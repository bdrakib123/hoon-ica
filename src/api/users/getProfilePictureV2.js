/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.getProfilePictureV2(idOrUsername, [options], callback)
//   -> { id, userID, username, url, hd, thumb, sizes: { <px>: url } }
//
// Returns the user's profile picture at every size a caller may want, resolved
// from whichever source answers (inbox-learned record, web_profile_info or the
// account's own page). Instagram's CDN resizes a picture from its URL, so the
// size variants are derived without extra requests.
//
// options: { size }   -> `url` is returned at that square size (default 320).
//          { sizes: [n, ...] } -> a map of square sizes under `sizes`.
module.exports = function (client) {
  return async function getProfilePictureV2(idOrUsername, options, callback) {
    if (typeof options === "function") { callback = options; options = {}; }
    options = options || {};
    const cb = typeof callback === "function" ? callback : null;
    const key = String(idOrUsername == null ? "" : idOrUsername).replace(/^@/, "");
    try {
      const profile = await client.getProfile(key).catch(() => null);
      if (!profile || (!profile.profilePicUrl && !profile.profilePicUrlHd)) {
        const empty = { id: profile?.id || null, userID: profile?.id || null, username: profile?.username || null, url: null, hd: null, thumb: null, sizes: {} };
        if (cb) cb(null, empty);
        return empty;
      }
      const { profilePictureAtSize } = require("../../profileParse");
      const hd = profile.profilePicUrlHd || profile.profilePicUrl;
      const base = profile.profilePicUrl || hd;
      const size = Number(options.size) || 320;
      const wanted = Array.isArray(options.sizes) && options.sizes.length ? options.sizes : [150, 320, 640, 1080];
      const sizes = {};
      for (const px of wanted) sizes[String(px)] = profilePictureAtSize(hd, px);
      const out = {
        id: profile.id,
        userID: profile.id,
        username: profile.username,
        url: profilePictureAtSize(base, size),
        hd,
        thumb: profilePictureAtSize(base, 150),
        sizes
      };
      if (cb) cb(null, out);
      return out;
    } catch (error) {
      if (cb) cb(error, null);
      return null;
    }
  };
};
