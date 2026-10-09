# Correctness of decisions, carried approvals, supersession, and promotion under concurrency and failure

Lane: `gap-review-state`. Commit `f83fef6`. Root: `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`. All paths below are relative to this root.

Method. The audit is read-only. I read the state code in `packages/service/src` and its callers in `apps/web/src`. Then I ran each scenario with repository code from a scratch directory: the real `handleApi`, the real `Service`, a real local D1 (Miniflare 5, the complete numbered migrations), two real Better Auth sessions (GitHub users 42 and 43), and a stub for the GitHub API. A small wrapper around D1 lets a probe run one action immediately before a selected write batch. That gives a repeatable race. No repository file was changed. No request went to production. Scripts and raw results are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-review-state/` (`*.probe.ts`, `harness.ts`, `results/*.json`).

Short list of the most important results:

- A decision fails with HTTP 409 when any other write of the project commits in the same moment. Two reviewers on two different rows lost 17 of 40 decisions in a local test (STATE-01).
- A Reject on a carried approval is forgotten at the next push. The next run copies the older approval again and the check is `success` (STATE-02).
- A check that is locked after `success` keeps `success` after Reject. The lock from OPS-01 is not fail-closed (STATE-03).
- The web client always uses the queued path. On that path the conflict answer never names the other reviewer, and a dead task answers 409 forever for its command ID (STATE-04, STATE-05).
- The basic rules hold. No tested state gives `success` while a changed row has no valid approval. Writes are atomic. Command replay is idempotent. Promotion resumes after a stop.

## How it works (map)

### Objects and states

Every guarded write is one `atomic()` batch (`packages/service/src/database.ts:53-69`). A guard is an `assertion(...)` statement. A false guard inserts a row that breaks `CHECK (valid = 1)` (`apps/web/migrations/0001_service.sql:3`), so D1 rolls the batch back.

Two guards are in almost every batch:

```ts
// packages/service/src/run-guards.ts:5-19
projectGuard: "EXISTS (SELECT 1 FROM visonaut_projects WHERE id = ? AND revision = ?)";
activeGuard: "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND active = 1 AND revision = ?)";
```

`touchRunStatusStatements` (`packages/service/src/status-touch.ts:9-24`) adds 1 to the project revision and to the run revision, moves `work_checks.desired_revision`, and inserts one `visonaut_status_outbox` row. Each check-visible write includes it.

Paths in the tables below are in `packages/service/src` unless they start with `api/` or `operations/` (then they are in `apps/web/src`).

**Run** (`visonaut_runs.state`: `uploading`, `comparing`, `reviewing`, `accepted`, `failed`, `superseded`; `active` 0 or 1; `0001_service.sql:27-28`)

| From                                           | To                               | Function                                                   | Trigger                                                                                                                                                                  | Guards                                                                                                                                                          |
| ---------------------------------------------- | -------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| none                                           | `uploading`, active              | `reserveRun` (`run-admission.ts:46-353`)                   | Submit materialization: `workflow_run` webhook (`api/webhooks.ts:273-275`), `ingest` message, cron recovery (`api/workflow-materialize.ts:721`)                          | `projectGuard` (`:114`); no run with the same workflow run and the same or a higher attempt (`:115-119`); capacity (`:212-217`); pre-created check (`:179-201`) |
| active, older attempt of the same workflow run | `superseded`, inactive           | same batch (`run-admission.ts:120-124`)                    | same                                                                                                                                                                     | same                                                                                                                                                            |
| `uploading`                                    | `failed` (stays active)          | `failRun` (`run-admission.ts:703-735`)                     | staged reconciliation gives up (`api/workflow-materialize.ts:938`)                                                                                                       | `projectGuard`, `activeGuard`, not sealed                                                                                                                       |
| `uploading`                                    | `comparing` (sealed)             | `sealRun` (`run-admission.ts:737-801`)                     | materialization                                                                                                                                                          | `activeGuard`; all shards complete; image bytes present                                                                                                         |
| `comparing`                                    | `comparing` with `comparison_id` | `createLocalComparison` (`local-comparison.ts:371-552`)    | materialization or recovery                                                                                                                                              | `:395-470`: `projectGuard`, `activeGuard`, sealed; main: baseline revision and snapshot equal to the receipt                                                    |
| `comparing`                                    | `reviewing`                      | `finalizeComparison` (`local-comparison.ts:563-691`)       | materialization (`api/ingest.ts:60`); `reconcileComparisons` on `ingest` or `recovery` (`operations/index.ts:32-45`)                                                     | `:595-611`                                                                                                                                                      |
| `reviewing` (main, all accepted)               | `accepted`, inactive             | `promote` (`baseline-promotion.ts:348-513`)                | `promotion` step (`operations/promotions.ts:193-456`) on `status` and `recovery` messages                                                                                | `:370-409`                                                                                                                                                      |
| active                                         | `superseded`, inactive           | `retireRun` (`run-retirement.ts:11-78`)                    | `pull_request` webhook: closed, or new head (`api/webhooks.ts:310-323`); merge group destroyed (`:221`); `retireReplacedMainRuns` (`operations/main-retirement.ts:4-30`) | `projectGuard`; run is not the baseline (`:30-34`); for a replaced main run: `activeGuard` and `replacedMainRunSql` (`review-status.ts:4-22`)                   |
| active, not sealed, older than 24 h            | `failed`, inactive               | `expireIncompleteWorkflowRun` (`run-retirement.ts:80-163`) | `expireStagedAttempts` (`api/workflow-retention.ts:129`) on `recovery` or `ingest`                                                                                       | `:89-108`                                                                                                                                                       |

**Comparison** (`state`: `comparing`, `ready`, `invalidated`; `0001_service.sql:118`)

| From                                                                             | To            | Function                                         | Guards                                            |
| -------------------------------------------------------------------------------- | ------------- | ------------------------------------------------ | ------------------------------------------------- |
| none                                                                             | `comparing`   | `createLocalComparison`                          | see above                                         |
| `comparing`                                                                      | `ready`       | `finalizeComparison` (`local-comparison.ts:649`) | state is `comparing`; no `pending` or `error` row |
| any state; the run is active, is not a pull request, and is not the promoted run | `invalidated` | `promote` (`baseline-promotion.ts:486-492`)      | part of the promotion batch                       |

No transition leaves `invalidated` (test: "does not revive an invalidated main comparison in place", `service.test.ts:2440`).

**Row and decision** (`visonaut_comparison_rows.decision_id`, `decision_revision`; `visonaut_decisions`: `verdict`, `kind` human or automatic, `revoked`; `UNIQUE (row_id, revision)`; `0001_service.sql:122-152`)

| From                                 | To                                                                                 | Function                                             | Guards                                                                                                                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no decision, revision 0              | approved, ID `copied:<row>`, revision 1                                            | `finalizeComparison` (`local-comparison.ts:612-624`) | `acceptanceValiditySql` (`:21-37`)                                                                                                                                                                    |
| no decision, introduction or removal | approved, ID `automatic:<row>`, no actor, revision 1                               | `finalizeComparison` (`:625-639`)                    | `eligibleAutomatic` (`:593`): no reservation and no identity history                                                                                                                                  |
| any                                  | human approved or rejected, revision + 1; the previous decision gets `revoked = 1` | `applyReviewCommand` (`review-commands.ts:126-317`)  | `projectGuard` (`:214`); `reviewGuard` (`:104-110`): run active, run revision, sealed, comparison `ready`, no promotion; row revision (`:229-233`); `currentBaselineGuard` (`:112-124`)               |
| decision of command C                | the decision before C (`revoked = 0` again), revision + 1                          | `undoReviewCommand` (`review-commands.ts:319-467`)   | same actor and same review session, not undone, not an Undo (`:340-347`); main: baseline revision (`:353`); no promotion (`:356-364`); the row revision equals the revision that C wrote (`:389-395`) |

**Command** (`visonaut_commands`; `kind` approve, reject, undo). The row is written in the decision batch (`review-commands.ts:272-288`). `commandReplay` (`:68-102`) returns the saved result for the same ID and the same request JSON. A different request with the same ID is a `ConflictError`.

**Review task** (`work_tasks`, `kind = 'review'`, ID `review:<commandId>`; states `queued`, `leased`, `complete`, `dead`; `work.ts:44`)

| From                                      | To                                   | Function                                                                                        | Notes                                                                                             |
| ----------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| none                                      | `queued`                             | `enqueueReview` (`operations/review-queue.ts:25-66`)                                            | guard: comparison `ready`, run active, not archived. `maxAttempts: 5` (`:62`)                     |
| `queued`, or `leased` with an ended lease | `leased`, attempts + 1               | `claimWork` (`work.ts:102-135`)                                                                 | only when the predecessor is `complete` or `dead` (`review-queue.ts:88-91`)                       |
| `leased`                                  | `complete` with the result           | `completeWork` (`work.ts:154-175`)                                                              | also for a refused command: `result = {"error": message}` (`review-queue.ts:135-146`)             |
| `leased`                                  | `queued`, or `dead` after 5 attempts | `failWork` (`work.ts:185-207`)                                                                  | for every error that is not a conflict (`review-queue.ts:147-156`); `retryAt` is the present time |
| any                                       | deleted                              | `compactRunHistory` (`history.ts:166-170`); closed summary (`operations/closed-summary.ts:312`) | closed runs only                                                                                  |

Two workers claim tasks: the request itself in `waitUntil`, with a 30-second lease and only its own command (`api/review.ts:647-654`), and the queue consumer in the `review-decisions` step with the 12-minute lease (`operations/index.ts:48`, `apps/web/src/runtime-defaults.ts:23`).

**Status outbox and check**

| Object                                                             | States                                                                          | Functions                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visonaut_status_outbox`                                           | undelivered, delivered                                                          | written by `touchRunStatusStatements`; closed by `prepareStatusIntent` (`run-status.ts:136-140`)                                                                                                                                                                                                     |
| `work_status_outbox` (one row for each check and project revision) | `pending`, `sending`, `complete`, `obsolete`, `dead`                            | `prepareStatusIntent` (`run-status.ts:82-143`; guards: `projectGuard`, run revision, `statusRunEligibleSql`); `claimStatus`, `deliverStatus`, `settleStatus` (`work.ts:437-614`); the trigger `work_status_identity` forbids a change of a stored intent (`apps/web/migrations/0002_work.sql:48-53`) |
| `work_checks`                                                      | `desired_revision`, `delivered_revision`, lease, `request_started`, `ambiguous` | `deliverStatus` sets `ambiguous = 1` on each error (`work.ts:538-548`). See OPS-01 and OPS-02                                                                                                                                                                                                        |

The sender checks three things immediately before the `PATCH` (`operations/checks.ts:314-317`): the lease, `isStatusIntentCurrent` (`run-status.ts:145-152`: run eligible, same attempt, same project revision, same comparison ordinal), and that the pre-run check is the current one.

**Promotion** (`visonaut_snapshots.state`: `copying`, `accepted`, `revoked`)

| Step             | Function                                                           | Guards                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prepare          | `preparePromotion` (`baseline-promotion.ts:65-206`)                | `readyGuard` (`:22-30`): each changed row has a valid approval, and no review task of this comparison is `queued` or `leased`; comparison `ready` at the current baseline revision; main run only (`:114`) |
| verify originals | `recordSnapshotCopy` or `recordInventoryVerification` (`:295-346`) | snapshot is `copying`                                                                                                                                                                                      |
| promote          | `promote` (`:348-513`)                                             | all guards again, plus `expectedBaselineRevision` and ancestry (`:370-409`)                                                                                                                                |
| cancel           | `cancelPreparedPromotion` (`:208-258`)                             | called for a `copying` snapshot whose run is no longer `passed` (`operations/promotions.ts:212-240`)                                                                                                       |

### Sequence of one decision (as the web client sends it)

1. The client sends `POST /api/comparisons/:id/commands` with `queued: true` and, for the second and later decisions, `previousCommandId` (`apps/web/src/review/client.ts:313-317`, `apps/web/src/review/use-review-session.ts:430-441`).
2. `handleApi` checks the session and the repository permission with access `review` (`api/index.ts:192-205`).
3. The route reads the comparison and the run, reads the body (limit 1 MiB), checks the review session, and calls `enqueueReview` (`api/review.ts:838-877`). The answer is `202 {queued, commandId}`.
4. In `waitUntil` the same request runs `processReviewQueue` for this command only (`api/review.ts:647-654`). That calls `service.review` (`applyReviewCommand`): one read batch, then one write batch with all guards.
5. The request sends one `{kind: "status"}` message (`api/review.ts:661`).
6. The client reads `GET /api/commands/:id/queued` each 500 ms (`review/client.ts:326-336`). The answer is 202 while the task is `queued` or `leased`, 200 with the result and the model when it is `complete`, and 409 when the result is an error or the task is `dead` (`api/review.ts:799-836`).
7. The queue consumer handles the `status` message: `review-decisions`, `checks`, `review-links`, `promotion` (`operations/index.ts:47-62`).
8. `checks` writes a new intent for each run whose intent has an old project revision, then sends `GET` and `PATCH` to GitHub (`operations/checks.ts:200-218`, `packages/security/src/checks.ts:162-215`).
9. For a main run with no pending row, `promotion` verifies the originals and promotes (`operations/promotions.ts:243-456`). Measured: the run was `accepted` after the first `status` pass (M9).

### Rules in plain words

Each rule has one measured example. Raw results: `results/rules-reuse.json` and `results/rules-runs.json`. A row state is written as `verdict/kind@revision`.

1. **An earlier approval is used again** when a row of a new run has exactly the same tuple as an approved decision, and that decision is still the current decision of its own row, and the source run is the same run or has a verified lineage link to the new run (`local-comparison.ts:21-37`). The tuple is: project, item, variant, reference digest, candidate digest, both rendering profile digests, policy digest, engine version, codec version (`local-comparison.ts:203-214`). The copy is made one time, when the comparison becomes `ready`. If more than one decision matches, the oldest wins (`:591`: `ORDER BY decision.created_at, decision.id LIMIT 1`).
   - Example: user 42 approves `r0` in run 1 of a pull request. Run 2 of the same pull request has the same pixels. Result: `"r0": "approved/human(copied)@1"`, status `passed`.
   - Same pixels in another pull request (no link): `"r0": "no decision@0"`, `needs-review`.
   - Same pixels with another rendering profile: `needs-review`.
2. **A copied approval is a new, independent decision** (`'copied:' || row.id`, `local-comparison.ts:612-624`). It keeps the kind and the actor of the source. A later Reject or Undo in the source run does not change the copy. Measured: Reject in the older run after the copy; the newer run stays `passed`. This is contract rule C02 (`docs/current-contract.md:184`).
3. **A change is approved with no person** in two cases (`local-comparison.ts:592-593`, `:625-639`):
   - Introduction: the reference digest is null, the lineage has no reservation for this item, variant, and kind, and the key is not in `visonaut_identity_history` for this lineage or for main.
   - Removal: the candidate digest is null and the lineage has no reservation.
   - Example: a pull request adds `new` and removes `old`: `"new": "approved/automatic@1"`, `"old": "approved/automatic@1"`, status `passed`, no reviewer.
   - The same new item with other pixels in the next run of the same pull request: `"new": "no decision@0"`, `needs-review`. In another pull request it is approved automatically again.
4. **A zero-pixel result is not a change.** A receipt row with `changedPixels = 0`, `ratio = 0`, no mask, and equal dimensions gets no review row (`local-comparison.ts:177-189`; dense path `:490-496`). Migrations `0029` and `0030` applied the same rule to stored rows that had no decision and no promotion.
5. **A rejection is not carried.** Only `verdict = 'approved'` matches the reuse query. Measured: Reject `r1` in run 1, then a push with the same pixels: `"r1": "no decision@0"`, `needs-review`. The reviewer must decide again in each run.
6. **A rejection does not block an older approval** of the same tuple in the same lineage. See STATE-02.
7. **A rejected automatic approval does not come back** when the rejection is in the run that made it. The reservation stays, so the next run has `no decision` and needs review (measured, case g4).
8. **Main advances: pull request results stay valid.** `promote` invalidates only comparisons of runs that are not pull requests (`baseline-promotion.ts:489`). Measured (case f): after a promotion to baseline revision 2, the pull request comparison is still `ready` with baseline revision 1, the saved approval is still there, a second approval that sends the old baseline revision answers 200, and Undo answers 200. This agrees with "Approved PR baseline independence" (`docs/current-contract.md:208-214`).
9. **Main advances: other main runs in review stop.** Their comparison becomes `invalidated`, the status is `needs-recompare`, the check conclusion is `pending`, and a new decision answers 409 "Only the active complete comparison can be reviewed." (measured, case f2). Only a new signed Submit (a workflow rerun) or `retireReplacedMainRuns` ends this state.
10. **A main run is promoted by the first status pass after its last approval.** After that, Undo answers 409 "Promoted history is read-only…" (measured, M9). `docs/review-guide.md:63` states the read-only rule.
11. **A newer attempt of the same workflow run closes the older attempt** in the `reserveRun` batch, before any upload (measured, case b1: status `superseded`, decision 409). A new push is a different workflow run. It does not close the older run. The `pull_request` webhook does that (`api/webhooks.ts:310-323`).
12. **Undo** restores the decision before the command, also an automatic one (test `service.test.ts:1978`). It needs the same GitHub user and the same review session, and each row must still have the revision that the command wrote. Undo of an Undo is refused (measured, M3).

Differences between these rules and the two documents:

| Document text                                                                                                                                                                                                                     | Code                                                                                                         | Finding  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------- |
| "A retry cannot recreate rejected or revoked acceptance." (`docs/simplification-audit/contract-issue-1.md:209`)                                                                                                                   | A later run copies an older approval after a Reject of the carried copy.                                     | STATE-02 |
| "A stale command returns a conflict with current state and identifies the conflicting reviewer" (`contract-issue-1.md:225`); "The message identifies the conflicting reviewer when one is available." (`docs/review-guide.md:55`) | The queued path never returns `reviewer`. The direct path returns it only for the check before the write.    | STATE-05 |
| "**Retry same command** uses the original command identity and targets" (`docs/review-guide.md:51`); "the notice still says that server processing will continue" (`:53`)                                                         | A `dead` task answers 409 for the same command ID with no end.                                               | STATE-04 |
| "refuse delayed success after rejection, Undo, supersession" (`contract-issue-1.md:328`)                                                                                                                                          | The send-time fence works. But a locked check keeps an earlier `success` after Reject.                       | STATE-03 |
| `docs/review-guide.md` has no sentence about carried approvals.                                                                                                                                                                   | A copied approval shows the first reviewer and `source: "human"`. The model has no field that says "copied". | STATE-08 |
| "A superseded attempt cannot accept review commands." (`docs/review-guide.md:17`)                                                                                                                                                 | Correct (case b1). The guide does not say that a new push can leave the older run open.                      | STATE-06 |
| "Reuse references the original decision and revision, not a copied detached verdict." (`contract-issue-1.md:199`)                                                                                                                 | Replaced by C02 (`docs/current-contract.md:184`). No difference.                                             | none     |

### Truth table

Source: the real `reviewStatus` function (`packages/service/src/review-status.ts:67-96`) with each input set (`truth.probe.ts`, raw result `results/truth-table.txt`). The check column is the expression in `prepareStatusIntent` (`run-status.ts:95-105`). The label column is `stateLabel` (`apps/web/src/routes/index.tsx:130-140`).

| #   | Run kind                                     | Active | Run state            | Comparison             | Pending rows | Rejected | Status            | Check         | Dashboard label         |
| --- | -------------------------------------------- | ------ | -------------------- | ---------------------- | ------------ | -------- | ----------------- | ------------- | ----------------------- |
| 1   | any                                          | 1      | `uploading`          | none                   | 0            | 0        | `incomplete`      | pending       | Waiting for screenshots |
| 2   | any                                          | 1      | `failed`             | none                   | 0            | 0        | `failed`          | failure       | Run failed              |
| 3   | any                                          | 1      | `comparing` (sealed) | none                   | 0            | 0        | `incomplete`      | pending       | Waiting for screenshots |
| 4   | any                                          | 1      | `comparing`          | `comparing`            | 0            | 0        | `comparing`       | pending       | Comparing images        |
| 5   | pull request, main                           | 1      | `reviewing`          | `ready`                | 2            | 0        | `needs-review`    | **failure**   | Needs review            |
| 6   | merge group                                  | 1      | `reviewing`          | `ready`                | 2            | 0        | `needs-review`    | pending       | Needs review            |
| 7   | any                                          | 1      | `reviewing`          | `ready`                | 1            | 1        | `rejected`        | failure       | Changes rejected        |
| 8   | pull request                                 | 1      | `reviewing`          | `ready`                | 0            | 0        | `passed`          | success       | Passed                  |
| 9   | pull request, baseline moved                 | 1      | `reviewing`          | `ready`                | 0            | 0        | `passed`          | success       | Passed                  |
| 10  | main, not promoted                           | 1      | `reviewing`          | `ready`                | 0            | 0        | `passed`          | success       | Passed                  |
| 11  | main or merge group, baseline moved          | 1      | `reviewing`          | `ready`                | 0            | 0        | `needs-recompare` | pending (P)   | New capture needed      |
| 12  | main, baseline moved                         | 1      | `reviewing`          | `ready`                | 1            | 0        | `needs-review`    | failure       | Needs review            |
| 13  | main or merge group                          | 1      | `reviewing`          | `invalidated`          | any          | any      | `needs-recompare` | pending (P)   | New capture needed      |
| 14  | any, dead comparison task (legacy rows only) | 1      | any                  | `comparing` or `ready` | 0            | 0        | `failed`          | failure (F)   | Run failed              |
| 15  | main                                         | 0      | `accepted`           | `ready`                | 0            | 0        | `passed`          | success       | Passed                  |
| 16  | any                                          | 0      | `superseded`         | any                    | any          | any      | `superseded`      | no update (P) | Replaced by a newer run |
| 17  | any, expired before completion               | 0      | `failed`             | none                   | 0            | 0        | `superseded`      | no update (P) | Replaced by a newer run |

Notes:

- **No row gives `success` while a changed row has no valid approval.** `passed` needs `pending = 0`, and `pending` counts each changed row with no approved, not revoked decision whose tuple equals the row tuple (`review-status.ts:29-35`). Row 15 reads no rows, but `promote` checked the same condition in its batch (`readyGuard`).
- `success` does not mean that a person approved each row. Rows 8 to 10 include automatic approvals (rule 3) and copied approvals (rules 1 and 6).
- Row 5: the check is `failure` with the title "Visual review has not passed" before a person looked at the run. This is the selected Gate design (`contract-issue-1.md:326`).
- (P) cannot leave `pending` without a new workflow run. Rows 11 and 13: server recomparison is retired, so only a new signed Submit helps. Rows 16 and 17: `prepareStatusIntent` throws for `superseded` (`run-status.ts:95-97`) and the run is not eligible (`review-status.ts:25-27`), so the GitHub check keeps its last state. Row 17 is PKG-07.
- (F) cannot leave `failure`: a `dead` comparison task has no retry. The trusted Submit path creates no comparison tasks, so this row needs legacy data.

### Which run owns the check

- One check for each workflow attempt. A rerun of the same commit (attempt 2) gets a new check. Measured with service-created checks (case i): the commit has check 7 (attempt 1, `success`, never updated again) and check 9 (attempt 2, `success`). Attempt 2 copied the approval and is `passed`. With pre-created checks the code does the same: a new generation `visonaut:pre:<sha>:1`, and the old check is closed as `failure` only when it was not complete (`api/pre-run-attempts.ts:621-657`).
- "Equivalent merge check retired": the run that was tested keeps the verdict on its own check. The check of the regenerated merge commit becomes `neutral` with a link to the tested run (`api/pre-run-checks.ts:322-377`). See STATE-07.

### Failure between steps

"Cron" is the `*/5 * * * *` trigger that sends one `recovery` message (`apps/web/wrangler.jsonc:109-111`, as cited in `second-lens-5.md`). A `recovery` pass runs every step.

| Operation                        | Stop after                                    | State                                                  | Repair                                                                                                | Delay                                                                                                                              |
| -------------------------------- | --------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Queued decision                  | task inserted, response lost                  | task `queued`                                          | The client retries the same ID: 202 (M4). The consumer step `review-decisions` runs the task.         | next `status` message, or 5 minutes at most                                                                                        |
| Queued decision                  | inline worker stops with the lease            | task `leased`                                          | consumer, after the lease ends                                                                        | 30 s (measured: done at 31 s, M5)                                                                                                  |
| Queued decision                  | consumer stops with the lease                 | task `leased`                                          | consumer, after the lease ends                                                                        | 12 minutes (measured: done at 721 s, M5)                                                                                           |
| Queued decision                  | decision batch committed, receipt not written | rows decided, receipt answers 202                      | The next pass runs the command again. `commandReplay` returns the saved result.                       | until the lease ends (seen at 1,000 targets, M8)                                                                                   |
| Queued decision                  | `status` message not sent                     | decision saved, check has the old state                | cron                                                                                                  | 5 minutes at most (measured: the next pass sends `success`, M7)                                                                    |
| Direct decision or Undo          | batch committed, response lost                | saved                                                  | The client sends the same ID again: 200 with the same result (M4).                                    | none                                                                                                                               |
| Status delivery                  | intent written, not sent                      | `work_status_outbox` `pending`                         | next `checks` pass                                                                                    | next message                                                                                                                       |
| Status delivery                  | `request_started = 1`, then any error or stop | `ambiguous = 1`                                        | none (OPS-01)                                                                                         | no end                                                                                                                             |
| Finalize, then `status` message  | finalize committed, send fails                | comparison `ready`, outbox row not delivered           | cron (test `api.test.ts:968`)                                                                         | 5 minutes at most                                                                                                                  |
| Create comparison, then finalize | between the two                               | run `comparing`, comparison `comparing`                | `reconcileComparisons` on `ingest` or `recovery` (`operations/index.ts:32-45`)                        | 5 minutes at most                                                                                                                  |
| Seal, then create comparison     | between the two                               | run sealed, no comparison                              | `reconcileStagedWorkflows` (`api/workflow-materialize.ts:868-871`)                                    | 5 minutes; after 5 failures 1 hour (`:825-826`)                                                                                    |
| Promotion                        | prepared, `promote` batch fails               | snapshot `copying`, pins held, run `passed` and active | The next `promotion` step uses the same snapshot and promotes (M9).                                   | next `status` message, or 5 minutes; 12 minutes if the stopped worker holds the promotion lease (from the code, `work.ts:748-763`) |
| Promotion                        | prepared, then Undo                           | Undo answers 200, run `needs-review`                   | The next `promotion` step cancels the snapshot (`revoked`). A new approval makes a new snapshot (M9). | next pass                                                                                                                          |

### Error surface

`atomic()` maps a false assertion to `ConflictError("State changed. Refresh the comparison before trying again.")`. Every other D1 error keeps its class (`database.ts:60-68`). Measured raw text of a false assertion: `D1_ERROR: CHECK constraint failed: valid = 1: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_CHECK)`. `errorResponse` (`api/index.ts:35-84`) maps `ConflictError` and `IncompleteError` to 409 and every unknown error to 503 with a reference. The review routes catch `ConflictError` first and add the current model (`api/review.ts:682-697`, `:905-913`).

| Case                                    | Direct path                                                                         | Queued path (the web client)                                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Row changed before the request          | 409 `{error, model, reviewer}` "A target changed or belongs to another comparison." | POST 202. Receipt 409 `{error, model}`, same message, **no `reviewer`**                                                      |
| A guard fails in the write batch (race) | 409 `{error, model}` "State changed. Refresh the comparison before trying again."   | POST 202. Receipt 409, same message                                                                                          |
| Run superseded                          | 409 "Only the active complete comparison can be reviewed."                          | POST 409 "State changed…" (the admission guard)                                                                              |
| Run promoted                            | 409 "Promoted history is read-only…"                                                | POST 409 "State changed…"                                                                                                    |
| No targets, or duplicate targets        | 409 `{schemaVersion, error}`, code `incomplete`                                     | POST 202. Receipt 409, code `conflict`                                                                                       |
| Same command ID, other body             | 409 "The command ID already belongs to another request."                            | POST 409 "This command ID already belongs to another decision."                                                              |
| Unknown review session                  | 409, code `review_session_expired`, no model                                        | same                                                                                                                         |
| Unknown comparison                      | 409, code `incomplete` (API-04)                                                     | same                                                                                                                         |
| Predecessor not on the server           | not applicable                                                                      | POST **503** `service_unavailable` with a reference                                                                          |
| Storage error in the write              | 503 `service_unavailable` with a reference, `Retry-After: 1`                        | POST 202. The task is tried 5 times, then `dead`. Receipt 409 "The queued decision could not be processed. Review it again." |
| Invalid verdict                         | 400 `invalid_verdict`                                                               | same                                                                                                                         |

A normal race gives 409 with the current model in the body. It never gave 500 or 503 in the probes. Raw results: `results/errors.json`, `results/a-concurrency.json`.

## Findings

### STATE-01 · A decision fails with 409 when any other write of the project commits at the same time

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `packages/service/src/review-commands.ts:213-216`: each decision batch starts with `projectGuard(service.database, project)` and `reviewGuard(service.database, run, comparison.id)`. `reviewGuard` includes `run.revision = ?` (`:107`). Undo has the same guards (`:368-370`).
  - `packages/service/src/status-touch.ts:11`: `"UPDATE visonaut_projects SET revision = revision + 1 WHERE id = ?"`. Each decision, Undo, reserve, seal, comparison, finalize, promotion, retirement, and history compaction runs this statement (list with lines in `second-lens-5.md`, section D1-05).
  - The precise guard exists already: `review-commands.ts:229-233` asserts `decision_revision = ?` for each target row.
  - `apps/web/src/operations/review-queue.ts:135-146`: a `ConflictError` ends the task (`completeWork` with `{"error": message}`). No retry.
  - `review-queue.ts:106-116`: a successor of a failed task fails with "An earlier queued decision failed. Review the current evidence again."
  - `packages/service/src/run-status.ts:107-108`: `prepareStatusIntent` has the same `projectGuard`. `apps/web/src/operations/checks.ts:210-218` calls it in a loop with no `try`.
  - M1, different rows of one run, reviewer B commits between the read and the write of reviewer A: `"loserA": {"status": 409, "error": {"message": "State changed. Refresh the comparison before trying again."}}`, `"rowOfA": "no decision@0"`.
  - M1, different pull requests: same 409. M1, a `reserveRun` of another pull request in the same moment: same 409.
  - M1, queued chain of three decisions with one overlap: receipts `409 State changed…`, `409 An earlier queued decision failed…`, `409 An earlier queued decision failed…`. All three rows: `no decision@0`.
  - M1, no injected race: 20 pairs of requests, reviewer A and reviewer B, different rows, sent together: `"receiptStatusCounts": {"200": 23, "409": 17}`.
  - M7, one decision commits while the consumer prepares a status intent: `"checks": "completed 0, attention [\"scheduler\"], hasMore false"` and a new event `checks / scheduler / step-failed`.
- What happens: The read batch takes the project revision and the run revision. The write batch asserts both. Any commit between the two batches makes the assertion false, also a commit that does not touch the same row, the same run, or the same pull request. The reviewer gets "Conflict. State changed. Refresh the comparison before trying again." The decision is not saved. On the queued path, each later decision of the chain is also discarded. The status pass has the same guard, so a decision that commits during a status pass makes the complete `checks` step fail for that pass.
- Impact:
  - Two reviewers, or two tabs, on one project cannot work at the same time without lost decisions. This includes work on different pull requests.
  - One reviewer alone loses a decision when a CI event, a webhook retirement, a promotion, or a maintenance step commits in the window. The window is one D1 round trip. I did not measure a production rate.
  - One reviewer who decides fast makes the `checks` step fail repeatedly, because each decision sends a `status` message and the status pass reads and writes over many round trips. Each failed pass raises the alert `checks: step-failed` and delays the check update until a later pass. From the code and from one measured overlap (M7); the rate in production is not measured.
  - The 409 message does not say what changed, and it names no reviewer (STATE-05).
- Recommendation: retry inside the service when the write batch fails and the command was not saved. The second read gives the precise answer: it throws "A target changed…" when a target row is really stale, and it passes when only a revision counter moved.
  ```ts
  // packages/service/src/review-commands.ts (sketch)
  for (let attempt = 0; ; attempt += 1) {
    const prepared = await prepareReview(service, input); // the read batch and the statements
    try {
      await atomic(service.database, prepared.statements);
      return prepared.result;
    } catch (error) {
      const replay = await commandReplay(service.database, input.commandId, request);
      if (replay) return replay;
      if (!(error instanceof ConflictError) || attempt === 2) throw error;
    }
  }
  ```
  In `deliverGitHubStatuses`, catch `ConflictError` for one run, continue with the next run, and set `hasMore`.
- Alternatives:
  - Narrow the guards: remove `projectGuard` and `run.revision` from Approve, Reject, and Undo. Keep the row revisions, "comparison ready and current", "no promotion", and `currentBaselineGuard`. Read the new run revision with `RETURNING`. This removes the cause, but it changes the path that must never publish a wrong `success`, so it needs the race tests of `contract-issue-1.md:328`.
  - Minimal: let `processReviewQueue` put a task back to `queued` one or two times when the error text is the generic "State changed…" message. This fixes the queued path only.
  - Keep the behavior and change the message to "Another change was saved at the same time. Decide again."
- Maintainer decision needed: yes. Is "one writer for each project at a time" the intended rule for decisions, or only a side effect of the shared guard?

### STATE-02 · A Reject of a carried approval is dropped at the next push

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/service/src/local-comparison.ts:24-36`: the reuse rule needs `decision.verdict = 'approved' AND decision.revoked = 0`, the same tuple, and `source_row.decision_id = decision.id`. It has no condition about a later rejection of the same tuple.
  - `local-comparison.ts:591`: `ORDER BY decision.created_at, decision.id LIMIT 1`. The oldest matching approval wins.
  - `packages/service/src/review-commands.ts:242-246`: Reject sets `revoked = 1` only on the decision of the rejected row. For a copied approval that is the copy (`copied:<row>`), not the source.
  - `docs/simplification-audit/contract-issue-1.md:209`: "Before promotion, explicit rejection overrides automatic acceptance. A retry cannot recreate rejected or revoked acceptance."
  - M2, case g2 (one pull request, three runs, same pixels for `r2`):
    ```text
    run 1, user 42 approves:        "r2": "approved/human@1"           status passed
    run 2, approval copied:         "r2": "approved/human(copied)@1"   status passed
    run 2, user 43 rejects:         "r2": "rejected/human@2"           status rejected
    run 3 (new push, same pixels):  "r2": "approved/human(copied)@1"   status passed
    run 3 decision: {"kind": "human", "actor": "42", "verdict": "approved"}, check conclusion "success"
    ```
  - M2, case g3: the same with an automatic approval of a new item. Run 3: `"added": "approved/automatic(copied)@1"`, `passed`.
  - The existing tests cover the other direction only: "keeps copied approval after source rejection and permits verified descendants" (`service.test.ts:1830`).
