# Second-lens check: INFRA-01, INFRA-02, FE-01, FE-02

Date: 2026-10-05. Source: worktree `serialized-dazzling-pixel` at `f83fef6`. Read-only.
Lens: platform facts, real impact, and fix feasibility. The first verifier already checked that the cited code exists.

Inputs. The files `infra/report.md`, `frontend-perf/report.md`, and the two `verification.md` files do not exist. I used the recovered copies and the raw outputs of the first verifier:

- `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/infra/verify/recovered-report.md`
- `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/frontend-perf/verify/recovered-report.md`
- `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/infra/verify/ttfb-rerun.txt`
- `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/live/auth-cost-*.txt`
- `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/live-authenticated.md` (the only signed-in production data)

My scratch files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-7/`.

## Summary

| ID       | Verdict          | Severity | One line                                                                                                                                                                                           |
| -------- | ---------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INFRA-01 | confirmed        | high     | The schema check costs 0.31 s for each auth request from GRU (my measurement). It is about 23% to 31% of each signed-in dashboard API call. The fix is one supported option.                       |
| INFRA-02 | partly confirmed | high     | The D1 part is confirmed: one D1 round trip costs about 0.126 s from GRU. The GitHub part is not supported. The D1 region is not verified. The fix moves the HTML shell away from the visitor too. |
| FE-01    | partly confirmed | medium   | The mechanism is real. For the signed-in maintainer it is about 0.2 to 0.3 s of a 1.2 to 2.3 s wait. The main recommendation (a server loader) blocks the first byte unless the data is deferred.  |
| FE-02    | partly confirmed | low      | The mechanism is real. For real runs it is at most about 0.25 s of a 6.7 to 7.8 s wait. The model request (5.3 to 5.7 s, 5 to 6 MB) is the cost.                                                   |

The four findings are not equal. Measured on the real signed-in path, the order of cost is: D1 distance (INFRA-02) and the schema check (INFRA-01) first, then the request order (FE-01, FE-02).

## Measurements that I ran

The raw outputs of the three scripts are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-7/raw-output.txt`.

### M-A. One D1 round trip and the schema check, production, one reused connection

Command: `node /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-7/prod-roundtrips.mjs 10`
The script sends anonymous GET requests with Node `fetch` on one kept-alive connection. It discards one warm-up request. It records the time to response headers. 41 requests in total. Time: 2026-10-05T20:31:43Z.

| Path                                           | D1 work (from code)                                            | Status | Min (ms) | Median (ms) | Max (ms) |
| ---------------------------------------------- | -------------------------------------------------------------- | ------ | -------: | ----------: | -------: |
| `/health`                                      | none (`apps/web/src/server.ts:60-71`)                          | 200    |     27.0 |        35.4 |    100.0 |
| `/images/00000000-0000-4000-8000-000000000000` | 1 query, no auth instance (`apps/web/src/api/images.ts:24-36`) | 404    |    152.9 |       161.4 |    174.5 |
| `/api/me`, no cookie                           | schema check only (2 round trips)                              | 401    |    336.0 |       344.3 |    352.7 |
| `/api/runs`, no cookie                         | schema check only (2 round trips)                              | 401    |    344.6 |       355.6 |    438.7 |

Raw facts from the same run: all 41 responses have `cf-ray: …-GRU`. No response has a `cf-placement` header.

Derived values (subtraction of medians):

- One D1 round trip from GRU: 161.4 − 35.4 = **126 ms**.
- The schema check: 344.3 − 35.4 = **309 ms**. This is 2 round trips (252 ms) plus about 57 ms. The 57 ms is the 75-statement batch and the auth construction. The split is an estimate.

Limits: one location, one day, anonymous only, 10 samples for each path. The subtraction assumes that the paths differ only in D1 work.

### M-B. GitHub REST latency from this machine

Command: `node /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-7/github-latency.mjs 6`
Unauthenticated `GET https://api.github.com/user/583231` (the same endpoint shape as `packages/security/src/github.ts:251`).

```
warm-up with connection setup: 327.7 ms
reused connection, 6 samples:   28.8, 26.5, 111.1, 24.3, 25.1, 24.0 ms (median 26.5)
```

Limits: this is a home network in São Paulo, not the Worker in GRU. The request has no token. It shows only that GitHub has a near entry point for this region.

### M-C. Cost of the GitHub App JWT (RS256, 2048-bit key)

