/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const { DOC_ID } = require("../constants");
const { textOf, attachmentsFromContent, normalizeRepliedMessage } = require("../messageContent");
const { fetchThreadDetail, threadFbidMap } = require("../threadDetail");
const { classify, toIgError } = require("../utils/errors");
const { globalAntiSuspension } = require("../utils/antiSuspension");
const { setBounded } = require("../utils/boundedMap");

// Reads the DM inbox through the same Relay query the web client uses
// (PolarisDirectInboxQuery). The old /api/v1/direct_v2/inbox/ endpoint is dead
// (404) — Instagram moved the web DM inbox to GraphQL.
const INBOX_PAGINATION_VARIABLES = {
  __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider: true,
  __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider: 5,
  __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider: true
};

const INBOX_VARIABLES = {
  __relay_internal__pv__IGDIsProfessionalAccountGKrelayprovider: false,
  __relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider: true,
  __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider: 5,
  __relay_internal__pv__IGDThreadListActionsEnabledGKrelayprovider: true
};

const SKIP_TYPES = new Set(["like", "action_log", "video_call_event", "reaction_log"]);

function isUsableThread(thread) {
  if (!thread || typeof thread !== "object") return false;
  return [thread.id, thread.thread_id].some((value) => value != null && String(value).trim() !== "");
}

function isUsableMessage(message) {
  if (!message || typeof message !== "object") return false;
  return [message.id, message.item_id, message.message_id].some(
    (value) => value != null && String(value).trim() !== ""
  );
}

class InboxMethods {
  constructor(http, getUserID, options = {}) {
    this.http = http;
    this.getUserID = getUserID;
    // The device identity (deviceId/uuid) the realtime MQTT connection needs.
    this.identity = options.identity || {};
    // { enabled, fallback } — realtime is opt-in via listen(); see listen().
    this.realtimeOptions = options.realtime || null;
    // Returns the session's single shared MQTT client (see InstaAPI). When
    // present, listen() rides that connection instead of dialing its own, so a
    // second consumer cannot steal the Direct stream from it.
    this.getSharedClient = typeof options.getSharedClient === "function" ? options.getSharedClient : null;
    // true = deliver the session's own outbound messages on the event stream
    // (FCA's selfListen); false (default) = drop them. Only the self filter
    // below honours it; reactions and admin logs are still skipped.
    this.selfListen = options.selfListen === true;
    // Lowest poll interval listen() will honour, in ms. Instagram has no DM
    // push, so reply latency is bounded by one poll cycle. The 15000 default is
    // the conservative safe floor for a personal account; operators on a
    // residential/mobile proxy can lower it (e.g. 2000) for snappier replies.
    this.minPollIntervalMs = Math.max(2000, Number(options.minPollIntervalMs) || 15000);
    this._seen = new Map();
    this._threadIdMap = new Map();
    this._pollTimer = null;
    this._selfFbid = null;
    // threadID -> participant igids from the latest inbox snapshot. The inbox
    // event carries no participant list, so the FCA layer reads it from here to
    // fill event.participantIDs for commands ported from Facebook (all, ban).
    this._members = new Map();
    // threadID -> { title, image, members:Set, adminIDs:Set, nicknames:{} }
    this._threadState = new Map();
    this._statePrimed = false;
  }

