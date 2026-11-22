/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// Id reconciliation between the two inbound sources.
//
// A Direct message reaches the bot twice: once on the realtime MQTT push (fast,
// ~1s) and once on the next inbox poll (the safety net). The two name the same
// message differently:
//
//   poller  node.id            = "mid.$cAH8..."   (Instagram's mid)
//   push    item value.item_id = "330934783..."   (the numeric item id)
//   push    item value.message_id = "mid.$..."    (the mid, when the broker sends it)
//
// So a dedupe keyed on one id alone would treat the two copies as two messages
// and the bot would reply twice. buildKeys() returns every key a message can be
// recognised by, and MessageDeduper treats two arrivals as the same message when
// any key matches. The content fingerprint (thread + sender + body + a coarse
// timestamp bucket) is the fallback for a push payload that omits the mid.

"use strict";

const crypto = require("crypto");

const MID_RE = /^mid\./;
// Instagram timestamps appear in ms (13 digits) and microseconds (16 digits).
function toMillis(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e14 ? Math.round(n / 1000) : Math.round(n);
}

function sha1(text) {
  return crypto.createHash("sha1").update(String(text)).digest("hex").slice(0, 16);
}

// The mid, from whichever field the source used. A poller node exposes it as
// `id`; a push item may expose `message_id`, `mid` or an item_id shaped like one.
function extractMid(source = {}) {
  const candidates = [source.messageID, source.message_id, source.mid, source.item_id, source.itemID, source.id];
  for (const c of candidates) {
    if (c != null && MID_RE.test(String(c))) return String(c);
  }
  return null;
}

// The numeric item id, from whichever field the source used.
function extractItemId(source = {}) {
  const candidates = [source.item_id, source.itemID, source.id, source.messageID, source.message_id];
  for (const c of candidates) {
    if (c != null && /^\d+$/.test(String(c))) return String(c);
  }
  return null;
}

// Every key an inbound message can be recognised by. `timestamp` may be in ms or
// microseconds; the fingerprint bucket normalises it and tolerates ~1s of skew
// between the push and the poll.
function buildKeys(msg = {}) {
  const keys = new Set();
  const threadID = msg.threadID != null ? String(msg.threadID) : "";
  const senderID = msg.senderID != null ? String(msg.senderID) : "";

  const mid = extractMid(msg);
  if (mid) keys.add(`mid:${mid}`);
  const itemID = extractItemId(msg);
  if (itemID) keys.add(`item:${itemID}`);
  if (msg.offlineThreadingId != null && String(msg.offlineThreadingId)) {
    keys.add(`otd:${msg.offlineThreadingId}`);
  }

  // Content fingerprint, only when there is a sender and a body: two genuinely
  // different messages from the same sender rarely share a body in the same
  // second, and without it a push that carries no mid could never be matched to
  // its poller copy.
  const body = msg.body == null ? "" : String(msg.body);
  const timestampMs = toMillis(msg.timestamp);
  if (threadID && senderID && body && timestampMs > 0) {
    const bucket = Math.floor(timestampMs / 1000);
    keys.add(`fp:${sha1(`${threadID}|${senderID}|${body}|${bucket}`)}`);
  }
  return keys;
}

// Sliding window of recently-seen message keys. Bounded so a long-running bot
// does not grow it without limit.
class MessageDeduper {
  constructor(options = {}) {
    const ttlMs = Number(options.ttlMs);
    const max = Number(options.max);
    this.ttlMs = Number.isFinite(ttlMs) && ttlMs > 0
      ? Math.min(ttlMs, 24 * 60 * 60 * 1000)
      : 10 * 60 * 1000;
    // Zero explicitly disables retention; negative/invalid values fall back
    // safely. A hard ceiling prevents a caller typo from making this cache huge.
    this.max = Number.isSafeInteger(max) && max >= 0
      ? Math.min(max, 100000)
      : 5000;
    this._seen = new Map(); // key -> seenAt
  }

  _prune(now) {
    for (const [key, at] of this._seen) {
      if (now - at > this.ttlMs) this._seen.delete(key);
    }
    while (this._seen.size > this.max) {
      const oldest = this._seen.keys().next().value;
      this._seen.delete(oldest);
    }
  }

  has(keys) {
    const now = Date.now();
    this._prune(now);
    for (const key of keys) if (this._seen.has(key)) return true;
    return false;
  }

  add(keys) {
    const now = Date.now();
    for (const key of keys) this._seen.set(key, now);
    this._prune(now);
  }

  // true when the message is new (and records it), false when it is a duplicate.
  accept(keys) {
    if (this.has(keys)) return false;
    this.add(keys);
    return true;
  }

  clear() {
    this._seen.clear();
  }

  get size() {
    return this._seen.size;
  }
}

module.exports = { buildKeys, extractMid, extractItemId, toMillis, MessageDeduper };
