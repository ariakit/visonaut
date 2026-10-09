# Second-lens check 1: LOAD-01, LOAD-02, LOAD-03, LOAD-05

Source state: `f83fef6`, worktree `serialized-dazzling-pixel`. Read-only. Nothing in the repository was changed.

This check does not repeat the first verification. It tests three things for each finding: does the path run for real users in production, how large is the cost, and does the recommended fix work on the installed platform and library versions.

## Verdict summary

| ID      | Verdict          | Severity | Main correction from this check                                                                                                                             |
| ------- | ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOAD-01 | confirmed        | high     | None to the finding. The check also runs on each Approve and Reject request. The upstream documentation confirms the cause.                                 |
| LOAD-02 | partly-confirmed | medium   | The measured gain is 0.20 to 0.30 s, not 0.2 to 0.6 s. The fix has three hazards that the report does not list.                                             |
| LOAD-03 | confirmed        | high     | The repository already holds proof that a region hint works on this account, and a recorded cost of 12 to 18 ms for one D1 round trip from a placed Worker. |
| LOAD-05 | confirmed        | high     | The recommended code is wrong as written: two links get `aria-current="page"`. The change also removes the unsaved-decision prompt on the run page.         |

## What I ran and read

| Item                                                                           | Result                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node audit/load/prod-probe.mjs 6` (31 anonymous `GET` requests to production) | `second-lens-1/prod-probe.txt`. All responses: `colo: GRU`, `placement: null`.                                                                                                                                                |
| `node second-lens-1/link-active.cjs` (new)                                     | Renders the LOAD-05 link shape with the installed TanStack Router and Ariakit packages. Output in the LOAD-05 section.                                                                                                        |
| `node second-lens-1/placed-d1-wall.mjs` (new)                                  | Reads 316 recorded D1 queries in `docs/evidence/v3-small/receipts/`. Output in `second-lens-1/placed-d1-wall.txt`.                                                                                                            |
| Installed code                                                                 | Better Auth 1.7.5, `@tanstack/react-router` 1.170.38, `@tanstack/router-core` 1.171.32, `@tanstack/start-server-core` 1.169.37, Wrangler 4.136.1, `@cloudflare/vite-plugin` 1.57.1, `@cloudflare/workers-types` 5.20260922.1. |
| Official documentation                                                         | Cloudflare Workers placement, D1 data location, D1 read replication, D1 limits, D1 Worker API, Better Auth database and options pages, TanStack Router and Start guides, GitHub REST documentation. URLs are at the end.      |

All paths that start with `second-lens-1/` are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-1/`.

### Production timing, three independent runs (anonymous, `GRU`, medians in ms)

| Request                        | D1 round trips        | Auditor    | Verifier 1 | This check |
| ------------------------------ | --------------------- | ---------- | ---------- | ---------- |
| `/health`                      | 0                     | 32         | 33         | 40         |
| `/images/<unknown id>`         | 1                     | 157        | 175        | 162        |
| `/api/runs` (guest, 401)       | 2 (schema check only) | 365        | 365        | 353        |
| `/api/operations` (guest, 401) | 3                     | 471        | 505        | 494        |
| `/` document                   | 0                     | not listed | 65         | 54         |

Raw values of this check: `/health` 118, 49, 42, 32, 29, 38. `/images` 196, 160, 159, 224, 158, 165. `/api/runs` 424, 347, 338, 347, 497, 359. `/api/operations` 500, 522, 485, 488, 523, 475.

Numbers that follow from the table:

- The schema check (2 round trips) costs 313 to 333 ms.
- One simple round trip costs 106 to 142 ms. I use "105 to 145 ms".

Signed-in numbers are from the orchestrator (`audit/live-authenticated.md`, 5 samples, background tab): `/api/runs` server wait 865 to 1,967 ms, `/api/operations` server wait 1,204 to 1,299 ms, queue visible at 1.22 to 2.29 s, page stable at 2.6 to 3.7 s.

### What the official documentation gives for latency

