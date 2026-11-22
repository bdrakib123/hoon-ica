"use strict";

const assert = require("node:assert/strict");
const createGetThreadInfo = require("../src/api/threads/getThreadInfo");
const createGetUserFriendship = require("../src/api/users/getUserFriendship");
const createGetUserInfo = require("../src/api/users/getUserInfo");
const createGetThreadList = require("../src/api/threads/getThreadList");
const createGetThreadHistory = require("../src/api/threads/getThreadHistory");
const createSetMessageReaction = require("../src/api/messaging/setMessageReaction");
const createUnsendMessage = require("../src/api/messaging/unsendMessage");
const createEditMessage = require("../src/api/messaging/editMessage");
const createSendMessage = require("../src/api/messaging/sendMessage");
const createGetUserProfile = require("../src/api/users/getUserProfile");
const createGetUserID = require("../src/api/users/getUserID");
const createGetSelfInfo = require("../src/api/users/getSelfInfo");
const createGetProfilePictureV2 = require("../src/api/users/getProfilePictureV2");
const createGetProfileBio = require("../src/api/users/getProfileBio");
const createGetUserInfoV2 = require("../src/api/users/getUserInfoV2");
const createShareContact = require("../src/api/messaging/shareContact");

async function testThreadListPaginatesAndHonorsTimestamp() {
  const calls = [];
  const pages = [
    {
      threads: [
        { id: "new-1", read_state: 1, slide_messages: { edges: [{ node: { timestamp_ms: 3000, text_body: "new" } }] } },
        { id: "old-1", read_state: 1, slide_messages: { edges: [{ node: { timestamp_ms: 1000, text_body: "old" } }] } }
      ],
      nextCursor: "cursor-1",
      hasNextPage: true
    },
    {
      threads: [
        { id: "old-2", read_state: 0, slide_messages: { edges: [{ node: { timestamp_ms: 900, text_body: "older" } }] } },
        { id: "old-3", read_state: 1, slide_messages: { edges: [{ node: { timestamp_ms: 800, text_body: "oldest" } }] } }
      ],
      nextCursor: null,
      hasNextPage: false
    }
  ];
  const client = {
    api: {
      getInbox: async (cursor) => {
        calls.push(cursor || null);
        return pages[calls.length - 1];
      }
    }
  };
  const getThreadList = createGetThreadList(client);
  const list = await getThreadList(2, 2000, null);
  assert.deepEqual(calls, [null, "cursor-1"]);
  assert.deepEqual(list.map((item) => item.threadID), ["old-1", "old-2"]);
  assert.equal(list[0].snippet, "old");
}

async function testThreadListUnreadFilterAndCallbackOverload() {
  const client = {
    api: {
      getInbox: async () => ({
        threads: [
          { id: "read", read_state: 0, slide_messages: { edges: [{ node: { timestamp_ms: 2000 } }] } },
          { id: "unread", read_state: 2, slide_messages: { edges: [{ node: { timestamp_ms: 1000 } }] } }
        ],
        nextCursor: null
      })
    }
  };
  const getThreadList = createGetThreadList(client);
  let callbackArgs;
  const list = await getThreadList(10, null, ["INBOX", "unread"], (...args) => { callbackArgs = args; });
  assert.deepEqual(list.map((item) => item.threadID), ["unread"]);
  assert.equal(callbackArgs[0], null);
  assert.deepEqual(callbackArgs[1], list);
  await assert.rejects(() => getThreadList(10, null, ["ARCHIVED"]), /INBOX pagination only/);
}

async function testThreadListSkipsMalformedEntries() {
  const getThreadList = createGetThreadList({
    api: {
      getInbox: async () => ({
        threads: [
          null,
          {},
          { id: null, thread_id: null },
          { id: "", thread_id: "fallback-thread", slide_messages: { edges: [{ node: { timestamp_ms: 1700000000000, text_body: "fallback" } }] } },
          { id: "valid-thread", slide_messages: { edges: [{ node: { timestamp_ms: 1700000000000, text_body: "valid" } }] } }
        ],
        nextCursor: null
      })
    }
  });
  const list = await getThreadList(10);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map(item => item.threadID), ["fallback-thread", "valid-thread"]);
  assert.equal(list[1].snippet, "valid");
}