- What happens: A reviewer rejects pixels that an earlier run of the same pull request had approved. The rejection is stored on the copy in the newer run. The source approval in the older run stays valid. The next run with the same pixels finds the source approval again and copies it. The page shows "approved" with the first reviewer. The required check goes to `success`.
- Impact: The required check passes although the newest human verdict for exactly these pixels in this pull request is Reject. The author does not need to change anything; an unrelated push is sufficient. The second reviewer gets no signal.
- Recommendation: refuse reuse when the lineage has a newer, valid rejection of the same tuple. Add this condition inside the `EXISTS` subquery of `acceptanceValiditySql`, where the alias `target_run` is in scope:
  ```sql
  AND NOT EXISTS (SELECT 1 FROM visonaut_decisions later
    JOIN visonaut_comparison_rows later_row ON later_row.id = later.row_id AND later_row.decision_id = later.id
    JOIN visonaut_comparisons later_comparison ON later_comparison.id = later_row.comparison_id
    WHERE later.verdict = 'rejected' AND later.revoked = 0
      AND later.tuple_json = row.tuple_json AND later.created_at >= decision.created_at
      AND (later_comparison.run_id = target_run.id OR EXISTS (SELECT 1 FROM visonaut_lineage l
        WHERE l.source_run_id = later_comparison.run_id AND l.target_run_id = target_run.id)))
  ```
  The index `visonaut_decisions_tuple (tuple_json, revoked, verdict)` exists (`apps/web/migrations/0001_service.sql:153`). Check the query plan before use.
