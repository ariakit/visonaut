# Database schema, migrations, and query efficiency

Scope: `apps/web/migrations` (33 files), and every SQL statement in `apps/web/src/api`, `apps/web/src/operations`, `apps/web/src/*.ts`, `packages/service/src`, and `packages/security/src`.

Method: I read the code, applied all migrations to a scratch SQLite file, and ran the repository code against a native local D1 (Miniflare/workerd) with synthetic data. A proxy around the D1 binding counted each D1 call, the statements in it, and the `rows_read` / `rows_written` values that D1 returns in `meta`. Nothing inside the repository was changed.

Read this first:

- "D1 call" means one `first()`, `all()`, `run()`, or `batch()` call. Each one is one round trip from the Worker to the database.
- "Sequential depth" is the longest chain of D1 calls that do not overlap in time. It is the number of round trips that the request must wait for, one after the other.
- Counts of calls, statements, and rows are measured. Latency in production is **not** measured. The local wall time of the harness is not representative, because Miniflare adds a proxy hop for each `prepare` and `bind`.
- The synthetic data set has 3,001 runs, 30 active runs, 750 pull requests, 50,240 comparison rows, 60,000 webhook receipts, and 400 operations events. Real row counts in production are not known to me. Where a cost depends on table size, I state the scaling rule.

## How it works (map)

### Storage and access pattern

- One D1 database per environment, bound as `DB` (`apps/web/wrangler.jsonc:67-74`). Preview has no D1 binding (`:31`) and serves fixtures.
- All code reaches D1 through a two-method interface: `prepare` and `batch` (`packages/service/src/database.ts:15-18`).
- Atomic writes use `db.batch([...])` plus "assertion" statements. An assertion inserts a row that fails a CHECK when a guard is false, so the whole batch rolls back (`packages/service/src/database.ts:43-69`).
- There is no use of the D1 Sessions API (`withSession`), no `ANALYZE`, and no `PRAGMA optimize` anywhere in the repository (search result: no matches).
- The Worker has no Smart Placement setting (`apps/web/wrangler.jsonc` has no `placement` key).
- Schema after all migrations: 74 tables, 1 view, 18 triggers, 137 indexes (41 explicit, the rest are automatic PRIMARY KEY / UNIQUE indexes). Integrity check and foreign-key check pass on a fresh database.

### Request walk-through: `GET /api/runs/:id` (review page data)

Measured sequence for an active run (20 D1 calls, sequential depth 15):

1. `assertConfiguredProject` reads the project. `apps/web/src/api/index.ts:124-126`. 1 call.
2. `createAuth(...)` builds a new Better Auth instance for this request. `apps/web/src/api/index.ts:130`, `packages/security/src/auth.ts:15-21`. Better Auth then validates the whole database schema: 1 query on `sqlite_master`, then 1 batch with 75 `pragma_table_info` statements. 2 calls.
3. `requireMaintainer` → `auth.api.getSession` reads `session` by token, then `user` by id. `packages/security/src/authorization.ts:32-36`. 2 calls.
4. `requireMaintainer` reads the linked GitHub account. `authorization.ts:40-43`. 1 call. The GitHub permission check is cached in memory for 60 s (`:19-23`, `:60-70`).
5. `reviewModel` → `projectRun` reads the run with `SELECT *`. `apps/web/src/api/review.ts:89-95`. 1 call.
6. A `Promise.all` starts four things at the same time (`review.ts:276-307`): a 3-statement batch, the project again, `service.status(run.id)`, and the comparison.
7. `service.status` is a chain of 6 sequential calls: run again, comparison again, dead tasks, counts, project again, promotion. `packages/service/src/run-status.ts:26-80`.
8. One probe for a local run. `review.ts:315-322`. 1 call.
9. A second `Promise.all` (`review.ts:323-365`): comparison rows, a 5-statement batch (policy, captures, images, decisions, promotion), and the approval-eligibility query. For runs with an inventory it also reads two inventory documents from R2.

The same project row is read 3 times, the run row 3 times, and the comparison row 3 times in this one request.

### Request walk-through: one review decision (default client path)

1. `POST /api/comparisons/:id/commands` with `queued: true` (`apps/web/src/review/client.ts:313-317`). Measured: 11 D1 calls, all sequential. It stores a `work_tasks` row and returns 202.
2. The same request starts `processReviewQueue` in `waitUntil` (`review.ts:641-667`). Measured: 14 sequential D1 calls. It then sends `{ kind: "status" }` to the queue.
3. The client polls `GET /api/commands/:id/queued` (`client.ts:326-331`). When the task is complete, the handler builds the **full** review model again and returns it (`review.ts:812-833`). Measured: 24 D1 calls, depth 19, and an 844 KB JSON body for a run with 800 changed rows.
4. The queue consumer runs `runOperations({ kind: "status" })`. If any step reports `hasMore`, the consumer sends the same message again with a 1 s delay (`apps/web/src/runtime.ts:431-454`).

### Background work

- Cron every 5 minutes sends `{ kind: "recovery" }` (`wrangler.jsonc:109-111`, `apps/web/src/server.ts:129-139`).
- The queue consumer handles one message at a time (`max_batch_size: 1`, `max_concurrency: 1`, `wrangler.jsonc:98-106`).
- `runScheduledOperations` runs reconcile steps and then `runOperations` (`runtime.ts:307-457`, `apps/web/src/operations/index.ts:24-112`).

### Table to index map

Full output: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/d1/indexmap.txt`. Compact view of the tables on request and queue paths. "PK" and "UQ" are automatic indexes.

| Table                          | Indexes                                                                                                                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visonaut_runs`                | PK(id); UQ(project_id, external_run_id, attempt); `visonaut_runs_active`(project_id, external_run_id, active); partial `visonaut_main_promotion_scan`(created_at, id)                                                                    |
| `visonaut_comparisons`         | PK(id); UQ(run_id, ordinal); partial unique `visonaut_historical_comparing_run`(run_id)                                                                                                                                                  |
| `visonaut_comparison_rows`     | PK(id); UQ(comparison_id, item_key, variant_key); `visonaut_rows_comparison`(comparison_id, ordinal); partial (reference_capture_id); partial (candidate_capture_id)                                                                     |
| `visonaut_decisions`           | PK(id); UQ(row_id, revision); `visonaut_decisions_pixels`(2 JSON expressions, revoked, verdict)                                                                                                                                          |
| `visonaut_captures`            | PK(id); UQ(run_id, item_key, variant_key); (run_id, ordinal); (profile_digest); (image_id)                                                                                                                                               |
| `visonaut_images`              | PK(id); UQ(object_key); (run_id)                                                                                                                                                                                                         |
| `visonaut_snapshots`           | PK(id); UQ(prefix); partial (created_at, id) WHERE state='copying'. **No index on run_id.**                                                                                                                                              |
| `visonaut_promotions`          | PK(id). **No index on comparison_id.**                                                                                                                                                                                                   |
| `visonaut_checks`              | PK(id). **No index on (project_id, external_run_id).**                                                                                                                                                                                   |
| `visonaut_audit`               | PK(id). **No index on run_id.**                                                                                                                                                                                                          |
| `visonaut_status_outbox`       | PK(id). **No index on run_id.**                                                                                                                                                                                                          |
| `visonaut_commands`            | PK(id). No index on comparison_id.                                                                                                                                                                                                       |
| `work_tasks`                   | PK(id); `work_tasks_due`(state, available_at, lease_until); `work_tasks_publication`(kind, state, published_at, publication_due_at); partial `work_tasks_review_queue`(state, available_at, lease_until, created_at) WHERE kind='review' |
| `work_checks`                  | PK(id) only                                                                                                                                                                                                                              |
| `work_status_outbox`           | PK(check_id, revision); `work_status_due`(state, available_at)                                                                                                                                                                           |
| `operations_check_creations`   | PK(run_id); UQ(external_id). **No index on check_id or state.**                                                                                                                                                                          |
| `operations_events`            | PK(id) only. The id is `kind:subject:code`.                                                                                                                                                                                              |
| `operations_review_links`      | PK(repository_id, pull_request_number, source_sha); UQ(external_id); UQ(check_id)                                                                                                                                                        |
| `pre_run_checks`               | PK(tested_sha, generation); UQ(external_id); UQ(check_id); UQ(repository_id, workflow_run_id, workflow_attempt); (kind, source_sha, pull_request_number)                                                                                 |
| `ingest_staged_runs`           | PK(id); UQ(repository_id, workflow_run_id, workflow_attempt)                                                                                                                                                                             |
| `github_webhook_delivery`      | PK(delivery_id); partial `..._pending`(last_attempt_at, received_at) WHERE processed_at IS NULL; partial `..._pr_title`(2 JSON expressions, received_at DESC) WHERE event='pull_request'                                                 |
| `session` / `user` / `account` | PK(id); `session` UQ(token), (userId); `user` UQ(email); `account` (userId)                                                                                                                                                              |
| `ingest_review_sessions`       | PK(id)                                                                                                                                                                                                                                   |

