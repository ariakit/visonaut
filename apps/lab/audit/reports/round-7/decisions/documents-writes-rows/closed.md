# Items 5, 6, and 7: the things that are not decisions

Three things of these items are not a choice of the maintainer. Each one has: what it is, the evidence, the words that close it, what the implementation must do, and where the record states it.

Labels: **Measured** is a value that a command gave. **Counted** is a fact read from a file, with file:line. **Assumption** is a statement that nobody verified.

The independent check of 2026-10-07 changed this file: part 2 is new (the author had it as the decision D-PRE-22), and parts 1 and 3 have corrections. The author's first version is in `check/author-copy/closed.md`.

## 1. `docs/operations/simplification-cutover.md` (second file of item 5)

### What the record asked

Revision r7, `15-your-answers.html`, part `your-answers-question-history`: "line 9 of the README sends the reader to `operations/simplification-cutover.md` for removal gates. If the gates are still in use, that file stays."

This is a question about a fact, and the repository answers it. The rules of the record say: "Do not ask for a fact that the repository or a small experiment can give" (`apps/lab/audit/AUTHORING.md:463`).

### What the file is

It is the guide for the simplification of 2026-09-30 to 2026-10-03 (issue #204). It has 104 lines and 2,770 words (measured with `wc`, and again by the check). A "removal gate" was a condition that had to be true before a part of the old system was removed. These are its first lines:

```text
# Simplification cutover

## Current cutover status

The [current contract](../current-contract.md) is the repository authority after PR #205 merged on 2026-10-02. [...] Historical pending states below do not reopen completed or waived gates.
```

### The evidence: no gate holds production

| Part of the file            | Lines     | State, in the words of the repository                                                                                                                                           |
| --------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current cutover status      | 3 to 18   | "The caller, consumer, readiness-marker, and authority receipts are complete for the recorded PR #205 cutover." (line 14)                                                       |
| Issue #204 removal holds    | 20 to 33  | "The following conditions governed removal and remain limits on later target changes. The linked completion record resolves them for the selected production rollout" (line 26) |
| Historical initial sequence | 35 to 51  | "Read their pending states and gates as historical evidence." (line 37)                                                                                                         |
| One-time conversion runner  | 53 to 104 | "These commands do not run in the current checkout." (line 55)                                                                                                                  |

More facts:

- **Counted.** `docs/evidence/issue-204-completion.md:16-18` has W06, W07, and W08 as "Complete in production". Line 13 says: "D14 remains an inventory and retirement proposal." Line 52 says that the preview environment "is not a production hold".
- **Measured.** Issue #204 is closed as completed since 2026-10-02T21:50:26Z (`gh issue view 204 --repo ariakit/visonaut --json state,closedAt,stateReason`, read two times on 2026-10-07).
- **Counted.** The 4 holds of lines 28 to 31 (W07, W08, W06 stage B, D14) each have a row in the contract: `docs/current-contract.md:47` (D02 and W07), `:48` (D03 and W08), `:51` (D06 and W06), and `:58` (D14). So the rule part stays in the contract when the file moves. The contract rows are shorter: the exact conditions (for example "required protected snapshots ... must be zero") are only in the file.
- **Counted.** The preview environment has no database, no bucket, and no queue today (`docs/current-contract.md:188`: "Its source configuration has no D1, R2, comparator service, or queue bindings"). So the conditions of lines 28 to 31 cannot apply to a preview rollout again.
- **Counted.** The count of D-CODE-04 already moves the file: "`operations/`, 16 of its 17 files". `docs/operations/` has 17 tracked files (measured with `git ls-files`), and only `adapter-service-pins.md` stays.

So the answer to "Are the gates still in use?" is: no gate of the file holds production, and no gate is pending. One sentence of the file is still a rule: the conditions of lines 28 to 31 "remain limits on later target changes" (line 26). The move must keep that sentence in force. It does, with the text of step 2 below.

### Who links to it

| File                                    | Line        | What the link says                                                         | Moves with D-CODE-04 |
| --------------------------------------- | ----------- | -------------------------------------------------------------------------- | -------------------- |
| `README.md`                             | 9           | "the [cutover guide] for dated completion receipts and removal gates"      | No                   |
| `docs/current-contract.md`              | 252         | "Follow the approved recovery scope above and the [current cutover guide]" | No                   |
| `.github/workflows/README.md`           | 7           | "their [historical instructions] remain available"                         | No                   |
| `apps/web/src/operations/README.md`     | 32          | "Keep the [historical runner instructions]"                                | No                   |
| `docs/simplification-implementation.md` | 111 and 246 | "[cutover sequence]"                                                       | Yes                  |

`.github/workflows/scripts/deploy-migrations.test.mjs:19` names the path `simplification-cutover/run.mjs` of the removed runner, in a check that the workflow does not have it. It does not read the document.

### The words that close it

- The note of the maintainer on D-CODE-04 in round 1: "/docs/history keep in the same repo". The settled answer: "Dated records, old designs, and raw evidence move to docs/history/ in the same repository."
- 2026-10-07: "3. Ok" (the contract is updated first, in its own pull requests), and "I authorize the implementation".

### What the implementation must do

1. Move the file to `docs/history/operations/simplification-cutover.md` with the 15 other files, in the commit of D-CODE-04 that changes paths only.
2. Change line 252 of the contract in the same commit. Today it calls the file "the current cutover guide" and tells the reader to follow it. Proposed text: "Follow the approved recovery scope above. The [dated cutover record](history/operations/simplification-cutover.md) has the receipts of the completed cutover. Its issue #204 conditions remain limits on a later target change." The last sentence keeps the rule of line 26 of the file in force, so the new text changes a path and a name and no rule. This text is the answer that `CC-31` of `../contract-future/contract-changes.json` waits for.
3. Change line 9 of `README.md`: the words "and removal gates" go, and the link gets the new path and the words "dated cutover record".
4. Change the path in `.github/workflows/README.md:7` and in `apps/web/src/operations/README.md:32`. Their words already say "historical".

### Where the record states it

- `15-your-answers.html`, part `your-answers-question-history`: the second "Needs your word" item becomes a statement: "No gate of `operations/simplification-cutover.md` holds production (its lines 14, 26, 37, and 55, and `docs/evidence/issue-204-completion.md`, lines 16 to 18). The file moves. Line 252 of the contract gets the new path and keeps the conditions of the file in force. Line 9 of the README changes its words."
- `15-your-answers.html`, list `your-answers-word`: item 5 keeps only `contract-issue-1.md`, as a link to the decision D-PRE-21.
- The step "D-CODE-04" of the order of work (`demo-answers-order`) names the two lines.

### When this closure is wrong

It is wrong only if the maintainer wants the 4 conditions of lines 28 to 31 as text in `docs/` and not behind a link. Then those 4 list items go into the contract as text, and the rest of the file still moves. No fact of the repository shows a plan for a new removal under these conditions.

## 2. The index `work_tasks_review_queue` (first change of item 6)

### What the record asked

Revision r7, `15-your-answers.html`, list item 6 and row 2 of the table of `your-answers-d1-less`: "Remove one old index of the task rows. [...] It needs your word: an earlier decision of yours (D14) says 'No destructive migration, row/table/object deletion', and an index holds no data."

The question had one reason: the earlier decision D14. The repository answers if D14 applies. Without that reason, the removal is a fix with one correct behavior, as the 17 fixes of D-DATA-01.

### What it is, in simple words

Each review decision is one task row in D1 until the server has saved it. Migration 0030 (pull request #190, 2026-10-02) added an index for the poll of these rows. No statement uses that index, and D1 counts 1 written row more for each index that a write changes. So each decision writes 3 rows more than it needs.

```sql
-- apps/web/migrations/0030_review_queue_index.sql, the complete file.
CREATE INDEX work_tasks_review_queue
ON work_tasks(state, available_at, lease_until, created_at)
WHERE kind = 'review';

-- The removal: one new migration file. No applied file changes.
DROP INDEX work_tasks_review_queue;
```

### The evidence

- **Counted.** The D14 row of the contract is about "Applied backup and transfer tables with no current runtime-source name references" (`docs/current-contract.md:58`, column 2). Line 42 says: "The replacement scope below is exact." The table `work_tasks` is not a backup table or a transfer table, and an index holds no data.
- **Measured.** The D14 row came into the contract with pull request #208 (commit of 2026-10-02T21:28Z, `git log -S"D14: inventory retired data" -- docs/current-contract.md`). Pull request #237, "Reduce upload image index writes", has the maintainer as its author and was merged by him on 2026-10-03T12:10:09Z (`gh pr view 237 --repo ariakit/visonaut`). Its migration removes an index of a live table for the same reason: `apps/web/migrations/0032_upload_indexes.sql:1` is `DROP INDEX visonaut_images_run_role_key;`, and the pull request says "These indexes add writes to every uploaded image." So the repository did, one day after D14, the same kind of change.
- **Measured (local D1, round 2).** One decision for one variant writes 27 rows today and 24 without the index: the INSERT of the task row goes from 5 to 4, and each of the two UPDATEs from 4 to 3 (`apps/lab/audit/reports/round-2/d1-writes/results/review.txt:24-25`, `:61-62`, `:127`, `:131-132`, `:309`, `:313-314`). `DROP INDEX` wrote 0 rows (`apps/lab/audit/reports/round-2/d1-writes/notes.md:54`).
- **Estimate.** A decision for a whole screenshot with 4 variants writes 46 rows today (measured, `review.txt:31-32`) and 43 without the index. The 43 is not measured: it is 46 minus 3, because that decision runs each of the 3 statements one time (`review.txt:173`, `:178-179`). The author's draft had the 43 as measured.
- **Measured (SQLite 3.51.0, two runs on 2026-10-07, `scripts/plan.sql`).** The poll, the poll with the fix of D-DATA-01, the promotion guard, the deletion at the closed summary, and the reconcile statement have the same plan with and without the index. Round 1 measured the same on a local D1 (`apps/lab/audit/reports/d1/verification.md:277-284`). Nobody ran it in production D1.
- **Estimate.** The saving is 3 rows for each decision: 4,500 rows in 30 days at 50 decisions each day, which is 0.009% of the 50 million rows that Workers Paid includes.

### Why no choice is left

- The one reason for the question was D14, and D14 does not apply (the two facts above).
- No option gives something up. The index serves no statement, the removal writes 0 rows, and one `CREATE INDEX` reverses it.
- The standing rules of the maintainer give the direction: writes that repeat become fewer (rule 1), and one object fewer is simpler (rule 3).

### The words that close it

- Contract line 42 and line 58 (the scope of D14), and the act of the maintainer in pull request #237.
- The selection of "Accept the list" for D-DATA-01, which has the fix of the same poll (finding D1-09).
- 2026-10-07: "I authorize the implementation".

### What the implementation must do

1. Put one new migration file with `DROP INDEX work_tasks_review_queue;` into the pull request that adds `task.state IN ('queued','leased')` to the poll (row D1-09 of the fix list of D-DATA-01). Change no applied migration file.
2. Prove the 3 rows with the helper that counts D1 writes in a test (`apps/web/src/api/test-d1-costs.ts`, used by `apps/web/src/sql-writes.test.ts`): the task row of one decision writes 4, 3, and 3 rows in place of 5, 4, and 4.
3. Keep the second old index, `github_webhook_delivery_pr_title`: the title lookup uses it (`apps/lab/audit/reports/round-2/d1-writes/notes.md:419`).
4. Keep the 11 tables and the view of finding D1-15. D14 is about them.

### Where the record states it

- `40-data-storage.html`, part `data-scans`: the text of `fragments/closed-index.html`, which has no decision panel. New anchor: `data-scans-old-index`.
- `15-your-answers.html`, table of `your-answers-d1-less`, row 2: the state becomes "It goes with the fix of the poll (D-DATA-01). D14 is about the retired backup and transfer tables, and your pull request #237 removed an index one day after D14." The number becomes "24 in place of 27 for a decision. The removal writes 0."
- `15-your-answers.html`, list `your-answers-word`: item 6 keeps only the receipt, as a link to the decision D-PRE-23.
- `40-data-storage.html`, part `data-other`, row D1-15: "Decision D14 forbids a drop" is true for the 11 tables and the view, and not for this index.

### When this closure is wrong

It is wrong if the maintainer reads D14 as a rule for each object of the schema. The record states the removal with its reason, so he can say so in a note. If the coordinator wants an explicit word first, `withdrawn/D-PRE-22.json` and `withdrawn/D-PRE-22.html` have the panel with two options.

## 3. The row deletion of D-SCALE-03 (item 7)

### What the record asked

Item 7 of the list: "The row deletion of D-SCALE-03. It changes contract line 33 and your earlier decision D05: 'Preserve original decisions, exact tuples'. D14 is about retired backup tables. A test comes first: carried approvals and the baseline checks must work without these rows."

### What it is, in simple words

A closed run keeps, in D1, one row for each changed screenshot and one row for each decision of a reviewer. Example: a pull request with 4 changed screenshots leaves about 30 KB in D1 with no end (record, measured on a local D1). The settled answer deletes these rows 30 days after the run closed, with the images. The run row, its counts, and its capture list in R2 stay. A run that is the baseline, or that a later run still needs, is not released.

### Why no choice is left

- The maintainer selected the option in round 4. Its text said what he gives up: "A closed run older than 30 days shows its counts and its capture list, and no decision for one variant: the name of the reviewer of a single variant is lost. An approval older than the window is not copied to a later run." It also said: "Check two things first", and it named the comment at `closed-summary.ts:315`.
- The option that keeps the complete history ("Move the rows of a closed run to R2") was in the same decision, and he did not select it.
- The test is a condition of the implementation. It does not select between options. If a later run needs a row, the settled answer already says what happens: that run "is not released".
- The contract can record a rule before the code has it. `docs/current-contract.md:42`: "A selected target permits the named work; it does not prove that code, clients, live data, or deployed resources have moved to it."

### The words that close it

- Round 4: the selection of "Delete the rows of a closed run with its images", with no note.
- 2026-10-07: "3. Ok" (the contract is updated first, in its own pull requests).
- 2026-10-07: "I authorize the implementation, the GitHub writes, the two writes to production D1, and the package publication and the change in ariakit/ariakit."

### Verified in the repository

| Fact of the record                                                                        | Verdict      | Source                                                                                  |
| ----------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| Contract line 33 says that decisions and approval tuples of closed runs "remain readable" | Correct      | `docs/current-contract.md:33`                                                           |
| D05 says "Preserve original decisions, exact tuples"                                      | Correct      | `docs/current-contract.md:50`                                                           |
| D14 is about retired backup tables                                                        | Correct      | `docs/current-contract.md:58`, column 2: "Applied backup and transfer tables"           |
| A comment says that the kept rows still serve the checks                                  | Correct      | `apps/web/src/operations/closed-summary.ts:315`                                         |
| No code deletes a decision row                                                            | Correct      | no `DELETE FROM visonaut_decisions` in `apps/web/src` and `packages`, tests not counted |
| The page of an old run reads the 2 copies                                                 | Correct      | `apps/web/src/api/review.ts:242`, `closed-summary.ts:21-60`                             |
| The run row stores only the capture count                                                 | Correct      | `apps/web/migrations/0034_sparse_inventories.sql:5`                                     |
| The foreign keys to a decision row are in "migrations 0001 and 0024"                      | Not complete | see the next part                                                                       |

### Two things that the record does not have (not complete in r7)

1. **More rules change than the record names.** The record names contract line 33, D05, and D-DATA-04. The complete list is in `../contract-future/contract-changes.json`, which another agent wrote and the check compared with the repository:
   - Map row `MR-05`: D05 (`docs/current-contract.md:50`), line 33, S06 (`:137`, "Detailed active reviews, compact closed history"; its meaning is in `docs/simplification-audit/handoff-draft.md:21`: "S06 keeps a permanent compact decision and identity summary"), line 184, and the saved issue #1 lines 210 ("Keep identity/removal/acceptance metadata when historical bytes expire") and 336 ("Preserve identity and acceptance history after byte expiry").
   - Later edits in place: `CC-08` (line 26, "D1 keeps ... changed capture and comparison rows, decisions"), `CC-10` (line 33), and `CC-18` (line 184).
   - One companion document: `docs/review-guide.md:63` ("Closed history keeps the original decisions and available evidence").
   - The author's draft named 4 of these texts (D05, line 33, S06, and line 336). It did not name line 26, line 184, the saved line 210, and the review guide.
   - The maintainer selected the substance (the name of the reviewer of one variant is lost after 30 days). So this is not a new choice. But the contract pull request must replace each text, or line 5 of the contract ("Only an explicit approved change supersedes a requirement") keeps them in force.
2. **One more table points at a decision row.** The record names the reservation of an automatic approval (`0001_service.sql:160`) and the copy of a carried approval (`0024_core_simplification.sql:4`). `visonaut_decision_replacements` has 2 more foreign keys to a decision row (`0006_acceptance.sql:2-3`). No runtime code writes that table (counted: the only INSERT is in the migration and in `api.test.ts:1410`), and `closed-summary.ts:244` reads it. Also, each decision row points at its comparison row (`0001_service.sql:141`), so the decisions go first. These 5 are all foreign keys to a decision row or a comparison row (counted with `git grep "REFERENCES (ariviso|visonaut)_(decisions|comparison_rows)"`).

### What the implementation must do

In the contract pull request (first):

1. Add the map row `MR-05` of `../contract-future/contract-changes.json` for D-SCALE-03. That file has the text. Its field `dependsOn` waits for item 7: the answer is that item 7 is closed and adds no decision.
2. Do not change lines 26, 33, and 184 in that pull request. They describe current behavior. They change in the pull request that ships the deletion (`CC-08`, `CC-10`, `CC-18`).

Before the deletion code (with step 2 of D-DATA-02, not before):

3. Write the test first. It must show that these 5 readers work when the rows of a released run are gone: the carried approval (`packages/service/src/local-comparison.ts:21-37` and `:612-624`), the one automatic approval for each lineage (`local-comparison.ts:593` and `:637`), the promotion guard (`packages/service/src/baseline-promotion.ts:25-27`), the check counts of an active run and of the baseline run (`packages/service/src/review-status.ts:25-35`), and the acceptance of a closed summary (`closed-summary.ts:236-245`).
4. Define "a later run still needs". From the code, a run is needed while one of these points at one of its decisions: a row of an active run or of the baseline run, a copied decision of such a run (`source_decision_id`), or a reservation of a lineage that can get a new run. Delete in this order: reservations and replacements that point at the decisions, then the decisions, then the comparison rows.
5. Store the 3 review counts in the run row before the copies stop.
6. Change the two texts that promise a permanent summary: `apps/web/src/operations/closed-summary.ts:17-18` ("This closed review has a permanent decision summary.") and `apps/web/src/api/review.ts:678` ("The permanent decision summary remains available.").
7. Delete the copies that exist (`visonaut_closed_summary_rows` and `visonaut_closed_summary_decisions` of runs older than the window) with the same scheduled step, in parts of a fixed size. This is a one-time write of deployed code, so rule 1 accepts it. It is not one of "the two writes to production D1" of the authorization, which are the UPDATE of D-AUTH-05 and the measurement of D-SCALE-02.

### A limit of the definition of step 4

The lineage `main` always gets a new run. So with the definition of step 4, the decision of each screenshot that main introduced or removed stays with no end, with its comparison row.

- **Estimate.** For Ariakit this is small: the record has about 19 new captures each day.
- **Assumption (nobody tested it).** For a new repository it is not small. The first complete main run introduces each capture, and the service approves each one automatically (`docs/simplification-audit/contract-issue-1.md:203`, `local-comparison.ts:593` and `:627`). Then one decision row and one comparison row stay for each capture of that first run. The size of one such row pair is not measured.

If the test shows that these rows are too many, the other form is a reservation that keeps its key and has no link to a decision row. That form needs a migration of the reservation table and keeps the review behavior of today. It is an implementation choice and not a decision, while the review behavior stays the same.

### When this must come back as a decision

One case. The test of step 3 can show that no rule of step 4 keeps a review behavior of today. Example: a screenshot of an open pull request gets a second automatic approval, because the reservation of the first one was deleted. `contract-issue-1.md:204` says: "First-introduction reservation is per verified PR/main lineage". If the implementation cannot keep that rule with the deletion, it stops and brings one decision with the measured case. From the code, the rule of step 4 keeps it (**assumption**: nobody ran the test).

### Where the record states it

- `content/decisions.json`, D-SCALE-03: the settled answer stays. Its rationale gets one sentence: "It also replaces S06 (contract line 137), contract lines 26 and 184, and two sentences of the saved issue #1 text (lines 210 and 336)."
- `40-data-storage.html`, note `data-scale-checks`: add the third table (`visonaut_decision_replacements`, migration 0006), the rules of `MR-05`, and the 2 texts of step 6.
- `15-your-answers.html`, list `your-answers-word`: item 7 goes out of the list. Item 9 (the contract) gets S06, lines 26 and 184, and the saved lines 210 and 336 in its list of changed rules.
- The step of the order of work that has step 2 of D-DATA-02 names the test of step 3 as its first part.