- **D1.** Cloudflare publishes no latency value for one call from a Worker to D1. The documentation gives the cost model only: `batch()` "reduces latency from network round trips to D1", and "With D1, your application code and SQL database queries are not colocated which can impact application performance." The dashboard metric "Query Latency" is "on the server-side" and does not include the network. So the per-round-trip number must be measured. It is measured above.
- **GitHub REST API.** GitHub publishes no typical response time. It publishes only the limit: "If GitHub takes more than 10 seconds to process an API request, GitHub will terminate the request". GitHub calls are not part of LOAD-01, LOAD-02, LOAD-03, or LOAD-05, except as the probable cause of the one 1,967 ms sample.
- **RSA signing.** Cloudflare publishes no time for WebCrypto RS256. It is not on the hot path. `packages/security/src/github.ts:116-119` computes only a SHA-256 digest for each request. `createAppJwt` (`github.ts:29-42`, `importPKCS8` and `sign`) runs only inside `authorize()` (`github.ts:134-135`), when the isolate has no valid installation token (`github.ts:166-173`). GitHub states: "The installation access token will expire after 1 hour."

## LOAD-01 · Better Auth reads the whole database schema on every request

Verdict: **confirmed**. Severity: **high**.

### 1. Hot path

Verified from code:

- Production is not the preview branch. `apps/web/wrangler.jsonc:51` sets `"VISONAUT_ENVIRONMENT": "production"` and lines 67-74 bind the D1 database `visonaut`. `apps/web/src/server.ts:73-80` handles preview and returns. Production continues to line 81.
- `apps/web/src/server.ts:106-116` sends each `/api/*` and `/v1/*` request to `handleApi`.
- `apps/web/src/api/index.ts:130`: `const auth = createAuth({ ...bindings.configuration.auth, database: bindings.database });`. This line runs for each request that is not an image (`:113-122` return first) and not a webhook (`:127-129` return first).
- `packages/security/src/auth.ts:21` calls `betterAuth({...})`. The `advanced` block (`:47-51`) has no `database` key.
- `@better-auth/kysely-adapter/dist/index.mjs:712` registers one new check for each adapter instance. `@better-auth/core/dist/db/schema-check.mjs:58-59` keeps the result in the closure (`let clean = false; let verdict;`). A new instance has a new closure.
- `better-auth/dist/api/to-auth-endpoints.mjs:41-42` awaits the check before each `auth.api.*` call. `packages/security/src/authorization.ts:32` is `await auth.api.getSession(...)`.

How often:

| Request                                                               | Checks | Awaited                                         |
| --------------------------------------------------------------------- | ------ | ----------------------------------------------- |
| Dashboard load (`/api/runs`, then `/api/operations`)                  | 2      | Yes                                             |
| Run page (`/api/runs/:id`)                                            | 1      | Yes                                             |
| Pull request entry (`/api/pulls/:n`, then `/api/runs/:id`)            | 2      | Yes                                             |
| Each Approve or Reject (`POST /api/comparisons/:id/commands`)         | 1      | Yes                                             |
| Each 60-second alert poll                                             | 1      | Yes                                             |
| Each `/api/auth/*` request (`better-auth/dist/api/index.mjs:169-170`) | 1      | Yes                                             |
| Each `/v1/*` CI request                                               | 1      | No. Started at `auth/base.mjs:15`, not awaited. |
| `/images/:id`, webhooks                                               | 0      | n/a                                             |

The Approve and Reject row is not in the report. The maintainer selected the 10-second decision cache "for faster reviews" (`docs/current-contract.md:204`). Each decision still waits for the schema check.

Upstream confirms the cause. The Better Auth database page says: "Validation is enabled by default, including in production, and caches a clean result or mismatch per adapter instance." The feature arrived in 1.7.3. The upstream pull request describes the design as "Initialization and requests share one check per process". Visonaut makes one instance for each request, so the design assumption does not hold here. The repository has used `1.7.5` from its first commit (`43552ce`), so there is no earlier state to compare with.

### 2. Magnitude

- Measured: 313 to 333 ms for each private request at `GRU` (three runs, table above). A guest `/api/runs` request does no other D1 work.
- Share of the signed-in wait (measured wait, measured check cost): 29 to 38% of `/api/runs` in four of five samples, and 24 to 28% of `/api/operations`.
- One dashboard load: 2 checks in sequence, about 0.63 to 0.67 s of the 2.6 to 3.7 s to a stable page.
- One review decision: about 0.32 s more for each Approve or Reject. Estimate, same statements.
- Not time, but load: 76 statements for each request on a database that "processes queries one at a time". The auditor measured 856 rows and about 85 KB for each check (local). I did not measure this again.

