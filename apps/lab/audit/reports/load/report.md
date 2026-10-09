# Dashboard page load and access-check path

Source state: `f83fef6` (worktree `serialized-dazzling-pixel`). Production serves the same client files as the local `apps/web/dist` (`/assets/index-CXm4JU5N.css`, `/assets/index-MxeSnhFR.js`), so the production measurements below apply to this source.

Words used in this report:

- **Round trip**: one request and its response between two systems. A `database.batch([...])` call is one round trip with many statements.
- **Measured (local)**: counted with the real `handleApi` and `requireMaintainer` code against a Miniflare D1 database. This gives exact counts, not production time.
- **Measured (production)**: anonymous `GET` requests to `https://visonaut.com` from a machine near São Paulo. The Cloudflare location was `GRU` in every response. This lane made no signed-in production request.
- **Orchestrator measurement**: signed-in production numbers from `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/live-authenticated.md`. This lane did not make them.
- **Estimate**: a measured unit cost multiplied by a measured count. Each estimate is labeled.

## How it works (map)

### Request sequence for a signed-in maintainer who opens `https://visonaut.com/`

| #       | From → to             | What                                                                                                                                                                                                                                     | Serial or parallel                 | Blocks the queue paint                                             | Cache                                                                                                                    |
| ------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 1       | Browser → Worker      | `GET /`. `server.ts:118` calls `render(request)`. The route has no loader (`routes/index.tsx:39-44`), so the server makes no D1, GitHub, or R2 call. The HTML contains `Checking access and loading runs…` (`routes/index.tsx:275-279`). | Serial                             | Yes                                                                | `Cache-Control: no-store, private` (`packages/security/src/http.ts:33`). Not cached.                                     |
| 2       | Browser → edge assets | 1 CSS file and 8 JS files for `/`. No Worker call.                                                                                                                                                                                       | Parallel with each other, after #1 | Yes. React must hydrate before the data request starts.            | `public, max-age=0, must-revalidate`. The browser revalidates all 9 files on each document load.                         |
| 3       | Browser → Worker      | `fetch("/api/runs")` from a `useEffect` (`routes/index.tsx:176-184`).                                                                                                                                                                    | Serial, after hydration            | Yes                                                                | Response `no-store, private`. Request `cache: "no-store"`.                                                               |
| 3.1     | Worker → D1           | `select "name", "type", "sql" from "sqlite_master" …` (Better Auth schema check)                                                                                                                                                         | Serial                             | Yes                                                                | The verdict is kept per auth instance. A new instance is made for each request, so the verdict is never reused.          |
| 3.2     | Worker → D1           | Batch of 75 `SELECT * FROM pragma_table_info(?)` (same schema check)                                                                                                                                                                     | Serial                             | Yes                                                                | Same as 3.1                                                                                                              |
| 3.3     | Worker → D1           | `select … from "session" where "token" = ?`                                                                                                                                                                                              | Serial                             | Yes                                                                | None. Cookie cache is off (`auth.ts:45`, `authorization.ts:34`).                                                         |
| 3.4     | Worker → D1           | `select … from "user" where "id" = ?`                                                                                                                                                                                                    | Serial                             | Yes                                                                | None                                                                                                                     |
| 3.5     | Worker → D1           | `SELECT accountId FROM account WHERE userId = ? AND providerId = 'github'` (`authorization.ts:40-43`)                                                                                                                                    | Serial                             | Yes                                                                | None                                                                                                                     |
| 3.6     | Worker → GitHub       | `POST /app/installations/:id/access_tokens`                                                                                                                                                                                              | Serial                             | Yes, when it runs                                                  | In the isolate, until 30 s before token expiry (`github.ts:102-104`, `167`). Runs only when the isolate has no token.    |
| 3.7     | Worker → GitHub       | `GET /user/:id`                                                                                                                                                                                                                          | Serial                             | Yes, when it runs                                                  | In the isolate, no time limit, 128 entries (`github.ts:193-205`). Runs only when the isolate has no login hint.          |
| 3.8     | Worker → GitHub       | `GET /repos/:repo/collaborators/:login/permission`                                                                                                                                                                                       | Serial                             | Yes, when it runs                                                  | In the isolate: 60 s for reads, 10 s for Approve and Reject, never for other writes (`authorization.ts:19-23`, `61-70`). |
| 3.9     | Worker → D1           | One batch of 3 statements: history, actionable runs, project (`api/dashboard.ts:68-81`)                                                                                                                                                  | Serial                             | Yes                                                                | None                                                                                                                     |
| 4       | Browser → Worker      | `fetch("/api/operations")`. `OperationsAttention` mounts only after #3 succeeds (`routes/index.tsx:254-256`).                                                                                                                            | Serial, after #3                   | No for the queue. Yes for the alert bell and for the service view. | `no-store, private`                                                                                                      |
| 4.1–4.9 | Worker → D1           | `SELECT * FROM visonaut_projects WHERE id = ?` (`api/index.ts:124-126`), then 3.1 to 3.5 again, then the 3 statements of `operationsStatus` one at a time (`api/operations.ts:16-18`, `30-36`, `45-47`)                                  | All serial                         | —                                                                  | Permission is reused if #3 ran in the same isolate less than 60 s before.                                                |
| 5       | Browser → Worker      | #4 again, 60 s after each response (`components/operations-attention/index.tsx:280`)                                                                                                                                                     | Repeats                            | No                                                                 | Each poll makes one new GitHub permission call (LOAD-08).                                                                |

R2 is not used on this path.

Order inside the Worker for `/api/runs`: `apiBindings(env)` (`server.ts:112`) → origin check (`api/index.ts:110-112`) → `createAuth` (`api/index.ts:130`) → `createGitHubClient` (`api/index.ts:191`, no network) → `requireMaintainer` with `access: "read"` (`api/index.ts:194-205`) → `handleReview` → `dashboard(context)` (`api/review.ts:732-734`).

### Counts for one dashboard load (measured, local)

| Request                                                        | State                                                    | D1 round trips | D1 statements | GitHub calls |
| -------------------------------------------------------------- | -------------------------------------------------------- | -------------- | ------------- | ------------ |
| `GET /` document                                               | any                                                      | 0              | 0             | 0            |
| `GET /api/runs`                                                | guest, no credential                                     | 2              | 76            | 0            |
| `GET /api/runs`                                                | signed in, new isolate                                   | 6              | 82            | 3            |
| `GET /api/runs`                                                | signed in, permission checked < 60 s ago in this isolate | 6              | 82            | 0            |
| `GET /api/operations`                                          | signed in, 0.3 s after `/api/runs`, same isolate         | 9              | 83            | 0            |
| `GET /api/operations`                                          | each 60 s poll                                           | 9              | 83            | 1            |
| **Total for the page** (`/api/runs` + first `/api/operations`) | new isolate                                              | **15**         | **165**       | **3**        |

152 of the 165 statements (4 of the 15 round trips) are the Better Auth schema check. Raw output: `roundtrips.json`.

### Every wait that the user sees as loading text