### Hot-path queries and index support

| Path                 | Statement (file:line)                                          | Filter and order                                 | Index support (EXPLAIN QUERY PLAN)                                                                                                                  |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session              | Better Auth `session` by token, `user` by id                   | equality                                         | Yes: UQ(token), PK                                                                                                                                  |
| Session              | `account` by userId (`authorization.ts:40-43`)                 | equality                                         | Yes: `account_userId_idx`                                                                                                                           |
| Dashboard history    | `dashboard.ts:35-66` with `ORDER BY created_at DESC LIMIT 100` | project_id, sort by created_at                   | **Partial.** Reads all runs of the project and sorts in a temp B-tree. The `counts` CTE scans the whole `visonaut_comparison_rows` index. See D1-06 |
| Dashboard actionable | `dashboard.ts:70-75`                                           | project_id, active=1                             | Partial: reads all runs of the project, then uses indexes                                                                                           |
| Dashboard PR title   | `dashboard.ts:57-62`                                           | JSON expressions on `payload_json`               | Index is used, but the data is gone. See D1-03                                                                                                      |
| Review model         | run / comparison / project by id                               | PK                                               | Yes                                                                                                                                                 |
| Review model         | comparison rows (`service.ts:116-124`)                         | comparison_id, order by ordinal, id              | Yes: `visonaut_rows_comparison`                                                                                                                     |
| Review model         | captures, images, decisions (`review.ts:339-354`)              | `id IN (subquery)`                               | Yes, PK lookups; the images query also scans all images of the run through `visonaut_images_run`                                                    |
| Review model         | promotion probe (`review.ts:355`)                              | comparison_id                                    | **No.** `SCAN visonaut_promotions`                                                                                                                  |
| Review model         | counts (`run-status.ts:56-60`)                                 | comparison_id                                    | Yes                                                                                                                                                 |
| Image                | `images.ts:24-28`                                              | id                                               | Yes: PK. One D1 call per image request                                                                                                              |
| Save decision        | read batch (`review-commands.ts:145-176`)                      | comparison id; `id IN json_each`                 | Yes, but it reads all rows of the comparison (801 rows for 1 target)                                                                                |
| Save decision        | `status-touch.ts:16-21`                                        | `visonaut_checks` by project_id, external_run_id | **No.** `SCAN visonaut_checks` on every decision                                                                                                    |
| Save decision        | `reviewSession` (`review.ts:621-626`)                          | id                                               | Yes                                                                                                                                                 |
| Review queue         | `review-queue.ts:83-94`                                        | kind='review', state, order by created_at        | **Partial.** Uses `work_tasks_publication(kind)` and reads every review task. The dedicated 0030 index is not chosen. See D1-09                     |
| Operations attention | `operations.ts:30-36`                                          | resolved_at IS NULL, order by last_seen_at       | **No.** `SCAN operations_events`, plus scans inside correlated subqueries. See D1-07                                                                |

## Findings

