NOTE ON THE REPORT FILE: `report.md` was NOT written. The harness refused the Write call for `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-github-journey/report.md` with "Subagents should return findings as text, not write report files. Include this content in your final response instead." I did not bypass that guard. The complete report text follows in this field, in the requested structure. The main session can save it to `reportPath` as it is. All evidence files exist in the scratch folder `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-github-journey/`: `screens/` (30 PNG files), `capture.mjs`, `capture-log.json`, `print-log.mjs`, `measure-last-decision.mjs`, `measure-last-decision-output.json`, `measure-401-shape.mjs`, `measure-401-shape-output.txt`, `check-states.mjs`, `check-states-output.txt`, `check-output-current.html`, `inspect-model.mjs`, `preview-run-model.json`. Ariakit skills that I loaded for this lane: `ariakit-general-workflow`, `ariakit-general-markdown`, `ariakit-general-code-style`. No repository file was changed.

# The journey outside the app: GitHub check text, the people who arrive, the sign-in round trip, and the way back to the pull request

Lane: `gap-github-journey`. Finding prefix: `JOUR`. This audit is read-only. Repository paths are relative to `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`. Scratch files (scripts, raw output, screenshots) are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-github-journey/`.

Words in this report:

- "Check" is the GitHub check run that the Visonaut App writes. Its name is `Visonaut`.
- "Details URL" is the `details_url` field of the check run.
- "Author" is the person who opened the pull request. The author can have no write access to the repository.
- "Maintainer" is a person with write access. Only this person can open a review.

Three limits apply to all sections:

- I sent no request to GitHub and no request to `visonaut.com`. Statements about how GitHub shows a check are assumptions. They are marked, and they are listed again in the last section.
- Server latency is another track. For server waits I count stages, requests, and timers from the code. I measured only client timers, on the fixture harness.
- Earlier lanes own some parts. I cite them and do not repeat them: PULL-01, PULL-05, PULL-06, PULL-07, PULL-17, PULL-18 (`ui-pull-ops/report.md`), DASH-13, DASH-15, DASH-16, DASH-17, DASH-19 (`ui-dashboard/verify/recovered-report.md`), SHELL-14, SHELL-15 (`ui-shell/report.md`), WORK-15, WORK-18 (`ui-workspace/verify/recovered-report-1.md`), OPS-01, OPS-09, OPS-11, OPS-13 (`operations/report.md`).

## How it works (map)

### M1. Who writes the check, and when

One GitHub App writes one check name. `packages/security/src/checks.ts:4-5`:

```ts
export const CHECK_NAME = "Visonaut";
export const REVIEW_LINK_CHECK_NAME = "Open Visonaut review";
```

No code path writes the second name today (JOUR-13). The check text has two authors in the code:

1. The pre-run code (`apps/web/src/api/pre-run*.ts`) owns the check before a run exists. It writes 6 titles.
2. The status outbox (`apps/web/src/operations/checks.ts`, `packages/security/src/checks.ts`) owns the check when a run exists. It writes 3 titles.

Sequence for a pull request that needs a capture:

1. Push. GitHub sends `pull_request` and `workflow_run` webhooks. The service stores a candidate row and creates no check. `apps/web/src/api/pre-run-checks.ts:590-604`: `/** Preserve candidate provenance without publishing a GitHub check. */` with `createCheck: false`. `apps/web/src/api/pre-run-attempts.ts:971`: `if (!candidate.check_id) return;`.
2. CI runs `Plan`, the build jobs, then `App / Visual Capture (linux)` and `App / Visual Capture (safari)` (`/Users/diegohaz/Developer/ariakit/.github/workflows/app.yml:153-156`, `timeout-minutes: 120`). In this time the pull request has no Visonaut check (JOUR-08).
3. `App / Visual Submit` starts and calls the service. `apps/web/src/api/workflow-owned.ts:317`: `await ensureSignedAttemptCheck(context, github, verified);`. This creates the check on the pull request head: `in_progress`, title "Checking visual coverage", Details URL `/pulls/<number>?check=visonaut:pre:<merge sha>` (`apps/web/src/api/pre-run-checks.ts:501-521`).
4. Submit finishes. The service makes the run row and adopts the same check (`packages/service/src/run-admission.ts:202-206`).
5. An operations pass writes the run status to the check: title, summary, and a new Details URL `/runs/<run id>` (`apps/web/src/operations/checks.ts:28-30`, `:211-217`; `packages/security/src/checks.ts:188-202`).
6. Each review decision adds a new status intent (`packages/service/src/status-touch.ts:9-24`). The next operations pass sends it with one GET and one PATCH at GitHub (`packages/security/src/checks.ts:173`, `:191`).

Sequence for a pull request that needs no capture: the last step of the `Plan` job calls `visonaut submit --no-visual`. The service creates the check and completes it in the same request (`apps/web/src/api/pre-run.ts:132-136`, `apps/web/src/api/pre-run-plan.ts:165-196`).

The status of a run becomes a GitHub conclusion in one expression. `packages/service/src/run-status.ts:98-105`:

```ts
const conclusion =
  status.status === "passed"
    ? "success"
    : status.status === "rejected" ||
        status.status === "failed" ||
        (status.status === "needs-review" && run.kind !== "merge_group")
      ? "failure"
      : "pending";
