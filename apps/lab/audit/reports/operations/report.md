# Scheduled operations, queue, alerts, and recovery

Scope: `apps/web/src/runtime.ts`, `apps/web/src/operations/*`, `apps/web/src/capacity.ts`, the `scheduled` and `queue` handlers in `apps/web/src/server.ts`, and the queue and cron settings in `apps/web/wrangler.jsonc`. All paths below are relative to the repository root. Paths that start with `operations/`, `api/`, or `components/` are in `apps/web/src/`.

Method: source reading, plus local measurements. The measurements run the real repository code against the real migrations through the repository test fixtures (`node:sqlite`). They are not D1 measurements. Statement counts, round-trip counts, and scan-step counts do not depend on the engine. Local times are not D1 times. They are given only to show the growth shape.

This audit changed no repository file. `git status` shows `M pnpm-lock.yaml` and `?? apps/lab/`. These come from another lane of this workflow, not from this audit.

## How it works (map)

### Triggers and messages

| Trigger                                           | Where                                                                                            | Message                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Cron, every 5 minutes                             | `apps/web/wrangler.jsonc:109-111` (`"crons": ["*/5 * * * *"]`), `apps/web/src/server.ts:129-139` | `{ kind: "recovery" }`                                                                |
| A review decision is admitted                     | `api/review.ts:641-667`                                                                          | `{ kind: "status" }`, after an inline `processReviewQueue` for that command           |
| A comparison becomes ready                        | `api/ingest.ts:59-73`                                                                            | `{ kind: "status", comparisonId }`                                                    |
| Trusted Submit, or the Submit `check_run` webhook | `api/workflow-owned.ts:1279`, `api/webhooks.ts:246-250`                                          | `{ kind: "ingest" }`                                                                  |
| A pass reports more work                          | `apps/web/src/runtime.ts:432-454`                                                                | `ingest`, `status`, or `{ kind: "maintenance", family }`, each with `delaySeconds: 1` |

The message type is in `packages/service/src/work.ts:1-28`. It also decodes the old `{ kind: "continue" }` shape as `recovery`.

The cron handler only publishes. The queue consumer does all work. Consumer settings (`apps/web/wrangler.jsonc:98-107`): `max_batch_size: 1`, `max_batch_timeout: 1`, `max_concurrency: 1`, `max_retries: 5`, `dead_letter_queue: "visonaut-production-dead-letter"`. Worker limits (`apps/web/wrangler.jsonc:39-42`): `cpu_ms: 240000`, `subrequests: 250000`. Preview has no cron, queue, D1, or R2. Both handlers return early in preview (`server.ts:130`, `server.ts:141-146`, `runtime.ts:311-312`).

Queue handler (`server.ts:140-168`): an invalid body is logged and acknowledged. A valid message runs `runScheduledOperations(env, parsed)` and is acknowledged. If the pass throws, the handler calls `reportSchedulerFailure(env)` and `message.retry({ delaySeconds: 60 })`.

### One `recovery` pass (numbered walk-through)

`runScheduledOperations` is `apps/web/src/runtime.ts:307-457`. The idle counts are measured (see Measurements, M1 and M2). "RT" is a D1 round trip. A batch is one round trip.

1. `assertOperationsProject` (`runtime.ts:184-197`). 1 RT.
2. `monitorDatabaseCapacity` (`capacity.ts:33-89`). 3 RT: count active runs and read `meta.size_after`, write the `database-capacity` cursor, resolve the capacity alert. A failure is caught (`runtime.ts:319-330`).
3. `recoverGitHubDeliveries` (`operations/github-deliveries.ts:137-295`). It signs an App JWT. `GET /app/hook/config`. `GET /app/hook/deliveries?per_page=100&cursor=…`. Then 3 statements for each listed delivery. 3 RT + 3 × deliveries. 2 GitHub requests, plus 1 `POST …/attempts` for each redelivery (at most `tasksPerStep` = 25).
4. Four reconcilers in a loop (`runtime.ts:367-411`): `reconcileWebhooks` (1 RT), `retireUnpinnedMainChecks` (1 RT), `reconcileEquivalentPullRequestChecks` (1 RT), `reconcileStagedWorkflows` (3 RT). After each one, 1 alert write (resolve or record).
5. `expireStagedAttempts` (`api/workflow-retention.ts:109-291`). 2 RT, plus 1 alert write.
6. `runOperations` (`operations/index.ts:24-112`):
   - Pre-steps, not isolated: `retireReplacedMainRuns` (1 RT), `Service.reconcileComparisons` (2 RT, 8 statements; it starts with `expireHistoricalPreparations`), `reportComparisonRecovery` (6 RT).
   - Ten isolated steps. Each one is followed by `resolveEvents(name, "scheduler")`: `review-decisions` (1 RT), `checks` (15 RT), `review-links` (4 RT), `promotion` (6 RT), `history` (3 RT), `reference-retention` (3 RT), `source-retention` (3 RT), `snapshot-retention` (3 RT), `retention` (1 RT), `profile-retention` (2 RT).
   - `expireExports` (1 RT), then the `operations_pass` log line.
7. Continuations (`runtime.ts:432-454`): `ingest` if staged work remains; one `maintenance` message for each family with `hasMore`; one `status` message if a status step has `hasMore`.
8. `resolveSchedulerFailure(env, "runtime", …)` (`runtime.ts:455`). 1 RT.

Measured totals for an idle pass (one project, no runs, no work):

| Pass                                               | D1 round trips | D1 statements | GitHub requests | R2 operations |
| -------------------------------------------------- | -------------- | ------------- | --------------- | ------------- |
| `recovery`, empty delivery page                    | 83             | 89            | 2               | 0             |
| `recovery`, 100 successful deliveries in the page  | 383            | 389           | 2               | 0             |
| `status`                                           | 32             | 32            | 0               | 0             |
| `ingest`                                           | 18             | 24            | 0               | 0             |
| `maintenance` `history` / `retention` / `profiles` | 6 / 17 / 5     | 6 / 17 / 5    | 0               | 0             |

At 288 cron ticks each day, the idle floor is 23,904 round trips each day with an empty delivery page, and 110,304 with a full page. `recoverGitHubDeliveries` is 303 of the 383 round trips (79%).

### Other message kinds

- `status`: only the steps `review-decisions`, `checks`, `review-links`, `promotion` (`operations/index.ts:62`, `74`). The `comparisonId` field is not read.
- `ingest`: `reconcileStagedWorkflows`, `expireStagedAttempts`, and the three pre-steps. No step from the list of ten (`operations/index.ts:76`).
- `maintenance`: the steps of one family (`operations/index.ts:63-72`). The `retention` family also runs `expireExports`.

### Alerts

Alerts are rows in `operations_events` (`apps/web/migrations/0005_operations.sql`). The primary key is `kind:subject:code`. `recordEvent` (`operations/common.ts:16-27`) upserts and clears `resolved_at`. `resolveEvents` (`operations/common.ts:29-41`) sets `resolved_at` for all rows with one kind and one subject. `GET /api/operations` (`api/operations.ts:6-54`) returns at most 50 unresolved rows and the last capacity snapshot. The Service view polls this endpoint. The view states "No external notifications are sent." (`components/operations-attention/index.tsx:465`).

### Budgets

`apps/web/src/runtime-defaults.ts:20-26`: `tasksPerStep: 25`, `objectsPerStep: 1000`, `leaseMilliseconds: 720000`, `maxAttempts: 5`, `maximumObjectBytes: 16777216`. `VISONAUT_OPERATIONS_BUDGET` and `VISONAUT_API_LIMITS` are `"{}"` (`apps/web/wrangler.jsonc:28-29`, `64-65`), so the defaults apply.

### Repeat safety

Work that touches GitHub or R2 uses D1 leases and guarded batches: `work_tasks` (review commands), `work_checks` and `work_status_outbox` (check updates), `operations_check_creations`, promotion pins, `work_retained_runs`, staged-run deletion tokens. Paging state is in `operations_cursors`. With `max_concurrency: 1`, two queue passes do not run at the same time.

## Findings

### OPS-01 · A failed GitHub read marks a check "ambiguous" forever

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `packages/service/src/work.ts:491-499`: the lease sets `request_started = 1` before the sender runs.
  - `packages/service/src/work.ts:538-548`: every error from the sender becomes ambiguous: `UPDATE work_checks SET ambiguous = 1 WHERE id = ? AND lease_token = ?` … `return "ambiguous"`.
  - `packages/security/src/checks.ts:173`: the sender first reads the check (`const existing = record(await github.request(path));`). The write is later, at `checks.ts:191` (`method: "PATCH"`).
  - No code clears an ambiguous sender. `settleStatus` is called only from `deliverStatus` and from the abandoned-lease path, which needs `request_started = 0` (`work.ts:635-652`).
  - Measurement M4: I failed only the read. Result: `"failedReads": 1`, `"patchesAfterFailure": 1` (no new PATCH), sender `{"ambiguous":1,"request_started":1,"leased":1,"desired_revision":2,"delivered_revision":1}`. Five later passes with a healthy GitHub, 13 minutes apart, each returned `"attention":["1"],"completed":[]`, and `"patchesAtEnd": 1`.
  - Production record: `docs/evidence/diagnostic-check-rename-repair.md:3-7`. "six diagnostic status deliveries became ambiguous" with the error `SecurityError: The check does not belong to this application and tested commit.` That error is thrown before the PATCH (`packages/security/src/checks.ts:176-187`). The repair needed a one-time Worker.
  - The same step already has the safer pattern for check creation. `operations/checks.ts:148-163` sets `request_started=1` only `if (init?.method === "POST")`, and `operations/checks.ts:172-175` returns the row to `pending` when no request started.
