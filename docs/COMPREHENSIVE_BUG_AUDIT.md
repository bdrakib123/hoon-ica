# Comprehensive Source Audit — Hoon ICA

Branch: `audit/comprehensive-bug-hunt`  
Baseline: `audit/fca-wrapper-regression`  
Scope: source inspection, isolated runtime fixes, and local regression-test preparation.

## Validation status (2026-11-22)

- The user ran the diagnostic suite locally in UserLAnd on **Node.js v20.20.2** and **npm 10.8.2**.
- `npm install` completed successfully and reported **0 vulnerabilities**.
- Before runtime fixes began, `npm run audit:repro` completed with exit code 0 and reported **17 reproduced / 17 diagnostic cases**.
- `git status --short` was empty after the run.
- These are controlled local runtime reproductions of the current source behavior, **not live Instagram validation**.
- No live Instagram login, DM, MQTT subscription, media upload, or account action was performed.
- Runtime fixes are now being made only on `audit/comprehensive-bug-hunt`, after the user authorized this work.
- The normal `npm test` command now includes `test/runtime-fixes.test.js`; the separate `audit:repro` script has been converted to check corrected behavior for fixed cases and retain diagnostics for remaining candidates.
- The published `@cexi/hoonica@1.0.0` release and `release/1.0.0` remain untouched.
- The user ran the current pre-thread-list-change test suite successfully on Node.js v20.20.2 / npm 10.8.2: `npm test`, `npm run audit:repro`, `npm run test:types`, and `npm run release:check` all exited 0. Subsequent thread-list changes add two more regression cases and still require a fresh local run.

## Diagnostic reproduction inventory

| # | Area | Source-level finding | Diagnostic case |
|---:|---|---|---|
| 1 | Cookie normalization | **Fixed:** documented object and browser cookie-array inputs are normalized before string parsing. | regression test added |
| 2 | UID parsing | **Fixed:** known Instagram content routes such as `/reel/...` and `/p/...` no longer resolve to fake usernames; valid profile paths remain supported. | regression test added |
| 3 | Thread list | **Fixed:** reads preview text and timestamp from Relay `slide_messages`, with legacy `items` fallback. | regression test added |
| 4 | Anti-suspension config | **Fixed:** `cooldownMs` and `strikesToActivate` update the nested cooldown state consumed by activation. | regression test added |
| 5 | Thread classification | **Fixed:** fallback group classification now requires more than two participants after viewer normalization. | regression test added |
| 6 | XMA attachments | **Fixed:** XMA text is no longer exposed as a URL; a share attachment requires a preview URL. | regression test added |
| 7 | FBID mapping | **Fixed:** viewer mapping uses `viewer.id` / `viewer.pk` before the legacy top-level fallback and omits missing IDs. | regression test added |
| 8 | Read retry | **Fixed:** thrown exceptions surface immediately; only null/undefined results are retried. | regression test added |
| 9 | Realtime readiness | **Fixed:** `onReady` runs after a cursor subscription is acknowledged. | regression test added |
| 10 | Realtime fallback | **Fixed:** polling fallback is guarded so error/disconnect/start rejection can start it only once. | regression test added |
| 11 | Realtime acknowledgement | **Fixed:** listener waits for `iris_sub_response`; missing acknowledgement times out and is not marked subscribed. | regression test added |
| 12 | Thread history | **Fixed on branch:** FCA timestamp is forwarded; older pages are fetched with the Relay message-list query using the opaque `end_cursor`, and results are filtered strictly before the timestamp boundary. | regression tests added; execution pending |
| 13 | Inbox polling | **Fixed:** the first successful poll primes state even when empty, so the first later DM is emitted. | regression test added |
| 14 | Link sending | **Fixed:** `sendLink()` takes a turn from the shared outbound send pacer. | regression test added |
| 15 | Inbox pagination | **Implemented on branch:** `getInbox(cursor)` uses `IGDThreadListOffMsysPaginationQuery` with the mailbox id, Relay cursor, count, required `INBOX` folder, timestamp bound and Relay provider flags. Returns `nextCursor` and `hasNextPage` while preserving `threads`. | mock regression added; local execution pending |
| 16 | Media caption fallback | **Fixed:** auth/challenge/blocked/rate-limit errors do not fall back to legacy caption sending. | regression test added |
| 17 | Thrift integer precision | **Mitigated:** `ThriftReader` supports `{ int64AsBigInt: true }` for exact INT64 decoding; legacy Number behavior remains the default and can still round large values. | regression test added |
| 18 | FCA thread-list contract | **Fixed in part on branch:** `getThreadList` now follows inbox cursors to satisfy limits above 15, filters by the requested millisecond timestamp, and supports inbox unread filtering. `ARCHIVED`, `PENDING`, and `OTHER` are explicitly rejected because the current verified web pagination query only documents `folder: INBOX`. | two wrapper regression tests added; local execution pending |

