"use strict";

const assert = require("node:assert/strict");
const { normalizeCookie, toHeader } = require("../src/cookies");
const { SendPacer, globalAntiSuspension } = require("../src/utils/antiSuspension");
const MessageMethods = require("../src/methods/message");
const MediaMethods = require("../src/methods/media");
const InboxMethods = require("../src/methods/inbox");
const { install } = require("../src/utils/readRetry");
const { setBounded } = require("../src/utils/boundedMap");

async function testCookieInputs() {
  assert.deepEqual(normalizeCookie({ sessionid: "s1", csrftoken: "c1" }), {
    sessionid: "s1", csrftoken: "c1"
  });
  assert.deepEqual(normalizeCookie([{ name: "sessionid", value: "s2" }]), {
    sessionid: "s2"
  });
  assert.deepEqual(normalizeCookie("sessionid=s3; csrftoken=c3"), {
    sessionid: "s3", csrftoken: "c3"
  });
  assert.deepEqual(normalizeCookie('{"sessionid":"s4"}'), { sessionid: "s4" });
  assert.match(toHeader(normalizeCookie({ sessionid: "s1" })), /sessionid=s1/);
}

async function testNestedPacingConfiguration() {
  const pacer = new SendPacer();
  try {
    pacer.configure({ cooldownMs: 1234, strikesToActivate: 5 });
    assert.equal(pacer.baseCooldownMs, 1234);
    assert.equal(pacer.cooldown.durationMs, 1234);
    assert.equal(pacer.cooldown.strikesToActivate, 5);
  } finally {
    pacer.destroy();
  }
}

async function testRealtimeHandlersCanRegisterBeforeConnect() {
  const InstaAPI = require("../src/api");
  const EventEmitter = require("node:events");
  let creations = 0;
  let received = 0;
  const api = Object.create(InstaAPI.prototype);
  api._realtime = null;
  api._realtimeConnecting = null;
  api.realtimeClient = (options) => {
    creations += 1;
    const client = new EventEmitter();
    client.options = options;
    client.connected = false;
    client.asyncConnectOptions = options;
    client.connect = async () => { client.connected = true; };
    client.disconnect = () => { client.connected = false; };
    return client;
  };

  api.realtimeOn("message", () => { received += 1; });
  assert.equal(creations, 0);
  const first = await api.sharedRealtimeClient({ host: "custom-broker" });
  assert.equal(creations, 1);
  assert.equal(first.options.host, "custom-broker");
  first.emit("message", {});
  assert.equal(received, 1);

  api.realtimeDisconnect();
  const second = await api.sharedRealtimeClient();
  assert.equal(creations, 2);
  second.emit("message", {});
  assert.equal(received, 2);
}


async function testSharedRealtimeReconnectSurvivesOldAttemptCleanup() {
  const InstaAPI = require("../src/api");
  let rejectFirst;
  const first = {
    connected: false,
    connect: () => new Promise((_resolve, reject) => { rejectFirst = reject; }),
    disconnect() {
      if (rejectFirst) rejectFirst(new Error("first connection cancelled"));
    }
  };
  const second = {
    connected: false,
    async connect() { this.connected = true; },
    disconnect() { this.connected = false; }
  };
  const clients = [first, second];
  const api = Object.create(InstaAPI.prototype);
  api._realtime = null;
  api._realtimeConnecting = null;
  api.realtimeClient = () => clients.shift();

  const firstAttempt = api.sharedRealtimeClient();
  const firstRejected = assert.rejects(firstAttempt, /first connection cancelled/);
  await Promise.resolve();
  api.realtimeDisconnect();

  const secondAttempt = await api.sharedRealtimeClient();
  assert.equal(secondAttempt, second);
  await firstRejected;
  assert.equal(api._realtime, second);
  assert.equal(api._realtimeConnecting, null);
  assert.equal(await api.sharedRealtimeClient(), second);
}


async function testMentionHydrationRetriesAfterInboxFailure() {
  const InstaClient = require("../src/app/InstaClient");
  let inboxCalls = 0;
  let liveLookups = 0;
  const client = Object.create(InstaClient.prototype);
  client._userIndex = new Map();
  client._picCache = new Map();
  client._threadMembers = new Map();
  client.api = {
    getInbox: async () => {
      inboxCalls += 1;
      if (inboxCalls === 1) throw new Error("temporary inbox failure");
      return { threads: [{ id: "thread-1", users: [{
        id: "user-1",
        username: "alice",
        full_name: "Alice",
        profile_pic_url: "https://cdn.example/alice.jpg"
      }] }] };
    },
    getUserInfoByUsername: async () => {
      liveLookups += 1;
      return null;
    }
  };

  await client._resolveMentionsOffline("hello @alice");
  assert.equal(client._inboxLearned, undefined);
  await client._resolveMentionsOffline("hello @alice");
  assert.equal(inboxCalls, 2);
  assert.equal(liveLookups, 1);
  assert.equal(client._inboxLearned, true);
  assert.deepEqual(await client._resolveMentionsOffline("hello @alice"), { "user-1": "alice" });
  assert.equal(inboxCalls, 2);
}


async function testLegacyLoginPreservesCookieMaps() {
  const apiPath = require.resolve("../src/api");
  const loginPath = require.resolve("../module/login");
  const cachedApi = require.cache[apiPath];
  const cachedLogin = require.cache[loginPath];
  const received = [];
  class FakeInstaAPI {
    constructor(cookie) { received.push(cookie); }
    async init() {}
  }
  try {
    require.cache[apiPath] = {
      id: apiPath,
      filename: apiPath,
      loaded: true,
      exports: FakeInstaAPI
    };
    delete require.cache[loginPath];
    const legacyLogin = require("../module/login");
    await legacyLogin({ sessionid: "s1", csrftoken: "c1", ds_user_id: "1" });
    await legacyLogin({ cookie: { sessionid: "s2", csrftoken: "c2" } });
    assert.deepEqual(received[0], { sessionid: "s1", csrftoken: "c1", ds_user_id: "1" });
    assert.deepEqual(received[1], { sessionid: "s2", csrftoken: "c2" });
  } finally {
    if (cachedApi) require.cache[apiPath] = cachedApi;
    else delete require.cache[apiPath];
    if (cachedLogin) require.cache[loginPath] = cachedLogin;
    else delete require.cache[loginPath];
  }
}


async function testTypingStopsOnRateLimitButFallsBackOnUnknown() {
  const TypingMethods = require("../src/methods/typing");
  let rateLimitedCalls = 0;
  const rateLimited = new TypingMethods({
    postForm: async () => {
      rateLimitedCalls += 1;
      const error = new Error("too many requests");
      error.response = { status: 429 };
      throw error;
    }
  });
  assert.equal(await rateLimited.start("thread-1"), false);
  assert.equal(rateLimitedCalls, 1);

  let fallbackCalls = 0;
  const fallback = new TypingMethods({
    postForm: async () => {
      fallbackCalls += 1;
      if (fallbackCalls === 1) {
        const error = new Error("endpoint not found");
        error.response = { status: 404 };
        throw error;
      }
      return { status: "ok" };
    }
  });
  assert.equal(await fallback.start("thread-1"), true);
  assert.equal(fallbackCalls, 2);
}


async function testSendLinkUsesPacer() {
  const original = globalAntiSuspension.waitForTurn;
  let calls = 0;
  globalAntiSuspension.waitForTurn = async (threadID) => {
    assert.equal(threadID, "thread-1");
    calls += 1;
  };
  try {
    const methods = new MessageMethods({
      uuid: () => "ctx",
      postForm: async () => ({ status: "ok" })
    }, {});
    await methods.sendLink("thread-1", "https://example.com", "example");
    assert.equal(calls, 1);
  } finally {
    globalAntiSuspension.waitForTurn = original;
  }
}

async function testPartialGraphqlDataPreventsLegacyFallback() {
  const originalWait = globalAntiSuspension.waitForTurn;
  globalAntiSuspension.waitForTurn = async () => {};
  try {
    const graphError = new Error("mutation returned partial data");
    graphError.name = "InstagramGraphQLError";
    graphError.errors = [{ message: graphError.message }];
    graphError.graphQLData = { send_message: { message_id: "mid.accepted" } };

    let textFallbacks = 0;
    const messages = new MessageMethods({
      uuid: () => "client-context",
      offlineThreadingId: () => "17000000000000001",
      postGraphQL: async () => { throw graphError; },
      postForm: async () => { textFallbacks += 1; return {}; }
    }, {});
    await assert.rejects(messages.send("hello", "thread-1"), /partial data/);
    assert.equal(textFallbacks, 0);

    let captionFallbacks = 0;
    const media = new MediaMethods({
      uuid: () => "client-context",
      offlineThreadingId: () => "17000000000000002",
      postGraphQL: async () => { throw graphError; },
      postForm: async () => { captionFallbacks += 1; return {}; }
    }, {});
    await assert.rejects(media._sendCaption("thread-1", "caption"), /partial data/);
    assert.equal(captionFallbacks, 0);
  } finally {
    globalAntiSuspension.waitForTurn = originalWait;
  }
}