- What happens: any GitHub error during the read phase (5xx, timeout, token mint failure, identity mismatch) locks the check. The lock needs a manual D1 repair. The required check on the pull request stays at its old state.
- Impact: a transient GitHub fault can block a merge until a maintainer repairs D1 by hand. The Service view says "Follow the recovery guide to reconcile the check" (`components/operations-attention/index.tsx:133`). The guide has no such procedure, and the repair tool named in `docs/evidence/diagnostic-check-rename-repair.md:9` (`apps/web/tooling/check-rename-repair`) is not in the tree.
- Recommendation: let the sender report "nothing was written". Keep the ambiguous lock only for failures at or after the PATCH.

  ```ts
  // packages/service/src/work.ts
  export class NotSentError extends Error {}

  } catch (error) {
    if (error instanceof NotSentError) {
      // Retry later. The attempt still counts toward max_attempts.
      await settleStatus(database, { id, token, revision, now: params.now(), outcome: "not-sent" });
      return "stale" as const;
    }
    // Unchanged: a failure after the write started stays ambiguous.
  }
  ```

  ```ts
  // packages/security/src/checks.ts
  let existing: Record<string, unknown>;
  try {
    existing = record(await github.request(path));
  } catch (error) {
    throw new NotSentError("The check read failed.", { cause: error });
  }
  ```

- Alternatives:
  - Minimal: move `request_started = 1` to the moment before the PATCH, as `operations/checks.ts:148-163` does for creation.
  - Keep the code, and add a documented and tested repair command for one check ID (see OPS-15).
  - Auto-reconcile: after the lease ends, read the check from GitHub and compare it with the intent. `work.ts:569-572` says a read alone does not prove that an old request settled, so this needs a decision on the accepted risk.
- Maintainer decision needed: yes. Is a failure before the PATCH safe to retry automatically?

### OPS-02 · An ambiguous check with a newer status starts an endless `status` loop, and each cron tick adds one more loop

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `operations/checks.ts:347-349`: `report.hasMore = … || deliveries.some((item, index) => item.state === "pending" && outcomes[index] !== "skipped");`. The outcome `"attention"` counts as more work.
  - `operations/checks.ts:258-266`: an ambiguous delivery only records an event and returns `"attention"`. Nothing changes.
  - `runtime.ts:454`: `else if (result.hasMore) await env.OPERATIONS.send(message, { delaySeconds: 1 });`
  - `runtime.ts:446-453`: every `recovery` pass also sends a new `{ kind: "status" }` when a status step has `hasMore`. Nothing checks for a chain that already runs.
  - Measurement M4: one lost PATCH, then one newer revision. Six `status` passes in a row returned `"checksHasMore": true, "checksAttention": ["1"], "passHasMore": true`. Outbox: revision 2 `sending`, revision 3 `pending` with `attempts: 0`.
  - Measurement M5: the queue depth at the end of each 5-minute interval was 1, 2, 3, 4, 5, 6 for six cron ticks. 234 `status` passes ran, each with 33 D1 round trips. The alert `check-delivery:1:ambiguous` reached `occurrences: 241`.
- What happens: the state from OPS-01 is permanent. Any later status change of that run (a review decision, a main promotion) creates a newer pending intent. From then on, each `status` pass sends itself again after 1 second. Each cron tick adds a new chain. The chains never stop.
- Impact: the single consumer never becomes idle. Each loop pass costs 33 D1 round trips (measured locally). The queue backlog grows by 288 messages each day. `ingest` and real `status` messages wait behind the loop.
- Recommendation: report more work only when a pass made progress.

  ```ts
  // operations/checks.ts
  report.hasMore =
    (updates.results?.length ?? 0) === budget.tasksPerStep ||
    outcomes.some((outcome) => outcome === "completed" || outcome === "deferred");
  ```

  Also bound a chain, so one wrong `hasMore` cannot loop:

  ```ts
  // packages/service/src/work.ts: { kind: "status"; comparisonId?: string; hop?: number }
  // runtime.ts
  if (result.hasMore && (message.hop ?? 0) < 20)
    await env.OPERATIONS.send({ ...message, hop: (message.hop ?? 0) + 1 }, { delaySeconds: 1 });
  ```

- Alternatives:
  - Minimal: only the one-line `hasMore` change.
  - No self-continuation. Let the 5-minute cron pick up the rest. This is simpler, but large backlogs drain more slowly.
  - Keep one "continuation pending" marker for each family in `operations_cursors`. Do not send a second message while it is set.
- Maintainer decision needed: no.

### OPS-03 · Two statements in each `status` pass read (accepted runs × snapshots) rows

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/service/src/review-status.ts:25-27`: `statusRunEligibleSql = (run.active=1 OR (run.state='accepted' AND EXISTS(SELECT 1 FROM visonaut_projects project JOIN visonaut_snapshots snapshot ON snapshot.id=project.snapshot_id WHERE snapshot.run_id=run.id)))`.
  - It is used in `operations/checks.ts:48` (seed insert), `65`, `73`, `155`, `205` (the `updates` query), and in `operations/check-state.ts:22`, `27`.
  - There is no index on `visonaut_snapshots(run_id)` or on `visonaut_runs(active)` (schema dump, M6).
  - Measurement M6, `sqlite3 .stats`, 1,000 accepted runs and 1,000 snapshots, the seed insert of `operations/checks.ts:46-51`: plan `SCAN run` / `CORRELATED SCALAR SUBQUERY` / `SCAN snapshot`; `Fullscan Steps: 999999`; `Virtual Machine Steps: 4021088`.
  - Measurement M7, one `status` pass, local time: 0 runs 0.9 ms; 250 runs 4.6 ms; 500 runs 14.8 ms; 1,000 runs 63.1 ms; 2,000 runs 210.2 ms; 4,000 runs 828.2 ms. Two statements hold almost all of the time: the seed insert, and the `SELECT DISTINCT run.id,creation.check_id …` of `operations/checks.ts:200-209`.
  - Accepted runs and snapshots are never deleted. No `DELETE FROM visonaut_runs` or `DELETE FROM visonaut_snapshots` exists in `apps/` or `packages/` source.
- What happens: for each closed accepted run, SQLite scans the whole snapshot table. The cost grows with the square of the main-branch history. The statements run in each `recovery` pass and in each `status` pass.
- Impact: D1 bills each scanned row as a row read. At 1,000 accepted runs, one pass reads about 2 million rows in these two statements (computed from the measured scan steps). The pass also gets slower, and the `status` pass is the path that updates GitHub checks after a review. Computed example with OPS-04, not observed: 1,000 accepted runs and 1,000 pull requests give 41 passes × about 2 million rows for each cron tick, which is about 23.6 billion rows each day. The D1 paid plan includes 25 billion rows each month.
- Recommendation: drive the predicate from the project row. Measured on the same data (M6): 999 scan steps in place of 999,999.

  ```ts
  export const statusRunEligibleSql = `(run.active=1 OR (run.state='accepted' AND run.id IN (
    SELECT snapshot.run_id FROM visonaut_projects project
    JOIN visonaut_snapshots snapshot ON snapshot.id=project.snapshot_id)))`;
  ```

- Alternatives:
  - Add `CREATE INDEX … ON visonaut_snapshots(run_id)`. Measured: 999 scan steps, 27,021 VM steps.
  - Replace the scan of all runs with two indexed reads: active runs through a partial index, plus the baseline run. Measured: 0 full-scan steps, 52 VM steps. This needs a migration.
  - Minimal: no change now. Add the row counts to the pass log, and act when they grow.
- Maintainer decision needed: no.

### OPS-04 · The `review-links` step pages through every pull request on every cron tick

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `operations/review-links.ts:46-61`: the candidate query takes the latest bound check of every pull request. It has no state filter and no time filter.
  - `operations/review-links.ts:173-174`: `// New attempts publish directly on the PR head; old merge checks keep their mirror.` / `if (candidate.checkHeadSha === candidate.sourceSha) continue;`. Current attempts are skipped, but they are still paged.
  - `operations/review-links.ts:406`: `report.hasMore = rows.length === context.budget.tasksPerStep;`. A full page of skipped rows asks for another pass.
  - `runtime.ts:446-453`: that sends `{ kind: "status" }`, which runs all four status steps again.
  - `pre_run_checks` rows are never deleted (no `DELETE FROM pre_run_checks` in source).
  - Measurement M3, one cron tick, pull requests in the current head-check shape:

    | Pull requests with a bound check | Passes caused by one tick | D1 round trips |
    | -------------------------------- | ------------------------- | -------------- |
    | 0                                | 1                         | 83             |
    | 24                               | 1                         | 83             |
    | 25                               | 2                         | 115            |
    | 100                              | 5                         | 211            |
    | 500                              | 21                        | 723            |
    | 1,000                            | 41                        | 1,363          |

