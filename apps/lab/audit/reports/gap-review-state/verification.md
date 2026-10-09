# Verification of the lane "gap-review-state"

Verifier: a second auditor who did not write the report. Commit `f83fef6`. Root: `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`. Paths below are relative to this root unless they start with `/`.

This work was read-only. No repository file was changed. No request went to production. GitHub: 2 read-only GraphQL calls (one failed with HTTP 502). Web: 5 reads of official documentation pages.

## Method and re-run record

1. I read each cited file and compared each quoted line.
2. I copied the auditor's probes to `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-review-state/verify/` and ran them again with repository code. Command, from the repository root:

   ```sh
   node_modules/.bin/vitest run --config /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-review-state/verify/vitest.probe.config.mjs <probe name>
   ```

3. I wrote 5 new probes (`v-*.probe.ts`) and one GitHub read script (`gh-checks.mjs`) in the same directory. Raw results: `verify/results/`.

| Probe                                                                                     | Result of the re-run                                                                                                                                                 |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a-concurrency` (2 tests)                                                                 | Same as the auditor. Natural overlap: `{"200": 23, "409": 17}` again.                                                                                                |
| `rules` (2 tests)                                                                         | `rules-reuse.json` identical. `rules-runs.json` differs only in the numbers of the stub checks.                                                                      |
| `c-undo-replay`, `e-dead-task`, `errors`, `i-equivalent`, `promotion`, `status` (3 tests) | Identical after UUIDs are masked.                                                                                                                                    |
| `h-bulk-5000`                                                                             | 1,000 targets: 4,010 statements, 2,442,021 bytes, 124.4 ms. 5,000 targets: 20,010 statements, 12,202,022 bytes, 492.5 ms, `error: null`. Same counts as the auditor. |
| `h-bulk` (HTTP, 1,000 targets), `truth`                                                   | Not run again.                                                                                                                                                       |

New probes:

| Probe           | Question                                                                                                                                | Raw result                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `v-stagger`     | How does the 409 count of STATE-01 depend on the start offset of two requests?                                                          | `v-stagger.json`                      |
| `v-reuse-fix`   | Is the SQL of the STATE-02 recommendation valid, and which index does it use?                                                           | `v-reuse-fix.json`                    |
| `v-rerun`       | STATE-02 without a push (workflow re-run), and on the main run after a merge. STATE-03: when does a passed check get a new GitHub read? | `v-rerun.json`, `v-status-reads.json` |
| `v-outage`      | STATE-04: does a complete D1 outage use the 5 attempts?                                                                                 | `v-outage.json`                       |
| `v-command-row` | STATE-09: how large are the stored rows of one large command?                                                                           | `v-command-row.json`                  |

Limits of my probes: the same as the auditor's. Local D1 (Miniflare) is not production D1. The fixture is the dense fixture. GitHub is a stub.

Summary of verdicts:

| ID       | Verdict                                                                      | Auditor severity | My severity |
| -------- | ---------------------------------------------------------------------------- | ---------------- | ----------- |
| STATE-01 | partly-confirmed                                                             | high             | medium      |
| STATE-02 | partly-confirmed (the defect is confirmed and is wider than the report says) | high             | high        |
| STATE-03 | confirmed                                                                    | high             | medium      |
| STATE-04 | partly-confirmed                                                             | medium           | low         |
| STATE-05 | partly-confirmed                                                             | medium           | low         |
| STATE-06 | partly-confirmed                                                             | low              | low         |
| STATE-07 | partly-confirmed (impact not verifiable)                                     | medium           | low         |
| STATE-08 | confirmed                                                                    | low              | low         |
| STATE-09 | confirmed                                                                    | low              | low         |
| STATE-10 | confirmed (one small correction)                                             | low              | low         |

---

## STATE-01 · A decision fails with 409 when any other write of the project commits at the same time

**Verdict: partly-confirmed. Severity: medium** (auditor: high).

### Proof that I checked

- The code is as quoted. `packages/service/src/review-commands.ts:213-216` starts each decision batch with `projectGuard` and `reviewGuard`. `reviewGuard` has `run.revision = ?` (`:107`). Undo has the same guards (`:368-370`). `packages/service/src/status-touch.ts:11` adds 1 to the project revision in each check-visible write.
- `apps/web/src/operations/review-queue.ts:134-146` completes the task with `{"error": message}` for a `ConflictError`. No retry. `:106-116` fails each successor.
- The client does not retry a conflict. It clears its queue: `apps/web/src/review/use-review-session.ts:373-394` (`session.queue = conflict ? [] : ...`).
- Re-run of `a-concurrency`: every case gave the auditor's result. Examples from `verify/results/a-concurrency.json`: different rows of one run with an injected overlap: `"loserA": {"status": 409, ... "State changed. Refresh the comparison before trying again."}`, `"rowOfA": "no decision@0"`. Queued chain with one overlap: receipts 409, 409, 409.
- Re-run of `status` (overlap of a decision and a status pass): `"checks": "completed 0, attention [\"scheduler\"], hasMore false"` and the event `checks / scheduler / step-failed`. The next pass resolved the event.
- No document asks for one writer for each project. `docs/simplification-audit/contract-issue-1.md:223` asks for "expected decision revisions" and "atomic, revision-checked state transitions". A retry or a narrower guard keeps both.

### Corrections to the finding text

1. **"17 of 40" is the result for two requests that start in the same instant.** The auditor's probe sends each pair with `Promise.all`. The report says: "It shows that the conflict needs no special timing." That is not correct. My probe `v-stagger` sends the same pairs with a start offset:

   ```json
   "conflictsByStartOffset": {
     "0 ms":   { "ok": 8,  "conflict": 8 },
     "5 ms":   { "ok": 10, "conflict": 6 },
     "10 ms":  { "ok": 13, "conflict": 3 },
     "20 ms":  { "ok": 12, "conflict": 4 },
     "40 ms":  { "ok": 10, "conflict": 6 },
     "80 ms":  { "ok": 16, "conflict": 0 },
     "160 ms": { "ok": 16, "conflict": 0 }
   }
   ```

   The local window between the end of the read batch and the end of the write batch was 102 to 144 ms (median 116.1 ms, 10 samples). This window is larger than in a Worker, because each `prepare().bind()` is a process round trip in the harness. A conflict needs a second commit inside this window. With an offset of 80 ms or more, no decision was lost. So the sentence "Two reviewers ... cannot work at the same time without lost decisions" is too strong. Correct text: two writers lose a decision when their commits are less than one read-to-write window apart.

2. **The direction is one way for the status pass.** `prepareStatusIntent` asserts the project revision but does not change it (`packages/service/src/run-status.ts:107-141`). A status pass cannot make a decision fail. A decision can make the status pass fail. The report says this correctly in the text; the title of the JSON index does not.
3. **For one reviewer on a pull request, no step of the reviewer's own status pass changes the project revision.** `review-decisions` runs the reviewer's own chain in order, `checks` and `review-links` do not touch the revision, and `promotion` is for main runs. The consumer has `"max_concurrency": 1` (`apps/web/wrangler.jsonc:103`). So a lone reviewer loses a decision only to an external commit (CI materialization, a webhook retirement, a promotion, maintenance). The report states that this rate is not measured. I agree.

### Why medium and not high

No wrong state is saved. The loser gets 409 with the current model, and the client says that later queued decisions were not saved. The cost is repeated work, an unclear message, and `checks: step-failed` alerts that clear at the next pass. The measured loss rate applies to simultaneous starts only.

### Check of the options

- Retry inside the service (the recommendation): feasible. All checks before the write run again in each attempt, so a real stale target still gives "A target changed ...". The happy path keeps its 3 round trips (test `packages/service/src/service.test.ts:1880-1923`).
- Catch `ConflictError` for one run in `deliverGitHubStatuses`: feasible. `hasMore: true` gives a continuation after 1 second (`apps/web/src/runtime.ts:454`).
- Narrow the guards: one more point is necessary. The command result stores `runRevision: run.revision + 1`, computed before the write (`review-commands.ts:224-225`). The route and the client use this value (`apps/web/src/api/review.ts:891-893`, `apps/web/src/review/navigation.ts:137`). Without the run revision guard this value can be wrong, so it must be computed in SQL in the same batch. `RETURNING` alone is too late for the stored `result_json`.

---

## STATE-02 · A Reject of a carried approval is dropped at the next push

**Verdict: partly-confirmed. The defect is confirmed and reproduced. Two statements in the report need correction. Severity: high** (same as the auditor).

### Proof that I checked

- `packages/service/src/local-comparison.ts:24-36` and `:591` are as quoted. The reuse rule reads only approved decisions and takes the oldest.
- `packages/service/src/review-commands.ts:242-246`: Reject revokes the decision of the rejected row only. For a copy this is `copied:<row>`, not the source.
- The probe fixture agrees with production on the important point. In production a new run of a pull request gets a verified link from every earlier run of the same pull request: `apps/web/src/api/lineage.ts:568-580` selects each run with `lineage_key = 'pr:<number>'`, and `apps/web/src/api/lineage.ts:362-365` adds each with the reason `same-pr`. `packages/service/src/lineage.ts:10-21` also adds each ancestor of an ancestor.
- Closed runs keep their decisions for 30 days and longer: `apps/web/src/operations/closed-summary.ts:315` ("Exact tuples and decision stubs still serve baseline and source approval checks").
- Re-run of `rules`: `rules-reuse.json` is identical to the auditor's file. Case g2: run 3 `"r2": "approved/human(copied)@1"`, `"run3_checkConclusion": "success"`. Case g3: `"added": "approved/automatic(copied)@1"`, `passed`.

### New measurements (the finding is wider than the title)

Probe `v-rerun`, raw `verify/results/v-rerun.json`:

```json
"run2_afterRejectByUser43":      { "status": "rejected", "r2": "rejected/human@2" },
"rerunOfSameWorkflow_attempt2":  { "status": "passed",   "r2": "approved/human(copied)@1" },
"rerunCheckConclusion": "success",
"attempt2_afterSecondReject":    { "status": "rejected", "r2": "rejected/human@2" },
"mainRunAfterMerge":             { "status": "passed",   "r2": "approved/human(copied)@1" },
"mainRunDecision": { "kind": "human", "actor": "42", "decisionId": "copied:<row id>" },
"mainRunCheckConclusion": "success"
```

1. **A push is not necessary.** A re-run of the same workflow (attempt 2, same commit) copies the older approval again.
2. **After a merge, the main run copies the older approval.** The main run has verified links to the runs of the merged pull request (`apps/web/src/api/lineage.ts:381-386`, reason `merged-pr`). It is `passed` with no pending row. A main run with no pending row is promoted (`readyGuard`, `packages/service/src/baseline-promotion.ts:22-30`). I did not run the promotion step in this probe.

### Corrections to the finding text

1. **The index that the recommendation names does not exist.** The report says: "The index `visonaut_decisions_tuple (tuple_json, revoked, verdict)` exists (`apps/web/migrations/0001_service.sql:153`)." Migration `0009_retention_history.sql:43` drops it:

   ```sql
   DROP INDEX ariviso_decisions_tuple;
   CREATE INDEX ariviso_decisions_pixels ON ariviso_decisions(
     json_extract(tuple_json,'$.referenceDigest'),
     json_extract(tuple_json,'$.candidateDigest'), revoked, verdict
   );
   ```

   The current schema has only `visonaut_decisions_pixels` (`0014_visonaut_brand.sql:45-48`; measured list in `v-reuse-fix.json`). With the SQL of the report as written, the query plan is a full scan of `visonaut_decisions` for each candidate decision of each changed row:

   ```text
   auditor's condition:   "SCAN later"
   with digest predicates: "SEARCH later USING INDEX visonaut_decisions_pixels (<expr>=? AND <expr>=? AND revoked=? AND verdict=?)"
   ```

   Add the two predicates that `acceptanceValiditySql` already uses (`local-comparison.ts:25-26`):

   ```sql
   AND json_extract(later.tuple_json,'$.referenceDigest') IS json_extract(row.tuple_json,'$.referenceDigest')
   AND json_extract(later.tuple_json,'$.candidateDigest') IS json_extract(row.tuple_json,'$.candidateDigest')
   ```

2. **The SQL itself is valid and gives the intended result** (measured, `v-reuse-fix.json`). Run 3 after a Reject of the copy in run 2: current code `"r2": "reuse (first-hand)"`; with the condition `"r2": "no reuse"`; the untouched row `r3` keeps its reuse. After a new first-hand approval in run 3, run 4 can reuse again with the condition.
3. **The contract citation needs the C02 context.** The report cites `docs/simplification-audit/contract-issue-1.md:209` ("A retry cannot recreate rejected or revoked acceptance."). The maintainer later selected C02 "copy". Its recorded text is: "Later review changes apply to their own active run" and "removes later cross-run revocation" (`docs/simplification-audit/audit-data.json`, decision C02, `settled.optionId: "copy"`). `docs/simplification-audit/handoff-draft.md:22` says that C02 replaces the "live cross-run revocation" of the acceptance sections. So line 209 alone does not prove a contract breach. But C02 names only one direction: its risk text and its test list say "a later source rejection affects no copied downstream approval". The direction of this finding (Reject of the copy, then a new copy from the old source) is in no document and in no test (`packages/service/src/service.test.ts:961`, `:1830` test the other direction).
4. **The code is not consistent with itself.** A Reject in the run that made the approval stays (case g4: next run `no decision`, `needs-review`). A Reject of a carried copy does not stay (cases g2, g3). This supports "not intended" more than line 209 does.

### Real exploitability

Who: any person who can push to the pull request branch or re-run its workflow. What they need first: a maintainer approval of the same pixels in an earlier run of the same pull request (or an automatic approval of a new item), and then a maintainer Reject on a later run. What they gain: the required check is `success` again with no new human decision, and after a merge the main run takes the change into the baseline. They cannot get pixels approved that no rule approved before. The common case is not an attack: a reviewer rejects a new image in run 2 or later, the author pushes a commit that does not change that image, and the check is green.

### Check of the options

- Recommendation (refuse reuse when a newer current rejection of the same tuple exists in the lineage): feasible, with the index correction above.
- "Also revoke the source decision": this writes to a run that can be closed. `docs/current-contract.md:50` (D05) says all closed history is read-only. This option needs an explicit decision.
- "The newest verdict wins": feasible and simple to explain.

---

## STATE-03 · A check that is locked after "success" keeps "success" after Reject or Undo

**Verdict: confirmed. Severity: medium** (auditor: high).

### Proof that I checked

- `packages/service/src/work.ts:538-548`: each error inside `send` sets `ambiguous = 1` and keeps `lease_token`. `packages/security/src/checks.ts:173`: the first statement of `sendGitHubCheck` is the `GET`. So a failed read locks the check.
- No code clears the lock. `settleStatus` is the only statement with `ambiguous = 0` (`work.ts:598`). It needs the lease token. Its callers are the success path and the path for `request_started = 0` (`work.ts:635-652`).
- A new status after the lock cannot be claimed: `claimStatus` needs `lease_token IS NULL` (`work.ts:441-447`).
- `apps/web/src/operations/checks.ts:258-266` returns `"attention"` for a locked check and sends nothing.
- The production path is the same sender. Current pull request checks are on the pull request head. `apps/web/src/operations/review-links.ts:174` skips them (`if (candidate.checkHeadSha === candidate.sourceSha) continue;`), so `deliverGitHubStatuses` is their only publisher.
- Re-run of `status`: identical. After the Reject: `"serviceStatus": "rejected"`, `"gitHubCheck": "success"`, 3 healthy passes with `"gitHubRequestsForThisCheck": []`.
- New probe `v-status-reads.json`: 2 idle passes after an approval send nothing (`"github": []`). After one event of another pull request, each check gets a `GET` and a `PATCH`. So each project event is one new chance for a failed read, as the report says.
- Platform facts in the recommendation are correct. GitHub: "If GitHub takes more than 10 seconds to process an API request, GitHub will terminate the request" (https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api). Client: `AbortSignal.timeout(15_000)` (`packages/security/src/github.ts:78`). Lease: 12 minutes (`apps/web/src/runtime-defaults.ts:23`).

### Why medium and not high

The harmful case needs two events in order: a failed GitHub read (or a `PATCH` with no answer) for a check that already shows `success`, and then a Reject or an Undo on the same head commit. No user can cause the first event. A reversal after an approval is not frequent. The alert `check-delivery: ambiguous` is open in this state. The result is a required check that is wrong in the passing direction, so it is not low. The cause is OPS-01, which is rated high already.

### Corrections to the options

- The two-line sketch does not work alone. At `checks.ts:258` the `delivery` object has no lease time and no conclusion (`reconcileStatus` returns `id`, `desired_revision`, `lease_token`, `lease_revision`, `ambiguous`, `state`: `work.ts:653-692`). `deliverStatus` and `isStatusCurrent` need `ambiguous = 0` (`work.ts:479`, `:494`). The old outbox row is in the state `sending`. A fail-closed write needs a new step that settles the old lease after its end, and then a normal claim. Effort M is correct.
- The idea is safe for the platform: a `failure` or `pending` write cannot make a pass, and an old request cannot write after the lease time.
- Fixing OPS-01 first removes most of the exposure. I agree with this order.

---

## STATE-04 · A queued decision that fails 5 times is dead for its command ID

**Verdict: partly-confirmed. Severity: low** (auditor: medium).

### Proof that I checked

- `apps/web/src/operations/review-queue.ts:148-154` (`retryAt: context.now()`), `:62` (`maxAttempts: 5`), `:28-32` (`if (previous) return;`), `apps/web/src/api/review.ts:817-830` (a `dead` task answers 409 with the code `conflict`), `apps/web/src/runtime.ts:454` (continuation after 1 second), `apps/web/src/runtime-defaults.ts:23` (12 minutes): all as quoted.
- Re-run of `e-dead-task`: identical. `dead` after 5 attempts, receipt 409 `conflict`, `"operationsEvents": []`, the same ID again: `POST` 202 and receipt 409, a new ID: receipt 200.

### Corrections to the finding text

1. **"A storage fault of some seconds makes the decision dead" is true only for a partial fault.** The auditor's probe makes only the review write batch fail (`e-dead-task.probe.ts:48-52`, pattern `INSERT INTO visonaut_commands`). Each other D1 call works. In a complete outage the attempt counter does not move, because the claim is the statement that adds 1 to `attempts` (`packages/service/src/work.ts:113-134`) and the claim needs the database. Measured (`v-outage.json`), every D1 call fails:

   ```text
   consumer pass 1..6   threw: D1_ERROR: Network connection lost.   task queued, attempts 0
   pass after the outage   completed 1   task complete, attempts 1   row "approved/human@1"
   ```

   So a task becomes `dead` when the claim works, the review write fails with an error that is not a conflict, and `failWork` works, 5 times. An error that repeats for each attempt does this. One candidate is a command that is too large (see STATE-09).

2. **The reviewer is not blocked.** A 409 receipt is a conflict for the client. The client clears its queue and does not offer "Retry same command" (`apps/web/src/review/use-review-session.ts:275`, `:378`). The reviewer decides again, the client makes a new command ID, and that works (measured by the auditor and by me). The wrong parts are the `202` answer for a dead task, the code `conflict`, and the missing alert.
3. **The delay after a stopped inline worker is more than 30 seconds.** The `status` message is sent after the inline processing in the same promise (`apps/web/src/api/review.ts:643-665`). If the worker stops in the processing step, no message is sent. The lease ends after 30 seconds, but the next consumer pass comes with another decision or with the 5-minute cron. The report's table says "30 s (measured: done at 31 s)". That number is the lease, not the repair delay. The probe called the consumer by hand.
4. The 12-minute hold is correct from the code (`apps/web/src/operations/index.ts:48` passes the general budget). It was measured with a moved clock, as the report says. The consumer processes review tasks in normal use: a chained decision whose predecessor was not complete at admission is not started by its own request (`review-queue.ts:88-91`).

### Check of the options

All are feasible. `failWork` takes `retryAt` already. A separate lease time for review tasks is one argument.

---

## STATE-05 · The queued path and the direct path give different answers for the same refusal

**Verdict: partly-confirmed. Severity: low** (auditor: medium).

### Proof that I checked

- `apps/web/src/api/review.ts:682-697`, `packages/service/src/review-commands.ts:190`, `apps/web/src/operations/review-queue.ts:140-145`, `review.ts:817-830`, `apps/web/src/review/client.ts:313-317` and `:275`: all as quoted.
- Re-run of `errors` and `c-undo-replay`: identical. No targets: direct 409 `incomplete`, receipt 409 `conflict`. Missing predecessor: `POST` 503 `service_unavailable`. Stale target (c5): direct `"reviewer": "42"`, receipt with no `reviewer`.
- `docs/simplification-audit/contract-issue-1.md:225` is still binding: "A stale command returns a conflict with current state and identifies the conflicting reviewer in the private UI."

### Corrections to the finding text

1. **"A missing predecessor ... offers a retry that cannot succeed" is not correct for the web client.** A second `POST` starts only after the first `POST` has an answer or an error (`client.ts:306-323`, the `admission` chain). When the first `POST` fails, the client reports that error, aborts the later entries, and keeps all commands (`use-review-session.ts:373-379`). **Retry** sends all entries again in order (`:286-305`), so the predecessor arrives first. The 503 for the successor is an answer that the client discards. The server text "The previous decision has not reached the server. Retry the unsent decisions." is lost in the 503 mapping; that part is correct.
2. **"The reviewer cannot see who changed a row" is too strong.** The 409 receipt has the current model. The client installs it (`use-review-session.ts:265-268`), and the details line prints the reviewer of the row (`apps/web/src/review/review-workspace.tsx:463-466`). What is missing is the name in the message. Also, the value is the numeric GitHub user ID, not a login (`review.ts:500` `reviewer: effective.actor_id`, `:857` `actorId: context.identity.githubUserId`). The ui-copy lane reported this already. A fix of this finding must resolve the ID to a login, or the message is "Updated by 42."

### Why low

No wrong state. The differences are codes and sentences. The contract sentence about the reviewer is not met in the message on the queued path.

### Check of the options

The minimal option (compute `reviewer` in the receipt route from the model and the targets in the task payload) is feasible: the payload has the targets (`review.ts:805`) and the model has `reviewer` for each variant.

---

## STATE-06 · Two runs of one pull request can be open for review

**Verdict: partly-confirmed. Severity: low** (same as the auditor).

### Proof that I checked

- `packages/service/src/run-admission.ts:120-124` closes only runs with the same `external_run_id`. `apps/web/src/api/webhooks.ts:283-323` is as described. Approvals are copied one time (`packages/service/src/local-comparison.ts:612-624`).
- Re-run of `rules`, case b2: approval on the older run after the newer run is ready: 200, older run `passed`, newer run `"r1": "no decision@0"`.

### Correction to the finding text

The report assumes: "If GitHub had not computed the new merge commit when the webhook arrived, nothing retires the run at that time." The code does more. In that state the same webhook fails with 503, the delivery stays not processed, and the 5-minute recovery pass processes it again from the start:

- `webhooks.ts:299-307`: `merge_not_ready` when the merge ref is not the current `merge_commit_sha`.
- `apps/web/src/api/pre-run-candidates.ts:73-87`: `merge_not_ready` when `merge_commit_sha` is missing, or when it is the old merge commit. For the old merge commit, `mergeBaseForHead` returns `null` because its second parent is the old head (`apps/web/src/api/merge.ts:16-23`, `:45-58`).
- `webhooks.ts:330-335` sets `processed_at` only at the end. `reconcileWebhooks` (`:362-395`) runs in each `recovery` message (`apps/web/src/runtime.ts:369-371`; cron `*/5 * * * *`, `apps/web/wrangler.jsonc:110`). Production has `VISONAUT_WORKFLOW_OWNED` (`wrangler.jsonc:61`), so the candidate step runs.

So the older run is retired by the first webhook attempt after GitHub has the new merge commit. The newer run needs the CI time first (one dated record: 232 s from Submit to the reservation, `docs/evidence/checks-7710/README.md:43`). Two open runs need a lost delivery or a webhook recovery that fails for the full CI time. I did not observe real timing. The report says the same about its own assumption.

### Check of the options

"Close the older open runs of that lineage ... with a guard on the verified lineage link": the link alone is too wide. `visonaut_lineage` also has links from main runs and from merged pull requests. The guard must also compare `lineage_key` (`pr:<number>`).

---

## STATE-07 · "Equivalent merge check retired" makes the check neutral also when the tested result failed

**Verdict: partly-confirmed. The code facts are confirmed. The impact is not verifiable. One option is wrong. Severity: low** (auditor: medium, confidence low).

### Proof that I checked

- `apps/web/src/api/pre-run-checks.ts:255-260` accepts `success` and `failure`. `:350-363` writes `conclusion: "neutral"`. `:201-205` selects only rows with a check and no workflow run.
- Re-run of `i-equivalent`: identical. Failed source: `"githubWrites": ["PATCH check 2 -> neutral"]`.
- GitHub documentation, read on 2026-10-05: "Successful check statuses are `success`, `skipped`, and `neutral`." (https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks). The page has no rule for two check runs with one name on one commit.
- Reach: correct. A webhook stores a candidate with no check (`pre-run-checks.ts:590-604`, `createCheck: false`). A check with no workflow run needs older data or a stop between `pre-run-attempts.ts:864` and `:877`.
- I looked for live evidence. One read-only GraphQL call for the 25 most recently updated pull requests of `ariakit/ariakit`: 22 heads have one `Visonaut` check run, 0 heads have two (`verify/results/gh-pr-checks.raw.json`). So production gives no evidence for the question today.

### Corrections

1. **The main recommendation can block a pull request for good.** It writes `failure` to the alias when the source failed. The alias is processed only while its GitHub check is `queued` or `in_progress`, or when it is already retired (`pre-run-checks.ts:323-331`). After the write, the row is `docs_complete` with `lease_until = NULL` (`:373-377`), and the selection needs `alias.lease_until<=?` (`:203-204`). So the alias stays `failure` when the reviewer later approves the source. If GitHub needs each same-name check to pass, the pull request stays blocked.
2. **The "minimal" alternative is the correct one under both GitHub rules:** accept only `"success"` at line 257. The alias stays `in_progress` while the source fails and becomes `neutral` when the source passes.
3. The lines `:323-328` and `:366-371` also compare with `"neutral"`. Any change of the conclusion must change these lines too.

### Real exploitability

Not shown. It needs a rare row state and an unknown GitHub rule. No user can make the row state on demand.

---

## STATE-08 · A carried approval looks like a first-hand approval

**Verdict: confirmed. Severity: low.**

- `packages/service/src/local-comparison.ts:614-615` copies `source.kind` and `source.actor_id` and stores `source.id` in `source_decision_id`. `apps/web/src/api/review.ts:497-500` returns only `verdict`, `source`, `reviewer`.
- Re-run: `"copied_decision_in_review_model": {"verdict": "approved", "source": "human", "reviewer": "42"}`. The key list of the variant has no origin field.
- `docs/review-guide.md` has no sentence about carried approvals. Line 47 explains only "Accepted automatically".
- Addition: the `reviewer` value is the numeric GitHub user ID (see STATE-05).
- Option check: `carriedFrom` is feasible. The model read already loads the decisions (`review.ts:351`). The source run needs one more join. A copy of a copy points to the direct source, not to the first human decision (`local-comparison.ts:615`, `source.id`), so "decided at" needs a rule for chains.

---

## STATE-09 · One command can have about 6,000 targets

**Verdict: confirmed. Severity: low.**

- `packages/service/src/review-commands.ts:227-271`: 4 statements for each target. `apps/web/src/api/review.ts:842` (1 MiB), `:849` (`maximumCaptures`), `apps/web/src/runtime-defaults.ts:14` (40,000): as quoted.
- Re-run of `h-bulk-5000` (`verify/results/h-bulk-5000.json`):

  ```json
  { "targets": 1000, "error": null, "writeBatchStatements": 4010,  "writeBatchPayloadBytes": 2442021,  "writeBatchLocalMs": 124.4, "approvedRows": 1000 }
  { "targets": 5000, "error": null, "writeBatchStatements": 20010, "writeBatchPayloadBytes": 12202022, "writeBatchLocalMs": 492.5, "approvedRows": 5000 }
  ```

  The counts and the byte sizes are the same as the auditor's. The local times differ by some milliseconds.

### Additions (the report says: "I did not find the official number")

Official D1 limits, read on 2026-10-05 (https://developers.cloudflare.com/d1/platform/limits/):

- "Maximum string, BLOB or table row size: 2,000,000 bytes (2 MB)".
- "Maximum SQL statement length: 100,000 bytes (100 KB)". "Maximum bound parameters per query: 100". "Maximum SQL query duration: 30 seconds".
- "Queries per Worker invocation: 1000 (Workers Paid)".
- "Limits for individual queries (listed above) apply to each individual statement contained within a batch statement."
- The page and the `batch()` page (https://developers.cloudflare.com/d1/worker-api/d1-database/) state no limit for the number of statements or the size of one batch. They do not say how the statements of one batch count for the 1,000 queries limit.

One stored row grows with the target count. Measured (`v-command-row.json`, 1,000 targets, row IDs of 138 characters):

```json
"commandRowJsonCharacters": { "request": 169308, "previous": 203015, "result": 169264, "total": 541587 },
"targetsAtWhichCommandRowPasses2000000": 3692
```

So the `visonaut_commands` row of one command passes 2,000,000 bytes at about 3,690 targets. That is below the about 6,190 targets that the body limit accepts. Local D1 does not refuse such a row: the 5,000 target command (about 2.7 MB of JSON in one row, from the measured 542 bytes for each target) was accepted in my re-run. If production D1 applies the documented row limit, a command of this size fails in each attempt and its task becomes `dead` (STATE-04). This is from the documentation. It is not measured on production.

The option with `json_each` is feasible. The read batch already sends all target IDs as one bound value (`review-commands.ts:166-170`). One bound JSON value must stay below 2,000,000 bytes, which is about 11,800 targets for the ID list.

---

## STATE-10 · Three "expected" fields of a decision command have no guard effect

**Verdict: confirmed, with one small correction. Severity: low.**

- `packages/service/src/types.ts:158-159` declares `expectedPromotionId?` and `expectedBaselineRevision?`. `applyReviewCommand` (`packages/service/src/review-commands.ts:126-317`) reads neither. `expectedBaselineRevision` is a check only in Undo for runs that are not pull requests (`:353`).
- `apps/web/src/api/review.ts:881-887` uses the three body fields only to select the answer shape of the direct path.
- Correction: only two of the three fields are part of the command identity. The route does not pass `expectedRunRevision` to the service or to the task payload (`review.ts:855-871`). `expectedBaselineRevision` and `expectedPromotionId` are in the stored request. The auditor's replay example uses `expectedBaselineRevision`, which is correct.
- Note for the option "remove the fields": `docs/current-contract.md:53` (D08/D09) says "Preserve public entry points, atomic transactions, expected revisions, exact command IDs". A removal changes the stored request text, so a command that is sent again across a deploy answers "The command ID already belongs to another request." (`review-commands.ts:98-100`). Undo still needs `expectedBaselineRevision`. The report says "Maintainer decision needed: no". Because of the contract sentence, I think a decision is necessary before a removal.

---

## Missed

1. **STATE-02 has two more triggers and a worse end state (measured, `v-rerun.json`).** A workflow re-run with no push brings the old approval back. After a merge, the main run copies the old approval, is `passed` with check `success`, and has no pending row, so the promotion step can make the rejected pixels the baseline.
2. **The last approval of a main run cannot be undone.** The first status pass after it promotes the run, and Undo then answers 409. The report measured this (M9) and lists it as rule 10, but it is not a finding. There is no grace time and no confirmation for the decision that changes the baseline.
3. **A stopped inline worker also loses the wake-up message.** `apps/web/src/api/review.ts:643-665` sends the `status` message after the inline processing in the same promise. A stop in the processing step leaves the decision to the 5-minute cron or to the next decision. The failure table of the report gives 30 seconds for this case.
4. **A large command can pass the documented D1 row limit before it passes the API limits.** The stored command row is about 542 bytes for each target (measured). It passes 2,000,000 bytes at about 3,690 targets; the API accepts about 6,190. Not verified on production. See STATE-09.
5. **The `noop` result field has no producer.** `packages/service/src/types.ts:170` declares it. No service code sets it. The route and the client still have branches for it (`apps/web/src/api/review.ts:880-882`, `apps/web/src/review/use-review-session.ts:340-353`, `apps/web/src/review/navigation.ts:91`).
6. **A decision on any run can make the promotion batch of a main run fail, with a misleading alert.** `promote` has the same `projectGuard` (`packages/service/src/baseline-promotion.ts:370`). The report shows the alert code `source-verification-failed` for this case only as a side note. It belongs to STATE-01 as one more effect of the shared guard.
