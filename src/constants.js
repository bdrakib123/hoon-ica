/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const BASE = "https://www.instagram.com/api/v1";
const WEB = "https://www.instagram.com";

// Reverse-engineered from a live www.instagram.com session (Burp capture).
// The web DM client no longer uses the /api/v1/direct_v2/broadcast/* endpoints;
// it uploads media to /ajax/mercury/upload.php and then commits the send with a
// Relay GraphQL mutation. doc_id values are stable per friendly-name and were
// taken verbatim from the capture.
const GRAPHQL = `${WEB}/api/graphql`;
const UPLOAD = `${WEB}/ajax/mercury/upload.php`;

const DOC_ID = {
  TEXT_SEND: "26911679871773184",
  MEDIA_SEND: "25766288509716264",
  EDIT_MESSAGE: "32480262318254796",
  REACTION_SEND: "24374451552236906",
  ANIMATED_MEDIA_SEND: "32089613413987432",
  CUTOUT_STICKER_SEND: "26601474479505807",
  MARK_THREAD_READ: "27399783383056109",
  THREAD_DETAIL: "29619996517588618",
  MESSAGE_LIST: "29380270148264352",
  INBOX: "27909866362025854",
  INBOX_PAGINATION: "28774058922187457",
  UNSEND_MESSAGE: "26948700068153789",
  // Profile Relay operations. PolarisProfilePageContentQuery is the one the
  // profile page itself issues; PolarisUserRootQuery is its fallback. Both take
  // a `username` variable and return the full `data.user` profile.
  PROFILE_PAGE_CONTENT: "7898261790222653",
  PROFILE_USER_ROOT: "25317500992033585"
};

const EP = {
  CURRENT_USER: `${BASE}/accounts/current_user/?edit=true`,
  INBOX: `${BASE}/direct_v2/inbox/`,
  BROADCAST_TEXT: `${BASE}/direct_v2/threads/broadcast/text/`,
  BROADCAST_LINK: `${BASE}/direct_v2/threads/broadcast/link/`,
  BROADCAST_REACTION: (threadID, itemID) =>
    `${BASE}/direct_v2/threads/${threadID}/items/${itemID}/reaction/`,
  THREAD_INFO: (threadID) => `${BASE}/direct_v2/threads/${threadID}/?visual_message_return_type=unseen&limit=20`,
  THREAD_ITEMS: (threadID) => `${BASE}/direct_v2/threads/${threadID}/items/`,
  THREAD_SEEN: (threadID) => `${BASE}/direct_v2/threads/${threadID}/items/seen/`,
  THREAD_MUTE: (threadID) => `${BASE}/direct_v2/threads/${threadID}/mute/`,
  THREAD_UNMUTE: (threadID) => `${BASE}/direct_v2/threads/${threadID}/unmute/`,
  THREAD_HIDE: (threadID) => `${BASE}/direct_v2/threads/${threadID}/hide/`,
  THREAD_ADD_USER: (threadID) => `${BASE}/direct_v2/threads/${threadID}/add_user/`,
  THREAD_REMOVE_USER: (threadID) => `${BASE}/direct_v2/threads/${threadID}/remove_user/`,
  ITEM_DELETE: (threadID, itemID) => `${BASE}/direct_v2/threads/${threadID}/items/${itemID}/delete/`,
  TYPING: (threadID) => `${BASE}/direct_v2/threads/${threadID}/indicate_activity/`,
  USER_INFO: (userID) => `${BASE}/users/${userID}/info/`,
  USER_BY_USERNAME: (username) => `${BASE}/users/${username}/usernameinfo/`,
  USER_SEARCH: (query, count) => `${BASE}/users/search/?q=${encodeURIComponent(query)}&count=${count}`,
  // The canonical profile JSON a logged-in web session reads. Unlike the
  // /users/<id>/info/ and usernameinfo REST paths, it is not 302'd to the login
  // page, and it carries follower/media counts, biography and the account flags.
  WEB_PROFILE_INFO: (username) => `${BASE}/users/web_profile_info/?username=${encodeURIComponent(username)}`,
  TOPSEARCH: (query) => `${WEB}/web/search/topsearch/?query=${encodeURIComponent(query)}&context=blended`,
  RUPLOAD_PHOTO: (uploadName) => `https://i.instagram.com/rupload_igphoto/${uploadName}`,
  RUPLOAD_VIDEO: (uploadName) => `https://i.instagram.com/rupload_igvideo/${uploadName}`,
  RUPLOAD_AUDIO: (uploadName) => `https://i.instagram.com/rupload_igdirect/${uploadName}`,
  CONFIGURE_PHOTO: `${BASE}/direct_v2/threads/broadcast/configure_photo/`,
  CONFIGURE_VIDEO: `${BASE}/direct_v2/threads/broadcast/configure_video/`,
  CONFIGURE_VOICE: `${BASE}/direct_v2/threads/broadcast/configure_voice/`
};

module.exports = { EP, DOC_ID, GRAPHQL, UPLOAD, WEB };
