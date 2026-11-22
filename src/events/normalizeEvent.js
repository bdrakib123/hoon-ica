/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// Turns a raw Instagram inbox event into the FCA / GoatBot-Pro event shape that
// commands expect: senderID, threadID, messageID, body, mentions, messageReply,
// type, attachments, senderName.

const USERNAME_RE = /@([A-Za-z0-9._]{1,30})/g;

function normalizeAttachments(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((attachment) => attachment && typeof attachment === "object")
    .map((attachment) => ({
      type: attachment.type,
      url: attachment.url,
      filename: null,
      caption: attachment.caption || null
    }));
}

class EventNormalizer {
  constructor(client) {
    this.client = client;
    this._replyCache = new Map(); // threadID -> { itemId: item }
  }

  // The reply target as the caller named it: the realtime push carries a numeric
  // item id and, when the broker includes it, the target's mid; the poller
  // carries the flat replied_to_item_id. Thread history is keyed by the mid, so
  // collect every candidate id.
  _replyLookupIds(reply, rawId) {
    const ids = [];
    for (const v of [rawId, reply && reply.messageID, reply && reply.itemID]) {
      const s = v == null ? "" : String(v);
      if (s && !ids.includes(s)) ids.push(s);
    }
    return ids;
  }

  async _findReply(threadID, ids) {
    const wanted = (Array.isArray(ids) ? ids : [ids])
      .map((v) => (v == null ? "" : String(v)))
      .filter(Boolean);
    if (wanted.length === 0) return null;
    const keyOf = (id) => `${threadID}:${id}`;
    for (const id of wanted) {
      const hit = this._replyCache.get(keyOf(id));
      if (hit) return hit;
    }
    try {
      const items = await this.client.api.getThreadHistory(String(threadID), 50);
      for (const item of items) {
        for (const id of [item.item_id, item.messageID, item.mid, item.id]) {
          const s = id == null ? "" : String(id);
          if (s) this._replyCache.set(keyOf(s), item);
        }
      }
    } catch (_) {
      return null;
    }
    this._pruneReplyCache();
    for (const id of wanted) {
      const hit = this._replyCache.get(keyOf(id));
      if (hit) return hit;
    }
    return null;
  }

  // Bounded so a bot that runs for days across many threads does not grow the
  // cache without limit (Map preserves insertion order, so the oldest goes first).
  _pruneReplyCache() {
    const MAX = 5000;
    while (this._replyCache.size > MAX) {
      const oldest = this._replyCache.keys().next().value;
      this._replyCache.delete(oldest);
    }
  }

  // A reply target is "complete" when it already carries the text and media the
  // commands need. The push gives text only; a media reply's body is empty and
  // its attachments are absent, so it is incomplete and must be enriched.
  _replyHasContent(reply) {
    if (!reply || typeof reply !== "object") return false;
    const body = reply.body || reply.text || "";
    const attachments = Array.isArray(reply.attachments) ? reply.attachments : [];
    if (attachments.length > 0) return true;
    const type = String(reply.itemType || reply.content_type || "").toLowerCase();
    const textOnly = !type || ["text", "1", "text_content", "message"].includes(type);
    // A caption is not proof that a media reply is complete: the push can carry
    // the caption/type while omitting the actual attachment nodes.
    return textOnly && String(body).trim() !== "";
  }

  // Prefer the fields the caller already had (the push's ids/sender) and take the
  // richer content from the history item.
  _mergeReply(partial, found) {
    if (!found) return partial;
    if (!partial) return found;
    return {
      messageID: partial.messageID || found.messageID || found.item_id || "",
      itemID: partial.itemID || found.item_id || found.itemID || null,
      senderID: partial.senderID || found.senderID || found.user_id || found.sender_fbid || null,
      senderName: partial.senderName || found.senderName || null,
      body: partial.body || partial.text || found.body || found.text || "",
      attachments:
        Array.isArray(partial.attachments) && partial.attachments.length
          ? partial.attachments
          : found.attachments || [],
      itemType: partial.itemType || partial.content_type || found.itemType || found.content_type || "",
      clientContext: partial.clientContext || partial.client_context || found.clientContext || null,
      offlineThreadingId:
        partial.offlineThreadingId || partial.offline_threading_id ||
        found.offlineThreadingId || found.offline_threading_id || null,
      timestamp: partial.timestamp || found.timestamp || null
    };
  }

  // Resolves @username mentions to a { userID: name } map. Instagram text
  // messages carry no structured mention list, and username lookups rate-limit
  // (429) for web sessions, so resolve against the users the client already
  // learned from the inbox / thread views.
  async _resolveMentions(body) {
    if (typeof this.client._resolveMentionsOffline === "function") {
      return this.client._resolveMentionsOffline(body);
    }
    const mentions = {};
    const names = [...new Set((body.match(USERNAME_RE) || []).map((m) => m.slice(1)))];
    for (const username of names) {
      try {
        const user = await this.client.api.getUserInfoByUsername(username);
        const userID = user && (user.pk || user.id);
        if (userID != null) mentions[String(userID)] = user.username || username;
      } catch (_) {}
    }
    return mentions;
  }

