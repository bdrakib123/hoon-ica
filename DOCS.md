# @cexi/hoonica — API documentation

Unofficial Instagram Direct Message API for Node.js. This document describes the
public API and the reverse-engineered protocol the package speaks.

## Introduction

Instagram's web Direct client does **not** use the old
`/api/v1/direct_v2/...` REST endpoints any more — most of them now `404`
(Instagram answers with the login HTML shell). The current client uses **Relay
GraphQL** for reads and sends, and a dedicated `rupload` PUT for media. This
package reproduces that flow exactly, so it stays alive as long as the web
client does.

Because Instagram validates the browser **session params** (`__dyn`, `__csr`,
`__hs`, `__hsi`, `__s`, `fb_dtsg`, `jazoest`, `lsd`, ...) on every request,
you should supply them via `harvestSessionParams()` once per session.

## Installation

Requires **Node.js >= 20**.

```bash
npm install @cexi/hoonica
```

Browser session harvesting is optional. `puppeteer-core` is not installed
automatically; install a Node-compatible version separately only if you need
`harvestSessionParams()`. Otherwise pass pre-harvested `sessionParams` and
the package runs without Puppeteer or a browser dependency. Audit any optional
Puppeteer installation in your application.

## Entry point

```javascript
const login = require("@cexi/hoonica");
```

`login(cookie, [options], [callback])` returns a `Promise<InstaClient>` (or
calls back FCA-style). `cookie` accepts:

- a raw `sessionid=...` string,
- a full browser `Cookie` header (`"k=v; k=v; ..."`),
- a `{ name: value }` object,
- a browser-devtools cookie array (`[{ name, value }]`).

`InstaClient` is the **FCA-shaped** surface (what GoatBot-Pro / Facebook-Chat-API
commands call). Pass `{ native: true }` to get the bare `InstaAPI` instead.

### options

| Key | Default | Meaning |
|-----|---------|---------|
| `native` | `false` | Resolve the bare `InstaAPI` instead of the FCA `InstaClient`. |
| `sessionParams` | – | Pre-harvested browser session params. |
| `sessionParamsFile` | `./session-params.json` | Load params from disk. |
| `deviceFile` | `./device.json` | Persisted device identity. |
| `pollInterval` | `15000` | `listen()` poll interval (ms), used when realtime is off. |
| `minPollIntervalMs` | `15000` | Lowest interval `listen()` will honour (floor, min 2000). |
| `realtime` | – | `{ enabled, fallback, host, keepAliveMs }` — realtime MQTT push for `listen()`. `keepAliveMs` (default 25000) is the PINGREQ interval and must stay below the CONNECT keep-alive (60 s). |
| `readRetry` | `{ attempts: 3, firstWaitMs: 3000, maxWaitMs: 30000 }` | Retry a throttled read (a `null` result) before giving up. `false` disables it. |
| `sendPacing` | – | Tune the anti-suspension send pacer (`{ enabled, globalMinGapMs, perThreadMinGapMs, jitterMs, warmupWindowMs, warmupHourlyCap, normalHourlyCap, dailyCap, overCapGapMs }`). `{ enabled: false }` sends with no throttle at all. |

A throttled read (`getThreadInfo`, `getUserInfo`, `getUserInfoV2`) resolves
`null` instead of throwing. With `readRetry` on, the client retries that
`null`/`undefined` result up to `attempts` times (hard cap 10) — the first wait is
`firstWaitMs` (clamped to `maxWaitMs`), doubling each attempt up to `maxWaitMs` (both waits hard-capped at five minutes) — so a caller that
destructures the result answers normally instead of crashing on a transient
HTTP 429. A callback-style call is never retried, thrown errors surface
immediately, and `readRetry: false` turns the behaviour off. Only
`null`/`undefined` results are retried.

Every outbound send is paced by the anti-suspension pacer so a personal account
does not look scripted. That pacing is serialized across sends, and once the
warmup hourly cap is passed it applies `overCapGapMs` (20 s) to every send, so a
busy account's replies queue up and drift. Pass `sendPacing` to loosen it, or
`{ enabled: false }` to turn it off entirely. `setSendPacing()` re-tunes a live
client.

## `InstaClient` (FCA surface)

