# Second-lens check: LIVE-01, LIVE-02, LIVE-03, LIVE-14

Lens: platform facts, real impact, and fix feasibility. Source state: commit `f83fef6`, worktree `serialized-dazzling-pixel`. Read-only. Nothing in the repository was changed.

## Inputs and limits

- `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/live/report.md` and `live/verification.md` do not exist. I used `live/verify/recovered-report.md` (the recovered report text) and the raw probe outputs in `live/verify/`. No written first verification exists for the live lane.
- I also used `audit/live-authenticated.md` (the orchestrator's signed-in measurements in the maintainer's browser) and `audit/load/verification.md` (same code path, different lane).
- Installed versions that I checked in `node_modules`: `better-auth` 1.7.5, `@better-auth/core` 1.7.5, `@better-auth/kysely-adapter` 1.7.5, `@tanstack/react-router` 1.170.38, `@tanstack/router-core` 1.171.32, `@tanstack/react-start` 1.168.57, `@tanstack/start-server-core` 1.169.37, `wrangler` 4.136.1.
- My own measurements: 16 anonymous `GET` requests to production (below) and one local RSA probe. All other numbers are quoted from the files above and are marked as such.
- All production samples in all lanes come from one location (Cloudflare `GRU`, São Paulo). The D1 primary region is still not known.

My production re-measurement (one `curl` process, connection reused, time to first byte in ms, raw file `second-lens-9/prod-guest-curl.txt`; the label column in that file is wrong because `curl` applies the last `-w` to all transfers, the order is the request order):

| Path                         | D1 round trips (from code) | Samples (ms)       | Median |
| ---------------------------- | -------------------------- | ------------------ | ------ |
| `/health` (200)              | 0                          | 30, 28, 27, 101    | 29     |
| `/images/<unknown id>` (404) | 1                          | 214, 311, 265, 507 | 288    |
| `/api/runs` (401)            | 2 (schema check)           | 575, 370, 378, 359 | 374    |
| `/api/operations` (401)      | 3 (project + schema check) | 478, 470, 485, 488 | 481    |

Read: schema check = 374 - 29 = 345 ms. One more point query = 481 - 374 = 107 ms. The image path was noisy in my 4 samples. The load lane measured 142 ms for it with 8 samples.

## Summary

| ID      | Verdict                                          | Report severity | My severity |
| ------- | ------------------------------------------------ | --------------- | ----------- |
| LIVE-01 | confirmed                                        | high            | high        |
| LIVE-02 | confirmed, with three corrections to the options | high            | high        |
| LIVE-03 | partly-confirmed                                 | high            | medium      |
| LIVE-14 | partly-confirmed                                 | medium          | medium      |

---

## LIVE-01 · Each API request runs a full database schema check inside better-auth

Verdict: **confirmed**. Severity: **high**.

### 1. Hot path

Production takes this path for each request (`apps/web/wrangler.jsonc:47-66` sets `VISONAUT_ENVIRONMENT: "production"`, so `apps/web/src/server.ts:73-80` is skipped):

- `apps/web/src/api/index.ts:130`: `const auth = createAuth({ ...bindings.configuration.auth, database: bindings.database });`. This line runs for each `/api/*` and `/v1/*` request. Only `/images/*` (`:113-122`) and the webhook (`:127-129`) return before it.
- `apps/web/src/server.ts:85` and `:93`: one more `createAuth(...)` for `/api/auth/*` and `/api/me`.
- `packages/security/src/auth.ts:21`: `return betterAuth({ ... })`. The `advanced` block (`:47-51`) has no `database` key.
- `better-auth/dist/auth/base.mjs:15`: `const pendingSchemaCheck = ctx.checkSchema?.();` starts the check when the instance is built.
- `better-auth/dist/api/to-auth-endpoints.mjs:41-42`: `if (pendingSchemaCheck) await pendingSchemaCheck;`. Each `auth.api.*` call waits, also `getSession` with no cookie. `better-auth/dist/api/index.mjs:169-170` does the same for `auth.handler`.
- `@better-auth/kysely-adapter/dist/index.mjs:712`: one check is registered for each adapter instance. `@better-auth/core/dist/db/schema-check.mjs:58-67`: the `clean` flag is a closure variable of that one instance. A new instance for each request never has a clean result.
- `@better-auth/kysely-adapter/dist/d1-sqlite-dialect-D4qp4-wW.mjs:89-98`: the check is 1 `sqlite_master` query, then `this.#d1.batch(statements)` with one `pragma_table_info(?)` for each table and view in the database.