  async normalize(raw) {
    // Instagram system activity (member added/removed, name/image change) is
    // synthesized by the inbox poller as an already-shaped "event" — GoatBot's
    // handlerEvent/onEvent dispatch on event.type === "event".
    if (!raw || raw.type === "event") {
      if (!raw) return null;
      // Do not turn absent identifiers into the literal strings "undefined"
      // or "null"; downstream dispatch and thread caches use these as keys.
      if (raw.threadID == null || String(raw.threadID).trim() === "" ||
          raw.messageID == null || String(raw.messageID).trim() === "") return null;
      return {
        type: "event",
        threadID: String(raw.threadID),
        senderID: String(raw.author || ""),
        author: raw.author ? String(raw.author) : "",
        messageID: String(raw.messageID),
        body: null,
        logMessageType: raw.logMessageType,
        logMessageData: raw.logMessageData || {},
        isGroup: raw.isGroup,
        participantIDs: (Array.isArray(raw.participantIDs) ? raw.participantIDs : []).map(String),
        timestamp: raw.timestamp || Date.now(),
        mentions: {}
      };
    }
    if (raw.type !== "message") return null;
    // A malformed push must not poison message->thread lookup with "undefined".
    if (raw.threadID == null || String(raw.threadID).trim() === "" ||
        raw.messageID == null || String(raw.messageID).trim() === "") return null;

    const threadID = String(raw.threadID);
    const senderID = String(raw.senderID || "");
    const body = raw.body || "";

    let senderName = raw.senderName || null;
    // Prefer the name the client already learned from the inbox/thread views.
    // A live getUserInfo() on the critical path is a web REST call Instagram
    // answers with a 302/429 for this session, so it costs a round trip and then
    // fails — and the command dispatch waits on it. The offline index is free.
    if (!senderName && typeof this.client.getUserByUsername === "function") {
      try {
        const known = this.client.getUserByUsername(senderID);
        if (known) senderName = known.full_name || known.username || null;
      } catch (_) {}
    }
    if (!senderName) {
      try {
        const u = await this.client.api.getUserInfo(senderID);
        if (u) senderName = u.full_name || u.username || null;
      } catch (_) {}
    }
    if (!senderName) senderName = senderID;

    const event = {
      type: "message",
      threadID,
      senderID,
      userID: senderID,
      messageID: String(raw.messageID),
      body,
      senderName,
      // Facebook MQTT events carried the member list; Instagram's do not. Frozen
      // commands (all.js, ban.js) read event.participantIDs, so fill it from the
      // members the client learned from thread introspection. Undefined when
      // unknown — the same shape as upstream, so `|| []` guards behave.
      participantIDs: (() => {
        if (typeof this.client.getThreadParticipantIDs !== "function") return undefined;
        const ids = this.client.getThreadParticipantIDs(threadID);
        return Array.isArray(ids) ? ids.map(String) : undefined;
      })(),
      mentions: body.includes("@") ? await this._resolveMentions(body) : {},
      attachments: normalizeAttachments(raw.attachments),
      timestamp: raw.timestamp
    };

    // Reply context. The poller resolves the replied-to message from the
    // thread-detail query and passes it as raw.repliedToMessage. The realtime push
    // carries only the target's ids and text, never its media node, so a
    // swipe-reply to a photo arrived with `attachments: []` and every media
    // command (imgbb/catbox, …) answered "Please reply to an image". A text reply
    // needs no round-trip; a target missing its body or media is resolved from
    // thread history.
    const replied = raw.repliedToMessage || null;
    if (replied || raw.repliedToItemId) {
      let reply = replied;
      if (!reply || !this._replyHasContent(reply)) {
        const found = await this._findReply(
          threadID,
          this._replyLookupIds(reply, raw.repliedToItemId)
        );
        if (found) reply = this._mergeReply(reply, found);
      }
      if (reply) {
        const senderId = String(reply.senderID || reply.user_id || reply.sender_fbid || "");
        event.type = "message_reply";
        event.messageReply = {
          messageID: String(reply.messageID || reply.item_id || ""),
          senderID: senderId,
          body: reply.body || reply.text || "",
          attachments: normalizeAttachments(reply.attachments),
          itemType: String(reply.itemType || reply.content_type || "").toLowerCase(),
          clientContext: reply.clientContext || reply.client_context || null,
          offlineThreadingId: reply.offlineThreadingId || reply.offline_threading_id || null,
          timestamp: Number(reply.timestamp || reply.timestamp_ms) || null
        };
        event.messageReply.senderName = reply.senderName || null;
        if (!event.messageReply.senderName) {
          // Prefer a name the session already learned; a live lookup is a web REST
          // call Instagram answers with 302/429, and dispatch waits on it.
          try {
            const known =
              typeof this.client.getUserByUsername === "function"
                ? this.client.getUserByUsername(senderId)
                : null;
            if (known) event.messageReply.senderName = known.full_name || known.username || null;
          } catch (_) {}
        }
        if (!event.messageReply.senderName) {
          try {
            const u = await this.client.api.getUserInfo(senderId);
            event.messageReply.senderName = u?.full_name || u?.username || senderId;
          } catch (_) {
            event.messageReply.senderName = senderId;
          }
        }
      }
    }

    // Commands react to the inbound message by id (setMessageReaction), so the
    // client must know which thread it belongs to.
    if (typeof this.client.rememberThread === "function") {
      this.client.rememberThread(event.messageID, threadID);
      // Remember the replied-to message too: /unsend resolves its thread from
      // that id, and the bot may be unssending a message it sent in an earlier
      // process (so it is not in _msgThread otherwise).
      if (event.messageReply && event.messageReply.messageID) {
        this.client.rememberThread(event.messageReply.messageID, threadID);
      }
    }

    return event;
  }
}

module.exports = EventNormalizer;
