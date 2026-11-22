/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// Instagram's realtime broker (edge-mqtt.facebook.com) speaks MQTToT with
// cookie_auth: the CONNECT password is "sessionid=<sessionid>" and the session
// cookie authenticates the connection, so no app login is needed. This client
// keeps that connection open and turns the broker's Direct message-sync and
// realtime-sub publishes into plain events.
//
// Message-sync (topic 146) is the Direct stream: the broker pushes Relay-style
// patches ({ path: "/direct_v2/threads/<threadID>", op, value }) as messages
// arrive, which is what makes listen() push instead of poll. Topics:
//   88 pubsub · 133 send-response · 135 iris-sub-response
//   146 message-sync · 149 realtime-sub · 150 region-hint

"use strict";

const { EventEmitter } = require("events");
const crypto = require("crypto");

const {
  MQTToTConnection,
  SocketMQTToTTransport,
  compressPayload,
  writeConnectPacket,
  writeDisconnectPacket,
  writePingreqPacket,
  writePublishPacket,
  writeSubscribePacket,
  decodePacket,
  tryDecompressPayload,
  parseJsonPayload,
  KEEP_ALIVE_SECONDS
} = require("./mqttot");

const REALTIME_HOST = "edge-mqtt.facebook.com";
const IG_REALTIME_APP_ID = 567067343352427;
const REALTIME_SUBSCRIBE_TOPICS = [88, 135, 149, 150, 133, 146];
// The PINGREQ interval (ms). It must fire well inside the CONNECT keep-alive
// (KEEP_ALIVE_SECONDS), or the broker tears the socket down between pings — a
// 20s keep-alive with a 30s ping got the connection dropped every ~30s.
const PING_INTERVAL_MS = 25000;

// An Android app identity. The broker expects the app's own UA + app version in
// the CONNECT's appSpecificInfo; a web UA is rejected.
const ANDROID_UA =
  "Instagram 449.0.0.52.84 Android (34/14; 480dpi; 1344x2992; Google/google; Pixel 8 Pro; husky; husky; en_US; 1079242191)";
const APP_VERSION = "449.0.0.52.84";
const CAPABILITIES = "3brTv10=";
const LOCALE = "en_US";

const TOPICS = {
  PUBSUB: "88",
  SEND_MESSAGE: "132",
  SEND_MESSAGE_RESPONSE: "133",
  IRIS_SUB: "134",
  IRIS_SUB_RESPONSE: "135",
  MESSAGE_SYNC: "146",
  REALTIME_SUB: "149",
  REGION_HINT: "150"
};

class RealtimeClient extends EventEmitter {
  constructor(context, options = {}) {
    super();
    this.context = context || {};
    this.options = options;
    this.host = options.host || REALTIME_HOST;
    this.transport = options.transport || new SocketMQTToTTransport(this.host, 443, { timeout: options.socketTimeout || 30000 });
    this.connected = false;
    this._packetId = 0;
    this._loop = null;
    this._pingTimer = null;
    this._stopRequested = false;
  }

  _deviceId() {
    const id = this.context.deviceId || this.context.phoneId || this.context.uuid || "";
    if (!id) throw new Error("realtime: deviceId is required");
    return String(id);
  }

  _sessionId() {
    const raw = this.context.sessionid;
    if (!raw) throw new Error("realtime: sessionid is required");
    // The browser stores the sessionid URL-encoded (32715034217%3A...); the
    // broker wants the decoded value.
    try {
      return decodeURIComponent(String(raw));
    } catch (_) {
      return String(raw);
    }
  }

