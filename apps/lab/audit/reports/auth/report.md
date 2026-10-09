# Authentication, authorization, and GitHub client cost

Scope: `packages/security/src` (all files) and its use in `apps/web` (`server.ts`, `runtime.ts`, `api/index.ts`, `api/context.ts`, `api/review.ts`, the three routes, and the review client).

Paths are relative to the worktree root. "RT" means one D1 round trip (one `all`, `first`, `run`, or `batch` call). All counts in this report come from the harness in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/auth/`. See [Measurements](#measurements-command-raw-result-limits).

The three largest facts:

1. Each request that touches Better Auth runs a full schema check of the D1 database: 2 RTs, 76 statements, 856 rows read, about 85 KB of result data. The check has no effect on the result of the request.
2. Before a private handler runs its first query, the request makes 6 sequential RTs (project, schema check x2, session, user, account).
3. On a cold isolate the first private request also makes 3 sequential GitHub requests (token, user, permission). Nothing is persisted, so each new isolate pays this again.

## How it works (map)

### Parts

| Part               | File                                           | Role                                                                                        |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Session library    | `packages/security/src/auth.ts:16-80`          | `createAuth` builds a Better Auth 1.7.5 instance on the D1 binding. GitHub OAuth only.      |
| Access check       | `packages/security/src/authorization.ts:25-84` | `requireMaintainer`: session, linked GitHub account, repository permission.                 |
| GitHub App client  | `packages/security/src/github.ts:107-185`      | `createGitHubClient`: App JWT, installation token, bounded requests to `api.github.com`.    |
| Permission lookup  | `packages/security/src/github.ts:208-262`      | `requireRepositoryWrite`: login hint, `/user/:id`, collaborator permission.                 |
| CI identity        | `packages/security/src/oidc.ts:111-363`        | `verifyGitHubOidc` for `/v1/plan`, `/v1/runs`, `/v1/runs/:id/begin`, `/v1/runs/:id/submit`. |
| Upload credentials | `packages/security/src/capabilities.ts`        | HS256 tokens for ingest, upload tickets, and reuse challenges.                              |
| Webhooks           | `packages/security/src/webhooks.ts`            | HMAC check, durable receipt, OAuth revocation.                                              |
| HTTP helpers       | `packages/security/src/http.ts`                | `assertFixedOrigin`, `requireSameOrigin`, `securePrivateResponse`, `readBoundedBody`.       |
| Worker entry       | `apps/web/src/server.ts:55-128`                | Routes `/health`, `/api/auth/*`, `/api/me`, the API, and page rendering.                    |
| API router         | `apps/web/src/api/index.ts:86-227`             | Origin check, project check, ingest routes, then the maintainer boundary.                   |

### Caches that exist today

| Data                      | Where                                                       | Lifetime                                                   | Shared between isolates | Evidence                                           |
| ------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- | ----------------------- | -------------------------------------------------- |
| Better Auth instance      | None. One new instance per request.                         | Request                                                    | No                      | `api/index.ts:130`, `server.ts:85`, `server.ts:93` |
| Schema check result       | Inside each Better Auth adapter instance                    | Request                                                    | No                      | `@better-auth/core/dist/db/schema-check.mjs:53-78` |
| Session and user          | None. D1 on each request. `cookieCache: { enabled: false }` | -                                                          | -                       | `auth.ts:45`, `authorization.ts:34`                |
| Linked GitHub account     | None. D1 on each request.                                   | -                                                          | -                       | `authorization.ts:40-43`                           |
| Installation token        | Module memory, `WeakMap<typeof fetch, Map>`                 | GitHub `expires_at` minus 30 s                             | No                      | `github.ts:102-104`, `github.ts:166-173`           |
| Login hint                | Module memory `Map`, 128 entries                            | Isolate life                                               | No                      | `github.ts:193-205`                                |
| Positive permission grant | Module memory, `WeakMap<D1Database, Map>`, 128 entries      | 60 s for reads, 10 s for decisions, never for other writes | No                      | `authorization.ts:19-23`, `authorization.ts:60-70` |
| GitHub OIDC key set       | None. New `createRemoteJWKSet` per verification.            | -                                                          | -                       | `oidc.ts:120-124`                                  |

Verified in local workerd: `env`, `env.DB`, and global `fetch` are the same objects for all requests of one isolate. Thus the two `WeakMap` caches do hit inside one isolate.

### One authenticated private request

Example: `GET /api/runs/<id>` with a valid session cookie in production. Each step waits for the previous step.

1. `server.ts:57-59`: make a correlation ID, parse the URL.
2. `server.ts:81` and `server.ts:112`: check bindings, then `apiBindings(env)` builds the configuration (`runtime.ts:199-302`). This parses two JSON variables. No I/O.
3. `api/index.ts:107`: `new Service(database)`.
4. `api/index.ts:110-112`: compare `url.origin` with the configured origin.
5. `api/index.ts:123-126`: `assertConfiguredProject`. **RT 1**: `SELECT * FROM visonaut_projects WHERE id = ?`. Only `GET /api/runs` skips this step.
6. `api/index.ts:130`: `createAuth(...)`. Better Auth starts its schema check in the background immediately.
7. `api/index.ts:191`: `createGitHubClient(...)`. One SHA-256 of the App private key (`github.ts:116-119`). No network.
8. `api/index.ts:194-205`: `requireMaintainer`.
   1. `authorization.ts:32-36`: `auth.api.getSession`. Better Auth waits for the schema check first. **RT 2**: read `sqlite_master`. **RT 3**: one batch of 75 `pragma_table_info` statements.
   2. Better Auth checks the cookie HMAC. **RT 4**: session by token. **RT 5**: user by ID. One time per day for each session there is one more RT (`UPDATE session`) and a `Set-Cookie`.
   3. `authorization.ts:40-43`. **RT 6**: `SELECT accountId FROM account WHERE userId = ? AND providerId = 'github'`.
   4. `authorization.ts:55-70`: look for a grant in isolate memory. A read uses a grant that is less than 60 s old. A decision uses a grant that is less than 10 s old.
   5. On a miss, `github.ts:208-262`:
      - No token in this isolate: import the PKCS8 key, sign an RS256 JWT, then `POST /app/installations/:id/access_tokens`.
      - No login hint in this isolate: `GET /user/:id`.
      - Always: `GET /repos/:repo/collaborators/:login/permission`.
9. `api/index.ts:206-208`: `requireSameOrigin` for methods other than GET and HEAD.
10. `api/index.ts:209-213`: the handler runs its own queries.
11. `api/index.ts:220-223`: append the session headers, then `securePrivateResponse`.

### Requests of one page load (measured counts)

"Before handler" counts the RTs that finish before the first handler query starts.

| Page                                                                  | Request                                                                                                                                         | D1 RTs before handler   | GitHub requests, cold isolate | GitHub requests, warm (grant under 60 s) |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------- | ---------------------------------------- |
| Dashboard `/`                                                         | `GET /api/runs` (`routes/index.tsx:180`)                                                                                                        | 5                       | 3                             | 0                                        |
| Dashboard `/`                                                         | then `GET /api/operations` (`components/operations-attention/index.tsx:233`), again each 60 s                                                   | 6                       | 0                             | 0, or 1 after 60 s                       |
| Review `/runs/:id`                                                    | `GET /api/runs/:id` (`routes/runs.$runId.tsx:39`)                                                                                               | 6                       | 3                             | 0                                        |
| From a PR check link `/pulls/:n?check=` (`api/pre-run-checks.ts:511`) | `GET /api/pulls/:n`, then a client redirect, then `GET /api/runs/:id` (`routes/pulls.$pullNumber.tsx:51-84`)                                    | 6 + 6                   | 3                             | 0                                        |
| First Approve or Reject                                               | `POST /api/review-sessions`, `POST /api/comparisons/:id/commands`, then `GET /api/commands/:id/queued` each 500 ms (`review/client.ts:296-336`) | 6 + 6 + 6 for each poll | 2 live permission requests    | 2                                        |

The document request for the page itself (`server.ts:118`) does no authentication and no D1 or GitHub work. The page shows "Checking access and loading this run…" (`routes/runs.$runId.tsx:69-71`) while the first API request runs.

### Access rule for each route

| Route                                                                                             | Credential                | Access level                            | Evidence                                |
| ------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------- | --------------------------------------- |
| `/health`                                                                                         | None                      | Public                                  | `server.ts:60-71`                       |
| `/images/:id` GET, HEAD                                                                           | None                      | Public by contract                      | `api/index.ts:113-116`, `api/images.ts` |
| `/api/auth/*`                                                                                     | Better Auth rules         | Better Auth origin check and rate limit | `server.ts:82-87`                       |
| `/api/me` GET                                                                                     | Session                   | `read`                                  | `server.ts:88-105`                      |
| `/v1/webhooks`, `/webhooks/github` POST                                                           | HMAC signature            | -                                       | `api/index.ts:127-129`                  |
| `/v1/plan`, `/v1/runs`, `/v1/runs/:n/begin`, `/v1/runs/:n/submit` POST                            | GitHub OIDC bearer        | -                                       | `api/index.ts:134-143`, `186-189`       |
| `/v1/runs/:id/reference*`, `/shards/:key`, `/reuse`, `/finalize`, `/v1/uploads/:ticket`           | Ingest capability (HS256) | -                                       | `api/index.ts:144-185`                  |
| All other GET or HEAD under `/api/` and `/v1/` (includes `GET /v1/runs/:id`)                      | Session                   | `read` (grant reuse up to 60 s)         | `api/index.ts:199-201`                  |
| `POST /api/comparisons/:id/commands`                                                              | Session + same origin     | `review` (grant reuse up to 10 s)       | `api/index.ts:192-203`                  |
| All other mutations (`/api/review-sessions`, `/api/commands/:id/undo`, `/api/runs/:id/recompare`) | Session + same origin     | `write` (live check)                    | `api/index.ts:204`                      |

### Session and cookie settings

`auth.ts:42-53`:

```ts
session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
advanced: {
  cookiePrefix: `visonaut-${configuration.environment}`,
  useSecureCookies: configuration.environment !== "local",
  defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
},
rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
plugins: [bearer()],
```

Measured cookie in production mode: name `__Secure-visonaut-production.session_token`, attributes `Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`, no `Domain`.

### Origin and CSRF checks

| Where                                                                  | Rule                                                                                                | Failure shape             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------- |
| Preview, all paths except `/health` (`server.ts:73-76`)                | `url.origin === VISONAUT_ORIGIN`                                                                    | Empty 403                 |
| Production `/api/auth/*` (`server.ts:83-84`)                           | Same rule, then Better Auth `trustedOrigins`                                                        | Empty 403                 |
| Production `/api/me` (`server.ts:89-92`)                               | Same rule, GET only                                                                                 | Empty 403 or 405          |
| Production API (`api/index.ts:110-112`)                                | Same rule                                                                                           | JSON `wrong_origin` 403   |
| Production private mutations (`api/index.ts:206-208`, `http.ts:21-29`) | `Origin` header must equal the origin. `Sec-Fetch-Site` must be `same-origin` or `none` if present. | JSON `invalid_origin` 403 |
| Production pages (`server.ts:118`)                                     | No rule                                                                                             | -                         |
| `/health`                                                              | No rule                                                                                             | -                         |

### Security headers

`securePrivateResponse` (`http.ts:31-50`) sets `Cache-Control: no-store, private`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Cross-Origin-Opener-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, and a CSP. Pages get a script nonce for each request (`router.tsx:5-8`, `server.ts:25-27`). It is applied to pages, API responses, auth responses, preview fixtures, and outer failures. It is not applied to `/health` and images (images have their own policy in `api/images.ts:48-57`).

## Findings

### AUTH-01 · Better Auth checks the full database schema on each request

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/security/src/auth.ts:47-51` sets `advanced` without `database`, so the Better Auth default applies.
  - `@better-auth/core/dist/types/init-options.d.mts:390-400`: "Validate the schema during initialization … Authentication requests await the same check … Kysely introspects the database … `@default true`".
  - `better-auth/dist/api/to-auth-endpoints.mjs:40-42`: `const pendingSchemaCheck = rawContext.checkSchema?.(); if (pendingSchemaCheck) await pendingSchemaCheck;`
  - `@better-auth/core/dist/db/schema-check.mjs:53-78`: the "clean" result lives in a closure of one adapter instance. `api/index.ts:130` makes a new instance for each request, so the result is never reused.
  - `@better-auth/kysely-adapter/dist/d1-sqlite-dialect-*.mjs:88-98`: one `sqlite_master` query, then `this.#d1.batch(...)` with one `SELECT * FROM pragma_table_info(?)` for each table of the database (not only the auth tables).
  - Harness, scenario A1 (`GET /api/runs`): the first two RTs are `select "name", "type", "sql" from "sqlite_master" …` and `batch of 75 x: SELECT * FROM pragma_table_info(?)`.
  - Local workerd D1 (`measure-workerd.out.txt`): a fresh instance needs 79 statements and 859 rows read for one `requireMaintainer`. A shared instance needs 3 statements and 3 rows read.
  - Result size: 85,280 bytes of JSON for the table list and the column lists (scenario O).
- What happens: before the session lookup, each request reads the definition of all 75 tables and compares them with the auth schema. The request waits for this. The result is thrown away at the end of the request.
- Impact: 2 of the 6 sequential RTs before each private handler. This applies to each API request, each poll (`/api/operations`, `/api/commands/:id/queued`, `/api/runs/:id/state`), each `/api/auth/*` request, and each anonymous request. The cost in production is two network round trips to D1 plus about 85 KB of data. The SQL itself is cheap (about 2 ms for the batch in local workerd). Production latency is not measured.
- Recommendation: disable the runtime schema check. The numbered migrations own the schema.

  ```ts
  // packages/security/src/auth.ts
  advanced: {
    cookiePrefix: `visonaut-${configuration.environment}`,
    useSecureCookies: configuration.environment !== "local",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    // A new instance for each request would read all table definitions each time.
    database: { validateSchema: false },
  },
  ```

  Measured with the same options plus this override: `getSession` goes from 4 RTs and 78 statements to 2 RTs and 2 statements. CPU on this machine goes from 1.36 ms to 0.17 ms for each request (median, Node, in-process SQLite).

- Alternatives:
  - Keep the check, but keep one Better Auth instance for each isolate (`WeakMap<D1Database, VisonautAuth>`). Then the check runs one time for each isolate. This needs a workerd test, because the pending check promise would be shared between requests. `auth.ts:15` and `packages/security/README.md:5` currently require one instance for each request.
  - Keep the check only in a test or a deploy step (compare `migrations/0003_auth.sql` with the Better Auth schema).
- Maintainer decision needed: yes. Is a runtime schema guard wanted in production, or is the migration directory sufficient?

### AUTH-02 · Session, user, account, and project checks are four more sequential round trips

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S (option 1), M (options 2 and 3)
- Evidence:
  - Harness, scenario A3 (`GET /api/runs/:id`), in order: `SELECT * FROM visonaut_projects WHERE id = ?`; schema check x2; `select … from "session" where "session"."token" = ?`; `select … from "user" where "user"."id" = ?`; `SELECT accountId FROM account WHERE userId = ? AND providerId = 'github'`.
  - `better-auth/dist/db/internal-adapter.mjs:343-350`: `findOne({ model: "session", …, join: { user: true } })`. With `joins` off (the default), the adapter runs two queries.
  - `authorization.ts:40-43` runs the account query after `getSession`.
  - `api/index.ts:123-126` runs the project check before authentication, alone.
  - The project check repeats inside handlers: scenario A2 shows `SELECT * FROM visonaut_projects WHERE id = ?` and later `SELECT id,repository_id FROM visonaut_projects ORDER BY id LIMIT 2` (`api/operations.ts:16-18`). Scenario K shows two identical project queries for `POST /v1/plan`.
- What happens: four facts that do not depend on each other (except that the account needs the user ID) are read one at a time.
- Impact: 4 RTs for each private request after AUTH-01 is removed. Each RT is one network round trip from the Worker to D1. Latency is not measured.
- Recommendation: three steps, each independent.
  1. Turn on Better Auth joins for the session lookup. Measured: 1 RT in place of 2 (`select "primary".*, "join_user"."name" as "_joined_user_name", …`).

     ```ts
     database: { validateSchema: false, joins: true },
     ```

  2. Read the account and the project row in one `database.batch` (1 RT in place of 2), or start the project check at the same time as `getSession`.

     ```ts
     // api/index.ts (sketch)
     const projectReady = dashboardRead ? null : assertConfiguredProject(context);
     projectReady?.catch(() => {}); // the result is awaited below
     const identity = await requireMaintainer({ request, auth, database, github, access });
     await projectReady;
     ```

  3. Remove the second project check from `operationsStatus` and `reportVisualPlan`, or pass the project row down.
- Alternatives:
  - Cache the positive project check in isolate memory for a short time. The project and repository IDs are deployment configuration. Tradeoff: a wrong configuration is found up to the cache time later. This is not an access check.
  - One hand-written SQL statement that joins session, user, account, and grant. It removes Better Auth from the read path, so cookie signature and renewal logic must be written again. More risk.
- Maintainer decision needed: yes for `joins: true` (Better Auth says to read the adapter notes first; the harness shows it works on SQLite, but it is not tested in workerd here).

### AUTH-03 · A cold isolate makes three sequential GitHub requests, and nothing is persisted

- Kind: performance
- Severity: high. Confidence: high for the counts, medium for how often isolates are cold in production. Measured: yes (counts). Effort: M
- Evidence:
  - Harness, scenario A1, GitHub calls in order: `POST /app/installations/1/access_tokens`, `GET /user/42`, `GET /repos/ariakit/ariakit/collaborators/maintainer/permission`.
  - `github.ts:102`: `const installationTokens = new WeakMap<typeof fetch, Map<string, InstallationToken>>();` (module memory only).
  - `github.ts:193`: `const loginHints = new Map<string, string>();` (module memory only).
  - `authorization.ts:19`: `const privatePermissions = new WeakMap<D1Database, Map<string, PrivatePermission>>();` (module memory only).
  - `github.ts:133` and `github.ts:169-172`: `pendingToken` belongs to one client object, and each request makes its own client. Scenario H1 (two parallel requests, cold): 2 token requests, 2 user requests, 2 permission requests.
  - `auth.ts:29-34`: the OAuth profile login is not stored. The `account` table has only the numeric `accountId`.
- What happens: the first private request on each new isolate signs a JWT, gets a token, resolves the login from the numeric ID, and then asks for the permission. The three requests run one after the other. A second isolate, or the same isolate after eviction, repeats all three.
- Impact: this is the "checking access" wait. A maintainer who opens a review link after some idle time meets a cold isolate in most cases (assumption: low traffic; isolate lifetime is not measured). After AUTH-01 and AUTH-02, this is the largest remaining fixed delay. The contract permits only one of the three requests to be skipped by time (the permission, for 60 s). The other two (token, login) have no freshness rule.
- Contract text that limits permission freshness (`docs/current-contract.md:186` and `:204`):

  > Private reads may reuse a positive GitHub permission result for the same valid session, user, and repository for at most 60 seconds. The approved decision-only supersession below permits Approve and Reject to reuse a positive GitHub permission check for at most 10 seconds. Live session and linked-account checks still run for every request. All other writes require a live repository-permission check.

  > These submissions may reuse a positive GitHub permission result for at most 10 seconds from the start of the GitHub permission request that established it. Cache hits do not extend that interval. Live session and linked-account checks still run for every request. Session creation, Undo, promotion, and all other writes retain a live repository-permission check.

- Caching options and the security tradeoff of each:

  | Option                                                                                                  | Effect                                                                                               | Staleness bound                                                                                    | Security tradeoff                                                                                                                                                                                             | Inside the contract                                                       |
  | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
  | A. Persist the installation token (D1 row, AES-GCM with a Worker secret, expiry from GitHub)            | Removes the token request on cold isolates and the duplicate mints                                   | Token lifetime (1 hour, set by GitHub)                                                             | A repository-scoped App token is at rest for up to 1 hour. With encryption, read access to D1 alone is not sufficient. A revoked installation stays usable until expiry, as it does today inside one isolate. | Yes. No permission rule changes.                                          |
  | B. Persist the login hint (one column or small table, written after `GET /user/:id` or at sign-in)      | Removes `GET /user/:id` on cold isolates                                                             | None needed                                                                                        | None. The permission response is still matched against the numeric ID (`github.ts:220-223`). A wrong hint only causes one more lookup.                                                                        | Yes                                                                       |
  | C. Persist the positive grant in D1 (`session_id`, GitHub user ID, App configuration key, `checked_at`) | Removes the permission request on cold isolates and on other isolates when a check is under 60 s old | 60 s from the start of the GitHub request, the same rule as today, but one window for all isolates | No longer window. A person with D1 write access could insert a grant; that person can already insert sessions and accounts. One D1 write for each live check.                                                 | Yes, if `checked_at` is the request start and hits do not extend it       |
  | D. Store the result of a successful live write check as a grant (see AUTH-04)                           | Removes the second live check of the first decision                                                  | Same 60 s and 10 s rules                                                                           | None: the result is a positive GitHub result with a known start time                                                                                                                                          | Yes by the text. The README says only reads and decisions fill the cache. |
  | E. Run the permission request and the read queries at the same time (see AUTH-05)                       | Wait time becomes the larger of the two, not the sum                                                 | No change                                                                                          | Signed-in users without access cause read queries. No data is returned to them.                                                                                                                               | Yes                                                                       |
  | F. Start the access check during the page navigation (see AUTH-05)                                      | The grant is ready when the first API request arrives                                                | No change                                                                                          | GitHub is called for page views with a valid session. Needs option C to be reliable across isolates.                                                                                                          | Yes                                                                       |
  | G. Serve with an expired grant while a new check runs                                                   | No wait after 60 s                                                                                   | 60 s plus the recheck time                                                                         | Removal of access takes longer than 60 s to apply                                                                                                                                                             | No. Needs a contract change.                                              |
  | H. Longer grant lifetime with webhook invalidation (`member`, `team`, `organization` events)            | Very few live checks                                                                                 | The lifetime if an event is lost                                                                   | Depends on delivery. Team and organization changes need more App permissions.                                                                                                                                 | No. Needs a contract change.                                              |
  | I. Better Auth cookie cache for the session                                                             | Removes the session RT                                                                               | The cookie cache age                                                                               | A signed-out or revoked session stays valid until the cache age ends                                                                                                                                          | No. "Live session and linked-account checks still run for every request." |
  | J. D1 read replicas for the session lookup                                                              | Shorter RTs far from the primary                                                                     | Replica lag                                                                                        | A sign-out can be seen late unless each read is pinned to the primary                                                                                                                                         | Not clear. Needs a decision.                                              |

- Recommendation: options A, B, and C together. Then a cold isolate needs 0 GitHub requests when a check is under 60 s old, and 1 request (the permission) in all other cases. Sketch of the read path:

  ```ts
  // one RT after the session lookup (sketch; table names are examples)
  const [account, grant, hint, token] = await database.batch([
    database
      .prepare("SELECT accountId FROM account WHERE userId = ? AND providerId = 'github'")
      .bind(userId),
    database
      .prepare(
        "SELECT login, role, checked_at FROM auth_permission_grants WHERE session_id = ? AND authorization_key = ?",
      )
      .bind(sessionId, key),
    database
      .prepare(
        "SELECT login FROM github_login_hints WHERE github_user_id = (SELECT accountId FROM account WHERE userId = ? AND providerId = 'github')",
      )
      .bind(userId),
    database
      .prepare(
        "SELECT ciphertext, expires_at FROM github_installation_tokens WHERE authorization_key = ?",
      )
      .bind(key),
  ]);
  ```

- Alternatives:
  - Minimal: option B only (no secret at rest, no new freshness state). Cold cost becomes 2 GitHub requests.
  - Options A and B without C. Cold cost becomes 1 GitHub request, and the 60 s grant stays in isolate memory.
  - Keep all three in memory and accept the cold cost.
- Maintainer decision needed: yes. Which data may be stored in D1: the encrypted installation token, the login hint, the grant row?

### AUTH-04 · A write deletes the cached grant and does not store the new positive result

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `authorization.ts:71-82`:

    ```ts
    permissions.delete(key);
    const checkedAt = Date.now();
    const identity = await requireRepositoryWrite(github, githubUserId);
    if (access !== "write") {
      // …
      permissions.set(key, { identity, checkedAt });
    }
    ```

  - Harness, scenario C: `C1 POST /api/review-sessions` makes 1 permission request. `C2 GET /api/runs` directly after it makes 1 more permission request. `C3` makes 0.
  - `review/client.ts:296` and `:310-313`: the first decision sends `POST /api/review-sessions` (access `write`) and then `POST /api/comparisons/:id/commands` (access `review`).
- What happens: a successful live check for a write removes the grant and stores nothing. The next read or decision must ask GitHub again, although a positive result with a known start time exists.
- Impact: the first Approve or Reject of a page visit waits for two sequential live GitHub requests. Each Undo also removes the grant, so the next poll or read asks GitHub again.
- Recommendation: store the grant after each successful live check, for all access levels. Writes still never read the cache.

  ```ts
  permissions.delete(key); // a failed check leaves no grant
  const checkedAt = Date.now();
  const identity = await requireRepositoryWrite(github, githubUserId);
  remember(permissions, key, { identity, checkedAt }); // also for access === "write"
  ```

  The existing tests still hold: a failed write check still deletes the grant (`packages/security/test/auth-d1.test.ts:253-256`, `:364-367`).

- Alternatives:
  - Create the review session inside the first decision request. Then the first decision makes one request and one live check.
  - Keep the behavior and document it as intended.
- Maintainer decision needed: yes. The contract text permits reuse of "a positive GitHub permission result". `packages/security/README.md:19` and `:26` describe only reads and decisions as sources. Confirm that a write check may be a source.

### AUTH-05 · The access check and the data read run one after the other, and the entry path repeats the check

- Kind: performance
- Severity: medium. Confidence: high for the order, medium for the gain. Measured: no. Effort: M
- Evidence:
  - `api/index.ts:194-213`: `const identity = await requireMaintainer({…});` completes before `handleReview(request, { ...context, identity, lifetime })` starts.
  - `server.ts:118`: `return await render(request);` The document request carries the session cookie (`SameSite=Lax`, top-level GET) but starts no access check.
  - `routes/runs.$runId.tsx:31`: `ssr: false`, and `:39`: the loader calls `loadReviewModel` only after the script has loaded.
  - `routes/pulls.$pullNumber.tsx:51-84`: `fetch('/api/pulls/…')`, then `navigate({ to: "/runs/$runId", … })`, which starts `GET /api/runs/:id`. `api/pre-run-checks.ts:511` builds this `/pulls/:n?check=` link for GitHub checks.
- What happens: for a read, the total wait is session time + GitHub time + data time. From a PR check link, the browser makes two private API requests in sequence, and each repeats the full session and account work (6 + 6 RTs before the handlers, see the page table).
- Impact: the GitHub request (1 to 3 requests when cold) fully delays the first data query. Not measured in production.
- Recommendation: options E and F from AUTH-03, plus a shorter entry path.
  - E: after the session and account are valid, start the GitHub check and the read at the same time. Return the body only if the check passes. Use this only for GET handlers without side effects.

    ```ts
    const session = await requireSession({ request, auth, database }); // D1 only
    const [identity, body] = await Promise.all([
      requireRepositoryAccess({ session, github, access: "read" }),
      reviewModel(context, runId, comparisonId), // result is dropped if the check throws
    ]);
    ```

  - F: on a page navigation with a session cookie, start the read check under `waitUntil`, so the grant exists when the script asks for data. This needs a grant that other isolates can see (AUTH-03 option C).
  - Entry path: answer `/pulls/:n?check=` with the run in one step (a server redirect to `/runs/:id`, or return the review model from `/api/pulls/:n`).
- Alternatives:
  - Load the review model during server rendering of the page. One browser round trip, but the HTML then contains private data and the first byte waits for the check.
  - No change after AUTH-01 to AUTH-04, if the remaining wait is acceptable.
- Maintainer decision needed: yes. Is it acceptable that a signed-in user without repository access causes read queries (no data returned)?

### AUTH-06 · Ingest routes build Better Auth and never use it

- Kind: cost
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `api/index.ts:130`: `const auth = createAuth({ ...bindings.configuration.auth, database: bindings.database });` runs before the `/v1/*` routes at `:134-189`. Only `:132` and `:194` use `auth`.
  - `better-auth/dist/auth/base.mjs:9-18`: the schema check starts when the instance is created (`const pendingSchemaCheck = ctx.checkSchema?.();`).
  - Harness, scenario K: `PUT /v1/uploads/abc` and `POST /v1/runs` show 1 RT before the response and 3 RTs 50 ms later. The two extra RTs are the schema check (76 statements). `POST /webhooks/github` shows none, because it returns at `:127-129`.
  - `apps/web/src/server.test.ts:69-71`: "Await auth initialization before disposing its native database or mocks." The tests already work around this background work.
- What happens: each CI request (plan, reserve, begin, declare, each image upload, reuse, finalize, submit) starts a schema check that nothing waits for.
- Impact: 2 extra D1 calls and 856 rows read for each ingest request, in the background. Each image upload is one such request. The work can also fail after the response and log `Could not validate the database schema` (seen in `measure-workerd.out.txt` when the database closed first).
- Recommendation: create the instance only where it is used.

  ```ts
  // api/index.ts: move below the /v1 routes, next to createGitHubClient
  const auth = createAuth({ ...bindings.configuration.auth, database: bindings.database });
  const github = await createGitHubClient(bindings.configuration.github);
  ```

- Alternatives: AUTH-01 alone also removes the D1 work, but the instance is still built for no reason.
- Maintainer decision needed: no.

### AUTH-07 · Anonymous requests cost D1 work before the 401

- Kind: cost
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Harness, scenario B1 (`GET /api/runs`, no cookie): status 401, 2 RTs, 76 statements. Scenario B2 (`GET /api/operations`, no cookie): status 401, 3 RTs, 77 statements (project row, then the schema check).
  - `api/index.ts:123-126`: `assertConfiguredProject` runs before `requireMaintainer` at `:194`.
  - `auth.ts:52`: the rate limit applies only to Better Auth routes. The private API has no request limit in the application.
- What happens: a request with no credential reads the project row and all table definitions before it gets `sign_in_required`. A wrong project configuration answers anonymous callers with `503 repository_configuration` and not `401`.
- Impact: each anonymous request (a signed-out page view, a scanner, a bot) reads 857 rows and moves about 85 KB from D1. A signed-out visitor waits for 3 RTs before the sign-in card appears.
- Recommendation: return 401 before any I/O when the request has no session cookie and no `Authorization` header, and run the project check after authentication.

  ```ts
  // packages/security (sketch)
  export function hasSessionCredential(request: Request, cookieName: string) {
    if (request.headers.has("authorization")) return true;
    return (request.headers.get("cookie") ?? "").includes(`${cookieName}=`);
  }
  ```

- Alternatives: AUTH-01 and AUTH-02 reduce the cost to 0 RTs for `GET /api/runs` and 1 RT for other paths without this change.
- Maintainer decision needed: no.

### AUTH-08 · For mutations, the origin check runs after the session and GitHub checks

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `api/index.ts:194-208`: `requireMaintainer` first, then `requireSameOrigin`.
  - `http.ts:20`: "Apply to cookie-authenticated mutations, before reading the request body."
  - Harness, scenario D1 (`POST /api/review-sessions`, valid cookie, `Origin: https://evil.example`): status 403 `invalid_origin` after 6 RTs and 1 GitHub permission request. Scenario E0 then shows that the read grant was deleted (1 more permission request).
- What happens: the request is refused, so there is no CSRF effect on data. But a same-site page (for example `preview.visonaut.com`, which shares the site with `visonaut.com`) can make the browser send the cookie, cause a live GitHub request, and delete the cached grant of the user.
- Impact: wasted D1 and GitHub work, and one extra live check on the next read. Low.
- Recommendation: check the origin first. It needs no I/O.

  ```ts
  if (!["GET", "HEAD"].includes(request.method)) {
    requireSameOrigin(request, bindings.configuration.origin);
  }
  const identity = await requireMaintainer({ … });
  ```

- Alternatives: none needed.
- Maintainer decision needed: no.

### AUTH-09 · The signed session token reaches page scripts, and the raw database token works as a credential

- Kind: security
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `auth.ts:53`: `plugins: [bearer()]`.
  - `better-auth/dist/plugins/bearer/index.mjs:52-66`: for each response that sets the session cookie, the plugin adds `set-auth-token` and `Access-Control-Expose-Headers`.
  - `api/index.ts:220-222`: `for (const [name, value] of identity.sessionHeaders) { result.headers.append(name, value); }` forwards all headers, not only `Set-Cookie`.
  - Harness, scenario F1 (daily renewal), response headers: `access-control-expose-headers: set-auth-token`, `set-auth-token: PYGv…o4=`, `set-cookie: __Secure-visonaut-production.session_token=…`. Scenario I: `set_auth_token_equals_cookie_value: true`.
  - `better-auth/dist/plugins/bearer/index.mjs:34-37`: a token without a signature is signed by the server (`if (options?.requireSignature) return;`). Scenario G1: `Authorization: Bearer <value of session.token column>` returns 200.
  - `docs/simplification-audit/contract-issue-1.md:316`: "Use secure HTTP-only same-site cookies".
  - The only documented user of bearer sessions is the CLI: `packages/cli/src/engine.ts:733-746` ("Status requires VISONAUT_TOKEN with a current maintainer session").
- What happens:
  1. One time per day for each session, a JSON API response carries the full signed session token in a header that `fetch` code can read. The cookie itself is `HttpOnly`.
  2. Any person who can read the `session` table (export, backup, Time Travel) can use `token` values directly as credentials. Without the plugin default, that person would also need `BETTER_AUTH_SECRET` to sign a cookie.
- Impact: the `HttpOnly` protection is weaker than intended. A script injection would be needed to use (1); the CSP limits that risk. (2) makes database read access equal to maintainer read access, plus decisions from a browser context.
- Recommendation:

  ```ts
  // auth.ts: accept only signed tokens
  plugins: [bearer({ requireSignature: true })],

  // api/index.ts and server.ts: forward only the cookie renewal
  for (const cookie of identity.sessionHeaders.getSetCookie()) {
    result.headers.append("Set-Cookie", cookie);
  }
  ```

- Alternatives:
  - Remove the bearer plugin and the CLI `status` command (it has no supported way to get a token today).
  - Keep the plugin, but strip `set-auth-token` and `access-control-expose-headers` in `securePrivateResponse`.
- Maintainer decision needed: yes. Is `visonaut status` with `VISONAUT_TOKEN` a supported feature? If yes, how does a maintainer get the token?

### AUTH-10 · The origin rule differs for each route, and production also answers on workers.dev

- Kind: inconsistency
- Severity: low. Confidence: medium. Measured: no. Effort: S
- Evidence:
  - `server.ts:73-76` (preview): `if (url.origin !== env.VISONAUT_ORIGIN) return securePrivateResponse(new Response(null, { status: 403 }));` for all paths.
  - `server.ts:83-84`, `:89-92`, and `api/index.ts:110-112`: three separate copies of the rule in production, with two failure shapes (empty 403, JSON `wrong_origin`).
  - `server.ts:118`: pages render with no origin rule in production.
  - `apps/web/wrangler.jsonc:48`: `"workers_dev": true` in `env.production`. `apps/compare/wrangler.jsonc:6` uses `false`.
- What happens: on the `workers.dev` host, production serves the page shell, but each API and auth request answers 403. The page shows an error state.
- Impact: a confusing second address for the app. No data exposure found.
- Recommendation: one origin gate at the top of `fetch` for all paths except `/health`, as preview does. Or set `workers_dev` to `false` for production.
- Alternatives: redirect other hosts to the configured origin.
- Maintainer decision needed: yes. Is the `workers.dev` address used for any probe or tool?

### AUTH-11 · Private failures have several shapes

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `api/index.ts:38-44`: `{ schemaVersion, error: { code, message } }`, `Retry-After` only for 503.
  - `server.ts:36-50`: `{ error: { code, message } }` with `headers: { "Retry-After": "1" }` for all statuses. `server.test.ts:214-219` expects a 401 with `Retry-After: 1` and no `schemaVersion`.
  - `api/index.ts:216-218`: the 404 fallback is `{ error: { code: "not_found", … } }` without `schemaVersion`.
  - `api/review.ts:689-696`: conflict responses are `{ error, model, reviewer }` without `schemaVersion`.
  - Origin failures: empty body in `server.ts`, JSON in `api/index.ts`.
  - A missing run answers `409 incomplete` (scenario A3 body: `"code":"incomplete","message":"The requested record does not exist."`), not 404.
- What happens: the client must handle each shape. `review/client.ts:269-273` reads only `error.message` and `error.reference`, so it works today.
- Impact: drift risk. A 401 that says "retry after 1 second" is wrong advice.
- Recommendation: one function that builds all private error responses, used by `server.ts` and `api/index.ts`. Send `Retry-After` only with 503.
- Alternatives: document the two families (protocol errors with `schemaVersion`, app errors without).
- Maintainer decision needed: no.

### AUTH-12 · Duplicate and unused identity routes, and document drift

- Kind: dead-code
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `server.ts:88-105`: `/api/me` returns `{ userId }`. No app code calls it. `review/__tests__/route.browser.test.ts:103`, `:115`, `:182`, `:309`, `:445` assert `expect(requests).not.toContain("/api/me")`. Only `apps/web/tooling/review-scale/local-routes.mjs:273` uses it.
  - `api/review.ts:713-721`: `/api/session` returns the user. A search of the repository finds no caller and no test.
  - `api/index.ts:124` and `:131-133`: the `/api/auth/` branch of `handleApi` cannot be reached in production, because `server.ts:82-87` answers first.
  - `docs/review-evidence-plan.md:62`: "The integrated routes use `GET /api/me` before loading protected app data." This is no longer true.
  - `packages/security/migrations/0001_auth.sql` and `apps/web/migrations/0003_auth.sql` are identical (`diff` prints nothing).
  - `api/index.ts:127`: `/v1/webhooks` and `/webhooks/github` both reach the receiver. `operations/github-deliveries.ts:170` requires `/v1/webhooks`.
- What happens: two "who am I" routes and two auth entry points exist with different error shapes and different checks (`/api/me` skips the project check).
- Impact: more surface to keep in step. Low.
- Recommendation: keep one identity route inside `handleReview`, point the tool at it, and delete the unused branches. Update the document line.
- Alternatives: keep `/api/me` as a documented probe and delete only `/api/session` and the unreachable branch.
- Maintainer decision needed: yes. Is `/webhooks/github` still configured anywhere? Is `/api/me` part of a runbook (`docs/operations/retire-preview-auth-at-cutover.md:59` names it)?

### AUTH-13 · The access level comes from the HTTP method and a copied pattern

- Kind: simplification
- Severity: low. Confidence: high. Measured: no. Effort: M
- Evidence:
  - `api/index.ts:192-204`:

    ```ts
    const reviewWrite =
      request.method === "POST" && /^\/api\/comparisons\/[a-f0-9-]+\/commands$/.test(path);
    // …
    access: request.method === "GET" || request.method === "HEAD" ? "read" : reviewWrite ? "review" : "write",
    ```

  - `api/review.ts:837`: the same pattern again, `/^\/api\/comparisons\/([a-f0-9-]+)\/commands$/`.
- What happens: the router decides the access level before it knows which handler will run. The contract names exact routes ("only for Approve and Reject submissions at `POST /api/comparisons/:id/commands`").
- Impact: a later change of one pattern, or a GET with a side effect, would get the wrong level without a failing test. No wrong level exists today.
- Recommendation: a small route table that states method, pattern, access level, and handler in one place.

  ```ts
  const privateRoutes = [
    { method: "GET", pattern: /^\/api\/runs$/, access: "read", handle: dashboardRoute },
    {
      method: "POST",
      pattern: /^\/api\/comparisons\/([a-f0-9-]+)\/commands$/,
      access: "review",
      handle: commandRoute,
    },
    {
      method: "POST",
      pattern: /^\/api\/commands\/([a-f0-9-]+)\/undo$/,
      access: "write",
      handle: undoRoute,
    },
  ] as const;
  ```

- Alternatives: export the one pattern from `review.ts` and use it in both places.
- Maintainer decision needed: no.

### AUTH-14 · Rate limiting covers only the auth routes, uses D1, and takes the client address from `X-Forwarded-For`

- Kind: security
- Severity: low. Confidence: medium. Measured: yes (query counts and key selection). Effort: S
- Evidence:
  - `auth.ts:52`: `rateLimit: { enabled: true, storage: "database", window: 60, max: 60 }`. No `advanced.ipAddress` setting.
  - `@better-auth/core/dist/utils/ip.mjs:196`: `const DEFAULT_IP_HEADERS = ["x-forwarded-for"];` and `:190`: `if (forwardedIps.length !== 1) return null;`
  - Harness, scenario M: one auth request adds 2 RTs (`select … from "rateLimit"`, `insert into "rateLimit" …`). After three requests the table holds `203.0.113.7|/get-session` (1) and `no-trusted-ip|/get-session` (2). The second key received the request with two forwarded addresses and the request with none.
  - Scenario N: `POST /api/auth/sign-in/social` is 5 RTs today (schema check 2, rate limit 2, state row 1). `POST /api/auth/sign-out` is 10 RTs.
- What happens: a request with more than one address in `X-Forwarded-For` (a user behind a forwarding proxy, or a client that adds the header) goes to one shared bucket for each path. A client can thus fill the shared sign-in bucket for all such users. The private API (`/api/runs`, …) has no limit in the application.
- Impact: low. A limited denial of sign-in for proxy users. Each auth request pays 2 RTs for the limiter.
- Recommendation: use the address that Cloudflare sets.

  ```ts
  advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] }, /* … */ },
  ```

- Alternatives: a Cloudflare rate limiting rule or binding for `/api/auth/*` and the private API, and `rateLimit: { enabled: false }` in Better Auth (removes the 2 RTs and the `rateLimit` table writes).
- Maintainer decision needed: yes. Is an application rate limit wanted, or a Cloudflare rule?

### AUTH-15 · Each OIDC verification gets the GitHub key set again and makes 9 to 12 sequential GitHub requests

- Kind: performance
- Severity: medium. Confidence: high for the count from code, low for the time. Measured: no. Effort: M
- Evidence:
  - `oidc.ts:120-124`: `createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"), { timeoutDuration: 10_000 })` inside the function. The key set object is new for each call, so its internal cache is never reused.
  - Sequential `await github.request(...)` calls for a pull request with the production configuration (`apps/web/wrangler.jsonc:63`): `oidc.ts:165` caller workflow file, `:190` trusted workflow file, `:240` run, `:243` attempt, `:258` jobs (1 or more pages, `:365-387`), `:295` pull request, `:303` merge ref, `:311` main ref, `:313` commit, `:320` compare (when the base is not main head), `:324` and `:330` (when the merge commit moved).
  - Callers: `api/workflow-owned.ts:309`, `:336`, `:1209`, and `api/pre-run.ts:73`. One CI run verifies at Plan, at each shard reservation, at Begin, and at Submit.
- What happens: 1 key set request plus 9 to 12 GitHub API requests, one after the other, for each verification. A push run needs 1 + 5.
- Impact: slower CI steps (not the maintainer pages). GitHub App rate budget is used for each shard. Time is not measured.
- Recommendation:
  - Keep the key set data in module memory with the `jose` cache option (plain data, safe to share between requests):

    ```ts
    import { createRemoteJWKSet, jwksCache, type JWKSCacheInput } from "jose";
    const githubKeys: JWKSCacheInput = {};
    const keys = createRemoteJWKSet(jwksUrl, { timeoutDuration: 10_000, [jwksCache]: githubKeys });
    ```

  - Start the independent reads together (`Promise.all` for the two workflow files, run, attempt, jobs, pull request, main ref) and compare after all have returned.
- Alternatives: verify one time for each workflow attempt and store the verified facts for the other shards of the same attempt. This changes the trust model (each shard token is still checked for signature, but GitHub state is read one time).
- Maintainer decision needed: yes, only for the alternative.

### AUTH-16 · GitHub OAuth user tokens are stored and never read

- Kind: security
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `auth.ts:36-41`: `encryptOAuthTokens: true, updateAccountOnSignIn: true`.
  - A search for `accessToken|refreshToken|idToken` in `apps/web/src` and `packages/*/src` (tests excluded) finds only two statements, and both set the columns to `NULL`: `packages/security/src/webhooks.ts:137` and `apps/web/src/operations/recovery.ts:40`.
  - `github.ts:208-262`: permission checks use the App installation token, not the user token.
- What happens: each sign-in stores an encrypted user access token (scope `read:user user:email`) that no code uses.
- Impact: unused secret data at rest. Low, because it is encrypted and has a narrow scope.
- Recommendation: do not keep the tokens.

  ```ts
  databaseHooks: {
    account: {
      create: { before: async (account) => ({ data: { ...account, accessToken: null, refreshToken: null, idToken: null } }) },
      update: { before: async (account) => ({ data: { ...account, accessToken: null, refreshToken: null, idToken: null } }) },
    },
  },
  ```

- Alternatives: keep them for a later feature and document why.
- Maintainer decision needed: yes. Is a later use of the user token planned?

### AUTH-17 · Small gaps in the response headers

- Kind: security
- Severity: low. Confidence: high. Measured: yes (header lists). Effort: S
- Evidence:
  - Harness, scenario A1 response headers: no `Cross-Origin-Resource-Policy`. `api/images.ts:55` sets `"Cross-Origin-Resource-Policy": "same-origin"` for public images, so private JSON has less protection than public images.
  - Scenario A1 also shows `pragma: no-cache`. It comes from Better Auth (`better-auth/dist/api/routes/session.mjs:33-34`) through `api/index.ts:220-222`. Scenario I: `sessionHeaders_normal: [["cache-control","no-store"],["pragma","no-cache"]]`.
  - `server.ts:60-71`: `/health` sets only `Cache-Control: no-store`.
  - `http.ts:39`: `Strict-Transport-Security: max-age=31536000` without `includeSubDomains`.
- What happens: the headers work, but three places differ from the main policy.
- Impact: low. Defense in depth only.
- Recommendation: add `Cross-Origin-Resource-Policy: same-origin` in `securePrivateResponse`, forward only `Set-Cookie` from the session headers (see AUTH-09), and pass `/health` through the same function.
- Alternatives: no change.
- Maintainer decision needed: no.

## Measurements (command, raw result, limits)

All files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/auth/`.

