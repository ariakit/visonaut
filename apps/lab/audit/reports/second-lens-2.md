# Second-lens check: REVIEW-01 to REVIEW-04 (run review load path)

Lens: platform facts, real impact, and fix feasibility. Read-only. Repository commit `f83fef6`. Date: 2026-10-05.

## Read this first

- `review-load/report.md` does not exist. I used the four one-line findings, `review-load/verification.md`, the raw probe files, the code, the installed dependencies, and the official documentation.
- I did not repeat the first verifier's line checks. I checked different things: which requests pay the cost, how large the cost is in production, and if each fix exists in the installed versions.
- All my files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-2/`.

| File                                            | What it is                                                                                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `production-timing.txt`                         | 13 anonymous production `GET` requests on one connection (`curl -w`).                                                                                |
| `state-depth.lens.ts` → `state-depth-3582.json` | `reviewModel` on a 3,582-capture inventory run: I/O count and sequence depth for two run states, cost split of the inventory read, retained heap.    |
| `auth-options.lens.ts` → `auth-options.json`    | `requireMaintainer` with the current Better Auth options and with `validateSchema: false`, on native local D1. Also the behavior after schema drift. |
| `rsa-sign.mjs` → `rsa-sign.json`                | One RS256 signature, local Node.                                                                                                                     |
| `docs/*.md`, `docs/*.html`                      | Raw copies of the cited Cloudflare and Better Auth pages. I checked each quote in this document against these files with `rg`.                       |

Verdicts:

| ID        | Verdict          | Severity | Confidence                     | Largest correction                                                                                                                            |
| --------- | ---------------- | -------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| REVIEW-01 | confirmed        | high     | high                           | The check is a real fail-closed guard. Keep it in one test if you remove it from requests.                                                    |
| REVIEW-02 | confirmed        | high     | medium                         | The D1 region is not read. Smart Placement can stay inactive. A region hint is the deterministic form.                                        |
| REVIEW-03 | partly-confirmed | medium   | high (counts), medium (impact) | The depth is 15 only for an active run that needs review. It is 10 for the archived runs that were measured in production.                    |
| REVIEW-04 | confirmed        | high     | medium                         | Hashing is 3% of the cost. Validation and the canonical check are 88%. About 3.8 to 4.3 s of the measured 5.3 to 5.7 s is not D1 round trips. |

## Shared facts

### Fact 1. My production timing agrees with the first verifier

Command: `curl -s -o /dev/null -w @curl-format.txt <url> --next ...` (one connection, `cf-ray: ...-GRU`, no `cf-placement` header).

```text
# second-lens-2/production-timing.txt (ttfb, seconds, warm connection)
/health                        0.034 0.028 0.029 0.113   no D1
/images/<unknown uuid>   404   0.182 0.156 0.177 0.174   1 D1 round trip
/api/runs                401   0.353 0.342 0.372 0.368   2 D1 round trips (the schema check only)
```

- One simple D1 round trip: median 175 - 31 = about 145 ms. The first verifier measured 125 ms. Use 125 to 145 ms.
- The two schema-check trips together: median 360 - 31 = about 330 ms. The second trip is a batch of 75 statements, so it is slower than a simple trip.

### Fact 2. A simple model predicts the signed-in dashboard numbers

Model: server wait = 0.33 s (schema check) + (other sequential D1 trips) x 0.125 to 0.145 s.

| Request                     | Sequential D1 trips | Model          | Measured (`audit/live-authenticated.md`) |
| --------------------------- | ------------------- | -------------- | ---------------------------------------- |
| `GET /api/runs` (dashboard) | 6                   | 0.83 to 0.91 s | 0.87 to 1.08 s (one sample 1.97 s)       |
| `GET /api/operations`       | 9                   | 1.21 to 1.35 s | 1.20 to 1.30 s                           |

The model fits. So D1 round trips explain almost all of the dashboard wait. This is an inference from counts and anonymous timing. It is not a trace.

### Fact 3. The same model does not explain the run page

The production run samples are "three archived runs of pull request #7746". An archived pull request run has `active = 0`. For that state `readRunStatus` returns after one read (`packages/service/src/run-status.ts:27-35`, `packages/service/src/review-status.ts:77`: `if (!run.active) return empty(run.state === "accepted" ? "passed" : "superseded");`).

I measured both states with the real `reviewModel` (`state-depth-3582.json`):

```text
state                            D1 trips in the model   R2 gets   I/O steps in sequence (model only)
active run that needs review     15                      2         11.9 / 10.6   (9 D1 + 2 R2 by code)
run with active = 0 (superseded) 10                      2          7.5 / 5.9    (4 D1 + 2 R2 by code)
```

With the 6 prelude trips (`project`, 2 schema, `session`, `user`, `account`), the complete request has:

| Run state             | D1 trips in sequence | D1 wait by the model | Production measurement     |
| --------------------- | -------------------- | -------------------- | -------------------------- |
| Active, needs review  | 15                   | about 1.95 to 2.2 s  | none                       |
| Archived (superseded) | 10                   | about 1.3 to 1.5 s   | server wait 5.25 to 5.68 s |

So for the measured samples, about 3.8 to 4.3 s (72 to 76%) of the server wait is **not** D1 round trips. What remains on that path is two R2 downloads, the inventory validation, the model build, and the JSON output. The split of this part is not measured. Assumption: the three runs were not `detail_archived`. If they were, the D1 path is different.

### Fact 4. Official documentation has no latency number for D1, R2, or the GitHub REST API

- D1: the only numbers are replica lag between regions, 30 to 75 ms (https://blog.cloudflare.com/d1-read-replication-beta/). The placement page says, for a database in general: "Reducing round-trip latency from 20 to 30 milliseconds per query to 1 to 3 milliseconds improves response times." (https://developers.cloudflare.com/workers/configuration/placement/).
- D1 has no location in South America: "D1 location hints are not currently supported for South America (`sam`), Africa (`afr`), and the Middle East (`me`)." (https://developers.cloudflare.com/d1/configuration/data-location/). Read replicas exist only in the same six regions (ENAM, WNAM, WEUR, EEUR, APAC, OC), and "To use read replication, you must use the D1 Sessions API, otherwise all queries will continue to be executed only by the primary database." (https://developers.cloudflare.com/d1/best-practices/read-replication/).
- GitHub REST API: the best-practices page gives no latency number (https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api). Not measured in production.
- RSA signing: no official number. Local Node: one RS256 signature is 0.5 ms (`rsa-sign.json`). It is not a relevant part of any of these four findings.

So every production number in this document comes from a measurement or from a count. I state which one each time.

---

## REVIEW-01: better-auth checks the database schema on each private API request

**Verdict: confirmed. Severity: high. Confidence: high.**

### 1. Hot path

- `apps/web/wrangler.jsonc:46-122` (`env.production`) binds `DB`. `apps/web/src/server.ts:73-80` returns fixtures only for `VISONAUT_ENVIRONMENT === "preview"`. Production continues to `handleApi`.
- `apps/web/src/api/index.ts:130`: `const auth = createAuth({ ...bindings.configuration.auth, database: bindings.database });`. This line runs for each request that is not an image and not a webhook. `apps/web/src/server.ts:85` and `:93` do the same for `/api/auth/*` and `/api/me`.
- Installed `better-auth` 1.7.5: each `betterAuth()` call registers a new check (`@better-auth/kysely-adapter/dist/index.mjs:712`), the check starts at construction (`better-auth/dist/auth/base.mjs:15`), and each `auth.api.*` call awaits it (`better-auth/dist/api/to-auth-endpoints.mjs:41-42`).
- The official database page says the same: "Validation is enabled by default, including in production, and caches a clean result or mismatch per adapter instance." and "Kysely reads live database metadata and needs database access during initialization." (https://www.better-auth.com/docs/concepts/database). The options reference page says "`true` outside production" (https://www.better-auth.com/docs/reference/options). The two pages disagree. The installed code and the 1.7.7 code on npm agree with the database page.

How often:

| Page or action      | Private requests                         | Schema checks                                                                                                                     |
| ------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard load      | `/api/runs`, then `/api/operations`      | 2, in sequence                                                                                                                    |
| Run page load       | `/api/runs/:id`                          | 1                                                                                                                                 |
| Pull request page   | `/api/pulls/:n`, then `/api/runs/:id`    | 2, in sequence                                                                                                                    |
| First decision      | `/api/review-sessions`, command, receipt | 3                                                                                                                                 |
| Each later decision | command, receipt                         | 2 or more                                                                                                                         |
| Signed-out visitor  | any `/api/*`                             | 1. It is the only D1 work of the 401 for `/api/runs`.                                                                             |
| CI ingest (`/v1/*`) | each request                             | 1, started but not awaited (D1 load, no latency). Source: `better-auth/dist/auth/base.mjs:15-18` and `audit/load/ci-routes.json`. |

### 2. Magnitude

- Measured by me, production: about 330 ms for each awaited check (Fact 1).
- Measured by me, local native D1 (`auth-options.json`): 2 round trips for a guest, 5 for a signed-in read. With `validateSchema: false`: 0 and 3.
- Per page: dashboard about 0.66 s of 2.6 to 3.7 s (18 to 25%). Run page about 0.33 s of a 5.3 to 5.7 s server wait (6%).
- Cost: 856 rows read for each request (first verifier's measurement). On the Workers Paid plan this is not a money problem. It is 76 statements on a database that "processes queries one at a time" (https://developers.cloudflare.com/d1/platform/limits/).

### 3. Fix feasibility

The option exists in the installed version. `@better-auth/core/dist/types/init-options.d.mts:390-400`:

```ts
/** ... Set `false` to disable runtime schema validation. @default true */
validateSchema?: boolean;
```

Official text: "Set `advanced.database.validateSchema` to `false` to disable runtime validation and its skip message." (https://www.better-auth.com/docs/concepts/database).

What you lose. I removed one optional column from `session` and repeated the signed-in read (`auth-options.json`, `drift`):

```text
current options         -> rejected SCHEMA_MISMATCH  "Missing columns session.userAgent"
validateSchema: false   -> ok login=maintainer
```

So the check is a real guard. With the check, schema drift stops every authenticated request. Without it, reads continue with a drifted schema. Inserts that use a missing column still fail in SQLite.

Three more facts for the decision:

- Today the guard also runs in tests, by accident. `packages/security/test/auth-d1.test.ts:35` and `apps/web/src/api/api.test.ts:355` call `createAuth` on a migrated local D1. If `createAuth` hard-codes `false`, those tests stop checking that `apps/web/migrations/0003_auth.sql` matches Better Auth.
- The deploy applies migrations before it deploys the Worker (`.github/workflows/deploy.yml:127`, then `:133`). A test with the check on, plus this order, gives the same protection for all changes that go through the repository. It does not protect against a manual change of the production database.
- A newer Better Auth does not fix this. The 1.7.7 file (`https://unpkg.com/@better-auth/core@1.7.7/dist/db/schema-check.mjs`) still keeps `clean` in a closure for each adapter instance.

