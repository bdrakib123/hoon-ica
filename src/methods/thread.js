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

  // fca-shaped message history: each item carries a stable id, the sender's
  // Instagram user id, the text body, a timestamp and any media attachment.
  // IG's inbound reply linkage (replied_to_message) is preserved so the bot's
  // event normalizer can resolve reply targets without a second round-trip.
  async getHistory(threadID, limit = 20, afterCursor = null) {
    const thread = await this.fetchDetail(threadID, limit, afterCursor);
    if (!thread) return [];
    const edges = thread.slide_messages?.edges || [];
    const fbidToIgid = threadFbidMap(thread);

    return edges.map((e) => {
      const n = e.node || e;
      const senderFbid = n.sender_fbid != null ? String(n.sender_fbid) : null;
      return {
        messageID: n.id,
        item_id: n.id,
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
