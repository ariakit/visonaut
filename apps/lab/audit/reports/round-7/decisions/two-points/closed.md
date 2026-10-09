# The two open points of the issue plan: both are closed, and none is a new decision

This file is the result after the independent check of 2026-10-07. The first draft closed point A and made point B a decision (D-PRE-52). The check keeps point A closed, with three corrections in what the implementation must do. The check also closes point B, because three explicit answers of the maintainer and one settled answer of this record already select the rule. The first draft is in `check/author-original/`. A corrected form of the withdrawn decision is in `withdrawn/`, for the case that the coordinator wants to ask.

Labels: "measured" is a number that this part or the audit measured. "Counted from code" is a fact that was read in the code or in a document of the repository on 2026-10-07. "From the record" is a statement of the audit record that this part read and did not measure again. "Assumption" is a statement that nobody checked.

# Point A: the run approval of a large run

Point A is the open input "Run approval of a very large run" of the issue `review-decisions` (`/Users/diegohaz/.claude/jobs/f65a6229/tmp/round7/issues/final/21-review-decisions.md`, line 171).

## A1. What the question is

A run approval is one menu item that approves each change of a run that has no decision (D-WORK-04). The server writes one decision row for each change, in one transaction. The question of the issue plan: what does the server do when the run has so many changes that D1 refuses that transaction? Three answers are possible: save nothing and answer with an own error code, divide the approval into parts, or turn the menu item off above some count.

## A2. Why it is not a choice

Two settled answers and one documented rule of D1 leave one behavior.

