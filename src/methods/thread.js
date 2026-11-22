/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const { DOC_ID, EP } = require("../constants");
const { textOf, attachmentsFromContent, normalizeRepliedMessage } = require("../messageContent");
const { fetchThreadDetail, threadFbidMap } = require("../threadDetail");

class ThreadMethods {
  constructor(http) {
    this.http = http;
  }

  // Legacy REST first (fast when it works), then the GraphQL thread-detail
  // query. /direct_v2/threads/<id>/ returns 404 on modern web sessions.
  async getInfo(threadID) {
    try {
      const res = await this.http.get(EP.THREAD_INFO(threadID));
      if (res?.thread) return res.thread;
    } catch (_) {}
    return this.fetchDetail(threadID);
  }

  // Raw IGDThreadDetailQuery payload. Returns null when Instagram answers with
  // a GraphQL error object (some malformed ids), not an HTTP error.
  async fetchDetail(threadID, limit = 20, afterCursor = null) {
    return fetchThreadDetail(this.http, threadID, limit, afterCursor);
  }

  // Fetch an older page from Instagram's Relay message-list connection.
  // The cursor is opaque and comes from slide_messages.page_info.end_cursor;
  // it is not a timestamp or uq_seq_id.
  async fetchOlderMessages(threadFBID, cursor, limit = 20) {
    const res = await this.http.postGraphQL(
      "IGDMessageListOffMsysQuery",
      DOC_ID.MESSAGE_LIST,
      {
        after: cursor,
        before: null,
        first: limit,
        last: null,
        id: String(threadFBID),
        newer_than_message_id: null,
        older_than_message_id: null,
        "__relay_internal__pv__IGDInitialMessagePageCountrelayprovider": limit
      },
      "https://www.instagram.com/direct/inbox/"
    );
    return res?.data?.fetch__SlideThread?.as_ig_direct_thread?.slide_messages || {};
  }

  _mapHistoryEdges(edges, fbidToIgid) {
    return (Array.isArray(edges) ? edges : [])
      .map((edge) => edge?.node || edge)
      .filter((node) =>
        node && typeof node === "object" &&
        [node.id, node.item_id, node.message_id].some((value) => value != null && String(value).trim() !== "")
      )
      .map((n) => {
      const messageID = String([n.id, n.item_id, n.message_id].find(
        (value) => value != null && String(value).trim() !== ""
      ));
      const senderFbid = n.sender_fbid != null ? String(n.sender_fbid) : null;
      return {
        messageID,
        item_id: messageID,
        senderID: senderFbid && fbidToIgid[senderFbid] ? fbidToIgid[senderFbid] : senderFbid,
        user_id: senderFbid,
        sender_fbid: senderFbid,
        senderName: n.sender?.name || null,
        body: textOf(n),
        text: textOf(n),
        itemType: String(n.content_type || "").toLowerCase(),
        content_type: n.content_type,
        attachments: attachmentsFromContent(n.content),
        repliedToItemId: n.replied_to_message_id || null,
        repliedToMessage: normalizeRepliedMessage(n.replied_to_message, fbidToIgid),
        clientContext: n.client_context || null,
        offlineThreadingId: n.offline_threading_id != null ? String(n.offline_threading_id) : null,
        timestamp: Number(n.timestamp_ms) || null
      };
    });
  }

  // fca-shaped message history. FCA's third argument is a millisecond
  // timestamp boundary: return messages strictly older than that message.
  // Relay pagination itself is cursor-based, so walk page_info.end_cursor
  // until enough older messages have been collected.
  async getHistory(threadID, limit = 20, beforeTimestamp = null) {
    const thread = await this.fetchDetail(threadID, limit);
    if (!thread) return [];

    const fbidToIgid = threadFbidMap(thread);
    const firstConnection = thread.slide_messages || {};
    let boundary = null;
    if (beforeTimestamp != null && beforeTimestamp !== "") {
      boundary = Number(beforeTimestamp);
      if (!Number.isFinite(boundary) || boundary <= 0) boundary = null;
      // FCA callers normally pass milliseconds; accept Unix seconds as well.
      else if (boundary < 1e12) boundary *= 1000;
    }

    const wanted = Math.max(1, Number(limit) || 20);
    const threadFBID = thread.thread_fbid || thread.id || String(threadID);
    const results = [];
    const seenIDs = new Set();
    const seenCursors = new Set();
    let connection = firstConnection;

    // Always follow Relay pages until the requested amount is collected (or
    // the server says there are no more). Some web responses cap the first
    // thread-detail page below the requested count, even when first is larger.
    while (true) {
      const page = this._mapHistoryEdges(connection.edges, fbidToIgid);
      for (const item of page) {
        if (seenIDs.has(String(item.messageID))) continue;
        seenIDs.add(String(item.messageID));
        if (boundary == null || (item.timestamp != null && item.timestamp < boundary)) {
          results.push(item);
          if (results.length >= wanted) return results.slice(0, wanted);
        }
      }

      const pageInfo = connection.page_info || {};
      const cursor = pageInfo.end_cursor;
      if (!pageInfo.has_next_page || !cursor || seenCursors.has(cursor)) break;
      seenCursors.add(cursor);
      try {
        connection = await this.fetchOlderMessages(threadFBID, cursor, wanted - results.length);
      } catch (_) {
        break;
      }
      if (!connection || !Array.isArray(connection.edges) || connection.edges.length === 0) break;
    }

    return results;
  }

  async markSeen(threadID, itemID) {
    return this.http.postForm(EP.THREAD_SEEN(threadID), { item_id: itemID });
  }

  async mute(threadID) {
    return this.http.postForm(EP.THREAD_MUTE(threadID), {});
  }

  async unmute(threadID) {
    return this.http.postForm(EP.THREAD_UNMUTE(threadID), {});
  }

  async hide(threadID) {
    return this.http.postForm(EP.THREAD_HIDE(threadID), {});
  }

  // Adds participants to a group DM. Instagram expects a JSON-encoded
  // `user_ids` array plus the client's `_uuid` (confirmed against instagrapi's
  // direct_thread_add_users, which the web/app endpoints share).
  async addUsers(threadID, userIds) {
    const ids = (Array.isArray(userIds) ? userIds : [userIds]).map(String);
    return this.http.postForm(EP.THREAD_ADD_USER(threadID), {
      _uuid: this.http.uuid(),
      user_ids: JSON.stringify(ids)
    });
  }

  async removeUser(threadID, userID) {
    return this.http.postForm(EP.THREAD_REMOVE_USER(threadID), {
      _uuid: this.http.uuid(),
      user_id: String(userID)
    });
  }
}

module.exports = ThreadMethods;
