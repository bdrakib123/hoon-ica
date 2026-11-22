/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// Parsers for the two profile sources this package can read with a web session:
//
//  1. /api/v1/users/web_profile_info/ - the canonical profile JSON
//     (`data.user` with edge_followed_by.count, biography, is_verified, ...).
//  2. the profile page HTML - www.instagram.com/<username>/ embeds a
//     `["PolarisViewer",[],{"data":{...}}]` blob with biography, full_name,
//     profile_pic_url_hd and the account flags, but no follower counts.
//
// Both are normalized to one rich object so callers never branch on the source.
// The /api/v1/users/<id>/info/ REST path is deliberately not used: for a web
// session Instagram 302s it to the login page (which the HTTP layer reads as an
// expired session) or 429s it.

function firstUsableId(...values) {
  const value = values.find((entry) => entry != null && String(entry).trim() !== "");
  return value == null ? null : String(value);
}

// Walks a JSON object literal starting at the first `{` at/after `from`,
// honouring strings and escapes, and returns the parsed value (or null).
function parseJsonAt(text, from) {
  let i = text.indexOf("{", from);
  if (i < 0) return null;
  const start = i;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch (_) {
          return null;
        }
      }
    }
  }
  return null;
}

function countOf(edge) {
  if (edge == null) return null;
  const n = typeof edge === "object" ? edge.count : edge;
  return n != null && Number.isFinite(Number(n)) ? Number(n) : null;
}

