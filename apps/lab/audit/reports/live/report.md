# Live measurements of the deployed service (unauthenticated, GET only)

Measured on 2026-10-05, 19:26 to 19:43 UTC, from one machine that reaches the Cloudflare GRU (São Paulo) data center. Total: 119 HTTP requests (cap 120). All findings use guest requests. No credentials and no session cookies were used.

Read these three facts first.

1. Production runs the current `main` (commit `f83fef6`). Its asset names are equal to the local `apps/web/dist/client` build (`index-CXm4JU5N.css`, `index-MxeSnhFR.js`, `app-shell-rQLLgOsf.js`).
2. Preview does not run the current `main`. It serves the UI from before PR #252 (see LIVE-09). Preview numbers describe an older bundle.
3. One rule of this lane was broken by accident. The first browser run sent 2 `POST /cdn-cgi/rum` requests to `visonaut.com`. The Cloudflare Web Analytics beacon sent them, not the application. See "Limits and deviations".

## How it works (map)

### Server routing

`apps/web/src/server.ts:56-128` is the Worker entry.

- `/health` returns JSON directly (`server.ts:60-71`). No auth, no D1.
- Preview (`VISONAUT_ENVIRONMENT === "preview"`): fixture JSON for `/api/*`, else SSR (`server.ts:73-80`, `apps/web/src/review/preview-fixtures.ts:70-113`). No D1, no GitHub.
- Production: `/api/auth/*` and `/api/me` build a better-auth instance in `server.ts` (`:82-105`). All other `/api/*`, `/v1/*`, `/images/*` go to `handleApi` (`server.ts:106-117`, `apps/web/src/api/index.ts:86-227`). All other paths go to the TanStack Start SSR handler (`server.ts:118`).
- `securePrivateResponse` sets `Cache-Control: no-store, private` and the CSP on documents and API responses (`packages/security/src/http.ts:31-50`).
- Static files in `dist/client` are served by Workers Static Assets before the Worker runs. The repository has no `_headers` file (`apps/web/public` contains only `favicon.svg`), so the platform default applies.

### What one private API request does (production)

Order in `apps/web/src/api/index.ts`:

1. Origin check (`:110-112`).
2. `assertConfiguredProject` for every path except `GET /api/runs` (`:123-126`). This is 1 D1 query, and it runs before the auth check.
3. `createAuth(...)` (`:130`). This builds a new better-auth instance for each request (`packages/security/src/auth.ts:15-21`).
4. `createGitHubClient` (`:191`). No network call yet.
5. `requireMaintainer` (`:194-205`, `packages/security/src/authorization.ts:25-84`):
   - `auth.api.getSession` (`authorization.ts:32-36`). With no cookie it returns `null` and the request ends with 401 (`:37-39`).
   - `SELECT accountId FROM account ...` (`:40-43`), 1 D1 query.
   - GitHub permission check, cached per isolate for 60 s for reads (`:21`, `:60-70`). On a miss: up to 3 calls to `api.github.com` (`packages/security/src/github.ts:134-158`, `:208-262`).
6. The handler (`handleReview`, `apps/web/src/api/review.ts:699-...`).

better-auth 1.7.5 adds a hidden step to 3 and 5. Each new instance checks the full database schema before the first auth call (see LIVE-01).

D1 round trips in series for each request (counted from the code and from the local experiment in "Measurements"):

| Request                                          | Before auth | Schema check | Session and user | Account | Handler                                   | Total     |
| ------------------------------------------------ | ----------- | ------------ | ---------------- | ------- | ----------------------------------------- | --------- |
| `GET /api/runs`, guest                           | 0           | 2            | 0                | 0       | 0                                         | 2         |
| `GET /api/runs/<id>` or `/api/operations`, guest | 1           | 2            | 0                | 0       | 0                                         | 3         |
| `GET /api/runs`, signed in                       | 0           | 2            | 2                | 1       | 1 (batch, `dashboard.ts:68`)              | 6         |
| `GET /api/operations`, signed in                 | 1           | 2            | 2                | 1       | 3 (`operations.ts:16,30,45`)              | 9         |
| `GET /api/runs/<id>`, signed in                  | 1           | 2            | 2                | 1       | 3 or more waves (`review.ts:232,276,323`) | 9 or more |

The guest rows are measured (LIVE-01, LIVE-02). The signed-in rows are counted, not measured.

### Home page `/` (`apps/web/src/routes/index.tsx`)

1. `GET /`. SSR renders `Index` with `useState({ status: "loading" })` (`:161`). The HTML contains the header and `<p role="status">Checking access and loading runs…</p>` (`:275-279`). It contains no data.
2. The HTML references 1 stylesheet, 8 `modulepreload` scripts, the favicon, and the injected Cloudflare beacon.
3. The browser paints the header and the loading line when the stylesheet arrives.
4. After hydration, `useEffect` sends `fetch("/api/runs", { cache: "no-store" })` (`:176-210`).
5. 401 gives the sign-in view (`:185-188`, `:280-320`). 200 gives the queue (`:356-376`).
6. Only when the state is `ready` does `OperationsAttention` mount (`:254-256`). It then sends `fetch("/api/operations")` and repeats it each 60 s (`apps/web/src/components/operations-attention/index.tsx:228-289`).

Measured guest sequence on production (cold cache, no throttling, 1 sample):

| Time from navigation start | Event                                                        |
| -------------------------- | ------------------------------------------------------------ |
| 0 ms                       | Navigation starts (HTTP/3, DNS 12 ms, connect 27 ms)         |
| 91 ms                      | First byte of the document (`cfEdge;dur=19, cfWorker;dur=9`) |
| 95 to 187 ms               | Stylesheet and 8 scripts download in parallel                |
| 204 to 228 ms              | Loading line is visible, first contentful paint              |
| 231 ms                     | `fetch /api/runs` starts                                     |
| 607 ms                     | 401 arrives (375 ms wait)                                    |
| 616 ms                     | "Sign in with GitHub" is visible. LCP 624 ms                 |

The loading line was on screen for 406 ms. 375 ms of that was the wait for `/api/runs`.

