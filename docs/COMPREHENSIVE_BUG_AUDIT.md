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

- Latest user-confirmed validation (2026-11-23) after pulling commit `4431f9b`: `npm test`, `npm run audit:repro` (17 checks), `npm run test:types`, and `npm run release:check` all exited 0 on Node.js v20.20.2 / npm 10.8.2; the working tree was clean. The release check completed a dependency audit (0 vulnerabilities) and npm package dry-run only. No live Instagram login/messaging or publish was performed.
- No live Instagram login, DM, MQTT subscription, media upload, or account action was performed.
- Runtime fixes are now being made only on `audit/comprehensive-bug-hunt`, after the user authorized this work.
- Latest audit-branch change after the user's green local run: bounded listener inbox pagination (#155), with 2 new regression checks; the new code and tests await local execution.
- The normal `npm test` command now includes `test/runtime-fixes.test.js`; the separate `audit:repro` script has been converted to check corrected behavior for fixed cases and retain diagnostics for remaining candidates.
- The published `@cexi/hoonica@1.0.0` release and `release/1.0.0` remain untouched.
- Latest user-run validation on Node.js v20.20.2 / npm 10.8.2, after pulling commit `4e24d66`: `npm test`, `npm run audit:repro`, `npm run test:types`, and `npm run release:check` all exited 0. The wrapper suite reported 6 tests, runtime fixes reported 28 regression tests passed, type checks passed, dependency audit found 0 vulnerabilities, npm package dry-run passed, and `git status --short` was empty. This confirms #29 failed-handshake cleanup locally; it does not validate live Instagram behavior.