- What happens: one tick causes `floor(P / 25)` extra `status` passes for P pull requests, forever, for work that the step itself skips. Each extra pass also runs the statements of OPS-03.
- Impact: D1 cost and queue time grow with the total number of pull requests ever seen. Each continuation has `delaySeconds: 1`, so 1,000 pull requests keep the consumer busy for at least 40 seconds in every 5-minute interval (computed from the configured delay; pass time not included).
- Recommendation: page only the rows that the step can act on. Apply the filter after the ranking, so an old attempt cannot become the latest row.

  ```ts
  // operations/review-links.ts
  candidatesSql +
    " AND (checkHeadSha IS NULL OR checkHeadSha != sourceSha)" +
    " AND pullRequestNumber>? ORDER BY pullRequestNumber LIMIT ?";
  ```

- Alternatives:
  - Remove the mirror step when no legacy merge check is still open. This needs a production count of rows with `check_head_sha IS NULL OR check_head_sha != source_sha` that still have an active run.
  - Keep the walk, but do not request a continuation when the page did no work.
  - Minimal: limit candidates to checks updated in the last N days.
- Maintainer decision needed: yes. Can the legacy review-link mirror be retired, or must it stay for old open pull requests?

### OPS-05 · Webhook delivery recovery runs 3 D1 statements for each listed delivery, including successful ones

- Kind: performance
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `operations/github-deliveries.ts:229-246`: for each delivery, one receipt `SELECT`. Then, for a received or 2xx delivery, `UPDATE github_webhook_recovery SET resolved_at=? WHERE guid=?` and `resolveEvents(…, "upstream-webhook", delivery.guid, …)`.
  - Measurement M2: `recoverGitHubDeliveries (100 successful deliveries)`: 303 round trips, 202 write statements. Whole idle pass: 383 round trips.
  - `resolveEvents` scans `operations_events` (plan: `SCAN operations_events`, M6). With a full page, `operations_events` is scanned 129 times in one pass (M1).
  - `operations/github-deliveries.ts:165-179`: `GET /app/hook/config` runs in every pass to compare one URL.
  - `operations/github-deliveries.ts:186-210`: one page of 100 for each pass. The cursor moves to older pages and returns to the newest page only after the last page.
  - GitHub keeps deliveries for 3 days ("You can view details about webhook deliveries from the past 3 days.", GitHub documentation, read 2026-10-05).
  - Production record: `docs/evidence/capacity-admission-20260928.md:7`: "D1 held 30,566 delivery rows … 25,452 processed `check_run` receipts and 4,020 processed `workflow_run` receipts."
- What happens: an idle system writes 200 no-op statements and runs 100 lookups every 5 minutes for deliveries that need nothing. A new failed delivery is on the newest page. The walk returns to that page only after it has visited all older pages, at 100 deliveries for each 5 minutes.
- Impact: 87,264 D1 round trips each day for this one function when the page is full (303 × 288, computed from M2). Detection of a lost webhook can take (pages in 3 days) × 5 minutes. The page count in production is not known to me.
- Recommendation: filter in memory, and batch the rest.

  ```ts
  const failed = deliveries.filter(
    (d) => d.status_code === null || d.status_code < 200 || d.status_code >= 400,
  );
  const guids = JSON.stringify(deliveries.map((d) => d.guid));
  // 1 statement: which failed deliveries already have a receipt?
  // 1 statement: settle open recovery rows for GUIDs on this page.
  await database
    .prepare(
      `UPDATE github_webhook_recovery SET resolved_at=?
      WHERE resolved_at IS NULL AND guid IN (SELECT value FROM json_each(?))`,
    )
    .bind(now, guids)
    .run();
  // 1 statement: resolve their alerts in the same way. Then loop only over `failed`.
  ```

- Alternatives:
  - Always read the newest page first, then continue the older walk. This removes the detection delay.
  - Check `/app/hook/config` once each hour or once each day, with a cursor that stores the last check time.
  - Minimal: keep the loop, but skip the two writes when the delivery has no row in `github_webhook_recovery`.
- Maintainer decision needed: no.

### OPS-06 · Two alerts are resolved by an operation that did not fix them

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Name collision. `runtime.ts:371`: `["checks", retireUnpinnedMainChecks]` records `checks:scheduler:reconciliation-failed`. `operations/index.ts:49`: `["checks", () => deliverGitHubStatuses(context)]`, and `operations/index.ts:80`: `await resolveEvents(context.database, name, "scheduler", context.now());`. `resolveEvents` matches kind and subject only (`operations/common.ts:37`).
  - Measurement M4, `checksKindCollision`: the event was unresolved before `runOperations` and had `resolved_at: 1790035200001` after it. `"resolvedByRunOperations": true`.
  - Wrong scope. `runtime.ts:455`: `await resolveSchedulerFailure(env, "runtime", "configuration-or-step-failed");` runs at the end of every successful pass of any kind.
  - Measurement M8: after `reportSchedulerFailure`, one idle `status` pass changed `runtime:scheduler:configuration-or-step-failed` from `unresolved: 1` to `unresolved: 0`.
- What happens: (a) a failure of `retireUnpinnedMainChecks` is recorded and then resolved in the same pass by the unrelated status step. The alert is never visible. (b) When `recovery` passes fail, any successful `status`, `ingest`, or `maintenance` pass hides the scheduler alert until the next failure.
- Impact: the Service view under-reports scheduler failures. A maintainer cannot trust "no alerts".
- Recommendation: give each runtime reconciler its own kind, and key the runtime alert by message kind.

  ```ts
  // runtime.ts
  (["main-check-retirement", retireUnpinnedMainChecks],
    // …
    await resolveSchedulerFailure(env, "runtime", `${message.kind}-failed`));
  ```

- Alternatives:
  - Resolve by the full event ID (`kind:subject:code`) everywhere. The ID is the primary key, so this also removes the table scans.
  - Minimal: rename only the `checks` reconciler kind.
- Maintainer decision needed: no.

### OPS-07 · Several alerts never clear, and one alert fires for normal retries

- Kind: bug
- Severity: medium. Confidence: medium. Measured: yes. Effort: M
- Evidence:
  - `check-creation:<run>:*` is resolved only on a later success for the same run (`operations/checks.ts:118`, `170`). `promotion:<run>:*` is resolved only when that run is promoted (`operations/promotions.ts:351`, `413`). There is no resolver for a run that closed.
  - Measurement M8: I recorded `check-creation:run:exhausted`, `check-creation:run:ambiguous`, `promotion:run:state-changed`, and `promotion:run:source-verification-failed`, closed the run, and ran ten `recovery` passes of `runOperations`. All four were still listed by `operationsStatus`.
  - `promotion:<run>:state-changed` is recorded for `ConflictError` and `IncompleteError` (`operations/promotions.ts:421-430`). These are normal races.
  - By code reading, not measured: `upstream-webhook:<guid>:redelivery-exhausted` resolves only when the delivery is seen again on a fetched page (`operations/github-deliveries.ts:236-246`). GitHub drops deliveries after 3 days. `staged-reconciliation:<run:attempt>:expired-incomplete` (`packages/service/src/run-retirement.ts:134-144`) resolves only when the same or a later attempt of the same workflow run is sealed (`api/workflow-materialize.ts:837-855`). A new commit starts a different workflow run.
  - Noise: `runtime.ts:387-396` records `staged:scheduler:reconciliation-failed` when `result.errors.length > 0`. `reconcileStagedWorkflows` returns an error for each staged run that is not ready yet (`api/workflow-materialize.ts:900-904`), and it expects that: `/** Retry incomplete conversion after transient GitHub, D1, or R2 failures. */` (`api/workflow-materialize.ts:822`).
  - `api/operations.ts:33-35` hides only two alert classes (`check-delivery` exhausted and obsolete `staged-reconciliation`).
- What happens: alerts for subjects that are no longer work stay in the Service view until someone edits D1. One alert appears during normal ingest retries.
- Impact: the list fills with stale rows. The API returns 50 rows. Maintainers learn to ignore the view.
- Recommendation: add one sweep statement to each pass for alerts whose run is closed. Give alerts that cannot recover a terminal state.

  ```sql
  UPDATE operations_events SET resolved_at=?
  WHERE resolved_at IS NULL AND kind IN ('check-creation','promotion')
    AND EXISTS (SELECT 1 FROM visonaut_runs run
      WHERE run.id=operations_events.subject_id AND run.active=0 AND run.state!='accepted');
  ```

- Alternatives:
  - Add an "acknowledge" action in the Service view. A maintainer closes an alert. The row keeps who and when.
  - Auto-expire: an unresolved alert that was not seen again for N days moves to an archive list.
  - Minimal: extend the filter in `api/operations.ts` to hide these classes. The rows stay unresolved in D1.
- Maintainer decision needed: yes. May the service close alerts for closed runs automatically, or must a person acknowledge them?

