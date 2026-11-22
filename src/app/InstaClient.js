/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// The FCA-shaped client. It wraps the native InstaAPI (src/api.js) and exposes
// the Facebook Chat API surface (sendMessage, setMessageReaction, getThreadInfo,
// ...) so GoatBot-Pro / FCA commands run unchanged. The individual methods live
// as one file each under src/api/<group>/<method>.js and are attached by
// loadApiMethods(); this class holds the shared plumbing they build on.

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const { AUDIO_EXT, VIDEO_EXT, extOf } = require("../utils/format");
const { convert } = require("../utils/messageStyle");
const loadApiMethods = require("./loadApiMethods");
const { setBounded } = require("../utils/boundedMap");

class InstaClient {
  constructor(instaApi, options = {}) {
    // The native client is kept as `api`, exactly like FCA keeps `ctx` separate
    // from the public surface.
    this.api = instaApi;
    this.options = options;
    this.userID = instaApi.getCurrentUserID ? instaApi.getCurrentUserID() : null;
    this.username = instaApi.username || null;
    this.http = instaApi.http;
    this.convert = convert;

    // messageID -> threadID, so unsendMessage(messageID) can find its thread.
    this._msgThread = new Map();
    // pk / username -> avatar CDN URL, learned from thread introspection.
    this._picCache = new Map();
    // any id / interop fbid / lowercase username -> full user record, learned
    // from inbox and thread introspection. Instagram rate-limits username
    // lookups (usernameinfo / web_profile_info) for web sessions, so resolving a
    // mentioned @handle must come from data the session already has.
    this._userIndex = new Map();
    // threadID -> participant igids, learned from thread introspection. Instagram
    // inbox events carry no participant list, so frozen commands that read
    // event.participantIDs (all, ban) are served from here by the normalizer.
    this._threadMembers = new Map();

    this._learnFromInbox();
    loadApiMethods(this);
    this._bindNativeMethods();

    // Retry a throttled read (a null result) a bounded number of times, so a
    // caller that destructures the result does not crash on a transient 429.
    // Configurable via `options.readRetry`; disabled with `readRetry: false`.
    require("../utils/readRetry").install(this, options && options.readRetry);

    // Re-tune outbound send pacing for this client (same shape as the native
    // `sendPacing` option). Honoured even when the wrapper is built around an
    // already-initialised native client, so a bot can loosen the throttle after
    // login. `{ enabled: false }` switches it off entirely.
    if (options && options.sendPacing) {
      require("../utils/antiSuspension").globalAntiSuspension.configure(options.sendPacing);
    }

    // Snapshot the session guard onto the client unless explicitly disabled.
    if (!options || options.sessionGuard !== false) {
      require("../utils/sessionGuard").install(this, options && options.sessionGuardFile);
    }
  }

