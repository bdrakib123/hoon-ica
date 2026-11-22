"use strict";

const assert = require("node:assert/strict");
const { AdaptiveRateLimiter, CircuitBreaker, IdempotencyCache } = require("../index");

async function run() {
  const limiter = new AdaptiveRateLimiter({
    globalMinDelayMs: 0,
    perUrlBaseDelayMs: 100,
    maxDelayMs: 1000,
    relaxAfterSuccesses: 1,
    relaxFactor: 0.5
  });
  limiter.recordResponse("https://www.instagram.com/api/v1/inbox/?a=1", {
    status: 429,
    headers: { "retry-after": "2" }
  });
  const snapshot = limiter.snapshot();
  assert.equal(Object.values(snapshot)[0].delayMs, 1000);
  limiter.recordResponse("https://www.instagram.com/api/v1/inbox/?a=2", { status: 200 });
  assert.equal(Object.values(limiter.snapshot())[0].delayMs, 500);
  limiter.recordResponse("https://www.instagram.com/api/v1/inbox/?a=3", {
    status: 429,
    headers: { "Retry-After": new Date(Date.now() + 5000).toUTCString() }
  });
  assert.equal(Object.values(limiter.snapshot())[0].delayMs, 1000);
  limiter.recordResponse("https://www.instagram.com/api/v1/inbox/?a=4", {
    status: 429,
    headers: { "retry-after": "0" }
  });
  assert.equal(Object.values(limiter.snapshot())[0].delayMs, 0);

  const pacing = new AdaptiveRateLimiter({
    globalMinDelayMs: 100,
    perUrlBaseDelayMs: 200
  });
  pacing.markRequest("https://www.instagram.com/api/v1/inbox/", 1000);
  assert.equal(pacing.recommendDelay("https://www.instagram.com/api/v1/threads/", 1000), 100);
  assert.equal(pacing.recommendDelay("https://www.instagram.com/api/v1/inbox/", 1000), 200);

  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 5 });
  await assert.rejects(
    breaker.run("ig-read", async () => {
      const error = new Error("temporary network error");
      error.code = "ECONNRESET";
      throw error;
    })
  );
  assert.equal(breaker.state("ig-read"), "open");
  await new Promise(resolve => setTimeout(resolve, 10));

  let releaseProbe;
  const probeGate = new Promise(resolve => { releaseProbe = resolve; });
  const probe = breaker.run("ig-read", async () => {
    await probeGate;
    return "recovered";
  });
  await assert.rejects(breaker.run("ig-read", async () => "duplicate probe"), { code: "CIRCUIT_OPEN" });
  releaseProbe();
  assert.equal(await probe, "recovered");
  assert.equal(breaker.state("ig-read"), "closed");

  // A late success from a request that began before the breaker opened must
  // not close the circuit after a concurrent request reaches the threshold.
  const raceBreaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10000 });
  let releaseLateSuccess;
  let releaseFailure;
  const lateSuccessGate = new Promise(resolve => { releaseLateSuccess = resolve; });
  const failureGate = new Promise(resolve => { releaseFailure = resolve; });
  const lateSuccess = raceBreaker.run("concurrent", async () => {
    await lateSuccessGate;
    return "late success";
  });
  const concurrentFailure = raceBreaker.run("concurrent", async () => {
    await failureGate;
    const error = new Error("concurrent network failure");
    error.code = "ECONNRESET";
    throw error;
  });
  releaseFailure();
  await assert.rejects(concurrentFailure, /concurrent network failure/);
  assert.equal(raceBreaker.state("concurrent"), "open");
  releaseLateSuccess();
  assert.equal(await lateSuccess, "late success");
  assert.equal(raceBreaker.state("concurrent"), "open");

  // A request that began before the breaker opened must not release a
  // half-open probe lock when it eventually settles.
  const staleBreaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 5 });
  let releaseStaleSuccess;
  let releaseOpenFailure;
  let releaseStaleProbe;
  const staleSuccess = staleBreaker.run("stale-probe", () => new Promise(resolve => {
    releaseStaleSuccess = resolve;
  }));
  const openingFailure = staleBreaker.run("stale-probe", () => new Promise((_, reject) => {
    releaseOpenFailure = reject;
  }));
  const openError = new Error("opens circuit");
  openError.code = "ECONNRESET";
  releaseOpenFailure(openError);
  await assert.rejects(openingFailure, /opens circuit/);
  await new Promise(resolve => setTimeout(resolve, 10));
  const activeProbe = staleBreaker.run("stale-probe", () => new Promise(resolve => {
    releaseStaleProbe = resolve;
  }));
  releaseStaleSuccess("late success");
  assert.equal(await staleSuccess, "late success");
  await assert.rejects(
    staleBreaker.run("stale-probe", async () => "duplicate probe"),
    { code: "CIRCUIT_OPEN" }
  );
  releaseStaleProbe("probe recovered");
  assert.equal(await activeProbe, "probe recovered");

  const boundedLimiter = new AdaptiveRateLimiter({ maxEndpoints: 2 });
  boundedLimiter.recommendDelay("https://example.com/a");
  boundedLimiter.recommendDelay("https://example.com/b");
  boundedLimiter.recommendDelay("https://example.com/c");
  assert.equal(boundedLimiter.endpoints.size, 2);
  assert.equal(boundedLimiter.endpoints.has("https://example.com/a"), false);

  const boundedBreaker = new CircuitBreaker({ maxCircuits: 2 });
  boundedBreaker.state("one");
  boundedBreaker.state("two");
  boundedBreaker.state("three");
  assert.equal(Object.keys(boundedBreaker.snapshot()).length, 2);

  const boundedIdempotency = new IdempotencyCache({
    ttlMs: Infinity,
    maxSize: Infinity,
    maxInflight: 1
  });
  assert.equal(boundedIdempotency.ttlMs, 300000);
  assert.equal(boundedIdempotency.maxSize, 1000);
  assert.equal(boundedIdempotency.maxInflight, 1);
  let releaseInflight;
  const pending = boundedIdempotency.run("pending", () => new Promise(resolve => { releaseInflight = resolve; }));
  await Promise.resolve();
  await assert.rejects(boundedIdempotency.run("second-pending", async () => "blocked"), /in-flight limit/);
  releaseInflight("done");
  assert.equal(await pending, "done");

  const cache = new IdempotencyCache({ ttlMs: 1000, maxSize: 5 });
  let calls = 0;
  const operation = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 2));
    return { messageID: "m-1" };
  };
  const [first, second] = await Promise.all([
    cache.run("same-action", operation),
    cache.run("same-action", operation)
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(await cache.run("same-action", operation), first);
  assert.equal(calls, 1);

  await assert.rejects(cache.run("retry-after-failure", async () => {
    throw new Error("temporary");
  }));
  assert.equal(await cache.run("retry-after-failure", async () => "retried"), "retried");

  const clearingCache = new IdempotencyCache({ ttlMs: 1000, maxSize: 2 });
  let releaseStale;
  const staleRun = clearingCache.run("same-key", () => new Promise(resolve => {
    releaseStale = resolve;
  }));
  await Promise.resolve();
  clearingCache.clear();
  const freshRun = clearingCache.run("same-key", async () => "fresh");
  releaseStale("stale");
  assert.equal(await staleRun, "stale");
  assert.equal(await freshRun, "fresh");
  assert.equal(clearingCache.get("same-key"), "fresh");

  clearingCache.set("second", 2);
  clearingCache.set("third", 3);
  assert.equal(clearingCache.get("same-key"), undefined);
  assert.equal(clearingCache.get("third"), 3);

  process.stdout.write("reliability-utils.test.js: all checks passed\n");
}

run().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
