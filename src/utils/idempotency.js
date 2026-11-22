"use strict";

/**
 * Optional in-memory deduplication helper.
 * Only successful, defined results are cached; rejected operations can retry.
 */
class IdempotencyCache {
  constructor(options = {}) {
    const requestedTtl = Number(options.ttlMs);
    this.ttlMs = Number.isFinite(requestedTtl) && requestedTtl > 0
      ? Math.min(Math.floor(requestedTtl), 7 * 24 * 60 * 60 * 1000)
      : 300000;
    const requestedMax = Number(options.maxSize);
    this.maxSize = Number.isSafeInteger(requestedMax) && requestedMax > 0
      ? Math.min(requestedMax, 100000)
      : 1000;
    const requestedInflight = Number(options.maxInflight);
    this.maxInflight = Number.isSafeInteger(requestedInflight) && requestedInflight > 0
      ? Math.min(requestedInflight, 100000)
      : 10000;
    this.store = new Map();
    this.inflight = new Map();
    this.generation = 0;
  }

  get(key) {
    if (key === undefined || key === null || key === "") return undefined;
    const id = String(key);
    const entry = this.store.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(id);
      return undefined;
    }
    return entry.value;
  }

  set(key, value) {
    if (key === undefined || key === null || key === "" || value === undefined) return;
    const id = String(key);
    this.store.delete(id);
    this.store.set(id, { value, expiresAt: Date.now() + this.ttlMs });
    this._prune();
  }

  async run(key, operation) {
    if (typeof operation !== "function") throw new TypeError("Idempotency operation must be a function");
    if (key === undefined || key === null || key === "") return operation();
    const id = String(key);
    const cached = this.get(id);
    if (cached !== undefined) return cached;
    if (this.inflight.has(id)) return this.inflight.get(id);
    if (this.inflight.size >= this.maxInflight) {
      throw new RangeError("Idempotency cache has reached its configured in-flight limit");
    }

    const generation = this.generation;
    let promise;
    promise = Promise.resolve().then(operation).then((value) => {
      if (generation === this.generation && value !== undefined) this.set(id, value);
      return value;
    }).finally(() => {
      if (this.inflight.get(id) === promise) this.inflight.delete(id);
    });
    this.inflight.set(id, promise);
    return promise;
  }

  _prune() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(key);
    }
    while (this.store.size > this.maxSize) {
      this.store.delete(this.store.keys().next().value);
    }
  }

  clear() {
    this.generation += 1;
    this.store.clear();
    this.inflight.clear();
  }
}

module.exports = IdempotencyCache;