async function testThreadHistoryPreservesAmountAndCallbackOverloads() {
  const calls = [];
  const client = {
    api: {
      getThreadHistory: async (...args) => {
        calls.push(args);
        return [{ messageID: "m-1" }];
      }
    }
  };
  const getHistory = createGetThreadHistory(client);
  let callbackArgs;
  const withAmountCallback = await getHistory("thread-1", 5, (...args) => { callbackArgs = args; });
  assert.equal(calls[0][1], 5);
  assert.equal(calls[0][2], null);
  assert.deepEqual(callbackArgs, [null, withAmountCallback]);

  const withTimestamp = await getHistory("thread-1", 3, 1700000000000);
  assert.equal(calls[1][1], 3);
  assert.equal(calls[1][2], 1700000000000);

  const callbackOnly = await getHistory("thread-1", (...args) => { callbackArgs = args; });
  assert.equal(calls[2][1], 20);
  assert.equal(calls[2][2], null);
  assert.deepEqual(callbackArgs, [null, callbackOnly]);
}


async function testSuccessCallbackThrowsOnlyOnce() {
  const historyCalls = [];
  const getHistory = createGetThreadHistory({
    api: { getThreadHistory: async () => [{ messageID: "m-1" }] }
  });
  await assert.rejects(
    () => getHistory("thread-1", 5, (error, items) => {
      historyCalls.push([error, items]);
      throw new Error("history callback failed");
    }),
    /history callback failed/
  );
  assert.equal(historyCalls.length, 1);
  assert.equal(historyCalls[0][0], null);

  const listCalls = [];
  const getList = createGetThreadList({
    api: { getInbox: async () => ({ threads: [], nextCursor: null }) }
  });
  await assert.rejects(
    () => getList(5, null, [], (error, items) => {
      listCalls.push([error, items]);
      throw new Error("list callback failed");
    }),
    /list callback failed/
  );
  assert.equal(listCalls.length, 1);
  assert.equal(listCalls[0][0], null);
}


async function testFcaCallbacksAreInvokedOnlyOnceWhenTheyThrow() {
  const invoke = async (operation, label) => {
    let calls = 0;
    await assert.rejects(
      () => operation(() => {
        calls += 1;
        throw new Error(label);
      }),
      new RegExp(label)
    );
    assert.equal(calls, 1, label);
  };

  await invoke(
    cb => createGetThreadInfo({
      api: { getThreadInfo: async () => ({ id: "thread-1", users: [] }) },
      _learnThreads() {}
    })("thread-1", cb),
    "thread info callback"
  );
  await invoke(
    cb => createGetUserFriendship({ api: { _learnedUser: () => ({ id: "u-1", friendship_status: {} }) } })("u-1", cb),
    "friendship callback"
  );
  await invoke(
    cb => createGetUserInfo({
      getUserByUsername: () => ({ id: "u-1", username: "user", full_name: "User Name" }),
      _picCache: new Map(),
      api: {}
    })("u-1", cb),
    "user info callback"
  );
  await invoke(
    cb => createGetUserInfoV2({ getProfile: async () => ({ id: "u-1", fullName: "User" }) })("u-1", cb),
    "user info v2 callback"
  );
  await invoke(
    cb => createGetUserProfile({ getProfile: async () => ({ id: "u-1" }) })("u-1", cb),
    "profile callback"
  );
  await invoke(
    cb => createShareContact({
      api: { getUserInfo: async () => null },
      sendMessage: async () => ({ messageID: "m-1" })
    })("u-1", "u-1", "thread-1", cb),
    "share contact callback"
  );
  await invoke(
    cb => createSendMessage({
      _normalizeForm: () => ({ body: "hello" }),
      convert: value => value,
      api: { sendMessage: async () => ({ message_id: "m-1" }) },
      _msgThread: new Map()
    })("hello", "thread-1", cb),
    "send message callback"
  );
  await invoke(
    cb => createEditMessage({
      _resolveThread: () => "thread-1",
      api: { editMessage: async () => true }
    })("edited", "m-1", cb),
    "edit callback"
  );
  await invoke(
    cb => createUnsendMessage({
      _resolveThread: () => "thread-1",
      api: { unsendMessage: async () => true }
    })("m-1", cb),
    "unsend callback"
  );
  await invoke(
    cb => createSetMessageReaction({
      _resolveThread: () => "thread-1",
      api: { sendReaction: async () => true }
    })("❤️", "m-1", cb),
    "reaction callback"
  );
}


