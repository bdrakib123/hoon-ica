/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.getThreadHistory(threadID, amount, timestamp, callback).
module.exports = function (client) {
  return async function getThreadHistory(threadID, _amount, _timestamp, callback) {
    // FCA permits getThreadHistory(threadID, amount, callback) and
    // getThreadHistory(threadID, callback) with the timestamp omitted.
    if (typeof _amount === "function") {
      callback = _amount;
      _amount = null;
      _timestamp = null;
    } else if (typeof _timestamp === "function") {
      callback = _timestamp;
      _timestamp = null;
    }
    const cb = typeof callback === "function" ? callback : null;
    try {
      const requested = _amount == null ? 20 : Number(_amount);
      if (!Number.isInteger(requested) || requested <= 0) {
        throw new TypeError("getThreadHistory: amount must be a positive integer");
      }
      const limit = requested;
      const items = await client.api.getThreadHistory(String(threadID), limit, _timestamp);
      if (cb) cb(null, items);
      return items;
    } catch (error) {
      if (cb) cb(error, null);
      return [];
    }
  };
};