```

The conclusion becomes the text in a second step. `packages/security/src/checks.ts:43-55`:

```ts
export function genericCheckOutput(conclusion: StatusDelivery["conclusion"], detailsUrl: string) {
  const summary = `[Open this review in Visonaut](${detailsUrl}). Sign in with GitHub if prompted.`;
  if (conclusion === "pending") {
    return { title: "Visual review is running", summary };
  }
  if (conclusion === "success") {
    return { title: "Visual review passed", summary };
  }
  return {
    title: "Visual review has not passed",
    summary,
  };
}
```

So 7 run statuses become 3 conclusions, and 3 conclusions become 3 titles with 1 summary. The eighth status, `superseded`, cannot publish (`packages/service/src/run-status.ts:95-97`).

### M2. Check state table (task A)

Source: transcribed from the code by `check-states.mjs`. The script also counts the groups. The code has 9 different titles and 14 different pairs of title and summary. The lane brief said "at least ten titles". The count is 9.

"Kinds" are `pull_request`, `merge_group`, and `main`. "All" means all three.

| ID  | Stage or run status                                        | Kinds              | GitHub status | Conclusion | Title                             | Summary                                                                                                                              | Details URL                                                              | What the person learns                                                       | Action that is needed                                             |
| --- | ---------------------------------------------------------- | ------------------ | ------------- | ---------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| P1  | Push or rerun, before the first signed call                | all                | no check run  | none       | none                              | none                                                                                                                                 | none                                                                     | Nothing. Visonaut has not written to GitHub.                                 | Wait for CI.                                                      |
| P2  | Verification (Plan report or Submit started)               | all                | `in_progress` | none       | "Checking visual coverage"        | "Visonaut is verifying this commit."                                                                                                 | PR: `/pulls/N?check=visonaut:pre:<merge sha>`. Main and merge queue: `/` | Visonaut has seen the commit. No stage, no time.                             | Wait.                                                             |
| P3  | Plan says no capture                                       | all                | `completed`   | `success`  | "Visual capture is not required"  | "The successful trusted Plan selected app=false for this attempt."                                                                   | unchanged from P2                                                        | No visual work. The reason is in workflow terms.                             | None.                                                             |
| P4  | Capture failed (the workflow ended without a valid Submit) | all                | `completed`   | `failure`  | "Visual capture did not complete" | One of 4 sentences (see below)                                                                                                       | unchanged from P2                                                        | The capture did not arrive. No link to the failed job.                       | Inspect CI. Rerun all jobs.                                       |
| P5  | Superseded by a new head                                   | pull_request       | `completed`   | `failure`  | "Visual capture was superseded"   | "The pull request head or target changed before capture completed."                                                                  | unchanged from P2                                                        | This attempt is obsolete. It shows as a failure.                             | None. A newer check holds the result.                             |
| P6  | Superseded by a rerun                                      | all                | `completed`   | `failure`  | "Visual capture was superseded"   | "A verified rerun started as workflow attempt N."                                                                                    | unchanged from P2                                                        | This attempt is obsolete. It shows as a failure on the same commit.          | None. A newer check holds the result.                             |
| P7  | Superseded because main advanced                           | main               | `completed`   | `failure`  | "Visual capture was superseded"   | "Main advanced before this workflow attempt completed."                                                                              | unchanged from P2 (`/`)                                                  | This main commit has no visual result. It shows as a failure.                | None. A newer check holds the result.                             |
| P8  | Merge regenerated (legacy check with no workflow run)      | pull_request       | `completed`   | `neutral`  | "Equivalent merge check retired"  | "GitHub regenerated this pull request merge without changing its parents or file tree. [Open the tested Visonaut result](/runs/ID)." | `/runs/<run id>`                                                         | Another check holds the result.                                              | None.                                                             |
| P9  | Main commit before the pinned workflow (legacy)            | main               | `completed`   | `neutral`  | "Visual capture was not active"   | "Ariakit had not yet merged the pinned Visonaut App workflow."                                                                       | unchanged (`/`)                                                          | No visual result for this commit.                                            | None.                                                             |
| R1  | Run: `incomplete`                                          | all                | `in_progress` | none       | "Visual review is running"        | "[Open this review in Visonaut](URL). Sign in with GitHub if prompted."                                                              | `/runs/<run id>`                                                         | Something runs. It is the capture upload, not a review.                      | Wait.                                                             |
| R2  | Run: `comparing`                                           | all                | `in_progress` | none       | "Visual review is running"        | same sentence                                                                                                                        | `/runs/<run id>`                                                         | Same text as R1.                                                             | Wait.                                                             |
| R3a | Run: `needs-review`                                        | pull_request, main | `completed`   | `failure`  | "Visual review has not passed"    | same sentence                                                                                                                        | `/runs/<run id>`                                                         | A red failure. Not how many changes. Not that a maintainer must act.         | A maintainer reviews.                                             |
| R3b | Run: `needs-review`                                        | merge_group        | `in_progress` | none       | "Visual review is running"        | same sentence                                                                                                                        | `/runs/<run id>`                                                         | Same text as R1. The merge queue waits for a person.                         | A maintainer reviews before the queue times out.                  |
| R4  | Run: `rejected`                                            | all                | `completed`   | `failure`  | "Visual review has not passed"    | same sentence                                                                                                                        | `/runs/<run id>`                                                         | Same text as R3a. Not that a maintainer rejected a change. Not which change. | The author changes the code, or a maintainer changes the verdict. |
| R5  | Run: `failed` (capture or comparison)                      | all                | `completed`   | `failure`  | "Visual review has not passed"    | same sentence                                                                                                                        | `/runs/<run id>`                                                         | Same text as R3a. Not that the machine failed.                               | Inspect CI. Capture a new run.                                    |
| R6  | Run: `passed`                                              | all                | `completed`   | `success`  | "Visual review passed"            | same sentence                                                                                                                        | `/runs/<run id>`                                                         | Passed. Not if anything changed. Not who approved.                           | None.                                                             |
| R7  | Run: `needs-recompare`                                     | all                | `in_progress` | none       | "Visual review is running"        | same sentence                                                                                                                        | `/runs/<run id>`                                                         | Same text as R1. Nothing runs. Server recompare is disabled.                 | Capture a new complete run.                                       |
| R8  | Run: `superseded`                                          | all                | no delivery   | none       | the last delivered output stays   | none                                                                                                                                 | `/runs/<run id>` of the old run                                          | A stale result on the old commit or attempt.                                 | None. Look at the newer check.                                    |

Sources for each row: P1 `apps/web/src/api/webhooks.ts:186-206`, `:325-328`. P2 `apps/web/src/api/pre-run-checks.ts:501-521`. P3 `apps/web/src/api/pre-run-plan.ts:178-188`. P4 `apps/web/src/api/pre-run-attempts.ts:1011-1026`. P5 `:301-304`. P6 `:646-656`. P7 `:226-229`. P8 `apps/web/src/api/pre-run-checks.ts:351-363`. P9 `:118-128`. R1 to R7 `packages/service/src/run-status.ts:98-105` and `packages/security/src/checks.ts:43-55`, `:188-202`. R3b also `packages/service/src/service.test.ts:2420-2438` ("keeps merge-group review pending until approval or rejection"). R7 also `packages/service/src/review-status.ts:80-90` and `apps/web/src/api/review.ts:986`. R8 `packages/service/src/run-status.ts:95-97` (`throw new ConflictError("A superseded attempt cannot publish a check.")`) and `packages/service/src/review-status.ts:25-27`.

The 4 sentences of P4 (`apps/web/src/api/pre-run-attempts.ts:1011-1018`):

- "The trusted Plan or signed Submit is missing. Missing Plan never means no visual work."
- "A pinned capture or submit job did not complete successfully."
- "The capture workflow finished without a signed Visonaut submit job."
- "The pinned capture workflow ended with CONCLUSION."

States that have the same title and the same conclusion, but need a different action (output of `check-states.mjs`):

| Title and conclusion                       | Rows            | Different actions                                                               |
| ------------------------------------------ | --------------- | ------------------------------------------------------------------------------- |
| "Visual review has not passed", `failure`  | R3a, R4, R5     | 3: a maintainer reviews; the author changes the code; someone inspects CI       |
| "Visual review is running", `in_progress`  | R1, R2, R3b, R7 | 3: wait; a maintainer reviews; someone starts a new capture                     |
| "Visual capture was superseded", `failure` | P5, P6, P7      | 1: none. The defect here is the red conclusion for a state that needs no action |

Screenshot `screens/jour-08-check-output-today-simulated--desktop-dark.png` shows the 16 outputs side by side (all rows but P1 and R8, which have no output). It is a simulated layout, not a GitHub screenshot.

### M3. Who can open what

- `packages/security/src/authorization.ts:32-39`: no session gives `401 sign_in_required`, "Sign in with GitHub."
- `packages/security/src/github.ts:226-228`: `if (result.permission !== "write" && result.permission !== "admin") { throw new SecurityError("not_maintainer", 403, "Repository write permission is required."); }`
- Every private read uses this gate (`/api/runs`, `/api/runs/:id`, `/api/pulls/:n`). There is no read-only role. `apps/web/src/api/api.test.ts:762-770` proves it: with permission `read`, `/api/pulls/42` answers 403 as soon as the cached permission is gone (the test clears it with a denied write).
- Sign-in is open to every GitHub account. `packages/security/src/auth.ts:29-46` has no allow list. The session lasts 7 days (`expiresIn: 60 * 60 * 24 * 7`) and is renewed after 1 day of use (`updateAge`).
- `docs/review-guide.md:3`: "Validated image URLs need no session; anyone with a URL can view and copy those pixels. Labels, verdicts, audit data, export files, and quarantine remain private." No surface gives these URLs to a person without write access.

### M4. Journey maps (task B)

Each step has: the surface, the exact text, the wait and its cause, the next action. Dead ends are listed below each map. Counts are from the code if no measurement is named.

#### J1. A maintainer goes from a failed check to the first image

Signed in. The run exists and one status was delivered.

| Step | Surface                                                                 | Text that the person reads                                                                                      | Wait and cause                                                                                                                                                                                                                                                                                                          | Next action            |
| ---- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1    | GitHub, pull request, checks list                                       | "Visonaut" with a red mark and "Visual review has not passed"                                                   | none                                                                                                                                                                                                                                                                                                                    | Click "Details"        |
| 2    | GitHub, check run page (assumption: an App check opens this page first) | Title "Visual review has not passed". Summary: "Open this review in Visonaut. Sign in with GitHub if prompted." | One GitHub page                                                                                                                                                                                                                                                                                                         | Click the summary link |
| 3    | App, `/runs/<id>`                                                       | "Checking access and loading this run…" (`apps/web/src/routes/runs.$runId.tsx:66-74`)                           | Document, then JavaScript (the route has `ssr: false`, `:31`), then 1 API request `GET /api/runs/<id>`: 1 session read, 1 account read, the permission check (cached 60 s; a miss is 1 to 3 GitHub requests, `packages/security/src/authorization.ts:60-73`, `packages/security/src/github.ts:231-261`), then the model | none                   |
| 4    | App, review workspace                                                   | "#5300 · Dialog focus styles", "9 of 11 need review", the first pending variant                                 | 2 image requests for the side by side view                                                                                                                                                                                                                                                                              | Review                 |

Before the first status delivery, the Details URL is `/pulls/<n>?check=…`. This adds 1 API request with the same access path and 1 client redirect (PULL-01).

Signed out. Steps 1 and 2 are the same.

| Step | Surface                                                                                                          | Text that the person reads                                                                                                                                                                                             | Wait and cause                                                                                                                                                                                                             | Next action          |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 3    | App, `/runs/<id>`                                                                                                | "Checking access and loading this run…", then "Sign in to review this run", "This review is available to Ariakit maintainers.", button "Sign in with GitHub" (`screens/jour-02-run-guest-deep-link--desktop-dark.png`) | Document, JavaScript, `GET /api/runs/<id>` answers 401                                                                                                                                                                     | Click the button     |
| 4    | App                                                                                                              | Button text "Opening GitHub…" (`screens/jour-03-run-guest-deep-link-opening-github--desktop-dark.png`)                                                                                                                 | `POST /api/auth/sign-in/social`. Measured: the body is `{"provider":"github","callbackURL":"/runs/run-42?item=menu%2Fopen&variant=Menu-dark"}`                                                                             | none                 |
| 5    | GitHub, authorize page (assumption: no click if the person is signed in to GitHub and authorized the App before) | GitHub text                                                                                                                                                                                                            | 1 or more GitHub pages                                                                                                                                                                                                     | Possibly "Authorize" |
| 6    | App, `/api/auth/callback/github`                                                                                 | none                                                                                                                                                                                                                   | The server exchanges the code at GitHub, makes the session, and redirects to the callback URL                                                                                                                              | none                 |
| 7    | App, `/runs/<id>?item=…&variant=…`                                                                               | "Checking access and loading this run…" again                                                                                                                                                                          | Second document load, JavaScript again, `GET /api/runs/<id>`. The permission cache key contains the session ID (`packages/security/src/authorization.ts:49-54`), so a new session always misses: at least 1 GitHub request | none                 |
| 8    | App, review workspace                                                                                            | The item and variant from the link are selected. Measured: 1 API request, heading "Open menu", current variant "Menu-dark" (`screens/jour-04-run-return-to-deep-link-after-sign-in--desktop-dark.png`)                 | 2 image requests                                                                                                                                                                                                           | Review               |

Counts for the signed-out path: 2 document loads of the app, 4 app API requests (run 401, sign-in, callback, run 200), 1 or more GitHub pages, and 1 or 2 more clicks than the signed-in path.

Dead ends: none. Gaps: GitHub shows no count before the click (JOUR-03). The sign-in card does not name the pull request (JOUR-10).

#### J2. The pull request author without write access follows the same link

| Step | Surface                                                                             | Text that the person reads                                                                                                                                                                    | Next action                                             |
| ---- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1    | GitHub, the author's own pull request                                               | "Visonaut" with a red mark, "Visual review has not passed"                                                                                                                                    | The author thinks that the pull request broke something |
| 2    | Ariakit contributor guide (`/Users/diegohaz/Developer/ariakit/contributing.md:578`) | "Check the Visonaut result. If it requires review, open the linked review and ask a maintainer to review the changes."                                                                        | Click "Details", then the link                          |
| 3    | GitHub, check summary                                                               | "Open this review in Visonaut. Sign in with GitHub if prompted."                                                                                                                              | Click                                                   |
| 4    | App, `/runs/<id>`                                                                   | "Sign in to review this run", "This review is available to Ariakit maintainers."                                                                                                              | The check said "sign in", so the author signs in        |
| 5    | GitHub                                                                              | The authorize page for the Visonaut App (assumption)                                                                                                                                          | Authorize                                               |
| 6    | App, `/runs/<id>`                                                                   | "This run could not be opened", "Write access to this repository is required to open this run.", button "Retry" (`screens/jour-01-run-forbidden-signed-in-no-write-access--desktop-dark.png`) | Retry gives the same answer                             |

On the pull route (Details URL before the first status delivery) step 6 reads "Repository access required", "Write access to this repository is required to open its review.", button "Use another account" (`ui-pull-ops/screens/pull-05-forbidden--desktop-dark.png`).

What the author can see or do: nothing. No count, no item name, no image, no link back to the pull request, no text that says "a maintainer does this, you can wait". The header on the run page has no account menu in this state (`apps/web/src/routes/runs.$runId.tsx:55-64` renders `<AppHeader />` with no `end` slot), so the author cannot sign out there. The session lasts 7 days. The user row and the account row stay (JOUR-04).

Dead ends: step 6 on both routes.

#### J3. A maintainer makes the last decision. The chain to a green check

Stages. "Client" is the browser. "Worker" is the web Worker. Numbers in brackets are code references.

| #   | Where                  | What happens                                                                                                                                                                                                                                                                              | Timer or wait                                                                                                                |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Client                 | Click "Approve & next". The page shows the verdict and "0 of 11 need review" at once (optimistic).                                                                                                                                                                                        | none                                                                                                                         |
| 2   | Client to Worker       | First decision of the page only: `POST /api/review-sessions` [`apps/web/src/review/client.ts:295-303`]                                                                                                                                                                                    | 1 request                                                                                                                    |
| 3   | Client to Worker       | `POST /api/comparisons/:id/commands` with `queued: true`. The Worker checks access (10 s permission cache), stores the task, and answers 202 [`apps/web/src/api/review.ts:872-878`]                                                                                                       | 1 request                                                                                                                    |
| 4   | Worker, `waitUntil`    | `processReviewQueue` for this command: the decision is written, the run status is read, the task is completed [`apps/web/src/api/review.ts:641-659`, `apps/web/src/operations/review-queue.ts:96-133`]. The write adds a status intent row [`packages/service/src/status-touch.ts:19-23`] | not counted here                                                                                                             |
| 5   | Client                 | Fixed wait of 500 ms, then `GET /api/commands/:id/queued`. Repeats every 500 ms until the task is complete [`apps/web/src/review/client.ts:326-336`]. The answer has `runStatus: "passed"`. The page shows "1 variant approved. Saved." and "Check passed".                               | Timer 1: 500 ms. Measured floor from click to "Saved.": 672 to 677 ms with instant API answers (M-1)                         |
| 6   | Worker, `waitUntil`    | `context.operations.send({ kind: "status" })` puts 1 message on the queue [`apps/web/src/api/review.ts:660-664`]. A failed send is only logged: `review-status-wakeup-failed`.                                                                                                            | Fallback after a failed send: the cron, `*/5 * * * *` [`apps/web/wrangler.jsonc:109-111`]. Timer 2: up to 5 minutes          |
| 7   | Cloudflare Queue       | The consumer takes 1 message at a time: `max_batch_size: 1`, `max_batch_timeout: 1`, `max_concurrency: 1` [`apps/web/wrangler.jsonc:98-107`]. A `recovery`, `ingest`, or `maintenance` pass in front runs first (OPS-11).                                                                 | Timer 3: the queue wait. Not measured. A consumer error delays the retry by 60 s [`apps/web/src/server.ts:164-167`]. Timer 4 |
| 8   | Worker, queue consumer | `runOperations` with kind `status` runs 4 steps in this order: `review-decisions`, `checks`, `review-links`, `promotion` [`apps/web/src/operations/index.ts:47-62`, `:74`]                                                                                                                | Step 1 runs before the check step                                                                                            |
| 9   | Worker, step `checks`  | Prepares the intent (run, project, status, comparison, 1 batch) [`packages/service/src/run-status.ts:82-143`], claims it, then reads the check at GitHub and writes it [`packages/security/src/checks.ts:173`, `:191`]                                                                    | 2 GitHub requests: 1 GET, 1 PATCH. A new isolate also needs 1 installation token request                                     |
| 10  | GitHub                 | The check is `completed`, `success`, "Visual review passed".                                                                                                                                                                                                                              | none                                                                                                                         |

Count: 6 stages after the click that the decision must pass before GitHub is green (3, 4, 6, 7, 8, 9), 4 timers (500 ms poll, queue wait, 60 s retry, 5 minute cron), and 2 GitHub requests. The only production numbers in the repository are from the older code path, before stage 4 moved into `waitUntil`. `docs/evidence/checks-7710/README.md:43`: "The approval waited `52524 ms` before its commit and `53369 ms` before its receipt. Success intents followed the approval commit by `21514 ms` and `33363 ms`." The same file says at line 67: "Local tests prove check identity and wakeup behavior; they do not measure new production latency." I did not measure production.

What the app shows in this time:

- At stage 3: "1 queued on server. You can close this window." (`screens/jour-06-run-last-decision-queued--desktop-dark.png`). The status text at the top right still says "Changes need review" while the counter says "0 of 11 need review".
- At stage 5: "1 variant approved. Saved." at the bottom, and "Check passed" at the top right in 10 px text (`screens/jour-07-run-last-decision-after-check-passed--desktop-dark.png`).
- After stage 5: nothing more. Measured: 0 requests in the next 6 seconds (M-1). The page does not know if stages 6 to 10 happened.
- "Check passed" is the label of the run status `passed` (`apps/web/src/review/use-review-session.ts:63-64`). It is not the state of the GitHub check.
- "Review complete. No variants need review." exists only in a screen reader region (WORK-15).

Link back to the pull request: none. Measured: 0 links to `github.com` in the workspace (M-2). The title "#5300 · Dialog focus styles" and the commit "4f1c9e0" are plain text. The only way out is "Queue".

Dead ends: the end of the review has no next step (WORK-15). If the delivery fails, the alert appears only on the dashboard and the Service status page, not on the run page (OPS-01, `ui-pull-ops/report.md` section C).

#### J4. A new push or a rerun arrives while a review is open, or an old link is in a browser tab

New push, review tab open:

1. GitHub sends `pull_request`. The Worker retires the active run of the old merge commit (`apps/web/src/api/webhooks.ts:310-323`, `retireRun`). The run status becomes `superseded`.
2. The open tab does not learn this. The workspace polls only while a comparison is pending (`apps/web/src/review/use-review-session.ts:144-149`, `:185-186`).
3. The reviewer makes the next decision. The command admission asserts `run.active = 1` (`apps/web/src/operations/review-queue.ts:49-57`). The assertion fails. The answer is 409 with the text "State changed. Refresh the comparison before trying again." (`packages/service/src/database.ts:65`).
4. The page loads the current model and shows "Comparison superseded", "A newer attempt replaced this comparison. Its evidence cannot be reviewed.", and the button "Recompare now" (`apps/web/src/review/review-workspace.tsx:136-137`, `:957-958`, `:987`; screenshot of the state: `ui-workspace/screens/53-terminal-superseded-dark-1440.png`). "Recompare now" cannot work in production (WORK-18). There is no link to the newer run and no link to the pull request.

On GitHub after the push:

- The old head keeps its check. If the old check was not complete, it becomes `failure`, "Visual capture was superseded" (P5). If it was complete, it stays, for example `failure`, "Visual review has not passed" (R8).
- The new head has no Visonaut check until the Submit job of the new commit starts (P1, JOUR-08).

Rerun on the same head:

- The service closes the old check only if it is not complete: `failure`, "Visual capture was superseded", "A verified rerun started as workflow attempt N." (`apps/web/src/api/pre-run-attempts.ts:644-657`). It then creates a second check run with the same name `Visonaut` and a new external ID with a generation suffix, `visonaut:pre:<sha>:1` (`:663-685`, `apps/web/src/api/pre-run-checks.ts:153-155`).
- The same commit then has 2 check runs with the name `Visonaut`. How GitHub lists two runs with one name is not verified.

Old link in a tab, or the Details link of an older commit:

- `/runs/<old id>`: the superseded workspace of step 4. Dead end.
- `/pulls/<n>?check=<old external id>`: the page answers for the old attempt only (PULL-06). A sealed old run gives "ready" and opens the old run, also when the run is not active (`apps/web/src/api/api.test.ts:739-743`). An old attempt with no run gives "Visual capture failed." with a "Check again" button that cannot change the answer (PULL-07, JOUR-05).

Dead ends: all three old-link cases.

#### J5. A run on main and a run in the merge queue. Who learns about it, and where?

Main:

- The check is on the main commit. It is created when Submit starts, with the Details URL `/`, the dashboard (`apps/web/src/api/pre-run-checks.ts:508-514`). After the first status delivery the URL is `/runs/<id>`.
- A main run that needs review is `failure`, "Visual review has not passed" (R3a). The baseline is not promoted until the review passes (`README.md:42`: "A full main run promotes a baseline only when all acceptance conditions pass.").
- Who learns: a person who looks at the commit list on GitHub and sees the red mark, or a person who opens the Visonaut queue. The service sends no message. The run list does not refresh by itself (DASH-19). The merged pull request does not show the check of the main commit.

Merge queue:

- The check is on the merge group commit. The Details URL is `/` at first, then `/runs/<id>`.
- A merge queue run that needs review stays `in_progress` with "Visual review is running" (R3b). This keeps the pull request in the queue, by design (`packages/service/src/service.test.ts:2420-2438`).
- Who learns: nobody is told that the queue waits for a person. The text says "running". Assumption: GitHub removes the pull request from the queue when the queue's status check timeout ends, and names a timeout as the reason.

Dead ends: none in the app. The gap is that no text and no surface says "a person must act now" (JOUR-02, JOUR-09).

#### J6. A pull request that needs no capture

1. `Plan CI` reports `app=false`. The last Plan step runs `visonaut submit --no-visual` (`/Users/diegohaz/Developer/ariakit/contributing.md:568`).
2. The service creates the check and completes it: `success`, "Visual capture is not required", "The successful trusted Plan selected app=false for this attempt." (P3). The PATCH has no `details_url` (`apps/web/src/api/pre-run-plan.ts:178-188`), so the Details URL stays `/pulls/<n>?check=…`.
3. A person who clicks "Details" on this green check reaches the pull page. `/api/pulls` answers `state: "pending"` (JOUR-05). The page says "Waiting for screenshots.", "The visual capture has not reached Visonaut yet. This page updates automatically when the review is ready." (`ui-pull-ops/screens/pull-08-pending--desktop-dark.png`). It polls every 15 s while the tab is visible, with no end (PULL-05).

Dead end: step 3. The correct page text exists ("No visual review needed.", `apps/web/src/routes/pulls.$pullNumber.tsx:257-258`) but current data cannot reach it.

### M5. Prior art (task D)

Raw pages: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/ui-benchmark/sources/`.