async function testAsyncFcaCallbackRejectionsArePropagated() {
  const getHistory = createGetThreadHistory({
    api: { getThreadHistory: async () => [{ messageID: "m-1" }] }
  });
  await assert.rejects(
    () => getHistory("thread-1", 5, async () => {
      await Promise.resolve();
      throw new Error("async history callback failed");
    }),
    /async history callback failed/
  );

  const getList = createGetThreadList({
    api: { getInbox: async () => ({ threads: [], nextCursor: null }) }
  });
  await assert.rejects(
    () => getList(5, null, [], async () => {
      await Promise.resolve();
      throw new Error("async list callback failed");
    }),
    /async list callback failed/
  );

  const getUserInfo = createGetUserInfo({
    getUserByUsername: () => ({ id: "u-1", username: "user", full_name: "User" }),
    _picCache: new Map(),
    api: {}
  });
  await assert.rejects(
    () => getUserInfo("u-1", async () => {
      await Promise.resolve();
      throw new Error("async user callback failed");
    }),
    /async user callback failed/
  );
}


async function testMultiAttachmentFailureReportsPartialProgress() {
  const attachments = [
    { url: "https://cdn.example/one.jpg" },
    { url: "https://cdn.example/two.jpg" },
    { url: "https://cdn.example/three.jpg" }
  ];
  let attempts = 0;
  const sendMessage = createSendMessage({
    _normalizeForm: () => ({ body: "caption", attachments }),
    _sendAttachment: async () => {
      attempts += 1;
      if (attempts === 2) throw new Error("second attachment failed");
      return { message_id: "sent-first" };
    },
    _msgThread: new Map()
  });
  await assert.rejects(
    () => sendMessage("ignored", "thread-1"),
    error => {
      assert.deepEqual(error.partialSend, {
        sentCount: 1,
        totalAttachments: 3,
        messageIDs: ["sent-first"]
      });
      return true;
    }
  );
  assert.equal(attempts, 2);
}


async function testSendMessageHandlesDeepAndCircularAttachmentArrays() {
  const first = { url: "https://cdn.example/one.jpg" };
  const second = { url: "https://cdn.example/two.jpg" };
  const circular = [first, [second]];
  circular.push(circular);
  let sent = [];
  const sendMessage = createSendMessage({
    _normalizeForm: () => ({ body: "caption", attachment: circular }),
    _sendAttachment: async (_threadID, attachment, caption) => {
      sent.push({ attachment, caption });
      return { message_id: `m-${sent.length}` };
    },
    _msgThread: new Map()
  });
  const result = await sendMessage("ignored", "thread-1");
  assert.deepEqual(sent, [
    { attachment: first, caption: "caption" },
    { attachment: second, caption: "" }
  ]);
  assert.equal(result.messageID, "m-2");
}


async function testAsyncCallbacksPropagateAcrossProfileAndIdAdapters() {
  const rejects = async (operation, message) => {
    await assert.rejects(
      () => operation(async () => {
        await Promise.resolve();
        throw new Error(message);
      }),
      new RegExp(message)
    );
  };
  await rejects(
    cb => createGetProfileBio({ getProfile: async () => ({ id: "u-1", fullName: "User", biography: "bio" }) })("u-1", cb),
    "bio callback failed"
  );
  await rejects(
    cb => createGetProfilePictureV2({
      getProfile: async () => ({ id: "u-1", profilePicUrl: "https://cdn.example/p.jpg" })
    })("u-1", {}, cb),
    "picture callback failed"
  );
  await rejects(
    cb => createGetSelfInfo({
      getCurrentUserID: () => "self-1",
      getUserInfoV2: async () => ({ "self-1": { id: "self-1" } })
    })(cb),
    "self callback failed"
  );
  await rejects(
    cb => createGetUserID({ getProfile: async () => ({ id: "u-1" }) })("friend", cb),
    "id callback failed"
  );

  let selfFailureArgs;
  const selfFailure = await createGetSelfInfo({
    getCurrentUserID: () => { throw new Error("self identity lookup failed"); }
  })((...args) => { selfFailureArgs = args; });
  assert.equal(selfFailure, null);
  assert.match(selfFailureArgs[0].message, /self identity lookup failed/);
  assert.equal(selfFailureArgs[1], null);
}


