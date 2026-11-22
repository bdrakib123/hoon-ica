"use strict";

// Instagram realtime sequence IDs may be 64-bit decimal strings. Preserve
// values outside JavaScript's safe integer range instead of rounding them.
function normalizeSequenceId(value) {
  if (typeof value === "bigint") {
    if (value < 0n) return null;
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  }
  if (typeof value === "string") {
    const decimal = value.trim();
    if (!/^\d+$/.test(decimal)) return null;
    try {
      const exact = BigInt(decimal);
      return exact <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(exact) : exact.toString();
    } catch (_) {
      return null;
    }
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return null;
}

module.exports = { normalizeSequenceId };
