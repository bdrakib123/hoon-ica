"use strict";

const assert = require("node:assert/strict");
const createGetThreadInfo = require("../src/api/threads/getThreadInfo");
const createGetUserFriendship = require("../src/api/users/getUserFriendship");
const createGetUserInfo = require("../src/api/users/getUserInfo");
const createGetThreadList = require("../src/api/threads/getThreadList");
const createGetThreadHistory = require("../src/api/threads/getThreadHistory");

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
  const list = await getThreadList(2, 2000, ["INBOX"]);
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
  await testUserInfoCacheRemainsBounded();
  await testDirectThreadNameDoesNotUseViewer();
  await testUnknownFriendshipReturnsNull();
  await testUserInfoFirstNameIsFirstToken();
  process.stdout.write("fca-wrapper-regression.test.js: 8 tests passed\n");
})().catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