### Run page `/runs/$runId` (`apps/web/src/routes/runs.$runId.tsx`)

1. `GET /runs/<id>`. The route has `ssr: false` (`:31`). The server renders only the shell and the pending component (`:48`, `:66-74`). The HTML contains "Checking access and loading this run…".
2. The browser downloads 1 stylesheet and 9 scripts.
3. The client router runs the `loader` (`:37-47`). It calls `loadReviewModel` (`apps/web/src/review/client.ts:365-373`), which sends `fetch("/api/runs/<id>", { cache: "no-store" })` (`client.ts:254-262`).
4. 401 gives the sign-in card (`:42-44`, `:217-246`). 200 gives `ReviewWorkspace`.
5. In production each screenshot is `GET /images/<id>`: 1 D1 query and 1 R2 read (`apps/web/src/api/images.ts:24-40`) with `Cache-Control: public, max-age=31536000, immutable` (`:52`). Not measured (guest). Preview uses `data:` URLs.

Measured guest sequence on production (cold, 1 sample): first byte 503 ms, FCP 1024 ms, `fetch /api/runs/<id>` starts at 1030 ms, 401 at 1539 ms (505 ms wait), sign-in card at 1549 ms. The loading line was on screen for 535 ms.

### What is good

- HTTP/3 on the first connection, zstd compression, and `cf-cache-status: HIT` for all assets.
- Documents and API responses carry the security headers from `packages/security/src/http.ts`.
- No long tasks and CLS 0 on the production guest pages. Script time was 32 to 39 ms without throttling.
- A warm Worker answers `/health` in 24 to 30 ms and the home document in 56 to 131 ms.

## Findings

### LIVE-01 · Each API request runs a full database schema check inside better-auth

- **Kind:** performance
- **Severity:** high. **Confidence:** high. **Measured:** yes. **Effort:** S
- **Evidence:**
  - `packages/security/src/auth.ts:15-16`: `/** Create inside each request so a D1 binding cannot cross request ownership. */ export function createAuth(...)`. Callers: `apps/web/src/api/index.ts:130`, `apps/web/src/server.ts:85`, `apps/web/src/server.ts:93`.
  - better-auth 1.7.5, `better-auth/dist/auth/base.mjs:9-19`: `const pendingSchemaCheck = ctx.checkSchema?.();` runs when the instance is built.
  - `@better-auth/core/dist/types/init-options.d.mts:390-400`: "Validate the schema during initialization ... Authentication requests await the same check ... Kysely introspects the database ... Set `false` to disable runtime schema validation. `@default true`".
  - `@better-auth/core/dist/db/schema-check.mjs`: the clean result is cached in a closure of one adapter instance ("check shared by one adapter instance"). A new instance has no cached result.
  - Live, production, warm connection, server wait (time to first byte minus connection setup):

    | Path                          | What the Worker does               | Samples (ms)                    |
    | ----------------------------- | ---------------------------------- | ------------------------------- |
    | `/health`                     | nothing                            | 30, 29, 25, 29 (first: 41)      |
    | `/images/not-an-image_` (404) | enters `handleApi`, no auth, no D1 | 28 (first: 36)                  |
    | `/api/me` (401)               | `createAuth` + `getSession`        | 344, 351                        |
    | `/api/runs` (401)             | `createAuth` + `getSession`        | 369, 366, 366, 384 (first: 413) |

  - Local experiment (`auth-guest-cost.mjs`, repository migrations applied to an in-memory SQLite, the same better-auth options):

    ```
    {"mode":"guest","session":null,"databaseStatements":76,"databaseRoundTrips":2,"batchCalls":1,
     "statementKinds":[["all select \"name\", \"type\", \"sql\" from \"sqlite_master\" ...",1],["all SELECT * FROM pragma_table_info(?)",75]]}
    guest --no-validate  -> "databaseStatements":0
    guest --shared       -> 76 statements on the first call, 0 on calls 2 to 4
    construct-only       -> "databaseStatements":76 (no auth API was called)
    ```

- **What happens:** `createAuth` runs for each request. Each new better-auth instance reads `sqlite_master` (1 query) and then sends 1 batch with one `pragma_table_info` statement for each table and view in the whole database (75 with the current migrations). The auth call waits for both. This happens before the cookie is read, so a guest with no cookie pays it too.
- **Impact:** About 315 to 340 ms is added to every API request at this location (344 to 384 ms measured, against 28 ms for the same Worker without auth). This is the largest single part of the "Checking access" wait: 375 of 406 ms on the home page. It also applies to each `/api/operations` poll, each `/state` poll, and each review command. Each request reads about 855 schema rows (230 in `sqlite_master` and 625 from `pragma_table_info`, counted locally). Anonymous requests to `/api/*` cause these reads too. Requests to `/v1/*` also build the instance (`api/index.ts:130` is before the `/v1` routes), so CI uploads start the same check in the background. That last point is shown locally only, not in the Workers runtime.
- **Recommendation:** Turn the runtime check off. The deploy workflow applies the D1 migrations before it deploys the Worker (`.github/workflows/deploy.yml:127-133`).

  ```ts
  // packages/security/src/auth.ts
  advanced: {
    cookiePrefix: `visonaut-${configuration.environment}`,
    useSecureCookies: configuration.environment !== "local",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    // Migrations run at deploy. Do not introspect the schema on each request.
    database: { validateSchema: false },
  },
  ```

  Then measure `/api/me` again. The local experiment gives 0 statements for a guest and 2 (session, user) for a signed-in request.

- **Alternatives:**
  - Minimal: the one-line option above.
  - Keep the check, but build one instance for each isolate (a module-level `WeakMap<D1Database, VisonautAuth>`). The check then runs once for each isolate. Risk: the comment at `auth.ts:15` says that the per-request instance is deliberate. A pending check that two requests share can cross request contexts in workerd.
  - Keep the check and move it to a deploy step (a script that compares the schema one time).
  - Do nothing. The cost stays on each request.
- **Maintainer decision needed:** yes. Is the runtime schema check wanted, given that deploy applies migrations first?

### LIVE-02 · One D1 round trip costs about 90 ms here, and a signed-in API request makes 6 to 9 of them in series