- Alternatives:
  - Simpler rule: take the newest current decision of the tuple in the lineage, of any verdict, and copy only when it is an approval ("the newest verdict wins").
  - When a reviewer rejects a copy, also revoke the source decision that the copy came from (`visonaut_decisions.source_decision_id`). This changes an older run after the fact.
  - Keep the behavior and document it: "A rejection applies to one run. An approval in an older run of the pull request can apply again."
- Maintainer decision needed: yes. Which verdict wins when one pull request has an approval and a later rejection of the same pixels?

### STATE-03 · A check that is locked after "success" keeps "success" after Reject or Undo

- Kind: bug
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - OPS-01 (`second-lens-5.md`): each error in `deliverStatus` sets `ambiguous = 1` (`packages/service/src/work.ts:538-548`), and no code path clears it.
  - `apps/web/src/operations/checks.ts:258-266`: a delivery with `ambiguous` returns `"attention"`. Nothing is sent.
  - M6 (`results/status-locked-success.json`), one pull request run:
    ```text
    1. approved, delivered                      service passed     GitHub check success
    2. event of another pull request, then one  service passed     GitHub check success   sender ambiguous=1
       failed GitHub read (GET check 2)
    3. reviewer rejects (HTTP 200)              service rejected   GitHub check success
    4. three status passes, GitHub is healthy   service rejected   GitHub check success   requests for this check: []
    ```
  - Open alert after step 4: `{"kind": "check-delivery", "code": "ambiguous", "unresolved": 1}`.
  - M3, case c1, shows the normal path: after Undo the check stays `success` until the next status pass sends `failure`.
