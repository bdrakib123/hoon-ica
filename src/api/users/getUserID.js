/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.getUserID(idOrUsername, callback) -> the numeric user id (pk) as a string.
//
// Resolves an @handle to its id, or passes a numeric id through. Answers from
// the inbox-learned index first (free), then the logout-safe profile resolver.
// Returns null when the handle cannot be resolved.
module.exports = function (client) {
  return async function getUserID(idOrUsername, callback) {
    const cb = typeof callback === "function" ? callback : null;
    const raw = String(idOrUsername == null ? "" : idOrUsername).trim().replace(/^@/, "");
    if (/^\d+$/.test(raw)) {
      if (cb) cb(null, raw);
      return raw;
    }
    try {
      const profile = await client.getProfile(raw).catch(() => null);
      const id = profile?.id || null;
      if (cb) cb(null, id);
      return id;
    } catch (error) {
      if (cb) cb(error, null);
      return null;
    }
  };
};
