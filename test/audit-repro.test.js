"use strict";

// Mixed audit checks for the comprehensive source audit.
// Fixed cases assert corrected behavior; unresolved cases retain controlled
// source-level defect signatures. This suite is separate from the release gate.

const assert = require("node:assert/strict");
const { normalizeCookie } = require("../src/cookies");
const createGetUID = require("../src/api/users/getUID");
const createGetThreadList = require("../src/api/threads/getThreadList");
const createGetThreadHistory = require("../src/api/threads/getThreadHistory");
const createGetThreadInfo = require("../src/api/threads/getThreadInfo");
const { SendPacer, globalAntiSuspension } = require("../src/utils/antiSuspension");
const MessageMethods = require("../src/methods/message");
const { attachmentsFromContent } = require("../src/messageContent");
const { threadFbidMap } = require("../src/threadDetail");
const { install: installReadRetry } = require("../src/utils/readRetry");
const { EventEmitter } = require("node:events");
const { RealtimeListener } = require("../src/realtime/listener");
const MediaMethods = require("../src/methods/media");
const InboxMethods = require("../src/methods/inbox");
const { ThriftWriter, ThriftReader, ThriftTypes } = require("../src/realtime/mqttot");

const checked = [];

async function checkCase(name, check) {
  await check();
  checked.push(name);
  process.stdout.write("CHECKED: " + name + "\n");
}

