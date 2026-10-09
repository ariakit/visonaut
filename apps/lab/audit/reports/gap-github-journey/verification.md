# Verification: the journey outside the app (gap-github-journey)

Verifier: adversarial second pass. Date: 2026-10-05.

## Limit of this verification (read first)

The file `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-github-journey/report.md` does not exist. I looked at 18:20 and again at 20:57. No `*.md` file is in that directory, and a search of the job directory for the finding IDs found nothing.

So I could not read the finding text, the quoted excerpts, the line ranges, or the recommendations. I verified each finding from these sources:

- The finding title in the index that the task gave me.
- The auditor's scratch evidence: `check-states.mjs` and `check-states-output.txt` (the state table with file and line sources), `capture.mjs` and `capture-log.json`, `measure-last-decision.mjs` and its output, `measure-401-shape.mjs` and its output, and the 30 screenshots in `screens/`.
- The repository source, read again from zero.

Each "Corrections" part below is written against the title and the evidence, not against the report text. Where I write "if the report recommends X", I could not see the recommendation.

All 20 source references in `check-states.mjs` (rows P1 to R8) point at code that exists and says what the row says. I checked each one.

## Platform facts that I used

| Fact                                                                                                                                              | Source                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Check conclusions: `action_required`, `cancelled`, `failure`, `neutral`, `success`, `skipped`, `stale`, `timed_out`. Only GitHub can set `stale`. | https://docs.github.com/en/rest/checks/runs                                                                           |
| "Successful check statuses are `success`, `skipped`, and `neutral`." "Required checks must pass on the latest commit SHA."                        | https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks |
| "If a check run is in an incomplete state for more than 14 days, then the check run's `conclusion` becomes `stale`."                              | https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks                                     |
| Status `expected`: "The check run is waiting for a status to be reported."                                                                        | https://docs.github.com/en/pull-requests/reference/status-checks                                                      |
| "List check runs for a Git reference": `filter` default is `latest` ("returns the most recent check runs").                                       | https://docs.github.com/en/rest/checks/runs                                                                           |
| Requested actions: "A maximum of three actions are accepted." Label 20 characters, description 40 characters.                                     | https://docs.github.com/en/rest/checks/runs                                                                           |

Facts about the consumer repository, read with `gh api` (read-only) today:

- `gh api repos/ariakit/ariakit/rules/branches/main` returns five rules: `deletion`, `non_fast_forward`, `pull_request`, `required_status_checks`, `code_scanning`. The required checks are `{"context":"Gate","integration_id":15368}` and `{"context":"Visonaut","integration_id":5028451}`. There is no `merge_queue` rule.
- `.github/workflows/ci.yml` in ariakit/ariakit starts with `on: push: branches: [main]` and `pull_request: types: [opened, synchronize, reopened]`. There is no `merge_group` trigger.
- `.github/workflows/app.yml` in ariakit/ariakit: line 225 `name: Visual Submit`, line 226 `needs: visual`, line 259 `run: visonaut submit --shard linux --shard safari`. The file has no `visonaut begin` call.

## JOUR-01

Title: A review that waits for a maintainer is a red failure, and three different states share one title.

**Verdict: confirmed.** My severity: **medium** (auditor: high). It is the most visible item in this lane, but it blocks nothing that the contract does not already block.

Proof:

- `packages/service/src/run-status.ts:98-105`:
  ```ts
  status.status === "passed"
    ? "success"
    : status.status === "rejected" ||
        status.status === "failed" ||
        (status.status === "needs-review" && run.kind !== "merge_group")
      ? "failure"
      : "pending";
  ```
- `packages/security/src/checks.ts:51-54`: each `failure` gets `title: "Visual review has not passed"`. The function takes only `conclusion` and `detailsUrl`, so `needs-review`, `rejected`, and `failed` cannot differ.
- `packages/service/src/service.test.ts:2416` pins `failure` for a pull request that needs review.
- The contract requires a block, not a red result. `docs/design-r9.json:485-488` (D20): "Unapproved existing changes, rejection, incomplete capture, and stale acceptance still block the required check." GitHub blocks on each conclusion that is not `success`, `skipped`, or `neutral`. So the red state is a choice, not a requirement.

