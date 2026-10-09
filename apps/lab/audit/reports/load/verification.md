# Verification: Dashboard page load and access-check path

Source state: [`f83fef6`](https://github.com/ariakit/visonaut/commit/f83fef6bfcaeb44ad0ed8fa91d5ae6cd4a1ecc90), worktree `serialized-dazzling-pixel`. Read-only. Nothing in the repository was changed.

## Input and method

`/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/load/report.md` did not exist. The harness refused the auditor's `Write` call. I recovered the full report text from the auditor's transcript (the refused `Write` input). The recovered copy is `verify/recovered-report.md` (54,527 characters, 15 findings, the same IDs as the index).

For each finding I opened each cited file, ran the auditor's local probes again in my scratch directory, and wrote new probes where the auditor's method had a weak point. All paths below that start with `verify/` are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/load/verify/`.

| Probe                                                                                                         | Result                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vitest` copies of `roundtrips`, `auth-options`, `ci-routes`, `pr-title`, `auth-init-cpu`                     | 5 of 5 pass. All numbers equal the report (M1, M2, M4, M9, M16).                                                                                       |
| `verify/cookie.test.ts` (new): signed session cookie, not the `Bearer` header                                 | Same counts: guest 2, `/api/runs` 6, `/api/operations` 9 round trips.                                                                                  |
| `node ../prod-probe.mjs 8` (anonymous, production)                                                            | `verify/prod-probe.rerun.txt`. `/health` 33 ms, `/images/<unknown>` 175 ms, guest `/api/runs` 365 ms, guest `/api/operations` 505 ms (medians, `GRU`). |
| `node ../fresh-connections.mjs 10 1500` (anonymous, production)                                               | `verify/fresh-connections.rerun.txt`. 0 of 10 new connections were slow. See LOAD-10.                                                                  |
| `node ../nav-reload.mjs`, `verify/pending-states.mjs`, `verify/refresh-blank.mjs`, `verify/service-chain.mjs` | All equal the report (M8, M15, M10, M11).                                                                                                              |
| `verify/unread-body-local.mjs` (new): a real 401 from a local server                                          | Confirms LOAD-15 and adds one correction.                                                                                                              |
| `verify/sizes.mjs` (new)                                                                                      | Equal to M7.                                                                                                                                           |
| `curl -s -D -` on `/api/me`, `/api/runs`, two assets (production)                                             | Equal to M6 and M17.                                                                                                                                   |

Production requests sent by this verification: about 100 anonymous `GET` requests. No credential, no write.

Two sources that the auditor did not have:

- `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/live-authenticated.md`: the orchestrator measured the signed-in dashboard in the maintainer's Chrome session. `/api/runs` server wait: 865 to 1,967 ms (5 samples). `/api/operations` server wait: 1,204 to 1,299 ms. `/api/operations` starts 66 to 250 ms after `/api/runs` ends. The page is stable 2.6 to 3.7 s after navigation start. Limit: a background tab.
- `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/infra/deploy-37357689984.log:6971-6972`: the production deploy of the same build.

## Verdict summary

| ID      | Verdict          | Auditor severity | My severity |
| ------- | ---------------- | ---------------- | ----------- |
| LOAD-01 | confirmed        | high             | high        |
| LOAD-02 | partly-confirmed | high             | medium      |
| LOAD-03 | confirmed        | high             | high        |
| LOAD-04 | confirmed        | medium           | medium      |
| LOAD-05 | confirmed        | high             | high        |
| LOAD-06 | confirmed        | medium           | medium      |
| LOAD-07 | confirmed        | medium           | medium      |
| LOAD-08 | confirmed        | low              | low         |
| LOAD-09 | partly-confirmed | medium           | low         |
| LOAD-10 | partly-confirmed | medium           | low         |
| LOAD-11 | confirmed        | low              | low         |
| LOAD-12 | confirmed        | medium           | medium      |
| LOAD-13 | confirmed        | medium           | medium      |
| LOAD-14 | confirmed        | low              | low         |
| LOAD-15 | confirmed        | low              | low         |

No finding is refuted in full. Three findings need a material correction (LOAD-02, LOAD-09, LOAD-10).

## LOAD-01 · Better Auth reads the whole database schema on every request

Verdict: **confirmed**. Severity: **high**.

Proof that I checked:

- `packages/security/src/auth.ts:15-16` and `:47-51`: the comment and the `advanced` block are as quoted. There is no `database` key.
- `apps/web/src/api/index.ts:130`, `apps/web/src/server.ts:85`, `apps/web/src/server.ts:93`: one `createAuth(...)` call for each request.
- Installed Better Auth 1.7.5: `@better-auth/core/dist/db/schema-check.mjs:7-9` (`validateSchema !== false`), `:51-78` (the verdict lives in a closure of `createSchemaCheck`, one closure for each adapter instance), `@better-auth/kysely-adapter/dist/index.mjs:712` (one check is registered for each `betterAuth()` call), `better-auth/dist/auth/base.mjs:15`, `better-auth/dist/api/to-auth-endpoints.mjs:41-42`. The quotes are exact.
- `@better-auth/kysely-adapter/dist/d1-sqlite-dialect-D4qp4-wW.mjs:89-98`: the check is one `sqlite_master` query, then one `batch` with one `pragma_table_info(?)` for each table and view in the database (all tables, not only the auth tables).
- Local re-run, signed cookie (`verify/cookie.json`): guest `GET /api/runs` sends exactly 2 round trips, `select "name", "type", "sql" from "sqlite_master" …` and `BATCH(75) SELECT * FROM pragma_table_info(?)`. With `validateSchema: false`, `requireMaintainer` returns `ok login=maintainer` with 3 round trips. With `joins: true` also, 2.
- Production re-run: guest `/api/runs` median 365 ms, `/health` median 33 ms. The difference is 332 ms. A guest request does no other D1 work (`api/index.ts:123` skips the project check for `GET /api/runs`).
- I searched for a guard that would make this wrong. `rg -i "validateSchema|SchemaMismatch|getMigrations"` in the repository (outside `node_modules`) has no result. No contract line requires the runtime check. It is a library default.

Corrections and additions:

- On `/v1/*` routes the check is started but not awaited (`base.mjs:15-18` attaches only a `.catch`). The CI request does not wait for it, but D1 still receives the 76 statements. `PUT /v1/uploads/:token` is one request for each image (`api/workflow-owned.ts:1005-1017`), so the check repeats for each uploaded image. The D1 documentation says: "Each individual D1 database is inherently single-threaded, and processes queries one at a time." (https://developers.cloudflare.com/d1/platform/limits/). This cost is outside the dashboard lane but it increases the value of the fix.
- The recommendation is feasible. The option exists in the installed version (`@better-auth/core/dist/types/init-options.d.mts:390-400`: "Set `false` to disable runtime schema validation."). No current test validates the Better Auth schema against the migrations, so the proposed test is new work.

## LOAD-02 · The server sends the loading text, and the data request starts only after hydration

Verdict: **partly-confirmed**. Severity: **medium** (auditor: high).

Confirmed:

- `apps/web/src/routes/index.tsx:39-44` has no `loader`. Lines `161` and `176-184` are as quoted.
- The saved production document contains `role="status">Checking access and loading runs…` (`../prod-root.html`). It preloads 1 CSS file and 8 JS files.
- `verify/sizes.mjs`: JS for `/` is 602,062 bytes raw and 191,660 bytes gzip. CSS is 464,666 bytes raw and 60,125 bytes gzip. Equal to M7.
- `../prod-guest-waterfall.json`: `/api/runs` starts at 367, 266, 166, and 182 ms. Equal to M6.

Corrections:

1. The size of the problem. The measured delay before the data request starts is 0.17 to 0.37 s for a guest (auditor) and 0.24 to 0.60 s for the signed-in maintainer (orchestrator: 322, 359, 240, 277, and 595 ms). The measured server wait of `/api/runs` is 0.87 to 1.97 s, and the read ends 1.2 to 2.3 s after navigation start. A loader moves the start of the read to the document request, so it removes about 0.2 to 0.6 s. That is 14 to 27% of the wait in four of the five samples and 41% in one. LOAD-01, LOAD-03, and LOAD-04 remove more. The finding stays important because the loader is also the base for LOAD-06 and LOAD-07, and because a slower device makes the JS stage longer.
2. The P03 evidence does not apply to the dashboard. P03 in `docs/simplification-audit/audit-data.json:2228-2330` asks "Who should cancel and own page reads?" for the run page. The selected option says: "Use TanStack Router’s existing route loader for the complete review model." Its migration note says: "Keep this browser-oriented route client-only initially; server loading would need a separately scoped authenticated server read." So `ssr: false` on the run route is deliberate, and the dashboard was not part of the selection. This is not drift between the contract and the code.
3. The first recommendation (a loader that awaits the read) has a cost that the report does not state. The server waits for the loader before it sends the first byte. With today's access check the document would arrive after about 0.9 to 2.0 s, not after 50 to 100 ms, and the browser would show the previous page during that time. The streaming variant (return the promise, render with `<Await>`) or the cookie pre-check does not have this cost. Use the awaiting loader only together with LOAD-01, LOAD-03, and LOAD-04.

Feasibility: `createIsomorphicFn` is in use (`apps/web/src/router.tsx:5`), `getRequest` exists (`@tanstack/start-server-core/dist/esm/request-response.d.ts:8`), and `RequestOptions` accepts a `context` (`request-handler.d.ts:56-66`). The sketch was not built by the auditor or by me.

## LOAD-03 · Each D1 round trip costs about 105-125 ms from the São Paulo edge, and the Worker has no placement setting

Verdict: **confirmed**. Severity: **high**.

Proof that I checked:

- `apps/web/wrangler.jsonc:1-125`: no `placement` key at the top level or in `env.production`. `rg -i 'withSession|"placement"'` in `apps/` and `packages/` has no result.
- Production re-run (`verify/prod-probe.rerun.txt`), medians of 8, `colo: GRU`, `placement: null`:

  ```
  /health                 33 ms   (0 D1 round trips)
  /images/<unknown id>   175 ms   (1 D1 round trip, apps/web/src/api/images.ts:24-35)
  /api/runs       (401)  365 ms   (2 round trips)
  /api/operations (401)  505 ms   (3 round trips)
  ```

  Per round trip: 175 − 33 = 142 ms and 505 − 365 = 140 ms. The auditor measured 125 and 106 ms. Use "about 105 to 145 ms".

- The signed-in measurement agrees with the model. `/api/operations` has 9 round trips: 332 ms (schema check) + 7 × 105 to 145 ms = 1.07 to 1.35 s. Measured: 1.20 to 1.30 s.
- `node_modules/wrangler/config-schema.json:261-330` accepts the four placement forms that the report lists.

Platform facts (official documentation):

- "D1 location hints are not currently supported for South America (`sam`), Africa (`afr`), and the Middle East (`me`). D1 databases do not run in these locations." (https://developers.cloudflare.com/d1/configuration/data-location/). A Worker that runs in `GRU` therefore always crosses to another continent for each D1 round trip. This makes the auditor's "consistent with a database in North America" stronger, but the region is still not read.
- Read replicas exist only in "ENAM, WNAM, WEUR, EEUR, APAC, OC" and "you must use the D1 Sessions API, otherwise all queries will continue to be executed only by the primary" (https://developers.cloudflare.com/d1/best-practices/read-replication/). There is no replica in South America. For a maintainer in Brazil the read-replica alternative gives no gain if the primary is in ENAM.
- Placement: `{ "mode": "smart" }` and `{ "region": "aws:us-east-1" }` are the documented forms. "Smart Placement requires consistent traffic to the Worker from multiple locations to make a placement decision. The analysis process may take up to 15 minutes." The page recommends placement hints when "Your Worker connects to a single database, API, or service". "Placement only affects the execution of fetch event handlers." "Static assets are always served from the location nearest to the incoming request." (https://developers.cloudflare.com/workers/configuration/placement/).
- Smart Placement does consider D1: "Workers has Smart Placement to dynamically run your Worker in the best location to reduce total request latency, considering everything your Worker talks to, including D1." (https://blog.cloudflare.com/sqlite-in-durable-objects/).

Corrections to the recommendation: the region hint uses cloud-provider region names, not D1 region names, so the D1 region must be read first (dashboard or `wrangler d1 info`). The queue and cron handlers are not affected. The tradeoff that the report states (one long hop for each Worker request, about 110 to 140 ms more for the document in Brazil) is correct.

## LOAD-04 · The access check and the operations read send their D1 statements one at a time

Verdict: **confirmed**. Severity: **medium**.

Proof that I checked:

- `packages/security/src/authorization.ts:32-43`: `getSession`, then the `account` statement, in sequence.
- `@better-auth/core/dist/db/adapter/factory.mjs:562`: exact quote. `advanced.database.joins` is a normal option in 1.7.5, not under `experimental` (`init-options.d.mts:375-389`).
- `apps/web/src/api/operations.ts:16-18`, `30-36`, `45-47`: three awaited statements. No statement uses the result of another one.
- `apps/web/src/api/index.ts:123-126` and `apps/web/src/api/operations.ts:16-29`: the project is read two times for `/api/operations`.
- `verify/cookie.json`, statement lists with a signed cookie:

  ```
  [current]                               5 round trips: sqlite_master, BATCH(75), session, user, account
  [validateSchema: false]                 3 round trips: session, user, account
  [validateSchema: false + joins: true]   2 round trips: session with "join_user" columns, account
  ```

  All three variants return `ok login=maintainer` for the same user.

Additions: at the measured 105 to 145 ms for each round trip, `joins` saves about 0.1 s for each private read and the operations batch saves about 0.3 to 0.4 s. The statement in the report that the session cookie cache needs a contract change is correct (`docs/current-contract.md:186`: "Live session and linked-account checks still run for every request.").

## LOAD-05 · Each header navigation click reloads the whole document

Verdict: **confirmed**. Severity: **high** (small change, and each click costs one complete load, measured at 2.6 to 3.7 s for the signed-in maintainer).

Proof that I checked:

- `apps/web/src/components/app-shell.tsx:15-19`, `:29`, `:53-58`: plain `href` values and `render={<a href="/" />}`.
- `apps/web/src/components/ariakit/components/nav.ariakit.react.tsx:577-606`: `NavLink` renders `ak.Role.a` and its documentation gives `render` to the anchor.
- Re-run of `../nav-reload.mjs` (`verify/nav-reload.rerun.txt`): each header click gives `documentLoads: 1` and the loading text. The in-page `View history` link gives `documentLoads: 0, apiRunsRequests: 0`.
- I searched the documents and the history for a reason for the full reload. There is none.

Feasibility of the recommendation: the same pattern is in use (`apps/web/src/routes/index.tsx:510` and `:549`, `render={<Link … />}` on a `Button`). `NavLink` computes its own `aria-current` from `rest.href` (`nav.ariakit.react.tsx:590`), which is empty when `Link` supplies the `href`. `AppHeader` passes `aria-current` explicitly, so this is not a problem. Not built.

## LOAD-06 · The dashboard data lives only in component state

Verdict: **confirmed**. Severity: **medium**.

Proof that I checked: `apps/web/src/routes/index.tsx:161`, `:242-245`, `:254-264` are as quoted. `verify/refresh-blank.txt` equals M10 (`queueHeading: false, loadingText: true, accountMenu: false, cards: 0` during the refresh). `verify/nav-reload.rerun.txt`: browser Back from a run sends `/api/runs` again and shows the loading text.

No correction. The security note is correct. One addition: private data already stays on screen in an open tab without a time limit, because nothing reads again until the user acts.

## LOAD-07 · The service view and the alert bell wait for `/api/runs` before they request `/api/operations`

Verdict: **confirmed**. Severity: **medium**.

Proof that I checked:

- `apps/web/src/routes/index.tsx:254-256` and `:356-365`: both mounts are inside `state.status === "ready"`.
- `verify/service-chain.txt`: `/api/runs` 299 → 1,312 ms, then `/api/operations` 1,337 → 2,344 ms, data at 2,641 ms. Equal to M11.
- Signed-in production (orchestrator): `/?view=service`: `/api/runs` ends at 1,461 ms, `/api/operations` starts at 1,527 ms and ends at 2,744 ms.

Corrections:

- The estimate "about 1.9 s at `GRU`" is low. The measured value is 2.6 to 3.7 s to a stable page.
- The option "start both reads together" has a cost. `packages/security/src/authorization.ts:71-82` deletes the cached entry, awaits GitHub, and only then stores the result. There is no shared pending check. Two parallel reads with a permission older than 60 s can each call GitHub. In my local run with an instant GitHub stub the second read found the new entry (1 call); with real GitHub latency it can be 2. The other option (the alert count inside the dashboard batch) does not have this cost.

## LOAD-08 · The alert poll period equals the permission cache lifetime, so each poll calls GitHub

Verdict: **confirmed**. Severity: **low**.

Proof that I checked:

- `apps/web/src/components/operations-attention/index.tsx:280`: `timeout = setTimeout(load, 60000);` in `finally`, so the next request starts 60 s after the response.
- `packages/security/src/authorization.ts:21`, `:63`, `:72`: lifetime 60,000 ms from a `checkedAt` that is taken before the GitHub call. The next poll is always later than `checkedAt + 60000`.
- Re-run of M1 (`verify/roundtrips.json`): both 60 s polls record `GET /repos/ariakit/ariakit/collaborators/maintainer/permission`, 9 round trips, 83 statements.
- The effect (`index.tsx:228-289`) has no `visibilitychange` handler. `apps/web/src/routes/pulls.$pullNumber.tsx:105-119` has one.

Notes: "1,440 GitHub calls per day" is the upper limit (a tab that is open for 24 hours on a device that does not sleep). Two UI strings state the period: "This page checks for updates every minute." and "Alerts refresh every minute while this dashboard is open." (`operations-attention/index.tsx:330-338`). A different period must change them. I did not verify the sub-claim that the 5-minute cron records "most" alerts.

## LOAD-09 · The permission, token, and login caches live in one isolate only

Verdict: **partly-confirmed**. Severity: **low** (auditor: medium).

Confirmed:

- `packages/security/src/authorization.ts:19`, `packages/security/src/github.ts:102` and `:193`: module-level `WeakMap` and `Map`.
- `apps/web/src/runtime.ts:117-136` and `:259-260`: `env.DB` is passed directly and no custom `fetch` is set, so the keys are stable in one isolate. `node ../env-identity.mjs` gives `sameDatabaseBinding: true, weakMapHit: true` for requests 2 and 3.
- `verify/cookie.json`: the first signed-in request makes `POST /app/installations/1/access_tokens`, `GET /user/42`, `GET /repos/…/permission`, in sequence.

Corrections:

1. M13 does not show that new isolates occur. A new connection is not a new isolate. In my run 0 of 10 new connections had a slow first `/health` (77 to 366 ms with TCP and TLS setup), and one slow request (1,012 ms) was the third `/api/runs` on a warm connection. How often a request reaches a new isolate is unknown.
2. The gain of the recommended D1 table is smaller than "1 to 3 GitHub calls on each new isolate". The contract limits the stored result to 60 s. A maintainer who returns after more than 60 s needs a live permission call in each design. The installation token cannot be stored. So in the usual case (first load after an idle period) the table saves only `GET /user/:id`, and only if the login is stored. It saves all the calls only when a new isolate serves a request less than 60 s after the last check.
3. The table adds one D1 write for each live check.

The alternative "store only the login hint" gives almost the same gain with less code. Placement (LOAD-03) also moves the GitHub calls closer to GitHub.

## LOAD-10 · A cold Worker adds 0.6-1.3 s to the first request

Verdict: **partly-confirmed**. Severity: **low** (auditor: medium). The slow requests are real. The cause in the title is not shown, and the open question is answered against it.

Proof that I checked:

- `verify/sizes.mjs`: 33 modules, 4,104,202 bytes raw, 888,351 bytes gzip. `dist/server/index.js` is 2,098,892 bytes in 46,193 lines (not minified). Equal to M7.
- The Worker startup time is known. The auditor says it is not. The production deploy log has it (`/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/infra/deploy-37357689984.log:6971-6972`, step "Deploy production web worker", 2026-10-05T18:47:22Z):

  ```
  Total Upload: 4007.84 KiB / gzip: 856.53 KiB
  Worker Startup Time: 47 ms
  ```

  The platform limit is 1 second: "A Worker must parse and execute its global scope (top-level code outside of handlers) within 1 second." (https://developers.cloudflare.com/workers/platform/limits/). 47 ms cannot explain 700 to 1,400 ms.

- Re-run (`verify/fresh-connections.rerun.txt`), first `/health` on 10 new connections, in ms: 366, 79, 121, 158, 80, 88, 179, 83, 77, 107. No slow first request. First `/api/runs` on the same connections: 341 to 397. One outlier of 1,012 ms was the third `/api/runs` on connection 6.
- Re-run of the probe series (`verify/prod-probe.rerun.txt`): the first guest `/api/runs` took 436 ms, not about 1,050 ms.

Corrections: change the title to "Some requests take 0.7 to 1.4 s more; the cause is not known". The pattern "first request after a new connection" did not repeat. The recommended work (minify the server build, load the render path and Better Auth only where needed) has no evidence behind it, because the startup time is 47 ms. The traces that `apps/web/wrangler.jsonc:15-20` enables are the place to find the cause.

## LOAD-11 · Content-hashed assets are revalidated on every document load

Verdict: **confirmed**. Severity: **low**.

Proof that I checked:

- `curl -s -D - -o /dev/null https://visonaut.com/assets/index-MxeSnhFR.js` → `cache-control: public, max-age=0, must-revalidate`, `etag: "1353ea0a382036735f0a145a145f6a9a"`. The CSS file has the same policy.
- `../prod-guest-waterfall.json`: on each of the 3 reloads, 9 asset entries have `transfer: 300` and end 37 to 106 ms after they start. The CSS is one of them, and first paint follows it (reload 1: CSS 104 → 210 ms, first paint 244 ms).
- `apps/web/public/` holds only `favicon.svg`. The built `dist/server/wrangler.json` has `"assets":{"directory":"../client"}`. `node_modules/wrangler/wrangler-dist/cli.js:156046` is `HEADERS_FILENAME = "_headers"` (Wrangler 4.136.1).

Platform facts: the default is "Cache-Control: public, max-age=0, must-revalidate", and the documentation recommends "Cache-Control: public, max-age=31556952, immutable" for "fingerprinted assets (assets which have a hash in their filename)" (https://developers.cloudflare.com/workers/static-assets/headers/). The Vite plugin supports `_headers` in the `public` directory "at build, preview and deploy time" (https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/). "Custom headers defined in the `_headers` file are not applied to responses generated by your Worker code", so the private responses are not affected.

No correction. The recommendation is correct for the platform. It was not built.

## LOAD-12 · Opening a run from the queue shows no change for 1 second, and nothing is preloaded

Verdict: **confirmed**. Severity: **medium**.

Proof that I checked:

- `apps/web/src/router.tsx:8`: no `defaultPendingMs`, no `defaultPreload`.
- `apps/web/src/routes/runs.$runId.tsx:31-36`: `ssr: false`, `pendingMinMs: 0`, `gcTime: 0`, `staleTime: Infinity`. No `pendingMs`.
- `@tanstack/router-core@1.171.32/dist/esm/router.js:625-627`: `defaultPreloadDelay: 50, defaultPendingMs: 1e3, defaultPendingMinMs: 500`.
- `verify/pending-states.txt`: `{"urlChangedMs":21,"loadingTextMs":1000,"queueGoneMs":1000}`. Equal to M15.
- `rg "preload|pendingMs"` in `apps/web/src` (outside the generated route tree) has no other result.

Caveat for the recommendation: `preload="intent"` starts the most expensive read of the service on hover. The orchestrator measured `/api/runs/<id>` for a 626-item run at 5.3 to 5.7 s server wait and 5.3 to 6.0 MB of JSON. A preload for a run that the user does not open keeps the single-threaded D1 database busy for that time, and a client abort does not stop the server work. `pendingMs: 0` and feedback on the clicked control have no such cost. Add the preload only after the model read is cheap. The interaction with `gcTime: 0` is still not tested.

## LOAD-13 · Pull request titles are erased before the dashboard reads them

Verdict: **confirmed**. Severity: **medium**.

Proof that I checked:

- `apps/web/src/api/dashboard.ts:57-62` and `apps/web/src/api/review.ts:288`: both read `json_extract(payload_json,'$.pull_request.title')` from `github_webhook_delivery`.
- `apps/web/src/api/webhooks.ts:279-335`: the `pull_request` branch has no early `return`, so the last statement always runs: `UPDATE github_webhook_delivery SET processed_at = ?, payload_json = '{}' WHERE delivery_id = ? AND payload_digest = ?`.
- `apps/web/src/api/dashboard.test.ts:42-56`: the fixture inserts rows with `processed_at` set and the full payload. The processor never leaves a row in this state.
- Re-run of M16 (`verify/pr-title.json`): `title: "Add the tooltip arrow"` before the update, no `title` after it.
- History: the compaction is [`339926d`](https://github.com/ariakit/visonaut/commit/339926dc17c5663d84299582b6b4b7636d8029e0) (2026-09-28). The title query and `apps/web/migrations/0028_pr_title_index.sql` are from [`5712036`](https://github.com/ariakit/visonaut/commit/5712036875830f7dfcc1d3294d3b2f61ac9fc4a7) (2026-09-30).
- Production: the auditor did not inspect production rows. The orchestrator's signed-in notes do: "History rows show `#7746 · Pull request` because no pull request title is available".

Additions:

- The compaction is deliberate and has a runbook: `docs/operations/compact-processed-webhooks.md` ("New deliveries retain their full JSON while `processed_at` is null and clear it in the same write that marks them processed."). A one-time backfill also cleared the old rows. So the fix must store the title in a different place. The alternative "keep three fields in the payload" works against that runbook.
- After compaction each key of the partial index in `0028_pr_title_index.sql` is `NULL`. The index gives no result but is updated on each delivery write.

## LOAD-14 · `/api/me` and `/api/session` are not used by the app, and their error shape differs

Verdict: **confirmed**. Severity: **low**.

Proof that I checked:

- `apps/web/src/server.ts:88-105` and `apps/web/src/api/review.ts:713-721`: as described.
- `curl -s -D - https://visonaut.com/api/me` → `HTTP/2 401`, `retry-after: 1`, `{"error":{"code":"sign_in_required","message":"Sign in with GitHub."}}`. `curl -s -D - https://visonaut.com/api/runs` → `HTTP/2 401`, no `retry-after`, `{"schemaVersion":"1.0","error":{…}}`.
- `apps/web/src/server.ts:47-50` (always `Retry-After: 1`), `apps/web/src/api/index.ts:38-44` (503 only), `:131-133` (not reachable through `server.ts:82-87`), `:216-218` (404 body with no `schemaVersion`).
- `apps/web/src/routes/index.tsx:258-263` and `apps/web/src/components/user-menu.tsx:24`: no `login`, label `Account`.
- `docs/review-evidence-plan.md:62`: the stale sentence is there.

Corrections:

- `/api/me` has a documented operator use that the report does not list: `docs/operations/retire-preview-auth-at-cutover.md:59` names it as a probe target, and `apps/web/src/review/__tests__/preview-fixtures.test.ts:25` covers it. Removal must change that runbook also.
- `/api/session` has no caller in the repository and no test. `rg "/api/session"` finds only `apps/web/src/api/review.ts:713`.

## LOAD-15 · The dashboard leaves 401 and 403 response bodies unread

Verdict: **confirmed**. Severity: **low**.

Proof that I checked:

- `apps/web/src/routes/index.tsx:185-195`, `apps/web/src/components/operations-attention/index.tsx:239-242`, `apps/web/src/routes/pulls.$pullNumber.tsx:59-69`: the code returns and does not read the body. `apps/web/src/review/client.ts:268-269` reads the body before it checks the status, so the run page does not have this problem.
- The auditor's M18 used a response that Playwright replaced. I tested a real 401 from a local HTTP server with the production headers (`verify/unread-body-local.mjs`, Chrome):

  ```
  body not read    events: request, response                   network idle: never (14 s)   Resource Timing entries: 0
  body.cancel()    events: request, response, requestfailed    network idle: yes            Resource Timing entries: 1
  response.json()  events: request, response, requestfinished  network idle: yes            Resource Timing entries: 1
  ```

Correction to the recommendation: `await response.body?.cancel()` works, but Chrome then reports the request as failed. To read the 92-byte body gives a clean finish:

```ts
if (response.status === 401) {
  await response.arrayBuffer();
  setState({ status: "guest" });
  return;
}
```

## Missed

- **The pull request entry path runs the complete access check two times in sequence.** GitHub check links open `/pulls/:n?check=…` (`apps/web/src/operations/review-links.ts:65`). The page reads `/api/pulls/:n` (8 serial D1 round trips by code: project, 2 schema, session, user, account, `pre_run_checks`, `visonaut_runs`; `apps/web/src/api/review.ts:735-784`), then navigates in the client to `/runs/:id`, which runs the check again. The report shows this only in a table row.
- **The Worker startup time is in the deploy log: 47 ms.** `audit/infra/deploy-37357689984.log:6971-6972`. It answers the open question of LOAD-10.
- **Signed-in production timing exists and is higher than the estimates.** `/api/runs` 0.87 to 1.97 s and `/api/operations` 1.20 to 1.30 s server wait, page stable at 2.6 to 3.7 s (`audit/live-authenticated.md`). The report estimates 0.8 s and 1.1 s. One sample is about 1 s slower than the others, which fits a live GitHub check.
- **D1 has no region in South America, for the primary or for replicas.** Each D1 round trip from `GRU` is intercontinental, and read replication cannot help a maintainer in Brazil (https://developers.cloudflare.com/d1/configuration/data-location/).
- **The schema check also runs one time for each uploaded image.** `PUT /v1/uploads/:token` builds the auth instance (`apps/web/src/api/index.ts:130`, `:174-177`), so each image adds 76 statements on the single-threaded database.
- **The permission check has no shared pending request.** Parallel private reads with a permission older than 60 s can each call GitHub (`packages/security/src/authorization.ts:71-82`). This matters for the parallel option of LOAD-07.
- **Session renewal adds one D1 write round trip.** Measured locally: 7 round trips and a `Set-Cookie` for `/api/runs` when the session is due (`verify/cookie.json`, `update "session" set "expiresAt" = ?, "updatedAt" = ? …`). This occurs one time each day for each session (`packages/security/src/auth.ts:44`).
- **The title index is dead.** `apps/web/migrations/0028_pr_title_index.sql` holds only `NULL` keys after compaction (part of LOAD-13).
- **The alert poll period is stated in two UI strings.** `apps/web/src/components/operations-attention/index.tsx:330-338` (part of LOAD-08).

## Limits of this verification

- No signed-in production request was made by me. The signed-in numbers are from the orchestrator's file.
- The D1 primary region, the GitHub latency from the Worker, and the frequency of new isolates are still not measured.
- No recommendation was built. I checked each one against the installed package versions and the official documentation only.
- All production samples are from one machine near São Paulo on one day.
