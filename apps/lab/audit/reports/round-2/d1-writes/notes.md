# D1 write audit of the selected answers (round 2)

Lane folder: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/round2/d1-writes/`
Date of the work: 2026-10-06. Record revision: r1. Repository: `github.com/ariakit/visonaut`, worktree `serialized-dazzling-pixel`, commit `f83fef6`.

The rule of the maintainer: "As long as we don't increase the number of D1 writes (which is more costly on Cloudflare), it's fine." (D-LOAD-01) and "Extra D1 writes are also not acceptable." (D-DATA-02).

This file is the research record. `table.json` has one line for each selected answer and for each fix that changes writes.

An independent checker read this file on the same day, ran each probe again, and ran four new probes. Section 9 lists what the check changed. Text that comes from the check says "checker".

## 1. Result in short

A "row written" is what Cloudflare counts and bills for D1. Section 2 has the definition.

- 49 selected answers were checked. 40 do not increase the number of rows that D1 writes: 39 write the same, and 1 writes fewer (`D-AUTH-01`).
- **4 selected answers increase writes as the record describes them today.** For 3 of them, a small change of the design removes the increase. For `D-DATA-04`, no such change exists. See section 6.
  - `D-OPS-05 accept-and-wait`: each refused try writes 3 rows (measured). Change: the capacity check only reads. Then a try writes 0 rows.
  - `D-OPS-01`, row 8 (heartbeat): 1 new row for each pass (measured). Change: use the time that each cron pass already writes. Row 12 (alert for a dead decision): 2 rows on that failure. Change: read the failed task, which is already stored.
  - `D-DATA-01`: the six indexes (+1 row for each decision, +5 rows for each run, both measured), the title table (+1 row for each `pull_request` webhook, measured), and the inventory size alert (+1 row for each Submit above 80%). Change: two query rewrites in place of the indexes, three kept fields in place of the table, and a read in place of the alert. Each one writes 0 more rows (measured for the first two).
  - `D-DATA-04 thirty-day-window`: it deletes data that stays today, and each deletion is a write. About 25 to 55 rows, one time for each closed run (estimate).
- 4 selected answers are "the same" only if the implementation obeys one condition: `D-RUN-02`, `D-AUTH-04`, `D-UX-04`, `D-WORK-06`. See section 5.2.
- 1 selected answer is a one-time write: `D-AUTH-05` (10 rows for 10 accounts, measured).
- The fear about session refresh is not confirmed. Better Auth renews a session row one time each 24 hours. 20 polls in sequence wrote 0 rows (measured). So `D-LOAD-04`, `D-LOAD-05`, `D-UX-05`, and `D-RES-03` add no write.
- The grant of `D-LOAD-03` is in Worker memory, not in D1. It adds no write.
- The largest sources of writes today are not in the list of the maintainer's concerns. They are the webhook receipts and the check updates that one decision starts for every open pull request. See section 7.

## 2. Primary sources (read on 2026-10-06)

| Source     | Link                                                                  | Page date                   |
| ---------- | --------------------------------------------------------------------- | --------------------------- |
| D1 pricing | https://developers.cloudflare.com/d1/platform/pricing/                | "Last updated Apr 21, 2026" |
| D1 limits  | https://developers.cloudflare.com/d1/platform/limits/                 | "Last updated Apr 21, 2026" |
| D1 metrics | https://developers.cloudflare.com/d1/observability/metrics-analytics/ | "Last updated Apr 21, 2026" |

Copies of the three pages as Markdown are in `sources/`. The checker read the pricing page again on 2026-10-06: the price table and the definitions are the same as the copy.

### 2.1 What a "row written" is (pricing page, section "Definitions")

- Definition 2: "Rows written measure how many rows were written to D1 database. Write operations include `INSERT`, `UPDATE`, and `DELETE`. Each of these operations contribute towards rows written. A query that `INSERT` 10 rows into a `users` table would count as 10 rows written."
- Definition 6: "Indexes will add an additional written row when writes include the indexed column, as there are two rows written: one to the table itself, and one to the index."
- Definition 4: "Row size or the number of columns in a row does not impact how rows are counted. A row that is 1 KB and a row that is 100 KB both count as one row."
- Definition 3: DDL (`CREATE`, `ALTER`, `DROP`) "may contribute to a mix of read rows and write rows".
- FAQ: "Writing to columns referenced in an index will add at least one (1) additional row written to account for updating the index".
- FAQ: queries from the dashboard or from Wrangler "count as either reads or writes".
- Each query returns `meta.rows_read` and `meta.rows_written`. The pricing page names this `meta` object as a way to track the usage.

Consequences for a design, each with a number from this repository:

- A new column on a row that the service already writes costs 0 more rows, if the column has no index. Example: the two counts of `D-AUTH-04` in the `UPDATE visonaut_runs SET inventory_key=?, ...` that Submit already runs (1 row, measured).
- A new index costs 1 more row for each insert into its table, and 1 more row for each update that changes a column of the index. Example: the trial index on `operations_events(kind, subject_id)` makes a new alert 3 rows in place of 2 (measured).
- A new table costs 1 row or more for each insert. Example: the title table, 1 row for each `pull_request` event (measured).
- A statement that changes no row costs 0 rows. Example from the repository: `INSERT ... ON CONFLICT DO UPDATE ... WHERE value IS NOT excluded.value` (`apps/web/src/sql-writes.test.ts:195-213`).
- A migration has a one-time cost. Measured by the checker on the local D1 (`check/results/ddl.txt`): `CREATE INDEX` on a table with 1,000 rows wrote 1,001 rows, `ALTER TABLE ADD COLUMN` wrote 1 row, and `DROP INDEX` wrote 0 rows.

### 2.2 Prices

|              | Workers Free    | Workers Paid                                              |
| ------------ | --------------- | --------------------------------------------------------- |
| Rows read    | 5 million / day | First 25 billion / month included + $0.001 / million rows |
| Rows written | 100,000 / day   | First 50 million / month included + $1.00 / million rows  |
| Storage      | 5 GB (total)    | First 5 GB included + $0.75 / GB-mo                       |

### 2.3 The claim "a write costs about 1,000 times a read"

Verified for the price of one row above the included amount: $1.00 / million against $0.001 / million is exactly 1,000 times.

Two other ratios are smaller:

- The included amount of the paid plan: 25 billion rows read against 50 million rows written is 500 times.
- The daily limit of the free plan: 5 million against 100,000 is 50 times.

Rule of thumb that follows: in money, an index pays for its extra written row only when it removes more than 1,000 rows read for that written row. Example: the trial index on `operations_events` removes 1,194,000 rows read for each pass in the test of section 6.3, and it adds 1 written row for each new alert. In money it pays. Under the rule of the maintainer ("no increase") it is still 1 more written row.

### 2.4 Limits that this lane used

- "Queries per Worker invocation: 1000 (Workers Paid) / 50 (Free)". A review command with 246 targets needs 998 statements (record, D-WORK-04).
- "Maximum bound parameters per query: 100". "Maximum SQL statement length: 100,000 bytes".
- The limits page also says: "A single query that attempts to modify hundreds of thousands of rows ... will exceed execution limits."

### 2.5 What the service paid (documents in the repository)

- `docs/evidence/e07-billable-usage-september-24.json`: on 2026-09-24 the account showed 102 USD for D1 rows written: 151.67 million rows, of which 50 million are included. The billing cycle started on 2026-09-09.
- The same file and `docs/evidence/e07-cost-graphql-sanitized.json`: 144,767,914 of the 151,659,178 rows (95.46%) came from five synthetic capacity databases, which were deleted. All other databases of the account wrote 6,891,264 rows in that cycle to 2026-09-23.
- So the bill came from test databases on Cloudflare, not from the service. A test that needs many rows must use a local D1 (Miniflare), as the probes of this lane do. The answer `D-CODE-05 seeded-backend` is a local D1, so it writes no billed row.

## 3. Method

### 3.1 Tools

All counts with the label "measured" come from a native local D1 (Miniflare 5 / workerd, the version that the repository installs), with all 33 migration files of `apps/web/migrations` applied, and with the real repository code. A wrapper around the D1 binding records `meta.rows_written` of each statement. The repository has the same kind of wrapper: `apps/web/src/api/test-d1-costs.ts`.

| Probe                                                                 | File                                                                                                                                                                  | Result                  |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Scheduled passes, admission, alerts, heartbeat                        | `probe/cron.probe.ts`                                                                                                                                                 | `results/cron.txt`      |
| Sign-in, session, decisions, check updates, webhooks, the six indexes | `probe/review.probe.ts` (built by `probe/build-review-probe.mjs` from the harness of the d1 audit lane and `probe/review-cases.txt`)                                  | `results/review.txt`    |
| Submit flow                                                           | 2 tests of the repository, `apps/web/src/api/workflow-owned.test.ts:1398-1519` and `:4824-5053`, run with `VISONAUT_D1_COST_REPORT` and `VISONAUT_UPLOAD_COST_REPORT` | `results/submit.txt`    |
| Proposed statements                                                   | `probe/proposals.probe.ts`                                                                                                                                            | `results/proposals.txt` |

Commands (from the repository root; the Vitest cache and all output stay in the lane folder):

```sh
node_modules/.bin/vitest run --config <lane>/probe/vitest.probe.config.mjs <lane>/probe/cron.probe.ts
AUDIT_RUNS=1609 node_modules/.bin/vitest run --config <lane>/probe/vitest.probe.config.mjs <lane>/probe/review.probe.ts
VISONAUT_D1_COST_REPORT=<lane>/results/submit-d1-cost.jsonl VISONAUT_UPLOAD_COST_REPORT=<lane>/results/submit-upload-cost.jsonl \
  node_modules/.bin/vitest run --config <lane>/probe/vitest.repo-test.config.mjs -t "D1 evidence phase costs|keeps native D1 writes constant"