| Text                                         | Where                                           | Shown from → until                                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Checking access and loading runs…`          | `routes/index.tsx:275-279`                      | Server HTML → `/api/runs` response. Shown again after each header navigation click (LOAD-05), after browser Back from a run, and after `Refresh runs` (LOAD-06).                            |
| `Checking access and loading this run…`      | `routes/runs.$runId.tsx:66-74`                  | Direct load: server HTML → `/api/runs/:id` response (`ssr: false`, line 31). Client navigation: appears 1,000 ms after the click (LOAD-12).                                                 |
| `Finding this pull request’s visual review…` | `routes/pulls.$pullNumber.tsx:179-183`          | Server HTML → `/api/pulls/:n` response. Then the page navigates to `/runs/:id` (lines 80-84) and the run text above starts. Two private reads in sequence, each with the full access check. |
| `Checking for unresolved operation alerts…`  | `components/operations-attention/index.tsx:345` | After `/api/runs` → `/api/operations` response (service view and bell popover)                                                                                                              |

### Production timing

Guest (measured by this lane, Chrome, `GRU`, times in ms from navigation start):

| Load            | Document first byte | Assets done | `/api/runs` start → end | Loading text visible |
| --------------- | ------------------- | ----------- | ----------------------- | -------------------- |
| Cold HTTP cache | 172                 | 314         | 367 → 719 (352)         | 320 → 728            |
| Reload 1        | 92                  | 210         | 266 → 623 (357)         | 221 → 630            |
| Reload 2        | 49                  | 126         | 166 → 530 (364)         | 133 → 537            |
| Reload 3        | 97                  | 145         | 182 → 567 (385)         | 152 → 575            |

A guest request has no session and makes only the 2 schema-check round trips.

Signed in (orchestrator measurement, 5 warm samples): `/api/runs` starts at 240–595 ms and has a server wait of 865–1,967 ms (865, 942, 992, 1,077, 1,967). `/api/operations` starts 66–250 ms after `/api/runs` ends and has a server wait of 1,204–1,299 ms. The page is stable 2.6–3.7 s after navigation start. `/api/runs` returns 2,285 bytes and `/api/operations` 554 bytes.

Check of the model in this report: guest `/api/runs` is 365 ms (median), and each extra D1 round trip adds 106–125 ms (M3). Four more round trips give an estimate of about 0.8 s for a signed-in `/api/runs` and about 1.1 s for `/api/operations`. The signed-in measurements (0.87–1.08 s and 1.2–1.3 s) agree with this. The estimate does not include SQL execution time or GitHub calls. The 1,967 ms sample is about 0.9 s above the others; the cause is not known. A permission cache miss with GitHub calls fits.

### The binding requirement for the permission check

`docs/current-contract.md:186`:

> Private reads may reuse a positive GitHub permission result for the same valid session, user, and repository for at most 60 seconds. The approved decision-only supersession below permits Approve and Reject to reuse a positive GitHub permission check for at most 10 seconds. Live session and linked-account checks still run for every request. All other writes require a live repository-permission check.

`docs/current-contract.md:204` adds: "at most 10 seconds from the start of the GitHub permission request that established it. Cache hits do not extend that interval." `packages/security/README.md:19` adds: "Denials are never cached." and "Logout and expired or replaced sessions cannot use a cached permission."

The contract does not say where the 60-second result is stored. The earlier rule (`docs/simplification-audit/contract-issue-1.md:306`, "Check **current permission for protected app reads and all review writes**") is superseded for reads by selections O05 and O08. The same paragraph still applies: "Client-side route guards are not an authorization boundary."

## Findings

**Option overview.** Each option names the security guarantee that changes.

| Option                                                                                | Removes or shortens                                                           | Security guarantee that changes                                                                                                                                                  | Finding          |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Turn off Better Auth runtime schema validation                                        | 2 D1 round trips on every private request                                     | None for session or permission. The service loses a fail-closed guard against schema drift.                                                                                      | LOAD-01          |
| Load the dashboard in the route loader during the server render                       | The JS download and hydration before the data request; one browser round trip | None, if the loader calls `requireMaintainer({ access: "read" })`. The document then holds private data and must keep `no-store, private`.                                       | LOAD-02          |
| Streaming (deferred loader data)                                                      | The same; the first paint does not wait for the access check                  | Same as the loader                                                                                                                                                               | LOAD-02          |
| Server function (`createServerFn`)                                                    | The same as the loader                                                        | Adds an RPC endpoint. It needs the same origin check, access check, and private headers.                                                                                         | LOAD-02          |
| Optimistic shell with skeletons                                                       | Perceived wait only                                                           | None                                                                                                                                                                             | LOAD-02, LOAD-06 |
| Worker placement near D1 (smart or targeted)                                          | Each D1 round trip from about 110 ms to a local call                          | None                                                                                                                                                                             | LOAD-03          |
| D1 read replication with the Sessions API                                             | D1 latency for reads near a replica                                           | A replica can lag. A session or account read from a replica can accept a session that the primary already deleted. This conflicts with "Live session and linked-account checks". | LOAD-03          |
| Better Auth `joins`                                                                   | 1 D1 round trip                                                               | None                                                                                                                                                                             | LOAD-04          |
| Batch or parallel D1 statements                                                       | 3 round trips on `/api/operations`                                            | None                                                                                                                                                                             | LOAD-04          |
| Session cookie cache                                                                  | 1–2 D1 round trips                                                            | A deleted or revoked session stays valid until the cookie cache expires. This conflicts with `current-contract.md:186`. It needs an approved contract change.                    | LOAD-04          |
| Router `Link` in the header                                                           | A full document load on each view change                                      | None                                                                                                                                                                             | LOAD-05          |
| Router loader cache for the dashboard                                                 | Repeated loading text between views                                           | The browser keeps private data in memory for the stale time after access is removed. Server checks do not change.                                                                | LOAD-06          |
| HTTP caching of `/api/runs` (`private, max-age`)                                      | A repeated read                                                               | The browser would show private data with no session check. Conflicts with the per-request session check. `ETag` with `304` keeps the check and saves only bytes.                 | LOAD-06          |
| Start `/api/operations` in parallel, or include the alert count in the dashboard read | One chained request                                                           | None                                                                                                                                                                             | LOAD-07          |
| Poll less often and pause when hidden                                                 | 1 GitHub call and 9 D1 round trips per minute per open tab                    | None                                                                                                                                                                             | LOAD-08          |
| Permission result in D1, at most 60 s                                                 | 1–3 GitHub calls on each new isolate                                          | Same 60 s and 10 s limits. The limit becomes exact across isolates.                                                                                                              | LOAD-09          |
| Permission result in KV                                                               | The same                                                                      | KV is eventually consistent. A grant that one location deleted after a failed live check can be read in another location for up to 60 s. The `checkedAt` limit still holds.      | LOAD-09          |
| Permission result in the Cache API                                                    | The same, per data center                                                     | A delete is local to one data center. The `checkedAt` limit still holds.                                                                                                         | LOAD-09          |
| Preload on intent                                                                     | Part of the wait for a run                                                    | None. It adds reads that the user did not complete.                                                                                                                              | LOAD-12          |
| Immutable caching for hashed assets                                                   | 9 conditional requests per document load                                      | None. The files are public and content-hashed.                                                                                                                                   | LOAD-11          |

### LOAD-01 · Better Auth reads the whole database schema on every request

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/security/src/auth.ts:15-16`: `/** Create inside each request so a D1 binding cannot cross request ownership. */ export function createAuth(...)`. Lines 47-51 set `advanced` with no `database` key.
  - Call sites that build a new instance per request: `apps/web/src/api/index.ts:130`, `apps/web/src/server.ts:85`, `apps/web/src/server.ts:93`.
  - Better Auth 1.7.5, `@better-auth/core/dist/db/schema-check.mjs:7-9`: `function checksSchema(options) { return options.advanced?.database?.validateSchema !== false; }`.
  - `better-auth/dist/auth/base.mjs:15`: `const pendingSchemaCheck = ctx.checkSchema?.();` runs when the instance is built. `better-auth/dist/api/to-auth-endpoints.mjs:41-42`: `const pendingSchemaCheck = rawContext.checkSchema?.(); if (pendingSchemaCheck) await pendingSchemaCheck;` runs before each `auth.api.*` call.
  - Measured (local, M1): every private request starts with `select "name", "type", "sql" from "sqlite_master" …` and `BATCH(75): SELECT * FROM pragma_table_info(?)`.
  - Measured (local, M2): `requireMaintainer` uses 5 D1 round trips now, and 3 with `validateSchema: false`. A guest uses 2 now, and 0 with the flag.
  - Measured (local, M5): the two round trips read 856 rows and return about 85 KB of JSON (33.7 KB + 51.6 KB) for the 75 tables and views.
  - Measured (production, M3): guest `GET /api/runs` has a median of 365 ms. `GET /health` has a median of 32 ms. The guest request does no other D1 work.
  - Measured (local, M4): `PUT /v1/uploads/:token` and `POST /v1/runs/:id/finalize` also send the 76 statements, because `handleApi` builds the auth instance (`api/index.ts:130`) before it routes the signed CI requests (lines 134-189).