- **Kind:** performance
- **Severity:** high. **Confidence:** medium. **Measured:** yes (the cost of one query). The signed-in totals are counted from code. **Effort:** M
- **Evidence:**
  - `apps/web/src/api/index.ts:123-126`: `if (!path.startsWith("/api/auth/") && !dashboardRead) { await assertConfiguredProject(context); }`. This is 1 point query (`packages/service/src/service.ts:104-106`) that `GET /api/runs` skips and `GET /api/runs/<id>` runs.
  - Live, production, guest, warm connection: `/api/runs` 366 to 384 ms (first 413). `/api/runs/<id>` 453, 456 ms (first 517). Difference: 87 to 133 ms for 1 extra D1 query.
  - Local experiment, signed-in session: `"databaseStatements":78,"databaseRoundTrips":4` for `getSession` (schema check 2, session 1, user 1). Then `authorization.ts:40-43` adds the account query.
  - `apps/web/src/api/operations.ts:16-18` reads `visonaut_projects` again after `assertConfiguredProject` (`apps/web/src/api/context.ts:128-141`) already read it in the same request.
  - `apps/web/wrangler.jsonc` has no `placement` key (`rg -n "placement|smart"` gives no match).
- **What happens:** Each `await` on D1 is one round trip from the Worker (near the user) to the database region. The requests are in series. The table in "How it works" gives 6 round trips for `GET /api/runs` and 9 for `GET /api/operations` when the user is signed in.
- **Impact:** At about 90 ms each, the D1 time alone is about 0.5 s for the run list and about 0.8 s for the operations badge at this location. A GitHub permission check is added when the 60 s cache is cold. The exact signed-in times were not measured. A user near the database region pays less for each round trip.
- **Recommendation:** Reduce the number of round trips first, then the cost of each one.
  1. Remove the schema check (LIVE-01): 2 less on each request.
  2. Read the session and the user in one query. better-auth has an `experimental.joins` option (`init-options.d.mts:389`).
  3. Remove the second project read in `operationsStatus`, or put the three reads in one `database.batch([...])`.
  4. Run the Worker near the database with Smart Placement, so that N round trips become 1 long hop. Check the current Cloudflare documentation for the exact key:

     ```jsonc
     // apps/web/wrangler.jsonc, env.production
     "placement": { "mode": "smart" }
     ```

     Trade-off: the SSR document then also runs near the database. Static assets stay at the edge.
- **Alternatives:**
  - Minimal: items 1 and 3 only (3 less for `/api/operations`).
  - D1 read replication with the Sessions API for the read-only routes.
  - A short in-isolate cache from session token to account ID, like the existing permission cache.
- **Maintainer decision needed:** yes. Where is the D1 primary region, and is it acceptable that SSR documents run near the database?

### LIVE-03 · The first data request starts only after all JavaScript has loaded and run

- **Kind:** performance
- **Severity:** high. **Confidence:** high. **Measured:** yes. **Effort:** M
- **Evidence:**
  - `apps/web/src/routes/index.tsx:161`: `useState<DashboardState>({ status: "loading" })`. `:176-210`: the fetch is in `useEffect`. `:275-279`: the loading line.
  - `apps/web/src/routes/runs.$runId.tsx:31`: `ssr: false`. `:37-47`: the loader runs in the browser only.
  - Production document body text (decoded HTML, 28,950 bytes): `"visonaut. Review queue Run history Service status Checking access and loading runs…"`.
  - Browser runs on production, guest:

    | Run                            | Document complete | API request starts | API response | Loading line on screen   |
    | ------------------------------ | ----------------- | ------------------ | ------------ | ------------------------ |
    | Home, cold                     | 94 ms             | 231 ms             | 607 ms       | 204 to 610 ms (406 ms)   |
    | Home, warm                     | 96 ms             | 205 ms             | 625 ms       | 178 to 632 ms (454 ms)   |
    | Home, cold, 4x CPU and slow 4G | 705 ms            | 2729 ms            | 3302 ms      | 2375 to 3315 ms (940 ms) |
    | Run page, cold                 | 504 ms            | 1030 ms            | 1539 ms      | 1009 to 1544 ms (535 ms) |

- **What happens:** The server sends a page that always says "Checking access". The browser must download and run about 205 KB (compressed) of JavaScript before it asks the server who the user is. The server then repeats the auth work (LIVE-01, LIVE-02).
- **Impact:** The wait is a chain: document, then scripts, then API, then render. On a slow link the API request starts 2.0 s after the document is complete. Each visitor sees the loading line, also a guest for whom the server needs no database to know the answer (there is no session cookie).
- **Recommendation:** Decide access while the server renders the document.
  - No session cookie: render the sign-in view in SSR. No API request and no loading line.
  - Session cookie: load the run list (or the review model) in a server loader and send it with the document.

  ```tsx
  // apps/web/src/routes/index.tsx (sketch)
  export const Route = createFileRoute("/")({
    loader: () => loadDashboard(), // server function: guest | forbidden | ready
    component: Index,
  });
  ```

- **Alternatives:**
  - Minimal: start the request early. An inline script with the SSR nonce in the document head starts the fetch while the scripts download, and the component uses that promise.

    ```tsx
    // head of the document for "/", sketch
    <script
      nonce={nonce}
    >{`window.__runs = fetch("/api/runs", { credentials: "same-origin", cache: "no-store" })`}</script>
    ```

    This removes the script download time from the wait (about 140 ms on this link, about 2.0 s on slow 4G in the runs above).

  - Keep client fetching and remove `ssr: false` from the run route so that the shell is at least the correct layout.
  - Do nothing.
- **Maintainer decision needed:** yes. May the document request do the access check and the data load on the server?

### LIVE-04 · `/api/operations` starts only after `/api/runs` ends, and each request repeats the auth work

- **Kind:** performance
- **Severity:** medium. **Confidence:** high. **Measured:** no (it needs a session). **Effort:** S
- **Evidence:**
  - `apps/web/src/routes/index.tsx:254-256`: `{state.status === "ready" && !state.preview && view !== "service" && (<OperationsAttention ... />)}`.
  - `apps/web/src/components/operations-attention/index.tsx:233`: `fetch("/api/operations", ...)`. `:280`: `timeout = setTimeout(load, 60000);`.
  - Round trips: 9 D1 round trips for one `/api/operations` request (table in "How it works").