Count that I checked: `sqlite3 audit/d1/schema.db` gives 74 tables + 1 view = 75 statements in the batch (76 statements with the first query), and 28,673 bytes of `sql` text in the answer to the first query. Production probably has one table more (`d1_migrations`, which Wrangler creates). I did not read the production schema.

How often, for a signed-in maintainer:

| User action              | API requests that build an auth instance                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open the dashboard       | 2 (`/api/runs`, then `/api/operations`)                                                                                                                                              |
| Dashboard tab stays open | 1 each 60 s (`operations-attention/index.tsx:280`)                                                                                                                                   |
| Open a run               | 1 (`/api/runs/<id>`)                                                                                                                                                                 |
| Approve or Reject        | 1 `POST /api/review-sessions` (first time), 1 `POST .../commands`, then 1 `GET /api/commands/<id>/queued` each 500 ms until it is saved (`review/client.ts:296`, `:313`, `:326-335`) |
| Open a GitHub check link | 2 (`/api/pulls/<n>`, then `/api/runs/<id>`)                                                                                                                                          |

CI also takes this path. Each `/v1/*` request builds the instance (`api/index.ts:130` is before `:134-189`). The check is started but not awaited there (`base.mjs:16` attaches only `.catch`). `PUT /v1/uploads/<token>` is one request for each image (`api/index.ts:174-177`). So each uploaded image sends 76 more statements to D1. This is from code and from the local `construct-only` experiment (76 statements). It is not measured in the Workers runtime.

### 2. Magnitude

Measured (guest, `GRU`):

- Schema check = guest `/api/runs` minus `/health`: 345 ms (mine), 332 ms (load lane, medians of 8), 338 to 356 ms (auditor).

Measured (signed-in, orchestrator, `audit/live-authenticated.md`): `/api/runs` server wait 865 to 1,967 ms, `/api/operations` 1,204 to 1,299 ms, page stable at 2.6 to 3.7 s.

Computed from these two measurements:

- The check is 31 to 39% of a typical `/api/runs` request (335 of 865 to 1,077 ms) and 26 to 28% of `/api/operations` (335 of 1,204 to 1,299 ms).
- One dashboard load pays it two times in series: about 0.67 s of the 2.6 to 3.7 s.