### OPS-08 · A failed pass leaves no cause in the logs, and log shapes differ

- Kind: dx
- Severity: medium. Confidence: high. Measured: no. Effort: M
- Evidence:
  - `server.ts:164-167`: `} catch { await reportSchedulerFailure(env); for (const message of valid) message.retry({ delaySeconds: 60 }); }`. The error is dropped. `reportSchedulerFailure` logs only when its own D1 write fails (`runtime.ts:476-477`: `{ event: "operations-failed" }`).
  - `operations/index.ts:81-88`: `} catch { await recordEvent(… code: "step-failed" …)`. No log line.
  - `runtime.ts:422-429`: the staged-retention failure records an event and logs nothing.
  - `runtime.ts:397-403`: `logOperationFailure({ operation: kind, code: "reconciliation-failed", … })`. The code is fixed. The error class and the GitHub status are not logged.
  - `runtime.ts:380`: `const failed = "pending" in result ? result.pending.length : result.errors.length;`. `reconcileWebhooks` returns the failing delivery IDs (`api/webhooks.ts:375-394`), and `reconcileStagedWorkflows` returns `{ runId, code }` (`api/workflow-materialize.ts:901-904`). Only the count is used.
  - `operations/index.ts:103-108`: the pass log is `{ event: "operations_pass", elapsedMs, promotionMs }`. It has no message kind, no step results, no `hasMore`, and no correlation ID.
  - `OperationReport.completed`, `deferred`, and `attention` (`operations/types.ts:72-77`) are filled by every step. `runtime.ts:441-454` reads only `hasMore`.
  - Naming: kebab-case events (`operation-failed`, `invalid-operations-message`, `operations-failed`, `webhook-processing-pending`, `review-status-wakeup-failed`) and snake_case events (`operations_pass`, `baseline_promotion_step`, `workflow_materialized`, `comparison_ready_timing`, `api_rejected`). Durations: `elapsedMilliseconds` (`operations/failure.ts:21`), `elapsedMs` (`operations/index.ts:106`), `totalMs` (`api/workflow-materialize.ts:796`).
  - Policy: `operations/failure.ts:13`: `/** Fixed fields keep credentials, request payloads, and SQL out of Worker logs. */`.
- What happens: when a pass fails, the only trace is an alert row with a fixed code and the subject `scheduler`. The log cannot tell which step, which run, or which error. An operator must query D1 by hand.
- Impact: slow diagnosis. The incident of 2026-09-22 needed the archived Worker bundle to find the cause (`docs/evidence/diagnostic-check-rename-repair.md:3-5`).
- Recommendation: one structured log helper for all operations. Keep the "safe fields only" rule, and add fields that are safe: error class name, `SecurityError.code`, `GitHubUnavailableError.upstreamStatus`, step name, message kind, subject ID, queue attempt.

  ```ts
  // operations/index.ts
  } catch (error) {
    logOperationFailure({
      operation: name, code: "step-failed", correlationId, startedAt,
      errorName: error instanceof Error ? error.name : "unknown",
      upstreamStatus: error instanceof GitHubUnavailableError ? error.upstreamStatus : undefined,
    });
  ```

  Emit one summary line for each pass:

  ```json
  {
    "event": "operations_pass",
    "kind": "recovery",
    "attempt": 1,
    "queueWaitMs": 1840,
    "elapsedMs": 912,
    "steps": { "checks": { "ms": 310, "completed": 2, "attention": 0, "hasMore": false } }
  }
  ```

  `queueWaitMs` is `Date.now() - message.timestamp.getTime()` in the queue handler. It gives the queue delay that OPS-11 cannot measure today.

- Alternatives:
  - Minimal: log `error.name` and the step name in the three `catch` blocks, and log the IDs from `result.pending` and `result.errors`.
  - Store the last error class in a new nullable column of `operations_events`, and show it in the Service view.
  - Use Workers trace spans for each step (traces are enabled in `apps/web/wrangler.jsonc:15-20`) in place of log fields.
- Maintainer decision needed: yes. Which error fields are safe to log under the rule in `operations/failure.ts:13`?

### OPS-09 · A stopped scheduler, a dead-lettered message, or a killed pass raises no signal

- Kind: dx
- Severity: medium. Confidence: medium. Measured: no. Effort: M
- Evidence:
  - `api/operations.ts:51`: `checkedAt: Date.now()`. The Service view prints it as "Last checked" (`components/operations-attention/index.tsx:343`). This is the time of the API read, not the time of the last scheduler pass.
  - The only time of a real pass is the capacity snapshot (`capacity.ts:60-71`), shown as "Capacity sampled …" (`components/operations-attention/index.tsx:389`). No code compares it with the present time.
  - `components/operations-attention/index.tsx:465`: "No external notifications are sent."
  - `apps/web/wrangler.jsonc:105`: `"dead_letter_queue": "visonaut-production-dead-letter"`. No consumer for that queue exists in `apps/web/wrangler.jsonc` or `apps/compare/wrangler.jsonc`. `docs/operations/recover-comparison-dead-letters.md` speaks of "the four-day unconsumed-DLQ retention". Cloudflare: "Messages delivered to a DLQ without an active consumer will persist for four (4) days before being deleted from the queue." (read 2026-10-05).
  - `server.ts:157-167`: the alert and the 60-second delay exist only in the `catch` block. If the platform ends the invocation (CPU limit 240,000 ms, wall-clock limit 15 minutes), the `catch` block does not run. `apps/web/wrangler.jsonc:98-107` has no `retry_delay`.
  - `.github/workflows/deploy.yml:334-337`: the `production-fence` action deploys with `queues: { consumers: [] }`, and `apps/web/src/cutover-fence.ts:10` has `scheduled() {}`.
- What happens: if the consumer is detached, the cron stops, or every pass is killed by a limit, no event is written. The Service view shows "No unresolved operation alerts. Last checked (now)". Messages that used all retries go to a queue that nothing reads. They are deleted after 4 days.
- Impact: checks stop updating and retention stops, with no visible sign. The first sign is a contributor who reports a pending check.
- Recommendation:
  - Write a heartbeat at the end of each pass, and show its age.

    ```ts
    // runtime.ts, end of runScheduledOperations
    await env.DB.prepare(
      "INSERT INTO operations_cursors(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    )
      .bind(`last-pass:${message.kind}`, String(Date.now()))
      .run();
    ```

    `GET /api/operations` returns `lastRecoveryPassAt`. The view shows a warning when it is older than 15 minutes.

  - Set `"retry_delay": 60` on the consumer, so platform retries also wait.
- Alternatives:
  - Attach a small consumer to the dead-letter queue. It records `runtime:dead-letter:<kind>` and acknowledges. Then the queue has a purpose.
  - Remove the dead-letter queue. The messages carry no state, and the next cron tick sends a new `recovery` message.
  - External check: a monitor that reads a heartbeat field from `/health`. `/health` reads no D1 today (`server.ts:60-71`), so this adds a D1 read or a cache.
- Maintainer decision needed: yes. Is a pull-only alert view enough, or is one external notification (for "scheduler stale") wanted?

### OPS-10 · Failure isolation is not the same for all parts of a pass

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: no. Effort: S
- Evidence:
  - Isolated: the ten steps (`operations/index.ts:78-88`), the four reconcilers (`runtime.ts:378-410`), capacity (`runtime.ts:319-330`), delivery recovery (`runtime.ts:331-365`).
  - Not isolated: the pre-steps in `operations/index.ts:32-46` (`retireReplacedMainRuns`, `service.reconcileComparisons`, `reportComparisonRecovery`). `operations/main-retirement.ts:24`: `if (!(error instanceof ConflictError)) throw error;`.
  - Not isolated: `expireExports`. `operations/index.ts:96-110` uses `try { … await expireExports(context); } finally { console.info(…) }` with no `catch`. `operations/exports.ts:18-26` calls R2 `list` and `delete` with no `try`.
  - Not isolated inside a step: `operations/checks.ts:210-218` calls `service.prepareStatusIntent` in a loop with no `try`. `operations/checks.ts:98` calls `service.run` with no `try`.
  - `runtime.ts:431-454`: the continuation messages are sent after `runOperations` returns.
  - Retry rules also differ: review commands 5 attempts (`operations/review-queue.ts:62`, hardcoded); status and check creation `budget.maxAttempts`; staged conversion 5 attempts, then one each hour (`api/workflow-materialize.ts:825-826`); pending webhooks without a limit (`github_webhook_delivery` has no attempts column; `api/webhooks.ts:362-395`); promotion and retention retry at every pass without a limit.
- What happens: an error in a pre-step stops the whole pass before any of the ten steps. An R2 error in the export cleanup makes the pass throw after all steps ran. In both cases no continuation is sent, the message is retried after 60 seconds up to 5 times, and each retry repeats the full pass. One throwing run in the `prepareStatusIntent` loop stops status delivery for all runs in that pass.
- Impact: one bad record, or one R2 fault in a low-value cleanup, can delay check delivery for every pull request.
- Recommendation: run the pre-steps and `expireExports` through the same wrapper as the ten steps. Catch errors for each item in the two loops in `operations/checks.ts`.

  ```ts
  const steps: [string, () => Promise<OperationReport>][] = [
    ["main-retirement", () => retireReplacedMainRuns(context)],
    ["finalization", () => finalizeComparisons(context)],
    // … the ten steps …
    ["export-retention", () => expireExports(context)],
  ];
  ```

