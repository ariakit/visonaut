# Adversarial verification: Database schema, migrations, and query efficiency

Target: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/d1/report.md` (findings D1-01 to D1-17).

Result in one line: no finding is refuted. 12 are confirmed (some with a changed severity or an added correction). 5 are partly confirmed (D1-02, D1-04, D1-08, D1-10, D1-16), because one claim or one recommended fix in each is wrong or does not work as written.

## How I checked

- I read every cited file at the cited lines in the worktree.
- I read the installed dependency code for Better Auth 1.7.5 (not the documentation only).
- I wrote three independent tests that run against a native local D1 (Miniflare/workerd). They use my own seed data, not the auditor's.
- I ran a copy of the auditor's harness at a different scale (`AUDIT_RUNS=2001 AUDIT_DELIVERIES=10000`) to see if the numbers move as the report predicts.
- I checked platform facts in the Cloudflare and GitHub documentation.
- I did not read any remote resource. Production latency and production row counts are still not measured.

Scripts and raw output (all in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/d1/verify/`):

| File                                              | Purpose                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `own.test.ts` → `own-results.txt`                 | Better Auth call counts, dashboard scaling, review-queue poll, title scrub, review-link sweep      |
| `own2.test.ts` → `own2-results.txt`               | Plans and `rows_read` in three states: no statistics, after `ANALYZE`, after four proposed indexes |
| `own3.test.ts` → `own3-results.txt`               | Feasibility of proposed fixes (D1-03, D1-04, D1-16)                                                |
| `replica/replica.test.ts` → `replica/results.txt` | Auditor's harness at a smaller scale                                                               |
| `fk.mjs`                                          | Foreign key columns without an index                                                               |

Command for each test (run from the worktree root): `node_modules/.bin/vitest run --root <verify dir> --globals <file>`.

## Facts that change how to read the whole report

### 1. The production database is 1 or 2 days old

Verified from git history of `apps/web/wrangler.jsonc` (`git log -L` on the `d1_databases` block):

```
e277a91 2026-10-05  visonaut-production (441904d8…)                -> visonaut (3c0b122f…)
0b629ce 2026-10-04  visonaut-production-delta-20261004 (f33b9393…) -> visonaut-production (441904d8…)
6219fdf 2026-10-04  visonaut-production (15fcd402…)                -> visonaut-production-delta-20261004 (f33b9393…)
```

`docs/baseline-delta-cutover.md:3`: "Use a fresh D1 database for this development cutover. … Do not copy old runs, comparisons, review decisions, authentication users, or sessions."

Consequences:

- The 680,124,416 bytes in D1-10 belong to database `15fcd402…`, which is no longer bound.
- Assumption (not read from production): the tables are almost empty today. Then the scan findings (D1-04, D1-06, D1-07, D1-08, D1-09, D1-10) describe growth. They do not explain pages that are slow today.
- The slowness that the maintainer sees today must come from costs that do not depend on table size: the number of sequential D1 round trips (D1-01, D1-02), the distance per round trip (D1-13), and cold-isolate GitHub calls (see "Missed").

### 2. No statistics exist, and `ANALYZE` alone removes the three largest scans

The report says that there is no `ANALYZE` or `PRAGMA optimize` in the repository. That is correct (search: no match). The report did not test what statistics change. I did (`own2-results.txt`, 2,000 runs, 198 snapshots, 300 events, no new index):

| Statement                                                                           | `rows_read` no statistics | `rows_read` after `ANALYZE` |
| ----------------------------------------------------------------------------------- | ------------------------- | --------------------------- |
| Eligible runs filter (`statusRunEligibleSql`)                                       | 41,403                    | 2,396                       |
| Closed-summary candidates (`closed-summary.ts:389-401`)                             | 597,980                   | 6,260                       |
| Resolve staged alerts (`workflow-materialize.ts:838-848`)                           | 606,000                   | 8,300                       |
| Runs with stale intents (`checks.ts:200-209`)                                       | 48,530                    | 9,502                       |
| Dashboard history statement (`own-results.txt`, 3,000 runs, 30,000 comparison rows) | 67,589                    | 67,589 (no change)          |

After `ANALYZE` the planner builds an automatic index for the event lookup (`SEARCH event USING AUTOMATIC PARTIAL COVERING INDEX`) and starts from the one project row. Cloudflare recommends `PRAGMA optimize` after index creation: <https://developers.cloudflare.com/d1/best-practices/use-indexes/>. Limits: statistics describe the table sizes at the time of the command, an empty table gets no statistics, and other plans can change. This is an extra option for D1-07, not a replacement for the indexes.

