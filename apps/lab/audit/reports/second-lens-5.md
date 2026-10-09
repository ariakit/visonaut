# Second-lens check: D1-05, D1-06, OPS-01, OPS-02

Lens: platform facts, real impact on the deployed production configuration, and fix feasibility.
The first verification already proved that the cited code exists. This document does not repeat that work.

Repository root: `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`. All paths below are relative to this root.
Scratch directory: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-5/`.
No repository file was changed. No write was sent to GitHub or Cloudflare.

## Result in one table

| ID     | Verdict   | Severity (report) | Severity (this lens) | Main reason for the severity                                                                                                                                                           |
| ------ | --------- | ----------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1-05  | confirmed | high              | medium               | Real scale today is about 6 eligible runs, not 30. The cost is 12 GitHub requests and 140 D1 calls for each project event. It is the multiplier for OPS-01 and the trigger for OPS-02. |
| D1-06  | confirmed | high              | low                  | One D1 round trip. 27 ms of local SQL time at 48,000 comparison rows. Production `/api/runs` already takes 0.9 to 2.0 s on a 5.5 MiB database, so this query is not the cause today.   |
| OPS-01 | confirmed | high              | high                 | GitHub API incidents with 9 % failed requests are on record. One failed read locks a required check. No code path and no tool clears the lock.                                         |
| OPS-02 | confirmed | high              | high                 | The loop starts on the next project event of any run. It never stops, and one more chain starts every 5 minutes. The one-line fix is verified as safe.                                 |

The four findings are one chain. D1-05 sends a read and a write for every active run after each project event. OPS-01 turns one failed read into a permanent lock. OPS-02 turns one lock plus the next project event into an endless loop.

## Method

- Code reading of the hot paths from the HTTP route or the cron trigger down to the SQL and the GitHub request.
- Three local measurements with repository code (commands and raw results below).
- Two read-only requests to the public GitHub API for the real scale of `ariakit/ariakit`.
- Official platform documentation, read on 2026-10-05 (URLs below).
- Production timings from the orchestrator's record `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/live-authenticated.md`. I did not measure production myself.

### Measurements that I ran

M-A. Real scale of the repository (public GitHub API, read-only):

```
$ gh api "repos/ariakit/ariakit/pulls?state=open&per_page=100" --jq 'length'
5
$ gh api "repos/ariakit/ariakit/actions/workflows/ci.yml/runs?per_page=1&created=2026-09-28..2026-10-04" --jq '.total_count'
296
```

Five open pull requests (one is a draft from January 2025). 296 runs of `ci.yml` in 7 days, about 42 each day.

M-B. The D1 lane harness with 5 active runs instead of 30 (native local D1, Miniflare 5.20260921.0-alpha, workerd 1.20260921.1). File `second-lens-5/scale.measure.ts` is a copy of `d1/harness/measure.test.ts` with two changed lines (`ACTIVE` from the environment, output path).

```
$ env AUDIT_RUNS=2001 AUDIT_DELIVERIES=10000 AUDIT_ACTIVE=5 node_modules/.bin/vitest run \
    --config /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/second-lens-5/vitest.config.mjs scale.measure.ts

parameters {"RUNS":2001,"ACTIVE":5,"ROWS":30,"BIG":800,"DELIVERIES":10000,"CUT":560}
case | d1Calls | batches | statements | sequentialDepth | rowsRead | rowsWritten | sqlMs | localWallMs
A idle queue: one 'status' wakeup followed until hasMore=false | 1987 | 0 | 1987 | 1987 | 2645371 | 114 | 400 | 19698.8 | 21 queue messages; GitHub requests {}
C after one decision queue: one 'status' wakeup followed until hasMore=false | 2127 | 12 | 2175 | 2071 | 2686947 | 180 | 441 | 21214.3 | 21 queue messages; GitHub requests {"GET /repos/ariakit/ariakit/check-runs/:id":6,"PATCH /repos/ariakit/ariakit/check-runs/:id":6}
C after a second decision queue: one 'status' wakeup followed until hasMore=false | 2127 | 12 | 2175 | 2071 | 2686976 | 180 | 390 | 21398.3 | 21 queue messages; GitHub requests {"GET /repos/ariakit/ariakit/check-runs/:id":6,"PATCH /repos/ariakit/ariakit/check-runs/:id":6}
```

I ran it two times. All counts were the same in both runs. Only the local times changed. Raw files: `second-lens-5/scale-results.txt`, `scale-results.json` (second run) and `scale-results.first-run.txt`.

M-C. Cross-run effects, send order, and the "not-sent" state machine (repository fixtures, `node:sqlite`). File `second-lens-5/ops.measure.ts`, raw result `second-lens-5/results-ops.json`.

```
$ node_modules/.bin/vitest run --config .../second-lens-5/vitest.config.mjs ops.measure.ts
 Test Files  1 passed (1)   Tests  3 passed (3)
```

M-D. The real `dashboard()` SQL against the same SQL with only the `CROSS JOIN` change (native local D1). File `second-lens-5/dashboard.measure.ts`, raw result `second-lens-5/results-dashboard.json`. The test captures the SQL text that `dashboard()` sends, so the comparison uses the real statement.

```
$ node_modules/.bin/vitest run --config .../second-lens-5/vitest.config.mjs dashboard.measure.ts
 Test Files  1 passed (1)   Tests  1 passed (1)