  buildConnection() {
    const deviceId = this._deviceId();
    const userAgent = this.context.userAgent || ANDROID_UA;
    const appVersion = this.context.appVersion || APP_VERSION;
    return new MQTToTConnection({
      clientIdentifier: deviceId.slice(0, 20),
      clientInfo: {
        userId: this.context.userId || 0,
        userAgent,
        clientCapabilities: 183,
        endpointCapabilities: 0,
        publishFormat: 1,
        noAutomaticForeground: false,
        makeUserAvailableInForeground: true,
        deviceId,
        isInitiallyForeground: true,
        networkType: 1,
        networkSubtype: 0,
        clientMqttSessionId: Date.now() & 0xffffffff,
        subscribeTopics: REALTIME_SUBSCRIBE_TOPICS,
        clientType: "cookie_auth",
        appId: IG_REALTIME_APP_ID,
        deviceSecret: "",
        clientStack: 3
      },
      password: `sessionid=${this._sessionId()}`,
      appSpecificInfo: {
        app_version: appVersion,
        "X-IG-Capabilities": CAPABILITIES,
        everclear_subscriptions: JSON.stringify({
          inapp_notification_subscribe_comment: "17899377895239777",
          inapp_notification_subscribe_comment_mention_and_reply: "17899377895239777",
          video_call_participant_state_delivery: "17977239895057311",
          presence_subscribe: "17846944882223835"
        }),
        "User-Agent": userAgent,
        "Accept-Language": LOCALE.replace("_", "-"),
        platform: "android",
        ig_mqtt_route: "django",
        pubsub_msg_type_blacklist: "direct, typing_type",
        auth_cache_enabled: "0"
      }
    });
  }

  async connect() {
    if (this.connected) return this;
    // A previous connection that dropped leaves a closed transport and a live
    // ping timer behind; clear both so the reconnect is clean and pings do not
    // accumulate one per attempt.
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = null;
    this._stopRequested = false;
    if (this.transport && typeof this.transport.reset === "function") this.transport.reset();
    try {
      await this.transport.connect();
      if (this._stopRequested) throw new Error("Realtime MQTT connection cancelled");
      await this.transport.send(writeConnectPacket(this.buildConnection(), KEEP_ALIVE_SECONDS));
      if (this._stopRequested) throw new Error("Realtime MQTT connection cancelled");
      const packet = decodePacket(await this.transport.recvPacket());
      if (this._stopRequested) throw new Error("Realtime MQTT connection cancelled");
      if (packet.packetType !== "connack" || packet.returnCode !== 0) {
        throw new Error(`Realtime MQTT connect failed (return code ${packet.returnCode})`);
      }
      this.connected = true;
      this._stopRequested = false;
      this.emit("connected", { host: this.host });
      this._startPing();
      this._startLoop();
      return this;
    } catch (error) {
      // A failed TLS/MQTT handshake must not leave its socket alive. The
      // listener may switch to polling and the same client may be retried later.
      this.connected = false;
      this._stopRequested = true;
      if (this._pingTimer) clearInterval(this._pingTimer);
      this._pingTimer = null;
      try {
        if (this.transport && typeof this.transport.disconnect === "function") {
          this.transport.disconnect();
        }
      } catch (_) {}
      throw error;
    }
  }

  _startPing() {
    // Ping comfortably inside the keep-alive the CONNECT advertised, so the
    // broker never times the connection out between pings.
    const keepAliveMs = this.options.keepAliveMs || PING_INTERVAL_MS;
    this._pingTimer = setInterval(() => {
      if (this.connected) this.transport.send(writePingreqPacket()).catch(() => {});
    }, keepAliveMs);
    if (this._pingTimer.unref) this._pingTimer.unref();
  }

  _startLoop() {
    this._loop = (async () => {
      let receiveError = null;
      try {
        while (this.connected) {
          let packet;
          try {
            packet = decodePacket(await this.transport.recvPacket());
          } catch (err) {
            receiveError = err;
            if (!this._stopRequested) this.emit("error", err);
            break;
          }
          try {
            this._handlePacket(packet);
          } catch (err) {
            this.emit("error", err);
          }
        }
      } finally {
        this.connected = false;
        if (this._pingTimer) clearInterval(this._pingTimer);
        this._pingTimer = null;
        // A malformed packet can terminate the receive loop while the TLS socket
        // is still open. Close it before announcing disconnection so polling
        // fallback/reconnect cannot leave an idle broker connection behind.
        // The finally block also guarantees cleanup if an error listener throws.
        if (receiveError && !this._stopRequested) {
          this._stopRequested = true;
          try {
            if (this.transport && typeof this.transport.disconnect === "function") {
              this.transport.disconnect();
            }
          } catch (_) {}
        }
        this.emit("disconnected", {});
      }
    })();
  }

