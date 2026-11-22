"use strict";

// Diagnostic reproductions for issues found during the comprehensive source audit.
// Kept separate from the normal test gate: these checks confirm current bug
// signatures without changing runtime code or the release test command.
// After a fix, update the corresponding check to assert the corrected behavior.

const assert = require("node:assert/strict");
const { normalizeCookie } = require("../src/cookies");
const createGetUID = require("../src/api/users/getUID");
const createGetThreadList = require("../src/api/threads/getThreadList");
const createGetThreadHistory = require("../src/api/threads/getThreadHistory");
const createGetThreadInfo = require("../src/api/threads/getThreadInfo");
const { SendPacer } = require("../src/utils/antiSuspension");
const { attachmentsFromContent } = require("../src/messageContent");
const { threadFbidMap } = require("../src/threadDetail");
const { install: installReadRetry } = require("../src/utils/readRetry");
const { EventEmitter } = require("node:events");
const { RealtimeListener } = require("../src/realtime/listener");
const MediaMethods = require("../src/methods/media");

const reproduced = [];

async function reproduce(name, check) {
  await check();
  reproduced.push(name);
  process.stdout.write("REPRODUCED: " + name + "\n");
}

async function main() {
  await reproduce("cookie object/array input throws before normalization", async () => {
    assert.throws(() => normalizeCookie({ sessionid: "session-value", csrftoken: "csrf-value" }), TypeError);
    assert.throws(() => normalizeCookie([{ key: "sessionid", value: "session-value" }]), TypeError);
  });

  await reproduce("getUID treats a reel route as a username", async () => {
    const getUID = createGetUID({ userID: "self-uid" });
    assert.equal(getUID("https://www.instagram.com/reel/ABC123/"), "reel");
    assert.equal(getUID("https://www.instagram.com/p/ABC123/"), "p");
  });

  await reproduce("getThreadList ignores Relay slide_messages preview", async () => {
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
    assert.equal(thread.snippet, "");
    assert.equal(thread.timestamp, null);
  });

  await reproduce("anti-suspension configure does not update nested cooldown values", async () => {
    const pacer = new SendPacer();
    try {
      pacer.configure({ cooldownMs: 1234, strikesToActivate: 5 });
      assert.equal(pacer.baseCooldownMs, 60 * 60 * 1000);
      assert.equal(pacer.cooldown.strikesToActivate, 2);
      assert.equal(pacer.cooldownMs, 1234);
      assert.equal(pacer.strikesToActivate, 5);
    } finally {
      pacer.destroy();
    }
  });

  await reproduce("getThreadInfo marks a one-to-one DM as a group when is_group is absent", async () => {
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
    assert.equal(info.isGroup, true);
  });

  await reproduce("XMA text body is incorrectly returned as an attachment URL", async () => {
    const attachments = attachmentsFromContent({
      __typename: "SlideMessageXMAContent",
      xma_text_body: "Shared a post with you",
      xma: {}
    });
    assert.deepEqual(attachments, [{
      type: "share",
      url: "Shared a post with you",
      caption: null
    }]);
  });

  await reproduce("threadFbidMap creates an undefined viewer ID mapping", async () => {
    const map = threadFbidMap({
      viewer: {
        id: "viewer-ig-id",
        interop_messaging_user_fbid: "viewer-fbid"
      }
    });
    assert.equal(map["viewer-fbid"], "undefined");
  });

  await reproduce("readRetry retries thrown permanent errors instead of surfacing immediately", async () => {
    let calls = 0;
    const client = {
      getThreadInfo: async () => {
        calls += 1;
        throw new Error("invalid thread id");
      }
    };
    installReadRetry(client, { attempts: 2, firstWaitMs: 0, maxWaitMs: 0 });
    await assert.rejects(client.getThreadInfo("bad-id"), /invalid thread id/);
    assert.equal(calls, 2);
  });

  await reproduce("RealtimeListener omits onReady after a cursor subscription", async () => {
    class FakeRealtimeClient extends EventEmitter {
      constructor() {
        super();
        this.connected = true;
        this.subscriptions = [];
      }
      async connect() { this.connected = true; }
      async irisSubscribe(seqId, snapshotAtMs) {
        this.subscriptions.push({ seqId, snapshotAtMs });
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
    assert.equal(readyCalls, 0);
    listener.stop();
  });


  await reproduce("getThreadHistory ignores its timestamp argument", async () => {
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

  await reproduce("media caption falls back to legacy send after an auth error", async () => {
    let legacyCalls = 0;
    const media = new MediaMethods({
      offlineThreadingId: () => "offline-1",
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
    await media._sendCaption("thread-1", "caption");
    assert.equal(legacyCalls, 1);
  });

  process.stdout.write("\nAudit reproductions: " + reproduced.length + " confirmed\n");
  process.stdout.write("These checks reproduce current defects; they are not passing regression assertions.\n");
}

main().catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