```

Limits of all local measurements: counts of calls, statements, rows, and GitHub requests do not depend on the machine. Local times are not production times.

### Platform facts (official documentation)

| Fact                                                                                                                                                                                                                                                                                                                                                                                                                             | Source                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Each individual D1 database is inherently single-threaded, and processes queries one at a time." Maximum SQL query duration: 30 seconds.                                                                                                                                                                                                                                                                                        | https://developers.cloudflare.com/d1/platform/limits/                                                                                                                                            |
| "Queries per Worker invocation (read subrequest limits): 1000 (Workers Paid)". The Workers page says for paid plans: "Subrequests to internal services: Matches configured limit (default 10,000)". The two pages do not agree. `apps/web/wrangler.jsonc:39-42` sets `subrequests: 250000`.                                                                                                                                      | https://developers.cloudflare.com/d1/platform/limits/ and https://developers.cloudflare.com/workers/platform/limits/                                                                             |
| D1 billing: rows read "First 25 billion / month included + $0.001 / million rows"; rows written "First 50 million / month included + $1.00 / million rows". No charge for each query.                                                                                                                                                                                                                                            | https://developers.cloudflare.com/d1/platform/pricing/                                                                                                                                           |
| Queues: `delaySeconds` up to 24 hours. Consumer wall time 15 minutes. "it takes 3 operations to deliver a message". "1,000,000 operations/month included + $0.40/million operations". At-least-once delivery. The delivery page does not promise an order.                                                                                                                                                                       | https://developers.cloudflare.com/queues/platform/limits/ , https://developers.cloudflare.com/queues/platform/pricing/ , https://developers.cloudflare.com/queues/reference/delivery-guarantees/ |
| Workers Paid: 10 million requests and 30 million CPU ms included each month, then $0.30 per million requests and $0.02 per million CPU ms.                                                                                                                                                                                                                                                                                       | https://developers.cloudflare.com/workers/platform/pricing/                                                                                                                                      |
| GitHub App installation token: "minimum rate limit of 5,000 requests per hour". Secondary limits: "No more than 100 concurrent requests", "No more than 900 points per minute are allowed for REST API endpoints", "no more than 80 content-generating requests per minute and no more than 500 content-generating requests per hour". Points: GET = 1, POST/PATCH/PUT/DELETE = 5. A limit error is "a `403` or `429` response". | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api                                                                                                                  |
| "If GitHub takes more than 10 seconds to process an API request, GitHub will terminate the request and you will receive a timeout response and a 'Server Error' message."                                                                                                                                                                                                                                                        | https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api                                                                                                                  |
| `GET /repos/{owner}/{repo}/check-runs/{id}` returns `name`, `head_sha`, `external_id`, `status`, `conclusion`, `details_url`, `output.title`, `output.summary`, `app.id`. `PATCH` on the same path: "OAuth apps and personal access tokens (classic) cannot use this endpoint."                                                                                                                                                  | https://docs.github.com/en/rest/checks/runs                                                                                                                                                      |
| "If a check run is in an incomplete state for more than 14 days, then the check run's `conclusion` becomes `stale`". "Only GitHub can mark check runs as `stale`."                                                                                                                                                                                                                                                               | https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks                                                                                                                |
| "GitHub Apps with write-level access for the 'Checks' permission are automatically subscribed to this webhook event" (`check_run`).                                                                                                                                                                                                                                                                                              | https://docs.github.com/en/webhooks/webhook-events-and-payloads#check_run                                                                                                                        |
| "The installation access token will expire after 1 hour."                                                                                                                                                                                                                                                                                                                                                                        | https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app                                                   |
| GitHub API incidents: "On June 10, 2026, between 15:05 and 16:25 UTC, GitHub API services experienced degraded availability due to sporadic authentication failures affecting approximately 9% of requests. Both REST and GraphQL API requests were affected." On August 17, 2026 (about 6 h 44 min): "At the peak, 56.07% of front-door requests to the affected services failed or ran slow at the edge."                      | https://github.blog/news-insights/company-news/github-availability-report-june-2026/ and https://github.blog/news-insights/company-news/github-availability-report-august-2026/                  |
| SQLite: "SQLite chooses to never reorder tables in a CROSS JOIN." `AS MATERIALIZED` is available "in SQLite version 3.35.0 (2021-03-12) and later".                                                                                                                                                                                                                                                                              | https://www.sqlite.org/optoverview.html and https://www.sqlite.org/lang_with.html                                                                                                                |

Facts that have no official number:

- Cloudflare does not publish a typical latency for one Worker-to-D1 round trip. Production gives an upper bound: `/api/operations` makes 9 sequential D1 calls (`d1/results.txt`: `B GET /api/operations | 9 | 1 | 83 | 9`) and its server wait was 1,204 to 1,299 ms in five samples (`live-authenticated.md`). That is at most about 134 to 144 ms for each sequential call on the HTTP path from the maintainer's location. Assumption: the wait is mostly D1 round trips. The queue consumer can run in a different location, so its round-trip time is not known. I use a range of 5 ms (assumption, Worker near D1) to 140 ms (bound from production) below, and I mark each result as an estimate.
- GitHub does not publish a typical latency for check-run requests. The hard bounds are 10 s on the GitHub side and 15 s in the client (`packages/security/src/github.ts:78`: `AbortSignal.timeout(15_000)`).
- No official latency exists for RSA signing in Workers. It is not on these paths for each request: the installation token is kept in a module-level cache for each isolate (`packages/security/src/github.ts:102`, `:166-173`) and GitHub tokens last 1 hour. Signing runs when an isolate has no valid token.

### Installed versions (checked in `node_modules` and `package.json`)

`wrangler` 4.136.1, `@cloudflare/workers-types` 5.20260922.1, `miniflare` 5.20260921.0-alpha, `workerd` 1.20260921.1, `jose` 6.2.12, `better-auth` 1.7.5, `vitest` 5.0.1. `QueueSendOptions.delaySeconds`, `QueueRetryOptions.delaySeconds`, and `D1Meta.rows_read` exist in the installed types (`apps/web/node_modules/@cloudflare/workers-types/index.d.ts:2421-2453`, `:14523-14526`). No option below needs an API that is not installed.

---

## D1-05 · One review decision sends a new GitHub check update for every active run

Verdict: **confirmed**. Severity: **medium** at the real scale (the report and the first verification say high).

### 1. Hot path on production

Each step is in the production configuration (`apps/web/wrangler.jsonc:46-122`: D1 `DB`, queue producer `OPERATIONS`, one consumer with `max_batch_size: 1`, `max_concurrency: 1`).

1. The review client saves each decision with `queued: true` (`apps/web/src/review/client.ts:313-317`).
2. `POST /api/comparisons/:id/commands` calls `wakeReviewStatus` (`apps/web/src/api/review.ts:876`, `:880`, `:938`), which sends `{ kind: "status" }` (`review.ts:661`).
3. The decision runs `touchRunStatusStatements` (`packages/service/src/review-commands.ts:301`). Statement 1 is `UPDATE visonaut_projects SET revision = revision + 1 WHERE id = ?` (`packages/service/src/status-touch.ts:11`).
4. The queue consumer runs `deliverGitHubStatuses` (`apps/web/src/operations/index.ts:49`, `:62`). Its selection takes each eligible run whose current intent has `stale.source_revision!=project.revision` (`apps/web/src/operations/checks.ts:206`).
5. Each selected run gets a new intent (`checks.ts:210-218`) and then one `GET` and one `PATCH` (`packages/security/src/checks.ts:173`, `:191`).

The trigger is wider than "a review decision". Every site that adds 1 to the project revision has the same effect:

| Event                                                                                                                                     | Site                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Approve or Reject (`applyReviewCommand`), Undo (`undoReviewCommand`)                                                                      | `packages/service/src/review-commands.ts:301`, `:451`                          |
| New run reserved (`reserveRun`)                                                                                                           | `packages/service/src/run-admission.ts:340`                                    |
| Run failed (`failRun`), run sealed (`sealRun`)                                                                                            | `run-admission.ts:728`, `:794`                                                 |
| Comparison created or finalized (`createSparseComparison`, `createLocalComparison`, `finalizeComparison`)                                 | `packages/service/src/local-comparison.ts:362`, `:545`, `:668`                 |
| Promotion cancelled or done (`cancelPreparedPromotion`, `promote`)                                                                        | `packages/service/src/baseline-promotion.ts:252`, `:504`                       |
| Run retired (`retireRun`, called for a closed or replaced pull request in `apps/web/src/api/webhooks.ts:316-318`), incomplete run expired | `packages/service/src/run-retirement.ts:63`, `:145`                            |
| Closed run compacted (`compactRunHistory`), snapshot retired (`retireSnapshot`), both in scheduled maintenance                            | `packages/service/src/history.ts:215`, `packages/service/src/retention.ts:117` |

Frequency: one fan-out for each status pass that sees a new project revision. Several events before one pass count once.

How many runs are "active": a pull request run stays `active=1` until the pull request closes or its merge commit is replaced (`apps/web/src/api/webhooks.ts:310-323`). The capacity limit `maximumActiveRuns: 5` does not cap this number. It counts only runs in `uploading` or `comparing` (`apps/web/src/capacity.ts:41`). So the number of eligible runs is about (open pull requests with a visual run) + (main runs in review) + 1 (the current baseline, `packages/service/src/review-status.ts:25-27`).

### 2. Magnitude

Measured (M-B, 5 active runs + the baseline = 6 eligible runs):

|                 | Idle sweep | After one decision | Difference                            |
| --------------- | ---------- | ------------------ | ------------------------------------- |
| D1 calls        | 1,987      | 2,127              | +140 (about 23 for each eligible run) |
| Rows written    | 114        | 180                | +66 (11 for each eligible run)        |
| GitHub requests | 0          | 6 GET + 6 PATCH    | +12                                   |

This agrees with the report's numbers for 30 active runs (+740 D1 calls, 31 + 31 requests). The cost is linear in the number of eligible runs.

Measured (M-C, `results-ops.json`, key `crossRunResend`): two pull request runs A and B. Only run B gets the four statements of `touchRunStatusStatements`. The next pass sends run A again with the same conclusion:

```json
"secondPass": { "completed": ["1", "2"], "hasMore": true,
  "github": { "GET check 1": 1, "GET check 2": 1, "PATCH check 1": 1, "PATCH check 2": 1 } }
