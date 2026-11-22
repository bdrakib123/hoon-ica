/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.getThreadList(limit, timestamp, tags, callback) - the DM inbox.
module.exports = function (client) {
  return async function getThreadList(limit = 10, _timestamp, _tags, callback) {
    const cb = typeof callback === "function" ? callback : null;
    try {
      const { threads } = await client.api.getInbox();
      const list = threads.slice(0, limit).map((t) => {
        const latest = t.slide_messages?.edges?.[0]?.node || t.slide_messages?.[0]?.node || t.slide_messages?.[0] || t.items?.[0] || null;
        return {
        threadID: String(t.id || t.thread_id),
        name: t.thread_title || null,
        snippet: latest?.text_body || latest?.text || latest?.content?.xma_text_body || "",
        timestamp: Number(latest?.timestamp_ms ?? latest?.timestamp) || null,
        unreadCount: t.read_state ?? 0,
        // The inbox payload carries `is_group`; fall back to the participant
        // count for a snapshot that omits it. Commands that gate on groups
        // (broadcast to every box, admin tools) read this flag.
        isGroup: typeof t.is_group === "boolean" ? t.is_group : (t.users || []).length > 2
      };
      });
      if (cb) cb(null, list);
      return list;
    } catch (error) {
      if (cb) cb(error, null);
      return [];
    }
  };
};
