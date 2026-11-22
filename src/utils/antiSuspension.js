/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

"use strict";

const { EventEmitter } = require("events");

const SUSPICION_PHRASES = [
  "checkpoint",
  "automated behavior",
  "automated_behavior",
  "unusual activity",
  "unusual_activity",
  "suspicious activity",
  "action_required",
  "account_locked",
  "account locked",
  "account has been disabled",
  "account has been suspended",
  "account suspended",
  "account banned",
  "bot detected",
  "bot_detected",
  "not a human",
  "spam detected",
  "spam_detected",
  "looks like spam",
  "rate limited",
  "rate_limit",
  "too many requests",
  "too_many_requests",
  "temporarily blocked",
  "feature temporarily unavailable",
  "verify your account",
  "confirm your identity",
  "security check required",
  "policy violation",
  "action blocked",
  "feedback_required"
];

const DEFAULTS = Object.freeze({
  enabled: true,
  warmupWindowMs: 20 * 60 * 1000,
  warmupHourlyCap: 30,
  normalHourlyCap: 150,
  dailyCap: 1000,
  cooldownMs: 60 * 60 * 1000,
  maxCooldownMs: 6 * 60 * 60 * 1000,
  escalationWindowMs: 24 * 60 * 60 * 1000,
  strikesToActivate: 2,
  strikeDecayMs: 30 * 60 * 1000,
  globalMinGapMs: 1500,
  perThreadMinGapMs: 2500,
  overCapGapMs: 20000,
  cooldownGapMs: 30000,
  jitterMs: 1500
});

class SendPacer extends EventEmitter {
  constructor(options = {}) {
    super();
    const cfg = { ...DEFAULTS, ...options };
    this.enabled = cfg.enabled !== false;
    this.perThreadLastSendAt = new Map();
    this.startedAt = Date.now();
    this.warmupWindowMs = cfg.warmupWindowMs;
    this.warmupHourlyCap = cfg.warmupHourlyCap;
    this.normalHourlyCap = cfg.normalHourlyCap;
    this.dailyCap = cfg.dailyCap;
    this.globalMinGapMs = cfg.globalMinGapMs;
    this.perThreadMinGapMs = cfg.perThreadMinGapMs;
    this.overCapGapMs = cfg.overCapGapMs;
    this.cooldownGapMs = cfg.cooldownGapMs;
    this.jitterMs = cfg.jitterMs;
    this.baseCooldownMs = cfg.cooldownMs;
    this.maxCooldownMs = cfg.maxCooldownMs;
    this.escalationWindowMs = cfg.escalationWindowMs;
    this.strikeDecayMs = cfg.strikeDecayMs;
    this.lastSendAt = 0;
    this.hourWindowStart = Date.now();
    this.hourSendCount = 0;
    this.dayWindowStart = Date.now();
    this.daySendCount = 0;
    this.cooldown = {
      active: false,
      since: null,
      durationMs: cfg.cooldownMs,
      strikes: 0,
      strikesToActivate: cfg.strikesToActivate,
      lastStrikeAt: null,
      lastSignal: null,
      lastActivationAt: null,
      level: 0
    };
    this._queue = Promise.resolve();
    this._timer = setInterval(() => this._rollWindows(), 60 * 1000);
    if (this._timer.unref) this._timer.unref();
  }

  destroy() {
    if (this._timer) clearInterval(this._timer);
  }

  _rollWindows() {
    const now = Date.now();
    if (now - this.hourWindowStart >= 60 * 60 * 1000) {
      this.hourWindowStart = now;
      this.hourSendCount = 0;
    }
    if (now - this.dayWindowStart >= 24 * 60 * 60 * 1000) {
      this.dayWindowStart = now;
      this.daySendCount = 0;
    }
  }

  _decayStrikes() {
    const c = this.cooldown;
    if (c.active || c.strikes === 0 || !c.lastStrikeAt) return;
    if (Date.now() - c.lastStrikeAt >= this.strikeDecayMs) c.strikes = 0;
  }

