/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

"use strict";

const InstaAPI = require("./src/api");
const constants = require("./src/constants");
const { normalizeCookie } = require("./src/cookies");
const { harvestSessionParams, findChromium } = require("./src/session");
const InstaClient = require("./src/app/InstaClient");
const { InstaContext } = require("./src/app/InstaContext");
const { createFcaClient } = require("./src/app/createFcaClient");
const EventNormalizer = require("./src/events/normalizeEvent");
const loadApiMethods = require("./src/app/loadApiMethods");
const moduleLogin = require("./module/login");
const { RealtimeClient } = require("./src/realtime/client");
const { RealtimeListener } = require("./src/realtime/listener");
const AdaptiveRateLimiter = require("./src/utils/adaptiveRateLimiter");
const CircuitBreaker = require("./src/utils/circuitBreaker");
const IdempotencyCache = require("./src/utils/idempotency");
const Scheduler = require("./src/utils/scheduler");
const utilities = Object.freeze({ AdaptiveRateLimiter, CircuitBreaker, IdempotencyCache, Scheduler });

/**
 * Log in to Instagram with a browser cookie / sessionid and return a ready
 * client. Mirrors the classic FCA `login(credentials, callback)` shape so bot
 * projects can swap it in the same way they swap an FCA package.
 *
 * By default it resolves to an {@link InstaClient} — the FCA-shaped surface
 * (sendMessage, setMessageReaction, getThreadInfo, ...) — which is what
 * GoatBot-Pro commands are written against. Pass `{ native: true }` to get the
 * bare {@link InstaAPI} instead.
 *
 * @param {string|object} cookie  sessionid string, "k=v; k=v" cookie string,
 *                                a cookie object, or a browser cookie array.
 * @param {object}        [options]  { native, sessionParams, sessionParamsFile,
 *                                     deviceFile, pollInterval }
 * @param {function}      [callback] (err, api) classic node-callback style.
 * @returns {Promise<InstaClient|InstaAPI>}
 */
function login(cookie, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  options = options || {};

  const promise = (async () => {
    const native = new InstaAPI(cookie, options);
    await native.init();
    return options.native ? native : new InstaClient(native, options);
  })();

  if (typeof callback === "function") {
    promise.then((api) => callback(null, api), (err) => callback(err, null));
    return undefined;
  }
  return promise;
}

/**
 * Alias kept for parity with FCA-style packages that expose `createClient`.
 */
function createClient(cookie, options) {
  return login(cookie, options);
}

/**
 * Wraps an already-initialised native InstaAPI in the FCA-shaped client.
 */
function wrap(native, options) {
  return new InstaClient(native, options);
}

/**
 * Wraps an already-initialised native client in a per-thread context.
 */
function createContext(nativeOrClient, threadID) {
  const client = nativeOrClient instanceof InstaClient ? nativeOrClient : wrap(nativeOrClient);
  return new InstaContext(client, threadID);
}

login.InstaAPI = InstaAPI;
login.InstaClient = InstaClient;
login.InstaContext = InstaContext;
login.createClient = createClient;
login.createFcaClient = createFcaClient;
login.wrap = wrap;
login.createContext = createContext;
login.CookieUtils = { parse: normalizeCookie };
login.harvestSessionParams = harvestSessionParams;
login.findChromium = findChromium;
login.moduleLogin = moduleLogin;
login.RealtimeClient = RealtimeClient;
login.RealtimeListener = RealtimeListener;
login.utilities = utilities;

module.exports = login;

module.exports.login = login;
module.exports.default = login;
module.exports.createClient = createClient;
module.exports.InstaAPI = InstaAPI;
module.exports.InstaClient = InstaClient;
module.exports.InstaContext = InstaContext;
module.exports.createFcaClient = createFcaClient;
module.exports.EventNormalizer = EventNormalizer;
module.exports.loadApiMethods = loadApiMethods;
module.exports.wrap = wrap;
module.exports.createContext = createContext;
module.exports.CookieUtils = { parse: normalizeCookie };
module.exports.harvestSessionParams = harvestSessionParams;
module.exports.findChromium = findChromium;
module.exports.constants = constants;
module.exports.moduleLogin = moduleLogin;
module.exports.RealtimeClient = RealtimeClient;
module.exports.RealtimeListener = RealtimeListener;
module.exports.reconcile = require("./src/realtime/reconcile");
module.exports.bridge = require("./src/realtime/bridge");
module.exports.antiSuspension = require("./src/utils/antiSuspension");
module.exports.sessionGuard = require("./src/utils/sessionGuard");
module.exports.utilities = utilities;
module.exports.AdaptiveRateLimiter = AdaptiveRateLimiter;
module.exports.CircuitBreaker = CircuitBreaker;
module.exports.IdempotencyCache = IdempotencyCache;
module.exports.Scheduler = Scheduler;
