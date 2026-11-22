/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// Small shared helpers used by the FCA-shaped adapter methods.

const path = require("path");

const AUDIO_EXT = new Set([".ogg", ".opus", ".mp3", ".m4a", ".aac", ".wav"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".mkv", ".webm", ".gif"]);

function extOf(name) {
  return path.extname(String(name || "").split("?")[0]).toLowerCase();
}

// Instagram's Relay mutations wrap the payload in a single dynamically-named
// key (e.g. xig_direct_text_send_with_slide_messaging_response), so walk the
// response depth-first for the first message/item id we recognise.
const ID_KEYS = ["message_id", "item_id", "messageId", "itemId", "id"];
function extractMessageId(result) {
  if (!result) return null;
  if (typeof result === "string") return result;

  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return null;
    seen.add(node);
    for (const key of ID_KEYS) {
      const v = node[key];
      if (typeof v === "string" && v) return v;
    }
    for (const key of Object.keys(node)) {
      const found = walk(node[key]);
      if (found) return found;
    }
    return null;
  };
  return walk(result);
}

module.exports = { AUDIO_EXT, VIDEO_EXT, extOf, extractMessageId };
