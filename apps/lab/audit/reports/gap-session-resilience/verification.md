# Adversarial verification: gap-session-resilience (RESIL-01 to RESIL-23)

Verifier scratch: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-session-resilience/verify/` (called `VERIFY` below). Repository paths are relative to the worktree root. No file in the repository was changed. No request went to `visonaut.com` or to GitHub.

## Summary

- 23 findings checked. 11 confirmed, 11 partly confirmed, 1 judgment, 0 refuted, 0 unverifiable.
- All quoted code exists at the cited lines. The static checks (M9) and the matrix arithmetic (103 realistic cells: 35, 29, 33, 5) are correct.
- The main error source is the mock API of the auditor (`lib.mjs`). It differs from the real server in two places that change finding text:
  1. A replaced run answers the save with `409` "State changed. Refresh the comparison before trying again." at admission. The report uses "Only the active complete comparison can be reviewed." (RESIL-05).
  2. The queued receipt `409` has no `reviewer` field. "Updated by 5550002." cannot show in the path that the client uses (RESIL-06).
- The second error source is dev mode. In the production bundle the router's default error screen hides the error text and shows "Show Error" (RESIL-13).
- My severity is lower than the auditor's for 12 findings. The four "high" findings are "medium" in my reading: each needs an uncommon trigger or has a one-step workaround (browser reload).

## Method and new measurements

| ID  | Command                                                                                                                                                                                        | Result file                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| P1  | `pnpm exec vitest run --config VERIFY/vitest.probe.config.mjs server-answers` (real `handleReview`, `enqueueReview`, `processReviewQueue` on the in-memory SQLite harness with all migrations) | `VERIFY/server-answers.result.json`                                                         |
| P2  | `node --no-warnings VERIFY/rerun.mjs` (Chrome through Playwright on `route-fixture.html`, mock answers corrected with P1)                                                                      | `VERIFY/rerun.json`, `VERIFY/screens/*.png`                                                 |
| P3  | `node --no-warnings VERIFY/rerun2.mjs` (offline, then "Refresh current state")                                                                                                                 | `VERIFY/rerun2.json`                                                                        |
| P4  | `node --no-warnings VERIFY/s01-deploy-skew.mjs` (copy of the auditor's script, dev app on port 4310)                                                                                           | `VERIFY/s01-deploy-skew.json`                                                               |
| P5  | `node --experimental-transform-types --no-warnings VERIFY/auth-probe.mjs` (copy of the auditor's probe plus an `errorCallbackURL` case)                                                        | `VERIFY/auth-probe.default.json`                                                            |
| P6  | `node VERIFY/matrix-count.mjs` (recount of the matrix table in `report.md`)                                                                                                                    | console: `{"realistic":103,"notRealistic":24,"fullyOk":35,"wrong":29,"dead":33,"silent":5}` |

P1 raw results that matter (real server code):

```text
stale target, queued path (client always sends queued: true):
  POST commands -> 202 {queued, commandId}
  GET  /api/commands/:id/queued -> 409, body keys ["error","model"]            (no reviewer)
  error: { code: "conflict", message: "A target changed or belongs to another comparison." }
stale target, path without `queued` (client never uses it):
  POST commands -> 409, body keys ["error","model","reviewer"], reviewer: "1002"
run closed before the save (service.retireRun, the same call as a newer push, api/webhooks.ts:318):
  POST commands -> 409 { code: "conflict", message: "State changed. Refresh the comparison before trying again." } + model
  model.run.status "superseded", model.archived true
run closed after admission, before processing:
  receipt -> 409 { code: "conflict", message: "Only the active complete comparison can be reviewed." } + model
review session of an older sign-in:
  POST commands -> SecurityError review_session_expired 409 "Start a new review session after signing in."
  POST /api/review-sessions -> 201; the same commandId with the new session -> 202; receipt -> 200 (applied)
same variant decided again while the first command is queued (other review session):
  first receipt 200; second receipt 409 "A target changed or belongs to another comparison."
unknown run id -> IncompleteError "The requested record does not exist." (409 incomplete in api/index.ts:55-66)
?comparison=not-a-uuid -> SecurityError invalid_id 400 "The resource identity is invalid."
```

Platform facts that I checked in official documentation:

- Cloudflare, `process.env`: "`process.env.NODE_ENV` is statically replaced at build time and is not a runtime value". <https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/>
- Cloudflare, static assets and versions: a request for a hashed file of another version "does not have that file - resulting in a 404 error". The documented answer is version affinity during a gradual rollout, not asset retention. <https://developers.cloudflare.com/workers/static-assets/routing/advanced/gradual-rollouts/>
- Cloudflare, version metadata binding (`id`, `tag`, `timestamp`). <https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/>
- Vite, `vite:preloadError` fires "when it fails to load dynamic imports". <https://vite.dev/guide/build>
- Chrome timer throttling: hidden pages check timers "once per second"; after 5 minutes hidden and a chain count of 5 or more, "once per minute". <https://developer.chrome.com/blog/timer-throttling-in-chrome-88>
- MDN, `Cross-Origin-Opener-Policy: same-origin`: a cross-origin popup opens in a new browsing context group and the opener relation is cut. <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy>

Installed versions used for API checks: `better-auth` 1.7.5, `@tanstack/react-router` 1.170.38, `@tanstack/router-core` 1.171.32, `@tanstack/start-plugin-core` 1.171.47, `@tanstack/router-plugin` 1.168.40.

## RESIL-01

- Verdict: confirmed.
- Severity: medium (auditor: high).
- Proof:
  - `apps/web/src/review/client.ts:293-303`: `sessionPromise ??= request("/api/review-sessions", {})`. Only the `.catch` clears it. `:349-351`: `refresh()` reads the model only.
  - `apps/web/src/routes/runs.$runId.tsx:161`: `const commands = useMemo(() => createReviewCommands(runId, comparisonId), [runId, comparisonId]);`. The object lives as long as the page. `review-workspace.tsx:259`: `onRefresh: () => setRetry((value) => value + 1)` does not create a new one.
  - `apps/web/src/api/review.ts:619-635` and `packages/security/src/authorization.ts` (`sessionId: session.session.id`): a new sign-in gives a new auth session ID.
  - P1: the real handler throws `review_session_expired` 409. P2 case A: 1 `POST /api/review-sessions`, `reviewSessionIds: ["session-1","session-1","session-1","session-1"]`, the same alert after 3 cycles of "Refresh current state" and Approve.
  - I found no guard, cache, test, or contract sentence that makes this behavior deliberate.
- Why medium: the tab must already hold a review session (one saved decision), and the auth session must change outside this tab (sign-out and sign-in in another tab, a revoked session, a restore). A sign-in in the same tab always loads a new document. A browser reload repairs the tab. No stored data is lost.
- Corrections to the options:
  - The retry with a new review session works for `save()`. P1 shows that the same `commandId` is admitted and applied with the new session.
  - It cannot work for `undo()`. `packages/service/src/review-commands.ts:340-347` refuses a command of another session: "Only your saved command in this review session can be undone." The client must clear its Undo stack when it renews the session. The report snippet says "in save() and undo()".
  - A queued command with `previousCommandId` must use the session of its predecessor (`apps/web/src/operations/review-queue.ts:41-47`). Renew the session only when the client queue has no admitted predecessor.

## RESIL-02

- Verdict: partly confirmed.
- Severity: medium (auditor: high).
- Proof:
  - P2 case G: first alert `Not saved. Sign in with GitHub.` with "Retry same command" and "Refresh current state". After "Refresh current state" with a 401: only "Refresh current state"; Undo, "All 7 changed views…", Reject, and Approve are disabled; `signInControls: []`; focus `body`.
  - `use-review-session.ts:484-488` clears `session.queue` before the read. `:502` calls `reportError(error)` with no command.
  - `use-review-session.ts:380-388`: a non-409 error on an admitted command shows "Could not confirm the queued decisions…". A 401 goes this way.
- Correction: "no way to sign in" is too strong. The page has no sign-in control in the workspace, but a browser reload shows "Sign in to review this run" (`runs.$runId.tsx:42-44`, `:217-246`), and that sign-in returns to the same item and variant (`:169-178`). The header also keeps the "Review queue" link (`components/app-shell.tsx:15-19`). The held decision is lost in both paths. The loss is one decision, or the unsent part of a rapid sequence.
- Corrections to the options:
  - "A popup that posts back" cannot use `window.opener`. Each response has `Cross-Origin-Opener-Policy: same-origin` (`packages/security/src/http.ts:37`), and the popup goes to `github.com`. Use a `BroadcastChannel` or a `storage` event.
  - After the new sign-in, RESIL-01 applies. The two fixes must ship together.

## RESIL-03

- Verdict: partly confirmed.
- Severity: medium (auditor: high).
- Proof:
  - `review-workspace.tsx:1113`: `" You can close this window."`. `use-review-session.ts:123-132`: command IDs live in React state and a ref. `api/review.ts:799-836`: the only receipt read needs the command ID and the same actor (P1: another actor gets 404).
  - `docs/current-contract.md:196`: "Admitted commands survive its closure, and failed commands remain visible through their receipts."
  - P1: a second decision for the same variant, sent after a reload while the first one is queued, ends with receipt 409 "A target changed or belongs to another comparison.", also when both verdicts are equal. The report marked this as derived. It is now measured.
- Corrections:
  - "This conflicts with the contract" (index one-liner) is a reading, not a fact. The server keeps each receipt until the run is archived (`apps/web/src/operations/closed-summary.ts:312`, `packages/service/src/history.ts:168`), so the data rule holds. The gap is that no screen can find a receipt after a reload. The report body states this choice correctly as a maintainer question.
  - The reload and close scenarios ran with a queue that never completes. On the real server, processing starts in the admission request (`api/review.ts:641-667`, `:876`: `wakeReviewStatus(context, input.commandId)` calls `processReviewQueue` in `waitUntil`). The real exposure is a close or reload in the short time before the receipt, or a consumer fault. I did not measure this time on production.
- Feasibility of the recommended list endpoint: possible from `work_tasks` (`kind='review'`, `payload.actorId`, `payload.comparisonId`). There is no index for that filter; the present reads use the primary key (`operations/review-queue.test.ts:136-140`). A list read scans the review tasks unless an index on the JSON fields is added.

## RESIL-04

- Verdict: partly confirmed.
- Severity: low (auditor: medium).
- Proof:
  - `client.ts:326-336`: the `while` loop with a fixed 500 ms wait. No counter and no visibility check.
  - P2 case D: 19 receipt polls in 10 s for one queued command. The bar stays `1 queued on server. You can close this window.`
- Corrections:
  - "Also when it is hidden" was measured only with a simulated `visibilityState` (10 polls in 5 s). A real hidden tab is throttled by the browser. Chrome checks such timers one time each second, and one time each minute after 5 minutes (URL above). The report lists this limit in "not verified" but the finding text states the full rate.
  - "Never completes" needs a stopped operations consumer. The review queue is also drained by the scheduled operations (`apps/web/src/operations/index.ts:48`, cron each 5 minutes in `wrangler.jsonc`).
  - The load argument is weak for a service with a few maintainers. The user-visible part (no elapsed time, no "stuck" state, Undo disabled) is correct.

## RESIL-05

- Verdict: partly confirmed.
- Severity: medium (auditor: high).
- Proof:
  - A push retires the older run: `apps/web/src/api/webhooks.ts:310-323` calls `service.retireRun`, which sets `active = 0, state = 'superseded'` (`packages/service/src/run-retirement.ts:35-39`).
  - P2 case B: 0 requests in 3 s after the run is replaced. After Approve the screen has the header text "A newer attempt is active", the line "This run is archived. Decisions show the state at archive time and are read-only.", the block "Comparison superseded / A newer attempt replaced this comparison. Its evidence cannot be reviewed.", and the bar. "Refresh current state" then shows "Current state loaded. Check the evidence before saving a new command." Screens: `VERIFY/screens/B-superseded-real-admission-text.png`, `B-superseded-after-refresh.png`.
  - `apps/web/src/review/model.ts:68-95`: no successor field.
- Corrections:
  - The bar text of the first failed save is wrong in the report. The real answer comes from the admission check, not from the queue:

    ```ts
    // apps/web/src/operations/review-queue.ts:49-57 -> packages/service/src/database.ts:65
    throw new ConflictError("State changed. Refresh the comparison before trying again.");
    ```

    P1 and P2: `Conflict. State changed. Refresh the comparison before trying again.` "Only the active complete comparison can be reviewed." shows only when the run closes between admission and processing. The real text is worse for the user: it asks for a refresh, and the refresh then says "Check the evidence before saving a new command." on a run that accepts no command.

  - "Wasted review time on each push" is too strong. Each decision is a save, so the reviewer learns at the next decision. The cost is the confusing texts and the missing link.
  - Recommendation (1): a successor lookup by `lineage_key` has no index. `apps/web/migrations/0014_visonaut_brand.sql:60-71` has only `visonaut_runs(project_id, external_run_id, active)` and `visonaut_main_promotion_scan`. Add an index, or accept a table scan on each model and state read.
  - Recommendation (2): the cost of `/api/runs/:id/state` each 30 to 60 s was not measured in this lane.

## RESIL-06

- Verdict: partly confirmed.
- Severity: medium (auditor: medium).
- Proof of the correct part: no read happens between load and save on a ready run (`runs.$runId.tsx:34-36`). The 409 carries the model and the page applies it at once (`use-review-session.ts:265-268`), so "Refresh current state" changes nothing visible. Approve and Reject are not disabled in the conflict state (`review-workspace.tsx:1064-1087` checks only `status === "error"`).
- Correction (the title is wrong for the real path): "Updated by 5550002." is an artifact of the mock. `lib.mjs:218-226` adds `reviewer` to the queued receipt. The real receipt does not:

  ```ts
  // apps/web/src/api/review.ts:817-830
  return Response.json({ error: { code: "conflict", message: … }, model }, { status: 409 });
  ```

  P1: body keys `["error","model"]`. Only the path without `queued` returns `reviewer` (`conflictResponse`, `:682-697`), and `client.ts:313-318` always sends `queued: true` (since commit `8ebf821`, PR #190). P2 case C: the bar is `Conflict. A target changed or belongs to another comparison.` with no name and no ID. Screen: `VERIFY/screens/C-other-reviewer-real-receipt.png`.

- Consequences of the correction:
  - The conflict names nobody. `docs/review-guide.md:55` says "The message identifies the conflicting reviewer when one is available." In the queued path it is never available.
  - The numeric ID problem is real in another place: Details prints `React · Chromium · Light · 1280 × 720 · Rejected · 5550002` (`review-workspace.tsx:465`, `api/review.ts:500`). Screen: `VERIFY/screens/C-other-reviewer-details.png`.
  - Matrix cell "409 conflict with model / Receipt poll" shows the mock text.
- Option check: "send the login" needs a lookup. Decisions store `actor_id` (GitHub numeric ID). A login is not stored with the decision; `packages/security/src/github.ts:193-204` keeps logins only as an in-memory routing hint.

## RESIL-07

- Verdict: confirmed.
- Severity: medium (auditor: medium).
- Proof: `runs.$runId.tsx:34-36` (`gcTime: 0, staleTime: Infinity`). `routes/index.tsx:176-210` reads `/api/runs` only on mount and on `reload`; `:242-245` blanks the page on refresh. `components/operations-attention/index.tsx:278-281` polls each 60 s with no visibility check. Static check repeated: only two `visibilitychange` listeners exist (`pulls.$pullNumber.tsx:113`, `use-review-session.ts:251`).
- Correction to alternative (b): `refetchOnWindowFocus` is a TanStack Query option. It does not exist in the installed TanStack Router (`grep` in `router-core` 1.171.32 and `react-router` 1.170.38 finds nothing), and TanStack Query is not a dependency of `apps/web`. With router loaders the equivalent is `router.invalidate()` from a `visibilitychange` handler.

## RESIL-08

- Verdict: confirmed. The matrix counts are the auditor's judgment.
- Severity: medium (auditor: medium).
- Proof: `client.ts:269-281` reads `error.message`, `error.reference`, and the status. `routes/index.tsx:185-196` and `pulls.$pullNumber.tsx:59-73` branch on the status. No client file reads `error.code` (`grep '\.code\b'` in `apps/web/src/review`, `routes`, `components` finds only operation event codes). P6: the table arithmetic is correct (103, 35, 29, 33, 5; 139 raw cells in `s08-matrix.json`).
- Corrections:
  - The `dead` mark counts the controls in the card. Each screen except the router error screen and the browser offline page keeps the header links "Review queue", "Run history", and "Service status" (`components/app-shell.tsx:15-19`). The number 33 is therefore an upper bound.
  - Some "realistic" cells are doubtful: `409 incomplete` on `/api/runs` needs a missing project row, and `403 invalid_identity` needs a user with not exactly one GitHub account (the report lists this as open question 9).
  - The contract quote for alternative (b) is correct (`docs/current-contract.md:83`).

## RESIL-09

- Verdict: partly confirmed.
- Severity: low (auditor: medium).
- Proof: dashboard: "Retry" and "Use another account" (`routes/index.tsx:340-352`). Pull page: only "Use another account" (`pulls.$pullNumber.tsx:216-233`). Run page: only "Retry", and `RunShell` renders `<AppHeader />` with no `end` (`runs.$runId.tsx:55-63`, `:76-111`). Wrong origin: `server.ts:82-84` answers sign-out with an empty 403. Screens `03-*.png` match.
- Corrections:
  - "Two are dead ends" is too strong. The run error screen keeps the header link "Review queue" (visible in `screens/03-run-page-403-invalid-identity-dark.png`). That link opens the dashboard, which offers "Use another account". The pull page offers the valid action for a wrong account; only "Retry" is absent.
  - The wrong-origin case needs the `workers.dev` host (`apps/web/wrangler.jsonc`: `"workers_dev": true` in `env.production`). No link leads there. Alternative (b) (redirect or close that host) removes the case.

## RESIL-10

- Verdict: confirmed.
- Severity: low (auditor: medium).
- Proof: `components/operations-attention/index.tsx:239-242` calls `onAccessDenied(401)`. `routes/index.tsx:165-174` sets `{ status: "guest" }`. The guest view (`:280-320`) has no reason text and no live region.
- Why low: an open dashboard polls each 60 s, and each request renews the session (P5: 168 hours left after each request later than 1 day). The realistic cause of a background 401 is a sign-out in another tab. The landing page is then the correct state. The missing sentence, the lost search text, and the lost focus are real but small.

## RESIL-11

- Verdict: confirmed.
- Severity: medium (auditor: medium).
- Proof: P2 case E with real `offline` and `online` window events (`windowNetworkEvents: ["offline","online"]`): alert `Not saved. Failed to fetch`; 0 requests in 5 s after `online`; key `A` gives only the screen-reader line "Resolve the unsaved command before saving another review." (`use-review-session.ts:409-412`).
- Note on the auditor's method: `s07-network.mjs:26-28` simulated the loss with `route.abort("internetdisconnected")`. `navigator.onLine` stayed `true` and no `online` event fired, so the sentence "`navigator.onLine` is `true`" proves nothing. The result holds with real events (above).
- Addition: see "Missed" item 3. "Refresh current state" pressed while still offline drops the held decision.

## RESIL-12

- Verdict: partly confirmed.
- Severity: low (auditor: medium).
- Proof: `@tanstack/react-router/src/lazyRouteComponent.tsx:52-71` and `@tanstack/router-core/src/utils.ts:507-517` (installed versions). P4 case 1c on the dev app: `url: "chrome-error://chromewebdata/"`, `ERR_INTERNET_DISCONNECTED`, and the run page 3 s after the connection returns.
- Production (derived, no build run): the local `dist` has the same file names as production (`index-MxeSnhFR.js` in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/live/curl-prod-assets.jsonl`). Assets have `Cache-Control: public, max-age=0, must-revalidate`, so a chunk in the HTTP cache does not help offline.
- Corrections:
  - Kind "bug" is debatable. This is the designed router behavior. A run cannot open offline in any case (the loader needs the API). In Chrome the result after reconnection is the run that the user asked for.
  - Alternative (a) names an option that the Start plugin refuses: `@tanstack/start-plugin-core/src/schema.ts:6-8` has `configSchema.omit({ autoCodeSplitting: true, target: true })`. The available control is `router.codeSplittingOptions` (`defaultBehavior` or `splitBehavior`, `@tanstack/router-plugin/src/core/config.ts:95-115`). I did not run a build to prove that an empty grouping removes the split.
  - `router.preloadRoute` also runs the loader. For the run route that needs a run ID and reads the full model. The chunk-only call is `router.loadRouteChunk(route)` (`router-core/src/router.ts:2660`).
  - `vite:preloadError` exists only in a production build (Vite documentation, URL above).

## RESIL-13

- Verdict: partly confirmed.
- Severity: low (auditor: medium).
- Proof: P4 cases 1b and 1e reproduce the dev result (6 failed module requests, 2 automatic reloads, then the bare screen). The production build splits the error component: `dist/client/assets/index-MxeSnhFR.js` has ``errorComponent:pe(()=>_e(()=>import(`./runs._runId-6tHAE8eb.js`)``. `router.tsx:7-9` has no `defaultErrorComponent`.
- Corrections:
  - The production screen differs from the screenshot. The default error component starts with the details hidden outside development (`@tanstack/react-router/src/CatchBoundary.tsx:59`: `useState(process.env.NODE_ENV !== 'production')`; in the bundle: `function Ts({error:e}){let[t,n]=z.useState(!1)`). Production shows "Something went wrong!" and a "Show Error" button. The module URL shows only after a click. Screen code X1 ("Hide Error", red module URL) describes the dev screen.
  - A normal deploy does not reach this state. `.github/workflows/deploy.yml:133` runs `wrangler deploy` (all traffic at once). The first reload gets the new document and the new chunk names. The second failure needs an asset fault or a blocked request.
  - Alternative (c), "keep old assets available", is not a Workers setting. The Cloudflare document (URL above) offers version affinity for gradual rollouts only. Old files would need a custom store.
  - The option names in the recommendation exist: `defaultErrorComponent`, `defaultNotFoundComponent` (`react-router/src/router.ts:33`, `:48`), and `codeSplittingOptions` to keep `errorComponent` in the main bundle.

## RESIL-14

- Verdict: confirmed.
- Severity: low (auditor: low).
- Proof: `client.ts:157-159`. `server.ts:60-71`: `/health` has no build or version field. The measured sequence follows from the code: the receipt parse fails with a plain `Error`, `use-review-session.ts:380-388` replaces the text with "Could not confirm…", and `refresh()` fails with "Not saved. This review format has changed. Refresh before reviewing." through `reportError` (`:260-278`, `:502`).
- Feasibility: the build ID can come from the Workers version metadata binding (URL above) and a Vite `define` on the client.

## RESIL-15

- Verdict: confirmed.
- Severity: low (auditor: low).
- Proof: `client.ts:263-267`; `apps/web/src/cutover-fence.ts:4-8` (503, plain text, `Retry-After: 60`).
- Note: the fence is deployed only during a cutover (`.github/workflows/deploy.yml:376-402`). Outside that time the row needs a platform error page that is not JSON.

## RESIL-16

- Verdict: partly confirmed.
- Severity: low (auditor: medium).
- Proof: the table matches the code: `routes/index.tsx:196`, `operations-attention/index.tsx:243`, `pulls.$pullNumber.tsx:73`, `use-review-session.ts:236`, `:274`, `:386`. `api/index.ts:42`, `:82` and `server.ts:49` set `Retry-After: 1`.
- Corrections:
  - "No client code reads `Retry-After`" is true only for the web client. The CLI reads it: `packages/cli/src/http.ts:195`: `const delay = retryDelay(response.headers.get("Retry-After"));`.
  - Alternative (c) (remove the header) is not open. `docs/current-contract.md:81` requires "HTTP 503 with `error.reference`, the existing private headers, and `Retry-After: 1`", and the CLI uses it.
  - The missing reference on the dashboard and the pull page is not a contract fault. `docs/current-contract.md:83` requires it in the review client only (the report says this).
  - The automatic retry is safe for commands: `enqueueReview` returns for an equal payload (`operations/review-queue.ts:28-32`), and Undo replays by `undoCommandId` (`review-commands.ts:330-334`). `POST /api/review-sessions` is not idempotent; a retry adds one more row.

## RESIL-17

- Verdict: confirmed.
- Severity: medium (auditor: medium).
- Proof: `routes/index.tsx:356-364`. P2 case F: `/?view=service` with a 503 from `/api/runs` shows the heading "The review queue could not be loaded", `operationsRequests: 0`, `runsRequests: 1`. Screen: `VERIFY/screens/F-service-view-run-list-503.png`.
- Note: both endpoints share the auth and GitHub checks (`api/index.ts:191-205`). A fault there stops both. The gain of the fix is for faults of the run list read alone.

## RESIL-18

- Verdict: partly confirmed.
- Severity: low (auditor: medium).
- Proof: P1: an unknown run ID gives `IncompleteError` "The requested record does not exist." (409 `incomplete`). A bad `comparison` value gives 400 `invalid_id` "The resource identity is invalid." (the report marked this as derived). Image texts: `components/screenshot-viewer.tsx:58`, `:68`, `:158`. `api/review.ts:592`: `recompareAllowed: false`.
- Correction: the cards have no exit link, but the pages are not dead ends. The header keeps "Review queue" on the run error screen and on the pull page (`components/app-shell.tsx`). The part about evidence errors is fully correct: a dimension mismatch has no control and no text that names the next step.

## RESIL-19

- Verdict: confirmed. The production branch stays unverified.
- Severity: low (auditor: medium).
- Proof: P5 reproduces each line of M8 (`access_denied`, `state_mismatch`, `state_not_found`, `invalid_code`, the 9,340-byte page with the `better-auth.com` "Ask AI" link). `better-auth/dist/api/routes/callback.mjs:37`, `:79-86`, and `error.mjs:380-384` match the quotes (version 1.7.5). The three sign-in calls pass only `provider` and `callbackURL`.
- Production branch: I did not request `/api/auth/*` (forbidden by the rules). Three facts point to the built-in HTML page: the built chunk reads `env.NODE_ENV` through a proxy at run time (`dist/server/assets/error-CzdqHglb.js:30-32`), `wrangler.jsonc` has no `NODE_ENV` variable, and Cloudflare states that `NODE_ENV` "is not a runtime value" (URL above; the plugin replaces only the literal `process.env.NODE_ENV`). This is an inference.
- Correction to the recommendation: `errorCallbackURL` is not enough. P5:

  ```text
  callback, user denied access, errorCallbackURL set -> 302 /runs/7c0e…?item=…&variant=React&error=access_denied&error_description=…
  callback, same state again, errorCallbackURL set   -> 302 /api/auth/error?error=state_mismatch
  ```

  The state errors (`state_mismatch`, `state_not_found`, and the 10-minute case) happen before the stored state is read, so they always use the default error URL. `onAPIError.errorURL` is required for them. It is not only a second line of defense.

- Why low: the failure needs a cancel on GitHub, a wait of more than 10 minutes, or a GitHub fault. "Go Home" returns to `/`.

## RESIL-20

- Verdict: confirmed for the library behavior. The production address handling is not verified (AUTH-14 owns it).
- Severity: low (auditor: low).
- Proof: P5: `200, 200, 200, 429 x-retry-after=10, 429 x-retry-after=10`; body `{"message":"Too many requests. Please try again later."}` with `content-type: text/plain`. `better-auth/dist/api/rate-limiter/index.mjs:302-308` (window 10, max 3 for `/sign-in`). UI code: `routes/index.tsx:220-226`, `:270-274`; `pulls.$pullNumber.tsx:128-131`.
- Note: the default address header is `x-forwarded-for` (`@better-auth/core/dist/utils/ip.mjs:196`). If the Worker request has no such header, all users share one bucket for each path (P5: `[200,200,200,429,429]` with no address header).

## RESIL-21

- Verdict: judgment. Each factual part is correct.
- Severity: low (auditor: low).
- Proof: `api/review.ts:581` (the sentence), `review-workspace.tsx:385-387` (`if (!ready) return;` before any feedback), `:473-488` (plain anchors, `aria-current` only). Screen `screens/11-historical-comparison-dark.png` shows "9 of 11 need review", the "Needs review" badge, and a filled Approve button.
- Note: no new historical comparison can be made (`recompareAllowed: false`). The contract keeps existing ones readable (`docs/current-contract.md:50`, W06). The traffic of this view in production is not known.

## RESIL-22

- Verdict: partly confirmed.
- Severity: medium (auditor: medium).
- Proof: focus is `body` after "Refresh current state" in P2 cases B, E, and G. `review-workspace.tsx:1104-1134`: one element changes between `role="status"` and `role="alert"` and contains the buttons. `:950-990`: the evidence alert contains "Retry images". `:1202-1204`: the announcement line is `sr-only`.
- Correction: "alerts read their button labels as text" was not measured with a screen reader. The recorded string (`Not saved. Failed to fetchRetry same commandRefresh current state`) is the `textContent` of the element. The DOM fact (controls inside the live region) is confirmed. The real speech output depends on the screen reader.

## RESIL-23

- Verdict: confirmed.
- Severity: low (auditor: low). Kind "security" is generous.
- Proof: no `BroadcastChannel` and no session `storage` listener (static check repeated). `runs.$runId.tsx:193`: `window.location.assign("/")` only in the tab that signs out. `routes/index.tsx:234`.
- Real exposure: a person at the same browser profile sees the content that was already on screen. No request works after the sign-out (each API read answers 401). Images are public by URL by design: `docs/review-guide.md:3` says "Validated image URLs need no session; anyone with a URL can view and copy those pixels." The private part is labels and verdicts on that one screen. Nothing can be changed.

## Missed

1. The queued receipt drops the reviewer, so a conflict never names the other person. `api/review.ts:817-830` returns `{ error, model }`; only the unused non-queued path adds `reviewer`. This breaks `docs/review-guide.md:55`, and the repository's own client test mocks a field that production does not send (`review/__tests__/client.test.ts:221-245`).
2. The first failed save on a replaced run says "State changed. Refresh the comparison before trying again." (`packages/service/src/database.ts:65`). The text asks for an action that cannot help, because the run is closed for good.
3. "Refresh current state" drops the held decision also when the read itself fails. P3 (offline): after the click, "Retry same command" is gone, Approve and Reject stay disabled until a later refresh works, and 0 commands are posted in total. The auditor showed this for a 401 only.
4. An open dashboard tab renews the session without end. The alerts poll runs each 60 s also in a hidden tab, and each request after 1 day extends the 7-day session (P5). The expiry is not an idle limit while one dashboard tab is open.
5. In production the router's default error screen shows "Something went wrong!" and "Show Error" with the details hidden (`CatchBoundary.tsx:59`). The dev screenshot in the report is not what a user sees.
6. A renewed review session cannot undo decisions of the older session, and a queued command cannot follow a predecessor of another session (`review-commands.ts:340-347`, `operations/review-queue.ts:41-47`). Any fix of RESIL-01 must clear the Undo stack and the predecessor link.
7. `errorCallbackURL` does not cover the state errors of the OAuth callback (P5). The 10-minute wait case always goes to `/api/auth/error` unless `onAPIError.errorURL` is set.
8. The run page prints the reviewer as a numeric GitHub ID in Details (`review-workspace.tsx:465`). This is the real place of the "numeric ID" problem.
9. No runtime code deletes rows of `ingest_review_sessions` (only the restore sanitizer and the preview retirement SQL do). Each tab adds one row at its first decision.