  _handlePacket(packet) {
    if (packet.packetType !== "publish" || packet.topic == null) return;
    this.dispatch(packet.topic, packet.payload);
    if (packet.qos === 1 && packet.packetId != null) {
      this.transport.send(Buffer.concat([Buffer.from([0x40, 0x02]), uint16(packet.packetId)])).catch(() => {});
    }
  }

  dispatch(topic, payload) {
    const body = tryDecompressPayload(payload);
    let parsed;
    if (
      topic === TOPICS.SEND_MESSAGE_RESPONSE ||
      topic === TOPICS.IRIS_SUB_RESPONSE ||
      topic === TOPICS.REALTIME_SUB ||
      topic === TOPICS.MESSAGE_SYNC
    ) {
      parsed = safeJson(body);
    } else {
      parsed = safeJson(payload);
    }
    this.emit("receive", { topic, payload: parsed });
    if (topic === TOPICS.SEND_MESSAGE_RESPONSE) this.emit("send_response", parsed);
    if (topic === TOPICS.IRIS_SUB_RESPONSE) this.emit("iris_sub_response", parsed);
    if (topic === TOPICS.MESSAGE_SYNC) this._dispatchMessageSync(parsed);
    if (topic === TOPICS.REALTIME_SUB) this._dispatchRealtimeSub(parsed);
    return parsed;
  }

  // message-sync payloads are a list of { data: [ { path, op, value } ] } patches.
  _dispatchMessageSync(payload) {
    if (!Array.isArray(payload)) return this.emit("iris", payload);
    for (const item of payload) {
      if (!item || typeof item !== "object" || !Array.isArray(item.data)) {
        this.emit("iris", item);
        continue;
      }
      const meta = {};
      for (const [k, v] of Object.entries(item)) if (k !== "data") meta[k] = v;
      for (const patch of item.data) {
        if (!patch || typeof patch !== "object") continue;
        const path = patch.path;
        if (!path || patch.value == null) {
          this.emit("iris", { ...meta, ...patch });
          continue;
        }
        const value = parseMaybeJson(patch.value);
        const threadID = threadIdFromPath(path);
        const wrapped = {
          ...meta,
          message: {
            path,
            op: patch.op,
            thread_id: threadID,
            ...(value && typeof value === "object" ? value : { value })
          }
        };
        this.emit(path.startsWith("/direct_v2/threads/") ? "message" : "thread_update", wrapped);
        this._dispatchDirectEvent({ path, op: patch.op, value, threadID });
      }
    }
  }

  _dispatchRealtimeSub(payload) {
    this.emit("realtime_sub", payload);
    if (!payload || typeof payload !== "object") return;
    let message = payload.message;
    if (typeof message === "string") message = safeJson(Buffer.from(message));
    if (!message || typeof message !== "object") return;
    if (message.topic !== "direct") return;
    let direct = message.json || message.payload;
    if (typeof direct === "string") direct = safeJson(Buffer.from(direct));
    this._dispatchDirectPayload(direct);
  }

  _dispatchDirectPayload(payload) {
    if (!payload || typeof payload !== "object") return this._dispatchDirectEvent({ value: payload });
    if (!Array.isArray(payload.data)) return this._dispatchDirectEvent(payload);
    const meta = {};
    for (const [k, v] of Object.entries(payload)) if (k !== "data") meta[k] = v;
    for (const item of payload.data) {
      this._dispatchDirectEvent(item && typeof item === "object" ? { ...meta, ...item } : { ...meta, value: item });
    }
  }

