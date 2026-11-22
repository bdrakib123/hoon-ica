/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.getThreadList(limit, timestamp, tags, callback) - the DM inbox.
// Instagram's current web Relay pagination exposes the INBOX folder only.
// Do not silently return INBOX data for ARCHIVED/PENDING/OTHER requests.
function firstUsableId(...values) {
  const value = values.find((entry) => entry != null && String(entry).trim() !== "");
  return value == null ? null : String(value);
}

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
    let list = [];

    try {
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new TypeError("getThreadList: limit must be a positive integer");
      }
      if (timestamp != null && (!Number.isFinite(Number(timestamp)) || !Number.isInteger(Number(timestamp)))) {
        throw new TypeError("getThreadList: timestamp must be an integer or null");
      }

      const requestedTags = tags == null ? [] : typeof tags === "string" ? [tags] : tags;
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
        if (!thread || typeof thread !== "object") return null;
        const rawThreadID = [thread.id, thread.thread_id].find(
          (value) => value != null && String(value).trim() !== ""
        );
        if (rawThreadID == null) return null;

        const latest =
          thread.slide_messages?.edges?.[0]?.node ||
          thread.slide_messages?.[0]?.node ||
          thread.slide_messages?.[0] ||
          thread.items?.[0] ||
          null;
        const users = (Array.isArray(thread.users) ? thread.users : [])
          .filter((user) => user && typeof user === "object");
        const participantIDs = new Set(users.map((user) => firstUsableId(user.id, user.pk)).filter(Boolean));
        const viewer = thread.viewer && typeof thread.viewer === "object" ? thread.viewer : null;
        const viewerID = viewer && firstUsableId(viewer.id, viewer.pk);
        if (viewerID) participantIDs.add(viewerID);
        const participantCount = participantIDs.size;
        return {
          threadID: String(rawThreadID),
          name: thread.thread_title || null,
          snippet: latest?.text_body || latest?.text || latest?.content?.xma_text_body || "",
          timestamp: Number(latest?.timestamp_ms ?? latest?.timestamp) || null,
          unreadCount: Number(thread.read_state) || 0,
          // The inbox payload carries is_group; fall back to participant count
          // when a snapshot omits it.
          isGroup: typeof thread.is_group === "boolean"
            ? thread.is_group
            : participantCount > 2
        };
      };

      list = [];
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
          // Ignore malformed Relay edges instead of collapsing them into the
          // literal "undefined" thread id and suppressing valid later entries.
          if (!item || seenThreads.has(item.threadID)) continue;
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

    } catch (error) {
      if (cb) {
        await cb(error, null);
        return [];
      }
      throw error;
    }

    // Keep user callback exceptions outside the request/validation catch so
    // they cannot be mistaken for API failures or trigger a second callback.
    if (cb) await cb(null, list);
    return list;
  };
};