Corrections and feasibility:

- There is a second copy of the mapping that the state table does not show: `apps/web/src/operations/review-links.ts:113-117`. It also maps `superseded` to `failure` and has no merge-group exception. It serves only the legacy head mirror (`review-links.ts:174` skips new attempts), but a change must touch both copies.
- If the report recommends `action_required`: this is a larger change than a text change. `apps/web/migrations/0002_work.sql:38` has `CHECK (conclusion IN ('pending', 'success', 'failure'))`, so D1 needs a table rebuild. The types at `packages/service/src/work.ts:375,388` and `packages/security/src/checks.ts:22` must change. Six code sites treat a completed remote conclusion other than `success`, `neutral`, or `failure` as an error or skip it: `apps/web/src/api/pre-run-attempts.ts:77-82`, `:105-108`, `:995`, `:1004`, and `apps/web/src/api/pre-run-checks.ts:255-260`, `:551-556`.
- If the report recommends `in_progress` for a pull request that waits for review: GitHub makes an incomplete check run `stale` after 14 days. A long-lived pull request would get a stale check. A completed conclusion is the safer base.
- The smallest change keeps `failure` and changes the title and summary for each state. The outbox stores only `conclusion` (`0002_work.sql:31-45`), so the sender must read the run status at send time or the outbox needs a column. Three tests pin the current text: `packages/security/test/security.test.ts:292-301`, `packages/security/test/checks.test.ts:53`, `:83`.

## JOUR-02

Title: "Visual review is running" also means "waits for a person" and "needs a new capture".

**Verdict: partly-confirmed.** My severity: **low** (auditor: medium).

Proof:

- `run-status.ts:98-105` sends `pending` for `incomplete`, `comparing`, `needs-recompare`, and for `needs-review` on a `merge_group` run. `checks.ts:45-47` gives all of them `"Visual review is running"`.
- "Needs a new capture" is confirmed. `review-status.ts:80` and `:83-90` produce `needs-recompare`. Server recompare is off: `apps/web/src/api/review.ts:986` throws `local_comparison_required`, and `review.ts:592` sends `recompareAllowed: false`. So the check says "running" while nothing runs. My capture `verify/screens/v-06-run-needs-recompare--desktop-dark.png` shows the page text "Comparison needs fresh Submit. This comparison is out of date."

Corrections:

- "Waits for a person" is the merge-group branch only. Production does not reach it today. Ariakit has no `merge_group` trigger and no merge queue rule (see the consumer facts above). The code path is real (`service.test.ts:2420-2438`), but it is dormant.
- Missing consequence: a check that stays `in_progress` becomes `stale` after 14 days (GitHub guide above). That is the end state of a `needs-recompare` check.
- `needs-recompare` is rare for pull requests. `review-status.ts:83-90` applies the baseline rule only when `run.kind !== "pull_request"`. For a pull request it needs an invalidated comparison. `apps/web/src/operations/main-retirement.ts:4-30` also retires replaced main runs, which removes some of these cases.

## JOUR-03

Title: The check output has no counts and no item names. The service computes the counts and drops them.

**Verdict: partly-confirmed.** The facts are right. The framing as a defect is wrong for item names. My severity: **medium** as a decision to reopen (auditor: high).

Proof of the facts:

- `run-status.ts:56-60` reads `pending` and `rejected` counts. `run-status.ts:69-79` returns them. `prepareStatusIntent` (`run-status.ts:94-105`) uses only `status.status`.
- `checks.ts:43-44`: `genericCheckOutput(conclusion, detailsUrl)` has no parameter for counts.

Why the current behavior is deliberate:

- `docs/design-r9.json:606-626`, decision D25 "Public check output", answer `link`: "Generic public GitHub status and a sign-in review link remain selected. Reviewer names and per-image results stay private."
- `README.md:15`: "Run metadata, labels, decisions, export files, and quarantine remain private."
- `packages/security/test/security.test.ts:292-296` is named "links the %s check to the exact review without exposing its contents" and asserts `Object.keys(output)` equals `["title", "summary"]`.
- `README.md:79` says the current contract "preserves its 61 decisions".

Corrections:

- Item names are private labels. A check on a public repository is public. Item names in the output need an explicit supersession of D25. This is not a bug fix.
- Counts are an aggregate, not a "per-image result". They are a smaller question, but "generic status" is the recorded choice. The maintainer must select the change.
- The function name `genericCheckOutput` states the intent. A finding that says "drops them" should say "drops them by design (D25)".

## JOUR-04

Title: The check tells each reader to sign in. A pull request author who does so reaches a dead end.

**Verdict: confirmed**, with one precision about which page. My severity: **medium** (auditor: high).

Proof:

- `checks.ts:44`: `` `[Open this review in Visonaut](${detailsUrl}). Sign in with GitHub if prompted.` `` The same summary goes to every conclusion.
- A person without write access gets 403: `packages/security/src/github.ts:226-228` throws `not_maintainer` when `permission` is not `write` or `admin`. `apps/web/src/api/index.ts:35-45` returns it as JSON with `error.message`.
- `apps/web/src/routes/runs.$runId.tsx:76-111`: the error card has one control, `Retry`. Screenshot `screens/jour-01-run-forbidden-signed-in-no-write-access--desktop-dark.png` shows "This run could not be opened", "Write access to this repository is required to open this run.", and `Retry`. The mobile and light captures show the same.

Corrections:

- "Measured" here means a browser capture with a mocked 403 (`capture.mjs:71-80`). It did not use real authentication. The production body has the same shape, so the UI result holds.
- The Details link has two targets. Before the run exists it is `/pulls/N?check=...` (`apps/web/src/api/pre-run-checks.ts:508-514`). After the first status delivery it is `/runs/<id>` (`checks.ts:188-196`). On the pull route a 403 shows "Repository access required" with `Use another account` (`pulls.$pullNumber.tsx:206-234`; my capture `verify/screens/v-01-pull-forbidden--desktop-dark.png`). So the dead end is exact for the run route. The pull route has an account switch, and neither route has a link back to GitHub.
- The header keeps the links "Review queue", "Run history", "Service status". They lead to the dashboard, which shows "Repository access required" for this person. It is not a strict dead end, but it has no useful exit.
- The sign-in link in the public check is the selected D25 option ("Public readers see the result and can reach the login page. Only current maintainers can read the review."). A change to the summary text is inside D25. A removal of the link is not.

## JOUR-05

Title: The page behind the Details link contradicts the check in three states.

**Verdict: partly-confirmed.** I cannot match "three states" because the report text is missing. Contradictions exist. I verified four. My severity: **medium**.

What I verified:

1. `needs-review` (pull request, main). Check: red, "Visual review has not passed". Page: "Changes need review" and amber "Needs review" badges (`use-review-session.ts:61-62`; capture `verify/screens/v-07-run-needs-review--desktop-dark.png`). The tone differs: failure against waiting.
2. `needs-recompare`. Check: "Visual review is running". Page: "A new comparison is required" and "Comparison needs fresh Submit" (`use-review-session.ts:71-72`, `review-workspace.tsx:138-139`, `:959-960`; capture `v-06`). A real contradiction.
3. Superseded attempt before a run exists. Check: "Visual capture was superseded". Page: "Visual capture failed." The API maps `pre_run_checks.state='failed'` to `failed` (`review.ts:776`), and the supersede paths set `state='failed'` (`pre-run-attempts.ts:84`, `:633`). Capture `verify/screens/v-02-pull-capture-failed-or-superseded--desktop-dark.png`. A real contradiction.
4. No visual work needed. Check: green, "Visual capture is not required". Page: "Waiting for screenshots. ... This page updates automatically when the review is ready." See the first entry in "Missed" for the proof. A real contradiction, and the page polls each 15 seconds with no end (`pulls.$pullNumber.tsx:105-119`).