`InstaClient` wraps a native `InstaAPI` (kept as `.api`) and exposes the
Facebook-Chat-API shape. Its methods live one-per-file under
`src/api/<group>/<method>.js` and are attached by `loadApiMethods()`.

| Group | Methods |
|-------|---------|
| messaging | `sendMessage(form, threadID, cb?, replyToMessage?)`, `sendMessageSync`, `editMessage(text, messageID)`, `unsendMessage(messageID, cb?, threadID?)`, `setMessageReaction(emoji, messageID, cb?, threadID?)`, `sendTypingIndicator`, `markAsRead`, `shareContact`, `resolvePhotoUrl` |

**Contact sharing:** Instagram's web adapter does not expose a verified native contact-card mutation. The FCA `shareContact` compatibility method therefore sends the contact's profile link and id as a normal DM; a send failure is returned as `null` and recorded in `client.lastShareContactError`.
| threads | `getThreadInfo`, `getThreadList`, `getThreadHistory` |
| users | `getUserInfo`, `getUserInfoV2`, `getUserProfile`, `getProfilePictureV2`, `getProfileBio`, `getUserFriendship`, `getUserID`, `getUID`, `getProfilePictureUrl` |
| account | `getCurrentUserID`, `getSelfInfo`, `getAppState`, `getCookies`, `setOptions` |
| realtime | `listen`, `stopListening`, `getInbox(cursor?)`, `realtimeConnect`, `realtimeOn`, `realtimeSubscribe`, `realtimePing`, `realtimeDisconnect` |
| media | `sendPhoto`, `sendPhotoFromUrl`, `sendVideoFromUrl`, `sendVoiceFromUrl` |

Group-management calls Instagram DMs cannot do (`changeNickname`, `setTitle`,
`changeThreadColor`, `changeThreadEmoji`, `changeGroupImage`, `changeAvatar`)
return `false` instead of throwing, so ported commands degrade cleanly.
Adding and removing participants are supported when Instagram accepts the
requested user id.

**Multi-attachment sends:** FCA `sendMessage` accepts `attachment` or
`attachments` arrays and sends one media message per item in order; the text
caption is attached to the first item only. If a later item fails, the thrown
error includes `partialSend: { sentCount, totalAttachments, messageIDs }`
for items known to have been sent. Captioned native media sends are two
Instagram commits (text + media); if one succeeds and the other fails, the
error includes `partialSend: { captionSent, mediaSent }`. Check this metadata
before retrying to avoid duplicate messages.

For FCA attachment sends, `form.maxDownloadBytes` (100 MiB default, 512 MiB
hard cap) and `form.downloadTimeoutMs` (60 s default, 120 s hard cap) bound URL,
Buffer, local-file, and stream inputs. HTTPS redirects cannot downgrade to HTTP.

Native `sendPhotoBuffer`, `sendVideoBuffer`, `sendVoiceBuffer` and their
file-path / URL variants enforce `options.maxUploadBytes` (100 MiB default,
512 MiB hard cap). File-path variants check the file size before reading it.
URL-based media downloads and FCA attachment URL downloads reject private,
loopback, link-local and reserved IP destinations, including unsafe DNS answers
on redirects.

`createFcaClient(client)` returns a namespaced view (`messages.send()`,
`threads.getInfo()`, `users.getInfo()`, …) if you prefer namespaces over the
flat surface. `new InstaContext(client, threadID)` binds a thread for
`send`/`reply`/`react`/`unsend`/`edit`.

### Events

`EventNormalizer` turns a raw inbox event into the FCA event shape
(`senderID`, `threadID`, `messageID`, `body`, `mentions`, `messageReply`,
`type`, `attachments`, `senderName`). `login()` output is not required — pass
any `InstaClient`:

```javascript
const { EventNormalizer } = require("@cexi/hoonica");
const normalizer = new EventNormalizer(client);
api.listen(async (err, raw) => {
  if (err) return;
  const event = await normalizer.normalize(raw);
  if (event) console.log(event.senderID, event.body);
});
```

## `InstaAPI` (native)

The low-level client `InstaClient` wraps. `login({ native: true })` returns it
directly; `client.api` is always one.

### Identity