## Runtime fix progress (2026-11-22)

**All 17 original diagnostic cases have a branch-level response, and a new #18 compatibility gap has been addressed in part.** #12 uses the Relay message-list cursor for older messages; #15 uses the documented inbox pagination query. #18 now handles multi-page INBOX results, timestamp filtering, and unread filtering. Archived/pending/other folders remain unsupported by the currently verified web query. The latest #18 tests still need a fresh local run; none of these protocol changes has been validated against a live Instagram session.

New test file: `test/runtime-fixes.test.js` (18 focused regression checks). It has been added to the normal `npm test` command. The legacy `audit:repro` checks were updated so fixed cases assert the corrected behavior rather than the old defect signature. The user has confirmed those 18 checks and the full pre-#18 suite pass locally. `test/fca-wrapper-regression.test.js` now has two additional #18 checks and needs a fresh run.

**Execution status:** the user-confirmed test run covers the inbox pagination (#15) change, but predates #18. The two new #18 wrapper tests and full suite require another local run. Do not treat source review or successful GitHub commits as test passes.

## Additional source-review candidates (not yet diagnostic tests)

These require more focused fixtures, payload captures, or runtime validation before being treated as defects:

- `getThreadList` supports the currently verified INBOX folder and unread filter. Archived, pending and other folders remain unsupported; implement only after their current Instagram web query contracts are verified.
- The fallback group-count rules in thread-list and thread-detail wrappers are not consistent; validate against captured inbox and thread-detail payloads before changing either.
- Verify whether inbox/realtime participant lists consistently include the viewer/self ID for every event type.
- Exercise cache/map growth under long-running multi-thread load; source inspection alone cannot establish a practical memory leak.
- Verify media upload and commit error classification against real response shapes, especially transient 412 and authentication/challenge responses.
- The INT64 reader now offers exact BigInt decoding as an opt-in while preserving Number as the default. Audit any external consumers and document the option wherever the low-level Thrift reader is exposed.


- Long-lived inbox instances retain `_seen`, `_threadIdMap`, `_members`, and `_threadState` entries for threads that disappear from later inbox snapshots. This is a potential unbounded-growth/stale-state issue; validate expected thread churn and whether these maps need TTL/LRU pruning before classifying it as a confirmed defect.

## Recommended next validation sequence

1. Run `npm test`, `npm run test:types`, `npm run release:check`, and `npm run audit:repro` on Node 20.
2. Fix any test failures before considering a release candidate.
3. Verify the latest #18 thread-list pagination/filter tests locally; #15 inbox cursor pagination has already passed the user-run suite.
4. Audit all INT64 reader consumers before choosing a compatibility-safe representation.
5. Keep live Instagram account actions, merge, and npm publish separate; they require their own explicit approval.


## Initial severity triage (provisional)

Severity reflects likely impact from source behavior, not confirmed production incidence. Validate against supported payloads and account-safe fixtures before fixing.

### P1 — original high-priority cases (status updated)
- **Fixed on branch:** #1 cookie normalization, #10–11 realtime fallback/acknowledgement, #13 first inbox message, #14 sendLink pacing, and #16 media auth fallback. Regression tests are authored; execution is pending.
- **Mitigated on branch:** #17 adds an opt-in exact BigInt mode; default Number output is retained to avoid a breaking change, so callers needing exactness must enable the option.

### P2 — fix after P1, with contract fixtures
- **Fixed on branch:** #2 profile URL parsing, #3 thread-list preview, #5 DM/group classification, #6 XMA attachment URL, #7 viewer FBID mapping, #8 read retry policy, and #9 realtime readiness callback.
- **Implemented on branch, execution pending:** #12 history timestamp. The wrapper forwards the FCA millisecond timestamp; the thread method walks `slide_messages.page_info.end_cursor` via `IGDMessageListOffMsysQuery` and returns messages strictly older than the boundary. The timestamp is never used as the Relay cursor.
- **Implemented on branch, execution pending:** #15 inbox cursor pagination. Uses mailbox id + opaque Relay cursor; returns `nextCursor` and `hasNextPage`.

### Required before release
- Run all four validation commands listed above on Node 20 and inspect their complete outputs.
- For INT64, inspect all consumers before changing the default from Number to BigInt or string; either can be a public API compatibility break.
- Do not run live account actions as part of ordinary regression tests.
