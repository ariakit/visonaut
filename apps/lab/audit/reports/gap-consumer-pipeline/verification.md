# Adversarial verification: lane `gap-consumer-pipeline`

Report under test: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-consumer-pipeline/report.md`.
Repository: `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel` at `f83fef6`. All repository paths below are relative to this root.
Scratch: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-consumer-pipeline/verify/`.
Time of the live reads: 2026-10-06 00:20 to 00:45 UTC.

No repository file was changed. No request was sent to `visonaut.com`. GitHub: 18 read-only `gh api` GET requests of the 60 allowed. npm registry: two `npm view` reads and one archive download.

## Result in one table

| ID      | Verdict          | Severity (report) | Severity (this check) | Main correction                                                                                                                                                    |
| ------- | ---------------- | ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PIPE-01 | confirmed        | medium            | medium                | The open assumption is now measured: GitHub shows "succeeded in 4h 41m 40s". The minimal alternative must send the old `completed_at`, not omit it.                |
| PIPE-02 | partly-confirmed | high              | medium                | The refusals are real. The cause is still an assumption. The main recommendation gives a worse message without a CLI release.                                      |
| PIPE-03 | partly-confirmed | high              | medium                | Facts hold. 30 commits changed B, C, or D, not 36. Option D is the recorded decision A02, which production does not follow. Options B and E cost more than stated. |
| PIPE-04 | partly-confirmed | medium            | low                   | The variable is an echo. Three cells give the wrong CLI text for HTTP 403.                                                                                         |
| PIPE-05 | confirmed        | low               | low                   | D is the true SHA-256 of the registry archive (I measured it). The pipeline does not measure it. No new attack.                                                    |
| PIPE-06 | partly-confirmed | medium            | medium                | The main case most probably fails at a different code site. The proposed status change there breaks a webhook path.                                                |
| PIPE-07 | confirmed        | medium            | medium                | The fix reverses contract line 224 and costs one pin cutover.                                                                                                      |
| PIPE-08 | confirmed        | medium            | low                   | Correct counts. 21 of 22 are on one automatic release pull request. It is incidence data for API-03, not a new defect.                                             |
| PIPE-09 | partly-confirmed | low               | low                   | Facts hold. The cause is not proved, but no other writer can make this state. The code sketch can turn "pending" into a passing required check.                    |
| PIPE-10 | partly-confirmed | low               | low                   | Facts hold. The first recommendation makes the Plan job fail for such pull requests.                                                                               |
| PIPE-11 | partly-confirmed | low               | low                   | The Node part holds. The Playwright part is wrong: nothing enforces the exact peer, so no release and no cutover is needed.                                        |

## Method

1. I opened each cited file and compared the quoted text and line numbers.
2. I recomputed the main counts and distributions from the auditor's raw data with my own scripts (not copies of the auditor's analysis): `verify/recompute.mjs`, `verify/late-writes.mjs`, `verify/queue.mjs`, `verify/pins.mjs`, `verify/logs.mjs`. Raw outputs are the `*.out.txt` files beside them.
3. I read live GitHub state for the items that a finding depends on (list at the end).
4. I read the binding contract and the recorded decisions for text that makes a behavior deliberate.
5. I checked platform facts in official documentation and in the registry.