| Method | Description |
|--------|-------------|
| `init()` | Validate the session, resolve the user id/username, bootstrap tokens. Called by `login`. |
| `getCurrentUserID()` | The logged-in account id. |
| `refreshSession(params?)` | Swap in fresh session params. |

### Messaging

`sendMessage(text, threadID, replyToItemId?)`,
`replyToMessage(threadID, text, replyToItemId?)`,
`sendLink(threadID, link, text)`, `sendReaction(threadID, itemID, emoji)`,
`removeReaction(threadID, itemID)`, `unsendMessage(threadID, itemID)`,
`editMessage(threadID, itemID, text)`,
`startTyping(threadID)`, `stopTyping(threadID)`.

Pass the target message id as `replyToItemId` to send a quote-reply, e.g.
`api.replyToMessage(threadID, "hi", event.messageID)`. The id is any message's
`item_id` / `messageID` (an Instagram `mid.$...` value). It is sent in
`reply_to_message_id`, which is the field the Instagram web client uses, and
renders the quote bubble in the thread.

### Media

`sendPhoto` / `sendPhotoBuffer` / `sendPhotoFromUrl`,
`sendVideo` / `sendVideoBuffer` / `sendVideoFromUrl`,
`sendVoice` / `sendVoiceBuffer` / `sendVoiceFromUrl`.

All take `(threadID, source, options)`. Options include `{ filename, text }`; URL-based sends also accept `maxDownloadBytes` (100 MiB default, capped at 512 MiB) and `downloadTimeoutMs` (30 s default, capped at 120 s). URL downloads accept HTTP(S) only.

### Threads

`getThreadInfo`, `getThreadHistory(threadID, limit, beforeTimestamp?)`,
`markThreadSeen(threadID, itemID)`, `muteThread`, `unmuteThread`, `hideThread`.

`getThreadHistory` returns messages newest-first. Pass the timestamp of the
oldest message from the previous batch as `beforeTimestamp` to load up to
`limit` older messages. The requested limit must be a positive safe integer
from 1 through 5,000; Instagram requests are paginated in batches of at most
50 messages. Timestamps are Unix milliseconds (Unix seconds are also accepted);
the boundary message itself is excluded.

### Users

`getUserInfo(userID)`, `getUserInfoByUsername(username)`, `searchUsers(query, limit)`,
`getUserProfile(idOrUsername, opts?)`, `getProfilePicture(idOrUsername, opts?)`.

`getUserProfile` returns the complete merged profile (see
`README.md` -> *Full profiles*): id, username, full name, biography,
follower/following/media counts, verified/private/business flags, external url,
category, business contact, `profilePicUrl` and `profilePicUrlHd`. It is
logout-safe — it merges the users learned from the inbox/thread views with
`web_profile_info`, the profile GraphQL query and the account's own page, and
swallows a 429 / 302 from any source, so a profile read never trips the session
guard. Returns `null` when nothing resolves.

`getProfilePicture(idOrUsername, { size })` returns the best picture URL at the
requested square size.

### Inbox / listening

`getInbox()` returns `{ threads }`. `listen(callback, intervalMs)` emits
normalized `message` events and returns a `stop()` function. `stopListening()`
also stops it.

By default `listen` polls the inbox; the interval is raised to the client's
`minPollIntervalMs` floor (default 15000 ms, minimum 2000 ms). Pass
`{ realtime: { enabled: true } }` to `login` and `listen` instead subscribes to
Instagram's realtime MQTT stream, so each new DM is pushed the moment Instagram
delivers it. The callback and event shape are the same either way, and a realtime
connection that cannot be established falls back to polling unless you set
`realtime: { enabled: true, fallback: false }`.

### Realtime (MQTT)

The realtime broker (`edge-mqtt.facebook.com`) is an MQTToT connection whose
CONNECT payload is a Thrift-compact struct and whose password is
`sessionid=<sessionid>`; the session cookie authenticates it, so there is no app
login. Message-sync publishes (`/direct_v2/threads/<id>/items/<id>`) are decoded
into the same raw inbox events the poller produces and normalized identically.

