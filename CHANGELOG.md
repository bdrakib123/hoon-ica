# Changelog

All package-identity and documentation references were updated for the Hoon-maintained `@cexi/hoonica` distribution. Original upstream attribution remains in `NOTICE`.

This changelog retains historical development records. Versions before `1.0.0` are inherited project history, not previous public npm releases of this distribution.
The format follows [Keep a Changelog](https://keepachangelog.com/) and uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.1] - Unreleased

### Fixed

- Hardened inbox and realtime lifecycle handling, including bounded pagination,
  subscription acknowledgement deadlines, disconnect cleanup, polling fallback,
  and duplicate-event prevention.
- Improved message and media send reliability with bounded retries, stable
  idempotency identifiers, explicit partial-send outcomes, and callback
  exception handling.
- Added bounds and validation for media transfers, MQTT frames, decompressed
  payloads, Thrift decoding, timers, retries, and long-lived caches.
- Hardened media URL fetching against private/local network destinations,
  unsafe redirects, stalled streams, and oversized responses.
- Corrected thread, participant, profile, cookie, and identifier normalization
  for malformed or partial Instagram payloads.

### Changed

- Expanded FCA compatibility and aligned the TypeScript declarations with
  supported runtime overloads, callback forms, nullable values, and helper
  exports.
- Added strict declaration regression coverage and a consolidated source-audit
  report with 186 tracked findings.

### Security

- Restricted persisted session, cookie, backup, device, and session-parameter
  files to owner-only permissions where supported.
- Kept browser automation optional; the package runtime remains Node.js 20+
  without a browser dependency.


## [1.0.0] - 2026-11-22

### Changed

- **Runtime baseline is now Node.js 20+.** The scheduler uses
  `node-cron@4.6.0`; stopped cron tasks are created with `createTask()`
  to preserve the public `start: false`, `start()`, `stop()` and
  `remove()` behavior after node-cron v4 removed the legacy `scheduled`
  option. Lifecycle regression coverage was expanded.
- **Puppeteer is no longer installed with the package.** Browser session
  harvesting remains available when the application separately supplies a
  Node-compatible `puppeteer-core`; callers can instead pass pre-harvested
  `sessionParams` without installing a browser dependency.


### Fixed

- **FCA edit failures now retain Instagram's GraphQL error details.** The native
  `IGDirectEditMessageMutation` now opts into HTTP-200 GraphQL error checking,
  rather than treating a rejected mutation as an opaque `false`. The FCA wrapper
  preserves the original failure as `api.lastEditError` while keeping its
  non-throwing return contract. Regression coverage: `test/edit.test.js`.

## [2.2.7] - 2026-11-08

### Added

- **Outbound send pacing is now configurable (`sendPacing` option), and can be
  switched off.** The anti-suspension pacer deliberately throttles a personal
  account: it applies a per-thread gap plus jitter, and — because the pacer is
  serialized across every send — a busy account that passes the warmup cap
  (`warmupHourlyCap`, 30 sends in the first 20 minutes by default) starts paying
  `overCapGapMs` (20 s) on *every* send, so replies queue up and drift to
  minutes. A bot that wants no throttle can now pass
  `login(cookie, { sendPacing: { enabled: false } })`, or re-tune any pacer field
  (`globalMinGapMs`, `perThreadMinGapMs`, `jitterMs`, `warmupWindowMs`,
  `warmupHourlyCap`, `normalHourlyCap`, `dailyCap`, `overCapGapMs`, ...) to keep
  the pacing but stop the over-cap gap from being reached. `setSendPacing()` does
  the same on a live client. Non-numeric or negative values are ignored.
  Regression test: `test/sendPacing.test.js`.

## [2.2.6] - 2026-11-08

### Added

- **A captioned media send commits the caption and the attachment together,
  instead of sequentially.** Instagram's `IGDirectMediaSendMutation` has no
  caption field, so `sendMessage({ body, attachment })` is necessarily two
  messages. Committing them back-to-back left a visible gap — the recipient saw
  the text arrive, then the image a beat later. The upload still runs first (it
  is the slow part), but the caption and the media commit now go out
  concurrently: the caption takes a paced turn, the media joins it on an
  immediate turn. Which one renders on top is decided by Instagram from the
  message's `offline_threading_id`, not arrival order, so the id generator is now
  strictly increasing per process (shared across concurrent sends) and the
  caption is built first — the text always sorts above the attachment.
  Regression test: `test/mediaCaption.test.js`.

- **Bounded read retries (`readRetry` option).** Instagram throttles web reads
  (HTTP 429) and the read wrappers resolve `null` instead of throwing, but a
  caller that destructures the result straight away turned a transient throttle
  into a crash. `getThreadInfo`, `getUserInfo` and `getUserInfoV2` now retry a
  `null`/`undefined` result up to three times (first wait 3000 ms, doubling,
  capped at 30000 ms). Tune it with
  `login(cookie, { readRetry: { attempts, firstWaitMs, maxWaitMs } })`, or
  disable it with `readRetry: false`. A callback-style call is never retried, and
  an exception on the final attempt is thrown. Regression test:
  `test/readRetry.test.js`.

- **`getThreadList` items carry `isGroup`.** The inbox projection dropped the
  group flag, so commands that gate on groups (broadcast to every box, admin
  tools) filtered every thread out. Each item now exposes `isGroup` — from the
  inbox payload's `is_group`, or the participant count when that is absent.

## [2.2.5] - 2026-11-08

### Fixed

- **An array attachment (`attachment: [..]`) is sent as one media message per
  entry instead of failing with `Unsupported attachment`.** Instagram's
  `IGDirectMediaSendMutation` carries a single `attachment_fbid`, so a media send
  is inherently one message; `sendMessage` nevertheless only read
  `attachment || attachments[0]` and passed the raw value to
  `_sendAttachment`. When a ported GoatBot-Pro command handed it an array
  (pinterest's page of pins, backupdata's four exports, appstore, poli, rankup,
  shortcut), `_attachmentToBuffer` saw a non-buffer/non-string/non-stream value,
  returned null, and the send threw — so `/pinterest cat` answered
  `Search failed: Unsupported attachment`. `sendMessage` now flattens
  `attachment`/`attachments` into a list and commits one media per entry, with
  the text body on the first so the caption renders above the images. Regression
  test: `test/attachmentArray.test.js`.


## [2.2.4] - 2026-11-08

### Fixed

- **A swipe-reply to an image (or any media) keeps the target's attachment on the
  realtime push path.** The poller resolves the replied-to message through
  IGDThreadDetailQuery and hands the normalizer a full `repliedToMessage`
  (media included). The realtime push carries only the target's ids and text —
  never its media node — and the normalizer skipped its history lookup whenever
  `repliedToMessage` was present, so `event.messageReply.attachments` came out
  empty and every media command (imgbb, catbox, …) answered
  `Please reply to an image`. The normalizer now enriches an incomplete push
  reply from `getThreadHistory` (matched by mid *or* item id, cached per thread),
  and still skips the round-trip when the target already carries text. The reply
  sender's name is resolved from the offline index before any live lookup, so it
  no longer blocks dispatch on a web REST call that Instagram answers with
  302/429. Regression test: `test/replyMedia.test.js`.

## [2.2.3] - 2026-11-07

### Fixed

- **URL-bearing DMs are no longer dropped (push + poll).** Instagram types a DM
  that contains a link as a link preview, not plain text: the realtime push
  carries `item_type: "xma_link"` and the inbox snapshot carries
  `content_type: "MESSAGE_INLINE_SHARE"` (`content.__typename`
  `SlideMessageXMAContent`). Both decoders treated "not text" as "media", looked
  for a CDN attachment, found none, and discarded the message — so
  `/cmd install baby.js <url>` and every other URL command never reached the
  handler and produced no reply. The user's text (the command included) is still
  present in `text` / `text_body` / `xma_text_body`, so any non-`TEXT` item that
  actually carries text is now emitted as a text message with `itemType: "text"`.
  Items with neither text nor a parseable media URL are still dropped, and
  reactions / admin logs are unchanged. Regression test:
  `test/linkMessage.test.js`.

## [2.2.2] - 2026-11-06

### Added

- **`selfListen` option (FCA parity).** `login(cookie, { selfListen: true })`
  now delivers the session's own outbound messages on the event stream instead
  of dropping them, so a bot can answer commands sent from its own account
  (handy for testing without a second account). Default is `false`, which keeps
  the previous behaviour: the bot never reacts to its own messages, so a command
  cannot reply to itself forever. The flag is threaded through `src/api.js` →
  `src/methods/inbox.js` (poller self-filter and `listen()`), `src/realtime/
  bridge.js` and `src/realtime/listener.js` (push self-filter). Regression test:
  `test/selfListen.test.js`.

## [2.2.1] - 2026-11-06

### Fixed

- **Push-delivered swipe-replies were never typed as replies (`src/realtime/bridge.js`).**
  The realtime broker sends a reply's target as a full `replied_to_message`
  object (`item_id` + `message_id` + `text`), while the inbox poller uses a flat
  `replied_to_item_id`. `rawEventFromMessageSync()` read only the flat field, so
  a reply that arrived on the fast push path was emitted as a plain `message`
  with no reply linkage. The normalizer therefore never set `type:
  "message_reply"`, the handler's `onReply` never ran, and the reply waited for
  the next inbox poll (~8s with the safety poll) instead of answering on push.
  The bridge now normalises `replied_to_message` to the same
  `{ repliedToItemId, repliedToMessage }` pair the poller produces, so a
  swipe-reply answers immediately on the push. Regression test:
  `test/pushReply.test.js`.

## [2.2.0] - 2026-11-06

### Added

- **Push/poller id reconciliation (`src/realtime/reconcile.js`).** The realtime
  push and the inbox poll name the same DM differently — the poller uses the
  message mid (`mid.$...`), the push carries the numeric `item_id` and, when the
  broker includes it, the same mid. `buildKeys()` returns every key a message can
  be recognised by and `MessageDeduper` drops the second copy, so both paths can
  run at once without the bot replying twice. Exposed as
  `require("@cexi/hoonica").reconcile`.
- **`InboxMethods.startSafetyPoll(callback, intervalMs)`.** Runs the inbox poll on
  its own timer with its own 429 backoff, independently of the realtime listener,
  so a caller can keep a warm polling fallback under a push path. Returns a cancel
  function. With realtime on, `listen()` now uses it internally instead of relying
  on the pre-subscribe fallback alone.
- **`InstaClient.resolveThreadID()` / `InboxMethods.getThreadIdMap()`.** The push
  names a thread by its internal `thread_id`; the poller, thread-detail read and
  commands use the inbox id. The map is learned from every inbox snapshot so a
  pushed event can be rewritten to the id the rest of the bot uses.
- **`bridge` and `reconcile` are exported** from the package root for consumers
  that build their own listener.

### Fixed

- **One MQTT connection per session, shared by every consumer.** Instagram's
  broker routes the Direct message-sync stream to a single subscriber per device
  id, so a second connection with the same device id silently takes the stream
  away from the first — the "connects and subscribes but receives nothing"
  deafness. `realtimeConnect()` and `sharedRealtimeClient()` now return the same
  live client and serialise concurrent connects, so the inbox listener and the
  reaction push ride one connection instead of two.
- **`normalizeEvent` no longer blocks on a live `getUserInfo()`.** The sender-name
  lookup used to make a rate-limited REST round trip on the critical path before
  every command. It now prefers the name the client already learned from the
  inbox/thread views and only falls back to the live call.

## [2.1.2] - 2026-11-06

### Fixed

- **Realtime MQTT no longer flaps.** A dropped broker connection could never be
  brought back up: `SocketMQTToTTransport.connect()` kept the previous socket's
  `_closed`/`_error` state, so every `recvPacket()` on a reconnect rejected with
  the stale `MQTT socket closed` and the client reconnected in a tight loop
  (`realtime: MQTT transport closed` → `realtime reaction push connected` →
  `MQTT transport closed`). The transport now resets that state on connect.
- **Keep-alive matches the ping interval.** The CONNECT advertised a 20 s
  keep-alive while the PINGREQ timer fired every 30 s, so the broker dropped the
  socket after ~30 s of apparent silence. The keep-alive (60 s) and ping interval
  (25 s) now share the `KEEP_ALIVE_SECONDS` / `PING_INTERVAL_MS` constants, with
  the ping comfortably inside the window.
- **`realtimeConnect()` returns a live client.** After a drop it handed back the
  stale, disconnected client, so a caller that "reconnected" was still holding a
  dead socket. It now reuses the client only while `connected` and otherwise
  builds a fresh one. Callers should attach handlers to the returned client (see
  `README`); a reconnect can yield a new instance.
- **`disconnect()` no longer leaks an unhandled rejection.** The teardown write
  (`DISCONNECT` packet) is cancelled when the socket closes and its rejection
  (`write ECANCELED Canceled because of SSL destruction`) was unhandled, which
  could crash the process on every disconnect. It is now swallowed.
- **No duplicate ping timers.** `connect()` clears any previous ping timer, so a
  reconnect does not leave the old one running alongside the new one.
- `test/realtime.test.js` now awaits its async sections (they previously resolved
  after the process had already printed its result, so their assertions were
  never counted) and covers the reset, reconnect, keep-alive and teardown paths.

## [2.1.0] - 2026-10-14

### Added

- **Realtime MQTT listening.** `listen()` can now receive DMs over Instagram's
  realtime broker (`edge-mqtt.facebook.com`) instead of polling the inbox, so
  replies are pushed the moment Instagram delivers them. Opt in with
  `login(cookie, { realtime: { enabled: true } })`; the callback and event shape
  are identical to polling, and a broker that will not connect falls back to the
  poller (unless `realtime.fallback` is `false`).
  - `src/realtime/mqttot.js` — a dependency-free MQTToT codec: the Thrift-compact
    CONNECT struct, MQTT packet framing, zlib payloads and a TLS transport.
  - `src/realtime/client.js` — `RealtimeClient`: cookie-auth connect, keepalive,
    and decoding of message-sync (`/direct_v2/threads/<id>/items/<id>`) and
    realtime-sub payloads into `message`, `typing`, `seen` and `presence` events.
  - `src/realtime/bridge.js` — turns a message-sync patch into the same raw inbox
    event the poller produces, so `EventNormalizer` is unchanged.
  - `src/realtime/listener.js` — `RealtimeListener`, which `listen()` drives.
  - Native `InstaAPI` gains `realtimeClient`, `realtimeConnect`, `realtimeOn`,
    `realtimeSubscribe`, `realtimePing`, `realtimeDisconnect`; `RealtimeClient`
    and `RealtimeListener` are exported from the package root.
- `examples/realtime-bot.js` — the tiny DM bot over realtime push.
- `test/realtime.test.js` — codec, bridge, dispatch and `listen()` fallback.
- **V2 profile plugins.** `src/api/users/` gains `getUserInfoV2`,
  `getProfilePictureV2`, `getUserProfile`, `getUserID`, `getProfileBio`,
  `getUserFriendship` and `getSelfInfo` (FCA surface + `users` / `account`
  namespaces). `getUserInfoV2` returns the *complete* profile — username, full
  name, biography, follower/following/media counts, verified/private/business
  flags, external url, category, business contact and the square + HD picture —
  not just the fca subset V1 returned. `getProfilePictureV2` returns the picture
  at any square size (derived from the CDN `stp=` param, no extra request) plus
  the HD original. The native `InstaAPI` gains `getUserProfile` /
  `getProfilePicture`.
  - `src/profileParse.js` — normalizes the `web_profile_info` REST JSON, the
    profile GraphQL `data.user`, the HTML-embedded `PolarisViewer` blob and the
    inbox user record into one shape, and resizes a picture URL.
  - `test/profile.test.js` — normalization, the logout-safe resolver and the
    plugins.

### Fixed

- **A profile lookup can no longer masquerade as a dead session (the logout
  bug).** `getInfo` reads `/api/v1/users/<id>/info/`, which Instagram 302s to the
  login page for a web session — the HTTP layer classifies any 3xx as an auth
  failure, so any command that looked up a profile could trip the session guard
  and log the bot out. Profile reads now go through a resolver that tries the
  users already learned from the inbox/thread views, `web_profile_info`, the
  profile GraphQL query and the account's own server-rendered page, and swallows
  a 429 / 302 from any of them. It never throws and returns `null` when nothing
  resolves. `init()` also resolves the logged-in username from the home shell
  instead of the same 302'ing REST path.

## [2.0.10] - 2026-10-11

### Added

- **`event.participantIDs` is populated on Instagram message events.** Facebook
  MQTT events carried the thread's member list, so commands ported from
  GoatBot-Pro read `event.participantIDs` (`all.js` tags every member, `ban.js`
  checks membership). Instagram inbox events carry none, so the normalizer now
  fills it from the participants the client learned from thread introspection
  (`InstaClient.getThreadParticipantIDs`, fed by the native inbox poller's
  per-poll snapshot). It stays `undefined` when unknown — the same shape as
  upstream, so `|| []` guards keep working.
- **`addUserToGroup` / `removeUserFromGroup` resolve a username or `@handle` to
  a numeric igid** before calling the endpoint, against the offline user index
  first and a live lookup second, and return `false` rather than send a
  non-numeric id Instagram would 4xx on. The frozen `adduser.js` may hand over a
  handle it could not resolve itself.

### Fixed

- **A username lookup can no longer masquerade as a dead session.** Both
  `usernameinfo` and `users/search` are `/api/v1` REST paths that Instagram now
  answers with a 302 to the login page for a web session; the HTTP layer
  classifies any 3xx as an auth failure, so `getInfoByUsername` (and `search`)
  used to leak an auth-classified error. They now return `null` / `[]`, letting
  callers fall back to the users learned from thread introspection.
- **A command that builds an empty reply no longer risks the session.** An empty
  text send already returns `{ messageID: null, dropped: "empty" }`; the ported
  `adduser.js` (now byte-identical to GoatBot-Pro) can produce an empty string
  for a handle it cannot resolve, and the drop guard keeps that from reaching
  Instagram's login-page redirect.

## [2.0.9] - 2026-10-11

### Fixed

- **`unsendMessage` still never deleted the message.** The 2.0.8 fix sent
  `_csrftoken` + `_uuid` to the REST delete endpoint
  (`/api/v1/direct_v2/threads/<t>/items/<id>/delete/`), but Instagram retired
  that endpoint: on `www.instagram.com` the whole `/api/v1` namespace now
  returns `{"message":"useragent mismatch","status":"fail"}` /
  `not-logged-in` 404, and on `i.instagram.com` it needs the mobile app
  identity. Unsend now goes through the web DM client's Relay mutation
  `IGDMessageUnsendDialogOffMsysMutation` (doc_id `26948700068153789`) with
  `{ message_id, send_data: { thread_id } }`, which answers
  `{ data: { direct_unsend_message: true } }`. Verified against a real message.

## [2.0.8] - 2026-10-11

### Fixed

- **`unsendMessage` never deleted the message.** The REST delete request was
  sent with an empty body, which Instagram rejects with `status: "fail"` (or a
  404/redirect). The web client sends `_csrftoken` and `_uuid`, so `/unsend`
  now includes both. Previously the call resolved to `false`, which the bot
  surfaced as "Could not unsend this message (Instagram refused it, or the
  message is too old)."