- What happens: OPS-01 describes the lock as a blocked approval. The lock also blocks the other direction. If the last delivered conclusion was `success`, a later Reject, Undo, or other change to `needs-review` cannot reach GitHub. Step 2 needs no action of the reviewer: each project event sends each active check again (D1-05), so each event is one more chance for a failed read.
- Impact: The required `Visonaut` check on the pull request shows `success` while the service result is `rejected`. GitHub permits the merge. The only signal is the alert on the dashboard. `contract-issue-1.md:330` says "An outage must not manufacture a passing result"; here an outage keeps an old passing result.
- Recommendation: fix the cause first with the OPS-01 change (a failed read returns `"not-sent"`, so no lock). For the locks that remain (a `PATCH` with no answer), let the sender write a conclusion that is not `success` after the lease has ended. A `failure` or `pending` update cannot manufacture a pass, and after 12 minutes no older request can still write (GitHub ends a request after 10 s, the client after 15 s; facts in `second-lens-5.md`).
  ```ts
  // apps/web/src/operations/checks.ts (sketch)
  const failClosed = delivery.ambiguous && leaseEnded && intent.conclusion !== "success";
  if (delivery.ambiguous && !failClosed) return "attention";
  ```
- Alternatives:
  - Show the difference in the product: add "GitHub check not updated" to the run model and to the dashboard row when the sender is `ambiguous` or `dead` and the delivered conclusion differs from the current one.
  - A repair command that reads the check and settles the lock (OPS-01 lists this).
  - Minimal: fix OPS-01 only and accept the remaining case.