// Accepts either a Relay field-count edge (`{ count: n }`) or a plain number.
function countOrEdge(v) {
  if (v == null) return null;
  if (typeof v === "object") return countOf(v);
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

// Maps a web_profile_info `data.user` (REST) to the normalized shape.
function normalizeWebProfileInfo(user) {
  if (!user || typeof user !== "object") return null;
  return normalize({
    id: firstUsableId(user.id, user.pk),
    username: user.username,
    fullName: user.full_name,
    biography: user.biography,
    externalUrl: user.external_url,
    category: user.category_name || user.category,
    isVerified: user.is_verified,
    isPrivate: user.is_private,
    isBusinessAccount: user.is_business_account,
    isProfessionalAccount: user.is_professional_account,
    profilePicUrl: user.profile_pic_url,
    profilePicUrlHd: user.profile_pic_url_hd || user.profile_pic_url,
    fbid: user.fbid,
    followerCount: countOf(user.edge_followed_by),
    followingCount: countOf(user.edge_follow),
    mediaCount: countOf(user.edge_owner_to_timeline_media),
    highlightReelCount: user.highlight_reel_count,
    businessEmail: user.business_email,
    businessPhone: user.business_phone_number,
    publicEmail: user.public_email,
    publicPhone: user.public_phone_number,
    hasProfilePic: user.has_profile_pic,
    raw: user
  });
}

// Maps the GraphQL profile response (`data.user` from PolarisProfilePageContent-
// Query / PolarisUserRootQuery) to the normalized shape. The field names are the
// Relay ones, and the counts come back either as an edge or as a plain number,
// so both are accepted.
function normalizeGraphqlUser(user) {
  if (!user || typeof user !== "object") return null;
  const follower = user.follower_count ?? user.edge_followed_by;
  const following = user.following_count ?? user.edge_follow;
  const media = user.media_count ?? user.edge_owner_to_timeline_media;
  return normalize({
    id: firstUsableId(user.id, user.pk, user.strong_id__),
    username: user.username,
    fullName: user.full_name,
    biography: user.biography,
    externalUrl: user.external_url || user.bio_links?.[0]?.url,
    category: user.category_name || user.category,
    isVerified: user.is_verified,
    isPrivate: user.is_private,
    isBusinessAccount: user.is_business_account,
    isProfessionalAccount: user.is_professional_account,
    profilePicUrl: user.profile_pic_url,
    profilePicUrlHd: user.hd_profile_pic_url_info?.url || user.profile_pic_url_hd || user.profile_pic_url,
    fbid: user.fbid,
    followerCount: countOrEdge(follower),
    followingCount: countOrEdge(following),
    mediaCount: countOrEdge(media),
    businessEmail: user.business_email,
    businessPhone: user.business_phone_number,
    publicEmail: user.public_email,
    publicPhone: user.public_phone_number,
    hasProfilePic: user.has_profile_pic ?? (!!user.profile_pic_url),
    raw: user
  });
}

// Maps the HTML-embedded PolarisViewer `data` to the normalized shape.
function normalizePolarisViewer(data) {
  if (!data || typeof data !== "object" || !data.username) return null;
  return normalize({
    id: data.id,
    username: data.username,
    fullName: data.full_name,
    biography: data.biography,
    externalUrl: data.external_url,
    category: data.category_name,
    isVerified: data.is_verified,
    isPrivate: data.is_private,
    isBusinessAccount: data.is_business_account,
    isProfessionalAccount: data.is_professional_account,
    profilePicUrl: data.profile_pic_url,
    profilePicUrlHd: data.profile_pic_url_hd || data.profile_pic_url,
    fbid: data.fbid,
    hasProfilePic: data.has_profile_pic,
    raw: data
  });
}

// Maps an inbox/thread introspection user record (id, username, full_name,
// profile_pic_url, is_verified, interop_messaging_user_fbid) to the normalized
// shape. This is the data the DM GraphQL surface reliably returns for the
// people a bot actually talks to, when the profile REST paths rate-limit.
function normalizeInboxUser(u) {
  if (!u || typeof u !== "object") return null;
  const username = u.username || null;
  const id = firstUsableId(u.id, u.pk, u.interop_messaging_user_fbid);
  if (!username && !id) return null;
  return normalize({
    id,
    username,
    fullName: u.full_name,
    profilePicUrl: u.profile_pic_url,
    profilePicUrlHd: u.profile_pic_url_hd || u.profile_pic_url,
    isVerified: u.is_verified,
    isPrivate: u.is_private,
    fbid: u.interop_messaging_user_fbid,
    raw: u
  });
}

// Pulls the profile out of a profile page's HTML. Returns null when the page is
// a login wall or carries no profile blob. `expectUsername`, when given, guards
// against the SPA shell embedding the *viewer's* profile for a page Instagram
// did not server-render: the blob is only trusted when it is the requested user.
function parseProfilePage(html, expectUsername) {
  const text = typeof html === "string" ? html : "";
  if (!text || /accounts\/login/i.test(text.slice(0, 2000))) return null;
  for (const marker of ['"PolarisViewer",[],', '"PolarisProfilePageContentQuery"']) {
    const at = text.indexOf(marker);
    if (at < 0) continue;
    const obj = parseJsonAt(text, at + marker.length);
    const data = obj && (obj.data || obj);
    const profile = normalizePolarisViewer(data);
    if (!profile) continue;
    if (expectUsername && String(profile.username).toLowerCase() !== String(expectUsername).toLowerCase()) {
      continue;
    }
    return profile;
  }
  return null;
}

// The single normalized profile shape every source maps to. Fields a source
// cannot supply stay null, so a caller can tell "unknown" from "false".
function normalize(p) {
  if (!p) return null;
  const id = p.id != null && String(p.id).trim() !== "" ? String(p.id) : null;
  return {
    id,
    pk: id,
    username: p.username || null,
    fullName: p.fullName || null,
    biography: p.biography || "",
    externalUrl: p.externalUrl || null,
    category: p.category || null,
    isVerified: typeof p.isVerified === "boolean" ? p.isVerified : null,
    isPrivate: typeof p.isPrivate === "boolean" ? p.isPrivate : null,
    isBusinessAccount: typeof p.isBusinessAccount === "boolean" ? p.isBusinessAccount : null,
    isProfessionalAccount: typeof p.isProfessionalAccount === "boolean" ? p.isProfessionalAccount : null,
    hasProfilePic: typeof p.hasProfilePic === "boolean" ? p.hasProfilePic : null,
    profilePicUrl: p.profilePicUrl || null,
    profilePicUrlHd: p.profilePicUrlHd || p.profilePicUrl || null,
    fbid: p.fbid != null ? String(p.fbid) : null,
    followerCount: p.followerCount != null ? p.followerCount : null,
    followingCount: p.followingCount != null ? p.followingCount : null,
    mediaCount: p.mediaCount != null ? p.mediaCount : null,
    highlightReelCount: p.highlightReelCount != null ? p.highlightReelCount : null,
    businessEmail: p.businessEmail || null,
    businessPhone: p.businessPhone || null,
    publicEmail: p.publicEmail || null,
    publicPhone: p.publicPhone || null,
    raw: p.raw || null
  };
}

// Instagram's CDN resizes a profile picture from the URL's stp= parameter. This
// returns the same picture at a requested square size, so callers get a crisp
// avatar without a second API call.
function profilePictureAtSize(url, size) {
  if (!url || !size) return url;
  const px = Math.max(1, Math.round(Number(size) || 0));
  if (!px) return url;
  const stp = `dst-jpg_s${px}x${px}_tt6`;
  if (/[?&]stp=[^&]+/.test(url)) return url.replace(/([?&])stp=[^&]+/, `$1stp=${stp}`);
  return `${url}${url.includes("?") ? "&" : "?"}stp=${stp}`;
}

module.exports = {
  parseProfilePage,
  normalizeWebProfileInfo,
  normalizeGraphqlUser,
  normalizePolarisViewer,
  normalizeInboxUser,
  normalize,
  profilePictureAtSize
};