  // Expose the native client's own methods (sendPhotoBuffer, sendVoiceBuffer,
  // markThreadSeen, getUserInfoByUsername, ...) on the FCA surface too, so a
  // command may use either the fca-style or the native call. FCA-shaped methods
  // defined on this class (or attached by loadApiMethods) win.
  _bindNativeMethods() {
    const proto = Object.getPrototypeOf(this.api) || {};
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === "constructor" || key in this) continue;
      const fn = this.api[key];
      if (typeof fn === "function") this[key] = fn.bind(this.api);
    }
  }

  // Every thread-introspection payload (inbox, thread info) discovered during
  // normal operation carries each participant's profile_pic_url. Learn the
  // pk/fbid/username -> URL mapping up front, so the graph bridge and
  // getUserInfo can answer without a rate-limited REST call.
  _learnFromInbox() {
    if (typeof this.api.getInbox !== "function") return;
    const originalInbox = this.api.getInbox.bind(this.api);
    this.api.getInbox = async (...args) => {
      const result = await originalInbox(...args);
      this._learnThreads(result);
      return result;
    };
  }

  // Rewrites Facebook Graph picture URLs to the real Instagram CDN avatar.
  async _resolveIgPictureUrl(src) {
    const m = String(src).match(/graph\.facebook\.com\/(\d+)\/picture/i) ||
      String(src).match(/graph\.facebook\.com\/(\d+)/i);
    if (!m) return null;
    const id = m[1];
    const igHost = /instagram\.com/i.test(String(src));
    return this._igPictureForUser(id, igHost ? "username" : "id");
  }

  async _igPictureForUser(key, kind = "id") {
    const k = String(key);
    const cached = this._picCache.get(k);
    if (cached) return cached;
    const named = this._picCache.get(`name:${k}`);
    if (named && this._picCache.get(named)) return this._picCache.get(named);
    // Learned from inbox/thread introspection: answers an @handle without a
    // rate-limited REST call.
    const known = this._userIndex.get(k.toLowerCase());
    if (known) {
      const url = known.profile_pic_url_hd || known.profile_pic_url;
      if (url) {
        this._rememberUser(known);
        return url;
      }
    }
    try {
      let u = null;
      // Prefer the inbox introspection path (users[].profile_pic_url): it stays
      // inside the DM GraphQL surface and returns real avatars, whereas
      // /api/v1/users/<id>/info/ rate-limits (429) for this session.
      u = await this._igUserFromInbox(key, kind);
      if (!u) {
        if (kind === "username") u = await this.api.getUserInfoByUsername(key);
        else u = await this.api.getUserInfo(String(key));
      }
      const url = u?.profile_pic_url_hd || u?.profile_pic_url || u?.profileUrl || null;
      if (url) {
        for (const id of [u?.id, u?.pk, u?.interop_messaging_user_fbid, key]) {
          if (id) setBounded(this._picCache, String(id), url, 5000);
        }
        if (u?.username) setBounded(this._picCache, u.username, url, 5000);
      }
      return url;
    } catch (_) {
      return null;
    }
  }

  async _igUserFromInbox(key, kind) {
    const known = this.getUserByUsername(key);
    if (known) return known;
    if (typeof this.api.getInbox !== "function") return null;
    const inbox = await this.api.getInbox().catch(() => null);
    this._learnThreads(inbox);
    return this.getUserByUsername(key) || null;
  }

  // Records avatars for every participant seen in an inbox / thread payload, keyed
  // by pk, fbid and username, so later getUserInfo / graph-bridge lookups are a
  // cache hit instead of a REST call Instagram rate-limits (429). Also fills the
  // user index used to resolve @mentions to a pk offline.
  _learnThreads(payload) {
    const raw = payload?.threads || payload;
    const threads = Array.isArray(raw) ? raw : raw?.users ? [raw] : [];
    for (const t of threads) {
      const users = (Array.isArray(t.users) ? t.users : []).filter((u) => u && typeof u === "object");
      if (t.viewer && typeof t.viewer === "object") users.unshift(t.viewer);
      for (const u of users) this._rememberUser(u);
      const threadID = t.id != null ? String(t.id) : t.thread_id != null ? String(t.thread_id) : null;
      if (threadID) {
        setBounded(
          this._threadMembers,
          threadID,
          users.map((u) => String(u.id || u.pk || "")).filter(Boolean),
          2000
        );
      }
    }
  }

  // The igids of a thread's participants, from data already seen. Prefers the
  // native poller's latest inbox snapshot (fresh every poll) and falls back to
  // the thread introspection the FCA layer learned. Used to fill
  // event.participantIDs for commands ported from Facebook, whose MQTT events
  // carried the member list but Instagram's do not.
  getThreadParticipantIDs(threadID) {
    if (this.api && typeof this.api.getThreadMemberIDs === "function") {
      const live = this.api.getThreadMemberIDs(threadID);
      if (live.length) return live;
    }
    const members = this._threadMembers.get(String(threadID));
    return Array.isArray(members) ? members.slice() : [];
  }

  // The realtime push names a thread by its internal thread_id; the poller,
  // thread-detail read and frozen commands use the inbox id. Map one onto the
  // other so a pushed event is handled with the same thread id the rest of the
  // bot uses. An unknown id (the map is cold, or a brand-new thread) is returned
  // unchanged.
  resolveThreadID(threadID) {
    const key = String(threadID);
    if (this.api && typeof this.api.getThreadIdMap === "function") {
      const mapped = this.api.getThreadIdMap().get(key);
      if (mapped) return String(mapped);
    }
    const known = this._threadMembers.get(key);
    if (known) return key;
    return key;
  }

  // Indexes one Instagram user record (inbox/thread shape: id, username,
  // full_name, interop_messaging_user_fbid, profile_pic_url) under every key a
  // command may look it up by.
  _rememberUser(u) {
    if (!u || typeof u !== "object") return;
    const url = u.profile_pic_url_hd || u.profile_pic_url || null;
    const id = u.id || u.pk || null;
    const username = u.username || null;
    for (const key of [id, u.pk, u.interop_messaging_user_fbid, username]) {
      if (key) setBounded(this._userIndex, String(key).toLowerCase(), u, 5000);
    }
    for (const k of [id, u.pk, u.interop_messaging_user_fbid]) {
      if (k && username) setBounded(this._picCache, `name:${k}`, username, 5000);
      if (k && url) setBounded(this._picCache, String(k), url, 5000);
    }
    if (username && url) setBounded(this._picCache, username, url, 5000);
  }

  // Returns the user record for an @handle (or numeric id / interop fbid) from
  // data already learned from the inbox and thread views. This is deliberately
  // offline: usernameinfo and web_profile_info both rate-limit a web session.
  getUserByUsername(username) {
    if (username == null) return null;
    return this._userIndex.get(String(username).replace(/^@/, "").toLowerCase()) || null;
  }

  async _resolveMentionsOffline(body) {
    const mentions = {};
    const names = [...new Set((String(body).match(/@([A-Za-z0-9._]{1,30})/g) || []).map((m) => m.slice(1)))];
    if (!names.length) return mentions;
    // The inbox is the richest source; learn it once, then answer from the index.
    if (!this._inboxLearned && typeof this.api.getInbox === "function") {
      this._inboxLearned = true;
      try { this._learnThreads(await this.api.getInbox()); } catch (_) {}
    }
    for (const username of names) {
      let u = this.getUserByUsername(username);
      // Index miss (e.g. a handle never seen in the inbox): fall back to a live
      // lookup and remember it, so the next mention resolves offline.
      if (!u && typeof this.api.getUserInfoByUsername === "function") {
        try {
          u = await this.api.getUserInfoByUsername(username);
          if (u) this._rememberUser(u);
        } catch (_) {}
      }
      if (u) mentions[String(u.id || u.pk)] = u.username || username;
    }
    return mentions;
  }


  // ---------------------------------------------------------------- sending
  _normalizeForm(form) {
    if (typeof form === "string") return { body: form };
    if (!form || typeof form !== "object") return { body: String(form) };
    return {
      body: form.body || form.message || "",
      attachment: form.attachment,
      attachments: form.attachments,
      url: form.url
    };
  }

  async _attachmentToBuffer(src) {
    if (Buffer.isBuffer(src)) return { buffer: src, filename: `file_${Date.now()}` };
    if (typeof src === "string") {
      if (/^https?:\/\//i.test(src)) {
        // Frozen Facebook commands fetch avatars straight from the Graph API
        // (e.g. pp.js's graph.facebook.com/<uid>/picture). On Instagram that
        // endpoint is meaningless, so rewrite such URLs to the user's real
        // Instagram CDN picture before downloading — commands stay untouched.
        const bridge = await this._resolveIgPictureUrl(src);
        const url = bridge || src;
        const res = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
        // A graph .../picture URL that failed to bridge returns JSON, not an
        // image; fail loudly there. Other media URLs keep the lenient path.
        if (/graph\.facebook\.com\/.*picture/i.test(src)) {
          const ct = String(res.headers?.["content-type"] || "");
          if (!ct.startsWith("image/")) throw new Error(`Attachment is not an image (${ct || "unknown"})`);
        }
        return { buffer: Buffer.from(res.data), filename: path.basename(url.split("?")[0]) || `file_${Date.now()}.jpg` };
      }
      return { buffer: fs.readFileSync(src), filename: path.basename(src) };
    }
    if (src && typeof src.pipe === "function") {
      // a readable stream (fs.createReadStream) — drain it
      const chunks = [];
      for await (const chunk of src) chunks.push(chunk);
      const filename = src.path ? path.basename(src.path) : `file_${Date.now()}`;
      return { buffer: Buffer.concat(chunks), filename };
    }
    return null;
  }

  async _sendAttachment(threadID, src, caption) {
    const resolved = await this._attachmentToBuffer(src);
    if (!resolved) throw new Error("Unsupported attachment");
    const { buffer, filename } = resolved;
    const ext = extOf(filename);
    const opts = caption ? { text: convert(caption), filename } : { filename };

    if (AUDIO_EXT.has(ext)) return this.api.sendVoiceBuffer(threadID, buffer, opts);
    if (VIDEO_EXT.has(ext)) return this.api.sendVideoBuffer(threadID, buffer, opts);
    return this.api.sendPhotoBuffer(threadID, buffer, opts);
  }

  // Media helpers the ported commands call directly. All resolve the source
  // (URL / path / buffer / stream) and route to the matching IG send.
  async _mediaSend(threadID, src, opts, callback) {
    const cb = typeof callback === "function" ? callback : null;
    try {
      const info = await this._sendAttachment(String(threadID), src, opts && (opts.text || opts.caption));
      if (info && info.messageID) setBounded(this._msgThread, info.messageID, String(threadID), 5000);
      const out = { messageID: info && info.messageID, threadID: String(threadID), timestamp: Date.now() };
      if (cb) cb(null, out);
      return out;
    } catch (error) {
      if (cb) cb(error, null);
      throw error;
    }
  }

  sendPhoto(threadID, src, opts, callback) {
    if (typeof opts === "function") { callback = opts; opts = {}; }
    return this._mediaSend(threadID, src, opts, callback);
  }

  sendPhotoFromUrl(threadID, url, opts, callback) {
    if (typeof opts === "function") { callback = opts; opts = {}; }
    return this._mediaSend(threadID, url, opts, callback);
  }

  sendVideoFromUrl(threadID, url, opts, callback) {
    if (typeof opts === "function") { callback = opts; opts = {}; }
    return this._mediaSend(threadID, url, opts, callback);
  }

  sendVoiceFromUrl(threadID, url, opts, callback) {
    if (typeof opts === "function") { callback = opts; opts = {}; }
    return this._mediaSend(threadID, url, opts, callback);
  }

  // Resolves an Instagram profile-picture CDN URL for the graph bridge that
  // keeps frozen Facebook commands (pp.js) working. Accepts a numeric pk or a
  // username.
  async getProfilePictureUrl(idOrUsername) {
    const key = String(idOrUsername);
    return this._igPictureForUser(key, /^\d+$/.test(key) ? "id" : "username");
  }

  // Full profile (id or @handle) from the native resolver. Merges the record
  // learned from the inbox/thread views with web_profile_info and the account's
  // own page, so it answers even when the profile REST paths rate-limit (429) or
  // 302 to the login page. Never throws; returns null when nothing resolves.
  async getProfile(idOrUsername, opts) {
    if (typeof this.api.getUserProfile !== "function") return null;
    const profile = await this.api.getUserProfile(idOrUsername, opts).catch(() => null);
    if (profile) this._rememberProfile(profile);
    return profile;
  }

  // Seeds the FCA caches (picture + user index) from a normalized profile so
  // later getUserInfo / graph-bridge lookups are a cache hit.
  _rememberProfile(profile) {
    if (!profile) return;
    const url = profile.profilePicUrlHd || profile.profilePicUrl;
    for (const key of [profile.id, profile.pk, profile.username, profile.fbid]) {
      if (!key) continue;
      if (url) setBounded(this._picCache, String(key), url, 5000);
      if (profile.username) setBounded(this._picCache, `name:${String(key)}`, profile.username, 5000);
    }
  }

  // Frozen commands (pp.js) call the fca name `getPictureUrl(id, type)` and
  // guard with `typeof api.getPictureUrl === "function"`; without it the call
  // is skipped and the avatar is blank. `type` mirrors fca's optional
  // "normal"/"large" hint and is ignored — Instagram serves one CDN URL.
  getPictureUrl(idOrUsername) {
    return this.getProfilePictureUrl(idOrUsername);
  }

  // ------------------------------------------------------------- reactions
  rememberThread(messageID, threadID) {
    if (messageID && threadID) setBounded(this._msgThread, String(messageID), String(threadID), 5000);
  }

  _resolveThread(messageID, threadID) {
    // fca's signature is setMessageReaction(emoji, messageID, callback, force);
    // commands pass `true` there, so anything that is not a real id is ignored
    // and we fall back to the thread the message was seen in.
    const explicit = typeof threadID === "string" || typeof threadID === "number" ? threadID : null;
    const tid = explicit || this._msgThread.get(String(messageID));
    if (!tid) throw new Error("Unknown thread for message " + messageID);
    return tid;
  }

  // -------------------------------------------------------------- low level
  async httpPost(url, options) {
    const res = await axios.post(url, options?.form || options?.body, options);
    return res.data;
  }

  async httpGet(url, options) {
    const res = await axios.get(url, options);
    return res.data;
  }

  // Group-management features do not exist for Instagram personal DMs.
  async changeNickname() { return false; }
  async setTitle() { return false; }
  async changeThreadColor() { return false; }
  async changeThreadEmoji() { return false; }
  async changeGroupImage() { return false; }
  async changeAvatar() { return false; }

  // Instagram group DMs support adding/removing participants. FCA passes
  // (userID, threadID); the API takes the reverse. Instagram's endpoint only
  // accepts a numeric igid, but frozen commands (adduser.js) may hand over a
  // username or @handle (they resolve numeric ids themselves; only a handle can
  // reach here unresolved). Resolve it against data already learned, and refuse
  // rather than send a non-numeric id the endpoint would 4xx on.
  async _resolveUserKey(userID) {
    const key = String(userID).replace(/^@/, "").trim();
    if (/^\d+$/.test(key)) return key;
    const known = this.getUserByUsername(key);
    if (known) {
      const id = known.id || known.pk || known.interop_messaging_user_fbid;
      if (id != null) return String(id);
    }
    if (typeof this.api.getUserInfoByUsername === "function") {
      try {
        const u = await this.api.getUserInfoByUsername(key);
        if (u) {
          this._rememberUser(u);
          const id = u.id || u.pk || u.interop_messaging_user_fbid;
          if (id != null) return String(id);
        }
      } catch (_) {}
    }
    return null;
  }

  async addUserToGroup(userID, threadID) {
    if (typeof this.api.addUserToGroup !== "function") return false;
    const uid = await this._resolveUserKey(userID);
    if (!uid) return false;
    return this.api.addUserToGroup(threadID, uid);
  }

  async removeUserFromGroup(userID, threadID) {
    if (typeof this.api.removeUserFromGroup !== "function") return false;
    const uid = await this._resolveUserKey(userID);
    if (!uid) return false;
    return this.api.removeUserFromGroup(threadID, uid);
  }
}

module.exports = InstaClient;