- **What happens:** The header badge waits for the run list, then sends its own request. That request does the origin check, the project check, the schema check, the session read, the account read, and three more reads.
- **Impact:** The dashboard needs two API requests in series. The second one costs about 0.8 s of D1 time at this location (computed from LIVE-02). An open tab repeats it each 60 s, which is 9 round trips and about 855 schema rows for each poll.
- **Recommendation:** Start both requests at the same time, or return the alert summary in the `/api/runs` response.

  ```tsx
  // index.tsx sketch: do not gate the badge on the run list
  {
    state.status !== "guest" && view !== "service" && (
      <OperationsAttention onAccessDenied={onAccessDenied} />
    );
  }
  ```

- **Alternatives:** Minimal: keep two requests, start them in parallel. Larger: one dashboard endpoint for runs, project, and alerts. Or load alerts only when the user opens the popover.
- **Maintainer decision needed:** no.

### LIVE-05 · Hashed assets are served with `max-age=0, must-revalidate`

- **Kind:** performance
- **Severity:** medium. **Confidence:** high. **Measured:** yes. **Effort:** S
- **Evidence:**
  - `curl https://visonaut.com/assets/index-CXm4JU5N.css`: `cache-control: public, max-age=0, must-revalidate`, `etag: W/"9e4cfd6955347432dd08ee4c96daa415"`, `cf-cache-status: HIT`. The entry script and the favicon have the same header.
  - Warm load of the production home page: 10 conditional requests, all `304`, 452 to 470 bytes each, 46 to 98 ms wait each. The document arrived at 96 ms. The scripts were usable at 150 to 165 ms.
  - `ls apps/web/public` gives only `favicon.svg`. The generated config has `"assets": { "directory": "../client" }` and no header rules.
- **What happens:** The file names contain a content hash, but the browser must ask the server for each file on each page load.
- **Impact:** 10 extra round trips on each repeat visit to the home page and 11 on the run page. Script execution waits for the slowest `304` (about 60 ms here, more on a slow or far link).
- **Recommendation:** Add a headers file for the hashed directory. Check it with `wrangler dev` and one `curl -I`.

  ```
  # apps/web/public/_headers
  /assets/*
    Cache-Control: public, max-age=31536000, immutable
  ```

- **Alternatives:** Keep the default for `favicon.svg` (its name has no hash). Or do nothing.
- **Maintainer decision needed:** no.

### LIVE-06 · A cold Worker adds about 300 to 450 ms to the document

- **Kind:** performance
- **Severity:** medium. **Confidence:** medium. **Measured:** yes. **Effort:** M
- **Evidence:**
  - Document server wait and Cloudflare `server-timing`:

    | Request                                                   | First request after idle                   | Later requests on the same connection                       |
    | --------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
    | Preview `/` (curl)                                        | 370 ms, `cfEdge;dur=266, cfWorker;dur=75`  | 97, 85, 75, 56 ms, `cfEdge` 10 to 14, `cfWorker` 8 to 20    |
    | Production `/` (curl)                                     | 406 ms, `cfEdge;dur=267, cfWorker;dur=112` | 91, 131, 130, 118 ms, `cfEdge` 9 to 21, `cfWorker` 13 to 28 |
    | Preview `/` (browser, 5.5 minutes after the last request) | 511 ms, `cfEdge;dur=265, cfWorker;dur=79`  | not sampled                                                 |
    | Preview `/runs/<id>` (browser)                            | 354 ms, `cfEdge;dur=199, cfWorker;dur=49`  | not sampled                                                 |

  - Local build at HEAD (`apps/web/dist/server`): 33 JavaScript files, 4,104,202 bytes, 888,351 bytes gzip. `index.js` is 2,098,815 bytes in 46,193 lines, so it is not minified. The generated config has `"no_bundle": true`.
- **What happens:** After a few idle minutes the first request must load and start the Worker again. `cfEdge` rises from about 15 ms to 200 to 267 ms.
- **Impact:** The first page of a session often pays this, because the tool has little traffic. It adds to the chain in LIVE-03. The production cron (`*/5 * * * *`) keeps one isolate warm in one location only.
- **Recommendation:** Measure the startup first, then reduce it. `wrangler check startup` gives a CPU profile of the Worker startup without a deploy. Candidates: minify the server build, and load the API and operations code with a dynamic import so that document requests do not evaluate it.
- **Alternatives:** Do nothing and accept the cost for the first request. Or split the API into its own Worker.
- **Maintainer decision needed:** no.

### LIVE-07 · One 465 KB stylesheet blocks the first paint, and the HTML is mostly class names

- **Kind:** performance
- **Severity:** medium. **Confidence:** high. **Measured:** yes. **Effort:** M
- **Evidence:** Production, cold home page (bytes on the wire and decoded):

  | File                                   | Wire    | Decoded |
  | -------------------------------------- | ------- | ------- |
  | `index-CXm4JU5N.css` (render-blocking) | 46,757  | 464,666 |
  | `index-MxeSnhFR.js`                    | 105,718 | 319,611 |
  | `app-shell-rQLLgOsf.js`                | 42,964  | 139,641 |
  | `badge.ariakit.react-CyMRzBLT.js`      | 20,843  | 53,323  |
  | `routes-DOmkFmT0.js`                   | 13,516  | 41,664  |
  | `react-Dfu8Q4go.js`                    | 12,862  | 31,168  |
  | `preload-helper-B-8p3_4s.js`           | 7,343   | 15,947  |
  | `git-pull-request-DhyqwrD4.js`         | 799     | 474     |
  | `rotate-ccw-DxwNi5rf.js`               | 675     | 234     |
  | Document `/`                           | 7,131   | 28,950  |

  The run page adds `runs._runId-QUJlDVZ1.js` (46,757 wire, 137,841 decoded) and `arrow-left-D1LfnDKV.js` (645 wire, 199 decoded). In the document, `class="..."` attributes are 20,957 of 28,950 bytes (72%). The visible text is 82 characters. With 4x CPU and slow 4G the stylesheet finished at 2309 ms and FCP was 2392 ms.