| Product        | Surface on the pull request                                                                                                                                              | Content                                                                                                                     | Source file and lines                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Argos          | One comment, updated on each status change. Also commit statuses (`argos`, `argos/<build>`, `argos/summary`).                                                            | Status, a link to the build, and a "Details" column: "`2 added` or `4 changed, 3 ignored`"                                  | `argos-pr-comments.md:7-19`, `argos-summary-checks.md:7-9`  |
| Chromatic      | One comment. "The comment is created the first time a build posts results for a PR. From then on, it updates automatically". Also the checks "UI Tests" and "UI Review". | "the number of visual and accessibility changes that need to be accepted as baselines", the review status, a Storybook link | `chromatic-pr-comments.md:9-21`, `chromatic-in-pr.md:75-84` |
| Percy          | Build states "Unreviewed", "Changes requested", "Approved". A change request makes "a time-stamped comment".                                                             | Rejection is a separate state with a note                                                                                   | `percy-change-request.txt:51-67`                            |
| Lost Pixel     | A red status check until all images are approved, then green                                                                                                             | No counts in the cited page                                                                                                 | `lostpixel-baseline-flow.md:12-14`                          |
| Visonaut today | One check run. No comment.                                                                                                                                               | 9 titles, 1 sentence for all run states, no counts                                                                          | M2                                                          |

Two facts limit a copy of the comment pattern:

- The App cannot comment today. `packages/security/README.md:30`: "Required repository permissions are Metadata read, Actions read, Checks write, Pull requests read, and Contents read." A comment needs a write permission for pull requests or issues, and the installation owner must accept it.
- The check output needs no new permission. GitHub renders Markdown in `output.summary` and `output.text` (assumption from the GitHub API, not verified here).

Red until approved is a known pattern (Lost Pixel). Percy and Chromatic separate "waits for review" from "changes requested". Visonaut merges these two and a machine failure into one title (JOUR-01).

## Findings

### JOUR-01 · A review that waits for a maintainer is a red failure, and three different states share one title

- Kind: ux
- Severity: high. Confidence: high. Measured: no. Effort: S for titles, M for a different conclusion
- Evidence:
  - `packages/service/src/run-status.ts:98-105` (quoted in M1): `rejected`, `failed`, and `needs-review` (not merge queue) all become `"failure"`.
  - `packages/security/src/checks.ts:51-54`: `return { title: "Visual review has not passed", summary };`
  - `packages/service/src/work.ts:381-392`: the delivery row has `conclusion: "pending" | "success" | "failure"` and no status field. The sender cannot know which of the three states it sends.
  - The app has three words for the same states. `apps/web/src/routes/index.tsx:130-140`: "Needs review", "Changes rejected", "Run failed".
  - Prior art: Percy and Chromatic have a separate state for "waits for review" (M5).
- What happens: A pull request with 3 intended visual changes gets a red check with the text "Visual review has not passed" as soon as the comparison is ready. Nobody did anything wrong. The same red text appears when a maintainer rejected a change, and when the capture or the comparison failed.
- Impact: The author reads a failure of the pull request. The maintainer cannot tell from GitHub if the next step is a review, a code change by the author, or a rerun of CI. Each of the three needs a click into the app, and the author cannot open the app (JOUR-04). A red check also trains people to ignore the Visonaut check.
- Recommendation: Send the run status with the delivery and choose the title from the status. Keep the conclusion for now. Sketch:

  ```ts
  // packages/security/src/checks.ts (sketch)
  type CheckStatus =
    | "incomplete"
    | "comparing"
    | "needs-review"
    | "rejected"
    | "failed"
    | "passed"
    | "needs-recompare";

  const titles: Record<CheckStatus, (counts: { pending: number; rejected: number }) => string> = {
    incomplete: () => "Receiving screenshots",
    comparing: () => "Comparing screenshots",
    "needs-review": ({ pending }) =>
      `${pending} ${pending === 1 ? "change needs" : "changes need"} review`,
    rejected: ({ rejected }) => `${rejected} ${rejected === 1 ? "change" : "changes"} rejected`,
    failed: () => "Capture or comparison failed",
    passed: () => "Visual review passed",
    "needs-recompare": () => "A new capture is needed",
  };
  ```

  The status and the counts are in scope where the intent is made (`packages/service/src/run-status.ts:94`: `const status = await service.status(run.id);`). They need a place in `work_status_outbox` (`apps/web/migrations/0002_work.sql:31-46`), or the sender reads the status again before the PATCH.

- Alternatives:
  - Minimal: no schema change. Read `service.status(run.id)` in the `send` callback (`apps/web/src/operations/checks.ts:302-318`) and pass a title. The intent stays as it is.
  - Use the GitHub conclusion `action_required` for `needs-review`. Assumption: GitHub shows "Action required" and a required check with this conclusion blocks the merge. Verify both on a test repository first.
  - Keep `needs-review` as `in_progress` for all kinds, as the merge queue does today, with the title "Waiting for review". The check is then yellow, not red. A check that is in progress for days can look stuck.
  - Keep one title and move the difference to the summary (JOUR-03).
- Maintainer decision needed: yes. Which GitHub conclusion should a review that waits for a maintainer have: `failure` (today), `action_required`, or `in_progress`?

### JOUR-02 · "Visual review is running" also means "waits for a person" and "needs a new capture"