```

Real scale today (M-A): 5 open pull requests. So N is about 6, not 30.

| Quantity                                             | N = 6 (today) | N = 31 (report) | Limit                                                                                      |
| ---------------------------------------------------- | ------------- | --------------- | ------------------------------------------------------------------------------------------ |
| GitHub requests for each event pass                  | 12            | 62              | 5,000 each hour (primary)                                                                  |
| GitHub points for each event pass (GET 1, PATCH 5)   | 36            | 186             | 900 each minute (secondary)                                                                |
| Event passes each minute that reach the points limit | 25            | 4.8             | The consumer is serial, so 25 is not reachable. 4.8 is reachable in a fast review session. |
| Extra D1 calls for each event pass                   | 140           | 740             | 250,000 configured (or 1,000 if the D1 page is the valid one)                              |

Not verified: if a check-run `PATCH` is a "content-generating request" (80 each minute, 500 each hour). GitHub does not define the term for each endpoint.

Time (estimate, not measured). In one pass the code prepares all selected runs one after the other, about 10 D1 calls each (`checks.ts:210-218`, `packages/service/src/run-status.ts:92-141`). Only then it sends, 3 at a time (`checks.ts:26`). For N = 6 that is about 60 sequential D1 calls before the first `PATCH`. With the round-trip range above (5 to 140 ms) the fan-out adds about 0.3 to 8 s before any check update. Without the fan-out the decided run needs about 10 calls (0.05 to 1.4 s).

Effect that a maintainer can see: the reviewed run is served last. The selection is `ORDER BY run.created_at,run.id LIMIT ?` (`checks.ts:207`) and the send order is `ORDER BY outbox.available_at, checks.id` (`packages/service/src/work.ts:661`). The run that a maintainer just approved is usually one of the newest runs.

Measured (M-C, `decidedRunIsSentLast`): five runs, `run1` is the oldest, and the status touch is on `run5`:

```json
"githubRequestOrder": ["GET run1", "GET run2", "GET run3", "PATCH run1", "PATCH run2", "PATCH run3",
                       "GET run4", "GET run5", "PATCH run4", "PATCH run5"]