- What happens: Better Auth validates the live schema one time per auth instance. Visonaut builds a new instance for each request, so the validation runs on each request. The session lookup waits for it.
- Impact: about 330 ms on each private request from `GRU` (measured for a guest; the statements are the same for a signed-in user). That is about one third of the signed-in `/api/runs` time that the orchestrator measured. It is 4 of the 15 round trips and 152 of the 165 statements of one dashboard load. Each CI upload request also sends 76 extra statements to the single D1 primary.
- Recommendation: set `advanced.database.validateSchema` to `false` in `createAuth`. Keep one test that builds an instance with validation on, against the numbered migrations, so that schema drift fails in CI.

  ```ts
  // packages/security/src/auth.ts
  advanced: {
    cookiePrefix: `visonaut-${configuration.environment}`,
    useSecureCookies: configuration.environment !== "local",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    // The numbered migrations own the schema. A test validates it one time.
    database: { validateSchema: configuration.validateSchema ?? false },
  },
  ```

- Alternatives:
  - Minimal: the flag only, with no test parameter.
  - Build the auth instance only on routes that use it (move `createAuth` below the `/v1/*` routes). This removes the CI cost but not the dashboard cost.
  - Keep one instance per isolate, so the verdict is reused. Risk: a second request can wait on a promise that belongs to the first request. The construction cost that this would save is small: 0.08 ms median in Node (M9).
- Security guarantee that changes: none for the session, the linked account, or the permission. The runtime guard that rejects auth requests after schema drift is removed.
- Maintainer decision needed: yes. Is a test-time schema check an acceptable replacement for the runtime check?

