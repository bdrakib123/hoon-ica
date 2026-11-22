/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.markAsRead(threadID, itemID) -> Instagram's item-seen call.
module.exports = function (client) {
  return async function markAsRead(threadID, itemID) {
    return client.api.markThreadSeen(String(threadID), itemID).catch(() => false);
  };
};