### M1. Request harness with a D1-shaped SQLite wrapper

Command:

```sh
node --experimental-transform-types --no-warnings measure-auth.mjs > measure-auth.out.txt
```

What it does: imports `packages/security/src/index.ts` and `apps/web/src/api/index.ts` from the worktree, applies all files of `apps/web/migrations` to an in-memory `node:sqlite` database, wraps it in an object with the D1 API (`prepare`, `bind`, `all`, `first`, `run`, `batch`), and records each call. GitHub is a stub `fetch` that records each request. The session uses a real signed cookie.

Raw results (short form; the file has the full SQL):

| Scenario                                                    | Status   | D1 RTs | D1 statements | GitHub requests               |
| ----------------------------------------------------------- | -------- | ------ | ------------- | ----------------------------- |
| A1 `GET /api/runs`, cold                                    | 200      | 6      | 82            | token, user, permission       |
| A2 `GET /api/operations`, warm                              | 200      | 9      | 83            | 0                             |
| A3 `GET /api/runs/:id`, unknown run, warm                   | 409      | 7      | 81            | 0                             |
| B1 `GET /api/runs`, no cookie                               | 401      | 2      | 76            | 0                             |
| B2 `GET /api/operations`, no cookie                         | 401      | 3      | 77            | 0                             |
| B3 `GET /images/:id`                                        | 404      | 1      | 1             | 0                             |
| C1 `POST /api/review-sessions`                              | 201      | 7      | 81            | permission                    |
| C2 `GET /api/runs` directly after C1                        | 200      | 6      | 82            | permission                    |
| C3 `GET /api/runs` again                                    | 200      | 6      | 82            | 0                             |
| D1 `POST /api/review-sessions`, foreign `Origin`            | 403      | 6      | 80            | permission                    |
| E1 `GET /api/runs` after 61 s                               | 200      | 6      | 82            | permission                    |
| F1 `GET /api/runs`, renewal due                             | 200      | 7      | 83            | 0                             |
| G1 `GET /api/runs`, `Authorization: Bearer <session.token>` | 200      | 6      | 82            | 0                             |
| H1 two parallel requests, cold                              | 200, 200 | 15     | -             | 2 token, 2 user, 2 permission |