- Maintainer decision needed: yes. May the sender write `failure` or `pending` to a locked check after the lease has ended?

### STATE-04 · A queued decision that fails 5 times is dead for its command ID, the 5 attempts take seconds, and a stopped consumer holds a decision for 12 minutes

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/operations/review-queue.ts:148-154`: `failWork(... retryAt: context.now() ...)`. No delay between attempts. `:62`: `maxAttempts: 5`. `apps/web/src/runtime.ts:454` sends the continuation after 1 second.
  - `review-queue.ts:28-32`: `if (previous) return;`. A second `POST` with the same ID and body does nothing, also when the task is `dead`.
  - `apps/web/src/api/review.ts:817-830`: a `dead` task answers 409 with code `conflict`.
  - M5 (`results/e-dead-task.json`), each review write fails with a storage error:
    ```text
    after POST and inline attempt   task queued  attempts 1   receipt 202
    consumer pass 1..3              task queued  attempts 2, 3, 4   hasMore true
    consumer pass 4                 task dead    attempts 5
    receipt:        409 {"code": "conflict", "message": "The queued decision could not be processed. Review it again."}
    successor:      409 "An earlier queued decision failed. Review the current evidence again."
    operations_events: []
    retry, same ID: POST 202 {"queued": true}; task stays dead; receipt 409
    new command ID: receipt 200, row "approved/human@1"
    ```
  - M5, lost lease: a consumer that stops with the lease (12 minutes, `apps/web/src/runtime-defaults.ts:23`) holds the task: receipt 202 at 0 s, 60 s, and 660 s; `complete` at 721 s. For the inline worker (30 s lease) the task completed at 31 s.
  - `docs/review-guide.md:53`: "If the decision is already queued, the notice still says that server processing will continue. Retry checks the same command".
- What happens: Five attempts run in about 4 seconds (one inline, four consumer passes with a 1-second continuation; the count is measured, the time is from the code). A storage fault of some seconds makes the decision and its chain `dead`. The decision is not lost without a message: the receipt is 409 and the client shows a conflict. But the `POST` for the same command answers `202 queued` for a task that cannot run again, the code `conflict` is wrong for a storage fault, and no operations alert exists for a dead review task. The consumer uses the general 12-minute lease for review tasks, so one stopped consumer invocation delays one decision for 12 minutes while the page shows "Queued on server".
- Impact: After a short D1 fault the reviewer must make each in-flight decision again. The documented "Retry same command" cannot help. An operator sees no alert.
- Recommendation:
  ```ts
  // review-queue.ts: wait between attempts
  retryAt: context.now() + Math.min(60_000, 2_000 * 2 ** task.attempts),
  // enqueueReview: same ID and body, task is dead -> put it back to queued with attempts = 0
  // processReviewQueue in the consumer: leaseMs: 30_000 for kind 'review'
  ```
  Record an operations event for a dead review task, with the command ID as the subject.
- Alternatives:
  - Minimal: answer the `POST` with the 409 of the receipt when the task is `dead`, and change the code to `decision_failed`.
  - Send review tasks through the direct path again and keep the queue only for the chain order.
- Maintainer decision needed: no.

### STATE-05 · The queued path and the direct path give different answers for the same refusal, and the queued path never names the reviewer

- Kind: inconsistency
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/api/review.ts:682-697`: `conflictResponse` adds `reviewer` only when `error.current` has a row ID. Only one site passes a row: `packages/service/src/review-commands.ts:190`.
  - `apps/web/src/operations/review-queue.ts:140-145`: the task result keeps `error.message` only. `api/review.ts:817-830` builds the receipt from that string.
  - `review-queue.ts:36-38`: a missing predecessor throws a plain `Error`, so `errorResponse` answers 503.
  - `apps/web/src/review/client.ts:313-317`: the web client always sends `queued: true`.
  - M3, case c5, the same stale target on both paths: direct `{"status": 409, "keys": ["error", "model", "reviewer"], "reviewer": "42"}`; queued receipt `{"status": 409, "keys": ["error", "model"]}`.
  - M1, same row with a real overlap, direct path: `"loserA": {"status": 409, "keys": ["error", "model"]}`. No reviewer, although reviewer B changed that row.
  - M11 (`results/errors.json`): the table in "Error surface" above. Examples: no targets is `incomplete` on the direct path and `conflict` on the receipt; a promoted run is "Promoted history is read-only…" on the direct path and "State changed…" on the queued `POST`; a missing predecessor is `503 service_unavailable` with a reference.
  - `docs/review-guide.md:55`: "The message identifies the conflicting reviewer when one is available."
- What happens: The service has the facts (the row, the other reviewer, the reason), but the queue stores one sentence. The client maps each 409 to "Conflict" (`review/client.ts:275`). So the product cannot say "Updated by X" on the path that it uses, and it shows the same generic sentence for a closed run, a promoted run, and a race.
- Impact: The reviewer cannot see who changed a row or why a decision was refused. The UI text cannot depend on the error. A missing predecessor looks like a service outage and offers a retry that cannot succeed.
- Recommendation: one answer shape for both paths, with a specific code. Store the code and the reviewer in the task result.
  ```ts
  { error: { code: "row_changed" | "state_changed" | "run_closed" | "promoted"
                 | "predecessor_failed" | "predecessor_missing" | "invalid_targets",
             message: string },
    model, reviewer?: string }
  ```
  Use 400 for invalid targets and 409 for a missing predecessor.
