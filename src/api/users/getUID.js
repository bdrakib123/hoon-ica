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
    const raw = String(input || "").trim();
    if (!raw) return client.userID;
    let url;
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch (_) {
      return client.userID;
    }
    const host = url.hostname.toLowerCase();
    const isInstagram = host === "instagram.com" || host.endsWith(".instagram.com");
    const isFacebook = host === "facebook.com" || host.endsWith(".facebook.com");
    if (!isInstagram && !isFacebook) return client.userID;
    let candidate = url.pathname.split("/").filter(Boolean)[0] || "";
    try { candidate = decodeURIComponent(candidate); } catch (_) {}
    if (isInstagram && RESERVED_INSTAGRAM_PATHS.has(candidate.toLowerCase())) return client.userID;
    return candidate || client.userID;
  };
};