| Method | Description |
|--------|-------------|
| `realtimeClient(options?)` | Build a raw `RealtimeClient` without connecting. |
| `realtimeConnect(options?)` | Open the MQTT connection. Resolves to the session's shared client; after a drop it reuses that client and its registered handlers while resetting the stale transport. |
| `realtimeOn(event, handler)` | Subscribe to `message`, `typing`, `seen`, `presence`, `direct`, `receive`, `error`, `disconnected`. |
| `realtimeSubscribe()` | Subscribe to the Direct message-sync stream (reads the cursor from the inbox query). |
| `realtimePing()` | Send a keepalive ping. |
| `realtimeDisconnect()` | Close the connection. |

`RealtimeClient` and `RealtimeListener` are also exported from the package root.

A custom cursor can be supplied with `realtime.seqId` or `getRealtimeState()`. Use a decimal **string** for sequence IDs above `Number.MAX_SAFE_INTEGER`; numeric values outside JavaScript's safe-integer range are rejected rather than rounded.

### Event shape

```javascript
{
  type: "message",
  threadID: "340282366842...",
  senderID: "1234567890",
  messageID: "mid.$cAAA...",
  body: "hello",
  attachments: [{ type: "photo", url: "https://...", caption: null }],
  itemType: "text",
  repliedToItemId: null,
  timestamp: 1791442499484
}
```

## Protocol notes

### Endpoints (`src/constants.js`)

| Name | Value |
|------|-------|
| Web origin | `https://www.instagram.com` |
| GraphQL | `https://www.instagram.com/api/graphql` |
| rupload | `https://rupload.instagram.com/<consumer>/<uuid>` |

Relay **doc_ids** (stable per friendly-name, rotate rarely):

| Operation | doc_id |
|-----------|--------|
| `IGDirectTextSendMutation` | `26911679871773184` |
| `IGDirectMediaSendMutation` | `25766288509716264` |
| `IGDirectReactionMutation` | `24374451552236906` |
| `IGDirectAnimatedMediaSendMutation` | `32089613413987432` |
| `IGDirectCutoutStickerSendMutation` | `26601474479505807` |
| `PolarisDirectInboxQuery` | `27909866362025854` |
| `useFeatureLimitsOffMsysQuery` (login probe) | `28374543635529813` |
| `IGDMessageUnsendDialogOffMsysMutation` (unsend) | `26948700068153789` |
| Thread detail | `29619996517588618` |

### Text send

`IGDirectTextSendMutation` with variables:
`{ ig_thread_igid, offline_threading_id, text: { sensitive_string_value }, ... }`,
`Referer: https://www.instagram.com/direct/t/<threadID>/`.

### Media send

1. **Upload** the raw bytes with `PUT`-style POST to
   `https://rupload.instagram.com/<consumer>/<uuid>?<sessionParams>`.
   Consumer + type header from the MIME type (`messenger_image`/`image_type`,
   `messenger_video`/`video_type`, `messenger_audio`/`audio_type`,
   `messenger_gif`/`image_type`, `messenger_file`/`file_type`).
   Instagram may answer `412 AuthorizationFailedError` transiently — the client
   retries with backoff.
2. **Commit** with `IGDirectMediaSendMutation`:
   `{ attachment_fbid, thread_id, offline_threading_id }`. Only errors classified as
   transient are retried, and every attempt reuses the same `offline_threading_id`
   to avoid creating a second logical send after an ambiguous response. GraphQL
   `field_exception` errors are surfaced rather than blindly retried.

### Reactions

`IGDirectReactionMutation` with a **flat `input`** object:

```javascript
{ input: { emoji, item_id, message_id, reaction_status, thread_id } }
```

`reaction_status` is `"created"` or `"deleted"`. (Reverse-engineered from the
live `comet/CometDirectPageWeb` bundle; the legacy REST reaction endpoint 404s.)

### Unsend (delete for everyone)

`IGDMessageUnsendDialogOffMsysMutation` (doc_id `26948700068153789`) with
variables:

```javascript
{ message_id: "<mid.$...>", send_data: { thread_id: "<threadID>" } }
```