```

From the code, not measured: with more than 25 eligible runs, the `LIMIT` moves the newest runs to the second pass.

Daily volume (estimate): there are about 42 CI runs each day. Each visual run makes several project events (reserve, comparison, seal), and events that arrive before one pass count once. The order of magnitude is 50 to 300 event passes each day. At N = 6 that is 600 to 3,600 GitHub requests each day. This is far below the hourly limit.

### 3. Fix feasibility

Report recommendation (move `source_revision` forward on the existing intent):

- Correct that the trigger blocks it (`apps/web/migrations/0002_work.sql:48-53`). A new migration can drop and create the trigger. D1 supports this. Applied migrations stay unchanged, as the contract requires (`docs/current-contract.md:126`).
- It removes the GitHub requests and the new outbox row. It does not remove the selection and the status computation (about 10 D1 calls for each run and event).
- It changes what an outbox row means. Today an intent is immutable. The trigger text is "Status revision conflicts with stored intent".

Report alternative "skip when the previous complete intent is the same":

- Feasible. The proof of equality is the database, not GitHub.
- Six other code sites `PATCH` the same check IDs directly: `apps/web/src/api/pre-run-attempts.ts:110`, `:646`, `:1019`, `apps/web/src/api/pre-run-plan.ts:178`, `apps/web/src/api/pre-run-checks.ts:118`, `:351`. The sites that I read move `pre_run_checks.state` away from `active`, and the outbox selection then excludes the check (`apps/web/src/operations/check-state.ts:3-8`). `pre-run-attempts.ts:1019-1033` writes to GitHub first and to D1 second. A crash between the two leaves GitHub and D1 different.
- Today's repeated `PATCH` corrects such a difference at the next event. This alternative removes that correction.

A third option that this lens adds: compare with the `GET` response that `sendGitHubCheck` already has.

```ts
// packages/security/src/checks.ts, after `const output = genericCheckOutput(intent.conclusion, href);`
const status = intent.conclusion === "pending" ? "in_progress" : "completed";
const current =
  existing.output && typeof existing.output === "object" ? record(existing.output) : {};
const same =
  existing.name === CHECK_NAME &&
  existing.details_url === href &&
  existing.status === status &&
  (status === "in_progress" || existing.conclusion === intent.conclusion) &&
  current.title === output.title &&
  current.summary === output.summary;