### 3. Small errors in the map section

- "137 indexes (41 explicit)" is wrong. The schema has 137 indexes, and 38 have a `CREATE INDEX` statement (`sqlite3 schema.db "select count(*) from sqlite_master where type='index' and name not like 'sqlite_%'"` → `38`).
- The other map numbers that I checked are correct: 74 tables, 1 view, 18 triggers, 33 migration files.

---

## D1-01 · Better Auth validates the whole database schema on every request

- Verdict: **confirmed**
- Severity: **high** (same as the report)

Proof:

- `packages/security/src/auth.ts:15-21` and `:47-51`: `createAuth` builds a new `betterAuth(...)` each call. `advanced` has no `database` key.
- `apps/web/src/api/index.ts:130` and `apps/web/src/server.ts:85`, `:93`: one new instance per request.
- Dependency code: `@better-auth/core/dist/db/schema-check.mjs:51-78`. The `clean` flag is a closure variable of one check. Only the revision number is shared per database. `better-auth/dist/auth/base.mjs:15` starts the check at construction. `better-auth/dist/api/to-auth-endpoints.mjs:41-42` awaits it before each API call.
- My measurement (`own-results.txt`):
  ```
  new instance, request 1   d1 calls: 4   (sqlite_master read=231, batch x75 pragma_table_info read=625, session, user)
  new instance, request 2   d1 calls: 4   (same four calls again)
  same instance, second call d1 calls: 2  (session, user)
  validateSchema:false, new instance          d1 calls: 2, session found: true
  validateSchema:false + joins:true           d1 calls: 1, session found: true
  instance constructed and never called       d1 calls: 1 within 200 ms (sqlite_master; the batch follows)
  ```
- I found no cache, guard, or override. `validateSchema` appears nowhere in the repository.

Corrections:

1. The report says that migration parity is "already tested" by `apps/web/src/operations/test-migrations.test.ts`. That test compares the migrations with the test fixtures (`:22-41`). It does not compare the Better Auth schema with the migrations. If the runtime check is turned off, keep one test that builds `betterAuth` with the check on against a migrated D1, so a Better Auth upgrade that needs a new column still fails in CI.
2. The alternative "cache the auth instance in a module-level `WeakMap`" has a platform risk. The instance holds a promise (`authContext`) that the first request creates. A second request that awaits it depends on I/O from another request. Cloudflare documents this class of error: <https://developers.cloudflare.com/workers/observability/errors/> ("Cannot perform I/O on behalf of a different request"). The one-line option does not have this risk.
3. For ingest requests the check is not awaited, so it does not add latency there. It adds D1 load: 76 statements and about 856 rows read for each `PUT /v1/uploads/:token`.

## D1-02 · Every private request waits for 6 sequential D1 calls before its handler starts, and the review model needs 20

- Verdict: **partly-confirmed**
- Severity: **high** (same as the report)

Proof:

- Call counts are reproduced at a different data scale (`replica/results.txt`): `/api/session` 6, `/api/runs` 6, `/api/operations` 9, `/api/runs/:id` 20 calls with depth 15, `/state` 14, queued receipt 24 with depth 19, direct save 26 with depth 21. They are equal to the report. So they do not depend on table size.
- I counted the review-model chain by hand from `apps/web/src/api/review.ts:232`, `:276-307`, `:315-322`, `:323-365` and `packages/service/src/run-status.ts:26-80`. The result is 20 calls and depth 15.
- `apps/web/wrangler.jsonc` has no `placement` key. No `withSession` exists.

Corrections:

1. The dashboard does not make the two requests in parallel. `apps/web/src/routes/index.tsx:254-256`:
   ```tsx
   {
     state.status === "ready" && !state.preview && view !== "service" && (
       <OperationsAttention onAccessDenied={onAccessDenied} />
     );
   }
   ```
   The component that calls `/api/operations` mounts only after `/api/runs` has returned. The run list waits for 6 round trips. The alert indicator waits for 6 + 9, plus two HTTP requests in series. It is not "9 round trips".
