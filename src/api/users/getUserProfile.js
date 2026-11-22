/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.getUserProfile(idOrUsername, callback) -> the full normalized profile
// object (see src/profileParse.js): id, username, fullName, biography, counts,
// flags, pictures, externalUrl, category and contact details.
//
// Thin FCA-shaped wrapper over the native getUserProfile(); returns null (never
// throws) when nothing resolves, so a caller can fall back safely.
module.exports = function (client) {
  return async function getUserProfile(idOrUsername, callback) {
    const cb = typeof callback === "function" ? callback : null;
    try {
      const profile = await client.getProfile(String(idOrUsername).replace(/^@/, ""));
      if (cb) cb(null, profile);
      return profile;
    } catch (error) {
      if (cb) cb(error, null);
      return null;
    }
  };
};