- Alternatives:
  - Minimal: add `catch` to the `expireExports` block and to the pre-steps, each with `recordEvent`.
  - Send continuations in a `finally` block, so a late failure does not drop them.
- Maintainer decision needed: no.

### OPS-11 · One queue with one consumer puts check updates and ingest behind maintenance, and the wait is not measured

- Kind: performance
- Severity: medium. Confidence: medium. Measured: no. Effort: M
- Evidence:
  - `apps/web/wrangler.jsonc:101-103`: `"max_batch_size": 1, "max_batch_timeout": 1, "max_concurrency": 1`.
  - `runtime.ts:307-457`: all kinds run in the same handler. A `recovery` pass can include staged-run conversion (up to 25 runs, `api/workflow-materialize.ts:823`), promotion (up to 50 object digests, `operations/promotions.ts:20`), history conversion (up to 1,000 R2 reads, `operations/closed-summary.ts:382`), and retention (up to 1,000 objects).
  - `api/review.ts:642`: `// Start the saved command while the shared consumer may be occupied with ingest.` The decision itself was moved off the queue for this reason. The GitHub check update still needs the queue (`api/review.ts:661`).
  - Production record, not measured by me, `docs/evidence/checks-7710/README.md`: "Submit acceptance to reservation took `232624 ms`. Reservation to seal took `64900 ms`." and "Success intents followed the approval commit by `21514 ms` and `33363 ms`." The same record says: "They do not identify the exact queue occupancy".
  - No log holds the queue wait (OPS-08).
- What happens: after a reviewer approves, the check turns green only after the queue reaches the `status` message. A long pass in front of it adds its full duration. The recorded conversion of one run took 65 seconds.
- Impact: this is part of the "slow" feeling that the maintainer reports. The service cannot say how large this part is, because the wait is not logged.
- Recommendation: first measure (`queueWaitMs`, OPS-08). Then choose one of the options below.
- Alternatives:
  - Deliver the status inline. After the decision commits, run the status delivery for that run in `waitUntil`, as `api/review.ts:647-654` does for the command. The queue stays as the recovery path.
  - Two queues: a fast queue for `status` and `ingest`, and a slow queue for `recovery` and `maintenance`. `docs/current-contract.md:141` records the earlier choice "One queue with small, named work kinds", so this changes a recorded decision.
  - Raise `max_concurrency`. Leases protect checks, review tasks, and promotion. The cursors in `operations_cursors` have no lease (for example `operations/review-links.ts:407-412`). I did not verify that two parallel passes are safe.
  - Minimal: keep one queue, and move staged conversion out of `recovery` into its own `ingest` message, so a `recovery` pass stays short.
- Maintainer decision needed: yes. Which option, after the wait is measured?

### OPS-12 · Continuation rules are written three times and differ between steps

- Kind: simplification
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - The step-to-family table exists in `operations/index.ts:62-72` (`statusNames`, `familyNames`), in `runtime.ts:435-448` (`families`, and the list `["review-decisions", "checks", "review-links", "promotion"]`), and as the type and the validator in `packages/service/src/work.ts:1`, `18-23`.
  - `runtime.ts:434-454`: for `recovery`, only the listed step names can cause a continuation. `finalization.hasMore` (`operations/index.ts:43`) and `main-retirement.hasMore` (`operations/main-retirement.ts:28`) are in no list, so `recovery` ignores them. For `ingest`, the generic `result.hasMore` is used, so the same two reports do cause a continuation.
  - `hasMore` has a different meaning in each step: "a full page" (`operations/snapshot-retention.ts:242`, `operations/review-links.ts:406`, `api/workflow-retention.ts:125`); "a full page and progress" (`operations/snapshot-retention.ts:81`, `189`); "one item was delivered" (`operations/checks.ts:347-349`; M4 shows `hasMore: true` after one successful delivery); "after a promotion" (`operations/promotions.ts:354`, `417`).
  - `packages/service/src/work.ts:3`: `{ kind: "status"; comparisonId?: string }`. No consumer reads `comparisonId`.
  - `packages/service/src/work.ts:24-26`: the `continue` decoder: "New writers never publish this old queue shape." `git log -S` dates it to 2026-09-30. Queue retention is at most 14 days.
- What happens: a new step must be added in three places. "More work" has no single definition. That made OPS-02 and OPS-04 possible.
- Impact: maintenance cost, and extra passes. Each delivered check update causes one more `status` pass (32 round trips when idle, M1).
- Recommendation: one table, one rule.

  ```ts
  // one module, used by index.ts and runtime.ts
  export const operationSteps = {
    "review-decisions": "status",
    checks: "status",
    "review-links": "status",
    promotion: "status",
    history: "history",
    "reference-retention": "retention",
    "source-retention": "retention",
    "snapshot-retention": "retention",
    retention: "retention",
    "profile-retention": "profiles",
  } as const;
  // Rule: hasMore is true only if the step changed state in this pass and work remains.
  ```

- Alternatives:
  - Minimal: export the table from `operations/index.ts` and import it in `runtime.ts`.
  - Remove `comparisonId` from the message type, or use it to limit the pass to one run.
  - Remove the `continue` decoder after 2026-10-14, or 14 days after the deployment of the new producer if that is later.
- Maintainer decision needed: no.

### OPS-13 · Operations for retired features still run in every pass

- Kind: dead-code
- Severity: low. Confidence: medium. Measured: yes. Effort: M
- Evidence (idle counts from M2):

  | Operation                                                                                                                                                          | Why it looks retired                                                                                                                                                                                                                                                                                             | Idle cost for each pass                                                                                                                           |
  | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `expireHistoricalPreparations` (`packages/service/src/historical.ts:113-157`), called from `reconcileComparisons` (`packages/service/src/local-comparison.ts:697`) | No source file inserts into `visonaut_historical_preparations` (search of `apps/` and `packages/`, tests excluded). `runtime.ts:284-291`: `prepareComparison` throws "Closed history is read-only."                                                                                                              | 1 round trip, 7 statements, in `recovery` and `ingest`                                                                                            |
  | `reportComparisonRecovery`, the `comparison-publication` and `comparison-task` parts (`operations/comparison-alerts.ts:37-113`)                                    | It is always called with `{ published: [], failed: [] }` (`operations/index.ts:45`). `work_tasks` of kind `compare` have no producer in `apps/web/src` or `packages`; only `apps/web/tooling/queue-recovery/worker.mjs:31-33`. `docs/current-contract.md:32`: "legacy producers and queue handlers are removed". | 4 of its 6 round trips, in `recovery` and `ingest`                                                                                                |
  | `retireUnpinnedMainChecks` (`api/pre-run-checks.ts:75-151`)                                                                                                        | Comment: "Retire checks created before the pinned App workflow existed on main." For a commit that has the pinned workflow it does nothing: `if (await hasPinnedMainWorkflow(…)) continue;` (line 97).                                                                                                           | 1 round trip, plus 1 alert write. The `SELECT *` at lines 84-89 has no `LIMIT`. Each matching row costs one GitHub `contents` read in every pass. |
  | `expireExports` (`operations/exports.ts`)                                                                                                                          | The export feature is removed (`docs/current-contract.md:34`). The cleanup stays for retained rows.                                                                                                                                                                                                              | 1 round trip                                                                                                                                      |
  | `continue` decoder (`packages/service/src/work.ts:24-26`)                                                                                                          | See OPS-12.                                                                                                                                                                                                                                                                                                      | none                                                                                                                                              |

- What happens: about 8 of the 83 idle round trips of a `recovery` pass serve features that cannot produce new work. `retireUnpinnedMainChecks` can also make GitHub calls without a bound if rows match its query.
- Impact: a small cost in each pass. The larger cost is reading and testing code for behavior that no longer exists.
- Recommendation: for each row, check production once with the queries below. If the count is zero, remove the operation.

  ```sql
  SELECT COUNT(*) FROM visonaut_historical_preparations;
  SELECT COUNT(*) FROM work_tasks WHERE kind='compare' AND state IN ('queued','leased');
  SELECT COUNT(*) FROM operations_events WHERE resolved_at IS NULL
    AND kind IN ('comparison-publication','comparison-task');
  SELECT COUNT(*) FROM pre_run_checks WHERE kind='main' AND workflow_run_id IS NULL
    AND state IN ('active','ambiguous','creating');
  SELECT COUNT(*) FROM operations_exports WHERE state!='expired';
  ```

- Alternatives:
  - Keep them, and run them only in a daily pass (a separate cron or a message kind).
  - Minimal: add `LIMIT ?` to the query in `api/pre-run-checks.ts:84-89`.
- Maintainer decision needed: yes. These removals follow the W06 to W08 gates in `docs/current-contract.md`. Which gates are complete?

