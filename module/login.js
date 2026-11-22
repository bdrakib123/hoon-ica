/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// Classic FCA-style entry point: login(credentials, [options], [callback]).
// Returns a ready native client (InstaAPI) with its FCA-shaped surface attached.

const InstaAPI = require("../src/api");
const { normalizeCookie } = require("../src/cookies");

// Accepts a sessionid string, a "k=v; k=v" cookie string, a cookie object, a
// browser cookie array, or { appState | Cookie | cookie | sessionid }.
function extractCookie(credentials) {
  if (typeof credentials === "string") return credentials;
  if (Array.isArray(credentials)) return JSON.stringify(credentials);
  if (credentials && typeof credentials === "object") {
    const candidate =
      credentials.appState ||
      credentials.Cookie ||
      credentials.cookie ||
      credentials.sessionid ||
      credentials.sessionId;
    if (Array.isArray(candidate)) return JSON.stringify(candidate);
    if (typeof candidate === "string") return candidate;
    // A raw cookie map { sessionid: "...", csrftoken: "..." }.
    if (credentials.sessionid) return normalizeCookie(credentials);
  }
  return credentials;
}

function login(credentials, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  options = options || {};

  const cookie = extractCookie(credentials);

  const promise = (async () => {
    if (!cookie) throw new Error("login: no Instagram session cookie supplied");
    const api = new InstaAPI(cookie, options);
    await api.init();
    return api;
  })();

  if (typeof callback === "function") {
    promise.then((api) => callback(null, api), (err) => callback(err, null));
    return undefined;
  }
  return promise;
}

module.exports = login;