Not contradictions: `passed` ("Visual review passed" against "Check passed"), `rejected` ("has not passed" against "Rejected changes"), and `failed` (the page is only more specific).

Correction: if the report's three states include `incomplete` or `comparing`, that is a naming difference ("Visual review is running" against "Waiting for the complete capture"), not a contradiction.

## JOUR-06

Title: After the last decision the app says "Check passed" before GitHub has the result, never confirms it, and has no link back.

**Verdict: confirmed.** I ran the measurement again and got the same result. My severity: **medium** (auditor: high).

Proof:

- `apps/web/src/review/use-review-session.ts:63-64`: `case "passed": return "Check passed";`. The label is the run status, not the GitHub check state.
- The receipt carries the run status from the database: `apps/web/src/operations/review-queue.ts:119-128` (`runStatus: status.status`). The GitHub write is a later queue job: `apps/web/src/api/review.ts:641-667` runs the command and then calls `context.operations.send({ kind: "status" })`.
- No later read: the status poll runs only while a comparison is awaited (`use-review-session.ts:185-186`).
- No link: `rg "github\.com"` over the UI source finds two links only, `pulls.$pullNumber.tsx:281` and `operations-attention/index.tsx:456`. `capture-log.json` records `"githubLinks": 0` in all four variants.
- Screenshot `screens/jour-07-...-after-check-passed--desktop-dark.png` shows "0 of 11 need review", "Check passed", and "1 variant approved. Saved." The queued state in `jour-06` shows "Changes need review" and "1 queued on server. You can close this window."

Measurement, run again (`verify/rerun-last-decision.mjs`, output in `verify/measure-last-decision-output.json`):

| Run                   | "Saved." after the click | Requests in the next 6 s |
| --------------------- | ------------------------ | ------------------------ |
| 1                     | 684 ms                   | 0                        |
| 2                     | 685 ms                   | 0                        |
| 3                     | 680 ms                   | 0                        |
| 4 (two pending polls) | 1698 ms                  | 0                        |

The auditor recorded 676, 677, 672, and 1714 ms. All API answers are immediate mocks, so these times are the client timer only (`client.ts:328`, a fixed 500 ms wait before the first receipt read).

Corrections:

- The time until GitHub has the result is not measured by anyone. From the code: one queue with `max_concurrency: 1` and `max_batch_timeout: 1` (`apps/web/wrangler.jsonc:99-104`) that review status shares with ingest (`review.ts:642`, "the shared consumer may be occupied with ingest"), and a cron fallback each 5 minutes (`wrangler.jsonc:110`).
- A failed delivery is not silent: it becomes a "check-delivery" operations event (`apps/web/src/operations/checks.ts:258-265`). It shows on the dashboard, not on the review page.
- A link back needs a model change. The server knows the number (`review.ts:274-275`), but `ReviewModel.run` has only `repository` and a `title` string (`apps/web/src/review/model.ts:74-78`). A confirmation needs a new field too: the delivery state exists per check (`0002_work.sql:40`, `state IN ('pending','sending','complete','obsolete','dead')`), but no API returns it.
- The cheap fix for the wrong claim is a rename ("All changes approved"). It needs no backend work.

## JOUR-07

Title: An obsolete attempt is a red failure, and its Details link ends at a page with no way forward.

**Verdict: partly-confirmed.** My severity: **low** (auditor: medium).

Proof of the first part:

- `apps/web/src/api/pre-run-attempts.ts:110-117` (`conclusion: "failure"`, used by `:226-229` and `:301-304`) and `:646-656`. All three use the title "Visual capture was superseded".

Corrections to the second part:

