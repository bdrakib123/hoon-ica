/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const HttpClient = require("./http");
const { normalizeCookie } = require("./cookies");
const { EP } = require("./constants");
const deviceIdentity = require("./deviceIdentity");
const sessionGuard = require("./utils/sessionGuard");
const { dataPath } = require("./utils/dataDir");
const fs = require("fs");
const path = require("path");

const { globalAntiSuspension } = require("./utils/antiSuspension");
const { setBounded } = require("./utils/boundedMap");
const MessageMethods = require("./methods/message");
const ReactionMethods = require("./methods/reactions");
const TypingMethods = require("./methods/typing");
const ThreadMethods = require("./methods/thread");
const UserMethods = require("./methods/user");
const InboxMethods = require("./methods/inbox");
const MediaMethods = require("./methods/media");

class InstaAPI {
  constructor(cookieRaw, options = {}) {
    const jar = normalizeCookie(cookieRaw);
    if (!jar.sessionid) throw new Error("sessionid missing from cookie");

    this.userID = jar.ds_user_id || null;
    this.username = null;
    this.options = options;

    // Apply outbound send pacing before anything can send. `sendPacing` is a
    // partial SendPacer config (see antiSuspension.DEFAULTS): { enabled,
    // globalMinGapMs, perThreadMinGapMs, jitterMs, warmupWindowMs,
    // warmupHourlyCap, normalHourlyCap, dailyCap, overCapGapMs, ... }. A bot that
    // does not want the anti-suspension throttle at all passes `{ enabled: false }`
    // or raises the caps so they are never hit.
    if (options.sendPacing) globalAntiSuspension.configure(options.sendPacing);

    const restored = sessionGuard.loadSaved(options.appStateFile || options.sessionGuardFile, jar);
    const cookies = restored ? { ...jar, ...restored } : jar;

    this.http = new HttpClient(cookies);
    this.identity = deviceIdentity.loadOrCreate(
      options.deviceFile || dataPath("device.json"),
      cookies.ig_did
    );

    const sessionParams = options.sessionParams || this._loadSessionParams(options.sessionParamsFile);
    if (sessionParams) this.http.setSessionParams(sessionParams);

    this.message = new MessageMethods(this.http, this.identity);
    this.reaction = new ReactionMethods(this.http);
    this.typing = new TypingMethods(this.http);
    this.thread = new ThreadMethods(this.http);
    this.user = new UserMethods(this.http, () => ({ id: this.userID, username: this.username }), (key) => this._learnedUser(key));
    this.inbox = new InboxMethods(this.http, () => this.userID, {
      minPollIntervalMs: options.minPollIntervalMs,
      pollMaxPages: options.pollMaxPages,
      identity: this.identity,
      realtime: options.realtime,
      // false (default) = drop the session's own outbound messages from the
      // event stream, matching FCA's selfListen. true = deliver them too, so a
      // bot can answer commands sent from its own account.
      selfListen: options.selfListen === true,
      // Both the inbox listener and a caller that wants reaction/typing push
      // (e.g. a bot's reaction watcher) must share one MQTT connection: the
      // broker delivers the Direct message-sync stream to only the most-recent
      // subscriber on a session, so a second connection with the same device id
      // silently steals the stream from the first.
      getSharedClient: () => this.sharedRealtimeClient()
    });
    this.media = new MediaMethods(this.http, this.identity);

    // pk / @handle -> user record, learned from inbox/thread introspection. The
    // profile REST paths rate-limit (429) or 302 to login for a web session, so
    // a lookup for a user the bot has already seen answers from here for free.
    this._userIndex = new Map();
    this._learnInboxUsers();
  }

  _learnInboxUsers() {
    const original = this.inbox.getInbox.bind(this.inbox);
    this.inbox.getInbox = async (...args) => {
      const result = await original(...args);
      for (const t of result?.threads || []) {
        if (!t || typeof t !== "object") continue;
        const users = Array.isArray(t.users) ? t.users : [];
        for (const u of users) this._rememberUser(u);
        if (t.viewer) this._rememberUser(t.viewer);
      }
      return result;
    };
  }