2. `/api/runs` skips the project read (`index.ts:123-126`, `dashboardRead`). Its preamble is 5 calls, and the handler adds 1.
3. The "session cache" alternative conflicts with the binding contract. `docs/current-contract.md:186`: "Live session and linked-account checks still run for every request." It needs an explicit supersession.
4. The main recommendation (a hand-written `session JOIN user LEFT JOIN account` query) replaces Better Auth's signed-cookie check, expiry check, and renewal. A smaller change gives almost the same result and keeps Better Auth in the path. I measured `advanced.database.joins: true`: `getSession` becomes 1 call. Then the preamble can be 2 round trips:
   ```ts
   // round trip 1: the two reads do not depend on each other
   const [project, { response: session }] = await Promise.all([
     assertConfiguredProject(context),
     auth.api.getSession({ headers, query: { disableCookieCache: true }, returnHeaders: true }),
   ]);
   // round trip 2: the linked account
   ```
5. Latency is still not measured. See D1-13 for the reason to think that each round trip is long for this maintainer.

## D1-03 · Pull request titles are read from webhook payloads that the service has already erased

- Verdict: **confirmed**
- Severity: **medium** (same as the report)

Proof:

- All four write paths set `payload_json='{}'`: `apps/web/src/api/webhooks.ts:150`, `:172`, `:332`, `packages/security/src/webhooks.ts:147`. `apps/web/src/operations/recovery.ts:73` does the same.
- Both readers exist: `apps/web/src/api/dashboard.ts:57-62`, `apps/web/src/api/review.ts:288`.
- Git history agrees: scrub in `339926d` (2026-09-28), lookup and index in `5712036` (2026-09-30).
- `apps/web/src/api/dashboard.test.ts:42-54` inserts a full payload together with `processed_at`. Production code cannot create that row.
- The UI uses the field: `apps/web/src/routes/index.tsx:499`, `:586`, `:714` (`run.title ?? kindLabel(run.kind)`) and the history search at `:619`.
- My measurement (`own-results.txt`): `title before scrub: {"title":"Verify title"}`, `title after scrub: null`.
- `CREATE TABLE … WITHOUT ROWID` (the recommended table shape) works on local D1 (`own3-results.txt`).

Corrections: none.

## D1-04 · One "status" wakeup becomes a chain of queue messages that grows with the number of pull requests

- Verdict: **partly-confirmed**
- Severity: **medium** today. It becomes high when the pull request count grows.

Proof:

- `apps/web/src/operations/review-links.ts:168-171` (page of `tasksPerStep`), `:405-412` (`hasMore = rows.length === tasksPerStep`), `apps/web/src/operations/index.ts:95`, `apps/web/src/runtime.ts:454` (same message again, 1 s delay), `apps/web/src/api/review.ts:659-662` (each decision sends `status`).
- The chain length follows the rule at three scales: 31 messages for 750 pull requests (report), 21 for 500 (`replica/results.txt`), 6 for 130 (`own-results.txt`: `steps until hasMore=false = 6; GitHub requests = 0`).
- No `DELETE FROM pre_run_checks` exists in runtime source.

Corrections:

1. Today the chain does not occur. The production database is 1 or 2 days old (see the top section). With fewer than 25 pull requests, `hasMore` is false. The problem appears when the count reaches 25, and then grows by one message for each 25 pull requests.
2. An exact filter exists. The loop already skips each candidate that uses a head check (`review-links.ts:174`: `if (candidate.checkHeadSha === candidate.sourceSha) continue;`). New rows always get `check_head_sha = source_sha` unless a legacy row exists for the same commit (`apps/web/src/api/pre-run-checks.ts:629-631`). Put the same rule in the page query:
   ```ts
   candidatesSql +
     " AND checkHeadSha IS NOT sourceSha AND pullRequestNumber>? ORDER BY pullRequestNumber LIMIT ?";
   ```
   Measured (`own3-results.txt`, 130 pull requests, 3 legacy): the current page has 25 rows and only 3 are not skipped. With the filter the page has 3 rows, so `hasMore` is false. Keep `currentCandidate` (`:74-79`) without the filter.
3. The recommended `source.updated_at > ?` filter can skip a real case: an old legacy pull request that gets a new verdict. The exact filter does not have this problem.
4. In a fresh database no legacy row can exist. Then the complete review-link step has no work. A read-only check: `SELECT COUNT(*) FROM pre_run_checks WHERE kind='pull_request' AND check_head_sha IS NOT source_sha` and `SELECT COUNT(*) FROM operations_review_links`. If both are 0, the step and `operations_review_links` are candidates for removal.

