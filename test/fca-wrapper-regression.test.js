"use strict";

const assert = require("node:assert/strict");
const createGetThreadInfo = require("../src/api/threads/getThreadInfo");
const createGetUserFriendship = require("../src/api/users/getUserFriendship");
const createGetUserInfo = require("../src/api/users/getUserInfo");

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
  await testDirectThreadNameDoesNotUseViewer();
  await testUnknownFriendshipReturnsNull();
  await testUserInfoFirstNameIsFirstToken();
  process.stdout.write("fca-wrapper-regression.test.js: 3 tests passed\\n");
})().catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
