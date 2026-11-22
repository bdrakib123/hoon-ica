"use strict";

/**
 * Optional, caller-managed adaptive request pacing.
 *
 * This utility is deliberately NOT wired into HttpClient: existing request
 * timing remains unchanged unless an application explicitly uses it.
 */
class AdaptiveRateLimiter {
  constructor(options = {}) {
    this.globalMinDelayMs = positive(options.globalMinDelayMs, 0);
    this.perUrlBaseDelayMs = positive(options.perUrlBaseDelayMs, 0);
    this.maxDelayMs = Math.max(this.perUrlBaseDelayMs, positive(options.maxDelayMs, 60000));
    this.relaxAfterSuccesses = Math.max(1, Math.floor(positive(options.relaxAfterSuccesses, 10)));
    this.relaxFactor = clamp(options.relaxFactor, 0.1, 0.99, 0.9);
    this.bumpFactor = Math.max(1.1, positive(options.bumpFactor, 2));
    this.lastGlobalRequest = 0;
    this.endpoints = new Map();
  }

  _key(url) {
    if (!url) return "__unknown__";
    try {
      const parsed = new URL(String(url));
      return parsed.origin + parsed.pathname;
    } catch (_) {
      return String(url).split("?")[0];
    }
  }

  _entry(url) {
    const key = this._key(url);
    let entry = this.endpoints.get(key);
    if (!entry) {
      entry = { delayMs: this.perUrlBaseDelayMs, lastRequest: 0, successStreak: 0 };
      this.endpoints.set(key, entry);
    }
    return entry;
  }

  recommendDelay(url, now = Date.now()) {
    const entry = this._entry(url);
    return Math.max(
      0,
      this.globalMinDelayMs - (now - this.lastGlobalRequest),
      entry.delayMs - (now - entry.lastRequest)
    );
  }

  markRequest(url, now = Date.now()) {
    this.lastGlobalRequest = now;
    this._entry(url).lastRequest = now;
  }

  recordResponse(url, responseOrError) {
    const entry = this._entry(url);
    const status = Number(
      responseOrError && (responseOrError.status ||
      (responseOrError.response && responseOrError.response.status))
    );
    const headers = responseOrError && (
      responseOrError.headers ||
      (responseOrError.response && responseOrError.response.headers)
    ) || {};

    if (status === 429) {
      const raw = typeof headers.get === "function"
        ? headers.get("retry-after")
        : (headers["retry-after"] || headers["Retry-After"]);
      const hasRetryAfter = raw !== undefined && raw !== null && raw !== "";
      const seconds = hasRetryAfter ? Number(raw) : NaN;
      const retryAt = hasRetryAfter && !Number.isFinite(seconds)
        ? Date.parse(String(raw))
        : NaN;
      const retryAfterMs = Number.isFinite(seconds) && seconds >= 0
        ? seconds * 1000
        : (Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : null);
      entry.delayMs = retryAfterMs !== null
        ? Math.min(this.maxDelayMs, retryAfterMs)
        : Math.min(this.maxDelayMs, Math.max(this.perUrlBaseDelayMs, entry.delayMs) * this.bumpFactor);
      entry.successStreak = 0;
      return entry.delayMs;
    }

    if (status >= 200 && status < 300) {
      entry.successStreak += 1;
      if (entry.successStreak >= this.relaxAfterSuccesses) {
        entry.delayMs = Math.max(this.perUrlBaseDelayMs, entry.delayMs * this.relaxFactor);
        entry.successStreak = 0;
      }
    }
    return entry.delayMs;
  }

  snapshot() {
    const result = {};
    for (const [key, entry] of this.endpoints) {
      result[key] = { delayMs: entry.delayMs, successStreak: entry.successStreak };
    }
    return result;
  }

  reset() {
    this.endpoints.clear();
    this.lastGlobalRequest = 0;
  }
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

module.exports = AdaptiveRateLimiter;