It answers `{ data: { direct_unsend_message: true } }`. The legacy REST delete
endpoint (`/api/v1/direct_v2/threads/<t>/items/<id>/delete/`) is gone: on
`www.instagram.com` the whole `/api/v1` namespace returns `not-logged-in` 404,
and on `i.instagram.com` it needs the mobile app identity. (Reverse-engineered
from the live `IGDMessageUnsendDialogOffMsys.react` chunk.)

### Session validation

The REST probe endpoints lie (they 302 to login even for healthy sessions), so
`isLoggedIn()` issues a cheap authenticated GraphQL call
(`useFeatureLimitsOffMsysQuery`) and treats any auth failure as logged out.

### `offline_threading_id`

Computed as `(unix_ms << 22) | rand(22 bits)` packed into a 64-bit integer.
Instagram rejects sends whose id does not decode to a recent timestamp.

## Limitations

- **Realtime is best-effort.** `listen({ realtime: { enabled: true } })` subscribes
  to Instagram's MQTT push stream for near-instant delivery; if the broker is
  unreachable (or the process runs on a host that blocks it) it falls back to
  polling. Polling has a short delay before events arrive.
- Instagram rate-limits aggressively; keep a sane `pollInterval` and avoid
  tight send loops.
- Only works for **personal** accounts with a valid browser session cookie.


## Optional reliability utilities

The following standalone helpers are exported as `login.utilities` and
`require("@cexi/hoonica").utilities`:

- `AdaptiveRateLimiter` — caller-managed global/per-endpoint pacing and
  adaptive backoff after HTTP 429 responses.
- `CircuitBreaker` — optional per-operation circuit breaker with a single
  half-open probe.
- `IdempotencyCache` — short-lived in-memory deduplication for explicitly
  keyed operations.

These helpers are **not automatically attached to the Instagram HTTP client**.
They do not change request timing, login, message sending, retries, or realtime
behavior unless application code explicitly opts in. Use idempotency keys only
when the caller can guarantee that repeated operations represent the same
intended action; never reuse a key for different messages.


- `Scheduler` — optional cron and one-time task scheduler. It is created by
  the application and does not start any background task until explicitly
  scheduled. Call `removeAll()` during application shutdown when appropriate.
  Scheduled task errors are emitted through `taskError` and do not crash the
  scheduler loop.


## Edit failure diagnostics

`editMessage(text, messageID)` returns the edited message info or `false` without
rejecting. For FCA callers, the last failure is also available as
`api.lastEditError` (the underlying GraphQL error, including Instagram's
`errors` payload when present). Instagram only permits editing an outgoing
message for a limited time (currently 15 minutes); the message must also
belong to the authenticated account.


### Inbox pagination

The first `getInbox()` call returns the newest page and pagination metadata:

```js
const first = await api.getInbox();
console.log(first.threads);
if (first.nextCursor) {
  const second = await api.getInbox(first.nextCursor);
  console.log(second.threads);
}
```

`nextCursor` is an opaque Relay cursor; pass it back unchanged. `hasNextPage` indicates whether Instagram reports another page. Malformed Relay edges without a usable `id` or `thread_id` are ignored. The result remains backward-compatible with callers that only read `{ threads }`.


### FCA thread-list pagination

`getThreadList(limit, timestamp, tags, callback)` now walks inbox Relay cursors until
it has collected the requested number of matching threads or Instagram reports
that there are no more pages. The timestamp is treated as a millisecond boundary;
only threads whose latest message is older than that boundary are returned.
`[]` and `["INBOX"]` select the inbox, and `["INBOX", "unread"]` selects unread
inbox threads. The current Instagram web pagination query is documented for the
`INBOX` folder only, so `ARCHIVED`, `PENDING`, and `OTHER` are rejected rather
than silently returning inbox results for a different folder.


### Long-running session cache limits

Long-lived inbox and FCA lookup maps use bounded FIFO caches to prevent memory use
from growing without limit during extended sessions. The current internal limits
are 5,000 entries for seen-message, user-index, avatar, and message-to-thread
lookups, and 2,000 entries for thread-member and internal-thread-ID mappings.
Updating an existing key refreshes its insertion position. When a limit is
reached, the oldest entry is evicted; a later lookup may need to be learned again
from inbox/thread data or resolved through the normal API fallback. These limits
bound cache growth but do not guarantee a fixed process-memory ceiling.
