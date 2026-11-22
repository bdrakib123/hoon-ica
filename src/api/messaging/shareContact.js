/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const createCallback = require("../../utils/createCallback");

// Instagram has no contact-card message, so fca.shareContact(uid, uid, threadID,
// messageID) is answered with the user's profile link + id as a normal message.
module.exports = function (client) {
  return async function shareContact(uid, _uid2, threadID, callback) {
    const cb = createCallback(callback);
    try {
      const u = await client.api.getUserInfo(String(uid)).catch(() => null);
      const name = u?.full_name || u?.username || String(uid);
      const link = u?.username ? `https://instagram.com/${u.username}` : `https://instagram.com/${uid}`;
      const info = await client.sendMessage({ body: `\u{1F464} ${name}\n\u{1F517} ${link}\n\u{1F194} ${uid}` }, String(threadID));
      if (cb) await cb(null, info);
      return info;
    } catch (error) {
      if (cb?.called) throw error;
      client.lastShareContactError = error;
      if (cb) await cb(error, null);
      return null;
    }
  };
};