- Latest user-run validation after pulling `68da077`: `npm test` and `release:check` reached `testNewlyDiscoveredThreadDoesNotReplayHistory` and failed because the test fixture listed messages oldest-first while the inbox contract is newest-first; `audit:repro` (17 checks) and `test:types` passed, and `git status --short` was clean. The fixture order has been corrected on this branch; the full suite has not yet been rerun.\n\n- Additional source-review fixes after the latest user run: thread-history request bounds (#126), read-retry initial-delay ceiling (#127), and MQTT QoS 1 acknowledgement ordering (#128). Runtime regression source now declares 89 cases; these additions are pending the next combined local run.\n\n- Additional source-review fix: realtime subscription acknowledgement timeout now clamps to Node's maximum timer delay (#129); runtime regression inventory is now 90 tests plus 17 wrapper tests (107 focused tests), pending the combined local run.\n\n## Diagnostic reproduction inventory

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
| 25 | Compressed MQTT payload expansion | **Fixed on branch:** zlib publish payloads now have a 32 MiB decompressed-output cap, preventing a small compressed broker frame from expanding without bound. Oversized/malformed payloads retain the existing best-effort behavior and are returned unchanged. | normal decompression and 33 MiB expansion-cap regression test passed in user's latest local run |
| 26 | Thrift decoder malformed-size handling | **Fixed on branch:** Thrift varints are limited to 10 bytes / 64 bits and reject truncation; binary reads cannot exceed remaining input; list/map sizes are capped (default 100,000), and nested structs are capped (default depth 64). | regression tests cover truncated varint, oversized list, truncated binary and valid list; passed in user's latest local run |
| 27 | Truncated Thrift struct termination | **Fixed on branch:** `readStruct()` now requires the protocol STOP marker and rejects EOF after a partial/complete field sequence instead of silently returning a partial object. | missing-STOP regression passed in the user's latest local run |
| 28 | Realtime disconnect fallback | **Fixed on branch:** if the MQTT connection drops after the iris subscription was acknowledged, `listen()` now starts the polling safety net instead of only reporting an error and leaving message delivery stopped. Fallback remains single-start guarded. | established-subscription disconnect regression passed in the user's local Node 20 run |
| 29 | Failed MQTT handshake cleanup | **Fixed on branch:** if TLS connect, CONNECT write, CONNACK decode, or a rejected CONNACK fails, `RealtimeClient.connect()` now clears ping state, resets connection flags, and disconnects the transport before rethrowing. This prevents a failed startup from leaving a socket alive while the caller falls back or retries. | rejected-CONNACK cleanup regression passed in the user's local Node 20 run |
| 30 | Realtime receive-loop cleanup | **Fixed on branch:** if MQTT packet decoding / receiving fails after a successful handshake, the client now clears its ping timer and disconnects the transport before emitting the final disconnect event. This prevents malformed broker data from leaving an idle TLS socket open while polling fallback takes over. | truncated MQTT header regression added; pending user local run |
| 31 | User profile cache growth | **Fixed on branch:** `UserMethods._profileCache` now uses a 2,000-entry FIFO bound, so arbitrary profile lookups cannot grow the long-lived session map indefinitely. | profile-cache eviction regression added; pending batch local run |
| 32 | Poller shutdown race | **Fixed on branch:** an inbox poll that was already in flight when `stopListening()` runs now discards its result, skips callbacks, and does not schedule another poll. | stop-during-request regression added; pending batch local run |
| 33 | Ambiguous text/caption fallback | **Fixed on branch:** text sends and media captions now use the legacy endpoint only after an explicit GraphQL operation error; transient network failures are surfaced rather than risking duplicate sends after an accepted-but-unacknowledged mutation. | ECONNRESET no-fallback regression added; pending batch local run |
| 34 | FCA user avatar cache bypass | **Fixed on branch:** `getUserInfo()` now uses the shared bounded-map helper for avatar and username cache writes instead of unbounded direct `Map.set()` calls. | 2,600-user cache-bound regression added; pending batch local run |
| 35 | FCA thread-history overload/limit | **Fixed on branch:** `getThreadHistory(threadID, amount, callback)` and callback-only overloads are normalized, and requested positive integer amounts are no longer silently raised to 20. | wrapper regressions added; pending batch local run |
| 36 | MQTT packet identifier wraparound | **Fixed on branch:** outbound QoS-1 packet IDs now wrap from 65,535 to 1 instead of overflowing to invalid packet ID 0. | packet-id boundary regression added; pending batch local run |
| 37 | Missing profile metrics | **Fixed on branch:** explicit null count edges remain `null` instead of being coerced to numeric zero, so an unknown follower/following/media count is not reported as zero. | null-versus-zero profile parsing regression added; pending batch local run |
| 38 | Typing fallback request amplification | **Fixed on branch:** typing indicator fallback now stops immediately for auth, challenge, rate-limit, and transport failures; it tries alternate legacy routes only for endpoint-specific/unknown rejections. | rate-limit stop and 404 fallback regression added; pending batch local run |
| 39 | Malformed nested thread edges | **Fixed on branch:** inbox message extraction, thread history mapping, reply lookup, actor lookup, FBID mapping, and FCA participant mapping now skip null or malformed nested Relay nodes instead of throwing. | malformed nested message/user regression added; pending batch local run |
| 40 | Malformed Relay edge collection shape | **Fixed on branch:** inbox pagination and thread-detail consumers now verify `edges` is an array before iterating; malformed collection values are treated as empty rather than crashing the listener. | malformed collection regression added; pending batch local run |
| 41 | FCA thread-history TypeScript overloads | **Fixed on branch:** declaration types now include callback-only, amount-plus-callback, and amount/timestamp/callback forms; realtime ping interval documentation now matches the 25-second runtime default. | TypeScript overload examples added to type test; pending batch local run |
| 42 | Legacy login cookie-map loss | **Fixed on branch:** the FCA-style `module/login` entrypoint now preserves all cookies in a raw `{ sessionid, csrftoken, ... }` map and accepts nested cookie objects instead of reducing the input to the session ID alone. | raw-map and nested-cookie regression added; pending batch local run |
| 43 | Realtime connect cancellation | **Fixed on branch:** `RealtimeClient.connect()` checks its stop state after each awaited handshake stage, so a listener stopped during TLS/connect cannot later finish the handshake and revive a supposedly stopped client. | delayed-connect cancellation regression added; pending batch local run |
| 44 | Listener stop during shared-client lookup | **Fixed on branch:** `RealtimeListener.start()` now exits when stop is called while the shared-client provider is still resolving, and checks stop state after cursor resolution/subscription. | pending-client lookup stop regression added; pending batch local run |
| 45 | Normalized reply metadata and event types | **Fixed on branch:** realtime quoted-message metadata (item type, client context, offline threading ID, timestamp) now survives bridge and FCA normalization; declarations now include `message_reply` and system-event fields. | normalized reply metadata regression and type examples added; pending batch local run |
| 46 | Legacy text-send offline ID | **Fixed on branch:** the legacy text-send fallback now uses a separate UUID `client_context` and numeric `offline_threading_id`, matching the native send contract instead of reusing one UUID for both fields. | fallback payload regression added; pending batch local run |
| 47 | Mention-cache hydration retry | **Fixed on branch:** failed initial inbox hydration no longer permanently marks the mention index as loaded; concurrent message events share one in-flight hydration request and later events retry after failure. | transient inbox failure/retry regression added; pending batch local run |
| 48 | Shared realtime reconnect race | **Fixed on branch:** explicit realtime disconnect detaches the pending connect promise immediately, and an older cancelled attempt can no longer clear a newer reconnect promise in its `finally` handler. | cancel-and-reconnect race regression added; pending batch local run |
| 49 | Malformed mention and attachment fields | **Fixed on branch:** mention maps omit users without usable IDs, participant lists must be arrays, and malformed/null attachment entries are filtered during event normalization. | malformed event payload regression added; pending batch local run |
| 50 | Polling misses messages between cycles | **Fixed on branch:** when the inbox preview advances but the last-seen message is still in the bounded thread-detail page, the poller now emits every newer message from that page in chronological order rather than only the latest preview. | multiple-messages-between-polls regression added; pending batch local run |
| 51 | Captioned media reply enrichment | **Fixed on branch:** a non-text reply with a caption but no attachment nodes is now considered incomplete and resolved from thread history, allowing image/video reply commands to receive the media attachment. | captioned-media reply regression added; pending batch local run |
| 52 | Poller stops on inconclusive auth probe | **Fixed on branch:** after repeated auth-shaped request failures, `graphql_error` and `unexpected_response` session checks now trigger a delayed recheck instead of permanently stopping the inbox listener; explicit auth/challenge/suspension states still stop. | inconclusive-auth-probe recovery regression added; pending batch local run |
| 53 | Explicit failure envelope without message | **Fixed on branch:** `status: fail`, `require_login`, and challenge/checkpoint envelopes are surfaced even when Instagram omits an error message; the HTTP response interceptor no longer silently treats unknown explicit failures as success. | unknown-failure, auth, and challenge envelope regression added; pending batch local run |
| 54 | Blank primary thread/message identifiers | **Fixed on branch:** inbox and history normalization now chooses the first non-empty `id`, `thread_id`, `item_id`, or `message_id` rather than allowing a blank primary field to hide a valid fallback identifier. | FCA thread-list blank-id fallback regression added; pending batch local run |
| 55 | Pending TLS socket cancellation | **Fixed on branch:** `SocketMQTToTTransport` now owns the socket from the start of TLS negotiation; `reset()` and `disconnect()` destroy pending sockets and reject waiters, while stale socket events cannot overwrite a newer connection. | pending TLS reset/disconnect regression added; pending batch local run |
| 56 | Old receive loop corrupts reconnect | **Fixed on branch:** realtime connections and receive loops now carry a generation token; late errors or packets from an old connection cannot clear the new ping timer, mark the new connection disconnected, or emit stale events. | old-loop/new-connection regression added; pending batch local run |
| 57 | MQTT decoder accepts malformed frames | **Fixed on branch:** packet decoding now requires exact remaining-length/frame agreement, validates UTF-8 lengths and fixed-size control packets, rejects reserved packet types/unsupported QoS/zero IDs, and writers reject invalid packet identifiers. | malformed frame, QoS, and packet-id regressions added; pending batch local run |
| 58 | HTTP-date Retry-After ignored | **Fixed on branch:** `retryAfterMs()` now parses both numeric seconds and HTTP-date header values, capped at 30 minutes. | numeric/date/invalid header regression added; pending batch local run |
| 59 | Poller retries before server Retry-After | **Fixed on branch:** inbox rate-limit and blocked backoff now honors the server-provided retry delay, including session-check rate limits, instead of always using a shorter local delay. | 120-second Retry-After poller regression added; pending batch local run |
| 60 | Realtime handlers registered before connect are lost | **Fixed on branch:** `realtimeOn()` now queues handlers without creating a premature client; `sharedRealtimeClient()` attaches them to the client created with the requested options and restores them after reconnect/disconnect. | pre-connect handler registration and reconnect regression added; pending batch local run |
| 61 | Contact sharing lacks a native web mutation | **Clarified, not implemented:** the FCA wrapper previously called a nonexistent `InstaAPI.shareContact` and silently returned `null`. It now records `IG_METHOD_UNSUPPORTED` in `lastShareContactError` and documents the limitation. Actual contact-card sharing remains unsupported until a verified Instagram web mutation contract is available. | unsupported-adapter callback regression added; pending batch local run |
| 62 | MQTT UTF-8 field length overflow | **Fixed on branch:** outbound MQTT UTF-8 fields now reject encoded values above the protocol's 65,535-byte limit rather than wrapping the 16-bit length prefix. | oversized publish/subscribe topic assertions added to MQTT decoder regression |
| 63 | Form requests serialize nullish values literally | **Fixed on branch:** `postForm()` now omits `null`/`undefined` fields, preserves `0`/`false`, and JSON-encodes structured object values instead of sending literal `undefined` or `[object Object]`. | form serialization regression added; pending batch local run |
| 64 | Null FCA thread-list tags rejected | **Fixed on branch:** `getThreadList(limit, timestamp, null)` now treats null tags as the default INBOX request; unread counts are normalized to numbers and participant fallback checks require an array. | existing wrapper pagination regression now passes null tags; pending batch local run |
| 65 | Partial GraphQL mutation data can trigger duplicate fallback | **Fixed on branch:** GraphQL errors now retain response/partial data; text and media-caption fallbacks are suppressed whenever any mutation data was returned, avoiding a second send after a possible partial commit. | partial-data no-fallback regression covers text and media caption; pending batch local run |
| 66 | Concurrent CSRF token bootstrap duplication | **Fixed on branch:** simultaneous GraphQL requests now share one in-flight homepage token bootstrap instead of issuing duplicate page loads; failed bootstrap attempts clear the shared promise for retry. | concurrent bootstrap regression added; pending batch local run |
| 67 | Persisted session/device files use permissive modes | **Fixed on branch:** appstate cookie files, backups, and device identity files are now created/restricted to owner-only `0600` permissions, including pre-existing files. | temp-directory permission regression added; pending batch local run |
| 68 | Application callback exceptions terminate inbox delivery | **Fixed on branch:** inbox callbacks are wrapped so synchronous throws and rejected callback promises are reported through `callbackError` without escaping the polling/realtime delivery loop. | sync/async callback failure regression added; pending batch local run |
| 69 | Repeated `listen()` leaks previous poller/listener | **Fixed on branch:** a new `listen()` call stops the previous active listener/poller before creating another; old stop handles cannot stop the new stream. | repeated-listen replacement regression added; pending batch local run |
| 70 | Startup error delivered after listener was stopped | **Fixed on branch:** the asynchronous `listener.start()` rejection handler now exits silently when that listener lifetime has already been stopped, instead of calling the application callback after stop. | stop-during-pending-start regression added; pending batch local run |
| 71 | MQTT ping interval can exceed broker keepalive | **Fixed on branch:** caller-provided ping intervals are validated and clamped below the advertised MQTT keepalive, preventing an otherwise healthy socket from being disconnected by the broker. | fake-timer interval clamp regression added; pending batch local run |
| 72 | Invalid MQTT transport limits can disable safety bounds | **Fixed on branch:** port, timeout, packet-size and receive-buffer options are validated and capped; buffer capacity is always sufficient for one maximum-size packet. | invalid and undersized transport-limit regressions added; pending batch local run |
| 73 | Poller misses backlog beyond the first 20 thread messages | **Fixed on branch:** when the last-seen message is not in the initial thread-detail page, the poller now follows up to four opaque Relay cursors (up to 100 messages total), emits all messages newer than the last-seen ID in order, and advances its seen cursor to the newest detail-page message. | 25-new-messages/two-page regression added; pending batch local run |
| 74 | Newly discovered inbox thread replays historical preview | **Fixed on branch:** once polling is primed, a thread first appearing without a known cursor emits only its newest preview message instead of treating its entire historical preview as fresh. | newly discovered thread history-replay regression added; pending batch local run |
| 75 | FCA success callback exceptions trigger a second callback | **Fixed on branch:** `getThreadHistory` and `getThreadList` now invoke success callbacks outside their operation catch blocks, so a user callback throw propagates once instead of being mistaken for an API failure and invoking the callback again. | callback-throws-once regression added; pending batch local run |
| 76 | Callback exceptions cause duplicate FCA callback across wrappers | **Fixed on branch:** thread info, user info/profile/friendship, send/edit/unsend/reaction, and contact-share wrappers now track callback invocation and rethrow a callback's own exception rather than calling it again with an error. | cross-wrapper callback-throws-once regression added; pending batch local run |
| 77 | Per-thread anti-suspension pacing map can grow beyond its intended cap | **Fixed on branch:** the per-thread last-send cache now evicts the oldest entry whenever it exceeds 500 keys, even when every thread was active within the one-hour TTL window. | 750-thread hard-bound regression added; pending batch local run |
| 78 | Recursive attachment flattening can overflow on deep/circular arrays | **Fixed on branch:** FCA attachment arrays are now flattened iteratively with cycle detection, preserving order without recursive call-stack growth. | nested/circular multi-attachment regression added; pending batch local run |
| 79 | Captioned media Promise.all hides the other commit's outcome | **Fixed on branch:** caption and media commits now both settle before the send reports failure; the thrown error includes `partialSend.captionSent` / `partialSend.mediaSent` so callers can distinguish a partial send from a total failure. | delayed-media/failed-caption partial-outcome regression added; pending batch local run |
| 80 | Multi-attachment send failure hides already-sent items | **Fixed on branch:** FCA multi-attachment sends now attach `partialSend` metadata (`sentCount`, `totalAttachments`, and known message IDs) when a later item fails, so callers can distinguish partial completion from a total failure. | second-item failure/partial-progress regression added; pending batch local run |
| 81 | Media URL download has no timeout or response-size cap | **Fixed on branch:** photo/video/voice URL downloads now accept only HTTP(S), use a 30-second default timeout (configurable up to 120 seconds), and cap response size at 100 MiB by default (configurable up to 512 MiB). | protocol rejection, size cap, timeout and redirect-limit regression added; pending batch local run |
| 82 | FCA participantIDs omit the logged-in viewer | **Fixed on branch:** inbox member caches and system-event snapshots now merge the separate `viewer` record into participants, deduplicating the id and preserving its name. | viewer-excluded-from-users participant regression added; pending batch local run |
| 83 | Async FCA callback rejections become unhandled promises | **Fixed on branch:** FCA adapters now await callback results, propagate rejected async callbacks, and use the once-only guard to prevent a second callback invocation. | async rejection regressions for history/list/user-info/profile/id callbacks added; pending batch local run |
| 84 | Persisted GraphQL session parameters are world-readable | **Fixed on branch:** `_loadSessionParams()` now restricts an existing `session-params.json` to owner-only `0600` before reading reusable `fb_dtsg`/LSD/browser-session tokens. | existing-file permission regression added to session-file security test; pending batch local run |
| 85 | Inbox cursor silently ignored when mailbox bootstrap fails | **Fixed on branch:** after bootstrapping, `getInbox(cursor)` now throws a clear error if Instagram did not return a mailbox id instead of silently returning page one and ignoring the requested cursor. | missing-mailbox cursor regression added; pending batch local run |
| 86 | Realtime listener leaks handlers after failed startup | **Fixed on branch:** `RealtimeListener.start()` now calls its own cleanup when connect, cursor resolution, subscription acknowledgement, or onReady fails; shared clients retain their session connection while listener-owned connections are closed. | startup acknowledgement timeout regression asserts all per-listener handlers are removed and shared client is not disconnected; pending batch local run |
| 87 | Pending realtime subscription waits full timeout after disconnect | **Fixed on branch:** a disconnect now rejects the pending iris-subscription acknowledgement immediately and avoids duplicate callback notification. | disconnect-before-ack regression asserts prompt rejection and handler cleanup; pending batch local run |
| 88 | Multi-attachment send tracking references uninitialized variables | **Fixed on branch (follow-up correction):** `sendMessage` now declares the sent-message ID list and attachment count in the enclosing function scope, so the catch handler can safely report partial progress without masking the original failure. | wrapper partial-progress regression covers second-item failure; pending batch local run |
| 89 | Thread-info viewer merge assumes `viewer.id` always exists | **Fixed on branch:** FCA `getThreadInfo` now normalizes `viewer.id` and `viewer.pk` before deduplication and participant insertion, avoiding an undefined participant when only `pk` is present. | regression extends direct-thread participant test with pk-only viewer payload; pending batch local run |
| 90 | FCA attachment URL and stream buffering is unbounded | **Fixed on branch:** `InstaClient` attachment inputs now enforce a 100 MiB default / 512 MiB hard-capped size limit, configurable download timeout, bounded HTTP redirects, HTTPS downgrade rejection, and stream byte accounting. FCA `sendMessage` forwards the download-limit options. | URL size/timeout/redirect settings, Buffer cap, and oversized stream regressions added; pending batch local run |
| 91 | Native media callbacks are fire-and-forget and can run twice | **Fixed on branch:** `_mediaSend` now uses the shared once-only callback wrapper, awaits async callbacks, and rethrows callback errors without invoking the callback a second time. | sync-throw and async-rejection callback regressions added; pending batch local run |
| 92 | FCA learned thread members duplicate the viewer | **Fixed on branch:** `InstaClient._learnThreads()` now checks the viewer's normalized `id`/`pk` before merging it into `users`, so participant IDs remain unique when the server already includes the viewer. | viewer-already-in-users regression added; pending batch local run |
| 93 | Thrift map `__proto__` key can mutate decoded object prototype | **Fixed on branch:** map entries now use `Object.defineProperty` to create own data properties, preventing untrusted wire keys from changing the decoded object's prototype. | crafted `__proto__` map-key regression asserts prototype remains unchanged; pending batch local run |
| 94 | Realtime fingerprint collapses every timestamp-less same-text message | **Fixed on branch:** content-fingerprint dedupe keys are now generated only when a valid positive timestamp exists; messages without timestamps rely on their actual IDs instead of colliding in bucket zero. | missing-timestamp versus timestamped fingerprint regression added; pending batch local run |
| 95 | MessageDeduper accepts zero/negative cache limits unsafely | **Fixed on branch:** TTL and maximum size are normalized; zero explicitly disables retention without an infinite prune loop, invalid limits use safe defaults, and maximum retention is capped. | zero-capacity and negative-limit regressions added; pending batch local run |
| 96 | HTTPS media downloads may follow an insecure HTTP redirect | **Fixed on branch:** both native media URL downloads and FCA attachment URL downloads now track every redirect hop and reject any HTTPS-to-HTTP downgrade while retaining a small redirect limit. Null options are normalized safely in the native downloader. | redirect downgrade and null-options regression added; pending batch local run |
| 97 | Late pre-open circuit request releases a live half-open probe | **Fixed on branch:** only the request that actually acquired the half-open probe may clear `probeInFlight`; older in-flight requests can no longer permit a second concurrent recovery probe. | stale-success-during-probe regression added to reliability utility suite; pending batch local run |
| 98 | Session guard ignores backup when primary JSON is valid but incomplete | **Fixed on branch:** cookie recovery now falls back to `.bak` whenever the primary file has fewer than the minimum required cookies, and saving over an incomplete primary never overwrites the last known-good backup. | incomplete-primary recovery and backup-preservation regressions added; pending batch local run |
| 99 | FCA getThreadList result is block-scoped inside try | **Fixed on branch:** the accumulated list now lives in the adapter's outer scope, so successful Promise and callback paths can return it after the validation/request catch. | existing pagination and callback-overload regressions exercise both successful return paths; pending batch local run |
| 100 | Partial-send error handler cannot access send tracking state | **Fixed on branch:** follow-up inspection found `sentMessageIDs` and `attachmentCount` were still declared inside `try`, making them inaccessible to `catch`; both now live in the enclosing function scope so the original send error and partial-send metadata survive. | existing multi-attachment second-item failure regression; pending batch local run |
| 101 | FCA attachment streams can stall indefinitely | **Fixed on branch:** readable-stream attachments now share the configured download timeout with HTTP downloads; a stalled stream is destroyed and rejects with a clear timeout error while the existing byte cap remains enforced. | PassThrough stalled-stream timeout regression added; pending batch local run |
| 102 | Session cookie loader continues after permission-hardening failure | **Fixed on branch:** `secureFile()` now reports chmod failure, and cookie loading refuses to read an existing primary or backup file unless permission hardening succeeds. Session saves also abort when existing session files cannot be secured. | chmod-failure regression asserts neither primary nor backup is read; pending batch local run |
| 103 | Malformed inbox user collections break native inbox hydration | **Fixed on branch:** `_learnInboxUsers()` now skips malformed thread records and treats non-array `users` as empty, while still learning a valid separate `viewer` and preserving the inbox response. | mixed malformed/valid participant-collection regression added; pending batch local run |
| 104 | Media URL downloads can reach private/local network services (SSRF) | **Fixed on branch:** both native media URL downloads and FCA attachment URL downloads now use a DNS lookup guard that rejects loopback, private, link-local, reserved and non-global IPv6 targets, and rejects mixed public/private DNS answers to reduce DNS-rebinding risk. Redirect requests use the same validated lookup and existing HTTPS-downgrade guard; Axios environment proxies are disabled for these requests so the proxy cannot bypass destination-IP validation. | IPv4/IPv6 private-address, public-address and mixed-DNS regression coverage added; pending batch local run |
| 105 | Native media uploads have no byte limit and file paths are read before validation | **Fixed on branch:** native photo/video/voice uploads now require Buffer payloads and enforce a 100 MiB default / 512 MiB hard cap (configurable with `maxUploadBytes`). File-path methods stat the file and reject oversized inputs before reading them into memory; the option is declared in TypeScript. | Buffer validation, configurable byte-limit and pre-read file-size regression coverage added; pending batch local run |
| 106 | Malformed normalized events/messages create invalid identifiers or body types | **Fixed on branch:** `EventNormalizer` drops message/system-event payloads without nonblank `threadID`/`messageID`; messages also require a nonblank `senderID`, and non-string body values normalize to an empty string before mention parsing. | regression covers missing IDs/sender and malformed structured body; pending batch local run |
| 107 | String-valued HTTP status codes bypass error classification | **Fixed on branch:** `statusOf()` now normalizes numeric strings from `err.status` / `err.response.status` before classification, preserving unknown for invalid values. | regression covers string 429, 401, 503 and invalid status; pending batch local run |
| 108 | Realtime subscription rounds 64-bit sequence IDs | **Fixed on branch:** inbox cursor normalization preserves large decimal sequence IDs as exact strings and rejects unsafe numeric values that have already lost precision; the listener passes the normalized cursor to MQTT without coercing it through `Number()`. | regression covers values above `Number.MAX_SAFE_INTEGER`, safe integers, invalid values, inbox extraction and subscription forwarding; pending batch local run |
| 109 | Poller reports auth failure after stop during confirmation probe | **Fixed on branch:** after the asynchronous session-confirmation request resolves, the poller rechecks its stopped state before invoking callbacks or scheduling further work. | deferred-auth-probe regression stops the poller before resolving an invalid-session result and asserts no late callback/timer; pending batch local run |
| 110 | Direct-thread name fallback mistakes a pk-only viewer for the other participant | **Fixed on branch:** `getThreadInfo` now excludes the viewer using the already-normalized `viewerID` (`id` or `pk`) when selecting the other participant for a direct-thread title fallback. | existing pk-only viewer fixture now asserts that the friend username, not the logged-in viewer username, becomes `threadName`; pending batch local run |
| 111 | Inbox group fallback omits the separate viewer participant | **Fixed on branch:** `getThreadList` now counts a separate `viewer.id` / `viewer.pk` exactly once when `is_group` is absent, matching the thread-detail wrapper. | regression covers a 3-person group with viewer outside `users`, a direct chat, and a viewer already present in `users`; pending batch local run |
| 112 | Read-retry options can configure effectively unbounded retries or delays | **Fixed on branch:** retry attempts are capped at 10 and both first/max wait durations are capped at five minutes; invalid values fall back to safe defaults. | regression covers Infinity, extremely large attempts/delays, zero waits and invalid attempts; pending batch local run |
| 113 | Missing profile boolean fields are misreported as explicit false | **Fixed on branch:** normalized verification, privacy, business/professional and profile-picture flags now remain `null` when the source omits them, while explicit booleans are preserved. | regression covers absent flags and explicit true/false values alongside unknown profile counts; pending batch local run |
| 114 | Partial friendship payloads misreport missing status fields as false | **Fixed on branch:** blocking, restriction, follow and request flags now preserve `null` when the inbox/thread payload omits an individual field, while explicit booleans remain unchanged. | wrapper regression covers mixed explicit false/true values and omitted friendship fields; pending batch local run |
| 115 | TypeScript realtime cursor options reject exact large sequence strings | **Fixed on branch:** `RealtimeOptions.seqId` and `getRealtimeState()` now accept `number | string`; docs direct callers to use decimal strings above `Number.MAX_SAFE_INTEGER`. | TypeScript fixture now compiles a 64-bit decimal string cursor; pending local type check |
| 116 | Malformed thread participant records create an `undefined` participant ID | **Fixed on branch:** `getThreadInfo` now drops participant entries without a nonblank `id` or `pk` before viewer merging and FCA shaping. | pk-only viewer regression fixture now includes null, empty and ID-less user entries and asserts only valid participant IDs remain; pending batch local run |
| 117 | Refreshing a dedupe key does not refresh its FIFO eviction position | **Fixed on branch:** `MessageDeduper.add()` now removes and reinserts existing keys so recently refreshed message IDs are retained ahead of older entries when the cache is full. | regression fills a two-key cache, refreshes the older key, adds a third, and asserts the refreshed key survives; pending batch local run |
| 118 | Scheduler accepts one-shot delays that Node timers silently clamp to 1 ms | **Fixed on branch:** `scheduleOnce()` now rejects delays above Node's maximum supported timeout instead of unexpectedly firing a long-delay task almost immediately. | regression passes a delay one millisecond above the timer ceiling and asserts no task is registered; pending batch local run |
| 119 | Invalid thread-history timestamps silently disable the before filter | **Fixed on branch:** `getHistory()` now validates the timestamp before making a GraphQL request; invalid/non-integer values throw instead of returning the newest messages as if no filter were supplied. | existing timestamp-pagination regression now asserts invalid input rejects without issuing another request; pending batch local run |
| 120 | Inbox polling accepts intervals beyond Node's maximum timer delay | **Fixed on branch:** the configured minimum and per-listen interval are normalized and capped at Node's maximum timeout; jitter is capped too, preventing an oversized delay from wrapping into an almost-immediate poll. | regression covers an infinite configured floor and a maximum-finite listen interval; captured scheduled delay stays within the timer limit; pending batch local run |
| 121 | Realtime receive-loop regression fixture redeclares its receive counter | **Fixed on branch:** the throwing-error-handler scenario now uses its own `throwingReceives` counter, avoiding a duplicate lexical declaration that prevented the runtime regression suite from parsing. | user Node 20 run identified the SyntaxError; corrected fixture is included in the branch; pending rerun |
| 122 | GraphQL partial-data helper imported by message/media methods was not exported | **Fixed on branch:** `hasGraphQLPartialData` is now included in `src/utils/errors.js` exports; a regression test verifies the public internal import and true/false partial-data cases. | user Node 20 run exposed a TypeError during legacy text fallback; source export and regression coverage added; pending rerun |
| 123 | IPv4 public-address validation rejected a known public address in Node 20 | **Fixed on branch:** IPv4 validation now uses explicit strict address parsing and CIDR range comparisons rather than `net.BlockList.check`; regression coverage includes public addresses, loopback, broadcast, and malformed octets. | user Node 20 run failed the first public IPv4 assertion; deterministic IPv4 range validation replaces the failing path; pending rerun |
| 140 | getUID can parse a username from an untrusted URL host or path | **Fixed on branch:** profile URL parsing now uses the URL hostname and accepts only Instagram/Facebook domains or their subdomains; lookalike hosts and path-embedded domain strings fall back to the current user ID. | runtime regression covers lookalike domains, path spoofing and scheme-less official profile URLs; pending user local run |
| 139 | FCA thread-list accepts unsafe pagination limits and timestamps | **Fixed on branch:** requested limits are now positive safe integers capped at 5,000, and timestamp boundaries must be non-negative safe integers before any inbox request is made. | wrapper regression covers unsafe huge limits and timestamps without issuing network requests; pending user local run |
| 138 | Profile normalization can discard valid pk when primary ID is whitespace | **Fixed on branch:** web, GraphQL and inbox profile parsers now select the first nonblank identity field, and the shared normalized profile rejects blank IDs. | runtime regression covers whitespace `id` with valid `pk` in web and inbox profile payloads; pending user local run |
| 137 | Friendship wrapper can return a whitespace user ID | **Fixed on branch:** friendship shaping now uses the first nonblank learned `id`, `pk`, or requested key for both `id` and `userID`. | wrapper regression verifies whitespace id falls back to a valid pk; pending user local run |
| 136 | Remaining FCA identity consumers can prefer whitespace IDs over valid fallbacks | **Fixed on branch:** group-member resolution, actor lookup and fallback event mention parsing now use the first nonblank identity field, preventing whitespace IDs from leaking into API calls or mention maps. | runtime regression verifies group-member username resolution falls back to a valid pk; pending user local run |
| 135 | Offline mention resolution can emit a whitespace user ID | **Fixed on branch:** mention normalization now uses the first nonblank `id` or `pk` before creating the FCA mentions map. | runtime regression verifies a whitespace primary ID resolves to the valid pk key; pending user local run |
| 134 | FCA client inbox hydration stores whitespace IDs in participant cache | **Fixed on branch:** FCA inbox/thread hydration now uses the first nonblank participant ID, includes a valid viewer fallback, deduplicates IDs, and skips blank identity/cache keys. | runtime regression covers whitespace primary IDs, pk fallbacks, duplicates and viewer inclusion; pending user local run |
| 133 | Thread FBID mapping can map a sender to a whitespace participant ID | **Fixed on branch:** FBID mapping now selects the first nonblank `id`, `pk`, or viewer fallback and omits unusable IDs rather than storing whitespace. | runtime regression covers whitespace IDs with valid pk fallbacks and malformed viewer/user identities; pending user local run |
| 132 | FCA thread-info shaping can retain whitespace IDs and duplicate users | **Fixed on branch:** thread-info shaping now normalizes each participant using the first nonblank `pk` or `id`, deduplicates by that ID, and applies the same rule to the viewer and direct-thread name fallback. | wrapper regression covers whitespace primary IDs, valid pk fallbacks, duplicate users, malformed entries and viewer exclusion; pending user local run |
| 131 | FCA thread-list group fallback counts malformed/duplicate participants and misses pk fallback | **Fixed on branch:** group classification now counts distinct nonblank participant IDs and resolves viewer/user identity from the first usable `id` or `pk`, rather than raw array length or truthy whitespace values. | wrapper regression includes whitespace IDs, pk fallbacks, duplicates, malformed users and a pk-only viewer; pending user local run |
| 130 | Inbox participant snapshots can retain blank IDs instead of valid pk fallbacks | **Fixed on branch:** inbox member hydration and thread-state snapshots now select the first nonblank `id` or `pk`, deduplicate participant IDs, and include a valid viewer fallback even when its primary ID is whitespace. | regression covers blank/whitespace IDs, valid pk fallbacks, duplicate users, and a pk-only viewer; pending user local run |
| 129 | Realtime subscription acknowledgement timeout could overflow Node's timer range | **Fixed on branch:** `subscriptionTimeoutMs` now defaults safely for invalid values and clamps positive finite values to Node's maximum timer delay. | source review found `Number.MAX_VALUE` passed directly to `setTimeout` (which can become a 1 ms timer); regression captures and verifies the maximum clamped delay; pending user local run |\n| 128 | MQTT QoS 1 publish was not acknowledged when application dispatch threw | **Fixed on branch:** send the PUBACK before invoking synchronous application listeners, so a user callback exception cannot cause the broker to redeliver the same publish. | source review found `_handlePacket()` dispatched before PUBACK; regression asserts acknowledgement is issued before a deliberately throwing dispatch; pending user local run |\n| 127 | Read-retry first delay could exceed configured maxWaitMs | **Fixed on branch:** normalized `firstWaitMs` is now clamped to the normalized `maxWaitMs`, including zero; the retry backoff ceiling applies from the first wait. | source review found `firstWaitMs=30000, maxWaitMs=1000` returned a 30-second first wait; regression asserts the first delay is capped; pending user local run |\n| 126 | Thread history accepted unbounded/unsafe requested limits and sent unbounded GraphQL page sizes | **Fixed on branch:** requested history count is validated as a positive safe integer up to 5,000; each initial and cursor page is capped at 50 messages, with Relay pagination preserving larger supported requests. | source review found unbounded `first`/`limit`; regression covers invalid counts and verifies 50-message page bounds; pending user local run |\n| 125 | New-thread regression fixture reverses inbox message order | **Fixed on branch:** the fixture now follows the inbox's newest-first Relay ordering, so the assertion verifies that only the newest message is emitted for a newly discovered thread; production behavior is unchanged. | User Node 20 run exposed the mismatch (`old-3` actual vs `newest` expected); corrected fixture order; pending rerun |
| 124 | Media URL regression fixture referenced FCA client/context without declaring them | **Fixed on branch:** the protocol/size/timeout regression now imports `InstaClient` locally and provides the minimal picture-URL resolver context required by `_attachmentToBuffer`. | user Node 20 run exposed a ReferenceError at the FCA redirect-guard assertion; fixture setup corrected; pending rerun |

## Additional utility hardening

| 143 | FCA getThreadInfo whitespace-ID fixture expected the wrong participant order | **Fixed on branch:** the regression now expects the viewer first, matching the documented behavior and the existing participant insertion logic; the other participant remains selected for direct-thread naming. No runtime behavior change was needed. | wrapper regression expectation corrected; pending user local run |
| 144 | Runtime test called `_learnThreads` on a plain fixture object without its prototype method | **Fixed on branch:** the second fixture invocation now calls `InstaClient.prototype._learnThreads.call(client, payload)`, matching the first invocation and preserving the intended lightweight fixture. Production code was correct; no runtime behavior change. | test fixture corrected; pending user local run |
| 145 | Learned-thread whitespace-ID fixture expected viewer last, contrary to viewer-first insertion | **Fixed on branch:** the expected participant order now matches `_learnThreads()`; valid `pk` fallbacks and duplicate elimination are unchanged. No runtime behavior change. | test expectation corrected; pending user local run |
| 146 | MQTT truncated remaining-length test omitted the second fixed-header byte | **Fixed on branch:** the fixture now supplies a fixed header plus an unterminated remaining-length byte (`0x20, 0x80`), so `decodePacket()` reaches and verifies the intended truncated-varint guard. Parser behavior was correct. | malformed-frame fixture corrected; pending user local run |
| 147 | Realtime cancellation regression referenced `RealtimeClient` without importing it | **Fixed on branch:** the test now imports `RealtimeClient` from `src/realtime/client`; production code was unaffected. | test import corrected; pending user local run |
| 148 | Inbox rate-limit jitter could schedule a retry earlier than HTTP `Retry-After` | **Fixed on branch:** rate-limit scheduling now takes the maximum of the server-provided wait and jittered wait, so jitter can extend but never shorten the server minimum. Existing regression asserts the 120-second lower bound. | runtime fix and regression assertion present; pending user local run |
| 149 | Realtime ping interval regression expected a stale 30-second fallback | **Fixed on branch:** the regression assertion now compares the invalid-option fallback with the exported `PING_INTERVAL_MS` (25 seconds). The production default already fires within the 60-second MQTT keep-alive; no runtime behavior change was needed. | stale test expectation corrected; pending user local run |
| 150 | FCA history forwarding fixture expected the default amount instead of the supplied amount | **Fixed on branch:** the wrapper correctly forwards the caller's requested amount (`5`) and timestamp unchanged; the regression assertion now checks the actual supplied amount rather than stale `20`. No production behavior change. | stale fixture expectation corrected; pending user local run |
| 142 | Reply normalization can prefer a whitespace message ID over a valid fallback | **Fixed on branch:** replied-message IDs now select the first nonblank `id` or `message_id`, preserving valid quote context when the primary field is whitespace. | runtime regression verifies a whitespace primary ID falls back to the valid message ID; pending user local run |
| 141 | Optional reliability utility maps can grow without bounds | **Fixed on branch:** adaptive endpoint history and circuit registries now have configurable hard entry limits; idempotency result retention, TTL and concurrent in-flight operations are normalized and capped. Open/half-open circuits are not evicted to make room for a new key. | reliability regression covers endpoint/circuit eviction, infinite cache options and in-flight saturation; pending user local run |

## Runtime fix progress (2026-11-22)

**All 17 original diagnostic cases have a branch-level response; #18 remains partial FCA compatibility and #20 is a bounded-cache mitigation.** #12 uses the Relay message-list cursor for older messages; #15 uses the documented inbox pagination query. #18 handles multi-page INBOX results, timestamp filtering, and unread filtering. Archived/pending/other folders remain unsupported by the currently verified web query. The user has now confirmed #20 bounded-cache, #21 malformed-inbox-edge, and #22 media-auth retry regression tests in the full local suite. #23 makes media commit retries idempotent, and #24 bounds MQTT frame parsing and buffering; the user has now confirmed all 24 regression tests pass locally. #25 adds a decompression output cap and #26 bounds malformed Thrift structures; both await a fresh local run. None of these protocol changes has been validated against a live Instagram session.

`test/runtime-fixes.test.js` is part of the normal `npm test` command and currently contains 94 named regression checks. The legacy `audit:repro` checks assert corrected behavior for fixed cases rather than the old defect signature. The user most recently confirmed the full suite after commit `29f8e14` (2026-11-23): all 94 runtime regression tests, 18 FCA wrapper tests, the other npm test suites, 17 audit checks, TypeScript declarations, dependency audit (0 vulnerabilities), and package dry-run passed; working tree was clean. This run includes the #156 stalled-publish timeout and #157 circuit-breaker race regressions.

**Execution status:** #158 is locally green in the user's Node 20.20.2 / npm 10.8.2 environment, based on the user's combined validation run at `cf48871`. The current branch contains 94 named runtime regression tests and 18 FCA wrapper regression tests (112 named tests total); all 94 runtime tests, all 18 wrapper tests, the remaining npm test suites, 17 audit checks, TypeScript declarations, dependency audit (0 vulnerabilities), package dry-run, and clean working-tree check passed. #159–#184 are committed after that validation and await a later batched local run. Do not treat source review or successful GitHub commits alone as live Instagram validation.

## Additional source-review candidates (not yet diagnostic tests)

These require more focused fixtures, payload captures, or runtime validation before being treated as defects:

- `getThreadList` supports the currently verified INBOX folder and unread filter. Archived, pending and other folders remain unsupported; implement only after their current Instagram web query contracts are verified.
- Listener polling now follows a configurable, bounded number of inbox pages (#155); verify the default three-page budget against real account thread volume and rate-limit behavior.
- Verify whether inbox/realtime participant lists consistently include the viewer/self ID for every event type.
- Stress-test bounded caches under long-running multi-thread load and confirm eviction does not break expected command lookups; the helper test alone cannot establish practical memory behavior.
- Verify media upload and commit error classification against real response shapes, especially transient 412 and authentication/challenge responses.
- The INT64 reader now offers exact BigInt decoding as an opt-in while preserving Number as the default. Audit any external consumers and document the option wherever the low-level Thrift reader is exposed.


- Inbox thread maps and FCA identity/message lookup caches were unbounded by entry count. #20 now applies FIFO limits (5,000 entries for seen-message/user/avatar/message-thread maps; 2,000 for thread-member/internal-thread-ID maps). Old entries may remain stale until eviction, and eviction may cause a later lookup to require re-learning; stress-test this behavior before release.

- Voice-note semantics remain unverified: `sendVoiceBuffer()` currently uses the generic `messenger_audio` upload/commit path; confirm whether current Instagram requires additional voice-note metadata before treating this as a supported voice bubble.
- Realtime cursor/history pagination and media upload retry behavior have regression coverage but still need live, account-safe validation before being considered protocol-confirmed.

## Recommended next validation sequence

1. Stress-test bounded caches and the configurable polling page budget under high thread churn, using deterministic fixtures and bounded workloads.
2. Add focused tests for any newly confirmed race or malformed-input case before changing production behavior.
3. Keep live Instagram account actions, merge, and npm publish separate; they require their own explicit approval.


## Follow-up source review (2026-11-23)

Reviewed the current realtime listener/client lifecycle, MQTT TLS transport reset and cancellation paths, media upload/commit retry logic, HTTP error classification, outbound send pacing, optional reliability utilities, and public TypeScript declarations after #156. This pass identified #157 in the optional CircuitBreaker helper and #158 in the utility option declarations. Existing regression coverage exercises pending TLS cancellation, stale connection-loop isolation, shared-client reconnect cleanup, media commit retry ID reuse, permanent auth non-retry, and caption/media partial-send reporting.

Remaining protocol-level uncertainty is unchanged: source fixtures do not prove current Instagram broker or mutation behavior. In particular, keep voice-note semantics (#154), HTTP 412 upload retry classification, and remote idempotency behavior marked for account-safe protocol capture rather than changing payloads speculatively. No live account actions, merge, or npm publish were performed.

### #157 — A stale half-open circuit probe could erase a later failure

- **Fixed on branch:** a request that began before the breaker opened can fail while a half-open recovery probe is running. That late failure reopens the circuit, but the older probe's later success previously set the state to CLOSED unconditionally.
- **Fix:** each half-open probe now owns a unique token. Only the currently active probe may close or reopen its circuit; a superseded probe cannot mutate a newer half-open attempt.
- **Regression:** `test/reliability-utils.test.js` now holds an old request open, opens the breaker with a concurrent failure, starts a half-open probe, then fails the old request before resolving the probe. The circuit must remain OPEN after the stale probe succeeds.
- **Scope:** this optional `CircuitBreaker` utility is not wired into `HttpClient` by default. The change protects applications that explicitly use the helper; it does not alter normal Instagram request behavior.
- **Validation status:** source and regression test are committed on the audit branch; the user's next local `npm test` run must confirm the new case.

### #158 — TypeScript declarations omitted supported reliability capacity options

- **Fixed on branch:** runtime constructors already supported `AdaptiveRateLimiter.maxEndpoints`, `CircuitBreaker.maxCircuits`, and `IdempotencyCache.maxInflight`, but `index.d.ts` rejected these valid options. TypeScript consumers could not configure the documented bounded-state limits without casts or plain JavaScript.
- **Fix:** added the three optional properties to the corresponding constructor option types.
- **Regression:** `test/types.test.ts` now instantiates all three helpers with their capacity options, so `npm run test:types` verifies the public declarations.
- **Documentation:** `DOCS.md` now describes the defaults and hard caps for each bound.
- **Validation status:** declarations, type regression, and documentation are committed on the audit branch; the user's next local validation run must confirm them.

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

### #151 — Inbox cursor missing-mailbox test fixture lacked device UUID
- The cursor-bootstrap test constructed the inbox HTTP client without the `uuid()` method required by the first-page Polaris inbox query.
- The fixture now supplies a deterministic device UUID, allowing the production path to reach and assert the intended missing-mailbox error.
- This was a test-fixture defect; no production runtime code changed.

### #152 — Event normalizer identifier test rejected valid cache writes
- The regression fixture configured `rememberThread()` to throw unconditionally, but its malformed-body case intentionally has valid message/thread identifiers and should be cached.
- The fixture now asserts that every cache write has nonblank identifiers and verifies that only the valid event is remembered.
- Production normalization already rejects missing core identifiers before cache writes; no runtime change was needed.


### #153 — Malformed Relay edge test asserted query count too early
- The malformed-edge test checked for four GraphQL calls immediately after the two inbox-page requests, before invoking `fetchReplies()` and `_latestActor()`, which each issue the thread-detail query.
- Moved the query-count assertion after both detail methods. The intended total remains four calls: first inbox page, pagination page, reply detail, and latest-actor detail.
- This was a test assertion-order defect; production code was not changed.

### #154 — Voice-note API does not currently demonstrate voice-note-specific semantics
- `sendVoiceBuffer()` passes a `voice: true` flag into `_send()`, but `_send()` never reads that flag. The upload path selects the generic `messenger_audio` / `audio_type` consumer, and the commit mutation contains only the generic attachment/thread/offline-ID/reply fields.
- `_waveform()` exists but is not called anywhere in the media send path; no voice-specific waveform or duration metadata is attached by this implementation.
- This is a concrete implementation/documentation gap, but not yet proof that Instagram requires those fields: a generic audio attachment may still render as an audio/voice bubble depending on server-side classification.
- **Disposition:** do not change the payload speculatively. Keep voice-note support marked protocol-unverified until a current web-client request/response capture or account-safe fixture establishes the required upload headers and commit metadata. Add regression coverage only after the expected contract is known.

### #155 — Polling listener ignored inbox pages after the first 15 threads
- **Fixed on branch:** polling now follows Relay cursors for a bounded number of pages instead of silently limiting the listener to page one. The new `pollMaxPages` option defaults to 3 (up to 45 threads), is clamped to 1–10, and can be set to 1 to retain first-page-only behavior.
- Duplicate thread IDs across pages are deduplicated, repeated cursors stop traversal, and a listener stopped while a page request is in flight discards that page.
- Added regression coverage for page traversal, cursor propagation, deduplication, maximum-page enforcement, option bounds, and stop-during-pagination. The test source declares 93 runtime regression checks; the user confirmed all 93 passed locally after pulling `924bf14`.
- **Remaining limitation:** a thread beyond the configured page budget is still not polled in that cycle. Increasing the page budget increases GraphQL request volume; choose it based on account/thread volume and rate-limit behavior.

### #156 — Realtime subscription timeout did not bound a stalled publish
- `_subscribeWithAck()` created a timeout for the iris acknowledgement, but awaited `irisSubscribe()` before awaiting the acknowledgement promise. If the MQTT socket write remained pending, the configured subscription deadline could fire while startup remained blocked on the publish promise; the acknowledgement rejection could also be temporarily unhandled.
- **Fixed on branch:** publish and acknowledgement are now observed concurrently with `Promise.all()`. The configured timeout settles startup even if the publish promise stalls, and both outcomes have rejection handlers immediately.
- Added a regression test with a deliberately unresolved `irisSubscribe()` promise; it verifies the subscription timeout rejects within the deadline and removes the acknowledgement listener.
- **Validation status:** user-confirmed green at commit `4adfedf` (2026-11-23): all 94 runtime regression tests, all 18 FCA wrapper tests, remaining npm suites, 17 audit checks, TypeScript declarations, zero-vulnerability dependency audit, package dry-run, and clean working tree.


### #159 — `moduleLogin` declaration incorrectly reused the root login export type

- **Found in source review:** the root `login.moduleLogin` and named `moduleLogin` export point to `module/login.js`, a distinct legacy entry point that always constructs and returns an `InstaAPI`. It does not attach the root login function's static properties (`InstaClient`, `createClient`, `utilities`, etc.).
- **Defect:** `index.d.ts` declared `moduleLogin: LoginExport`, incorrectly advertising the root callable's union return type and static properties on this separate function. Consumers could receive inaccurate IntelliSense and accept code that fails at runtime.
- **Fix:** introduced `ModuleLoginExport` with promise and callback overloads that return only `InstaAPI`; both `login.moduleLogin` and the named export now use that interface.
- **Regression:** `test/types.test.ts` now checks promise, options, and callback forms against the native `InstaAPI` return type.
- **Validation status:** declaration and regression-test changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #160 — realtimeSubscribe declaration narrowed an exact 64-bit cursor to number

- **Found in source review:** `InstaAPI.realtimeSubscribe()` returns the cursor object from `inbox.fetchRealtimeState()`. That path uses `normalizeSequenceId()`, which deliberately returns a decimal string when the sequence exceeds `Number.MAX_SAFE_INTEGER`.
- **Defect:** `index.d.ts` declared the returned `seqId` as `number` only, even though the runtime can and must preserve large sequence IDs as strings to avoid precision loss.
- **Fix:** widened both `InstaAPI.realtimeSubscribe()` and the FCA-shaped `InstaClient.realtimeSubscribe()` return declarations to `number | string`, matching `RealtimeOptions.seqId` and the actual normalization behavior.
- **Regression:** `test/types.test.ts` assigns both native and FCA-shaped method results to promises whose `seqId` accepts both safe numbers and exact decimal strings.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #161 — CookieUtils.parse declaration rejected supported cookie object inputs

- **Found in source review:** the exported `CookieUtils.parse` is the runtime `normalizeCookie` function. It accepts cookie strings, cookie maps/objects, individual browser cookie records, and cookie arrays.
- **Defect:** its public declaration accepted only `string`, rejecting valid object and array inputs already supported by the implementation.
- **Fix:** widened the declaration to `string | object`.
- **Regression:** `test/types.test.ts` now checks both browser cookie-array and cookie-map calls.

### #162 — createContext declaration rejected a nullable thread ID accepted at runtime

- **Found in source review:** `createContext(nativeOrClient, threadID)` forwards the value to `InstaContext`, whose constructor explicitly accepts `string | null` and stores null when no thread is selected.
- **Defect:** the exported function declaration required a non-null string even though the context constructor and runtime support null.
- **Fix:** widened the function's thread ID argument to `string | null`.
- **Regression:** `test/types.test.ts` now creates a typed context with a null thread ID.
- **Validation status (#161–#162):** declaration and type-test changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #163 — login declarations did not narrow the result for the `native` option

- **Found in source review:** root `login(cookie, options)` returns an `InstaAPI` when `options.native === true`, and otherwise returns the FCA-shaped `InstaClient`. `createClient` delegates to the same behavior.
- **Defect:** the declaration exposed only a broad `Promise<InstaClient | InstaAPI>` for both cases, forcing callers to narrow/cast even when they explicitly passed `native: true`; it also failed to describe the default FCA-shaped return precisely.
- **Fix:** added literal-`true`, literal-`false`/default, and boolean-variable overloads for both root login and `createClient`, plus corresponding callback overloads.
- **Regression:** `test/types.test.ts` now checks default login/factory calls infer `InstaClient` and explicit native calls infer `InstaAPI`.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #164 — supported session persistence and guard options were missing from InstaChatOptions

- **Found in source review:** `InstaAPI` reads `appStateFile` and `sessionGuardFile` to restore the saved app-state cookie snapshot. `InstaClient` reads `sessionGuard` (default enabled) and `sessionGuardFile` to install or disable its session guard.
- **Defect:** these supported root login / client-construction options were not declared, so strict TypeScript users could not configure the persistence path or disable the FCA session guard without casts.
- **Fix:** added `appStateFile`, `sessionGuardFile`, and `sessionGuard` to `InstaChatOptions` with behavior-oriented comments.
- **Regression:** `test/types.test.ts` now constructs an options object containing all three fields.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #165 — SendPacingOptions omitted supported cooldown/escalation controls

- **Found in source review:** `SendPacer.configure()` accepts every numeric key in its runtime `DEFAULTS` configuration, including `cooldownMs`, `maxCooldownMs`, `escalationWindowMs`, `strikesToActivate`, `strikeDecayMs`, and `cooldownGapMs`.
- **Defect:** the exported `SendPacingOptions` interface declared only the basic gaps and send caps, preventing TypeScript consumers from configuring the supported cooldown/escalation behavior.
- **Fix:** added the six supported fields with defaults and units documented from the runtime defaults.
- **Regression:** `test/types.test.ts` now constructs a `SendPacingOptions` value using all six fields.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #166 — ProfileInfo boolean flags were non-nullable despite nullable runtime normalization

- **Found in source review:** `profileParse.normalize()` preserves an unknown or unavailable verification/privacy/business/profile-picture flag as `null`; it only returns a boolean when a source supplied an actual boolean. This matches the interface's stated policy that fields a source cannot supply stay null.
- **Defect:** `ProfileInfo` declared `isVerified`, `isPrivate`, `isBusinessAccount`, `isProfessionalAccount`, and `hasProfilePic` as plain booleans, excluding valid runtime null values.
- **Fix:** widened all five fields to `boolean | null`.
- **Regression:** `test/types.test.ts` now assigns null to all five nullable flags.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #167 — getProfilePictureV2 declaration omitted its callback-only overload

- **Found in source review:** the runtime method explicitly detects a function in the second argument, moves it into `callback`, and defaults options to an empty object.
- **Defect:** the public declaration allowed the callback only as the third argument after an options object, rejecting the supported `getProfilePictureV2(idOrUsername, callback)` form.
- **Fix:** added a callback-only overload and typed callback results as `ProfilePicture | null`.
- **Regression:** `test/types.test.ts` now calls the method with a callback as its second argument.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #168 — media helper declarations omitted supported callback shorthand

- **Found in source review:** `InstaClient.sendPhoto`, `sendPhotoFromUrl`, `sendVideoFromUrl`, and `sendVoiceFromUrl` all detect a function in the options position, move it into the callback slot, and use empty options.
- **Defect:** their declarations required the callback to be the fourth argument, rejecting the runtime-supported third-argument callback shorthand.
- **Fix:** added callback-only overloads for all four FCA-shaped media helpers.
- **Regression:** `test/types.test.ts` now calls each helper with the callback directly after its source argument.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #169 — unsendMessage declaration omitted the supported explicit thread ID

- **Found in source review:** the runtime FCA method signature is `unsendMessage(messageID, callback, threadID)`. The third argument is used by `_resolveThread()` when the message-to-thread cache is cold, including the per-thread `InstaContext.unsend()` wrapper.
- **Defect:** the public declaration exposed only message ID and callback, rejecting the supported explicit thread ID argument and obscuring the reliable post-restart unsend path.
- **Fix:** added optional `threadID?: string` as the third parameter.
- **Regression:** `test/types.test.ts` now calls `unsendMessage` with callback and explicit thread ID.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #170 — setMessageReaction declaration excluded numeric explicit thread IDs

- **Found in source review:** the runtime `_resolveThread(messageID, threadID)` accepts string and number explicit thread IDs, and treats null as “resolve from the message cache”; booleans are ignored because FCA uses the fourth parameter as a legacy force flag.
- **Defect:** the declaration allowed `string | boolean` but omitted numeric IDs, rejecting a value accepted by the runtime.
- **Fix:** widened the fourth parameter to `string | number | boolean | null`.
- **Regression:** `test/types.test.ts` now supplies numeric and null explicit thread IDs.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #171 — InstaContext declaration omitted exposed api and userID properties

- **Found in source review:** the `InstaContext` constructor assigns `this.api = client.api` and `this.userID = client.userID`, in addition to `client` and `threadID`.
- **Defect:** the public class declaration exposed only `client` and `threadID`, so TypeScript consumers could not access two runtime properties.
- **Fix:** added `api: InstaAPI` and `userID: string | null` to the class declaration.
- **Regression:** `test/types.test.ts` now reads both properties with their expected types.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #172 — history declarations rejected nullable default arguments and context callback shorthand

- **Found in source review:** native `getThreadHistory()` treats a null limit as its default 20 and accepts a null timestamp. The FCA wrapper similarly treats a null amount as 20 and null timestamp as omitted. `InstaContext.getHistory(callback)` works because its callback is forwarded through the FCA wrapper's callback-position detection.
- **Defect:** native/FCA declarations excluded null for the supported default arguments, and `InstaContext.getHistory` did not declare the callback-only form that the runtime supports.
- **Fix:** widened history amount/timestamp arguments to include null and added a callback-only context overload.
- **Regression:** `test/types.test.ts` now covers native and FCA null defaults, plus context callback-only and null-amount calls.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #173 — InstaContext send/reply declarations narrowed supported reply targets to strings

- **Found in source review:** `InstaContext.send()` and `reply()` forward their third argument to `InstaClient.sendMessage()`, whose reply target accepts either a string or an object containing `messageID` / `id`.
- **Defect:** the context declarations accepted only strings, preventing TypeScript consumers from passing the same quoted-message context object supported by the underlying FCA send method.
- **Fix:** widened both context reply-target arguments to `string | { messageID?: string; id?: string }`.
- **Regression:** `test/types.test.ts` now exercises object reply targets through both context methods.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #174 — FCA/context reply-target declarations omitted numeric message IDs

- **Found in source review:** the FCA `sendMessage` implementation stringifies any non-object reply target, so numeric message IDs are accepted in its fourth argument. The native method also explicitly accepts string or number IDs. Context send/reply forward the same target to the FCA method.
- **Defect:** the declarations accepted only strings or message-reference objects for FCA/context reply targets, even though the runtime accepts numeric IDs.
- **Fix:** added `number` to the FCA `sendMessage` fourth argument and both context reply-target unions.
- **Regression:** `test/types.test.ts` now uses numeric reply targets through the FCA method and both context methods.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #175 — unsendMessage declaration excluded numeric explicit thread IDs

- **Found in source review:** `unsendMessage()` forwards its optional third argument to `_resolveThread()`, which accepts string and numeric thread IDs and treats null as a cache-based fallback.
- **Defect:** the declaration accepted only a string for the explicit thread ID, despite runtime support for numeric IDs.
- **Fix:** widened the third argument to `string | number | null`.
- **Regression:** `test/types.test.ts` now calls `unsendMessage` with numeric and null explicit thread IDs.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #176 — InstaContext declarations rejected numeric thread IDs normalized by the constructor

- **Found in source review:** the `InstaContext` constructor converts every non-null thread ID to `String(threadID)`; the exported `createContext()` forwards its argument directly to that constructor.
- **Defect:** both public declarations accepted only `string | null`, rejecting numeric IDs that the runtime explicitly normalizes.
- **Fix:** widened the constructor and `createContext()` input to `string | number | null`; the stored `threadID` remains `string | null`.
- **Regression:** `test/types.test.ts` now checks numeric IDs through both the factory and direct constructor.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #177 — runtime helper exports were missing from the package declarations

- **Found in source review:** `index.js` attaches `reconcile`, `bridge`, `antiSuspension`, and `sessionGuard` to the exported login function / CommonJS module object.
- **Defect:** these four runtime-accessible helper namespaces were absent from both `LoginExport` and the named export declarations, so strict TypeScript consumers could not access properties that exist at runtime.
- **Fix:** declared all four namespaces on the root login export and as named exports. Their internal helper shapes remain `any` for now rather than inventing a partial public schema.
- **Regression:** `test/types.test.ts` now references representative functions through each namespace.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #178 — named `login` runtime export was missing from the declaration file

- **Found in source review:** `index.js` assigns `module.exports.login = login` as well as `module.exports.default = login`, so CommonJS consumers and compatible named-import tooling can access both forms.
- **Defect:** `index.d.ts` declared only the default export and omitted the matching named `login` export.
- **Fix:** exported the existing `login` declaration by name as well as default.
- **Regression:** `test/types.test.ts` now imports and calls the named `login` export.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #179 — CommonJS login/default self-references were missing from LoginExport

- **Found in source review:** after assigning `module.exports = login`, the entry point also assigns `module.exports.login = login` and `module.exports.default = login`. Because the exported module is the function object, these are runtime properties on the root login export itself.
- **Defect:** `LoginExport` did not declare either self-reference, so TypeScript users accessing the CommonJS-compatible `login.login` or `login.default` properties received missing-property errors.
- **Fix:** added both self-reference properties to `LoginExport`.
- **Regression:** `test/types.test.ts` now checks calls through both properties.
- **Validation status:** declaration and type regression changes are committed on the audit branch; they have not yet been run in the user's local environment. No runtime behavior changed.


### #180 — InstaAPI.setSessionParams was omitted from the public declarations

- **Found in source review:** `InstaAPI.setSessionParams(params)` is a public prototype method that forwards session parameters to the HTTP client and is used by `refreshSession()`.
- **Defect:** the native API declaration omitted this supported method. The FCA client also binds native prototype methods onto its public instance, so its explicit surface omitted it as well.
- **Fix:** declared `setSessionParams(Record<string, string>): void` on both `InstaAPI` and `InstaClient`.
- **Regression:** `test/types.test.ts` calls it through both native and wrapped clients.
- **Validation status:** declaration and type regression changes are committed on the audit branch; not yet locally validated. No runtime behavior changed.

### #181 — getThreadIdMap was omitted from both public client declarations

- **Found in source review:** `InstaAPI.getThreadIdMap()` returns a defensive `Map` copy of the internal-thread-ID to inbox-thread-ID mapping; `InstaClient` binds the native method onto its instance.
- **Defect:** neither public client declaration exposed this supported mapping method.
- **Fix:** declared `getThreadIdMap(): Map<string, string>` on both `InstaAPI` and `InstaClient`.
- **Regression:** `test/types.test.ts` checks both native and wrapped return types.
- **Validation status:** declaration and type regression changes are committed on the audit branch; not yet locally validated. No runtime behavior changed.


### #182 — createClient declaration omitted the callback shorthand accepted by runtime

- **Found in source review:** `createClient(cookie, options)` forwards its second argument directly to `login`; `login` detects a function in the options position and treats it as the Node callback.
- **Defect:** the `LoginExport.createClient` declaration exposed only promise-returning overloads, rejecting the supported `createClient(cookie, callback)` form.
- **Fix:** added the callback-only second-argument overload. A three-argument options-plus-callback overload was deliberately not added because the runtime wrapper does not forward a third argument.
- **Regression:** `test/types.test.ts` now calls `createClient(cookie, callback)`.
- **Validation status:** declaration and type regression changes are committed on the audit branch; not yet locally validated. No runtime behavior changed.


### #183 — RealtimeOptions omitted the supported transport injection hooks

- **Found in source review:** `InstaAPI` passes `options.realtime` into `InboxMethods`; its listener setup forwards `realtime.transport` and `realtime.getClient` to `RealtimeListener`. These allow a caller to inject a custom transport or provide a shared realtime client.
- **Defect:** the public `RealtimeOptions` interface omitted both runtime-supported properties.
- **Fix:** declared `transport?: any` and `getClient?: () => any | Promise<any>`.
- **Regression:** `test/types.test.ts` now constructs realtime options with both hooks.
- **Validation status:** declaration and type regression changes are committed on the audit branch; not yet locally validated. No runtime behavior changed.


### #184 — getInbox declarations rejected the explicit null first-page cursor

- **Found in source review:** `InboxMethods.getInbox(cursor = null)` explicitly uses null to request/bootstrap the first inbox page; both native and FCA wrapper methods forward the cursor unchanged.
- **Defect:** both public declarations allowed an omitted cursor or string cursor, but rejected the runtime-supported explicit `null` first-page argument.
- **Fix:** widened native and wrapper declarations to `cursor?: string | null`.
- **Regression:** `test/types.test.ts` now calls `getInbox(null)` through both clients.
- **Validation status:** declaration and type regression changes are committed on the audit branch; not yet locally validated. No runtime behavior changed.