node_modules/.bin/vitest run --config <lane>/probe/vitest.probe.config.mjs <lane>/probe/proposals.probe.ts
```

`git status` of the repository was the same before and after the runs.

### 3.2 Probes of the independent check

The checker ran the cron probe, the review probe, and the proposal probe again. Each case gave the same number of rows written as the first run (54 cases of the review probe, compared in `check/rerun-review-writes.txt` and `check/first-review-writes.txt`). The first results are kept in `check/first-results/`.

| New probe                                                                                                                            | File                                                                                                         | Result                            |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| The Submit cost tests of the repository on a changed schema: today, the six indexes, and the six indexes without the two old indexes | `check/vitest.submit-schema.config.mjs`, `check/test-migrations-with-indexes.ts`, `check/compare-submit.mjs` | `check/results/submit-d1-*.jsonl` |
| Rows read for each of the four measured indexes alone, for two query rewrites, and for `ANALYZE`                                     | `check/index-gain.probe.ts` (built by `check/build-index-probe.mjs` from the test of the d1 verifier)        | `check/results/index-gain.txt`    |
| One-time migration statements, the title with three kept fields, a guarded alert, and the read of dead decisions                     | `check/ddl.probe.ts`                                                                                         | `check/results/ddl.txt`           |

```sh
CHECK_SCHEMA=six VISONAUT_D1_COST_REPORT=<lane>/check/results/submit-d1-six.jsonl VISONAUT_UPLOAD_COST_REPORT=<lane>/check/results/submit-upload-six.jsonl \
  node_modules/.bin/vitest run --config <lane>/check/vitest.submit-schema.config.mjs -t "D1 evidence phase costs|keeps native D1 writes constant"