  async getInbox(cursor = null) {
    let data;
    let pageInfo;

    // A pagination cursor is scoped to the mailbox. If this client has not
    // fetched the inbox yet (for example after a process restart), bootstrap
    // once to recover the mailbox id before requesting the requested page.
    if (cursor && this._mailboxId) {
      const res = await this.http.postGraphQL(
        "IGDThreadListOffMsysPaginationQuery",
        DOC_ID.INBOX_PAGINATION,
        { id: this._mailboxId, cursor, count: 15, folder: "INBOX", newer_than_timestamp_ms: null, ...INBOX_PAGINATION_VARIABLES },
        "https://www.instagram.com/direct/inbox/"
      );
      data = this._unwrap(res);
      const connection = data?.fetch__SlideMailbox?.threads_by_folder;
      pageInfo = connection?.page_info || null;
      const edges = Array.isArray(connection?.edges) ? connection.edges : [];
      const threads = edges.map((e) => e?.node?.as_ig_direct_thread).filter(isUsableThread);
      this._rememberInboxThreads(threads);
      return {
        threads,
        nextCursor: pageInfo?.has_next_page ? (pageInfo.end_cursor || null) : null,
        hasNextPage: pageInfo?.has_next_page === true
      };
    }

    // device_id_for_iris_subscription is required by the first-page query;
    // the web client sends the same value it uses as __hsi.
    const deviceID = this.http.session?.__hsi || this.http.uuid();
    const res = await this.http.postGraphQL(
      "PolarisDirectInboxQuery",
      DOC_ID.INBOX,
      { ...INBOX_VARIABLES, device_id_for_iris_subscription: deviceID },
      "https://www.instagram.com/direct/inbox/"
    );
    data = this._unwrap(res);
    const mailbox = data?.get_slide_mailbox_for_iris_subscription;
    this._mailboxId = mailbox?.id != null ? String(mailbox.id) : null;
    const connection = mailbox?.threads_by_folder;
    pageInfo = connection?.page_info || null;
    let threads = (Array.isArray(connection?.edges) ? connection.edges : [])
      .map((e) => e?.node?.as_ig_direct_thread)
      .filter(isUsableThread);

    // If a caller supplies a cursor before this instance has learned the
    // mailbox id, use the bootstrap response only to resolve that id and then
    // fetch the requested page rather than silently returning page one.
    if (cursor && this._mailboxId) {
      const page = await this.http.postGraphQL(
        "IGDThreadListOffMsysPaginationQuery",
        DOC_ID.INBOX_PAGINATION,
        { id: this._mailboxId, cursor, count: 15, folder: "INBOX", newer_than_timestamp_ms: null, ...INBOX_PAGINATION_VARIABLES },
        "https://www.instagram.com/direct/inbox/"
      );
      data = this._unwrap(page);
      const pagedConnection = data?.fetch__SlideMailbox?.threads_by_folder;
      pageInfo = pagedConnection?.page_info || null;
      threads = (Array.isArray(pagedConnection?.edges) ? pagedConnection.edges : [])
        .map((e) => e?.node?.as_ig_direct_thread)
        .filter(isUsableThread);
    }

    this._rememberInboxThreads(threads);
    return {
      threads,
      nextCursor: pageInfo?.has_next_page ? (pageInfo.end_cursor || null) : null,
      hasNextPage: pageInfo?.has_next_page === true
    };
  }

  _rememberInboxThreads(threads) {
    for (const t of threads) {
      const fbid = t.viewer?.interop_messaging_user_fbid;
      if (fbid && !this._selfFbid) this._selfFbid = String(fbid);
    }
    for (const t of threads) {
      const tid = String(t.id || t.thread_id);
      if (tid) {
        const users = (Array.isArray(t.users) ? t.users : []).filter((u) => u && typeof u === "object");
        setBounded(this._members, tid, users.map((u) => String(u.id || u.pk || "")).filter(Boolean), 2000);
      }
    }
    this._learnThreadIds(threads);
  }

  // The realtime push names a thread by its internal `thread_id` (e.g.
  // 340282366841710301244259277549563001902) while the poller, the thread-detail
  // read and the frozen commands all use the inbox id (e.g. 1102531985914926).
  // Learn the mapping from every inbox snapshot so the listener can hand the rest
  // of the bot one consistent thread id.
  _learnThreadIds(threads) {
    for (const t of threads) {
      const internal = t.thread_id != null ? String(t.thread_id) : null;
      const inbox = t.id != null ? String(t.id) : (t.thread_fbid != null ? String(t.thread_fbid) : null);
      if (internal && inbox) setBounded(this._threadIdMap, internal, inbox, 2000);
    }
  }

  // internal thread_id -> inbox thread id, from the latest inbox snapshot.
  getThreadIdMap() {
    return new Map(this._threadIdMap);
  }

  // Participant igids for a thread, from the latest inbox snapshot.
  getThreadMemberIDs(threadID) {
    const members = this._members.get(String(threadID));
    return Array.isArray(members) ? members.slice() : [];
  }

