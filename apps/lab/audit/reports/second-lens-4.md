# Second-lens check 4: platform facts, real impact, and fix feasibility

Findings checked: AUTH-03, D1-01, D1-02, D1-04.

Read-only. No file in the repository was changed. Scratch files: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-4/` (`measurements.txt`, `github-latency.txt`).

## Read this first

| ID      | Verdict          | Severity (first report) | Severity (this check)       | One line                                                                                                                                                                                                   |
| ------- | ---------------- | ----------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-03 | partly-confirmed | high                    | medium                      | The 3 GitHub requests are real. They add about 0.7 to 1.0 s, but only to the first private request of a cold isolate. Each warm request already waits about 1 s with no GitHub request.                    |
| D1-01   | confirmed        | high                    | high                        | Measured in production: about 0.33 s for each request that uses Better Auth. The one-line fix exists in the installed version.                                                                             |
| D1-02   | partly-confirmed | high                    | high                        | The counts are correct. Each sequential D1 call costs about 105 to 145 ms from São Paulo. The recommended hand-written join is more than is necessary.                                                     |
| D1-04   | partly-confirmed | high                    | medium now, grows with time | The chain is real and starts at 25 pull requests. The repository gets about 8 to 9 pull requests each day. The cost numbers in the report are for a synthetic size. One recommended alternative has a bug. |

What I ran myself (Measured: yes):

- GitHub search counts for pull request velocity (4 read-only requests).
- GitHub REST latency from this machine in São Paulo (11 public GET requests).
- A recalculation of production timings from the raw files of the `live` and `load` lanes. I did not send new requests to production.

What I did not measure: signed-in production requests, traces, the D1 region, and the cold-isolate rate.

Documentation quotes came through a fetch tool that summarizes pages. The wording can differ by a few words. Each quote has its URL.

## Facts that all four findings share

### Production configuration

- `apps/web/wrangler.jsonc:46-122` is `env.production`: Worker `visonaut`, domain `visonaut.com`, one D1 binding `DB`, one queue consumer, cron `*/5 * * * *`.
- `apps/web/wrangler.jsonc:98-107`: `"max_batch_size": 1`, `"max_concurrency": 1`. One message for each invocation, one invocation at a time.
- There is no `placement` key in the file. The Worker runs at the edge location nearest to the visitor.
- `apps/web/wrangler.jsonc:15-20`: `"observability": { "enabled": true, "traces": { "enabled": true } }`. Wrangler lists `observability`, `placement`, and `limits` as inheritable keys (https://developers.cloudflare.com/workers/wrangler/configuration/). So production traces are on today.
- `.github/workflows/deploy.yml:74-76` builds with `CLOUDFLARE_ENV: production`. Line 127 applies migrations. Line 133 deploys the Worker. Migrations run before the code.

### Production timing model (São Paulo, edge `GRU`)

Source: raw files of the `live` and `load` lanes, guest requests, 2026-10-05. Recalculation: `second-lens-4/measurements.txt`.

| Request                  | D1 calls                   | Server wait (median)              |
| ------------------------ | -------------------------- | --------------------------------- |
| `/health`                | 0                          | 28 to 33 ms                       |
| `/images/<unknown uuid>` | 1                          | 175 ms                            |
| guest `/api/runs`        | 2 (schema check)           | 362 ms and 365 ms (two sets of 8) |
| guest `/api/runs/<id>`   | 3 (project + schema check) | 466 ms                            |
| guest `/api/operations`  | 3                          | 505 ms                            |

Results:

- Schema check (2 calls, 76 statements): 362 − 28.5 = 334 ms and 365 − 33 = 332 ms.
- One small D1 call: 466 − 362 = 104 ms, 175 − 33 = 142 ms, 505 − 365 = 140 ms. Use **105 to 145 ms**.

Model: `server wait ≈ 30 ms + 333 ms + (sequential depth − 2) × 105 to 145 ms`.

Check against the signed-in samples in `audit/live-authenticated.md`:

| Request           | Depth | Model          | Measured                   |
| ----------------- | ----- | -------------- | -------------------------- |
| `/api/runs`       | 6     | 0.78 to 0.94 s | 0.87 to 1.08 s (4 samples) |
| `/api/operations` | 9     | 1.10 to 1.38 s | 1.20 to 1.30 s (5 samples) |

The model agrees. This number is for one location. A maintainer near the D1 region pays less for each call.

### Platform facts

1. `batch()` is one call: "Sends multiple SQL statements inside a single call to the database. This can have a huge performance impact as it reduces latency from network round trips to D1." "Batched statements are SQL transactions." (https://developers.cloudflare.com/d1/worker-api/d1-database/)
2. One D1 database does one query at a time: "Each individual D1 database is inherently single-threaded, and processes queries one at a time." Limit: 1,000 queries for each Worker invocation on Workers Paid. (https://developers.cloudflare.com/d1/platform/limits/)
3. D1 has no region in South America. Regions: wnam, enam, weur, eeur, apac, oc. "D1 will automatically create your primary database instance in a location close to where you issued the request to create a database." The location cannot change later. (https://developers.cloudflare.com/d1/configuration/data-location/)
4. Read replicas use the same six regions, and "you must use the D1 Sessions API, otherwise all queries will continue to be executed only by the primary database." (https://developers.cloudflare.com/d1/best-practices/read-replication/) For a maintainer in Brazil, a replica is not nearer than the primary.
5. Placement: `{ "mode": "smart" }` or an explicit `{ "region": "aws:us-east-1" }`. Status `INSUFFICIENT_INVOCATIONS` means "The Worker has not received enough requests from multiple locations". "Placement only affects the execution of fetch event handlers." "Static assets are always served from the location nearest to the incoming request." (https://developers.cloudflare.com/workers/configuration/placement/) Smart Placement considers D1: "considering everything your Worker talks to, including D1" (https://developers.cloudflare.com/workers/platform/storage-options/).
6. Isolates: "there is no guarantee that any two user requests will be routed to the same or a different instance of your Worker". An isolate can be evicted for "Resource limitations on the machine". Cloudflare gives no idle lifetime. (https://developers.cloudflare.com/workers/reference/how-workers-works/)
7. Traces make one span for each D1 call (`d1_batch`, `d1_first`, `d1_all`, `d1_run`) with `cloudflare.d1.response.served_by_region`, `rows_read`, and `sql_duration_ms`, and one `fetch` span for each outbound request. No code change. (https://developers.cloudflare.com/workers/observability/traces/spans-and-attributes/)
8. D1 price on Workers Paid: "First 25 billion / month included + $0.001 / million rows" read. (https://developers.cloudflare.com/d1/platform/pricing/) Queues: "$0.40/million operations", 1,000,000 included, "it takes 3 operations to deliver a message". (https://developers.cloudflare.com/queues/platform/pricing/) Queue consumer wall time: 15 minutes. (https://developers.cloudflare.com/queues/platform/limits/)
9. GitHub: "Installation tokens expire one hour from the time you create them." (https://docs.github.com/en/rest/apps/apps) The permission endpoint takes a username only (https://docs.github.com/en/rest/collaborators/collaborators). `GET /user/{account_id}` "takes their durable user ID instead of their login" (https://docs.github.com/en/rest/users/users). Installation limit: 5,000 requests each hour minimum (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
10. No official page gives a typical latency for a D1 query, for a GitHub REST request, or for an RSA signature on Workers. I use measurements for these.

### Installed versions (checked in `node_modules`)

| Package                            | Version      | What I confirmed                                                                                                                                       |
| ---------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `better-auth`, `@better-auth/core` | 1.7.5        | `advanced.database.validateSchema` (`init-options.d.mts:390-400`, "@default true") and `advanced.database.joins` (`:375-389`, "@default false") exist. |
| `wrangler`                         | 4.136.1      | `config-schema.json` accepts `placement` as `{mode: "off" \| "smart"}`, `{region}`, `{host}`, `{hostname}`, at top level and in an environment.        |
| `@cloudflare/workers-types`        | 5.20260922.1 | `withSession` (`index.d.ts:14588`), `served_by_region` (`:14534`), `sql_duration_ms` (`:14547`), queue `delaySeconds` (`:2423`).                       |
| `jose`                             | 6.2.12       | Used by `createAppJwt` (`packages/security/src/github.ts:29-42`).                                                                                      |

---

## AUTH-03 · A cold isolate makes three sequential GitHub requests, and nothing is persisted

Verdict: **partly-confirmed**. Severity: **medium**.

The counts are correct. The claim "this is the 'checking access' wait" is too strong. The claim "two parallel cold requests do each twice" is correct in a test, but the browser client does not send parallel private requests on a page load.

### 1. Hot path

Verified from code:

- `apps/web/src/api/index.ts:191-205`: each private route runs `const github = await createGitHubClient(bindings.configuration.github);` and then `requireMaintainer({ ... })`.
- `packages/security/src/authorization.ts:60-73`: the grant comes from `privatePermissions` (a module `WeakMap`), or the code calls `requireRepositoryWrite(github, githubUserId)`.
- `packages/security/src/github.ts:166-173`: the token comes from a module map, or `authorize()` signs a JWT and sends `POST /app/installations/:id/access_tokens`.
- `github.ts:231` and `:251`: `const hint = loginHints.get(key);` and, with no hint, `await client.request(`/user/${id}`)`.
- `apps/web/src/runtime.ts:128-136`: production passes no `fetch`, so the token map key is the global `fetch`. The cache is for one isolate.
- `apps/web/wrangler.jsonc:46-122`: production has no KV, no Durable Object, and no cache binding. Module memory is the only store.

How often:

| Case                                    | GitHub requests | Evidence                                |
| --------------------------------------- | --------------- | --------------------------------------- |
| First private request of a cold isolate | 3, in sequence  | Auditor harness scenario A1; code above |
| Warm isolate, grant under 60 s          | 0               | `authorization.ts:63`                   |
| Warm isolate, grant over 60 s           | 1               | `authorization.ts:71-73`                |
| Open dashboard, each 60 s               | 1 for each poll | First verification, "Missed" item 3     |
| First Approve or Reject                 | 2               | AUTH-04                                 |

Page loads send private requests in series: `apps/web/src/routes/index.tsx:254-256` mounts the alert poll only after `/api/runs` answers, and the run page loader sends one request (`routes/runs.$runId.tsx:37`). So the duplicate token mint needs two tabs, or two decision receipts that poll at the same time on a cold isolate.

Not known: how often the isolate is cold for a real visit. Cloudflare gives no idle lifetime (platform fact 6). Evidence from production: 1 of 5 signed-in dashboard samples was slow.

### 2. Magnitude

- Production, one sample: `/api/runs` waited 1,967 ms on the first API request of the session. The four later samples waited 865 to 1,077 ms. The difference is 0.9 to 1.1 s. It is one sample, and no trace proves that GitHub caused it.
- My measurement from São Paulo (`second-lens-4/github-latency.txt`): a GitHub REST request that is not in a cache waits 215 to 302 ms after the connection is ready (7 samples). A new TLS connection takes 58 to 68 ms. Three sequential requests on one new connection: **0.7 to 1.0 s**. This agrees with the production sample.
  ```
  200 connects=1 tls=0.058100 pre=0.058162 ttfb=0.279394   /user/3068563
  200 connects=0 ...          pre=0.000040 ttfb=0.302211   /repos/ariakit/ariakit
  200 connects=0 ...          pre=0.000041 ttfb=0.215085   /user/1000002
  ```
  Limits: this is a desk machine, not the Worker. The requests are public GET requests. A `POST` with an App JWT can be slower or faster.
- RSA signature: the auditor measured `createAppJwt` at 0.55 ms median in Node (`audit/auth/measure-auth.out.txt:377`). It is not a factor. No Workers number exists.
- One expired grant on a warm isolate: about 0.22 to 0.36 s (1 request).
- Rate limit: no risk. One open dashboard makes 60 permission requests each hour. The limit is 5,000 or more.

Size against the other waits: a warm `/api/runs` waits 0.87 to 1.08 s with **zero** GitHub requests. A run page waits 5.3 to 5.7 s. AUTH-03 adds up to about 1 s on top of these, one time for each cold isolate.

### 3. Fix feasibility

| Option                  | Does the platform permit it                     | Saves on a cold visit                 | What can go wrong                                                                                   |
| ----------------------- | ----------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A. Token in D1, AES-GCM | Yes. WebCrypto AES-GCM is available in Workers. | 1 of 3 requests, about 0.22 to 0.36 s | See below                                                                                           |
| B. Login hint in D1     | Yes, with no extra round trip                   | 1 of 3 requests                       | A stale hint causes one more lookup. The code already handles this (`github.ts:239-250`).           |
| C. Grant in D1          | Yes                                             | 0 after idle time                     | Helps only if another isolate made a check in the last 60 s. Adds one D1 write for each live check. |

Option A, details that the report does not state:

- The token is more than "repository-scoped". `github.ts:141` asks for `{ repository_ids: [...] }` with no `permissions` field. GitHub then gives "all of the permissions that were granted to the app". `packages/security/README.md:30` lists them ("Required repository permissions are Metadata read, Actions read, Checks write, Pull requests read, and Contents read"), and they include **Checks write**. A person who reads a valid token can set the required Visonaut check to `success` for up to 1 hour. Encryption helps only if the key is not in D1.
- A new key needs a new entry in `secrets.required` (`apps/web/wrangler.jsonc:113-121`) or a key derived from a current secret.
- `GitHubAppConfiguration` has no database field (`github.ts:5-12`). The queue path also builds clients (`apps/web/src/runtime.ts:161-172`). The change touches the interface of `createGitHubClient`.
- D1 Time Travel keeps 30 days of history (https://developers.cloudflare.com/d1/reference/time-travel/). Old cipher text stays there. The tokens in it are expired after 1 hour.
- `apps/web/src/operations/recovery.ts:35-41` must delete the new table in a restored database.
- `packages/security/README.md:28` says the client "reuses only resolved installation-token bytes until their expiry". The text must change.
- Two isolates can mint at the same time. Both tokens are valid until they expire. The last write wins. This is safe.

Option B can be one statement, so the cost is zero round trips:

```ts
// packages/security/src/authorization.ts (sketch; table name is an example)
const accounts = await database
  .prepare(
    `SELECT a.accountId, h.login FROM account a
    LEFT JOIN github_login_hints h ON h.github_user_id = a.accountId
    WHERE a.userId = ? AND a.providerId = 'github'`,
  )
  .bind(session.user.id)
  .all<{ accountId: string; login: string | null }>();