- Alternatives:
  - Minimal: compute `reviewer` in the receipt route from the returned model and the target IDs of the task payload.
  - Add a `code` property to `ConflictError` at each throw site and keep the messages.
- Maintainer decision needed: no.

### STATE-06 · Two runs of one pull request can be open for review, and approvals on the older run are not carried

- Kind: bug
- Severity: low. Confidence: medium. Measured: yes. Effort: M
- Evidence:
  - `packages/service/src/run-admission.ts:120-124`: `reserveRun` closes only runs with the same `external_run_id` (the same workflow run).
  - `apps/web/src/api/webhooks.ts:283-323`: the `pull_request` webhook retires an older run only when `pull.merge_commit_sha` is a string and differs from the run's tested SHA at that moment.
  - `packages/service/src/local-comparison.ts:612-624`: approvals are copied one time, when the new comparison becomes `ready`.
  - M2, case b2 (the webhook did not retire the older run): both runs `needs-review` and active. An approval on the older run after the newer run was ready: HTTP 200, older run `passed`, newer run still `"r1": "no decision@0"`. Checks: older `success`, newer `failure`.
  - M2, case b1 (same workflow run, attempt 2): the older attempt is `superseded` at once and answers 409.
- What happens: A new push is a new workflow run. The older run stays open until the webhook retires it. If GitHub had not computed the new merge commit when the webhook arrived, nothing retires the run at that time (assumption from the code; I did not observe the webhook timing in production). A reviewer who continues in the older run saves decisions that the newer run does not get.
- Impact: Lost review work and two "Needs review" entries for one pull request. No wrong pass: the older check is on the older head commit.
- Recommendation: when the comparison of a newer run of the same lineage becomes `ready`, close the older open runs of that lineage in the same batch, with a guard on the verified lineage link.
- Alternatives:
  - Minimal: the dashboard and the review page show "A newer run exists" for an open run when the lineage has a newer sealed run.
  - Retire in `reserveRun` when the verified source head differs.
- Maintainer decision needed: yes. Can two runs of one pull request be open for review at the same time?

### STATE-07 · "Equivalent merge check retired" makes the newest Visonaut check neutral also when the tested result failed

- Kind: bug
- Severity: medium. Confidence: low. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/api/pre-run-checks.ts:255-260`:
    ```ts
    if (
      sourceCheck.status !== "completed" ||
      !["success", "failure"].includes(String(sourceCheck.conclusion))
    ) {
      continue;
    }
    ```
    A failed source check qualifies. Lines `350-363` then write `conclusion: "neutral"`.
  - M10 (`results/i-equivalent.json`), real `reconcileEquivalentPullRequestChecks`, both checks on the pull request head (the current design, `check_head_sha`):
    ```text
    source check failed -> githubWrites: ["PATCH check 2 -> neutral"]
    checks on the head: {id 1, "Visonaut", tested merge, "failure"}, {id 2, "Visonaut", regenerated merge, "neutral", "Equivalent merge check retired"}
    ```
  - GitHub documentation, read on 2026-10-05, "Troubleshooting required status checks": "Successful check statuses are `success`, `skipped`, and `neutral`."
  - The existing tests use a passed source only (`apps/web/src/api/webhooks.test.ts:429`: `conclusion: "success"`).
- What happens: The path selects a check row with no workflow run (`workflow_run_id IS NULL AND check_id IS NOT NULL`, `pre-run-checks.ts:201-205`) whose merge commit has the same parents and tree as a tested merge. It completes that check as `neutral`. It does this also when the tested result is `failure`, which is the state of each run that needs review (truth table, row 5) and of each rejected run. With head checks, both check runs have the name `Visonaut` on the same commit.
- Impact: Not verified: which of two check runs with one name GitHub uses for a required check. If GitHub uses the newest, a pull request with a pending or rejected review shows a passing required check. If GitHub needs both to pass, there is no effect. Reach is small in the current code: a row with a check and no workflow run comes from older data or from a `begin` request that stopped between check creation and binding (`apps/web/src/api/pre-run-attempts.ts:864-878`).
- Recommendation: retire as `neutral` only for a passed source. For a failed source, write the same conclusion as the source, with the same link.
  ```ts
  const conclusion = sourceCheck.conclusion === "success" ? "neutral" : "failure";
  ```
- Alternatives:
  - Minimal: accept only `"success"` at line 257. An alias of a failed source stays `in_progress`.
  - Remove the path if production has no row for it. Read-only check: `SELECT COUNT(*) FROM pre_run_checks WHERE kind='pull_request' AND workflow_run_id IS NULL AND check_id IS NOT NULL AND state='active'`.
- Maintainer decision needed: yes. Is a `neutral` alias for a failed result intended? A test on a real pull request can show which check run GitHub uses.

### STATE-08 · A carried approval looks like a first-hand approval

- Kind: ux
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/service/src/local-comparison.ts:614-615`: the copy takes `source.kind` and `source.actor_id`, and stores `source.id` in `source_decision_id`.
  - `apps/web/src/api/review.ts:497-500`: the model gets `verdict`, `source`, and `reviewer` from the decision.
  - M2: decision record `{"decisionId": "copied:<row id>", "kind": "human", "actor": "42", "copiedFromIsSet": true}`; variant in the review model `{"verdict": "approved", "source": "human", "reviewer": "42"}`. The variant has no other decision field.
  - `docs/review-guide.md:47` explains "Accepted automatically". The guide has no sentence about carried approvals.
- What happens: A new run opens with rows that are already approved. The page shows the first reviewer as if that person approved this run. The data to say more exists (`source_decision_id` leads to the source run and its time).
- Impact: A reviewer cannot see which approvals are new and which were carried. This matters for STATE-02, where a carried approval returns after a rejection.
- Recommendation: add the origin to the variant, for example `carriedFrom: { runId, decidedAt }`, and one sentence to the guide. A label such as "Approved by X in an earlier run" is a candidate for the design lab.
- Alternatives: (a) Minimal: add `carried: true`. (b) Document only.
- Maintainer decision needed: no.

### STATE-09 · One command can have about 6,000 targets, and each target adds 4 statements and 2.4 KB to one batch

- Kind: performance
- Severity: low. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `packages/service/src/review-commands.ts:227-271`: for each target one assertion, two decision statements, and one row update. Undo: `:384-416`.
  - `apps/web/src/api/review.ts:842`: body limit `1024 * 1024`. `:849`: target limit `maximumCaptures`, which is 40,000 (`apps/web/src/runtime-defaults.ts:14`).
  - M8 (local D1, service call):

    | Targets | Statements in the write batch | Batch payload (SQL text and values) | Local time of the batch | Result   |
    | ------- | ----------------------------- | ----------------------------------- | ----------------------- | -------- |
    | 100     | 410                           | not recorded                        | 18 ms                   | accepted |
    | 1,000   | 4,010                         | 2,442,021 bytes                     | 114.5 ms                | accepted |
    | 5,000   | 20,010                        | 12,202,022 bytes                    | 509.8 ms                | accepted |

  - M8, HTTP with 1,000 targets: request body 169,254 bytes, so 1 MiB holds about 6,190 targets. The 40,000 limit cannot be reached. Direct answer: 964,511 bytes (the complete model). Task payload: 169,293 bytes, and the result stores the target list again. Undo: 4,012 statements.
  - `apps/web/src/review/review-workspace.tsx:1055`, `:1293`: the UI sends one item for each command ("Approve whole item").
- What happens: The API accepts very large commands. The cost is linear and unbounded in one batch. Local D1 accepted 20,010 statements. Production limits for a batch of this size are not verified. The UI does not send such commands today.
- Impact: None for the current UI. An "approve all" control in a new design would send exactly this command.
- Recommendation: use set-based statements with `json_each`, as `finalizeComparison` and `registerImages` do (`local-comparison.ts:612-634`, `run-admission.ts:384-390`). Then a command is about 12 statements for any number of targets. Derive decision IDs from the command ID and the row ID.
  ```sql
  -- one assertion for all targets
  NOT EXISTS (SELECT 1 FROM json_each(?) target WHERE NOT EXISTS (
    SELECT 1 FROM visonaut_comparison_rows row WHERE row.id = json_extract(target.value,'$.id')
      AND row.comparison_id = ? AND row.decision_revision = json_extract(target.value,'$.expectedRevision')))
  ```
- Alternatives: (a) Minimal: an explicit target limit (for example 500) with a 400 answer. (b) A server command "approve all pending rows of this comparison at run revision N" with no target list.
- Maintainer decision needed: no.

### STATE-10 · Three "expected" fields of a decision command have no guard effect

- Kind: simplification
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `packages/service/src/types.ts:158-159`: `expectedPromotionId?`, `expectedBaselineRevision?`. `applyReviewCommand` (`review-commands.ts:126-317`) does not read them. `expectedBaselineRevision` is a guard only in Undo for runs that are not pull requests (`:353`).
  - `apps/web/src/api/review.ts:881-887`: the route uses `expectedRunRevision`, `expectedBaselineRevision`, and `expectedPromotionId` only to select the answer shape of the direct path. The web client uses the queued path, so these lines do not run for it.
  - The fields are part of the stored request, so they are part of the command identity: the same ID with another `expectedBaselineRevision` answers 409 "The command ID already belongs to another request." (M4).
  - M2, case f: an approval that sends baseline revision 1 while the project is at 2 answers 200. For a pull request this is the intended rule.
