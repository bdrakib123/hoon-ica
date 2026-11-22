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
- Latest user-run validation on Node.js v20.20.2 / npm 10.8.2, after pulling commit `89fead4`: `npm test`, `npm run audit:repro`, `npm run test:types`, and `npm run release:check` all exited 0. The wrapper suite reported 6 tests, runtime fixes reported 26 regression tests passed, type checks passed, dependency audit found 0 vulnerabilities, npm package dry-run passed, and `git status --short` was empty. This confirms #25 and #26 locally; it does not validate live Instagram behavior. The subsequent #27 truncated-struct fix is pending a fresh local run.

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
| 12 | Thread history | **Fixed on branch:** FCA timestamp is forwarded; older pages are fetched with the Relay message-list query using the opaque `end_cursor`, and results are filtered strictly before the timestamp boundary. | regression tests passed in the user-run suite |
| 13 | Inbox polling | **Fixed:** the first successful poll primes state even when empty, so the first later DM is emitted. | regression test added |
| 14 | Link sending | **Fixed:** `sendLink()` takes a turn from the shared outbound send pacer. | regression test added |
| 15 | Inbox pagination | **Implemented on branch:** `getInbox(cursor)` uses `IGDThreadListOffMsysPaginationQuery` with the mailbox id, Relay cursor, count, required `INBOX` folder, timestamp bound and Relay provider flags. Returns `nextCursor` and `hasNextPage` while preserving `threads`. | mock regression passed in the user-run suite |
| 16 | Media caption fallback | **Fixed:** auth/challenge/blocked/rate-limit errors do not fall back to legacy caption sending. | regression test added |
| 17 | Thrift integer precision | **Mitigated:** `ThriftReader` supports `{ int64AsBigInt: true }` for exact INT64 decoding; legacy Number behavior remains the default and can still round large values. | regression test added |
| 18 | FCA thread-list contract | **Fixed in part on branch:** `getThreadList` follows inbox cursors for limits above 15, filters by the requested millisecond timestamp, and supports inbox unread filtering. `ARCHIVED`, `PENDING`, and `OTHER` are explicitly rejected because the verified web pagination query only documents `folder: INBOX`. | two wrapper regression tests passed locally (5-test suite) |
| 19 | Malformed thread-list edges | **Fixed on branch:** entries without a usable `id` / `thread_id` are skipped instead of becoming the shared string `undefined` and suppressing valid threads. | regression test passed in the user-run suite (6 wrapper tests) |
| 20 | Long-lived session cache growth | **Mitigated on branch:** inbox seen/member/thread-ID maps and FCA user/avatar/message/thread-member lookup maps now use bounded FIFO insertion with explicit limits. Eviction can require a later lookup to be learned again; it does not promise a fixed process-memory ceiling. | bounded-cache helper and 2,001-thread inbox-eviction regression passed in the user-run suite |
| 21 | Malformed native inbox Relay edges | **Fixed on branch:** `getInbox()` now filters null/malformed Relay nodes and entries without a usable `id` / `thread_id` before updating thread-member and ID caches. | initial-page and cursor-page regression test passed in the user-run suite |
| 22 | Media upload retry classification | **Fixed on branch:** an `AuthorizationFailedError` with a permanent 401/403 response is no longer retried just because of its message text. Retries remain limited to the observed 412 response or explicitly transient temporary failures. | 401 no-retry regression passed in the user-run suite |
| 23 | Ambiguous media commit retry | **Fixed on branch:** only errors classified as transient are retried, and all retries reuse the same `offline_threading_id` so an ambiguous first response does not create a new logical send. GraphQL `field_exception` errors are surfaced without retry. | both focused regression tests passed in the user's latest local run |
| 24 | MQTT frame and buffer bounds | **Fixed on branch:** MQTT remaining-length varints are limited to the protocol's four-byte encoding, declared packets are capped (default 16 MiB), and buffered inbound data is bounded (default 32 MiB). Invalid or oversized frames fail and close the transport instead of growing memory indefinitely. | split TCP length-header, malformed-varint, oversized-frame, and buffer-limit regression test passed in the user's latest local run |
| 25 | Compressed MQTT payload expansion | **Fixed on branch:** zlib publish payloads now have a 32 MiB decompressed-output cap, preventing a small compressed broker frame from expanding without bound. Oversized/malformed payloads retain the existing best-effort behavior and are returned unchanged. | normal decompression and 33 MiB expansion-cap regression test added; fresh local run pending |
| 26 | Thrift decoder malformed-size handling | **Fixed on branch:** Thrift varints are limited to 10 bytes / 64 bits and reject truncation; binary reads cannot exceed remaining input; list/map sizes are capped (default 100,000), and nested structs are capped (default depth 64). | regression tests cover truncated varint, oversized list, truncated binary and valid list; passed in user's latest local run |
| 27 | Truncated Thrift struct termination | **Fixed on branch:** `readStruct()` now requires the protocol STOP marker and rejects EOF after a partial/complete field sequence instead of silently returning a partial object. | missing-STOP regression added; fresh local run pending |