```

The security rule does not change: `github.ts:220-223` compares the numeric ID in the permission response (`if (numericId(verifiedUser.id) !== id) return null;`).

Other options in the report:

- Option F (start the check during the page navigation) does not help with the current timings. The navigation task must do the same 6 D1 calls (about 0.75 to 0.9 s) before it can call GitHub. The API request starts about 0.2 to 0.3 s later and reaches its GitHub step first or at the same time. `pendingToken` is for one client object (`github.ts:133`), so both requests mint a token.
- Option E (run the read and the check at the same time) has a cost that the report gives as small. Any GitHub user can sign in. Denials are not stored (`authorization.ts:71-82`). The API has no rate limit (AUTH-14). Today such a request stops after 6 D1 calls. With option E it runs the full read, up to 20 D1 calls and a model of some megabytes, before the 403.
- A placement near the database (D1-02) also shortens each GitHub request if the GitHub origin is in North America. This is an assumption. I did not measure it.

Contract: `docs/current-contract.md:186` and `:204` limit only the permission result (60 s and 10 s). They say nothing about the token or the login. `:188` says "Runtime auth and App secrets remain in Cloudflare." D1 is in Cloudflare, so option A is not against the text. It is a new decision about a credential at rest.

### 4. Strongest counter-argument

The evidence is one production sample, and the cold rate is not known. An open dashboard tab polls each 60 s (`operations-attention/index.tsx:280`), so its isolate, the token (1 hour), and the login hint can stay warm for hours. Each warm request waits about 1 s for D1 with no GitHub request, so D1-01 and D1-02 remove more wait on every request, and they add no stored credential. Option A puts a token with Checks write at rest to save about 0.3 s once for each isolate.

Cheap check before a decision: in the trace list, count `fetch` spans to `/app/installations/163661534/access_tokens` for one day. That count is the number of cold isolates plus the hourly renewals. The span duration is the real cost.

---

## D1-01 · Better Auth validates the whole database schema on every request

Verdict: **confirmed**. Severity: **high**.

### 1. Hot path

- `packages/security/src/auth.ts:47-51`: `advanced` has no `database` key.
- I looked for a production switch that skips the check. There is none. `@better-auth/core/dist/db/schema-check.mjs:4-9`:
  ```js
  /** Whether the adapter validates its schema. Enabled in every environment unless explicitly disabled. */
  function checksSchema(options) {
    return options.advanced?.database?.validateSchema !== false;
  }
  ```
- `better-auth/dist/auth/base.mjs:9-19` starts the check when the instance is made. `better-auth/dist/api/to-auth-endpoints.mjs:40-42` awaits it: `const pendingSchemaCheck = rawContext.checkSchema?.(); if (pendingSchemaCheck) await pendingSchemaCheck;`. `better-auth/dist/api/index.mjs:169-170` does the same for `/api/auth/*`.
- One instance for each request: `apps/web/src/api/index.ts:130`, `apps/web/src/server.ts:85`, `:93`.

Schema checks for each user action:

| Action                              | Requests that await the check                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| Dashboard load                      | 2 (`/api/runs`, then `/api/operations`)                                           |
| Run page load                       | 1                                                                                 |
| Load from a pull request check link | 2 (`/api/pulls/:n`, then `/api/runs/:id`)                                         |
| One decision                        | 2 or more (`POST .../commands`, then each receipt poll); 3 for the first decision |
| Dashboard left open                 | 1 each minute                                                                     |
| CI image upload                     | 1 for each request, started and not awaited                                       |

### 2. Magnitude

- **Measured in production: 332 to 334 ms for each request** from `GRU` (guest `/api/runs` minus `/health`, two sets of 8 samples from two lanes). The value includes the construction of the instance.
- Share: about 34% of a warm `/api/runs` (0.33 of 0.97 s). About 0.67 s of the 2.6 to 3.7 s that the dashboard needs to become stable. About 0.67 to 1.0 s of each decision. About 6% of an archived run page (0.33 of 5.3 to 5.7 s).
- Rows read: 856 for each request. This has no effect on the bill. One open dashboard reads 1.2 million rows each day; the plan includes 25 billion each month.
- D1 load: the 75-statement batch takes about 1 to 2 ms of SQL time in local workerd (`audit/auth/measure-introspection.out.txt`: `"pragma_batch_sql_ms": 1`). D1 does one query at a time (platform fact 2), so CI uploads put 76 more statements in the same line. This is small.
- For a maintainer near the D1 region the time is smaller. Not measured.

### 3. Fix feasibility

`advanced: { database: { validateSchema: false } }` exists in 1.7.5. The first verification measured 4 calls → 2 calls on native local D1.

What can go wrong, and one correction to both first verifications:

- Both say that no test compares the migrations with the Better Auth schema. That is not complete. `packages/security/test/auth-d1.test.ts:28-31` applies the real migrations (`tooling/test-migrations.ts:3`: `new URL("../apps/web/migrations/", import.meta.url)`) to a native D1. Lines 35 and 54 then call `createAuth(configuration)` and `auth.api.getSession(...)`. The runtime check runs inside these tests. If a Better Auth upgrade needs a new column, these tests fail today.
- If `createAuth` turns the check off, these tests lose that guard without a visible change. Keep the guard on purpose:
  ```ts
  // packages/security/src/auth.ts (sketch)
  export interface AuthConfiguration { /* ... */ validateSchema?: boolean }
  // ...
  advanced: {
    database: { validateSchema: configuration.validateSchema ?? false },
    // ...
  }
  // packages/security/test/auth-d1.test.ts: one test builds createAuth({ ...configuration, validateSchema: true })
  ```
- After the change, a schema mismatch shows as a raw D1 error on the first statement that needs the column. `apps/web/src/api/index.ts:67-83` turns it into `503 service_unavailable`. The status is the same as today. The log message is less clear.
- The deploy applies migrations before the Worker (`deploy.yml:127`, `:133`), so the schema is not behind the code at deploy.

Security contract: `docs/current-contract.md` has no text about schema validation. The one-line option keeps "Construct Better Auth inside each production Worker request" (`packages/security/README.md:5`). The alternative with one instance for each isolate is against that line and against `auth.ts:15`.

The alternative "move `createAuth` below the ingest routes" is feasible: `auth` is used only at `apps/web/src/api/index.ts:131-133` and `:196`. The branch at `:131-133` cannot run in production, because `apps/web/src/server.ts:82-87` answers `/api/auth/*` first.

### 4. Strongest counter-argument

The runtime check fails closed and gives a clear message when the schema is wrong. If a placement near the database is done first (D1-02), the two calls can cost some tens of milliseconds, and then the option saves little time. This argument is weak: the change is one line, the tests can keep the guard, and the check also adds 76 statements to each CI upload.

---

## D1-02 · Every private request waits for 6 sequential D1 calls before its handler starts, and the review model needs 20

Verdict: **partly-confirmed**. Severity: **high**.

The counts are correct. Two statements are wrong (the first verification found both): the dashboard requests are in series, not parallel, and `/api/runs` skips the project read. The main recommendation is larger than is necessary.

### 1. Hot path

- Preamble for each private request: `apps/web/src/api/index.ts:123-126` (project), `:130` (schema check, 2 calls), `packages/security/src/authorization.ts:32-43` (session, user, account).
- `packages/service/src/run-status.ts:27-68`: six awaits in sequence (`service.run`, `service.comparison`, dead tasks, counts, `service.project`, promotion).
- `apps/web/src/api/review.ts:232`, `:276-307`, `:315-322`, `:323-365`: the review model.
- `apps/web/src/api/operations.ts:16-47`: three reads in sequence that do not depend on each other.

Sequential D1 calls that the user waits for:

| User action                    | Requests                                           | Sequential depth |
| ------------------------------ | -------------------------------------------------- | ---------------- |
| Dashboard: run list visible    | `/api/runs`                                        | 6                |
| Dashboard: alert badge visible | then `/api/operations`                             | 6 + 9            |
| Active run page                | `/api/runs/:id`                                    | 15               |
| Archived run page              | `/api/runs/:id`                                    | 11               |
| One queued decision            | `POST .../commands`, 500 ms wait, then the receipt | 11 + 19          |

### 2. Magnitude

Model from "Production timing model": 333 ms for the schema check and 105 to 145 ms for each other call, from `GRU`.

| Request                   | Depth | Model          | Measured in production |
| ------------------------- | ----- | -------------- | ---------------------- |
| `/api/runs`               | 6     | 0.78 to 0.94 s | 0.87 to 1.08 s         |
| `/api/operations`         | 9     | 1.10 to 1.38 s | 1.20 to 1.30 s         |
| `/api/runs/:id`, active   | 15    | 1.7 to 2.2 s   | not measured           |
| `/api/runs/:id`, archived | 11    | 1.3 to 1.7 s   | 5.3 to 5.7 s in total  |
| `/api/runs/:id/state`     | 14    | 1.6 to 2.1 s   | not measured           |
| Queued receipt            | 19    | 2.1 to 2.8 s   | not measured           |

Two results:

- For the dashboard, the D1 chain is almost all of the wait.
- For an archived run page, the D1 chain is about 25 to 30% of the wait. About 3.6 to 4.3 s comes from other work (the 5 to 6 MB model). That part is not in this finding.

Uncertainty: the model has two measured request types and one location. The value for one call near the database is not known.

### 3. Fix feasibility

| Change                                             | In the installed version                                                                        | Round trips                                                                                   | Risk                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validateSchema: false`                            | Yes                                                                                             | −2                                                                                            | See D1-01                                                                                                                                                                                                                                      |
| `advanced.database.joins: true`                    | Yes (`init-options.d.mts:375-389`; used at `@better-auth/core/dist/db/adapter/factory.mjs:562`) | −1 (session and user in one statement; measured on native local D1 by the first verification) | It changes every Better Auth query that has a join, also in the OAuth callback. `packages/security/README.md:44` says the local tests "do not substitute for deployed login". A sign-in on the deployed service is necessary after the change. |
| Project read at the same time as `getSession`      | `Promise.all`, no API question                                                                  | −1                                                                                            | An anonymous request to a wrong project gets 401 and not 503.                                                                                                                                                                                  |
| One batch in `readRunStatus`                       | `batch()` is one call and one transaction                                                       | −5                                                                                            | The statements depend on each other (`comparison_id`, `promotion_id`). They need subqueries. The early returns at `run-status.ts:29-55` must give the same results.                                                                            |
| One batch in `operationsStatus`                    | Yes                                                                                             | −2                                                                                            | None found.                                                                                                                                                                                                                                    |
| Placement near the database                        | Yes, `"placement": { "region": "..." }` in `env.production`                                     | Each call becomes short; one long hop for each Worker request                                 | See below                                                                                                                                                                                                                                      |
| Read replicas                                      | Needs `withSession` in all code                                                                 | No gain in Brazil                                                                             | Platform facts 3 and 4                                                                                                                                                                                                                         |
| Session cookie cache                               | Yes                                                                                             | −2                                                                                            | Against `docs/current-contract.md:186`: "Live session and linked-account checks still run for every request."                                                                                                                                  |
| Hand-written `session JOIN user LEFT JOIN account` | Yes                                                                                             | −2                                                                                            | It replaces the Better Auth cookie signature check, expiry check, and renewal. This is the report's main recommendation. `joins: true` gives almost the same result with Better Auth still in the path.                                        |

`readRunStatus` as one batch (sketch). The batch is a transaction, so the six reads see one state. Today they can see six different states.

```ts
const [run, comparison, dead, counts, project, promotion] = await database.batch([
  statement(database, "SELECT * FROM visonaut_runs WHERE id = ?", [runId]),
  statement(
    database,
    `SELECT * FROM visonaut_comparisons
    WHERE id = (SELECT comparison_id FROM visonaut_runs WHERE id = ?)`,
    [runId],
  ),
  // dead tasks, counts: same subquery for the comparison id
  // project: WHERE id = (SELECT project_id FROM visonaut_runs WHERE id = ?)
  // promotion: joined to the project row by promotion_id
]);
```

Placement, the facts:

- `"placement": { "mode": "smart" }` can stay undecided for a service with few users (platform fact 5).
- An explicit region does not need traffic. The region name is a cloud region (`aws:us-east-1`), not a D1 region. Read the D1 region first: `cloudflare.d1.response.served_by_region` in any trace, or `wrangler d1 info visonaut`.
- Put the key in `env.production` only. `placement` is inheritable, and the preview Worker has no database.
- Cost: the HTML document is rendered by the Worker (`apps/web/src/server.ts:118`), so its first byte arrives about 105 to 145 ms later for a visitor in Brazil (today 41 to 119 ms). Static files stay at the edge.
- The queue and cron handlers do not move.
- The gain is not measured.

Security contract: the first five rows keep the live session check and the live linked-account check on each request. They do not change the contract.

### 4. Strongest counter-argument

One configuration key can remove most of this wait. With the Worker near the database, 15 calls of 105 to 145 ms become one hop of that size plus 15 short calls. The code changes then give a small extra gain, and they touch the access check and the status logic, where the contract has many rules. A reasonable order is: `validateSchema: false`, then placement, then one traced request, then a decision about the batches. Against this argument: the cost of a short call is not known, 15 to 20 calls can still be 0.2 to 0.6 s, and the batch in `readRunStatus` also gives a consistent read.

---

## D1-04 · One status wakeup becomes a chain of queue messages that grows with the number of pull requests

Verdict: **partly-confirmed**. Severity: **medium** today. It increases with time and with no change in code.

The mechanism is correct. Three points need a correction: the cost numbers are for a synthetic size, one impact statement is too strong, and one recommended alternative has a bug.

### 1. Hot path

- Wakeups: `apps/web/src/api/review.ts:661` (`await context.operations.send({ kind: "status" });`, called at `:876`, `:880`, `:938` for each decision and each Undo), `apps/web/src/api/ingest.ts:63`, and the cron pass (`apps/web/src/runtime.ts:446-453`).
- Chain: `runtime.ts:454`: `else if (result.hasMore) await env.OPERATIONS.send(message, { delaySeconds: 1 });`.
- Page: `apps/web/src/operations/review-links.ts:168-171`, `LIMIT ?` with `tasksPerStep` (25).
- `review-links.ts:405-412`: `report.hasMore = rows.length === context.budget.tasksPerStep;`.
- No statement deletes from `pre_run_checks` (search of `apps/web/src` and `packages`).
- In the current database the step has no work. New rows get `check_head_sha = source_sha` (`apps/web/src/api/pre-run-checks.ts:629-646`), and the loop skips them: `if (candidate.checkHeadSha === candidate.sourceSha) continue;` (`review-links.ts:174`). `docs/baseline-delta-cutover.md:3` says that old rows were not copied. So in production each page is read and then ignored.

When does the chain start? At 25 pull requests with a workflow check. My measurement (`second-lens-4/measurements.txt`):

```
created >= 2026-09-05: 256     (31 days, 8.3 each day)
created >= 2026-09-28: 68      (8 days, 8.5 each day)
created >= 2026-10-04: 17      (since the database cutover)
open now: 5
```

So the count reaches 25 about 1 to 3 days after the cutover. It can be true now. About 250 after one month, 750 after three months, 3,000 after one year. Only 5 pull requests are open; the sweep reads all of them, open or closed. Assumption: a pull request counts only when it has a workflow-bound check (`review-links.ts:56-57`: `workflow_run_id IS NOT NULL`), so the real count can be lower than the number of created pull requests. The count in production is not read. This query gives it: `SELECT COUNT(DISTINCT pull_request_number) FROM pre_run_checks WHERE kind='pull_request' AND workflow_run_id IS NOT NULL`.

### 2. Magnitude

- Messages for one wakeup: `floor(P / 25) + 1`. The three measured sizes agree: 31 at 750, 21 at 500, 6 at 130.
- **Chains do not merge.** All chains use one cursor, and a chain stops only when its own message reads a short page. One sweep stops one chain. So `K` wakeups cost about `K × (floor(P / 25) + 1)` passes. Thirty decisions at `P = 750` are about 930 status passes.
- Cost of one idle pass: the review-link step is 4 D1 calls (first verification: 24 calls in 6 steps). The other status steps add more. The auditor measured 79 calls for a pass with 30 active runs. Production has fewer active runs. The real number is not measured.
- The 7,597,795 rows are for 3,001 runs. Most of them come from scans in other steps (`audit/d1/results.txt:139-140`: two statements read 3.1 million and 2.8 million rows over 31 passes; the review-link query at `:142` reads 0.28 million). They are D1-07 costs that the chain repeats. Production is small today ("Database: 5.5 MiB used", `audit/live-authenticated.md:45`).
- Money at the synthetic size: 7.6 million rows × 288 cron passes = 2.2 billion rows each day, 66 billion each month. That is 41 billion more than the plan includes, about 41 USD each month. Queue: 31 × 288 × 30 × 3 = 0.8 million operations, inside the included 1 million. At the real size of the next months the cost is near zero.
- Time: each message waits 1 s. A chain at `P = 750` keeps the single consumer busy for 30 s or more.
- Platform limits are not near: 179 D1 calls for each message (limit 1,000), 15 minutes of wall time.

Correction to the impact text: "Real check updates wait behind it" is too strong. Each pass of the chain runs `review-decisions` and `checks` first (`apps/web/src/operations/index.ts:47-51`, `:73-76`). The next message, from any chain, delivers a pending check. The work that waits is an `ingest` message when many chains are in the queue: it waits about `K` passes.

### 3. Fix feasibility

| Option                                              | Feasible                | Note                                                                                                                                                                                                                         |
| --------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact filter in the page query (first verification) | Yes, tested on local D1 | `candidatesSql + " AND checkHeadSha IS NOT sourceSha AND pullRequestNumber>? ..."`. Same rule as `review-links.ts:174`. `IS NOT` treats `NULL` correctly. The window query still reads all rows, but one time for each pass. |
| `source.updated_at > ?` (report, main)              | Yes                     | It can skip an old legacy pull request that gets a new verdict. The first verification found this.                                                                                                                           |
| `hasMore = rows.some(didWork)` (report, minimal)    | **Not as written**      | See below.                                                                                                                                                                                                                   |
| Review links only from cron                         | Yes                     | `apps/web/src/operations/README.md:5` says a status wakeup "runs checks, review links, and promotion". The text must change. A legacy mirror can then be up to 5 minutes late.                                               |
| Remove the step                                     | Yes, after two counts   | See below.                                                                                                                                                                                                                   |

The bug in the minimal alternative: the cursor is saved only when `hasMore` is true.

```ts
// review-links.ts:411
.bind(report.hasMore ? String(rows.at(-1)?.pullRequestNumber) : null)
```

If a full page with no work sets `hasMore` to false, the cursor becomes `NULL`. The next pass starts at pull request 0. The pages after the first idle page are never read. The page state and the wakeup must be two values:

```ts
const pageFull = rows.length === context.budget.tasksPerStep;
report.hasMore = pageFull && didWork;                       // wake the queue only for work
// ...
.bind(pageFull ? String(rows.at(-1)?.pullRequestNumber) : null)   // the cursor follows the page
```

With this form, cron moves one page each 5 minutes. A sweep of 750 pull requests takes 2.5 hours.

Removal: these two read-only queries must return 0 in production.

```sql
SELECT COUNT(*) FROM pre_run_checks WHERE kind='pull_request' AND check_head_sha IS NOT source_sha;
SELECT COUNT(*) FROM operations_review_links;
```

Security contract: `docs/current-contract.md:212` says "The required GitHub result must remain available on the unchanged PR head when GitHub regenerates its temporary merge commit." For new rows the check itself is on the pull request head (`apps/web/src/api/pre-run-checks.ts:506`: `head_sha: row.check_head_sha ?? row.tested_sha`). The exact filter keeps the mirror for legacy rows. A removal is safe only while no legacy row exists.

Queue API: `delaySeconds` exists in the installed types. No platform limit blocks any option.

### 4. Strongest counter-argument

Today there is no chain, and the page is not slow because of it. At some hundreds of pull requests the cost is some seconds of queue time and less than one USD. The expensive part of each pass is in D1-05 and D1-07; when those are fixed, a chain is cheap. Against this argument: the growth is certain and has no end, chains multiply with decisions, and the exact filter is one predicate.

---

## Missed

1. **Status chains do not merge.** One sweep stops one chain, so `K` wakeups cost `K × (floor(P / 25) + 1)` passes (`review-links.ts:405-412`, `runtime.ts:454`, `review.ts:661`). The report says that each decision starts a chain. It does not say that the chains multiply.
2. **The 25 pull request limit is some days away.** 17 pull requests since the cutover, about 8 to 9 each day (measured). The first verification says "today the chain does not occur". That stays true for a short time only.
3. **The minimal alternative for D1-04 resets the cursor.** See the code above.
4. **The native D1 auth tests are the schema guard today.** `packages/security/test/auth-d1.test.ts:28-54` runs the runtime check against the real migrations. `validateSchema: false` in `createAuth` removes this guard from the tests without a failure.
5. **The installation token has Checks write.** `github.ts:141` asks for no `permissions` limit. A stored token (AUTH-03 option A) can set the required check to `success`. The report's table says only "repository-scoped".
6. **AUTH-03 options E and F have costs that the report does not state.** F cannot finish before the API request needs it. E lets any signed-in GitHub user start the full read, because denials are not stored and the API has no rate limit.

## Limits of this check

- One location (São Paulo). All production numbers are from `GRU`.
- The D1 region is not read. "North America" is an assumption that fits the numbers.
- The GitHub latency is from a desk machine with public requests, not from the Worker.
- No signed-in request and no trace was read. The cold-isolate rate is not known.
- The gain from placement is a model. It is not measured.
