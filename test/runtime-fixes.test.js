"use strict";

const assert = require("node:assert/strict");
const { normalizeCookie, toHeader } = require("../src/cookies");
const { SendPacer, globalAntiSuspension } = require("../src/utils/antiSuspension");
const MessageMethods = require("../src/methods/message");
const MediaMethods = require("../src/methods/media");
const { install } = require("../src/utils/readRetry");

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

async function run() {
  await testCookieInputs();
  await testNestedPacingConfiguration();
  await testSendLinkUsesPacer();
  await testCaptionAuthFailureDoesNotFallback();
  await testReadRetryDoesNotRetryThrownErrors();
  await testFirstMessageAfterEmptyInboxPoll();
  await testRealtimeAcknowledgementAndReady();
  await testRealtimeMissingAcknowledgementFails();
  await testRealtimeFallbackStartsOnlyOnce();
  await testRelayThreadListPreview();
  await testDirectThreadClassification();
  await testXmaWithoutPreviewHasNoAttachment();
  await testViewerFbidUsesViewerId();
  await testGetUidRejectsContentRoutes();
  await testThriftInt64BigIntMode();
  await testThreadHistoryTimestampPagination();
  await testFcaHistoryTimestampIsForwarded();
  process.stdout.write("runtime-fixes.test.js: 17 regression tests passed\n");
}

run().catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