  _rememberUser(u) {
    if (!u || typeof u !== "object") return;
    const keys = [u.id, u.pk, u.interop_messaging_user_fbid, u.username];
    for (const key of keys) {
      if (key) setBounded(this._userIndex, String(key).toLowerCase(), u, 5000);
    }
  }

  // The user record for a pk, interop fbid or @handle, from data already seen.
  // Returns null when the user has not been observed yet.
  _learnedUser(key) {
    if (key == null) return null;
    return this._userIndex.get(String(key).replace(/^@/, "").toLowerCase()) || null;
  }

  _loadSessionParams(file) {
    const target = file || dataPath("session-params.json");
    try {
      if (!fs.existsSync(target)) return null;
      // Session params contain reusable GraphQL security tokens; protect an
      // existing file just like the persisted cookie jar before reading it.
      fs.chmodSync(target, 0o600);
      return JSON.parse(fs.readFileSync(target, "utf8"));
    } catch (_) {
      return null;
    }
  }

  setSessionParams(params) {
    this.http.setSessionParams(params);
  }

  // Re-tune outbound send pacing on a live client (same shape as the
  // `sendPacing` option). `{ enabled: false }` switches the anti-suspension
  // throttle off entirely; raising the caps/gaps keeps it on but out of the way.
  setSendPacing(options) {
    return globalAntiSuspension.configure(options);
  }

  // Instagram's web API needs the browser session params (__dyn/__csr/__hs/...).
  // They expire, so re-harvest them (scripts/harvestSession.js) and call this to
  // refresh a running client without restarting.
  async refreshSession(params) {
    if (params) {
      this.setSessionParams(params);
      return true;
    }
    try {
      const { harvestSessionParams } = require("./session");
      const fresh = await harvestSessionParams(this.http.seed);
      if (fresh) {
        this.setSessionParams(fresh);
        return true;
      }
    } catch (_) {}
    return false;
  }

  _sessionError(check) {
    const table = {
      auth: ["IG_SESSION_INVALID", "Instagram rejected this session as unauthenticated (login_required or equivalent response)"],
      session_params_missing: ["IG_SESSION_PARAMS_MISSING", "Full browser-generated Instagram session parameters are missing. Harvest them with a compatible browser or pass sessionParams."],
      graphql_error: ["IG_GRAPHQL_ERROR", "Instagram returned GraphQL errors during session validation; this alone does not prove the cookie is invalid."],
      unexpected_response: ["IG_SESSION_CHECK_UNEXPECTED", "Instagram returned an unexpected response during session validation; the cookie status could not be confirmed."],
      challenge: ["IG_CHALLENGE", "Instagram requires a security check (challenge/checkpoint) before this session can be used"],
      suspended: ["IG_SUSPENDED", "Instagram explicitly reports this account as suspended or disabled"],
      rate_limited: ["IG_TRANSIENT", "Instagram is rate-limiting this session; retry later"],
      transient: ["IG_TRANSIENT", "Instagram could not be reached cleanly; the cookie may still be valid, retry later"]
    };
    const [code, message] = table[check.state] || table.transient;
    const err = new Error(message);
    err.code = code;
    err.state = check.state;
    err.retryAfterMs = check.retryAfterMs || 0;
    err.cause = check.error || null;
    return err;
  }

  async init() {
    const check = await this.http.checkSession();
    if (check.state !== "ok") throw this._sessionError(check);
    try {
      const res = await this.http.get(EP.CURRENT_USER);
      const user = typeof res === "object" ? res?.user : null;
      if (user?.pk) {
        this.userID = String(user.pk);
        this.username = user.username || null;
      }
    } catch (_) {
      // The API endpoint can return HTML; the session cookie already carries the id.
    }
    try {
      await this.http.bootstrapTokens();
    } catch (_) {
      // GraphQL tokens are only needed for sending; polling still works without them.
    }
    // EP.CURRENT_USER 302s to the login page for a web session, so the handle is
    // usually still unknown here. The home shell Instagram server-renders embeds
    // the viewer's own profile, which fills it in without another rate-limited call.
    if (!this.username && this.userID) {
      try {
        const selfProfile = await this.user.getProfile(this.userID);
        if (selfProfile?.username) this.username = selfProfile.username;
      } catch (_) {
        // A missing handle is cosmetic; the id from the cookie is enough.
      }
    }
    return { userID: this.userID, username: this.username };
  }

