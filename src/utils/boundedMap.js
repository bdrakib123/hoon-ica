"use strict";

// Keep long-lived per-session lookup maps bounded. Insertion order is used as
// a simple FIFO policy; updating a key refreshes its position.
function setBounded(map, key, value, maxSize = 5000) {
  if (!(map instanceof Map)) throw new TypeError("setBounded expects a Map");
  const limit = Math.max(1, Math.floor(Number(maxSize) || 5000));
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
  return map;
}

module.exports = { setBounded };
