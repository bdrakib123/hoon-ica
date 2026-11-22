/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const { EP, DOC_ID } = require("../constants");
const { globalAntiSuspension } = require("../utils/antiSuspension");
const { classify } = require("../utils/errors");

const NO_FALLBACK_KINDS = new Set(["rate_limited", "challenge", "blocked", "suspended", "auth"]);

class MessageMethods {
  constructor(http, identity) {
    this.http = http;
    this.identity = identity;
  }

  // Confirmed send path from a live web session: the IGDirectTextSendMutation
  // Relay operation. Falls back to the legacy broadcast endpoint if GraphQL
  // rejects (e.g. doc_id rotated).
  //
  // `replyToItemId` is the target message id (Instagram's "mid.$..." id, exposed
  // as item_id/messageID on every history/inbox item). The web client passes it
  // in `reply_to_message_id` and leaves `replied_to_item_id` /
  // `replied_to_client_context` null — captured live from IGDirectTextSendMutation
  // (doc_id 26911679871773184). Passing it anywhere else sets a pointer without
  // rendering the quote bubble.
  async send(text, threadID, replyToItemId = null) {
    // Instagram rejects an empty text send (IGDirectTextSendMutation with an
    // empty `sensitive_string_value`) with a 302 to the login page. The HTTP
    // layer classifies any 3xx as an auth failure, so emitting one was enough to
    // make the poller declare the session dead. Commands that build a reply from
    // resolvable input (e.g. adduser given an unresolvable username) can end up
    // with an empty string; drop it rather than send it.
    if (text === undefined || text === null || String(text).trim() === "") {
      return { messageID: null, threadID: String(threadID), dropped: "empty" };
    }
    // Pace outbound traffic so a personal account does not look scripted.
    await globalAntiSuspension.waitForTurn(threadID);
    const replyId =
      replyToItemId == null
        ? null
        : typeof replyToItemId === "object"
          ? (replyToItemId.messageID || replyToItemId.id || null)
          : String(replyToItemId);
    try {
      return await this.http.postGraphQL(
        "IGDirectTextSendMutation",
        DOC_ID.TEXT_SEND,
        {
          ig_thread_igid: String(threadID),
          offline_threading_id: this.http.offlineThreadingId(),
          recipient_igids: null,
          replied_to_client_context: null,
          replied_to_item_id: null,
          reply_to_message_id: replyId,
          sampled: null,
          text: { sensitive_string_value: String(text) },
          mentions: [],
          mentioned_user_ids: [],
          commands: null,
          forwarded_from_thread_id: null,
          is_forwarded_from_own_message: null,
          send_attribution: "igd_web_chat_tab:in_thread"
        },
        `https://www.instagram.com/direct/t/${threadID}/`,
        { throwOnError: true }
      );
    } catch (error) {
      globalAntiSuspension.noteSendError(error);
      const kind = error.igKind || classify(error).kind;
      if (NO_FALLBACK_KINDS.has(kind) || globalAntiSuspension.isCoolingDown()) throw error;
      const clientContextId = this.http.uuid();
      const params = {
        action: "send_item",
        thread_ids: JSON.stringify([String(threadID)]),
        client_context: clientContextId,
        offline_threading_id: clientContextId,
        text: String(text)
      };
      if (replyId) params.replied_to_item_id = replyId;
      return this.http.postForm(EP.BROADCAST_TEXT, params);
    }
  }

  async reply(threadID, text, replyToItemId = null) {
    return this.send(text, threadID, replyToItemId);
  }

  async sendLink(threadID, link, text) {
    await globalAntiSuspension.waitForTurn(threadID);
    return this.http.postForm(EP.BROADCAST_LINK, {
      action: "send_item",
      thread_ids: JSON.stringify([String(threadID)]),
      client_context: this.http.uuid(),
      link_text: text || link,
      link_urls: JSON.stringify([link])
    });
  }

  // Unsend (delete for everyone) via the Relay mutation the web DM client uses:
  // `IGDMessageUnsendDialogOffMsysMutation` (doc_id 26948700068153789). The
  // legacy REST delete path (`/direct_v2/threads/<t>/items/<id>/delete/`) is
  // dead on www.instagram.com (the whole /api/v1 namespace 404s) and on
  // i.instagram.com it needs the mobile app identity, so we go straight to
  // GraphQL. Captured live; verified against a real message.
  async unsend(threadID, itemID) {
    try {
      const res = await this.http.postGraphQL(
        "IGDMessageUnsendDialogOffMsysMutation",
        DOC_ID.UNSEND_MESSAGE,
        { message_id: String(itemID), send_data: { thread_id: String(threadID) } },
        `https://www.instagram.com/direct/t/${threadID}/`
      );
      return Boolean(res && res.data && res.data.direct_unsend_message) && !res.errors;
    } catch (_) {
      return false;
    }
  }

  // Instagram lets you edit an outgoing DM within 15 minutes of sending it.
  // Captured live from the web app (IGDirectEditMessageMutation).
  async edit(threadID, itemID, text) {
    this.lastEditError = null;
    try {
      const res = await this.http.postGraphQL(
        "IGDirectEditMessageMutation",
        DOC_ID.EDIT_MESSAGE,
        {
          thread_id: String(threadID),
          target_item_id: null,
          target_message_id: String(itemID),
          body: { sensitive_string_value: String(text) },
          offline_threading_id: this.http.offlineThreadingId()
        },
        `https://www.instagram.com/direct/t/${threadID}/`,
        { throwOnError: true }
      );
      const ok = Boolean(res && res.data) && !res.errors;
      if (!ok) {
        const error = new Error("Instagram edit mutation returned no data");
        error.name = "InstagramEditError";
        error.friendlyName = "IGDirectEditMessageMutation";
        error.response = res;
        throw error;
      }
      return { messageID: String(itemID), edited: true };
    } catch (error) {
      // Keep the actual rejection available to the FCA wrapper/debugger.
      this.lastEditError = error;
      return false;
    }
  }
}

module.exports = MessageMethods;
