/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// Frozen pp.js calls api.getUID(<profile link>) then treats the result as an id.
// Extract the trailing username/id from the URL, else fall back to the current
// user.
module.exports = function (client) {
  return function getUID(input) {
    const s = String(input || "");
    const m = s.match(/instagram\.com\/([^/?#]+)/i) || s.match(/facebook\.com\/([^/?#]+)/i);
    if (m) return m[1];
    return client.userID;
  };
};