  // The Polaris inbox returns messages under thread.slide_messages as a Relay
  // connection ({ edges: [{ node }] }); the node carries sender_fbid,
  // content_type, text_body and content. Older captures used thread.items, so
  // both shapes are accepted.
  _threadMessages(thread) {
    const sm = thread.slide_messages;
    if (Array.isArray(sm)) return sm.map((n) => n?.node || n).filter(isUsableMessage);
    if (sm && Array.isArray(sm.edges)) return sm.edges.map((e) => e?.node).filter(isUsableMessage);
    return (Array.isArray(thread.items) ? thread.items : [])
      .filter(isUsableMessage)
      .map((i) => ({
        id: i.item_id || i.id || i.message_id,
        sender_fbid: i.user_id,
        content_type: (i.item_type || "text").toUpperCase(),
        text_body: i.text,
        timestamp_ms: i.timestamp,
        content: i
      }));
  }

  _contentToText(node) {
    return textOf(node);
  }

  _contentToAttachments(node) {
    return attachmentsFromContent(node.content);
  }

  _fbidMap(thread) {
    return threadFbidMap(thread);
  }

  async _extractEvents(threads) {
    const events = [];
    const selfFbid = this._selfFbid ? String(this._selfFbid) : null;

    for (const thread of threads) {
      const threadID = String(thread.id || thread.thread_id);
      const fbidToIgid = this._fbidMap(thread);

      const nodes = this._threadMessages(thread); // newest-first
      const lastSeenID = this._seen.get(threadID);
      const fresh = [];
      for (const node of nodes) {
        if (lastSeenID && String(node.id) === String(lastSeenID)) break;
        fresh.push(node);
      }

      // The inbox query does not project reply linkage; the thread-detail query
      // does. Fetch it once and index by message id so reply targets resolve.
      let replyById = null;
      if (fresh.length) {
        replyById = await this.fetchReplies(threadID, fbidToIgid).catch(() => null);
      }

      for (const node of fresh.reverse()) {
        const rawSender = node.sender_fbid != null ? String(node.sender_fbid) : null;
        if (!this.selfListen && rawSender && selfFbid && rawSender === selfFbid) continue;

        const ctype = node.content_type || "";
        if (/REACTION_LOG|ADMIN_TEXT|ACTION_LOG/i.test(ctype)) continue;

        const body = this._contentToText(node);
        const attachments = ctype === "TEXT" ? [] : this._contentToAttachments(node);
        // Media whose CDN url we could not parse is not actionable; drop it.
        // But Instagram types a URL-bearing DM as MESSAGE_INLINE_SHARE (XMA),
        // not TEXT, while the user's message — the command included — is still
        // in text_body/xma_text_body. Dropping those left every URL command
        // (e.g. `/cmd install x.js <url>`) unanswered, so keep any non-TEXT node
        // that actually carries text.
        const hasText = String(body).trim() !== "";
        if (ctype !== "TEXT" && !hasText && attachments.length === 0) continue;
        const itemType = ctype === "TEXT" || hasText ? "text" : ctype.toLowerCase();

        const detail = replyById && replyById[String(node.id)];
        events.push({
          type: "message",
          threadID,
          senderID: rawSender && fbidToIgid[rawSender] ? fbidToIgid[rawSender] : rawSender,
          messageID: node.id,
          body,
          attachments,
          itemType,
          repliedToItemId: (detail && detail.repliedToItemId) || node.replied_to_item_id || null,
          repliedToMessage: detail ? detail.repliedToMessage : null,
          clientContext: node.client_context || null,
          // The inbox query does not project offline_threading_id; the thread
          // detail does. It doubles as the reply target's client_context.
          offlineThreadingId: (detail && detail.offlineThreadingId) || node.offline_threading_id || null,
          timestamp: Number(node.timestamp_ms) || Date.now()
        });
      }

      if (nodes[0]) setBounded(this._seen, threadID, nodes[0].id, 5000);
    }
    return events;
  }

