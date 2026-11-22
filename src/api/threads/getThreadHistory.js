/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.getThreadHistory(threadID, amount, timestamp, callback).
module.exports = function (client) {
  return async function getThreadHistory(threadID, _amount, _timestamp, callback) {
    const cb = typeof callback === "function" ? callback : null;
    try {
      const limit = Math.max(Number(_amount) || 0, 20);
      const items = await client.api.getThreadHistory(String(threadID), limit, _timestamp);
      if (cb) cb(null, items);
      return items;
    } catch (error) {
      if (cb) cb(error, null);
      return [];
    }
  };
};