| Possible answer                                         | What closes it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Save nothing, and answer with an own error code         | It is not a design. The settled answer to D-WORK-04 says "in one transaction", and a D1 batch is that transaction: "Batched statements are SQL transactions. If a statement in the sequence fails, then an error is returned for that specific statement, and it aborts or rolls back the entire sequence." (<https://developers.cloudflare.com/d1/worker-api/d1-database/#batch>, read on 2026-10-07). The error code is already in the plan: row 12 of the accepted fix list of D-OPS-01 gives a stored decision that failed its own code (issue `ops`, step 6). |
| Divide the approval into parts, with a visible progress | It is the option "Each step works in parts, for any count" of D-SCALE-02, which the maintainer did not select. It also changes two settled sentences of D-WORK-04: "in one transaction" and "one Undo reverses the command".                                                                                                                                                                                                                                                                                                                                       |
| Turn the menu item off above some count                 | It is the limit of D-SCALE-02 in a small form. The settled answer says "Nothing is built for it now". The number needs the measurement on production D1, and the rationale of D-SCALE-02 says that the measurement "waits too".                                                                                                                                                                                                                                                                                                                                    |

Words of the maintainer that close it:

- Round 4, the note on D-SCALE-02: "Let's defer this to when this is a problem." The panel that he answered had the numbers of this point: "30,000 changes are 150,008 rows for the run approval", and "Nobody tested production D1" (counted: the context of D-SCALE-02 in `apps/lab/audit/content/decisions.json`).
- Round 2, the selection of "Add a run approval, with decision rows" in D-WORK-04, after the request of round 1 for a button with no shortcut and no prominent place.
- 2026-10-07: "I authorize the implementation, the GitHub writes, the two writes to production D1, and the package publication and the change in ariakit/ariakit." The second of the two writes is the measurement for the limit of D-SCALE-02. It waits with the limit. Two other lanes read it in the same way (`/Users/diegohaz/.claude/jobs/f65a6229/tmp/round7/decisions/limit-production/closed.md`, line 154, and `/Users/diegohaz/.claude/jobs/f65a6229/tmp/round7/decisions/contract-future/closed.md`, line 79).

One more fact makes a guard for the menu item alone the wrong tool. From the record (measured on a local D1, `apps/lab/audit/reports/round-4/scale/notes.md`, line 22): the run approval is not the largest transaction for each change. The closed summary of today writes 8 rows for each change in one transaction, 30 days after a run closed, with no action of a person: 160,024 rows for 20,000 changes, where the run approval writes 100,008. So a run with a mass change meets the D1 limit in product code of today before it meets it in the run approval, and the answer for both is the one limit of D-SCALE-02.

## A3. The four facts that the task asked for

### What the code of today does for an approval of many targets

- Counted from code: no page sends a command for more than one screenshot. The largest command of the page is a whole screenshot. From the record: an Ariakit screenshot has 3 to 24 variants.
- Counted from code: the route accepts a list of targets up to the capture limit of the service, in a request body of 1 MiB at most (`apps/web/src/api/review.ts:842` and `:847-851`). The default of that limit is 40,000 (`apps/web/src/runtime-defaults.ts:14`). From the record (finding STATE-09, measured): the 1 MiB body holds about 6,190 targets.
- Counted from code: the service writes 4 statements for each target in one batch (`packages/service/src/review-commands.ts:227-271`), and the batch is one transaction (`packages/service/src/database.ts:53-59`). From the record (section `60-workspace-viewer.html`, estimate): the command row of that design is above the documented 2,000,000 bytes at about 3,690 targets.
- Counted from code: the page sends each decision through the queue (settled answer to D-RES-06). The queue ends a task at the first try for three error classes, for example a conflict (`apps/web/src/operations/review-queue.ts:135-146`). For each other error, as a batch that D1 refuses, it sets the task back to "queued" and tries again, up to 5 times (`review-queue.ts:62` and `:147-156`, `packages/service/src/work.ts:102-135` and `:185-207`). After the last try the task is "dead", and the receipt route answers HTTP 409 with the code `conflict` and the text "The queued decision could not be processed. Review it again." (`apps/web/src/api/review.ts:812-830`). This part did not drive the path with a real D1 error.
- So today there is no run approval, a large list fails for other reasons than the transaction size, and a refused transaction looks like a conflict after 5 tries.

### The documented limits of D1 for one transaction or one batch

Source: <https://developers.cloudflare.com/d1/platform/limits/>, "Last updated Apr 21, 2026". The check downloaded the page again on 2026-10-07: it is byte for byte the copy of the first draft (`evidence/d1-limits.md`, `check/checker-docs/d1-limits.md`).

| Limit                 | Words of the page                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time                  | "Maximum SQL query duration: 30 seconds", with the footnote "Requests to Cloudflare API must resolve in 30 seconds. Therefore, this duration limit also applies to the entire batch call."                                                                                                                                                                                                                                                                                                                                               |
| Size of one statement | "A single query that attempts to modify hundreds of thousands of rows or hundreds of MBs of data at once will exceed execution limits. Break the work into smaller chunks (e.g., processing 1,000 rows at a time) to stay within platform limits." The sentence is in the part "Query performance", which the page names "a rough guideline". It is not a row of the table of limits.                                                                                                                                                    |
| One query at a time   | "Each individual D1 database is inherently single-threaded, and processes queries one at a time."                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A batch               | "Limits for individual queries (listed above) apply to each individual statement contained within a batch statement." The page gives no count of statements and no count of rows for one batch.                                                                                                                                                                                                                                                                                                                                          |
| Other                 | 2,000,000 bytes for one string or row, 100,000 bytes for one statement, 100 bound parameters, and "Queries per Worker invocation: 1000 (Workers Paid)". The run approval of the settled design has 18 statements (17 in the probe of round 4) and a command row of about 390 characters for any count. Measured on a local D1: 389 characters at 246 changes (`apps/lab/audit/reports/round-2/work-04/probe/results/run-approval.json`) and 391 at 3,832 (`run-approval-large.json` in the same folder). So it does not meet these four. |

The error list (<https://developers.cloudflare.com/d1/observability/debug-d1/#error-list>, `evidence/d1-errors.md`, lines 86, 89, and 90) names what a statement that is too large returns: "D1 DB storage operation exceeded timeout which caused object to be reset.", "D1 DB's isolate exceeded its memory limit and was reset.", and "D1 DB exceeded its CPU time limit and was reset." For these three the page says to make the query smaller or to divide it. It says "Retry the operation" for errors of the network and of a restart (lines 79 to 85).

### The count at which the settled design reaches a limit

The settled design writes all targets with two statements: one `INSERT ... SELECT` into the decision table and one `UPDATE` of the changed rows.

| Changes | Rows in the transaction (5 for each change, and 8) | Rows of the `INSERT` (4 for each change) | Bytes of the new decision rows with their index entries (1,929 for each) | Label                                                                                 |
| ------: | -------------------------------------------------: | ---------------------------------------: | -----------------------------------------------------------------------: | ------------------------------------------------------------------------------------- |
|     246 |                                              1,238 |                                      984 |                                                                   0.5 MB | Measured on a local D1 (rows). The bytes are a calculation.                           |
|   3,832 |                                             19,168 |                                   15,328 |                                                                   7.4 MB | Measured on a local D1 (rows). The bytes are a calculation.                           |
|   4,750 |                                             23,758 |                                   19,000 |                                                                   9.2 MB | Calculation. From the record: the largest run of today in which each capture changed. |
|  20,000 |                                            100,008 |                                   80,000 |                                                                  38.6 MB | Calculation. The capture limit after step 1 of D-DATA-02.                             |
|  25,000 |                                            125,008 |                                  100,000 |                                                                  48.2 MB | Calculation.                                                                          |
|  30,000 |                                            150,008 |                                  120,000 |                                                                  57.9 MB | Measured on a local D1: accepted.                                                     |
|  51,800 |                                            259,008 |                                  207,200 |                                                                   100 MB | Calculation.                                                                          |
| 300,000 |                                          1,500,008 |                                1,200,000 |                                                                   580 MB | Measured on a local D1: accepted.                                                     |

Sources of the measured rows: `apps/lab/audit/reports/round-2/work-04/probe/results/run-approval.json` (246) and `run-approval-large.json` (3,832), and `apps/lab/audit/reports/round-4/scale/results/d1-scale-30000.json` and `d1-scale-300000.json`. Through the queue, the same approval writes 13 more rows for its task (from the record: 1,251 rows at 246 changes).

The local times are not stable, so they say nothing about production: the same statement for 30,000 changes needed 0.9 s in one run and 16 s in the next, on a computer with a load average of 48 to 62 (`apps/lab/audit/reports/round-4/scale/notes.md`, line 23). The record keeps local times out of its text for this reason (`40-data-storage.html`, the note after the anchor `data-scale-order`).

What the table says:

- The page gives no number. The lowest count that the words "hundreds of thousands of rows" can mean is 100,000 rows in one statement. D1 counts an index row as a written row, so the `INSERT` writes 4 rows for each change, and that count is 25,000 changes. If the words mean table rows, the count is 100,000 changes.
- "Hundreds of MBs" starts at about 51,800 changes.
- The 30 seconds have no count. Assumption: the time grows with the count of changes. Nobody measured a time on production D1, where each write is stored in several locations. So this limit can stop a run approval below 25,000 changes, and nobody knows where.

### Can a run reach that count before the limit of D-SCALE-02 exists?

- Today: no. From the record: the capture list stops a run at about 5,260 captures, and at about 4,750 when each capture changed. The largest run has 3,832 captures. A run approval of 4,750 changes writes 23,758 rows, and its largest statement writes 19,000 rows and 9.2 MB.
- After step 1 of D-DATA-02: not by the words about rows and megabytes, while the capture limit is 25,000 or lower. The settled answer says "about 20,000", and the number is a setting that a Worker measurement must confirm. At 20,000 changes the largest statement writes 80,000 rows and 38.6 MB, which is 80% of the lowest count of the D1 words. For the 30 seconds the answer is not known.
- After step 2 of D-DATA-02: yes. Step 2 removes the capture limit of step 1. It is planned work with no date (issue `scale`), and the record puts the limit of D-SCALE-02 later in its order (`40-data-storage.html`, anchor `data-scale-order`, item 6).

## A4. What the implementation must do

These go into step 3 of the issue `review-decisions`. Items 1 to 5 follow from settled answers. Item 6 is permitted and not necessary.

1. **One transaction, as settled.** The two statements, the guards for the run revision and for the count, the command row, and the audit row are in one D1 batch. When D1 refuses or stops the batch, no decision row is saved. The service adds no code for parts.
2. **The run approval is a stored decision as each other.** The page sends it through the queue (D-RES-06), so the accepted row 12 of D-OPS-01 applies to it with no new rule: a wait between the attempts, 5 attempts at most, the state "dead" after the last one, and an own error code in place of `conflict` (issue `ops`, step 6). The Status page reads the tasks in the state "dead" (issue `ops`, step 7), so the operator sees the event. No second error code is necessary: the page knows that the command was a run approval.
3. **A text in the status line that says the next step.** For a run approval with the code of row 12, the status line says that nothing was saved and what the reviewer can do. A proposal: "Not saved. The approval of the run failed. Approve one screenshot at a time, or try again." The text must not say "Review it again", must not name a conflict, and must not name a cause that the server does not know. The server knows only that the task failed.
4. **The same for Undo.** The Undo of a run approval is one transaction over each target (measured on a local D1: 11,505 rows for 3,832 targets, `run-approval-large.json`). When D1 refuses it, nothing is undone, and the status line says so.
5. **A test.** The acceptance line of the issue stays: "when D1 refuses the transaction of a run approval, no decision row is saved and the answer has its own error code."
6. **Permitted, not necessary: fewer tries for a refusal that cannot succeed.** Each try of a transaction that D1 stops for its time can hold the database for up to 30 seconds, because one database runs one query at a time. Assumption: 5 tries are then up to 150 seconds in which the database answers no other query. The queue of today already ends a task at the first try for three error classes (`review-queue.ts:135-146`). The implementation can add the three D1 errors of part A3 to that list. Then the cause is known, and the text of item 3 can say "This run has too many changes for one approval." Assumption: production D1 returns one of these three messages for this case. Nobody saw the message.

Two things of the first draft are not rules, and the check removed them:

- "A refused run approval gets one try." This narrows the settled answer to D-RES-06 ("tries a stored decision again by itself") and row 12 of D-OPS-01 for one kind of command. With one try for each failure, a short network error also ends the run approval, and the reviewer gets a text about the size of the run that is not true.
- The error code `run_approval_too_large` for each failed run approval. The name states a cause. After a failure that is not one of the three D1 errors of part A3, the server does not know the cause.

What the implementation must not do: no limit of changes, no menu item that is off above a count, no state "approval in progress", and no test write to production D1 for this point.

## A5. When the point opens again

- The first refusal of a run approval in production. That is the event "this is a problem" of the note on D-SCALE-02. Then the limit of changed captures is due, with its measurement on production D1.
- The pull request that sets the capture limit of one run above 25,000 (the setting of step 1, or step 2 of D-DATA-02). It makes 25,000 changes in one run possible, which is the lowest count of the D1 words. The issue `scale` says that the maintainer approves that limit in a contract pull request: that pull request must name the run approval.
- This reading is not in the record today. A note of the maintainer can correct it.

## A6. Where the record and the plan change

- `apps/lab/audit/content/sections/60-workspace-viewer.html`: the record has no text for a refused run approval. The file `fragments/CLOSED-run-approval-large.html` is that text, with no decision panel. It goes directly before `<h4 id="workspace-viewer-scope-place">`. The coordinator can leave it out: then this file is the only place of the closure.
- Issue `review-decisions`, "Open inputs": the item "Run approval of a very large run" becomes one sentence: closed by D-WORK-04 and D-SCALE-02. Step 3 gets one sentence: the error code is the code of row 12 of D-OPS-01, and the status line text for a run approval names the next step.
- Issue `scale`, "Out of scope" or step 2: one sentence that a capture limit above 25,000 makes a run approval of 25,000 changes possible.
- No text of the record is wrong. One sentence can be more exact: the rationale of D-SCALE-02 says "Nobody tested production D1 at that size". The limits page gives no count of rows for a transaction, so a test is the only way to a number.

# Point B: the variant that a screenshot opens on

Point B is the open input "The variant that a visit selects" of the issue `review-frame` (`/Users/diegohaz/.claude/jobs/f65a6229/tmp/round7/issues/final/18-review-frame.md`, line 199), with the findings WORK-32 and RULE-03.

## B1. What the question is

One screenshot has several variants, for example 3 browsers in 2 themes. When a reviewer goes to another screenshot, the page selects the variant that it shows first. The app of today has two rules for this, and the lab page has one.

## B2. The rule that is settled

The app of today has the rule that the maintainer selected, and the new page keeps it:

- **A click on a row, and a link that names no variant:** the first variant that needs review.
- **The keys Up and Down, and the two buttons "Previous screenshot" and "Next screenshot":** the variant that the reviewer selected last in that screenshot. On a first visit: the first variant that needs review.

Example with the lab fixture (scenario `changes`): `ariakit-ui-button/page/default` has 6 variants that need review. The reviewer presses 3 and sees Firefox, Light. Then Down, then Up. With the settled rule the page shows Firefox, Light again. A click on the row shows Chromium, Light, the first variant that needs review.

## B3. Why it is not a new decision

The maintainer answered this question three times, and one settled answer of this record keeps the result.

| Source                                                                                                  | Words                                                                                                                                                                                                                                                                                                                                                                                 | Label                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Earlier decision D04, "Which variant should open when up/down changes the item?"                        | Selected: "Remember the last variant for each item". Not selected: "Always open the first variant" ("Simple and predictable, but repeats theme/browser selection") and "Keep the matching variant key".                                                                                                                                                                               | Counted: `docs/simplification-audit/prior-r9.json`, entry D04, and `docs/simplification-audit/contract-issue-1.md:412`. The key table has the rule in its row for Up and Down (`contract-issue-1.md:271`).  |
| Pull request #104 of the maintainer, merged 2026-09-27 (commit `859ad6f`)                               | "Routed item links always select the first variant needing review, including after an explicit choice of an unchanged variant. Keyboard item navigation can restore the last explicitly chosen variant for that item." Its review record declined a link that uses the memory: "Keep links directed to review work", and "Keep explicit variant memory for keyboard item navigation." | Measured (a read of GitHub with `gh pr view 104`). The same commit added both rules to the code and the test "item navigation picks the first variant needing review unless one was chosen" (`git log -S`). |
| Earlier decision U03, one of the 45 selections that the contract keeps (`docs/current-contract.md:144`) | The selected option: "Item links target the first pending variant; remembered keyboard selection remains separate." Its tests: "First-pending item links and remembered keyboard variants stay distinct."                                                                                                                                                                             | Counted: `docs/simplification-audit/audit-data.json`, entry U03.                                                                                                                                            |
| D-WORK-03 of this record, settled                                                                       | "The review workspace keeps the keys of today". The selected option says "No change", and the rationale says "No key changes, so no test and no line of the review guide changes for the keys."                                                                                                                                                                                       | Counted: `apps/lab/audit/content/decisions.json`. The issue `review-frame` has the acceptance line "A browser test presses each key of today ... Each does what it does today."                             |
| The contract, line 5                                                                                    | "Only an explicit approved change supersedes a requirement. An unselected question or a passing source check does not change the contract".                                                                                                                                                                                                                                           | Counted: `docs/current-contract.md:5`.                                                                                                                                                                      |

The lab page differs, and no lab question asked for it:

- Measured in the lab (Chromium 153, scenarios `changes` and `one-browser`, by the first draft and again by the check, `check/checker-lab-probe.json`): a row click, Up and Down, and a return after a decision all open the first variant that needs review. The page has no memory. In the example of part B2, the lab shows Chromium, Light after Up.
- Counted from code: the session hook of the lab has the memory of D04 (`apps/lab/src/fixtures/hooks/review-model.ts:910-918` and `:1233-1247`). The page of the settled design does not use it: it selects the variant itself (`apps/lab/src/explorations/pages/review/ariakit/model.ts:72-93`, `use-workspace.ts:91-118`).
- Counted: none of the 30 lab decisions names this rule (`apps/lab/src/lab/record.ts:38-88` and `:139-331`), and the catalog text of the lab does not name it. The document of the picked direction lists the earlier decisions that it changes, and D04 is not in that list (`apps/lab/docs/design/directions/ariakit.md:914-934`).

So the pick of the lab page is not an approved change of the rule, and line 5 of the contract applies: the rule stays. The difference is a defect of the lab page that the move repairs.

The measured case that the findings name is not new evidence. In the app of today, the keys 3, A, Down, Up open "3. Dark · Approved" while another variant needs review (`apps/lab/audit/reports/gap-contract-map/verification.md:109`). The review record of pull request #104 names this case for an unchanged variant and keeps the memory for the keys.

## B4. What the implementation must do

These go into the issue `review-frame`, steps 1 to 3 and 6.

1. **A click on a row, and a link with no variant: the lab rule as it is.** The first variant that needs review, then the first variant with a change, then the first variant (`model.ts:72-78`). The second step is new and small: the app of today can open an unchanged variant of a screenshot in which each change has a decision (`apps/web/src/review/review-workspace.tsx:361-362` and `:457`).
2. **Up, Down, and the two screenshot buttons: add the memory to the page that moves.** They open the variant that the reviewer selected last in that screenshot, and then they follow item 1. The memory holds a variant that the reviewer selected with Left, Right, 1 to 6, or a click on a mark, and the variant of the link that opened the page. It does not hold the variant that the page selects after a decision or after a row click. This is the app of today (`review-workspace.tsx:242-246`, `:355-368`, `:373`, `:770`, and `apps/web/src/review/use-review-session.ts:313-316`). The cover is new: a click on a cell of the cover is a selection by the reviewer, so it writes the memory too. In the lab page, the place is `openItem` and `stepItem` (`use-workspace.ts:91-118`). Counted in the app: about 20 lines.
3. **A remembered variant that the run no longer has:** the page follows item 1 and prints "The remembered variant is unavailable. Selected ..." in the visible status line. Row 3 of the accepted list of D-WORK-01 prints the refusals in the one status line, and its finding RULE-13 names this message as a text of the same live region. So this message goes to the status line too.
4. **The memory is state of the page.** A reload forgets it. Nothing is stored, and no option writes to D1.
5. **Tests.** The two key tests and the link test of today stay for the new page (`apps/web/src/review/__tests__/review.browser.test.ts:399-432` and `route.browser.test.ts:359-381`). The acceptance line "each key does what it does today" gets one explicit check: 3, Down, Up shows variant 3.
6. **The page pull request lists this as a difference from the lab page,** with the reason: D04, U03, pull request #104, and D-WORK-03.
7. **One sentence of the contract text is corrected.** "First visit uses its first variant" (`contract-issue-1.md:271`) and "A first visit uses the first variant." (`docs/review-guide.md:82`) say what no source does since pull request #104. The new text: a first visit opens the first variant that needs review. It belongs in the map row of D-WORK-03 (the keys of today) of the contract pull request, which the maintainer approves with that pull request. That map row must keep the other sentences of line 271: the memory, and the fallback with its message.

What the implementation must not do: no memory for a row click or a row link (pull request #104 declined it), no rule "always the first variant", and no storage for the memory.

## B5. What stays, with low severity

The second half of the finding RULE-03 has no settled word. The context of D04 says "Auto-advance selects the next pending variant and updates that item's memory." The code of today does not write the memory at the advance after a decision, and pull request #104 says "the last explicitly chosen variant". The context of D04 is history and does not bind (`docs/current-contract.md:7`). D-WORK-03 keeps the keys of today, so the new page keeps the code of today. The follow-up list of the plan has the finding (`00-plan.follow-ups.md`, lines 58 and 59). A note of the maintainer can change it.

## B6. When a decision is right

If the maintainer prefers the rule of the lab page (no memory), one note is sufficient. It changes D04, the sentence "remembered keyboard selection remains separate" of U03, the row for Up and Down of the key table, line 82 of the review guide, and 2 tests. The folder `withdrawn/` has the decision in the form of the record for that case, with the option that follows the earlier answers marked as recommended. It is not a part of the result.

## B7. Where the record and the plan change

- `apps/lab/audit/content/sections/60-workspace-viewer.html`: the file `fragments/CLOSED-open-variant.html` is the text for the record, with no decision panel. It goes directly after `<div data-decision="D-WORK-03"></div>` and before `<h3 id="workspace-viewer-scope">`. The coordinator can leave it out.
- Issue `review-frame`, "Open inputs": the item "The variant that a visit selects" becomes: closed by D04, U03, pull request #104, and D-WORK-03. Its sentence "The page keeps the rule of the lab list" is not correct for the keys: with the lab rule, Up and Down do not do what they do today. Steps 2 and 6 and "Done when" get the items 2, 5, and 6 of part B4.
- `00-plan.follow-ups.md`, rows WORK-32 and RULE-03: "no answer selected one rule" becomes "D04, U03, pull request #104, and D-WORK-03 select the rule of today. One sentence of the contract text is corrected."
- The contract changes of the lane `contract-future` (`contract-changes.md`, the map row of D-WORK-03, which names the saved requirements lines 269 to 278): the row must not replace the sentence about the memory of line 271.
