# Verification of the lane "Scheduled operations, queue, alerts, and recovery"

Verified file: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/operations/report.md`.
Repository root: `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`. Paths below are relative to this root. Paths that start with `operations/` or `api/` are in `apps/web/src/`.

## Method

- I opened each cited file and compared the quoted text and line numbers.
- I copied the auditor's measurement scripts to `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/operations/verify/`, changed only the output paths, and ran them again with the repository Vitest binary and the system `sqlite3`. All re-run files are in that directory (`results-*.json`).
- I added three measurements of my own: `planA.sql` on an analyzed copy and on a "retired runs" copy of the scratch database, and `token-mint.measure.ts`.
- I read these platform pages on 2026-10-05:
  - Cloudflare Queues dead-letter queues: https://developers.cloudflare.com/queues/configuration/dead-letter-queues/
  - Cloudflare Queues batching and retries: https://developers.cloudflare.com/queues/configuration/batching-retries/
  - Cloudflare Queues limits: https://developers.cloudflare.com/queues/platform/limits/
  - Cloudflare D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
  - Cloudflare D1 SQL statements (`PRAGMA optimize`): https://developers.cloudflare.com/d1/sql-api/sql-statements/
  - Wrangler configuration (`keep_vars`, `retry_delay`, inheritable keys): https://developers.cloudflare.com/workers/wrangler/configuration/
  - GitHub webhook deliveries: https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries
- This verification changed no repository file. It made no remote call to Cloudflare or GitHub APIs.

Re-run results that match the report exactly:

```
idle pass          recovery 83 / 383 round trips, status 32, ingest 18, maintenance 6 / 17 / 5
per step           recoverGitHubDeliveries (100 successful deliveries) 303 round trips, 202 write statements
review-link walk   0, 24 PRs: 1 pass; 25: 2; 100: 5; 500: 21; 1,000: 41 passes (1,363 round trips)
chain growth       queue depth 1, 2, 3, 4, 5, 6; 234 status passes; 33 round trips each; occurrences 241
alerts             checks collision: resolved_at null -> 1790035200001; read failure: ambiguous 1, patches 1
stuck alerts       6 listed before and after 10 passes; runtime alert unresolved 1 -> 0 after one status pass
scan steps         A 999999, B 999, C 0, D 999 (sqlite3 3.51.0)
```

## Summary table

| ID     | Verdict                                 | Auditor severity | My severity |
| ------ | --------------------------------------- | ---------------- | ----------- |
| OPS-01 | confirmed                               | high             | high        |
| OPS-02 | confirmed                               | high             | high        |
| OPS-03 | partly-confirmed                        | medium           | low         |
| OPS-04 | confirmed                               | medium           | medium      |
| OPS-05 | confirmed                               | medium           | medium      |
| OPS-06 | confirmed                               | medium           | low         |
| OPS-07 | partly-confirmed                        | medium           | medium      |
| OPS-08 | confirmed                               | medium           | medium      |
| OPS-09 | confirmed                               | medium           | medium      |
| OPS-10 | confirmed                               | medium           | medium      |
| OPS-11 | confirmed (facts); options are judgment | medium           | medium      |
| OPS-12 | confirmed                               | low              | low         |
| OPS-13 | confirmed                               | low              | low         |
| OPS-14 | confirmed                               | low              | low         |
| OPS-15 | confirmed                               | medium           | low         |
| OPS-16 | partly-confirmed                        | medium           | low         |
| OPS-17 | confirmed                               | low              | low         |
| OPS-18 | confirmed                               | low              | low         |
| OPS-19 | confirmed                               | low              | low         |
| OPS-20 | confirmed                               | low              | low         |

No finding is refuted. Three findings need a correction that changes their weight (OPS-03, OPS-07, OPS-16). Two recommendations have a defect that makes the suggested code not work as written (OPS-01, OPS-02).

## OPS-01 · A failed GitHub read marks a check "ambiguous" forever

Verdict: **confirmed**. Severity: **high**.

Proof that I checked:

- `packages/service/src/work.ts:491-499` sets `request_started = 1` before the sender runs. `work.ts:538-548` turns every sender error into `ambiguous = 1`.
- `packages/security/src/checks.ts:173` reads the check first. The `PATCH` is at `checks.ts:191`. The identity error is at `checks.ts:176-187`.
- A search for `settleStatus`, `ambiguous = 0`, and `ambiguous=0` in non-test source finds only `work.ts`. Only `settleStatus` (`work.ts:598`) clears the flag. Its callers are `deliverStatus` and the abandoned-lease path that needs `request_started = 0` (`work.ts:635-652`).
- The same pattern is in the legacy mirror sender (`operations/review-links.ts:346-359`: a `GET`, then a `throw`, before the `PATCH`).
- Re-run of `alerts.measure.ts`: `"failedReads": 1`, `"patchesAfterFailure": 1`, sender `{"ambiguous":1,"request_started":1,"leased":1,"desired_revision":2,"delivered_revision":1}`. Five later passes: `"attention":["1"],"completed":[]`, `"patchesAtEnd": 1`.
- `docs/evidence/diagnostic-check-rename-repair.md:5-7` records the production case. `apps/web/tooling/check-rename-repair` is not in the tree (`ls apps/web/tooling` shows 5 other directories).
- I found no contract rule that requires a lock for a failure before the write. `work.ts:569-572` requires proof "that no request can still write". A failed `GET` in the same invocation is that proof.

What the auditor missed (it makes the finding worse):

1. **One failed token request locks every ready check of the pass.** `apps/web/src/runtime.ts:163-171` creates the GitHub client lazily. If the installation-token request fails, each delivery of the pass fails at its first request, after `request_started = 1`. Measured with `verify/token-mint.measure.ts` (real `operationsContext`, only `POST /app/installations/34/access_tokens` returns 502):

   ```json
   "before": { "checks": 5, "ambiguous": 0 },
   "githubCalls": [ { "method": "POST", "path": "/app/installations/34/access_tokens" }, … ],
   "after": { "checks": 5, "ambiguous": 5, "started": 5 },
   "lastErrors": [ { "last_error": "SecurityError: GitHub verification is temporarily unavailable." } ]
   ```

   In production the bound is `tasksPerStep` = 25 checks for each pass.

2. **An ambiguous sender also blocks a rerun of the same commit.** `api/pre-run-attempts.ts:636-643` throws `check_pending` (503, "The prior check delivery is still pending.") when `request_started=1 OR ambiguous=1`. `api/pre-run-attempts.ts:83-102` has the same guard.

Corrections to the text:

- "blocks a merge until a maintainer repairs D1 by hand" is too wide. The lock is for one GitHub check, which belongs to one tested commit. A new commit gets a new `pre_run_checks` row and a new check (`api/pre-run-checks.ts:626-651`). I did not test this path end to end. The same commit stays blocked.

Corrections to the recommendation:

- The sender contract already has a "nothing was written" result: `send` returns `void | "not-sent"` (`work.ts:467`), and `deliverStatus` settles it (`work.ts:528-536`). A new error class is not necessary. The smallest change is in the two senders:

  ```ts
  // packages/security/src/checks.ts (same idea in operations/review-links.ts)
  let existing: Record<string, unknown>;
  try {
    existing = record(await github.request(path));
  } catch {
    return "not-sent"; // No write request exists. The outbox row returns to pending.
  }
  ```

- **A retry delay is necessary.** `settleStatus` sets `available_at` to the present time (`work.ts:581`), and a `deferred` outcome sets `hasMore` (`operations/checks.ts:347-349`), which sends a continuation after 1 second (`runtime.ts:454`). With `maxAttempts: 5`, a GitHub fault of a few seconds uses all 5 attempts and the row becomes `dead`. A `dead` row recovers only when a newer revision arrives. Add a delay to `available_at` for this outcome, or do not request a continuation for `deferred`.
- The "Minimal" alternative (move `request_started = 1` to the moment before the `PATCH`) is not a small change. `isStatusCurrent` requires `request_started = 1` (`work.ts:479`) and the senders call it before the `PATCH`.
- The swallowed error must still be stored (for example in `work_status_outbox.last_error`), or the cause is lost (see OPS-08).

## OPS-02 · An ambiguous check with a newer status starts an endless `status` loop

Verdict: **confirmed**. Severity: **high**.

Proof that I checked:

- `packages/service/src/work.ts:673-691`: the attention query joins the outbox row of `desired_revision`. For an ambiguous check with a newer intent, the row has `ambiguous = 1` and `state = 'pending'`.
- `operations/checks.ts:258-266` returns `"attention"` and changes nothing. `operations/checks.ts:347-349` counts every `pending` item that is not `"skipped"` as more work.
- `apps/web/src/runtime.ts:446-454` sends a new `status` message from each `recovery` pass and from each `status` pass.
- Re-run of `alerts.measure.ts`: six `status` passes, each `"checksHasMore": true, "passHasMore": true`; outbox revision 2 `sending`, revision 3 `pending`, `attempts: 0`.
- Re-run of `chain-growth.measure.ts`: queue depth 1, 2, 3, 4, 5, 6; 234 passes; 33 round trips each.
- The precondition was real in production: `docs/evidence/diagnostic-check-rename-repair.md:7` records locks at revision 47 with `ambiguous=1` while "Five active runs wanted revision 243 (four `pending`, one `failure`)".
- The loop does not stop when the run closes. `obsoleteCheckDeliverySql` needs `sender.ambiguous=0` (`operations/check-state.ts:12-13`), so an ambiguous check is never obsolete.

Corrections to the recommendation:

- The `hasMore` change is correct. I checked that a `deferred` outcome cannot loop without limit: `claimStatus` adds one attempt each time (`work.ts:452`) and `settleStatus` ends at `dead`.
- **The hop bound does not work as written.** `operationsMessage` builds a new object and drops unknown fields (`packages/service/src/work.ts:8-28`). The queue handler uses that decoded object (`apps/web/src/server.ts:159-161`). `hop` is then always `undefined`. The decoder must copy the field:

  ```ts
  // packages/service/src/work.ts
  if (value.kind === "status") {
    const hop =
      "hop" in value && Number.isSafeInteger(value.hop) ? { hop: value.hop as number } : {};
    return { kind: "status", ...comparison, ...hop };
  }
  ```

## OPS-03 · Two statements in each `status` pass read (accepted runs × snapshots) rows

Verdict: **partly-confirmed**. Severity: **low** (auditor: medium).

Confirmed:

- The predicate text (`packages/service/src/review-status.ts:25-27`) and its uses (`operations/checks.ts:48, 65, 73, 155, 205`, `operations/check-state.ts:22, 27`).
- No index on `visonaut_snapshots(run_id)` (schema dump with `verify/schema.mjs`).
- The plan and the scan steps without planner statistics: `SCAN run` / `CORRELATED SCALAR SUBQUERY` / `SCAN snapshot`; `Fullscan Steps: 999999` for 1,000 accepted runs and 1,000 snapshots. The alternatives B, C, D give 999, 0, 999.
- Re-run of `scale.measure.ts`: 0.9, 4.5, 14.8, 56.3, 209.6, 815.1 ms for 0 to 4,000 runs (local SQLite).

Corrections:

1. **The number of accepted runs does not grow without limit.** Only a promoted main run gets `state='accepted'` (`packages/service/src/baseline-promotion.ts:465`). `retireSnapshot` moves an old accepted run to `superseded` (`packages/service/src/retention.ts:98-104`). The step `source-retention` calls it for each source snapshot whose run closed more than 30 days ago and that is not the baseline (`operations/snapshot-retention.ts:194-215`). The subquery runs only for `state='accepted'` rows. Measured on the scratch database with 100 accepted and 900 superseded runs:

   ```
   Fullscan Steps:                      100899
   ```

   So the cost is (accepted runs of about the last 30 days) × (all snapshots), plus one scan of all runs. It is linear in the history, not quadratic. The sentence "Accepted runs and snapshots are never deleted" is true for rows, but it does not give the growth that the finding states.

2. **Planner statistics remove the problem without a code change.** On an analyzed copy (`sqlite3 scale-1000-analyzed.db "ANALYZE;"`), the same statement uses `SCAN project` / `SEARCH snapshot USING INDEX … (id=?)`:

   ```
   Fullscan Steps:                      999
   Virtual Machine Steps:               25015
   ```

   The repository has no `ANALYZE` or `PRAGMA optimize` (search: no result). Cloudflare documents `PRAGMA optimize` for D1 and recommends it after schema changes. I do not know if the production database has statistics. The auditor stated this limit.

3. **The production size is small today.** `docs/current-contract.md:236`: "Baseline revision 27 is unchanged." Each promotion adds 1 to `baseline_revision` (`packages/service/src/baseline-promotion.ts:458`). So production had about 27 baseline changes on 2026-10-02. This is an inference from the document, not a production read.
4. The projection "about 23.6 billion rows each day" uses 1,000 accepted runs and 1,000 pull requests. Corrections 1 and 3 do not support these inputs. Remove the projection.

Recommendation check: the rewritten predicate (option B) is correct and safe, and it does not depend on statistics. It is still the right fix. `PRAGMA optimize` is an additional option.

## OPS-04 · The `review-links` step pages through every pull request on every cron tick

Verdict: **confirmed**. Severity: **medium**.

Proof that I checked:

- `operations/review-links.ts:46-61`: no state filter and no time filter. `:173-174`: current head checks are skipped after they are paged. `:406`: `report.hasMore = rows.length === context.budget.tasksPerStep;`. `:407-412`: the cursor returns to the start after the last page.
- `apps/web/src/runtime.ts:446-454` sends the `status` continuation.
- No `DELETE FROM pre_run_checks` exists in non-test source.
- Re-run of `review-links-walk.measure.ts`: the pass counts and round trips match the table in the report.
- The plan of the candidate query has `USE TEMP B-TREE` and `SCAN ranked` (`verify/results-plans.json`). The window function ranks all matching rows before `pullRequestNumber>?` applies. So each page also reads all pull-request rows.

Recommendation check: the added filter is valid SQL at that position (the outer `SELECT * FROM ranked WHERE position=1 …`) and it is the exact negation of the JavaScript `continue`. `currentCandidate` (`review-links.ts:74-79`) uses the same base SQL without the filter, which is correct. The fix does not stop paging for legacy rows whose verdict is stable (`review-links.ts:204`). The alternative "no continuation when the page did no work" covers that case.

## OPS-05 · Webhook delivery recovery runs 3 D1 statements for each listed delivery

Verdict: **confirmed**. Severity: **medium**.

Proof that I checked:

- `operations/github-deliveries.ts:229-246` (receipt `SELECT`, `UPDATE github_webhook_recovery`, `resolveEvents`), `:165-179` (`GET /app/hook/config` in each pass), `:186-210` (one page for each pass; the stored cursor is the `rel="next"` cursor).
- Re-run of `per-step.measure.ts`: 303 round trips, 202 write statements.
- GitHub: "You can view details about webhook deliveries from the past 3 days."
- `docs/evidence/capacity-admission-20260928.md:7`: 30,566 delivery rows.

Corrections:

- The cost unit matters. D1 bills rows read and rows written, not statements. The 200 "write statements" change 0 rows. The real costs are consumer time (300 sequential round trips in the single consumer) and the detection delay.
- The detection delay is the stronger half of this finding. `docs/current-contract.md:186` promises "bounded failed-delivery recovery". The bound is (pages in 3 days) × 5 minutes. Example with an assumed 10,000 deliveries in 3 days: 100 pages, so about 8 hours. The production page count is not known.

Corrections to the recommendation (the sketch has three defects):

1. It must keep the "newest entry for each GUID" rule (`github-deliveries.ts:213-217`). GitHub lists a redelivery with the same GUID. A filter on `failed` without this rule treats an old failed attempt as open after a successful redelivery.
2. It must keep the restored-GUID skip (`github-deliveries.ts:234-235`).
3. The batched `UPDATE … WHERE guid IN (…)` uses all GUIDs of the page. It must use only the GUIDs that are received or 2xx. Otherwise it sets `resolved_at` on rows that are still in recovery.

`json_each` is available in D1. The repository already uses it (`packages/service/src/prune.ts:26`).

## OPS-06 · Two alerts are resolved by an operation that did not fix them

Verdict: **confirmed**. Severity: **low** (auditor: medium).

Proof that I checked:

- `apps/web/src/runtime.ts:371` (`["checks", retireUnpinnedMainChecks]`), `operations/index.ts:49` and `:80`, `operations/common.ts:37` (match on kind and subject only).
- `apps/web/src/runtime.ts:455` runs at the end of each successful pass of each kind.
- Re-run: `"resolvedByRunOperations": true`; runtime alert `unresolved: 1` → `0` after one idle `status` pass.

Why I lowered the severity:

- (a) affects only `retireUnpinnedMainChecks`. This is a transition operation (see OPS-13).
- (b) is a flap, not a permanent loss. Each failed attempt records the alert again (`apps/web/src/server.ts:164-166`, `operations/common.ts:23-24` clears `resolved_at`). With `max_retries: 5` and a 60-second delay, a failing `recovery` message records the alert about once each minute. `first_seen_at` and `occurrences` are kept.

Recommendation check: the rename and the per-kind code are correct. If the code changes to `${message.kind}-failed`, `reportSchedulerFailure` must get the kind too, and the Service view must map the new codes.

## OPS-07 · Several alerts never clear, and one alert fires for normal retries

Verdict: **partly-confirmed**. Severity: **medium**.

Confirmed:

- `check-creation` is resolved only at `operations/checks.ts:118` and `:170`. `promotion` is resolved only at `operations/promotions.ts:351` and `:413`. `state-changed` is recorded for `ConflictError` and `IncompleteError` (`promotions.ts:421-430`).
- Re-run of `stuck-alerts.measure.ts`: the same 6 alerts are listed before and after 10 passes.
- `upstream-webhook:<guid>:redelivery-exhausted` is resolved only at `operations/github-deliveries.ts:236-245`, when the delivery is on a fetched page.
- The noise alert. Trusted Submit sends `ingest` while its own job still runs (`api/workflow-owned.ts:1279`). Materialization needs that job as `completed` and `success` (`api/workflow-reconcile.ts:94-112`). So the first pass can fail by design, and `runtime.ts:387-396` records `staged:scheduler:reconciliation-failed`. This is code reading, not a measurement.

Corrections:

- The list of resolvers for `staged-reconciliation` is not complete. There are two more: the "failed App check is terminal" sweep (`api/workflow-materialize.ts:857-869`) and `resolveSupersededStagedAlerts` (`operations/staged-alerts.ts:41-51`, called from `operations/comparison-alerts.ts:19` in each `recovery` and `ingest` pass). They do not cover `expired-incomplete`, because that run has `state='failed'` and `active=0` (`packages/service/src/run-retirement.ts:109-113`), and the sweeps need `superseded` or an unmaterialized run. So the claim for `expired-incomplete` stays correct.
- `check-creation` alerts are mostly not reachable in the current path. A run with a pre-created check gets its row as `complete` at admission (`packages/service/src/run-admission.ts:202-206`). The stale-alert risk for this kind is small.

Recommendation check: the sweep SQL is valid. One risk needs the maintainer decision that the auditor asked for: `check-creation:<run>:ambiguous` for a closed run can mean a GitHub check that stays `in_progress`. An automatic resolve hides that.

## OPS-08 · A failed pass leaves no cause in the logs, and log shapes differ

Verdict: **confirmed**. Severity: **medium**.

Proof that I checked: `apps/web/src/server.ts:164-167`, `operations/index.ts:81-88` and `:103-108`, `apps/web/src/runtime.ts:380`, `:397-403`, `:422-429`, `:476-477`, `operations/failure.ts:13-25`. A search for `event: "…"` confirms the mix of kebab-case and snake_case names, and the three duration field names.

Corrections:

- Some causes are stored in D1, not in logs. `deliverStatus` writes `String(error)` to `work_status_outbox.last_error` (`packages/service/src/work.ts:543-546`). The error text of the 2026-09-22 incident came from that column (`docs/evidence/diagnostic-check-rename-repair.md:7`). The archived Worker bundle was used to prove that no `PATCH` was sent, not to find the error. The impact sentence must say this.
- A step failure in `runOperations` has no such column. The finding is correct for those.
- Contract limit for the recommendation: `docs/current-contract.md:81` says "No request body, token, URL, SQL, raw exception, or private label is added to that log." An error class name and an upstream HTTP status are not a raw exception, but the maintainer must decide. The auditor asked for this decision.
- `queueWaitMs` from `message.timestamp` is feasible. Cloudflare `Message` has `timestamp` and `attempts`.

## OPS-09 · A stopped scheduler, a dead-lettered message, or a killed pass raises no signal

Verdict: **confirmed**. Severity: **medium**.

Proof that I checked: `api/operations.ts:51`, `apps/web/src/components/operations-attention/index.tsx:343`, `:389`, `:465`, `apps/web/wrangler.jsonc:98-107` (no `retry_delay`, a dead-letter queue with no consumer in `apps/web/wrangler.jsonc` or `apps/compare/wrangler.jsonc`), `apps/web/src/cutover-fence.ts:10`, `.github/workflows/deploy.yml:324-337`. Cloudflare: "Messages delivered to a DLQ without an active consumer will persist for four (4) days before being deleted from the queue." Queue consumer wall-clock limit: 15 minutes. `retry_delay` is a valid consumer key.

Corrections:

- "The only time of a real pass is the capacity snapshot" is not exact. The same snapshot is also written when a new run is admitted (`apps/web/src/capacity.ts:91-107`, called from `apps/web/src/runtime.ts:270-271`). So "Capacity sampled" is not a scheduler heartbeat at all. This makes the finding stronger.
- A killed pass is not a permanent stop. The message is retried, then dead-lettered, and the next cron tick sends a new `recovery` message. The problem is that no alert is written.
- If `retry_delay` is added, `.github/workflows/deploy.yml:324-331` must change too, because it compares the consumer settings with a literal.

## OPS-10 · Failure isolation is not the same for all parts of a pass

Verdict: **confirmed**. Severity: **medium**.

Proof that I checked: `operations/index.ts:32-46`, `:78-88`, `:96-110`; `operations/main-retirement.ts:24`; `operations/exports.ts:18-26`; `operations/checks.ts:98`, `:210-218`; `operations/review-queue.ts:62`; `api/workflow-materialize.ts:825-826`; `api/webhooks.ts:362-395`.

Corrections:

- "can delay check delivery for every pull request" is true for the loop in `operations/checks.ts:210-218`: one throwing run fails the whole `checks` step in each pass. It is less true for the pre-steps. A `status` message does not run the pre-steps (`operations/index.ts:32`), so check delivery continues through `status` messages. Staged conversion runs before `runOperations` (`apps/web/src/runtime.ts:368-411`), so it also continues.
- The code sketch does not type-check: `expireExports` returns a number (`operations/exports.ts:40`), not an `OperationReport`.

## OPS-11 · One queue with one consumer puts check updates and ingest behind maintenance, and the wait is not measured

Verdict: **confirmed** for the facts. The choice between the options is a **judgment**. Severity: **medium**.

Proof that I checked: `apps/web/wrangler.jsonc:101-103`; `api/review.ts:641-667` (the command runs inline, the check update goes to the queue); `docs/evidence/checks-7710/README.md:43` and `:65` (the quoted intervals and the limit "They do not identify the exact queue occupancy"); `docs/current-contract.md:141` ("One queue with small, named work kinds").

Notes:

- No log holds the queue wait. This is correct.
- "Deliver the status inline" is feasible. Each check has a D1 lease (`claimStatus`), so the queue pass and an inline delivery cannot write the same check twice. It needs a new function for one run; `deliverGitHubStatuses` works on all runs.
- The option "raise `max_concurrency`" also multiplies OPS-02 and OPS-04. Fix those first.

## OPS-12 · Continuation rules are written three times and differ between steps

Verdict: **confirmed**. Severity: **low**.

Proof that I checked: `operations/index.ts:62-72`, `apps/web/src/runtime.ts:434-454`, `packages/service/src/work.ts:1-28`. A search finds no reader of `message.comparisonId`. `git log -S` dates the `continue` decoder to commit `5712036` (2026-09-30). The `hasMore` examples match the cited lines. The first pass of `alerts.measure.ts` shows `"completed": ["1"], "hasMore": true`.

## OPS-13 · Operations for retired features still run in every pass

Verdict: **confirmed**. Severity: **low**.

Proof that I checked: no non-test source inserts into `visonaut_historical_preparations`; `operations/index.ts:45` passes `{ published: [], failed: [] }`; `kind: "compare"` is produced only in `apps/web/tooling/queue-recovery/worker.mjs:33, 98`; `api/pre-run-checks.ts:84-89` has no `LIMIT`, and `:97` skips a pinned commit without a count toward the limit.

Contract note: `docs/current-contract.md:71` says "Keep the unchanged ordinary `expireExports` cleanup while retained records need it." The recommendation (remove only when the production count is zero) agrees with this rule.

## OPS-14 · Almost a quarter of `operations/` source is reachable only from tests

Verdict: **confirmed**. Severity: **low**.

Proof that I checked: a search for the named functions in `apps/`, `packages/`, `.github/` without tests. The archive writer functions are called only from `operations/history.ts`, `operations/history-supplement.ts`, and tests. `reconcileWork` is called only from `apps/web/tooling/queue-recovery/worker.mjs:95`. `wc -l`: `history.ts` 985, `history-supplement.ts` 209, `common.ts` 203; 4,824 non-test lines in `operations/`. My count of test references is 71 lines in 11 files (auditor: 65 in 10). The difference comes from the search pattern.

## OPS-15 · The restore runbook names functions that have no runner

Verdict: **confirmed**. Severity: **low** (auditor: medium).

Proof that I checked: `operations/README.md:80-81`; `operations/recovery.ts:29, 88, 147`; all callers are tests (search of the whole tree without `node_modules`).

Why I lowered the severity: `docs/current-contract.md:244` says "Under O19, hosted restore remains **UNVERIFIED** and is not a required drill." The maintainer accepted this gap in the contract.

Corrections:

- `operations/README.md:82` does say what to do with ambiguous checks after a restore ("Keep checks with ambiguous prior external writes fenced until their requests are proven settled."). It has no procedure for a `check-delivery` alert in normal operation. The part of the finding that links to OPS-01 stays valid.

## OPS-16 · Operational tables only grow; the capacity stop is the only brake

Verdict: **partly-confirmed**. Severity: **low** (auditor: medium).

Confirmed:

- No non-test source has a `DELETE` for the listed tables.
- `operations_events` has only its primary-key index. The three plans are `SCAN operations_events`.
- Re-run: the idle pass with 100 deliveries takes 7.8 ms with 0 events and 54.7 ms with 20,000 resolved events (local).
- Every `check_run` delivery gets a receipt row (`packages/security/src/webhooks.ts:84-96`), and only the Submit job name is used (`api/webhooks.ts:225-233`).

Corrections:

1. **The main cause of the 2026-09-28 stop is already fixed.** `docs/evidence/capacity-admission-20260928.md:7` assigns about 335 MB and 81 MB to webhook JSON bodies. Since commit `339926d` ("Compact processed webhook payloads (#129)", 2026-09-28), each processed delivery is written as `payload_json='{}'` (`api/webhooks.ts:150`, `:172`, `:330-334`; `packages/security/src/webhooks.ts:147`). The row that stays is small. The sentence "a repeat of the 2026-09-28 stop at a later date" needs this context.
2. Deleting receipt identities is against two repository documents: `docs/operations/compact-processed-webhooks.md:3` ("Keep `delivery_id`, `event`, `payload_digest`, `received_at`, and `processed_at` for replay detection and audit") and `docs/evidence/capacity-admission-20260928.md` (last line: "Do not delete receipt identities or unprocessed payloads to reclaim space."). The auditor listed the first one. Deleting run rows is against `operations/README.md:28` ("Closed runs keep their identity …").
3. `operations_events` gets a new row only for a new failure identity. `resolveEvents` for a successful delivery inserts nothing. So the table grows slowly.

The low-cost parts of the recommendation stay valid: resolve by primary key, add a partial index for the alert list, and do not store receipts for `check_run` events that do not match the Submit job.

## OPS-17 · The budget settings cover only part of the limits, and a deploy resets live overrides

Verdict: **confirmed**. Severity: **low**.

Proof that I checked: `apps/web/src/runtime-defaults.ts:20-26`; `tasksPerStep` at 55 places in 21 files (same count); the constants at `operations/promotions.ts:20-21`, `operations/checks.ts:26`, `operations/review-queue.ts:62`, `api/review.ts:650`, `operations/github-deliveries.ts:270, 277`, `api/workflow-materialize.ts:825-826`, `api/workflow-retention.ts:6-7`, `api/pre-run-checks.ts:338, 465, 480`; `apps/web/src/runtime.ts:379, 414`.

Corrections:

- The reset at deploy is known and documented: `docs/current-contract.md:103` ("A future deployment must reconcile live values before applying the committed `{}` values."). `vars` is a non-inheritable Wrangler key, and without `keep_vars` a deploy replaces dashboard values. This part is a description of an accepted rule, not a new defect.
- "Remove the five unused preview variables" is not verified. `apps/web/package.json:10` runs `wrangler types` before `tsc`, and the generated `Env` type comes from `wrangler.jsonc`. A removal can change the type of `env.VISONAUT_API_LIMITS` and the other four names. Test `pnpm --filter … typecheck` before this change.

## OPS-18 · Alert kinds are free text; the Service view maps retired kinds and misses live ones

Verdict: **confirmed**. Severity: **low**.

Proof that I checked: `operations/common.ts:16-27`; the four upsert copies (`operations/common.ts:21-26`, `packages/service/src/comparison-publication.ts:15-21`, `packages/service/src/run-retirement.ts:134-144`, `operations/recovery.ts:77-81`); `apps/web/src/components/operations-attention/index.tsx:98-199`. A search finds `backup` and `backup-retention` only in the view. `operations/snapshot-retention.ts:232-235` records no event.

## OPS-19 · The operations guide does not match the code

Verdict: **confirmed**. Severity: **low**.

Proof that I checked: `operations/README.md:3`, `:8`, `:12`; `apps/compare/README.md:5`; `apps/compare/wrangler.jsonc:51-58`; no `OPERATIONS`, `env.DB`, or `env.IMAGES` in `apps/compare/src`; `.github/workflows/deploy.yml:324-331`.

Correction: `operations/README.md:3` states its own limit: "This runbook describes source behavior before the selected retirements." The document says that it is old. The finding stays valid, because the Service view links to it as "the operations and recovery guide".

## OPS-20 · Operation modules repeat the same plumbing in different ways

Verdict: **confirmed**. Severity: **low**.

Proof that I checked: 11 cursor writes in 8 files (same count). `Date.now()` counts 20, 16, 10 (same). `operations/retention.ts:65-75` and `:117-120`. `operations/github-deliveries.ts:151` (`2026-03-10`) and `packages/security/src/github.ts:67-68` (`2022-11-28`, with the comment "OIDC, lineage, and webhook checks require the supported PR merge_commit_sha contract"). `api/index.ts:127` serves both webhook paths.

Small differences: I count 14 report literals in 12 files (auditor: 13 in 11; mine includes the early return at `apps/web/src/runtime.ts:312`). My pattern for cursor reads gives 17 in 8 files (auditor: 10 in 7). The API version difference in the main client is deliberate (see the comment). These do not change the finding.

## Missed

1. **One failed installation-token request makes every ready check of the pass ambiguous.** `apps/web/src/runtime.ts:163-171` plus `packages/service/src/work.ts:491-548`. Measured: 5 of 5 checks (`verify/results-token-mint.json`). Production bound: 25 for each pass. This belongs with OPS-01.
2. **An ambiguous sender blocks a rerun of the same commit.** `api/pre-run-attempts.ts:83-102` and `:636-643` return 503 `check_pending` while `request_started=1 OR ambiguous=1`. This belongs with OPS-01.
3. **`status` wake-ups are not combined.** Each review command sends one `status` message (`api/review.ts:661`, called at `:876`, `:880`, `:938`), and `max_batch_size: 1` gives one full pass of the four status steps for each message (32 round trips when idle). A fast review of N items gives N passes in sequence.
4. **An `ingest` pass can send two continuations.** `apps/web/src/runtime.ts:432-433` sends `ingest` for `reconcileMore`, and `:454` sends the same message again for `result.hasMore`. Both conditions can be true in one pass, so a chain can branch.
5. **A retried pass can repeat its continuations.** The continuations are sent at `apps/web/src/runtime.ts:432-454`. If the last statement at `:455` fails, the queue handler retries the whole message (`apps/web/src/server.ts:164-166`) and the continuations are sent again. `recovery` messages also have no "already queued" check, so 60-second retries and new cron ticks can overlap.
6. **Pull-request titles are erased by webhook compaction (other lane, found during the OPS-16 check).** `api/webhooks.ts:330-334` writes `payload_json = '{}'` for every processed event, also `pull_request`. The dashboard and the review model read the title from that JSON (`api/dashboard.ts:57-62`, `api/review.ts:288`). The test seeds a processed row that still has its JSON (`api/dashboard.test.ts:46-56`), which production does not have. Code reading, not measured.
7. **The planner has no statistics.** The repository never runs `ANALYZE` or `PRAGMA optimize`. On the scratch database, statistics alone change the plan of the status predicate from 999,999 to 999 scan steps. Other scheduled statements can have the same weakness.