  // Runs IGDThreadDetailQuery and returns { <messageID>: { repliedToItemId,
  // repliedToMessage, offlineThreadingId } } for every message in the thread.
  // The inbox node lacks reply linkage and offline_threading_id, so both are
  // taken from here; offline_threading_id is the client_context a quote-reply
  // to that item needs.
  async fetchReplies(threadID, fbidToIgid = {}) {
    const thread = await fetchThreadDetail(this.http, threadID, 20);
    const out = {};
    for (const e of (Array.isArray(thread?.slide_messages?.edges) ? thread.slide_messages.edges : [])) {
      const n = e?.node || e;
      if (!isUsableMessage(n)) continue;
      out[String(n.id || n.item_id || n.message_id)] = {
        repliedToItemId: n.replied_to_message_id || null,
        repliedToMessage: normalizeRepliedMessage(n.replied_to_message, fbidToIgid),
        offlineThreadingId: n.offline_threading_id != null ? String(n.offline_threading_id) : null
      };
    }
    return out;
  }

  // Builds the thread-state fingerprint used to synthesize GoatBot system
  // events: participants, title, image, admins and nicknames. Instagram's
  // polling inbox reports none of these as discrete events, so the poller
  // diffs consecutive snapshots instead.
  _snapshot(thread) {
    const users = (Array.isArray(thread.users) ? thread.users : []).filter((u) => u && typeof u === "object");
    const members = new Set();
    const names = {};
    for (const u of users) {
      const rawId = u.id || u.pk;
      if (rawId == null || String(rawId).trim() === "") continue;
      const id = String(rawId);
      members.add(id);
      names[id] = u.full_name || u.username || id;
    }
    // Instagram's inbox reports nicknames as a positional list of
    // { nickname, igid, eimu_id } objects (keyed "0","1",… when serialized),
    // not as an { participantId: nickname } map. Reduce it to the latter so the
    // diff compares plain strings; otherwise each poll yields a spurious
    // log:user-nickname event (the parcel object is a fresh reference every
    // time and "0" is not a participant id).
    const nicknames = {};
    const rawNick = thread.nicknames;
    const entries = Array.isArray(rawNick) ? rawNick : Object.values(rawNick || {});
    for (const entry of entries) {
      if (entry == null) continue;
      if (typeof entry === "string") continue; // map form handled below
      const pid = String(entry.igid || entry.pk || entry.user_id || entry.participant_id || "");
      const nick = typeof entry.nickname === "string" ? entry.nickname : entry.nickname?.nickname || null;
      if (pid && pid !== "0" && nick) nicknames[pid] = nick;
    }
    // Also accept the plain { participantId: nickname } map shape.
    for (const [k, v] of Object.entries(rawNick || {})) {
      if (typeof v === "string" && v && /^\d+$/.test(k)) nicknames[String(k)] = v;
    }
    return {
      title: thread.thread_title || null,
      image: thread.thread_image_url || null,
      isGroup: !!thread.is_group,
      members,
      names,
      adminIDs: new Set((Array.isArray(thread.admin_user_ids) ? thread.admin_user_ids : []).map(String)),
      nicknames,
      threadID: String(thread.id || thread.thread_id)
    };
  }

