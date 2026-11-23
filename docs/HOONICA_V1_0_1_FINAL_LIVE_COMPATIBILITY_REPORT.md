# Hoonica v1.0.1 Final Live Compatibility Report

**Audit date:** 2026-11-23  
**Branch:** `release/1.0.1`  
**Commit audited:** `2297068177770d6674a86430f4060d17be99285b`  
**Package:** `@cexi/hoonica@1.0.1`

## Outcome

**Release readiness: READY WITH LIMITATIONS.** The local automated release checks passed. Live Instagram compatibility remains unverified. Termux Chromium and a UserLAnd CDP connection are available, and the external-browser helper has been tested locally; Instagram navigation and real session harvesting were not tested. No Instagram authentication or account API requests were made. This report does not treat local fixtures as live results.

## Environment and browser

- **PASS:** Ubuntu 24.04.4 LTS, ARM64 (`aarch64`); Node.js `v20.20.2`; npm `10.8.2`.
- **PASS:** Termux Chromium `158.0.8127.36` is installed and running outside the UserLAnd PRoot environment.
- **PASS:** UserLAnd can reach the Chromium DevTools endpoint at `http://127.0.0.1:9222/json/version`.
- **PASS:** `puppeteer-core` `24.31.0` is installed separately under `$HOME/hoonica-puppeteer-test/node_modules`, not as a project dependency.
- **PASS (helper test):** HoonICA connected to existing Chromium using `browserURL`; disconnecting the Puppeteer client did not close Chromium.
- **NOT RUN:** Instagram navigation or real `PolarisDirectInboxQuery` capture. No live Instagram account request was made.
- **NOT RUN:** Launching Chromium from inside UserLAnd; the tested setup uses Termux Chromium over CDP.

The local `.live-test-cookie` file was present with owner-only mode `0600`. Its contents were not read, printed, uploaded, or included in this report or package. `session-params.json` was absent. The cookie was not used to authenticate during the CDP/helper checks.

## Session bootstrap and request construction

- **PASS (source inspection):** `harvestSessionParams(cookieJar, options)` requires `puppeteer-core` and a Chromium/Chrome executable, injects cookies into an Instagram page, then captures the `PolarisDirectInboxQuery` GraphQL request body. `findChromium()` checks configured paths and common system paths.
- **PASS (source inspection):** A caller can supply harvested values using `login(cookie, { sessionParams })`, `sessionParamsFile`, or `api.setSessionParams(params)`. The constructor reads an existing params file and changes its mode to `0600`; `refreshSession(params)` can replace parameters directly. Without a supplied object, refresh attempts browser harvesting and returns `false` if that fails.
- **PASS (source inspection):** Session initialization checks authentication before fetching self info; then it bootstraps request tokens. HTTP requests use the cookie jar and web-session headers/parameters maintained by the HTTP client. GraphQL operations compose the session parameters with operation-specific request data.
- **UNVERIFIED:** Whether current Instagram accepts this implementation's authentication, GraphQL, inbox, thread-list, upload, or realtime requests. No live request was made.

No session parameters were fabricated. The supported injection path exists, but there were no legitimately harvested parameters available for this run.

## Live Instagram checks

| Check | Status | Evidence |
| --- | --- | --- |
| Cookie/session parsing | **NOT RUN** | Cookie contents were intentionally left unread; no login call was made. |
| Authentication/session validity | **UNVERIFIED** | No live session initialization. |
| Account identity via self-info | **NOT RUN** | No authenticated request. |
| Inbox retrieval | **NOT RUN** | No authenticated request. |
| Thread-list retrieval | **NOT RUN** | No authenticated request. |
| Live response/error structure | **BLOCKED** | No live responses were obtained. |
| Session expiry behavior | **NOT RUN** | No live session was established; no expiry was induced. |

No messages or other account-changing actions were attempted.

## Automated verification

All requested commands were executed on Node.js 20.20.2:

- **PASS — `npm test`:** 8 test files/check groups passed. Explicitly reported: edit 4, FCA wrapper 18, session check 6, no-browser 3, runtime regression 94, and browser session tests 9; reliability utilities and scheduler also reported all checks passed. Total: 134 explicitly numbered test cases, plus the non-numeric reliability and scheduler checks. No failures.
- **PASS — `npm run audit:repro`:** 17 audit checks passed. The script itself states these are local regressions/source-signature checks, not live Instagram validation.
- **PASS — `npm run test:types`:** strict TypeScript declaration check passed.
- **PASS — `npm run release:check`:** passed, including runtime tests, strict types, dependency security audit, and npm package dry run.
- **PASS — dependency audit:** 0 vulnerabilities reported.
- **PASS — package dry run:** `@cexi/hoonica@1.0.1`, 78 files. The package allowlist contains library source, declarations, and project docs; the local cookie, session params, tests, and generated files were not in the tarball listing.
- **NOT RUN:** Separate lint/build commands; no lint or build scripts are defined in `package.json`.

## Findings and fixes

- **No new reproducible implementation defect was established in this run.** Therefore, no production code or protocol behavior was changed and no speculative Instagram fields were added.
- **Voice-note behavior remains UNVERIFIED.** `sendVoiceBuffer()` sets `contentType: "audio/ogg"` and passes `voice: true`, but the generic media upload path does not demonstrate consuming that flag or attaching verified voice-note metadata. Existing README, DOCS, changelog, and audit notes already describe voice-note rendering as unverified. No change was warranted without protocol evidence.
- Session-parameter injection was confirmed as an existing supported path; no code change was necessary to expose it.

## Security observations

- **PASS:** The local cookie file was not read by the audit, echoed, uploaded, or staged.
- **PASS:** No credential/session file appears in the npm dry-run contents.
- **PASS:** Persisted session parameter file handling enforces owner-only permissions before reading.
- **PASS:** No live authentication, mutation, push, merge, deployment, or publication occurred.

## Git and release scope

- The audited branch was `release/1.0.1` at `2297068177770d6674a86430f4060d17be99285b`, matching `origin/release/1.0.1` at inspection.
- Local `release/1.0.0` remained at `20e59971dc31aee6696781f1bec3b484c1ae9d60`; it was not modified during this audit.
- Remote `origin/release/1.0.0` points to `90ad59c3e4ee1742420536a51b9b65750904fb47`, also referenced by `release/1.0.0-fresh`.
- The local and remote `release/1.0.0` branches have unrelated histories: `git merge-base` found no common ancestor. The local branch has 3 commits absent from the remote branch, while the remote branch has 1 commit absent from the local branch.
- Do not merge, rebase, reset, or force-push either 1.0.0 branch as part of this release preparation. Their relationship requires a separate, deliberate history decision.
- No Git tags were listed. No commits, pushes, merges, deployments, or publishes were performed during this audit.
- The working tree contains local uncommitted source changes and untracked report/test files. These are not part of the audited baseline commit until explicitly committed.

## Remaining action for live verification

Only if explicitly authorized, perform read-only compatibility checks using the user's own local browser/session environment. Keep credentials local and owner-only. Start with session validation and self-info, then inbox and thread-list retrieval; do not send or mutate anything. If Instagram presents a checkpoint, challenge, or rate limit, stop and record the result without bypassing it.