async function main() {
  await checkCase("documented cookie object/array inputs normalize correctly", async () => {
    assert.deepEqual(normalizeCookie({ sessionid: "session-value", csrftoken: "csrf-value" }), {
      sessionid: "session-value", csrftoken: "csrf-value"
    });
    assert.deepEqual(normalizeCookie([{ name: "sessionid", value: "session-value" }]), {
      sessionid: "session-value"
    });
  });

  await checkCase("getUID ignores reel and post routes instead of treating them as usernames", async () => {
    const getUID = createGetUID({ userID: "self-uid" });
    assert.equal(getUID("https://www.instagram.com/reel/ABC123/"), "self-uid");
    assert.equal(getUID("https://www.instagram.com/p/ABC123/"), "self-uid");
    assert.equal(getUID("https://www.instagram.com/rakib.hasan/"), "rakib.hasan");
  });

  await checkCase("getThreadList reads Relay slide_messages preview", async () => {
    const getThreadList = createGetThreadList({
      api: {
        getInbox: async () => ({
          threads: [{
            id: "thread-1",
            slide_messages: {
              edges: [{
                node: {
                  text_body: "latest Relay message",
                  timestamp_ms: 1700000000000
                }
              }]
            }
          }]
        })
      }
    });
    const [thread] = await getThreadList(10);
    assert.equal(thread.snippet, "latest Relay message");
    assert.equal(thread.timestamp, 1700000000000);
  });

  await checkCase("anti-suspension configure updates nested cooldown values", async () => {
    const pacer = new SendPacer();
    try {
      pacer.configure({ cooldownMs: 1234, strikesToActivate: 5 });
      assert.equal(pacer.baseCooldownMs, 1234);
      assert.equal(pacer.cooldown.durationMs, 1234);
      assert.equal(pacer.cooldown.strikesToActivate, 5);
    } finally {
      pacer.destroy();
    }
  });

  await checkCase("getThreadInfo marks a one-to-one DM as a group when is_group is absent", async () => {
    const getThreadInfo = createGetThreadInfo({
      api: {
        getThreadInfo: async () => ({
          viewer: { id: "self-1", username: "bot" },
          users: [{ id: "friend-1", username: "friend" }]
        })
      },
      _learnThreads() {}
    });
    const info = await getThreadInfo("thread-1");
    assert.deepEqual(info.participantIDs, ["self-1", "friend-1"]);
    assert.equal(info.isGroup, false);
  });

  await checkCase("XMA text body is not returned as an attachment URL", async () => {
    const attachments = attachmentsFromContent({
      __typename: "SlideMessageXMAContent",
      xma_text_body: "Shared a post with you",
      xma: {}
    });
    assert.deepEqual(attachments, []);
  });

  await checkCase("threadFbidMap uses the viewer's own ID", async () => {
    const map = threadFbidMap({
      viewer: {
        id: "viewer-ig-id",
        interop_messaging_user_fbid: "viewer-fbid"
      }
    });
    assert.equal(map["viewer-fbid"], "viewer-ig-id");
  });

  await checkCase("readRetry surfaces thrown errors without retrying", async () => {
    let calls = 0;
    const client = {
      getThreadInfo: async () => {
        calls += 1;
        throw new Error("invalid thread id");
      }
    };
    installReadRetry(client, { attempts: 2, firstWaitMs: 0, maxWaitMs: 0 });
    await assert.rejects(client.getThreadInfo("bad-id"), /invalid thread id/);
    assert.equal(calls, 1);
  });

  await checkCase("RealtimeListener invokes onReady after an acknowledged cursor subscription", async () => {
    class FakeRealtimeClient extends EventEmitter {
      constructor() {
        super();
        this.connected = true;
        this.subscriptions = [];
      }
      async connect() { this.connected = true; }
      async irisSubscribe(seqId, snapshotAtMs) {
        this.subscriptions.push({ seqId, snapshotAtMs });
        this.emit("iris_sub_response", { status: "ok" });
      }
      disconnect() {}
    }
    const fake = new FakeRealtimeClient();
    let readyCalls = 0;
    const listener = new RealtimeListener({}, {
      getClient: async () => fake,
      seqId: 7,
      snapshotAtMs: 1700000000000,
      onReady: () => { readyCalls += 1; }
    });
    await listener.start(() => {});
    assert.deepEqual(fake.subscriptions, [{ seqId: 7, snapshotAtMs: 1700000000000 }]);
    assert.equal(readyCalls, 1);
    listener.stop();
  });


  await checkCase("realtime error and disconnect events start only one polling fallback", async () => {
    class FakeRealtimeClient extends EventEmitter {
      constructor() {
        super();
        this.connected = true;
      }
      async connect() { this.connected = true; }
      disconnect() {}
    }
    const fake = new FakeRealtimeClient();
    const inbox = new InboxMethods({
      getCookie: () => "session-value"
    }, () => "self-1", {
      realtime: { enabled: true, getRealtimeState: async () => null },
      getSharedClient: () => fake
    });
    let fallbackStarts = 0;
    inbox._startPolling = () => {
      fallbackStarts += 1;
      return () => {};
    };
    const stop = inbox.listen(() => {});
    await new Promise((resolve) => setImmediate(resolve));
    fake.emit("error", new Error("socket receive failed"));
    fake.emit("disconnected", {});
    assert.equal(fallbackStarts, 1);
    stop();
  });

  await checkCase("RealtimeListener rejects an unacknowledged iris subscription", async () => {
    class FakeRealtimeClient extends EventEmitter {
      constructor() {
        super();
        this.connected = true;
      }
      async connect() { this.connected = true; }
      async irisSubscribe() {
        // Simulate a successful socket write with no iris_sub_response.
      }
      disconnect() {}
    }
    const fake = new FakeRealtimeClient();
    const listener = new RealtimeListener({}, {
      getClient: async () => fake,
      seqId: 9,
      snapshotAtMs: 1700000000000,
      subscriptionTimeoutMs: 20
    });
    await assert.rejects(
      listener.start(() => {}),
      /acknowledgement timed out/
    );
    assert.equal(listener._subscribed, false);
    assert.equal(fake.listenerCount("iris_sub_response"), 0);
    listener.stop();
  });

  await checkCase("getThreadHistory ignores its timestamp argument", async () => {
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
    assert.deepEqual(received, ["thread-1", 20]);
  });

  await checkCase("first DM is delivered after an empty initial inbox poll", async () => {
    const inbox = new InboxMethods({}, () => "self-1");
    let polls = 0;
    inbox.getInbox = async () => {
      polls += 1;
      if (polls === 1) return { threads: [] };
      return {
        threads: [{
          id: "thread-1",
          users: [{ id: "friend-1" }],
          slide_messages: {
            edges: [{ node: { id: "message-1", content_type: "TEXT", text_body: "first DM", timestamp_ms: 1700000000000 } }]
          }
        }]
      };
    };

    const scheduled = [];
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    let stop;
    let received = 0;
    try {
      global.setTimeout = (fn) => {
        const timer = { fn, unref() {} };
        scheduled.push(timer);
        return timer;
      };
      global.clearTimeout = () => {};
      stop = inbox._startPolling(() => { received += 1; }, 2000);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(scheduled.length, 1);
      scheduled.shift().fn();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(scheduled.length, 1);
      scheduled.shift().fn();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(polls, 3);
      assert.equal(received, 1);
      assert.equal(inbox._seen.get("thread-1"), "message-1");
    } finally {
      if (stop) stop();
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  });

  await checkCase("sendLink uses the configured outbound send pacer", async () => {
    const originalWaitForTurn = globalAntiSuspension.waitForTurn;
    let pacingCalls = 0;
    globalAntiSuspension.waitForTurn = async () => { pacingCalls += 1; };
    try {
      const methods = new MessageMethods({
        uuid: () => "client-context",
        postForm: async () => ({ status: "ok" })
      }, {});
      await methods.sendLink("thread-1", "https://example.com", "example");
      assert.equal(pacingCalls, 1);
    } finally {
      globalAntiSuspension.waitForTurn = originalWaitForTurn;
    }
  });

  await checkCase("getInbox ignores a supplied pagination cursor", async () => {
    let variables;
    const inbox = new InboxMethods({
      session: { __hsi: "device-1" },
      uuid: () => "device-1",
      postGraphQL: async (_name, _docId, vars) => {
        variables = vars;
        return { data: { get_slide_mailbox_for_iris_subscription: { threads_by_folder: { edges: [] } } } };
      }
    }, () => "self-1");
    await inbox.getInbox("next-page-cursor");
    assert.equal(Object.prototype.hasOwnProperty.call(variables, "cursor"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(variables, "before"), false);
  });

  await checkCase("media caption does not fallback to legacy send after an auth error", async () => {
    let legacyCalls = 0;
    const media = new MediaMethods({
      offlineThreadingId: () => "offline-1",
      uuid: () => "client-context-1",
      postGraphQL: async () => {
        const error = new Error("login required");
        error.response = { status: 401, data: { message: "login_required" } };
        throw error;
      },
      postForm: async () => {
        legacyCalls += 1;
        return { status: "ok" };
      }
    }, {});
    await assert.rejects(media._sendCaption("thread-1", "caption"), /login required/);
    assert.equal(legacyCalls, 0);
  });

  await checkCase("Thrift INT64 supports exact opt-in BigInt decoding without changing the default", async () => {
    const original = 9007199254740993n;
    const writer = new ThriftWriter();
    writer.writeInt(1, original, 64);
    writer.writeStop();
    const bytes = Buffer.from(writer.buffer);
    const legacyReader = new ThriftReader(bytes);
    const legacyType = legacyReader.readField();
    const legacyDecoded = legacyReader.readValue(legacyType, null);
    assert.equal(legacyDecoded, Number(original));
    assert.notEqual(BigInt(legacyDecoded), original);
    const exactReader = new ThriftReader(bytes, { int64AsBigInt: true });
    const exactType = exactReader.readField();
    assert.equal(exactReader.readValue(exactType, null), original);
  });

  process.stdout.write("\nAudit checks: " + checked.length + " checked\n");
  process.stdout.write("Cases marked CHECKED may assert either corrected behavior or a remaining source-level defect signature. Not a live Instagram validation.\n");
}

main().catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