if (!(await isCurrent())) return "not-sent";
if (same) return; // GitHub already shows this intent. Nothing to write.
```

- The fields are in the documented `GET` response (table above).
- The repository already uses this pattern: `apps/web/src/api/pre-run-checks.ts:322-331` computes `alreadyRetired` from `status`, `conclusion`, `output.title`, and `details_url`, and skips the `PATCH`.
- Cost for an unchanged run goes from 6 points (GET + PATCH) to 1 point (GET). No write request means no ambiguous write for that run.
- The proof is GitHub's own answer, so the correction of differences stays.
- If GitHub changes a field (for example it rewrites `details_url`), `same` is false and the code does what it does today. The failure mode is safe.
- It does not reduce D1 calls. It does not refresh `completed_at`. The report already asks the maintainer if a refresh is necessary.

Removing the D1 fan-out needs a narrower stale test. Facts for that decision:

- The saved requirement says: "Publish external status through an outbox that rereads current run, attempt, and comparison revisions" (`docs/simplification-audit/contract-issue-1.md:328`). It does not name a project revision.
- A pull request status does not read the project baseline (`packages/service/src/review-status.ts:84`: `run.kind !== "pull_request"`).
- The send-time fence does use the project revision: `project.revision = ?` in `isStatusIntentCurrent` (`packages/service/src/run-status.ts:148`). A change here is a change to the rule "refuse delayed success after rejection, Undo, supersession, or changed source acceptance" and needs the race tests that the same paragraph requires.

What can go wrong with any dedupe: M-C shows that a `dead` intent comes back only because the next project event makes a new intent for every run (`notSentStateMachine.passAfterNextProjectRevision`: `"completed": ["1"]`). A dedupe that compares with the current intent, and not with the last delivered state, would leave a `dead` intent dead.

Security contract effect: none for the third option (same lock, same fences, fewer writes). The other options change stored intent semantics or the fence, and need a maintainer decision.

### 4. Strongest counter-argument

At today's scale the fan-out is 12 GitHub requests and 140 D1 calls for each event. Both are far below every documented limit, and the cost is cents. The repeated `PATCH` also has a use: it makes GitHub agree with D1 again after any difference, and it revives `dead` intents. One project-wide clock is easy to reason about in the path that must never publish a wrong success. A narrower rule adds risk to that path for a small gain today.

Why I still rate it medium and not low: it multiplies the exposure to OPS-01 by N (each event makes N reads under the lock), it is the trigger of OPS-02, and it delays the check update that the maintainer waits for after a decision.

---

## D1-06 · The dashboard history query reads every comparison row in the database

Verdict: **confirmed**. Severity: **low** today (the report says high, the first verification says medium).

### 1. Hot path on production

`GET /api/runs` calls `dashboard(context)` (`apps/web/src/api/review.ts:732-734`). The dashboard page calls it once for each mount and once for each click on Refresh (`apps/web/src/routes/index.tsx:176-210`, `:242-245`). There is no polling timer in that file. The query is one `batch` with three statements (`apps/web/src/api/dashboard.ts:68-81`), so it is one D1 round trip for each page load.

### 2. Magnitude

Measured (M-D, real SQL text from `dashboard()`, 12 changed rows for each run, 6 active runs):

| Runs  | Comparison rows | History statement: rows read, current | With `CROSS JOIN` | Local SQL ms (median of 5), current → `CROSS JOIN` | Same result |
| ----- | --------------- | ------------------------------------- | ----------------- | -------------------------------------------------- | ----------- |
| 500   | 6,000           | 16,177                                | 5,489             | 5 → 4                                              | yes         |
| 2,000 | 24,000          | 55,177                                | 8,489             | 14 → 9                                             | yes         |
| 4,000 | 48,000          | 107,177                               | 12,489            | 27 → 19                                            | yes         |

The "actionable" statement of the same batch did not change with `CROSS JOIN`: 1,305, 4,305, and 8,305 rows read in both variants. It reads all runs of the project.

What this means:

- Rows read are about 2.2 x (all comparison rows). This agrees with the first verification.
- The time is small. 107,177 rows read took 27 ms of local SQL time. The `CROSS JOIN` change saved 8 ms at that size.
- Cost: 1,000 dashboard loads each day at 107,177 rows are 3.2 billion rows each month. The plan includes 25 billion.
- Production today: "Database: 5.5 MiB used" and `/api/runs` has a server wait of 865 to 1,967 ms (`live-authenticated.md`). The table is almost empty, so this statement is not a measurable part of that wait. The wait comes from the round trips before the batch (D1-01, D1-02).

A fact that bounds the growth: D1 holds only changed rows. `docs/current-contract.md:26`: "D1 keeps run and snapshot pointers, changed capture and comparison rows, decisions, and image ownership pins." The trusted Submit path inserts rows with the literal outcome `'changed'` (`packages/service/src/local-comparison.ts:325-327`). So the table grows with changed screenshots, not with the size of the capture inventory. Closed runs keep these rows (`apps/web/src/operations/closed-summary.ts:315-320`), so the growth has no end.

Unknown: the real number of changed rows for each run. It can be zero and it can be thousands (the orchestrator saw runs with 3,832 variants on a run page). With at most 42 CI runs each day (M-A), 4,000 runs need about 3 months or more.

### 3. Fix feasibility

- `CROSS JOIN` keeps the written join order. This is documented SQLite behavior (table above).
- Verified on native local D1: the rewritten statement returns byte-identical JSON for both `readRuns` statements at three sizes (M-D, `"sameResult": true` six times). The replaced text is:

  ```sql
  -- current (apps/web/src/api/dashboard.ts:40-41)
  FROM visonaut_comparison_rows row
  JOIN selected_runs selected ON selected.comparison_id=row.comparison_id
  -- changed
  FROM selected_runs selected CROSS JOIN visonaut_comparison_rows row ON row.comparison_id=selected.comparison_id
  ```

- `AS MATERIALIZED` is accepted by local D1 (M-D, `syntaxProbes.asMaterialized.ok: true`). `SELECT sqlite_version()` is not allowed on D1 ("not authorized to use function: sqlite_version"), so the version cannot be read. The syntax probe is the proof.
- I measured only the minimal `CROSS JOIN` change. I did not measure the report's full recommendation (`AS MATERIALIZED` plus a column list). The column list in the report has all columns that the outer query reads (`dashboard.ts:45-63`: `id`, `kind`, `tested_sha`, `state`, `attempt`, `created_at`, `comparison_id`, `active`, `sealed_at`, `lineage_key`, `project_id`).
- `readRuns` builds both statements from one SQL template (`dashboard.ts:33-67`), so each change applies to both. `AS MATERIALIZED` on the "actionable" statement stops flattening there. Check that plan before use.
- The index `visonaut_runs(project_id, created_at DESC)` is a new additive migration. No applied migration changes.
- Correction to the report's third alternative: the first verification already showed that `ANALYZE` does not change this plan.

What can go wrong: a wrong column list breaks the query at run time, and the existing tests in `apps/web/src/api/dashboard.test.ts` would catch that. Security contract effect: none. The response is the same.

### 4. Strongest counter-argument

This is an optimization for a table that is almost empty in a database that is 1 or 2 days old. The query is one round trip, and its time is tens of milliseconds at sizes that need months to reach. The slow dashboard that the maintainer sees has other causes. The answer to the counter-argument is only that the minimal change is one join keyword with a verified identical result.

---

## OPS-01 · A failed GitHub read marks a check "ambiguous" forever

Verdict: **confirmed**. Severity: **high**.

### 1. Hot path on production

Every check delivery takes this path (`apps/web/src/operations/checks.ts:297-319`):

1. `deliverStatus` sets `request_started = 1` (`packages/service/src/work.ts:491-498`).
2. `sendGitHubCheck` reads the check (`packages/security/src/checks.ts:173`).
3. Any error before or during the `PATCH` goes to the same `catch`, which sets `ambiguous = 1` (`work.ts:538-548`).

The GitHub client turns every response that is not 2xx, every network error, and the 15-second timeout into one error class (`packages/security/src/github.ts:73-94`). So these events, all before the `PATCH`, lock the check:

- A 5xx or a timeout on the `GET`.
- A `403` or `429` on the `GET`. GitHub uses these codes for primary and secondary rate limits (table above). The D1-05 fan-out makes these more probable at higher scale.
- A failed installation-token request. The client is created on first use (`apps/web/src/runtime.ts:163-171`), so the error comes out of the same `request` call. The first verification measured 5 of 5 checks locked.
- An identity mismatch (`checks.ts:176-187`). This is the production case in `docs/evidence/diagnostic-check-rename-repair.md:5-7`.
- An invalid review link (`checks.ts:188`, `reviewUrl`).

Nothing clears the lock. `settleStatus` is the only statement with `ambiguous = 0` (`work.ts:598`). Its callers are `deliverStatus` and the abandoned-lease path, which needs `request_started = 0` (`work.ts:635-652`). `apps/web/tooling` has no check repair tool (it has `backup-v2-recorded`, `baseline-delta-cost`, `baseline-reset`, `queue-recovery`, `review-scale`).

Frequency: each delivery is one chance. With D1-05, each project event makes one delivery for each eligible run.

### 2. Magnitude

Measured (M-C, `crossRunAmbiguousLoop.failedReadPass` and `afterFailure`): the read of check 1 (run A) fails once, in a pass that an event of run B caused.

```json
"failedReadPass": { "attention": ["1"], "completed": ["2"], "github": { "GET check 1": 1, "GET check 2": 1, "PATCH check 2": 1 } },
"senders": [ { "id": "1", "desired_revision": 4, "delivered_revision": 3, "ambiguous": 1, "request_started": 1, "leased": 1 }, ... ]
```

No `PATCH` was sent for check 1. The check is locked.

Probability (estimate from official incident data): during the June 10, 2026 incident about 9 % of API requests failed for 80 minutes. If failures are independent, a pass that reads 6 checks locks at least one with probability 1 − 0.91^6 = 43 %. With 31 checks it is 95 %. GitHub's reports list more than one API incident in 2026. So the expected rate is a few lock events each year, each with one or more locked checks. This is an estimate, not a measurement.

Consequences of one lock (from the code):

- The required `Visonaut` check of that commit keeps its old state. A later approval does not reach GitHub.
- A rerun of the same commit gets `503 check_pending` (`apps/web/src/api/pre-run-attempts.ts:83-102`, `:636-643`). A new commit gets a new check (first verification).
- The alert `check-delivery:<id>:ambiguous` stays open. The lock is never "obsolete" because `obsoleteCheckDeliverySql` needs `sender.ambiguous=0` (`apps/web/src/operations/check-state.ts:12-13`).
- The next project event starts OPS-02.

### 3. Fix feasibility

The sender contract already has the result that the fix needs: `send` returns `void | "not-sent"` (`work.ts:467`), and `deliverStatus` settles it without a lock (`work.ts:528-536`). No new platform API is necessary.

Measured (M-C, `notSentStateMachine`): I called the real `claimStatus` and `deliverStatus` with a sender that returns `"not-sent"`, one time each second, with the production value `maxAttempts: 5`.

```json
"steps": [
  { "attempt": 1, "outcome": "stale", "state": "pending", "attempts": 1, "availableNow": true },
  ...
  { "attempt": 5, "outcome": "stale", "state": "dead", "attempts": 5, "availableNow": true },
  { "attempt": 6, "claimed": false, ... } ],