- **What happens:** All routes share one stylesheet. The sign-in view needs it in full before the first paint. Three icon chunks of 199 to 474 bytes are separate requests whose headers are larger than their content.
- **Impact:** On a fast link the effect is small (FCP 228 ms). On a slow link the first paint waits about 2.4 s. Each tiny chunk is also one more revalidation request (LIVE-05).
- **Recommendation:** Find out why the stylesheet is 465 KB before any change (another lane inspects the build). Then consider one stylesheet for each route group and inlined icons.
- **Alternatives:** Do nothing for the stylesheet and fix only the caching (LIVE-05). Repeat visits then do not download it again.
- **Maintainer decision needed:** no.

### LIVE-08 · Cloudflare Web Analytics is injected into every page, and the repository does not mention it

- **Kind:** inconsistency
- **Severity:** low. **Confidence:** high. **Measured:** yes. **Effort:** S
- **Evidence:**
  - Both hosts add this to each HTML document: `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/v31edd6df..." data-cf-beacon='{"version":"2024.11.0","token":"201b3c8e...","r":1,"spa":2}' nonce="...">`.
  - The browser run recorded `POST https://visonaut.com/cdn-cgi/rum?` with status 204 on each page load.
  - `rg -i "cloudflareinsights|web analytics|cdn-cgi/rum"` over the repository gives no match.
  - `packages/security/src/http.ts:40-44` allows only `'self'` and the nonce in `script-src`. Cloudflare copies the nonce to its own tag, so the third-party script runs.
- **What happens:** A zone setting in the Cloudflare dashboard adds a third-party script (10,338 bytes) and one POST for each page view. It also adds `server-timing: cfEdge, cfOrigin, cfWorker` to documents.
- **Impact:** The effective script policy is wider than the code says. Maintainer page views go to an analytics product that the documents do not name. On the positive side, the dashboard already has real-user load times for these pages, which can confirm or correct the numbers in this report.
- **Recommendation:** Decide and write it down. If it is wanted, name it in `docs/development.md` and use its Core Web Vitals data. If it is not wanted, turn off the automatic setup for the zone.
- **Alternatives:** Keep it for production only. Or keep it and add no documentation.
- **Maintainer decision needed:** yes. Is Web Analytics on these hosts intended?

### LIVE-09 · The preview deployment does not match `main`

- **Kind:** inconsistency
- **Severity:** medium. **Confidence:** high. **Measured:** yes. **Effort:** S
- **Evidence:**
  - Preview HTML: `<p role="status">Checking access and loading runs…</p>` with no classes, a header that says `Repository`, and the assets `review-D6dKKXbW.css`, `shell.ariakit.react-lWx6ixWa.js`, `nav.ariakit.react-CM2-ZY_K.js`.
  - `git grep "Checking access and loading runs" e277a91 242d371 f83fef6 -- apps/web/src/routes/index.tsx` shows that markup at `e277a91` and `242d371`, and the new markup at `f83fef6`.
  - Production HTML references `index-CXm4JU5N.css` and `app-shell-rQLLgOsf.js`, the same names as the local build of HEAD.
  - `.github/workflows/deploy.yml:4-5` deploys production on each push to `main`. `:11` and `:292-294` make `preview-web` a manual dispatch.
  - `/health` on preview returns `{"service":"visonaut","status":"setup","launchEnabled":false,"environment":"preview","fixtureMode":true}`. It has no commit or version.
- **What happens:** Production follows `main`. Preview changes only when a person starts the workflow.
- **Impact:** The public demo shows the old UI. Nobody can use preview to check a change that is already on `main`. An outside check cannot detect the difference without a markup comparison.
- **Recommendation:** Add the build commit to `/health`, and choose how preview follows `main`.

  ```ts
  // server.ts /health sketch, value injected at build time
  commit: import.meta.env.VITE_COMMIT_SHA,
  ```

- **Alternatives:** Deploy preview in the same job as production. Or keep the manual step and state it in `.github/workflows/README.md`.
- **Maintainer decision needed:** yes. Must preview follow `main` automatically?

### LIVE-10 · Unknown URLs give a bare "Not Found" page

- **Kind:** ux
- **Severity:** low. **Confidence:** high. **Measured:** yes. **Effort:** S
- **Evidence:**
  - `curl https://visonaut.com/assets/does-not-exist-00000000.js`: status 404, `content-type: text/html`, body `<body><p>Not Found</p>...`, 2,414 bytes decoded, 46 ms server wait.
  - `apps/web/src/router.tsx:7-9` and `apps/web/src/routes/__root.tsx:5-16` set no `notFoundComponent`. `rg "notFoundComponent|defaultNotFoundComponent" apps/web/src` gives no match.
- **What happens:** A path that no route matches gets the default router output: one unstyled paragraph, with no header and no link.
- **Impact:** A wrong or old link gives a dead end. A missing asset also costs one SSR render in the Worker.
- **Recommendation:** Add a not-found component that uses the app shell and links to the queue.

  ```tsx
  // __root.tsx sketch
  export const Route = createRootRoute({ notFoundComponent: NotFound, ... });
  ```

- **Alternatives:** Return a plain 404 for `/assets/*` misses before SSR. Or do nothing.
- **Maintainer decision needed:** no.

### LIVE-11 · No recovery when a lazy chunk is missing after a deploy

- **Kind:** bug
- **Severity:** low. **Confidence:** low. **Measured:** no. **Effort:** S
- **Evidence:**
  - A missing file under `/assets/` returns 404 HTML (LIVE-10).
  - `rg "vite:preloadError|preloadError" apps/web/src` gives no match.
  - The run route is a separate chunk (`runs._runId-QUJlDVZ1.js`), loaded on navigation from the queue.
  - Production deploys on each push to `main` (`deploy.yml:4-5`), and the hashed names change with the content.
