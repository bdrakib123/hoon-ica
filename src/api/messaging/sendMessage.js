/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// fca.sendMessage(form, threadID, callback, replyToMessage) on Instagram.
// `form` is a string or { body, attachment | attachments }; `replyToMessage` is
// the target message id (or an event / messageReply object).
//
// `attachment` may be a single source or an array. Instagram commits one media
// per message (IGDirectMediaSendMutation carries a single attachment_fbid), so an
// array is sent as one message per entry — the FCA contract for an array, and what
// ported GoatBot-Pro commands (pinterest, backupdata, appstore, ...) rely on when
// they pass `attachment: [..]` for a multi-image send. The body rides with the
// first entry so the text renders above the images; the callback reports the last
// message.
const { extractMessageId } = require("../../utils/format");
const { setBounded } = require("../../utils/boundedMap");

// Normalises `attachment` / `attachments` into a flat, non-null list. A nested
// array is flattened one level deep; null/undefined entries are dropped.
function toAttachmentList(attachment, attachments) {
  const list = [];
  const add = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const entry of value) add(entry);
      return;
    }
    list.push(value);
  };
  add(attachment);
  add(attachments);
  return list;
}

module.exports = function (client) {
  return async function sendMessage(form, threadID, callback, replyToMessage) {
    // fca also accepts sendMessage(form, threadID, messageID) where the 3rd arg
    // is a string (the message being replied to).
    if (typeof callback === "string" && replyToMessage === undefined) {
      replyToMessage = callback;
      callback = undefined;
    }
    let replyTo = null;
    if (replyToMessage != null) {
      replyTo =
        typeof replyToMessage === "object"
          ? replyToMessage.messageID || replyToMessage.id || null
          : String(replyToMessage);
    }
    const cb = typeof callback === "function" ? callback : null;

    try {
      const { body, attachment, attachments } = client._normalizeForm(form);
      const mediaList = toAttachmentList(attachment, attachments);
      let result;

      if (mediaList.length) {
        // One media per message. The body is attached to the first send only, so
        // a captioned multi-image send is text + images rather than the text
        // repeated before every image.
        for (let i = 0; i < mediaList.length; i++) {
          result = await client._sendAttachment(
            String(threadID),
            mediaList[i],
            i === 0 ? body : ""
          );
          const sentId = extractMessageId(result);
          if (sentId) setBounded(client._msgThread, sentId, String(threadID), 5000);
        }
      } else {
        result = await client.api.sendMessage(client.convert(body), String(threadID), replyTo);
      }

      const messageID = extractMessageId(result);
      if (messageID) setBounded(client._msgThread, messageID, String(threadID), 5000);
      const info = { messageID, threadID: String(threadID), timestamp: Date.now() };
      if (cb) cb(null, info);
      return info;
    } catch (error) {
      if (cb) cb(error, null);
      throw error;
    }
  };
};
