/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.getProfileBio(idOrUsername, callback) -> { id, username, name, biography }.
//
// The biography is the profile "about" text. Sourced from the same logout-safe
// profile resolver as getUserInfoV2, so a rate-limited profile endpoint yields
// an empty bio rather than an error.
module.exports = function (client) {
  return async function getProfileBio(idOrUsername, callback) {
    const cb = typeof callback === "function" ? callback : null;
    const key = String(idOrUsername == null ? "" : idOrUsername).replace(/^@/, "");
    try {
      const profile = await client.getProfile(key).catch(() => null);
      const out = {
        id: profile?.id || null,
        userID: profile?.id || null,
        username: profile?.username || null,
        name: profile?.fullName || null,
        biography: profile?.biography || ""
      };
      if (cb) cb(null, out);
      return out;
    } catch (error) {
      if (cb) cb(error, null);
      return { id: null, userID: null, username: null, name: null, biography: "" };
    }
  };
};