Better Auth options (scenario L, one `getSession` on a fresh instance):

```text
current options                         d1_round_trips 4  d1_statements 78
advanced.database.validateSchema=false  d1_round_trips 2  d1_statements 2
validateSchema=false and joins=true     d1_round_trips 1  d1_statements 1
```

CPU time on this machine (scenario J and L, median of 300 runs, milliseconds):

```text
createAuth() + getSession with a valid cookie               1.32
shared auth instance: getSession with a valid cookie        0.104
fresh instance, validateSchema=false: getSession            0.173
fresh instance, validateSchema=false + joins: getSession    0.187
shared instance, validateSchema=false + joins: getSession   0.115
createGitHubClient() (SHA-256 of the private key)           0.014
createAppJwt() (importPKCS8 + RS256 sign, RSA-2048)         0.549
handleApi GET /api/runs, warm grant, empty project          1.834
handleApi GET /api/runs, no cookie (401)                    1.203
handleApi GET /images/:id, unknown image                    0.017
```

Limits: Node 24.18.0 on an Apple laptop, not workerd. SQLite is in the same process, so there is no network time. The database has the schema but almost no rows. The times show CPU order of size only. The counts do not depend on the machine.

### M2. Real D1 in local workerd (Miniflare)

Command:

```sh
node --experimental-transform-types --no-warnings measure-workerd.mjs > measure-workerd.out.txt
```

