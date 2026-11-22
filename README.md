<div align="center">

# 💬 @cexi/hoonica

**Unofficial Instagram DM Chat API for Node.js**

Send messages, media, voice notes & reactions · edit, unsend, listen · build Instagram bots on personal accounts · zero browser at runtime

[![npm](https://img.shields.io/npm/v/@cexi/hoonica?color=blue)](https://www.npmjs.com/package/@cexi/hoonica)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

</div>

---

## ⚡ What is this?

`@cexi/hoonica` is maintained and modified by Hoon. It is derived from the original `insta-chat` project; original copyright and NOTICE attribution are retained.

`@cexi/hoonica` is a standalone Instagram **Direct Message** API — the
Instagram sibling of an FCA package. It talks to the same web endpoints
`www.instagram.com` uses (Relay GraphQL + `rupload`), so you can build a bot on
your own personal account:

- ✅ **Send** text, photos, videos, voice notes
- ✅ **React**, edit and unsend messages
- ✅ **Listen** for incoming DMs — realtime MQTT push or polling — and dispatch them to your own commands
- ✅ **Typing** indicators, mark-seen, mute/unmute, hide
- ✅ **Users** — lookup by id / username, search
- ✅ **Pure HTTP at runtime** — no Puppeteer, no browser, no native build

> ⚠️ Unofficial. Not affiliated with Instagram or Meta. Use only on accounts you
> own and at your own risk. This package automates a personal account, not the
> official Instagram Business API.

---

## 📦 Installation

```bash
npm install @cexi/hoonica
```

Requires **Node.js >= 20**.

---

## 🚀 Quick start

```javascript
const login = require("@cexi/hoonica");

// `cookie` is your browser cookie string (needs at least `sessionid`).
// Store pre-harvested browser params in ./session-params.json first.
login(cookie, { sessionParamsFile: "./session-params.json" }, (err, api) => {
  if (err) return console.error("Login error:", err.message);
  console.log("Logged in as", api.username || api.userID);

  // send a DM
  api.sendMessage("Hello from my bot 👋", "340282366841710300949128138275732109616");
});
```

Promise style works too:

```javascript
const api = await login(cookie, { sessionParamsFile: "./session-params.json" });
await api.sendMessage("hi", threadID);
```

### Getting the cookie

Log in to <https://www.instagram.com> in a browser, open DevTools → Network →
copy the `Cookie` request header (it contains `sessionid`, `ds_user_id`,
`csrftoken`, `ig_did`). Paste the whole string; only `sessionid` is mandatory.

---

## 🧠 Session params (important)

Instagram's web API rejects requests that do not carry the browser **session
params** (`__dyn`, `__csr`, `__hs`, `__hsi`, `__s`, `fb_dtsg`, `jazoest`, ...).
They are produced by Instagram's own JS bundle but are session-scoped, so one
real browser page load is enough — capture once, reuse until it expires.

```javascript
const { harvestSessionParams, findChromium } = require("@cexi/hoonica");

const params = await harvestSessionParams({ /* cookie jar */ });
// -> { __dyn, __csr, __hs, fb_dtsg, lsd, ... }
```

`harvestSessionParams` drives a system Chrome/Chromium through `puppeteer-core`.
Puppeteer is **not installed automatically**: it is an optional browser-only
integration, not a runtime dependency. If you need browser harvesting, install
a Puppeteer version compatible with your Node.js version separately and audit
that dependency in your application. Otherwise, supply pre-harvested
`sessionParams` and no Puppeteer package is needed. No browser is downloaded
by this library. Pass the result to `login`:

```javascript
const api = await login(cookie, { sessionParams: params });
```

If full browser params are not supplied, the package can only bootstrap the
minimum tokens (`fb_dtsg`, `lsd`). It now stops with
`IG_SESSION_PARAMS_MISSING` instead of incorrectly reporting the cookie as
invalid. A usable Direct session still needs harvested or pre-saved
`sessionParams`. When params go stale use `api.refreshSession()`.

---

## 📚 API

### Login

| Call | Description |
|------|-------------|
| `login(cookie, [options], [cb])` | Returns/clbacks a ready `InstaClient` (FCA surface). |
| `login(cookie, { native: true })` | Returns the bare `InstaAPI` instead. |
| `createClient(cookie, [options])` | Alias of `login`. |

`options`: `{ native, sessionParams, sessionParamsFile, deviceFile, pollInterval, minPollIntervalMs, realtime }`.

To make `listen()` push instead of poll, opt into realtime MQTT:

```javascript
const api = await login(cookie, { realtime: { enabled: true } });
```

`realtime` is `{ enabled, fallback, host, keepAliveMs }`. With `fallback !== false`
(the default) a broker that will not connect degrades to the inbox poller, so the
bot still gets events. `keepAliveMs` is the PINGREQ interval; it must stay below
the CONNECT keep-alive (60 s) and defaults to 25 s. See [Listening](#listening).

### Two layers

| Layer | What it is | How to get it |
|-------|-----------|---------------|
| `InstaClient` | FCA / GoatBot-Pro shaped surface (`sendMessage`, `setMessageReaction`, `getThreadInfo`, …) | `login(...)` |
| `InstaAPI` | Native Instagram client (`sendReaction`, `sendPhotoBuffer`, `getInbox`, …) | `login(..., { native: true })` or `client.api` |

The FCA methods are one file each under `src/api/<group>/<method>.js`; adding a
method is adding a file. `createFcaClient(client)` gives a namespaced view
(`messages.send()`, `threads.getInfo()`); `new InstaContext(client, threadID)`
binds a thread. `EventNormalizer` maps raw inbox events to the FCA event shape.

### Messaging (FCA surface)

| Method | Description |
|--------|-------------|
| `sendMessage(form, threadID, [cb], [replyToMessage])` | Send text/attachment; quote-reply by passing the target message id. |
| `editMessage(text, messageID)` | Edit an outgoing message (within 15 min). |
| `unsendMessage(messageID)` | Unsend a message. |
| `setMessageReaction(emoji, messageID, [cb], [threadID])` | React to a message. |
| `sendTypingIndicator(threadID)` | Typing indicator. |
| `getThreadInfo` / `getThreadList` / `getThreadHistory` | Thread reads. |
| `getUserInfo` / `getUID` | User lookup. |
| `getUserInfoV2(idOrIds)` | Full profile (all details) for one id or an array of ids. |
| `getUserProfile(idOrHandle)` | The complete merged profile object. |
| `getProfilePictureV2(idOrHandle, opts)` | Profile picture at any size (square + HD). |
| `getProfileBio(idOrHandle)` / `getUserID(idOrHandle)` / `getUserFriendship(id)` | Bio, id, friendship state. |
| `getSelfInfo()` | The logged-in account's own profile. |
| `getAppState` / `getCookies` | Cookie jar. |

### Messaging (native `InstaAPI`)

| Method | Description |
|--------|-------------|
| `sendMessage(text, threadID, replyToItemId?)` | Send a text DM (optionally quote-reply). |
| `replyToMessage(threadID, text, replyToItemId?)` | Send a reply (quote the target item). |
| `sendLink(threadID, link, text)` | Send a link with optional text. |
| `sendReaction(threadID, itemID, emoji)` | React to a message. |
| `removeReaction(threadID, itemID)` | Remove a reaction. |
| `unsendMessage(threadID, itemID)` | Unsend a message. |
| `editMessage(threadID, itemID, text)` | Edit an outgoing message (within 15 min). |
| `startTyping(threadID)` / `stopTyping(threadID)` | Typing indicator. |

### Media

| Method | Description |
|--------|-------------|
| `sendPhoto(threadID, filePath, [opts])` | Photo from disk. |
| `sendPhotoBuffer(threadID, buffer, [opts])` | Photo from a Buffer. |
| `sendPhotoFromUrl(threadID, url, [opts])` | Photo from a URL. |
| `sendVideo` / `sendVideoBuffer` / `sendVideoFromUrl` | Video variants. |
| `sendVoice` / `sendVoiceBuffer` / `sendVoiceFromUrl` | Voice-note variants. |

`opts`: `{ filename, text }`.

### Threads & users

| Method | Description |
|--------|-------------|
| `getThreadInfo(threadID)` | Thread metadata. |
| `getThreadHistory(threadID, limit)` | Recent messages. |
| `markThreadSeen(threadID, itemID)` | Mark as read. |
| `muteThread` / `unmuteThread` / `hideThread` | Thread state. |
| `getUserInfo(userID)` / `getUserInfoByUsername(username)` | User lookup. |
| `searchUsers(query, limit)` | Search users. |
| `getUserProfile(idOrUsername, [opts])` | Complete profile merged from every source (see below). |
| `getProfilePicture(idOrUsername, [opts])` | Best picture URL; `opts.size` resizes via the CDN. |

### Full profiles (`getUserInfoV2` / `getUserProfile`)

V1 `getUserInfo` returns a small fca-shaped subset. V2 returns **every detail a
web session can read**, and it is *logout-safe*: profile lookups go through a
resolver that tries several sources and never turns a rate-limit (429) or a
login redirect (302) into a dead-session error - the bug that used to log the
bot out whenever a command looked up a profile.

Sources, merged in order (a field a source cannot supply stays `null`):

1. **Inbox/thread record** - the users the client has already seen in the DM
   views. Free, needs no request, and the only source that still answers once
   the profile REST paths 429. `getInbox()` populates it automatically.
2. **`web_profile_info` REST** - canonical counts (followers/following/media),
   biography, verified/private/business flags, external url, category.
3. **Profile GraphQL** (`PolarisProfilePageContentQuery`) - richest payload when
   Instagram answers it.
4. **The account's own page** - the home shell Instagram server-renders embeds
   the logged-in account's full profile, so self always resolves.

```javascript
const info = await api.getUserInfoV2("32715034217");
// info["32715034217"] => { id, username, name, biography, followerCount,
//   followingCount, mediaCount, isVerified, isPrivate, isBusinessAccount,
//   externalUrl, category, profilePicUrl, profilePicUrlHd, fbid, ... }

const profile = await api.getUserProfile("@someuser");   // the raw merged object
const pic     = await api.getProfilePictureV2("someuser", { size: 640 });
// pic => { url, hd, thumb, sizes: { "150": ..., "320": ..., "640": ..., "1080": ... } }
```

### Listening

```javascript
const stop = api.listen((err, event) => {
  if (err) return console.error(err.message);
  console.log(event.senderID, "->", event.body);
  // event = { type, threadID, senderID, messageID, body, attachments, timestamp }
});

// later
stop();
```

`listen` uses the realtime MQTT stream when you pass
`{ realtime: { enabled: true } }` to `login` — Instagram pushes each new DM over
the broker, so replies are near-instant. Without it, `listen` polls the inbox
(default every 15s, override with `options.pollInterval`). Either way the callback
and event shape are identical, and a realtime connection that fails falls back to
polling unless you set `realtime: { enabled: true, fallback: false }`.

### Realtime (MQTT)

Instagram's realtime broker (`edge-mqtt.facebook.com`) is an MQTToT connection
authenticated by the same `sessionid` cookie — no app login. `listen()` drives it
when realtime is enabled; you can also use it directly:

```javascript
const api = await login(cookie, { native: true });

api.realtimeOn("message", (e) => console.log(e.message));
api.realtimeOn("typing", (e) => console.log(e.threadID, "is typing"));
api.realtimeOn("seen", (e) => console.log(e.threadID, "read"));
api.realtimeOn("presence", (e) => console.log(e.value));

await api.realtimeConnect();
await api.realtimeSubscribe();   // reads seq_id/snapshot_at_ms from the inbox query
// ...later
api.realtimeDisconnect();
```

`realtimeConnect()` reuses the client only while it is connected; after a drop it
builds a fresh one, so **attach your handlers to the client it returns** and
re-attach whenever it differs from the last one you saw:

```javascript
let client = await api.realtimeConnect();
if (client !== previous) {
  client.on("direct", onRealtimeDirect);
  client.on("disconnected", () => reconnectLater());
  previous = client;
}
```

`RealtimeClient` (the raw client) and `RealtimeListener` (the `listen()` wrapper)
are exported too, for callers that want to drive the socket themselves.

---

## 🧩 Example — a tiny DM bot

```javascript
const login = require("@cexi/hoonica");

(async () => {
  const api = await login(process.env.IG_COOKIE);

  api.listen(async (err, event) => {
    if (err || !event || !event.body) return;
    if (event.body === "/ping") await api.sendMessage("pong 🏓", event.threadID);
    await api.sendReaction(event.threadID, event.messageID, "✅");
  });
})();
```

---

## 🗂️ Project structure

| Path | Description |
|------|-------------|
| `index.js` | Entry point; exports `login` + helpers. |
| `index.d.ts` | TypeScript definitions. |
| `module/login.js` | Classic `login(credentials, [options], [callback])`. |
| `src/api.js` | `InstaAPI` facade wiring every native method group. |
| `src/api/` | FCA methods, one file each: `messaging/`, `threads/`, `users/`, `action/`, `realtime/`. |
| `src/app/InstaClient.js` | The FCA-shaped client. |
| `src/app/InstaContext.js` | Per-thread view over a client. |
| `src/app/createFcaClient.js` | Namespaced view (`messages.*`, `threads.*`). |
| `src/app/loadApiMethods.js` | Attaches every `src/api/*/*.js` onto a client. |
| `src/events/normalizeEvent.js` | Raw inbox event → FCA event. |
| `src/utils/messageStyle.js` | `*bold*` / `_italic_` → Unicode. |
| `src/http.js` | HTTP client: web headers, session params, GraphQL, rupload. |
| `src/constants.js` | Endpoint + Relay `doc_id` table. |
| `src/cookies.js` | Cookie parsing / normalization. |
| `src/deviceIdentity.js` | Persisted device identity. |
| `src/session.js` | Browser session-param harvesting (`puppeteer-core`). |
| `src/utils/antiSuspension.js` | Request pacing / anti-suspension helpers. |
| `src/utils/sessionGuard.js` | Session-state guard. |
| `src/realtime/mqttot.js` | Dependency-free MQTToT codec (Thrift compact + MQTT packets + TLS transport). |
| `src/realtime/client.js` | Realtime MQTT client: connect, dispatch, direct events. |
| `src/realtime/bridge.js` | Message-sync patch → raw inbox event. |
| `src/realtime/listener.js` | Wires realtime into `listen()` with poller fallback. |

See [DOCS.md](./DOCS.md) for the full protocol notes (GraphQL doc_ids, send /
upload / reaction flows).

---

## 🧪 Local release verification

GitHub Actions may be unavailable for some accounts. On a machine with Node.js
**>=20** and dependencies installed, run the complete local release checks:

```bash
npm install
npm run release:check
```

This runs the runtime regression tests, TypeScript declaration check, dependency
audit (when a lockfile is present), and npm package dry-run. It does **not**
verify a live Instagram login or publish the package.

## 📋 Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## 📄 License

[Apache-2.0](./LICENSE) © hoon; Developed and maintained by Hoon

> **Credit required:** you may use and modify this library, but you must keep the original copyright headers, the `NOTICE` file and the author credit (hoon), and clearly state your changes. Removing or replacing the credit violates the license.