### OPS-14 · Almost a quarter of `operations/` source is reachable only from tests

- Kind: dead-code
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence (search of `apps/`, `packages/`, `.github/`, `tooling/`; tests and Markdown excluded; M9):
  - `operations/history.ts` (985 lines). Production imports only `readHistoryManifest` and `readVerifiedHistoryObject` (`operations/closed-summary.ts:13`). The archive writer has no production caller: `archiveClosedRuns` (line 871), `writeHistoryStep` (783), `readRunHistory` (276), `readHistoryView` (284), `readArchivedSection` (969), and their helpers (`sourcePage`, `claim`, `saveProgress`, `putVerified`, and others). About 880 lines.
  - `operations/history-supplement.ts` (209 lines). Production imports only `readComparisonHistoryManifest` (`operations/closed-summary.ts:12`). `archiveHistoricalComparisons` (line 60) and `readArchivedComparison` (line 188) have no production caller. About 150 lines.
  - `operations/common.ts:64-166`: `putKnownLength` and `copyVerifiedObject` have no caller outside this file and tests. About 100 lines.
  - `packages/service/src/work.ts:209-366`: `reconcileWork` (queue publication with receipts) is called only by `apps/web/tooling/queue-recovery/worker.mjs:95`.
  - Service functions used only by the dead writer: `compactRunHistory`, `prepareArchivedCommandReplay`, `archiveEligibilitySql` (`packages/service/src/history.ts`), `compactHistoricalComparison` (`packages/service/src/historical.ts:171`).
  - Tests: 65 matching lines for the writer functions in 10 test files.
  - `operations/` has 4,824 lines of non-test source. About 1,130 lines (23%) are in the first three groups above.
- What happens: the writer remains so that tests can build legacy archives. The live converter `convertLegacySummary` (`operations/closed-summary.ts:67-231`) then reads them. `operations/README.md:38` asks to keep "the legacy archive branch in `summarizeClosedRuns`". That is the reader, not the writer.
- Impact: review time, type-check time, and a wrong picture of what the service does. `operations/history.ts` is the largest file in the directory.
- Recommendation: move the archive writer to a test fixture directory (for example next to `tooling/legacy-comparison-fixture.ts`), or replace it with a small recorded archive. Delete `copyVerifiedObject` and `putKnownLength` if no plan needs them.
- Alternatives:
  - Keep the files, and mark them with a header comment "test fixture only" plus a lint rule that forbids production imports.
  - Remove the reader too, after this production count is zero: `SELECT COUNT(*) FROM operations_run_archives WHERE state='ready'`, and the same for `operations_comparison_archives`.
- Maintainer decision needed: yes. Are any ready legacy archives still present in production?

### OPS-15 · The restore runbook names functions that have no runner

- Kind: dx
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `operations/README.md:80-81`: "Run `sanitizeRestoredDatabase` only against this isolated target." and "Page through `inspectRecoveryImages` … Then page through `inspectRecoveryInventories`".
  - `operations/recovery.ts:29`, `88`, `147` define these functions. The only callers are tests (search, M9). No script, Worker entry point, tooling directory, or workflow action calls them. `apps/web/tooling/` contains `backup-v2-recorded`, `baseline-delta-cost`, `baseline-reset`, `queue-recovery`, `review-scale`.
  - `operations/README.md:92`: "The local recovery test restores an actual SQLite snapshot … They do not claim a completed hosted Time Travel rewind".
  - For a stuck check, the Service view says "Follow the recovery guide" (`components/operations-attention/index.tsx:133-134`). `operations/README.md` has no text for `check-delivery`, `check-creation`, or `redelivery-exhausted`. The one repair tool that existed is gone: `docs/evidence/diagnostic-check-rename-repair.md:9` links to `apps/web/tooling/check-rename-repair/README.md`, which is not in the tree.
- What happens: during a restore, or with an ambiguous check (OPS-01), an operator must write a one-time Worker or script under pressure. `sanitizeRestoredDatabase` needs a D1 binding. The two inspect functions need D1 and R2.
- Impact: longer recovery, and a risk of manual mistakes at the worst moment.
- Recommendation: add one small operator Worker in `apps/web/tooling/` with fixed commands, in the style of `apps/web/tooling/queue-recovery`: `sanitize` (with a dry run that prints the planned row counts), `inspect-images`, `inspect-inventories`, and `settle-check <checkId>` (it calls `settleStatus` with `outcome: "not-sent"` after the read-only checks from the incident record).
- Alternatives:
  - Minimal: add to the runbook the exact way to run the functions today (which binding setup, which entry file).
  - Export the SQL of `sanitizeRestoredDatabase` as a reviewed `.sql` file for `wrangler d1 execute`. The R2 inspection still needs a Worker.
- Maintainer decision needed: yes. Should recovery tooling be kept ready in the repository, or written when needed?

### OPS-16 · Operational tables only grow; the capacity stop is the only brake

- Kind: cost
- Severity: medium. Confidence: medium. Measured: yes. Effort: M
- Evidence:
  - Source has no `DELETE` for: `operations_events`, `github_webhook_delivery`, `github_webhook_recovery`, `pre_run_checks`, `operations_check_creations`, `work_checks`, `visonaut_status_outbox`, `operations_review_links`, `visonaut_runs`, `visonaut_snapshots` (search of `apps/` and `packages/`, tests excluded). `work_status_outbox` is pruned only for head checks (`operations/review-links.ts:327-332`).
  - `operations_events` has no index except the primary key. Plans (M6): `resolveEvents` → `SCAN operations_events`; `resolveSchedulerFailure` → `SCAN operations_events`; the alert list → `SCAN operations_events` plus `USE TEMP B-TREE FOR ORDER BY`.
  - Measurement M1: one idle `recovery` pass scans `operations_events` 29 times with an empty delivery page and 129 times with a full page. With 20,000 resolved rows, the local pass time went from 8.7 ms to 61.8 ms.
  - A success writes too: each pass runs 17 "resolve on success" updates (10 in `operations/index.ts:80`, 7 through `resolveSchedulerFailure`), also when no alert is open.
  - Production record: `docs/evidence/capacity-admission-20260928.md:3`: a real Submit got `capacity_exceeded` at 810,733,568 bytes. Line 7: 30,566 webhook receipt rows; 25,452 of them were `check_run`. The limits were then raised to a 1.5 GiB warning and a 2 GiB stop (`runtime-defaults.ts:15-16`).
  - `api/webhooks.ts:225-233`: the service uses a `check_run` event only for the one Submit job name. Every `check_run` delivery still gets a D1 receipt row (`packages/security/src/webhooks.ts:84-96`).
  - `capacity.ts:40-41`: the active-run count is `SCAN visonaut_runs` (M6).
- What happens: each webhook, check, status change, and alert leaves a row forever. Scans over these tables grow with them (see also OPS-03 and OPS-04). When D1 reaches 2 GiB, new capture runs stop (`capacity.ts:108-113`). No automatic job reduces the size.
- Impact: slow cost growth, and a repeat of the 2026-09-28 stop at a later date. The date depends on the event volume, which I did not measure.
- Recommendation:
  - Resolve alerts by primary key (`WHERE id=?`) where the code is known. Add a partial index for the list: `CREATE INDEX operations_events_open ON operations_events(last_seen_at DESC) WHERE resolved_at IS NULL`.
  - Skip the 17 success writes when nothing is open: read the open scheduler alerts once at the start of the pass.
  - Add a bounded retention step for rows with no further use, with an age for each table.
- Alternatives:
  - Do not store receipts for `check_run` deliveries that do not match the Submit job name. The delivery recovery already accepts a 2xx status as proof (`operations/github-deliveries.ts:236-239`).
  - Minimal: only add the index and the primary-key resolves.
  - Keep all rows, and move old ones to an R2 archive once each month.
- Maintainer decision needed: yes. What retention applies to webhook receipts and resolved alerts? `docs/operations/compact-processed-webhooks.md` says to keep receipt identities "for replay detection and audit".