Recomputed numbers that agree with the report (`verify/recompute.out.txt`): 98 runs (22 push, 76 pull request); 78 checks with the same title counts; 22 of 22 "not required" checks with a `/pulls/<n>?check=` link (21 on #7552, 1 on #7736); Submit executions 50 success, 10 failure, 4 cancelled, 2 skipped; 11 of 61 started "Submit captures" steps failed, at the same 11 times; linux capture 10 min 31 s / 11 min 6 s / 11 min 30 s (n = 63); safari capture 11 min 59 s / 13 min 26 s / 18 min 5 s (n = 60); Submit job 2 min 46 s / 3 min 28 s / 4 min 6 s; push to Plan end 33 s / 2 min 3 s / 10 min 36 s (n = 97); push to Submit end 17 min 43 s / 28 min 24 s / 32 min 5 s (n = 48); pull request service delay 1 min 1 s / 1 min 42 s / 3 min 37 s (n = 22); push to passed 20 min 9 s / 32 min 8 s / 33 min 12 s (n = 22); no-visual 38 s / 1 min 9 s / 1 min 18 s (n = 22).

Small differences: my matching gives n = 50 (not 49) for "Submit end to last write" and n = 52 (not 48) for "push to check exists" (p90 25 min 45 s, not 25 min 48 s). The medians of the main rows are the same. These differences change no conclusion.

## PIPE-01

Verdict: **confirmed**. Severity: **medium**.

Proof that I checked:

- `packages/security/src/checks.ts:197-200` is as quoted. Each final delivery sends `completed_at: new Date().toISOString()`.
- `apps/web/src/operations/checks.ts:206` selects each eligible run whose current intent has `stale.source_revision!=project.revision`. `packages/service/src/run-status.ts:124-135` then writes a new intent with `revision: project.revision`. So each change of the project revision gives one new delivery for each eligible run.
- Live read. The auditor's `details.json` (collected 21:05 UTC) has `completed_at: 2026-10-05T19:26:20Z` for check `111879629441`. My read:
  ```text
  $ gh api repos/ariakit/ariakit/check-runs/111879629441
  2026-10-06T00:23:18Z {"status":"completed","conclusion":"success","started_at":"2026-10-05T16:55:23Z","completed_at":"2026-10-05T21:37:03Z","title":"Visual review passed"}
  ```
  The conclusion is the same. `completed_at` moved by 2 h 10 min.
- The open assumption about the shown duration is now measured. The public page `https://github.com/ariakit/ariakit/runs/111879629441` shows "Visonaut CI / Visonaut succeeded Oct 5, 2026 in 4h 41m 40s". 21:37:03 minus 16:55:23 is 4 h 41 min 40 s. GitHub calculates the duration from `started_at` and `completed_at`.
- `verify/late-writes.out.txt`: 25 of 50 successful Submit executions have a last write more than 5 minutes after Submit end. For 22 of the 25, another run had an event in the 150 s before the write. The same three checks have no public event (`bb17f681`, `9cb28f01`, `77c59e3c`). Only 3.9 % of the event window lies within 150 s after an event, so 22 of 25 is not chance.
- Main: median 2 h 27 min 59 s, p90 8 h 15 min 50 s, max 11 h 53 min 42 s (n = 17). Same as the report.

What I searched for and did not find: a guard that skips an unchanged state, and a contract sentence that asks for a repeated PATCH as a repair. `docs/current-contract.md` has neither.

Corrections:

1. The "Minimal" alternative says "send `completed_at` only when the conclusion changes". The GitHub documentation does not say what GitHub does when `completed_at` is omitted on a check that is already complete (`https://docs.github.com/en/rest/checks/runs`: only "Required if you provide completed_at or a status of completed" for `conclusion`). Send the stored time instead. The GET response is available at that point.
   ```ts
   // packages/security/src/checks.ts, in the PATCH body
   completed_at:
     existing.conclusion === intent.conclusion && typeof existing.completed_at === "string"
       ? existing.completed_at
       : new Date().toISOString(),
   ```
2. The `same` test in the recommendation must also compare the name. The PATCH renames old checks (`checks.ts:194`, `name: CHECK_NAME`).
   ```ts
   const same = existing.name === CHECK_NAME && /* the four conditions of the report */;
   ```
3. The skip removes the PATCH only. The GET at `checks.ts:173` stays, so the request count drops by half, not to zero.

## PIPE-02

Verdict: **partly-confirmed**. Severity: **medium** (report: high).

Confirmed:

- Five refusals with the capacity text. `verify/logs.out.txt`, for example:
  ```text
  == 111426435074.txt
    2026-10-04T11:31:04.9586767Z visonaut: Visonaut has paused new capture runs at its capacity limit. Check Service attention. Rerun this job after admission resumes. No visual approval was granted.
    2026-10-04T11:31:04.9944000Z ##[error]Process completed with exit code 1.
  ```
  Times 11:31:04, 11:53:05, 12:08:17, 12:50:55, 12:53:32. Four on `main`, one on #7737.
- `apps/web/src/capacity.ts:25-30`, `:107-113`; `apps/web/src/runtime-defaults.ts:15-17`; `packages/cli/src/http.ts:190-194`; `apps/web/src/api/pre-run-attempts.ts:1010-1025`. All as quoted.
- The check text, read live: `gh api repos/ariakit/ariakit/check-runs/111430080114` gives `"conclusion":"failure"`, `"title":"Visual capture did not complete"`, `"summary":"The pinned capture workflow ended with failure."`, `"details_url":"https://visonaut.com"`. Commit `929b15439ad4` is still red.
- No Submit job ran between 12:53:35Z and 21:32:26Z. The last success before the pause ended at 11:21:47Z. So the pause started between 11:21:47 and 11:31:04, and the end is not visible.
- The check is required. This was an open item in the report. I read it:
  ```text
  $ gh api repos/ariakit/ariakit/rules/branches/main
  {"type":"required_status_checks", "parameters":{"strict_required_status_checks_policy":false,
   "required_status_checks":[{"context":"Gate","integration_id":15368},{"context":"Visonaut","integration_id":5028451}]}}
  ```

Corrections:

1. The subject of commit `6219fdf` is "Store full inventories in R2 and changed items in D1 (#247)". "Switch production to the imported baseline database" is one line of the squash body.
2. The cause is still an assumption, as the report says. Facts that support the size stop: Visonaut #247 moved production to a new database, and the signed-in measurement now shows "Database: 5.5 MiB used; 2042.5 MiB before new runs pause. Active captures: 0 of 5." (`live-authenticated.md:45`). #247 also measured 1,866 to 66 indexed writes for 100 unchanged items. The report does not weigh this. The size stop is now far away, so the probability of a repeat is lower than on 2026-10-04.
3. The stop is deliberate (`docs/evidence/capacity-admission-20260928.md:9`: "It pauses new run identities at 2 GiB physical D1"). The defect is the late place and the missing reason, not the stop.
4. "Let `begin` run `checkRunAdmission`" has two faults.
   - `beginSubmission` replaces each error with one sentence (`packages/cli/src/bundle-submit.ts:69-71`), and the capacity sentence is tied to `POST /v1/runs` (`http.ts:190`). With the published CLI 0.5.4 the consumer would read "The signed Submit check could not be started." and lose the capacity text. A CLI change is a new version in `app.yml:252` and `ci.yml:70`, so new pins B and C and one cutover (PIPE-03).
   - The admission check must run after `ensureSignedAttemptCheck` (`workflow-owned.ts:317`). If it runs before, no check exists (the PIPE-07 state). The gain is about 1 minute of about 15.
5. The sketch uses `refusedForCapacity`, which has no source. `settlePreRunWorkflow` runs from the `workflow_run` webhook and does not know why Submit failed. The refusal site (`reserveVerifiedStagedRun`, `workflow-owned.ts:415-431`) must store the reason (a new column on `pre_run_checks`, so a D1 migration) or write the check there, and the settle step must not overwrite it at `pre-run-attempts.ts:1019-1027`.
6. "Check admission in the Plan job" needs a signed report for `app=true`. `docs/current-contract.md:224` says: "There is no separate signed true report or reusable Plan mode."

Severity reason: the refusal is fail-closed and designed. The real loss was five Submit jobs and no possible visual merge for at least 82 minutes. The growth cause got a fix on the same day.

## PIPE-03

Verdict: **partly-confirmed**. Severity: **medium** (report: high).

Confirmed:

- `packages/security/src/oidc.ts:87-92`, `:157-172`, `:182-194`, `:59-69`; `apps/web/src/runtime.test.ts:122-124`; `docs/operations/adapter-service-pins.md:63-71`. All as quoted.
- The pins equal the files. `gh api "repos/ariakit/ariakit/contents/.github/workflows/app.yml?ref=643a23af…"` gives blob `202fd63a37199f5ac4350bd7c4e4bc44ea442216`, 280 lines. `ci.yml` gives `4d34ca17315b19fa90083501eb347ea23d88dda9`, 171 lines. Both equal `apps/web/wrangler.jsonc:61`.
- Pin history recount (`verify/pins.out.txt`): 36 commits matched; B changed in 25, C in 6, D in 14; by day 2, 2, 10, 6, 4, 2, 2, 6, 2.
- Cutover #238, read live: Deploy run `37124103937` from 12:49:07Z to 12:53:56Z; Ariakit #7720 created 12:59:12Z, merged 13:31:08Z. The three failed Submit logs in that window show the old D (`e1194e20…`) and exit code 4.
- Ariakit #7703, read live: created 02:50:15Z, merged 13:10:45Z, 11 commits, edits `app.yml` (43 changes) and `ci.yml` (34 changes). Five pin commits fall in that time (#181, #182, #188, #194, #200).
- The three failures after #7708 (jobs `110904926201`, `110906556535`, `110910250746`) are in the logs with the same sentence and exit code 4.

Corrections:

1. "36 pin commits" is the count of commits that touched the pin lines. 30 changed B, C, or D. 5 changed only the additional or transition values (`b69c256`, `51a3605`, `0637afb`, `cbee25f`, `5712036`). 1 changed no trusted value (`4e62991`).
2. The rate is not steady. 28 of the 36 commits are before the contract date (2026-10-02). 8 are on 10-02 and 10-03. There are 0 in the 2.5 days after 10-03 12:49Z, while Ariakit `main` got 22 commits. #7703 was the migration pull request itself. The future rate is not known. Do not read "36 in 12 days" as a forecast.
3. The report does not name the recorded decision. `docs/current-contract.md:156` lists `A02 · Pin one small visual workflow` as a selection. `docs/simplification-audit/audit-data.json` (decision A02) says: "Move capture and Submit jobs into a dedicated file … Unrelated app/deploy edits stop changing the trusted file" and "Remove old blob allowances at the cutover. Keep no optional approval window." So:
   - Option D is not a new idea. It is A02.
   - Production does not follow A02. The pin covers all of `app.yml`, which has `build`, `build-nextjs`, `test`, and `deploy-preview` (lines 14-150 and 269-280), and all of `ci.yml`. `docs/current-contract.md:218` says "Pin the exact Git blobs of `.github/workflows/ci.yml` and `.github/workflows/app.yml`". `docs/simplification-implementation.md:101` records only a "prepared visual.yml" patch. I found no record that explains the change from one small file to two full files.
   - Option B reverses "Keep no optional approval window".
4. Option B is larger than "`isTrustedWorkflowBlob` checks membership". The single value is also compared at `workflow-owned.ts:297`, `:330-333`, `:463-467`; `workflow-reconcile.ts:214-219`; `pre-run-plan.ts:25` and `:172`. `VerifiedRun` (`oidc.ts:48-57`) has no field for the blob that matched.
5. Option E needs more than the report says. Three sites assume a local file at the tested commit:
   - CLI: `packages/cli/src/signed-context.ts:27`, `claims.job_workflow_sha !== environment.GITHUB_SHA` gives "Submit did not use this commit's pinned visual workflow." (exit 4). So E needs a CLI release.
   - Server: `workflow-owned.ts:130-132` requires that `reusableWorkflowRef` starts with the consumer repository.
   - Server: `pre-run-candidates.ts:200-217` finds the tested merge commit through `referenced_workflows` with the pull merge ref.
     Platform facts for E: `{ref}` "can be a SHA, a release tag, or a branch name", and for the local syntax "the called workflow is from the same commit as the caller workflow" (`https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows`). `job_workflow_ref` and `job_workflow_sha` name the called workflow (`https://docs.github.com/en/actions/reference/security/oidc`). `ariakit/visonaut` is public (`gh api repos/ariakit/visonaut`: `"visibility":"public"`), so visibility does not block a call from Ariakit. The use of local `./` actions from a remote workflow stays not verified; the Submit job already checks out a fixed Ariakit commit before it uses one (`app.yml:238-247`).
6. Option C is described correctly. Add one fact: the Ariakit ruleset asks for a pull request with one approving review, code owner review, and approval of the last push. So "a person who can merge to `main`" means "an approved pull request".
7. The time of the variable change is public for a collaborator: `gh api repos/ariakit/ariakit/actions/variables/VISONAUT_WORKFLOW_SOURCE_SHA` gives `"updated_at":"2026-10-03T12:55:15Z"`. This is 1 min 19 s after the deployment ended. The report's bound "between 13:02:37Z and 13:26:48Z" is wrong (see PIPE-04).

Severity reason: each failure is fail-closed and a new push repairs it. One person owns both repositories and can plan the cutover. The measured cost is real, but it comes mostly from the migration days.

## PIPE-04

Verdict: **partly-confirmed**. Severity: **low** (report: medium).

Confirmed:

- `workflow-owned.ts:297` and `:330-333`: the server calculates the digest from its own configuration and compares the client value with it.
- `packages/cli/src/signed-context.ts:24` and `:81`: the CLI reads the variable only to send the digest back.
- The variable equals B today (`"value":"202fd63a37199f5ac4350bd7c4e4bc44ea442216"`).
- The line numbers of `app.yml` (11, 153, 225, 234-236, 252) and `ci.yml` (70, 82) are correct in my copy of the two files.
- `planDigest` has two meanings (`packages/cli/src/bundles.ts:50`, `signed-context.ts:81`, consumer `app/playwright.config.ts:93`).

Corrections:

1. Three cells of the table give the wrong CLI text. The CLI handles 401 and 403 before it reads the body:
   ```ts
   // packages/cli/src/http.ts:167-173
   if (response.status === 401 || response.status === 403) {
     await response.body?.cancel();
     throw new CliError(
       "Authentication or permission failed. Check the credential and repository access.",
       4,
     );
   }
   ```
   So the consumer reads "Authentication or permission failed. Check the credential and repository access." with exit code 4 for `wrong_workflow_source` (reserve), for `untrusted_run` at the Plan report (`bundle-submit.ts:36-55` has no catch), and for `manifest_provenance`. "The service refused the request (HTTP n)…" (`http.ts:221-223`) is for other codes, for example the 409 in job `110878531218`. The file did not change after 2026-10-02, so CLI 0.5.4 has this code.
2. The log evidence for the variable is read wrongly. The variable changed at 12:55:15Z. The job at 13:02:37Z printed the old value because its run was created at 12:47:22Z. In this case GitHub fixed `vars` when the run started. The job at 13:26:48Z belongs to a run created at 13:01:16Z.
3. The removal needs a CLI release (the CLI must use the returned digest). That is a new CLI version in both pinned files, so one more cutover. The alternative "the CLI reads the blob" is feasible: Submit has `contents: read` and `GH_TOKEN` (`app.yml:229-232`, `:258`).
4. The job-name lines are in the contract (`docs/current-contract.md:230`: "Set `VISONAUT_CAPTURE_JOB_NAME` to … The removed prefix setting has no fallback."). A change is a contract change.

Severity reason: one manual step and one more failure mode for each cutover. No wrong result is possible.

## PIPE-05

Verdict: **confirmed**. Severity: **low**.

Proof that I checked:

- Consumer `app/playwright.config.ts:93` and `:101` at `643a23af` (auditor's cached file): both read `requiredEnv("VISONAUT_PACKAGE_SHA256")`.
- `packages/playwright/src/discovery.ts:84` checks only `/^[a-f0-9]{64}$/`. `reporter.ts:114-124` passes the option. `sha256` in `packages/playwright/src` is used for images and font files only (`reporter.ts:208`, `visual.ts:468`, `environment.ts:45`).
- `packages/cli/src/bundles.ts:49-55` and `apps/web/src/api/context.ts:45-51` compare text with text.
- The capture job (`app.yml:173-222`) has no step that calculates a hash.
- The value is true. I measured it:
  ```text
  $ curl -sL -o playwright-0.5.0.tgz https://registry.npmjs.org/@visonaut/playwright/-/playwright-0.5.0.tgz
  $ shasum -a 256 playwright-0.5.0.tgz
  be4439ac7ce5eccea7b0d253687cae53b114884deed179d9dd17fd966b722e22  playwright-0.5.0.tgz
  ```
  So D is the SHA-256 of the published archive. The operator checks it by hand (`adapter-service-pins.md:17`). The pipeline does not.

Real exploitability:

- Who: a person with push access to a branch of `ariakit/ariakit`. A fork cannot do it (`oidc.ts:300` requires the head repository to be the same repository).
- What they need first: nothing more than push access.
- What they gain: nothing new. The capture job runs their code, so they control the images already. Decision A02 records this limit: "Candidate capture code can already supply false pixels; do not claim screenshot truth." The trusted Submit job is not affected: it checks out a fixed commit and installs the CLI by exact version (`app.yml:238-253`).

No correction to the finding text. The kind "security" is strong for this; it is a naming and simplification item.

## PIPE-06

Verdict: **partly-confirmed**. Severity: **medium**.

Confirmed:

- 11 failed "Submit captures" steps of 61, at the same times and with the same texts and exit codes (`verify/recompute.out.txt`, `verify/logs.out.txt`).
- `packages/cli/src/bundle-submit.ts:57-71` and `apps/web/src/api/index.ts:42` as quoted.

Corrections:

1. The code site for the `main` case is most probably another one. The push webhook stores a main candidate (`apps/web/src/api/webhooks.ts:186-191`, `recordPreRunCandidate`). Then `ensureSignedAttemptCheck` skips the block at `pre-run-attempts.ts:772-788`, because `storedCheck(...).kind` is `"main"`. The refusal then comes from `workflowCandidate`:
   ```ts
   // apps/web/src/api/pre-run-candidates.ts:247-250
   const ref = object(await github.request(`${root}/git/ref/heads/main`));
   if (object(ref.object).sha !== testedSha) {
     throw new SecurityError("workflow_candidate", 503, "The main branch changed.");
   }
   ```
   Both sites give 503 `workflow_candidate` with `Retry-After: 1`, so the claim "503 for a permanent state" holds. The sketch at `:782` changes only the less probable site.
2. Do not give the second site a new code without more work. `settlePreRunWorkflow` calls the same function and its catch needs `error.code === "workflow_candidate"` to retire a superseded main attempt (`pre-run-attempts.ts:950-962`).
3. The `main` case has no lasting effect. The step failed in a job that GitHub then cancelled (job conclusion `cancelled`, `ci.yml:12-14`). The report counts 11 failed steps; 10 Submit jobs have the conclusion `failure`.
4. The step time separates two classes. The three pin cases failed in 0 to 1 s. The three other cases failed in 4 to 5 s. So the three others passed the blob checks and failed late.
5. For the two pull request cases, "main moved" does not make a run untrusted by design (`oidc.ts:318-335`, `docs/current-contract.md:210-214`). For #7739, Renovate pushed the new head after the failure (next run of the branch at 23:32:06Z; failure at 23:31:32Z). A temporary `merge_not_ready` is a probable cause. It is not proved, as the report says.
6. A new server status alone changes nothing for the consumer, because `begin` hides each error. The CLI change is the part with effect, and it needs a release and a cutover.

## PIPE-07

Verdict: **confirmed**. Severity: **medium**.

Proof that I checked:

- `apps/web/src/api/pre-run-attempts.ts:881` and `:971` as quoted. `apps/web/src/api/pre-run.ts:55` refuses each Plan report where `visualRequired` is not `false`, so no path creates a check for `app=true` before `begin`.
- Push to check `started_at`, first attempts: median 15 min 3 s, p90 25 min 45 s, min 10 min 13 s, max 29 min 4 s (n = 52 with my matching).
- 12 runs with visual jobs have no check on the head commit: 2 not finished, 5 cancelled, 5 failed. Same run IDs as the report.
- The check is required on `main` (rules read, see PIPE-02).
- The long tail is the macOS runner wait, not Visonaut (`verify/queue.out.txt`): safari capture job `created_at` to `started_at` median 9 s, p90 12 min 1 s, max 14 min 52 s; 8 of 44 runs waited more than 5 minutes.

Corrections to the options:

1. The recommendation reverses `docs/current-contract.md:224` ("There is no separate signed true report"). The report says a decision is necessary. Add the cost: a server change (`pre-run.ts:55`), a new CLI flag (a CLI release), and a new step in `ci.yml` (pin C). That is one full cutover.
2. The original text of decision A04 asked for this state ("if app=true, keep it pending until signed capture and review"). The later contract text removed it. So the option restores an earlier selection; it is not new.

## PIPE-08

Verdict: **confirmed**. Severity: **low** (report: medium).

Proof that I checked:

- 22 "Visual capture is not required" checks, 22 with `details_url` `https://visonaut.com/pulls/<n>?check=…`; 21 on #7552, 1 on #7736.
- Live read: `gh api repos/ariakit/ariakit/check-runs/111873147850` gives `"conclusion":"success"`, `"title":"Visual capture is not required"`, `"details_url":"https://visonaut.com/pulls/7552?check=visonaut%3Apre%3Ae1b95ab1…"`.
- `apps/web/src/api/pre-run-checks.ts:508-514` sets the URL at creation. `apps/web/src/api/pre-run-plan.ts:178-189` completes the check with no `details_url`. GitHub kept the URL in 22 of 22 cases, so the API-03 assumption holds.
- I did not open the page. The page behavior is from API-03, which an earlier lane confirmed with a local run.

Correction: this is the incidence of API-03, not a second defect. 21 of the 22 checks are on one automatic release pull request, which one maintainer reads. "28 % of checks" is correct as a count and high as a measure of harm.

## PIPE-09

Verdict: **partly-confirmed**. Severity: **low**.

Confirmed facts:

- Final states of the 22 main commits: 15 passed, 2 capacity failures, 1 "has not passed", 1 green "running", 3 with no check. My recount agrees.
- The two green "running" checks, read live:
  ```text
  $ gh api repos/ariakit/ariakit/check-runs/111369835207
  {"status":"completed","conclusion":"success","completed_at":"2026-10-04T05:27:49Z","title":"Visual review is running"}
  $ gh api repos/ariakit/ariakit/check-runs/111219809935
  {"status":"completed","conclusion":"success","completed_at":"2026-10-03T14:16:36Z","title":"Visual review is running"}
  ```
- `packages/service/src/baseline-promotion.ts:489`, `review-status.ts:80`, `run-status.ts:95-105`, `apps/web/src/operations/main-retirement.ts:4-30` as cited.

The cause is not proved. It is stronger than "inferred":

- The title "Visual review is running" on an existing check comes only from `sendGitHubCheck` with a pending intent, and that call always sends `status: "in_progress"` (`checks.ts:45-47`, `:197`).
- No other writer can make "success" with this title. I read all eight PATCH sites (`pre-run-attempts.ts:111`, `:647`, `:1020`; `pre-run-checks.ts:119`, `:352`; `pre-run-plan.ts:179`; `operations/review-links.ts:370`; `checks.ts:192`). Each one that completes a check sends its own title.
- So GitHub took the new output and kept `completed` and `success`. The GitHub documentation does not state this behavior (`https://docs.github.com/en/rest/checks/runs`). A direct proof still needs one test write.
- Time support: the check of the old baseline `209d90a5` has its last write at 05:27:49Z, the same second as the `completed_at` of `613dca23`.

Corrections:

1. The code sketch can open a required check. It turns each pending intent on a complete check into `neutral`. GitHub counts neutral as passed: "Successful check statuses are `success`, `skipped`, and `neutral`." (`https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks`). `sendGitHubCheck` does not know the run kind. Limit the change to main runs in the caller, or use the "new check generation" alternative.
2. "No pull request path" is correct for `kind = 'pull_request'`. `baseline-promotion.ts:489` excludes only that kind, so a `merge_group` run can go from passed to pending. A merge queue is not active on Ariakit `main` (the rules read has no `merge_queue` rule), so there is no exposure today.
3. The title says "two checks are green". One is a final state (`613dca23`). The other is the first attempt of `465d713a`; a second check on that commit passed.

## PIPE-10

Verdict: **partly-confirmed**. Severity: **low**.

Confirmed facts:

- #7694 has base `solid-reboot`. 9 sample runs. Capture job time 1 h 34 min 21 s. 2 runs failed in both capture jobs at "Encrypt captures". 0 checks.
- Blobs on the branch: `4aac43e3039b…` and `c0e3da44bb1c…` (auditor's cached reads). `4aac43e3…` is the transition blob of `cbee25f` (`git show cbee25f:apps/web/wrangler.jsonc`).
- The failed step is `pnpm exec visonaut pack …` (line 208 of the old file). `docs/simplification-implementation.md:61-63` records the key retirement.
- `packages/security/src/oidc.ts:299` accepts only base `main`.

Added fact: `gh api repos/ariakit/ariakit/rules/branches/solid-reboot` returns no rules. The Visonaut check is not required on that branch. The cost is runner time and a red Gate only.

Correction to the recommendation: "select `app` visual work only for the base `main` in the planner" does not work alone.

- With the current `ci.yml`, `app=false` runs `visonaut submit --no-visual` (`ci.yml:66-70`).
- The service then refuses a base that is not `main` at `oidc.ts:299` (called from `apps/web/src/api/pre-run.ts:73-98`).
- The Plan job fails, and each job with `needs: plan` is skipped (`ci.yml:72-138`).

So the workflow must also skip the report for other bases. That is an edit of `ci.yml`, so a new pin C and one cutover. The planner is at a fixed commit (`ci.yml:40-45`), so a planner change is also an edit of `ci.yml`. The effort is not "S". "Keep `solid-reboot` current with `main`" alone gives captures that pass and a `begin` that refuses.

## PIPE-11

Verdict: **partly-confirmed**. Severity: **low**.

Confirmed:

- `packages/playwright/package.json:57-59` has `"node": "24.18.0"`. The published package has the same (`npm view @visonaut/playwright@0.5.0 engines` gives `{"node":"24.18.0"}`). `packages/cli/package.json:46-48` has `">=24.18.0 <25"`.
- Capture job `111873737902` on `643a23af`: `Found in cache @ /opt/hostedtoolcache/node/24.21.0/x64` and `node: v24.21.0`. The check of that commit passed.
- `packages/playwright/src/reporter.ts:242-243` and `packages/protocol/src/validate.ts:241` as cited. No code compares the Node or Playwright version.

Corrections:

1. The Playwright sentence is wrong. Nothing enforces the exact peer.
   - Ariakit `pnpm-workspace.yaml` at `643a23af` has no `strictPeerDependencies` (I read the file; it has only `peerDependencyRules.allowedVersions`).
   - The pnpm default is `false`: "If this is enabled, commands will fail if there is a missing or invalid peer dependency in the tree." (`https://pnpm.io/settings/peer-dependencies`).
   - A Playwright version is in no pin (B, C, D).
     So a Playwright patch in Ariakit gives a warning at most. It needs no adapter release and no cutover. The exact peer is the same kind of statement as the Node engine. It is a recorded choice (`docs/current-contract.md:22`: "The adapter has an exact Playwright `1.63.0` peer pin.").
2. `docs/operations/adapter-service-pins.md:19` is a dated record: "The merged consumer upgrade uses CLI `0.5.4` and adapter `0.5.0`. It retains Playwright `1.63.0`, Node `24.18.0`…". It was true on 2026-10-03. It is old as a description of today. It is not an error.
3. The trusted jobs still run Node 24.18.0. Submit and Plan read the version from the fixed commit `c87988ef` (`app.yml:241`, `ci.yml:43`, `:50`). The Submit log of `32c137db` (the commit of the Node update) shows `node: v24.18.0`.

## Missed

1. **Decision A02 is recorded, but production pins two full files.** `docs/current-contract.md:156` selects "Pin one small visual workflow"; the service pins all 280 lines of `app.yml` and all 171 lines of `ci.yml` (`:218`), and no record explains the change.
2. **A pull request to a branch other than `main` with `app=false` fails in Plan with the current workflow.** `ci.yml:66-70` sends the no-visual report, `oidc.ts:299` refuses the base, and all other jobs are skipped. Found in code only; no such run is in the sample.
3. **The required-check rule is readable without admin rights.** `rules/branches/main` shows Gate and Visonaut as required, `strict` off, and no merge queue; `solid-reboot` has no rules. This closes open item 8 of the report.
4. **The variable has a readable change time, and a run keeps the value from its start.** `updated_at` is 2026-10-03T12:55:15Z; a job at 13:02:37Z of a run created at 12:47:22Z printed the old value.
5. **The database switch of 2026-10-04 made a second Visonaut check on main commit `77c59e3c`.** Check `111533715466` has `external_id` `visonaut:034a3118-…` and started at 21:17:51Z, 11 minutes after Visonaut #247 merged. Not verified: if the `/runs/<id>` links of checks from before the switch still open.
6. **A main run that passes while an earlier main run is not yet the baseline ends as a green "running" check: 2 of 17 successful main Submit executions.** `465d713a` was then run again in full. The link between the two facts is inferred.
7. **The CLI text for each HTTP 403 says "Authentication or permission failed", which points to the wrong cause.** A wrong variable, a wrong `ci.yml` blob at the Plan report, and a wrong executor digest all print this sentence (`http.ts:167-173`). This is more misleading than the general sentence that PKG-02 covers.

## Live reads used (18 GitHub GET requests)

`check-runs/111879629441`, `111369835207`, `111219809935`, `111873147850`, `111430080114`; `contents/.github/workflows/app.yml` and `ci.yml` at `643a23af`; `contents/pnpm-workspace.yaml` at `643a23af`; `rules/branches/main`; `rules/branches/solid-reboot`; `actions/variables/VISONAUT_WORKFLOW_SOURCE_SHA`; `pulls/7720`; `pulls/7703`; `pulls/7703/files` (all in `ariakit/ariakit`); `repos/ariakit/visonaut`; `actions/runs/37124103937`; `pulls/247` (in `ariakit/visonaut`); one `search/issues` query.

Not verified in this check: the cause of the capacity pause; the server code of the two pull request `begin` refusals; GitHub's handling of `status: "in_progress"` on a complete check (strong indirect proof only); the "Not required" page behavior in production; rows 2, 4, and 5 of the cutover table (only the #238 row was read live, and the #203 failures were read from the cached logs).