- The Details link of these checks stays `/pulls/N?check=<old id>` because the PATCH sends no `details_url`. That page offers `Check again` and `Open on GitHub` (`pulls.$pullNumber.tsx:272-289`; capture `v-02`). So a way back to GitHub exists. What is missing is a link to the attempt that replaced this one. The text is also wrong ("Visual capture failed.").
- If a sealed run exists for the old attempt, the pull route sends the reader to it even when the run is not active. `apps/web/src/api/api.test.ts:739-743` pins this (`active=0` still returns `state: "ready"`). The run page then says "Comparison superseded. A newer attempt replaced this comparison. Its evidence cannot be reviewed." with no link to the newer run (capture `verify/screens/v-05-run-superseded--desktop-dark.png`; the "Recompare now" button in that capture comes from the fixture, production sends `recompareAllowed: false`).
- Visibility is smaller than the title suggests. A head change puts the old check on an old commit. A rerun puts two check runs on one commit, and the GitHub API default (`filter=latest`) returns only the most recent one. The red result is most visible on old main commits (`pre-run-attempts.ts:226-229`).
- Safety limit for any redesign: `neutral` and `skipped` satisfy a required check. If the new attempt's check creation fails or is ambiguous, an old `neutral` check could be the latest "Visonaut" check on the head. Use a blocking conclusion (`failure`, `cancelled`). The contract at `docs/current-contract.md:230` says "A prior passing check cannot replace the current result."

## JOUR-08

Title: From the push to the start of Submit, and after a capture job fails, the pull request has no Visonaut check.

**Verdict: partly-confirmed.** The facts are right. The pull request is not empty, and the obvious fixes conflict with the contract. My severity: **low** (auditor: medium).

Proof:

- Webhooks only record the candidate: `apps/web/src/api/webhooks.ts:186-192`, `:202-206`, `:325-328` call `recordPreRunCandidate`, which passes `createCheck: false` (`pre-run-checks.ts:590-604`, comment "Preserve candidate provenance without publishing a GitHub check").
- The check is created only by a signed call: `ensureSignedAttemptCheck` from `/v1/plan` (`pre-run.ts:132`), `/begin` (`workflow-owned.ts:317`), and `/submit` (`workflow-owned.ts:1226`).
- `workflow_run` events do not create it: `pre-run-attempts.ts:971`, `if (!candidate.check_id) return;`.
- Ariakit calls only `visonaut submit` in a job with `needs: visual`. If a capture job fails, Submit is skipped, so no signed call arrives and no check exists.

Corrections:

- The pull request shows the required check as "Expected - Waiting for status to be reported", because the ruleset requires `Visonaut` from App 5028451. The reader sees a row, not nothing.
- "Visual capture did not complete" (`pre-run-attempts.ts:1011-1026`) can appear only when a check already exists. For Ariakit that means Submit started. `docs/simplification-audit/evidence/feedback-integration.md:52` recommended "Required capture failed, was cancelled, or never submitted: Explicit failure". The "never submitted" case does not get it.
- `visonaut begin` does not fix the wait as the workflow is built. `/begin` accepts only the Submit job identity (`workflow-owned.ts:309-316`, `configuration.submitJobName`), and that job starts after the captures. `packages/cli/README.md:11` says "in the trusted job".
- A check at Plan time for `app=true` conflicts with the contract: `docs/current-contract.md:224`, "There is no separate signed true report or reusable Plan mode." `pre-run.ts:55` rejects `visualRequired !== false`.
- A check from the webhook was the older design and was removed on purpose. Each of these fixes needs an explicit contract change.
- Merging stays blocked in both cases (the required check is missing, and Gate fails when App jobs fail). The cost is an unexplained wait, not a wrong result.

## JOUR-09

Title: A run on main or in the merge queue that needs review reaches no person.

**Verdict: partly-confirmed.** My severity: **low** (auditor: medium).

Proof for main:

- No outbound notification exists. `rg` for issue comments, email, or chat calls in `apps/web/src`, `packages/security/src`, and `packages/service/src` finds none. `docs/review-guide.md:9`: "No external notifications are sent."
- The run is visible in two places: a red check on the main commit, and the dashboard queue (`apps/web/src/api/dashboard.ts:69-75`, `:139`, which keeps active main runs that are not `passed`).

Corrections:

- The merge-queue part is dormant. Ariakit has no `merge_group` trigger and no merge queue rule. Report it as a code path, not a production state.
- No notification is a recorded choice: `docs/design-r9.json:1512`, "maintainers find stalled work through the app and generic GitHub result. Avoid an outbound alert integration initially."
- The real cost on main is worth stating: until a person reviews, the baseline is not promoted (`docs/current-contract.md:214`, "Any remaining change needs valid acceptance before main can promote the full snapshot").

## JOUR-10

Title: The sign-in step does not name the target and exists in three texts. The return to a deep link works.

**Verdict: partly-confirmed.** My severity: **low** (auditor: medium).

Proof:

- Three texts: `apps/web/src/routes/index.tsx:283-309` ("Every change. A clear decision." and "Use a GitHub account with write access to this repository."), `runs.$runId.tsx:227-230` ("Sign in to review this run", "This review is available to Ariakit maintainers."), `pulls.$pullNumber.tsx:186-192` ("Sign in to review pull request #7", "Compare screenshots and approve expected changes...").
- Return target: `runs.$runId.tsx:169-178` builds `callbackURL` from the run, comparison, item, and variant. `capture-log.json` records `"callbackURL": "/runs/run-42?item=menu%2Fopen&variant=Menu-dark"`. `route.browser.test.ts:423,448` pins it.

Corrections:

- "Does not name the target" is true for the run route and the dashboard. The pull route names the pull request number, which it takes from the URL.
- The guest card cannot name the pull request title. The API answers 401 before it reads anything, and run metadata is private (`README.md:15`). A fix can use only the URL or public configuration.
- "Works" was measured only up to the sign-in request. The GitHub redirect and the return are mocked. I added one check: the better-auth 1.7.5 validator (`dist/auth/trusted-origins.mjs:68-78`, called from `dist/api/middlewares/origin-check.mjs:55`) accepts all three callback shapes. Output of `verify/callback-url-check.mjs`:
  ```
  {"label":"run deep link (item key with a slash)", ..., "accepted":true}
  {"label":"pull route","url":"/pulls/7?check=visonaut%3Apre%3Addd...","accepted":true}
  {"label":"control: encoded slash in the path","url":"/runs/a%2Fb","accepted":false}
  ```
  The full OAuth round trip stays unverified here.
- One more inconsistency: `runs.$runId.tsx:230` has the organization name in the text ("Ariakit maintainers"). The other two cards say "this repository".

## JOUR-11

Title: The run route shows the sign-in card only if the 401 body has error.message.

**Verdict: confirmed.** I ran the measurement again with the same result. My severity: **low** (same as the auditor).

Proof:

- `apps/web/src/review/client.ts:269-281`: for a response that is not OK, `string(error.message)` throws a plain `Error` before the `ReviewCommandError` with `status` is built. The loader at `runs.$runId.tsx:41-45` checks `error instanceof ReviewCommandError && error.status === 401`, so the plain error goes to the error card.
- Output of `verify/rerun-401-shape.mjs` (`verify/rerun-401-shape-output.txt`), same as the auditor's:
  ```
  {"route":"run","body":"with error.message","heading":"Sign in to review this run","signIn":1}
  {"route":"run","body":"without error.message","heading":"This run could not be opened","signIn":0}
  {"route":"run","body":"empty object","heading":"This run could not be opened","signIn":0}
  ```
  The dashboard and the pull route show the sign-in card for all three bodies.

Corrections:

- Production does not send such a body today. Each 401 on the private API comes from `packages/security/src/authorization.ts:38` through `apps/web/src/api/index.ts:35-45`, which always writes `error.message`. The problem is latent.
- A 401 that is not JSON has the same result (`client.ts:263-267` throws without a status). A proxy or edge answer would be that case.

## JOUR-12

Title: The documents for people outside the app describe a flow that the author cannot follow, and do not explain the check states.

**Verdict: partly-confirmed.** My severity: **low** (same as the auditor).

Proof:

- No document explains the check titles. `rg` for the nine titles finds them only in source, tests, `docs/simplification-audit/evidence/feedback-integration.md:49`, and one evidence JSON file.
- `README.md:13`: "Open the review link from the GitHub check and sign in with GitHub. Access requires current write permission to the configured repository."

Corrections:

- The README states the access rule in the same paragraph. So the text is correct for a maintainer. The exact gap is: no document tells an author without write access what the red check means or what to do.
- The review guide has drift that the title does not mention. `docs/review-guide.md:31-34` names "Side by side", "Pixel diff", "New only", "Original only". The UI has "Compare", "Difference", "Current", "Baseline" (`apps/web/src/review/review-workspace.tsx:845-888`). `docs/review-guide.md:92` says "Use **All runs** to return to the dashboard". The control is "Queue" (`review-workspace.tsx:584`). `docs/review-guide.md:15` says "The Runs page". The navigation says "Review queue" and "Run history".

## JOUR-13

Title: The name "Open Visonaut review" is not written any more. A pull request can still have two check runs with the name "Visonaut".

**Verdict: partly-confirmed.** My severity: **low** (same as the auditor).

Proof of the first part:

- `packages/security/src/checks.ts:5` defines `REVIEW_LINK_CHECK_NAME`. It is used only to find or accept an old check: `apps/web/src/operations/review-links.ts:255` and `:355`. Each write uses `CHECK_NAME`: `review-links.ts:278`, `:372`, `checks.ts:141`, `:194`.

Second part:

- At the API level it is true. A rerun inserts a new row with `generation+1` and a new external ID for the same head (`pre-run-attempts.ts:663-677`), and `pre-run-checks.ts:501-522` creates a second check run with `name: CHECK_NAME`. The code itself lists with `filter=all` to see both (`checks.ts:87`).
- Whether a person sees two rows is unverified. The API default is `filter=latest`. I found no GitHub statement about the merge box for two check runs with one name from one App. Nobody took a screenshot on GitHub. State this part as "two check runs exist on the commit", not "the pull request shows two".
- The old mirror case is on two different commits (the merge commit and the head), so it is not "two on one commit".

## JOUR-14

Title: The texts use "review" for machine stages and workflow terms for people.

**Verdict: judgment.** The quoted strings exist. My severity: **low**.

Facts that I checked:

- `checks.ts:46`: "Visual review is running" covers `incomplete` and `comparing`, which are capture and comparison stages.
- `apps/web/src/api/pre-run-plan.ts:186`: "The successful trusted Plan selected app=false for this attempt." This is in a public check summary.
- `pre-run-attempts.ts:1013`: "The trusted Plan or signed Submit is missing. Missing Plan never means no visual work."
- `review-workspace.tsx:960`: "Comparison needs fresh Submit".

The opinion that these words are wrong for the reader cannot be refuted. One limit: the public texts must stay generic (D25), so a rewrite can change words but cannot add private detail.

## Screenshots

The auditor's captures that I opened (all show what the file name says): `jour-01` (desktop dark, mobile light), `jour-02`, `jour-03`, `jour-04`, `jour-05`, `jour-06`, `jour-07` (desktop dark, mobile dark), `jour-08` (desktop dark). `jour-08` is a simulated layout of the check texts, and its header says so. It is not a GitHub screenshot.

New captures, all under `/Users/diegohaz/.claude/jobs/f65a6229/tmp/audit/gap-github-journey/verify/screens/` (fixture harness, mocked API, 1440 wide, dark):