async function testUserInfoCacheRemainsBounded() {
  const cache = new Map();
  const getUserInfo = createGetUserInfo({
    api: { getUserInfo: async (id) => ({
      id,
      username: "user" + id,
      full_name: "User " + id,
      profile_pic_url: "https://cdn.example/" + id + ".jpg"
    }) },
    getUserByUsername: () => null,
    _picCache: cache
  });
  const ids = Array.from({ length: 2600 }, (_, i) => String(i + 1));
  await getUserInfo(ids);
  assert.equal(cache.size, 5000);
  assert.equal(cache.has("1"), false);
  assert.equal(cache.has("name:1"), false);
  assert.equal(cache.has("2600"), true);
}


async function testShareContactSendsProfileLink() {
  const sent = [];
  const client = {
    api: { getUserInfo: async () => ({ username: "friend_account", full_name: "Friend Person" }) },
    sendMessage: async (form, threadID) => {
      sent.push({ form, threadID });
      return { messageID: "contact-message", threadID };
    }
  };
  const shareContact = createShareContact(client);
  let callbackArgs;
  const result = await shareContact("user-1", "contact-1", "thread-1", (...args) => {
    callbackArgs = args;
  });
  assert.equal(result.messageID, "contact-message");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].threadID, "thread-1");
  assert.match(sent[0].form.body, /https:\/\/instagram\.com\/friend_account/);
  assert.match(sent[0].form.body, /user-1/);
  assert.deepEqual(callbackArgs, [null, result]);
}


async function testDirectThreadNameDoesNotUseViewer() {
  const client = {
    api: {
      getThreadInfo: async () => ({
        is_group: false,
        viewer: { id: "self-1", username: "my_account" },
        users: [{ id: "other-1", username: "friend_account", full_name: "Friend Person" }]
      })
    },
    _learnThreads() {}
  };
  const info = await createGetThreadInfo(client)("thread-1");
  assert.equal(info.threadName, "friend_account");
  assert.deepEqual(info.participantIDs, ["self-1", "other-1"]);
}

async function testUnknownFriendshipReturnsNull() {
  const client = { api: { _learnedUser: () => null } };
  const getFriendship = createGetUserFriendship(client);
  assert.equal(await getFriendship("unknown-user"), null);

  let callbackArgs;
  await getFriendship("unknown-user", (...args) => { callbackArgs = args; });
  assert.equal(callbackArgs[0], null);
  assert.equal(callbackArgs[1], null);
}

async function testUserInfoFirstNameIsFirstToken() {
  const client = {
    api: { getUserInfo: async () => null },
    getUserByUsername: () => ({
      id: "user-1",
      username: "rakib",
      full_name: "Rakib Hasan"
    }),
    _picCache: new Map()
  };
  const result = await createGetUserInfo(client)("user-1");
  assert.equal(result["user-1"].name, "Rakib Hasan");
  assert.equal(result["user-1"].firstName, "Rakib");
}

(async () => {
  await testThreadListPaginatesAndHonorsTimestamp();
  await testThreadListUnreadFilterAndCallbackOverload();
  await testThreadListSkipsMalformedEntries();
  await testThreadHistoryPreservesAmountAndCallbackOverloads();
  await testSuccessCallbackThrowsOnlyOnce();
  await testFcaCallbacksAreInvokedOnlyOnceWhenTheyThrow();
  await testSendMessageHandlesDeepAndCircularAttachmentArrays();
  await testMultiAttachmentFailureReportsPartialProgress();
  await testAsyncFcaCallbackRejectionsArePropagated();
  await testAsyncCallbacksPropagateAcrossProfileAndIdAdapters();
  await testUserInfoCacheRemainsBounded();
  await testShareContactSendsProfileLink();
  await testDirectThreadNameDoesNotUseViewer();
  await testUnknownFriendshipReturnsNull();
  await testUserInfoFirstNameIsFirstToken();
  process.stdout.write("fca-wrapper-regression.test.js: 15 tests passed\n");
})().catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