- Kind: ux
- Severity: medium. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `packages/service/src/run-status.ts:103-105`: `needs-review` of a `merge_group` run, and each status that is not named, become `"pending"`. `needs-recompare` is not named.
  - `packages/security/src/checks.ts:45-47`: `return { title: "Visual review is running", summary };`
  - `packages/service/src/review-status.ts:80`: `if (comparison?.state === "invalidated") return empty("needs-recompare");` and `:83-90` for main and merge queue runs after the baseline moved.
  - `apps/web/src/api/review.ts:986`: `throw new SecurityError("local_comparison_required", 409, serverRecompareDisabledReason);`. The server cannot make a new comparison. `docs/review-guide.md:88`: "**Recompare stored run** is retired."
  - The app names the state differently: "New capture needed" (`apps/web/src/routes/index.tsx:131`), "A new comparison is required" (`apps/web/src/review/use-review-session.ts:71-72`).
- What happens: Four statuses show the same yellow text (rows R1, R2, R3b, R7 in M2). In two of them nothing runs. A merge queue run that needs review waits for a maintainer. A run with `needs-recompare` waits for a new CI run that nobody started.
- Impact: The check can stay "running" without an end. In the merge queue the pull request then leaves the queue by timeout (assumption about GitHub), and the text gave no reason. For `needs-recompare` the person waits for something that cannot finish.
- Recommendation: Give each state its own title with the status-based titles of JOUR-01: "Waiting for review: 3 changes" for the merge queue, "A new capture is needed" for `needs-recompare`. Decide the conclusion of `needs-recompare` separately.
- Alternatives:
  - Minimal: change only the summary for these two states, and keep the title.
  - Make `needs-recompare` a `failure` with the summary "Run the CI workflow again to capture this commit." It then matches the action. Check the effect on runs of main first.
- Maintainer decision needed: yes. Should `needs-recompare` stay `in_progress`, or become a completed check that asks for a new capture?

### JOUR-03 · The check output has no counts and no item names. The service computes the counts and drops them

- Kind: ux
- Severity: high. Confidence: high. Measured: no. Effort: M
- Evidence:
  - `packages/security/src/checks.ts:44`: one summary for all run states: ``const summary = `[Open this review in Visonaut](${detailsUrl}). Sign in with GitHub if prompted.`;``
  - `packages/service/src/run-status.ts:56-60`: the status read computes `pending` and `rejected` for the comparison. `:94` reads this status for each intent. `:98-105` keeps only the conclusion.
  - `packages/security/src/checks.ts:28-41`: the Details URL must be exactly `/runs/<id>`. A query string throws `invalid_review_link`. So the Details button cannot point to an item.
  - The check output uses 2 of the fields that GitHub offers (`title`, `summary`). It uses no `text`.
  - Each decision already makes a delivery. `packages/service/src/status-touch.ts:9-24` raises the project revision and adds an outbox row for each review command. `packages/service/src/work.ts:653-671` has no rule that skips an intent with an unchanged conclusion. So the GET and the PATCH happen, and the payload is the same text as before. Counted from code, not measured.
  - `docs/simplification-audit/contract-issue-1.md:261` asks the app for counts: "Show counts such as “2 of 6 need review,” not only “changed.” Counts and text must accompany color."
  - Prior art: Argos "`4 changed, 3 ignored`", Chromatic "the number of visual and accessibility changes that need to be accepted" (M5).
- What happens: On GitHub a run with 1 changed screenshot and a run with 300 look the same. A passed run with no change and a passed run with 40 approved changes look the same. The maintainer must open the app to learn the size of the task. The summary of a passed check still says "Sign in with GitHub if prompted."
- Impact: The maintainer cannot plan from the pull request page. The author learns nothing (JOUR-04). The service pays for a GitHub write after each decision batch and uses it to send the same sentence again.
- Recommendation: Build the output from the run status and the counts. Start with one line (Redesign idea G1). Add the item table as `output.text` when the privacy question below has an answer (G2). Sketch of the data that the sender needs:

  ```ts
  interface CheckFacts {
    status:
      | "incomplete"
      | "comparing"
      | "needs-review"
      | "rejected"
      | "failed"
      | "passed"
      | "needs-recompare";
    pending: number;
    rejected: number;
    approved: number;
    unchanged: number;
    automatic: number;
    attempt: number;
    runUrl: string;
  }
  ```

- Alternatives:
  - Minimal: add only the two numbers that the service already has, in the title: "3 changes need review" and "1 change rejected, 2 need review".
  - One pull request comment that is edited in place, as Argos and Chromatic do (G5). It needs a new App permission (M5).
  - A table of changed items with direct links in `output.text` (G2).
- Maintainer decision needed: yes. The check output of a public repository is public. `docs/review-guide.md:3` says "Labels, verdicts, audit data, export files, and quarantine remain private." May the check show (a) counts, (b) item names, (c) thumbnails of public image URLs?

### JOUR-04 · The check tells each reader to sign in. A pull request author who does so reaches a dead end

- Kind: ux
- Severity: high. Confidence: high. Measured: yes (screens). Effort: M
- Evidence:
  - `packages/security/src/checks.ts:44`: "Sign in with GitHub if prompted." for each reader.
  - `/Users/diegohaz/Developer/ariakit/contributing.md:578`: "If it requires review, open the linked review and ask a maintainer to review the changes." `README.md:13`: "Open the review link from the GitHub check and sign in with GitHub."
  - `packages/security/src/github.ts:226-228`: a person without write access gets 403.
  - `apps/web/src/routes/runs.$runId.tsx:78-80`, `:98-107`: the 403 text is "Write access to this repository is required to open this run." with one button, "Retry". `:55-64`: the header has no account menu in this state.
  - `apps/web/src/routes/pulls.$pullNumber.tsx:63-68`, `:225-232`: the pull route says "Write access to this repository is required to open its review." with "Use another account".
  - `packages/security/src/auth.ts:29-46`: sign-in has no access rule, stores encrypted OAuth tokens (`encryptOAuthTokens: true`), and makes a session for 7 days. `:56-65` adds an audit row for each sign-in. No code removes a user without access (a search for `DELETE FROM (user|account)` finds no match in `apps/web/src` and `packages/security/src`; only sessions are deleted).
  - `docs/simplification-audit/contract-issue-1.md:57`: "No customer billing, general signup, …".
  - Screens: `screens/jour-01-run-forbidden-signed-in-no-write-access--desktop-dark.png`, `--desktop-light.png`, `--mobile-dark.png`, `--mobile-light.png`.
- What happens: See J2. The author follows the guide and the check text, authorizes the App at GitHub, and gets "This run could not be opened". "Retry" repeats the 403. The page does not say which account is signed in (DASH-17), that this result is normal for an author, what a maintainer must do, or how to go back to the pull request. On the run route the author cannot sign out.
- Impact: The first contact of each outside contributor with Visonaut ends in an error page after an OAuth grant. Each such visit leaves a user row, an account row with tokens, a session, and an audit row for a person who can never use the app. The guide tells the author to do the one thing that cannot work.
- Recommendation:
  1. Split the summary by reader (Redesign idea G3): one sentence for the author ("A maintainer reviews these changes. You do not need to do anything.") and one link for maintainers.
  2. Replace the 403 pages with one "no access" page that names the account, says who reviews, and links to the pull request (Redesign idea A1).
  3. Change `contributing.md:578` to "ask a maintainer to review the visual changes". This file is in the Ariakit repository.
- Alternatives:
  - Minimal: change only the two texts. Summary: "Maintainers: open this review in Visonaut." 403 page: "Only maintainers of ariakit/ariakit can open reviews. You do not need to do anything."
  - A read-only summary for the author: counts and item names, no verdict controls (Redesign idea A2). This changes the access contract.
  - Do not make a session for a person without write access. Check the permission in the OAuth callback and end the flow with the "no access" page. I did not verify how better-auth supports this.
- Maintainer decision needed: yes. Is a read-only view for a signed-in person without write access allowed, and if yes, with which data? If no, may the service refuse the session at sign-in?

### JOUR-05 · The page behind the Details link contradicts the check in three states

- Kind: bug
- Severity: medium. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `apps/web/src/api/review.ts:773-777`:

    ```ts
    let state = "pending";
    if (run?.state === "failed") state = "failed";
    else if (run && run.sealedAt !== null) state = "ready";
    else if (current?.state === "failed") state = "failed";
    else if (current?.docsOnly) state = "not-required";
    ```

  - `docs_only` is never 1 in new rows. Each writer sets `docsOnly: false` or `0`: `apps/web/src/api/pre-run-candidates.ts:38`, `:99`, `:128`, `:197`; `apps/web/src/api/pre-run-attempts.ts:753`, `:822`, and `:667` (`…,pull_request_number,0,?,check_head_sha,…`).
  - A check that needs no capture has `plan_visual_required = 0` and `state = 'docs_complete'` (`apps/web/src/api/pre-run-plan.ts:190-195`). Both values are not read by `/api/pulls` (`apps/web/src/api/review.ts:744`).
  - The mirror operation uses the correct rule: `apps/web/src/operations/review-links.ts:97-103`: `candidate.state === "docs_complete" && candidate.visualRequired === 0 && candidate.planJobId && candidate.planWorkflowSha`.
  - The test reaches `not-required` only with a manual update: `apps/web/src/api/api.test.ts:752-761`: `UPDATE pre_run_checks SET workflow_run_id=NULL,workflow_attempt=NULL,docs_only=1 …`.
  - A superseded check row gets `state='failed'`: `apps/web/src/api/pre-run-attempts.ts:83-91` and `:631-636`.
  - The Details URL of these checks stays the pull URL, because their PATCH sends no `details_url` (`apps/web/src/api/pre-run-plan.ts:178-188`, `apps/web/src/api/pre-run-attempts.ts:110-118`, `:646-656`, `:1019-1026`).
- What happens:

  | Check on GitHub                                              | `/api/pulls` state | Text on the pull page                                                                                                                 |
  | ------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
  | Green: "Visual capture is not required" (P3)                 | `pending`          | "Waiting for screenshots. The visual capture has not reached Visonaut yet. This page updates automatically when the review is ready." |
  | Red: "Visual capture was superseded" (P5, P6), no sealed run | `failed`           | "Visual capture failed. No review is ready. Open the pull request on GitHub to inspect the failing check." with "Check again"         |
  | Neutral: "Equivalent merge check retired" (P8, legacy)       | `pending`          | "Waiting for screenshots." (if the person edits the URL; the Details URL of P8 is the run)                                            |

- Impact: A person who opens the Details link of a green check is told to wait for screenshots that will never come. The page polls every 15 s without an end (PULL-05). A person who opens a superseded check is told that the capture failed and that a failing check exists. The correct text "No visual review needed." is unreachable with current data.
- Recommendation: Derive the page state from the same columns as the check text.

  ```ts
  // apps/web/src/api/review.ts (sketch)
  const notRequired =
    current.docsOnly || (current.state === "docs_complete" && current.planVisualRequired === 0);
  const superseded = current.state === "failed" && newerCheckExists; // same tested_sha with a higher generation, or a newer source_sha
  ```

  Add `plan_visual_required` to the SELECT at `:744`. Return a `superseded` state with the newest check of the pull request (PULL-06).

- Alternatives:
  - Minimal: add `OR plan_visual_required = 0` to the `not-required` branch.
  - Send a `details_url` with the "not required" PATCH that points to the pull request on GitHub, so that the Details link of a green check does not open the app.
  - Remove the `not-required` state and the `docs_only` column in a later cleanup, when no reader needs them.
- Maintainer decision needed: no.

### JOUR-06 · After the last decision the app says "Check passed" before GitHub has the result, never confirms it, and has no link back

