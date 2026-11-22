/*!
 * insta-chat - Unofficial Instagram Chat API
 * Copyright (c) 2026 hoon (https://github.com/Bdrakib123)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 * Original author credit must be retained in all copies and derivatives.
 */

// Bounded retry for the read APIs that callers destructure straight away.
//
// Instagram throttles web reads (HTTP 429). The read wrappers catch that and
// resolve `null` (or an empty result) instead of throwing, but a caller that
// reads the result immediately turns a throttled read into a crash:
//
//   const threadInfo = await client.getThreadInfo(threadID);   // -> null
//   const { userInfo } = threadInfo;                           // TypeError
//
// So a single throttled read looks like a hard failure even though the session
// is fine. Wrap the read methods with a short bounded backoff: a transient null
// is retried until it clears, and the caller answers normally instead of
// erroring out. A real failure (bad id, dead session) still surfaces.
//
// The behaviour is configurable per client through the `readRetry` option —
// `{ attempts, firstWaitMs, maxWaitMs }` — and disabled entirely with
// `readRetry: false`.

const READ_METHODS = ["getThreadInfo", "getUserInfo", "getUserInfoV2"];
const DEFAULT_READ_RETRY = Object.freeze({ attempts: 3, firstWaitMs: 3000, maxWaitMs: 30000 });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Normalizes the option into { attempts, firstWaitMs, maxWaitMs }, or null when
// retry is turned off (`readRetry: false`). Partial overrides keep the defaults
// for the keys they omit.
function resolveConfig(readRetry) {
  if (readRetry === false) return null;
  const given = readRetry && typeof readRetry === "object" ? readRetry : {};
  const cfg = { ...DEFAULT_READ_RETRY, ...given };
  const attempts = Math.max(1, Math.floor(Number(cfg.attempts)) || DEFAULT_READ_RETRY.attempts);
  const firstWaitMs = Number(cfg.firstWaitMs);
  const maxWaitMs = Number(cfg.maxWaitMs);
  return {
    attempts,
    firstWaitMs: Number.isFinite(firstWaitMs) && firstWaitMs >= 0 ? firstWaitMs : DEFAULT_READ_RETRY.firstWaitMs,
    maxWaitMs: Number.isFinite(maxWaitMs) && maxWaitMs >= 0 ? maxWaitMs : DEFAULT_READ_RETRY.maxWaitMs
  };
}

function wrapRead(client, name, cfg) {
  const original = client[name];
  if (typeof original !== "function") return;
  client[name] = async function (...args) {
    // A callback-style call invokes its callback on every attempt, so a retry
    // would fire it more than once. Only the promise style is retried.
    if (args.some((a) => typeof a === "function")) return original.apply(this, args);
    let wait = cfg.firstWaitMs;
    for (let attempt = 1; attempt <= cfg.attempts; attempt += 1) {
      // Exceptions are real request failures (invalid IDs, auth errors, network
      // errors) and must not be converted into a delayed retry. This wrapper
      // only retries the documented null/undefined throttle result.
      const result = await original.apply(this, args);
      if (result !== null && result !== undefined) return result;
      if (attempt >= cfg.attempts) return result;
      await sleep(wait);
      wait = Math.min(wait * 2, cfg.maxWaitMs);
    }
  };
}

// Wraps the read methods on an FCA-shaped client. Returns the client so it can
// be chained from the constructor.
function install(client, readRetry) {
  const cfg = resolveConfig(readRetry);
  if (!cfg) return client;
  for (const name of READ_METHODS) wrapRead(client, name, cfg);
  return client;
}

module.exports = { install, resolveConfig, READ_METHODS, DEFAULT_READ_RETRY };