"healthyPassesWithoutNewRevision": [ { "attention": ["1"], "completed": [], "hasMore": false, "github": {} }, ... ],
"passAfterNextProjectRevision": { "completed": ["1"], "github": { "GET check 1": 1, "PATCH check 1": 1 } }
```

Results:

1. The mechanism works. A "not-sent" result leaves no lock.
2. As written, it is not enough. `settleStatus` sets `available_at` to the present time (`work.ts:581`), and a `deferred` outcome asks for a continuation after 1 second (`checks.ts:347-349`, `runtime.ts:454`). A GitHub fault of 5 seconds uses all 5 attempts, and the intent is `dead`.
3. A `dead` intent stays dead while GitHub is healthy. It comes back only when the project revision changes. Today that is the next event of any run, because of D1-05.

So the fix needs three parts:

```ts
// 1. packages/security/src/checks.ts: only the read phase. The PATCH stays outside.
let existing: Record<string, unknown>;
try {
  existing = record(await github.request(path));
} catch (error) {
  return "not-sent"; // No write request exists. Keep the cause, for example in last_error.
}
```

```ts
// 2. packages/service/src/work.ts, settleStatus: `available_at = ?` binds params.now today (work.ts:581, :588).
//    For a failed read, bind a later time. The delay must not apply to the other "not-sent" cases.
const retryAt = now + Math.min(15 * 60_000, 30_000 * 2 ** intent.attempts);
```

```ts
// 3. apps/web/src/operations/checks.ts: a deferred item with a future available_at is not "more work now".
//    The 5-minute cron pass sends it when its time comes.
```

The same change is necessary in the legacy sender (`apps/web/src/operations/review-links.ts:346-359`), as the first verification says.

What the fix does not cover: an invocation that stops between `request_started = 1` and the `PATCH` (CPU limit, eviction, deploy). The lease then ends with `request_started = 1`, and `reconcileStatus` sets `ambiguous = 1` (`work.ts:626-634`). To cover this, the write permit must move to the last statement before the `PATCH`. The creation path already works this way (`checks.ts:150-159` sets `request_started=1` only for the `POST`). For status delivery, `isStatusCurrent` (`work.ts:475-484`) is the statement that runs "immediately before PATCH". It can become an `UPDATE ... SET write_started = 1 ... RETURNING id` with the same conditions. This is a larger change, because `isStatusCurrent` requires `request_started = 1` today (`work.ts:479`).

A platform fact for the cases that stay ambiguous (a `PATCH` that got no answer): GitHub ends a request after 10 seconds, the client aborts after 15 seconds, and the lease is 12 minutes (`apps/web/src/runtime-defaults.ts:23`). After the lease ends, an old request cannot still write. A read of the check after that time, followed by "settle as delivered" or "settle as not-sent", is then a decision about accepted risk, not a platform limit. The code comment says a read alone is not proof (`work.ts:569-572`). The saved requirement says "reconcile ambiguous failures" (`docs/simplification-audit/contract-issue-1.md:328`). For check creation the code does reconcile (`checks.ts:107-123`). For status delivery it does not.

Security contract effect:

- "An outage must not manufacture a passing result" (`contract-issue-1.md:330`): kept. A failed read sends nothing.
- "refuse delayed success after rejection, Undo, supersession, or changed source acceptance": kept. The `PATCH` still passes all three `isCurrent` checks (`checks.ts:314-317`).
- The lock for a failed or unanswered `PATCH` stays as it is.
- Risk to avoid: a `try` block that also covers the `PATCH`. Then a real ambiguous write becomes "not-sent".

### 4. Strongest counter-argument

The lock is fail-closed on purpose. The header of `deliverStatus` says: "A failed or interrupted request retains its lock until proven settled." One simple rule (every error locks) is easier to audit than a rule that separates read errors from write errors. A lock needs a human, and that is a conservative choice for a required check. A new commit also gets a new check.

Why this does not hold: a failed `GET` in the same invocation is itself the proof that no write request exists. The lock then protects nothing. It costs a manual D1 repair with no tool, and it blocks reruns of the same commit.

---

## OPS-02 · An ambiguous check with a newer status starts an endless status loop, and each cron tick adds one more loop

Verdict: **confirmed**. Severity: **high**.

### 1. Hot path on production

Precondition: one check with `ambiguous = 1`. OPS-01 makes it. A real unanswered `PATCH` also makes it, and that case is correct by design.

Trigger: any later change of the project revision while the run is still eligible. It does not need a status change of the same run. The selection in `checks.ts:206` takes the locked run because its intent is stale. `prepareStatusIntent` then moves `desired_revision` and inserts a new `pending` row (`packages/service/src/work.ts:403-433`). The attention query returns the check with `ambiguous = 1` and `state = 'pending'` (`work.ts:673-691`). `checks.ts:258-266` returns `"attention"`, and `checks.ts:347-349` counts it as more work. `runtime.ts:454` sends the message again after 1 second. Each `recovery` pass also sends a new `status` message (`runtime.ts:446-453`, cron `*/5 * * * *` in `wrangler.jsonc:109-111`).

Measured (M-C, `crossRunAmbiguousLoop`): check 1 of run A is locked. Then only run B gets one more status touch. Four `status` passes follow:

```json
{ "checksHasMore": true, "checksAttention": ["1"], "checksCompleted": ["2"], "passHasMore": true, "github": { "GET check 2": 1, "PATCH check 2": 1 } },
{ "checksHasMore": true, "checksAttention": ["1"], "checksCompleted": [], "passHasMore": true, "github": {} },
{ "checksHasMore": true, "checksAttention": ["1"], "checksCompleted": [], "passHasMore": true, "github": {} },
{ "checksHasMore": true, "checksAttention": ["1"], "checksCompleted": [], "passHasMore": true, "github": {} }
```

Outbox of check 1 at the end: revision 4 `sending`, revision 5 `pending` with `attempts: 0`. The loop has no exit.

The report's own measurement used a bare `UPDATE visonaut_projects SET revision=revision+1` as the "newer status" (`operations/verify/alerts.measure.ts`). So the title is too narrow: any project event starts the loop.

Production record: `docs/evidence/diagnostic-check-rename-repair.md:7` describes this exact state for about 8.6 hours (21:38 UTC to 06:14 UTC): locks at revision 47 and "Five active runs wanted revision 243 (four `pending`, one `failure`)". I did not verify that the loop code was the same on that date.

### 2. Magnitude

Measured by the report and repeated by the first verification: 33 D1 round trips for each loop pass on an empty database, and queue depth 1, 2, 3, 4, 5, 6 after six cron ticks. With the larger synthetic database of M-B, one idle `status` pass is about 95 D1 calls and 126,000 rows read (1,987 calls and 2,645,371 rows in 21 passes).

Estimates (arithmetic on these counts, not measurements). After the first cron ticks there are enough chains to keep the single consumer busy all the time. Assume 0.5 to 5 s for one pass.

| Quantity                                                                                        | Estimate                                                                                                    |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Loop passes each day                                                                            | 17,000 to 173,000                                                                                           |
| D1 round trips each day (33 for each pass)                                                      | 0.6 to 5.7 million                                                                                          |
| Queue operations each month (3 for each message)                                                | 1.5 to 15.6 million, about $0.2 to $5.8 after the included 1 million                                        |
| Worker requests each month                                                                      | 0.5 to 5.2 million, inside the included 10 million                                                          |
| D1 rows read each day, almost empty database                                                    | Small. Inside the included 25 billion each month.                                                           |
| D1 rows read each day, database of the M-B size (126,000 for each pass, same pass time assumed) | 2.2 to 21.8 billion. The included 25 billion are used in 1 to 12 days. After that about $2 to $22 each day. |

The cost is not the main effect. The main effect is delay for real work:

- One consumer handles one message at a time (`wrangler.jsonc:98-106`).
- The number of loop messages N grows by 1 for each cron tick, so by 288 each day.
- A real message (`ingest` after a trusted Submit, `status` after a decision) waits behind about N passes. Assumption: delivery is about in arrival order. Cloudflare does not promise an order.
- After one day: 288 x (0.5 to 5 s) = 2.4 to 24 minutes of extra wait. After one week: 17 minutes to 2.8 hours.

The 15-minute consumer limit and the `max_retries: 5` setting do not stop the loop. Each pass ends well and acknowledges its message.

### 3. Fix feasibility

The one-line change in the report is correct:

```ts
// apps/web/src/operations/checks.ts
report.hasMore =
  (updates.results?.length ?? 0) === budget.tasksPerStep ||
  outcomes.some((outcome) => outcome === "completed" || outcome === "deferred");