- What happens: The names say that the server compares these values. For Approve and Reject it does not. The real protection is the row revision, the comparison state, and the promotion guard.
- Impact: A reader of the client or the API can assume a protection that does not exist. No wrong result was found.
- Recommendation: remove the three fields from the command, or enforce them and name the rule in the contract.
- Alternatives: keep them and add a comment at `types.ts:158`.
- Maintainer decision needed: no.

## Measurements (command, raw result, limits)

All probes ran from the repository root with the repository's Vitest and a scratch configuration. No file was written in the repository.

```sh
node_modules/.bin/vitest run --config /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-review-state/vitest.probe.config.mjs <probe name>
```

Each probe passed (`Test Files 1 passed`). The probe files and the raw JSON are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-review-state/` and `results/`.

General limits of all probes:

- Local D1 (Miniflare 5, workerd) is not production D1. Counts, HTTP statuses, response keys, and row states do not depend on the machine. Local times are not production times.
- The fixture is the dense fixture of `packages/service/src/service.test.ts:139-241` (`seedLegacyComparison` and `seedLegacyResult`), not the sparse inventory path of trusted Submit. The decision code is the same for both. `finalizeComparison`, `applyReviewCommand`, and `undoReviewCommand` have no branch on the storage mode except the `visonaut_identity_history` insert (`local-comparison.ts:644-645`).
- The GitHub API is a stub. "GitHub check" in the results is the state that the stub received.
- A race is made by a D1 wrapper that runs one action immediately before a selected write batch. This is the real interleaving "read batch, other commit, write batch". M1 also has a run without this wrapper.
- A row state is written as `verdict/kind@revision`.

### M1 · Two commands at the same time (S4a) — `a-concurrency`

Expected (`docs/review-guide.md:55`): "A concurrent change shows **Conflict** and current state. The message identifies the conflicting reviewer when one is available."

| Case                                                       | Path   | Winner  | Loser                                                                                               | Rows after                                           |
| ---------------------------------------------------------- | ------ | ------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Same row, one after the other                              | direct | 200     | 409 `{error, model, reviewer: "42"}` "A target changed or belongs to another comparison."           | `approved/human@1`                                   |
| Same row, real overlap                                     | direct | 200 (B) | 409 `{error, model}` "State changed. Refresh the comparison before trying again."                   | `rejected/human@1` (B)                               |
| Different rows, same run, real overlap                     | direct | 200 (B) | 409 `{error, model}` "State changed…"                                                               | A: `no decision@0`; B: `approved/human@1`            |
| Different pull requests, real overlap                      | direct | 200 (B) | 409 "State changed…"                                                                                | A: `no decision@0`                                   |
| Decision and `reserveRun` of another pull request          | direct | reserve | 409 "State changed…"                                                                                | A: `no decision@0`                                   |
| Chain of three queued decisions of A, B overlaps the first | queued | 200 (B) | three `POST` 202; receipts 409 "State changed…", 409 "An earlier queued decision failed…", 409 same | A: three rows `no decision@0`; B: `approved/human@1` |

Changed rows for the losing command in each case: none (`decisions`, `commands`, `audit`, `statusOutbox`, and the project revision changed by exactly the winner's write, for example `"decisions": "14 -> 15", "commands": "2 -> 3"`).

Run without an injected race: 20 pairs of queued requests (A and B, different rows, `Promise.all`), then the receipts.

```json
{
  "pairs": 20,
  "receiptStatusCounts": { "200": 23, "409": 17 },
  "conflictMessages": { "State changed. Refresh the comparison before trying again.": 17 },
  "rowsWithDecision": 23,
  "rowsWithoutDecision": 17
}
```

Limit: the number 17 depends on local timing. It shows that the conflict needs no special timing. It is not a production rate.

### M2 · Rules, newer runs, main advances, rerun (S2, S4b, S4f, S4g, S4i) — `rules`

Raw: `results/rules-reuse.json`, `results/rules-runs.json`.

| Case                                                                              | Expected                                                                          | Observed                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Introduction and removal                                                          | automatic (`contract-issue-1.md:203`, `:207`)                                     | `"new": "approved/automatic@1"`, `"old": "approved/automatic@1"`, `passed`                                                                                                                                             |
| Changed introduction in the same pull request                                     | review (`:206`)                                                                   | `"new": "no decision@0"`, `needs-review`                                                                                                                                                                               |
| Copy of a human approval (same pull request, same pixels)                         | reuse (`:193`)                                                                    | `"r0": "approved/human(copied)@1"`, `passed`; decision `copied:<row id>`, kind `human`, actor `42`                                                                                                                     |
| Same pixels, unrelated pull request                                               | no reuse (`:193`)                                                                 | `"r0": "no decision@0"`                                                                                                                                                                                                |
| Same pixels, other rendering profile                                              | no reuse                                                                          | `needs-review`                                                                                                                                                                                                         |
| g1: Reject, then a push with the same pixels                                      | not specified                                                                     | next run `"r1": "no decision@0"`, `needs-review`                                                                                                                                                                       |
| g2: approve, copy, Reject of the copy, push with the same pixels                  | "A retry cannot recreate rejected or revoked acceptance." (`:209`)                | **run 3 `"r2": "approved/human(copied)@1"`, `passed`, check conclusion `success`**                                                                                                                                     |
| g3: the same with an automatic approval                                           | same                                                                              | **run 3 `"added": "approved/automatic(copied)@1"`, `passed`**                                                                                                                                                          |
| g4: Reject of an automatic approval in the run that made it, then the same pixels | review (`:209`)                                                                   | `"added2": "no decision@0"`, `needs-review`                                                                                                                                                                            |
| g5: Reject in the older run after the copy                                        | copy stays (C02)                                                                  | newer run `"r3": "approved/human(copied)@1"`, `passed`                                                                                                                                                                 |
| b1: approve while attempt 2 of the same workflow run is reserved                  | "A superseded attempt cannot accept review commands." (`docs/review-guide.md:17`) | old attempt `superseded`; direct 409 "Only the active complete comparison can be reviewed."; queued `POST` 409 "State changed…"; `/state`: `{"run": {"status": "superseded"}, "reviewReady": false, "archived": true}` |
| b2: approve on the older run after a newer run (new push) is ready                | not specified                                                                     | 200; older run `passed`; newer run `"r1": "no decision@0"`; checks: older `success`, newer `failure`. After `retireRun`: 409                                                                                           |
| f: main advances during a pull request review                                     | results stay valid (`docs/current-contract.md:210`)                               | comparison `ready`, baseline revision 1 before and after; second approval 200 (model status `passed`); Undo of the first approval 200                                                                                  |
| f2: a newer main run in review when an older main run is promoted                 | new comparison needed (`contract-issue-1.md:217`)                                 | `needs-recompare`, pending and rejected shown as 0, approve 409, check conclusion `pending`                                                                                                                            |
| i: rerun of the same commit (attempt 2)                                           | new check for the attempt (`docs/evidence/checks-7710/README.md`)                 | attempt 1 `superseded`; attempt 2 `"r0": "approved/human(copied)@1"`, `passed`; two checks on the commit: attempt 1 `success`, attempt 2 `success`                                                                     |

Limits: in g2 and g3 the probe retired runs 1 and 2 with `retireRun` before run 3, as the `pull_request` webhook does. The reuse query does not read `active`, so the result does not depend on this step (from the code). Case i uses service-created checks (`visonaut:<run id>`); the pre-created path is read from the code only.

### M3 · Undo (S4c) — `c-undo-replay`

Expected: `docs/review-guide.md:59-63`.

| Case                                                            | Observed                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Undo after the status was delivered                             | 200 `{commandId, revisions, selection, baselineRevision, promotionId, model}`; rows `no decision@2`; run `needs-review`; GitHub check `success` until the next status pass, then `PATCH … -> failure`. Changed: `commands +1, audit +1, statusOutbox +1, projectRevision +1`; no new decision row |
| Undo from another review session of the same user               | 409 "Only your saved command in this review session can be undone."                                                                                                                                                                                                                               |
| Undo by another user                                            | 404 "Your command was not found."                                                                                                                                                                                                                                                                 |
| Undo with an unknown review session                             | 409, code `review_session_expired`                                                                                                                                                                                                                                                                |
| The same `undoCommandId` again                                  | 200, same result                                                                                                                                                                                                                                                                                  |
| A new `undoCommandId` for the same command                      | 409 "Only your saved command…"                                                                                                                                                                                                                                                                    |
| Undo of the Undo command                                        | 409 "Only your saved command…"                                                                                                                                                                                                                                                                    |
| Approve, then Reject on the same row; Undo of the older approve | 409 "State changed…"; row stays `rejected/human@2`                                                                                                                                                                                                                                                |
| Then Undo of the newer reject                                   | 200; row `approved/human@3`, run `passed`                                                                                                                                                                                                                                                         |
| Main run, Undo with a wrong baseline revision                   | 409 "The baseline changed after this command."                                                                                                                                                                                                                                                    |
| Main run, Undo after promotion                                  | 409 "Promoted history is read-only. Capture a correction in a new complete main run."                                                                                                                                                                                                             |
| Main run, Reject after promotion                                | direct 409 "Promoted history is read-only…"; queued `POST` 409 "State changed…"                                                                                                                                                                                                                   |
| Stale target (c5)                                               | direct 409 with `reviewer: "42"`; queued receipt 409 with no `reviewer`                                                                                                                                                                                                                           |

### M4 · The same command ID again (S4d) — `c-undo-replay`

Expected (`docs/review-guide.md:51`): "a lost response cannot create a second decision".

| Request                                                             | Observed                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Direct, same body                                                   | 200, same result. Total change of both requests: `decisions +1, commands +1, audit +1, statusOutbox +1` |
| Direct, other verdict; other `expectedBaselineRevision`; other user | 409 "The command ID already belongs to another request."                                                |
| Queued, same body                                                   | 202 `{queued, commandId}`; one task                                                                     |
| Queued, other verdict                                               | 409 "This command ID already belongs to another decision."                                              |
| Receipt read by another user                                        | 404 "The queued decision was not found."                                                                |
| A queued command sent again on the direct path                      | 200, saved result                                                                                       |
| A direct command sent again on the queued path                      | 202, then receipt 200 with the saved result                                                             |

### M5 · A review task that fails 5 times, and a lost lease (S4e) — `e-dead-task`

Raw lines are in STATE-04. Result in short: `dead` after 5 attempts (1 inline, 4 consumer passes); receipt 409 `{error, model}` "The queued decision could not be processed. Review it again."; rows `no decision@0`; `operations_events` empty; the same ID again: `POST` 202 and receipt 409; a new ID: 200 and `approved/human@1`. The decision is not saved. The user must decide again with a new command.

Lost lease: inline worker (30 s lease) task `complete` at 31 s; consumer (12-minute lease) task `complete` at 721 s. The probe moved the clock of the consumer pass forward; it did not wait.

### M6 · A locked check after "success" — `status.probe`

Raw: `results/status-locked-success.json`. Lines are in STATE-03. In this probe the one failed read locked all three checks of the pass (`"attention": 3`), as the first verification of OPS-01 saw.

### M7 · A status pass that overlaps a decision, and a lost wake-up message — `status.probe`

`results/status-pass-overlap.json`: the decision answered 200 during the pass. First pass: `"checks": "completed 0, attention [\"scheduler\"], hasMore false"`, event `{"kind": "checks", "subject": "scheduler", "code": "step-failed", "unresolved": 1}`, GitHub requests: two `POST` for new checks, no `PATCH`. Second pass: `"checks": "completed 2, …"`, both checks `PATCH … -> success`, event resolved.

`results/status-lost-wakeup.json` (`operations.send` throws): `POST` 202; receipt 200 with `runStatus: "passed"`; one undelivered `visonaut_status_outbox` row; GitHub check `failure` until the next pass, then `success`.

### M8 · Commands with many targets (S4h) — `h-bulk`, `h-bulk-5000`

The rows are synthetic: inserted with SQL into a real `ready` comparison, with row IDs (138 characters) and tuples of production length. The command path is real.

```json
{ "targets": 1000, "error": null, "writeBatchStatements": 4010, "expectedStatements": 4010,
  "writeBatchPayloadBytes": 2442021, "writeBatchLocalMs": 114.5, "approvedRows": 1000 }
{ "targets": 5000, "error": null, "writeBatchStatements": 20010, "expectedStatements": 20010,
  "writeBatchPayloadBytes": 12202022, "writeBatchLocalMs": 509.8, "approvedRows": 5000 }
