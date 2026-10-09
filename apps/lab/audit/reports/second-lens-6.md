# Second-lens check 6: API-01, API-02, API-05, CMP-01

Lens: platform facts, real impact in production, and fix feasibility. The first verifier checked that the cited code exists. I repeated a code check only where a claim in this lens depends on it.

Source state: commit `f83fef6`, worktree `serialized-dazzling-pixel`. Read-only. No repository file was changed. Skill invoked: `ariakit-general-workflow` (the remote is `github.com/ariakit/visonaut`; no Visonaut-specific workflow skill is installed).

## Verdicts

| ID     | Verdict   | First severity | My severity | One line                                                                                                                                           |
| ------ | --------- | -------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| API-01 | confirmed | high           | high        | Measured in production: about 330 ms for each private request at `GRU`. The one-line option exists in the installed version.                       |
| API-02 | confirmed | high           | medium      | Real in production (a signed-in view shows `#7746 · Pull request`). The SQL fix works, but it has four side effects that the report does not list. |
| API-05 | confirmed | high           | high        | 14 serial round trips at about 145 to 165 ms each is about 2.0 to 2.3 s for the smallest run page at `GRU`.                                        |
| CMP-01 | confirmed | high           | medium      | The path is dead and the contract text is wrong. There is no latency, no cost, and no exploit path. It is a decision about a security rule.        |

## Inputs and limits