| File                                                                | What it shows                                                                                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `v-01-pull-forbidden--desktop-dark.png`                             | Pull route with 403: "Repository access required", `Use another account`, no GitHub link.                                                     |
| `v-02-pull-capture-failed-or-superseded--desktop-dark.png`          | Pull route with `state: "failed"`: yellow "Visual capture failed.", `Check again`, `Open on GitHub`. A superseded attempt gets this page too. |
| `v-03-pull-pending-also-shown-for-no-visual-plan--desktop-dark.png` | Pull route with `state: "pending"`: "Waiting for screenshots." This is also the page for a green "Visual capture is not required" check.      |
| `v-04-pull-check-not-found--desktop-dark.png`                       | Pull route with 404: "This Visonaut check was not found. Open the latest check on GitHub." and `Retry`. No GitHub link.                       |
| `v-05-run-superseded--desktop-dark.png`                             | Run page, superseded: "A newer attempt is active", "Comparison superseded". No link to the newer run.                                         |
| `v-06-run-needs-recompare--desktop-dark.png`                        | Run page, needs-recompare: "A new comparison is required", "Comparison needs fresh Submit".                                                   |
| `v-07-run-needs-review--desktop-dark.png`                           | Run page, needs-review: "Changes need review".                                                                                                |

The log with headings, buttons, and links for each capture is `verify/capture-verify-log.json`.

## Missed

I could not read the report, so some of these can be in it already.

1. **A green "Visual capture is not required" check opens a page that says "Waiting for screenshots" with no end.** `apps/web/src/api/review.ts:773-777` returns `not-required` only when `docs_only` is set. Production never sets it: each candidate has `docsOnly: false` (`pre-run-candidates.ts:38,99,128,197`, `pre-run-attempts.ts:753,822`). The real signal is `plan_visual_required=0` with `state='docs_complete'` (`pre-run-plan.ts:190-195`). Only a test sets `docs_only=1`, with direct SQL (`api.test.ts:752-761`). The "No visual review needed." state of the page is dead in production.
2. **A sign-in by a person without write access leaves stored data.** `packages/security/src/auth.ts:29-41` stores the account with encrypted OAuth tokens (`read:user`, `user:email`), and `:54-65` writes a `sign_in` audit row, before the 403. I found no cleanup of `user` or `account` rows.
3. **The 403 state differs on each route.** Run route: `Retry` only. Pull route and dashboard: `Use another account`. No route has a link to GitHub. (`runs.$runId.tsx:76-111`, `pulls.$pullNumber.tsx:206-234`, `index.tsx:321-354`.)
4. **The pull route 404 tells the reader to "Open the latest check on GitHub" and gives no link.** `pulls.$pullNumber.tsx:70-72`, `:216-223`. The repository name is not known on this path.
5. **A capture job failure never gets the "Visual capture did not complete" text when Submit did not start.** `pre-run-attempts.ts:971`. The required check stays "Expected" with no reason.
6. **A check that stays `in_progress` becomes `stale` after 14 days.** This is the end state for `needs-recompare` and for each pending check that no event closes.
7. **A superseded run has no link to the run that replaced it, and the pull route opens it as "ready".** `review-workspace.tsx:136-137`, `api.test.ts:739-743`.
8. **The review guide names controls that the UI does not have.** See JOUR-12.
9. **The conclusion mapping exists twice and the copies differ.** `run-status.ts:98-105` and `review-links.ts:113-117`.
10. **One sign-in card has the organization name in the text.** `runs.$runId.tsx:230`, "Ariakit maintainers".
11. **The delay between the last decision and the GitHub result has no measurement and no bound in the UI.** One queue consumer with `max_concurrency: 1` shared with ingest, cron fallback each 5 minutes (`wrangler.jsonc:99-104`, `:110`).
12. **A redesign of obsolete-attempt results has a safety limit.** `neutral`, `skipped`, and `success` satisfy a required check. See JOUR-07.
