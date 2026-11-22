# Safe feature port plan: won-ica -> hoon-ica

## Baseline and rule

- Target: `bdrakib123/hoon-ica`.
- Source reviewed: `bdrakib123/won-ica`.
- Keep the existing `InstaAPI`, FCA-shaped `InstaClient`, event normalization,
  authenticated web-session HTTP layer, and MQTT/polling listener as the source
  of truth.
- No source from `won-ica` is copied wholesale. Each port must be additive,
  independently testable, and must not alter default request or message behavior.

## Feature inventory

| won-ica feature | hoon-ica status | Decision |
| --- | --- | --- |
| MQTT real-time listening | Already implemented, with polling fallback and shared client | Do not replace |
| Outbound pacing / read retry | Already implemented through anti-suspension pacing and read retry | Keep existing implementation |
| Adaptive endpoint rate limiter | Not part of default HTTP pipeline | Ported as an exported, opt-in helper only |
| Circuit breaker | Not present as a general-purpose helper | Ported as an exported, opt-in helper only |
| Idempotency cache | Not present as a general-purpose helper | Ported as an exported, opt-in helper only |
| Scheduler | Not present in core | Ported as an exported, opt-in helper using `node-cron`; no jobs start automatically |
| User search | Existing native `searchUsers` and profile lookup | Do not duplicate |
| Thread info/history/inbox | Existing native thread and inbox methods | Do not duplicate |
| Reactions / remove reaction | Existing native GraphQL reaction methods | Do not duplicate |
| Typing indicators | Existing native typing methods | Do not duplicate |
| Photo / video / voice send | Existing native web-session media upload and send methods | Do not duplicate |
| Group add/remove user | Existing native `addUsers` / `removeUser` methods | Do not duplicate |
| Mute / unmute / hide thread | Existing native GraphQL thread methods | Do not duplicate |
| Hashtag / place / audio / reel search | won-ica uses `/api/v1` endpoints | Deferred: hoon-ica documents that these REST routes redirect web sessions to login; require a web-session-compatible endpoint and fixtures first |
| Stories read APIs | won-ica uses mobile `/api/v1` feed endpoints | Deferred: the web-session client cannot safely call these mobile endpoints |
| Mark unread / bulk read | won-ica uses mobile Direct REST seen endpoints | Deferred: no verified web-session mutation path |
| Thread delete / approve / decline / title / nickname / leave | won-ica uses mobile Direct REST actions | Deferred: no verified web-session mutation path |
| Followers / following lists | won-ica uses mobile friendship REST endpoints | Deferred: no verified web-session read path |
| GIF send | won-ica uses mobile animated-media broadcast upload | Deferred: requires a verified web-session upload path |
| Story seen / reaction / reply / share | Mutating account actions | Deferred: mobile endpoints and account-side effects require a verified web-compatible path |
| Live feed / comments / hearts | Live-specific mobile endpoints and mutations | Deferred: mobile endpoints and account-side effects require a verified web-compatible path |
| SQLite database | Adds Sequelize + sqlite3 and schema lifecycle | Not ported into the core; would add native dependencies and persistent state/migration risk |
| Password / 2FA login | Different authentication and device flow | Not ported; preserve browser-cookie login and session guard |

## Implemented in this branch

The following helpers are available under `login.utilities` and the package
exports. They are deliberately not wired into `HttpClient` or message methods:

- `AdaptiveRateLimiter`: caller-managed delay recommendation, request marking,
  and bounded 429 backoff.
- `CircuitBreaker`: per-key failure tracking and a single half-open probe.
- `IdempotencyCache`: explicit-key in-memory deduplication; failed operations
  are not cached.
- `Scheduler`: optional cron/one-shot application task scheduler. No job starts
  unless the caller explicitly schedules it.

The only default runtime change is exposing these constructors. Existing send
pacing, read retry, login, message sending, and realtime behavior are unchanged.

## Promotion gate for deferred features

Story and Live methods were inspected endpoint-by-endpoint. Their read and write
routes all use the mobile `/api/v1` or `/api/v2` surface, including story reply,
share, reaction, seen, live comment, heart, and mute actions. They are therefore
not copied into the web-session client. A failed or redirected request here
could mark stories as seen, send unintended replies/comments, or trigger auth
safety handling.

Before any deferred feature is enabled or merged:

1. Verify the endpoint with the same authenticated web session used by
   `hoon-ica`; do not infer compatibility from won-ica's mobile HTTP client.
2. Add deterministic fixtures for success, empty response, auth failure, and
   rate limiting.
3. Keep mutating operations separate from read-only methods and never retry a
   message/story mutation unless the operation is proven idempotent.
4. Run the full existing test suite plus the focused new tests.
5. Confirm the default FCA method signatures and native API are unchanged.
