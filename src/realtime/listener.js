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

    if (!this._client.connected) await this._client.connect();
    this.connected = true;

    const cursor = await this._resolveCursor();
    if (cursor && cursor.seqId != null && cursor.snapshotAtMs != null) {
      await this._client.irisSubscribe(Number(cursor.seqId) || 0, Number(cursor.snapshotAtMs));
      this._subscribed = true;
    } else if (typeof this.options.onReady === "function") {
      this.options.onReady(this);
    }
    return this;
  }

  stop() {
    this._stopped = true;
    this.connected = false;
    if (!this._client) return;
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
