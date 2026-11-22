/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.getSelfInfo(callback) -> the logged-in account's own profile.
//
// Convenience wrapper over getUserInfoV2 for the bot's own id. Unlike another
// user's profile this always resolves: the session cookie carries the account
// id and the account's own page embeds its full PolarisViewer blob.
module.exports = function (client) {
  return async function getSelfInfo(callback) {
    const cb = typeof callback === "function" ? callback : null;
    const selfID = typeof client.getCurrentUserID === "function" ? client.getCurrentUserID() : client.userID;
    try {
      const info = await client.getUserInfoV2(selfID);
      const profile = info && info[String(selfID)] ? info[String(selfID)] : null;
      if (cb) cb(null, profile);
      return profile;
    } catch (error) {
      if (cb) cb(error, null);
      return null;
    }
  };
};