- **What happens:** This was not reproduced. The expected sequence: a tab loaded before a deploy navigates in the client to a route whose chunk has a new name. The import gets 404 HTML and fails.
- **Impact:** A maintainer with an open tab can get a route error after a deploy until a full reload. LIVE-05 does not change this.
- **Recommendation:** Reload one time on a preload error.

  ```ts
  // client entry sketch
  window.addEventListener("vite:preloadError", () => window.location.reload());
  ```

- **Alternatives:** Verify first: deploy, keep an old tab open, open a run. Or do nothing.
- **Maintainer decision needed:** no.

### LIVE-12 · Error bodies and headers differ between routes

- **Kind:** inconsistency
- **Severity:** low. **Confidence:** high. **Measured:** yes. **Effort:** S
- **Evidence:**
  - `GET /api/runs` as guest: `{"schemaVersion":"1.0","error":{"code":"sign_in_required","message":"Sign in with GitHub."}}`, no `Retry-After` (`apps/web/src/api/index.ts:36-44`).
  - `GET /api/me` as guest: `{"error":{"code":"sign_in_required","message":"Sign in with GitHub."}}` with `retry-after: 1` (`apps/web/src/server.ts:34-53`). The same path calls `logOperationFailure` for this normal 401 (`server.ts:119-127`).
  - `GET /health`: `cache-control: no-store` only. No `strict-transport-security`, no `x-content-type-options` (`server.ts:60-71` does not call `securePrivateResponse`).
  - `GET /images/not-an-image_`: 404 with `cache-control: no-store` and `x-content-type-options: nosniff` only (`api/index.ts:117-122`).
- **What happens:** Three code paths build error responses by hand. Each one has a different body shape and header set.
- **Impact:** A client cannot rely on one error shape. `Retry-After: 1` on a 401 tells a client to retry a request that cannot succeed. A guest request to `/api/me` is logged as a failed operation.
- **Recommendation:** Use one error builder for `server.ts` and `api/index.ts`, send `Retry-After` only with 503, and do not log 401 and 403 as failures.
- **Alternatives:** Fix only the `Retry-After` and the log line. Or do nothing.
- **Maintainer decision needed:** no.

### LIVE-13 · API responses have no application `Server-Timing`

- **Kind:** dx
- **Severity:** low. **Confidence:** high. **Measured:** yes. **Effort:** S
- **Evidence:** All 31 sampled API and health responses have no `server-timing` header. Documents have only the Cloudflare values (`cfEdge`, `cfOrigin`, `cfWorker`). `apps/web/src/server.ts:57` already records `startedAt` for each request.
- **What happens:** The Worker does not report how long auth, GitHub, and D1 took.
- **Impact:** The cause in LIVE-01 was found only with path comparisons and a local experiment. A maintainer cannot see in DevTools why one request is slow.
- **Recommendation:** Add timings for authenticated responses.

  ```ts
  // api/index.ts sketch
  const timings: string[] = [];
  const timed = async <T>(name: string, run: () => Promise<T>) => {
    const start = Date.now();
    try { return await run(); } finally { timings.push(`${name};dur=${Date.now() - start}`); }
  };
  const identity = await timed("auth", () => requireMaintainer({ ... }));
  // ...
  result.headers.set("Server-Timing", timings.join(", "));
  ```

- **Alternatives:** Use Workers traces only (already enabled in `wrangler.jsonc:15-20`). Or do nothing.
- **Maintainer decision needed:** no.

### LIVE-14 · Each return to the queue loads the run list again and shows the loading line again

- **Kind:** performance
- **Severity:** medium. **Confidence:** high. **Measured:** no (it needs a session). **Effort:** M
- **Evidence:**
  - `apps/web/src/routes/index.tsx:161`: each mount starts with `{ status: "loading" }`. `:176-210`: each mount fetches `/api/runs`. The route has no loader and no cache.
  - `apps/web/src/routes/runs.$runId.tsx:35-36`: `gcTime: 0, staleTime: Infinity`. The model is dropped when the user leaves the route.
  - `packages/security/src/http.ts:33`: documents are `no-store, private`.
- **What happens:** The data lives only in component state. A client navigation from a run to the queue mounts `Index` again, so the full API wait repeats (LIVE-02).
- **Impact:** The review loop (queue, run, queue, next run) shows the loading line at each step. The run list that was on screen seconds ago is not shown.
- **Recommendation:** Keep the last result and show it while the new request runs.

  ```tsx
  // sketch: route loader with a cache
  export const Route = createFileRoute("/")({ loader: loadRuns, staleTime: 30_000, ... });
  ```

- **Alternatives:** A module-level variable with the last dashboard state. Or do nothing.
- **Maintainer decision needed:** no.

## Measurements (command, raw result, limits)

All raw files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/live/`.

### Limits and deviations

- **Location:** one macOS machine. All `cf-ray` values end in `-GRU`. TCP connect to the edge took 17 to 24 ms in normal samples.
- **Clients:** curl 8.7.1 (HTTP/2, `Accept-Encoding: gzip, deflate, br, zstd`). Chrome 154.0.8037.98, headless, through Playwright, viewport 1440 by 900. Chrome used HTTP/3.
- **Guest only:** no cookie and no credential. A guest request never reaches the session, account, GitHub, or handler queries. All signed-in costs in this report are counted from code.
- **Preview:** no D1 and no GitHub. It serves an older build (LIVE-09).
- **Request count:** 119 of 120. 76 to `visonaut.com` and 43 to `preview.visonaut.com`. One more GET went to `static.cloudflareinsights.com` (third party, the beacon script). The ledger is `ledger.json`.
- **Deviation from "never POST":** the first browser run (production home, cold and warm) let the injected Cloudflare beacon run. It sent 2 requests `POST https://visonaut.com/cdn-cgi/rum?` (status 204). Cloudflare's edge handles this path. The Worker does not see it, and no application state changed. The effect is 2 page-view records in the zone's Web Analytics. The guard had covered only `cloudflareinsights.com`. From the second browser run on, the script, `/cdn-cgi/rum`, and each non-GET request were blocked with CDP `Fetch.failRequest`. A local test proved the block (`"post":"blocked:Failed to fetch"`). The 2 POSTs are included in the 119.
- **Sample count is lower than requested.** One page load costs 11 to 13 requests, so 5 cold and 5 warm loads for each page do not fit in 120 requests. Done: 5 curl samples for `/` on both hosts and for `/health` and `/api/runs` on production, 2 to 3 for the other paths. Browser: 1 cold load for each of 4 pages, 1 warm load and 1 throttled load for the production home page. There is no browser sample of a warm or throttled preview page.
- **Single browser samples vary.** Two of five cold loads waited 360 to 640 ms for assets that had `cf-cache-status: HIT`. Do not read the browser numbers as medians.
- **Blocked in browser runs 2 to 5:** the beacon script and `/favicon.svg`. This removes one third-party script and one small request from those loads.
- **Throttle profile:** CDP `Emulation.setCPUThrottlingRate {rate: 4}` and `Network.emulateNetworkConditions {latency: 562.5, downloadThroughput: 188743, uploadThroughput: 86400}` (the DevTools "Slow 4G" values).

