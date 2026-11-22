# Comprehensive Source Audit — Hoon ICA

Branch: `audit/comprehensive-bug-hunt`  
Baseline: `audit/fca-wrapper-regression`  
Scope: source inspection and diagnostic reproduction cases only.

## Validation status (2026-11-22)

- The user ran the diagnostic suite locally in UserLAnd on **Node.js v20.20.2** and **npm 10.8.2**.
- `npm install` completed successfully and reported **0 vulnerabilities**.
- `npm run audit:repro` completed with exit code 0 and reported **17 reproduced / 17 diagnostic cases**.
- `git status --short` was empty after the run.
- These are controlled local runtime reproductions of the current source behavior, **not live Instagram validation**.
- No live Instagram login, DM, MQTT subscription, media upload, or account action was performed.
- Runtime fixes are now being made only on `audit/comprehensive-bug-hunt`, after the user authorized this work.
- The normal `npm test` command now includes `test/runtime-fixes.test.js`; the separate `audit:repro` script has been converted to check corrected behavior for fixed cases and retain diagnostics for remaining candidates.
- The published `@cexi/hoonica@1.0.0` release and `release/1.0.0` remain untouched.
- The new regression tests have been authored but have **not yet been executed** in Node. GitHub source editing does not constitute a test run.

## Diagnostic reproduction inventory

| # | Area | Source-level finding | Diagnostic case |
|---:|---|---|---|
| 1 | Cookie normalization | **Fixed:** documented object and browser cookie-array inputs are normalized before string parsing. | regression test added |
| 2 | UID parsing | URL parsing captures the first path segment, so `/reel/...` and `/p/...` are returned as usernames. | getUID treats a reel route as a username |
| 3 | Thread list | **Fixed:** reads preview text and timestamp from Relay `slide_messages`, with legacy `items` fallback. | regression test added |
| 4 | Anti-suspension config | **Fixed:** `cooldownMs` and `strikesToActivate` update the nested cooldown state consumed by activation. | regression test added |
| 5 | Thread classification | **Fixed:** fallback group classification now requires more than two participants after viewer normalization. | regression test added |
| 6 | XMA attachments | **Fixed:** XMA text is no longer exposed as a URL; a share attachment requires a preview URL. | regression test added |
| 7 | FBID mapping | **Fixed:** viewer mapping uses `viewer.id` / `viewer.pk` before the legacy top-level fallback and omits missing IDs. | regression test added |
| 8 | Read retry | **Fixed:** thrown exceptions surface immediately; only null/undefined results are retried. | regression test added |
| 9 | Realtime readiness | **Fixed:** `onReady` runs after a cursor subscription is acknowledged. | regression test added |
| 10 | Realtime fallback | **Fixed:** polling fallback is guarded so error/disconnect/start rejection can start it only once. | regression test added |
| 11 | Realtime acknowledgement | **Fixed:** listener waits for `iris_sub_response`; missing acknowledgement times out and is not marked subscribed. | regression test added |
| 12 | Thread history | FCA wrapper accepts a timestamp argument but does not pass it to the native history method. | timestamp argument ignored |
| 13 | Inbox polling | **Fixed:** the first successful poll primes state even when empty, so the first later DM is emitted. | regression test added |
| 14 | Link sending | **Fixed:** `sendLink()` takes a turn from the shared outbound send pacer. | regression test added |
| 15 | Inbox pagination | Native `getInbox()` takes no cursor argument and sends fixed query variables; a supplied cursor is ignored. | getInbox ignores pagination cursor |
| 16 | Media caption fallback | **Fixed:** auth/challenge/blocked/rate-limit errors do not fall back to legacy caption sending. | regression test added |\n| 17 | Thrift integer precision | `ThriftReader.readValue()` converts every INT64 to JavaScript `Number`, losing exact values above `Number.MAX_SAFE_INTEGER`. | INT64 precision loss |

## Runtime fix progress (2026-11-22)

**13 of the 17 original diagnostic cases now have source fixes and regression assertions** on this branch: #1, #3–#11, #13, #14, and #16. The other four (#2 UID URL parsing, #12 history timestamp, #15 inbox cursor, and #17 Thrift INT64 precision) remain open pending contract/consumer review.

New test file: `test/runtime-fixes.test.js` (13 focused regression checks). It has been added to the normal `npm test` command. The legacy `audit:repro` checks were updated so fixed cases assert the corrected behavior rather than the old defect signature.

**Execution status:** these new tests and the full normal test suite have not yet been run in Node after the source edits. Do not treat source review or successful GitHub commits as test passes.

## Additional source-review candidates (not yet diagnostic tests)

These require more focused fixtures, payload captures, or runtime validation before being treated as defects:

- `getThreadList(limit, timestamp, tags, callback)` accepts timestamp and tags but currently ignores both.
- The fallback group-count rules in thread-list and thread-detail wrappers are not consistent; validate against captured inbox and thread-detail payloads before changing either.
- Verify whether inbox/realtime participant lists consistently include the viewer/self ID for every event type.
- Exercise cache/map growth under long-running multi-thread load; source inspection alone cannot establish a practical memory leak.
- Verify media upload and commit error classification against real response shapes, especially transient 412 and authentication/challenge responses.
- Determine which decoded INT64 fields require exact integer fidelity. The diagnostic fixture now demonstrates precision loss above `Number.MAX_SAFE_INTEGER`; audit consumers before choosing a BigInt/string-compatible public representation.


- Long-lived inbox instances retain `_seen`, `_threadIdMap`, `_members`, and `_threadState` entries for threads that disappear from later inbox snapshots. This is a potential unbounded-growth/stale-state issue; validate expected thread churn and whether these maps need TTL/LRU pruning before classifying it as a confirmed defect.

## Recommended next validation sequence

1. Run `npm run audit:repro` on Node 20 and capture the complete output.
2. Separate test-harness failures from reproduced source signatures.
3. Add fixtures for the additional candidates only after verifying their actual payload contracts.
4. For each accepted defect, invert its diagnostic assertion into a correct-behavior regression test before proposing a runtime fix.
5. Obtain explicit approval before changing runtime source, merging, publishing, or testing against a live Instagram account.


## Initial severity triage (provisional)

Severity reflects likely impact from source behavior, not confirmed production incidence. Validate against supported payloads and account-safe fixtures before fixing.

### P1 — original high-priority cases (status updated)
- **Fixed on branch:** #1 cookie normalization, #10–11 realtime fallback/acknowledgement, #13 first inbox message, #14 sendLink pacing, and #16 media auth fallback. Regression tests are authored; execution is pending.
- **Still open:** #17 Thrift INT64 precision. Exact large identifiers/values may be corrupted; inspect consumers and wire schema before choosing a compatible representation.

### P2 — fix after P1, with contract fixtures
- **Fixed on branch:** #3 thread-list preview, #5 DM/group classification, #6 XMA attachment URL, #7 viewer FBID mapping, #8 read retry policy, and #9 realtime readiness callback.
- **Still open:** #12 history timestamp and #15 inbox cursor (confirm public API semantics first), plus #2 UID URL parsing (confirm whether post/reel routes should be rejected or handled specially).

### Required before runtime changes
- Convert each accepted reproduction into a regression test that asserts the intended correct behavior.
- Add payload fixtures for supported Instagram response shapes.
- For INT64, inspect all consumers before changing Number to BigInt or string; either can be a public API compatibility break.
- Do not run live account actions as part of ordinary regression tests.