async function testLegacyTextFallbackUsesOfflineThreadingId() {
  const originalWait = globalAntiSuspension.waitForTurn;
  globalAntiSuspension.waitForTurn = async () => {};
  try {
    const graphError = new Error("Persisted query is no longer available");
    graphError.name = "InstagramGraphQLError";
    graphError.errors = [{ message: graphError.message }];
    let fallback;
    const methods = new MessageMethods({
      uuid: () => "client-context-1",
      offlineThreadingId: () => "17000000000000001",
      postGraphQL: async () => { throw graphError; },
      postForm: async (_url, params) => { fallback = params; return { status: "ok" }; }
    }, {});
    await methods.send("hello", "thread-1");
    assert.equal(fallback.client_context, "client-context-1");
    assert.equal(fallback.offline_threading_id, "17000000000000001");
    assert.notEqual(fallback.client_context, fallback.offline_threading_id);
  } finally {
    globalAntiSuspension.waitForTurn = originalWait;
  }
}


async function testAmbiguousGraphqlSendDoesNotFallback() {
  const originalWait = globalAntiSuspension.waitForTurn;
  globalAntiSuspension.waitForTurn = async () => {};
  try {
    let textFallbacks = 0;
    const networkError = new Error("socket hang up");
    networkError.code = "ECONNRESET";
    const text = new MessageMethods({
      offlineThreadingId: () => "offline-1",
      uuid: () => "legacy-context",
      postGraphQL: async () => { throw networkError; },
      postForm: async () => { textFallbacks += 1; return { status: "ok" }; }
    }, {});
    await assert.rejects(text.send("hello", "thread-1"), /socket hang up/);
    assert.equal(textFallbacks, 0);

    let captionFallbacks = 0;
    const media = new MediaMethods({
      offlineThreadingId: () => "offline-2",
      uuid: () => "legacy-context",
      postGraphQL: async () => { throw networkError; },
      postForm: async () => { captionFallbacks += 1; return { status: "ok" }; }
    }, {});
    await assert.rejects(media._sendCaption("thread-1", "caption"), /socket hang up/);
    assert.equal(captionFallbacks, 0);
  } finally {
    globalAntiSuspension.waitForTurn = originalWait;
  }
}


async function testCaptionAuthFailureDoesNotFallback() {
  let legacyCalls = 0;
  const media = new MediaMethods({
    offlineThreadingId: () => "offline-1",
    uuid: () => "ctx-1",
    postGraphQL: async () => {
      const error = new Error("login_required");
      error.response = { status: 401, data: { message: "login_required" } };
      throw error;
    },
    postForm: async () => {
      legacyCalls += 1;
      return { status: "ok" };
    }
  }, {});
  await assert.rejects(media._sendCaption("thread-1", "caption"), /login_required/);
  assert.equal(legacyCalls, 0);
}

async function testReadRetryDoesNotRetryThrownErrors() {
  let calls = 0;
  const client = {
    getThreadInfo: async () => {
      calls += 1;
      throw new Error("invalid thread id");
    }
  };
  install(client, { attempts: 3, firstWaitMs: 0, maxWaitMs: 0 });
  await assert.rejects(client.getThreadInfo("bad-id"), /invalid thread id/);
  assert.equal(calls, 1);
}