Uncertainty: all time values are from one location on one day. If LOAD-03 is applied, the check costs 2 near round trips. From the recorded 12 to 18 ms for each near round trip (see LOAD-03), that is about 25 to 40 ms. This is an estimate.

### 3. Fix feasibility

The option exists in the installed version.

- Type: `@better-auth/core/dist/types/init-options.d.mts:390-400`: "Set `false` to disable runtime schema validation."
- Runtime: `schema-check.mjs:7-9`: `return options.advanced?.database?.validateSchema !== false;`. With `false`, no check is registered, so `ctx.checkSchema` is `undefined` and both call sites do nothing. `auth/base.mjs:11` also skips the log line.
- Documentation: "Set `advanced.database.validateSchema` to `false` to disable runtime validation and its skip message."
- Result: the first verifier ran `requireMaintainer` with the flag. 5 round trips became 3, and the result was `ok login=maintainer` (`audit/load/verify/auth-options.json`). I read the code path. I did not run it again.

One documentation conflict: the Better Auth options page says "(default: `true` outside production)". The installed code and the database page say that the check runs in production. The installed code is the authority, and the production measurement agrees with it.

What can go wrong:

- Schema drift is no longer found at run time. The auth tables come from `apps/web/migrations/0003_auth.sql`. Drift can come from a Better Auth upgrade or from a new migration. Without the check, a missing column gives an SQL error on the first statement that uses it, and the request fails with 503. That is still fail-closed, but the message is less clear. A required column that Better Auth does not fill fails only at sign-in.
- The proposed test is new work, but it is possible. The probe `audit/load/verify/auth-options.test.ts` already builds an instance with validation on against the numbered migrations and gets `ok`.
- `better-auth` is pinned to `1.7.5` in `apps/web/package.json` and `packages/security/package.json`. A test in CI finds drift when the version changes, before deployment. The run-time check finds it after deployment, as a failure of each private request.

Security contract: no change. No line in `docs/current-contract.md` requires a run-time schema check (`rg -i "validateSchema|schema check"` has no result outside `node_modules`). The session check, the linked-account check, and the permission check (`docs/current-contract.md:186`) do not change.

### 4. Strongest counter-argument

The check is the library default and it is a fail-closed guard. Upstream can remove the cost without a local change: `schema-check.mjs:11` already has a `WeakMap` with the database as the key, so a later release can share the result for one D1 binding. LOAD-03 alone decreases the cost to about 30 ms. A maintainer who applies LOAD-03 can keep the default and not own a difference from upstream.