- Kind: ux
- Severity: high. Confidence: high. Measured: yes. Effort: M
- Evidence:
  - `apps/web/src/review/use-review-session.ts:63-64`: `case "passed": return "Check passed";`. The value comes from the receipt: `apps/web/src/review/navigation.ts:136`: `run: { ...model.run, status: result.runStatus },`.
  - The receipt is written before the GitHub write starts: `apps/web/src/operations/review-queue.ts:119-128` (review, status, then `completeWork`), and only then `apps/web/src/api/review.ts:660-661` sends the queue message.
  - Measurement M-1: "Saved." appeared 672 to 677 ms after the click, and the status text was "Check passed" when read right after. After the receipt the page sent 0 requests in 6 seconds.
  - Measurement M-2: 0 links to `github.com` in the workspace, before and after the last decision.
  - `apps/web/src/api/review.ts:274-275`, `:557-562`: the server knows the pull request number. It sends the repository as a field and the number only inside the title text: `` title: `#${pullRequestNumber} · ${…}` ``.
  - `apps/web/src/review/review-workspace.tsx:586-593` (title), `:611-614` (commit): plain text.
  - Screens: `screens/jour-07-run-last-decision-after-check-passed--desktop-dark.png`, `--desktop-light.png`, `--mobile-dark.png`, `--mobile-light.png`.
  - J3 in M4: 6 stages and 4 timers lie between the click and a green check. `docs/evidence/checks-7710/README.md:43` records 21.5 s and 33.4 s between the approval commit and the success intent for an older code path.
- What happens: The maintainer approves the last variant. In less than a second the page says "Check passed" in small gray text. The maintainer goes back to GitHub by hand (browser history or a new tab) and can find the check still red, because the queue message, the operations pass, and the PATCH have not run yet. If the delivery fails, the page never says so. The alert appears on another page (OPS-01).
- Impact: The last step of each review is a manual search for the pull request and a wait with no feedback. "Check passed" next to a red check on GitHub makes the maintainer doubt the tool, or reload GitHub several times. This is one concrete part of the complaint about waiting.
- Recommendation:
  1. Rename the label to the run state: "All changes approved". Do not use the word "check" for a state that the app did not read from the check.
  2. Add the pull request number and the head commit as fields of the model, and render them as links (Redesign idea A5).
  3. Show a completion card (WORK-15) with the delivery state of the check and a button "Open #5300 on GitHub" (Redesign idea A4). The card needs a small read, for example a `check` object in `GET /api/runs/:id/state`:

     ```ts
     // sketch: read from work_checks and work_status_outbox for the check of this run
     check: { state: "queued" | "delivered" | "attention"; conclusion: "success" | "failure" | "pending"; deliveredAt?: number }
     ```

- Alternatives:
  - Minimal: links only. Make the title a link to the pull request and the commit a link to the commit. No new API field is needed if the client reads the number from the title, but a field is cleaner.
  - Deliver the status inline in `waitUntil` after the decision (OPS-11, first alternative). The receipt can then carry the real check result, and the card needs no poll.
  - Navigate back to the pull request on GitHub after the last decision, with an Undo option. This is fast for one pull request and wrong for a maintainer who works through the queue.
- Maintainer decision needed: yes. After the last decision, where should the maintainer go: stay, next run in the queue, or back to the pull request? (The same question as WORK-15, with the GitHub option added.)

### JOUR-07 · An obsolete attempt is a red failure, and its Details link ends at a page with no way forward

- Kind: ux
- Severity: medium. Confidence: medium (high for the code, low for how GitHub lists the check runs). Measured: no. Effort: M
- Evidence:
  - `apps/web/src/api/pre-run-attempts.ts:226-229`, `:301-304`, `:646-656`: three "superseded" outputs, each with `conclusion: "failure"`.
  - `apps/web/src/api/pre-run-attempts.ts:663-685`: a rerun adds a second check run with the name `Visonaut` on the same commit.
  - `packages/service/src/run-status.ts:95-97`: a superseded run cannot publish. Its last output stays (R8).
  - `apps/web/src/review/review-workspace.tsx:136-137`: "A newer attempt replaced this comparison. Its evidence cannot be reviewed." No link follows. `:987`: the only button is "Recompare now" (WORK-18).
  - `apps/web/src/review/use-review-session.ts:185-186`: no poll unless a comparison is pending, so an open tab does not learn about a new push.
  - `packages/service/src/database.ts:65`: the first sign for the reviewer is a 409 with "State changed. Refresh the comparison before trying again."
  - Screenshot from another lane: `ui-workspace/screens/53-terminal-superseded-dark-1440.png`.
  - `apps/lab/docs/primitives.md:2287-2311` already has the target pattern as a recipe: "A newer run replaced this one", "Decisions here do not change the check.", link "Open run 3".
- What happens: See J4. After a rerun or a push, the old attempt shows a red "Visual capture was superseded" or keeps its old red text. The person who opens it reaches a read-only page that names no successor. A reviewer with an open tab works on a dead run until a decision fails.
- Impact: Red marks for states that need no action. Lost review time on a dead run. Three dead ends for old links (J4).
- Recommendation:
  1. Tell the open tab. Add the newest run of the same pull request to `GET /api/runs/:id/state`, and poll that endpoint at a low rate while the tab is visible.
  2. Show a banner with a link to the current run in the superseded state and in the pull page (Redesign idea A6, PULL-06).
  3. Use a title that does not read as an error, for example "Replaced by a newer attempt", and decide the conclusion.
- Alternatives:
  - Minimal: banner and link only, no poll.
  - Redirect an old `/runs/<id>` to the newest run of the pull request, with a note "You opened an older attempt". The old evidence then needs its own link.
  - Use the conclusion `cancelled` or `neutral` for superseded checks. Risk: `neutral` counts as passed for a required check. Verify how GitHub treats two check runs with one name before any change.
- Maintainer decision needed: yes. Which conclusion should a superseded attempt have? Please verify on a test repository which of two same-name check runs GitHub shows and requires.

### JOUR-08 · From the push to the start of Submit, and after a capture job fails, the pull request has no Visonaut check

- Kind: ux
- Severity: medium. Confidence: medium. Measured: no. Effort: M
- Evidence:
  - `apps/web/src/api/webhooks.ts:325-328`: the `pull_request` webhook calls `recordPreRunCandidate`. `apps/web/src/api/pre-run-checks.ts:590-604`: this stores the row with `createCheck: false`.
  - `apps/web/src/api/pre-run-attempts.ts:971`: on a `workflow_run` webhook, `if (!candidate.check_id) return;`.
  - The only callers that create the check: `apps/web/src/api/pre-run.ts:132` (Plan report with `app=false`) and `apps/web/src/api/workflow-owned.ts:317`, `:1226` (Submit).
  - `/Users/diegohaz/Developer/ariakit/.github/workflows/app.yml:156`: capture jobs have `timeout-minutes: 120`. `:224-226`: Submit `needs: visual`.
  - `docs/current-contract.md:236`: "The required `Visonaut` check from App `5028451` remains beside `Gate`".
  - `apps/web/src/api/pre-run.ts:30`: "Keep this path for checks created after a signed submit is verified." The late creation is a design choice.
- What happens: After a push, the required check does not exist until the capture jobs end and Submit starts. If a capture job fails, Submit does not start, and Visonaut never writes a check for this attempt. Assumption: GitHub shows a required check with no run as "Expected. Waiting for status to be reported".
- Impact: For the whole capture time, the pull request page has no Visonaut text. The person cannot tell "Visonaut waits for CI" from "Visonaut is down". After a failed capture the required check stays absent. The failing CI job is visible, so the cause can be found, but the Visonaut line gives no hint.
- Recommendation: Decide if the service may create the check when the workflow starts, with a text that claims nothing: title "Waiting for the capture jobs", summary "Visonaut starts when `App / Visual Submit` runs." This touches the trust rules of capture and Submit, which are out of scope for this lane.
- Alternatives:
  - Keep the design and state it in the contributor guide: "The Visonaut check appears when Visual Submit starts."
  - Create the check on the `workflow_run` webhook with action `requested`, and complete it as `failure` with "Visual capture did not complete" when the workflow ends with no Submit. The second half already exists for checks that were created (`apps/web/src/api/pre-run-attempts.ts:1011-1026`).
- Maintainer decision needed: yes. May a check exist before a signed call, as a pure progress sign?

### JOUR-09 · A run on main or in the merge queue that needs review reaches no person

- Kind: ux
- Severity: medium. Confidence: medium. Measured: no. Effort: M
- Evidence:
  - `apps/web/src/api/pre-run-checks.ts:508-514`: for main and merge queue checks the first Details URL is `context.configuration.origin`, the dashboard.
  - `packages/service/src/run-status.ts:98-105`: main `needs-review` is `failure`. Merge queue `needs-review` is `pending`.
  - `docs/review-guide.md:9`: "No external notifications are sent. Open the dashboard to check service health." The same holds for runs: I found no code that sends a message to a person (a search for `issues/` and `/comments` in `apps/web/src` and `packages/security/src` finds no GitHub comment call).
  - The run list does not update by itself (DASH-19).
  - `README.md:42`: "A full main run promotes a baseline only when all acceptance conditions pass."
- What happens: See J5. A main run that needs review puts a red mark on a main commit. A merge queue run that needs review shows "Visual review is running". In both cases the only people who learn about it are those who look at the commit list or open the Visonaut queue.
- Impact: A main run can wait for a long time. While it waits, the baseline does not move. Assumption: later pull requests then compare against the older baseline and show the same change again. A merge queue entry can time out with no visible reason.
- Recommendation: Make the queue the place that shows these two cases first, with their own labels ("Main: baseline waits for review", "Merge queue: waits for review"), and give the check a title that says so (JOUR-01, JOUR-02). Use the run URL as the Details URL from the first write when a run exists.
- Alternatives:
  - A pull request comment on the merged pull request when its main run needs review (needs the comment permission, M5).
  - A browser notification or a title badge while the dashboard is open (cited idea: SHELL C9).
  - Minimal: sort main and merge queue runs to the top of the queue and add the text.
- Maintainer decision needed: yes. Should the service notify a person outside the app, and through which channel?

### JOUR-10 · The sign-in step does not name the target and exists in three texts. The return to a deep link works

- Kind: ux
- Severity: medium. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - Run route: "Sign in to review this run", "This review is available to Ariakit maintainers." (`apps/web/src/routes/runs.$runId.tsx:227-230`). Pull route: "Sign in to review pull request #7", "Compare screenshots and approve expected changes. Use a GitHub account with write access to this repository." (`apps/web/src/routes/pulls.$pullNumber.tsx:186-192`). Dashboard: "Every change. A clear decision." (`apps/web/src/routes/index.tsx:293-294`). Measurement M-3 printed the three headings.
  - Check summary: "Sign in with GitHub if prompted." (`packages/security/src/checks.ts:44`).
  - The run route cannot name the pull request: the 401 answer has no data, and the URL has only the run ID.
  - Measurement M-2: the sign-in request keeps the deep link: `"callbackURL":"/runs/run-42?item=menu%2Fopen&variant=Menu-dark"` (`apps/web/src/routes/runs.$runId.tsx:169-178`). After the return the page sends 1 API request and selects "Open menu" and "Menu-dark".
  - `packages/security/src/auth.ts:42-46`: 7 day session, renewed after 1 day of use. `packages/security/src/authorization.ts:49-54`: the permission cache key contains the session ID.
  - Screens: `screens/jour-02-run-guest-deep-link--*.png`, `screens/jour-03-run-guest-deep-link-opening-github--*.png`, `screens/jour-04-run-return-to-deep-link-after-sign-in--*.png`.
  - Earlier lanes: DASH-15 (marketing page), SHELL-14 and PULL-18 (three designs), DASH-16 (account switch).
- What happens: A maintainer who has not used the app for 7 days clicks the check and sees "Sign in to review this run". Which run? The card does not say. After one click and the GitHub round trip, the app loads a second time and the link target is restored. The round trip costs 2 document loads and 4 API requests (J1).
- Impact: The step is correct but anonymous and slow. The three texts tell three different stories about who may sign in ("Ariakit maintainers", "write access to this repository", none).
- Recommendation: One sign-in card for all routes that names the target and the rule: "Sign in to review #5300" and "Needs write access to ariakit/ariakit" (Redesign idea A3). To name the target on the run route, put the pull request number in the path of the Details URL, for example `/pulls/5300/runs/<id>`. The URL validator accepts only `/runs/<id>` today (`packages/security/src/checks.ts:32`).
- Alternatives:
  - Minimal: align the three texts, and say "this review" where the number is unknown.
  - Skip the card: send a signed-out visitor to GitHub at once and return to the same URL (DASH-15, alternative 2).
  - Let the 401 answer carry the repository and the pull request number for a valid run ID. The run ID is public in the check URL, so the gain for an attacker is small, but it is a read without a session.