Raw results:

```text
{"requestInIsolate":2,"sameEnvObject":true,"sameDatabaseObject":true,"sameGlobalFetch":true}
{"sqlite_master_objects":[{"type":"index","count":137},{"type":"table","count":75},{"type":"trigger","count":18},{"type":"view","count":1}]}
fresh auth instance, request 1:  statements 79, rows_read 859
  sqlite_master query             1 statement, rows_read 231
  pragma_table_info               75 statements, rows_read 625
  session, user, account          3 statements, rows_read 3
fresh auth instance, request 2:  statements 79, rows_read 859
shared auth instance, later request: statements 3, rows_read 3
createAuth() constructed, no API call, after 300 ms: 1 statement, rows_read 231
ERROR [Better Auth]: Could not validate the database schema. Check your database connection.
```

Limits: the D1 binding is used from Node through the Miniflare proxy, so the wall times in the file (795 ms and 45 ms) are not valid for production and are not used in this report. The last two lines show the background check of an unused instance: it was still running when the database closed.

### M3. Schema check SQL inside workerd

Command:

```sh
node --experimental-transform-types --no-warnings measure-introspection.mjs > measure-introspection.out.txt
```

Raw result (median of 30 runs inside the Worker, native binding, timer step 1 ms):

```text
tables 75, table_list_ms 0, pragma_batch_ms 2, session_lookup_ms 0,
table_list_rows_read 231, pragma_batch_rows_read 625, response_bytes 85356
```

