/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// Turns a realtime MQTT message-sync patch into the same raw inbox event the
// poller produces, so listen() can hand either source to the same callback and
// the EventNormalizer never needs to know which one delivered it.
//
// The broker pushes a patch per Direct change:
//   { op: "add", path: "/direct_v2/threads/<tid>/items/<iid>",
//     value: "<json item>" }
// Only a new item under /items/ is an inbound message; activity indicators,
// seen state and reactions share the /direct_v2/threads/ prefix and are ignored.

"use strict";

const { attachmentsFromContent } = require("../messageContent");

const ITEM_PATH_RE = /^\/direct_v2\/threads\/([^/]+)\/items\/([^/]+)$/;

function isMessagePatch(path, op) {
  if (!ITEM_PATH_RE.test(String(path || ""))) return false;
  // op is "add" for a new item; older captures omit it, so an absent op is fine.
  return !op || String(op).toLowerCase() === "add";
}

// The push carries a reply's target as a full `replied_to_message` object
// (item_id + message_id + text), not as the flat `replied_to_item_id` the inbox
// poller uses. Reading only the flat field left every swipe-reply on the push
// path typed as a plain "message", so the handler's onReply never fired and the
// reply waited a whole poll cycle. Normalise the object to the same
// { repliedToItemId, repliedToMessage } pair the poller produces.
function normalizeReplyFromPush(replied) {
  if (!replied || typeof replied !== "object") return null;
  const itemId = replied.item_id != null ? String(replied.item_id) : null;
  const mid = replied.message_id != null ? String(replied.message_id) : null;
  const senderId = replied.user_id != null ? String(replied.user_id) : null;
  return {
    repliedToItemId: itemId || mid,
    repliedToMessage: {
      messageID: mid || itemId || "",
      itemID: itemId,
      senderID: senderId,
      senderName: null,
      body: replied.text || replied.text_body || "",
      attachments: attachmentsFromContent(replied.media || replied.content || {}),
      timestamp: Number(replied.timestamp || replied.timestamp_ms) || null
    }
  };
}

// Builds a raw event from a message-sync patch, or null when the patch is not an
// actionable inbound message (our own send, a reaction, a non-item change).
function rawEventFromMessageSync(event, selfId, opts) {
  const message = event && event.message ? event.message : event;
  if (!message || typeof message !== "object") return null;

  const match = String(message.path || "").match(ITEM_PATH_RE);
  if (!match || !isMessagePatch(message.path, message.op)) return null;

  const threadID = String(match[1]);
  const itemID = String(message.item_id || match[2]);
  // The poller names a message by its mid ("mid.$..."); the push carries the
  // numeric item id and, when the broker includes it, the same mid. Prefer the
  // mid so both sources produce the same messageID and a dedupe on it works.
  const mid = message.message_id != null ? String(message.message_id) : null;
  const messageID = mid || itemID;

  const senderID = message.user_id != null ? String(message.user_id) : null;
  // The broker echoes our own sends back over message-sync; drop them unless the
  // caller asked for self messages (FCA's selfListen).
  const selfListen = !!(opts && opts.selfListen);
  if (!selfListen && senderID && selfId && senderID === String(selfId)) return null;

  // item_type is a number on the wire (text = 1) and a string elsewhere; treat
  // only the known non-message kinds as non-actionable and everything else as
  // text, so a numeric type is not misread as an attachment with no URL.
  const rawType = message.item_type != null ? message.item_type : message.content_type;
  const typeText = typeof rawType === "string" ? rawType.toLowerCase() : String(rawType ?? "");
  if (/reaction|action_log|like|video_call/.test(typeText)) return null;
  const isText = typeText === "" || typeText === "1" || typeText === "text" || typeText === "text_content";

  const body = message.text || message.text_body || "";
  let attachments = [];
  if (!isText) {
    attachments = attachmentsFromContent(message.media || message.content || message);
  }
  // Instagram types a DM that contains a URL as "xma_link" (a link preview),
  // not "text", yet the user's message — including the command — is still in
  // `text`. Treating it as media dropped it, so `/cmd install x.js <url>` and
  // every other URL-bearing command went unanswered. Any non-media item that
  // carries text is a text message; only an item with neither text nor a
  // parseable media URL is dropped.
  const isLinkWithText = !isText && attachments.length === 0 && String(body).trim() !== "";
  if (!isText && !isLinkWithText && attachments.length === 0) {
    // The item carried no parseable media URL; let the normalizer/bot fetch the
    // thread history instead of emitting a message with nothing actionable.
    return null;
  }
  const itemType = isText || isLinkWithText ? "text" : typeText;

  const replyFromPush = normalizeReplyFromPush(message.replied_to_message);

  return {
    type: "message",
    threadID,
    senderID,
    messageID,
    itemID,
    mid,
    body,
    attachments,
    itemType,
    // A reply arrives as `replied_to_message` (object) on the push and as
    // `replied_to_item_id` (flat) on the poller; accept either.
    repliedToItemId:
      message.replied_to_item_id != null
        ? String(message.replied_to_item_id)
        : (replyFromPush && replyFromPush.repliedToItemId) || null,
    repliedToMessage: (replyFromPush && replyFromPush.repliedToMessage) || null,
    clientContext: message.client_context || null,
    offlineThreadingId: message.offline_threading_id != null ? String(message.offline_threading_id) : null,
    timestamp: Number(message.timestamp || message.timestamp_ms) || Date.now()
  };
}

module.exports = { rawEventFromMessageSync, isMessagePatch, ITEM_PATH_RE };
