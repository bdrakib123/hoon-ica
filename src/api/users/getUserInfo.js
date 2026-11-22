/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.getUserInfo(id | id[], callback) -> { <id>: { name, firstName, username,
// profileUrl, thumbSrc, gender } }.
const { setBounded } = require("../../utils/boundedMap");

module.exports = function (client) {
  return async function getUserInfo(ids, callback) {
    const cb = typeof callback === "function" ? callback : null;
    const list = Array.isArray(ids) ? ids : [ids];
    try {
      const out = {};
      for (const id of list) {
        const key = String(id);
        // A handle learned from the inbox/thread views answers without a
        // rate-limited lookup (usernameinfo / user info both 429 on web).
        const known = client.getUserByUsername ? client.getUserByUsername(key) : null;
        const u = known || await client.api.getUserInfo(key).catch(() => null);
        const cachedPic = client._picCache.get(key) ||
          client._picCache.get(client._picCache.get(`name:${key}`)) || null;
        const cachedName = client._picCache.get(`name:${key}`) || null;
        const fullName = u?.full_name || u?.username || cachedName || String(id);
        out[key] = {
          name: fullName,
          firstName: fullName.trim().split(/\s+/)[0] || "",
          username: u?.username || cachedName || null,
          profileUrl: u?.profile_pic_url || cachedPic || null,
          thumbSrc: u?.profile_pic_url || cachedPic || null,
          gender: u?.gender ?? null
        };
        if (u?.profile_pic_url) setBounded(client._picCache, key, u.profile_pic_url, 5000);
        if (u?.username) setBounded(client._picCache, `name:${key}`, u.username, 5000);
      }
      if (cb) cb(null, out);
      return out;
    } catch (error) {
      if (cb) cb(error, null);
      return {};
    }
  };
};
