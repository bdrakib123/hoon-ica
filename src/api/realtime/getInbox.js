/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// Instagram-specific: read the DM inbox directly.
module.exports = function (client) {
  return function getInbox(cursor) {
    return client.api.getInbox(cursor);
  };
};
