/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

const { EP, WEB, DOC_ID } = require("../constants");
const { parseProfilePage, normalizeWebProfileInfo, normalizeGraphqlUser, normalizeInboxUser, normalize } = require("../profileParse");

// A small cache so a profile fetched once (from whichever source answered) is
// reused instead of re-hit, and a per-user failure is not retried in a tight
// loop. Instagram rate-limits profile reads aggressively for web sessions.
const CACHE_TTL_MS = 10 * 60 * 1000;
const PROFILE_CACHE_MAX = 2000;
const { setBounded } = require("../utils/boundedMap");

class UserMethods {
  constructor(http, getSelf, getLearned) {
    this.http = http;
    // Resolves the logged-in account ({ id, username }) so a profile lookup by
    // the bot's own id can find its handle without a rate-limited REST call.
    this.getSelf = typeof getSelf === "function" ? getSelf : null;
    // Returns a raw user record already seen in the inbox/thread views for a pk,
    // interop fbid or @handle — the offline source that survives rate-limiting.
    this.getLearned = typeof getLearned === "function" ? getLearned : null;
    this._profileCache = new Map(); // key -> { at, value }
  }

  // The id-only lookup. /api/v1/users/<id>/info/ is a REST path Instagram 302s
  // to the login page for a web session (the HTTP layer reads any 3xx as an
  // expired session), so this is best-effort: callers that need a full profile
  // should use getProfile().
  async getInfo(userID) {
    try {
      const res = await this.http.get(EP.USER_INFO(userID));
      return res?.user || null;
    } catch (_) {
      return null;
    }
  }

  async getInfoByUsername(username) {
    // Both endpoints are mobile/web REST paths under /api/v1, which Instagram
    // now answers with a 302 to the login page for a web session (the HTTP
    // layer classifies any 3xx as an auth failure). A username lookup must not
    // leak an auth-classified error — a command reading a handle would then look
    // like a dead session. Return null instead; callers fall back to the users
    // the client already learned from thread introspection.
    try {
      const res = await this.http.get(EP.USER_BY_USERNAME(username));
      if (res?.user) return res.user;
    } catch (_) {}

    try {
      const res = await this.http.get(EP.USER_SEARCH(username, 30));
      const match = (res?.users || []).find(
        (u) => u.username?.toLowerCase() === username.toLowerCase()
      );
      if (match) return match;
    } catch (_) {}

    // web/search/topsearch is the path a logged-in web session actually gets an
    // answer from; the /api/v1 users/* REST paths above are 302'd for web. It
    // returns an exact-match user object (with pk) at users[].user.
    try {
      const res = await this.http.get(EP.TOPSEARCH(username));
      const match = (res?.users || [])
        .map((entry) => entry.user || entry)
        .find((u) => u?.username?.toLowerCase() === username.toLowerCase());
      return match || null;
    } catch (_) {
      return null;
    }
  }

  async search(query, limit = 20) {
    try {
      const res = await this.http.get(EP.USER_SEARCH(query, limit));
      return res?.users || [];
    } catch (_) {
      return [];
    }
  }