### LOAD-02 · The server sends the loading text, and the data request starts only after hydration

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/routes/index.tsx:39-44`: the route has `validateSearch` and `component` only. No `loader`.
  - `apps/web/src/routes/index.tsx:161`: `const [state, setState] = useState<DashboardState>({ status: "loading" });`
  - `apps/web/src/routes/index.tsx:176-184`: `useEffect(() => { … const response = await fetch("/api/runs", { credentials: "same-origin", cache: "no-store", … })`.
  - Measured (production, M6): the document HTML contains `role="status">Checking access and loading runs…`. `/api/runs` starts 166–367 ms after navigation start, after the 9 asset requests end. The orchestrator measured 240–595 ms for the signed-in session.
  - Measured (build, M7): the JS that must load before the request is 602 KB raw and 192 KB gzip. The CSS is 465 KB raw and 60 KB gzip.
  - `apps/web/src/routes/pulls.$pullNumber.tsx:47-58` uses the same effect pattern. `apps/web/src/routes/runs.$runId.tsx:31,37-47` has a loader but sets `ssr: false`.
  - `docs/simplification-audit/audit-data.json:6676-6679`: selection P03 is `"optionId": "router-loaders"` with the note "We should do things the idiomatic way." Only the run route uses a loader.
- What happens: the load has three serial network stages: document, JS, data. The server render cannot know the session, so each visitor, guest or maintainer, first sees the loading text.
- Impact: a guest waits about 0.4 s for the sign-in page (measured). A maintainer waits for the JS stage plus the complete access check: the queue data arrived 1.2–1.5 s after navigation start in the warm signed-in samples (orchestrator measurement). On a slower device or network, the JS stage grows and the data request starts later.
- Recommendation: read the dashboard in the route loader. On the server it calls the same function as `GET /api/runs`, with no HTTP hop. On client navigation it calls `fetch("/api/runs")`. `createIsomorphicFn` is already used in `apps/web/src/router.tsx:5`. Sketch (not built or run in this audit):

  ```tsx
  // apps/web/src/routes/index.tsx
  const loadDashboard = createIsomorphicFn()
    .server(async () => {
      // Server only: the same access check and query as GET /api/runs.
      const { readDashboard } = await import("../api/dashboard-read.ts");
      return readDashboard(getRequest());
    })
    .client(() => fetchDashboard());

  export const Route = createFileRoute("/")({
    validateSearch,
    loader: () => loadDashboard(),
    component: Index,
  });
  ```

  Rules for `readDashboard`: call `requireMaintainer({ access: "read" })`; return `{ status: "guest" }` for a 401 and `{ status: "forbidden" }` for a 403; copy `identity.sessionHeaders` to the response so that cookie renewal still works; return the preview fixture in the preview environment; when the request has no session cookie and no `Authorization` header, return `{ status: "guest" }` before any auth work. `render(request, { context })` (`@tanstack/start-server-core/dist/esm/request-handler.d.ts:56-66`) can pass `env` to the loader.

- Alternatives:
  - Streaming: return the promise from the loader without `await`, and render it with `<Await>` inside `<Suspense>`. The header and a skeleton flush at once, and the data arrives in the same response. `server.ts:24` already uses `defaultStreamHandler`.
  - Server function (`createServerFn`): the same result, but it adds an RPC endpoint that needs the origin check and `securePrivateResponse`.
  - Minimal: keep the client fetch, but start it from a small inline script in `<head>` (with the nonce) and give the promise to React. This removes the JS wait but not the extra round trip.
  - Skeleton only: replace the text with the page frame and row placeholders. The wait time does not change.
- Security guarantee that changes: none, if the loader uses `requireMaintainer`. The document then contains private data. `securePrivateResponse` already sets `Cache-Control: no-store, private` on it (`server.ts:23-28`). The session cookie is `sameSite: "lax"` (`auth.ts:50`), so a navigation from a GitHub check link carries it.
- Maintainer decision needed: yes. Blocking loader, streaming loader, or the minimal early fetch?

### LOAD-03 · Each D1 round trip costs about 105–125 ms from the São Paulo edge, and the Worker has no placement setting

- Kind: performance
- Severity: high. Confidence: medium (the latency is measured; the database region is not verified). Measured: yes. Effort: S
- Evidence:
  - `apps/web/wrangler.jsonc:46-123`: the production environment has no `placement` key. No source file uses `withSession` (D1 Sessions API).
  - Measured (production, M3), medians at `GRU`: `/health` 32 ms (0 D1 round trips); `/images/<unknown id>` 157 ms (1 round trip, `api/images.ts:24-35`); guest `/api/operations` 471 ms and guest `/api/runs` 365 ms (they differ by one round trip, `api/index.ts:124-126`).
  - No response had a `cf-placement` header.
  - The installed Wrangler schema accepts `{ "mode": "smart", "hint"?: string }`, `{ "region": string }`, `{ "host": string }`, and `{ "hostname": string }` (`node_modules/wrangler/config-schema.json:261-330`).
- What happens: the Worker runs at the edge location of the visitor. Each D1 statement or batch crosses the network to the database region and back. The access check sends them one at a time.
- Impact: a private read has 6–9 serial round trips. At 106–125 ms each this is about 0.6–1.1 s of network time for each read (estimate; it agrees with the signed-in orchestrator measurements of 0.87–1.3 s). `/api/operations` needs 1.2–1.3 s to return 554 bytes. Latency this high between `GRU` and the database is consistent with a database in North America. Not verified.
- Recommendation: run the Worker near the database. Measure with the M3 probe before and after.

  ```jsonc
  // apps/web/wrangler.jsonc, env.production
  "placement": { "mode": "smart" },
  // or a fixed region for a low-traffic Worker (confirm the value format in the Cloudflare docs):
  // "placement": { "region": "aws:us-east-1" },
  ```

  Tradeoff: each Worker request then has one long hop from the visitor to the Worker. The document for `/` takes about 110 ms longer for a visitor in Brazil than now. Static assets are not affected. A private read drops from N long hops to one.

- Alternatives:
  - Reduce the round trips only (LOAD-01, LOAD-04). This keeps the latency per round trip.
  - D1 read replication with the Sessions API. Read `wrangler d1 info visonaut` first. If the nearest replica region for Brazil is the same region as the primary, there is no gain. Use `first-primary` or a bookmark for session and account reads.
  - No change.
- Security guarantee that changes: placement: none. Read replicas: see the option overview.
- Maintainer decision needed: yes. Smart placement, a fixed region, or no placement?

### LOAD-04 · The access check and the operations read send their D1 statements one at a time

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/security/src/authorization.ts:32-43`: `await auth.api.getSession(…)` and then `await database.prepare("SELECT accountId FROM account WHERE userId = ? AND providerId = 'github'")`.
  - Better Auth splits the session lookup in two when joins are off: `@better-auth/core/dist/db/adapter/factory.mjs:562`: `if (!options.advanced?.database?.joins && join && Object.keys(join).length > 0) passJoinToAdapter = false;`. Measured (local, M2): two statements, `… from "session" where "session"."token" = ?` and `… from "user" where "user"."id" = ?`. With `joins: true` there is one statement with `"join_user"` columns.
  - `apps/web/src/api/operations.ts:16-18`, `30-36`, `45-47`: three `await database.prepare(…)` calls in sequence. None needs the result of another.
  - The project is checked twice for `/api/operations`: `api/index.ts:124-126` (`await assertConfiguredProject(context)`) and `api/operations.ts:16-29`. `/api/runs` already skips the first check (`api/index.ts:123`, `const dashboardRead = …`).
- What happens: `requireMaintainer` needs 3 round trips after the schema check. `/api/operations` needs 4 more.
- Impact: at 106–125 ms each (LOAD-03), about 110 ms on each private read from the session join, and about 330 ms on each `/api/operations` read (estimate).
- Recommendation:

  ```ts
  // packages/security/src/auth.ts
  database: { validateSchema: false, joins: true },
  ```

  ```ts
  // apps/web/src/api/operations.ts: one round trip, and the first statement
  // replaces the earlier assertConfiguredProject call for this route.
  const [projects, rows, capacity] = await database.batch([
    database.prepare("SELECT id,repository_id FROM visonaut_projects ORDER BY id LIMIT 2"),
    database.prepare(eventsSql),
    database.prepare("SELECT value FROM operations_cursors WHERE id='database-capacity'"),
  ]);
  ```

  Result (counts): `/api/runs` 6 → 3 round trips and `/api/operations` 9 → 3, together with LOAD-01.

- Alternatives:
  - Minimal: `joins: true` only.
  - Start the dashboard batch at the same time as the access check and discard the result when the check fails. This saves one more round trip. It lets a request with a signed but invalid session start the dashboard queries.
  - Session cookie cache (`session.cookieCache`). Not possible under the current contract.
- Security guarantee that changes: joins and batching: none. Cookie cache: see the option overview.
- Maintainer decision needed: no for joins and batching. Yes for the cookie cache, because it needs a contract change.

### LOAD-05 · Each header navigation click reloads the whole document

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/components/app-shell.tsx:15-19`: `{ id: "history", href: "/?view=history", … }`. Lines 53-58: `<NavLink key={id} href={href} …>`. Line 29: `render={<a href="/" />}` for the logo.
  - `apps/web/src/components/ariakit/components/nav.ariakit.react.tsx:600-606`: `NavLink` renders `<ak.Role.a … {...rest} />`, a plain anchor.
  - Measured (preview fixture, M8): each click on `Review queue`, `Run history`, or `Service status` causes 1 document load, a new `/api/runs` read, and the loading text. The in-page `View history` button, which uses the router `Link` (`routes/index.tsx:549`), causes 0 document loads and 0 reads.
- What happens: the three views are one route with a search parameter. The header changes the view with a full navigation, so the document, the 9 asset revalidations (LOAD-11), hydration, and the access check all run again.
- Impact: each view change costs a full page load. In the signed-in samples the queue data arrived 1.2–1.5 s after each load and the page was stable at 2.6–2.7 s (orchestrator measurement for `/`, `/?view=history`, `/?view=service`). The queue and the history use the same `/api/runs` data, so this read is not necessary.
- Recommendation: render the header links with the router `Link`. `NavLinkProps` extends `ak.RoleProps<"a">` and its documentation says that `render` belongs to the anchor (`nav.ariakit.react.tsx:577-585`).

  ```tsx
  <NavLink
    key={id}
    render={<Link to="/" search={view ? { view } : {}} />}
    aria-label={label}
    aria-current={active === id ? "page" : undefined}
  >
  ```

- Alternatives: make `/history` and `/service` real routes, each with its own loader. Keep the anchors and accept the reload.
- Security guarantee that changes: none.
- Maintainer decision needed: no.

### LOAD-06 · The dashboard data lives only in component state

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/routes/index.tsx:161`: state starts as `{ status: "loading" }` on each mount.
  - `apps/web/src/routes/index.tsx:242-245`: `const refresh = () => { setState({ status: "loading" }); setReload((value) => value + 1); };`
  - `apps/web/src/routes/index.tsx:254-264`: the alert bell and the user menu render only when the state is `ready`, or not `loading`.
  - Measured (preview fixture, M8): browser Back from a run to the queue sends `/api/runs` again and shows the loading text again.
  - Measured (preview fixture, M10): during `Refresh runs` the heading `Your review queue.` and all cards are removed, the account menu is removed from the header, and the loading text is shown. Screenshot: `shot-refresh-blank.png`.
- What happens: the data is lost when the component unmounts. A manual refresh replaces the page with the loading text. The bell unmounts and mounts again, so it sends `/api/operations` again and resets its poll.
- Impact: the maintainer sees an empty page for the duration of a full access check after each return to the queue and each refresh. The header changes width when the two controls return.
- Recommendation: keep the dashboard in the router loader cache (with LOAD-02). Set a short `staleTime` (60 s or less), keep the previous data on screen during a reload, and call `router.invalidate()` from `Refresh runs`. Show the busy state on the button only.
- Alternatives:
  - Minimal: do not set `status: "loading"` in `refresh`; keep the last `ready` state and add a `refreshing` flag.
  - Keep the last response in `sessionStorage` and show it at once on the next load.
- Security guarantee that changes: private data stays visible in the open tab for the stale time after access is removed. Each server read still runs the full check. `sessionStorage` also keeps the data after sign-out unless the sign-out code clears it.
- Maintainer decision needed: yes. The stale time, and in-memory only or `sessionStorage`.

### LOAD-07 · The service view and the alert bell wait for `/api/runs` before they request `/api/operations`

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/routes/index.tsx:254-256`: `{state.status === "ready" && !state.preview && view !== "service" && (<OperationsAttention … />)}`.
  - `apps/web/src/routes/index.tsx:356-365`: the service view renders `<OperationsAttention … layout="page" />` inside the `state.status === "ready"` block.
  - Measured (preview fixture with 1,000 ms added to each read, M11): `/api/runs` 295 → 1,308 ms, then `/api/operations` 1,330 → 2,338 ms. The alert data appeared at 2,638 ms.
  - Orchestrator measurement, signed in, `/?view=service`: `/api/runs` 595 → 1,461 ms, then `/api/operations` 1,527 → 2,744 ms.
- What happens: the two reads run in sequence. The service view uses only two values from `/api/runs`: `preview` and `repository`.
- Impact: the service view runs two complete access checks in sequence: 15 serial D1 round trips (measured count). The alerts appeared 2.7 s after navigation start in the signed-in sample.
- Recommendation: start both reads together. With LOAD-02, the loader for the service view reads only the operations status. For the bell, add the alert count to the dashboard read (one more statement in the existing batch) and request the details when the popover opens.
- Alternatives: minimal: mount `OperationsAttention` before `/api/runs` completes and let it handle 401 and 403 (it already has `onAccessDenied`).
- Security guarantee that changes: none.
- Maintainer decision needed: no.

### LOAD-08 · The alert poll period equals the permission cache lifetime, so each poll calls GitHub

- Kind: cost
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/components/operations-attention/index.tsx:280`: `timeout = setTimeout(load, 60000);`, set after each response.
  - `packages/security/src/authorization.ts:21`: `const privateReadLifetime = 60_000;`. Line 63: `cached.checkedAt + lifetime > Date.now()`. Line 72: `checkedAt` is set before the GitHub call.
  - Measured (local, M1): the polls at +60.3 s and +120.6 s each made `GET /repos/ariakit/ariakit/collaborators/maintainer/permission`.
  - The effect has no `visibilitychange` handling. `routes/pulls.$pullNumber.tsx:105-119` has it.
  - `apps/web/wrangler.jsonc:109-111`: `"crons": ["*/5 * * * *"]`. The scheduled recovery that records most alerts runs every 5 minutes.
- What happens: the next poll always arrives just after the cached result expires. The poll continues in a hidden tab.
- Impact: one open dashboard tab sends 1 GitHub API call, 9 D1 round trips, and 83 statements per minute, also when hidden. That is 1,440 GitHub calls per day for each open tab.
- Recommendation: pause the poll when the tab is hidden, refresh when it becomes visible, and poll every 5 minutes.
- Alternatives: keep 60 s and only add the visibility pause. Remove the poll and refresh on focus only.
- Security guarantee that changes: none.
- Maintainer decision needed: no.

### LOAD-09 · The permission, token, and login caches live in one isolate only

- Kind: performance
- Severity: medium. Confidence: medium (the counts are measured; how often a request reaches a new isolate is not). Measured: yes. Effort: M
- Evidence:
  - `packages/security/src/authorization.ts:19`: `const privatePermissions = new WeakMap<D1Database, Map<string, PrivatePermission>>();`
  - `packages/security/src/github.ts:102`: `const installationTokens = new WeakMap<typeof fetch, Map<string, InstallationToken>>();` and line 193: `const loginHints = new Map<string, string>();`
  - Measured (workerd, M12): `env`, `env.DB`, and global `fetch` are the same objects for each request in one isolate, so these caches work inside an isolate.
  - Measured (local, M1): the first signed-in request in an isolate makes 3 serial GitHub calls: `POST /app/installations/1/access_tokens`, `GET /user/42`, `GET /repos/ariakit/ariakit/collaborators/maintainer/permission`.
  - Measured (production, M13): 2 of 8 new connections reached a Worker that needed 702 ms and 1,402 ms for the first `/health`. This shows that new isolates occur during normal use.
- What happens: each new isolate, deploy, or other data center starts with empty caches. The first private read there waits for a token, a user lookup, and a permission check, one after the other.
- Impact: 3 GitHub round trips are added to the first private read in each isolate. GitHub latency from the Worker is not measured. From the audit machine a trivial GitHub read took 27 ms (median) on an open connection and 175 ms with connection setup (M14). One signed-in `/api/runs` sample was 0.9 s slower than the others (orchestrator measurement); its cause is not known.
- Recommendation: store the positive result in D1 with its `checked_at` time and read it in the same batch as the account lookup. Keep the same key parts as now (session, user, GitHub user ID, App configuration), the same 60 s and 10 s limits from `checked_at`, and the delete before each live check. Store the login with it, so a new isolate also skips `GET /user/:id`.

  ```ts
  const [accounts, grants] = await database.batch([
    database
      .prepare("SELECT accountId FROM account WHERE userId = ? AND providerId = 'github'")
      .bind(userId),
    database
      .prepare(
        "SELECT github_user_id, login, role, checked_at FROM auth_permission_grants WHERE session_id = ? AND authorization_key = ?",
      )
      .bind(sessionId, authorizationKey),
  ]);
  ```

- Alternatives:
  - Store only the login hint in D1. A new isolate then makes 2 GitHub calls, not 3. The login is a routing hint; `github.ts:220-223` still compares the numeric ID.
  - KV or the Cache API. See the option overview for the weaker delete behavior.
  - No change. With LOAD-03 the GitHub calls leave from a location near GitHub and can cost less.
  - Do not store the installation token outside the isolate. It is a credential.
- Security guarantee that changes: D1: none in the contract text. The limit is then the same in each isolate. Today a new isolate checks GitHub again before 60 s by accident.
- Maintainer decision needed: yes. D1 table, login hint only, or no change?

### LOAD-10 · A cold Worker adds 0.6–1.3 s to the first request

- Kind: performance
- Severity: medium. Confidence: medium (the cause is not isolated). Measured: yes. Effort: M
- Evidence:
  - Measured (production, M13): the first `/health` on a new connection took 83–232 ms on 6 connections, and 702 ms and 1,402 ms on 2 connections. `/health` returns before any binding is used (`server.ts:60-71`).
  - Measured (production, M3 and the first `curl` series): the first guest `/api/runs` of a series took 1,052 ms and 1,067 ms. Later ones took 333–406 ms.
  - Orchestrator measurement: the first signed-in document on a cold connection had a first byte at 523 ms; warm ones had 41–119 ms.
  - Measured (build, M7): the Worker is 33 modules, 4.10 MB raw and 888 KB gzip. `dist/server/index.js` is 2.10 MB and is not minified.
- What happens: some requests reach a Worker instance that must start first. The start time of this script is not known; the deploy output prints it as `Worker Startup Time`.
- Impact: the first load after an idle period or on a new connection can be about 1 s slower, before any D1 or GitHub work.
- Recommendation: read `Worker Startup Time` from the next deploy log. If it is high, reduce the code that the entry module evaluates: minify the server build, and load the React render path and Better Auth only on the routes that use them.
- Alternatives: no change. Record the startup time only.
- Security guarantee that changes: none.
- Maintainer decision needed: yes. Is this worth work before the startup time is known?

### LOAD-11 · Content-hashed assets are revalidated on every document load

- Kind: performance
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Measured (production, M6): `GET /assets/index-MxeSnhFR.js` returns `cache-control: public, max-age=0, must-revalidate` and `etag: W/"1353ea0a382036735f0a145a145f6a9a"`. `index-CXm4JU5N.css` returns the same policy.
  - Measured (production, M6): on each reload Chrome sent 9 conditional requests (transfer size 300 bytes each). They ended 37–106 ms after they started. The orchestrator saw the same in the signed-in session ("300 bytes transfer each").
  - `apps/web/public/` contains only `favicon.svg`. There is no `_headers` file. Wrangler 4.136.1 reads one from the assets directory (`wrangler-dist/cli.js:156046`, `HEADERS_FILENAME = "_headers"`).
- What happens: Workers static assets use `max-age=0` by default. The file names contain a content hash, so the files can be cached without revalidation.
- Impact: 9 extra requests before hydration on each document load. With LOAD-05 this occurs on each header click.
- Recommendation:

  ```
  # apps/web/public/_headers
  /assets/*
    Cache-Control: public, max-age=31536000, immutable
  ```

- Alternatives: no change. The requests are small.
- Security guarantee that changes: none. The files are public.
- Maintainer decision needed: no.

### LOAD-12 · Opening a run from the queue shows no change for 1 second, and nothing is preloaded

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/router.tsx:8`: `createRouter({ routeTree, scrollRestoration: true, ssr: { nonce: scriptNonce() } })`. No `defaultPendingMs` and no `defaultPreload`.
  - `apps/web/src/routes/runs.$runId.tsx:33`: `pendingMinMs: 0`. No `pendingMs`. The router default is 1,000 ms.
  - Measured (preview fixture with 2,500 ms added to `/api/runs/:id`, M15): after the click the URL changed at 21 ms. The queue stayed on screen until 1,000 ms. Then `Checking access and loading this run…` appeared.
  - No `Link` in `apps/web/src` sets `preload`.
- What happens: the router waits 1 s before it shows the pending component. The run chunk (138 KB raw) and the review model start to load only after the click.
- Impact: the click on `Review changes` appears to do nothing for 1 s. Then a text-only page replaces the queue. The orchestrator measured a server wait of 5.3–5.7 s for the run model of a large pull request, so this state lasts for seconds.
- Recommendation: show feedback at once on the clicked control, and start the read on hover or focus.

  ```tsx
  <Button
    $layer="primary"
    render={<Link to="/runs/$runId" params={{ runId: run.id }} preload="intent" />}
  >
  ```

  Set `pendingMs: 0` on the run route if the pending page must appear at once. Confirm how `preload` works with this route's `gcTime: 0` and `staleTime: Infinity` (`runs.$runId.tsx:35-36`).

- Alternatives: `defaultPreload: "intent"` for the whole router. `pendingMs: 0` only.
- Security guarantee that changes: none. A preload is the same checked `GET`. It adds review-model reads for runs that the user does not open.
- Maintainer decision needed: no.

### LOAD-13 · Pull request titles are erased before the dashboard reads them

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/api/dashboard.ts:57-62`: `CASE WHEN run.kind='pull_request' THEN (SELECT json_extract(delivery.payload_json,'$.pull_request.title') FROM github_webhook_delivery delivery WHERE delivery.event='pull_request' AND … ORDER BY delivery.received_at DESC LIMIT 1) END AS title`. `apps/web/src/api/review.ts:288` reads the title the same way for the run page.
  - `apps/web/src/api/webhooks.ts:330-335`, at the end of `processWebhook`, after the `pull_request` branch (lines 279-329): `"UPDATE github_webhook_delivery SET processed_at = ?, payload_json = '{}' WHERE delivery_id = ? AND payload_digest = ?"`.
  - History: the compaction is from `339926d` (2026-09-28, "Compact processed webhook payloads (#129)"). The title query and its index `apps/web/migrations/0028_pr_title_index.sql` are from `5712036` (2026-09-30).
  - `apps/web/src/api/dashboard.test.ts:42-56` inserts processed deliveries that still have the full payload. The processor never leaves a row in this state.
  - Measured (local, M16): before the update, `dashboard()` returns `title: "Add the tooltip arrow"`. After the exact update statement, it returns no `title`.
  - Orchestrator note from the signed-in production session: "History rows show `#7746 · Pull request` because no pull request title is available".
- What happens: the title is read from the stored webhook payload. The processor replaces the payload with `{}` when it completes the delivery.
- Impact: a pull request run shows the title only while one of its deliveries is not processed. After that the queue card heading is `Pull request` (`routes/index.tsx:499`, `run.title ?? kindLabel(run.kind)`), and the cards differ only by number. The correlated subquery and the index have no result to return.
- Recommendation: keep the title outside the temporary payload. For example, write the number and title to a small table when a `pull_request` delivery is processed, and join it in the dashboard query. Change the test fixture to use the real processor state.
- Alternatives: for `pull_request` events, compact the payload to the three fields that the index reads (`repository.id`, `pull_request.number`, `pull_request.title`) and not to `{}`. Or store the title with the run when it is reserved.
- Security guarantee that changes: none. Titles are private metadata and stay behind the same check.
- Maintainer decision needed: yes. Where is the title stored?

### LOAD-14 · `/api/me` and `/api/session` are not used by the app, and their error shape differs

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/server.ts:88-105` handles `/api/me` outside `handleApi` with its own `createAuth`, `createGitHubClient`, and `requireMaintainer`. `apps/web/src/api/review.ts:713-721` handles `/api/session`.
  - No file in `apps/web/src` requests them. Only tooling does (`apps/web/tooling/review-scale/local-routes.mjs:273`). `apps/web/src/review/__tests__/route.browser.test.ts:103`: `expect(requests).not.toContain("/api/me");`
  - `docs/review-evidence-plan.md:62` still says: "The integrated routes use `GET /api/me` before loading protected app data."
  - Measured (production, M17): `/api/me` as a guest returns `retry-after: 1` and `{"error":{"code":"sign_in_required",…}}`. `/api/runs` returns no `Retry-After` and `{"schemaVersion":"1.0","error":{…}}`. Source: `server.ts:47-50` sets `Retry-After` for each status; `api/index.ts:38-44` sets it for 503 only.
  - `apps/web/src/api/index.ts:131-133` handles `/api/auth/`, but `server.ts:82-87` returns first. `api/index.ts:216-218` returns a 404 body with no `schemaVersion`.
  - `apps/web/src/routes/index.tsx:258-263` renders `<UserMenu …>` with no `login`, so the menu label is `Account` (`components/user-menu.tsx:24`).
- What happens: two identity endpoints exist and the UI uses neither. The app never shows who is signed in.
- Impact: duplicate auth wiring to maintain, three error shapes, one stale document line, and a user menu with no name.
- Recommendation: return `login` in the dashboard read (LOAD-02) and pass it to `UserMenu`. Route `/api/me` through `handleApi`, or remove it and update the tooling and the document line. Use one error shape.
- Alternatives: keep `/api/me` as an operator probe and document that purpose.
- Security guarantee that changes: none.
- Maintainer decision needed: yes. Keep or remove `/api/me`?

### LOAD-15 · The dashboard leaves 401 and 403 response bodies unread

- Kind: bug
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/routes/index.tsx:185-195`: `if (response.status === 401) { setState({ status: "guest" }); return; }` and the same for 403. The body is not read or cancelled. `components/operations-attention/index.tsx:239-242` and `routes/pulls.$pullNumber.tsx:59-69` do the same.
  - Measured (production): Chrome reported `request` and `response` for the guest `/api/runs`, but never `requestfinished`. `page.goto(…, { waitUntil: "networkidle" })` timed out after 30 s.
  - Measured (preview fixture, M18): with a 401, the events are `request, response` and network idle is not reached. With a 200, where the body is read, `requestfinished` occurs and network idle is reached.
- What happens: Chrome keeps the request open while the body is not consumed.
- Impact: the guest page never becomes network-idle. A browser test that waits for network idle against a real deployment times out. The request has no Resource Timing entry.
- Recommendation: the server code already has the pattern (`packages/security/src/github.ts:81`).

  ```ts
  if (response.status === 401) {
    await response.body?.cancel();
    setState({ status: "guest" });
    return;
  }
  ```

- Alternatives: read the JSON error body and show its message.
- Security guarantee that changes: none.
- Maintainer decision needed: no.

## Measurements (command, raw result, limits)

All files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/load/`. Vitest ran with a scratch configuration (`vitest.config.mjs`) and wrote nothing to the repository.

**M1. D1 and GitHub calls per request (local).** `node_modules/.bin/vitest run --config <scratch>/vitest.config.mjs` (`roundtrips.test.ts`). Real `handleApi`, Miniflare D1 with all migrations, counting proxy on the binding, counting GitHub `fetch`, `Date.now` mocked for the time steps.

```
guest: no credential                  /api/runs        status=401 d1RoundTrips=2 d1Statements=76 github=0
cold isolate: first signed-in request /api/runs        status=200 d1RoundTrips=6 d1Statements=82 github=3
warm, 0.3 s later (operations bell)   /api/operations  status=200 d1RoundTrips=9 d1Statements=83 github=0
warm, 30 s later (Refresh runs)       /api/runs        status=200 d1RoundTrips=6 d1Statements=82 github=0
warm, first 60 s poll of the bell     /api/operations  status=200 d1RoundTrips=9 d1Statements=83 github=1
warm, second 60 s poll of the bell    /api/operations  status=200 d1RoundTrips=9 d1Statements=83 github=1
warm, run page read                   /api/session     status=200 d1RoundTrips=6 d1Statements=80 github=0
```

Limit: counts only. Local D1 has no network latency. Full statements: `roundtrips.json`.

**M2. `requireMaintainer` with other Better Auth options (local).** `auth-options.test.ts`, a new auth instance per call, as in production.

```
[current options] guest: d1RoundTrips=2 · signed in: d1RoundTrips=5
[validateSchema: false] guest: d1RoundTrips=0 · signed in: d1RoundTrips=3
[validateSchema: false + joins: true] guest: d1RoundTrips=0 · signed in: d1RoundTrips=2
```

**M3. Production response time, anonymous (median of 8, one open connection).** `node prod-probe.mjs 8`.

```
/health                                       ttfbMs min 24  median 32  max 123   colo GRU  (0 D1 round trips)
/images/00000000-0000-4000-8000-000000000000  ttfbMs min 142 median 157 max 404   colo GRU  (1 D1 round trip, 404)
/api/runs (401)                               ttfbMs min 333 median 365 max 1067  colo GRU  (2 D1 round trips)
/api/operations (401)                         ttfbMs min 448 median 471 max 571   colo GRU  (3 D1 round trips)
/ (document)                                  ttfbMs min 39  median 56  max 105   colo GRU  28,538 bytes, br
```

Per round trip: 157 − 32 = 125 ms; 471 − 365 = 106 ms. Limits: one location, one time of day, 8 samples, no signed-in request. `cf-placement` was `null` on each response.

**M4. CI routes also start the schema check (local).** `ci-routes.test.ts`: `PUT /v1/uploads/not-a-valid-token` and `POST /v1/runs/<id>/finalize` return 401 and record `SELECT * FROM visonaut_projects WHERE id = ?`, the `sqlite_master` statement, and `BATCH(75)`.

**M5. Size of the schema check (local).** `node introspection-cost.mjs`: `{"tablesAndViews":75,"sqliteMasterRowsRead":231,"sqliteMasterResponseBytes":33736,"pragmaStatements":75,"pragmaRowsRead":625,"pragmaResponseBytes":51620}`.

**M6. Production waterfall in Chrome, guest.** `node waterfall.mjs https://visonaut.com/ prod-guest-waterfall 3`. Results are in the guest table in the map section and in `prod-guest-waterfall.json`. Asset headers: `curl -s -o /dev/null -D - https://visonaut.com/assets/index-MxeSnhFR.js` → `cache-control: public, max-age=0, must-revalidate`, `cf-cache-status: HIT`, `content-encoding: br`. Limit: a fast desktop and network; no CPU or network throttling.

**M7. Build sizes.** `node sizes.mjs` and `node server-sizes.mjs` on the existing `apps/web/dist` (not built by this lane).

```
index-CXm4JU5N.css        raw=464666 gzip= 60125
index-MxeSnhFR.js         raw=319611 gzip=101315
app-shell-rQLLgOsf.js     raw=139641 gzip= 40194
runs._runId-QUJlDVZ1.js   raw=137841 gzip= 44074
JS for route "/": raw=602062 gzip=191660 (8 files)
Worker: modules=33 TOTAL raw=4104202 gzip=888351; index.js raw=2098892 gzip=453133
```

**M8. Navigation reloads (preview fixture, `http://127.0.0.1:4310`).** `node nav-reload.mjs`.

```
{"step":"header nav: Run history","documentLoads":1,"apiRunsRequests":2,"loadingTextShown":1}
{"step":"header nav: Service status","documentLoads":1,"apiRunsRequests":2,"loadingTextShown":1}
{"step":"header nav: Review queue","documentLoads":1,"apiRunsRequests":2,"loadingTextShown":1}
{"step":"in-page link: View history (router Link)","documentLoads":0,"apiRunsRequests":0,"loadingTextShown":0}
{"step":"browser back to queue","documentLoads":0,"apiRunsRequests":2,"loadingTextShown":1}
```

Limit: the dev server runs each effect twice (the first request is aborted), so `apiRunsRequests` is 2. Production sent 1 (M6).

**M9. Cost to build one Better Auth instance (Node 24.18.0, no I/O).** `auth-init-cpu.test.ts`: first 5.63 ms, later median 0.083 ms, p95 0.236 ms. Limit: Node, not workerd.

**M10. `Refresh runs` (preview fixture, 2,000 ms added to `/api/runs`).** `node refresh-blank.mjs`: `{"before":{"queueHeading":true,"accountMenu":true,"cards":1},"duringRefresh":{"queueHeading":false,"loadingText":true,"accountMenu":false,"cards":0}}`.

**M11. Service view chain (preview fixture, 1,000 ms added to each read).** `node service-chain.mjs`: `/api/runs` request 295 → response 1,308; `/api/operations` request 1,330 → response 2,338; heading at 1,349; alert data at 2,638.

**M12. Binding identity in workerd.** `node env-identity.mjs`: requests 2 and 3 return `{"sameEnvObject":true,"sameDatabaseBinding":true,"sameGlobalFetch":true,"weakMapHit":true}`.

**M13. New connections (production).** `node fresh-connections.mjs 8 1500`. First `/health` with TCP and TLS setup, in ms: 178, 232, 121, 92, 171, **1402**, **702**, 83. First `/api/runs` on the same connections: 391, 359, 357, 345, 366, 561, 308, 382. Limit: 8 connections; the cause of the two slow ones is not isolated.

**M14. GitHub API from the audit machine.** `node github-probe.mjs`: `GET https://api.github.com/rate_limit` first 175 ms, then 21, 23, 23, 27, 28, 64 ms. Limit: not from the Worker, not the permission endpoint.

**M15. Pending states (preview fixture, 2,500 ms added).** `node pending-states.mjs`: client navigation to a run: `{"urlChangedMs":21,"loadingTextMs":1000,"queueGoneMs":1000}`. Direct load of a run: loading text at 107 ms. Screenshots: `shot-dashboard-loading.png`, `shot-run-loading.png`, `shot-run-pending-client-nav.png`.

**M16. Title after payload compaction (local).** `pr-title.test.ts`: `{"beforeProcessing":{"pullRequestNumber":7,"title":"Add the tooltip arrow"},"afterProcessing":{"pullRequestNumber":7}}`.

**M17. Error shapes (production).** `curl -s -D - https://visonaut.com/api/me` → `HTTP/2 401`, `retry-after: 1`, `{"error":{"code":"sign_in_required","message":"Sign in with GitHub."}}`. `curl -s -D - https://visonaut.com/api/runs` → `HTTP/2 401`, no `retry-after`, `{"schemaVersion":"1.0","error":{…}}`.

**M18. Unread body (preview fixture).** `node unread-body.mjs`: `{"status":401,"events":["request","request","requestfailed","response"],"reachedNetworkIdle":false}` and `{"status":200,"events":["request","request","requestfailed","response","requestfinished"],"reachedNetworkIdle":true}`. The first `request` and `requestfailed` are the dev-only aborted effect.

Production requests sent by this lane: about 150 anonymous `GET` requests (`/health`, `/`, `/assets/*`, `/api/runs`, `/api/operations`, `/api/me`, one unknown `/images/` ID). No credential, no write.

## Open questions and items not verified

- **Signed-in production time.** This lane had no session. The signed-in numbers are the orchestrator's (`live-authenticated.md`: one location, background tab, 5 samples). The split of that time between D1, GitHub, and SQL execution is an estimate.
- **D1 primary region.** Not read (`wrangler d1 info visonaut` is a remote command). The 106–125 ms per round trip suggests a region far from `GRU`.
- **GitHub latency from the Worker.** Not measured. M14 is from the audit machine.
- **How often a request reaches a new isolate.** Only 8 connections were sampled. The Worker startup time is not known.
- **Smart Placement with low traffic.** Not tested. The `region` value format for targeted placement is taken from the schema and must be confirmed in the Cloudflare documentation.
- **D1 replica regions.** Not verified for South America.
- **Sketches.** The `createIsomorphicFn` loader, the streaming variant, `preload="intent"` with `gcTime: 0`, the `NavLink` with `render={<Link />}`, and the `_headers` file were not built or run.
- **Session renewal.** `updateAge` is one day (`auth.ts:44`). The first request after that adds a session `UPDATE`. Its round-trip count was not measured.
- **Run page.** After the same access check, `reviewModel` (`api/review.ts:227-365`) has at least three more serial stages and one R2 inventory read. This lane did not count them.
- **Back/forward cache.** The effect of `Cache-Control: no-store` on the document was not tested.
- **Cloudflare Web Analytics.** Each load requests one beacon script and posts to `/cdn-cgi/rum`. Not analyzed.
