/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.getThreadList(limit, timestamp, tags, callback) - the DM inbox.
// Instagram's current web Relay pagination exposes the INBOX folder only.
// Do not silently return INBOX data for ARCHIVED/PENDING/OTHER requests.
module.exports = function (client) {
  return async function getThreadList(limit = 10, timestamp = null, tags = [], callback) {
    // FCA callers commonly omit optional timestamp/tags arguments.
    if (typeof timestamp === "function") {
      callback = timestamp;
      timestamp = null;
      tags = [];
    } else if (typeof tags === "function") {
      callback = tags;
      tags = [];
    }
    const cb = typeof callback === "function" ? callback : null;

    try {
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new TypeError("getThreadList: limit must be a positive integer");
      }
      if (timestamp != null && (!Number.isFinite(Number(timestamp)) || !Number.isInteger(Number(timestamp)))) {
        throw new TypeError("getThreadList: timestamp must be an integer or null");
      }

      const requestedTags = typeof tags === "string" ? [tags] : tags;
      if (!Array.isArray(requestedTags)) {
        throw new TypeError("getThreadList: tags must be an array or string");
      }
      const normalizedTags = requestedTags.map((tag) => String(tag).trim().toUpperCase()).filter(Boolean);
      const allowedTags = new Set(["INBOX", "UNREAD"]);
      const unsupported = normalizedTags.filter((tag) => !allowedTags.has(tag));
      if (unsupported.length) {
        throw new Error(
          "getThreadList: current Instagram web API supports INBOX pagination only; unsupported tag(s): " +
          unsupported.join(", ")
        );
      }
      const unreadOnly = normalizedTags.includes("UNREAD");

      const toItem = (thread) => {
        const latest =
          thread.slide_messages?.edges?.[0]?.node ||
          thread.slide_messages?.[0]?.node ||
          thread.slide_messages?.[0] ||
          thread.items?.[0] ||
          null;
        return {
          threadID: String(thread.id || thread.thread_id),
          name: thread.thread_title || null,
          snippet: latest?.text_body || latest?.text || latest?.content?.xma_text_body || "",
          timestamp: Number(latest?.timestamp_ms ?? latest?.timestamp) || null,
          unreadCount: thread.read_state ?? 0,
          // The inbox payload carries is_group; fall back to participant count
          // when a snapshot omits it.
          isGroup: typeof thread.is_group === "boolean"
            ? thread.is_group
            : (thread.users || []).length > 2
        };
      };

      const list = [];
      const seenThreads = new Set();
      const seenCursors = new Set();
      const before = timestamp == null ? null : Number(timestamp);
      let cursor = null;

      // Each Instagram inbox page contains at most 15 threads. Continue through
      // Relay cursors so FCA's requested limit is not silently capped at 15.
      while (list.length < limit) {
        const page = await client.api.getInbox(cursor);
        const threads = Array.isArray(page?.threads) ? page.threads : [];
        for (const thread of threads) {
          const item = toItem(thread);
          if (!item.threadID || seenThreads.has(item.threadID)) continue;
          seenThreads.add(item.threadID);
          if (before != null && (item.timestamp == null || item.timestamp >= before)) continue;
          if (unreadOnly && !(Number(item.unreadCount) > 0)) continue;
          list.push(item);
          if (list.length >= limit) break;
        }

        const nextCursor = page?.nextCursor || null;
        if (list.length >= limit || !nextCursor || seenCursors.has(nextCursor)) break;
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }

      if (cb) cb(null, list);
      return list;
    } catch (error) {
      if (cb) {
        cb(error, null);
        return [];
      }
      throw error;
    }
  };
};