  // Diffs a thread against its cached snapshot and returns fca-shaped system
  // events. `author` is unknown over the poll API, so callers treat it as empty.
  _diffThread(prev, next) {
    const events = [];
    const base = {
      type: "event",
      threadID: next.threadID,
      author: "",
      participantIDs: [...next.members],
      isGroup: next.isGroup,
      timestamp: Date.now()
    };
    const id = () => `evt.${next.threadID}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

    if (prev.isGroup && next.isGroup) {
      const added = [...next.members].filter((m) => !prev.members.has(m));
      const left = [...prev.members].filter((m) => !next.members.has(m));
      if (added.length) {
        events.push({
          ...base,
          messageID: id(),
          logMessageType: "log:subscribe",
          logMessageData: {
            addedParticipants: added.map((uid) => ({
              userFbId: uid,
              fullName: next.names[uid] || uid,
              firstName: (next.names[uid] || "").split(" ")[0] || uid
            }))
          }
        });
      }
      for (const uid of left) {
        events.push({
          ...base,
          messageID: id(),
          logMessageType: "log:unsubscribe",
          logMessageData: { leftParticipantFbId: uid }
        });
      }
      const addedAdmins = [...next.adminIDs].filter((a) => !prev.adminIDs.has(a));
      const removedAdmins = [...prev.adminIDs].filter((a) => !next.adminIDs.has(a));
      for (const uid of addedAdmins) {
        events.push({ ...base, messageID: id(), logMessageType: "log:thread-admins", logMessageData: { ADMIN_EVENT: "add_admin", TARGET_ID: uid } });
      }
      for (const uid of removedAdmins) {
        events.push({ ...base, messageID: id(), logMessageType: "log:thread-admins", logMessageData: { ADMIN_EVENT: "remove_admin", TARGET_ID: uid } });
      }
      for (const uid of Object.keys(next.nicknames)) {
        if (prev.nicknames[uid] !== next.nicknames[uid]) {
          events.push({ ...base, messageID: id(), logMessageType: "log:user-nickname", logMessageData: { participant_id: uid, nickname: next.nicknames[uid] } });
        }
      }
    }
    if (prev.title !== next.title) {
      events.push({ ...base, messageID: id(), logMessageType: "log:thread-name", logMessageData: { name: next.title } });
    }
    if (prev.image !== next.image) {
      events.push({ ...base, messageID: id(), logMessageType: "log:thread-image", logMessageData: { url: next.image } });
    }
    return events;
  }

  // The inbox payload's ADD_PARTICIPANT_XMAT / REMOVE_PARTICIPANT_XMAT nodes
  // carry only a typename; the actor (who added/removed) and the target username
  // live in the thread-detail text_fragments, and the actor's id is the node's
  // sender_fbid. Synthesized log:subscribe/log:unsubscribe events have no author
  // of their own, so resolve the most recent add/remove actor here to fill it —
  // welcome.js renders it as the "added by" avatar + name.
  async _latestActor(threadID) {
    const thread = await fetchThreadDetail(this.http, threadID, 20).catch(() => null);
    if (!thread) return {};
    const map = threadFbidMap(thread);
    const byId = {};
    for (const u of (Array.isArray(thread.users) ? thread.users : []).filter((entry) => entry && typeof entry === "object")) {
      const id = String(u.id || u.pk || "");
      if (id) byId[id] = u;
    }
    const nodes = (Array.isArray(thread.slide_messages?.edges) ? thread.slide_messages.edges : [])
      .map((e) => e?.node || e)
      .filter(isUsableMessage);
    const out = {};
    for (const n of nodes) {
      const ct = String(n.content_type || "");
      const isAdd = /ADD_PARTICIPANT_XMAT/i.test(ct);
      const isRemove = /REMOVE_PARTICIPANT_XMAT/i.test(ct);
      if ((!isAdd && !isRemove) || (isAdd && out.add) || (isRemove && out.remove)) continue;
      const raw = n.sender_fbid != null ? String(n.sender_fbid) : null;
      const actorID = raw && map[raw] ? map[raw] : raw || "";
      const u = byId[actorID] || {};
      const frags = n.content?.text_fragments || [];
      const entry = {
        actorID,
        actorName: u.full_name || u.username || frags[0]?.plaintext || null,
        targetName: frags.length ? frags[frags.length - 1].plaintext : null
      };
      if (isAdd) out.add = entry;
      else out.remove = entry;
    }
    return out;
  }

  // Starts the realtime (MQTT) listener, falling back to the inbox poller when
  // the broker is unreachable and options.realtime.fallback !== false. Realtime
  // is push (sub-second); the poller is the always-works safety net.
  listen(callback, intervalMs) {
    const rtOpts = this.realtimeOptions;
    if (rtOpts && rtOpts.enabled) {
      const { RealtimeListener } = require("../realtime/listener");
      const allowFallback = rtOpts.fallback !== false;
      let stopped = false;
      let stopPoll = null;
      let fallbackStarted = false;
      const startFallback = () => {
        if (!allowFallback || stopped || fallbackStarted) return;
        fallbackStarted = true;
        stopPoll = this._startPolling(callback, intervalMs);
      };
      const listener = new RealtimeListener(
        {
          sessionid: this.http.getCookie("sessionid"),
          userId: this.getUserID(),
          deviceId: this.identity.deviceId,
          uuid: this.identity.uuid,
          userAgent: rtOpts.userAgent,
          appVersion: rtOpts.appVersion
        },
        {
          host: rtOpts.host,
          transport: rtOpts.transport,
          keepAliveMs: rtOpts.keepAliveMs,
          seqId: rtOpts.seqId,
          snapshotAtMs: rtOpts.snapshotAtMs,
          // Deliver the session's own outbound messages too (FCA selfListen).
          selfListen: this.selfListen,
          getRealtimeState: rtOpts.getRealtimeState || (() => this.fetchRealtimeState()),
          // Share the session's single MQTT connection. A second connection on
          // the same device id steals the Direct stream from the first, so the
          // inbox listener and any other consumer (reaction push) must ride the
          // same client.
          getClient: rtOpts.getClient || (this.getSharedClient ? () => this.getSharedClient() : undefined),
          onReady: rtOpts.onReady,
          onError: (err) => {
            // The current realtime client does not reconnect itself. Any
            // socket error/disconnect therefore makes push delivery unavailable,
            // even if the initial subscription was acknowledged. Keep polling as
            // the safety net for the rest of this listen() lifetime.
            if (allowFallback && !stopped) {
              startFallback();
            } else {
              callback(err, null);
            }
          }
        }
      );
      listener.start(callback).catch((err) => {
        listener.stop();
        if (allowFallback && !stopped) startFallback();
        else callback(err, null);
      });
      const stop = () => {
        stopped = true;
        listener.stop();
        if (stopPoll) stopPoll();
      };
      this._realtimeListener = listener;
      this._stopListen = stop;
      return stop;
    }
    this._stopListen = this._startPolling(callback, intervalMs);
    return this._stopListen;
  }

  // Runs the inbox poller as an independent stream, for a caller that uses
  // realtime push as the primary path and wants a polling safety net beneath it
  // (the broker can connect, subscribe, and then silently stop delivering). The
  // poller keeps its own cursor and its own rate-limit backoff, so a 429 here
  // does not disturb the push path. Returns a stop function. The caller is
  // expected to dedupe events that both sources deliver.
  startSafetyPoll(callback, intervalMs) {
    return this._startPolling(callback, intervalMs);
  }

  // The iris (Direct message-sync) subscription cursor: seq_id + snapshot time.
  // Read from the inbox query when it exposes them; otherwise the listener
  // connects without a subscription (a live message still opens the stream).
  async fetchRealtimeState() {
    try {
      const res = await this.http.postGraphQL(
        "PolarisDirectInboxQuery",
        DOC_ID.INBOX,
        { ...INBOX_VARIABLES, device_id_for_iris_subscription: this.http.session?.__hsi || this.http.uuid() },
        "https://www.instagram.com/direct/inbox/"
      );
      const box = res?.data?.get_slide_mailbox_for_iris_subscription || {};
      const seqId = box.iris_inactive_subscription_uq_seq_id;
      if (seqId == null) return null;
      return { seqId: Number(seqId), snapshotAtMs: Date.now() };
    } catch (_) {
      return null;
    }
  }

  _startPolling(callback, intervalMs = 20000) {
    const MIN_INTERVAL_MS = this.minPollIntervalMs;
    const BASE_INTERVAL_MS = Math.max(Number(intervalMs) || 20000, MIN_INTERVAL_MS);
    const BACKOFF_START_MS = 30000;
    const BACKOFF_MAX_MS = 10 * 60 * 1000;
    const TRANSIENT_MAX_MS = 5 * 60 * 1000;
    const BLOCKED_WAIT_MS = 15 * 60 * 1000;
    const AUTH_RECHECK_MS = 60 * 1000;
    const AUTH_CONFIRMATIONS = 2;

    let stopped = false;
    let polling = false;
    let timer = null;
    let backoff = BACKOFF_START_MS;
    let authFailures = 0;
    let transientStreak = 0;

    const jittered = (ms) => Math.round(ms * (0.8 + Math.random() * 0.5));
    const pollDelay = () => jittered(BASE_INTERVAL_MS * (globalAntiSuspension.isCoolingDown() ? 3 : 1));

    const schedule = (delayMs) => {
      if (stopped) return;
      timer = setTimeout(tick, delayMs);
      if (timer.unref) timer.unref();
    };

    const tick = async () => {
      if (polling || stopped) return;
      polling = true;
      try {
        const { threads } = await this.getInbox();
        // stopListening() may be called while the network request is in flight.
        // Do not dispatch stale events or schedule another poll after stop.
        if (stopped) return;

        const wasBackingOff = backoff !== BACKOFF_START_MS;
        backoff = BACKOFF_START_MS;
        authFailures = 0;
        transientStreak = 0;

        const state = new Map();
        for (const t of threads) state.set(String(t.id || t.thread_id), this._snapshot(t));

        if (!this._statePrimed) {
          for (const t of threads) {
            const tid = String(t.id || t.thread_id);
            const first = this._threadMessages(t)[0];
            if (first) setBounded(this._seen, tid, first.id, 5000);
          }
          this._threadState = state;
          this._statePrimed = true;
          schedule(pollDelay());
          return;
        }

        const extractedEvents = await this._extractEvents(threads);
        if (stopped) return;
        for (const event of extractedEvents) {
          if (stopped) return;
          callback(null, event);
        }

        if (this._statePrimed) {
          for (const [tid, snap] of state) {
            const prev = this._threadState.get(tid);
            if (!prev) continue;
            const diff = this._diffThread(prev, snap);
            if (diff.some((e) => e.logMessageType === "log:subscribe" || e.logMessageType === "log:unsubscribe")) {
              const actors = await this._latestActor(tid);
              if (stopped) return;
              for (const e of diff) {
                const a = e.logMessageType === "log:unsubscribe" ? actors.remove : actors.add;
                if (!a) continue;
                e.author = a.actorID || e.author;
                e.logMessageData = { ...e.logMessageData, actorName: a.actorName, targetName: a.targetName };
                if (a.actorID && a.actorName) {
                  try { await global.db.usersData.set(a.actorID, { name: a.actorName }); } catch (_) {}
                }
              }
            }
            for (const evt of diff) {
              if (stopped) return;
              callback(null, evt);
            }
          }
        }
        this._threadState = state;
        if (wasBackingOff) {
          try { this._emitter && this._emitter.emit && this._emitter.emit("reconnected"); } catch (_) {}
        }
        schedule(pollDelay());
      } catch (error) {
        if (stopped) return;
        const kind = error.igKind || classify(error).kind;

        if (kind === "challenge" || kind === "suspended") {
          stopped = true;
          callback(toIgError(error, { kind }), null);
          return;
        }

        if (kind === "auth") {
          authFailures += 1;
          if (authFailures >= AUTH_CONFIRMATIONS) {
            const check = await this.http.checkSession({ attempts: 1 });
            if (check.state === "ok" || check.state === "transient" || check.state === "rate_limited") {
              authFailures = 0;
              schedule(pollDelay());
              return;
            }
            stopped = true;
            callback(check.error || toIgError(error, { kind: check.state === "auth" ? "auth" : check.state }), null);
            return;
          }
          schedule(jittered(AUTH_RECHECK_MS));
          return;
        }

        if (kind === "rate_limited") {
          const wait = Math.min(backoff, BACKOFF_MAX_MS);
          backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
          try { this._emitter && this._emitter.emit && this._emitter.emit("rateLimit", { wait }); } catch (_) {}
          callback(error, null);
          schedule(jittered(wait));
          return;
        }

        if (kind === "blocked") {
          try { this._emitter && this._emitter.emit && this._emitter.emit("rateLimit", { wait: BLOCKED_WAIT_MS }); } catch (_) {}
          callback(error, null);
          schedule(jittered(BLOCKED_WAIT_MS));
          return;
        }

        if (kind === "transient") {
          transientStreak += 1;
          const wait = Math.min(BASE_INTERVAL_MS * 2 ** Math.min(transientStreak, 4), TRANSIENT_MAX_MS);
          callback(error, null);
          schedule(jittered(wait));
          return;
        }

        callback(error, null);
        schedule(pollDelay());
      } finally {
        polling = false;
      }
    };

    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }

  // GraphQL responses are JSON prefixed with "for (;;);".
  _unwrap(res) {
    if (res && typeof res === "object") return res.data || res;
    const cleaned = String(res).replace(/^for \(;;\);/, "");
    try {
      return JSON.parse(cleaned).data;
    } catch (_) {
      return null;
    }
  }

  stopListening() {
    if (typeof this._stopListen === "function") this._stopListen();
    this._stopListen = null;
    if (this._pollTimer) clearInterval(this._pollTimer);
  }
}

module.exports = InboxMethods;
