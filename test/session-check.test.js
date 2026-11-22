"use strict";

const assert = require("node:assert/strict");
const HttpClient = require("../src/http");

function makeHttp() {
  const http = new HttpClient({ sessionid: "unit-test-session" });
  http.bootstrapTokens = async () => ({ fbDtsg: "test", lsd: "test" });
  http.hasSessionParams = () => true;
  return http;
}

async function testMissingBrowserParamsIsNotAuth() {
  const http = makeHttp();
  http.hasSessionParams = () => false;
  let called = false;
  http.postGraphQL = async () => { called = true; return { data: {} }; };

  const result = await http.checkSession();
  assert.equal(result.state, "session_params_missing");
  assert.match(result.error.message, /session parameters are missing/i);
  assert.equal(called, false);
}

async function testGraphQLErrorIsNotMisclassifiedAsAuth() {
  const http = makeHttp();
  http.postGraphQL = async () => ({
    errors: [{ message: "Persisted query is no longer available" }]
  });

  const result = await http.checkSession();
  assert.equal(result.state, "graphql_error");
  assert.equal(result.error.name, "InstagramGraphQLError");
  assert.equal(result.error.errorCount, 1);
  assert.doesNotMatch(result.error.message, /sessionid|cookie|token/i);
}

async function testExplicitLoginRequiredIsAuth() {
  const http = makeHttp();
  http.postGraphQL = async () => ({
    errors: [{ message: "login_required" }]
  });

  const result = await http.checkSession();
  assert.equal(result.state, "auth");
}

async function testGraphQLDataIsSuccess() {
  const http = makeHttp();
  http.postGraphQL = async () => ({ data: { viewer: { id: "1" } } });

  const result = await http.checkSession();
  assert.equal(result.state, "ok");
}

async function testEmptyResponseIsUncertainNotAuth() {
  const http = makeHttp();
  http.postGraphQL = async () => ({});

  const result = await http.checkSession();
  assert.equal(result.state, "unexpected_response");
}

async function testThrownAuthenticationErrorRemainsAuth() {
  const http = makeHttp();
  http.postGraphQL = async () => {
    const error = new Error("login_required");
    error.igKind = "auth";
    throw error;
  };

  const result = await http.checkSession();
  assert.equal(result.state, "auth");
}

(async () => {
  await testMissingBrowserParamsIsNotAuth();
  await testGraphQLErrorIsNotMisclassifiedAsAuth();
  await testExplicitLoginRequiredIsAuth();
  await testGraphQLDataIsSuccess();
  await testEmptyResponseIsUncertainNotAuth();
  await testThrownAuthenticationErrorRemainsAuth();
  process.stdout.write("session-check.test.js: 6 tests passed\n");
})().catch((error) => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
