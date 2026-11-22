/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const { DOC_ID } = require("./constants");

// The web DM thread view is served by IGDThreadDetailQuery. Unlike
// PolarisDirectInboxQuery it projects full message content, reply linkage
// (replied_to_message_id / replied_to_message) and media attachments.
async function fetchThreadDetail(http, threadID, limit = 20, afterCursor = null) {
  const res = await http.postGraphQL(
    "IGDThreadDetailQuery",
    DOC_ID.THREAD_DETAIL,
    {
      min_uq_seq_id: afterCursor || null,
      thread_fbid: String(threadID),
      __relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider: false,
      __relay_internal__pv__IGDInitialMessagePageCountrelayprovider: limit
    },
    `https://www.instagram.com/direct/t/${threadID}/`
  );
  return res?.data?.get_slide_thread_nullable?.as_ig_direct_thread || null;
}

// Builds an fbid -> instagram-id lookup from a thread-detail payload, including
// the viewer so the bot's own messages map too.
function threadFbidMap(thread) {
  const map = {};
  for (const u of thread?.users || []) {
    if (u.interop_messaging_user_fbid) {
      map[String(u.interop_messaging_user_fbid)] = String(u.id || u.pk);
    }
  }
  const viewerFbid = thread?.viewer?.interop_messaging_user_fbid;
  if (viewerFbid) map[String(viewerFbid)] = String(thread.viewer_id);
  return map;
}

module.exports = { fetchThreadDetail, threadFbidMap };