## D1-05 · One review decision sends a new GitHub check update for every active run

- Verdict: **confirmed**
- Severity: **high** (same as the report). It depends on the number of active runs, not on the age of the database.

Proof:

- `packages/service/src/status-touch.ts:10-12`: one project-wide counter.
- `apps/web/src/operations/checks.ts:206`: the `stale.source_revision!=project.revision` branch selects every eligible run.
- `packages/service/src/run-status.ts:92-141`: `prepareStatusIntent` writes a new intent with `revision: project.revision`. I counted 10 D1 calls.
- `packages/security/src/checks.ts:173` (GET) and `:191-202` (PATCH). There is no comparison with the previous conclusion.
- `apps/web/migrations/0002_work.sql:48-53`: the trigger that blocks a change of `source_revision` exists.
- Reproduced at a second scale (`replica/results.txt`): idle sweep `GitHub requests {}`; after one decision `{"GET …/check-runs/:id":31,"PATCH …/check-runs/:id":31}`; the same after a second decision.
- The newer review-link path already has the missing rule. `apps/web/src/operations/review-links.ts:191-204`: "Stable verdicts need no GitHub polling, even after unrelated main promotions." The run-check path has no equivalent.

Corrections and additions:

1. Pull request runs do not depend on the project baseline. `packages/service/src/review-status.ts:84` has `run.kind !== "pull_request"` in the only rule that reads `baselineRevision`. So for pull request runs the project-wide stale test has no functional purpose that I found.
2. Any change must keep the send-time fence. `packages/service/src/run-status.ts:148` requires `project.revision = intent.source_revision` before the PATCH.
3. GitHub documents a secondary limit of "no more than 80 content-generating requests per minute and no more than 500 content-generating requests per hour" (<https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>). I did not verify that a check-run PATCH counts as content-generating. If it does, 30 active runs reach the hourly limit after about 17 decisions.

## D1-06 · The dashboard history query reads every comparison row in the database

- Verdict: **confirmed**
- Severity: **medium** (the report says high)

Proof:

- `apps/web/src/api/dashboard.ts:35-44`, `:69`.
- My plan on native D1 is the same as the report: `SCAN row USING INDEX visonaut_rows_comparison` + `SEARCH selected USING AUTOMATIC COVERING INDEX`.
- My scaling measurement (`own-results.txt`, always 100 runs shown):
  ```
  comparison_rows=3000   history rows_read=8189    rewritten CROSS JOIN rows_read=3199 (same result)
  comparison_rows=15000  history rows_read=34589   rewritten CROSS JOIN rows_read=5599 (same result)
  comparison_rows=30000  history rows_read=67589   rewritten CROSS JOIN rows_read=8599 (same result)
  ```
  Cost is about 2.25 x (all comparison rows). The `CROSS JOIN` form returns the same rows.

Corrections:

1. The third alternative ("Run `PRAGMA optimize` … so the planner has statistics") does not work for this statement. After `ANALYZE` the statement still read 67,589 rows and the plan still had `SCAN row`.
2. Severity. The cost is linear, the fix is small, and the production database is new. In the auditor's own run the whole dashboard request used 68 ms of SQL time at 50,240 rows (`results.txt`, column `sqlMs`, local workerd). Assumption: the 5 round trips before the statement are the larger cost today.

## D1-07 · Recurring queue and cron statements scan whole tables; three of them are quadratic

- Verdict: **confirmed**
- Severity: **medium** (same as the report)

Proof (`own2-results.txt`, no statistics, my seed):

```
eligible runs (current SQL):            rows_read=41403   SCAN run / SCAN snapshot / AUTOMATIC COVERING INDEX
eligible runs (proposed rewrite):       rows_read=2396    two primary-key searches
closed-summary candidates:              rows_read=597980  = 1,980 old runs x (300 events + 2), 0 candidates returned
resolve staged alerts (inner select):   rows_read=606000  = 2,000 runs x 300 events + rows
resolveEvents:                          rows_read=300     SCAN operations_events
active run count:                       rows_read=2000    SCAN visonaut_runs
```