  getCurrentUserID() {
    return this.userID;
  }

  sendMessage(text, threadID, replyToItemId = null) {
    return this.message.send(text, threadID, replyToItemId);
  }

  replyToMessage(threadID, text, replyToItemId = null) {
    return this.message.reply(threadID, text, replyToItemId);
  }

  sendLink(threadID, link, text) {
    return this.message.sendLink(threadID, link, text);
  }

  unsendMessage(threadID, itemID) {
    return this.message.unsend(threadID, itemID);
  }

  editMessage(threadID, itemID, text) {
    return this.message.edit(threadID, itemID, text);
  }

  sendReaction(threadID, itemID, emoji) {
    return this.reaction.send(threadID, itemID, emoji);
  }

  removeReaction(threadID, itemID) {
    return this.reaction.remove(threadID, itemID);
  }

  startTyping(threadID) {
    return this.typing.start(threadID);
  }

  stopTyping(threadID) {
    return this.typing.stop(threadID);
  }

  getThreadInfo(threadID) {
    return this.thread.getInfo(threadID);
  }

  getThreadHistory(threadID, limit, beforeTimestamp) {
    return this.thread.getHistory(threadID, limit, beforeTimestamp);
  }

  markThreadSeen(threadID, itemID) {
    return this.thread.markSeen(threadID, itemID);
  }

  muteThread(threadID) {
    return this.thread.mute(threadID);
  }

  unmuteThread(threadID) {
    return this.thread.unmute(threadID);
  }

  hideThread(threadID) {
    return this.thread.hide(threadID);
  }

  addUserToGroup(threadID, userID) {
    return this.thread.addUsers(threadID, [userID]);
  }

  removeUserFromGroup(threadID, userID) {
    return this.thread.removeUser(threadID, userID);
  }

  getUserInfo(userID) {
    return this.user.getInfo(userID);
  }

  getUserInfoByUsername(username) {
    return this.user.getInfoByUsername(username);
  }

  searchUsers(query, limit) {
    return this.user.search(query, limit);
  }

  // Full profile (id or @handle) merged from every source a web session can
  // read. Logout-safe: never throws, returns null when nothing resolves.
  getUserProfile(idOrUsername, opts) {
    return this.user.getProfile(idOrUsername, opts);
  }

  // The best available profile-picture URL. `opts.size` resizes via the CDN.
  async getProfilePicture(idOrUsername, opts = {}) {
    const profile = await this.user.getProfile(idOrUsername);
    const url = profile?.profilePicUrlHd || profile?.profilePicUrl || null;
    if (!url) return null;
    const { profilePictureAtSize } = require("./profileParse");
    return opts && opts.size ? profilePictureAtSize(url, opts.size) : url;
  }

  sendPhoto(threadID, filePath, options) {
    return this.media.sendPhoto(threadID, filePath, options);
  }

  sendPhotoBuffer(threadID, buffer, options) {
    return this.media.sendPhotoBuffer(threadID, buffer, options);
  }

  sendPhotoFromUrl(threadID, url, options) {
    return this.media.sendPhotoFromUrl(threadID, url, options);
  }

  sendVideo(threadID, filePath, options) {
    return this.media.sendVideo(threadID, filePath, options);
  }

  sendVideoBuffer(threadID, buffer, options) {
    return this.media.sendVideoBuffer(threadID, buffer, options);
  }

  sendVideoFromUrl(threadID, url, options) {
    return this.media.sendVideoFromUrl(threadID, url, options);
  }

  sendVoice(threadID, filePath, options) {
    return this.media.sendVoice(threadID, filePath, options);
  }

  sendVoiceBuffer(threadID, buffer, options) {
    return this.media.sendVoiceBuffer(threadID, buffer, options);
  }

