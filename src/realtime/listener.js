/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// The realtime listener: it opens the MQTT connection, subscribes to the Direct
// message-sync stream and feeds decoded messages to a callback as they arrive,
// instead of the inbox poller's interval. It is push, so a bot replies as soon
// as Instagram delivers the message.
//
// Real-time is best-effort. Instagram can drop the socket, refuse the iris
// subscription, or the process can run on a host that blocks the broker, so the
// listener reports failure instead of pretending to be connected; listen() keeps
// the poller as its fallback.

"use strict";

const { RealtimeClient } = require("./client");
const { rawEventFromMessageSync } = require("./bridge");

class RealtimeListener {
  constructor(context, options = {}) {
    this.context = context || {};
    this.options = options;
    this.connected = false;
    this._client = null;
    this._callback = null;
    this._stopped = false;
    this._subscribed = false;
    this._subscriptionTimer = null;
    this._subscriptionAckHandler = null;
    this._subscriptionReject = null;
  }

  _emitError(err) {
    if (typeof this.options.onError === "function") this.options.onError(err);
    else if (this._callback) this._callback(err, null);
  }

  _handleMessageSync(event) {
    if (this._stopped || !this._callback) return;
    const raw = rawEventFromMessageSync(event, this.context.userId, { selfListen: this.options.selfListen === true });
    if (raw) this._callback(null, raw);
  }

  _resolveCursor() {
    const opts = this.options;
    if (opts.seqId != null && opts.snapshotAtMs != null) {
      return { seqId: opts.seqId, snapshotAtMs: opts.snapshotAtMs };
    }
    if (typeof opts.getRealtimeState === "function") {
      return Promise.resolve(opts.getRealtimeState()).then((state) => state || null);
    }
    return Promise.resolve(null);
  }

  async _subscribeWithAck(cursor) {
    const timeoutMs = Math.max(1, Number(this.options.subscriptionTimeoutMs) || 10000);
    let timer;
    let onAck;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (onAck) this._client.removeListener("iris_sub_response", onAck);
      if (this._subscriptionTimer === timer) this._subscriptionTimer = null;
      if (this._subscriptionAckHandler === onAck) this._subscriptionAckHandler = null;
    };
    const acknowledgement = new Promise((resolve, reject) => {
      this._subscriptionReject = reject;
      onAck = (payload) => {
        cleanup();
        this._subscriptionReject = null;
        if (payload && (payload.error || payload.error_type || payload.status === "fail" || payload.success === false)) {
          reject(new Error("Realtime iris subscription was rejected"));
          return;
        }
        resolve(payload);
      };
      this._subscriptionAckHandler = onAck;
      this._client.once("iris_sub_response", onAck);
      timer = setTimeout(() => {
        cleanup();
        this._subscriptionReject = null;
        reject(new Error("Realtime iris subscription acknowledgement timed out"));
      }, timeoutMs);
      this._subscriptionTimer = timer;
    });

    try {
      await this._client.irisSubscribe(Number(cursor.seqId) || 0, Number(cursor.snapshotAtMs));
      return await acknowledgement;
    } catch (error) {
      cleanup();
      this._subscriptionReject = null;
      throw error;
    }
  }

  async start(callback) {
    this._callback = callback;
    // Prefer a caller-supplied client (the session's single shared MQTT
    // connection). A second connection on the same device id silently steals the
    // Direct message-sync stream from the first, so when one is offered we attach
    // to it rather than dialing our own.
    let owned = true;
    if (typeof this.options.getClient === "function") {
      this._client = await this.options.getClient();
      owned = false;
    } else {
      this._client = new RealtimeClient(this.context, this.options);
    }
    this._owned = owned;
    // stop() can run while a shared-client provider is still resolving. Do not
    // attach handlers or start a subscription after that listener was cancelled.
    if (this._stopped) return this;

    // Keep per-instance handler references so stop() can detach exactly its own
    // listeners from a shared client without disturbing the other consumers.
    this._onMessage = (event) => this._handleMessageSync(event);
    this._onError = (err) => this._emitError(err);
    this._onDisconnected = () => {
      this.connected = false;
      if (!this._stopped) this._emitError(new Error("Realtime MQTT connection closed"));
    };
    this._client.on("message", this._onMessage);
    this._client.on("error", this._onError);
    this._client.on("disconnected", this._onDisconnected);

    try {
      if (!this._client.connected) await this._client.connect();
      if (this._stopped) return this;
      this.connected = true;

      const cursor = await this._resolveCursor();
      if (this._stopped) return this;
      if (cursor && cursor.seqId != null && cursor.snapshotAtMs != null) {
        await this._subscribeWithAck(cursor);
        if (this._stopped) return this;
        this._subscribed = true;
      }
      if (typeof this.options.onReady === "function") this.options.onReady(this);
      return this;
    } catch (error) {
      // A failed start must not leave handlers attached to a shared session
      // client or an owned MQTT socket alive when the caller forgets stop().
      this.stop();
      throw error;
    }
  }

  stop() {
    this._stopped = true;
    this.connected = false;
    if (!this._client) return;
    if (this._subscriptionTimer) clearTimeout(this._subscriptionTimer);
    if (this._subscriptionAckHandler && typeof this._client.removeListener === "function") {
      this._client.removeListener("iris_sub_response", this._subscriptionAckHandler);
    }
    const rejectSubscription = this._subscriptionReject;
    this._subscriptionTimer = null;
    this._subscriptionAckHandler = null;
    this._subscriptionReject = null;
    if (rejectSubscription) rejectSubscription(new Error("Realtime listener stopped before subscription acknowledgement"));
    if (typeof this._client.removeListener === "function") {
      if (this._onMessage) this._client.removeListener("message", this._onMessage);
      if (this._onError) this._client.removeListener("error", this._onError);
      if (this._onDisconnected) this._client.removeListener("disconnected", this._onDisconnected);
    }
    // Only tear down a connection this listener owns; a shared client belongs to
    // the session and other consumers may still be using it.
    if (this._owned !== false) this._client.disconnect();
  }
}

module.exports = { RealtimeListener };
