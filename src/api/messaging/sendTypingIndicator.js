/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.sendTypingIndicator(threadID)
module.exports = function (client) {
  return async function sendTypingIndicator(threadID) {
    return client.api.startTyping(String(threadID)).catch(() => false);
  };
};