Load on D1 (counted, not measured): 76 statements for each request. The auditor counted about 855 rows read for each check. Cost is not the problem: the paid plan includes "First 25 billion / month" rows read (https://developers.cloudflare.com/d1/platform/pricing/). The problem is the queue. "Each individual D1 database is inherently single-threaded, and processes queries one at a time." (https://developers.cloudflare.com/d1/platform/limits/). A capture run with thousands of uploads puts thousands of 75-statement batches in front of real queries.

Uncertainty: the 330 to 345 ms is for `GRU`. A user near the D1 region pays less for the same 2 round trips. The split between the first query and the batch is not measured.

### 3. Fix feasibility

The option exists in the installed version:

- `@better-auth/core/dist/types/init-options.d.mts:390-400`: "Set `false` to disable runtime schema validation. `@default true`".
- `@better-auth/core/dist/db/schema-check.mjs:7-9`: `return options.advanced?.database?.validateSchema !== false;`.
- Official documentation: "To disable this feature, configure: `advanced.database.validateSchema: false`" and results are cached "per adapter instance" (https://better-auth.com/docs/concepts/database).
- The upstream issue for this exact pattern (a factory for each request on Cloudflare D1): "because the check runs before every request" (https://github.com/better-auth/better-auth/issues/11346). The check is new in 1.7.3.

```ts
// packages/security/src/auth.ts
advanced: {
  cookiePrefix: `visonaut-${configuration.environment}`,
  useSecureCookies: configuration.environment !== "local",
  defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
  database: { validateSchema: false },
},
```

The first verifier's local run with this option returns the same session with 2 statements (session, user) and 0 for a guest (`live/verify/rerun-session-no-validate.txt`).

What could go wrong:

- A schema that does not match better-auth is then found by a failed query, not by a clear message. The request still fails closed (a thrown query error gives 503 through `api/index.ts:224-226`).
- No test compares the better-auth schema with `apps/web/migrations` (`rg "validateSchema|getMigrations|SchemaMismatch"` outside `node_modules` has no result). A test that runs the same comparison one time in CI replaces the runtime check.
- The other option (one shared instance for each isolate) has a real platform risk. The shared check is one pending promise (`schema-check.mjs:68`, `verdict ??= ...`). A second request would await I/O that the first request started. Workers bind I/O to the request that started it. The comment at `auth.ts:15` is correct about this. Keep the instance for each request.

Security contract: no change. `docs/current-contract.md:186` says "Live session and linked-account checks still run for every request." The session, user, and account reads stay.

### 4. Strongest counter-argument

The check is the only automatic guard between hand-written D1 migrations and the schema that better-auth expects. If the Worker ran near D1 (LIVE-02), the same check would cost two short round trips, and the maintainer could keep the guard. Against this: the check runs on each CI upload also, the failure mode without it is still closed, and a CI test gives the same guard one time for each build.

### Corrections to the report

- None to the facts. Add the CI effect to the impact: the check also runs one time for each uploaded image.

---

## LIVE-02 · One D1 round trip costs about 90 ms from GRU, and a signed-in API request makes 6 to 9 in series

Verdict: **confirmed**, with three corrections to the options. Severity: **high**. Confidence is now high, because the signed-in measurement agrees with the count.

### 1. Hot path

Serial `await`s for one signed-in `GET /api/operations`, from the code:

| Step                             | Code                                                                | Round trips |
| -------------------------------- | ------------------------------------------------------------------- | ----------- |
| Project check                    | `api/index.ts:124-126`, `packages/service/src/service.ts:104-106`   | 1           |
| Schema check                     | LIVE-01                                                             | 2           |
| Session, then user               | `authorization.ts:32-36` (better-auth, two queries without `joins`) | 2           |
| Linked account                   | `authorization.ts:40-43`                                            | 1           |
| Projects again, events, capacity | `api/operations.ts:16-18`, `:30-43`, `:45-47`                       | 3           |
| Total                            |                                                                     | 9           |

`GET /api/runs` skips the project check (`api/index.ts:123`) and its handler is one batch (`api/dashboard.ts:68`): 6. The load lane counted the same numbers with a D1 wrapper and a signed cookie (`load/verify/cookie.json`: guest 2, `/api/runs` 6, `/api/operations` 9).

Each dashboard load runs both requests in series (`routes/index.tsx:254-256`). An open tab repeats the 9 each 60 s.

A GitHub call is added when the 60 s permission entry is old (`authorization.ts:60-73`). The poll period is also 60 s, so each poll calls GitHub.

`apps/web/wrangler.jsonc` has no `placement` key (I read the complete file, 125 lines). The load lane's probe shows `"placement":null` and `"colo":"GRU"`.

### 2. Magnitude

- One round trip, measured: 107 ms (mine, `/api/operations` minus `/api/runs`), 140 to 142 ms (load lane), 87 to 133 ms (auditor). "About 90 ms" in the title is the low end. Use 105 to 145 ms.
- The model agrees with the signed-in measurement. 9 round trips: 335 ms (schema check) + 7 x 105 to 145 ms = 1.07 to 1.35 s. Measured: 1.20 to 1.30 s. 6 round trips: 335 + 4 x 105 to 145 = 0.76 to 0.92 s. Measured: 0.87 to 1.08 s in four of five samples, so the model is a little low for this request (its last round trip is a batch of 3 statements with joins and JSON reads, `api/dashboard.ts:68-81`, so it is not a point query). The fifth sample (1.97 s) fits a live GitHub check, but that cause is not measured.
- Platform reason: "D1 location hints are not currently supported for South America (`sam`), Africa (`afr`), and the Middle East (`me`)." (https://developers.cloudflare.com/d1/configuration/data-location/). A Worker that runs in `GRU` crosses to another continent for each round trip.
- GitHub API: GitHub publishes rate limits, not latency. An installation token "will expire after 1 hour" (https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app) and the limit is "5,000 requests per hour" (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api). One poll each minute is far below it. Latency from the Worker is not measured.
- RSA signing: Cloudflare publishes no timing. The signature is CPU work with no network. It runs only when a token is minted (`github.ts:134-143`), at most one time each hour for each isolate. A local Node probe (`second-lens-9/rsa-sign.mjs`, not workerd) gives a median of 1.98 ms for `importKey` + RS256 sign. It is not a part of this problem.

Round trips after each step (counted from code and from the first verifier's local runs):

| Request               | Now | No schema check | + `joins` | + one batch in `operationsStatus` |
| --------------------- | --- | --------------- | --------- | --------------------------------- |
| `GET /api/runs`       | 6   | 4               | 3         | 3                                 |
| `GET /api/operations` | 9   | 7               | 6         | 4                                 |

### 3. Fix feasibility

**a. `joins`. Correction: the option name in the report is wrong.** `experimental.joins` does not exist in 1.7.5. `init-options.d.mts:1549-1561` has only `instrumentation` under `experimental`. The option is `advanced.database.joins` (`init-options.d.mts:375-389`, read at `@better-auth/core/dist/db/adapter/factory.mjs:192`, `:562`). Documentation: "Enable via `advanced.database.joins: true`" (https://better-auth.com/docs/concepts/database).

```ts
// packages/security/src/auth.ts
database: { validateSchema: false, joins: true },
```

Local run: 1 statement with `join_user` columns and the same session (`live/verify/rerun-session-joins.txt`). Risk: the SQL of a security-critical read changes. The type comment says "Please read the adapter documentation ... before enabling this."

**b. One batch in `operationsStatus`.** `D1Database.batch()` exists. "Sends multiple SQL statements inside a single call to the database. This can have a huge performance impact as it reduces latency from network round trips to D1." (https://developers.cloudflare.com/d1/worker-api/d1-database/). The three reads do not depend on each other.

```ts
// apps/web/src/api/operations.ts (sketch)
const [projects, rows, capacity] = await database.batch([
  database.prepare("SELECT id,repository_id FROM visonaut_projects ORDER BY id LIMIT 2"),
  database.prepare(eventsSql),
  database.prepare("SELECT value FROM operations_cursors WHERE id='database-capacity'"),
]);
```

**c. Placement. Correction: `mode: "smart"` can fail to engage for this Worker.** The keys exist in wrangler 4.136.1 (`node_modules/wrangler/config-schema.json:261-333`: `mode: "off" | "smart"`, or `region`, `host`, `hostname`). `placement` is an inheritable key, so set it inside `env.production` only (preview has no D1). Platform facts (https://developers.cloudflare.com/workers/configuration/placement/):

- "Smart Placement requires consistent traffic to the Worker from multiple locations to make a placement decision." and "Smart Placement only considers locations where the Worker has previously run." A tool with a few maintainers can stay in `INSUFFICIENT_INVOCATIONS`.
- The page recommends explicit hints when "Your Worker connects to a single database, API, or service". That is this case.
- "Placement only affects the execution of fetch event handlers." Cron and queue do not change.
- "Static assets are always served from the location nearest to the incoming request."

```jsonc
// apps/web/wrangler.jsonc, env.production (the region is an example; read the D1 region first)
"placement": { "region": "aws:us-east-1" }
```

The region hint uses cloud-provider names, not D1 names. Read the D1 region first: `meta.served_by_region` is "present for all D1 remote requests" (https://developers.cloudflare.com/d1/best-practices/read-replication/). After a deploy, the `cf-placement` response header shows the result.

What changes: each of the N round trips then stays in one region, and the request pays one long hop. The SSR document and `/health` pay that hop also (now 29 to 120 ms at `GRU`). The size of the gain is not measured. I did not build this. The generated `dist/server/wrangler.json` passes standard keys through (`limits` and `observability` are there), but verify with `wrangler deploy --dry-run`.

**d. Read replicas. Correction: this alternative gives nothing here.** Replicas exist only in "ENAM, WNAM, WEUR, EEUR, APAC, OC", and "you must use the D1 Sessions API (withSession), otherwise all queries will continue to be executed only by the primary database" (same page). There is no replica in South America. A session read from a replica also has replica lag, which touches the contract line about live session checks.

**e. Session-to-account cache. This alternative needs a contract change.** `docs/current-contract.md:186`: "Live session and linked-account checks still run for every request." Options a to c do not change the contract.

### 4. Strongest counter-argument

The 105 to 145 ms is a fact of one location. D1 has no region in South America, so a maintainer in Brazil always pays it, but a maintainer near the D1 region would not. Placement adds an opaque platform decision and makes each document slower for edge users. The contract sets a floor of 2 to 3 round trips for each private request. LIVE-01 alone removes one third of the wait. A maintainer can decide that LIVE-01 plus the two small changes (a, b) are enough and that placement is not worth the new variable.

### Corrections to the report

1. `experimental.joins` → `advanced.database.joins`.
2. "About 90 ms" → 105 to 145 ms for one round trip, and the signed-in totals are now measured (0.87 to 1.97 s and 1.20 to 1.30 s), not only counted.
3. Smart Placement: state the traffic requirement and offer the region hint. Remove read replicas as an option for this location.

---

## LIVE-03 · The first data request starts only after all JavaScript has loaded and run

Verdict: **partly-confirmed**. Severity: **medium** (report: high).

The facts are correct. The severity and the main recommendation are not.

### 1. Hot path

- `routes/index.tsx:161`: `useState<DashboardState>({ status: "loading" })`. `:176-210`: the fetch is in `useEffect`. The route (`:39-44`) has no `loader`. So SSR always renders `:275-279`.
- `routes/runs.$runId.tsx:31`: `ssr: false`. The server renders `pendingComponent` (`:48`, `:66-74`). Documentation: "the server will render the route's `pendingComponent` as a fallback" (https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr).
- Saved production documents contain the two loading texts (`live/body-prod-root.html`, `live/body-prod-run-doc.html`, 1 match each).
- Frequency: one time for each document load. The header links and the run page's `Queue` button are plain anchors (`components/app-shell.tsx:29`, `:55`; `review/review-workspace.tsx:580`), so each of these clicks is a new document load and pays the chain again.

### 2. Magnitude

What this finding owns is the time between the first byte of the document and the start of the API request.

- Guest, production, fast link (auditor): 138 ms cold (93 → 231 ms) and 107 ms warm (98 → 205 ms). With 4x CPU and slow 4G, cold: about 2.0 s (705 → 2,729 ms).
- Signed-in maintainer (orchestrator, 5 samples): `/api/runs` starts 199 to 303 ms after the document's first byte (232, 240, 199, 200, 303).
- In the same samples the `/api/runs` response ends at 1.2 to 2.3 s and the page is stable at 2.6 to 3.7 s.

So on the maintainer's real device this finding is 0.2 to 0.3 s of a 1.2 to 2.3 s wait (about 10 to 20%). The report's own number says the same: "the API wait is 92% of it". LIVE-01 and LIVE-02 own the larger part. After they are fixed, this gap becomes the larger part of what remains. For a guest with no cookie, SSR of the sign-in view removes the complete wait, but a maintainer with a 7-day session (`auth.ts:43`) is rarely a guest.

### 3. Fix feasibility

The APIs exist in the installed versions: `createServerFn`, `createIsomorphicFn` (`@tanstack/react-start/dist/esm/index.d.ts:3`), `getRequest`, `getCookie` (`@tanstack/start-server-core/dist/esm/request-response.d.ts:8`, `:74`), `ssr: boolean | 'data-only'` (`router-core/dist/esm/router.d.ts:42`), and a request `context` (`request-handler.d.ts:56-66`). better-auth has a cookie presence helper: `getSessionCookie(request, { cookiePrefix })` (`better-auth/dist/cookies/index.mjs:261-270`, exported as `better-auth/cookies`). It reads the cookie only. It does not validate the session.

Three problems with the main recommendation (a server loader for the data):

**a. Server-function responses do not get the security headers.** `server.ts:23-28` adds `securePrivateResponse` inside the callback of `createStartHandler`. That callback runs only for router SSR (`createStartHandler.js:386`). Server-function requests take a different branch (`createStartHandler.js:337-348`, `handleServerAction`) and `server.ts:118` returns that response as it is. A `createServerFn` that returns the run list would answer with no `Cache-Control: no-store, private`, no `nosniff`, and no origin check from `api/index.ts:110-112`. This is a change to the security surface. Two ways to prevent it:

```ts
// Option 1: no new endpoint. Server calls the API in process, client keeps /api/runs.
const loadRuns = createIsomorphicFn()
  .server(() =>
    handleApi(
      new Request(new URL("/api/runs", origin), { headers: getRequest().headers }),
      bindings,
      lifetime,
    ),
  )
  .client(() => fetch("/api/runs", { credentials: "same-origin", cache: "no-store" }));

// Option 2: secure all Start responses in the outer handler.
return securePrivateResponse(await render(request)); // server.ts:118, keep the nonce for documents
```

**b. An awaited loader moves the access check into the document.** `createStartHandler.js:372` awaits `routerInstance.load()` before it renders. With the current API cost the first byte would arrive after 0.9 to 2.0 s, not after 41 to 120 ms. The user would see the old page or a blank page for that time. Use a streamed promise, or do this only after LIVE-01 and LIVE-02.

**c. The run page cannot use this fix.** The orchestrator measured 5.3 to 6.0 MB of JSON for one run model. A server loader would put that in the HTML. The selected decision P03 says: "Keep this browser-oriented route client-only initially; server loading would need a separately scoped authenticated server read." (`docs/simplification-audit/audit-data.json:2326`). `ssr: false` on the run route is deliberate.

What is feasible with low risk:

- **Guest shortcut in SSR.** No session cookie → render the sign-in view. This needs no D1 and makes no authorization decision, so the contract does not change. It needs a loader or `beforeLoad` on `/` that reads the cookie on the server.
- **Early fetch (the report's "minimal" option).** The CSP allows it: `script-src 'self' 'nonce-…'` (`packages/security/src/http.ts:40-43`), and `routes/__root.tsx:23-26` already has an inline script with the nonce. It works for the run page also. It saves the measured 0.2 to 0.3 s for the maintainer and about 2 s on a slow device.

```tsx
// routes/__root.tsx head (sketch): start the read while the scripts download
<script
  nonce={nonce}
  dangerouslySetInnerHTML={{
    __html: `if (location.pathname === "/") window.__runs = fetch("/api/runs", { credentials: "same-origin", cache: "no-store" });`,
  }}
/>
```

Risk: the component must use the promise exactly one time and must fall back to a new fetch on refresh and on client navigation.

Security contract: the early fetch and the guest shortcut do not change it. A server loader for private data adds a second authenticated read path and needs point a.

### 4. Strongest counter-argument

The report's data shows that the API is 92% of the wait. On the maintainer's device this finding is 0.2 to 0.3 s. The larger fix adds a private-data path to the document route, in a service whose contract is strict about access checks. Fix LIVE-01 and LIVE-02, measure again, and then decide if 0.2 to 0.3 s is worth a new path.

### Corrections to the report

1. Severity medium. State the measured share (0.2 to 0.3 s of 1.2 to 2.3 s for the signed-in maintainer).
2. The server-loader recommendation must name the three problems (a, b, c). For the run page only the early fetch applies.

---

## LIVE-14 · Each return to the queue loads the run list again and shows the loading line again

Verdict: **partly-confirmed**. Severity: **medium**.

The headline is correct and now has local measurements. The recommended fix does not reach the usual return path.

### 1. Hot path

There are two ways back to the queue, and they are different:

| Way back                                           | Code                                                                                                | What happens                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Queue` button on the run page, logo, header links | `review/review-workspace.tsx:580` (`render={<a href="/" />}`), `components/app-shell.tsx:29`, `:55` | A new document. All in-memory state is lost.                                                         |
| Browser Back                                       | client navigation                                                                                   | `Index` mounts again with `{ status: "loading" }` (`routes/index.tsx:161`) and fetches (`:176-210`). |

Local probes of the first verifiers (dev server with fixtures):

- `live/verify/nav-probe.out2.txt`, step 1.3, click `Queue`: `{"type":"document","method":"GET","path":"/"}`, then `/api/runs`.
- `live/verify/back-probe.out.txt`, after Back: `"/|loading=true|queue=false"` at 11 ms, then `fetch /api/runs`.
- `load/verify/nav-reload.rerun.txt`, "browser back to queue": `"documentLoads":0,"apiRunsRequests":2,"loadingTextShown":1` (2 requests because of React Strict Mode in dev).

Why nothing is kept: the router caches only matches of routes that have a loader (`router-core/dist/esm/load-client.js:783`: `if (!route.options.loader || ...) continue;`). The index route has none.

Frequency: one time for each reviewed run in the loop queue → run → queue.

### 2. Magnitude

Not measured in production for this exact sequence. From the signed-in dashboard measurements, each return costs the same as a dashboard load:

- `Queue` button: a complete load, stable at 2.6 to 3.7 s.
- Back: `/api/runs` (0.87 to 1.97 s) with the loading line, then `/api/operations` (1.20 to 1.30 s) for the header badge.

In round trips: 6 + 9 = 15 serial D1 round trips for each return, for a list that was on screen a short time before.

### 3. Fix feasibility

The router feature exists in the installed version and is the default behavior for a route with a loader:

- `load-client.js:330`: `staleTime` default `0`. `:783`: `gcTime` default `3e5` (5 minutes). `:346`: a stale successful match reloads in the background unless `staleReloadMode` is `"blocking"`.
- Documentation: "By default, `staleReloadMode` is `'background'`, so stale successful matches keep rendering with their existing `loaderData` while the loader revalidates in the background." (https://tanstack.com/router/latest/docs/framework/react/guide/data-loading).

Three corrections to the recommendation:

**a. The cache helps only client navigations.** With the current anchors, the `Queue` button and the header links reload the document, and a module variable or the router cache is empty again. The fix needs router links first (the pattern is already at `routes/index.tsx:510` and `:549`):

```tsx
// review/review-workspace.tsx:580
<Button $p={1} render={<Link to="/" search={{}} />}>
```

**b. `staleTime: 30_000` in the sketch is a correctness risk.** The user returns to the queue directly after a decision. For 30 s the router would show the old list and send no request, so a run that was just approved still reads "Needs review". Keep the default `staleTime: 0`. The old list shows at once and the new one replaces it when it arrives. Or call `router.invalidate()` after a saved decision.

```tsx
// routes/index.tsx (sketch): the loader returns a state, so 401 and 403 are data, not errors
export const Route = createFileRoute("/")({
  ssr: false, // or an isomorphic loader, see LIVE-03
  loader: ({ abortController }) => loadDashboard(abortController.signal),
  pendingComponent: DashboardLoading,
  component: Index,
});
```

A loader with a relative `fetch` cannot run in SSR. Use `ssr: false` (the same as the run route) or the isomorphic function from LIVE-03.

**c. `gcTime: 0` on the run route is not evidence for this finding.** It belongs to the run model (5.3 to 6.0 MB in production) and is part of the selected P03 sketch (`docs/simplification-audit/audit-data.json:2337`: `gcTime: 0,`). Do not change it as part of this fix.

Other things that can go wrong: sign-out must clear the cache (`router.invalidate()` or the current `window.location.assign("/")` at `routes/runs.$runId.tsx:193`). A background reload that gets 401 or 403 must replace the old list at once. `OperationsAttention` keeps its own state and still fetches on each mount.

Security contract: no server change. The server still checks the session and the account for each request. The browser keeps a private run list in memory for at most 5 minutes after the user leaves the route. Today the same list stays in the DOM while the tab is open.

### 4. Strongest counter-argument

After LIVE-01 and LIVE-02 the read on return is 3 round trips, not 6, and a short loading line can be acceptable. A cached list that is wrong for a moment (a run that still shows as open after approval) can be worse than a short wait for a review tool. The cache also does nothing until the anchors become router links, and that link change removes the document reload, which is the larger cost.

### Corrections to the report

1. Name the two return paths. The usual one (`Queue` button) is a document reload, which a client cache cannot fix.
2. Replace `staleTime: 30_000` with the default background reload.
3. Remove `gcTime: 0` of the run route from the evidence.

---

## Order that follows from the numbers

This is not a disposition. It shows how the four findings depend on each other.

1. LIVE-01 is one option and removes 2 of 6 (or 9) round trips and about 335 ms from each API request at `GRU`. It also removes 76 statements from each CI request.
2. LIVE-02 a and b remove 1 and 2 more round trips with small code changes. Placement (c) changes the cost of each remaining round trip but needs the D1 region and a measurement.
3. LIVE-14 needs router links first. Then a loader on `/` gives the cached list on return.
4. LIVE-03 early fetch is independent and small. The server loader is the largest change and has security work (point a).

## Files

- This file: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-9.md`
- Scratch: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-9/prod-guest-curl.txt`, `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-9/rsa-sign.mjs`
