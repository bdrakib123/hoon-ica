# Comprehensive Source Audit — Hoon ICA

Branch: `audit/comprehensive-bug-hunt`  
Baseline: `audit/fca-wrapper-regression`  
Scope: source inspection and diagnostic reproduction cases only.

## Important validation status

- The cases below are **source-derived reproductions**, not dynamically confirmed runtime failures.
- `npm run audit:repro` has **not** been executed in Node.js in this audit session.
- No live Instagram login, DM, MQTT subscription, media upload, or account action was performed.
- No runtime source file was modified by this audit.
- The normal `npm test` command and published `@cexi/hoonica@1.0.0` release remain untouched.
- The diagnostic suite is intentionally separate from the normal test gate. A `REPRODUCED` result means the current source exhibits the asserted defect signature; it is not a passing regression test.

## Diagnostic reproduction inventory

| # | Area | Source-level finding | Diagnostic case |
|---:|---|---|---|
| 1 | Cookie normalization | `normalizeCookie()` calls `.trim()` before handling the documented object and browser-devtools array inputs. | documented cookie object/array inputs throw |
| 2 | UID parsing | URL parsing captures the first path segment, so `/reel/...` and `/p/...` are returned as usernames. | getUID treats a reel route as a username |
| 3 | Thread list | FCA preview/timestamp read legacy `items[0]`, while the inbox query returns Relay `slide_messages.edges[].node`. | getThreadList ignores Relay preview |
| 4 | Anti-suspension config | `configure()` assigns top-level fields, but cooldown activation reads `baseCooldownMs` and nested `cooldown.strikesToActivate`. | configure does not update nested cooldown values |
| 5 | Thread classification | Thread detail adds the viewer to the other-participant list, then falls back to `users.length > 1`; a one-to-one DM can be classified as a group when `is_group` is absent. | one-to-one DM marked as group |
| 6 | XMA attachments | XMA attachment URL falls back to extracted text body when no preview image URL exists. | XMA text body returned as attachment URL |
| 7 | FBID mapping | Viewer mapping uses `thread.viewer_id` even though the viewer object can carry its own `id`; missing top-level ID becomes the string `"undefined"`. | undefined viewer ID mapping |
| 8 | Read retry | Thrown read errors are retried even though the module describes null/undefined throttle results as the retry case. | retries thrown permanent errors |
| 9 | Realtime readiness | With a cursor, listener subscribes but skips its configured `onReady` callback. | onReady omitted after cursor subscription |
| 10 | Realtime fallback | Error and disconnect handlers can both invoke the polling fallback before the listener is stopped; no one-shot guard is visible in the fallback path. | duplicate polling fallbacks |
| 11 | Realtime acknowledgement | Listener marks itself subscribed after the publish promise resolves; it does not wait for an `iris_sub_response` acknowledgement. | unacknowledged publish treated as subscribed |
| 12 | Thread history | FCA wrapper accepts a timestamp argument but does not pass it to the native history method. | timestamp argument ignored |
| 13 | Inbox polling | If the first poll is empty, the first later-arriving message is used to seed `_seen` and is not emitted as a new event. | first DM skipped after empty startup |
| 14 | Link sending | `sendLink()` posts directly without calling the shared outbound send pacer, unlike text/media sends. | sendLink bypasses pacer |
| 15 | Inbox pagination | Native `getInbox()` takes no cursor argument and sends fixed query variables; a supplied cursor is ignored. | getInbox ignores pagination cursor |
| 16 | Media caption fallback | Caption send catches a GraphQL auth error and falls back to the legacy broadcast send path instead of treating auth as non-retriable. | auth error triggers legacy caption send |\n| 17 | Thrift integer precision | `ThriftReader.readValue()` converts every INT64 to JavaScript `Number`, losing exact values above `Number.MAX_SAFE_INTEGER`. | INT64 precision loss |

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