node <lane>/check/compare-submit.mjs today six
node_modules/.bin/vitest run --config <lane>/check/vitest.check.config.mjs <lane>/check/index-gain.probe.ts
node_modules/.bin/vitest run --config <lane>/check/vitest.check.config.mjs <lane>/check/ddl.probe.ts
```

### 3.3 Limits of the measurements

- The meter is local workerd. It is the same SQLite engine and the same `meta` fields as D1, but it is not a production trace. Nobody read `rows_written` of the production database in this lane (no credentials, and the task forbids it).
- What the local meter counted: an INSERT is 1 row plus 1 row for each index of the table. An UPDATE is 1 row plus 1 row for each index that holds a changed column. A DELETE was 1 row for each deleted table row, also when the table has indexes (examples: `delete from "session"` is 1 row, and `session` has 3 indexes; the checker deleted 10 rows of `operations_events` and read 10). An UPDATE that takes a row out of a partial index counted no row for the index. The pricing page does not say how production counts the index entries of a DELETE. So the DELETE counts of this file can be low for production.
- The review probe uses the synthetic data of the d1 audit lane: 1,609 runs, 9 active runs, 724 old review links, 2,000 webhook receipts. Counts for one statement do not depend on that size. Counts for a status pass depend on the number of active runs and of pull requests: the text gives the rule.
- A failed batch returns no `meta`. Rows of a batch that rolls back are not in the counts.
- Event rates of production (decisions each day, webhooks each day) were not measured. Section 7 gives ranges and says where each range comes from.

## 4. Baseline: rows that D1 writes today, for each event

"Fixed" means that the number does not grow with the size of the test suite.

### 4.1 Sign-in and session

| Event                                                |                         Rows written | Statements that write                                                                                 | Source                         |
| ---------------------------------------------------- | -----------------------------------: | ----------------------------------------------------------------------------------------------------- | ------------------------------ |
| Sign-in, start (`POST /api/auth/sign-in/social`)     | 4 (6 the first time from an address) | `rateLimit` insert 3 or update 1; `verification` insert 3                                             | measured, `results/review.txt` |
| Sign-in, callback, account that signed in before     |                                   10 | `rateLimit` 1; `account` update 1; `verification` delete 1; `session` insert 4; `auth_audit` insert 3 | measured                       |
| Sign-in, callback, new account                       |                                   17 | as above, with `user` insert 3 and `account` insert 3                                                 | measured                       |
| **One complete sign-in of a known account**          |                               **14** |                                                                                                       | measured                       |
| Page request with a session less than 24 h old       |                                    0 |                                                                                                       | measured                       |
| First request after the session is 24 h old          |                                    1 | `update "session" set "expiresAt" = ?, "updatedAt" = ?`                                               | measured                       |
| 20 requests of `GET /api/runs` in sequence           |                                    0 |                                                                                                       | measured                       |
| 20 requests of `GET /api/runs/:id/state` in sequence |                                    0 |                                                                                                       | measured                       |
| A request to an auth route that the app does not use |                            3, then 1 | `rateLimit` insert, then update                                                                       | measured                       |
| Sign-out                                             |                                    7 | `rateLimit` 3; `session` delete 1; `auth_audit` insert 3                                              | measured                       |

Why the session row is written one time each 24 hours: `packages/security/src/auth.ts:42-46` sets `expiresIn` to 7 days and `updateAge` to 1 day. Better Auth 1.7.5 updates the row only when `expiresAt - expiresIn + updateAge <= Date.now()` (`better-auth/dist/api/routes/session.mjs:179-183`). After the update, the next one is due 24 hours later. The number of requests does not matter.

Why an auth route writes a row: `packages/security/src/auth.ts:52` has `rateLimit: { enabled: true, storage: "database", window: 60, max: 60 }`. The limit applies only to requests of `/api/auth/*`. A private API request does not pass it (0 rows, measured). The pages call only two auth routes, sign-in and sign-out (`apps/web/src/routes/index.tsx:216` and `:232`), so a poll does not reach an auth route.

### 4.2 Review

| Event                                                                |                                      Rows written | Source   |
| -------------------------------------------------------------------- | ------------------------------------------------: | -------- |
| Open a review page (`POST /api/review-sessions`)                     |                                                 2 | measured |
| **One decision for one variant** (queued, as the client sends it)    | **27** = 5 in the request + 22 in the queued save | measured |
| Decision for a whole screenshot with 4 variants                      |                                       46 = 5 + 41 | measured |
| One command with 20 variants                                         |                                     142 = 5 + 137 | measured |
| Undo of one decision                                                 |                                                13 | measured |
| Read of the decision receipt, the run model, the run state, an image |                                                 0 | measured |

The rule behind these numbers:

- Each command has a fixed part of 22 rows. `work_tasks`: insert 5, lease 4, complete 4. `visonaut_commands` insert 2. `visonaut_audit` insert 2. `visonaut_status_outbox` insert 2. `visonaut_projects`, `visonaut_runs`, and `work_checks`: 1 update each.
- Each variant adds 5 rows: `visonaut_decisions` insert 4 (the table has 3 indexes) and `visonaut_comparison_rows` update 1. A variant that already had a decision adds 2 more rows, for the revoke of the old decision.

### 4.3 Check update after a decision

| Event                                                  |                                                            Rows written | Source                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------: | -------------------------------------------------------------------------------------------- |
| Status pass with nothing to do                         | 17 = 1 for each page of 25 pull requests (the test data needs 17 pages) | measured. The first pass after a new database writes 32: 15 rows create the cursors one time |
| **Status pass after one decision, 9 active runs**      |                                                            **110** more | measured                                                                                     |
| Status pass after 4 commands that came before the pass |                           113 more: one update for each check, not four | measured                                                                                     |

Why 10 checks for one decision: each decision adds 1 to the revision of the project (`packages/service/src/status-touch.ts:11`). The status pass then selects each active run, and the baseline run, whose stored check update has another project revision (`apps/web/src/operations/checks.ts:200-208`). For each one it writes a new update and sends it to GitHub, also when the result is the same.

The 110 rows are 11 rows for each of the 9 other checks, 10 rows for the check of the reviewed run, and 1 row for its status row. The 11 rows of one check: `work_status_outbox` insert 3 and 2 updates of 2 rows each; `work_checks` 4 updates of 1 row each.

So one decision in a project with 9 open pull requests writes 27 + 110 = 137 rows. 80% of them are check updates for other pull requests.

### 4.4 Submit of a run

| Event                                                              |                                             Rows written | Source                                                                                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| The capacity check of a new run                                    | 1 for each call. The code calls it 2 times for a new run | 1 row: measured, `results/cron.txt`. 2 calls: counted, `apps/web/src/api/workflow-owned.ts:417` and `apps/web/src/api/workflow-materialize.ts:720` |
| Stage of a run with no changed capture (declare, finalize, submit) |                                                        5 | measured, `results/submit.txt`                                                                                                                     |
| Materialization of a run with no changed capture, with 1 capture   |                                                       59 | measured                                                                                                                                           |
| The same with 100 captures                                         |                                                       59 | measured                                                                                                                                           |
| Stage of a run with 1 changed capture and its mask                 |                                                       17 | measured                                                                                                                                           |
| Materialization of that run, with 2 or with 100 captures           |                                                       78 | measured                                                                                                                                           |
| Cleanup of the staged rows, after the retention time               |                                                  7 to 10 | measured                                                                                                                                           |

- A run with no change writes 64 rows in the measured steps, and the number does not grow with the number of captures. The repository has a test for this: "keeps native D1 writes constant as unchanged captures grow" (`workflow-owned.test.ts:1398`). The tests run with no capacity check, so the 2 rows of that check are not in the 64.
- Each changed capture with a mask adds about 31 rows at Submit (95 against 64) and 2 to 3 rows at cleanup. This is an estimate from one changed capture.
- Not measured in this lane: the rows of the Plan report, of the first Submit call that creates the staged run, of the check creation, and of the closed summary after 30 days.

### 4.5 Scheduled jobs

| Event                                                       |                                                      Rows written | Source                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------: | ---------------------------------------------------------------- |
| Cron pass (each 5 minutes), nothing to do                   |                                                                 1 | measured: `operations_cursors`, id `database-capacity`           |
| Cron pass with 100 successful deliveries in the GitHub list |                                                                 1 | measured: the 202 write statements of the recovery change no row |
| Status, ingest, and maintenance pass with nothing to do     |                                                                 0 | measured                                                         |
| Cron pass while the service is at its active-run limit      | 3 for the limit (snapshot 1, alert resolved 1, alert set again 1) | measured                                                         |

The 1 row of each cron pass is the capacity snapshot. `apps/web/src/capacity.ts:66-71` writes it with no guard, and its value holds `observedAt`, the time of the pass. 288 passes each day are 288 rows each day.

### 4.6 Alerts and webhooks

| Event                                                                    |                        Rows written | Source                                           |
| ------------------------------------------------------------------------ | ----------------------------------: | ------------------------------------------------ |
| Alert, first time                                                        |                                   2 | measured                                         |
| Alert that is seen again in a later pass                                 |                     1 for each pass | measured                                         |
| Alert resolved                                                           |                                   1 | measured                                         |
| Webhook receipt, event with no handler (for example `check_run` created) | 4 = insert 3 + "processed" update 1 | measured; the API audit lane measured the same 4 |
| Webhook receipt, `pull_request` event                                    |             6 = insert 4 + update 2 | measured                                         |

`pull_request` costs 2 more rows because of the index `github_webhook_delivery_pr_title` (migration `0028`). The dashboard uses this index to find the title of a pull request (`apps/web/src/api/dashboard.ts:57-62`). The lookup returns NULL in production, because the service clears each processed payload. The audit found this (finding D1-03: "Pull request titles are read from webhook payloads that the service has already erased").

## 5. The 49 selected answers

The complete list with the numbers is `table.json`. This section explains the answers that needed a close look.

### 5.1 Answers that the task named, and that add no write

**D-LOAD-03 `batch-reads` ("a write check keeps the grant").** The grant is a `Map` in Worker memory: `packages/security/src/authorization.ts:19` (`new WeakMap<D1Database, Map<string, PrivatePermission>>()`) and line 81 (`permissions.set(key, { identity, checkedAt })`). Today line 74 stores the grant only when the access is not "write". The selected answer removes that condition. No D1 statement is added. The option `joins: true` changes the SQL of a read. Verdict: the same, 0 rows.

**D-LOAD-04 `server-loader`, D-LOAD-05 `loader-default`, D-UX-05 `focus-and-interval`, D-RES-03 `on-return`.** These answers add or move read requests. A read request with a session writes 0 rows. The session row is written one time each 24 hours, for any number of requests (section 4.1, measured). Example: a maintainer keeps the queue open for 8 hours with the 60-second refresh of D-UX-05. That is 480 requests and 0 or 1 written row, the same row that the first click of the day writes today. Verdict: the same.

One note for D-LOAD-04. The record already says: "Leave the session renewal to a later request". With `disableRefresh` in the document read, the read writes 0 rows. Without it, the write is the same single row, but its `Set-Cookie` is lost in a streamed response. That is a cookie problem, not a write problem.

**D-AUTH-03 `repair`.** The repair asks for a new review session: 2 rows (`ingest_review_sessions` insert). Today the reviewer must reload the page, and a reload also asks for a new review session: 2 rows. The first try with the expired review session is refused before any write. Verdict: the same.

**D-OPS-03 `keep-project-version`.** No change. A decision that loses the race keeps the 13 rows of its queue task and writes no decision. The second try is a normal decision. This is the behavior of today.

**D-OPS-06 `newest-wins`.** One more condition in a read, and no new statement. The service then makes fewer copies of an approval: 290 against 300 in the test of the record. A copy is 5 rows (a decision row and its row update, counted from section 4.2). A row that gets no copy waits for a reviewer, and a decision by hand is a normal decision (27 rows for one variant). That is the purpose of the rule. Verdict: the same.

**D-RUN-05 `receipt-only`.** Only the answer of the server changes. The decision writes the same 27 rows. Verdict: the same.

**D-WORK-02 `one-stage-mask-at-load`.** One more image request for each changed variant. An image request writes 0 rows (measured). Verdict: the same.

**D-RES-02 `no-promise`.** Client text only. Verdict: the same.

### 5.2 Answers that are the same only with a condition

**D-RUN-02 `attention-first-response`.** The record says: "Submit must store the baseline image, the name, and the variant with each changed or removed row, in a new column of D1". Submit already inserts one `visonaut_comparison_rows` row for each changed capture: 5 rows written (measured: the row and its index entries). A new column in that same INSERT costs 0 more rows. Condition: no index on the new column, no second statement, no new table, and no UPDATE of old runs. With the rule "no backward compatibility", old runs can keep the read of today or show nothing. A backfill would be one row for each old comparison row. The migration that adds the column writes 1 row, one time (measured for `ALTER TABLE ADD COLUMN`).

**D-AUTH-04 `show-settings`.** The two counts must be stored at Submit, or the run header needs the inventory from R2. Submit already updates the run row when it stores the inventory pointer (`UPDATE visonaut_runs SET inventory_key=?, ...`, `packages/service/src/run-admission.ts:644`, 1 row). Condition: the counts go into that statement.

**D-UX-04 `fields-with-a-source`.** The login is a read. "The last result needs no storage." The closed reason: each writer already updates the run row when it closes the run (example: `packages/service/src/retention.ts:100`), so the reason costs 0 more rows in the same UPDATE. Condition: no index on the reason, and no second statement. The title is the open point: see 6.3.

**D-WORK-06 `undo-on-both-paths`.** Each save writes what it writes today. The dialog of today stops a wrong click on the button before any write. Without the dialog, a wrong click is one command and one Undo: for a screenshot with 4 variants that is 46 + 13 = 59 rows, and 2 check updates. Nobody measured how often a reviewer clicks the button by mistake. The key path (Shift+A) already saves at once today.

One more note, for **D-OPS-07 `counts`**. Today each status pass writes 11 rows for each check, so counts in the text add nothing. But counts change the text of a check at each decision. If the service later stops the update of a check whose text did not change (section 7, item 2), the check of the reviewed run still changes at each decision, because its count changes. The other checks do not.

### 5.3 The note of D-WORK-04 (a button that approves the entire run)

One command for the entire run writes fewer rows than the same decisions one by one. Example with the constructed run of the record, 41 screenshots and 246 variants:

| How                                | Commands |              Rows written |
| ---------------------------------- | -------: | ------------------------: |
| One variant at a time              |      246 |          246 × 27 = 6,642 |
| One screenshot at a time (Shift+A) |       41 | 41 × 22 + 246 × 5 = 2,132 |
| One command for the run            |        1 |      22 + 246 × 5 = 1,252 |

The numbers follow from the rule of section 4.2 (22 rows for a command, 5 for a variant). The limit is not the rows. It is the 1,000 queries of one Worker invocation: the record counts 998 statements for 246 targets.

### 5.4 D-DATA-02 (opened again)

`smaller-object` changes only the R2 object. The run row keeps one key, one digest, and one size: 0 more rows. For the new options:

- Any format that stays in R2 writes 0 more rows, if the run row has one pointer and one digest for the complete inventory.
- A format with one D1 row for each capture breaks the rule. Example: 3,832 captures are 3,832 rows or more for each run, against 64 rows today. With 450 to 680 runs each month (record, data section) that is 1.7 to 2.6 million rows each month before indexes.
- A format with one D1 row for each page of an R2 inventory adds 1 row or more for each page and each run.

### 5.5 The fix lists

The checker read each row of the 10 accepted lists (`check/scan-lists.mjs` prints the rows that name a store, a row, an alert, or an index). The rows that write are in section 6. Three rows looked like a write and are not one:

- D-AUTH-01, "Keep the login also after a refusal": the login is in a `Map` in Worker memory (`packages/security/src/github.ts:193-204`).
- D-WORK-01, "Store the switch beside the sidebar preference": that is `localStorage` in the browser.
- D-DATA-01, the prefix rule for image deletion: it changes a read. The audit found that 25 rows that cannot be deleted stop all later image deletions (finding STORE-08). The fix adds no statement. If production has such rows today, deletions that are stopped today run again, with the rows of a normal run deletion. Nobody read production for this.

## 6. Answers that increase writes, and the smallest change for each

### 6.1 D-OPS-05 `accept-and-wait`

What happens today: the reserve call of Submit runs `checkRunAdmission` (`apps/web/src/capacity.ts:91-114`). That function calls `monitorDatabaseCapacity`, which writes. Measured for a run that is refused at the active-run limit: 3 rows for each try (the capacity snapshot, the alert resolved, the alert set again). The reserve request writes nothing before this check (counted by the checker: `apps/web/src/api/workflow-owned.ts:327-343` and `:397-430` only read). A new run that is accepted writes 1 row for each call, and the code calls the check 2 times for a new run.

With the selected answer the CLI sends the reserve call again for a limited time. Example: one try each 30 seconds for 10 minutes is 20 tries and 60 rows, where today one refused Submit writes 3.

Smallest change: the admission check only reads. It runs the one SELECT of `capacity.ts:40-41` (0 rows written, measured) and compares the result with the limits. The same result holds the database size (`meta.size_after`), so no second read is necessary. The cron pass keeps the snapshot and the alert: it writes them each 5 minutes already.

```ts
// apps/web/src/capacity.ts (sketch, not built)
export async function checkRunAdmission(database, policy, identity, now) {
  // ...the read of the existing run, as today
  const snapshot = await readCapacity(database, policy, now); // the SELECT only: no cursor, no alert
  if (blocked(snapshot)) throw new SecurityError("capacity_exceeded", 503, "...");
  return { maximumActiveRuns: policy.maximumActiveRuns };
}
```

Result: 0 rows for each refused try and 0 rows for each accepted new run. That is 2 rows fewer than today for each new run. What it gives up: the alert "admission-blocked" appears at the next cron pass (5 minutes or less), not at the moment of the refusal. If a run waits and then passes between two cron passes, no alert appears at all. For a run that waits and passes, that is correct.

### 6.2 D-OPS-01, rows 8 and 12

**Row 8: "Write a heartbeat at the end of each pass".** A heartbeat row costs 1 written row for each pass (measured). 288 cron passes each day are 288 rows, and each status, ingest, and maintenance pass adds one.

Smallest change: write no new row. The cron pass already writes the capacity snapshot each 5 minutes, and the snapshot holds `observedAt`. The API already sends the snapshot to the Service view: `apps/web/src/api/operations.ts:45-52` reads the row and returns it as `capacity`. So the Service view only needs to compare `capacity.observedAt` with the time of now, and to warn when the difference is more than 15 minutes.

```sql
-- The row that each cron pass writes today (apps/web/src/capacity.ts:66-71):
-- operations_cursors: id = 'database-capacity'. Example value, with the 5.5 MiB of today:
-- {"databaseBytes":5767168,"activeRuns":0,"observedAt":1791300000000, ...}
SELECT json_extract(value, '$.observedAt') AS last_pass
FROM operations_cursors WHERE id = 'database-capacity';
```

Three conditions:

- Today the admission of a new run also writes this snapshot, 2 times for each new run. With the change of 6.1, only the scheduler writes it. Without that change, a Submit makes a stopped scheduler look alive.
- The snapshot is written at the start of a pass. To show that a pass ended, move that one write to the end of the pass. It stays 1 row.
- The snapshot is not written when the size measurement fails (`capacity.ts:47-58`). Then the time gets old while the scheduler runs. The warning must say "no scheduled pass, or no measurement". The alert `measurement-unavailable` of today shows which one.

**Row 12: "raise an alert" for a decision that failed 5 times.** An alert is 2 rows the first time and 1 row each time it is seen again (measured). It is written only on a failure that the audit saw 0 times in 60 decisions of one reviewer.

Smallest change: write no alert row. The failed task already gets the state `dead` in `work_tasks` (`packages/service/src/work.ts:188`). That UPDATE is written today. The API of the Service view can read it:

```sql
SELECT COUNT(*) AS dead, MAX(updated_at) AS newest
FROM work_tasks WHERE kind = 'review' AND state = 'dead';
```

Measured by the checker: 2 rows read among 2,002 review tasks, 0 rows written, through the index `work_tasks_publication` (`check/results/ddl.txt`). Not built. What it gives up: the read has no "resolved" time. A dead task stays until its run is summarized, 30 days after the run closes, so the read needs an age limit, for example `updated_at` in the last 24 hours. A log line (row 7 of the same list) costs 0 rows but is not in the Service view.

### 6.3 D-DATA-01: three rows of the list

**The six indexes (`0036_scan_indexes.sql` in the record).** Each index adds 1 row to each insert into its table.

| Index                              | Adds                                                | Source                                                                                                   |
| ---------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `visonaut_status_outbox_pending`   | +1 for each decision and each Undo; +3 for each run | measured: decision 28 against 27; materialization +3                                                     |
| `visonaut_runs_lineage_active`     | +1 for each run                                     | measured                                                                                                 |
| `operations_check_creations_check` | +1 for each run                                     | measured                                                                                                 |
| `visonaut_checks_run`              | +1 for each run                                     | counted: the check row is inserted outside the measured steps (`packages/service/src/run-status.ts:116`) |
| `operations_events_subject`        | +1 for each new alert                               | measured: 2 becomes 3                                                                                    |
| `visonaut_promotions_comparison`   | +1 for each baseline promotion                      | counted                                                                                                  |

Measured by the checker with the six indexes in place (`check/compare-submit.mjs today six`): the materialization of a run with no change writes 64 rows against 59, and with one changed capture 83 against 78. So a run writes 5 rows more (measured) and 1 more for its check row (counted). The migration itself writes 1 row for each row that the six tables hold on that day (measured: 1,001 rows for a table with 1,000 rows).

What each index gives. The record measured four of the six together, with `ANALYZE`. The checker measured each of the four alone, with no `ANALYZE`, on the same test data (2,000 runs, 300 alerts; `check/results/index-gain.txt`):

| Statement                      | Where it is                                                                                    |   Today | With its index | Index                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ------: | -------------: | -------------------------------- |
| Closed-summary candidates      | `apps/web/src/operations/closed-summary.ts:389-396`                                            | 597,980 |          3,980 | `operations_events_subject`      |
| Resolve staged alerts          | `apps/web/src/api/workflow-materialize.ts:837-850`, in the scheduled step for staged workflows | 606,000 |          6,000 | `operations_events_subject`      |
| Runs with a stale check status | `apps/web/src/operations/checks.ts:200-208`, in each status pass                               |  48,530 |         43,509 | `visonaut_status_outbox_pending` |
| The check of a run             | the queued save of each decision                                                               |   2,001 |              3 | `visonaut_checks_run`            |
| Active runs of a pull request  | `apps/web/src/api/webhooks.ts:286`, at each `pull_request` webhook                             |   2,000 |              0 | `visonaut_runs_lineage_active`   |
| Count of active runs           | `apps/web/src/capacity.ts:40-41`, in each cron pass and each capacity check                    |   2,000 |             20 | `visonaut_runs_lineage_active`   |

The first two statements read each alert again for each run. They are 1,203,980 of the 1,293,913 rows of the record's table. The other statements read each run one time.

Smallest change: add no index, and rewrite the first two statements. Both rewrites are measured on the same test data, with no index and no `ANALYZE`:

```sql
-- apps/web/src/operations/closed-summary.ts:394, in the candidate statement.
-- Today: one scan of operations_events for each run.
AND NOT EXISTS(SELECT 1 FROM operations_events event WHERE event.kind='history'
  AND event.subject_id=run.id AND event.code='summary-conversion-failed'
  AND event.resolved_at IS NULL AND event.last_seen_at>?)
-- Rewrite: one scan for the statement. subject_id is NOT NULL (migration 0005), so the rows are the same.
AND run.id NOT IN (SELECT event.subject_id FROM operations_events event WHERE event.kind='history'
  AND event.code='summary-conversion-failed' AND event.resolved_at IS NULL AND event.last_seen_at>?)

-- apps/web/src/api/workflow-materialize.ts:839-850, the statement that resolves staged alerts.
-- Today the planner starts from the runs.
-- Rewrite: CROSS JOIN keeps the order of the text, so the statement starts from the open alerts.
SELECT event.id FROM operations_events event
  CROSS JOIN ingest_staged_runs staged ON event.subject_id = staged.workflow_run_id || ':' || staged.workflow_attempt
  CROSS JOIN visonaut_runs run ON run.external_run_id = staged.workflow_run_id AND run.attempt >= staged.workflow_attempt
WHERE event.kind = 'staged-reconciliation' AND event.resolved_at IS NULL AND ...
```

| Statement                 |   Today | Index | Rewrite | Rows written by the rewrite |
| ------------------------- | ------: | ----: | ------: | --------------------------: |
| Closed-summary candidates | 597,980 | 3,980 |   6,280 |                           0 |
| Resolve staged alerts     | 606,000 | 6,000 |     301 |                           0 |

The checker added 3 alerts that match each statement and compared the rows: each rewrite returned the same 3 rows as the statement of today. With 3 open staged alerts the second rewrite read 6,315 rows: it reads the staged runs of the repository one time for each open alert. The record already uses this kind of fix in the same list: `CROSS JOIN` in the history statement, and `state IN` in the poll.

The other five indexes serve statements that read each run one time. At 2,000 runs that is 2,000 rows read, which costs less than 2 written rows by the price ratio of section 2.3. The record itself says about the scans: "Money is not the cost." The database has 5.5 MiB today. This lane proposes to leave the five out until production shows a slow statement.

`ANALYZE` is the third way. Measured by the checker: it writes 38 rows each time it runs, and it brings the three large statements to 6,260, 8,300, and 9,502 rows. The record rejects it because its counts describe the tables at the time of the command.

**Two old indexes (a proposal of the first report of this lane).** The first report proposed to remove two indexes in the same migration, to pay for the six. The check changes that proposal in three points.

| Schema                                     | One decision | One `pull_request` receipt | Materialization of a run with no change |
| ------------------------------------------ | -----------: | -------------------------: | --------------------------------------: |
| Today                                      |           27 |                          6 |                                      59 |
| The six indexes of the record              |           28 |                          6 |                                      64 |
| The six indexes, minus the two old indexes |           25 |                          4 |                                      64 |
| Today, minus the two old indexes           |           24 |                          4 |                                      59 |

All numbers are measured, with one exception: the receipt in the last line follows from the line above it, because none of the six indexes is on the receipt table.

1. The removal does not pay for the six indexes. A run still writes 5 rows more (measured). So it is an opportunity by itself: 3 rows fewer for each decision, and 2 fewer for each `pull_request` receipt.
2. `work_tasks_review_queue` (migration 0030) is not used: no query selects it, also after the fix `state IN` of the list (verification of the d1 audit lane, `apps/lab/audit/reports/d1/verification.md:277-284`). `github_webhook_delivery_pr_title` (migration 0028) is used: the title lookup of the dashboard selects it, and `apps/web/src/api/dashboard.test.ts:275` checks that plan. It can go only in the change that replaces that lookup. If the lookup stays, the index stays.
3. The contract has a row about retired data (`docs/current-contract.md:58`, decision D14: "No destructive migration, row/table/object deletion, or shorter retention"). The verifier of the d1 audit lane read it as a stop for these removals. The row is about backup and transfer tables, and an index holds no data. The maintainer must say if it applies. `DROP INDEX` wrote 0 rows (measured).

**The title of a pull request.** The dashboard reads the title from the stored webhook payload, and the service replaces that payload with `{}` when it has processed the webhook. So the title is NULL today. The record adds a table, and its sketch writes the row at each `pull_request` webhook: `ON CONFLICT ... DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at`. Measured: 1 row for each event, also when the title is the same. A pull request with 12 pushes and 5 label changes gives 18 rows for one title.

Three designs, with the rows for one `pull_request` event:

| Design                                     | Receipt | Title                               | New objects                           |
| ------------------------------------------ | ------: | ----------------------------------- | ------------------------------------- |
| Today                                      |       6 | 0 rows, and no title                | none                                  |
| The table of the record                    |       6 | +1 for each event                   | 1 table, 1 migration                  |
| Keep three fields in the payload           |       6 | 0 rows                              | none                                  |
| The table with a guard, and no title index |       4 | +1 when the title is new or changed | 1 table, 1 migration, 1 index removed |

Smallest change with no more rows: keep three fields. The UPDATE that marks the receipt as processed writes a small payload in place of `{}`:

```sql
UPDATE github_webhook_delivery SET processed_at = ?,
  payload_json = json_object(
    'repository', json_object('id', json_extract(payload_json, '$.repository.id')),
    'pull_request', json_object('number', json_extract(payload_json, '$.pull_request.number'),
                                'title', json_extract(payload_json, '$.pull_request.title')))
WHERE delivery_id = ? AND payload_digest = ?;
```

Measured by the checker (`check/results/ddl.txt`): the receipt writes 4 + 2 = 6 rows, the same as today. After it, the title lookup of today returns `"Fix the combobox popover"` (the title of the test payload) with 1 row read, through the index that exists. No table, no migration, and no change in the two readers. Its cost: 5 statements clear the payload today (`apps/web/src/api/webhooks.ts:150`, `:172`, `:332`, `apps/web/src/operations/recovery.ts:73`, `packages/security/src/webhooks.ts:147`), and each one needs the same change for a `pull_request` event. The rule in `docs/operations/compact-processed-webhooks.md` needs a new sentence. The record names this option and rejects it for these two reasons. With the rule "no backward compatibility", both can change.

Second option, with fewer rows than today: the table with a guard, and the removal of the title index.

```sql
INSERT INTO pull_request_titles(repository_id, number, title) VALUES(?,?,?)
ON CONFLICT(repository_id, number) DO UPDATE SET title=excluded.title
WHERE pull_request_titles.title IS NOT excluded.title;
```

Measured: 1 row for the first event, 0 rows for a later event with the same title, 1 row for a changed title. The column `updated_at` must go, or it must change only with the title. For the pull request with 18 events: 18 × 4 + 1 = 73 rows, against 18 × 6 = 108 today.

The record has a third text for the title. D-UX-04 says "No new table: the design record of U05 selects a title column on the run row" (U05 is an earlier design decision of the project). D-DATA-01 has the table. The maintainer accepted both texts, so one of them must change. "Keep three fields" agrees with "No new table".

**The inventory size alert ("above 80% of the limit").** An alert of today is 2 rows the first time and 1 row for each later Submit above the line. Production is at 72.9%, so above 80% each run would write 1 more row.

Smallest change: write no alert row. The run row already holds the size: Submit stores `inventory_bytes` (`packages/service/src/run-admission.ts:644`). The API of the Service view can read the largest size of the newest runs and compare it with the limit. That is a read. Not built.

If an alert row is necessary, write it only when it is not open:

```sql
INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at,
  occurrences=operations_events.occurrences+1, resolved_at=NULL
WHERE operations_events.resolved_at IS NOT NULL;
```

Measured by the checker: 0 rows while the alert stays open, and 1 row when it opens again after a resolve. The first report proposed `ON CONFLICT(id) DO NOTHING` (measured: 2 rows, then 0). That form never opens a resolved alert again. The new design for D-DATA-02 can make this alert unnecessary.

### 6.4 D-DATA-04 `thirty-day-window`

Today the images of a replaced baseline stay, so D1 writes nothing for them. The selected answer adds one statement, `DELETE FROM work_retention_pins WHERE owner=? AND reason='comparison'`, to a batch that already runs one time for each closed run (`packages/service/src/retention.ts:7-35`). The runs that lose their last pin then go through the deletion that exists for other runs (`retention.ts:190-222`). Each pull request run already pays these statements today, 30 days after it closes.

Rows for each run that the window releases (an estimate, counted from the code, not measured):

- 1 row for each deleted pin.
- 3 rows for the three state changes of `work_retained_runs`.
- 1 row for each stored image of the run: `UPDATE visonaut_images SET bytes_present=0 WHERE run_id=?`. A run stores an image only for a changed or new capture, and its mask.
- When the run detail is already archived, 1 more row for each image row and each capture row that the same batch deletes (`packages/service/src/prune.ts:22-41`). The first report did not count these.

Example: a main run with 10 changed captures has about 20 image rows. Its release writes about 25 rows, and up to about 55 with the two deletes of the last point. One time. The same run wrote about 370 rows when it was submitted (64 + 10 × 31).

No design deletes these images with 0 writes: the service must record that the bytes are gone, or the image route would ask R2 for a missing object. Two smaller designs, both not verified:

- The run state alone (3 rows), with no row for each image. That needs a change in the 12 source files that use `bytes_present`.
- An R2 lifecycle rule that deletes objects by age. It writes 0 rows, but it cannot know if a baseline still needs an image.

The option with 0 writes is the one that the maintainer did not select: `keep-and-document`.

Also one-time: "Runs that are past the step need a release one time". That is one such release for each old run.

### 6.5 D-AUTH-05 `stop-and-clear` (one-time)

- The hook: a sign-in writes the same 14 rows. The `account` update of 1 row stays, with NULL in the token columns.
- The clear: 1 row for each GitHub account. Measured: 10 accounts, 10 rows. The second run of the same statement wrote 10 rows again, because an UPDATE that sets NULL to NULL still counts. With `AND (accessToken IS NOT NULL OR refreshToken IS NOT NULL OR ...)` the second run wrote 0 rows.
- An option that the record does not have: with no token to store, `updateAccountOnSignIn: false` (`packages/security/src/auth.ts:38`) would remove the `account` update from each sign-in: 13 rows in place of 14. Not measured.

## 7. The largest sources of D1 writes today

The order is an estimate. The rows for each event are measured. The number of events each day is not.

|   # | Source                         | Rows for each event (measured)                                                 | How often                                                       | Does the record reduce it?                                       |
| --: | ------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------- |
|   1 | Webhook receipts               | 4 for each delivery, 6 for `pull_request`                                      | 1,600 to 5,100 deliveries each day (estimate, see below)        | No. D-DATA-01 puts the 2 statements in one batch: the same rows. |
|   2 | Check updates after a decision | 11 for each active run and the baseline run                                    | each decision, or each group of decisions that one pass handles | No. D-OPS-01 row 3 stops the PATCH to GitHub, not the 11 rows.   |
|   3 | The decision                   | 22 for each command + 5 for each variant                                       | each decision                                                   | No. −3 with the removal of one old index (6.3).                  |
|   4 | Submit                         | 64 for each run + 2 for the capacity check + about 31 for each changed capture | 450 to 680 runs each month (record)                             | No. The six indexes add 5 (measured) and 1 (counted).            |
|   5 | The walk over old review links | 1 for each 25 pull requests, in each status wakeup                             | each decision and each cron pass with more work                 | Yes: D-OPS-01 rows 2 and 9.                                      |
|   6 | The capacity snapshot          | 1 for each cron pass                                                           | 288 each day                                                    | No. It can serve as the heartbeat (6.2).                         |
|   7 | Alerts that stay open          | 1 for each pass and each open alert                                            | each pass                                                       | Yes: D-OPS-01 row 6, in part.                                    |
|   8 | Sign-in                        | 14                                                                             | a few each week (sessions live 7 days)                          | Yes, a little: D-AUTH-01 (allow-list).                           |

Where the webhook estimate comes from: `docs/operations/compact-processed-webhooks.md:5` records 30,562 processed receipts in production on 2026-09-28. The first commit of the repository is from 2026-09-21, and the billing cycle of the evidence starts on 2026-09-09. So the count covers 6 to 19 days: 1,600 to 5,100 deliveries each day, or 6,400 to 20,000 rows each day. Production got a new database on 2026-10-04 (record, operations section), so the rate of today can differ. One read of `SELECT COUNT(*), MIN(received_at) FROM github_webhook_delivery` in production gives the fact.

The sum of these sources is below 1 million rows each month in this estimate. The one measured number of the account is higher: all databases without the five test databases wrote 6,891,264 rows in the 15 days to 2026-09-23 (section 2.5). That number includes preview and test databases and the code of September, so it is an upper bound for the service of that time, not a measure of today. Both numbers are far below the 50 million rows that the paid plan includes.

### Opportunities that are not in the record

1. **A receipt for an event with no handler in one statement.** `INSERT ... (processed_at) VALUES (...)` with an empty payload: 2 rows in place of 4 (measured, `results/proposals.txt`). The audit recommended it (finding API-10: "Every webhook delivery costs 6 D1 round trips and 4 row writes, including events with no handler"), and the fix list took only its batch. The maintainer must decide if such an event needs a receipt at all: the upstream recovery reads the receipts (`apps/web/src/operations/github-deliveries.ts:230`).
2. **No new check update when the result for a run is the same.** Today a decision on pull request A writes 11 rows for each other open pull request. The audit recommends a "verified at revision" marker (finding D1-05: "One review decision sends a new GitHub check update for every active run"): 1 row for a check that did not change, in place of 11. With 9 open pull requests, one decision then writes 27 + 11 + 9 = 47 rows, in place of 137. It needs a migration and a change in the rule for a stale update, which must never publish a wrong success. Not built and not measured.
3. **Remove two old indexes** (6.3): 3 rows fewer for each decision and 2 fewer for each `pull_request` receipt. Measured. The title index can go only with the title lookup.
4. **An admission check that only reads** (6.1): 2 rows fewer for each new run and 3 fewer for each refused Submit. The SELECT is measured, the change is not built.
5. **One command for many variants** (5.3): the fixed 22 rows, and the check updates, are paid one time. This is what the note of D-WORK-04 asks for.

## 8. Not checked

- No production number. The rates in section 7 are estimates from documents of the repository.
- The rows of the first Submit call, the Plan report, the check creation, the baseline promotion, and the closed summary were not measured in this lane.
- The rows of D-DATA-04 are counted from the code. The emulation of the storage lane ran on `node:sqlite`, which has no `rows_written`.
- How production counts the index entries of a DELETE is not in the pricing page. The local meter counted 1 row for each deleted table row.
- No fix of the record was built. Each "after" number is from the measured cost of the same statement today, or from a plain SQL statement in `probe/proposals.probe.ts`, `check/ddl.probe.ts`, or `check/index-gain.probe.ts`.
- The two rewrites of 6.3 were compared with the statements of today on synthetic data with 3 alerts that match. They did not run in the service code or in its tests.
- The statement "runs with a stale check status" reads 48,530 rows today and 43,509 with its index. The record has a rewrite of the filter for eligible runs in the same list. Nobody measured this statement with that rewrite.
- A decision that loses the race (D-OPS-03) and `updateAccountOnSignIn: false` were not run.

## 9. What the independent check changed

1. **The six indexes and a run.** The first report said "about 6 more rows for each run, counted". Measured now: 5 rows more in the materialization (64 against 59, and 83 against 78), and 1 more for the check row (counted).
2. **"Remove two indexes to pay for the six."** It does not pay for a run: with the six indexes and the two removals, a run still writes 5 rows more (measured). The recommendation changed: add no index, and rewrite two statements (0 rows written; 1,203,980 rows read become 6,581; measured).
3. **"Two indexes that no query uses."** Wrong for one of them. The dashboard uses `github_webhook_delivery_pr_title` for the title lookup, and a test checks that plan. It can go only with the lookup. The contract row about retired data (decision D14, "No destructive migration, row/table/object deletion") is a doubt for both removals.
4. **The title.** New option, measured: keep three fields of the payload. The same 6 rows as today, the lookup of today works, and no table.
5. **The alert for a dead decision.** The first report said that no smaller design keeps it in the Service view. A read of the dead tasks does: 0 rows written (measured).
6. **The inventory size alert.** `ON CONFLICT DO NOTHING` never opens a resolved alert again. A read of `inventory_bytes` writes 0 rows. A guarded upsert is measured: 0 rows while open, 1 row when it opens again.
7. **The capacity check.** It runs 2 times for a new run, not 1 time (counted). The Submit tests run with no capacity check, so the 64 rows do not include it.
8. **The heartbeat.** Two facts added: the API already sends the snapshot to the Service view, and the snapshot is not written when the size measurement fails.
9. **D-OPS-06.** The verdict changed from "fewer" to "the same": a row that gets no copy needs a decision by hand.
10. **D-DATA-04.** The count missed two DELETE statements of the same batch: about 25 to 55 rows, not about 25.
11. **The status pass.** The walk pages over pull requests, 25 for each step, not over review links. The 110 rows are 9 × 11 + 10 + 1.
12. **The total.** The estimate "below 1 million rows each month" now stands beside the one measured number of the account (6,891,264 rows in 15 days).
13. **One-time costs** of a migration are measured: `CREATE INDEX` 1 row for each row of the table, `ALTER TABLE ADD COLUMN` 1 row, `DROP INDEX` 0 rows, `ANALYZE` 38 rows.

Confirmed with no change: the prices and the definitions of Cloudflare, the 102 USD and its cause, the session renewal (1 row each 24 hours), the grant in Worker memory, the 14 rows of a sign-in, the 27 rows of a decision, the 64 and 95 rows of a Submit, the 1 row of a cron pass, the 3 rows of a refused try, the 4 and 6 rows of a webhook receipt, and the 10 rows of the token clear.

## 10. Files of this lane

- `notes.md`: this file.
- `table.json`: one line for each selected answer, and for each fix of a list that changes writes.
- `build-table.mjs`: writes `table.json` and checks that all 49 answers are in it.
- `sources/`: the three Cloudflare pages as Markdown.
- `probe/`: the probes and their Vitest configurations.
- `results/`: the output of the probes. `cron.txt`, `review.txt`, `submit.txt`, and `proposals.txt` are the readable forms.
- `results/review-runs1601-with-main-candidate.txt`: the first run of the review probe. In it, one main run with all rows approved made the promotion step claim and release a lease in each pass (4 rows for each pass). It is kept as evidence of that cost, not as the baseline.
- `check/`: the probes, the configurations, and the results of the independent check. `check/first-results/` is a copy of `results/` before the check ran the probes again.
- `selections.json`, `selected.jq`, `extract-lists.mjs`, `extract-tables.mjs`, `writes-by-case.jq`: small tools that read the record and the results of the d1 audit lane.