### D1-01 · Better Auth validates the whole database schema on every request

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/security/src/auth.ts:15-21`: `/** Create inside each request so a D1 binding cannot cross request ownership. */ export function createAuth(...) { ... return betterAuth({` . The options (`:21-79`) do not set `advanced.database.validateSchema`.
  - `apps/web/src/api/index.ts:130`: `const auth = createAuth({ ...bindings.configuration.auth, database: bindings.database });` . This line runs for every API path except images and webhooks, before the ingest routes at `:134-189`.
  - Better Auth 1.7.5, `@better-auth/core/dist/db/schema-check.mjs:7-9`: `return options.advanced?.database?.validateSchema !== false;` and the comment "Turns a schema comparison into a check shared by one adapter instance."
  - Better Auth type docs, `@better-auth/core/dist/types/init-options.d.mts:391-400`: "Authentication requests await the same check ... Kysely introspects the database ... Set `false` to disable runtime schema validation. @default true".
  - D1 dialect introspector, `@better-auth/kysely-adapter/dist/d1-sqlite-dialect-*.mjs:88-98`: one `sqlite_master` query, then `this.#d1.batch(statements)` with one `pragma_table_info` statement per table.
  - Measurement (harness, every private request):
    ```
    single  select "name","type","sql" from "sqlite_master" where "type" in (?, ?) ...   rows_read=231
    batch   75 x  SELECT * FROM pragma_table_info(?)                                      rows_read=625
    ```
  - Measurement for an ingest request that never reads a session (`PUT /v1/uploads/:token`, rejected): the `sqlite_master` query ran inside the request, and the 75-statement batch ran right after it (it showed up in the next measured case as `x150 pragma_table_info`).
- What happens: The schema check is cached per Better Auth instance. Visonaut makes a new instance for each request, so the cache never helps. Each request pays 2 extra D1 round trips, 76 statements, and about 856 rows read. Private requests wait for both round trips before the session query starts.
- Impact: 2 of the 6 fixed round trips at the start of every private request are schema validation. The dashboard makes two private requests, so it pays this twice. CI ingest requests also pay it: `createAuth` runs before the upload routes, so each image upload starts the same 76 statements.
- Recommendation: Turn the runtime check off in `createAuth`. Migration parity is already tested (`apps/web/src/operations/test-migrations.test.ts`).
  ```ts
  return betterAuth({
    // ...
    advanced: {
      database: { validateSchema: false },
      cookiePrefix: `visonaut-${configuration.environment}`,
      // ...
    },
  });
  ```
- Alternatives:
  - Minimal: the option above. One line.
  - Keep the check but pay it once per isolate: cache the auth instance in a module-level `WeakMap<D1Database, VisonautAuth>`, the same way `privatePermissions` is already keyed (`authorization.ts:19`). This also removes the per-request construction cost. It needs a decision about the "cannot cross request ownership" comment.
  - Also move `createAuth` in `handleApi` below the ingest routes, so CI requests never construct Better Auth.
- Maintainer decision needed: yes. Is the runtime schema check wanted in production, or is the migration parity test enough? Is a per-isolate auth instance acceptable?

### D1-02 · Every private request waits for 6 sequential D1 calls before its handler starts, and the review model needs 20

- Kind: performance
- Severity: high. Confidence: high (counts), medium (latency effect). Measured: yes (call counts and order). Effort: M
- Evidence (measured, warm GitHub permission cache):

  | Request                                        | D1 calls | Sequential depth | Statements | Rows read |
  | ---------------------------------------------- | -------- | ---------------- | ---------- | --------- |
  | `GET /api/session`                             | 6        | 6                | 80         | 860       |
  | `GET /api/runs` (dashboard)                    | 6        | 6                | 82         | 127,459   |
  | `GET /api/operations`                          | 9        | 9                | 83         | 1,279     |
  | `GET /api/runs/:id` (active, 800 changed rows) | 20       | 15               | 100        | 26,672    |
  | `GET /api/runs/:id` (active, 30 changed rows)  | 20       | 15               | 100        | 3,061     |
  | `GET /api/runs/:id` (archived summary)         | 13       | 11               | 92         | 880       |
  | `GET /api/runs/:id/state` (poll)               | 14       | 14               | 88         | 2,467     |
  | `GET /api/pulls/:n?check=`                     | 8        | 8                | 82         | 862       |
  | `POST .../commands` (queued, HTTP part)        | 11       | 11               | 87         | 866       |
  | `GET /api/commands/:id/queued` (receipt)       | 24       | 19               | 104        | 26,682    |
  | `POST .../commands` (direct save)              | 26       | 21               | 123        | 31,167    |

  Fixed preamble, in order: project (`index.ts:124-126`), `sqlite_master`, pragma batch, session, user, account (`authorization.ts:32-43`).
  - `packages/service/src/run-status.ts:26-80`: six awaits in a row (`service.run`, `service.comparison`, dead tasks, counts, `service.project`, promotion).
  - `apps/web/src/api/review.ts:104-130` (`reviewPollState`): run, comparison, then `service.status`, which reads run and comparison again.
  - `apps/web/src/api/operations.ts:16-47`: three reads in a row that do not depend on each other.

- What happens: Each D1 call is a separate round trip to the single primary database. The handlers issue them one after the other. Many of them read the same row again.
- Impact: The wait is (sequential depth) x (one Worker-to-D1 round trip). I did not measure the production round trip. With no Smart Placement and no read replica, the Worker runs near the user and the database stays in one region, so the round trip includes that distance. This matches the complaint about waiting for access checks. The dashboard page makes `GET /api/runs` and `GET /api/operations` in parallel, so it waits for 9 round trips. The review page waits for 15.
- Recommendation: Cut the chain to 2 or 3 round trips for a read.
  1. Preamble: after D1-01, read session + user + account in one statement, and put the project read in the same batch.
     ```ts
     const [identity, project] = await database.batch([
       database
         .prepare(
           `SELECT s.id AS sessionId, s.expiresAt, u.id AS userId, a.accountId
         FROM session s JOIN user u ON u.id = s.userId
         LEFT JOIN account a ON a.userId = u.id AND a.providerId = 'github'
         WHERE s.token = ?`,
         )
         .bind(token),
       database
         .prepare(
           "SELECT id, repository_id, baseline_revision, promotion_id, revision FROM visonaut_projects WHERE id = ?",
         )
         .bind(projectId),
     ]);
     ```
     This bypasses `auth.api.getSession`, so the cookie signature check and the daily session renewal must stay somewhere. A smaller step is Better Auth's `advanced.database.joins` option, which can remove one call.
  2. `readRunStatus`: one batch that returns run, comparison, dead-task flag, counts, project, and promotion. The dashboard already computes the same status in one set-based query (`dashboard.ts:35-66`) and then calls `reviewStatus` in JavaScript.
  3. `reviewModel`: pass the loaded run, project, and status down instead of loading them again; put the remaining reads in one batch.
- Alternatives:
  - Minimal: D1-01 plus batching inside `readRunStatus` (6 calls become 1). That alone takes the review model from depth 15 to about 8, and the poll from 14 to about 7.
  - Infra only: enable Smart Placement so the Worker runs next to D1. This shortens each round trip without code changes, but adds user-to-Worker distance once per request.
  - Session cache: allow a short Better Auth cookie cache (it is disabled on purpose at `auth.ts:45` and `authorization.ts:34`). This removes 2 calls but delays session revocation by the cache lifetime.
- Maintainer decision needed: yes. Which trade is acceptable for the session check: a custom single join, the Better Auth joins option, or a short cookie cache?

### D1-03 · Pull request titles are read from webhook payloads that the service has already erased

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Write side, `apps/web/src/api/webhooks.ts:330-335`: `"UPDATE github_webhook_delivery SET processed_at = ?, payload_json = '{}' WHERE delivery_id = ? AND payload_digest = ?"`. The same scrub is at `:150`, `:172`, and `packages/security/src/webhooks.ts:147`. It came with commit `339926d` "Compact processed webhook payloads (#129)" on 2026-09-28.
  - Read side, `apps/web/src/api/dashboard.ts:57-62`: `SELECT json_extract(delivery.payload_json,'$.pull_request.title') FROM github_webhook_delivery delivery WHERE delivery.event='pull_request' AND CAST(json_extract(delivery.payload_json,'$.repository.id') AS TEXT)=project.repository_id ...`. Same lookup in `apps/web/src/api/review.ts:286-290`. Added by commit `5712036` (#155) on 2026-09-30, with migration `0028_pr_title_index.sql`.
  - Test fixture, `apps/web/src/api/dashboard.test.ts:42-54`: inserts a delivery with the full payload **and** `processed_at` set. Production code never creates that state.
  - Measurement: a `pull_request` receipt was stored with `persistWebhook`, then the statement from `webhooks.ts:330-335` ran.
    ```
    pullRequestTitle {"beforeProcessing":{"title":"Audit title"},"afterProcessing":null}
    ```
- What happens: The title is visible only between receipt and the end of processing, or while a delivery is stuck unprocessed. After that the JSON is `{}` and both lookups return NULL.
- Impact: The dashboard returns no `title` for pull request runs (`dashboard.ts:133`). The review page falls back to "Pull request visual review" (`review.ts:561`). Index `github_webhook_delivery_pr_title` holds only `(NULL, NULL, received_at)` entries for processed rows and still costs two JSON extractions on each insert and scrub.
- Recommendation: Store the title where it is needed, not in the receipt. A small table keyed by pull request, written while the `pull_request` webhook is processed:
  ```sql
  CREATE TABLE visonaut_pull_requests (
    repository_id TEXT NOT NULL, number INTEGER NOT NULL,
    title TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (repository_id, number)
  ) WITHOUT ROWID;
  ```
  The dashboard subquery becomes a primary-key lookup. Then drop index `github_webhook_delivery_pr_title`.
- Alternatives:
  - Minimal: keep three fields when a `pull_request` delivery is scrubbed, so the current index and queries work: `payload_json = json_object('repository', json_object('id', ...), 'pull_request', json_object('number', ..., 'title', ...))`.
  - Fetch the title from GitHub when a run is created and store it on the run.
  - Remove the title from the UI and delete both lookups and the index.
- Maintainer decision needed: yes. Should titles be stored (where), or removed?

### D1-04 · One "status" wakeup becomes a chain of queue messages that grows with the number of pull requests

- Kind: performance
- Severity: high. Confidence: high (mechanism), medium (production scale). Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/operations/review-links.ts:46-61`: `candidatesSql` ranks **all** `pull_request` rows of `pre_run_checks` with `ROW_NUMBER() OVER (PARTITION BY ... pull_request_number ORDER BY created_at DESC ...)`.
  - `review-links.ts:168-171`: `candidatesSql + " AND pullRequestNumber>? ORDER BY pullRequestNumber LIMIT ?"` with `tasksPerStep` (25).
  - `review-links.ts:405-412`: `report.hasMore = rows.length === context.budget.tasksPerStep;` and the cursor is saved.
  - `apps/web/src/runtime.ts:454`: `else if (result.hasMore) await env.OPERATIONS.send(message, { delaySeconds: 1 });`
  - `apps/web/src/api/review.ts:659-662`: every saved decision sends `{ kind: "status" }`.
  - `pre_run_checks` rows are never deleted (no `DELETE FROM pre_run_checks` in the source).
  - Measurement, idle database (no pending work), 750 pull requests:
    ```
    A idle queue: one 'status' wakeup followed until hasMore=false
      31 queue messages | 3,949 D1 calls | 7,597,795 rows read | 412 rows written | GitHub requests {}
      first steps: 179 D1 calls and ~251,000 rows read each; last steps: 79 D1 calls and ~239,000 rows read each
    ```
  - Per step, `publishReviewLinks` alone: 104 sequential D1 calls. For each legacy candidate it runs 4 single statements (`review-links.ts:81-92`, `:111`, `:179-190`).
- What happens: The review-link step pages through every pull request that ever had a check, 25 per step. Each page is a new queue message. Each message runs the whole status pass again: review queue, check delivery, review links, promotion. So one wakeup costs `ceil(pull requests / 25)` full passes, even when there is nothing to do. The window query is also run again for each page.
- Impact: The single queue consumer is busy for at least `ceil(P / 25)` seconds per wakeup because of the 1 s delay, plus the work. Each decision and each cron pass with `hasMore` starts such a chain. Real check updates wait behind it. Rows read grow with P x (rows per step), which also grows. I do not know P in production. This query returns it: `SELECT COUNT(DISTINCT pull_request_number) FROM pre_run_checks WHERE kind='pull_request' AND workflow_run_id IS NOT NULL`.
- Recommendation: Make the step look only at pull requests that can still change.
  ```sql
  -- candidates: only checks that changed recently
  ... FROM pre_run_checks source ...
  WHERE source.kind='pull_request' AND source.repository_id=?
    AND source.updated_at > ?            -- for example now - 14 days
  ```
  and do not report `hasMore` for a page that did no work. New attempts already skip the publish path (`review-links.ts:174`), so the legacy set never grows.
- Alternatives:
  - Minimal: `report.hasMore = rows.some(candidateDidWork)` so an idle sweep ends after one page, and let cron advance the cursor.
  - Mark finished legacy links (a `settled_at` column on `operations_review_links`) and exclude them from `candidatesSql`.
  - Split the message kinds, so a review decision wakes only "review-decisions" and "checks" for its own run, and review links run only from cron.
- Maintainer decision needed: yes. Must closed pull requests stay in the sweep at all? How long after the last attempt?

### D1-05 · One review decision sends a new GitHub check update for every active run

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `packages/service/src/status-touch.ts:9-13`: every check-visible change runs `UPDATE visonaut_projects SET revision = revision + 1 WHERE id = ?`. The revision is one counter for the whole project.
  - `apps/web/src/operations/checks.ts:200-209`: a run is selected when `EXISTS(SELECT 1 FROM work_status_outbox stale ... WHERE stale.check_id=creation.check_id AND stale.source_revision!=project.revision)`.
  - `checks.ts:210-218`: `prepareStatusIntent` for each selected run. `packages/service/src/run-status.ts:82-143` is about 10 sequential D1 calls per run.
  - `packages/security/src/checks.ts:160-203` (`sendGitHubCheck`): always one GET and one PATCH. It does not compare the new conclusion with the last delivered one.
  - Measurement: 30 active runs plus the baseline run. One decision on one row of one run, then the status wakeup:
    ```
    C after one decision queue: one 'status' wakeup followed until hasMore=false
      4,689 D1 calls | 753 rows written
      GitHub requests {"GET /repos/ariakit/ariakit/check-runs/:id":31,"PATCH /repos/ariakit/ariakit/check-runs/:id":31}
      first step: 775 D1 calls; second step: 323 D1 calls
    ```
    The idle sweep before the decision made 0 GitHub requests. A second decision gave the same 31 + 31.
- What happens: A decision on pull request A bumps the project revision. Every other active run then has a "stale" intent. The next status pass writes a new intent for each one and sends it to GitHub, even when its conclusion did not change.
- Impact: D1 calls, D1 writes, and GitHub API requests per decision grow with the number of active runs (open pull requests with a visual run). In the test, one decision cost 740 extra D1 calls and 62 GitHub requests. A review session with many decisions repeats this for each status pass. GitHub App rate limits and secondary limits apply to these PATCH calls.
- Recommendation: Do not deliver an intent that equals the last delivered one. In `prepareStatusIntent`, compare the computed `(conclusion, comparison ordinal, details URL)` with the current intent and only move `source_revision` forward:
  ```sql
  UPDATE work_status_outbox SET source_revision = ?
  WHERE check_id = ? AND revision = (SELECT desired_revision FROM work_checks WHERE id = ?)
    AND conclusion = ? AND comparison_revision = ? AND details_url = ? AND state = 'complete'
  ```
  The `work_status_identity` trigger (`0002_work.sql:48-53`) forbids changing `source_revision` today, so this needs a migration or a separate "verified at revision" column.
- Alternatives:
  - Minimal: in `deliverGitHubStatuses`, skip `sendGitHubCheck` when the previous complete intent for the check has the same conclusion and details URL, and settle the new intent as delivered. No schema change.
  - Narrow the staleness test: only project events that can change other runs (promotion, baseline change) bump a second counter that the stale check uses; review decisions bump only the run.
  - Keep the behavior and raise `tasksPerStep`. This does not remove the cost.
- Maintainer decision needed: yes. Is a repeated identical check update ever required (for example to refresh `completed_at`)?

### D1-06 · The dashboard history query reads every comparison row in the database

- Kind: performance
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/api/dashboard.ts:35-44`:
    ```sql
    WITH selected_runs AS (SELECT * FROM visonaut_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 100),
    counts AS (SELECT row.comparison_id, ... FROM visonaut_comparison_rows row
      JOIN selected_runs selected ON selected.comparison_id=row.comparison_id
      LEFT JOIN visonaut_decisions decision ON decision.id=row.decision_id GROUP BY row.comparison_id)
    ```
  - EXPLAIN QUERY PLAN on native D1:
    ```
    MATERIALIZE selected_runs
    SEARCH visonaut_runs USING INDEX visonaut_runs_active (project_id=?)
    USE TEMP B-TREE FOR ORDER BY
    MATERIALIZE counts
    SCAN row USING INDEX visonaut_rows_comparison
    SEARCH selected USING AUTOMATIC COVERING INDEX (comparison_id=?)
    ```
  - Measurement with 3,001 runs and 50,240 comparison rows: `dashboard()` = 1 batch, 126,608 rows read (history statement 114,415; actionable statement 12,192).
  - Same result with join order forced from the 100 runs (`FROM selected_runs selected CROSS JOIN visonaut_comparison_rows row ON ...`, only needed columns): 18,214 rows read. With an index on `(project_id, created_at DESC)` as well: 12,312 rows read. My variant left out the title, promotion, and failure subqueries; those are index lookups.
  - An index alone does not fix it: the unchanged SQL after adding the indexes still read 120,676 rows.
- What happens: The `LIMIT` makes SQLite materialize the CTE. With no statistics it then scans the whole row index and probes the 100 runs, instead of looking up rows for 100 comparisons. `SELECT *` also copies `plan_json` of each selected run into the materialized CTE. There is no index for `ORDER BY created_at`, so all runs of the project are read and sorted.
- Impact: Dashboard cost grows with the total number of comparison rows ever kept, not with the 100 runs shown. Closed runs keep row and decision stubs forever (`closed-summary.ts:315-320`), so this number only grows.
- Recommendation:
  ```sql
  WITH selected_runs AS MATERIALIZED (
    SELECT id, project_id, kind, tested_sha, state, attempt, created_at, comparison_id, active, sealed_at, lineage_key
    FROM visonaut_runs WHERE project_id=? ORDER BY created_at DESC LIMIT 100
  ), counts AS (
    SELECT selected.comparison_id, ... FROM selected_runs selected
    CROSS JOIN visonaut_comparison_rows row ON row.comparison_id = selected.comparison_id
    LEFT JOIN visonaut_decisions decision ON decision.id = row.decision_id
    GROUP BY selected.comparison_id
  ) ...
  ```
  plus `CREATE INDEX visonaut_runs_project_created ON visonaut_runs(project_id, created_at DESC);`
- Alternatives:
  - Minimal: only the `CROSS JOIN` (SQLite keeps the written order for `CROSS JOIN`). No migration.
  - Store `pending` and `rejected` counts on the comparison when a decision is saved, and read them directly. The dashboard then needs no row access. This adds a write to every decision.
  - Run `PRAGMA optimize` after migrations so the planner has statistics. This can change other plans too and needs a test.
- Maintainer decision needed: no.

### D1-07 · Recurring queue and cron statements scan whole tables; three of them are quadratic

- Kind: performance
- Severity: medium (high growth). Confidence: high. Measured: yes. Effort: S
- Evidence (idle database, one pass; rows read before and after seven trial indexes on the scratch database):

  | Statement                                  | File                                             | Plan problem                                                                                                          | Rows read | After indexes           |
  | ------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------- |
  | Closed-summary candidates                  | `closed-summary.ts:389-401`                      | `CORRELATED SCALAR SUBQUERY 3: SCAN event` for each old closed run, before the summary join                           | 632,837   | 4,760                   |
  | Resolve staged alerts                      | `workflow-materialize.ts:838-856`                | join on `event.subject_id = staged.workflow_run_id \|\| ':' \|\| staged.workflow_attempt` → `SCAN event` for each run | 1,218,583 | 18,355 (whole function) |
  | Create missing checks                      | `checks.ts:46-51`                                | `SCAN run`, then for each accepted run `SCAN snapshot`                                                                | 91,539    | 3,923                   |
  | Runs with stale intents                    | `checks.ts:200-209`                              | `SCAN creation`, `SCAN snapshot`, automatic index on `visonaut_status_outbox`                                         | 100,699   | 13,051                  |
  | `resolveEvents`                            | `common.ts:29-41`, called per step               | `SCAN operations_events`; 60 calls in one recovery step                                                               | 24,171    | (index used)            |
  | Lease sweeps on `work_checks`              | `work.ts:626-642`                                | `SCAN work_checks` twice per pass                                                                                     | 8,706     | not changed             |
  | Check creation state updates               | `checks.ts:52-62`                                | `SCAN operations_check_creations` twice                                                                               | 6,002     | not changed             |
  | Active run count                           | `capacity.ts:39-44`                              | `SCAN visonaut_runs`                                                                                                  | 3,001     | 3,001                   |
  | Alert list with 10 unmatched staged alerts | `operations.ts:30-36` + `staged-alerts.ts:29-31` | `SCAN staged` for each alert                                                                                          | 30,448    | not measured            |

  Totals for one idle pass: `runOperations({kind:'recovery'})` first step 921,542 rows read → 91,798 after indexes. `reconcileStagedWorkflows` 1,218,583 → 18,355. Cron runs every 5 minutes, which is 288 passes per day.
  - The shared predicate is `packages/service/src/review-status.ts:25-27`: `(run.active=1 OR (run.state='accepted' AND EXISTS(SELECT 1 FROM visonaut_projects project JOIN visonaut_snapshots snapshot ON snapshot.id=project.snapshot_id WHERE snapshot.run_id=run.id)))`. EXPLAIN: `SCAN snapshot` + `SEARCH project USING AUTOMATIC COVERING INDEX`. It is used in 9 places.
  - `operations_events` has only its primary key, but its id is built as `` `${kind}:${subject}:${code}` `` (`common.ts:20`).

- What happens: These statements have no index for their filter, or the filter is an expression. Cost is (old closed runs x events), (runs x events), and (accepted runs x snapshots). All three factors grow and never shrink.
- Impact: Rows read per cron pass grow quadratically. At the synthetic size the idle cron pass reads about 2.1 million rows. At twice the runs and twice the events it reads about four times that. D1 bills rows read and limits a statement to 30 s.
- Recommendation: Four small changes cover most of it.
  ```sql
  CREATE INDEX operations_events_subject ON operations_events(kind, subject_id);
  CREATE INDEX visonaut_status_outbox_pending ON visonaut_status_outbox(run_id) WHERE delivered_at IS NULL;
  CREATE INDEX operations_check_creations_check ON operations_check_creations(check_id);
  ```
  ```ts
  // review-status.ts: start from the single project row. Verified plan: two primary-key searches.
  export const statusRunEligibleSql = `(run.active=1 OR (run.state='accepted' AND run.id=(
    SELECT snapshot.run_id FROM visonaut_projects project
    JOIN visonaut_snapshots snapshot ON snapshot.id=project.snapshot_id
    WHERE project.id=run.project_id)))`;
  ```
  Use the primary key where the full id is known, for example `runtime.ts:459-465`: `WHERE id = kind || ':scheduler:' || code`.
- Alternatives:
  - Minimal: only the `operations_events(kind, subject_id)` index. It removes the two largest scans.
  - Add a partial index for active runs, `CREATE INDEX visonaut_runs_live ON visonaut_runs(state) WHERE active=1`, and rewrite the `OR` as a `UNION ALL` of "active" and "current baseline", so the run table is not scanned at all.
  - Delete resolved events after a period (see D1-10). This shrinks one factor but keeps the scans.
- Maintainer decision needed: no.

### D1-08 · Lookups on request paths have no supporting index

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence (EXPLAIN QUERY PLAN on the migrated schema, `explain.txt`; rows from the harness):
  - `packages/service/src/status-touch.ts:16-21`, in every decision and seal: `... WHERE id IN (SELECT id FROM visonaut_checks WHERE project_id = ? AND external_run_id=(...))` → `SCAN visonaut_checks`. Measured 3,007 rows read in one single-target decision.
  - `packages/service/src/run-status.ts:138`: `UPDATE visonaut_status_outbox SET delivered_at = ? WHERE run_id = ? AND run_revision <= ? AND delivered_at IS NULL` → `SCAN visonaut_status_outbox`. This table has no delete path.
  - `apps/web/src/api/review.ts:355`, `review-commands.ts:171-175`, `:107`: `FROM visonaut_promotions WHERE comparison_id = ?` → `SCAN visonaut_promotions`. Measured 297 rows (all promotions) three times per decision.
  - `packages/service/src/run-status.ts:37-41` (failed runs): `FROM visonaut_audit WHERE run_id = ? AND action = 'capture-failed' ORDER BY created_at DESC` → `SCAN visonaut_audit` + temp B-tree. Same scan in `history.ts:205` and `closed-summary.ts:329` (`DELETE FROM visonaut_audit WHERE run_id=?`).
  - `apps/web/src/api/webhooks.ts:284-289`, for every `pull_request` webhook: `FROM visonaut_runs WHERE project_id = ? AND lineage_key = ? AND active = 1` → `SEARCH ... visonaut_runs_active (project_id=?)`, which reads every run of the project. Same for `:214-219`.
  - `packages/service/src/review-commands.ts:166-170`: `WHERE comparison_id = ? AND id IN (SELECT value FROM json_each(?))` → `SEARCH ... visonaut_rows_comparison (comparison_id=?)`. Measured 801 rows read for one target.
  - `packages/service/src/service.ts:183-188` (`referenceCandidates`): `SCAN snapshot` + temp B-tree.
  - `closed-summary.ts:258-263`: commands of a run → `SCAN command USING INDEX sqlite_autoindex_visonaut_commands_1` (all commands).
- What happens: Each of these reads a whole table (or all runs of the project) to find a few rows.
- Impact: Small today, linear growth, and they sit on the decision and webhook paths. The `visonaut_checks` scan alone was 10 % of the rows read by a direct save in the test.
- Recommendation:
  ```sql
  CREATE INDEX visonaut_checks_run ON visonaut_checks(project_id, external_run_id);
  CREATE INDEX visonaut_promotions_comparison ON visonaut_promotions(comparison_id);
  CREATE INDEX visonaut_audit_run ON visonaut_audit(run_id, created_at);
  CREATE INDEX visonaut_runs_lineage_active ON visonaut_runs(project_id, lineage_key) WHERE active=1;
  CREATE INDEX visonaut_commands_comparison ON visonaut_commands(comparison_id);
  ```
  For the single-target read, put the primary key first: `WHERE id IN (SELECT value FROM json_each(?)) AND comparison_id = ?` and check the plan.
- Alternatives:
  - Minimal: `visonaut_checks_run` and `visonaut_promotions_comparison` only (both are on the decision path).
  - Store `check_id` on the run row and update `work_checks` by primary key, which removes `visonaut_checks` from the decision path.
- Maintainer decision needed: no.

### D1-09 · The review-queue index from migration 0030 is not used; the queue poll reads every review task

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/migrations/0030_review_queue_index.sql:1-3`: `CREATE INDEX work_tasks_review_queue ON work_tasks(state, available_at, lease_until, created_at) WHERE kind = 'review';`
  - `apps/web/src/operations/review-queue.ts:83-94`: `WHERE task.kind = 'review' ... AND ((task.state = 'queued' AND task.available_at <= ?) OR (task.state = 'leased' AND task.lease_until <= ?)) ... ORDER BY task.created_at, task.id LIMIT 1`
  - EXPLAIN (`explain2.txt`): `SEARCH task USING INDEX work_tasks_publication (kind=?)` + `USE TEMP B-TREE FOR ORDER BY`. With `INDEXED BY work_tasks_review_queue` the plan is a full `SCAN` of that index. No query names the index.
  - Measurement: 1,500 completed review tasks → the poll read 1,501 rows in each status step (46,531 rows over one 31-step sweep).
  - Review tasks stay until the run is summarized, 30 days after it closes (`closed-summary.ts:310-314`).
- What happens: The `OR` across two states hides the state filter from the planner. It uses the `kind` prefix of another index and reads every review task, including all completed ones, then sorts.
- Impact: The poll cost equals the number of decisions made in the last 30+ days, on every status step. The 0030 index adds write cost to every `work_tasks` update and gives nothing back.
- Recommendation: Add a state list that the planner can use, then drop the unused index.
  ```sql
  WHERE task.kind = 'review' AND task.state IN ('queued', 'leased')
    AND ((task.state = 'queued' AND task.available_at <= ?) OR (task.state = 'leased' AND task.lease_until <= ?))
  ```
  Verified plan: `SEARCH task USING INDEX work_tasks_publication (kind=? AND state=?)`.
- Alternatives:
  - Minimal: only the `state IN (...)` line; keep the index.
  - Replace both indexes with one partial index for open work: `CREATE INDEX work_tasks_open ON work_tasks(kind, created_at, id) WHERE state IN ('queued','leased')`, which also gives the order.
- Maintainer decision needed: no.

### D1-10 · Many tables only grow, and admission stops new runs at 2 GiB

- Kind: cost
- Severity: medium. Confidence: medium. Measured: yes (bytes per row), no (production counts). Effort: M
- Evidence:
  - `apps/web/src/runtime-defaults.ts:15-16`: `databaseWarningBytes: 1536 * 1024 * 1024, databaseAdmissionBytes: 2 * 1024 * 1024 * 1024`. `apps/web/src/capacity.ts:107-113` rejects new runs with 503 `capacity_exceeded` above the admission size.
  - `docs/simplification-implementation.md:171`: production D1 was 680,124,416 bytes on 2026-09-29. Later storage changes (#250, #251) may have changed this; I did not read the live size.
  - No `DELETE` exists in runtime source for these tables (search of all `DELETE` statements): `github_webhook_delivery`, `github_webhook_recovery`, `visonaut_status_outbox`, `work_checks`, `visonaut_checks`, `operations_check_creations`, `pre_run_checks`, `operations_review_links`, `operations_events`, `ingest_staged_runs`, `ingest_merge_groups`, `ingest_review_sessions`, `auth_audit`, `rateLimit`, `visonaut_commands`, `visonaut_promotions`, `visonaut_snapshots`. `work_status_outbox` is trimmed only for review-link checks (`review-links.ts:327-332`). `session` rows are deleted on sign-out and revocation only.
  - Measured bytes per row including indexes (`growth.txt`, 100,000 rows each):
    ```
    github_webhook_delivery (processed, payload '{}'): 215 bytes per row
    visonaut_status_outbox (delivered): 149 bytes per row
    work_status_outbox (complete): 204 bytes per row
    pre_run_checks: 667 bytes per row
    ingest_review_sessions: 145 bytes per row
    ingest_staged_runs (retention_state 'deleted'): 2,139 bytes per row   <- assumes 600-byte verified_json values
    ```
  - `packages/security/src/webhooks.ts:84-96` stores a receipt for every signed delivery, including events that `processWebhook` does nothing with.
  - `apps/web/src/api/review.ts:722-730` inserts one `ingest_review_sessions` row per review page session; nothing removes them.
- What happens: Receipts, outbox rows, check bookkeeping, staged-run headers, and sessions are kept forever. Closed runs keep summaries by design; these other tables are bookkeeping.
- Impact: The database moves toward the 1.5 GiB warning and the 2 GiB admission stop. The same tables are the ones scanned in D1-04, D1-07, and D1-09, so growth also slows the queue. One million webhook receipts are about 215 MB.
- Recommendation: Add one bounded cron step that deletes by age in pages, for the tables where the data has no later reader. A sketch:
  ```sql
  DELETE FROM github_webhook_delivery WHERE delivery_id IN (
    SELECT delivery_id FROM github_webhook_delivery
    WHERE processed_at IS NOT NULL AND processed_at < ? ORDER BY processed_at LIMIT 500);
  DELETE FROM visonaut_status_outbox WHERE id IN (
    SELECT id FROM visonaut_status_outbox WHERE delivered_at < ? LIMIT 500);
  DELETE FROM ingest_review_sessions WHERE created_at < ?;  -- older than the 7-day auth session
  ```
  Each needs a supporting index on the age column, and the webhook replay window (`github-deliveries.ts`, `recovery.ts`) defines the minimum age for receipts.
- Alternatives:
  - Minimal: delete only processed webhook receipts and delivered `visonaut_status_outbox` rows older than a fixed period.
  - Keep everything and raise the thresholds toward the 10 GB D1 limit. This keeps the scan costs.
  - Move cold bookkeeping to R2 as part of the existing closed-summary step.
- Maintainer decision needed: yes. How long must webhook receipts, check bookkeeping, and staged-run headers stay for replay protection and audit?

### D1-11 · Each decision rebuilds and returns the complete review model

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/api/review.ts:812-833`: when the queued task is complete, `const model = await reviewModel(context, run.id);` and `return Response.json({ ...result, model });`. Also `:637-639` (`commandResult`) and `:682-696` (`conflictResponse`).
  - Measurement for a run with 800 changed rows:

    | Step of one decision                | D1 calls | Rows read | Rows written | Response bytes |
    | ----------------------------------- | -------- | --------- | ------------ | -------------- |
    | `POST .../commands` (queued)        | 11       | 866       | 5            | 66             |
    | `processReviewQueue` in `waitUntil` | 14       | 6,098     | 22           | n/a            |
    | `GET /api/commands/:id/queued`      | 24       | 26,682    | 0            | 844,488        |
    | Total visible to the reviewer       | 49       | 33,646    | 27           | 844,554        |

  - The model read itself: images 8,801 rows, captures 6,400, decisions 4,005, comparison rows 3,200, eligibility 1,504, counts 1,604.
  - `packages/service/src/review-commands.ts:112-123` (`currentBaselineGuard`) and `run-status.ts:56-60` each read all rows of a comparison per decision.
- What happens: The client already holds the model. The server still reads every row, capture, image, and decision of the comparison and sends them all back after each decision. If the task is not complete on the first poll, the poll repeats with a new 6-call preamble.
- Impact: Cost per decision grows with the size of the comparison, not with the size of the decision. Before D1-01 and D1-02 are fixed, one decision waits for about 11 + 19 sequential round trips across two requests.
- Recommendation: Return the receipt plus the changed rows only. The command result already lists `revisions` (`review-commands.ts:218-226`, `:270`).
  ```ts
  return Response.json({
    ...result, // commandId, revisions, runRevision, baselineRevision
    reviewer: input.actorId,
    runStatus: status.status,
    changed: result.revisions, // the client patches its model
  });
  ```
  The direct-save branch already has this shape for the no-conflict case (`review.ts:900-904`). Send the full model only on conflict or revision mismatch.
- Alternatives:
  - Minimal: keep the full model but build it from one batch (see D1-02), which cuts calls, not rows or bytes.
  - Let `POST .../commands` wait for the inline `processReviewQueue` for a short time and return the receipt in the same response, which removes the poll request in the common case.
- Maintainer decision needed: yes. May the client patch its model from a receipt, or must every decision return server-built state?

### D1-12 · Image requests always reach the Worker, D1, and R2

- Kind: performance
- Severity: low. Confidence: medium. Measured: yes (1 D1 call per image). Effort: S
- Evidence: `apps/web/src/api/images.ts:24-35` reads `visonaut_images` by id, then `:39-40` reads R2. The response sets `Cache-Control: public, max-age=31536000, immutable` (`:52`), but the Worker does not use the Cache API, so the edge does not store its response. `validated = 1` in the filter repeats a CHECK constraint (`0001_service.sql:73`).
- What happens: The first view of each image in each browser costs one Worker run, one D1 primary read, and one R2 read. A conditional request costs a D1 read and an R2 `head`.
- Impact: A review with many thumbnails makes many primary reads for rows that never change.
- Recommendation: Check `caches.default` first and store successful responses, keyed by the image URL. The image id is immutable and unguessable, and the route is already public.
- Alternatives:
  - Minimal: none; keep it.
  - Use a D1 read replica session with `first-unconstrained` for this lookup only (see D1-13). The row never changes after validation except `bytes_present`.
  - Put the object key in a signed URL so no D1 read is needed.
- Maintainer decision needed: yes. Is an edge-cached image acceptable after a run's bytes are deleted (the cached copy outlives `bytes_present = 0`)?

### D1-13 · Read replication cannot help yet: no Sessions API, and two parts of the code depend on the raw binding object

- Kind: performance
- Severity: medium. Confidence: medium. Measured: no. Effort: M
- Evidence:
  - No `withSession` call in the repository (search: no matches). All reads and writes use `env.DB` directly (`apps/web/src/runtime.ts:259-263`). Without the Sessions API, D1 sends every query to the primary.
  - `packages/security/src/authorization.ts:19`: `const privatePermissions = new WeakMap<D1Database, Map<string, PrivatePermission>>();`. A per-request session object as the key would miss the cache on every request and call GitHub each time.
  - Better Auth detects D1 by shape (`batch`, `exec`, `prepare`). I did not verify that a D1 session object passes this test, so auth should keep the raw binding.
  - Read-after-write flows that need the primary or a bookmark: `review-commands.ts:308` then `review.ts:890-893` (`service.status`, `service.run` right after the write), and `review.ts:814-816`.
  - Good news: the application layer only needs `prepare` and `batch` (`database.ts:15-18`), which a D1 session also has. The read-only handlers (`dashboard`, `reviewModel`, `reviewPollState`, `operationsStatus`, `publicImage`) take the database as a parameter.
  - `apps/web/wrangler.jsonc` has no `placement` key.
- What happens: Every query from every region goes to one primary. Turning replication on in the dashboard would change nothing until the code opens sessions.
- Impact: Round-trip time per call stays tied to the distance between the user's edge location and the primary. With the depths in D1-02 this multiplies.
- Recommendation: Treat this as a second step after D1-01 and D1-02. Then: open one session per request, pass it to read handlers, and return the bookmark to the client so a read after a decision is not stale.
  ```ts
  const bookmark = request.headers.get("x-d1-bookmark") ?? "first-unconstrained";
  const session = env.DB.withSession(bookmark);
  const response = await dashboard({ database: session, configuration });
  response.headers.set("x-d1-bookmark", session.getBookmark() ?? "");
  ```
  Key the permission cache by a stable string, not by the database object.
- Alternatives:
  - Minimal: Smart Placement only (`"placement": { "mode": "smart" }`). No code change; the Worker moves next to D1.
  - Replicas only for the public image lookup (D1-12).
  - Do nothing; rely on fewer round trips.
- Maintainer decision needed: yes. Where is the primary located relative to the maintainers, and is Smart Placement or replication preferred?

### D1-14 · Migration numbering has a duplicate and two gaps, and nothing checks it

- Kind: dx
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Listing of `apps/web/migrations`: `0030_local_zero_pixel_reviews.sql` and `0030_review_queue_index.sql` both exist. Numbers `0017` and `0025` are missing. Scratch script output: `duplicates [["0030",2]]`, `missing ["0017","0025"]`.
  - The two 0030 files came from separate pull requests on the same day: `7893072` (#198) and `8ebf821` (#190), both 2026-10-02.
  - `apps/web/src/operations/README.md:3`: "Preserve applied migrations as history, including both `0030_*` files". So the duplicate is known and must stay.
  - `tooling/test-migrations.ts:24-26` sorts by file name. `.github/workflows/deploy.yml:125-127` runs `wrangler d1 migrations apply`. I found no test or script that rejects a duplicate or out-of-order number (`.github/workflows/scripts/deploy-migrations.test.mjs` checks the deploy command only).
  - `apps/web/migrations/0001_service.sql:1`: `PRAGMA foreign_keys = ON;` has no effect in D1.
- What happens: Two branches can each add the next number. Wrangler tracks applied migrations by name, so both apply, but the order in production then depends on merge and deploy order, while a fresh database uses name order. The two 0030 files are independent (one index, one data correction), so there is no effect today.
- Impact: A later pair of dependent migrations with the same number would apply in different orders in production and in tests.
- Recommendation: Add a small unit test next to `test-migrations.test.ts`:
  ```ts
  const numbers = names.map((name) => name.slice(0, 4));
  const known = new Set(["0030"]); // historical duplicate
  expect(numbers.filter((n, i) => numbers.indexOf(n) !== i && !known.has(n))).toEqual([]);
  ```
- Alternatives:
  - Minimal: a comment in the migrations folder that names the next free number.
  - Switch new files to a date prefix after `0034`, which cannot collide.
- Maintainer decision needed: no.

### D1-15 · Unused schema objects remain: 11 tables, 1 view, and 2 indexes

- Kind: dead-code
- Severity: low. Confidence: high. Measured: yes (reference count over 169 runtime source files). Effort: M
- Evidence (`usage.txt`):
  - No runtime reference: `operations_backups`, `operations_backup_pages`, `operations_backup_required`, `operations_backup_inventory`, `operations_backup_objects`, `operations_backup_groups`, `operations_backup_group_pages`, `operations_backup_members`, `operations_promotions`, `transfer_key_redemptions`, `visonaut_baseline_restorations` (named only inside trigger `work_no_byte_resurrection`, `0024_core_simplification.sql:52-58`), and view `operations_ready_history_archives`.
  - `docs/operations/issue-204-inventory.md:141`: "No current application/package runtime source names these nine tables." The backup tables are kept on purpose as history.
  - Index `work_tasks_review_queue` is not chosen by any query (D1-09). Index `github_webhook_delivery_pr_title` indexes values that are always NULL after processing (D1-03).
  - `packages/security/src/auth.ts:52`: `rateLimit: { enabled: true, storage: "database", ... }` writes to table `rateLimit`, which also has no cleanup.
- What happens: Retired features left their tables. They are small, but they are part of the 75 objects that Better Auth introspects per request (D1-01) and part of every schema dump and restore.
- Impact: Mostly reading cost for maintainers. The two indexes add write cost.
- Recommendation: After the retention decisions that the docs describe, one migration can drop the tables that hold no required evidence, the view, and the two indexes. Keep the migration files.
- Alternatives:
  - Minimal: drop only the two unused indexes.
  - Leave the tables and add a short comment file in `apps/web/migrations` that lists retired objects.
- Maintainer decision needed: yes. Which retired tables still hold evidence that must stay in D1?

### D1-16 · Independent statements are sent one by one where one batch or one statement is enough

- Kind: simplification
- Severity: low. Confidence: high. Measured: yes (call counts). Effort: S
- Evidence:
  - `packages/security/src/webhooks.ts:84-102` (`persistWebhook`): `INSERT ... ON CONFLICT DO NOTHING`, then a `SELECT` of the same row. Measured 2 calls per webhook. The earlier project check in `handleApi` makes 3 before the 202.
  - `packages/service/src/work.ts:102-135` (`claimWork`): two `UPDATE` statements in a row. Measured as 2 of the 14 background calls per decision.
  - `apps/web/src/capacity.ts:39-72` (`monitorDatabaseCapacity`): count, upsert, resolve → 3 calls, each cron pass.
  - `apps/web/src/api/operations.ts:16-47`: 3 independent reads in a row.
  - `apps/web/src/operations/checks.ts:46-85` (`createChecks`): 6 statements in a row before any work is known.
  - `apps/web/src/operations/index.ts:80`: `resolveEvents` after every step. Measured 60 `UPDATE operations_events` calls in one idle recovery step and 124 in one idle status sweep. `apps/web/src/runtime.ts:333`, `:388`, `:420`, `:455` add more.
  - `apps/web/src/operations/review-links.ts:172-204`: 4 single statements per legacy candidate (N+1), 100 calls per page.
  - Measured totals for one idle step: `runOperations({kind:'recovery'})` 385 D1 calls; `runOperations({kind:'status'})` 79 to 179 D1 calls.
- What happens: The queue consumer spends most of an idle pass on round trips that return nothing.
- Impact: Queue time per message and D1 request count. It also multiplies with D1-04.
- Recommendation: Use `RETURNING` for `persistWebhook`; put `claimWork`'s two updates in one `batch`; batch the reads in `operationsStatus`; resolve scheduler events once at the end of a pass with one statement:
  ```sql
  UPDATE operations_events SET resolved_at=? WHERE subject_id='scheduler' AND resolved_at IS NULL
    AND kind IN (SELECT value FROM json_each(?))
  ```
  For review links, load links and intents for the page with one joined query instead of per candidate.
- Alternatives:
  - Minimal: only the `resolveEvents` change (largest count).
  - Skip `resolveEvents` when the step neither failed now nor has an open event (keep an in-memory set per pass).
- Maintainer decision needed: no.

### D1-17 · Wide rows and API bounds that can meet D1 limits

- Kind: performance
- Severity: low. Confidence: medium. Measured: no. Effort: S
- Evidence:
  - `packages/service/src/service.ts:108-110`: `SELECT * FROM visonaut_runs WHERE id = ?` includes `plan_json`. `packages/service/src/run-admission.ts:79-82` allows it to be up to 1,500,000 bytes ("D1 limits a stored TEXT value to 2 MB; leave room for row metadata"). The run row is read up to 4 times in one request (D1-02), and `dashboard.ts:36` selects `*` for 100 runs into a materialized CTE. For sealed inventory runs the plan is compacted (`run-admission.ts:644`), so the size is small on the current path; legacy runs keep the full plan until they are archived.
  - `apps/web/src/api/review.ts:846-852`: a command may carry up to `maximumCaptures` (40,000) targets. `review-commands.ts:227-271` adds 4 statements per target to one batch, and stores `request_json`, `previous_json`, and `result_json` with one entry per target in one `visonaut_commands` row. `previous_json` is about 130 bytes per target, so about 15,000 targets pass the 2 MB value limit. The request body limit is 1 MB (`review.ts:842`), which allows about 16,000 targets.
  - The UI sends at most the changed variants of one item (`apps/web/src/review/use-review-session.ts:408-435`), so this is an API bound, not a UI path.
  - No statement builds a placeholder list; lists go through `json_each(?)`, so the 100-parameter limit is safe.
- What happens: The service accepts inputs that it cannot store in one row or one batch, and reads a large column that most callers do not use.
- Impact: A large scripted command would fail with a D1 error (503 to the caller) instead of a clear 400. Extra bytes are read for each run lookup on legacy runs.
- Recommendation: Name the columns in `Service.run` for callers that do not need the plan, and cap targets per command at a number that fits the batch (for example 500):
  ```ts
  if (!Array.isArray(body.targets) || body.targets.length > 500) throw new SecurityError("invalid_targets", 400, ...);
  ```
- Alternatives:
  - Minimal: only the target cap.
  - Move `plan_json` to its own table keyed by run id.
- Maintainer decision needed: no.

## Measurements (command, raw result, limits)

All scripts and outputs are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/d1/`.

1. Apply all migrations in file-name order to SQLite.
   - Command: `node apply.mjs`
   - Result:
     ```
     applied 33 files
     sqlite 3.53.1
     [{"type":"index","n":137},{"type":"table","n":74},{"type":"trigger","n":18},{"type":"view","n":1}]
     integrity [{"integrity_check":"ok"}]
     fk []
     duplicates [["0030",2]]
     missing ["0017","0025"]
     ```
2. Table to index map. Command: `node indexmap.mjs`. Result: `indexmap.txt`.
3. Native D1 harness. Command: `node_modules/.bin/vitest run --root <scratch>/harness --globals measure.test.ts` (run from the worktree; 1 test passed, 196 s). It starts Miniflare with one D1 database, applies all migrations with `tooling/test-migrations.ts`, seeds data with recursive CTEs, creates a real Better Auth session, and calls `handleApi` and the operations functions from the repository source. Results: `results.txt` and `results.json`.
   - Seed: `{"RUNS":3001,"ACTIVE":30,"ROWS":30,"BIG":800,"DELIVERIES":60000,"CUT":1560}`; database size 251,228,160 bytes.
   - Row counts: `visonaut_runs` 3,001; `visonaut_comparison_rows` 50,240; `visonaut_decisions` 30,400; `visonaut_captures` 88,000; `visonaut_images` 132,000; `github_webhook_delivery` 60,000; `pre_run_checks` 3,001; `operations_review_links` 1,350; `operations_events` 400; `ingest_staged_runs` 3,001; `work_tasks` 1,500; `work_checks` 4,351.
   - HTTP table: see D1-02 and D1-11.
   - Idle queue and cron (case, D1 calls, statements, rows read, rows written):
     ```
     A idle cron: monitorDatabaseCapacity()                      | 3   | 3   | 3,401     | 2
     A idle cron: reconcileWebhooks()                            | 1   | 1   | 1         | 0
     A idle cron: retireUnpinnedMainChecks()                     | 1   | 1   | 302       | 0
     A idle cron: reconcileEquivalentPullRequestChecks()         | 1   | 1   | 2,702     | 0
     A idle cron: reconcileStagedWorkflows()                     | 3   | 3   | 1,218,583 | 6
     A idle cron: expireStagedAttempts()                         | 2   | 2   | 6,004     | 0
     A idle cron: runOperations({kind:'recovery'}) first step    | 385 | 716 | 921,542   | 162
     A idle step: deliverGitHubStatuses()                        | 15  | 15  | 232,412   | 4
     A idle step: summarizeClosedRuns()                          | 3   | 3   | 632,837   | 0
     A idle step: publishReviewLinks() first page                | 104 | 104 | 15,434    | 2
     A idle queue: one 'status' wakeup until hasMore=false       | 3,949 | 3,949 | 7,597,795 | 412   (31 queue messages, 0 GitHub requests)
     C after one decision: one 'status' wakeup until hasMore=false | 4,689 | 4,937 | 7,899,629 | 753 (31 queue messages, 31 GET + 31 PATCH check-runs)
     ```
   - Index trial on the scratch database (rows read before → after): `reconcileStagedWorkflows` 1,227,559 → 18,355; `runOperations` recovery first step 941,529 → 91,798; `deliverGitHubStatuses` 252,413 → 56,846; `summarizeClosedRuns` 632,837 → 4,760; `dashboard()` unchanged SQL 126,608 → 120,676; rewritten dashboard history statement 18,214 (no index) and 12,312 (with index); direct save 31,167 → 28,181.
   - Pull request title: `{"beforeProcessing":{"title":"Audit title"},"afterProcessing":null}`.
   - Limits: synthetic data and shapes that I chose; real distributions differ. GitHub was a stub. Runs with an R2 inventory were not seeded, so the inventory path of `reviewModel` (two R2 reads and one more D1 read per request, `review-inventory.ts:43-66`) is not in the numbers. `rows_read` is the value from local workerd; I assume production D1 reports the same way. Wall times are not reported because Miniflare's proxy dominated them.
4. Static plans. Commands: `node explain.mjs`, `node explain2.mjs` (node:sqlite on the migrated schema, no statistics). Results: `explain.txt`, `explain2.txt`. Key lines are quoted in D1-07, D1-08, and D1-09.
5. Object usage. Command: `node usage.mjs`. Result: `usage.txt` (169 runtime source files scanned; tests, fixtures, and `test-*.ts` excluded).
6. Bytes per retained row. Command: `node growth.mjs`. Result: `growth.txt`, quoted in D1-10. The `ingest_staged_runs` number depends on my assumed JSON sizes.

## Open questions and items not verified

- Production row counts and the current database size. These decide the real weight of D1-04, D1-05, D1-07, and D1-10. Useful read-only queries: `SELECT COUNT(*) FROM operations_events`; `SELECT COUNT(DISTINCT pull_request_number) FROM pre_run_checks WHERE kind='pull_request' AND workflow_run_id IS NOT NULL`; `SELECT COUNT(*) FROM visonaut_runs WHERE active=1`; `SELECT COUNT(*) FROM github_webhook_delivery`; `SELECT COUNT(*) FROM visonaut_comparison_rows`.
- Production latency per D1 call and the primary's region. Workers traces are enabled (`wrangler.jsonc:15-20`), so one traced request to `/api/runs/:id` will show the chain from D1-02 with real timings.
- Whether Better Auth's un-awaited schema check always completes for ingest requests in production, or is sometimes cancelled when the response ends first. Locally both statements ran.
- Queue volume in production (messages per day on `visonaut-production-operations`). It would confirm or refute the chain length in D1-04.
- The inventory path of the review model (R2 reads and JSON validation of two inventory documents per request). It is outside the D1 lane, but it is on the same request.
- Whether any external reader (SQL exports, recovery tooling) still needs the retired tables in D1-15.
- `visonaut_summary_conversion_pages.rows_json` stores one archive page per row (`closed-summary.ts:150-155`). I did not check the maximum page size against the 2 MB value limit; this affects only the legacy conversion.
- The exact GitHub App event subscriptions, which set the growth rate of `github_webhook_delivery`.
- Whether a D1 session object can be passed to Better Auth (D1-13).
- I did not run the repository test suite or a build. I did not read any remote Cloudflare resource.