### curl samples

Command form (one invocation for each group, so the first sample has a new connection and the others reuse it):

```sh
curl -s -H 'Accept-Encoding: gzip, deflate, br, zstd' -w '%{json}\n%{header_json}\n' -o /dev/null <url> -o /dev/null <url> ...
node summarize-curl.mjs <capture.jsonl>
```

"Wait" is `time_starttransfer - time_pretransfer`. Times are in ms. Sizes are bytes on the wire and decoded.

| Host and path                             | Status, HTTP | First sample: DNS, TCP, TLS, wait, total | Other samples: wait | Size               | Headers                                                                                                                                                                                       |
| ----------------------------------------- | ------------ | ---------------------------------------- | ------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prod `/`                                  | 200, h2      | 332, 92, 125, 406, 955                   | 91, 131, 130, 118   | 6,337 / 28,950     | `no-store, private`, zstd, CSP with nonce, `server-timing: cfEdge;dur=267,cfOrigin;dur=0,cfWorker;dur=112` then `cfEdge` 9 to 21 and `cfWorker` 13 to 28. No `etag`, `age`, `cf-cache-status` |
| preview `/`                               | 200, h2      | 325, 24, 30, 370, 750                    | 97, 85, 75, 56      | 3,289 / 10,643     | same set. `cfEdge;dur=266,cfWorker;dur=75` then `cfEdge` 10 to 14 and `cfWorker` 8 to 20                                                                                                      |
| prod `/health`                            | 200, h2      | 2, 16, 30, 41, 90                        | 30, 29, 25, 29      | 94 / 107           | `no-store`, zstd. No security headers, no `server-timing`                                                                                                                                     |
| preview `/health`                         | 200, h2      | 590, 23, 31, 195, 839                    | 46, 116             | 93 / 104           | same                                                                                                                                                                                          |
| prod `/api/runs`                          | 401, h2      | 11, 15, 28, 413, 467                     | 369, 366, 366, 384  | 92, not compressed | `no-store, private`, no `server-timing`                                                                                                                                                       |
| prod `/api/me`                            | 401, h2      | reused connection                        | 344, 351            | 70                 | `retry-after: 1`                                                                                                                                                                              |
| prod `/api/runs/<id>`                     | 401, h2      | reused connection                        | 517, 453, 456       | 92                 |                                                                                                                                                                                               |
| prod `/images/not-an-image_`              | 404, h2      | 3, 211, 82, 36, 331                      | 28                  | 9                  | `no-store`, `nosniff`                                                                                                                                                                         |
| prod `/runs/<id>`                         | 200, h2      | reused connection                        | 62                  | 6,284 / 28,570     | as `/`                                                                                                                                                                                        |
| prod `/assets/index-CXm4JU5N.css`         | 200, h2      | 2, 18, 34, 73, 135                       |                     | 46,249 / 464,666   | `public, max-age=0, must-revalidate`, `etag: W/"9e4c..."`, `cf-cache-status: HIT`, zstd, no `age`                                                                                             |
| prod `/assets/index-MxeSnhFR.js`          | 200, h2      | reused connection                        | 58                  | 105,183 / 319,611  | same                                                                                                                                                                                          |
| prod `/favicon.svg`                       | 200, h2      | reused connection                        | 48                  | 155 / 180          | same                                                                                                                                                                                          |
| prod `/assets/does-not-exist-00000000.js` | 404, h2      | 2, 15, 32, 46, 95                        |                     | 1,046 / 2,414      | `text/html`, `no-store, private`                                                                                                                                                              |
| preview `/api/runs` (19:35)               | 200, h2      | reused connection                        | 154, 430, 298       | 243 / 594          |                                                                                                                                                                                               |
| preview `/api/runs` (19:43)               | 200, h2      | 289, 165, 98, 329, 881                   | 25, 39              | 243 / 594          |                                                                                                                                                                                               |
| preview `/api/runs/<id>`                  | 200, h2      | reused connection                        | 404, 187            | 974 / 8,107        |                                                                                                                                                                                               |
| preview `/runs/<id>`                      | 200, h2      | reused connection                        | 77                  | 2,996 / 9,870      |                                                                                                                                                                                               |
| preview `/api/me`                         | 403, h2      | reused connection                        | 28                  | 105 / 112          | `preview_fixtures_only`                                                                                                                                                                       |

The two preview `/api/runs` groups differ by a factor of ten. The fixture path has no I/O, so the first group shows network or isolate variance, not application cost.

### Browser runs

Command form:

```sh
node measure.mjs --url <url> --label <name> --expect <n> --ready <mark> [--warm] [--cpu 4 --net slow4g]
node summarize-run.mjs run-<name>.json --waterfall
```

Marks are `performance.now()` values taken in a `requestAnimationFrame` loop. "Loading line" is the `role="status"` element with "Checking access". Times are in ms from navigation start.