```

Checks that I made:

- `attention` no longer asks for a continuation. Nothing is lost: an `ambiguous` or `dead` check cannot change in the next second, and the cron pass looks at it again every 5 minutes.
- `deferred` cannot loop without end. M-C shows that each claim adds one attempt and the fifth "not-sent" ends as `dead`. Then the outcome is `attention`.
- `completed` still asks for one more pass. M-C shows this today: a pass that only delivers reports `"hasMore": true` (`crossRunResend.secondPass`). So each event costs one extra idle `status` pass. A tighter rule is "the ready page was full". `reconcileStatus` returns ready and attention rows in one array (`work.ts:692`), so this needs a small change of its return value.

The hop bound in the report needs the decoder change that the first verification describes. I checked deploy safety: `operationsMessage` builds a new object and drops unknown fields (`packages/service/src/work.ts:8-28`). An old consumer that gets a message with `hop` reads a valid `status` message. A new consumer that gets an old message reads `hop` as 0. Both directions are safe.

Platform options that exist in the installed version: `delaySeconds` up to 24 hours on `send` (`QueueSendOptions`), so a pass without progress can use a longer delay. Queues has no deduplication of messages, so "one chain only" needs a marker in D1 (the report's third alternative).

Security contract effect: none. The change only decides when a pass asks for another pass. The lock, the fences, and the alert stay the same. The 5-minute cron still visits each attention check.

What can go wrong: a wrong `hasMore = false` delays work by at most one cron interval (5 minutes). A wrong `hasMore = true` is today's failure. The first error is cheaper.

### 4. Strongest counter-argument

The loop needs a locked check, and a locked check already raises an alert that a maintainer must act on. If OPS-01 is fixed, read failures no longer make locks, so the precondition becomes rare. On a new database each loop pass is cheap.

Why this does not hold: a real unanswered `PATCH` still makes a lock, and that lock is correct. No repair tool exists, so the lock can stay for hours (8.6 hours in the production record). During that time the next event of any pull request starts the loop, and the backlog grows by 288 messages each day until a manual repair.

---

## Items that this lens adds

1. **One chain, one order of work.** D1-05 multiplies the reads under the lock, OPS-01 turns a failed read into a lock, and OPS-02 turns a lock plus any event into a loop (all three measured in M-C). The OPS-02 change is independent and removes the unbounded part first.
2. **A rate-limit answer on the read also locks the check.** `packages/security/src/github.ts:84-87` maps `403` and `429` to the same error as a 5xx. From the code, not measured.
3. **The reviewed run is sent last.** `ORDER BY run.created_at,run.id LIMIT ?` (`checks.ts:207`) prepares the oldest runs first. Measured in M-C for five runs. With more than 25 eligible runs the newest runs wait for a second pass (from the code, not measured).
4. **Each delivering pass asks for one more pass.** Measured in M-C (`"hasMore": true` after a pass with only completed deliveries).
5. **The "not-sent" fix needs a retry delay, and `dead` intents depend on D1-05 to come back.** Measured in M-C. A D1-05 dedupe must compare with the last delivered state.
6. **The saved requirement asks to "reconcile ambiguous failures"** (`docs/simplification-audit/contract-issue-1.md:328`). Status delivery has no reconcile step. Check creation has one (`checks.ts:107-123`).
7. **The two Cloudflare pages state different D1 query limits for one invocation** (1,000 on the D1 page, the configured subrequest limit on the Workers page). A `status` pass with 25 selected runs makes about 775 D1 calls (report measurement), so the lower number is close.
8. **`maximumActiveRuns: 5` does not limit the fan-out.** It counts runs in `uploading` or `comparing` only (`apps/web/src/capacity.ts:41`).

## Not verified

- Production latency of one D1 round trip in the queue consumer, and the location of the D1 primary.
- If a check-run `PATCH` counts as a "content-generating request" at GitHub.
- If GitHub sends a `check_run` webhook to the App for each repeated `PATCH`. If it does, each repeated update also adds one webhook receipt row (`apps/web/src/api/webhooks.ts:225-251`, `:330-335`).
- The real number of changed comparison rows for each run in production.
- If the OPS-02 loop ran during the production incident of 2026-09-22.
- The report's full D1-06 rewrite (`AS MATERIALIZED` plus column list). I measured only the `CROSS JOIN` change.