## Runtime fix progress (2026-11-22)

**All 17 original diagnostic cases have a branch-level response; #18 remains partial FCA compatibility and #20 is a bounded-cache mitigation.** #12 uses the Relay message-list cursor for older messages; #15 uses the documented inbox pagination query. #18 handles multi-page INBOX results, timestamp filtering, and unread filtering. Archived/pending/other folders remain unsupported by the currently verified web query. The user has now confirmed #20 bounded-cache, #21 malformed-inbox-edge, and #22 media-auth retry regression tests in the full local suite. #23 makes media commit retries idempotent, and #24 bounds MQTT frame parsing and buffering; the user has now confirmed all 24 regression tests pass locally. #25 adds a decompression output cap and #26 bounds malformed Thrift structures; both await a fresh local run. None of these protocol changes has been validated against a live Instagram session.

`test/runtime-fixes.test.js` is part of the normal `npm test` command and currently contains 26 focused regression checks. The legacy `audit:repro` checks assert corrected behavior for fixed cases rather than the old defect signature. The user confirmed the full suite after commit d022bb8: all 24 runtime regression checks, 6 wrapper tests, type checks, audit checks, and release dry-run passed; working tree was clean. #25 was added after that run and remains pending.

**Execution status:** #20–#26 are locally green in the user's Node 20.20.2 / npm 10.8.2 environment, including #25 decompression-output and #26 Thrift decoder bounds. #27 truncated-struct termination requires a fresh local run. Do not treat source review or successful GitHub commits as test passes.

## Additional source-review candidates (not yet diagnostic tests)

These require more focused fixtures, payload captures, or runtime validation before being treated as defects:

- `getThreadList` supports the currently verified INBOX folder and unread filter. Archived, pending and other folders remain unsupported; implement only after their current Instagram web query contracts are verified.
- Inbox polling currently consumes the first inbox page only, while the FCA `getThreadList` wrapper can paginate. Assess whether polling beyond the first 15 threads is required and balance coverage against additional GraphQL request volume before changing it.
- The fallback group-count rules in thread-list and thread-detail wrappers are not consistent; validate against captured inbox and thread-detail payloads before changing either.
- Verify whether inbox/realtime participant lists consistently include the viewer/self ID for every event type.
- Stress-test bounded caches under long-running multi-thread load and confirm eviction does not break expected command lookups; the helper test alone cannot establish practical memory behavior.
- Verify media upload and commit error classification against real response shapes, especially transient 412 and authentication/challenge responses.
- The INT64 reader now offers exact BigInt decoding as an opt-in while preserving Number as the default. Audit any external consumers and document the option wherever the low-level Thrift reader is exposed.


- Inbox thread maps and FCA identity/message lookup caches were unbounded by entry count. #20 now applies FIFO limits (5,000 entries for seen-message/user/avatar/message-thread maps; 2,000 for thread-member/internal-thread-ID maps). Old entries may remain stale until eviction, and eviction may cause a later lookup to require re-learning; stress-test this behavior before release.

## Recommended next validation sequence

1. Re-run the full Node 20 validation suite after the #27 truncated-struct rejection change.
2. Stress-test cache eviction and assess first-page-only inbox polling under high thread churn.
3. Audit all INT64 reader consumers before choosing a compatibility-safe representation.
4. Keep live Instagram account actions, merge, and npm publish separate; they require their own explicit approval.


## Initial severity triage (provisional)

Severity reflects likely impact from source behavior, not confirmed production incidence. Validate against supported payloads and account-safe fixtures before fixing.

### P1 — original high-priority cases (status updated)
- **Fixed on branch:** #1 cookie normalization, #10–11 realtime fallback/acknowledgement, #13 first inbox message, #14 sendLink pacing, and #16 media auth fallback. Regression tests passed in the user-run suite through #18.
- **Mitigated on branch:** #17 adds an opt-in exact BigInt mode; default Number output is retained to avoid a breaking change, so callers needing exactness must enable the option.

### P2 — fix after P1, with contract fixtures
- **Fixed on branch:** #2 profile URL parsing, #3 thread-list preview, #5 DM/group classification, #6 XMA attachment URL, #7 viewer FBID mapping, #8 read retry policy, and #9 realtime readiness callback.
- **Implemented and locally regression-tested:** #12 history timestamp. The wrapper forwards the FCA millisecond timestamp; the thread method walks `slide_messages.page_info.end_cursor` via `IGDMessageListOffMsysQuery` and returns messages strictly older than the boundary. The timestamp is never used as the Relay cursor.
- **Implemented and locally regression-tested:** #15 inbox cursor pagination. Uses mailbox id + opaque Relay cursor; returns `nextCursor` and `hasNextPage`.

### Required before release
- Run all four validation commands listed above on Node 20 and inspect their complete outputs.
- For INT64, inspect all consumers before changing the default from Number to BigInt or string; either can be a public API compatibility break.
- Do not run live account actions as part of ordinary regression tests.
