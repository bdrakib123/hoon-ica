/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca's callback-free convenience wrapper: never rejects, resolves to
// { error } on failure.
module.exports = function (client) {
  return function sendMessageSync(form, threadID) {
    return client.sendMessage(form, threadID).catch((e) => ({ error: e.message }));
  };
};