Limits: local D1 has no network distance. This shows that the SQL is cheap and that the production cost is the two round trips and the data size. Production round-trip time is not measured.

### M4. Static checks

```sh
diff packages/security/migrations/0001_auth.sql apps/web/migrations/0003_auth.sql   # no output
rg -n "api/session\b" .   # only apps/web/src/api/review.ts:713
rg -n "accessToken|refreshToken|idToken" apps/web/src packages --glob '!**/*.test.ts' --glob '!**/*.sql'   # two NULL updates only
git status --porcelain   # no change made by this lane
```

## Open questions and items not verified

1. Production latency. No request to production was made. D1 round-trip time, GitHub API time from the Worker, and the share of cold isolates are not measured. Workers Traces are enabled (`apps/web/wrangler.jsonc:15-20`), so one traced request to `/api/runs` would give real numbers for each step.
2. Table count in production. The harness database has 75 tables from the repository migrations. The production database can also contain `d1_migrations` and tables that later migrations dropped or kept. The schema check reads one `pragma_table_info` for each table that exists.
3. `X-Forwarded-For` in the Worker. AUTH-14 assumes that Cloudflare passes one client address in this header when the client sends none, and appends when the client sends one. This was not tested on Cloudflare.
4. `joins: true` in workerd. The joined session query works in the SQLite harness. It was not run against workerd D1, and the Better Auth notes for this option were not read.
5. One shared Better Auth instance for each isolate. Not tested. The comment in `auth.ts:15` says that a D1 binding must not cross requests. The probe shows that `env.DB` is the same object for all requests of an isolate, but a pending promise that one request starts and another request awaits can fail in workerd. With `validateSchema: false` the instance does no I/O at start, but this needs its own test.
6. Background schema check on ingest routes in production. Workers can stop work that is not passed to `waitUntil` when the response ends. The harness shows that the two calls start. It does not show how many of them finish in production.
7. Static assets. The headers of JS and CSS files come from the Workers asset layer, not from `securePrivateResponse`. Not checked in this lane.
8. Session token for the CLI. No document says how a maintainer gets `VISONAUT_TOKEN`. The cookie is `HttpOnly`, and the only place where the server sends the token is the `set-auth-token` header.
9. Cleanup of auth tables. Expired `session` and `verification` rows are deleted only when the same token or state is presented again. `rateLimit` rows are pruned by Better Auth when a window rolls over. `auth_audit` and `ingest_review_sessions` have no cleanup that this lane found (`operations/recovery.ts:35` clears them only after a database restore). Growth is slow for a small team. Not measured.
10. GitHub permission endpoint behavior for outside users. `requireRepositoryWrite` expects `200` with `permission: "read"` or `"none"` for a user without access. This matches the GitHub documentation that the code cites, but it was not called here.