### OPS-17 · The budget settings cover only part of the limits, and a deploy resets live overrides

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `runtime-defaults.ts:20-26` defines five fields. `tasksPerStep` is read at 55 places in 21 source files. It is the page size of many unrelated queries, the limit of the four reconcilers (`runtime.ts:379`), and the redelivery cap (`operations/github-deliveries.ts:268`).
  - Limits outside the budget: `maximumPromotionObjectsPerStep = 50` and `maximumConcurrentPromotionObjects = 5` (`operations/promotions.ts:20-21`), so the default `objectsPerStep: 1000` never applies to promotion (`Math.min(budget.objectsPerStep, maximumPromotionObjectsPerStep)`, line 250); `maximumConcurrentStatusDeliveries = 3` (`operations/checks.ts:26`); `maxAttempts: 5` for review commands (`operations/review-queue.ts:62`); a 30-second lease for the inline command (`api/review.ts:650`); 5-minute redelivery spacing, written twice (`operations/github-deliveries.ts:270`, `277`); `retryBurst = 5` and `delayedRetryMs` of one hour (`api/workflow-materialize.ts:825-826`); `stagedAttemptRetentionMs` and `stagedMaterializationLeaseMs` (`api/workflow-retention.ts:6-7`); 120-second check leases (`api/pre-run-checks.ts:338`, `465`, `480`); 15-second GitHub timeouts.
  - `operationsBudget` validates (`runtime.ts:147`), and `runOperations` validates again (`operations/index.ts:28`). `apiBindings(env)` is built up to five times in one `recovery` pass (`runtime.ts:379`, `414`). Each call parses and validates both JSON variables again.
  - `runtime.ts:414`: `apiBindings(env).configuration.workflowOwned` is always set, because `apiBindings` throws when a field is missing (`runtime.ts:202-229`). The condition is constant.
  - `docs/current-contract.md:103`: "Keep incident overrides in the existing deployment configuration. A future deployment must reconcile live values before applying the committed `{}` values." `apps/web/wrangler.jsonc` has no `keep_vars`.
  - `apps/web/wrangler.jsonc:23-29`: the preview variables `VISONAUT_REPOSITORY`, `GITHUB_REPOSITORY_ID`, `VISONAUT_PROJECT_ID`, `VISONAUT_API_LIMITS`, and `VISONAUT_OPERATIONS_BUDGET` are read only on production paths (`runtime.ts:102`, `133-134`, `142`, `185`). The preview paths return before that (`server.ts:73-80`, `runtime.ts:311-312`).
- What happens: an operator cannot tune one step in an incident. One field changes many unrelated pages. A value set in the Cloudflare dashboard during an incident is replaced by `{}` at the next deploy.
- Impact: the override path exists, but it is coarse and easy to lose.
- Recommendation: either accept that the budget is "defaults in code", or make it real: move the constants above into `runtime-defaults.ts` with a name for each step, and document that overrides must be committed.
- Alternatives:
  - Remove `VISONAUT_OPERATIONS_BUDGET` and `VISONAUT_API_LIMITS` from configuration, and keep typed constants only. `docs/current-contract.md:95-103` keeps the override path, so this changes the contract.
  - Add `"keep_vars": true` so that a dashboard override survives a deploy. The drawback is that committed values then stop being the truth.
  - Minimal: remove the five unused preview variables and the constant condition at `runtime.ts:414`.
- Maintainer decision needed: yes. Is a live incident override still a requirement?

### OPS-18 · Alert kinds are free text; the Service view maps retired kinds and misses live ones

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `recordEvent` takes `kind: string` and `code: string` (`operations/common.ts:18`). Kinds are string literals in 14 files. Four hand-written copies of the upsert exist: `operations/common.ts:21-26`, `packages/service/src/comparison-publication.ts:15-21`, `packages/service/src/run-retirement.ts:134-144` (this one does not increase `occurrences`), `operations/recovery.ts:77-81`.
  - Kinds recorded today: `database-capacity`, `upstream-webhook`, `webhooks`, `checks`, `check-aliases`, `staged`, `staged-retention`, `runtime`, `staged-reconciliation`, `check-creation`, `check-delivery`, `comparison-finalization`, `comparison-task`, `promotion`, `history`, `reference-retention`, `snapshot-retention`, `retention`, `restore`, and one for each step name (`review-decisions`, `review-links`, `source-retention`, `profile-retention`, and so on).
  - `components/operations-attention/index.tsx:98-199` has texts for `backup` (line 117) and `backup-retention` (line 175), which no source file records, and for `comparison-publication` (line 137), which has no producer (OPS-13). It has no text for `webhooks`, `check-aliases`, `staged`, `staged-retention`, `runtime`, `history`, `review-decisions`, `review-links`, or `source-retention`. They get the generic text "A service operation needs attention" (line 195).
  - `operations/snapshot-retention.ts:232-235`: `retireSourceBaselines` pushes to `report.attention`, but it records no event and writes no log. The sibling steps record one.
- What happens: an operator sees a generic line for nine live alert kinds. The code keeps texts for kinds that cannot occur.
- Impact: weaker guidance at the moment it is needed. A typo in a kind compiles.
- Recommendation: one typed registry that both the Worker and the view import.

  ```ts
  export const alertKinds = {
    "check-delivery": { codes: ["ambiguous", "exhausted"], subject: "check" },
    webhooks: { codes: ["reconciliation-failed"], subject: "scheduler" },
    // …
  } as const;
  export type AlertKind = keyof typeof alertKinds;
  ```

- Alternatives:
  - Minimal: add the nine missing texts, and remove the three stale ones.
  - Generate the texts from `operations/README.md` sections, so that the guide link can target an anchor for each kind.
- Maintainer decision needed: no.

### OPS-19 · The operations guide does not match the code

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `operations/README.md:3`: "the compare Worker consumes work and publishes a status wakeup." `apps/compare/README.md:5`: "This Worker has no queue handler or cron." `apps/compare/src/index.ts:4-8` exports only `fetch`.
  - `operations/README.md:8`: `await operationsQueue.send({ kind: "status", comparisonId });`. The consumer does not read `comparisonId` (OPS-12).
  - `operations/README.md:12`: "preserve the committed preview and production budgets". Preview runs no operations (`runtime.ts:311-312`).
  - `components/operations-attention/index.tsx:456` links every alert to this README as "the operations and recovery guide". The README has no list of message kinds and steps, no alert list, no cursor list, and no procedure for an alert (OPS-15).
  - `docs/evidence/diagnostic-check-rename-repair.md:9` links to a tooling directory that does not exist.
  - `apps/compare/wrangler.jsonc:51-58` declares an `OPERATIONS` producer for the compare Worker. `apps/compare/src` has no reference to `OPERATIONS`, `env.DB`, or `env.IMAGES` (search). `apps/compare/README.md:18` says the bindings are retained on purpose.
  - `.github/workflows/deploy.yml:324-331` repeats the consumer settings as a literal. A settings change needs an edit in two files.
- What happens: the document that the product names as the recovery guide is mostly a history of retirements. The current behavior must be read from code.
- Impact: slower onboarding and slower incident response.
- Recommendation: split the README into (1) "How operations run now" (triggers, kinds, steps, alerts with one recovery paragraph each, cursors) and (2) a dated history file. The map in this report can seed part (1).
- Alternatives:
  - Minimal: correct the three wrong statements, and add a table of alert kinds with actions.
- Maintainer decision needed: no.

### OPS-20 · Operation modules repeat the same plumbing in different ways

- Kind: simplification
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence (counts from searches, M9):
  - The cursor write `INSERT INTO operations_cursors(id,value) VALUES(…) ON CONFLICT(id) DO UPDATE SET value=excluded.value …` appears 11 times in 8 files. The cursor read appears 10 times in 7 files. Only `operations/snapshot-retention.ts:14-28` has local helpers (`afterCursor`, `saveCursor`).
  - The line `const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };` appears 13 times in 11 files.
  - Paging differs: a cursor by ID (`operations/snapshot-retention.ts`, `operations/closed-summary.ts`, `operations/review-links.ts`, `apps/web/src/profiles.ts`); a cursor with a fixed frontier (`operations/promotions.ts:124-191`); no cursor, with `ORDER BY closed_at,id LIMIT` (`operations/retention.ts:50-57`). In the last one, a candidate with an unsafe prefix is never claimed (`operations/retention.ts:65-75`) and stays at the head of each page.
  - Clock: the operations use `context.now()`. The reconcilers called from the same pass use `Date.now()` directly (20 uses in `api/workflow-materialize.ts`, 16 in `api/pre-run-checks.ts`, 10 in `runtime.ts`).
  - Assertions: `operations/retention.ts:117-120` writes its own `INSERT INTO visonaut_assertions(valid) SELECT CASE …` in place of `assertion()` (`packages/service/src/database.ts:44-51`; the comment at line 57 notes this).
  - GitHub requests: `operations/github-deliveries.ts:143-164` has its own request helper with API version `2026-03-10`. `packages/security/src/github.ts:68` uses `2022-11-28`.
  - Project check: three versions: `assertOperationsProject` (`runtime.ts:184-197`), the same query in `operationsStatus` (`api/operations.ts:16-29`), and `assertConfiguredProject` (`api/context.ts:128-141`).
  - Receiver URL: recovery accepts only `${origin}/v1/webhooks` (`operations/github-deliveries.ts:170`). The API also serves `/webhooks/github` (`api/index.ts:127`).
- What happens: each new step copies about 20 lines of plumbing and picks its own rules for paging, events, and time.
- Impact: more code to review, and small behavior differences that are hard to see (OPS-07, OPS-12, OPS-18).
- Recommendation: a small step kit in `operations/common.ts`.

  ```ts
  export function emptyReport(): OperationReport { … }
  export async function readCursor(database: Database, id: string): Promise<string> { … }
  export async function writeCursor(database: Database, id: string, value: string | null) { … }
  // Pages by ID, calls `each` in a try/catch, records and resolves one event kind.
  export async function pageById<Row extends { id: string }>(options: {
    context: OperationsContext; cursor: string; kind: string;
    select: (after: string, limit: number) => Promise<Row[]>;
    each: (row: Row) => Promise<"completed" | "deferred">;
  }): Promise<OperationReport> { … }
  ```

