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

async function run() {
  await testCookieInputs();
  await testNestedPacingConfiguration();
  await testSendLinkUsesPacer();
  await testCaptionAuthFailureDoesNotFallback();
  await testReadRetryDoesNotRetryThrownErrors();
  process.stdout.write("runtime-fixes.test.js: 5 regression tests passed\\n");
}

run().catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