Command: `node /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-7/rsa-sign.mjs`
The script runs the same `importPKCS8` and `SignJWT` calls as `packages/security/src/github.ts:29-42` with `jose` 6.2.12.

```
importPKCS8 + RS256 sign: first 2.99 ms, median 0.78 ms, p95 0.93 ms (60 runs)
SHA-256 of the private key (createGitHubClient): median 0.015 ms
```

Limits: Node 24 (OpenSSL), not workerd (BoringSSL). No official Cloudflare number exists for this. The order of magnitude is about 1 ms. It is not a cause of the slow pages.

### M-D. Signed-in production data (not mine; from `live-authenticated.md`)

The orchestrator recorded these in the maintainer's own browser session. I only did arithmetic on them.

| Value                                        | Samples (ms)                 | Median |
| -------------------------------------------- | ---------------------------- | -----: |
| `/api/runs` server wait                      | 1967, 992, 1077, 942, 865    |    992 |
| `/api/operations` server wait                | 1299, 1204, 1284, 1249, 1216 |   1249 |
| `/api/runs` start minus document TTFB        | 232, 240, 199, 200, 303      |    232 |
| `/api/runs` response end                     | 2290, 1353, 1318, 1220, 1461 |   1353 |
| `/api/operations` response end (page stable) | 3663, 2638, 2678, 2721, 2744 |   2721 |
| `/api/runs/<id>` start (run page)            | 300, 206, 233                |    233 |
| `/api/runs/<id>` server wait                 | 5416, 5680, 5251             |   5416 |
| Run content visible                          | 7456, 7756, 6676             |   7456 |

A model from the code agrees with these numbers. For signed-in `GET /api/runs` the sequential D1 work is: schema check (309 ms), `session` select, `user` select, `account` select, and the dashboard batch (4 × 126 ms = 504 ms). With the 35 ms base, the total is about 0.85 s. The measured values are 0.87 to 1.08 s in 4 of 5 samples. So the server wait of the dashboard is almost only D1 round trips.

## INFRA-01 · Each request that uses auth runs a full schema check against D1 first

Verdict: **confirmed**. Severity: **high**. Confidence: high.

### 1. Hot path

Verified from code. Production takes this path because `env.production.vars.VISONAUT_ENVIRONMENT` is `"production"` (`apps/web/wrangler.jsonc:51`), so the preview branch at `apps/web/src/server.ts:73-80` does not run.

- `createAuth` has 3 call sites, and each runs for each request: `apps/web/src/server.ts:85` (`/api/auth/*`), `apps/web/src/server.ts:93` (`/api/me`), `apps/web/src/api/index.ts:130` (all other `/api/*` and all `/v1/*` paths).
- `packages/security/src/auth.ts:21-53` does not set `advanced.database.validateSchema`.
- Installed `@better-auth/core@1.7.5`, `dist/db/schema-check.mjs:7-9`: `return options.advanced?.database?.validateSchema !== false;`
- Installed `better-auth@1.7.5`, `dist/auth/base.mjs:15`: `const pendingSchemaCheck = ctx.checkSchema?.();` runs when the instance is made. `dist/api/to-auth-endpoints.mjs:41-42` and `dist/api/index.mjs:169-170` await the same check before each `auth.api.*` call and each handler request.
- The verdict is kept in a closure for each adapter instance (`schema-check.mjs:58`, `let clean = false;`). A new instance for each request starts with an empty verdict.
- The check for D1 is one `sqlite_master` select and one `batch()` with one `pragma_table_info` statement for each table (`@better-auth/kysely-adapter@1.7.5`, `dist/d1-sqlite-dialect-D4qp4-wW.mjs:89-98`).

How often:

| User action                       | Requests that pay the check                                                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed-in dashboard load          | 2: `/api/runs`, then `/api/operations` (`apps/web/src/routes/index.tsx:180`, `apps/web/src/components/operations-attention/index.tsx:233`). Then 1 more each 60 s (`:280`). |
| Run page load                     | 1: `/api/runs/<id>`                                                                                                                                                         |
| Each Approve or Reject            | 1 for the command, plus 1 for each receipt poll (`apps/web/src/review/client.ts:328-335`)                                                                                   |
| Sign-in and sign-out              | each `/api/auth/*` request                                                                                                                                                  |
| Each CLI upload request (`/v1/*`) | 1 in the background, not awaited (`apps/web/src/api/index.ts:130` is above the `/v1/*` branches)                                                                            |
| Images (`/images/*`)              | none (`apps/web/src/api/index.ts:113-116` returns before `createAuth`)                                                                                                      |