| Run                                             | TTFB               | FCP  | Loading line visible | API start to response (wait) | Target visible        | LCP  | Requests, bytes             |
| ----------------------------------------------- | ------------------ | ---- | -------------------- | ---------------------------- | --------------------- | ---- | --------------------------- |
| Production `/`, guest, cold                     | 91                 | 228  | 204                  | 231 to 607 (375)             | sign-in 616           | 624  | 13 + beacon script, 270,016 |
| Production `/`, guest, warm                     | 96                 | 200  | 178                  | 205 to 625 (419)             | sign-in 640           | 648  | 13 (10 are `304`), 12,299   |
| Production `/`, guest, cold, 4x CPU and slow 4G | 157 (complete 705) | 2392 | 2375                 | 2729 to 3302 (325)           | sign-in 3343          | 3352 | 11, 258,764                 |
| Production `/runs/<id>`, guest, cold            | 503                | 1024 | 1009                 | 1030 to 1539 (505)           | sign-in card 1549     | 1556 | 12, 293,461                 |
| Preview `/`, cold (older build)                 | 648                | 780  | 761                  | 848 to 903 (33)              | queue content 926     | 952  | 12, 248,994                 |
| Preview `/runs/<id>`, cold (older build)        | 501                | 1192 | 1186                 | 1206 to 1240 (31)            | first screenshot 1314 | 1560 | 13, 260,206                 |

Main thread, from CDP `Performance.getMetrics`: production home 32 ms script and 76 ms task time, no long task. With 4x CPU: 125 ms script and 309 ms task time, one long task of 58 ms. Preview run page: 58 ms script and 146 ms task time, one long task of 71 ms, CLS 0.0175.

Waterfall of the production home page, cold (start, first byte, end, in ms from the first request):

```
    0   93   93  200 h3 Document    7131   28950  /                                  [no-store, private] zstd cfEdge;dur=19,cfWorker;dur=9
   95  167  187  200 h3 Stylesheet 46757  464666  /assets/index-CXm4JU5N.css         [public, max-age=0, must-revalidate] zstd HIT
   95  183  181  200 h3 Script    105718  319611  /assets/index-MxeSnhFR.js          same
   95  184  183  200 h3 Script     42964  139641  /assets/app-shell-rQLLgOsf.js      same
   95  174  174  200 h3 Script      7343   15947  /assets/preload-helper-B-8p3_4s.js same
   95  175  174  200 h3 Script     13516   41664  /assets/routes-DOmkFmT0.js         same
   95  184  183  200 h3 Script     20843   53323  /assets/badge.ariakit.react-CyMRzBLT.js same
   95  175  175  200 h3 Script       799     474  /assets/git-pull-request-DhyqwrD4.js same
   96  183  183  200 h3 Script     12862   31168  /assets/react-Dfu8Q4go.js          same
   96  175  175  200 h3 Script       675     234  /assets/rotate-ccw-DxwNi5rf.js     same
   96  216  207  200 h2 Script     10338          static.cloudflareinsights.com/beacon.min.js  [public, max-age=86400] gzip
  221  240  239  204 h3 XHR POST     443          /cdn-cgi/rum
  226  255  255  200 h3 Other        627     180  /favicon.svg
  231  607       401 h3 Fetch                     /api/runs                          [no-store, private]
```

The warm load has the same rows with wire status `304` and 452 to 470 bytes for the 9 assets and the favicon.

Screenshots: `shot-prod-home-guest-cold.png`, `shot-prod-run-guest-cold.png`, `shot-preview-home-cold.png`, `shot-preview-run-cold.png`.

### Local experiment for LIVE-01 and LIVE-02 (no network)

`auth-guest-cost.mjs` builds better-auth 1.7.5 with the options from `packages/security/src/auth.ts`. The database is an in-memory `node:sqlite` with all files in `apps/web/migrations` applied (75 tables and views), behind a D1-shaped object that counts statements. `--delay 90` makes each round trip wait 90 ms.

| Command                                                     | Statements | Round trips | Time                    |
| ----------------------------------------------------------- | ---------- | ----------- | ----------------------- |
| `node auth-guest-cost.mjs guest --delay 90`                 | 76         | 2           | 184 ms                  |
| `node auth-guest-cost.mjs guest --delay 90 --no-validate`   | 0          | 0           | under 1 ms              |
| `node auth-guest-cost.mjs guest --delay 90 --shared`        | 76, then 0 | 2, then 0   | 195 ms, then under 1 ms |
| `node auth-guest-cost.mjs session --delay 90`               | 78         | 4           | 368 ms                  |
| `node auth-guest-cost.mjs session --delay 90 --no-validate` | 2          | 2           | 184 ms                  |
| `node auth-guest-cost.mjs construct-only --delay 20`        | 76         | 2           | not applicable          |

Limits: Node, not workerd. The 90 ms delay is a model. In production the batch of 75 statements takes longer than one point query, which agrees with the measured 315 to 340 ms for the two round trips. The production table count can differ from 75.

## Open questions and items not verified

- **Signed-in timings.** No session was used. The time to the review queue and to the first real screenshot for a maintainer is not measured. The Cloudflare Web Analytics data (LIVE-08) or a HAR from a maintainer session can supply it.
- **D1 region.** The 87 to 133 ms for one query was measured from GRU only. The primary region is not in the repository. A user near that region pays less.
- **Why the two schema round trips take about 320 ms.** The split between the `sqlite_master` query and the 75-statement batch was not measured.
- **Does a `/v1/*` request send the schema queries in workerd?** The local test says that building the instance sends them. The Workers runtime can cancel work that nothing awaits. Check `rows_read` for one upload request in the D1 metrics.
- **GitHub cost on a cold permission cache.** Up to 3 GitHub API calls. Not measured.
- **Image latency.** Each `/images/<id>` costs 1 D1 query and 1 R2 read on the first load. Not measured.
- **Cold start cause.** The 300 to 450 ms is measured. That the 4.1 MB unminified server build causes it is an assumption. `wrangler check startup` can test it.
- **Stale chunks after a deploy (LIVE-11).** Not reproduced.
- **Preview fixture API variance.** Samples from 25 to 430 ms for a path with no I/O. Cause not found.
- **Asset stalls.** Two cold loads waited 360 to 640 ms on cached assets. This can be the test link or the QUIC connection. More samples are needed, and the request cap did not allow them.
- **`workers_dev: true`** is set for both environments (`apps/web/wrangler.jsonc:7`, `:48`). The `workers.dev` host was not tested, because it is not one of the two hosts of this lane.