  // --------------------------------------------------------------- profiles
  // Full profile for a user id or @handle. Tries every source a web session can
  // actually read, in order, and merges whatever each returns so the result is
  // as complete as Instagram allows:
  //
  //   1. the user record already learned from the inbox/thread views (free, and
  //      the only source that still answers once the profile REST paths 429)
  //   2. web_profile_info REST (canonical: follower/media counts, verified, ...)
  //   3. the logged-in account's own page HTML (bio, hd picture, account flags)
  //
  // Never throws: an id that cannot be resolved returns null, and a source that
  // 302s/429s is simply skipped — a profile lookup must not surface as a dead
  // session.
  async getProfile(idOrUsername, opts = {}) {
    const raw = String(idOrUsername == null ? "" : idOrUsername).trim().replace(/^@/, "");
    if (!raw) return null;
    const byId = /^\d+$/.test(raw);
    const key = (byId ? "id:" : "user:") + raw.toLowerCase();

    const cached = this._profileCache.get(key);
    if (!opts.refresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    let username = byId ? null : raw;
    const parts = [];

    // 0) Whatever the inbox/thread views already told us about this user.
    if (this.getLearned) {
      const learned = this.getLearned(raw);
      if (learned) {
        const norm = normalizeInboxUser(learned);
        if (norm) parts.push(norm);
        if (!username && learned.username) username = learned.username;
      }
    }

    // 1) Canonical REST profile (username only). Also resolves an id -> username.
    if (!username && byId) {
      const self = this.getSelf && this.getSelf();
      if (self && String(self.id) === raw && self.username) {
        // The logged-in account answers offline (the cookie carries its handle).
        username = self.username;
      } else {
        const u = await this.getInfo(raw).catch(() => null);
        if (u?.username) username = u.username;
      }
    }
    if (username) {
      const rest = await this._webProfileInfo(username);
      if (rest) parts.push(rest);
    }

    // 1b) Profile GraphQL (PolarisProfilePageContentQuery). Usually rate-limited
    // (429) for a web session, but when it does answer it carries the richest
    // data: biography, counts, external url and the account flags.
    if (username) {
      const gql = await this._profileFromGraphQL(username);
      if (gql) parts.push(gql);
    }

    // 2) Profile pages Instagram server-renders: the account's own profile and
    // the home/inbox shell both embed the *viewer's* full PolarisViewer blob, so
    // the logged-in account is always resolvable even when REST 302s/429s.
    const self = this.getSelf && this.getSelf();
    const isSelf = !!(self && self.id && String(self.id) === raw);
    if (username) {
      const page = await this._profileFromPage(username);
      if (page) parts.push(page);
    }
    if (isSelf && !parts.some((p) => p && p.username)) {
      const shell = await this._viewerProfileFromShell();
      if (shell) parts.push(shell);
    }

    if (!parts.length) return null;

    const merged = this._mergeProfiles(parts, { id: byId ? raw : null, username });
    const entry = { at: Date.now(), value: merged };
    setBounded(this._profileCache, key, entry, PROFILE_CACHE_MAX);
    if (merged.username) setBounded(this._profileCache, "user:" + merged.username.toLowerCase(), entry, PROFILE_CACHE_MAX);
    if (merged.id) setBounded(this._profileCache, "id:" + merged.id, entry, PROFILE_CACHE_MAX);
    return merged;
  }

  async _webProfileInfo(username) {
    try {
      const res = await this.http.get(EP.WEB_PROFILE_INFO(username));
      const user = res?.data?.user || res?.user;
      return normalizeWebProfileInfo(user);
    } catch (_) {
      return null;
    }
  }

  async _profileFromPage(username) {
    try {
      const res = await this.http.client.get(`${WEB}/${encodeURIComponent(username)}/`, { maxRedirects: 5 });
      return parseProfilePage(typeof res.data === "string" ? res.data : "", username);
    } catch (_) {
      return null;
    }
  }

  // The viewer's own profile, read from the home shell Instagram server-renders
  // for a logged-in session (it embeds the full PolarisViewer blob).
  async _viewerProfileFromShell() {
    try {
      const res = await this.http.client.get(`${WEB}/`, { maxRedirects: 5 });
      return parseProfilePage(typeof res.data === "string" ? res.data : "");
    } catch (_) {
      return null;
    }
  }

  // Profile GraphQL. Best-effort: a 429 / "Rate limit exceeded" / rotated doc_id
  // is swallowed so the caller simply falls through to the next source.
  async _profileFromGraphQL(username) {
    const referer = `${WEB}/${encodeURIComponent(username)}/`;
    const docs = [
      ["PolarisProfilePageContentQuery", DOC_ID.PROFILE_PAGE_CONTENT],
      ["PolarisUserRootQuery", DOC_ID.PROFILE_USER_ROOT]
    ];
    for (const [name, docId] of docs) {
      try {
        const res = await this.http.postGraphQL(name, docId, { username }, referer);
        if (Array.isArray(res?.errors) && res.errors.length) continue;
        const user = res?.data?.user;
        const norm = normalizeGraphqlUser(user);
        if (norm && norm.username) return norm;
      } catch (_) {
        // try the next operation
      }
    }
    return null;
  }

  // Later sources fill only the fields earlier ones left null, so the canonical
  // REST profile wins and the HTML/learned data tops it up.
  _mergeProfiles(parts, fallback) {
    const out = normalize({ id: fallback.id, username: fallback.username });
    for (const part of parts) {
      for (const [k, v] of Object.entries(part)) {
        if (k === "raw") continue;
        const empty = out[k] === null || out[k] === undefined || out[k] === "";
        if (empty && v !== null && v !== undefined && v !== "") out[k] = v;
      }
      for (const flag of ["isVerified", "isPrivate", "isBusinessAccount", "isProfessionalAccount", "hasProfilePic"]) {
        if (part[flag] === true) out[flag] = true;
      }
      if (!out.raw && part.raw) out.raw = part.raw;
    }
    if (!out.id && fallback.id) out.id = String(fallback.id);
    if (!out.pk) out.pk = out.id;
    return out;
  }
}

module.exports = UserMethods;
module.exports.PROFILE_CACHE_MAX = PROFILE_CACHE_MAX;