  _dispatchDirectEvent(event) {
    const out = { ...event };
    let value = out.value;
    if (typeof value === "string") value = safeJson(Buffer.from(value));
    out.value = value;
    if (out.path && !out.threadID) out.threadID = threadIdFromPath(out.path);
    this.emit("direct", out);
    const kind = classifyDirectEvent(out);
    if (kind) this.emit(kind, out);
  }

  publishBytes(topic, payload) {
    // MQTT packet identifiers are non-zero unsigned 16-bit values. Wrap before
    // uint16 encoding would silently turn 65536 into the invalid id 0.
    this._packetId = (this._packetId % 65535) + 1;
    const packet = writePublishPacket(topic, payload, 1, this._packetId);
    return this.transport.send(packet);
  }

  publishJson(topic, data) {
    return this.publishBytes(topic, compressPayload(Buffer.from(JSON.stringify(data))));
  }

  irisSubscribe(seqId, snapshotAtMs, appVersion) {
    return this.publishJson(TOPICS.IRIS_SUB, {
      seq_id: seqId,
      snapshot_at_ms: snapshotAtMs,
      snapshot_app_version: appVersion || this.context.appVersion || APP_VERSION
    });
  }

  graphQlSubscribe(subscriptions) {
    return this.publishJson(TOPICS.REALTIME_SUB, { sub: [].concat(subscriptions) });
  }

  skywalkerSubscribe(subscriptions) {
    return this.publishJson(TOPICS.PUBSUB, { sub: [].concat(subscriptions) });
  }

  async ping() {
    if (!this.connected) throw new Error("Realtime client is not connected");
    await this.transport.send(writePingreqPacket());
    return true;
  }

  disconnect() {
    this._stopRequested = true;
    this.connected = false;
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = null;
    // send() returns a promise (the socket write); during teardown that write is
    // cancelled and rejects with ECANCELED, so the rejection must be swallowed
    // here rather than becoming an unhandled rejection that crashes the process.
    try {
      Promise.resolve(this.transport.send(writeDisconnectPacket())).catch(() => {});
    } catch (_) {}
    this.transport.disconnect();
    return this;
  }
}

// Extracts the thread id from a message-sync path such as
// "/direct_v2/threads/1234/items/..." or "/direct_v2/inbox/threads/1234".
function threadIdFromPath(path) {
  const p = String(path || "");
  let m = p.match(/^\/direct_v2\/threads\/([^/]+)/);
  if (m) return m[1];
  m = p.match(/^\/direct_v2\/inbox\/threads\/([^/]+)/);
  if (m) return m[1];
  return null;
}

function classifyDirectEvent(event) {
  const path = String(event.path || "").toLowerCase();
  const action = String(event.action || "").toLowerCase();
  const value = event.value;
  const valueText = value && typeof value === "object" ? JSON.stringify(value).toLowerCase() : String(value || "").toLowerCase();
  if (valueText.includes("activity_status") || path.includes("activity_indicator") || path.includes("typing")) return "typing";
  if (path.includes("presence") || valueText.includes("is_active") || valueText.includes("last_active")) return "presence";
  if (action === "mark_seen" || path.includes("/seen") || valueText.includes("seen")) return "seen";
  return null;
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  const parsed = safeJson(Buffer.from(value));
  return parsed === undefined ? value : parsed;
}

function safeJson(buffer) {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (_) {
    return buffer;
  }
}

function uint16(value) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(value & 0xffff, 0);
  return buf;
}

module.exports = {
  RealtimeClient,
  REALTIME_HOST,
  IG_REALTIME_APP_ID,
  REALTIME_SUBSCRIBE_TOPICS,
  KEEP_ALIVE_SECONDS,
  PING_INTERVAL_MS,
  TOPICS,
  ANDROID_UA,
  APP_VERSION,
  threadIdFromPath,
  classifyDirectEvent,
  newClientContext: () => crypto.randomUUID()
};