```

HTTP, 1,000 targets: direct `POST` 200, request 169,254 bytes, answer 964,511 bytes, 1,000 rows `rejected`. Queued `POST` 202; task payload 169,293 bytes. Undo 200, 4,012 statements, 134 ms in the batch. 100 targets: 410 statements, 18 ms.

Limits:

- The total local time of a call (31 s for 1,000 targets, 157 s for 5,000) is a property of the harness. Each `prepare().bind()` on the Miniflare proxy is one process round trip: 1,000 pairs with no query took 5,168 ms. In a Worker these calls are local. Use only the batch time and the counts.
- For the same reason the 30-second inline lease ended before the receipt was written in the 1,000-target queued case: 1,000 rows were `approved`, the task was `leased`, and the receipt answered 202. This shows the state "decision saved, receipt not written" from the failure table. It does not show that production needs more than 30 seconds.
- I did not test the HTTP path with 5,000 targets, and I did not test the body limit with a request (the 6,190 figure is 1 MiB divided by the measured 169.3 bytes for each target).
- Production D1 limits for a batch of 4,010 or 20,010 statements are not verified.

### M9 · Promotion steps (S5) — `promotion.probe`

Real `runOperations(context, {kind: "status"})` with real image bytes and digests in a memory store. Raw: `results/promotion.json`.

| Case                                 | Observed                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Last approval of a main run (queued) | after the request: `passed, active 1, state reviewing`. After one status pass: `"promotion": "completed 1, …"`, run `passed, active 0, state accepted`, baseline revision 2. Undo: 409 "Promoted history is read-only…" (409 "The baseline changed after this command." with the old baseline revision) |
| `promote` batch fails one time       | pass: `"promotion": "completed 0, deferred 0, attention 1, hasMore false"`; snapshot `copying`; pins `promotion` and `review`; event `promotion / source-verification-failed`. Next pass: `completed 1`, snapshot `accepted`, event resolved                                                            |
| Undo between prepare and promote     | Undo 200, run `needs-review`. Next pass: snapshot `revoked`. New approval and pass: a second snapshot `accepted`, run `accepted`                                                                                                                                                                        |

Note: a storage error in `promote` gets the event code `source-verification-failed` (`apps/web/src/operations/promotions.ts:421-424`). The source was not the cause.

### M10 · "Equivalent merge check retired" (S4i) — `i-equivalent`

Real `reconcileEquivalentPullRequestChecks`, fixture shape of `apps/web/src/api/webhooks.test.ts:388-443` with head checks. Raw: `results/i-equivalent.json`. Lines are in STATE-07. With a passed source: check 1 `success`, check 2 `neutral`. With a failed source: check 1 `failure`, check 2 `neutral`. In both cases the row of check 2 becomes `docs_complete`, and the tested run (check 1) stays the owner of the verdict.

### M11 · Error surface (S6) — `errors.probe`

Raw: `results/errors.json`. The table is in "Error surface".

### M12 · Truth table (S3) — `truth.probe`

Raw: `results/truth-table.txt` and `results/truth-table.json`. The status column comes from the real `reviewStatus` function. The check column and the label column are copies of two expressions (`run-status.ts:95-105`, `apps/web/src/routes/index.tsx:130-140`).

## Open questions and items not verified

1. **Which check run GitHub uses when one commit has two check runs with the name `Visonaut` from the same App.** This decides the impact of STATE-07 and of the two checks after a rerun (M2, case i). The GitHub pages that I read say that `neutral` passes a required check and that the `filter` parameter of the list endpoint has the default `latest` ("returns the most recent check runs"). They do not state the rule for required checks. A test on a real pull request is necessary.
2. **Production rate of the conflicts in STATE-01.** The window is one D1 round trip for a decision and several round trips for a status pass. I did not measure production timing, and I sent no request to production.
3. **Production D1 limits for large batches** (STATE-09). Local D1 accepted 20,010 statements and 12.2 MB. The code comment at `packages/service/src/local-comparison.ts:86` names "D1's request limit" for 512 KiB pages. I did not find the official number.
4. **An expired incomplete run and its GitHub check.** `expireIncompleteWorkflowRun` sets `pre_run_checks.state = 'failed'` in D1 (`packages/service/src/run-retirement.ts:124-133`) and sends no request to GitHub. The run is then inactive, so the status sender does not select it (`review-status.ts:25-27`). From the code, the check of that attempt stays `in_progress` until a rerun closes it (`apps/web/src/api/pre-run-attempts.ts:634-657`) or GitHub marks it stale. I did not run this path. It needs the pre-created check fixtures.
5. **When the `pull_request` webhook retires the older run after a push** (STATE-06). The code needs `pull.merge_commit_sha` to be the new merge commit at the time of the event. I did not observe real webhook timing.
6. **The sparse inventory path.** All probes use the dense fixture. The decision functions are the same, but I did not run a complete trusted Submit with a signed receipt.
7. **Merge group runs.** `needs-review` is `pending` for a merge group (truth table, row 6). I ran no merge group scenario. The contract says that the real merge queue is deferred.
8. **Undo and the 10-second permission cache.** The contract says that Undo needs a live permission check. I did not test the permission layer; the auth lane owns it.
9. **`currentBaselineGuard`** (`packages/service/src/review-commands.ts:112-124`). Each decision asserts that the current baseline snapshot has no changed row without a valid approval. No probe made this guard fail. With promoted history read-only, I found no code path that can make it false. It can be a leftover of the removed rollback rule (D22, D26). Not verified.
10. **Behavior of the browser client** for each answer in this report. The UI track owns it. I read only the request code (`apps/web/src/review/client.ts`, `use-review-session.ts`).
