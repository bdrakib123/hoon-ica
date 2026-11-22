/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// Parsers for the Relay slide-message content shapes returned by
// PolarisDirectInboxQuery and IGDThreadDetailQuery. Both queries wrap a
// message as a node with { content_type, text_body, content }, where content
// carries a typed __typename and the media under a type-specific key.

function textOf(node) {
  return node?.text_body || node?.content?.text_body || node?.content?.xma_text_body || "";
}

function firstUrl(...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    if (Array.isArray(c)) {
      const hit = c.find((x) => x && (x.attachment_cdn_url || x.preview_cdn_url || x.url || x.uri));
      if (hit) return hit.attachment_cdn_url || hit.preview_cdn_url || hit.url || hit.uri;
      continue;
    }
    const url = c.attachment_cdn_url || c.preview_cdn_url || c.url || c.uri;
    if (url) return url;
  }
  return null;
}

// Maps a slide-message content object to an fca-style attachment array.
function attachmentsFromContent(content) {
  if (!content) return [];
  const pick = (arr) => (Array.isArray(arr) ? arr[0] : arr);
  const one = (type, url) => (url ? [{ type, url, caption: null }] : []);

  switch (content.__typename) {
    case "SlideMessageImageContent":
      return one("photo", firstUrl(content.attachments, content.images, content.image));
    case "SlideMessageVideosContent":
      return one("video", firstUrl(content.videos, content.video));
    case "SlideMessageAudioContent":
      return one("audio", firstUrl(content.audios, content.audio, content.audio_src));
    case "SlideMessageAnimatedMediaContent":
      return one("gif", firstUrl(content.animated_media, content.gifs));
    case "SlideMessageXMAContent":
      return one("share", content.xma?.preview_image?.url || content.xma?.preview_image?.uri || null);
    default: {
      const o = pick(content.attachments) || content.image || content.video || content.audio;
      const url = firstUrl(o);
      if (!url) return [];
      return [{ type: "file", url, caption: null }];
    }
  }
}

// Builds an fca-shaped reply context from a raw replied_to_message node. The
// sender fbid is mapped to the participant's Instagram id when the caller
// passes a lookup table.
function firstUsableId(...values) {
  const value = values.find((entry) => entry != null && String(entry).trim() !== "");
  return value == null ? "" : String(value);
}

function normalizeRepliedMessage(replied, fbidToIgid = {}) {
  if (!replied) return null;
  const senderFbid = replied.sender_fbid != null ? String(replied.sender_fbid) : null;
  const mapped = senderFbid && fbidToIgid[senderFbid] ? fbidToIgid[senderFbid] : senderFbid;
  return {
    messageID: firstUsableId(replied.id, replied.message_id),
    senderID: mapped,
    sender_fbid: senderFbid,
    senderName: replied.sender?.name || null,
    body: textOf(replied),
    text: textOf(replied),
    itemType: String(replied.content_type || "").toLowerCase(),
    content_type: replied.content_type,
    attachments: attachmentsFromContent(replied.content),
    clientContext: replied.client_context || null,
    timestamp: Number(replied.timestamp_ms) || null
  };
}

module.exports = { textOf, attachmentsFromContent, normalizeRepliedMessage };