Options:

```ts
// Option A: off for requests, on in one test. packages/security/src/auth.ts
export interface AuthConfiguration { /* ... */ validateSchema?: boolean }
advanced: {
  cookiePrefix: `visonaut-${configuration.environment}`,
  // ...
  database: { validateSchema: configuration.validateSchema ?? false },
},

// The test that keeps the guard:
const auth = createAuth({ ...configuration, validateSchema: true });
await auth.api.getSession({ headers: new Headers() }); // throws SCHEMA_MISMATCH on drift
```

```ts
// Option B: check one time for each isolate and database, then skip.
// The repository already keys isolate state by the binding:
// packages/security/src/authorization.ts:19
//   const privatePermissions = new WeakMap<D1Database, Map<string, PrivatePermission>>();
const validated = new WeakSet<D1Database>();
const check = !validated.has(configuration.database);
// betterAuth({ advanced: { database: { validateSchema: check } } })
// add the binding to `validated` only after a clean check in the same request
```

- Option B keeps the production guard. It shares only a resolved fact between requests, not a pending promise. That is the pattern that `packages/security/src/github.ts:106` describes: "Reuse resolved token bytes; pending I/O stays within the request's client."
- Option B saves less for this app. The first request of each new isolate still pays 330 ms. How often a request meets a new isolate is not known. The limits page gives no isolate lifetime (https://developers.cloudflare.com/workers/platform/limits/).
- Do not move the complete `betterAuth` instance to module scope. It holds a promise that the first request starts. Cloudflare documents the error class "Cannot perform I/O on behalf of a different request" for "I/O objects ... created by one invocation ... in the context of a different invocation" (https://developers.cloudflare.com/workers/observability/errors/).

Contract effect: none. `docs/current-contract.md:186` requires "Live session and linked-account checks still run for every request." Both options keep the session, user, and account reads. The contract does not name the schema check. `packages/security/README.md:5` ("Construct Better Auth inside each production Worker request.") stays true with both options.

### 4. Strongest counter-argument

The check is the only thing in production that turns auth schema drift into a hard stop, and the auth tables are hand-kept SQL (`0003_auth.sql`: "Generated from Better Auth 1.7.5 core schema"). The cost is 6% of the slowest page. If REVIEW-02 moves the Worker near D1, the two trips cost a few tens of milliseconds, and the guard is then almost free. A maintainer who plans to do REVIEW-02 can keep the check.

---

## REVIEW-02: the Worker runs near the user while each D1 round trip costs about 125 to 165 ms

**Verdict: confirmed. Severity: high. Confidence: medium (the cost is measured; the result of the fix is not).**

### 1. Hot path

- `apps/web/wrangler.jsonc:1-125` has no `placement` key, at the top level or in `env.production`. My production response has `cf-ray: ...-GRU` and no `cf-placement` header.
- Each dynamic request of a signed-in maintainer in Brazil runs in `GRU`. Each D1 statement or batch is one round trip to another continent, because D1 has no South America location (Fact 4).
- Frequency: each D1 round trip of each request. 6 for the dashboard list, 9 for the alert read, 10 to 15 in sequence for the run model, 1 for each image.

### 2. Magnitude

- Measured: 125 to 145 ms for a simple trip, about 330 ms for the schema-check pair (Fact 1).
- The count model reproduces the signed-in dashboard waits to within about 10% (Fact 2). That is good evidence that distance times count is the dashboard problem.
- The one-line finding says "15 sequential round trips ... 1.9-2.5 s". That is correct for an active run that needs review. No production sample exists for that state. The measured samples were archived runs with 10 trips in sequence, about 1.3 to 1.5 s of a 5.3 to 5.7 s wait (Fact 3).
- D1 region: not read. `rg -i "d1 create|--location"` in the repository finds no creation command with a location. The documentation says: "By default, D1 will automatically create your primary database instance in a location close to where you issued the request to create a database." A trip of 125 ms from `GRU` is consistent with eastern North America. This is an assumption.

### 3. Fix feasibility

The key exists in the installed Wrangler 4.136.1 for one environment. `node_modules/wrangler/config-schema.json`, `RawEnvironment.properties.placement`:

```jsonc
// apps/web/wrangler.jsonc, inside "env": { "production": { ... } } only.
// The top level is the preview Worker. It has no D1.
"placement": { "mode": "smart" }
// or, after the D1 region is known:
"placement": { "region": "aws:us-east-1" }
```

Platform facts (https://developers.cloudflare.com/workers/configuration/placement/):

- "Smart Placement requires consistent traffic to the Worker from multiple locations to make a placement decision. The analysis process may take up to 15 minutes."
- Status `INSUFFICIENT_INVOCATIONS`: "The Worker has not received enough requests from multiple locations to make a placement decision."
- "Smart Placement may take up to 15 minutes to analyze your Worker after deployment." The deploy workflow runs on each push to `main` (`.github/workflows/deploy.yml:3-5`).
- "Cloudflare adds a `cf-placement` header to all requests when placement is enabled." and "The `cf-placement` header may be removed before Smart Placement exits beta."
- "By default, 1% of requests are not routed with Smart Placement to serve as a baseline for comparison."
- Use placement hints when "You know the exact location of your back-end infrastructure" and "Your Worker connects to a single database, API, or service". For a region hint: "Cloudflare maps your specified cloud region to the data center with the lowest latency to that region."
- "Placement only affects the execution of fetch event handlers." The queue consumer and the cron handler do not move.
- "Static assets are always served from the location nearest to the incoming request."
- Smart Placement does consider D1: "Workers has Smart Placement to dynamically run your Worker in the best location to reduce total request latency, considering everything your Worker talks to, including D1." (https://blog.cloudflare.com/sqlite-in-durable-objects/). The placement page itself does not name D1.

What this means here:

- This Worker has traffic from Brazil (the maintainer) and from GitHub (webhooks, CI uploads). Smart Placement can have enough data, or not. The result is not predictable from the documentation. Read the status after the deploy (dashboard: Workers & Pages > the Worker > Settings > General > Placement), and read the `cf-placement` response header (`remote-<colo>` when placed).
- The region hint is deterministic, but it needs the D1 region first. Three read-only ways: the D1 page in the dashboard, `wrangler d1 info visonaut`, or `meta.served_by_region` of any D1 result (`@cloudflare/workers-types` `index.d.ts:14534`: `served_by_region?: string;`).
- Expected result, as an estimate only. Assumptions: the Worker runs in the D1 region, a trip in the region costs 5 to 20 ms (no official D1 number exists), and the hop from the user costs about 120 ms one time.

| Request                             | Today                            | Estimate with placement |
| ----------------------------------- | -------------------------------- | ----------------------- |
| `GET /api/runs` (6 trips)           | 0.87 to 1.08 s measured          | about 0.15 to 0.27 s    |
| `GET /api/operations` (9 trips)     | 1.20 to 1.30 s measured          | about 0.17 to 0.33 s    |
| Run model, D1 part (10 to 15 trips) | about 1.3 to 2.2 s by count      | about 0.17 to 0.45 s    |
| Document (0 trips)                  | 41 to 119 ms measured            | about 120 ms more       |
| Image (1 trip)                      | about 145 ms more than `/health` | about the same          |

- Possible extra gains, not verified: the two R2 buckets and the GitHub API are probably also nearer to North America than to `GRU`. If so, the R2 inventory reads of REVIEW-04 and the GitHub calls also become faster. No bucket location is recorded in the repository.

What can go wrong:

- Smart Placement stays inactive, or it is inactive for up to 15 minutes after each deploy. Then nothing changes and nothing breaks.
- A region hint for the wrong region adds a hop and keeps the long D1 trips.
- Each document and each `/health` request gets one long hop. The page shell arrives about 0.12 s later.
- The generated deploy file (`apps/web/dist/server/wrangler.json`) must contain the key. The local preview build has `limits` and `observability` in that file, so I expect `placement` to pass through. I did not build with `CLOUDFLARE_ENV=production`. Check it with the existing `wrangler deploy --dry-run` step.

Contract effect: no security rule changes. `docs/current-contract.md:188` says "Standard Wrangler deployment owns declared bindings, routes, consumers, cron, and observability." Placement is one more declared deployment setting. It needs a line in the deployment guide.

Other levers that do not work: a D1 location near Brazil does not exist, and read replicas are in the same six regions.

### 4. Strongest counter-argument

Placement changes the distance, not the count. The count fix (REVIEW-01, the prelude, REVIEW-03) is deterministic, it can be tested with the existing `measureD1` helper (`apps/web/src/api/test-d1-costs.ts:14`), and it does not depend on a region that nobody has read. After the count fix, the dashboard has about 2 to 3 trips for each request, so placement would save only about 0.25 to 0.4 s and still add 0.12 s to each document. Also, for the measured run page, D1 trips are only about a quarter of the wait.

---

## REVIEW-03: the run model reads the same rows again and awaits 15 round trips in sequence

**Verdict: partly-confirmed. Severity: medium. Confidence: high for the counts, medium for the impact.**

The first verifier gave "high". I give "medium" for three reasons that come from this lens: the depth depends on the run state, the measured production samples had the short path, and the gain of this fix becomes small if REVIEW-02 is done.

### 1. Hot path

- `GET /api/runs/:id` (`apps/web/src/api/review.ts:785-790`) calls `reviewModel` one time for each run page load.
- `reviewModel` also runs for each ready receipt (`review.ts:814`), each Undo and direct save (`review.ts:637-639`), and each conflict response (`review.ts:683`).

Counts that I reproduced (`state-depth-3582.json`, active run that needs review): 15 D1 trips and 2 R2 gets in the model. With the 6 prelude trips: 21 D1 trips for the request. The duplicates are real:

- Project: `apps/web/src/api/index.ts:125`, `review.ts:292`, `packages/service/src/run-status.ts:61`.
- Run: `review.ts:90`, `run-status.ts:27`, and a third read with other columns in `apps/web/src/inventory-records.ts:45-49`.
- Comparison: `review.ts:305` and `run-status.ts:45`.

Correction to the depth. The status chain has early returns:

```ts
// packages/service/src/run-status.ts:26-35 (shortened)
const run = await service.run(runId);
const initial = reviewStatus({ run });
if (initial.status === "passed") {
  /* one more read */
}
if (initial.status === "superseded" || initial.status === "incomplete") {
  return { run, ...initial };
}
```

| Run state                                              | D1 trips in the model | In sequence, model | In sequence, complete request |
| ------------------------------------------------------ | --------------------- | ------------------ | ----------------------------- |
| Active, needs review, current promotion                | 15                    | 9                  | 15                            |
| `active = 0`, not accepted (archived pull request run) | 10                    | 4                  | 10                            |

### 2. Magnitude

- Active run: 9 trips in sequence in the model, about 1.1 to 1.3 s at 125 to 145 ms. About 7 to 8 of them are avoidable. No production sample.
- Archived run (the measured case): 4 trips in sequence in the model, about 0.5 to 0.6 s of the 5.3 to 5.7 s server wait. About 2 to 3 are avoidable.
- Each receipt repeats the active-run cost. The first verifier counted 23 D1 trips for a receipt.

### 3. Fix feasibility

`batch()` is one round trip: it "reduces latency from network round trips to D1", and "Batched statements are SQL transactions." (https://developers.cloudflare.com/d1/worker-api/d1-database/). `reviewModel` already uses it two times (`review.ts:277`, `review.ts:335`). Limits apply to each statement in the batch, not to the batch (https://developers.cloudflare.com/d1/platform/limits/).

"From 15 to about 4" is reachable, but not with one batch alone. It needs three changes:

```ts
// 1. Prelude: 6 -> 2. REVIEW-01 removes two trips. Then:
const [project, session] = await Promise.all([
  assertConfiguredProject(context), // does not depend on the session
  auth.api.getSession({/* with advanced.database.joins: true */}),
]);
// then the account read

// 2. Model: 9 -> 2, with no new SQL. Group the reads by what they need.
const run = await projectRun(context, runId); // already has comparison_id and project_id
// batch A (needs the run row): comparison, project, retained state, historical list, title
// batch B (needs the comparison row): dead tasks, counts, promotion, rows, policy,
//   captures, images, decisions, eligible approval IDs, snapshot inventory header

// 3. Or 9 -> 1, with subqueries keyed by the run ID:
// SELECT * FROM visonaut_comparisons
//  WHERE id = (SELECT comparison_id FROM visonaut_runs WHERE id = ?)
```

With only change 2 or 3, the request still has 7 to 8 trips in sequence.

What can go wrong:

- `readRunStatus` is shared. `prepareStatusIntent` uses it to publish the GitHub check (`run-status.ts:94`). Its early returns encode the order of the status rules. A version that takes rows as input must keep the same order, or the published check can change.
- A batch reads all rows before the project check in `projectRun` (`review.ts:89-95`). The code must still answer 404 before it uses any row.
- A batch is one transaction, so the model sees one consistent state. Today the reads can see different revisions, and `review.ts:816` reads the run again to detect that. This is a small behavior change in the safe direction.
- A round-trip budget test is possible with the existing helper (`apps/web/src/api/test-d1-costs.ts:14`, `measureD1`).

Contract effect: none. The contract does not fix the number or order of reads.

### 4. Strongest counter-argument

This is a refactor of status code that also decides the required GitHub check. Its gain is about 0.3 to 1.1 s today (2 to 8 trips at 125 to 145 ms). It is only about 0.01 to 0.16 s if the Worker runs near D1 (REVIEW-02, the same trips at an assumed 5 to 20 ms). The measured slow samples had only 4 model trips in sequence. Most of their wait is in REVIEW-04.

---

## REVIEW-04: each model read downloads, hashes, and validates two complete inventories from R2

**Verdict: confirmed. Severity: high. Confidence: medium (the code path and the local cost are measured; the production share is an inference by elimination).**

### 1. Hot path

- `apps/web/src/api/review.ts:364`: `run.inventory_key ? readReviewInventory(context, run.id) : null`. All runs in the current production database have an inventory: `docs/current-contract.md:26` says "New storage uses one complete, immutable R2 inventory per run", and the production database was replaced on 2026-10-04 and 2026-10-05 (`audit/d1/verification.md`, "The production database is 1 or 2 days old").
- `apps/web/src/api/review-inventory.ts:44-48`: the run inventory, then the baseline inventory. The second read waits for the first.
- It runs for each run page load, each ready receipt, each Undo, and each conflict response (same call sites as REVIEW-03). It also runs for archived runs, which the production samples show (3,832 variants with one "Accepted (626)" group).

### 2. Magnitude

Measured by me, local (`state-depth-3582.json`; Node 24.18, Apple M4 Pro, memory store with no network, synthetic 3,582 captures):

```text
                        bytes      sha256  decode  JSON.parse  canonical check  expand + validate  total
run inventory        5,993,161    3.1 ms  0.2 ms      9.3 ms          37.1 ms            68.7 ms  118 ms
baseline inventory   3,391,523    2.5 ms  0.2 ms      7.7 ms          30.1 ms            28.0 ms   69 ms
share of the total                   3%      0%          9%              36%                52%
```

- `readReviewInventory` median: 190 ms in this run, 128 ms in the first verifier's run. The machine was under load from other audit jobs, so use 130 to 190 ms. `reviewModel` median: 221 ms (first verifier: 168 ms).
- Hashing is not the cost. "Rehashes" in the finding is true but it is 3%. The canonical check (`apps/web/src/capture-inventory.ts:514`) and the expansion plus validation (`capture-inventory.ts:553`) are 88%.
- The strings round trip is real: `review-inventory.ts:30` (`metadata_json: JSON.stringify(capture.metadata)`) and `review.ts:447` (`JSON.parse((candidate ?? reference)?.metadata_json ?? "{}")`), plus `tuple_json` and `result_json` (`review-inventory.ts:146-159`, `review.ts:436`, `:455`).

Production, by elimination (Fact 3): about 3.8 to 4.3 s of the 5.25 to 5.68 s server wait is not D1 round trips. On that path there is nothing else than the two R2 downloads, this validation, the model build, and the JSON output. A GitHub permission call is possible in one sample but not in all three in a row (60 s cache). So this finding is probably the largest part of the run page wait. I cannot split it into network and CPU.

Two reasons why the local number is a lower bound:

- The fixture is smaller than production data. The fixture model is 2,153,156 bytes for 3,582 variants. Production models are 5.3 to 6.0 MB for 3,832 variants. The real inventory sizes are not known.
- Production CPU speed and R2 download speed from `GRU` are not measured. No official number exists for either.

The fastest way to get the real split: the Worker has `observability.traces.enabled: true` (`apps/web/wrangler.jsonc:15-20`). One trace of one `GET /api/runs/:id` shows the D1, R2, and GitHub spans.

Memory (`state-depth-3582.json`, Node heap after forced collection):

```text
retained by the two parsed inventories and their review rows   13.4 MiB
retained by the model object                                     3.3 MiB
heap growth during one model read, before collection            47.7 MiB
```

"Each isolate can consume up to 128 MB of memory ... This limit is per-isolate, not per-invocation. A single isolate can handle many concurrent requests." (https://developers.cloudflare.com/workers/platform/limits/). One model read allocates about 48 MiB before the collector runs, at the fixture size. The live set at one moment is smaller, and I did not measure it. Model reads that run at the same time (a page load and receipts) share the one limit. Production data is larger than the fixture.

### 3. Fix feasibility

Four options. They are independent.

**Option 1: start the two R2 reads together.** The baseline ID is already in D1 (`packages/service/src/types.ts:225`: `reference_snapshot_id: string | null;`), and `reviewModel` has the comparison row before the inventory read (`review.ts:276-307`). The service makes the two IDs equal when it creates the comparison (`packages/service/src/local-comparison.ts:477`), and `validateReceipt` checks the receipt against the inventory (`capture-inventory.ts:225`).

```ts
const [inventory, reference] = await Promise.all([
  readRunInventory(context, run.id),
  comparison?.reference_snapshot_id
    ? readSnapshotInventory(context, comparison.reference_snapshot_id)
    : null,
]);
if (inventory && inventory.referenceSnapshotId !== (comparison?.reference_snapshot_id ?? null)) {
  throw new IncompleteError("The review reference differs from the inventory.");
}
```

Measured (`state-depth-3582.json`): the inventory chain goes from 4 I/O steps in sequence to 1.7. `comparisonRowHasSameReferenceSnapshotId: true`. Risk: two inventories are in memory at the same time (they already are today, after the second read). A run without a comparison row must keep the sequential path.

**Option 2: verify identity, do not validate again.** The objects are immutable and their key contains the digest (`capture-inventory.ts:479`: `` `${prefix}/inventory/${digest}.json` ``). `writeCaptureInventory` validates before it writes (`capture-inventory.ts:465`) and gives R2 the digest (`capture-inventory.ts:481-484`: `sha256: digest`). R2 keeps it: "If a checksum was provided when using the `put()` binding, it will be available on the returned object under the `checksums` property." (https://developers.cloudflare.com/r2/api/workers/workers-api-reference/). A read path for review can keep the size check and the digest check and skip the canonical check and the validation. Local saving: about 88% of the inventory CPU.

- Keep the digest check. It is the proof that the object is the one that D1 points to, and it costs 3%.
- Contract: `docs/current-contract.md:24` requires validation "before importing the result". `docs/current-contract.md:26` says "Review reads the full inventory to show unchanged items." No line requires validation on each read. But this is a trust rule, so the maintainer decides. One real difference: validation on read applies today's rules to objects that an older version wrote.

**Option 3: build the review rows directly.** Use the parsed objects in the model loop instead of `JSON.stringify` followed by `JSON.parse` for each capture. This is a local change in `review-inventory.ts` and `review.ts`. I did not measure its part alone.

**Option 4: a cache.** Three forms, with different risks:

- In isolate memory: 13.4 MiB retained at the fixture size, against the 128 MB limit and the code's own note (`capture-inventory.ts:55`: "Leave room for the decoded JSON and capture graph in a 128 MiB Worker."). When an isolate goes over the limit, "the Workers runtime lets in-flight requests complete and creates a new isolate", and then the permission and token caches are empty again.
- Cache API: "the contents of the cache do not replicate outside of the originating data center" (https://developers.cloudflare.com/workers/runtime-apis/cache/). It works on the custom domain. It removes the R2 download but not the parse. It puts private review metadata in an edge cache, which the contract does not describe.
- A smaller review object written at materialization time: the largest change. It also changes the sentence in `docs/current-contract.md:26` and touches the approved decision P01 ("One compact complete model"). It needs a new decision.

Related: REVIEW-06 (each receipt returns the complete model) multiplies this finding. A receipt without the model removes most repeats without any change here.

### 4. Strongest counter-argument

The production share is not measured. If one trace shows that the R2 downloads are most of the 3.8 to 4.3 s, then the cheapest fixes are Option 1 and REVIEW-02 (a Worker near the bucket), and the validation is not the problem. The validation on read is also deliberate defense: it makes each review read prove that the stored evidence still satisfies the receipt rules. On a fast machine it costs less than 0.2 s for 3,582 captures. Read the trace before you change a trust rule.

---

## How the four findings act together

- REVIEW-02 multiplies the others. If the Worker runs near D1, each trip costs a few milliseconds, so REVIEW-01 and REVIEW-03 become small. If REVIEW-02 is not possible or not wanted, REVIEW-01 and REVIEW-03 are the only way to decrease the D1 wait.
- REVIEW-01 is the only one with a measured production cost for the fix target (about 330 ms for each request) and a one-line change.
- REVIEW-04 is probably the largest part of the run page wait, but it is the least measured.
- Two measurements remove most of the uncertainty: the D1 region (`served_by_region`), and one trace of `GET /api/runs/:id`.

## Missed (from this lens)

1. **The production run samples are not the 15-trip case.** They are archived runs with 10 D1 trips in sequence. No production measurement exists for an active run that needs review, which is the main review task.
2. **The inventory fixture is smaller than production data.** Fixture model: 2.15 MB for 3,582 variants. Production: 5.3 to 6.0 MB for 3,832 variants. All local CPU and byte numbers for REVIEW-04 are a lower bound.
3. **Hashing is 3% of the inventory cost.** The canonical check is 36% and expansion plus validation is 52%. A fix that only removes the hash gives almost nothing.
4. **The two R2 reads can start together today.** `visonaut_comparisons.reference_snapshot_id` already has the baseline ID before the first read.
5. **With the schema check off, a drifted schema passes reads.** Measured: `ok login=maintainer` after a column was removed. The existing D1 tests get the check only because `createAuth` leaves it on.
6. **Comments and code disagree about who owns a binding.** `packages/security/src/auth.ts:15` ("so a D1 binding cannot cross request ownership") and `apps/web/src/runtime.ts:160` ("All clients and binding references belong to the current request or event.") say that bindings belong to one request. `packages/security/src/authorization.ts:19` keys a module-level `WeakMap` by the D1 binding, which works only because the binding object is the same for all requests of one isolate (`audit/load/env-identity.mjs`: `sameDatabaseBinding: true`).
7. **Model reads at the same time share one 128 MB isolate.** One read grows the heap by about 48 MiB before collection at the fixture size.
8. **Placement can also shorten the R2 and GitHub calls.** Neither the bucket location nor the GitHub latency is recorded or measured.

## Limits of this check

- One location (`GRU`), one day, anonymous production requests only (13 by me).
- No trace, no D1 region, no R2 bucket location, no real inventory size. I did not run remote Wrangler commands.
- The local numbers are Node 24 on an Apple M4 Pro. They are not Workers CPU time.
- I did not build or deploy. The placement key is checked against the installed Wrangler schema only.