### 2. Magnitude

- Measured (M-A): **309 ms** for each request from GRU. The first verifier got about 0.40 s with a new TLS connection for each request (`infra/verify/ttfb-rerun.txt`). The auditor got 0.31 s. The three results agree.
- Share of the real signed-in wait (M-D): 309 of 992 ms for `/api/runs` (31%). 309 of 1,249 ms for `/api/operations` (25%). About 0.62 s of the 2.72 s until the dashboard is stable (23%).
- It is added to each review decision. The contract accepted a 10-second permission cache "for faster reviews" (`docs/current-contract.md:204`). Each decision request still pays this 0.31 s.
- The cost depends on the distance between the Worker and D1. It is 2 round trips. From GRU that is 0.31 s. For a Worker near the database it is much less (not measured). GitHub Actions upload requests probably enter Cloudflare in North America, so the upload path pays less time. That is an assumption.
- D1 load: D1 "is inherently single-threaded, and processes queries one at a time" ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)). Each request adds 76 statements. For a capture with thousands of upload requests this is real extra load. I did not measure it.
- Money: not a factor at this traffic.

### 3. Fix feasibility

The recommended fix exists in the installed version and is the documented switch.

- Type, `@better-auth/core@1.7.5`, `dist/types/init-options.d.mts:390-400`: "Set `false` to disable runtime schema validation." and `@default true`.
- Docs: "Set `advanced.database.validateSchema` to `false` to disable runtime validation" and "Kysely reads live database metadata and needs database access during initialization" ([Better Auth database, schema validation](https://better-auth.com/docs/concepts/database#schema-validation)). The quotes are as my fetch tool returned them.
- Code path with `false`: `checksSchema` returns false, so `registerSchemaCheck` does not run (`kysely-adapter dist/index.mjs:712`), `ctx.checkSchema` is undefined, and the three call sites do nothing. The live lane measured 0 D1 statements for a request with no session and 2 (`session`, `user`) for a valid session (`live/auth-cost-guest-no-validate.txt`, `live/auth-cost-session-no-validate.txt`).

```ts
// packages/security/src/auth.ts
advanced: {
  cookiePrefix: `visonaut-${configuration.environment}`,
  useSecureCookies: configuration.environment !== "local",
  defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
  database: { validateSchema: false },
},
```

What can go wrong:

- Today a schema mismatch makes each auth request fail at once with a clear message. Without the check, a missing column fails only when a query uses it. Both fail closed (HTTP 503 through `privateFailure`, `apps/web/src/server.ts:34-53`).
- `packages/security/test/auth-d1.test.ts:35` calls `createAuth` against the real migrations. With the default check on, this test also proves that the migrations match Better Auth 1.7.5. If `createAuth` always passes `false`, that proof is lost without a visible change. Keep one test that makes an instance with the check on.
- The deploy applies migrations before it deploys code (`.github/workflows/deploy.yml:125-133`). That order is the guard that stays.

Security contract: no change. `docs/current-contract.md:186` requires "Live session and linked-account checks still run for every request." The fix does not touch `auth.api.getSession` or the `account` select (`packages/security/src/authorization.ts:32-47`). It also keeps the rule in `packages/security/README.md:5` ("Construct Better Auth inside each production Worker request").

The alternative (one cached auth instance for each isolate) is weaker. It contradicts `packages/security/README.md:5`. With the check still on, a second request can await the check promise that the first request started (`schema-check.mjs:68`, `verdict ??= Promise.resolve().then(find)`). Workers state that I/O objects "created in the context of one request handler cannot be accessed from a different request's handler" ([Workers errors](https://developers.cloudflare.com/workers/observability/errors/)). I did not test whether this case fails in workerd. The alternative also saves almost no CPU: construction costs 0.083 ms median after the first instance (`load/auth-init-cpu.json`).

### 4. Strongest counter-argument

The check is a safety net for a Better Auth upgrade that needs a schema change. If INFRA-02 puts the Worker near D1, the same check costs only 2 short round trips, and the maintainer can keep the net. The answer to this: migrations run before deploy, the test can keep the check, and the fix is one line that does not depend on a placement decision.

## INFRA-02 · The Worker has no placement setting, so each D1 query and GitHub call is a long round trip

Verdict: **partly confirmed**. Severity: **high** for the D1 part. Confidence: medium.

- Confirmed: no placement, the Worker runs in GRU, and one D1 round trip costs about 126 ms there.
- Not supported: "each GitHub call is a long round trip".
- Not verified: the D1 region, and the size of the gain.

### 1. Hot path

- `apps/web/wrangler.jsonc:1-125` has no `placement` key (I read the whole file). My 41 production responses have `cf-ray: …-GRU` and no `cf-placement` header (M-A).
- Each signed-in API request makes these D1 calls one after the other, counted from code:

| Request               | Sequential D1 round trips before the response                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/runs`       | schema check (2), `session`, `user`, `account`, dashboard batch (`apps/web/src/api/dashboard.ts:68`) = 6                                                   |
| `GET /api/operations` | project (`apps/web/src/api/index.ts:124-126`), schema check (2), `session`, `user`, `account`, then the status queries = 6 or more                         |
| `GET /api/runs/<id>`  | project, schema check (2), `session`, `user`, `account`, run, then at least 2 waves of parallel queries (`apps/web/src/api/review.ts:232-365`) = 9 or more |

- `session` and `user` are 2 separate round trips because `advanced.database.joins` is off (`better-auth dist/db/internal-adapter.mjs:343-350`, `join: { user: true }`; `@better-auth/core dist/db/adapter/factory.mjs:562`).
- GitHub calls happen only when the permission cache for the isolate is cold: 0 to 3 calls (`packages/security/src/authorization.ts:60-73`, `packages/security/src/github.ts:133-141`, `:231-256`). The caches are module-level maps, so a new isolate starts cold.

### 2. Magnitude

- D1 from GRU: **126 ms for each round trip** (M-A). Cloudflare states the cause: "D1 request latency is dependent on the physical proximity of a user to the primary database instance" ([D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/)) and cross-region requests are where "network latency is an outsized latency factor" ([D1 changelog, 2025-01-07](https://developers.cloudflare.com/changelog/post/2025-01-07-d1-faster-query/)). No official page gives a latency number for D1.
- D1 has no South America location: "D1 location hints are not currently supported for South America (`sam`), Africa (`afr`), and the Middle East (`me`)" ([D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/)).
- The D1 region is not verified. 126 ms agrees with eastern North America (ENAM) and not with Europe or western North America. That is an inference from the latency. `wrangler d1 info visonaut` gives the fact.
- Estimate for `/api/runs`, signed-in: the D1 wait today is about 0.81 s (309 + 4 × 126 ms). With the Worker near D1 it becomes one hop from GRU (about 0.11 to 0.13 s, inferred) plus 6 short calls. If a short call is 5 to 20 ms (assumption, not measured), the total is 0.15 to 0.25 s. The gain is about 0.55 to 0.65 s. After INFRA-01 the gain is about 0.30 to 0.36 s. For `/api/runs/<id>` the gain is larger because it has more round trips.
- GitHub: my local measurement (M-B) shows about 25 ms for one call on a warm connection and 328 ms with connection setup. This is not from the Worker. It does not support "each GitHub call is a long round trip" as a distance problem. One signed-in sample was 1,967 ms against a median of 992 ms. A cold permission cache (2 to 3 GitHub calls) can explain that, but the data does not prove it.
- The JWT signature is about 1 ms (M-C).

### 3. Fix feasibility

The API exists in the installed version.

- `node_modules/wrangler/config-schema.json:261-333` (wrangler 4.136.1) accepts `{ "mode": "smart" }`, `{ "region": string }`, `{ "host": string }`, and `{ "hostname": string }`.
- `placement` is an inheritable key, so it can be set only inside `env.production` (`@cloudflare/vite-plugin@1.57.1 dist/index.mjs:42468-42472`, `inheritable(..., "placement", ...)`).
- The build copies it into the deploy config: `getOutputConfig` spreads the input config (`dist/index.mjs:86597-86598`, `...inputWorkerConfig`). I read the code. I did not run a build.
- Docs ([Workers placement](https://developers.cloudflare.com/workers/configuration/placement/), [changelog 2026-01-22](https://developers.cloudflare.com/changelog/post/2026-01-22-explicit-placement-hints/)):
  - "Placement only affects the execution of fetch event handlers." The queue consumer and the cron handler do not move.
  - "Static assets are always served from the location nearest to the incoming request." The CSS and JS stay at the edge.
  - Region format: `{provider}:{region}`, for example `aws:us-east-1`.
  - "Smart Placement requires consistent traffic to the Worker from multiple locations to make a placement decision."
  - `cf-placement` shows the result: `remote-LHR` or `local-EWR`.

```jsonc
// apps/web/wrangler.jsonc, inside env.production
"placement": { "mode": "smart" }            // Cloudflare decides from measured duration
// or
"placement": { "region": "aws:us-east-1" }  // fixed; correct only if D1 is in ENAM
```

What can go wrong:

- The region hint names a cloud provider region. There is no hint that means "near my D1 database". `aws:us-east-1` is a stand-in for ENAM. If the database is in a different region, the hint makes each request slower.
- The whole fetch handler moves. The HTML shell has no D1 work today and has a warm TTFB of 41 to 119 ms (M-D). With placement it pays one hop: about 0.11 to 0.13 s more for a visitor in Brazil. The same is true for `/health`. To keep the shell at the edge you need two Workers and a service binding, which is a larger change.
- Smart Placement can stay undecided. The placement status then reads `INSUFFICIENT_INVOCATIONS`. Cloudflare wrote in 2024 that Smart Placement considers "everything your Worker talks to, including D1" ([D1 blog](https://blog.cloudflare.com/building-d1-a-global-database/)); the current placement page does not say it.
- Deploy guards: the guard for the normal deploy reads only the name and two variables of the generated config (`.github/workflows/scripts/deploy-source.mjs:22-27`). It does not reject a new key. I did not read each guard of the manual `preview-web` and `production-fence` paths.

Security contract: no change. Placement changes where the code runs, not what it checks. One alternative in the finding does touch the contract: "a signed short-lived permission cookie". If such a cookie replaced the session or linked-account check, it would break `docs/current-contract.md:186` ("Live session and linked-account checks still run for every request"). A cookie that caches only the GitHub permission for 60 s is inside the contract.

A smaller code option that the finding does not name: `advanced.database.joins: true`. The Kysely adapter has native joins (`kysely-adapter dist/index.mjs:516`, `query.leftJoin(...)`), so `session` and `user` become one query. That removes one round trip (about 126 ms from GRU) from each signed-in request. I did not test it on D1.

### 4. Strongest counter-argument

The gain is an estimate and the database region is unknown. The change also makes the first HTML byte slower for the only measured user. Code changes give a large part of the gain with no platform change: INFRA-01 removes 0.31 s, joins remove about 0.13 s, and one query for `account` with the session removes about 0.13 s more. After those, `/api/runs` has about 2 round trips left (about 0.25 s), and placement would save only about 0.1 s there. The answer to this: `/api/runs/<id>` and `/api/operations` keep many round trips, and placement is the only option that changes all of them at once.

## FE-01 · The dashboard requests its data only after JavaScript loads and hydrates

Verdict: **partly confirmed**. Severity: **medium**. Confidence: high for the mechanism, medium for the size.

### 1. Hot path

Verified. In production `GET /` reaches `render(request)` (`apps/web/src/server.ts:118`). The route has no loader (`apps/web/src/routes/index.tsx:39-44`). The component starts in `{ status: "loading" }` (`:161`) and calls `fetch("/api/runs")` in `useEffect` (`:176-184`). The captured production HTML contains `Checking access and loading runs` and 8 `modulepreload` links, and no data (`frontend-perf/prod-root.decoded.html`). This runs one time for each document load of `/`, `/?view=history`, and `/?view=service`, and again for each client navigation back to `/`.

### 2. Magnitude

- The numbers in the finding are correct for what they measured: a local build with an API that answers in 3 ms, and an anonymous production visit.
- For the signed-in maintainer (M-D): the request starts 199 to 303 ms after the first HTML byte (median 232 ms). The server then takes 865 to 1,967 ms. So the JavaScript wait is about **17% of the time to the queue** (232 of 1,353 ms). The other 83% is server time (INFRA-01, INFRA-02).
- The best possible gain from an earlier request is the same 0.2 to 0.3 s with a warm cache. The finding's synthetic profile (150 ms, 9 Mbps, cold cache) gives about 0.4 s. I did not measure a gain.
- If INFRA-01 and INFRA-02 make the API answer in 0.2 to 0.3 s, this finding becomes about half of the remaining wait. Its weight grows after the server fixes.

### 3. Fix feasibility

Main recommendation (server function plus route loader). The APIs exist:

- `createServerFn` is in `@tanstack/start-client-core@1.170.32` (`dist/esm/createServerFn.js`), and `getRequest` is in `@tanstack/start-server-core@1.169.37` (`dist/esm/request-response.d.ts:8`).
- The app's own handler can pass `env` to a server function: `RequestHandler` accepts `(request, opts)` with `context` (`dist/esm/request-handler.d.ts`), and the docs show `handler.fetch(request, { context: … })` ([server entry point](https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point)).
- Server function requests get a default CSRF middleware, because the app has no `src/start.ts` (`dist/esm/createStartHandler.js:302`, `isServerFnRequest ? [defaultCsrfMiddleware] : void 0`).

What can go wrong with the main recommendation:

1. It blocks the first byte. Start awaits the loaders before it renders: `await routerInstance.load({ _signal: signal });` comes before the render callback (`createStartHandler.js:372-390`). With the present server time, the document TTFB changes from 41–119 ms to about 0.9–2.0 s, and the browser cannot start the CSS and JS before that. The loader must return a promise that is not awaited (deferred data), or the server fixes must come first. The finding says this in one sentence. With the signed-in numbers it is the main risk.
2. It adds a second private data path. Today all private reads go through `handleApi`. A server function must repeat: the origin check (`apps/web/src/api/index.ts:110-112`; production also answers on `workers.dev`, and `render` has no origin check), `requireMaintainer` with `access: "read"`, the `Set-Cookie` headers from `identity.sessionHeaders` (`:220-222`), and the preview fixture source (preview has no `DB` binding).
3. It can break the failure contract. `docs/current-contract.md:81` requires HTTP 503 with `error.reference` and one `operation-failed` log for an unexpected failure. A server function that throws gets the Start error format, not this one.
4. Hydration mismatch. `runDate` uses `toLocaleString(undefined, …)` (`apps/web/src/routes/index.tsx:153-157`). The Worker and the browser have different locales and time zones, so server-rendered run dates will not match.
5. This would be the first server function in the app (`rg createServerFn apps/web/src` finds none).

Minimal alternative (start the request from the document head). It needs no new API and has a precedent: `sidebarPreferenceScript` is an inline script with the nonce (`apps/web/src/routes/__root.tsx:23-26`). The CSP allows it: `script-src 'self' 'nonce-…'` and `connect-src 'self'` (`packages/security/src/http.ts:40-44`).

```ts
// apps/web/src/routes/__root.tsx (sketch, not run)
const earlyDashboardScript = `(() => {
  if (location.pathname !== "/") return;
  window.__dashboard = fetch("/api/runs", { credentials: "same-origin", cache: "no-store" })
    .then(async (response) => ({
      status: response.status,
      body: response.ok ? await response.json() : null,
    }))
    .catch(() => null);
})();`;
```

`Index` reads `window.__dashboard` one time and uses its own `fetch` when the value is missing (client navigation, Refresh, tests). The promise resolves to plain data, so a second effect run in development does not read a response body twice.

Security contract: the minimal alternative changes nothing, because it calls the same endpoint with the same checks. The server-function path is inside the contract only if it runs the live session and linked-account checks for each request (`docs/current-contract.md:186`) and keeps `Cache-Control: no-store, private` on the HTML (it does: `apps/web/src/server.ts:23-28`).

### 4. Strongest counter-argument

For the real user this is 0.2 to 0.3 s of a wait that is 1.2 to 2.3 s. The server fixes are smaller changes and remove more time. The larger fix (server loader) makes the first paint worse if it is done first. A sensible order is: server first, then the head script, and a server loader only if the result is still not good.

## FE-02 · The run page requests the review model only after the entry JavaScript runs

Verdict: **partly confirmed**. Severity: **low** today. Confidence: high for the mechanism.

### 1. Hot path

Verified. The route has `ssr: false` (`apps/web/src/routes/runs.$runId.tsx:31`) and a client loader that calls `loadReviewModel` (`:37-39`), which requests `/api/runs/<id>` (`apps/web/src/review/client.ts:365-373`). The captured production HTML for a run has `ssr:!1`, `s:"pending"`, and `Checking access and loading this run` (`live/body-prod-run-doc.html`). This runs one time for each document load of a run, and one time for each client navigation to a run.

This design is a selected decision. `docs/current-contract.md:150` lists P03 "Use the existing router loaders". The research for it says that `ssr: false` "is the smallest safe migration" and that server-rendered review data "is a separate increase in scope, not a requirement for P03" (`docs/simplification-audit/evidence/feedback-performance.md:30`).

### 2. Magnitude

- The numbers in the finding come from the preview fixture: 1 item, 2 variants, `data:` images, and an API that answers in 3 ms.
- Real runs (M-D): 626 items and 3,832 variants. The model request starts at 206 to 300 ms. The server wait is 5,251 to 5,680 ms. The body is 5.3 to 6.0 MB (about 692 kB compressed). Content is visible at 6,676 to 7,756 ms.
- The best possible gain from an earlier request is the time between the first HTML byte and the request start: about 0.1 to 0.25 s. That is **at most about 4%** of the time to content. I did not measure a gain.
- The cost is the model request itself and the work after it (about 0.7 to 1.7 s from response end to visible content). Other lanes own those. This finding becomes medium only after the model request is fast.

### 3. Fix feasibility

Recommended fix (start the request from the head, and let the loader use that promise). It is feasible for the same reasons as in FE-01: inline nonce scripts are in use, and the CSP allows a same-origin `fetch`. A client loader on an `ssr: false` route is normal browser code, so it can read `window`. The fallback to `loadReviewModel` keeps the route browser tests working, because the fixtures do not set the early promise.

What can go wrong:

- The script must build the same URL as `loadReviewModel` (`/api/runs/<id>` plus `?comparison=`). The URL rule then exists in two places, one of them a string.
- The early request does not use the loader's `abortController.signal` (`runs.$runId.tsx:37-39`).
- The error path must stay the same as `request()` in `client.ts:254-283` (401 gives the guest state, 403 and 5xx give `ReviewCommandError` with the reference).

Alternative `ssr: "data-only"`. The installed router supports it (`@tanstack/router-core@1.171.32 dist/esm/router.d.ts:42`, `export type SSROption = boolean | 'data-only';`). The docs say it will "Run `loader` on the server and send the loader data to the client" ([selective SSR](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr)). For real runs this puts 5 to 6 MB of model data inside the HTML document, and the first byte waits for the 5.3 to 5.7 s model build. It also needs the server-function path with all the risks listed in FE-01. With the present model size this option is not practical.

Security contract: the recommended fix changes nothing (same endpoint, same checks). It also stays inside P03.

### 4. Strongest counter-argument

The fix can save about 0.2 s of a 7 s wait, and it adds an inline script that copies the URL rule. The same effort on the model endpoint (server time and size) removes seconds. Do this one after the model request is fast, or not at all.

## Items that the four findings do not state

1. **Order matters.** A blocking server loader for the dashboard (FE-01) makes the first byte wait for the access check. With the present server time that is 0.9 to 2.0 s. Do INFRA-01 (and INFRA-02 if selected) first, or defer the data.
2. **Joins option.** `advanced.database.joins: true` can make `session` and `user` one query: one D1 round trip less (about 126 ms from GRU) for each signed-in request. Not tested on D1.
3. **Hidden test coverage.** `packages/security/test/auth-d1.test.ts` is today also the proof that the migrations match Better Auth 1.7.5, because the runtime check is on. `validateSchema: false` removes that proof unless one test keeps the check on.
4. **Placement moves the HTML shell too.** The shell TTFB for a visitor in Brazil grows by one hop (about 0.11 to 0.13 s, inferred). The finding asks the maintainer to accept this but gives no number.
5. **No hint for "near D1".** `placement.region` accepts cloud provider regions only. `aws:us-east-1` is a stand-in for ENAM, and the D1 region is still not verified.
6. **The GitHub part of INFRA-02 has no evidence.** From São Paulo a GitHub REST call takes about 25 ms on a warm connection (local measurement, not from the Worker).
7. **The run page wait is the model request.** 5.3 to 5.7 s of server time and 5 to 6 MB of JSON for real runs. FE-02 does not reduce it.
8. **Server functions and the failure contract.** A server function for private data must keep the origin check, the `Set-Cookie` headers of the session, and the HTTP 503 `error.reference` format of `docs/current-contract.md:81`.