- Maintainer decision needed: yes. May the Details URL contain the pull request number, or may a 401 answer name the pull request?

### JOUR-11 · The run route shows the sign-in card only if the 401 body has `error.message`

- Kind: bug
- Severity: low. Confidence: high. Measured: yes. Effort: S
- Evidence:
  - `apps/web/src/review/client.ts:269-273`: `const error = record(data.error);` and then `string(error.message)`. `string` throws a plain `Error` for a missing field (`:22-27`). The 401 branch of the loader then does not match (`apps/web/src/routes/runs.$runId.tsx:42-44`).
  - The pull route and the dashboard read only the status code (`apps/web/src/routes/pulls.$pullNumber.tsx:59-62`, `apps/web/src/routes/index.tsx:185-188`).
  - Measurement M-3:

    ```
    {"route":"run","body":"with error.message","heading":"Sign in to review this run","signIn":1}
    {"route":"run","body":"without error.message","heading":"This run could not be opened","signIn":0}
    {"route":"pull","body":"without error.message","heading":"Sign in to review pull request #7","signIn":1}
    {"route":"dashboard","body":"without error.message","heading":"Every change. A clear decision.","signIn":1}
    ```

- What happens: With the current server each 401 has a message, so the card appears. A 401 from another layer, or a later change of the error shape, turns the sign-in step of the run route into "This run could not be opened" with "Retry".
- Impact: None today. The run route is the main entry from GitHub, so a small server change can break the sign-in of each maintainer.
- Recommendation: Read the status first, then the body.

  ```ts
  // apps/web/src/review/client.ts (sketch)
  if (!response.ok) {
    const error = isRecord(result) && isRecord(result.error) ? result.error : {};
    const message = typeof error.message === "string" ? error.message : "The request failed.";
    throw new ReviewCommandError(message, {
      status: response.status,
      conflict: response.status === 409,
    });
  }
  ```

- Alternatives: Keep the strict parser and add a test that pins the 401 shape of `requireMaintainer`.
- Maintainer decision needed: no.

### JOUR-12 · The documents for people outside the app describe a flow that the author cannot follow, and do not explain the check states

- Kind: copy
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `/Users/diegohaz/Developer/ariakit/contributing.md:578`: "open the linked review and ask a maintainer". The author cannot open it (JOUR-04).
  - `/Users/diegohaz/Developer/ariakit/contributing.md:582`: "The separate required Visonaut check blocks merging until visual review passes." It does not say that the check is red while it waits.
  - `README.md:13`: "Open the review link from the GitHub check and sign in with GitHub. Access requires current write permission".
  - No document names a check title. A search for "Visual review has not passed", "Visual review is running", "Visual capture was superseded", and "Checking visual coverage" in `docs/`, `README.md`, `.github/workflows/README.md`, `packages/security/README.md`, and the Ariakit `contributing.md` finds no match.
  - `README.md:35` names "`visonaut@0.5.3` and `@visonaut/playwright@0.4.0`". `docs/current-contract.md:22` names `0.5.4` and `0.5.0`.
- What happens: The only text for an author is one paragraph in another repository. No document lists the check titles or says which of them need an action and by whom.
- Impact: Each new contributor must ask what the red check means.
- Recommendation: Put the meaning into the check itself (JOUR-01, JOUR-03), then shorten the guide to two sentences: "A red or yellow Visonaut check means that a maintainer must review screenshots. You do not need to do anything."
- Alternatives: Add a table of the check states to `docs/review-guide.md` and link it from the check summary.
- Maintainer decision needed: no.

### JOUR-13 · The name "Open Visonaut review" is not written any more. A pull request can still have two check runs with the name "Visonaut"

- Kind: dead-code
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - `packages/security/src/checks.ts:5`: `export const REVIEW_LINK_CHECK_NAME = "Open Visonaut review";`
  - Uses: `apps/web/src/operations/review-links.ts:251-256` (find an old check), `:355` (accept the old name). Both writes use the other name: `:278` and `:372` have `name: CHECK_NAME`.
  - `apps/web/src/operations/review-links.ts:173-174`: `// New attempts publish directly on the PR head; old merge checks keep their mirror.` and `if (candidate.checkHeadSha === candidate.sourceSha) continue;`
  - New pull request rows get `check_head_sha = source_sha` (`apps/web/src/api/pre-run-checks.ts:628-646`).
  - `docs/evidence/checks-7710/README.md:5-16` records the older state: "Two checks for one review".
  - A rerun still adds a second run with the same name (JOUR-07).
- What happens: The lane brief asked to verify "two checks with similar names on one pull request". For new attempts this is not the case. The second name only lets the service find and rename checks of the older design. The step is still named `review-links` and still runs in each status pass (OPS-13 covers the cost).
- Impact: Small. A reader of the code expects a second check that does not exist. The step, its cursor, and its alert kind keep the old word (`apps/web/src/operations/index.ts:50`, `:82-87`).
- Recommendation: When no legacy row remains, remove the constant, the lookup, and the mirror step. Until then, rename the constant to `LEGACY_REVIEW_LINK_CHECK_NAME` and say so in a comment.
- Alternatives: Keep it as it is and add one line to `apps/web/src/operations/README.md`.
- Maintainer decision needed: no.

### JOUR-14 · The texts use "review" for machine stages and workflow terms for people

- Kind: copy
- Severity: low. Confidence: high. Measured: no. Effort: S
- Evidence:
  - "Visual review is running" for the upload and the comparison (R1, R2). No review runs.
  - "Visual review passed" for a run with no changed screenshot. No review happened.
  - "The successful trusted Plan selected app=false for this attempt." (`apps/web/src/api/pre-run-plan.ts:186`).
  - "The trusted Plan or signed Submit is missing. Missing Plan never means no visual work." (`apps/web/src/api/pre-run-attempts.ts:1013`).
  - "A pinned capture or submit job did not complete successfully." (`:1015`), "The pinned capture workflow ended with …" (`:1018`).
  - "Checking visual coverage", "Visonaut is verifying this commit." (`apps/web/src/api/pre-run-checks.ts:517-518`). "Coverage" appears in no other text of the product.
  - The app uses other words for the same states: "Waiting for screenshots", "Comparing images" (`apps/web/src/routes/index.tsx:133-134`).
- What happens: The reader of the check must know the words Plan, Submit, pinned, trusted, attempt, and `app=false`. These are terms of the CI design, not of the task.
- Impact: The texts are correct and hard to act on. Check and app use different words for one state.
- Recommendation: One word list for check and app. Examples: "No visual changes to check" with "This pull request does not touch files that need screenshots." for P3. "Capture failed" with "The job `App / Visual Capture (linux)` did not finish. Open the CI run and rerun all jobs." and a link to the workflow run for P4.
- Alternatives: Keep the precise terms in `output.text` for maintainers, and write the plain sentence in the summary.
- Maintainer decision needed: no.

## Measurements (command, raw result, limits)

All measurements ran in Chrome through Playwright against the route fixture on port 4311. Each `/api/*` answer was a `page.route` mock with no added delay. No request left `127.0.0.1`.

### M-1. Client timers after the last decision

Command: `node /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-github-journey/measure-last-decision.mjs`. Raw output: `measure-last-decision-output.json`.

| Run | Receipt polls that answer "queued" | `POST …/commands` (request clock) | `GET …/queued` (request clock) | "queued on server" text (page clock) | "Saved." text (page clock) | Requests in the next 6 s |
| --- | ---------------------------------- | --------------------------------- | ------------------------------ | ------------------------------------ | -------------------------- | ------------------------ |
| 1   | 0                                  | 131 ms                            | 634 ms                         | 119 ms                               | 676 ms                     | 0                        |
| 2   | 0                                  | 138 ms                            | 642 ms                         | 126 ms                               | 677 ms                     | 0                        |
| 3   | 0                                  | 120 ms                            | 623 ms                         | 121 ms                               | 672 ms                     | 0                        |
| 4   | 2                                  | 195 ms                            | 699 ms, 1202 ms, 1705 ms       | 158 ms                               | 1714 ms                    | 0                        |

The request clock starts in Node before Playwright sends the click. The page clock starts at the click event in the page, and a `MutationObserver` records the texts. The two zero points differ by 12 to 37 ms in these runs. In each run the first receipt read came 502 to 504 ms after the command request, and each later read 503 ms after the read before it. The status text after the receipt was "Check passed" in each run.

Limits: instant API answers, one machine, 4 runs. The numbers show the client timer (500 ms) and the render cost, not production latency. The first decision of a page also sends `POST /api/review-sessions`, which is included.

### M-2. Deep link through sign-in, and links to GitHub

Command: `node /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-github-journey/capture.mjs`, then `node /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-github-journey/print-log.mjs`. Raw output: `capture-log.json` (28 entries, 0 failed). Result for the desktop dark pass:

```
jour-03-run-guest-deep-link-opening-github
  "signInBody": { "provider": "github", "callbackURL": "/runs/run-42?item=menu%2Fopen&variant=Menu-dark" }
jour-04-run-return-to-deep-link-after-sign-in
  "requests": ["GET /api/runs/run-42"], "heading": "Open menu",
  "currentLinks": ["Open menu\n2 of 2 need review", "Chromium\nLight\nMenu-dark · 1280 × 720\n2\n…"],
  "githubLinks": 0
jour-07-run-last-decision-after-check-passed
  "requests": ["GET /api/runs/run-42", "POST /api/review-sessions", "POST /api/comparisons/comparison-2/commands", "GET /api/commands/<id>/queued"],
  "saveState": "1 variant approved. Saved.", "progress": "0 of 11 need review", "githubLinks": 0,
  "liveRegions": ["1 variant approved. Saved.", "Review complete. No variants need review."]
```

Limits: the fixture uses a memory history, so the address bar is not part of the test. The real OAuth round trip was not run. The return was simulated by loading the callback URL with a 200 answer.

### M-3. Which 401 answers lead to the sign-in card

Command: `node /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-github-journey/measure-401-shape.mjs`. Raw output: `measure-401-shape-output.txt`.

```
{"route":"dashboard","body":"with error.message","heading":"Every change. A clear decision.","signIn":1}
{"route":"dashboard","body":"without error.message","heading":"Every change. A clear decision.","signIn":1}
{"route":"dashboard","body":"empty object","heading":"Every change. A clear decision.","signIn":1}
{"route":"run","body":"with error.message","heading":"Sign in to review this run","signIn":1}
{"route":"run","body":"without error.message","heading":"This run could not be opened","signIn":0}
{"route":"run","body":"empty object","heading":"This run could not be opened","signIn":0}
{"route":"pull","body":"with error.message","heading":"Sign in to review pull request #7","signIn":1}
{"route":"pull","body":"without error.message","heading":"Sign in to review pull request #7","signIn":1}
{"route":"pull","body":"empty object","heading":"Sign in to review pull request #7","signIn":1}
```

### M-4. Count of check titles

Command: `node /Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-github-journey/check-states.mjs --html`. Raw output: `check-states-output.txt`.

```
Shared title and conclusion:
- Visual capture was superseded / failure: P5, P6, P7 (1 different actions)
- Visual review is running / in_progress: R1, R2, R3b, R7 (3 different actions)
- Visual review has not passed / failure: R3a, R4, R5 (3 different actions)

Distinct titles: 9
```

Limits: the rows are a manual transcription of the code. The script counts them. It does not read the source files.

### M-5. Search of the documents for check titles

Command: `rg -n -c "Visual review has not passed|Visual review is running|Visual capture was superseded|Checking visual coverage"` over `docs`, `README.md`, `.github/workflows/README.md`, `packages/security/README.md`, and `/Users/diegohaz/Developer/ariakit/contributing.md` with `--glob '*.md'`. Raw result: no output, exit code 1 (no match).

### Counts from code (not measured)

- GitHub requests for one check update: 1 GET and 1 PATCH (`packages/security/src/checks.ts:173`, `:191`), and 1 token request on a new isolate.
- Requests of the signed-out journey: 2 documents and 4 API requests in the app (J1).
- Stages and timers after the last decision: 6 and 4 (J3).