  _prune() {
    if (this.perThreadLastSendAt.size === 0) return;
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [key, at] of this.perThreadLastSendAt) {
      if (at < cutoff) this.perThreadLastSendAt.delete(key);
    }
    // A busy account can message hundreds of distinct threads within one
    // hour, so TTL pruning alone is not a hard memory bound. Evict the oldest
    // entries if active thread count still exceeds the cache budget.
    while (this.perThreadLastSendAt.size > 500) {
      const oldest = this.perThreadLastSendAt.keys().next().value;
      this.perThreadLastSendAt.delete(oldest);
    }
  }

  _rememberThreadSend(key, timestamp) {
    this.perThreadLastSendAt.delete(key);
    this.perThreadLastSendAt.set(key, timestamp);
    while (this.perThreadLastSendAt.size > 500) {
      const oldest = this.perThreadLastSendAt.keys().next().value;
      this.perThreadLastSendAt.delete(oldest);
    }
  }

  // Apply a partial config at runtime. Every key of DEFAULTS except `enabled`
  // and the strike/cap-count bookkeeping fields is honoured; a value that is not
  // a finite number (or a negative one) is ignored so a bad option cannot wedge
  // the pacer. Used by the `sendPacing` client option and by a bot that wants to
  // loosen (or switch off) the pacing after login.
  configure(options = {}) {
    for (const key of Object.keys(DEFAULTS)) {
      if (key === "enabled") continue;
      const value = Number(options[key]);
      if (Number.isFinite(value) && value >= 0) {
        this[key] = value;
        if (key === "cooldownMs") {
          this.baseCooldownMs = value;
          this.cooldown.durationMs = value;
        } else if (key === "strikesToActivate") {
          this.cooldown.strikesToActivate = value;
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(options, "enabled")) {
      this.enabled = options.enabled !== false;
    }
    return this.stats();
  }

  _inWarmup() {
    return Date.now() - this.startedAt < this.warmupWindowMs;
  }

  _hourlyCap() {
    return this._inWarmup() ? this.warmupHourlyCap : this.normalHourlyCap;
  }

  _activateCooldown(now) {
    const c = this.cooldown;
    const recent = c.lastActivationAt && now - c.lastActivationAt < this.escalationWindowMs;
    c.level = recent ? c.level + 1 : 1;
    c.durationMs = Math.min(this.baseCooldownMs * 2 ** (c.level - 1), this.maxCooldownMs);
    c.active = true;
    c.since = now;
    c.lastActivationAt = now;
    this.emit("cooldown", { level: c.level, durationMs: c.durationMs, signal: c.lastSignal });
  }

  noteSuspicionSignal(source) {
    const now = Date.now();
    const c = this.cooldown;
    c.strikes += 1;
    c.lastStrikeAt = now;
    c.lastSignal = source || null;
    if (c.active) {
      c.since = now;
      return;
    }
    if (c.strikes >= c.strikesToActivate) this._activateCooldown(now);
  }

  scanForSuspicion(text) {
    if (!text || typeof text !== "string") return false;
    const lower = text.toLowerCase();
    const hit = SUSPICION_PHRASES.find((p) => lower.includes(p));
    if (hit) this.noteSuspicionSignal(hit);
    return !!hit;
  }

  noteSendError(err) {
    if (!err) return;
    if (typeof err === "object" && err.__suspicionNoted) return;
    let text = "";
    try {
      if (typeof err === "string") text = err;
      else {
        text = [err.message, err.error, err.data && JSON.stringify(err.data), err.response && JSON.stringify(err.response.data)]
          .filter(Boolean)
          .join(" ");
      }
    } catch (_) {}
    const hit = this.scanForSuspicion(text);
    if (hit && typeof err === "object") {
      try {
        err.__suspicionNoted = true;
      } catch (_) {}
    }
  }

  isCoolingDown() {
    const c = this.cooldown;
    if (!c.active) return false;
    if (Date.now() - c.since >= c.durationMs) {
      c.active = false;
      c.strikes = 0;
      c.since = null;
      return false;
    }
    return true;
  }

  waitForTurn(threadID, opts) {
    if (!this.enabled) return Promise.resolve();
    const run = this._queue.then(() => this._turn(threadID, opts));
    this._queue = run.catch(() => {});
    return run.catch(() => {});
  }

  async _turn(threadID, opts = {}) {
    this._rollWindows();
    this._decayStrikes();
    this._prune();

    const key = String(threadID);

    // A captioned media is one logical message. Instagram's own client sends the
    // caption text and the attachment back-to-back, not seconds apart, so the
    // media pass asks for an immediate turn: still counted against the volume
    // caps (so the hourly/daily budget stays accurate) but without the
    // inter-message gap that made the image trail the text.
    if (opts && opts.immediate) {
      const stamp = Date.now();
      this.lastSendAt = stamp;
      this._rememberThreadSend(key, stamp);
      this.hourSendCount++;
      this.daySendCount++;
      return;
    }

    const cooling = this.isCoolingDown();
    const overCap = this.hourSendCount >= this._hourlyCap() || this.daySendCount >= this.dailyCap;

    let gap = this.globalMinGapMs;
    if (cooling) gap = Math.max(gap, this.cooldownGapMs);
    else if (overCap) gap = Math.max(gap, this.overCapGapMs);

    const now = Date.now();
    const sinceGlobal = now - this.lastSendAt;
    const sinceThread = now - (this.perThreadLastSendAt.get(key) || 0);
    const base = Math.max(gap - sinceGlobal, this.perThreadMinGapMs - sinceThread, 0);
    // Jitter only breaks up back-to-back sends. When nothing is queued (the first
    // reply to a message after a quiet spell) base is 0 and the send goes out
    // immediately, instead of always paying 0.3-1.0x jitterMs.
    const jitter = base > 0 && this.jitterMs > 0 ? this.jitterMs * (0.3 + Math.random() * 0.7) : 0;

    if (base + jitter > 0) await this._sleep(base + jitter);

    const stamp = Date.now();
    this.lastSendAt = stamp;
    this.perThreadLastSendAt.set(key, stamp);
    this.hourSendCount++;
    this.daySendCount++;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }

  stats() {
    const c = this.cooldown;
    const cooling = this.isCoolingDown();
    return {
      warmup: this._inWarmup(),
      hourSendCount: this.hourSendCount,
      hourlyCap: this._hourlyCap(),
      daySendCount: this.daySendCount,
      dailyCap: this.dailyCap,
      coolingDown: cooling,
      cooldownLevel: c.level,
      cooldownRemainingMs: cooling ? Math.max(0, c.durationMs - (Date.now() - c.since)) : 0,
      strikes: c.strikes
    };
  }
}

const pacer = new SendPacer();

module.exports = {
  SendPacer,
  SUSPICION_PHRASES,
  globalAntiSuspension: pacer
};
