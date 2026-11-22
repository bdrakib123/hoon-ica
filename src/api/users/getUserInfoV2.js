/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const createCallback = require("../../utils/createCallback");

// fca.getUserInfoV2(id | id[], callback) -> { <id>: <full profile> }.
//
// V1 getUserInfo returns the fca-shaped subset (name/firstName/username/
// profileUrl/thumbSrc/gender). V2 returns the *complete* profile Instagram
// exposes: id, username, full name, biography, follower/following/media counts,
// verified/private/business flags, the profile picture (square + HD), external
// url, category and business contact details.
//
// It is logout-safe: every source it reads (the users already learned from the
// inbox/thread views, web_profile_info, the account's own page) is failure
// tolerant, so a rate-limited (429) or login-redirected (302) profile endpoint
// can never be mistaken for an expired session.
module.exports = function (client) {
  return async function getUserInfoV2(ids, callback) {
    const cb = createCallback(callback);
    const list = Array.isArray(ids) ? ids : [ids];
    try {
      const out = {};
      for (const id of list) {
        const key = String(id);
        const profile = await client.getProfile(key.replace(/^@/, "")).catch(() => null);
        out[key] = profile
          ? {
              id: profile.id,
              userID: profile.id,
              username: profile.username,
              name: profile.fullName,
              firstName: (profile.fullName || profile.username || "").split(" ")[0] || null,
              biography: profile.biography,
              profileUrl: profile.profilePicUrl,
              thumbSrc: profile.profilePicUrl,
              profilePicUrl: profile.profilePicUrl,
              profilePicUrlHd: profile.profilePicUrlHd,
              followerCount: profile.followerCount,
              followingCount: profile.followingCount,
              mediaCount: profile.mediaCount,
              isVerified: profile.isVerified,
              isPrivate: profile.isPrivate,
              isBusinessAccount: profile.isBusinessAccount,
              isProfessionalAccount: profile.isProfessionalAccount,
              externalUrl: profile.externalUrl,
              category: profile.category,
              fbid: profile.fbid,
              gender: null
            }
          : null;
      }
      if (cb) cb(null, out);
      return out;
    } catch (error) {
      if (cb?.called) throw error;
      if (cb) cb(error, null);
      return {};
    }
  };
};