## [2.0.7] - 2026-10-11

### Fixed

- **`unsendMessage` silently failed for a message the bot did not send in this
  process.** The thread of the id being unsent was resolved only from the
  in-memory `messageID -> threadID` map, so unsending a message sent before a
  restart (or a reply to someone else's message) threw `Unknown thread for
  message` internally and returned `false` — `/unsend` appeared to do nothing.
  `unsendMessage(messageID, callback?, threadID?)` now accepts the thread
  explicitly, and the normalizer remembers the replied-to message id (whose
  thread is known) so the map lookup succeeds. The thread the message was seen
  in is always a safe explicit value for `/unsend`.

## [2.0.6] - 2026-10-10

### Added

- **Configurable poll floor.** `new InstaAPI(cookie, { minPollIntervalMs })` (and
  the same option on `InstaClient`) sets the lowest interval `listen()` will
  honour, defaulting to 15000 ms as before with a hard 2000 ms minimum.
  Instagram has no DM push, so reply latency is one poll cycle; operators on a
  residential/mobile proxy can lower it (e.g. 2000) for snappier replies.
  `api.listen(cb, interval)` still cannot go below this floor, so the bot can no
  longer pass an interval the package silently raises.

## [2.0.5] - 2026-10-10

### Fixed

- **Empty text send logged the account out.** `MessageMethods.send()` now drops
  an empty (or whitespace-only) body instead of firing an
  `IGDirectTextSendMutation` with an empty `sensitive_string_value`. Instagram
  answers that with a 302 to the login page, which the HTTP layer classifies as
  `IG_SESSION_INVALID`, so a command that built an empty reply (for example
  `adduser` handed a username it could not resolve) made the poller stop and
  report the session as dead. The dropped send returns
  `{ messageID: null, dropped: "empty" }`.

## [2.0.4] - 2026-10-10

### Fixed

- **Captioned media lagged behind its text.** A message carrying both text and
  an attachment uploads the media first, then commits the caption and the media
  back-to-back, so the text and the image land together instead of the image
  trailing by the whole upload time. Instagram's DM media mutation has no caption
  field, so caption + attachment is still two messages; this only removes the
  perceived gap after the caption.

### Added

- `antiSuspension.waitForTurn(threadID, { immediate })`: an immediate turn that
  still counts against the volume caps but skips the inter-message gap, so a
  captioned attachment can follow its caption at once.

## [1.0.12] - 2026-10-10

### Fixed

- **Bot logged out on a network blip.** `init()` treated every failed probe
  (timeout, 5xx, 429) as an expired cookie. It now distinguishes a dead session
  (`IG_SESSION_INVALID`), a security check (`IG_CHALLENGE`), a suspended account
  (`IG_SUSPENDED`) and a temporary failure (`IG_TRANSIENT`, with `retryAfterMs`),
  and retries transient failures before giving up.
- **Poller stopped on a single redirect.** `listen()` shut down on the first
  3xx. It now requires two consecutive auth failures plus a fresh session check
  before reporting the session dead, stops at once only on a challenge or a
  suspension, and keeps polling through transient errors with backoff.
- **Rotated cookies were never reused.** The saved `appstate.json` is now
  merged back in on the next start when it belongs to the same `sessionid`, and
  snapshots are written atomically so a crash cannot leave a truncated file.
- **Poll cadence looked scripted.** Poll interval floor raised to 15s (default
  20s) with +/-20% jitter, and polling slows down while a cooldown is active.
- **Cooldown did nothing.** The old cooldown added 2-5s per send and the
  hourly/daily caps only added a short delay. Sends are now serialized with a
  global gap, a per-thread gap and jitter; caps and cooldown enforce a real
  gap, strikes decay, and repeated cooldowns escalate (1h up to 6h).
- Suspicion signals are now detected on every request (challenge, checkpoint,
  `feedback_required`, suspended), not only on sends, and one failing request
  counts as one strike instead of two.
- The legacy broadcast fallback is no longer attempted while rate-limited,
  challenged or cooling down.
- Responses carrying `x-ig-set-www-claim` are tracked and echoed back like the
  web client does, instead of always sending `0`.
- Redirects are no longer followed on API calls, so a dead session fails on the
  first response instead of after five wasted requests.

### Added

- `INSTA_DATA_DIR` environment variable: directory for `device.json`,
  `session-params.json` and `appstate.json` (point it at a persistent volume on
  Render/Railway so the identity survives restarts).
- `appStateFile` option on `InstaAPI`.

## [1.0.11] - 2026-10-10

### Fixed

- **Attachment caption order.** A message carrying both text and an attachment
  (e.g. `sendMessage({ body, attachment })`) sent the media first and the text
  second, so the image rendered above its caption. The text is now sent before
  the media upload, so the recipient sees the caption on top and the
  photo/attachment underneath — matching how ported GoatBot-Pro commands format
  a header line followed by an image.

## [1.0.10] - 2026-10-10

### Fixed

- **Silent message drop.** Instagram answers a rejected Relay mutation with HTTP
  200 plus a top-level `errors` array. `postGraphQL` returned that payload as if
  it were a success, so `sendMessage` reported a `messageID` for a message
  Instagram never stored. Write operations (text send, media commit, caption,
  reaction, edit) now pass `{ throwOnError: true }`, which throws an
  `InstagramGraphQLError` carrying the relay `errors`. Read/query paths keep the
  old lenient behaviour so `getThreadHistory` still maps a rejected query to `[]`.
- `sessionGuard` now snapshots the cookie jar once at install time instead of
  waiting for the first 5-minute interval, so a crash right after login no longer
  leaves no good `appstate.json` on disk.
- `_resolveMentionsOffline` falls back to a live `getUserInfoByUsername` (and
  indexes the result) when a handle was never seen in the inbox, instead of
  dropping the mention.
- `addUserToGroup` / `removeUserFromGroup` degrade to a `false` stub when the
  native client does not expose the pair, matching the other group-management
  stubs.
- Reaction send/remove now note a failed mutation to the anti-suspension pacer,
  and reaction removal is paced like every other outbound send. Previously a
  checkpoint surfaced by a reaction was never counted as a strike, and removals
  bypassed the pacer entirely.
- Adds `test/safetyWiring.test.js`, which asserts the pacer is actually invoked
  (paced before the network call, noted on failure) by the text and reaction
  send paths, rather than merely being exported.

## [1.0.9] - 2026-10-09

### Added

- **Anti-suspension send pacer** (`src/utils/antiSuspension.js`), ported from
  `@cexi/hoonfca`. Every outbound DM (text, media, reactions) is paced with a
  per-thread gap plus jitter, capped per hour/day, and throttled for 45 min when
  a response or error mentions a checkpoint/spam/rate-limit signal. A freshly
  logged-in session starts under a stricter warmup ceiling (40/hr → 350/hr).
  This is the main reason an account survives weeks instead of days.
- **Session guard** (`src/utils/sessionGuard.js`), ported from `@cexi/hoonfca`.
  Snapshots the live cookie jar to `appstate.json` every 5 min, keeps the
  previous copy as `.bak`, and refuses to overwrite a good file with a shorter
  one (truncation guard). Installed automatically on every `InstaClient`;
  disable with `login(cookie, { sessionGuard: false })`.

### Changed

- `listen()` no longer piles polls on top of an HTTP 429. It tears down the
  current poll, re-arms with exponential backoff (30s → 10min), and resets on a
  clean poll. A dead session (redirect to the login page) now stops the listener
  instead of spinning forever. The poll interval is floored at 10s.
- Exported `antiSuspension` and `sessionGuard` from the package root.

## [1.1.0] - 2026-10-08

### Added

- **FCA / GoatBot-Pro shaped client.** The Facebook-Chat-API surface that used
  to live in the bot as `bot/adapter/IGAdapter.js` now ships inside the package
  as `InstaClient`. `login()` resolves to it by default; `{ native: true }`
  returns the bare `InstaAPI`. It exposes `sendMessage`, `sendMessageSync`,
  `setMessageReaction`, `editMessage`, `unsendMessage`, `getThreadInfo`,
  `getThreadList`, `getThreadHistory`, `getUserInfo`, `getUID`,
  `getCurrentUserID`, `getAppState`/`getCookies`, `listen`, media senders and
  the group-management stubs, so ported commands run unchanged.
- **One file per method** under `src/api/<group>/<method>.js` (mirroring the
  reference FCA layout): `messaging/`, `threads/`, `users/`, `action/`,
  `realtime/`. Adding a method is adding a file — `loadApiMethods()` attaches
  them all.
- `src/app/InstaClient.js`, `src/app/InstaContext.js` (per-thread view),
  `src/app/createFcaClient.js` (namespaced `messages.*` / `threads.*` / …),
  `src/events/normalizeEvent.js` (raw inbox event → FCA event) and
  `module/login.js` (classic `login(credentials, callback)`).
- `wrap()`, `createContext()`, `createFcaClient()`, `EventNormalizer` and
  `loadApiMethods` are exported from the package root.
- `InstaClient` also re-exposes the native client's methods (`sendPhotoBuffer`,
  `sendVoiceBuffer`, `markThreadSeen`, `getUserInfoByUsername`, …), so a command
  may use either the FCA-style or the native call. FCA-shaped methods win.
- Tests: `test/client.test.js` (60 checks) covering the FCA surface, reply
  plumbing, reaction/edit routing, the event normalizer, the namespaced view,
  native delegation and the full `api.*` surface the frozen commands call.

### Changed

- Text styling (`*bold*`, `_italic_`, `~strike~` → Unicode) moved into the
  package as `src/utils/messageStyle.js`, so the client can convert message
  bodies on its own. The bot no longer carries a copy.

## [1.0.6] - 2026-10-08

### Fixed

- **Quote-replies now render.** Captured a real reply from the Instagram web
  client (`IGDirectTextSendMutation`, doc_id `26911679871773184`): it carries
  the target in `reply_to_message_id` and leaves `replied_to_item_id` /
  `replied_to_client_context` null. `send`/`reply`/`sendMessage` now do the
  same, so the quoted bubble shows up in the thread. The old `replied_to_*`
  approach only set a pointer and rendered nothing.
- `replyToItemId` accepts a message id string/number or an object with
  `messageID`/`id`; the now-unused `replyToClientContext` argument is gone.

## [1.0.5] - 2026-10-08

### Changed

- `send`/`reply`/`sendMessage` accept the reply target as a bare item id, a
  plain context string, or `{ offlineThreadingId | clientContext }`, and
  `getThreadHistory`/inbox items now expose `offlineThreadingId`.

### Known limitation

- **Quote-replies do not render yet.** Sending `replied_to_item_id` +
  `replied_to_client_context` + `replied_to_action_source: "swipe"` makes
  Instagram store a `replied_to_message_id` pointer, but it does **not** embed
  the quoted message (`replied_to_message` stays null) and the web UI shows no
  quote bubble. The IG web client uses `replySourceId` /
  `replySourceIdMessageID` for this, so the mutation variables above are
  incomplete. Verified by comparing an API-sent reply against an app-sent reply
  in the same thread (the app-sent one renders the quote, the API-sent one does
  not). A fix needs a capture of the real web send request.

## [1.0.4] - 2026-10-08

### Added

- **Reply targeting.** `sendMessage(text, threadID, replyToItemId,
  replyToClientContext)` and `replyToMessage(...)` now set a reply pointer on
  the outgoing DM. Note: this sets the pointer only; the quote bubble does not
  render (see 1.0.5). Matching Instagram's native client
  (instagrapi `direct_send`), the mutation carries `replied_to_item_id`, the
  target's `replied_to_client_context` and `replied_to_action_source: "swipe"`;
  previously all three were hard-coded null, so quoted replies went out
  unlinked. The legacy broadcast fallback sends the same fields.

### Changed

- Inbound/history events now expose each item's `clientContext`, and the reply
  context (`normalizeRepliedMessage`) carries `clientContext`, so a caller can
  quote an inbound message without a second lookup.

## [1.0.3] - 2026-10-08

### Added

- **`editMessage(threadID, itemID, text)`.** Instagram allows editing an
  outgoing DM within 15 minutes; this wraps the captured
  `IGDirectEditMessageMutation` (doc_id `32480262318254796`) and returns
  `{ messageID, edited: true }` on success.

### Fixed

- **Inbound replies now carry full context.** The DM inbox query
  (`PolarisDirectInboxQuery`) does not project reply linkage, so
  `listen()` events always had `repliedToItemId: null` and bot reply handlers
  (`/uns`, `/catbox`, GoatBot `onReply`) never fired. Events are now enriched
  from `IGDThreadDetailQuery`, which exposes `replied_to_message_id` and the
  full `replied_to_message` node. Each event also carries a normalized
  `repliedToMessage` (`{ messageID, senderID, body, attachments, senderName }`).
- **`getThreadHistory` returned nothing.** It hit the dead REST endpoint
  `direct_v2/threads/<id>/`. It now reads `IGDThreadDetailQuery` and returns
  fca-shaped items with `messageID`, `senderID`, `body`, `timestamp`,
  `attachments` and reply fields.
- **`getThreadInfo` was null.** The legacy REST endpoint 404s on modern web
  sessions; it now falls back to the thread-detail query.
- **Inbound media parsing.** Photo/video/audio/GIF/animated-media/XMA content is
  parsed from the `content` object (`SlideMessageImageContent`, `videos`, `xma`,
  …) instead of the never-present `content.image.url` path, so media messages are
  no longer dropped from the event stream.

## [1.0.0] - 2025-09-15

### Added

- Initial public release.
- `login(cookie, [options], [callback])` entry point (Promise + FCA-style callback).
- Messaging: `sendMessage`, `replyToMessage`, `sendLink`, `sendReaction`,
  `removeReaction`, `unsendMessage`, `startTyping`, `stopTyping`.
- Media: `sendPhoto` / `sendVideo` / `sendVoice` (+ Buffer and URL variants).
- Threads: `getThreadInfo`, `getThreadHistory`, `markThreadSeen`,
  `muteThread`, `unmuteThread`, `hideThread`.
- Users: `getUserInfo`, `getUserInfoByUsername`, `searchUsers`.
- Inbox: `getInbox`, `listen(cb, intervalMs)` returning a `stop()` function.
- `harvestSessionParams()` + `findChromium()` browser session-param capture.
- Pure-HTTP runtime (no browser after harvesting) via Relay GraphQL + `rupload`.
- Graceful reaction support through `IGDirectReactionMutation`.

## License change
- Relicensed from MIT to Apache-2.0 (original author credit and NOTICE must be retained).
