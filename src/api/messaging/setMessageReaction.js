/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const createCallback = require("../../utils/createCallback");

// fca.setMessageReaction(emoji, messageID, callback, force). Commands pass
// `true` as the 4th argument, so anything that is not a real thread id is
// ignored and the thread the message was seen in is used instead.
module.exports = function (client) {
  return async function setMessageReaction(emoji, messageID, callback, threadID) {
    const cb = createCallback(callback);
    try {
      const tid = client._resolveThread(messageID, threadID);
      await client.api.sendReaction(tid, String(messageID), emoji);
      const info = { messageID, threadID: tid };
      if (cb) cb(null, info);
      return info;
    } catch (error) {
      if (cb?.called) throw error;
      if (cb) cb(error, null);
      return null;
    }
  };
};