- `api/report.md`, `api/verification.md`, `compare/report.md`, and `compare/verification.md` do not exist. I used `api/verify/recovered-report.md`, `compare/verify/recovered-report.md`, and the rerun outputs in the two `verify/` directories.
- I also read `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/live-authenticated.md` (the orchestrator's signed-in production timings) and `load/verification.md`.
- My probes are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-6/`:
  - `prod-guest-curl.txt`: 23 anonymous `GET` requests to production, with the command and the raw output.
  - `title-fix.sql` and `title-fix.out.txt`: the API-02 fix on local SQLite 3.51.0.
- I did not run the first auditor's Vitest probes again. The first verifier's rerun (`api/verify/roundtrips.result.txt`, `api/verify/schema-check.result.json`) equals the report. I compared the 19-trip sequence in `api/verify/roundtrips.result.json` with the code line by line.
- I had no signed-in production session. Each signed-in number below comes from the orchestrator's file and is marked.
- I ran no remote Wrangler command. So the D1 primary region and the request count of `visonaut-compare` are not known.

## Facts that the four findings share

### Production configuration

`apps/web/wrangler.jsonc:46-122` is `env.production`.

- Line 51: `"VISONAUT_ENVIRONMENT": "production"`. So `apps/web/src/server.ts:73` (`if (env.VISONAUT_ENVIRONMENT === "preview")`) is false. Each `/api/*`, `/v1/*`, and `/images/*` request reaches `handleApi` (`server.ts:106-117`).
- Lines 67-74: one D1 binding, `DB`. Lines 85-90: one service binding, `COMPARATOR` to `visonaut-compare`.
- The file has no `placement` key. The code has no `withSession` call (`rg withSession apps packages`: no match outside `node_modules`). So each D1 statement goes from the edge location of the request to the D1 primary.

### Cost of one D1 round trip (Measured: yes)

Command and raw output: `second-lens-6/prod-guest-curl.txt`. One `curl` process, one reused connection, 2026-10-05 20:29 GMT, edge location `GRU` (from `cf-ray`). Server wait is `time_starttransfer - time_pretransfer`.

| Path                      | D1 work, from the code                | Server wait, warm samples (ms) | Above `/health` |
| ------------------------- | ------------------------------------- | ------------------------------ | --------------- |
| `/health`                 | none (`server.ts:60-71`)              | 24, 25, 26, 30                 |                 |
| `/images/<unknown uuid>`  | 1 read (`api/images.ts:24-36`), no R2 | 157, 158, 192, 207, 224        | 130 to 200      |
| `/api/runs`, guest        | schema check only: 2 round trips      | 353, 356, 357, 360, 375        | about 330       |
| `/api/operations`, guest  | project read + schema check: 3        | 448, 464, 465, 468, 526        | about 440       |
| `/api/runs/<uuid>`, guest | project read + schema check: 3        | 521, 522, 524                  | about 495       |

Result: one serial D1 round trip costs about 145 to 165 ms from this location.

The signed-in numbers agree (orchestrator, `live-authenticated.md`, not measured by me): `/api/runs` 865 to 1,967 ms for 6 round trips, `/api/operations` 1,204 to 1,299 ms for 9 round trips.

Limits: one location, one hour, 3 to 5 samples for each path. A user near the D1 primary pays less for each round trip. The Cloudflare pages that I read give no latency figure for one D1 query.

### Platform facts from official documentation

| Fact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Source                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `batch()` "Sends multiple SQL statements inside a single call to the database. This can have a huge performance impact as it reduces latency from network round trips to D1." "Batched statements are SQL transactions." Statements "execute and commit, sequentially, non-concurrently."                                                                                                                                                                                                                               | https://developers.cloudflare.com/d1/worker-api/d1-database/                                                                                                                                                                       |
| "Each individual D1 database is inherently single-threaded, and processes queries one at a time." Limits: 100 bound parameters for each query, 100 KB for each statement, "1000 (Workers Paid) / 50 (Free)" queries for each invocation. Limits "apply to each individual statement contained within a batch statement."                                                                                                                                                                                                | https://developers.cloudflare.com/d1/platform/limits/                                                                                                                                                                              |
| Rows read: "First 25 billion / month included + $0.001 / million rows."                                                                                                                                                                                                                                                                                                                                                                                                                                                 | https://developers.cloudflare.com/d1/platform/pricing/                                                                                                                                                                             |
| D1 location hints: `wnam`, `enam`, `weur`, `eeur`, `apac`, `oc`. There is no South America region. The location is set when the database is created.                                                                                                                                                                                                                                                                                                                                                                    | https://developers.cloudflare.com/d1/configuration/data-location/                                                                                                                                                                  |
| "To use read replication, you must use the D1 Sessions API, otherwise all queries will continue to be executed only by the primary database."                                                                                                                                                                                                                                                                                                                                                                           | https://developers.cloudflare.com/d1/best-practices/read-replication/                                                                                                                                                              |
| Placement: "Smart Placement requires consistent traffic to the Worker from multiple locations to make a placement decision. The analysis process may take up to 15 minutes." "Smart Placement only considers locations where the Worker has previously run." "Placement only affects the execution of fetch event handlers." "Static assets are always served from the location nearest to the incoming request." Explicit keys: `region` (for example `aws:us-east-1`), `host`, `hostname`. The page does not name D1. | https://developers.cloudflare.com/workers/configuration/placement/                                                                                                                                                                 |
| "An async call that is neither awaited nor passed to `ctx.waitUntil()` can be canceled when the invocation ends." `waitUntil` gives "up to 30 seconds after the response is sent."                                                                                                                                                                                                                                                                                                                                      | https://developers.cloudflare.com/workers/runtime-apis/context/                                                                                                                                                                    |
| "Cannot perform I/O on behalf of a different request": I/O objects "created by one invocation of your Worker" cannot be used "in the context of a different invocation."                                                                                                                                                                                                                                                                                                                                                | https://developers.cloudflare.com/workers/observability/errors/                                                                                                                                                                    |
| "Each isolate can consume up to 128 MB of memory."                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | https://developers.cloudflare.com/workers/platform/limits/                                                                                                                                                                         |
| Service bindings: "there is zero overhead or added latency." "the target Worker ... must be deployed first."                                                                                                                                                                                                                                                                                                                                                                                                            | https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/                                                                                                                                                  |
| Better Auth schema validation: "enabled by default, including in production". "Requests await the same check and fail if the schema does not match." It "caches a clean result or mismatch per adapter instance."                                                                                                                                                                                                                                                                                                       | https://www.better-auth.com/docs/concepts/database                                                                                                                                                                                 |
| The same option on the options page: "(default: `true` outside production)". The two pages disagree. The installed code is the proof (see API-01).                                                                                                                                                                                                                                                                                                                                                                      | https://www.better-auth.com/docs/reference/options                                                                                                                                                                                 |
| GitHub installation tokens: "minimum rate limit of 5,000 requests per hour." "The installation access token will expire after 1 hour."                                                                                                                                                                                                                                                                                                                                                                                  | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api and https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app |
| GitHub and Cloudflare publish no latency figure for one REST request or for one RSA signature. I give counts only for those.                                                                                                                                                                                                                                                                                                                                                                                            |                                                                                                                                                                                                                                    |

Installed versions (checked in `node_modules/.pnpm`): `better-auth` 1.7.5, `@better-auth/core` 1.7.5, `@better-auth/kysely-adapter` 1.7.5, `wrangler` 4.136.1, `@cloudflare/workers-types` 5.20260922.1, `workerd` 1.20260921.1.

---

## API-01 · Better Auth scans the database schema on every private request

Verdict: **confirmed**. Severity: **high**.

### 1. Hot path

- `apps/web/src/api/index.ts:130`: `const auth = createAuth({ ...bindings.configuration.auth, database: bindings.database });`. This line runs for each `/api/*` and `/v1/*` request. Only images (`:113-122`) and webhooks (`:127-129`) return before it.
- `packages/security/src/auth.ts:21`: `return betterAuth({`. The `advanced` block (`:47-51`) has no `database` key.
- Installed Better Auth 1.7.5:
  - `@better-auth/kysely-adapter/dist/index.mjs:712`: `if (checksSchema(options)) registerSchemaCheck(instance, createSchemaCheck(() => findSchemaProblems(...), "database", options.database));`. One check for each adapter instance.
  - `@better-auth/core/dist/db/schema-check.mjs:58-59`: `let clean = false; let verdict;`. The result lives in a closure. A new instance starts with no result.
  - `better-auth/dist/api/to-auth-endpoints.mjs:41-42`: `const pendingSchemaCheck = rawContext.checkSchema?.(); if (pendingSchemaCheck) await pendingSchemaCheck;`. `auth.api.getSession` waits.
  - `@better-auth/kysely-adapter/dist/d1-sqlite-dialect-D4qp4-wW.mjs:89-98`: one `sqlite_master` query, then one `batch` with `SELECT * FROM pragma_table_info(?)` for each table and view. There is no table filter. The check reads all 75 tables and compares only the Better Auth tables.
- How often:
  - Dashboard: 2 (`/api/runs`, then `/api/operations`), then 1 each 60 s (`apps/web/src/components/operations-attention/index.tsx:280`).
  - Run page: 1, then 1 for each `/state` poll, 1 for each decision `POST`, and 1 for each receipt poll (`apps/web/src/review/client.ts:326-336`, 500 ms pause).
  - Pull page: 1 each 15 s (`apps/web/src/routes/pulls.$pullNumber.tsx:114`).
- One more caller: the `/v1/*` capture routes. `index.ts:130` is before them. `better-auth/dist/auth/base.mjs:15-18` starts the check when the instance is built and attaches only a `.catch`. The capture request does not wait, but D1 receives the 76 statements. Each uploaded image is one `PUT` (`apps/web/src/api/workflow-owned.ts:1005`). Verified in code. Not measured in workerd by me.

### 2. Magnitude

- Measured by me: guest `/api/runs` is 353 to 375 ms. `/health` is 24 to 30 ms. A guest request does no other D1 work: `index.ts:123-126` skips the project read for `GET /api/runs`, and `packages/security/src/authorization.ts:37-39` stops when there is no session. So the schema check costs about 330 ms for each request at `GRU`.
- The instance itself is not the cost. `load/verify/auth-init-cpu.json` gives a median of 0.074 ms for later instances (Node, first verifier's number).
- Share of the dashboard wait: 2 requests x about 330 ms = about 0.66 s of the 2.6 to 3.7 s that the orchestrator measured signed in. That is 18 to 25 percent. This is an estimate (count x measured cost).
- Money is not the problem. 856 rows read for each request (first auditor, M1) x 1 million requests = 856 million rows. The paid plan includes 25 billion each month.
- D1 load: the database processes "queries one at a time". Each private request, and each image upload, adds one 75-statement batch to that single queue. The duration of one batch was not measured.
- Uncertainty: the saving in milliseconds depends on the distance between the user's edge location and the D1 primary. The count (2 round trips, 76 statements) does not.

### 3. Fix feasibility

The recommended option exists in the installed version.

- `@better-auth/core/dist/types/init-options.d.mts:390-400`: "Set `false` to disable runtime schema validation. `@default true`".
- `@better-auth/core/dist/db/schema-check.mjs:7-9`: `return options.advanced?.database?.validateSchema !== false;`.
- With `false`, `kysely-adapter/dist/index.mjs:712` registers nothing, `ctx.checkSchema` is `undefined` (`better-auth/dist/context/create-context.mjs:231`), and `base.mjs:11` logs nothing.
- The first auditor and the first verifier measured 6 to 4 round trips and 80 to 4 statements. I did not run it again.
- History: upstream added the check in 1.7.3 (`packages/core/CHANGELOG.md`: "Validation is enabled by default, including in production"). Visonaut started on 1.7.5 (`git log -G'"better-auth":'` gives one commit, `43552ce`, 2026-09-22). So production always had this cost. It is not a regression.

What can go wrong:

1. The repository loses an implicit test. Today each test that calls `createAuth` on a migrated D1 (`packages/security/test/auth-d1.test.ts:34-48`) also runs the check. After the change no test compares the migrations with Better Auth. One explicit test replaces it:

   ```ts
   // packages/security/src/auth.ts
   export interface AuthConfiguration {
     // ...
     validateSchema?: boolean; // tests only
   }
   // ...
   advanced: {
     database: { validateSchema: configuration.validateSchema ?? false },
     cookiePrefix: `visonaut-${configuration.environment}`,
     // ...
   },
   ```

   ```ts
   // packages/security/test/auth-d1.test.ts
   it("matches the Better Auth schema", async () => {
     const auth = createAuth({ ...configuration, validateSchema: true });
     // getSession waits for the check and rejects on a mismatch.
     await expect(auth.api.getSession({ headers: new Headers() })).resolves.toBeNull();
   });
   ```

2. A schema mismatch then shows as an SQL error on the affected query (HTTP 503), not as a clear error on each auth request. Both results fail closed.
3. Do not rely on a default. The two upstream pages give different defaults. Set the value explicitly.

Security contract: no change. `docs/current-contract.md:186`: "Live session and linked-account checks still run for every request." Both reads stay. `packages/security/README.md:5` ("Construct Better Auth inside each production Worker request") stays true.

The alternative "one instance for each isolate" has a real hazard. `createSchemaCheck` shares one pending promise between concurrent callers (`schema-check.mjs:33`: "The first call runs `find` and every concurrent call shares that promise"; `:68`: `return verdict ??= Promise.resolve().then(find)`). Request B then waits for D1 I/O that request A started. If A ends first, the runtime can cancel that I/O. The repository already has a rule against this: `packages/security/src/github.ts:106`: "pending I/O stays within the request's client". After `validateSchema: false`, a shared instance gives no more gain, because construction costs 0.07 ms.

### 4. Strongest counter-argument

"The check is the library's fail-closed guard, and the 330 ms is a location effect. Put the Worker near D1 and the two round trips cost a few milliseconds. Then keep the default."

Facts against it: Smart Placement is not sure to activate for this traffic (see API-05). The check also sends 76 statements to a single-threaded database for each request and for each uploaded image. A CI test gives the same protection at the only time when the schema can change, which is a deploy.

---

## API-02 · Pull request titles cannot be found after the webhook is processed

Verdict: **confirmed**. Severity: **medium** (first auditor: high).

### 1. Hot path

- Readers: `apps/web/src/api/dashboard.ts:57-62` (in both `readRuns` statements of the batch at `:68-81`, so on each dashboard load) and `apps/web/src/api/review.ts:286-290` (on each run model).
- Writer: `apps/web/src/api/webhooks.ts:330-335`: `"UPDATE github_webhook_delivery SET processed_at = ?, payload_json = '{}' WHERE delivery_id = ? AND payload_digest = ?"`. It is the last statement of `processWebhook`. The `pull_request` branch (`:279-329`) has no return before it. `receiveWebhook` runs `processWebhook` in `waitUntil` together with the 202 (`:350-357`).
- So each processed `pull_request` delivery has the payload `{}`. A title is readable only while a delivery is pending, for example after a processing error.
- Production evidence (orchestrator, signed in, `live-authenticated.md`): "History rows show `#7746 · Pull request` because no pull request title is available." I did not read production rows.
- Local proof by the first verifier: `load/verify/pr-title.json` gives `beforeProcessing: { title: "Add the tooltip arrow" }` and `afterProcessing: { pullRequestNumber: 7 }`.

### 2. Magnitude

- All pull request runs are affected after the delivery is settled.
- Visible effects: the row text is `run.title ?? kindLabel(run.kind)` (`apps/web/src/routes/index.tsx:499,586,714`), the run page shows `#N · Pull request visual review` (`review.ts:561`), and the search string at `index.tsx:619` has no title in it.
- No latency cost. No data loss. No security effect. The lookup still runs for each pull request row and finds nothing through index `0028`.
- Why medium: the feature from #155 does not work in production and its test hides that (`apps/web/src/api/dashboard.test.ts:46-55` stores a full payload with a non-null `processed_at`). But the pull request number is shown, and no decision or check result depends on the title.

### 3. Fix feasibility

The recommended statement works. Measured: yes (`second-lens-6/title-fix.sql`, SQLite 3.51.0):

```text
rows after settle  d1  pull_request  {}                                                                                      2
rows after settle  d2  pull_request  {"repository":{"id":104133653},"pull_request":{"number":7,"title":"Fix dialog focus (v2) \"quoted\" ünïcode"}}  110
rows after settle  d3  check_run     {}                                                                                      2
review.ts:288 reader  Fix dialog focus (v2) "quoted" ünïcode
`--SEARCH github_webhook_delivery USING INDEX github_webhook_delivery_pr_title (<expr>=? AND <expr>=?)
old settled rows that can be repaired from stored data  0
```

D1 supports `json_object` and `json_extract` (https://developers.cloudflare.com/d1/sql-api/query-json/). A kept row is about 110 bytes.

Side effects that the report does not list:

1. Old rows stay empty. Their payload is gone, so SQL cannot repair them (last output line: 0). A title returns only when GitHub sends a new `pull_request` event for that pull request, or after a backfill with one `GET /repos/{owner}/{repo}/pulls/{number}` for each number.
2. The runbook erases the kept titles if it is run again. `docs/operations/compact-processed-webhooks.sql:1-9` selects `processed_at IS NOT NULL AND payload_json != '{}'`. `apps/web/src/api/webhooks.test.ts:3694` uses the same condition, and the tests at `:3452`, `:3463`, `:3611`, and `:3629` expect `"{}"`.
3. Four other statements also write `'{}'`: `webhooks.ts:150` (App lifecycle events), `webhooks.ts:172` (restore fence, all events), `apps/web/src/operations/recovery.ts:73` (restore activation, all rows), and `packages/security/src/webhooks.ts:147`. A database restore removes all titles again.
4. `docs/operations/compact-processed-webhooks.md:3` says which fields are kept: "Keep `delivery_id`, `event`, `payload_digest`, `received_at`, and `processed_at`". The fix adds three payload fields to that rule.

The alternative (a real column or a small table) has no extra GitHub cost. `processWebhook` already has the pull in memory at `webhooks.ts:282`: `const pull = object(await github.request(\`/repos/${github.repository}/pulls/${number}\`));`. It needs a new migration. `docs/current-contract.md:126` says that applied migrations stay unchanged, so it must be a new file.

```ts
// apps/web/src/api/webhooks.ts, after line 282
await context.database
  .prepare(
    "INSERT INTO pull_request_titles(repository_id, number, title, updated_at) VALUES(?,?,?,?) ON CONFLICT(repository_id, number) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at",
  )
  .bind(github.repositoryId, number, String(pull.title ?? ""), Date.now())
  .run();
```

Security contract: no rule mentions titles. `ariakit/ariakit` is a public repository, so the title is public text. It stays behind the private API in both options.

### 4. Strongest counter-argument

"The title is cosmetic. The number and the link are present. The payload compaction was a deliberate capacity decision (`docs/evidence/capacity-admission-20260928.md:7` estimates about 335 MB and 81 MB of JSON). The quick fix adds a special case to several statements and to a runbook. The UI redesign can decide first if a title is shown at all."

Fact against it: the redesign goal is less text that says more. A row that reads `#7746 · Pull request` cannot be recognized without the title.

---

## API-05 · Each private request repeats the same serial reads

Verdict: **confirmed**. Severity: **high**.

### 1. Hot path

Each run page view sends `GET /api/runs/:id` (`apps/web/src/routes/runs.$runId.tsx:37-47`, `apps/web/src/review/client.ts:365-373`). I compared the recorded sequence (`api/verify/roundtrips.result.json`, entry "review model") with the code:

| Trip              | Statement                                                       | Code                                                | Serial step     |
| ----------------- | --------------------------------------------------------------- | --------------------------------------------------- | --------------- |
| 1                 | `visonaut_projects`                                             | `api/index.ts:125`                                  | 1               |
| 2, 3              | schema check                                                    | API-01                                              | 2, 3            |
| 4, 5              | `session`, `user`                                               | `authorization.ts:32-36`                            | 4, 5            |
| 6                 | `account`                                                       | `authorization.ts:40-43`                            | 6               |
| 7                 | `visonaut_runs`                                                 | `review.ts:232` to `:90`                            | 7               |
| 8                 | `visonaut_projects` again                                       | `review.ts:292`                                     | parallel with 9 |
| 9, 10, 13, 14, 15 | run again, comparison, dead tasks, counts, project a third time | `packages/service/src/run-status.ts:27,45,50,58,61` | 8 to 12         |
| 11                | batch of 3                                                      | `review.ts:277-291`                                 | parallel with 9 |
| 12                | `visonaut_comparisons` again                                    | `review.ts:305`                                     | parallel with 9 |
| 16                | capture probe                                                   | `review.ts:315-322`                                 | 13              |
| 17, 18, 19        | rows, eligible approvals, batch of 5                            | `review.ts:323-365`                                 | 14              |

Result: 19 round trips and 14 serial steps. The claims "project 3 times, run 2, comparison 2" are correct. A run with a current promotion adds one more serial step (`run-status.ts:62-68`).

Other callers of the same work:

- Each completed receipt poll builds the full model again (`review.ts:814`), and so does each conflict (`review.ts:683`). The first auditor measured 23 round trips for that poll.
- First decision: `POST /api/review-sessions` has write access. `authorization.ts:63` skips the cache for `"write"`, `:71` deletes the entry, and `:74` does not store the new result. The `POST .../commands` that follows has review access and finds no entry. So there are 2 GitHub permission requests in sequence. I confirmed this in the code. I did not measure it.
- Later decisions make 1 GitHub request when the last check is older than 10 s (`authorization.ts:23,61-63`). The contract permits this.

### 2. Magnitude

- Smallest run page at `GRU`: 14 serial steps x 145 to 165 ms = about 2.0 to 2.3 s before the response. This is an estimate (count x measured cost for one round trip).
- Signed-in numbers (orchestrator, not mine): `/api/runs` 865 to 1,967 ms for 6 round trips, `/api/operations` 1,204 to 1,299 ms for 9.
- Large archived runs (orchestrator): 5.2 to 5.7 s server wait and 5.3 to 6.0 MB of JSON. These runs use the archive branch (`review.ts:242-248`). Nobody counted the round trips of that branch. My assumption: for these runs the model size is the larger part, and this finding is the smaller part.
- GitHub: there is no official latency figure. Count only: 1 extra HTTPS request to `api.github.com` on the first decision. The rate limit (5,000 for each hour) is not a concern.
- RSA signing: `createAppJwt` (`packages/security/src/github.ts:135`) runs only when the per-isolate token cache misses (`github.ts:166-173`), and a token lives 1 hour. It is not on the warm path. Each request does one SHA-256 of the key (`github.ts:116-119`). No official timing. Not measured.

### 3. Fix feasibility

`batch()` exists and the repository already uses it this way (`apps/web/src/api/dashboard.ts:68-81`, which also checks the project at `:82-90`). A dependent ID does not need a second round trip:

```ts
const [run, project, comparison, counts] = await context.database.batch([
  db.prepare("SELECT * FROM visonaut_runs WHERE id = ? AND project_id = ?").bind(runId, projectId),
  db.prepare("SELECT * FROM visonaut_projects WHERE id = ?").bind(projectId),
  db
    .prepare(
      "SELECT * FROM visonaut_comparisons WHERE id = (SELECT comparison_id FROM visonaut_runs WHERE id = ?)",
    )
    .bind(runId),
  db
    .prepare(
      `SELECT ${pendingReviewCountSql} AS pending, ${rejectedReviewCountSql} AS rejected
    FROM visonaut_comparison_rows row LEFT JOIN visonaut_decisions decision ON decision.id = row.decision_id
    WHERE row.comparison_id = (SELECT comparison_id FROM visonaut_runs WHERE id = ?)`,
    )
    .bind(runId),
]);
// reviewStatus({ run, comparison, pending, rejected, ... }) is a pure function.
```

A batch is one transaction. That is a small gain: today the serial reads can see different revisions, and `review.ts:816` compensates for it.

My count of what each step removes for `GET /api/runs/:id`:

| Change                                                                                                        | Serial steps | Estimate at `GRU`  |
| ------------------------------------------------------------------------------------------------------------- | ------------ | ------------------ |
| Today                                                                                                         | 14           | 2.0 to 2.3 s       |
| API-01 only                                                                                                   | 12           | 1.7 to 2.0 s       |
| Also skip the first project read and pass the loaded run and project into the status                          | 10           | 1.45 to 1.65 s     |
| One batch for run, project, comparison, counts, and metadata; one wave for rows; `joins` for session and user | about 4      | about 0.6 to 0.7 s |

Limits and risks:

- The session, user, and account reads cannot be cached or removed. `docs/current-contract.md:186`: "Live session and linked-account checks still run for every request."
- `advanced.database.joins` exists in the installed version (`init-options.d.mts:375-389`, `@default false`, "Not all adapters support joins"). The first verifier saw one round trip for session and user with it, on local D1. Test it on native D1 before use.
- Read replicas cannot help the access check. A replica read is not a live read, and D1 has no region in South America.
- `reviewModel` is 391 lines with archive and historical branches. The status logic decides `reviewReady`. A batch variant must keep the 409 for a missing record and the repository check.
- The error order changes. Today a wrong project configuration gives 503 before the 401.

Placement is the other lever. It lowers the cost of each round trip and changes no application code.

```jsonc
// apps/web/wrangler.jsonc, env.production. Installed wrangler 4.136.1 accepts both forms
// (node_modules/wrangler/config-schema.json, RawEnvironment.placement).
"placement": { "mode": "smart" }
// or, when the D1 primary region is known:
"placement": { "region": "aws:us-east-1" }
```

- Smart Placement "requires consistent traffic to the Worker from multiple locations" and "only considers locations where the Worker has previously run". This Worker has one maintainer location, GitHub webhooks, and CI. The result can be `INSUFFICIENT_INVOCATIONS`. Assumption; not tested.
- The explicit form needs the D1 primary region. Any D1 result gives it in `meta.served_by_region` (`@cloudflare/workers-types/index.d.ts:14534`).
- "Placement only affects the execution of fetch event handlers." The queue consumer and the cron are not moved. Static assets stay at the edge. The SSR document gets one long hop (its warm first byte is 41 to 119 ms today, orchestrator).
- The placement page does not name D1. So the effect on D1 round trips must be measured after the change.

The first-decision change (store the positive result of a write check for the 10-second class):

```ts
// packages/security/src/authorization.ts:74
// today:   if (access !== "write") { ... permissions.set(key, { identity, checkedAt }); }
// change:  permissions.set(key, { identity, checkedAt });   // for all three classes
```

- `docs/current-contract.md:204` permits reuse "for at most 10 seconds from the start of the GitHub permission request that established it". `authorization.ts:72` already takes `checkedAt` before the request. A write still checks live, so "all other writes retain a live repository-permission check" stays true.
- I read `packages/security/test/auth-d1.test.ts:225-273` and `:324-372`. No assertion there forbids it. I did not run the tests with the change.
- This changes an approved security rule in practice (a write result would also serve reads for 60 s). It needs the maintainer's explicit approval.

### 4. Strongest counter-argument

"The price of one round trip is the main term, not the count. One configuration line turns 14 x 150 ms into 14 short hops and one long hop, and it does not touch security-relevant code. After that, the dedupe saves little. For large runs the 5 to 6 MB model is the wait, and the dedupe does not change it."

Facts against it: placement is not sure to activate for this traffic. Fewer round trips also lower the load on a single-threaded database. The two project reads and the second run read are plain duplicates with no security purpose.

---

## CMP-01 · No request reaches `POST /validate`, but the contract says the Worker validates uploads

Verdict: **confirmed**. Severity: **medium** (first auditor: high).

### 1. Hot path

There is no hot path. That is the finding. Proof for the production configuration:

- The only call: `apps/web/src/api/workflow-owned.ts:1066-1067`: `if (capability.comparisonMode !== LOCAL_COMPARISON_MODE) {` then `context.comparator.fetch("https://compare.internal/validate", ...)`. `rg comparator apps packages` (without tests) gives no second call.
- Both capability issuers set local mode: `workflow-owned.ts:383` and `apps/web/src/api/local-comparison.ts:440`. A reservation in another mode fails at `workflow-owned.ts:182-187`.
- A capability lives 15 minutes at most (`packages/security/src/capabilities.ts:98,123`). The admission fence was deployed before 2026-10-03 (`docs/operations/retire-server-comparison.md:5`).
- So a production `PUT /v1/uploads/{ticket}` does this: size and SHA-256 check (`workflow-owned.ts:1038-1044`), a check that a signed local receipt exists (`:1090-1101`), then `context.images.put(...)` (`:1103-1106`). The object goes to the `IMAGES` bucket, which the public route reads (`apps/web/src/api/images.ts:24-40`).
- Not verified: the production request count of `visonaut-compare`. That needs Cloudflare analytics.

### 2. Magnitude

- Latency: 0. The call does not occur.
- Run cost: Workers are billed for requests, and there are none. Not measured.
- The real impact is a wrong statement in the binding contract:
  - `docs/current-contract.md:24`: "The service validates signed provenance, reference binding, receipt metrics, and image bytes before importing the result."
  - `:32`: "The private Worker validates PNG/WebP through fetch".
  - `:48` (D03): "Keep the Worker's image validation, required codecs/readers".
  - `:59` (D16): "Keep public validated image bytes".
  - `docs/operations/retire-server-comparison.md:39`: "Retained images and validation still need them."
- What is true today: only the trusted Submit job decodes. `packages/cli/src/png-comparison.ts:15,25` runs `validateImage` and a full PNG decode. `packages/cli/src/local-comparison.ts:239` calls it for each capture. The service takes width and height from the signed manifest.
- Exposure if the trusted job is wrong or compromised: a blob of 2 MiB or less (`packages/compare/src/types.ts:10`) that matches its declared digest gets a public URL with the type `image/png`. `images.ts:48-57` limits the effect: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: same-origin`. I found no script execution path. I did not test browsers.
- Side costs: a deployed Worker with production D1, R2, and queue bindings that no code uses (`apps/compare/wrangler.jsonc:38-59`), and one more deploy step before each web deploy (`.github/workflows/deploy.yml:130-131`).
- Why medium: no user-visible effect, no measured cost, and no exploit path. It is a decision about a security statement, not a defect that hurts users now.

### 3. Fix feasibility

Each direction is possible. Each has a different risk.

**A. Remove the branch, the binding, and the Worker.**

- Order: deploy the web Worker without the binding first, then delete `visonaut-compare`. A service binding needs its target to exist when the binding Worker deploys.
- These must change in the same build, or production fails:
  - `apps/web/src/runtime.ts:48-54`: `for (const binding of ["DB", "IMAGES", "QUARANTINE", "OPERATIONS", "COMPARATOR"] as const) { if (!env[binding]) { throw new Error(...) } }`. If the binding is gone and this list still names it, each backend request gives 503 (`server.ts:81,119-126`).
  - `.github/workflows/deploy.yml:352-354`: `assert.deepEqual(configuration.services..., [{ binding: 'COMPARATOR', service: 'visonaut-compare' }])`.
  - `.github/workflows/deploy.yml:130-131` (the comparator deploy step) and `.github/workflows/scripts/deploy-infrastructure.mjs:32-40` (it reads the `visonaut-compare` settings and fails with "Cannot read the production comparator bindings" when the Worker is deleted).
  - `apps/web/src/api/context.ts:78`, `apps/web/wrangler.jsonc:85-90`, and the tests.
- Rollback: an older web version still declares the binding. Delete the compare Worker only after the rollback window ends.
- Contract: D03 is an explicit "keep" rule. Removal needs an approved replacement rule in `docs/current-contract.md` (line 7: a requirement "remains binding unless an explicit approved rule below supersedes it").

**B. Validate the structure inside the web Worker.**

```ts
// apps/web/src/api/workflow-owned.ts, before context.images.put
const validated = await validateImage(bytes); // @visonaut/compare, no WASM
if (
  validated.digest !== image.digest ||
  validated.width !== image.width ||
  validated.height !== image.height
) {
  throw new SecurityError("image_mismatch", 422, "The image metadata differs.");
}
```

- The package is already a dependency (`apps/web/package.json:37`).
- Memory risk that the report does not state: `inflateBounded` is asynchronous (`packages/compare/src/binary.ts:40-67`, `DecompressionStream`), so several uploads can interleave in one isolate. The CLI sends 5 `PUT` requests in parallel (`packages/cli/src/engine.ts:33`). At the pixel bound (2,100,000 pixels, `types.ts:11`) the inflated data is about 8.4 MB and is held twice (the parts and the joined copy). Five images are about 85 MB plus the request bodies, against 128 MB for an isolate. This is a calculation, not a measurement. The compare Worker has a one-image gate for this reason (`apps/compare/src/capacity.ts:8-20`).
- It checks the structure, each CRC, and the inflate bound. It is not a full pixel decode. The contract text must say that.

**C. Call `/validate` for local uploads also.**

- The contract text becomes true again with no document change.
- The Worker admits one image at a time for each isolate and answers 503 `codec-busy` with `Retry-After: 1` (`apps/compare/src/validate.ts:39-44`). With 5 parallel uploads, retries will occur (`packages/cli/src/http.ts:6`). The added upload time was not measured.

**D. Correct the documents only.** No runtime risk. The dead branch and the unused Worker stay.

### 4. Strongest counter-argument

"Nothing is broken at runtime. D03 kept the Worker on purpose. The service already trusts the Submit job for the receipt, which contains the changed-pixel counts. A second decode on the server adds no new trust. Removal touches the startup binding check and two deploy guards, so it has an outage risk and gives users nothing. Option D is the cheap and correct action."

Fact against it: the contract is the binding document, and four of its lines describe a server check that does not occur. A reader of `uploadStagedImage` sees "The image failed trusted decoding" (`workflow-owned.ts:1076`) and can assume that each upload is decoded.

---

## Items that the reports missed

1. **Smart Placement may not activate.** The documentation requires "consistent traffic to the Worker from multiple locations". The placement recommendations in the other lanes do not state this condition. The explicit `region` form is the reliable variant, and it needs the D1 primary region first.
2. **D1 has no South America region.** Read replicas cannot bring the database near this maintainer, and a replica read conflicts with the "live session" rule. Only fewer round trips or Worker placement can lower the wait.
3. **API-02 fix side effects.** The compaction runbook and its test erase kept titles on a second run, a restore erases them, and old rows cannot be repaired from stored data.
4. **CMP-01 option B memory.** Five parallel uploads with an asynchronous inflate can hold about 85 MB in one 128 MB isolate.
5. **CMP-01 option A outage path.** `requireBackendBindings` and two deploy guards must change in the same build as the binding removal.
6. **Better Auth documents two different defaults** for `validateSchema`. Set the value explicitly. Do not depend on the environment.

## Sources

- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/configuration/data-location/
- https://developers.cloudflare.com/d1/best-practices/read-replication/
- https://developers.cloudflare.com/d1/sql-api/query-json/
- https://developers.cloudflare.com/workers/configuration/placement/
- https://developers.cloudflare.com/workers/runtime-apis/context/
- https://developers.cloudflare.com/workers/observability/errors/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- https://www.better-auth.com/docs/concepts/database
- https://www.better-auth.com/docs/reference/options
- https://github.com/better-auth/better-auth/blob/0d6b5c0beaa47c8ac6d9a49d5ecacfb719285277/packages/core/CHANGELOG.md
- https://github.com/better-auth/better-auth/issues/11346
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
- https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user
