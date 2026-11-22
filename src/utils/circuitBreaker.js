"use strict";

const STATE = Object.freeze({ CLOSED: "closed", OPEN: "open", HALF_OPEN: "half_open" });

/**
 * Optional circuit breaker. It is not connected to HttpClient by default.
 * Use run(key, fn) to ensure only one half-open probe is in flight.
 */
class CircuitBreaker {
  constructor(options = {}) {
    const requestedThreshold = Number(options.failureThreshold);
    this.failureThreshold = Number.isSafeInteger(requestedThreshold) && requestedThreshold > 0
      ? Math.min(requestedThreshold, 1000)
      : 5;
    const requestedCooldown = Number(options.cooldownMs);
    this.cooldownMs = Number.isFinite(requestedCooldown) && requestedCooldown > 0
      ? Math.min(Math.floor(requestedCooldown), 24 * 60 * 60 * 1000)
      : 30000;
    this.isFailure = typeof options.isFailure === "function" ? options.isFailure : defaultFailure;
    const requestedMax = Number(options.maxCircuits);
    this.maxCircuits = Number.isSafeInteger(requestedMax) && requestedMax > 0
      ? Math.min(requestedMax, 10000)
      : 1000;
    this.circuits = new Map();
  }

  _entry(key) {
    const id = String(key || "default");
    let entry = this.circuits.get(id);
    if (!entry) {
      if (this.circuits.size >= this.maxCircuits) {
        const evictable = [...this.circuits].find(([, candidate]) =>
          candidate.state === STATE.CLOSED && !candidate.probeInFlight && candidate.inFlight === 0
        );
        if (!evictable) throw new RangeError("Circuit breaker has reached its configured circuit limit");
        this.circuits.delete(evictable[0]);
      }
      entry = { state: STATE.CLOSED, failures: 0, successes: 0, openedAt: 0, probeInFlight: false, inFlight: 0 };
      this.circuits.set(id, entry);
    }
    return entry;
  }

  _refresh(entry) {
    if (entry.state === STATE.OPEN && Date.now() - entry.openedAt >= this.cooldownMs) {
      entry.state = STATE.HALF_OPEN;
      entry.probeInFlight = false;
    }
  }

  canRequest(key) {
    const entry = this._entry(key);
    this._refresh(entry);
    return entry.state === STATE.CLOSED ||
      (entry.state === STATE.HALF_OPEN && !entry.probeInFlight);
  }

  async run(key, operation) {
    if (typeof operation !== "function") throw new TypeError("Circuit breaker operation must be a function");
    const entry = this._entry(key);
    this._refresh(entry);

    const probe = entry.state === STATE.HALF_OPEN;
    if (entry.state === STATE.OPEN || (probe && entry.probeInFlight)) {
      const error = new Error("Circuit breaker is open");
      error.code = "CIRCUIT_OPEN";
      throw error;
    }
    if (probe) entry.probeInFlight = true;
    entry.inFlight += 1;

    try {
      const result = await operation();
      // A request that started while CLOSED must not close a circuit that
      // another concurrent request opened while this operation was in flight.
      // Only a successful half-open probe may transition OPEN -> CLOSED.
      if (probe) {
        entry.failures = 0;
        entry.successes += 1;
        entry.state = STATE.CLOSED;
      } else if (entry.state === STATE.CLOSED) {
        entry.failures = 0;
        entry.successes += 1;
      }
      if (probe) entry.probeInFlight = false;
      return result;
    } catch (error) {
      if (probe) entry.probeInFlight = false;
      if (this.isFailure(error)) {
        entry.failures += 1;
        entry.successes = 0;
        if (probe || entry.failures >= this.failureThreshold) {
          entry.state = STATE.OPEN;
          entry.openedAt = Date.now();
        }
      }
      throw error;
    } finally {
      entry.inFlight = Math.max(0, entry.inFlight - 1);
    }
  }

  state(key) {
    const entry = this._entry(key);
    this._refresh(entry);
    return entry.state;
  }

  snapshot() {
    const result = {};
    for (const [key, entry] of this.circuits) {
      this._refresh(entry);
      result[key] = {
        state: entry.state,
        failures: entry.failures,
        successes: entry.successes,
        probeInFlight: entry.probeInFlight
      };
    }
    return result;
  }

  reset(key) {
    if (key !== undefined && key !== null) this.circuits.delete(String(key));
    else this.circuits.clear();
  }
}

function defaultFailure(error) {
  if (!error) return false;
  const status = Number(error.status || (error.response && error.response.status));
  if (status >= 500) return true;
  return ["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "ECONNREFUSED", "EAI_AGAIN", "ENETUNREACH"].includes(error.code);
}

module.exports = CircuitBreaker;
module.exports.STATE = STATE;
