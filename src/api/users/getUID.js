/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// Frozen pp.js calls api.getUID(<profile link>) then treats the result as an id.
// Extract a profile path segment, but do not mistake Instagram content routes
// (reels, posts, stories, inbox, etc.) for usernames.
const RESERVED_INSTAGRAM_PATHS = new Set([
  "p", "reel", "reels", "tv", "stories", "explore", "direct",
  "accounts", "about", "developer", "api"
]);

module.exports = function (client) {
  return function getUID(input) {
    const s = String(input || "");
    const m = s.match(/instagram\.com\/([^/?#]+)/i) || s.match(/facebook\.com\/([^/?#]+)/i);
    if (m) {
      let candidate = m[1];
      try { candidate = decodeURIComponent(candidate); } catch (_) {}
      if (!RESERVED_INSTAGRAM_PATHS.has(candidate.toLowerCase())) return candidate;
    }
    return client.userID;
  };
};
