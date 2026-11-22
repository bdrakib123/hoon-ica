/*!
const createCallback = require("../../utils/createCallback");
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.unsendMessage(messageID, callback, threadID) — the thread may be passed
// explicitly; otherwise it is resolved from the id. A bot that only knows the
// replied-to message id (it did not send that message in this process, e.g.
// after a restart) cannot resolve the thread, so the explicit thread is what
// makes /unsend work reliably.
module.exports = function (client) {
  return async function unsendMessage(messageID, callback, threadID) {
    const cb = createCallback(callback);
    try {
      const tid = client._resolveThread(messageID, threadID);
      const ok = await client.api.unsendMessage(tid, String(messageID));
      if (cb) cb(null, ok);
      return ok;
    } catch (error) {
      if (cb?.called) throw error;
      if (cb) cb(error, null);
      return false;
    }
  };
};