## Screenshots

All files are in `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-github-journey/screens/`. Each state has four files with the endings `--desktop-dark.png`, `--desktop-light.png` (1440 x 900), `--mobile-dark.png`, `--mobile-light.png` (390 x 844). I read all 30 images.

| File name (without the ending)                                                  | Caption                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `jour-01-run-forbidden-signed-in-no-write-access`                               | Run page for a signed-in person without write access. "This run could not be opened", one sentence, "Retry". No account menu, no link to the pull request.                                                                     |
| `jour-02-run-guest-deep-link`                                                   | Run page for a signed-out person who opened `/runs/run-42?item=menu%2Fopen&variant=Menu-dark`. "Sign in to review this run". The card does not name the pull request or the item.                                              |
| `jour-03-run-guest-deep-link-opening-github`                                    | The same card after the click. The button reads "Opening GitHub…".                                                                                                                                                             |
| `jour-04-run-return-to-deep-link-after-sign-in`                                 | The workspace after the return. "Open menu" and the variant "Menu-dark" are selected. The title "#5300 · Dialog focus styles" and the commit are plain text. On 390 px the selected variant chip is cut off at the right edge. |
| `jour-05-run-last-decision-before`                                              | One variant left: "1 of 11 need review", status "Changes need review".                                                                                                                                                         |
| `jour-06-run-last-decision-queued`                                              | After the click, before the receipt: "0 of 11 need review", "1 queued on server. You can close this window.", status still "Changes need review". The selection moved to an item that needs no review.                         |
| `jour-07-run-last-decision-after-check-passed`                                  | After the receipt: "1 variant approved. Saved." and "Check passed" in small gray text. "Approve & next" is still the blue main button. No completion state, no link to GitHub.                                                 |
| `jour-08-check-output-today-simulated` (desktop dark and light only, full page) | The 16 check outputs of M2 as cards. Simulated layout, not a GitHub screenshot. Three cards say "Visual review has not passed", four say "Visual review is running".                                                           |

Screenshots of other lanes that this report uses:

| Path under `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/`                      | Caption                                                                                                    |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ui-pull-ops/screens/pull-02-guest--desktop-dark.png` (also light and mobile)      | Pull page, signed out: "Sign in to review pull request #7".                                                |
| `ui-pull-ops/screens/pull-05-forbidden--desktop-dark.png` (also light and mobile)  | Pull page, no write access: "Repository access required", "Use another account".                           |
| `ui-pull-ops/screens/pull-08-pending--desktop-dark.png`                            | Pull page, `pending`: "Waiting for screenshots." This is also what a "not required" check shows (JOUR-05). |
| `ui-pull-ops/screens/pull-09-capture-failed--desktop-dark.png`                     | Pull page, `failed`: "Visual capture failed." This is also what a superseded check shows (JOUR-05).        |
| `ui-pull-ops/screens/pull-10-not-required--desktop-dark.png`                       | Pull page, `not-required`: "No visual review needed." Current data cannot reach this state.                |
| `ui-pull-ops/screens/pull-06-check-not-found--desktop-dark.png`                    | Pull page with an unknown check.                                                                           |
| `ui-workspace/screens/53-terminal-superseded-dark-1440.png`                        | Workspace of a superseded run: "Comparison superseded", "Recompare now", no link to the newer run.         |
| `ui-workspace/screens/45-run-passed-dark-1440.png`, `46-run-passed-light-1440.png` | Workspace of a passed run (WORK-15).                                                                       |

## Redesign ideas

The examples use the data of the lab fixtures (`apps/lab/docs/fixtures.md:57-80`): repository `ariakit/ariakit`, pull request #4831 with 79 of 600 variants to review, pull request #4863 with 2 rejected and 22 undecided variants. I checked each prop of the JSX sketches against `apps/lab/docs/primitives.md` ("Pitfalls to know first", lines 37-52, and the primitive sections). No sketch uses `$layer="primary"`, `$ink` on `Text`, or `$gap` on `Frame`. Cards use `$p="1rem"` or more, so the buttons and badges inside keep their own radius (pitfall 2). Headings have `mt-0 mb-0` and a size class (pitfalls 4 and 5).

### G1 · Check output, variant A: one line with counts

- What changes: The title carries the state and the main number. The summary has one line of counts and one link. The sentence "Sign in with GitHub if prompted." goes away.
- Why it is better: The pull request page answers "how much work is this?" with no click. Three states get three titles (JOUR-01). It needs only numbers that the status read already has, and no new permission.
- Sketch (Markdown of `output.title` and `output.summary`):

  ```md
  title: 79 changes need review

  **79 of 600 screenshots changed and need review.** 506 unchanged · 15 new or removed, accepted automatically.

  Maintainers: [review 79 changes](https://visonaut.com/runs/RUN_ID) · Attempt 1 of `4f1c9e0`
  ```

  ```md
  title: 2 changes rejected

  **A maintainer rejected 2 changes.** 22 more need review · 3 approved.

  The author can push a fix. Maintainers: [open the review](https://visonaut.com/runs/RUN_ID)
  ```

  ```md
  title: No visual changes

  **600 screenshots match the baseline.**
  ```

### G2 · Check output, variant B: a table of changed items with direct links

- What changes: `output.text` (the long part of a check run) lists the changed items, largest first, each with a link to that item in the review. The summary stays as in G1.
- Why it is better: A maintainer can judge the change from GitHub ("only Dialog and Menu changed") and can open the one item that matters. Argos and Chromatic show counts only. This goes one step further.
- Needs: item names in a public check (decision of JOUR-03), a link format with a query (`/runs/<id>?item=…&variant=…` works in the app today, measured in M-2; only the Details URL validator forbids a query), and a cap on the row count.
- Sketch (Markdown of `output.text`):

  ```md
  ### 79 changes in 12 items

  | Item                                                                                 | Changed | Needs review | Largest change |
  | ------------------------------------------------------------------------------------ | ------: | -----------: | -------------: |
  | [Dialog · focus · open](https://visonaut.com/runs/RUN_ID?item=dialog%2Ffocus%2Fopen) |      14 |           14 |           3.2% |
  | [Menu · open](https://visonaut.com/runs/RUN_ID?item=menu%2Fopen)                     |       9 |            9 |           0.8% |
  | [Combobox · popover](https://visonaut.com/runs/RUN_ID?item=combobox%2Fpopover)       |       6 |            4 |          0.05% |
  | 9 more items                                                                         |      50 |           52 |                |

  506 unchanged. 15 new or removed screenshots were accepted automatically.
  ```

### G3 · Check output, variant C: a version for the pull request author

- What changes: The summary speaks to the author first, in plain words, and says who acts next. The maintainer link is the last line.
- Why it is better: It removes the dead end of J2 at its source. The author learns that the red or yellow mark is normal, and what to do in each of the three states.
- Sketch (Markdown of `output.summary`, one for each state):

  ```md
  title: 79 changes need review

  **This pull request changes 79 screenshots.** A maintainer must look at them before this check can pass. You do not need to do anything now.

  - If the changes are intended, wait for the review.
  - If they are not intended, push a fix. Each push starts a new capture.

  Maintainers: [review in Visonaut](https://visonaut.com/runs/RUN_ID) (needs write access to ariakit/ariakit).
  ```

  ```md
  title: 2 changes rejected

  **A maintainer rejected 2 screenshot changes.** Push a fix to start a new capture, or ask the maintainer in a comment.

  Maintainers: [open the review](https://visonaut.com/runs/RUN_ID).
  ```

  ```md
  title: Capture failed

  **Visonaut did not get the screenshots of this commit.** The job `App / Visual Capture (linux)` did not finish.

  [Open the CI run](https://github.com/ariakit/ariakit/actions/runs/WORKFLOW_RUN_ID) and choose "Re-run all jobs".
  ```

### G4 · Titles and conclusions for each state

- What changes: One table is the source for the check and the app. Each state has one title and one color.
- Why it is better: It ends the three groups of M2 and the two word lists (JOUR-14).
- Sketch:

  ```
  state              title on GitHub                    conclusion today   options
  -----------------  ---------------------------------  -----------------  ---------------------------------
  (workflow started) Waiting for the capture jobs       no check           in_progress (JOUR-08)
  verification       Receiving screenshots              in_progress        same
  comparing          Comparing 600 screenshots          in_progress        same
  needs-review       79 changes need review             failure            failure | action_required | in_progress
  needs-review (mq)  Waiting for review: 79 changes     in_progress        same
  rejected           2 changes rejected                 failure            same
  failed             Capture failed / Comparison failed failure            same
  passed, changes    81 changes approved                success            same
  passed, no change  No visual changes                  success            same
  not required       No screenshots to check            success            same
  needs-recompare    A new capture is needed            in_progress        failure (JOUR-02)
  superseded         Replaced by a newer attempt        failure            failure | cancelled (JOUR-07)
  ```

### G5 · One pull request comment that is edited in place

- What changes: The App posts one comment on the pull request when the first run is ready, and edits it on each status change. The check stays as the merge gate.
- Why it is better: A comment is in the conversation, where the author and the reviewers already read. It can hold a table and, if allowed, thumbnails. It is the pattern of Argos and Chromatic (M5).
- Cost: a new App permission and its approval, one more outbox with the same delivery rules as the check, and a decision on public content (JOUR-03).
- Sketch (Markdown of the comment):

  ```md
  ### Visonaut · 79 changes need review

  | Attempt | Commit    | Result                                        | Review                                   |
  | ------- | --------- | --------------------------------------------- | ---------------------------------------- |
  | 1       | `4f1c9e0` | 79 need review · 506 unchanged · 15 automatic | [Open](https://visonaut.com/runs/RUN_ID) |

  A maintainer reviews these changes. Updated 15:30 UTC.
  ```

### A1 · A page for a signed-in person without write access

- What changes: One page replaces "This run could not be opened" and "Repository access required". It names the account, says that the result is normal, says who acts, and links back to the pull request. "Use another account" is the second action.
- Why it is better: The author gets an answer in place of an error (JOUR-04). The maintainer who used the wrong account sees which account was refused (DASH-16, DASH-17).
- Open question for the maintainer: May this page show the count of changes to a person without write access? The sketch has the count in one sentence. Remove that sentence if the answer is no.
- Lab data: `useSignIn("forbidden")` gives `user`, `repository`, `message`, and `switchAccount()` (`apps/lab/docs/fixtures.md:566-605`).
- Sketch:

  ```tsx
  <Frame
    $lighten
    $border
    $rounded="2xl"
    $p="1.5rem"
    render={<section aria-labelledby="no-access-title" />}
    className="grid w-full max-w-md gap-4"
  >
    <Badge $layer="secondary" className="justify-self-start">
      <BadgeSlot $kind="avatar" $layer="brand">
        OC
      </BadgeSlot>
      <BadgeLabel>Signed in as @octocat</BadgeLabel>
    </Badge>
    <Heading id="no-access-title" className="mt-0 mb-0 text-xl">
      Maintainers review #4831
    </Heading>
    <Text render={<p />} className="ak-ink-70 text-sm">
      This account has no write access to ariakit/ariakit, so it cannot open the review. You do not
      need to do anything. A maintainer looks at the 79 changed screenshots.
    </Text>
    <div className="flex flex-wrap gap-2">
      <Button $layer="brand" render={<a href="https://github.com/ariakit/ariakit/pull/4831" />}>
        <ButtonLabel>Back to #4831</ButtonLabel>
        <ButtonSlot>
          <ArrowUpRight />
        </ButtonSlot>
      </Button>
      <Button $border onClick={signIn.switchAccount}>
        <ButtonLabel>Use another account</ButtonLabel>
      </Button>
    </div>
  </Frame>
  ```

### A2 · A read-only summary for the author (only if the access contract allows it)

- What changes: A person without write access sees the run as a list: item names, counts, and the state of each item. No verdict buttons, no reviewer names. Images are a second decision.
- Why it is better: The author can answer "did I mean to change the Dialog?" alone, and can fix an accident before a maintainer spends time.
- Sketch:

  ```
  ┌──────────────────────────────────────────────────────────────┐
  │ visonaut · ariakit/ariakit                     @octocat  ▾   │
  ├──────────────────────────────────────────────────────────────┤
  │ #4831 Add the combobox select            [ Needs review ]    │
  │ 79 of 600 screenshots changed · attempt 1 · 4f1c9e0          │
  │ A maintainer reviews these changes.   [ Back to #4831 ↗ ]    │
  ├──────────────────────────────────────────────────────────────┤
  │ Item                     Changed   State                     │
  │ Dialog · focus · open       14     needs review              │
  │ Menu · open                  9     needs review              │
  │ Combobox · popover           6     4 need review, 2 approved │
  │ …                                                            │
  └──────────────────────────────────────────────────────────────┘
  ```

### A3 · A sign-in step that names the target

- What changes: One card for the three routes. The heading names the target. One line names the rule and the repository. The button is the brand action. A link leads back to GitHub.
- Why it is better: The maintainer knows what the sign-in is for, and a person without access can stop before the OAuth grant (JOUR-04, JOUR-10).
- Lab data: `useSignIn(scenario)` gives `status`, `repository`, and `signIn()` (`apps/lab/docs/fixtures.md:566-605`).
- Sketch:

  ```tsx
  <Frame $lighten $border $rounded="2xl" $p="1.5rem" className="grid w-full max-w-md gap-4">
    <Text className="ak-ink-60 text-sm">ariakit/ariakit</Text>
    <Heading className="mt-0 mb-0 text-xl">Sign in to review #4831</Heading>
    <Text render={<p />} className="ak-ink-70 text-sm">
      Reviews need a GitHub account with write access to this repository.
    </Text>
    <Button $layer="brand" disabled={signIn.status === "signing-in"} onClick={signIn.signIn}>
      <ButtonSlot>
        <LogIn />
      </ButtonSlot>
      <ButtonLabel>
        {signIn.status === "signing-in" ? "Opening GitHub" : "Continue with GitHub"}
      </ButtonLabel>
    </Button>
    <Link href="https://github.com/ariakit/ariakit/pull/4831" className="text-sm">
      Back to the pull request
    </Link>
  </Frame>
  ```

  Variants for the lab: (a) this card, (b) no card and an automatic redirect with a one-line note "Opening GitHub to sign you in", (c) the card with the count "79 changes wait for review" if a 401 answer may carry it.

### A4 · A completion card that shows the check state and links to the pull request

- What changes: After the last decision the main area shows one card: the result of the review, the delivery state of the GitHub check, a button to the pull request, and a button to the next run. The line about the check has three states.
- Why it is better: It ends the silent finish (WORK-15) and replaces the early "Check passed" with the truth (JOUR-06). The maintainer does not need to look for the pull request.
- Sketch:

  ```tsx
  <Frame
    $layer="success"
    $mix={12}
    $border
    $edge="success"
    $rounded="xl"
    $p="1rem"
    role="status"
    className="grid w-full max-w-xl gap-4"
  >
    <div className="flex items-start gap-3">
      <Text $text="success" className="flex h-lh items-center">
        <CircleCheck className="size-[1.25em]" />
      </Text>
      <div className="grid flex-1 gap-0.5">
        <Text className="font-medium">Review complete</Text>
        <Text className="ak-ink-70 text-sm">79 approved · 15 accepted automatically</Text>
      </div>
    </div>
    <Frame
      $cover
      $darken={0.5}
      $p={3}
      className="flex flex-wrap items-center gap-3 border-t text-sm"
    >
      <span className="size-[1lh] p-0.5">
        <ProgressCircular aria-label="Updating the GitHub check" $thickness={0.75} />
      </span>
      <Text className="flex-1">Updating the check on GitHub</Text>
      <Button
        $size="sm"
        $lightnessOffset
        render={<a href="https://github.com/ariakit/ariakit/pull/4831" />}
      >
        <ButtonLabel>Open #4831</ButtonLabel>
        <ButtonSlot>
          <ArrowUpRight />
        </ButtonSlot>
      </Button>
      <Button $size="sm" $layer="brand" render={<RouterLink to="/" />}>
        <ButtonLabel>Next run</ButtonLabel>
      </Button>
    </Frame>
  </Frame>
  ```

  The three states of the check line:

  ```
  ◌  Updating the check on GitHub              (queued or sending)
  ✓  The check is green on GitHub · 4 s ago    (delivered, success)
  !  GitHub did not take the update. Service status →   (dead or ambiguous)
  ```

### A5 · Source links in the workspace header

- What changes: The pull request number and the commit are two small link buttons in the run header. They replace the plain title prefix and the plain commit text.
- Why it is better: One click to the pull request from any moment of the review (JOUR-06, DASH-13).
- Sketch:

  ```tsx
  <ButtonGroup aria-label="Source on GitHub" $size="sm">
    <Button render={<a href="https://github.com/ariakit/ariakit/pull/4831" />}>
      <ButtonSlot>
        <GitPullRequest />
      </ButtonSlot>
      <ButtonLabel>#4831</ButtonLabel>
    </Button>
    <ButtonSeparator />
    <Button render={<a href="https://github.com/ariakit/ariakit/pull/4831/commits/4f1c9e0" />}>
      <ButtonSlot>
        <GitCommitHorizontal />
      </ButtonSlot>
      <ButtonLabel>4f1c9e0</ButtonLabel>
    </Button>
  </ButtonGroup>
  ```

### A6 · A banner for an old attempt, with a link to the current run

- What changes: A superseded run, an old check on the pull page, and an open tab after a new push show the same banner. It names the newer commit and links to its run.
- Why it is better: It removes the three dead ends of J4. The recipe exists in the lab guide (`apps/lab/docs/primitives.md:2287-2311`).
- Lab data: `ReviewRun.supersededBy` in the `read-only` scenario (`apps/lab/docs/fixtures.md:77`, `:89`).
- Sketch:

  ```tsx
  <Frame
    $layer="warning"
    $mix={12}
    $border
    $edge="warning"
    $rounded="xl"
    $p={3}
    className="flex w-full items-start gap-3"
  >
    <Text $text="warning" className="flex h-lh items-center">
      <TriangleAlert className="size-[1.25em]" />
    </Text>
    <div className="grid flex-1 gap-0.5">
      <Text className="font-medium">A newer capture replaced this run</Text>
      <Text className="ak-ink-70 text-sm">
        Commit 9a2b7c1 arrived 4 minutes ago. Decisions here do not change the check.
      </Text>
    </div>
    <Link
      render={<RouterLink to="/runs/$runId" params={{ runId: "RUN_ID" }} />}
      className="text-sm"
    >
      Open the current run
    </Link>
  </Frame>
  ```

### L1 · A "GitHub check output" surface for the design lab

- What changes: The lab gets one more surface. It renders the check output for each state and each text variant (today, G1, G2, G3) in a neutral card, next to the app page that the Details link opens. A pure function `checkOutput(facts, variant)` makes the title and the Markdown from fixture data.
- Why it is better: The text on GitHub is the first screen of each journey, and no lane could look at it. With this surface the maintainer can compare the variants state by state, read the author's version and the maintainer's version, and see the mismatch between check and page (JOUR-05) in one place. The function can later move to `packages/security` unchanged, because it has no React code.
- Rules for the surface: label the card "Preview of the check text. Not a GitHub page." Do not copy GitHub's look. Show the character count, because GitHub limits the summary (assumption: 65,535 characters).
- States: the rows of M2. Fixture data: `Run` and `RunCounts` (`apps/lab/docs/fixtures.md:84-86`). A first data set exists in `check-states.mjs` in the scratch folder.
- Sketch:

  ```tsx
  <Tabs defaultSelectedId="check-needs-review" className="w-full">
    <TabList aria-label="Check state" $size="sm">
      <Tab $kind="flat" id="check-needs-review">
        <TabLabel>Needs review</TabLabel>
      </Tab>
      <Tab $kind="flat" id="check-rejected">
        <TabLabel>Rejected</TabLabel>
      </Tab>
      <Tab $kind="flat" id="check-failed">
        <TabLabel>Capture failed</TabLabel>
      </Tab>
      <Tab $kind="flat" id="check-passed">
        <TabLabel>Passed</TabLabel>
      </Tab>
      <TabGlider $kind="flat" />
    </TabList>
    <TabPanels>
      <TabPanel single>
        <CheckPreview output={checkOutput(facts, variant)} />
      </TabPanel>
    </TabPanels>
  </Tabs>
  ```

  ```tsx
  function CheckPreview({ output }: CheckPreviewProps) {
    const Icon = output.icon;
    return (
      <Frame $lighten $border $rounded="xl" $p="1rem" className="grid gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Text $text={output.color} className="flex">
            <Icon className="size-4" />
          </Text>
          <Text className="font-medium">Visonaut</Text>
          <Text className="ak-ink-60">{output.conclusionLabel}</Text>
        </div>
        <Heading className="mt-0 mb-0 text-base">{output.title}</Heading>
        <Prose $gap={3} className="text-sm">
          {output.summary}
        </Prose>
        <Frame
          $cover
          $darken={0.5}
          $p={2}
          className="flex flex-wrap items-center gap-2 border-t text-sm"
        >
          <Text className="ak-ink-60">Details</Text>
          <Code>{output.detailsPath}</Code>
          <Text className="ak-ink-60 ms-auto tabular-nums">{output.characters} characters</Text>
        </Frame>
      </Frame>
    );
  }
  ```

  `output.summary` is React content that the lab makes from the Markdown, for example a `p` and a `Table`. `output.color` is one of `"success"`, `"warning"`, `"danger"`, or `undefined`.

## Open questions and items not verified

Not verified, because this audit sent no request to GitHub:

1. Where the "Details" link of an App check run leads first: the GitHub check run page, or the Details URL. J1 and J2 assume the check run page.
2. How GitHub shows a required check that has no check run yet (JOUR-08).
3. How GitHub lists two check runs with the same name on one commit, and which of them a required check uses (JOUR-07, JOUR-13). `docs/evidence/checks-7710/README.md:16` states the rule for the merge commit and the head commit, not for two runs on one commit.
4. How GitHub renders the conclusion `action_required`, and if it blocks a required check (JOUR-01).
5. What the GitHub authorize page shows for this App, and if a person who authorized before passes it with no click (J1, J2, DASH-16).
6. What GitHub reports when a merge queue entry times out on a check that is `in_progress` (JOUR-02, JOUR-09).
7. The size limit and the Markdown support of `output.summary` and `output.text` (G1, G2, L1).

Not verified in the repository or in production:

8. No production timing after the `waitUntil` change. The only numbers are in `docs/evidence/checks-7710/README.md:43` for the older path.
9. JOUR-05 is traced from the code. I did not run the API with a row that has `plan_visual_required = 0`. The existing test covers `docs_only = 1` only.
10. How many legacy rows with `check_head_sha IS NULL` still exist in production. This decides when JOUR-13 can be cleaned up.
11. How better-auth can refuse a session for a person without write access (JOUR-04, third alternative).
12. If approvals of a pull request run carry over to the main run in all cases. JOUR-09 assumes that a main run can need review.
13. A side observation from `packages/service/src/status-touch.ts:9-24` and `apps/web/src/operations/checks.ts:200-209`: each review command raises the project revision, and the update query selects each eligible run whose last intent has another source revision. If this is right, one decision makes a GET and a PATCH for the check of each active run, not only for the reviewed run. I did not run it. It belongs to the operations track.

Questions for the maintainer (collected from the findings):

- JOUR-01: Which conclusion for a review that waits: `failure`, `action_required`, or `in_progress`?
- JOUR-02: Should `needs-recompare` become a completed check?
- JOUR-03: May the public check show counts, item names, or thumbnails?
- JOUR-04: Is a read-only view for a person without write access allowed? May the service refuse the session at sign-in?
- JOUR-06: Where should the maintainer go after the last decision?
- JOUR-07: Which conclusion for a superseded attempt?
- JOUR-08: May a check exist before a signed call?
- JOUR-09: Should the service notify a person outside the app?
- JOUR-10: May the Details URL contain the pull request number?
- G5: Is a pull request comment wanted, with the new App permission that it needs?
