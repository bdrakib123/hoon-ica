"use strict";

const assert = require("assert");
const MessageMethods = require("../src/methods/message");
const createEditMessage = require("../src/api/messaging/editMessage");
const HttpClient = require("../src/http");

async function testHttpGraphQLThrowOnError() {
  const http = new HttpClient({ sessionid: "test-session" });
  http.hasSessionParams = () => true;
  http._sessionParams = values => values;
  http._webHeaders = headers => headers;
  const payload = { data: { edit_message: null }, errors: [{ message: "Instagram rejected edit" }] };
  http.client.post = async () => ({ data: payload });

  await assert.rejects(
    http.postGraphQL("IGDirectEditMessageMutation", "doc-id", {}, undefined, { throwOnError: true }),
    error => error.name === "InstagramGraphQLError" &&
      error.friendlyName === "IGDirectEditMessageMutation" &&
      error.errors === payload.errors &&
      error.message === "Instagram rejected edit"
  );
  assert.deepStrictEqual(
    await http.postGraphQL("IGDirectEditMessageMutation", "doc-id", {}),
    payload
  );
}

async function testNativeEditChecksGraphQLErrors() {
  let request;
  const http = {
    offlineThreadingId: () => "123456",
    postGraphQL: async (...args) => {
      request = args;
      assert.strictEqual(args[4].throwOnError, true);
      return { data: { edit_message: { ok: true } } };
    }
  };
  const methods = new MessageMethods(http, {});
  const result = await methods.edit("thread-1", "item-1", "updated");
  assert.deepStrictEqual(result, { messageID: "item-1", edited: true });
  assert.strictEqual(request[0], "IGDirectEditMessageMutation");
  assert.strictEqual(request[2].target_message_id, "item-1");
}

async function testNativeEditPreservesGraphQLError() {
  const graphQLError = Object.assign(new Error("Message cannot be edited"), {
    name: "InstagramGraphQLError",
    errors: [{ message: "Message cannot be edited" }]
  });
  const http = {
    offlineThreadingId: () => "123456",
    postGraphQL: async (_name, _doc, _vars, _referer, opts) => {
      assert.strictEqual(opts.throwOnError, true);
      throw graphQLError;
    }
  };
  const methods = new MessageMethods(http, {});
  assert.strictEqual(await methods.edit("thread-1", "item-1", "updated"), false);
  assert.strictEqual(methods.lastEditError, graphQLError);
}

async function testFcaWrapperExposesFailureWithoutRejecting() {
  const graphQLError = new Error("Instagram edit rejected");
  const client = {
    lastEditError: null,
    _resolveThread: (messageID) => {
      assert.strictEqual(messageID, "item-1");
      return "thread-1";
    },
    api: {
      lastEditError: graphQLError,
      editMessage: async () => false
    }
  };
  const editMessage = createEditMessage(client);
  const result = await editMessage("updated", "item-1");
  assert.strictEqual(result, false);
  assert.strictEqual(client.lastEditError, graphQLError);
}

(async () => {
  await testHttpGraphQLThrowOnError();
  await testNativeEditChecksGraphQLErrors();
  await testNativeEditPreservesGraphQLError();
  await testFcaWrapperExposesFailureWithoutRejecting();
  process.stdout.write("edit.test.js: 4 tests passed\n");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
