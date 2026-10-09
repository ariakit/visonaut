# The pipeline as the consumer repository sees it: real timings, failure and stuck-check rates, and trust pins

Lane: `gap-consumer-pipeline`. Visonaut commit: `f83fef6`. Consumer: `ariakit/ariakit` (public).
Data window: all `ci.yml` workflow runs of Ariakit created from 2026-10-03T07:00:00Z to 2026-10-05T20:53:06Z, read on 2026-10-05 21:05 to 2026-10-06 00:00 UTC. All numbers come from public GitHub data. This lane sent no request to `visonaut.com` and made no GitHub write.

Short answers to the lane questions:

- A pull request with visual work gets a passed check about 20 minutes after the push (median 20 min 9 s, p90 32 min 8 s, n = 22). Visonaut's own part is about 3.5 minutes: the "Submit captures" step (median 2 min 27 s) and the service delay (median 1 min 1 s). The rest is GitHub build, runner wait, and the capture tests.
- The "2 hour 31 minute" check is not a slow service. The service writes `completed_at` again each time it sends the same result again. I watched the same check change from 19:26:20 to 21:20:31 to 21:37:03 with no change of conclusion (PIPE-01).
- No check was stuck `in_progress` at collection time (0 of 78). Public data has no history, so it cannot show how long a check was in progress before.
- 11 of 61 started Submit steps failed (18%). 5 were a capacity pause of the service, 3 were the trust pin cutover, 3 were "target branch moved". 0 map to PKG-03, API-11, or OPS-01. The CLI printed the cause in 5 of the 11 (PIPE-02, PIPE-03, PIPE-06).
- 22 of 78 checks (28%) are "Visual capture is not required" and all 22 link to the pull page that API-03 describes (PIPE-08).
- The trust tuple had 36 pin commits in 12 days. One consumer pull request (#7703) needed 5 service deployments. In two measured cutovers, 3 Submit jobs of other pull requests failed each time (PIPE-03).

## How it works (map)

### Parts

- Consumer workflow `ci.yml` (171 lines; blob `4d34ca17…`, pin "C"). Job `Plan` (lines 17-70) calculates `app=true|false`. For `app=false` its last step runs `visonaut submit --no-visual` (line 70). Job `App` calls `./.github/workflows/app.yml` (line 91). `concurrency: cancel-in-progress: true` for each ref, also for `main` (lines 12-14).
- Consumer workflow `app.yml` (280 lines; blob `202fd63a…`, pin "B"). Jobs `Visual Capture (linux|safari)` (lines 152-222) and `Visual Submit` (lines 224-267). Only Submit has `id-token: write`.
- Service: `POST /v1/plan` (`apps/web/src/api/pre-run.ts:49-157`), `POST /v1/runs/:id/begin` (`apps/web/src/api/workflow-owned.ts:293-325`), reserve, upload, submit (`workflow-owned.ts:327-…`, `:1262-1289`), then the queue.
- GitHub App `visonaut-ci` (App ID 5028451) owns the check run "Visonaut".

### Timeline of one pull request with visual work (real medians)

Sample sizes are in parentheses. "Push" is the `created_at` of the workflow run.

| Step  | What happens                                                                                                                                                              | Median      | p90         | Max         | n   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------- | ----------- | --- |
| 1     | Push. GitHub starts `ci.yml`. The Plan job starts.                                                                                                                        | 3 s         | 1 min 36 s  | 10 min 8 s  | 97  |
| 2     | Plan job runs. It ends.                                                                                                                                                   | 28 s        | 40 s        | 1 min 44 s  | 97  |
| 3     | Builds run. Linux capture job starts (time after Plan end).                                                                                                               | 1 min 24 s  | 1 min 43 s  | 2 min 30 s  | 50  |
| 3     | Safari capture job starts (time after Plan end). This is the macOS runner wait.                                                                                           | 1 min 32 s  | 11 min 17 s | 16 min 1 s  | 50  |
| 4     | Linux capture job (step "Test visual": 9 min 24 s).                                                                                                                       | 10 min 31 s | 11 min 6 s  | 11 min 30 s | 63  |
| 4     | Safari capture job (step "Test visual": 10 min 20 s).                                                                                                                     | 11 min 59 s | 13 min 26 s | 18 min 5 s  | 60  |
| 5     | Last capture ends. Submit job starts 3 s later.                                                                                                                           | 3 s         | 3 s         | 4 s         | 50  |
| 6     | Submit calls `begin`. The service verifies OIDC and creates the check "Checking visual coverage" (`apps/web/src/api/pre-run-checks.ts:501-521`). Time after Submit start. | 22 s        | 26 s        | 31 s        | 55  |
| 7     | Step "Submit captures": download artifacts, compare locally, upload, signed submit.                                                                                       | 2 min 27 s  | 3 min 4 s   | 3 min 47 s  | 50  |
| 8     | Submit job ends (time after push, first attempt, pull requests).                                                                                                          | 18 min 17 s | 30 min 41 s | 32 min 5 s  | 33  |
| 9     | Queue: `ingest` (`workflow-owned.ts:1279`), then `status` (`apps/web/src/api/ingest.ts:59-63`). The check changes to "Visual review passed". Time after Submit end.       | 1 min 1 s   | 1 min 42 s  | 3 min 37 s  | 22  |
| Total | Push to passed check.                                                                                                                                                     | 20 min 9 s  | 32 min 8 s  | 33 min 12 s | 22  |

Notes for the table:

- Rows 9 and Total use only pull request checks whose last write was not later than 5 minutes after Submit end (22 of 32). The other 10 were written again later (PIPE-01), so their first pass time is not known. One live observation agrees: pull request #7747, Submit end 21:19:35Z, check passed 21:20:31Z, 56 s.
- No Visonaut check exists on the commit before step 6. That is 15 min 3 s after the push (median, n = 48; p90 25 min 48 s) (PIPE-07).
- A push to `main` has the same steps. Push to Submit end: median 17 min 18 s, p90 20 min 44 s, max 28 min 11 s (n = 15). First pass on main: about 35 to 47 s after Submit end (inferred, n = 6, see PIPE-01).

### Timeline of a pull request without visual work

1. Push. Plan runs. Its last step sends the signed "no visual" report (`ci.yml:66-70`; `pre-run.ts:49-157`). Step time: median 12 s, max 15 s (n = 22, 0 failures).
2. The service creates the check and completes it in the same request: "Visual capture is not required" (`apps/web/src/api/pre-run-plan.ts:165-195`). Check `started_at` to `completed_at`: median 4 s, max 6 s.
3. Push to completed check: median 38 s, p90 1 min 9 s, max 1 min 18 s (n = 22).

### What the service checks at `begin` and at the Plan report

`verifyGitHubOidc` (`packages/security/src/oidc.ts:111-363`), in this order:

1. JWT signature, issuer, audience, age (`:118-139`).
2. Repository and owner IDs (`:150-156`).
3. Pin C: the blob of `ci.yml` at the tested commit must equal `callerWorkflowBlobSha` (`:157-172`).
4. Pin B, only for Submit: the blob of `app.yml` at the tested commit must equal `reusableWorkflowSha` (`:182-194`).
5. Run, attempt, job name, job state (`:207-281`).
6. For a pull request: state open, base `main`, merge ref current, parents and ancestry (`:289-336`).

Then `ensureSignedAttemptCheck` creates or binds the check (`apps/web/src/api/pre-run-attempts.ts:690-879`).

### What moves the check after Submit

1. Submit sends `{ kind: "ingest" }` (`workflow-owned.ts:1279`). The single queue consumer materializes the run (`apps/web/wrangler.jsonc:98-107`).
2. When the comparison is ready, materialization calls `finalizeSubmittedComparison` (`apps/web/src/api/workflow-materialize.ts:812`), which sends `{ kind: "status" }` (`apps/web/src/api/ingest.ts:59-63`).
3. A `status` pass runs four steps in this order: `review-decisions`, `checks`, `review-links`, `promotion` (`apps/web/src/operations/index.ts:47-51`, `:62`).
4. `checks` sends a PATCH for each eligible run, not only for the run that changed (`apps/web/src/operations/checks.ts:200-209`; eligible = active run or current baseline, `packages/service/src/review-status.ts:25-27`).
5. `promotion` makes a passed main run the new baseline. The old baseline run becomes inactive (`packages/service/src/baseline-promotion.ts:429`), so it gets no more writes.

## Findings

Each finding gives options. This lane does not select a disposition.

### PIPE-01 · The service writes `completed_at` again on each re-send, so GitHub shows a wrong and growing duration and public data cannot show when a check first passed

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/security/src/checks.ts:197-200`. Each delivery of a final state sets a new time:
    ```ts
    status: intent.conclusion === "pending" ? "in_progress" : "completed",
    ...(intent.conclusion === "pending"
      ? {}
      : { conclusion: intent.conclusion, completed_at: new Date().toISOString() }),
    ```
  - `apps/web/src/operations/checks.ts:200-209`. One project event selects each eligible run (`stale.source_revision!=project.revision`). The second-lens check D1-05 (`second-lens-5.md`) proved this locally. This lane proves it in production.
  - Live measurement, check run `111879629441` on main commit `643a23aff5a5` (Submit job ended 16:58:21Z). Command: `gh api repos/ariakit/ariakit/check-runs/111879629441`. Result at four times:

    | Read at (UTC) | `conclusion` | `completed_at` | Event of another run just before                                  |
    | ------------- | ------------ | -------------- | ----------------------------------------------------------------- |
    | 21:17:09      | success      | 19:26:20Z      | (first read)                                                      |
    | 21:20:31      | success      | 19:26:20Z      |                                                                   |
    | 21:20:46      | success      | 21:20:31Z      | Pull request #7747: its check changed to passed at 21:20:31Z      |
    | 00:00:30      | success      | 21:37:03Z      | Next main commit `8f018501`: Submit ended 21:36:24Z (39 s before) |

    The check of pull request #7747 (`111980868450`) also moved from 21:20:31Z to 21:37:15Z when the main run arrived.

  - 25 of 49 checks have a last write more than 5 minutes after their Submit end. For 22 of these 25, another run had an event in the 150 s before the write (`analysis-3.json`).
  - Six main commits in sequence: (last write of check N) minus (Submit end of main commit N+1) = 46, 43, 41, 47, 42, 35 s (`analysis-2.json`, `mainPairs`).
  - Distribution of "Submit end to `completed_at`" for main: median 2 h 27 min 59 s, p90 8 h 15 min 50 s, max 11 h 53 min 42 s (n = 17). For pull requests: median 1 min 24 s, p90 29 min 11 s, max 6 h 56 min 12 s (n = 32).
- What happens: a passed check gets a new PATCH each time any run in the project changes. The PATCH has the same conclusion and a new `completed_at`. A main check gets these writes until the next main commit becomes the baseline (`packages/service/src/baseline-promotion.ts:429` sets the old run inactive). A pull request check gets them until the pull request closes.
- The verified example explained: the check of `643a23aff5a5` started at 16:55:23Z. `completed_at` 19:26:20Z was the last re-send before I read it, not the first pass. The first pass time is not in public data. From the six pairs above, a main run with no changes passes about 35 to 47 s after Submit end. That is an inference: the `checks` step writes the old baseline and the new run in the same pass, before `promotion` (`operations/index.ts:47-51`).
- Impact:
  - GitHub calculates the shown duration of a check from `started_at` and `completed_at` (assumption, not verified in the browser in this lane). The Visonaut check of a main commit then reads as "2 hours" or "11 hours". This looks like a slow service.
  - Nobody can measure the service delay from GitHub data. This lane could give only upper limits.
  - Each re-send is one GET and one PATCH for each eligible run (cost is in D1-05).
- Recommendation: do not send a write when GitHub already shows the intent. The code has the GET response at that point (`checks.ts:173`). This is option 3 of D1-05; it also keeps `completed_at` stable.
  ```ts
  // packages/security/src/checks.ts, before the PATCH
  const status = intent.conclusion === "pending" ? "in_progress" : "completed";
  const shown = record(existing.output ?? {});
  const same =
    existing.status === status &&
    (status === "in_progress" || existing.conclusion === intent.conclusion) &&
    existing.details_url === href &&
    shown.title === output.title;
  if (!(await isCurrent())) return "not-sent";
  if (same) return; // GitHub already shows this state.
  ```
- Alternatives:
  - Minimal: keep the PATCH, but send `completed_at` only when the conclusion changes (`existing.conclusion !== intent.conclusion`). The duration becomes correct. The request count does not change.
  - Keep the code. Add a log line with the run ID and the first time a check became final, so the delay is measurable from Worker logs (see OPS-08).
  - No change. Then document that `completed_at` means "last synchronization".
- Maintainer decision needed: yes. Is the repeated PATCH wanted as a repair for differences between D1 and GitHub (D1-05 names this use)? If yes, the minimal alternative keeps it.

### PIPE-02 · A capacity pause refused Submit after the complete capture: 5 failed Submit steps in one afternoon, and two main commits keep a red check

- Kind: bug
- Severity: high. Confidence: medium. Measured: yes. Effort: M
- Evidence:
  - Logs of five Submit jobs on 2026-10-04 (command: `gh api repos/ariakit/ariakit/actions/jobs/<id>/logs`), for example job `111426435074`:
    ```text
    2026-10-04T11:31:04.9586767Z visonaut: Visonaut has paused new capture runs at its capacity limit. Check Service attention. Rerun this job after admission resumes. No visual approval was granted.
    2026-10-04T11:31:04.9944000Z ##[error]Process completed with exit code 1.
    ```
    Times of the five refusals: 11:31:04, 11:53:05 (Submit-only rerun of the same run), 12:08:17, 12:50:55, 12:53:32 UTC. Four are main pushes (commits `929b15439ad4` two times, `1c1f6d7f8d6e`, `1d2d2d2ffb3d`), one is pull request #7737.
  - `apps/web/src/capacity.ts:25-30` and `:107-113`: admission stops when `databaseBytes >= databaseAdmissionBytes` or `activeRuns >= maximumActiveRuns`. Defaults: 2 GiB and 5 runs (`apps/web/src/runtime-defaults.ts:15-17`).
  - `packages/cli/src/http.ts:190-194`: the CLI has a special message for `capacity_exceeded`. It does not wait or retry.
  - The check after the refusal: title "Visual capture did not complete", summary "The pinned capture workflow ended with failure." (`apps/web/src/api/pre-run-attempts.ts:1010-1025`). For the four main checks `details_url` is `https://visonaut.com`.
  - The first successful Submit after the pause ended at 21:32:26Z (full rerun of `1d2d2d2ffb3d`). Visonaut commit `6219fdf` ("Switch production to the imported baseline database") has the commit time 21:06:31Z.
  - The same failure is on record for 2026-09-28: `docs/evidence/capacity-admission-20260928.md:3`.
- What happens: the admission check runs at `POST /v1/runs`, inside the Submit job. Both capture jobs are complete at that time. In the five cases the linux capture used 6 min 47 s to 10 min 43 s and the safari capture 10 min 53 s to 13 min 2 s before the refusal. The author sees the refusal 13 min 54 s to 16 min 49 s after the push.
- Impact:
  - The pause lasted at least 82 minutes (11:31:04 to 12:53:32) and at most 10 hours (until 21:29). In that time no run could get a passed check. The Visonaut check is required (`.github/workflows/README.md:42`), so no pull request with visual work could merge.
  - Main commits `929b15439ad4` and `1c1f6d7f8d6e` keep a failed Visonaut check. Nobody ran them again.
  - The check text does not say "capacity". The Submit log says it.
  - Assumption: the cause was the database size stop, because admission came back after the database switch. Public data cannot separate "database size" from "5 active runs".
- Recommendation: make the pause visible before the capture and on the check.
  ```ts
  // apps/web/src/api/pre-run-attempts.ts, in settlePreRunWorkflow: keep the reason of the refusal
  const reason = refusedForCapacity
    ? "Visonaut paused new runs at its capacity limit. Run the Submit job again after admission resumes."
    : /* current reasons */;
  ```
  And refuse early: let `begin` (the first call of Submit, `workflow-owned.ts:293-325`) run `checkRunAdmission`. This moves the refusal from second 50 to 67 of the step to second 1 to 5. It does not save the capture time.
- Alternatives:
  - Check admission in the Plan job, also for `app=true`. A refused run then stops after about 40 s and uses no capture runner. This adds one signed call to each run and changes pin C once.
  - Keep the place of the check. Raise an alert when the database passes the warning size (the event `headroom-warning` exists at `capacity.ts:80-86`; OPS-09 covers the missing signal).
  - Let the CLI wait and retry on `capacity_exceeded` for a limited time. This helps only for the active-run limit, not for the size limit.
  - Minimal: change only the check summary, so the reason is on the pull request.
- Maintainer decision needed: yes. Is "stop all new runs" the correct action at the size limit, now that the check is required for merges? OPS-16 states that this stop is the only brake on table growth.

### PIPE-03 · One exact blob for each workflow file makes each consumer workflow edit a two-repository cutover; in two measured cutovers, 3 Submit jobs of other pull requests failed each time

- Kind: dx
- Severity: high. Confidence: high. Measured: yes. Effort: L
- Evidence (code):
  - `packages/security/src/oidc.ts:87-92`: `return blob === configuration.reusableWorkflowSha;` (one value).
  - `oidc.ts:163-171`: `requireEqual(file.sha, sha(configuration.callerWorkflowBlobSha), "rest.caller_workflow_blob");` (one value).
  - `oidc.ts:59-69`: each mismatch gives 403 `untrusted_run`, "The workflow does not match the trusted capture plan."
  - `apps/web/src/runtime.test.ts:122-124`: a test forbids a second value: `expect(workflow).not.toHaveProperty("additionalTrustedWorkflowBlobSha");`. The keys `additionalTrustedWorkflowBlobSha`, `transitionTrustedWorkflowBlobSha`, and `additionalTrustedExecutorDigest` were in `wrangler.jsonc` from 2026-09-27 to 2026-09-29 (commits `b69c256`, `0637afb`, `cbee25f`) and were removed in `5712036`.
  - `docs/operations/adapter-service-pins.md:63-71`: the procedure has 5 numbered steps and a census of old callers. Line 71: "This sequence adds no alternate digest, source exception, queue subsystem, or launch flag."
- Evidence (history, B2). Command: `node pin-history.mjs` (it runs `git log -G… -- apps/web/wrangler.jsonc` and `git show`).
  - 36 commits from 2026-09-22 to 2026-10-03. By UTC day: 2, 2, 10, 6, 0, 4, 2, 2, 0, 0, 6, 2.
  - Pin B (blob of `app.yml`) changed in 25 commits, pin D (executor digest) in 14, pin C (blob of `ci.yml`, exists since 2026-10-02) in 6.
  - My classification by subject line and diff:

    | Reason                                                                                                       | Commits |
    | ------------------------------------------------------------------------------------------------------------ | ------- |
    | First setup and diagnostic workflow (2026-09-22 to 09-24)                                                    | 9       |
    | Consumer workflow edit with no package release (job rename, fonts, setup action, Submit shape, Gate polling) | 13      |
    | Adoption of a new CLI or adapter version                                                                     | 10      |
    | Change of the service configuration shape                                                                    | 4       |

  - One example of the second row: `3ffee50` changed only pin C, because Ariakit removed a polling step from the `Gate` job (Ariakit #7708). `Gate` is not a Visonaut job.
- Evidence (five cutovers). Deploy times from `gh api repos/ariakit/visonaut/actions/workflows/deploy.yml/runs`, consumer times from the pulls and runs lists.

  | Service pin commit       | Deploy run (UTC)           | Consumer change                                   | Deploy end to consumer merge | Other runs in the window                                                                                     |
  | ------------------------ | -------------------------- | ------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
  | #238 `6f55c57` (B, C, D) | 10-03 12:49:07 to 12:53:56 | #7720, opened 12:59:12, merged 13:31:07           | 37 min 11 s                  | 3 Submit steps failed (13:02:56, 13:27:00, 13:41:51; pull requests #7719 and #7721). 0 passed, except #7720. |
  | #220 `4930189` (B, D)    | 10-03 00:53:10 to 00:57:03 | #7718, opened 01:09:48, merged 01:34:28           | 37 min 25 s                  | No other Submit ran. 2 no-visual runs passed (C did not change).                                             |
  | #203 `3ffee50` (C)       | 10-02 14:42:23 to 14:46:41 | #7708, opened 14:53:15, merged 15:27:54           | 41 min 13 s                  | 3 Submit steps failed (15:29:43, 15:33:08, 15:42:32; pull requests #7700, #7701, #7702).                     |
  | #200 `c8e57fd` (B, C)    | 10-02 12:32:31 to 12:36:44 | #7703, last head pushed 12:43:38, merged 13:10:44 | 34 min 0 s                   | Pull request #7706 failed in the capture job (old workflow, step "Encrypt captures").                        |
  | #188 `4451db2` (B, C)    | 10-02 06:39:23 to 06:43:29 | #7703, head `7852f405` pushed 06:48:24            | not merged                   | The Submit step of that head ran 29 min 58 s and was cancelled.                                              |
  - Pull request #7703 needed 5 service pin deployments in 10 hours: #181 (02:42), #182 (04:10), #188 (06:39), #194 (08:24), #200 (12:32).
  - The three failures after #7708 happened after the consumer merge. Their runs started at 15:10, before the merge. A run keeps the merge commit of its start, so it keeps the old file.
  - Log of one failure in the #238 window (job `111207855983`): `VISONAUT_PACKAGE_SHA256: e1194e20…` (old D), `VISONAUT_WORKFLOW_SOURCE_SHA: 3858bc67…` (old B), then `visonaut: The signed Submit check could not be started.` and `exit code 4`.

- Evidence (ordinary changes, B3):
  - A pull request that edits `ci.yml`: the merge commit has a new blob. For `app=false` the Plan report fails at `oidc.ts:171` (called from `pre-run.ts:73-98`). The Plan job fails, and every job that needs Plan is skipped. For `app=true` `begin` fails at the same line after the complete capture. No check is created (PIPE-07).
  - A pull request that edits `app.yml`: `begin` fails at `oidc.ts:194`.
  - The service cannot trust the old blob and the new blob at the same time (one value each, see above).
  - History of the two files on Ariakit `main` (`gh api "repos/ariakit/ariakit/commits?sha=main&path=…"`): Renovate changed `app.yml` 6 times from 2025-11-25 to 2026-06-20 (action major versions) and `ci.yml` 4 times in 2022. Since the pins exist, 0 Renovate changes. The workflows use tags (`actions/checkout@v7`, `actions/download-artifact@v8`), so the next major update is such a pull request.
  - In the sample, only #7720 touched the two files. Its check passed, because the service was deployed 5 min 16 s before the pull request opened. The three not-merged sample pull requests that I read (#7724, #7746, #7747) do not touch `.github/`.
  - The pinned scope is wide: `app.yml` has 280 lines, and the capture and Submit jobs are lines 152-267. `ci.yml` has 171 lines, and Plan is lines 17-70. An edit of the test matrix, the preview deployment, or any other CI job changes a pin.
- What happens: the service, the repository variable, and the consumer file must change in a fixed order. Between the service deployment and the consumer merge, the service trusts a file that `main` does not have yet. Each Submit and each no-visual Plan of another pull request fails in that window when its pin changed. The failures continue for runs that started before the merge. A rerun of such a run uses the same merge commit and fails again; the author must push or update the branch.
- Impact: measured 34 to 41 minutes of window for each cutover (n = 4), 6 failed Submit jobs on 5 other pull requests in two cutovers, each 15 min 34 s to 31 min 48 s after the push. Each cutover needs one service pull request, one deployment (3 min 53 s to 4 min 49 s), one variable change with readback, and the caller census of the runbook.
- Recommendation: none selected. The lane rule is to give options with the changed guarantee. See Alternatives.
- Alternatives (B4):

  | Option                                | What changes                                                                                                                                                                                                                                              | Guarantee after the change                                                                                                                                                                                                                                    | Cost and risk                                                                                                                                                                                                                  |
  | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | A. No change                          | Nothing.                                                                                                                                                                                                                                                  | Only one reviewed blob for each file can submit.                                                                                                                                                                                                              | The measured cost stays.                                                                                                                                                                                                       |
  | B. A list of trusted blobs            | `reusableWorkflowSha` and `callerWorkflowBlobSha` become lists (current and next). `isTrustedWorkflowBlob` checks membership. The stored `workflow_source_digest` already binds a run to its blob (`workflow-owned.ts:436-446`).                          | Two reviewed blobs are valid in the cutover window. Each blob still needs a service review and deployment.                                                                                                                                                    | Removes the failure window. Does not remove the deployment for each edit. Brings back the mechanism that `5712036` removed; `runtime.test.ts:122-124` must change. Old entries must be removed, or the list grows.             |
  | C. Trust by ancestry on `main`        | Accept the blob when it equals the blob of the same file at the pull request's target head. The code already has that commit and proves that it is an ancestor of `main` (`oidc.ts:319-320`). For a push to `main`, accept the blob of the tested commit. | Trust moves from "the service maintainer reviewed this blob" to "this file is on `main`". A pull request that edits the workflow stays untrusted until it merges. A person who can merge to Ariakit `main` can change the Submit job with no Visonaut change. | Removes all B and C pin commits and the window. Adds one GitHub read for each verification. Needs a decision on who is trusted. A workflow edit merges without a Visonaut check on its own pull request, or needs an override. |
  | D. Pin only a small reusable workflow | Move capture and Submit into one small workflow file (and the no-visual report into a second one, or under option C). Pin only these blobs.                                                                                                               | Same guarantee for the pinned files. Edits of other CI jobs need no service change.                                                                                                                                                                           | One consumer refactor with new job names (`submitJobName`, `captureJobName` change). Edits of the small files still need the cutover.                                                                                          |
  | E. Pin a commit, not a blob           | The caller uses `uses: <owner>/<repo>/.github/workflows/<file>@<commit>`. The service compares `job_workflow_ref` and `job_workflow_sha` (this branch exists at `oidc.ts:195-206`).                                                                       | Same guarantee for the called workflow. A pull request cannot change it; it can only change the reference, and then the claim does not match.                                                                                                                 | The workflow can live in the Visonaut repository and get a version with the CLI. The consumer update is one line. Not verified: use of the consumer's local composite actions from a remote reusable workflow.                 |

- Maintainer decision needed: yes. Which party must approve a change of the Submit job: the Visonaut maintainer (today), or each person who can merge to Ariakit `main` (option C)? The answer selects the option.

### PIPE-04 · The same coupling value is written in two to four places, and one of them (the repository variable) carries no information

- Kind: simplification
- Severity: medium. Confidence: high. Measured: no. Effort: M
- Evidence (B1). "CLI prints" is the text in the job log.

  | Value                      | Where it is set                                                                                                                                                                                                           | Code that checks it                                                                                                                                                                                           | Error for the consumer                                                                                                                                                                                                                                                                                                                  | Steps for one change                                                                           |
  | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
  | B: blob of `app.yml`       | (1) the file in Ariakit; (2) and (3) `reusableWorkflowRef` and `reusableWorkflowSha` in `apps/web/wrangler.jsonc:61`; (4) Ariakit variable `VISONAUT_WORKFLOW_SOURCE_SHA` (`app.yml:234`)                                 | `oidc.ts:182-194`; ref and sha must agree at `workflow-owned.ts:127-133`; the variable at `workflow-owned.ts:330-333`                                                                                         | File: 403 `untrusted_run`; CLI prints "The signed Submit check could not be started." (exit 4, `packages/cli/src/bundle-submit.ts:70`). Variable: 403 `wrong_workflow_source` "The workflow source changed."; CLI prints "The service refused the request (HTTP 403). No visual approval was granted." (`packages/cli/src/http.ts:222`) | `git hash-object`, service pull request, deployment, variable change, readback, consumer merge |
  | C: blob of `ci.yml`        | the file; `callerWorkflowBlobSha` in `wrangler.jsonc:61`                                                                                                                                                                  | `oidc.ts:157-172`, for Submit (`workflow-owned.ts:201-229`) and for the Plan report (`pre-run.ts:71-98`)                                                                                                      | 403 `untrusted_run`. Submit: generic `begin` text, exit 4. Plan: "The service refused the request (HTTP 403)…" (from the code; exit 1 was seen with this text for an HTTP 409 in job `110878531218`)                                                                                                                                    | service pull request, deployment, consumer merge                                               |
  | D: executor digest         | `VISONAUT_TRUSTED_EXECUTOR_DIGEST` (`wrangler.jsonc:62`); `VISONAUT_PACKAGE_SHA256` in `app.yml:11` (so a new D is also a new B); Ariakit `app/playwright.config.ts:93` and `:101`                                        | CLI `packages/cli/src/bundles.ts:49-55`; server `workflow-owned.ts:500-501`, `workflow-materialize.ts:625-628`, `workflow-reconcile.ts:145-147` (`apps/web/src/api/context.ts:45-51`)                         | CLI: "A capture bundle has the wrong shard or package identity." (exit 4). Server: 403 `manifest_provenance`                                                                                                                                                                                                                            | as B, plus the manual archive check of `adapter-service-pins.md:17`                            |
  | Job names                  | `submitJobName` and `captureJobName` in `wrangler.jsonc:61`; `name:` in `app.yml:153` and `:225` with the caller job name in `ci.yml:82`; `VISONAUT_CAPTURE_JOB_NAME` and `VISONAUT_SUBMIT_JOB_NAME` in `app.yml:235-236` | `oidc.ts:259`; CLI `packages/cli/src/signed-context.ts:72` and `github-artifacts.ts:72`; server `workflow-reconcile.ts:218`, `:258`, `pre-run-attempts.ts:52`, `workflow-owned.ts:466`                        | Server: 403 `untrusted_run` (generic `begin` text). CLI: "The signed Submit job identity is ambiguous." (exit 4)                                                                                                                                                                                                                        | a rename changes B (and C for the caller job), the service configuration, and two env lines    |
  | CLI version                | `visonaut@0.5.4` in `app.yml:252` and in `ci.yml:70`; `visonaut` in Ariakit `package.json`                                                                                                                                | No version check. The protocol fields are checked: `comparisonMode` at `workflow-owned.ts:171-187` (409 `local_comparison_required`)                                                                          | CLI prints "The service refused the request (HTTP 409)…"; the server sentence "Upgrade the Visonaut CLI…" is not shown                                                                                                                                                                                                                  | a new CLI version in the consumer is a new B and a new C                                       |
  | Adapter version            | `@visonaut/playwright` `0.5.0` in Ariakit `app/package.json` and the lockfile                                                                                                                                             | `producer` is checked for shape only (`packages/protocol/src/validate.ts:241`)                                                                                                                                | none                                                                                                                                                                                                                                                                                                                                    | a new adapter is a new D, so a new B                                                           |
  | Protocol identities        | `packages/protocol/src/types.ts:44-45` (`"rgba-visible-1"`, `"jsquash-png-3.1.1-webp-1.5.0"`, old server comparison) and `:130-131` (`"playwright-pixelmatch-1.63.0"`, `"pngjs-7.0.0"`)                                   | `validate.ts:404-405` accepts one value each; the CLI writes them at `packages/cli/src/local-comparison.ts:330-331`; they are part of the approval tuple (`packages/service/src/local-comparison.ts:212-213`) | a manifest validation error                                                                                                                                                                                                                                                                                                             | protocol, CLI, and service must release together (PKG-06)                                      |
  | Node engine of the adapter | `packages/playwright/package.json:57-59`: `"node": "24.18.0"`                                                                                                                                                             | Nothing at run time (PIPE-11)                                                                                                                                                                                 | none; the runs pass on 24.21.0                                                                                                                                                                                                                                                                                                          | none                                                                                           |
  | Playwright                 | `packages/playwright/package.json:46` and `:55`: `1.63.0` exact (dev and peer); Ariakit `app/package.json`: `1.63.0`; the engine string above                                                                             | The package manager only. No image: `rg "mcr.microsoft.com                                                                                                                                                    | playwright:v"`finds nothing in this repository, and the capture jobs run on`ubuntu-latest`and`macos-latest` (`app.yml:163-172`)                                                                                                                                                                                                         | a peer dependency warning or error at install                                                  | an update of Playwright in Ariakit needs a new adapter release first |
  - `workflow-owned.ts:297` and `:330`: the service calculates the source digest from its own configuration (`workflowSourceDigest(configuration.reusableWorkflowSha)`) and compares the value of the client with it.
  - `signed-context.ts:24` and `:81`: the CLI reads the variable only to send the same digest back.
  - Log evidence that the variable is one more thing to switch: in the #238 window the variable still had the old value at 13:02:37 and the new value at 13:26:48 (jobs `111207855983` and `111211852522`).
  - "planDigest" has two meanings: in a shard manifest it is D (`bundles.ts:51`), in the combined manifest it is the digest of B (`signed-context.ts:81`).

- What happens: one change of the Submit job needs the same 40-character value in four places of two repositories. The variable is not in a file, so no pull request shows its change.
- Impact: more manual steps for each cutover and one more way to fail (403 `wrong_workflow_source`, shown as a generic HTTP 403).
- Recommendation: remove the variable. Let `begin` return the digest that the service expects.
  ```ts
  // workflow-owned.ts, beginStaged
  return Response.json({
    schemaVersion: SCHEMA_VERSION,
    state: "pending",
    planDigest: sourceDigest,
  });
  // CLI: use the returned planDigest in bindSubmission; do not read VISONAUT_WORKFLOW_SOURCE_SHA.
  ```
  The guarantee does not change: the server already compares against its own value.
- Alternatives:
  - Let the CLI read the blob with the token that it has (`contents: read`): `GET /repos/{repo}/contents/.github/workflows/app.yml?ref=$GITHUB_SHA`.
  - Derive `reusableWorkflowRef` from `trustedWorkflowPath` and `reusableWorkflowSha` in `runtime.ts` (the check at `workflow-owned.ts:127-133` already requires that they agree). This removes copy (2).
  - Read the job names from the workflow run instead of two env lines (the server check stays).
  - Minimal: no code change; add the variable to the PR checklist of the runbook.
- Maintainer decision needed: no for the variable (the server ignores its information). Yes for the job-name env lines: do you want them as an explicit statement in the trusted file?

### PIPE-05 · The executor digest "D" is a declared text, not a measured hash; nothing checks which adapter ran

- Kind: security
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Ariakit `app/playwright.config.ts:93` and `:101` at commit `643a23aff5a5` (read with `gh api repos/ariakit/ariakit/contents/app/playwright.config.ts?ref=…`):
    ```ts
    planDigest: requiredEnv("VISONAUT_PACKAGE_SHA256"),
    executorDigest: requiredEnv("VISONAUT_PACKAGE_SHA256"),
    ```
  - `packages/playwright/src/discovery.ts:84`: the adapter checks only the format, `/^[a-f0-9]{64}$/`. `packages/playwright/src/reporter.ts:114-124` copies the option into the manifest. No code in `packages/playwright/src` hashes the package.
  - `packages/cli/src/bundles.ts:49-55`: the CLI compares the manifest text with the env value.
  - `apps/web/src/api/context.ts:45-51`: `return digest === configuration.trustedExecutorDigest;`.
  - Steps of one capture job (log of job `111873737902`): checkout, `./.github/workflows/setup`, `pnpm/action-setup`, `actions/setup-node`, install, `install-playwright`, two artifact downloads, the test command, two uploads. No step calculates a hash.
  - `docs/operations/adapter-service-pins.md:9`: "The service trusts one App workflow blob and one executor digest." Line 17 asks the operator to check the registry archive by hand.
- What happens: the capture job runs the code of the pull request. The Playwright configuration and the installed adapter come from the pull request (`package.json`, lockfile). The env value comes from `app.yml`, which pin B fixes. So the chain proves this: "the pull request declares the same text as the trusted workflow, and the service has the same text". It does not prove that the archive with that SHA-256 produced the captures.
- Impact: pin D adds one value to each adapter release (a new D is also a new B, see PIPE-04) and one manual check. The guarantee that it adds over pin B is small, because the text is inside the file that B pins. The name "trusted executor digest" promises more than the code checks. This is not a way to pass a wrong image as approved: the Submit job is the trusted part and it compares the images itself.
- Recommendation: state the real guarantee in `docs/current-contract.md` and in the runbook: "D is a label for the adapter release that the workflow declares." Then decide if the label needs its own pin.
- Alternatives:
  - Remove D as a separate pin. Keep the value in the manifest as information. One value less for each adapter release.
  - Make it a real check in the trusted Submit job: read `pnpm-lock.yaml` of the tested commit and compare the integrity value of `@visonaut/playwright` with a pinned value. This proves the lockfile, not the executed code.
  - No change.
- Maintainer decision needed: yes. What must D prove? If the answer is "which adapter release the consumer declares", the pin can go or stay as it is. If the answer is "which code made the captures", no option here gives that, because the capture job runs pull request code.

### PIPE-06 · Six of eleven failed Submit steps print only "The signed Submit check could not be started."; three of them came 4 s to 3 min after the target branch moved

- Kind: dx
- Severity: medium. Confidence: medium. Measured: yes. Effort: S
- Evidence. All Submit steps with conclusion `failure` in the sample (n = 11; 61 Submit steps started; raw logs in `raw/logs/`):

  | Time (UTC)     | Run and attempt | Event                            | CLI output                                                      | Exit | Cause                                                             |
  | -------------- | --------------- | -------------------------------- | --------------------------------------------------------------- | ---- | ----------------------------------------------------------------- |
  | 10-03 13:02:56 | 37124008447 / 1 | pull request #7719               | "The signed Submit check could not be started."                 | 4    | Pin cutover (PIPE-03). Cause hidden: PKG-02.                      |
  | 10-03 13:27:00 | 37124776275 / 1 | pull request #7721               | same                                                            | 4    | same                                                              |
  | 10-03 13:41:51 | 37125311244 / 1 | pull request #7719               | same                                                            | 4    | same                                                              |
  | 10-04 10:51:24 | 37195930304 / 1 | pull request #7732               | same                                                            | 4    | Other. `main` moved at 10:48:14 (3 min before). Code not visible. |
  | 10-04 11:31:04 | 37198107948 / 1 | push to main                     | "Visonaut has paused new capture runs at its capacity limit. …" | 1    | Other: capacity (PIPE-02)                                         |
  | 10-04 11:53:05 | 37198107948 / 2 | push to main (Submit-only rerun) | same                                                            | 1    | same                                                              |
  | 10-04 12:08:17 | 37200297718 / 1 | push to main                     | same                                                            | 1    | same                                                              |
  | 10-04 12:50:55 | 37202597656 / 1 | push to main                     | same                                                            | 1    | same                                                              |
  | 10-04 12:53:32 | 37202707125 / 1 | pull request #7737               | same                                                            | 1    | same                                                              |
  | 10-04 23:31:32 | 37242762309 / 1 | pull request #7739               | "The signed Submit check could not be started."                 | 4    | Other. `main` moved at 23:29:31 (2 min before). Code not visible. |
  | 10-05 16:38:16 | 37339712519 / 1 | push to main                     | same                                                            | 4    | Other. The next main push came at 16:38:08 (4 s before).          |
  - Mapping to earlier findings: PKG-02 (cause hidden) 6 of 11. PKG-01 (a temporary 503 that a retry repairs) 0 proved, 2 possible (the two pull request cases). PKG-03 (image limits) 0. API-11 0 visible. OPS-01 0 visible.
  - `packages/cli/src/bundle-submit.ts:57-71`: `catch { throw new CliError("The signed Submit check could not be started.", 4); }`.
  - For the main case the code gives the answer: `apps/web/src/api/pre-run-candidates.ts:181-182` returns `null` when the tip of `main` is not the tested commit, and `apps/web/src/api/pre-run-attempts.ts:782-787` then throws `new SecurityError("workflow_candidate", 503, "The signed main candidate is unavailable.")`. `apps/web/src/api/index.ts:42` adds `Retry-After: 1` to each 503.
  - For the two pull request cases the possible answers are 503 `merge_not_ready` (`packages/security/src/oidc.ts:303-306`), 503 `workflow_candidate` (`pre-run-candidates.ts:369-377`), or 403 `untrusted_run` (`oidc.ts:320`, `:334`). The log cannot tell which.

- What happens: `begin` can refuse for at least three different reasons: wrong pins, a superseded commit, a merge ref that is not ready. The job log has the same sentence and exit code 4 for all. For a superseded main commit the server answers "temporary" (503 with `Retry-After`) for a state that does not end.
- Impact: the maintainer cannot see from the log if a rerun helps. PKG-01 proposes "retry each 503"; with the current status codes that rule would also retry the permanent "main moved" state.
- Recommendation: print the server code in the `begin` failure (the sketch is in PKG-02), and give permanent states a status that is not 503.
  ```ts
  // apps/web/src/api/pre-run-attempts.ts:782
  throw new SecurityError("superseded_commit", 409, "A newer commit replaced this commit on main.");
  ```
- Alternatives:
  - Minimal: only the CLI change (`error.code` in the message).
  - Let the Submit job end without failure for a superseded commit (the consumer cancels that run a few seconds later, `ci.yml:12-14`).
  - No change in the server. Write the three reasons in the consumer guide.
- Maintainer decision needed: no for the message. Yes for the status codes: which `begin` refusals are permanent?

### PIPE-07 · A commit has no Visonaut check for the first 15 minutes, and it never gets one when the capture fails or `begin` refuses

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - The check is created inside `begin` (`apps/web/src/api/workflow-owned.ts:317`, `apps/web/src/api/pre-run-checks.ts:501-521`) or inside the no-visual Plan report.
  - `apps/web/src/api/pre-run-attempts.ts:881`: "A terminal pinned workflow settles only a check started by signed submit." and line 971: `if (!candidate.check_id) return;`.
  - Run created to check `started_at`, first attempts with visual work: median 15 min 3 s, p90 25 min 48 s, min 10 min 13 s, max 29 min 4 s (n = 48).
  - 10 finished runs with visual jobs have no Visonaut check on the head commit. 5 are runs that a newer push cancelled. 5 are failed runs: 4 where `begin` refused (PIPE-06) and 1 where the Safari capture job was cancelled and Submit was skipped (run 37363098996).
  - `.github/workflows/README.md:42`: "The required Visonaut check from App `5028451` is active beside Gate." and "The visual path has no separate signed Plan report."
- What happens: for 15 minutes the pull request shows the required check with no status and no link (assumption: GitHub shows "Expected — Waiting for status to be reported"; not checked in the browser). If Submit does not start or `begin` refuses, this state stays. The only explanation is in the Actions log.
- Impact: the author cannot open Visonaut from the pull request in that time. After a refused `begin` the pull request cannot merge and nothing on the check says why.
- Recommendation: create the check when Plan selects `app=true`. Plan already has `id-token: write` and already calls the service for `app=false` (`ci.yml:20-22`, `:66-70`). The settle code already has a reason for "no Submit" (`pre-run-attempts.ts:1017`).
  ```yaml
  # ci.yml, Plan job (one more step; this changes pin C one time).
  # "--visual-required" is a new flag. It does not exist today.
  - name: Report visual plan
    if: steps.plan.outputs.app == 'true'
    run: npm exec --yes --ignore-scripts --package=visonaut@<version> -- visonaut submit --visual-required
  ```
- Alternatives:
  - Create the check from the `pull_request` webhook. The service stores the candidate at that time. The code comment at `apps/web/src/api/pre-run.ts:30` shows that the project moved away from that path, so this changes a recorded decision.
  - Keep the creation in `begin`, but create the check before the trust checks that can refuse, and complete it as failed with the reason. This puts the reason of a refusal on the pull request. It gives an untrusted caller a way to create a failed check, so it needs a security review.
  - No change. Write in the consumer guide that an absent check means "look at the Submit job".
- Maintainer decision needed: yes. The README records "no separate signed Plan report" for the visual path. Do you want to change that decision to get an early check?

### PIPE-08 · 22 of 78 checks (28%) link to the pull page that waits forever (incidence of API-03)

- Kind: bug
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Command for each head commit: `gh api "repos/ariakit/ariakit/commits/<sha>/check-runs?per_page=100&filter=all&app_id=5028451"`.
  - 22 checks have the title "Visual capture is not required". All 22 have `details_url` = `https://visonaut.com/pulls/<n>?check=visonaut%3Apre%3A<sha>`. 21 are on pull request #7552 (the release pull request; it gets a new head after each push to `main`). 1 is on #7736.
  - `apps/web/src/api/pre-run-checks.ts:508-514` sets that URL when the check is created. `apps/web/src/api/pre-run-plan.ts:178-189` completes the check and sends no `details_url`.
  - API-03 assumed that GitHub keeps the URL when a PATCH does not send it. The data confirms it: 22 of 22.
  - Other `details_url` values in the sample: "Visual review passed" 47 of 47 link to `/runs/<id>`. "Visual capture did not complete" 4 of 5 link to `https://visonaut.com` only (main), 1 to `/pulls/<n>?check=`. "Visual capture was superseded" 1 links to `/pulls/<n>?check=`.
- What happens: the "Details" link of each "not required" check opens the pull page. API-03 measured that this page answers `state: "pending"` for this case and polls each 15 seconds. This lane did not open the page (no request to `visonaut.com`).
- Impact: about 9 such checks each day in this sample (22 in 2.4 days). Each one has a link to a page with a wrong message.
- Recommendation: the fix of API-03. Add the incidence to its priority.
- Alternatives: send a `details_url` in `completeNoVisualPlan` that needs no page state, for example the pull request URL on GitHub. Minimal: no link change, only the API-03 state fix.
- Maintainer decision needed: no.

### PIPE-09 · On `main`, 7 of 22 commits do not end with a passed check, and two checks are green with the title "Visual review is running"

- Kind: inconsistency
- Severity: low. Confidence: medium. Measured: yes. Effort: M
- Evidence:
  - Final state of the Visonaut check for the 22 main commits of the sample (last read 2026-10-06 00:00 UTC):

    | State                                                          | Commits                                                             | Count |
    | -------------------------------------------------------------- | ------------------------------------------------------------------- | ----- |
    | "Visual review passed"                                         | includes 3 that needed a rerun (`465d713a`, `1d2d2d2f`, `8f018501`) | 15    |
    | failure, "Visual capture did not complete" (capacity, PIPE-02) | `929b1543`, `1c1f6d7f`                                              | 2     |
    | failure, "Visual review has not passed"                        | `44251326`                                                          | 1     |
    | completed, success, title "Visual review is running"           | `613dca23`                                                          | 1     |
    | no check (a newer push cancelled the run, `ci.yml:12-14`)      | `205adb78`, `0b9d04c3`, `32c137db`                                  | 3     |

  - The two green "running" checks: `111369835207` (`613dca23`, `completed_at` 05:27:49Z, 88 s after Submit end) and `111219809935` (first attempt of `465d713a`, `completed_at` 14:16:36Z, 68 s after Submit end). Both: `status: completed`, `conclusion: success`, `output.title: "Visual review is running"`.
  - `packages/security/src/checks.ts:43-49` and `:197-200`: the title "Visual review is running" belongs to a pending intent, and a pending intent sends `status: "in_progress"` with no conclusion.
  - `packages/service/src/baseline-promotion.ts:489`: a promotion sets the comparisons of the other active main runs to `invalidated`. `packages/service/src/review-status.ts:80`: that gives `needs-recompare`. `packages/service/src/run-status.ts:98-105`: that gives conclusion `pending`.
  - `apps/web/src/operations/main-retirement.ts:4-30` retires such a run when a later main run is accepted. `run-status.ts:95-97`: a retired run publishes nothing more.
- What happens (inferred, not proved): the main run passed, and the check became green. Then an earlier main commit became the baseline, and the comparison of this run became invalid. The service sent a pending intent. GitHub changed the title and kept `completed` and `success`. Later the run was retired, so no more writes came. A test of the GitHub behavior needs a write, so this lane did not do it.
- Impact:
  - A reader of the commit list on `main` cannot use the Visonaut check as "this commit is visually approved". 7 of 22 commits have another state, for different reasons.
  - If the inference is correct, a pending intent cannot take back a success on GitHub. I found no path today where a pull request run goes from passed to pending (`baseline-promotion.ts:489` excludes `kind = 'pull_request'`; an Undo gives `failure`, which GitHub accepts). So today this is a display fault on `main` only.
  - Not explained by public data: why `44251326` kept "has not passed" while the next main commit passed.
- Recommendation: first verify the GitHub behavior with one test check in a test repository. If it is confirmed, do not send a pending intent to a check that is complete; send a final neutral state for a main run that will not be compared again.
  ```ts
  // sketch: packages/security/src/checks.ts
  if (intent.conclusion === "pending" && existing.status === "completed") {
    // GitHub does not reopen a completed check. Say what is true.
    return patch({
      status: "completed",
      conclusion: "neutral",
      output: { title: "Replaced by a later main commit", summary },
    });
  }
  ```
- Alternatives:
  - Create a new check run (next generation) when a completed check must become pending. The pre-run path already has generations (`apps/web/src/api/pre-run-checks.ts:153-155`).
  - No change. Document that only the newest main commit has a meaningful check.
  - For the 3 cancelled runs: no service change is possible; `cancel-in-progress` on `main` is a consumer choice.
- Maintainer decision needed: yes. Must each main commit end with a true final state, or is "the newest main commit is correct" enough?

### PIPE-10 · A branch with an old copy of the workflow runs captures that cannot succeed: 9 runs and 1 h 34 min of capture jobs for one pull request, 0 checks

- Kind: cost
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Pull request #7694 has the base branch `solid-reboot`. 9 of the 98 sample runs are its runs. Their jobs have the old names `App / Visual`, `App / Visual (Safari)`, `App / Visual / Submit`.
  - 2 runs failed in both capture jobs at the step "Encrypt captures" (runs 37124441336 and 37131005221). 7 were cancelled by newer pushes. Sum of the capture job times: 1 h 34 min 21 s (`analysis-2.json`, `oldShape`).
  - Blobs on that branch (`gh api "repos/ariakit/ariakit/contents/.github/workflows/app.yml?ref=solid-reboot"`): `app.yml` = `4aac43e3039b…`, `ci.yml` = `c0e3da44bb1c…`. The pins are `202fd63a…` and `4d34ca17…`. `4aac43e3…` was the transition blob of Visonaut commit `cbee25f` (2026-09-29).
  - `packages/security/src/oidc.ts:299`: `requireEqual(target.ref, "main", "pull.base_ref");`. The service accepts only pull requests to `main`.
  - Before Ariakit #7703 merged (2026-10-02 13:10Z), pull requests to `main` with the old workflow failed at the same step (8 capture jobs in 4 runs that I read, `explore-4.mjs`).
  - 3 of the newest 60 pull requests have the base `solid-reboot` (#7692, #7693, #7694).
- What happens: the old workflow packs the captures with a command and a key that no longer exist (assumption for the reason; `docs/simplification-implementation.md:61` records the key retirement on 2026-10-02; I did not read that step log). With the current workflow the captures would run, and `begin` would refuse because the base is not `main`.
- Impact: runner minutes (one macOS job in each run) and a failed Gate for each push to such a pull request. No Visonaut resource is used.
- Recommendation: in Ariakit, select `app` visual work only for the base `main` in the planner, or keep `solid-reboot` current with `main`. In Visonaut, add one sentence to the consumer guide: "Visonaut accepts pull requests to `main` only."
- Alternatives: support other base branches in the service (a baseline for each branch; large). No change.
- Maintainer decision needed: no for the documentation. Yes if other base branches must get visual review.

### PIPE-11 · The adapter states an exact Node version that the consumer no longer uses, and the runbook repeats the old number

- Kind: inconsistency
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `packages/playwright/package.json:57-59`: `"engines": { "node": "24.18.0" }`. The CLI uses a range: `packages/cli/package.json:46-48`, `">=24.18.0 <25"`.
  - Ariakit merged "Update Node.js to v24.21.0 (#7744)" at 2026-10-05 16:17:36Z. Its `package.json` now has `devEngines.runtime.version: "24.21.0"`.
  - Capture job `111873737902` (main commit `643a23aff5a5`, after that merge): the log has `node-version-file: package.json`, `Found in cache @ /opt/hostedtoolcache/node/24.21.0/x64`, and `node: v24.21.0`. The run passed and the check is "Visual review passed".
  - `docs/operations/adapter-service-pins.md:19`: "It retains Playwright `1.63.0`, Node `24.18.0`".
  - `packages/playwright/src/reporter.ts:242-243` writes `nodeVersion` and `playwrightVersion` into the manifest. `packages/protocol/src/validate.ts:241` checks only that they are text.
  - `packages/playwright/package.json:46` and `:55`: Playwright `1.63.0` exact as peer dependency. `packages/protocol/src/types.ts:130`: the engine identity contains the same number.
- What happens: the exact Node engine has no effect in the consumer. A Renovate update changed the Node version of the captures, and nothing in the pipeline saw it. For Playwright the peer dependency is exact, so a Playwright update in Ariakit needs a new adapter release first. A new adapter release is a new D and a new B (PIPE-03, PIPE-04).
- Impact: none on results today. The package and the runbook state a guarantee ("exact Node") that no code checks. A Playwright patch update costs one adapter release and one full cutover.
- Recommendation: use the same Node range as the CLI in the adapter, and correct the runbook sentence. Decide separately if the Playwright peer must be exact.
  ```json
  "engines": { "node": ">=24.18.0 <25" }
  ```
- Alternatives:
  - Enforce the number: let the reporter stop with a clear message when `process.versions.node` is outside the supported range.
  - Keep the exact value and make Renovate in Ariakit hold Node until an adapter release.
  - No change; correct only the runbook.
- Maintainer decision needed: yes. Does a different Node or Playwright patch version change screenshots enough to need an exact pin?

## Measurements (command, raw result, limits)

All scripts and raw JSON are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-consumer-pipeline/`. Each GitHub read is cached in `raw/<hash>.json`; `raw/_index.json` maps each hash to its API path. GitHub requests used: 316 of the 500 allowed (`raw/_request-count.json`). All requests were `GET`.

### M1. Sample (A1)

- Commands (`collect-1-lists.mjs`):
  - `gh api -X GET "repos/ariakit/ariakit/commits?sha=main&per_page=100&since=2026-10-03T00:00:00Z"`
  - `gh api -X GET "repos/ariakit/ariakit/pulls?state=all&sort=created&direction=desc&per_page=60"`
  - `gh api -X GET "repos/ariakit/ariakit/actions/workflows/ci.yml/runs?per_page=100&page=<n>&created=>=2026-10-03T00:00:00Z"`
- Raw result: `{"mainCommits":25,"pulls":60,"runs":105}`.
- Cutoff: 2026-10-03T07:00:00Z. The deployment of Visonaut #230 (last step of the local-comparison rollout, `docs/operations/retire-server-comparison.md:5`) ended at 06:49:35Z (`pin-window-lists.json`).
- Sample after the cutoff: 98 workflow runs, first 2026-10-03T12:11:23Z, last 2026-10-05T20:53:06Z. 22 push runs (22 main commits). 76 pull request runs (75 head commits). 25 of the newest 60 pull requests have a run in the sample; the release pull request #7552 adds 21 runs.
- The request was for 60 main commits and 60 pull request heads. Only 22 main commits and 25 pull requests exist after the rollout. I used every run in the window instead.
- Run conclusions: pull request 45 success, 14 failure, 15 cancelled, 2 not finished. Push 16 success, 2 failure, 3 cancelled, 1 not finished. Runs by UTC day: 28, 39, 31.

### M2. Jobs and checks for each run (A2)

- Commands (`collect-2-details.mjs`), for each of the 98 runs:
  - `gh api -X GET "repos/ariakit/ariakit/actions/runs/<id>/jobs?per_page=100&filter=all"`
  - `gh api -X GET "repos/ariakit/ariakit/commits/<head_sha>/check-runs?per_page=100&filter=all&app_id=5028451"`
- Raw result: `details.json` (all jobs with steps, all checks). A readable table of each run is in `run-table.txt`. 78 different Visonaut check runs.
- Limit: a rerun copies the jobs that did not run again into the new attempt with the same times. I count one execution for each (name, start, end).

### M3. Distributions (A3)

Command: `node analyze.mjs` and `node analyze-2.mjs` (they read only `details.json` and `lists.json`). Raw output is in `analysis.json` and `analysis-2.json`. Percentiles use the nearest-rank method.

| Measure                                                                          | n   | Min         | Median          | p90             | Max              |
| -------------------------------------------------------------------------------- | --- | ----------- | --------------- | --------------- | ---------------- |
| Push to end of Plan, all runs                                                    | 97  | 24 s        | 33 s            | 2 min 3 s       | 10 min 36 s      |
| Push to end of Plan, main                                                        | 22  | 24 s        | 32 s            | 1 min 12 s      | 2 min 3 s        |
| Push to end of Plan, pull requests                                               | 75  | 24 s        | 35 s            | 2 min 10 s      | 10 min 36 s      |
| Push to Plan job start (GitHub queue)                                            | 97  | 2 s         | 3 s             | 1 min 36 s      | 10 min 8 s       |
| Plan job                                                                         | 97  | 19 s        | 28 s            | 40 s            | 1 min 44 s       |
| Step "Submit without visual tests" (success)                                     | 22  | 7 s         | 12 s            | 15 s            | 15 s             |
| Capture job (linux), success                                                     | 63  | 6 min 47 s  | 10 min 31 s     | 11 min 6 s      | 11 min 30 s      |
| Step "Test visual" (linux)                                                       | 63  | 5 min 47 s  | 9 min 24 s      | 9 min 47 s      | 10 min 8 s       |
| Step "Upload captures" (linux)                                                   | 63  | 2 s         | 4 s             | 4 s             | 7 s              |
| Capture job (safari), success                                                    | 60  | 4 min 5 s   | 11 min 59 s     | 13 min 26 s     | 18 min 5 s       |
| Step "Test visual" (safari)                                                      | 60  | 3 min 6 s   | 10 min 20 s     | 11 min 32 s     | 15 min 50 s      |
| Step "Upload captures" (safari)                                                  | 60  | 2 s         | 4 s             | 6 s             | 10 s             |
| Plan end to linux capture start                                                  | 50  | 1 min 7 s   | 1 min 24 s      | 1 min 43 s      | 2 min 30 s       |
| Plan end to safari capture start                                                 | 50  | 1 min 12 s  | 1 min 32 s      | 11 min 17 s     | 16 min 1 s       |
| Plan end to last capture end                                                     | 50  | 9 min 23 s  | 14 min 19 s     | 24 min 49 s     | 27 min 7 s       |
| Submit job, success                                                              | 50  | 1 min 59 s  | 2 min 46 s      | 3 min 28 s      | 4 min 6 s        |
| Step "Submit captures", success                                                  | 50  | 1 min 41 s  | 2 min 27 s      | 3 min 4 s       | 3 min 47 s       |
| Submit job start to step start (setup)                                           | 50  | 12 s        | 15 s            | 19 s            | 27 s             |
| Submit job start to check `started_at`                                           | 55  | 15 s        | 22 s            | 26 s            | 31 s             |
| Push to check exists, first attempt                                              | 48  | 10 min 13 s | 15 min 3 s      | 25 min 48 s     | 29 min 4 s       |
| Push to Submit job end, first attempt, all                                       | 48  | 12 min 36 s | 17 min 43 s     | 28 min 24 s     | 32 min 5 s       |
| Push to Submit job end, first attempt, main                                      | 15  | 14 min 14 s | 17 min 18 s     | 20 min 44 s     | 28 min 11 s      |
| Push to Submit job end, first attempt, pull requests                             | 33  | 12 min 36 s | 18 min 17 s     | 30 min 41 s     | 32 min 5 s       |
| Submit end to check `completed_at` (last write), all                             | 49  | 34 s        | 5 min 41 s      | 5 h 46 min 29 s | 11 h 53 min 42 s |
| Submit end to check `completed_at` (last write), pull requests                   | 32  | 34 s        | 1 min 24 s      | 29 min 11 s     | 6 h 56 min 12 s  |
| Submit end to check `completed_at` (last write), main                            | 17  | 1 min 8 s   | 2 h 27 min 59 s | 8 h 15 min 50 s | 11 h 53 min 42 s |
| Submit end to passed, pull requests, only last write within 5 min                | 22  | 34 s        | 1 min 1 s       | 1 min 42 s      | 3 min 37 s       |
| Push to passed, pull requests, only last write within 5 min                      | 22  | 16 min 13 s | 20 min 9 s      | 32 min 8 s      | 33 min 12 s      |
| Main: last write of check N minus Submit end of commit N+1 (6 pairs in sequence) | 6   | 35 s        | 42 s            | 47 s            | 47 s             |
| Push to "Visual capture is not required" completed                               | 22  | 32 s        | 38 s            | 1 min 9 s       | 1 min 18 s       |

- "Submit end to last write" in buckets (n = 49): up to 90 s: 20. 91 s to 5 min: 4. 5 to 30 min: 7. 30 min to 2 h: 6. More than 2 h: 12. More than 24 h: 0.
- Limits:
  - "Push" is the `created_at` of the workflow run. For pull request #7747 the pull request was created 4 s before the run.
  - `completed_at` is the last write of the service (PIPE-01). Each "Submit end to …" row is an upper limit for the first pass. The two rows "only last write within 5 min" leave out 10 of 32 pull request checks; they are the best estimate, not a full distribution.
  - GitHub times have a resolution of 1 s.
  - The service delay for runs that need no human review cannot be split into materialization, queue wait, and status delivery from public data.

### M4. Counts (A4)

Command: `node analyze.mjs` (section "A4 COUNTS").

- Check states and titles (78 checks, read 2026-10-05 21:05 to 21:15 UTC):

  | Status and conclusion | Title                           | Count |
  | --------------------- | ------------------------------- | ----- |
  | completed, success    | Visual review passed            | 47    |
  | completed, success    | Visual capture is not required  | 22    |
  | completed, failure    | Visual capture did not complete | 5     |
  | completed, success    | Visual review is running        | 2     |
  | completed, failure    | Visual review has not passed    | 1     |
  | completed, failure    | Visual capture was superseded   | 1     |
  | in_progress           | (any)                           | 0     |

- Titles from the code that did not occur: "Visual capture was not active" (`pre-run-checks.ts:125`), "Equivalent merge check retired" (`:359`). "Checking visual coverage" (`:517`) occurred only in the live poll (pull request #7747, in progress from 21:16:52Z to 21:20:31Z).
- Checks `in_progress` more than 2 hours or more than 24 hours after a successful Submit: 0 at collection time. A merged or closed pull request with a check in progress: 0. History is not available, so "was in progress for N hours in the past" cannot be counted. As a proxy: 12 checks have a last write more than 2 hours after Submit end (11 on `main`, 1 on pull request #7719); PIPE-01 explains them as re-sends for 22 of the 25 late writes.
- Successful Submit executions: 50. Of these, 46 have a "Visual review passed" check. The other 4: 2 "Visual review is running" (green), 1 "Visual review has not passed", 1 "Visual capture was superseded" (pull request #7732, the head changed 25 s after Submit end).
- Submit job executions: 50 success, 10 failure, 4 cancelled, 2 skipped. Steps "Submit captures" with conclusion failure: 11 (one of them in a job that GitHub then cancelled).
- Capture job executions: linux 63 success, 1 cancelled, 1 in progress at collection. Safari 60 success, 4 cancelled, 1 in progress at collection. 0 failed capture jobs with the current workflow.
- Reruns (run attempt above 1): 6 of 98 runs. 2 full reruns on `main` (`465d713a`, reason not visible; `1d2d2d2f`, after the capacity pause). 1 Submit-only rerun on `main` (`929b1543`, failed again, capacity). 3 pull request reruns of "Plus / Test Plus" and Gate (not Visonaut).
- Runs with visual jobs and no check on the head commit: 12 at collection (2 not finished, 5 cancelled by a newer push, 5 failed).

### M5. Error text of each failed Submit step (A4)

- Command (`collect-3-logs.mjs`, `collect-6-logs.mjs`): `gh api --allow-escape-sequences -X GET "repos/ariakit/ariakit/actions/jobs/<job_id>/logs"`. (`gh run view --log-failed` gives the same lines; the job log also has the env values.)
- Raw result: `submit-failures.json` and `raw/logs/<job_id>.txt`. The table is in PIPE-06. Example with the pin values (job `111207855983`):
  ```text
  Uses: ariakit/ariakit/.github/workflows/app.yml@refs/pull/7719/merge (e29b8d55d46cec27f1a1667dbc1861f61d836f01)
    VISONAUT_PACKAGE_SHA256: e1194e2085c15c99eb88ae59b638aaa0462b94233bffb4676fe7a2a60075ea98
    VISONAUT_WORKFLOW_SOURCE_SHA: 3858bc67dda6d70381c3ad189f85dd6266fc7942
  + visonaut 0.5.3
  visonaut: The signed Submit check could not be started.
  ##[error]Process completed with exit code 4.
  ```
- Limit: the log has no server code and no request reference (PKG-02). The cause of the three "could not be started" cases with correct pins comes from the times and the code, not from the log.

### M6. "Not required" checks with a pull page link (A5)

- Command: `node analyze.mjs`. Raw output: `'Visual capture is not required': 22; with /pulls/<n>?check= details_url: 22`, `by pull request: {"7552":21,"7736":1}`.
- Limit: the page behavior is from API-03. This lane did not open the page.

### M7. The same check read at different times (A6)

- Command: `node poll-baseline.mjs` and `node poll-light.mjs` (`gh api repos/ariakit/ariakit/check-runs/111879629441` and `…/111980868450`). Raw output: `poll-log.jsonl`.
  ```text
  2026-10-05T21:17:09Z baseline completed_at=2026-10-05T19:26:20Z  | #7747: in_progress "Checking visual coverage"
  2026-10-05T21:19:05Z baseline completed_at=2026-10-05T19:26:20Z  | #7747: in_progress "Checking visual coverage"
  2026-10-05T21:20:31Z baseline completed_at=2026-10-05T19:26:20Z  | #7747: completed success, completed_at 21:20:31Z
  2026-10-05T21:20:46Z baseline completed_at=2026-10-05T21:20:31Z  | #7747: completed_at 21:20:31Z
  2026-10-06T00:00:30Z baseline completed_at=2026-10-05T21:37:03Z  | #7747: completed_at 21:37:15Z
  ```
- Related jobs: pull request #7747 Submit job 21:16:25Z to 21:19:35Z. Main commit `8f018501`, attempt 2, Submit job 21:32:35Z to 21:36:24Z (`followups.json`).
- Command: `node analyze-3.mjs`. Raw output: `checks with last write > 5 min after their own Submit end: 25; with another run's event 0..150 s before that write: 22`. The three with no public event: `bb17f681` (11:35:24Z), `9cb28f01` (01:57:20Z), `77c59e3c` (19:21:26Z).
- Limit: 5 reads of one check over 2 h 43 min. The data cannot separate "a person decided in Visonaut" from "the service sent the same state again" for one write. It can show that the state did not change between two reads.

### M8. Pin history (B2)

- Command: `node pin-history.mjs`. It runs `git log -G"reusableWorkflowSha|VISONAUT_TRUSTED_EXECUTOR_DIGEST|callerWorkflowBlobSha" --format=… -- apps/web/wrangler.jsonc` and `git show <commit>:apps/web/wrangler.jsonc` in the worktree. Raw output: `pin-history.json`.
- Raw result: `commits: 36`, `by UTC day: {"2026-10-03":2,"2026-10-02":6,"2026-09-29":2,"2026-09-28":2,"2026-09-27":4,"2026-09-25":6,"2026-09-24":10,"2026-09-23":2,"2026-09-22":2}`.
- Limit: the reason classes in PIPE-03 are my reading of 36 subject lines and diffs.

### M9. Cutover windows (B2)

- Commands (`collect-4-pins.mjs`, `collect-5-windows.mjs`): `gh api -X GET "repos/ariakit/visonaut/actions/workflows/deploy.yml/runs?per_page=100&created=2026-10-02T00:00:00Z..2026-10-03T23:59:59Z"` (68 deploy runs) and the Ariakit `ci.yml` runs of 2026-10-02T00:00Z to 2026-10-03T07:00Z (108 runs), then jobs and checks for 24 runs in five windows.
- Raw output: `pin-window-lists.json`, `pin-windows.json`. The table is in PIPE-03.
- Limit: "deploy end" is the `updated_at` of the Deploy workflow run, not a Cloudflare readback. The time of the variable change is not public; the logs bound it between 13:02:37Z and 13:26:48Z on 2026-10-03.

### M10. Changes of the two pinned files (B3)

- Commands (`collect-7-workflow-commits.mjs`, `collect-8-followups.mjs`): `gh api -X GET "repos/ariakit/ariakit/commits?sha=main&path=.github/workflows/app.yml&per_page=100"` (and `ci.yml`), `…/contents/.github/workflows/app.yml?ref=solid-reboot`, `…/pulls/<n>/files?per_page=100` for #7724, #7746, #7747.
- Raw result (`followups.json`): `app.yml` 54 commits since 2025-08-30 (authors: diegohaz 46, renovate[bot] 6, others 2). `ci.yml` 38 commits since 2019 (diegohaz 32, renovate[bot] 4, others 2). Since 2026-09-01: 9 commits to `app.yml`, 6 to `ci.yml`, all by the maintainer. Blobs on `solid-reboot`: `4aac43e3039b578913e8a603c10ca47009493ef5` and `c0e3da44bb1c65004053dd66163965db8132409f`. The three pull requests have 0 files under `.github/`.
- Check of the pins today: `git hash-object` of the two files at Ariakit commit `643a23aff5a5` gives `202fd63a37199f5ac4350bd7c4e4bc44ea442216` and `4d34ca17315b19fa90083501eb347ea23d88dda9`. They equal `apps/web/wrangler.jsonc:61`.

### M11. Consumer configuration and one capture log (B1)

- Command (`collect-9-consumer-config.mjs`): `gh api -X GET "repos/ariakit/ariakit/contents/<path>?ref=643a23aff5a5…"` for `package.json`, `app/package.json`, `app/playwright.config.ts`, and the log of capture job `111873737902`.
- Raw result (`consumer-config.json`): root `devEngines.runtime.version: "24.21.0"`, `visonaut: "0.5.4"`; app `@visonaut/playwright: "0.5.0"`, `@playwright/test: "1.63.0"`; log lines `Found in cache @ /opt/hostedtoolcache/node/24.21.0/x64` and `node: v24.21.0`.

## Open questions and items not verified

Not verified, because the check needs a GitHub write, a browser, or private data:

1. GitHub's shown duration of a check (PIPE-01). I assume that GitHub calculates it from `started_at` and `completed_at`. I did not open the checks tab in a browser.
2. GitHub's behavior when a completed check gets a PATCH with `status: "in_progress"` (PIPE-09). Two checks in the data are consistent with "GitHub keeps `completed` and the conclusion, and changes the title". A proof needs one test check run in a test repository.
3. The cause and the end of the capacity pause on 2026-10-04 (PIPE-02). Public data shows refusals from 11:31:04Z to 12:53:32Z and the next success at 21:32:26Z. It does not show the database size or the count of active runs. Query for the maintainer: `SELECT value FROM operations_cursors WHERE id='database-capacity';` and the `database-capacity` rows of `operations_events`.
4. The server code of the two pull request `begin` refusals on 2026-10-04 at 10:51:24Z and 23:31:32Z (PIPE-06). The Worker log line `oidc_rejected` (`packages/security/src/oidc.ts:62`) or the request failure log has it.
5. The first time a main check passed. The value "35 to 47 s after Submit end" is an inference from the last write of the check before it.
6. The reason of three late writes with no public event: check of `bb17f681` at 2026-10-04 11:35:24Z, of `9cb28f01` at 01:57:20Z, of `77c59e3c` at 19:21:26Z. Each can be a decision of a person in Visonaut, a scheduled operation that changed the project revision, or a deployment.
7. Why main commit `44251326` kept "Visual review has not passed" while the next main commit passed 6 hours later. Why the maintainer ran main commit `465d713a` again in full at 14:49Z on 2026-10-03.
8. Branch protection of Ariakit. "The Visonaut check is required" comes from `.github/workflows/README.md:42`. The branch protection API needs admin rights; I did not call it.
9. The reason of the step failure "Encrypt captures" on the old workflow (PIPE-10). I did not read that step log.
10. Option E of PIPE-03: use of the consumer's local composite actions (`./.github/workflows/setup`) from a reusable workflow in another repository.
11. If each repeated PATCH of a check produces a `check_run` webhook delivery to the service. If yes, the re-sends of PIPE-01 also cost webhook rows (API-10).
12. The Renovate configuration of Ariakit for GitHub Actions updates. The history shows 6 such updates of `app.yml` before the pins; I did not read `renovate.json` of Ariakit.

Incidence that public data cannot give:

- OPS-11 (queue wait). Only the sum "Submit end to passed" is visible: median 1 min 1 s for pull requests (upper limit). The split into materialization, queue wait, and delivery needs the `queueWaitMs` log that OPS-08 proposes.
- OPS-01 and OPS-02 (a locked check, an endless `status` loop). 0 checks were in progress at collection. A lock that keeps an old final state is not visible from outside. Query: `SELECT id, ambiguous, request_started, desired_revision, delivered_revision FROM work_checks WHERE ambiguous = 1;`
- API-09 (materialization inside the webhook) and API-11 (a delivery that is retried without limit). Query from API-11: `SELECT event, COUNT(*) AS pending, MIN(received_at) AS oldest FROM github_webhook_delivery WHERE processed_at IS NULL GROUP BY event;`
- PKG-01: 0 proved cases in 61 Submit steps, 2 possible. PKG-03: 0 cases in 61 Submit steps and 123 successful capture jobs.

Observations outside the sample window (before the rollout cutoff, not counted above):

- 2026-10-02 07:04Z to 07:35Z: one Submit step ran 29 min 58 s and was cancelled (run 36975333848). The job time limit was 30 minutes then; `app.yml:228` now has 90.
- 2026-10-02 14:24:49Z: `visonaut: The service refused the request (HTTP 409). No visual approval was granted.` with exit code 1 (job `110878531218`). The Submit-only rerun 12 minutes later passed. This is one more example for PKG-02.