Against this: each private request then still depends on 76 more statements. An upstream issue (better-auth/better-auth#11346, closed, fix in 1.7.6) reports that this check failed on D1 for each request in a different project, and gives the same option as the workaround. Visonaut does not show that failure (production returns 401, not 503). I did not reproduce the upstream report.

## LOAD-02 · The server sends the loading text, and the data request starts only after hydration

Verdict: **partly-confirmed**. Severity: **medium**.

The sequence in the title is correct. The size of the gain is smaller than the report states, and the fix needs more design work than the sketch shows.

### 1. Hot path

Verified from code:

- `apps/web/src/routes/index.tsx:39-44`: the route has `validateSearch` and `component` only.
- `:161`: `useState<DashboardState>({ status: "loading" })`. `:176-184`: the `fetch("/api/runs")` call is in a `useEffect`. An effect runs only after hydration.
- `apps/web/src/server.ts:118` renders the document with no D1 call.

How often: one time for each dashboard document load. With LOAD-05 as it is today, that is also one time for each header click. The same pattern is on `/pulls/:n` (`routes/pulls.$pullNumber.tsx`) and on the run page (`routes/runs.$runId.tsx:31`, `ssr: false`).

### 2. Magnitude

A server loader starts the read when the Worker gets the document request. So its gain is about the time between the document first byte and the start of `/api/runs` today (the "gap"). From the five signed-in samples:

| Sample           | Document first byte | `/api/runs` start | Gap | `/api/runs` end | Gap as share of time to queue |
| ---------------- | ------------------- | ----------------- | --- | --------------- | ----------------------------- |
| `/` 2            | 90                  | 322               | 232 | 2,290           | 10%                           |
| `/` 3            | 119                 | 359               | 240 | 1,353           | 18%                           |
| `/` 4            | 41                  | 240               | 199 | 1,318           | 15%                           |
| `/?view=history` | 77                  | 277               | 200 | 1,220           | 16%                           |
| `/?view=service` | 292                 | 595               | 303 | 1,461           | 21%                           |

So the measured gain is about 0.20 to 0.30 s, or 10 to 21% of the time to the queue. The report gives "166-367 ms guest, 240-595 ms signed in". Those are start times from navigation start. They include the document request, which a loader does not remove.

Limits: warm HTTP cache, fast device, background tab. A cold cache or a slow device makes the JS stage longer, so the gain is larger there. Not measured.

One fact changes the weight of this finding. Today the gap is the small part of the wait. If LOAD-01, LOAD-03, and LOAD-04 decrease `/api/runs` to about 0.2 to 0.3 s (estimate, see LOAD-03), the gap of 0.20 to 0.30 s becomes about half of the wait that remains.

### 3. Fix feasibility

The APIs exist in the installed versions:

- `createIsomorphicFn` is in use (`apps/web/src/router.tsx:5`).
- `getRequest` is exported (`@tanstack/start-server-core/dist/esm/request-response.d.ts:8`).
- `RequestOptions` accepts `context` (`@tanstack/start-server-core/dist/esm/request-handler.d.ts:56-66`).
- `Await` and `defer` are exported by `@tanstack/react-router` 1.170.38.
- The server already streams (`apps/web/src/server.ts:24`, `defaultStreamHandler`). The TanStack documentation says: "Deferred promises rendered with the `<Await>` component trigger suspense boundaries, allowing the server to stream html up to that point".
- The default `ssr: true` runs the loader "on the server during the initial request" and "on the client for subsequent navigation".

What can go wrong. The first verifier found item 1. Items 2 to 5 are new.

1. **A loader that awaits the read delays the first byte.** With today's access check the document would arrive after 0.9 to 2.0 s.
2. **A streamed read cannot set the session cookie.** `apps/web/src/api/index.ts:220-222` copies `identity.sessionHeaders` to the response. With a deferred promise, the response headers are sent before the access check ends. Better Auth renews the session one time each day (`packages/security/src/auth.ts:44`, `updateAge`). It updates the D1 row and then sets the cookie with a new 7-day lifetime (`better-auth/dist/api/routes/session.mjs:198-214`). If the streamed read does the renewal, the row is updated and the `Set-Cookie` header is lost. The next request sees a new row and does not renew. The dashboard document is the first request of a visit, so this can occur each day, and the browser cookie can expire 7 days after sign-in. The installed version has a query option for this (`session.mjs:170`, `disableRefresh`):

   ```ts
   // Only for the streamed document read. A later API request does the renewal.
   auth.api.getSession({
     headers: request.headers,
     query: { disableCookieCache: true, disableRefresh: true },
   });
   ```

   `requireMaintainer` does not accept this option today (`packages/security/src/authorization.ts:32-36`).

3. **Server-rendered rows give a hydration mismatch.** `apps/web/src/routes/index.tsx:153-157`:

   ```ts
   return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
   ```

   The queue and history rows use it (`:405`, `:721`, `:729`). The Worker formats with its own locale and time zone. The browser formats with the user's. The text differs. `ssr: "data-only"` prevents this: the loader runs on the server, and the component renders only in the browser. The data is then ready when the JS is ready, so the wait becomes the larger of the two times, not their sum.

4. **The origin check is not on the document path.** `apps/web/src/api/index.ts:110-112` rejects each API request from a different origin. `server.ts:118` has no such check, and `apps/web/wrangler.jsonc:48` sets `"workers_dev": true` for production. A server read must do the same check, or the private read becomes reachable on a second host name. A browser does not send the `visonaut.com` cookie to that host, so I see no direct exploit. The rule "one exact origin" would have an exception.
5. **Preview has no bindings.** `apps/web/wrangler.jsonc:31-37`. The server read must return the fixture before it touches `env.DB`, as `server.ts:73-80` does today.

An option that keeps one code path for the access check: the server read can call `handleApi` in the same process with a `GET /api/runs` request that has the headers of the document request. Then the origin check, the access check, and the error shapes stay in one place. This is not built.

Security contract: the access check does not change if the read uses `requireMaintainer({ access: "read" })`. The document then contains private data. `securePrivateResponse` already sets `Cache-Control: no-store, private`, `X-Frame-Options: DENY`, and `frame-ancestors 'none'` on it (`packages/security/src/http.ts:31-44`). The rule "Live session and linked-account checks still run for every request" (`docs/current-contract.md:186`) applies to the document read also.

The P03 note in the report is not evidence for the dashboard. P03 is about the run page. Its migration text says: "Keep this browser-oriented route client-only initially; server loading would need a separately scoped authenticated server read." (`docs/simplification-audit/audit-data.json:2326`). So the earlier decision already records that server loading needs a separate design step.

### 4. Strongest counter-argument

The gain is 0.2 to 0.3 s of a wait of 1.2 to 2.3 s today. The other three findings in this file remove more and have a smaller change. The fix adds a second way to read private data, with four rules that the API path gives automatically (origin, cookie renewal, preview, error shapes). A cheaper step gets a part of the gain: LOAD-11 (immutable assets) removes the 9 revalidation requests that are in the gap.

Against this: after the server-side fixes, the gap is the largest part that remains.

## LOAD-03 · Each D1 round trip costs about 105 to 145 ms from the São Paulo edge, and the Worker has no placement setting

Verdict: **confirmed**. Severity: **high**.

### 1. Hot path

- `apps/web/wrangler.jsonc:46-123`: `env.production` has no `placement` key. The top level has none.
- Production is built with `CLOUDFLARE_ENV: production` (`.github/workflows/deploy.yml:74-76`) and deployed from `apps/web/dist/server/wrangler.json` (`deploy.yml:133`).
- Each response in my probe had `colo: GRU` and no `cf-placement` header. The documentation says: "Cloudflare adds a `cf-placement` header to all requests when placement is enabled."
- No source file uses `withSession` (`rg -i withSession apps packages` has no result), so each query goes to the primary.
- How often: each D1 statement or batch of each request. `/api/runs` has 6 round trips, `/api/operations` has 9, each image request has 1.

### 2. Magnitude

Measured: 105 to 145 ms for each round trip (table above). The model agrees with the signed-in numbers: `/api/operations` = 40 ms + schema check 313 to 333 ms + 7 × 105 to 145 ms = 1.09 to 1.39 s. Measured: 1.20 to 1.30 s.

The repository has evidence that the report and the first verifier did not use.

- `apps/web/tooling/backup-v2-recorded/wrangler.example.json:60-62` already has a region hint for a diagnostic Worker:

  ```json
  "placement": {
    "region": "aws:us-east-1"
  }
  ```

- `docs/evidence/backup-restore-v2.json:493-497` records the result on 2026-09-22: `"placement": "remote-IAD"`, `"ray": "a3eeb3ff595b5a8d-CWB"`. A request that entered at Curitiba ran near Ashburn. So the region hint works on this account.
- `docs/evidence/v3-small/receipts/seed-summary.json:20-28` records one query of that Worker: `"milliseconds": 15`, `"served_by_region": "ENAM"`, `"served_by_colo": "EWR"`, `"served_by_primary": true`, `"sql_duration_ms": 0.1103`. Lines 41-42 of the same file record `"colo": "CWB"` and `"placement": "remote-IAD"`.
- The same evidence file states its own limit (`docs/evidence/backup-restore-v2.json:505`): "The 30 timing responses did not preserve response placement headers. Later health proof shows remote-IAD; the before/after timing comparison is not randomized and does not establish a sole cause." I use it only as proof that the hint was applied.
- `node second-lens-1/placed-d1-wall.mjs` reads all 316 recorded queries in that directory. Wall time minus SQL time: minimum 10.9 ms, median 16.5 ms, 90th percentile 32.3 ms. All were served by `EWR`. For each file the median is 12 to 18 ms.

So a Worker near Ashburn paid about 12 to 18 ms for one round trip to a D1 primary in Newark. From `GRU` the cost is 105 to 145 ms.

Limits of this evidence: the recorded databases are the disposable drill databases of 2026-09-22, not the production database `visonaut` (`3c0b122f-…`). Only 3 of the 316 queries are in a file that also records `remote-IAD`. The region of the production database is still not read. The documentation says: "D1 will automatically create your primary database instance in a location close to where you issued the request to create a database" and "D1 databases do not run in" South America. The measured 105 to 145 ms fits a primary in eastern North America. This is an inference.

Estimate with placement. `H` is the one long hop from `GRU` to the Worker. I assume `H` is about 105 to 145 ms, the same as one round trip today. Near round trip: 15 ms.

| State                           | `/api/runs` (6 round trips)      | `/api/operations` (9 round trips) | Document `/`   |
| ------------------------------- | -------------------------------- | --------------------------------- | -------------- |
| Today, measured                 | 0.87 to 1.08 s (4 of 5 samples)  | 1.20 to 1.30 s                    | 0.05 s         |
| LOAD-01 only, estimate          | 0.53 to 0.76 s                   | 0.87 to 0.99 s                    | 0.05 s         |
| Placement only, estimate        | 40 + H + 6 × 15 = 0.24 to 0.28 s | 40 + H + 9 × 15 = 0.28 to 0.32 s  | 0.16 to 0.20 s |
| Placement and LOAD-01, estimate | 0.21 to 0.25 s                   | 0.25 to 0.29 s                    | 0.16 to 0.20 s |

For one dashboard load, placement removes about 1.5 to 1.9 s of the two private reads and adds about 0.12 s to the document. Estimate.

### 3. Fix feasibility

- Wrangler 4.136.1 accepts `{ "mode": "smart" }`, `{ "region": … }`, `{ "host": … }`, and `{ "hostname": … }` (`node_modules/wrangler/config-schema.json:261-330`).
- The Cloudflare Vite plugin keeps the key. Its list of removed keys (`@cloudflare/vite-plugin/dist/index.mjs:65064-65090`) does not contain `placement`, so the key reaches `dist/server/wrangler.json`.
- The region format is documented: `"aws:us-east-1"`, `"gcp:us-east4"`, `"azure:westeurope"`. "Cloudflare maps your specified cloud region to the data center with the lowest latency to that region."
- The documentation recommends hints when "Your Worker connects to a single database, API, or service" and when "Your infrastructure is single-homed". That describes this Worker.
- Smart Placement does consider D1: "Workers has Smart Placement to dynamically run your Worker in the best location to reduce total Worker request latency, considering everything your Worker talks to, including D1."

What can go wrong:

1. **Smart mode can stay inactive.** "Smart Placement requires consistent traffic to the Worker from multiple locations to make a placement decision." The status `INSUFFICIENT_INVOCATIONS` means "The Worker has not received enough requests from multiple locations". Also: "Smart Placement only considers locations where the Worker has previously run." This Worker has a small number of human users. I cannot tell from the repository if the traffic is sufficient. A region hint does not have this condition.
2. **A region hint needs the location of the primary.** Each D1 result has it. `@cloudflare/workers-types/index.d.ts:14532-14542` documents `meta.served_by_region` and `meta.served_by_colo` ("The three letters airport code of the colo that executed the query"). One logged production query gives the value. No dashboard is necessary.
3. **Requests with no D1 work become slower for a user in Brazil.** The document and `/health` get one long hop (about 0.12 s). The documentation confirms that this does not apply to assets: "Static assets are always served from the location nearest to the incoming request."
4. **The location is fixed for all users.** A maintainer near the primary gets no change. A maintainer on a different continent gets the same trade as Brazil.
5. **Queue and cron work do not change.** "Placement only affects the execution of fetch event handlers."
6. **Smart mode keeps a baseline.** "By default, 1% of requests are not routed with Smart Placement".

Read replication is not an alternative for a user in Brazil. Replicas exist only in "ENAM, WNAM, WEUR, EEUR, APAC, OC", and they need the Sessions API. A replica can also lag, which conflicts with "Live session and linked-account checks" (`docs/current-contract.md:186`).

Security contract: no change. `docs/current-contract.md:188` says: "Standard Wrangler deployment owns declared bindings, routes, consumers, cron, and observability." A `placement` key is declared configuration. The same paragraph says: "No hosted diagnostic run is authorized by this contract." A before and after measurement in production needs the maintainer.

### 4. Strongest counter-argument

Placement treats the symptom. The cause is the number of serial round trips. If LOAD-01 and LOAD-04 decrease each private read to 3 round trips, placement saves about 2 × 0.12 s for each private read and costs 0.12 s on each request with no D1 work. The net gain is then small for the dashboard. The count of round trips has no trade-off and helps each user in each location.

Against this: the run page read takes 5.3 to 5.7 s on the server, and Approve and Reject do more round trips than a read. Placement helps each of them with no code change, and the repository already has a recorded result for the same hint.

## LOAD-05 · Each header navigation click reloads the whole document

Verdict: **confirmed**. Severity: **high**.

The finding is correct. The recommended code is not correct as written.

### 1. Hot path

- `apps/web/src/components/app-shell.tsx:15-19`: the three links have plain `href` values. `:53-58`: `<NavLink key={id} href={href} …>`. `:29`: `render={<a href="/" />}` for the logo.
- `apps/web/src/components/ariakit/components/nav.ariakit.react.tsx:600-606`: `NavLink` renders `ak.Role.a`. TanStack Router does not intercept a plain anchor.
- `AppHeader` is on each page: `routes/index.tsx:249`, `routes/runs.$runId.tsx:58`, `routes/pulls.$pullNumber.tsx:152`, `review/review-workspace.tsx:535`.
- How often: each click on one of the 3 header links or the logo. These are the main navigation of the app.
- Measured by the auditor and the first verifier (`audit/load/verify/nav-reload.rerun.txt`): each header click gives `documentLoads: 1`. The in-page `View history` link gives `documentLoads: 0, apiRunsRequests: 0`.

### 2. Magnitude

One header click costs one complete dashboard load. For the signed-in maintainer that is 1.2 to 2.3 s to the queue and 2.6 to 3.7 s to a stable page (orchestrator, 5 samples).

With a router link:

| Click                | Requests today                                                  | Requests with a router link                                                    |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Queue ↔ history      | Document, 9 asset revalidations, `/api/runs`, `/api/operations` | 0. The two views use the same data (`routes/index.tsx:365-373`).               |
| To service status    | The same                                                        | `/api/operations` only (1.2 to 1.3 s server wait)                              |
| Run page → dashboard | The same                                                        | `/api/runs` only. The document and hydration time (0.20 to 0.30 s) is removed. |

After LOAD-01, LOAD-03, and LOAD-04, one complete load becomes shorter, so each click costs less. The number of unnecessary requests does not change.

### 3. Fix feasibility

The pattern is in use. `apps/web/src/review/review-workspace.tsx:733-760` and `apps/web/src/review/item-list.tsx:197-214` render `NavLink` with `render={<Link … />}`.

Three corrections.

**1. The recommended code marks two links as the current page.** The report recommends:

```tsx
render={<Link to="/" search={view ? { view } : {}} />}
```

The installed `Link` computes its own active state. `@tanstack/react-router/dist/esm/link.js:34-43` compares the search with a partial match when `activeOptions.exact` is not set:

```js
if (
  !deepEqual(location.search, next.search, !activeOptions?.exact, activeOptions?.explicitUndefined)
)
  return false;
```

An empty search is a partial match of each search. Then `link.js:221-224` writes `aria-current`, and it writes it after the props of the caller:

```js
if (isActive) {
  props["data-status"] = "active";
  props["aria-current"] = "page";
}
```

Measured with the installed packages (`node second-lens-1/link-active.cjs`, default options):

```json
{
  "url": "/?view=history",
  "links": {
    "queue": { "href": "/", "ariaCurrent": "page" },
    "history": { "href": "/?view=history", "ariaCurrent": "page" },
    "service": { "href": "/?view=service", "ariaCurrent": null }
  }
}
```

With `activeOptions={{ exact: true }}`:

```json
{
  "url": "/?view=history",
  "links": {
    "queue": { "href": "/", "ariaCurrent": null },
    "history": { "href": "/?view=history", "ariaCurrent": "page" },
    "service": { "href": "/?view=service", "ariaCurrent": null }
  }
}
```

The first verifier wrote that `aria-current` "is not a problem", because `AppHeader` passes it. It is a problem: the `Link` value replaces an `undefined` from `AppHeader`. The code that gives the correct result:

```tsx
<NavLink
  key={id}
  render={<Link to="/" search={view ? { view } : {}} activeOptions={{ exact: true }} />}
  aria-label={label}
  aria-current={active === id ? "page" : undefined}
>
```

**2. The run page loses its prompt for decisions that are not sent.** `apps/web/src/review/use-review-session.ts:175-184` adds a `beforeunload` listener while a decision is being sent and is not yet durable. Today a header click on the run page is a document navigation, so the browser shows the prompt. A router navigation does not fire `beforeunload`. The workspace then unmounts, and the cleanup at `:168-173` aborts the queued browser requests. The contract says: "Unsent decisions still require the browser." (`docs/current-contract.md:196`). Two options exist in the installed router: `useBlocker` in the review session, or `reloadDocument` on the header links of the run page. Note: browser Back from a run to the dashboard is already a router navigation with no prompt, so this gap exists today in one path. The change would add four more exits.

**3. The reload is the refresh today.** The dashboard data is in component state (LOAD-06). A click on the current header link reloads the data. With a router link it does nothing. Only the `Refresh runs` button and the 60-second alert poll then update the page.

Security contract: no change. The server checks are the same. Private data stays on screen across a view change, which is already true for the in-page `View history` link and for an open tab.

### 4. Strongest counter-argument

The full reload is simple and always shows new data. It also gives the unsaved-decision prompt on the run page with no router code. The correct fix is not one line: it needs the `exact` option, a decision for the run page, and a way to refresh. After the server-side fixes, one complete load can be about 0.5 s (estimate), so the cost of each click becomes small.

Against this: the queue and the history show the same data, so the read on each click has no use, and this is the main navigation of the app.

## Missed by the report and the first verification

- **LOAD-05 fix:** the recommended `Link` gives two links with `aria-current="page"` on `/?view=history` and `/?view=service`. Measured. `activeOptions={{ exact: true }}` corrects it.
- **LOAD-05 fix:** a router link in the header removes the `beforeunload` prompt for unsent decisions on the run page (`use-review-session.ts:175-184`).
- **LOAD-02 fix:** server-rendered rows give a hydration mismatch, because `runDate` uses `toLocaleString(undefined, …)` (`routes/index.tsx:153-157`).
- **LOAD-02 fix:** a streamed read cannot send the daily session `Set-Cookie`. The `disableRefresh` query option exists for this.
- **LOAD-02 fix:** the document path has no origin check, and production has `workers_dev: true`.
- **LOAD-03 evidence:** the repository already records a region hint (`aws:us-east-1` → `remote-IAD`), a D1 primary in `EWR`, and 12 to 18 ms for one near round trip (`docs/evidence/v3-small/receipts/`, `docs/evidence/backup-restore-v2.json:493-505`).
- **LOAD-03 fix:** `meta.served_by_colo` gives the location of the production primary from one query.
- **LOAD-01 scope:** the check also runs for each Approve and Reject request.
- **LOAD-01 cause:** Better Auth 1.7.3 added the check with the assumption of one instance for each process. The options page of Better Auth states a default that differs from the installed code.

## Limits

- No signed-in production request was made by me. The signed-in numbers are from the orchestrator.
- All production samples are from one machine near São Paulo on one day.
- The region of the production D1 database is not read. The near round-trip cost comes from recorded receipts of different databases on the same account.
- No fix was built. The `Link` behavior is the only fix detail that I ran.
- Web pages were read through a summary tool. I quoted only text that the tool returned as exact quotes. The upstream issue and pull requests of Better Auth were not reproduced.

## Sources

- Cloudflare Workers placement: https://developers.cloudflare.com/workers/configuration/placement/
- Placement hints changelog (2026-01-22): https://developers.cloudflare.com/changelog/post/2026-01-22-explicit-placement-hints/
- Cloudflare storage options (Smart Placement and D1): https://developers.cloudflare.com/workers/platform/storage-options/
- D1 data location: https://developers.cloudflare.com/d1/configuration/data-location/
- D1 read replication: https://developers.cloudflare.com/d1/best-practices/read-replication/
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- D1 database API (`batch`, `withSession`): https://developers.cloudflare.com/d1/worker-api/d1-database/
- D1 metrics: https://developers.cloudflare.com/d1/observability/metrics-analytics/
- Better Auth database (schema validation): https://better-auth.com/docs/concepts/database
- Better Auth options: https://www.better-auth.com/docs/reference/options
- Better Auth pull request 11178 (schema check on initialization): https://github.com/better-auth/better-auth/pull/11178
- Better Auth issue 11346 and pull request 11366 (D1): https://github.com/better-auth/better-auth/issues/11346 , https://github.com/better-auth/better-auth/pull/11366
- TanStack Router deferred data loading: https://tanstack.com/router/latest/docs/framework/react/guide/deferred-data-loading
- TanStack Start selective SSR: https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr
- TanStack Start execution model: https://tanstack.com/start/latest/docs/framework/react/guide/execution-model
- GitHub REST API troubleshooting (timeouts): https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api
- GitHub installation access tokens: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