  sendVoiceFromUrl(threadID, url, options) {
    return this.media.sendVoiceFromUrl(threadID, url, options);
  }

  getInbox(cursor) {
    return this.inbox.getInbox(cursor);
  }

  // internal thread_id -> inbox thread id, learned from every inbox snapshot.
  getThreadIdMap() {
    return this.inbox.getThreadIdMap();
  }

  listen(callback, intervalMs) {
    return this.inbox.listen(callback, intervalMs || this.options.pollInterval);
  }

  stopListening() {
    this.inbox.stopListening();
  }

  // ------------------------------------------------------------- realtime
  // A standalone MQTT (realtime) connection, for callers that want raw push
  // events (typing/seen/presence) or to drive their own dispatch, rather than
  // the inbox callback listen() wires up. listen({ realtime: true }) uses the
  // same RealtimeClient under the hood.
  _realtimeContext() {
    return {
      sessionid: this.http.getCookie("sessionid"),
      userId: this.userID,
      deviceId: this.identity.deviceId,
      uuid: this.identity.uuid
    };
  }

  realtimeClient(options = {}) {
    const { RealtimeClient } = require("./realtime/client");
    return new RealtimeClient(this._realtimeContext(), options);
  }

  async realtimeConnect(options = {}) {
    return this.sharedRealtimeClient(options);
  }

  // The one MQTT client a session may keep open. Instagram's broker routes the
  // Direct message-sync stream to a single subscriber per device id, so a second
  // connection with the same id silently takes the stream away from the first —
  // the "connects but receives nothing" deafness. Every internal consumer
  // (listen(), the reaction push) shares this client instead of dialing its own.
  // Reuse the session client across socket drops; its transport resets on
  // reconnect, preserving event handlers. Concurrent callers (the listener and
  // watcher starting together) share one connect().
  async sharedRealtimeClient(options = {}) {
    if (this._realtime && this._realtime.connected) return this._realtime;
    if (this._realtimeConnecting) return this._realtimeConnecting;
    // Reuse a previously created client when it has dropped: transport.reset()
    // now safely closes stale sockets, and reusing preserves listeners already
    // attached by realtimeOn().
    const client = this._realtime || this.realtimeClient(options);
    this._realtime = client;
    for (const entry of this._realtimeHandlers || []) {
      if (typeof client.listeners !== "function" || !client.listeners(entry.event).includes(entry.handler)) {
        client.on(entry.event, entry.handler);
      }
    }
    let connecting;
    connecting = (async () => {
      try {
        await client.connect();
        return client;
      } finally {
        // An older cancelled attempt must not clear a newer reconnect promise.
        if (this._realtimeConnecting === connecting) this._realtimeConnecting = null;
      }
    })();
    this._realtimeConnecting = connecting;
    return connecting;
  }

  realtimeOn(event, handler) {
    if (typeof handler !== "function") throw new TypeError("realtimeOn: handler must be a function");
    if (!this._realtimeHandlers) this._realtimeHandlers = [];
    this._realtimeHandlers.push({ event, handler });
    if (this._realtime) this._realtime.on(event, handler);
    return this;
  }

  // Subscribes the connected realtime client to the Direct message-sync stream,
  // reading the cursor (seq_id/snapshot_at_ms) from the inbox query.
  async realtimeSubscribe() {
    if (!this._realtime) throw new Error("realtimeSubscribe: call realtimeConnect() first");
    const state = await this.inbox.fetchRealtimeState();
    if (!state) throw new Error("realtimeSubscribe: Instagram did not return a realtime sync cursor");
    await this._realtime.irisSubscribe(state.seqId, state.snapshotAtMs);
    return state;
  }

  async realtimePing() {
    if (!this._realtime) throw new Error("realtimePing: call realtimeConnect() first");
    return this._realtime.ping();
  }

  realtimeDisconnect() {
    const client = this._realtime;
    // Detach the pending promise immediately so a caller can start a fresh
    // connection without waiting for a cancelled TLS handshake to settle.
    this._realtime = null;
    this._realtimeConnecting = null;
    if (client) client.disconnect();
  }
}

module.exports = InstaAPI;