- Alternatives:
  - Minimal: only `emptyReport`, `readCursor`, `writeCursor`.
  - No shared kit. Write the rules (paging, events, clock) as a short section in the README, and enforce them in review.
- Maintainer decision needed: no.

## Measurements (command, raw result, limits)

All measurement files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/operations/`. The `*.measure.ts` files import repository source by absolute path. They run with the repository Vitest binary and a scratch config. `harness.ts` wraps the repository `TestDatabase` (`apps/web/src/operations/test-fixtures.ts`) and counts round trips and statements.

Common command form:

```sh
/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel/node_modules/.bin/vitest run \
  --config /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/operations/vitest.config.mjs <name>
```

Limits for all local measurements: SQLite in memory through `node:sqlite` (Node 24.18.0), not D1. One project. GitHub is a stub. R2 is the in-memory fixture store. Times are local CPU times. A round trip is one `first`, `all`, or `run` call, or one `batch`.

- **M1, idle pass.** `idle-pass.measure.ts` → `results-idle-pass.json`. It calls the real `runScheduledOperations`.

  ```
  recovery_idle_0_deliveries    roundTrips 83   statements 89   writeStatements 49   github 2  r2 0  events-table scans 29
  recovery_idle_100_deliveries  roundTrips 383  statements 389  writeStatements 249  github 2  r2 0  events-table scans 129
  recovery_idle_100_deliveries_20000_events  same counts; local 61.8 ms (8.7 ms with 0 events)
  status_idle                   roundTrips 32   statements 32   events-table scans 6
  ingest_idle                   roundTrips 18   statements 24   events-table scans 11
  maintenance history / retention / profiles   6 / 17 / 5 round trips
  ```

  "Write statements" are `INSERT`, `UPDATE`, or `DELETE` statements. Most of them change no row when idle. D1 bills rows written, not statements.

- **M2, cost of each component.** `per-step.measure.ts` → `results-per-step.json`. Round trips / statements / write statements:

  ```
  1/1/0        assertOperationsProject
  3/3/2        monitorDatabaseCapacity
  303/303/202  recoverGitHubDeliveries (100 successful deliveries)
  1/1/0        reconcileWebhooks
  1/1/0        retireUnpinnedMainChecks
  1/1/0        reconcileEquivalentPullRequestChecks
  3/3/2        reconcileStagedWorkflows
  2/2/0        expireStagedAttempts
  1/1/0        retireReplacedMainRuns
  2/8/7        Service.reconcileComparisons (includes expireHistoricalPreparations)
  6/6/5        reportComparisonRecovery
  1/1/0        processReviewQueue
  15/15/7      deliverGitHubStatuses
  4/4/1        publishReviewLinks
  6/6/2        promoteBaselines
  3/3/1        summarizeClosedRuns
  3/3/1        expireComparisonReferences
  3/3/1        retireSourceBaselines
  3/3/1        expireSnapshotImages
  1/1/0        expireRunImages
  2/2/0        pruneCaptureProfiles
  1/1/0        expireExports
  total 366 round trips; the pass adds 17 alert updates (10 + 7) = 383
  ```

- **M3, review-link walk.** `review-links-walk.measure.ts` → `results-review-links-walk.json`. It seeds N finished pull-request checks in the head-check shape, sends one `recovery` message, and processes every continuation in order. The result table is in OPS-04. Limit: the rows are `docs_complete` checks. Legacy mirror rows were not tested.

- **M4, alert and check behavior.** `alerts.measure.ts` → `results-alerts.json`. Three cases with the repository fixtures `context` and `reserve`:
  - `checksKindCollision`: `"before": {"resolved_at": null}`, `"after": {"resolved_at": 1790035200001}`.
  - `readFailureBecomesAmbiguous`: values quoted in OPS-01.
  - `ambiguousHotLoop`: values quoted in OPS-02.
  - Limit: the GitHub client is the fixture stub. The read failure is injected by a wrapper around `github.request`.

- **M5, chain growth.** `chain-growth.measure.ts` → `results-chain-growth.json`. Real `runScheduledOperations`, a simulated queue, 6 cron ticks, and an assumed capacity of 40 messages for each interval. `queueDepthAtEndOfInterval`: 1, 2, 3, 4, 5, 6. `statusPasses`: 234. `averageD1RoundTripsPerStatusPass`: 33. Limit: the 40-message capacity is an assumption. The growth of one chain for each tick does not depend on it.

- **M6, query plans and scan steps.**
  - `node plans.mjs` → `results-plans.json`: `EXPLAIN QUERY PLAN` for 13 scheduled statements on the schema of all migrations, plus the index list. Quoted in OPS-03, OPS-05, OPS-16.
  - `node seed-scale-db.mjs 1000`, then `sqlite3 scale-1000.db ".read scale-stats.sql"` (the system `sqlite3`): for the seed insert of `operations/checks.ts:46-51`, `Fullscan Steps: 999999`, `Virtual Machine Steps: 4021088`.
  - `sqlite3 scale-1000.db ".read scale-alternatives.sql"` → `results-scale-alternatives.txt`:

    ```
    A. current predicate                      Fullscan Steps 999999   VM steps 4021022
    B. IN (… driven by the project row)       Fullscan Steps 999      VM steps 14034
    C. UNION of two indexed reads             Fullscan Steps 0        VM steps 52
    D. current + index on snapshots(run_id)   Fullscan Steps 999      VM steps 27021
    ```

  - Limit: the planner had no `sqlite_stat1` data. D1 can choose another plan if statistics exist there.

- **M7, growth with history.** `scale.measure.ts` → `results-scale.json`. It seeds N accepted main runs, each with a snapshot, a completed check, and delivered status rows. Then it times one `status` pass of `runOperations`.

  ```
  accepted runs:         0     250    500    1000    2000    4000
  status pass, local ms  0.9   4.6    14.8   63.1    210.2   828.2
  D1 round trips         30    30     30     30      30      30
  ```

  Limit: local SQLite time. The shape (×4 for ×2 rows) is the result, not the absolute values.

- **M8, alert life cycle.** `stuck-alerts.measure.ts` → `results-stuck-alerts.json`. Values quoted in OPS-06 and OPS-07. Limit: the `upstream-webhook` and `staged-reconciliation` rows in the first case are not a faithful test, because that case runs only `runOperations`. Their life cycle is from code reading.

- **M9, searches.** `rg` over `apps/`, `packages/`, `.github/`, and `tooling/`, with tests and Markdown excluded, for callers of the functions named in OPS-13, OPS-14, and OPS-15, and for the duplicate counts in OPS-17 and OPS-20. `wc -l` for the line counts.

- **External facts read on 2026-10-05** (documentation pages, not measurements): GitHub keeps webhook deliveries for 3 days. Cloudflare D1 on the Workers Paid plan: "First 25 billion / month included + $0.001 / million rows" read, "First 50 million / month included + $1.00 / million rows" written, and a scan counts every scanned row. A dead-letter queue without a consumer keeps messages for 4 days. A queue consumer invocation is limited to 15 minutes.

- **Production records quoted from the repository** (not measured by me): `docs/evidence/capacity-admission-20260928.md`, `docs/evidence/checks-7710/README.md`, `docs/evidence/diagnostic-check-rename-repair.md`.

## Open questions and items not verified

1. Production row counts are unknown to me: `visonaut_runs` (accepted and total), `visonaut_snapshots`, `pre_run_checks` (pull requests with a bound check), `operations_events` (total and unresolved), `github_webhook_delivery`. They decide how urgent OPS-03, OPS-04, and OPS-16 are. One read-only query for each table gives the answer.
2. Is a check ambiguous in production now? `SELECT id FROM work_checks WHERE ambiguous=1`. If yes, OPS-02 can be active.
3. D1 round-trip latency from the Worker is not measured. All cost statements use counts, not time.
4. The real duration of a `recovery` pass and the queue wait of `status` messages in production are not measured. Workers Logs has `operations_pass.elapsedMs`. The wait needs the new field from OPS-08.
5. The number of GitHub delivery pages in the 3-day window is unknown. It decides the detection delay in OPS-05.
6. The platform default for a queue retry without `retry_delay` was not confirmed from the documentation (OPS-09).
7. I did not verify that a higher `max_concurrency` is safe (OPS-11). Leases exist for most work. Cursor writes have none.
8. `reconcileEquivalentPullRequestChecks` (`api/pre-run-checks.ts:194-391`) may also be transition-only work, now that checks are created on the pull-request head. I did not prove it. It is not in the table of OPS-13.
9. Whether the baseline cutover to a fresh database (`docs/current-contract.md:28`) was done in production is not known to me. It changes the current sizes for question 1.
10. `apps/compare` keeps D1, R2, and `OPERATIONS` bindings that its source does not use (OPS-19). The compare lane owns that decision.
11. The D1 cost projection in OPS-03 is computed from measured scan steps and pass counts, with assumed table sizes. It is not an observed cost.
12. The Write tool of this harness refused a file named `report.md` ("Subagents should return findings as text"). The task and the output schema require that path, so I wrote the same content to `operations-lane-body.txt` and copied it to `report.md` with a shell command.