- The closed-summary scan runs for runs that already have a summary. With 3,000 summarized runs I measured 9,000 rows for 0 events, 306,000 for 100 events, and 1,206,000 for 400 events (`own-results.txt`).
- The smaller-scale copy of the harness moved as predicted: `reconcileStagedWorkflows` 812,583 rows (2,001 runs x 400 events), `summarizeClosedRuns` 227,837 rows (560 old runs x 400 events).
- The proposed indexes work. After them: closed-summary 3,980, staged alerts 6,000, stale intents 4,481, `resolveEvents` 0.
- `statusRunEligibleSql` is used 9 times (`run-status.ts` 2, `checks.ts` 5, `check-state.ts` 2).

Corrections and additions:

1. Statistics alone remove the three quadratic scans (table in the top section). The report did not list this option here.
2. The partial index from D1-08 (`visonaut_runs(project_id, lineage_key) WHERE active=1`) also serves the active run count: 2,000 rows became 20 (measured after `ANALYZE`). The report shows "3,001 → 3,001" for that row.
3. The production database is new, so these costs are near zero today. They grow as (closed runs) x (events).

## D1-08 · Lookups on request paths have no supporting index

- Verdict: **partly-confirmed**
- Severity: **low** (the report says medium)

Proof (`own2-results.txt`, no statistics):

```
status-touch check lookup:            rows_read=2001  SCAN visonaut_checks            -> 3 with (project_id, external_run_id)
status outbox pending rows of a run:  rows_read=5000  SCAN visonaut_status_outbox     -> 0 with partial (run_id)
active runs of a pull request:        rows_read=2000  SEARCH visonaut_runs_active (project_id=?) -> 0 with partial (project_id, lineage_key)
```

Other plans from `own-results.txt`: `SCAN visonaut_promotions`, `SCAN visonaut_audit` + temp B-tree, `SCAN snapshot` + temp B-tree, `SCAN command USING INDEX sqlite_autoindex_visonaut_commands_1`. All cited lines exist (`status-touch.ts:16`, `run-status.ts:138`, `review.ts:355`, `review-commands.ts:107`, `:166-175`, `webhooks.ts:284-289`, `service.ts:183-188`, `closed-summary.ts:258-263`, `:329`).

Correction:

- The fix for the single-target read does not work as written. The report says: "put the primary key first: `WHERE id IN (...) AND comparison_id = ?` and check the plan". The order of terms does not change the SQLite plan. Measured on an 800-row comparison with 1 target (`own2-results.txt`):
  ```
  current:                       rows_read=801  SEARCH … visonaut_rows_comparison (comparison_id=?)
  reordered (id first):          rows_read=801  same plan
  unary plus on comparison_id:   rows_read=3    SEARCH … sqlite_autoindex_visonaut_comparison_rows_1 (id=?)
  ```
  A form that works:
  ```sql
  SELECT * FROM visonaut_comparison_rows
  WHERE +comparison_id = ? AND id IN (SELECT value FROM json_each(?))
  ```

Severity note: each item is a few thousand rows at the synthetic size, on a database that is new.

## D1-09 · The review-queue index from migration 0030 is not used; the queue poll reads every review task

- Verdict: **confirmed**
- Severity: **low** (the report says medium)

Proof (`own-results.txt`):

```
poll rows_read with 2,000 completed review tasks: 2001
   SEARCH task USING INDEX work_tasks_publication (kind=?) … USE TEMP B-TREE FOR ORDER BY
poll rows_read with added state IN (...): 3
   SEARCH task USING INDEX work_tasks_publication (kind=? AND state=?)
INDEXED BY work_tasks_review_queue → SCAN task USING INDEX work_tasks_review_queue
```

- `apps/web/migrations/0030_review_queue_index.sql:1-3`, `apps/web/src/operations/review-queue.ts:83-94`, `apps/web/src/operations/closed-summary.ts:310-314` are as quoted.

Corrections:

1. "Adds write cost to every `work_tasks` update" is not exact. The index is partial (`WHERE kind = 'review'`). It is updated only for review tasks. In practice that is every row now, because `enqueueWorkStatement` has one runtime caller (`review-queue.ts:58`, `kind: "review"`).
2. Severity. The poll reads one row per stored review task, once per status step. That is a small number.

## D1-10 · Many tables only grow, and admission stops new runs at 2 GiB

- Verdict: **partly-confirmed**
- Severity: **low** (the report says medium)

Proof:

- `apps/web/src/runtime-defaults.ts:15-16` and `apps/web/src/capacity.ts:107-113` are as quoted.
- My search for `DELETE FROM` in runtime source finds no delete for `github_webhook_delivery`, `github_webhook_recovery`, `visonaut_status_outbox`, `work_checks`, `visonaut_checks`, `operations_check_creations`, `pre_run_checks`, `operations_review_links`, `operations_events`, `ingest_staged_runs`, `ingest_merge_groups`, `ingest_review_sessions`, `auth_audit`, `visonaut_commands`, `visonaut_promotions`, `visonaut_snapshots`. The only deletes for some of them are in `sanitizeRestoredDatabase` (`recovery.ts:35-36`), which is restore tooling.

Corrections:

1. The 680 MB number is for a database that is no longer bound (top section). The current database was created on 2026-10-04 or 2026-10-05. The distance to the 2 GiB stop is not known and is probably large.
2. `rateLimit` is not an only-grow table. Better Auth prunes it: `better-auth/dist/api/rate-limiter/index.mjs:171-181` (`deleteExpiredRows`, `db.deleteMany` where `lastRequest < cutoff`).
3. `session` rows are also deleted when an expired session is presented: `better-auth/dist/api/routes/session.mjs:153-162`. Sessions that are never presented again do stay.
4. The old database grew fast under the old storage model (all captures in D1). Commit `6219fdf` moved full inventories to R2. The byte numbers per row in the report are small (215 bytes per webhook receipt). The larger effect of these tables is scan cost (D1-04, D1-07), not bytes.

## D1-11 · Each decision rebuilds and returns the complete review model

- Verdict: **confirmed**
- Severity: **medium** (same as the report)

Proof:

- `apps/web/src/api/review.ts:812-833` (queued receipt always builds the model), `:637-639`, `:682-696`, and `:900-904` (direct save returns no model when the revisions agree).
- `apps/web/src/review/client.ts:313-317`: the UI always sends `queued: true`. So the branch without a model at `review.ts:900-904` is not used by the UI.
- Reproduced (`replica/results.txt`): queued receipt 24 D1 calls, 26,582 rows read, 844,488 bytes.
- The client already accepts a receipt without a model. `apps/web/src/review/client.ts:254`: `model: data.model == null ? undefined : parseReviewModel(data.model)`.
- History: `docs/simplification-implementation.md:203` records the same problem for the direct path as "a moderate performance gap" and the fix. The queued path (PR #190) brought the full model back for every decision.

Corrections:

1. The direct path decides with a fence: `result.previousRunRevision !== body.expectedRunRevision` (`review.ts:881-887`). The queued path has no such input. The recommended code needs the same fence, or two fast decisions will patch a model that is one revision behind.
2. The contract requires this behavior to stay: "The UI must preserve multiple rapid decisions, pending overlays, newer route-model handling, Retry, Undo, focus, and navigation" (`docs/current-contract.md:196`).
3. The 844 KB is the JSON size before compression. The size on the wire was not measured.

## D1-12 · Image requests always reach the Worker, D1, and R2

- Verdict: **confirmed**
- Severity: **low** (same as the report)

Proof:

- `apps/web/src/api/images.ts:24-35`, `:38-40`, `:52`. `apps/web/migrations/0001_service.sql:73` has `CHECK (validated = 1)`.
- No `caches.default`, no `caches.open`, and no `cache` key in `apps/web/wrangler.jsonc`.
- Cloudflare: Worker responses are not cached unless the Worker uses the Cache API or Workers Cache. <https://developers.cloudflare.com/workers/runtime-apis/cache/>

Correction (a simpler option exists):

- Cloudflare now has Workers Cache, a configuration-only cache in front of the Worker: <https://developers.cloudflare.com/workers/cache/>. The installed Wrangler 4.136.1 accepts the key (`node_modules/wrangler/config-schema.json`, `CacheOptions`: `enabled`, `cross_version_cache`).
  ```jsonc
  "cache": { "enabled": true }
  ```
  It uses the response `Cache-Control`. Every private response already has `Cache-Control: no-store, private` (`packages/security/src/http.ts:33`). The image 404 has `no-store` (`images.ts:20`). So only successful image responses can be stored. Check each public response before this is enabled. The documentation says that purge uses `Cache-Tag`.
- The contract permits public image bytes: `docs/current-contract.md:59` ("A URL is not authorization; access revocation cannot recall copied pixels").

## D1-13 · Read replication cannot help yet: no Sessions API, and code depends on the raw binding object

- Verdict: **confirmed**
- Severity: **medium** (same as the report). It is not measured, but it can be the largest single cause of slow pages.

Proof:

- No `withSession` in the repository. Cloudflare: "you must use the D1 Sessions API, otherwise all queries will continue to be executed only by the primary database." <https://developers.cloudflare.com/d1/best-practices/read-replication/>
- `packages/security/src/authorization.ts:19`: the permission cache key is the `D1Database` object.
- `apps/web/wrangler.jsonc`: no `placement` key.

One open item in the report is now verified:

- A D1 session object cannot be given to Better Auth. The adapter needs `exec`: `@better-auth/kysely-adapter/dist/index.mjs:22` and `:102` (`if ("batch" in db && "exec" in db && "prepare" in db)`). A D1 session has only `prepare`, `batch`, and `getBookmark`: <https://developers.cloudflare.com/d1/worker-api/d1-database/>. So auth must keep the raw binding.

Corrections to the options:

1. Smart Placement can fail to decide for this Worker. The documentation says that it analyzes request duration across locations and needs enough traffic: <https://developers.cloudflare.com/workers/configuration/placement/>. This service has a few users. The same page documents an explicit placement, and Wrangler 4.136.1 accepts it (`placement` with `region`, `host`, or `hostname` in the config schema):
   ```jsonc
   "placement": { "region": "aws:us-east-1" }   // example only: use the region next to the D1 primary
   ```
   Placement changes only `fetch` handlers. The queue consumer and cron do not move.
2. Replicas help only where a replica is nearer than the primary. D1 regions are ENAM, WNAM, WEUR, EEUR, APAC, and OC (read replication page). D1 has no region in South America (<https://developers.cloudflare.com/d1/configuration/data-location/>).
3. Assumption, not measured: the commits have time zone `-0300`. If the maintainer is in South America, each D1 call from the nearest edge location crosses to another continent, with or without replicas. With depth 15 (D1-02) this cost repeats 15 times for the review page. Placement next to the primary makes it one long hop for each request. A read-only check of the real region: field `meta.served_by_region` of any D1 result in a Worker trace (traces are on, `wrangler.jsonc:15-20`).

## D1-14 · Migration numbering has a duplicate and two gaps, and nothing checks it

- Verdict: **confirmed**
- Severity: **low** (same as the report)

Proof:

- Directory listing: `0030_local_zero_pixel_reviews.sql` and `0030_review_queue_index.sql` exist. `0017` and `0025` do not.
- `git log`: `7893072` (#198) and `8ebf821` (#190), both 2026-10-02.
- `apps/web/src/operations/README.md:3`: "Preserve applied migrations as history, including both `0030_*` files". `docs/current-contract.md:126` says the same.
- `.github/workflows/deploy.yml:125-127` runs `wrangler d1 migrations apply`. Wrangler records each migration by name: <https://developers.cloudflare.com/d1/reference/migrations/>.
- `apps/web/migrations/0001_service.sql:1` is `PRAGMA foreign_keys = ON;`.

Corrections: none. The recommended test finds a new duplicate. It does not find a file with a lower number that is added later.

## D1-15 · Unused schema objects remain: 11 tables, 1 view, and 2 indexes

- Verdict: **confirmed**
- Severity: **low** (same as the report)

Proof:

- My search over the whole worktree (not only runtime source) finds the 11 table names and the view only in migrations, tests, recorded tooling, evidence files, and docs.
- `apps/web/migrations/0024_core_simplification.sql:53-58`: the trigger reads `visonaut_baseline_restorations`.
- Index claims are covered by D1-03 and D1-09.

Corrections and additions:

1. "`rateLimit` … also has no cleanup" is wrong (see D1-10, correction 2).
2. The contract forbids a drop at this time. `docs/current-contract.md:58` (D14): "No destructive migration, row/table/object deletion, or shorter retention. Source absence is not live evidence."
3. Assumption: in the new production database these tables are empty, because the cutover copies no old rows. The records that D14 protects are then in the old databases, which the runbook keeps for rollback. A read-only count on the current database can confirm this.

## D1-16 · Independent statements are sent one by one where one batch or one statement is enough

- Verdict: **partly-confirmed**
- Severity: **low** (same as the report)

Proof:

- `packages/security/src/webhooks.ts:84-102` (2 calls), `packages/service/src/work.ts:102-135` (2 updates), `apps/web/src/capacity.ts:39-72` (3 calls), `apps/web/src/api/operations.ts:16-47` (3 reads), `apps/web/src/operations/index.ts:80`, `apps/web/src/runtime.ts:333`, `:388`, `:420`, `:455`.
- Reproduced (`replica/results.txt`): `persistWebhook` 2 calls, recovery first step 385 calls, status steps 79 to 179 calls.

Corrections:

1. "Use `RETURNING` for `persistWebhook`" does not work as written. The statement has `ON CONFLICT(delivery_id) DO NOTHING`. For a duplicate delivery it returns no row, and the duplicate is the case where the stored identity must be compared. Measured (`own3-results.txt`): `DO NOTHING RETURNING rows on first insert: 1 on duplicate: 0`. Two forms that work: put the two statements in one `batch`, or use a no-op update (`ON CONFLICT(delivery_id) DO UPDATE SET delivery_id = excluded.delivery_id RETURNING event, payload_digest, processed_at`, which returned the stored row in my test).
2. `createChecks` (`apps/web/src/operations/checks.ts:46-85`) has 7 statements before the loop, not 6.

## D1-17 · Wide rows and API bounds that can meet D1 limits

- Verdict: **confirmed** (by reading; not measured, as the report says)
- Severity: **low** (same as the report)

Proof:

- `packages/service/src/service.ts:108-110` (`SELECT *`), `packages/service/src/run-admission.ts:79-82` (1,500,000 bytes), `:644` (plan made smaller for inventory runs), `apps/web/src/api/review.ts:842` (1 MB body), `:847-850` (limit is `maximumCaptures`, 40,000), `packages/service/src/review-commands.ts:227-271` (4 statements per target).
- D1 limits: 2,000,000 bytes per string or row, 100 bound parameters, 100 KB per statement. <https://developers.cloudflare.com/d1/platform/limits/>

Notes:

- Only a signed-in maintainer can send such a command. The batch is atomic, so a failure writes nothing. The result is a 503 in place of a 400.
- I did not check the claim that no statement builds a placeholder list.

---

## Missed

- **Production database is new (3 binding changes on 2026-10-04 and 2026-10-05).** The report keeps this as an open question. It decides which findings matter today (round trips and distance) and which are growth risks (scans and retention).
- **Statistics are a separate, cheap option.** `ANALYZE` alone cut three quadratic scans by 17x to 95x in my test. The report mentions `PRAGMA optimize` only for the dashboard, where it has no effect.
- **Dashboard requests run in series.** `/api/operations` starts after `/api/runs` returns (`apps/web/src/routes/index.tsx:254-256`), so the two preambles add up.
- **Cold isolates pay up to 3 GitHub calls before the first private response.** The permission cache (`authorization.ts:19`), the installation token (`github.ts:102`), and the login hint (`github.ts:193`) live in isolate memory. All measured numbers in the report are for a warm cache.
- **The review-link step has no work in a fresh database.** All new rows use head checks, so `publishReviewLinks`, `operations_review_links`, and the `/api/pulls/:n` mirror path are possible dead legacy code (check the two counts in D1-04).
- **`reconcileWork` and `enqueueWork` have no runtime caller.** `packages/service/src/work.ts:94` and `:233-366` are used only by tests and `apps/web/tooling/queue-recovery/worker.mjs`. Index `work_tasks_publication` and the publication columns exist for that retired publisher.
- **The ingest path was not measured.** Each `PUT /v1/uploads/:token` reads the project, the staged run, the bundle, and the manifest again (`apps/web/src/api/workflow-owned.ts:233-274`, `:1005-1046`), plus the Better Auth check from D1-01. A run uploads many images.
- **A session check per HTTP request is repeated across requests of one page.** The review page start, the review-session creation, the command, and each receipt poll each pay the full preamble. The report counts each request alone, not the sum for one user action. For one decision, my count from `apps/web/src/review/client.ts:313-331` and the measured depths is: 11 (POST) + 19 (receipt) = 30 sequential round trips plus one fixed 500 ms client wait when the first poll finds the task complete. When the first poll is too early, add 9 round trips and a second 500 ms wait.
- **Each identical check PATCH can produce a `check_run` webhook back to the service.** If so, D1-05 also feeds the receipt table in D1-10. Not verified.
- **Map section error:** 38 explicit indexes, not 41.