async function testInboxPollerHonorsRetryAfterHeader() {
  const inbox = new InboxMethods({}, () => "self-1");
  inbox.getInbox = async () => {
    const error = new Error("too many requests");
    error.response = { status: 429, headers: { "retry-after": "120" } };
    throw error;
  };
  const delays = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let stop;
  try {
    global.setTimeout = (fn, delay) => {
      const timer = { fn, delay, unref() {} };
      delays.push(timer);
      return timer;
    };
    global.clearTimeout = () => {};
    stop = inbox._startPolling(() => {}, 2000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(delays.length, 1);
    assert.ok(delays[0].delay >= 120000);
  } finally {
    if (stop) stop();
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
}


async function testPollingSurvivesInconclusiveAuthCheck() {
  const inbox = new InboxMethods({}, () => "self-1");
  let inboxCalls = 0;
  let callbackErrors = 0;
  inbox.getInbox = async () => {
    inboxCalls += 1;
    if (inboxCalls <= 2) {
      const error = new Error("login_required");
      error.igKind = "auth";
      throw error;
    }
    return { threads: [] };
  };
  inbox.http.checkSession = async () => ({
    state: "graphql_error",
    error: new Error("persisted query unavailable")
  });

  const timers = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let stop;
  try {
    global.setTimeout = (fn) => {
      const timer = { fn, unref() {} };
      timers.push(timer);
      return timer;
    };
    global.clearTimeout = () => {};
    stop = inbox._startPolling((error) => { if (error) callbackErrors += 1; }, 2000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(inboxCalls, 1);
    assert.equal(timers.length, 1);

    timers[0].fn();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(inboxCalls, 2);
    assert.equal(timers.length, 2);
    assert.equal(callbackErrors, 0);

    timers[1].fn();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(inboxCalls, 3);
    assert.equal(inbox._statePrimed, true);
    assert.equal(callbackErrors, 0);
  } finally {
    if (stop) stop();
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
}


async function testStoppedListenerSuppressesLateStartupError() {
  const { EventEmitter } = require("node:events");
  const inbox = new InboxMethods({ getCookie: () => "session" }, () => "self-1", {
    realtime: { enabled: true, fallback: false },
    getSharedClient: () => client
  });
  inbox.identity = { deviceId: "device-1", uuid: "uuid-1" };
  let rejectConnect;
  const client = new EventEmitter();
  client.connected = false;
  client.connect = () => new Promise((_resolve, reject) => { rejectConnect = reject; });
  client.disconnect = () => {};
  let callbackCalls = 0;
  const stop = inbox.listen(() => { callbackCalls += 1; });
  await new Promise(resolve => setImmediate(resolve));
  stop();
  rejectConnect(new Error("late startup failure"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(callbackCalls, 0);
}


async function testListenReplacesPreviousPollingListener() {
  const inbox = new InboxMethods({}, () => "self-1");
  inbox.realtimeOptions = { enabled: false };
  let starts = 0;
  let stops = 0;
  inbox._startPolling = () => {
    starts += 1;
    let stopped = false;
    return () => {
      if (!stopped) {
        stopped = true;
        stops += 1;
      }
    };
  };
  const firstStop = inbox.listen(() => {});
  const secondStop = inbox.listen(() => {});
  assert.equal(starts, 2);
  assert.equal(stops, 1);
  firstStop();
  assert.equal(stops, 1);
  secondStop();
  assert.equal(stops, 2);
}


async function testInboxCallbackErrorsDoNotEscapeListener() {
  const { EventEmitter } = require("node:events");
  const inbox = new InboxMethods({}, () => "self-1");
  inbox._emitter = new EventEmitter();
  const errors = [];
  inbox._emitter.on("callbackError", error => errors.push(error.message));

  const syncCallback = inbox._safeCallback(() => { throw new Error("sync callback failure"); });
  syncCallback(null, { messageID: "m-1" });
  assert.deepEqual(errors, ["sync callback failure"]);

  const asyncCallback = inbox._safeCallback(async () => {
    throw new Error("async callback failure");
  });
  await asyncCallback(null, { messageID: "m-2" });
  assert.deepEqual(errors, ["sync callback failure", "async callback failure"]);
}


async function testPollingDeliversAllMessagesSinceLastSeen() {
  const old = { id: "old-message", sender_fbid: "friend-1", content_type: "TEXT", text_body: "old" };
  const middle = { id: "middle-message", sender_fbid: "friend-1", content_type: "TEXT", text_body: "middle" };
  const newest = { id: "newest-message", sender_fbid: "friend-1", content_type: "TEXT", text_body: "newest" };
  const arrivedDuringDetail = { id: "arrived-during-detail", sender_fbid: "friend-1", content_type: "TEXT", text_body: "latest" };
  const http = {
    postGraphQL: async () => ({
      data: { get_slide_thread_nullable: { as_ig_direct_thread: {
        users: [],
        slide_messages: { edges: [arrivedDuringDetail, newest, middle, old].map(node => ({ node })) }
      } } }
    })
  };
  const inbox = new InboxMethods(http, () => "self-1");
  inbox._seen.set("thread-1", "old-message");
  const events = await inbox._extractEvents([{
    id: "thread-1",
    users: [],
    slide_messages: { edges: [{ node: newest }] }
  }]);
  assert.deepEqual(events.map(event => event.messageID), [
    "middle-message",
    "newest-message",
    "arrived-during-detail"
  ]);
  assert.equal(inbox._seen.get("thread-1"), "arrived-during-detail");
  const nextPoll = await inbox._extractEvents([{
    id: "thread-1",
    users: [],
    slide_messages: { edges: [{ node: arrivedDuringDetail }] }
  }]);
  assert.deepEqual(nextPoll, []);
}


async function testPollingStopSuppressesInflightResults() {
  const inbox = new InboxMethods({}, () => "self-1");
  let release;
  inbox.getInbox = () => new Promise(resolve => { release = resolve; });
  const scheduled = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let events = 0;
  let stop;
  try {
    global.setTimeout = (fn) => {
      const timer = { fn, unref() {} };
      scheduled.push(timer);
      return timer;
    };
    global.clearTimeout = () => {};
    stop = inbox._startPolling((_err, event) => { if (event) events += 1; }, 2000);
    await Promise.resolve();
    stop();
    release({ threads: [{
      id: "thread-1",
      users: [],
      slide_messages: { edges: [{ node: {
        id: "message-after-stop",
        sender_fbid: "friend-1",
        content_type: "TEXT",
        text_body: "must not dispatch",
        timestamp_ms: 1700000000000
      } }] }
    }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(events, 0);
    assert.equal(scheduled.length, 0);
    assert.equal(inbox._statePrimed, false);
  } finally {
    if (stop) stop();
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
}


async function testFirstMessageAfterEmptyInboxPoll() {
  const InboxMethods = require("../src/methods/inbox");
  const inbox = new InboxMethods({}, () => "self-1");
  let polls = 0;
  inbox.getInbox = async () => {
    polls += 1;
    if (polls === 1) return { threads: [] };
    return {
      threads: [{
        id: "thread-1",
        users: [{ id: "friend-1" }],
        slide_messages: { edges: [{ node: {
          id: "message-1", sender_fbid: "friend-fbid",
          content_type: "TEXT", text_body: "hello", timestamp_ms: 1700000000000
        } }] }
      }]
    };
  };
  inbox.fetchReplies = async () => ({});
  const scheduled = [];
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let stop;
  const events = [];
  const flush = () => new Promise(resolve => setImmediate(resolve));
  try {
    global.setTimeout = (fn) => {
      const timer = { fn, unref() {} };
      scheduled.push(timer);
      return timer;
    };
    global.clearTimeout = () => {};
    stop = inbox._startPolling((_err, event) => { if (event) events.push(event); }, 2000);
    await flush();
    scheduled.shift().fn();
    await flush();
    assert.equal(events.length, 1);
    assert.equal(events[0].messageID, "message-1");
    scheduled.shift().fn();
    await flush();
    assert.equal(events.length, 1);
  } finally {
    if (stop) stop();
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
}

async function testRealtimeAcknowledgementAndReady() {
  const { EventEmitter } = require("node:events");
  const { RealtimeListener } = require("../src/realtime/listener");
  class FakeClient extends EventEmitter {
    constructor() { super(); this.connected = true; }
    async connect() {}
    async irisSubscribe() { this.emit("iris_sub_response", { status: "ok" }); }
    disconnect() {}
  }
  const client = new FakeClient();
  let ready = 0;
  const listener = new RealtimeListener({}, {
    getClient: async () => client,
    seqId: 1,
    snapshotAtMs: 1700000000000,
    onReady: () => { ready += 1; }
  });
  await listener.start(() => {});
  assert.equal(listener._subscribed, true);
  assert.equal(ready, 1);
  listener.stop();
}

async function testRealtimeListenerStopDuringClientLookup() {
  const { EventEmitter } = require("node:events");
  const { RealtimeListener } = require("../src/realtime/listener");
  let releaseClient;
  let disconnects = 0;
  const clientPromise = new Promise(resolve => { releaseClient = resolve; });
  const listener = new RealtimeListener({}, { getClient: () => clientPromise });
  const starting = listener.start(() => {});
  listener.stop();

  const sharedClient = new EventEmitter();
  sharedClient.connected = true;
  sharedClient.disconnect = () => { disconnects += 1; };
  releaseClient(sharedClient);
  await starting;
  assert.equal(sharedClient.listenerCount("message"), 0);
  assert.equal(sharedClient.listenerCount("error"), 0);
  assert.equal(sharedClient.listenerCount("disconnected"), 0);
  assert.equal(disconnects, 0);
  assert.equal(listener.connected, false);
}


async function testRealtimeMissingAcknowledgementFails() {
  const { EventEmitter } = require("node:events");
  const { RealtimeListener } = require("../src/realtime/listener");
  class FakeClient extends EventEmitter {
    constructor() { super(); this.connected = true; }
    async connect() {}
    async irisSubscribe() {}
    disconnect() {}
  }
  const client = new FakeClient();
  const listener = new RealtimeListener({}, {
    getClient: async () => client,
    seqId: 1,
    snapshotAtMs: 1700000000000,
    subscriptionTimeoutMs: 20
  });
  await assert.rejects(listener.start(() => {}), /acknowledgement timed out/);
  assert.equal(listener._subscribed, false);
  assert.equal(client.listenerCount("iris_sub_response"), 0);
  listener.stop();
}

async function testRealtimeFallbackStartsOnlyOnce() {
  const { EventEmitter } = require("node:events");
  const InboxMethods = require("../src/methods/inbox");
  class FakeClient extends EventEmitter {
    constructor() { super(); this.connected = true; }
    async connect() {}
    disconnect() {}
  }
  const fake = new FakeClient();
  const inbox = new InboxMethods({ getCookie: () => "session-value" }, () => "self-1", {
    realtime: { enabled: true, fallback: true, getRealtimeState: async () => null },
    getSharedClient: () => fake
  });
  let fallbackStarts = 0;
  inbox._startPolling = () => { fallbackStarts += 1; return () => {}; };
  const stop = inbox.listen(() => {});
  await new Promise(resolve => setImmediate(resolve));
  fake.emit("error", new Error("socket failure"));
  fake.emit("disconnected", {});
  assert.equal(fallbackStarts, 1);
  stop();
}


async function testRealtimeConnectFailureClosesTransport() {
  const { RealtimeClient } = require("../src/realtime/client");
  let disconnects = 0;
  const transport = {
    reset() {},
    async connect() {},
    async send() {},
    async recvPacket() { return Buffer.from([0x20, 0x02, 0x00, 0x05]); },
    disconnect() { disconnects += 1; }
  };
  const client = new RealtimeClient({
    sessionid: "session",
    deviceId: "device-123",
    userId: 123456789
  }, { transport });
  await assert.rejects(client.connect(), /Realtime MQTT connect failed/);
  assert.equal(client.connected, false);
  assert.equal(client._pingTimer, null);
  assert.equal(disconnects, 1);
}


async function testMqttTransportCancelsPendingTlsSockets() {
  const tls = require("node:tls");
  const { EventEmitter } = require("node:events");
  const { SocketMQTToTTransport } = require("../src/realtime/mqttot");
  const originalConnect = tls.connect;
  class FakeSocket extends EventEmitter {
    setTimeout() {}
    end() {}
    destroy() {
      this.destroyed = true;
      this.emit("close");
    }
  }

  try {
    const sockets = [];
    tls.connect = () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    };
    const transport = new SocketMQTToTTransport("mqtt.example", 443);
    const firstConnect = transport.connect();
    const firstRejected = assert.rejects(firstConnect, /closed during TLS handshake/);
    transport.reset();
    const secondConnect = transport.connect();

    sockets[0].emit("secureConnect");
    await firstRejected;
    assert.equal(transport.socket, sockets[1]);
    sockets[1].emit("secureConnect");
    await secondConnect;
    assert.equal(transport.socket, sockets[1]);

    transport.disconnect();
    assert.equal(transport.socket, null);
    assert.equal(transport._closed, true);
    assert.equal(sockets[1].destroyed, true);

    const pendingTransport = new SocketMQTToTTransport("mqtt.example", 443);
    const pendingConnect = pendingTransport.connect();
    const pendingRejected = assert.rejects(pendingConnect, /MQTT transport closed/);
    pendingTransport.disconnect();
    await pendingRejected;
    assert.equal(sockets[2].destroyed, true);
  } finally {
    tls.connect = originalConnect;
  }
}


async function testRealtimePingIntervalIsClamped() {
  const { RealtimeClient } = require("../src/realtime/client");
  const originalSetInterval = global.setInterval;
  const delays = [];
  try {
    global.setInterval = (_fn, delay) => {
      delays.push(delay);
      return { unref() {} };
    };
    const client = new RealtimeClient({
      sessionid: "session",
      deviceId: "device-123",
      userId: 123456789
    }, { transport: {}, keepAliveMs: 120000 });
    client.connected = true;
    client._startPing();
    assert.equal(delays[0], 48000);

    const invalid = new RealtimeClient({
      sessionid: "session",
      deviceId: "device-123",
      userId: 123456789
    }, { transport: {}, keepAliveMs: -1 });
    invalid.connected = true;
    invalid._startPing();
    assert.equal(delays[1], 30000);
  } finally {
    global.setInterval = originalSetInterval;
  }
}


async function testOldRealtimeLoopCannotCloseNewConnection() {
  let recvCalls = 0;
  let rejectOldReceive;
  let rejectNewReceive;
  const connack = Buffer.from([0x20, 0x02, 0x00, 0x00]);
  const transport = {
    reset() {},
    async connect() {},
    async send() {},
    recvPacket() {
      recvCalls += 1;
      if (recvCalls === 1 || recvCalls === 3) return Promise.resolve(connack);
      if (recvCalls === 2) return new Promise((_resolve, reject) => { rejectOldReceive = reject; });
      if (recvCalls === 4) return new Promise((_resolve, reject) => { rejectNewReceive = reject; });
      throw new Error("unexpected receive call");
    },
    disconnect() {}
  };
  const client = new RealtimeClient({
    sessionid: "session",
    deviceId: "device-123",
    userId: 123456789
  }, { transport, keepAliveMs: 60000 });
  client.on("error", () => {});
  let disconnected = 0;
  client.on("disconnected", () => { disconnected += 1; });

  await client.connect();
  const oldLoop = client._loop;
  client.disconnect();
  await client.connect();
  const newLoop = client._loop;
  rejectOldReceive(new Error("old socket closed"));
  await oldLoop;
  assert.equal(client.connected, true);
  assert.equal(disconnected, 0);

  client.disconnect();
  rejectNewReceive(new Error("new socket closed"));
  await newLoop;
  assert.equal(client.connected, false);
  assert.equal(disconnected, 1);
}


async function testRealtimeConnectCanBeCancelled() {
  let releaseConnect;
  let connectPackets = 0;
  let disconnects = 0;
  const transport = {
    reset() {},
    connect: () => new Promise(resolve => { releaseConnect = resolve; }),
    async send(packet) {
      if (packet[0] === 0x10) connectPackets += 1;
    },
    async recvPacket() { throw new Error("recvPacket must not run after cancellation"); },
    disconnect() { disconnects += 1; }
  };
  const client = new RealtimeClient({
    sessionid: "session",
    deviceId: "device-123",
    userId: 123456789
  }, { transport });

  const connecting = client.connect();
  await Promise.resolve();
  client.disconnect();
  releaseConnect();
  await assert.rejects(connecting, /connection cancelled/);
  assert.equal(connectPackets, 0);
  assert.equal(client.connected, false);
  assert.equal(client._stopRequested, true);
  assert.equal(disconnects, 2);
}


async function testDecodePacketRejectsMalformedFrames() {
  const { decodePacket } = require("../src/realtime/mqttot");
  assert.throws(() => decodePacket(Buffer.alloc(0)), /missing fixed header/);
  assert.throws(() => decodePacket(Buffer.from([0x20])), /truncated remaining length/);
  assert.throws(() => decodePacket(Buffer.from([0x20, 0x01, 0x00])), /two-byte body/);
  assert.throws(() => decodePacket(Buffer.from([0xd0, 0x01, 0x00])), /empty body/);
  assert.throws(() => decodePacket(Buffer.from([0x30, 0x02, 0x00, 0x05])), /truncated UTF-8 value/);
  assert.throws(() => decodePacket(Buffer.from([0x30, 0x03, 0x00, 0x01, 0x61, 0x62])), /frame size/);
  assert.throws(() => decodePacket(Buffer.from([0x30, 0x02, 0x00, 0x01, 0x61])), /frame size/);
  assert.throws(() => decodePacket(Buffer.from([0x00, 0x00])), /reserved control packet type/);
  assert.throws(() => decodePacket(Buffer.from([0xf0, 0x00])), /reserved control packet type/);
  assert.throws(() => decodePacket(Buffer.from([0x34, 0x05, 0x00, 0x01, 0x78, 0x00, 0x01])), /unsupported QoS/);
  assert.throws(() => decodePacket(Buffer.from([0x32, 0x05, 0x00, 0x01, 0x78, 0x00, 0x00])), /cannot be zero/);
  const { writePublishPacket, writeSubscribePacket } = require("../src/realtime/mqttot");
  assert.throws(() => writePublishPacket("topic", Buffer.from("x"), 1, 0), /identifier/);
  assert.throws(() => writeSubscribePacket("topic", 0), /identifier/);
  assert.throws(() => writePublishPacket("x".repeat(65536), Buffer.from("x"), 0), /65535 bytes/);
  assert.throws(() => writeSubscribePacket("x".repeat(65536)), /65535 bytes/);
}


async function testRealtimePacketIdentifierWraps() {
  const { RealtimeClient } = require("../src/realtime/client");
  const { decodePacket } = require("../src/realtime/mqttot");
  const packets = [];
  const client = new RealtimeClient({
    sessionid: "session",
    deviceId: "device-123",
    userId: 123456789
  }, { transport: { send: async packet => { packets.push(packet); } } });
  client._packetId = 65534;
  await client.publishBytes("134", Buffer.from("first"));
  await client.publishBytes("134", Buffer.from("second"));
  assert.equal(decodePacket(packets[0]).packetId, 65535);
  assert.equal(decodePacket(packets[1]).packetId, 1);
}


async function testRealtimeReceiveFailureClosesTransport() {
  const { RealtimeClient } = require("../src/realtime/client");
  let receives = 0;
  let disconnects = 0;
  const transport = {
    reset() {},
    async connect() {},
    async send() {},
    async recvPacket() {
      receives += 1;
      if (receives === 1) return Buffer.from([0x20, 0x02, 0x00, 0x00]);
      return Buffer.from([0x20]); // truncated MQTT remaining-length header
    },
    disconnect() { disconnects += 1; }
  };
  const client = new RealtimeClient({
    sessionid: "session",
    deviceId: "device-123",
    userId: 123456789
  }, { transport, keepAliveMs: 60000 });
  client.on("error", () => {});
  await client.connect();
  await client._loop;
  assert.equal(client.connected, false);
  assert.equal(client._pingTimer, null);
  assert.equal(client._stopRequested, true);
  assert.equal(disconnects, 1);

  let throwingDisconnects = 0;
  let receives = 0;
  const throwingTransport = {
    reset() {},
    async connect() {},
    async send() {},
    async recvPacket() {
      receives += 1;
      return receives === 1
        ? Buffer.from([0x20, 0x02, 0x00, 0x00])
        : Buffer.from([0x20]);
    },
    disconnect() { throwingDisconnects += 1; }
  };
  const throwingClient = new RealtimeClient({
    sessionid: "session",
    deviceId: "device-123",
    userId: 123456789
  }, { transport: throwingTransport, keepAliveMs: 60000 });
  throwingClient.on("error", () => { throw new Error("consumer error handler failed"); });
  await throwingClient.connect();
  await assert.rejects(throwingClient._loop, /consumer error handler failed/);
  assert.equal(throwingClient._pingTimer, null);
  assert.equal(throwingDisconnects, 1);

  const { writePublishPacket } = require("../src/realtime/mqttot");
  let packetDisconnects = 0;
  let packetReceives = 0;
  const payload = Buffer.from(JSON.stringify([{
    data: [{
      path: "/direct_v2/threads/thread-1/items/item-1",
      op: "add",
      value: JSON.stringify({ item_type: 1, user_id: "friend-1", text: "hello" })
    }]
  }]));
  const packetTransport = {
    reset() {},
    async connect() {},
    async send() {},
    async recvPacket() {
      packetReceives += 1;
      return packetReceives === 1
        ? Buffer.from([0x20, 0x02, 0x00, 0x00])
        : writePublishPacket("146", payload, 0);
    },
    disconnect() { packetDisconnects += 1; }
  };
  const packetClient = new RealtimeClient({
    sessionid: "session",
    deviceId: "device-123",
    userId: 123456789
  }, { transport: packetTransport, keepAliveMs: 60000 });
  packetClient.on("message", () => { throw new Error("message handler failed"); });
  packetClient.on("error", () => { throw new Error("error listener failed"); });
  await packetClient.connect();
  await assert.rejects(packetClient._loop, /error listener failed/);
  assert.equal(packetClient._pingTimer, null);
  assert.equal(packetDisconnects, 1);
}


async function testRealtimeFallbackAfterEstablishedDisconnect() {
  const { EventEmitter } = require("node:events");
  const InboxMethods = require("../src/methods/inbox");
  class FakeClient extends EventEmitter {
    constructor() { super(); this.connected = true; }
    async connect() {}
    async irisSubscribe() { this.emit("iris_sub_response", { status: "ok" }); }
    disconnect() {}
  }
  const fake = new FakeClient();
  const inbox = new InboxMethods({ getCookie: () => "session-value" }, () => "self-1", {
    realtime: {
      enabled: true,
      fallback: true,
      seqId: 1,
      snapshotAtMs: 1700000000000
    },
    getSharedClient: () => fake
  });
  let fallbackStarts = 0;
  inbox._startPolling = () => { fallbackStarts += 1; return () => {}; };
  const stop = inbox.listen(() => {});
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(inbox._realtimeListener._subscribed, true);
  fake.emit("disconnected", {});
  fake.emit("error", new Error("socket already closed"));
  assert.equal(fallbackStarts, 1);
  stop();
}


async function testRelayThreadListPreview() {
  const createGetThreadList = require("../src/api/threads/getThreadList");
  const getThreadList = createGetThreadList({
    api: { getInbox: async () => ({ threads: [{
      id: "thread-1",
      slide_messages: { edges: [{ node: {
        text_body: "latest message", timestamp_ms: 1700000000000
      } }] }
    }] }) }
  });
  const [thread] = await getThreadList(10);
  assert.equal(thread.snippet, "latest message");
  assert.equal(thread.timestamp, 1700000000000);
}

async function testDirectThreadClassification() {
  const createGetThreadInfo = require("../src/api/threads/getThreadInfo");
  const getThreadInfo = createGetThreadInfo({
    api: { getThreadInfo: async () => ({
      viewer: { id: "self-1", username: "bot" },
      users: [{ id: "friend-1", username: "friend" }]
    }) },
    _learnThreads() {}
  });
  const info = await getThreadInfo("thread-1");
  assert.equal(info.isGroup, false);
}

async function testXmaWithoutPreviewHasNoAttachment() {
  const { attachmentsFromContent } = require("../src/messageContent");
  assert.deepEqual(attachmentsFromContent({
    __typename: "SlideMessageXMAContent",
    xma_text_body: "Shared a post with you",
    xma: {}
  }), []);
}

async function testViewerFbidUsesViewerId() {
  const { threadFbidMap } = require("../src/threadDetail");
  const map = threadFbidMap({
    viewer: { id: "viewer-ig-id", interop_messaging_user_fbid: "viewer-fbid" }
  });
  assert.equal(map["viewer-fbid"], "viewer-ig-id");
}


async function testGetUidRejectsContentRoutes() {
  const createGetUID = require("../src/api/users/getUID");
  const getUID = createGetUID({ userID: "self-uid" });
  assert.equal(getUID("https://www.instagram.com/reel/ABC123/"), "self-uid");
  assert.equal(getUID("https://www.instagram.com/p/ABC123/"), "self-uid");
  assert.equal(getUID("https://www.instagram.com/rakib.hasan/"), "rakib.hasan");
}


async function testThriftInt64BigIntMode() {
  const { ThriftWriter, ThriftReader } = require("../src/realtime/mqttot");
  const original = 9007199254740993n;
  const writer = new ThriftWriter();
  writer.writeInt(1, original, 64);
  writer.writeStop();
  const reader = new ThriftReader(Buffer.from(writer.buffer), { int64AsBigInt: true });
  const fieldType = reader.readField();
  assert.equal(reader.readValue(fieldType, null), original);
}


async function testInboxCursorPagination() {
  const calls = [];
  const inbox = new InboxMethods({
    session: { __hsi: "device-1" },
    uuid: () => "device-1",
    postGraphQL: async (name, docId, variables) => {
      calls.push({ name, docId, variables });
      if (name === "PolarisDirectInboxQuery") {
        return { data: { get_slide_mailbox_for_iris_subscription: {
          id: "mailbox-1",
          threads_by_folder: {
            edges: [{ node: { as_ig_direct_thread: { id: "thread-1", thread_id: "internal-1", users: [] } } }],
            page_info: { has_next_page: true, end_cursor: "cursor-1" }
          }
        } } };
      }
      return { data: { fetch__SlideMailbox: { threads_by_folder: {
        edges: [{ node: { as_ig_direct_thread: { id: "thread-2", thread_id: "internal-2", users: [] } } }],
        page_info: { has_next_page: false, end_cursor: null }
      } } } };
    }
  }, () => "self-1");
  const first = await inbox.getInbox();
  assert.deepEqual(first.threads.map(t => t.id), ["thread-1"]);
  assert.equal(first.nextCursor, "cursor-1");
  assert.equal(first.hasNextPage, true);
  const second = await inbox.getInbox(first.nextCursor);
  assert.deepEqual(second.threads.map(t => t.id), ["thread-2"]);
  assert.equal(second.nextCursor, null);
  assert.equal(second.hasNextPage, false);
  assert.equal(calls[1].name, "IGDThreadListOffMsysPaginationQuery");
  assert.equal(calls[1].variables.newer_than_timestamp_ms, null);
  assert.equal(calls[1].variables.__relay_internal__pv__IGDPinnedThreadsRenderEnabledGKrelayprovider, true);
}

async function testThreadHistoryTimestampPagination() {
  const ThreadMethods = require("../src/methods/thread");
  const calls = [];
  // Use realistic Unix-millisecond timestamps. Values below 1e12 are
  // intentionally normalized as Unix seconds by getHistory().
  const firstThread = {
    id: "long-thread-id",
    thread_fbid: "thread-fbid-1",
    users: [],
    slide_messages: {
      edges: [
        { node: { id: "m3", timestamp_ms: 1700000003000, text_body: "newest" } },
        { node: { id: "m2", timestamp_ms: 1700000002000, text_body: "boundary" } }
      ],
      page_info: { has_next_page: true, end_cursor: "cursor-1" }
    }
  };
  const olderConnection = {
    edges: [
      { node: { id: "m2", timestamp_ms: 1700000002000, text_body: "boundary duplicate" } },
      { node: { id: "m1", timestamp_ms: 1700000001500, text_body: "older one" } }
    ],
    page_info: { has_next_page: true, end_cursor: "cursor-2" }
  };
  const oldestConnection = {
    edges: [{ node: { id: "m0", timestamp_ms: 1700000001000, text_body: "older two" } }],
    page_info: { has_next_page: false, end_cursor: null }
  };
  const http = {
    postGraphQL: async (friendlyName, docId, variables) => {
      calls.push({ friendlyName, docId, variables });
      if (friendlyName === "IGDThreadDetailQuery") {
        return { data: { get_slide_thread_nullable: { as_ig_direct_thread: firstThread } } };
      }
      if (friendlyName === "IGDMessageListOffMsysQuery") {
        const connection = variables.after === "cursor-1" ? olderConnection : oldestConnection;
        return { data: { fetch__SlideThread: { as_ig_direct_thread: { slide_messages: connection } } } };
      }
      throw new Error("Unexpected GraphQL operation: " + friendlyName);
    }
  };
  const thread = new ThreadMethods(http);
  const items = await thread.getHistory("thread-key-1", 2, 1700000002000);
  assert.deepEqual(items.map(item => item.messageID), ["m1", "m0"]);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].variables.after, "cursor-1");
  assert.equal(calls[1].variables.id, "thread-fbid-1");
  assert.equal(calls[1].variables.first, 2);
  assert.equal(calls[2].variables.after, "cursor-2");
}

async function testFcaHistoryTimestampIsForwarded() {
  const createGetThreadHistory = require("../src/api/threads/getThreadHistory");
  let received;
  const getThreadHistory = createGetThreadHistory({
    api: {
      getThreadHistory: async (...args) => {
        received = args;
        return [];
      }
    }
  });
  await getThreadHistory("thread-1", 5, 1700000000000);
  assert.deepEqual(received, ["thread-1", 20, 1700000000000]);
}

async function testMediaUploadDoesNotRetryPermanentAuthFailure() {
  let calls = 0;
  const media = new MediaMethods({
    postRupload: async () => {
      calls += 1;
      const error = new Error("AuthorizationFailedError");
      error.response = { status: 401 };
      throw error;
    }
  }, {});
  await assert.rejects(media._upload("thread-1", {
    buffer: Buffer.from("test"), filename: "test.jpg", contentType: "image/jpeg"
  }), /AuthorizationFailedError/);
  assert.equal(calls, 1);
}


async function testMediaCommitDoesNotRetryGraphqlFieldException() {
  let calls = 0;
  let ids = 0;
  const media = new MediaMethods({
    offlineThreadingId: () => `offline-${++ids}`,
    postGraphQL: async (_name, _doc, variables) => {
      calls += 1;
      assert.equal(variables.offline_threading_id, "offline-1");
      throw new Error("field_exception");
    }
  }, {});
  await assert.rejects(media._commitMedia("thread-1", "media-1"), /field_exception/);
  assert.equal(calls, 1);
  assert.equal(ids, 1);
}

async function testMediaCommitRetryReusesOfflineThreadingId() {
  let calls = 0;
  let ids = 0;
  const sentIds = [];
  const media = new MediaMethods({
    offlineThreadingId: () => `offline-${++ids}`,
    postGraphQL: async (_name, _doc, variables) => {
      calls += 1;
      sentIds.push(variables.offline_threading_id);
      if (calls === 1) {
        const error = new Error("temporary network failure");
        error.code = "ECONNRESET";
        throw error;
      }
      return { data: { status: "ok" } };
    }
  }, {});
  const originalSetTimeout = global.setTimeout;
  try {
    global.setTimeout = (fn) => { fn(); return 0; };
    const result = await media._commitMedia("thread-1", "media-1");
    assert.deepEqual(result, { data: { status: "ok" } });
  } finally {
    global.setTimeout = originalSetTimeout;
  }
  assert.equal(calls, 2);
  assert.deepEqual(sentIds, ["offline-1", "offline-1"]);
  assert.equal(ids, 1);
}


async function testThriftReaderRejectsMalformedAndOversizedValues() {
  const { ThriftReader } = require("../src/realtime/mqttot");
  assert.throws(
    () => new ThriftReader(Buffer.from([0x15, 0x80])).readStruct([]),
    /Truncated Thrift varint/
  );
  assert.throws(
    () => new ThriftReader(Buffer.from([0x19, 0xf1, 0xa1, 0x8d, 0x06])).readStruct([]),
    /list exceeds configured collection limit/
  );
  assert.throws(
    () => new ThriftReader(Buffer.from([0x18, 0x05, 0x61])).readStruct([]),
    /binary field exceeds available data/
  );
  assert.deepEqual(
    new ThriftReader(Buffer.from([0x19, 0x13, 0x7f, 0x00])).readStruct([]),
    {}
  );
  assert.throws(
    () => new ThriftReader(Buffer.from([0x19, 0x13, 0x7f])).readStruct([]),
    /Thrift struct is missing STOP marker/
  );
}

async function testMqttDecompressionOutputIsBounded() {
  const zlib = require("node:zlib");
  const { tryDecompressPayload } = require("../src/realtime/mqttot");
  const small = zlib.deflateSync(Buffer.from('{"ok":true}'));
  assert.equal(tryDecompressPayload(small).toString("utf8"), '{"ok":true}');
  const oversized = zlib.deflateSync(Buffer.alloc(33 * 1024 * 1024, 0x41));
  assert.strictEqual(tryDecompressPayload(oversized), oversized);
}

async function testMqttTransportRejectsOversizedAndMalformedFrames() {
  const { EventEmitter } = require("node:events");
  const { SocketMQTToTTransport } = require("../src/realtime/mqttot");
  const transport = new SocketMQTToTTransport("mqtt.example", 443, {
    maxPacketSize: 4,
    maxBufferedBytes: 9
  });

  // A TCP data event may end in the middle of a valid MQTT length varint.
  transport._buffer = Buffer.from([0x30, 0x80]);
  assert.equal(transport._tryRead(), null);
  transport._buffer = Buffer.concat([transport._buffer, Buffer.from([0x00])]);
  assert.deepEqual(transport._tryRead(), Buffer.from([0x30, 0x80, 0x00]));

  transport._buffer = Buffer.from([0x30, 0x05]);
  assert.throws(() => transport._tryRead(), /exceeds configured limit/);

  transport._buffer = Buffer.from([0x30, 0x80, 0x80, 0x80, 0x80, 0x00]);
  assert.throws(() => transport._tryRead(), /exceeds four bytes/);

  // The malformed-frame assertions above intentionally leave invalid bytes
  // in the parser buffer; isolate the receive-buffer overflow case.
  transport._buffer = Buffer.alloc(0);
  const socket = new EventEmitter();
  socket.destroy = (error) => { socket.destroyError = error; };
  transport._attach(socket);
  const pending = transport.recvPacket();
  socket.emit("data", Buffer.alloc(10));
  await assert.rejects(pending, /receive buffer exceeded its configured limit/);
  assert.match(socket.destroyError.message, /receive buffer exceeded/);
}

async function testInboxSkipsMalformedRelayThreads() {
  const InboxMethods = require("../src/methods/inbox");
  const http = {
    session: {},
    uuid: () => "device-1",
    postGraphQL: async (name) => {
      if (name === "PolarisDirectInboxQuery") {
        return { data: { get_slide_mailbox_for_iris_subscription: {
          id: "mailbox-1",
          threads_by_folder: {
            edges: [
              null,
              { node: null },
              { node: { as_ig_direct_thread: {} } },
              { node: { as_ig_direct_thread: { id: "thread-1", thread_id: "internal-1", users: [] } } }
            ],
            page_info: { has_next_page: true, end_cursor: "cursor-1" }
          }
        } } };
      }
      if (name === "IGDThreadListOffMsysPaginationQuery") {
        return { data: { fetch__SlideMailbox: { threads_by_folder: {
          edges: [
            { node: { as_ig_direct_thread: { id: "thread-2", thread_id: "internal-2", users: [] } } },
            { node: { as_ig_direct_thread: { thread_title: "missing id" } } }
          ],
          page_info: { has_next_page: false, end_cursor: null }
        } } } };
      }
      throw new Error("Unexpected query: " + name);
    }
  };
  const inbox = new InboxMethods(http, () => "self-1");
  const first = await inbox.getInbox();
  assert.deepEqual(first.threads.map(thread => thread.id), ["thread-1"]);
  const second = await inbox.getInbox(first.nextCursor);
  assert.deepEqual(second.threads.map(thread => thread.id), ["thread-2"]);
  assert.equal(inbox._members.has("undefined"), false);
  assert.equal(inbox._threadIdMap.has("undefined"), false);
}

async function testMalformedRelayEdgeCollectionsAreIgnored() {
  let queryCount = 0;
  const http = {
    session: { __hsi: "device-1" },
    uuid: () => "device-1",
    postGraphQL: async (name) => {
      queryCount += 1;
      if (name === "PolarisDirectInboxQuery") {
        return { data: { get_slide_mailbox_for_iris_subscription: {
          id: "mailbox-1",
          threads_by_folder: {
            edges: { malformed: true },
            page_info: { has_next_page: true, end_cursor: "cursor-1" }
          }
        } } };
      }
      if (name === "IGDThreadListOffMsysPaginationQuery") {
        return { data: { fetch__SlideMailbox: { threads_by_folder: {
          edges: { malformed: true },
          page_info: { has_next_page: false, end_cursor: null }
        } } } };
      }
      if (name === "IGDThreadDetailQuery") {
        return { data: { get_slide_thread_nullable: { as_ig_direct_thread: {
          users: [],
          slide_messages: { edges: { malformed: true } }
        } } } };
      }
      throw new Error("Unexpected query " + name);
    }
  };
  const inbox = new InboxMethods(http, () => "self-1");
  const first = await inbox.getInbox();
  assert.deepEqual(first.threads, []);
  const second = await inbox.getInbox(first.nextCursor || "cursor-1");
  assert.deepEqual(second.threads, []);
  assert.equal(queryCount, 4);
  assert.deepEqual(await inbox.fetchReplies("thread-1"), {});
  assert.deepEqual(await inbox._latestActor("thread-1"), {});
}


async function testMalformedNestedThreadEdgesAreSkipped() {
  const ThreadMethods = require("../src/methods/thread");
  const { threadFbidMap } = require("../src/threadDetail");
  const inbox = new InboxMethods({}, () => "self-1");
  const malformed = [
    null,
    { node: null },
    { node: {} },
    { node: { id: "valid-message", sender_fbid: "fb-1", content_type: "TEXT", text_body: "ok" } }
  ];

  const fromEdges = inbox._threadMessages({ slide_messages: { edges: malformed } });
  assert.deepEqual(fromEdges.map(node => node.id), ["valid-message"]);
  const fromArray = inbox._threadMessages({ slide_messages: [null, { node: null }, { id: "valid-array" }] });
  assert.deepEqual(fromArray.map(node => node.id), ["valid-array"]);

  const mapped = new ThreadMethods({})._mapHistoryEdges(malformed, {});
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].messageID, "valid-message");
  const itemIdOnly = inbox._threadMessages({
    slide_messages: { edges: [{ node: { item_id: "item-id-only", content_type: "TEXT" } }] }
  });
  assert.equal(itemIdOnly[0].id, "item-id-only");
  const mappedItemIdOnly = new ThreadMethods({})._mapHistoryEdges([
    { node: { item_id: "item-id-only", content_type: "TEXT" } }
  ], {});
  assert.equal(mappedItemIdOnly[0].messageID, "item-id-only");
  assert.deepEqual(threadFbidMap({ users: [null, {}, { id: "u-1", interop_messaging_user_fbid: "fb-1" }] }), {
    "fb-1": "u-1"
  });

  const detailHttp = {
    postGraphQL: async () => ({
      data: { get_slide_thread_nullable: { as_ig_direct_thread: {
        users: [null, { id: "u-1", interop_messaging_user_fbid: "fb-1" }],
        slide_messages: { edges: malformed }
      } } }
    })
  };
  const detailInbox = new InboxMethods(detailHttp, () => "self-1");
  const replies = await detailInbox.fetchReplies("thread-1");
  assert.deepEqual(Object.keys(replies), ["valid-message"]);
  const actor = await detailInbox._latestActor("thread-1");
  assert.deepEqual(actor, {});
}


async function testEventNormalizerSkipsMalformedAttachmentsAndMentionIds() {
  const EventNormalizer = require("../src/events/normalizeEvent");
  const normalizer = new EventNormalizer({
    api: {
      getUserInfo: async () => ({ full_name: "Sender" }),
      getUserInfoByUsername: async () => ({ username: "ghost" })
    },
    getUserByUsername: () => null,
    getThreadParticipantIDs: () => ({ malformed: true }),
    rememberThread() {}
  });
  const event = await normalizer.normalize({
    type: "message",
    threadID: "thread-1",
    senderID: "sender-1",
    senderName: "Sender",
    messageID: "message-1",
    body: "hello @ghost",
    attachments: [null, { type: "photo", url: "https://cdn.example/photo.jpg" }],
    timestamp: 1700000000000
  });
  assert.deepEqual(event.mentions, {});
  assert.equal(event.participantIDs, undefined);
  assert.deepEqual(event.attachments, [{
    type: "photo",
    url: "https://cdn.example/photo.jpg",
    filename: null,
    caption: null
  }]);

  const InstaClient = require("../src/app/InstaClient");
  const client = Object.create(InstaClient.prototype);
  client._userIndex = new Map();
  client._picCache = new Map();
  client._threadMembers = new Map();
  client.api = {
    getInbox: async () => ({ threads: [] }),
    getUserInfoByUsername: async () => ({ username: "ghost" })
  };
  assert.deepEqual(await client._resolveMentionsOffline("hello @ghost"), {});
}


async function testCaptionedMediaReplyIsEnrichedFromHistory() {
  const EventNormalizer = require("../src/events/normalizeEvent");
  let historyCalls = 0;
  const normalizer = new EventNormalizer({
    api: {
      getUserInfo: async () => ({ full_name: "Sender" }),
      getThreadHistory: async () => {
        historyCalls += 1;
        return [{
          messageID: "target-message",
          item_id: "target-message",
          senderID: "sender-2",
          senderName: "Photo Sender",
          body: "nice photo",
          itemType: "image",
          attachments: [{ type: "photo", url: "https://cdn.example/photo.jpg", caption: null }],
          timestamp: 1700000000000
        }];
      }
    },
    getUserByUsername: () => null,
    getThreadParticipantIDs: () => [],
    rememberThread() {}
  });
  const event = await normalizer.normalize({
    type: "message",
    threadID: "thread-1",
    senderID: "sender-1",
    senderName: "Sender",
    messageID: "reply-message",
    body: "replying",
    attachments: [],
    timestamp: 1700000001000,
    repliedToItemId: "target-message",
    repliedToMessage: {
      messageID: "target-message",
      senderID: "sender-2",
      senderName: "Photo Sender",
      body: "nice photo",
      itemType: "image",
      attachments: []
    }
  });
  assert.equal(historyCalls, 1);
  assert.equal(event.type, "message_reply");
  assert.equal(event.messageReply.attachments.length, 1);
  assert.equal(event.messageReply.attachments[0].url, "https://cdn.example/photo.jpg");
}


async function testNormalizedReplyRetainsMetadata() {
  const EventNormalizer = require("../src/events/normalizeEvent");
  const { rawEventFromMessageSync } = require("../src/realtime/bridge");
  const raw = rawEventFromMessageSync({
    message: {
      path: "/direct_v2/threads/thread-1/items/item-2",
      op: "add",
      item_type: 1,
      user_id: "sender-1",
      message_id: "mid.message",
      text: "replying",
      replied_to_message: {
        item_id: "target-item",
        message_id: "mid.target",
        user_id: "sender-2",
        content_type: "TEXT",
        text: "quoted text",
        client_context: "client-context-1",
        offline_threading_id: "123456",
        timestamp_ms: 1700000000000
      }
    }
  }, "self-1", {});
  assert.equal(raw.repliedToMessage.clientContext, "client-context-1");
  assert.equal(raw.repliedToMessage.offlineThreadingId, "123456");
  assert.equal(raw.repliedToMessage.itemType, "text");

  const normalizer = new EventNormalizer({
    api: { getUserInfo: async () => ({ full_name: "Reply Sender" }) },
    getUserByUsername: () => null,
    getThreadParticipantIDs: () => ["self-1", "sender-1", "sender-2"],
    rememberThread() {}
  });
  const event = await normalizer.normalize(raw);
  assert.equal(event.type, "message_reply");
  assert.equal(event.messageReply.messageID, "mid.target");
  assert.equal(event.messageReply.itemType, "text");
  assert.equal(event.messageReply.clientContext, "client-context-1");
  assert.equal(event.messageReply.offlineThreadingId, "123456");
  assert.equal(event.messageReply.timestamp, 1700000000000);
}


async function testSessionCookieFilesUseOwnerOnlyPermissions() {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { install } = require("../src/utils/sessionGuard");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hoonica-session-"));
  const filePath = path.join(directory, "appstate.json");
  const client = {
    getAppState: () => [
      { key: "sessionid", value: "session-secret" },
      { key: "csrftoken", value: "csrf-secret" },
      { key: "ds_user_id", value: "12345" }
    ]
  };
  const guard = install(client, filePath);
  try {
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
    client.saveSession();
    const backup = filePath + ".bak";
    assert.equal(fs.statSync(backup).mode & 0o777, 0o600);

    fs.chmodSync(filePath, 0o644);
    fs.chmodSync(backup, 0o644);
    client.saveSession();
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(backup).mode & 0o777, 0o600);

    const { loadOrCreate } = require("../src/deviceIdentity");
    const deviceFile = path.join(directory, "device.json");
    loadOrCreate(deviceFile, "12345678-1234-1234-1234-123456789abc");
    assert.equal(fs.statSync(deviceFile).mode & 0o777, 0o600);
    fs.chmodSync(deviceFile, 0o644);
    loadOrCreate(deviceFile, "12345678-1234-1234-1234-123456789abc");
    assert.equal(fs.statSync(deviceFile).mode & 0o777, 0o600);
  } finally {
    guard.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}


async function testConcurrentTokenBootstrapIsDeduplicated() {
  const HttpClient = require("../src/http");
  const http = new HttpClient({ sessionid: "unit-test-session" });
  let calls = 0;
  let release;
  http.client.get = () => {
    calls += 1;
    return new Promise(resolve => { release = resolve; });
  };
  const html = '"LSD",[],{"token":"lsd-token"} DTSGInitialData",[],{"token":"dtsg-token"}';
  const first = http.bootstrapTokens();
  const second = http.bootstrapTokens();
  assert.equal(calls, 1);
  release({ data: html });
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(results[0], { fbDtsg: "dtsg-token", lsd: "lsd-token" });
  assert.deepEqual(results[1], results[0]);
  assert.equal(http._bootstrapPromise, null);
}


async function testPostFormOmitsNullishFields() {
  const HttpClient = require("../src/http");
  const http = new HttpClient({ sessionid: "unit-test-session" });
  let submitted;
  http.client.post = async (_url, body) => {
    submitted = body;
    return { data: { ok: true } };
  };
  await http.postForm("https://www.instagram.com/test/", {
    keep: "value",
    missing: undefined,
    empty: null,
    zero: 0,
    disabled: false,
    structured: { id: "123" }
  });
  const params = new URLSearchParams(submitted);
  assert.equal(params.get("keep"), "value");
  assert.equal(params.has("missing"), false);
  assert.equal(params.has("empty"), false);
  assert.equal(params.get("zero"), "0");
  assert.equal(params.get("disabled"), "false");
  assert.equal(params.get("structured"), JSON.stringify({ id: "123" }));
}


async function testRetryAfterSupportsHttpDate() {
  const { retryAfterMs } = require("../src/utils/errors");
  assert.equal(retryAfterMs({ response: { headers: { "retry-after": "120" } } }), 120000);
  const target = Date.now() + 120000;
  const headerDate = new Date(target).toUTCString();
  const wait = retryAfterMs({ response: { headers: { "Retry-After": headerDate } } });
  assert.ok(wait > 0 && wait <= 120000);
  assert.equal(retryAfterMs({ response: { headers: { "retry-after": "not-a-date" } } }), 0);
}


async function testExplicitFailureEnvelopeWithoutMessageIsRejected() {
  const HttpClient = require("../src/http");
  const { inspectBody } = require("../src/utils/errors");
  const info = inspectBody({ status: "fail" });
  assert.equal(info.kind, "unknown");
  assert.match(info.message, /without an error message/);

  const authInfo = inspectBody({ require_login: true });
  assert.equal(authInfo.kind, "auth");
  const challengeInfo = inspectBody({ checkpoint_url: "/challenge/" });
  assert.equal(challengeInfo.kind, "challenge");

  const http = new HttpClient({ sessionid: "unit-test-session" });
  await assert.rejects(
    http._onResponse({ status: 200, data: { status: "fail" }, headers: {} }),
    error => error.igKind === "unknown" && /without an error message/.test(error.message)
  );
}


async function testMissingProfileCountsRemainUnknown() {
  const { normalizeWebProfileInfo } = require("../src/profileParse");
  const missing = normalizeWebProfileInfo({
    id: "user-1",
    username: "profile",
    edge_followed_by: null,
    edge_follow: null,
    edge_owner_to_timeline_media: null
  });
  assert.equal(missing.followerCount, null);
  assert.equal(missing.followingCount, null);
  assert.equal(missing.mediaCount, null);

  const present = normalizeWebProfileInfo({
    id: "user-2",
    edge_followed_by: { count: 12 },
    edge_follow: { count: 34 },
    edge_owner_to_timeline_media: { count: 5 }
  });
  assert.equal(present.followerCount, 12);
  assert.equal(present.followingCount, 34);
  assert.equal(present.mediaCount, 5);
}


async function testProfileCacheIsBounded() {
  const UserMethods = require("../src/methods/user");
  const users = new UserMethods({}, null, null);
  users._webProfileInfo = async (username) => ({ username, full_name: username });
  users._profileFromGraphQL = async () => null;
  users._profileFromPage = async () => null;

  for (let i = 0; i < UserMethods.PROFILE_CACHE_MAX + 25; i++) {
    await users.getProfile("profile-user-" + i);
  }
  assert.equal(users._profileCache.size, UserMethods.PROFILE_CACHE_MAX);
  assert.equal(users._profileCache.has("user:profile-user-0"), false);
  assert.equal(users._profileCache.has("user:profile-user-24"), false);
  assert.equal(users._profileCache.has("user:profile-user-25"), true);
}


async function testBoundedSessionCache() {
  const cache = new Map();
  setBounded(cache, "a", 1, 2);
  setBounded(cache, "b", 2, 2);
  setBounded(cache, "a", 3, 2); // refresh insertion order
  setBounded(cache, "c", 4, 2);
  assert.equal(cache.size, 2);
  assert.equal(cache.has("a"), true);
  assert.equal(cache.has("b"), false);
  assert.equal(cache.get("a"), 3);
  assert.equal(cache.get("c"), 4);
  assert.throws(() => setBounded({}, "x", 1, 2), /expects a Map/);

  const inbox = new InboxMethods({}, () => "self-1");
  const threads = Array.from({ length: 2001 }, (_, i) => ({
    id: `thread-${i}`,
    thread_id: `internal-${i}`,
    users: []
  }));
  inbox._rememberInboxThreads(threads);
  assert.equal(inbox._members.size, 2000);
  assert.equal(inbox._threadIdMap.size, 2000);
  assert.equal(inbox._members.has("thread-0"), false);
  assert.equal(inbox._threadIdMap.has("internal-0"), false);
}

async function run() {
  await testCookieInputs();
  await testNestedPacingConfiguration();
  await testTypingStopsOnRateLimitButFallsBackOnUnknown();
  await testLegacyLoginPreservesCookieMaps();
  await testMentionHydrationRetriesAfterInboxFailure();
  await testSharedRealtimeReconnectSurvivesOldAttemptCleanup();
  await testRealtimeHandlersCanRegisterBeforeConnect();
  await testSendLinkUsesPacer();
  await testCaptionAuthFailureDoesNotFallback();
  await testAmbiguousGraphqlSendDoesNotFallback();
  await testLegacyTextFallbackUsesOfflineThreadingId();
  await testPartialGraphqlDataPreventsLegacyFallback();
  await testReadRetryDoesNotRetryThrownErrors();
  await testFirstMessageAfterEmptyInboxPoll();
  await testPollingStopSuppressesInflightResults();
  await testPollingDeliversAllMessagesSinceLastSeen();
  await testInboxCallbackErrorsDoNotEscapeListener();
  await testListenReplacesPreviousPollingListener();
  await testStoppedListenerSuppressesLateStartupError();
  await testPollingSurvivesInconclusiveAuthCheck();
  await testInboxPollerHonorsRetryAfterHeader();
  await testRealtimeAcknowledgementAndReady();
  await testRealtimeMissingAcknowledgementFails();
  await testRealtimeListenerStopDuringClientLookup();
  await testRealtimeFallbackStartsOnlyOnce();
  await testRealtimeFallbackAfterEstablishedDisconnect();
  await testRealtimeConnectFailureClosesTransport();
  await testRealtimeReceiveFailureClosesTransport();
  await testRealtimePacketIdentifierWraps();
  await testDecodePacketRejectsMalformedFrames();
  await testRealtimeConnectCanBeCancelled();
  await testOldRealtimeLoopCannotCloseNewConnection();
  await testRealtimePingIntervalIsClamped();
  await testMqttTransportCancelsPendingTlsSockets();
  await testRelayThreadListPreview();
  await testDirectThreadClassification();
  await testXmaWithoutPreviewHasNoAttachment();
  await testViewerFbidUsesViewerId();
  await testGetUidRejectsContentRoutes();
  await testThriftInt64BigIntMode();
  await testThreadHistoryTimestampPagination();
  await testFcaHistoryTimestampIsForwarded();
  await testInboxCursorPagination();
  await testInboxSkipsMalformedRelayThreads();
  await testBoundedSessionCache();
  await testProfileCacheIsBounded();
  await testMissingProfileCountsRemainUnknown();
  await testExplicitFailureEnvelopeWithoutMessageIsRejected();
  await testRetryAfterSupportsHttpDate();
  await testPostFormOmitsNullishFields();
  await testConcurrentTokenBootstrapIsDeduplicated();
  await testSessionCookieFilesUseOwnerOnlyPermissions();
  await testNormalizedReplyRetainsMetadata();
  await testCaptionedMediaReplyIsEnrichedFromHistory();
  await testEventNormalizerSkipsMalformedAttachmentsAndMentionIds();
  await testMalformedNestedThreadEdgesAreSkipped();
  await testMalformedRelayEdgeCollectionsAreIgnored();
  await testMediaUploadDoesNotRetryPermanentAuthFailure();
  await testMediaCommitDoesNotRetryGraphqlFieldException();
  await testMediaCommitRetryReusesOfflineThreadingId();
  await testMqttTransportRejectsOversizedAndMalformedFrames();
  await testMqttDecompressionOutputIsBounded();
  await testThriftReaderRejectsMalformedAndOversizedValues();
  process.stdout.write("runtime-fixes.test.js: 63 regression tests passed\n");
}

run().catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
