/*!
const createCallback = require("../../utils/createCallback");
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.editMessage(text, messageID) — edit the body of a message we sent.
// Instagram only allows this within 15 minutes of sending.
module.exports = function (client) {
  return async function editMessage(text, messageID, callback) {
    const cb = createCallback(callback);
    client.lastEditError = null;
    try {
      const tid = client._resolveThread(messageID);
      const res = await client.api.editMessage(tid, String(messageID), String(text ?? ""));
      if (res === false && client.api.lastEditError) {
        client.lastEditError = client.api.lastEditError;
        if (cb) cb(client.lastEditError, null);
        return false;
      }
      if (cb) cb(null, res);
      return res;
    } catch (error) {
      // Preserve FCA's non-throwing contract, but expose the reason for debugging.
      client.lastEditError = error;
      if (cb?.called) throw error;
      if (cb) cb(error, null);
      return false;
    }
  };
};
