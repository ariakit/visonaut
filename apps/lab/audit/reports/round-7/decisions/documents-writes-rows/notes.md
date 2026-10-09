# Notes for items 5, 6, and 7

Date: 2026-10-07. Worktree: `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`. Record copy: `/Users/diegohaz/.claude/jobs/f65a6229/tmp/round6/backup-r7` (revision r7). I wrote only below `/Users/diegohaz/.claude/jobs/f65a6229/tmp/round7/decisions/documents-writes-rows`.

Skills that I loaded and followed: `ariakit-general-workflow`, `ariakit-general-markdown`.

**Changed by the independent check of 2026-10-07.** The table below is the result after the check. The other parts of this file are the notes of the author and describe his first version (3 decisions). `check/notes.md` has each correction, and `check/author-copy/` has the first version of each file. The scripts `scripts/validate.mjs` and `scripts/make-trial.mjs` and the folder `trial/` belong to the first version. The current ones are `check/scripts/validate.mjs`, `check/scripts/trial.mjs`, and `check/trial/`.

## Result

| Item | Thing                                  | Result                                                                                                                                                                      | Id       |
| ---- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 5    | `contract-issue-1.md`                  | Decision                                                                                                                                                                    | D-PRE-21 |
| 5    | `operations/simplification-cutover.md` | Closed. The repository answers the question.                                                                                                                                | none     |
| 6    | The index `work_tasks_review_queue`    | Closed by the check. D14 does not apply, and pull request #237 removed an index one day after D14. The first version had it as the decision D-PRE-22 (now in `withdrawn/`). | none     |
| 6    | Receipt for a webhook with no work     | Decision                                                                                                                                                                    | D-PRE-23 |
| 7    | The row deletion of D-SCALE-03         | Closed. The contract pull request and the implementation close it.                                                                                                          | none     |

Ids D-PRE-22 and D-PRE-24 to D-PRE-29 are not used. D-PRE-23 keeps its id, so that no id names two questions.

## Files

- `decisions.json`: 3 open decisions in the form of `content/decisions.json`.
- `fragments/D-PRE-21.html`, `fragments/D-PRE-22.html`, `fragments/D-PRE-23.html`: one fragment each. The first comment of each file names the section file and the place.
- `closed.md`: the 2 things that are not decisions.
- `scripts/`: each script that I ran. `trial/`: a copy of revision r7 with the 3 decisions, and its build.

## Where each fragment belongs

Section 15 has no decision placeholder in revision r7 (counted: 0 in `15-your-answers.html`, and 5 to 7 in each topic section). So each panel goes into its topic section, where the tradeoff is explained.

| Decision | Section file           | Place                                                                                       | New anchor                |
| -------- | ---------------------- | ------------------------------------------------------------------------------------------- | ------------------------- |
| D-PRE-21 | `45-code-ci-docs.html` | Part `code-docs-volume`, after the placeholder of D-CODE-04, before `code-structure`        | `code-docs-issue-1`       |
| D-PRE-22 | `40-data-storage.html` | Part `data-scans`, after the code block with `statusRunEligibleSql`, before `data-ancestry` | `data-scans-old-index`    |
| D-PRE-23 | `40-data-storage.html` | Part `data-retention`, after the placeholder of D-DATA-04, before `data-other`              | `data-retention-receipts` |

Order in `decisions.json` of the record, to follow the order of the panels: D-PRE-22 after D-DATA-01, D-PRE-23 after D-DATA-04, D-PRE-21 after D-CODE-04.

## Commands

Each command ran from a script file or as one plain command. No command wrote below the worktree.

| Command                                                                                                               | Purpose                                          | Result                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `git remote -v`                                                                                                       | Repository check                                 | `origin https://github.com/ariakit/visonaut.git`                                                                      |
| `node scripts/show-decisions.mjs` and `scripts/show-settled.mjs`                                                      | Read the decisions of r7                         | 58 decisions: 55 settled, 3 open                                                                                      |
| `node scripts/show-findings.mjs ...`                                                                                  | Read findings, check ids                         | D1-09, D1-10, D1-15, API-10, OPS-05, HYG-06, HYG-07, HYG-13 exist                                                     |
| `node scripts/links.mjs`                                                                                              | Files that name the 2 documents (`git grep`)     | 7 files each                                                                                                          |
| `wc -w -l` on the documents                                                                                           | Words and lines                                  | 10,240 words and 491 lines; 2,770 words and 104 lines; the 5 files that stay have 12,242 words                        |
| `node scripts/counts.mjs`                                                                                             | The numbers of the drafts                        | 58 files in the audit folder, 17 in `docs/operations`; 20,625 and 22,482 words; the receipt and index estimates       |
| `sqlite3 :memory: ".read scripts/plan.sql"`                                                                           | Query plans with and without the index           | SQLite 3.51.0. The 5 plans are the same with and without `work_tasks_review_queue`                                    |
| `gh api "repos/ariakit/ariakit/commits/main/check-runs?per_page=100"`                                                 | Check runs of one commit (read only)             | 33: 32 of `github-actions`, 1 of `visonaut-ci`                                                                        |
| `gh api "repos/ariakit/ariakit/commits/main"`                                                                         | The commit of that count (read only)             | [`a7c8be2`](https://github.com/ariakit/ariakit/commit/a7c8be20c38b79f6fde727dd14f147233b9dc4df), 2026-10-07T19:03:54Z |
| `gh issue view 204 --repo ariakit/visonaut --json state,title,closedAt,stateReason`                                   | State of issue #204 (read only)                  | CLOSED, COMPLETED, 2026-10-02T21:50:26Z                                                                               |
| `node scripts/validate.mjs`                                                                                           | Form of the drafts, finding ids, 74 quoted lines | OK after the correction of the fragment comments                                                                      |
| `node scripts/make-trial.mjs --base`, then `node apps/lab/audit/build.mjs --content trial/base --out trial/base-dist` | Build of r7 with no change                       | 16 sections, 58 decisions, no error                                                                                   |
| `node scripts/make-trial.mjs`, then `node apps/lab/audit/build.mjs --content trial/content --out trial/dist`          | Build of r7 with the 3 decisions and fragments   | 16 sections, 61 decisions, no error                                                                                   |
| `git status --short`                                                                                                  | The worktree after the builds                    | The same 2 lines as at the start: `M pnpm-lock.yaml`, `?? apps/lab/`                                                  |

Not run: `check.mjs` (the browser checks of the record) on the trial build. No request to production. No GitHub write.

## Facts that I verified, with file:line

`scripts/validate.mjs` reads each line below and compares it with the quoted words (74 lines, all equal).

### Item 5

- `docs/current-contract.md:7`: each saved issue #1 requirement "remains binding".
- `docs/current-contract.md:48`: the second link of the contract to the file.
- `docs/current-contract.md:9`: "The frozen design, audit, and issue body are not separate current authorities."
- `docs/simplification-audit/contract-issue-1.md:1-5`: the first lines. Line 5: "The issue remains the current implementation contract" (not true since 2026-10-02, by `current-contract.md:3`).
- `contract-issue-1.md:334` (the `r2.dev` rule) and `:342` (D54). Counted with `grep -c`: 0 lines with `r2.dev` or `D54` in the 5 guides that stay and in `README.md`.
- 24 headings in the file (counted with `grep -n -E "^#{1,3} "`).
- Links to the file (counted with `git grep`): `current-contract.md` 2 lines, `.gitattributes:5`, and in the audit folder `handoff-draft.md` 7, `index.html` 3, `audit-data.json` 3, `evidence/feedback-quality.md` 2, `README.md` 1. No match in `apps/web/src`, `packages`, `.github`, and `README.md`.
- `docs/simplification-audit/README.md:3`: "Keep this folder with it".
- `docs/operations/simplification-cutover.md:5`, `:14`, `:26`, `:37`, `:55`: the 5 sentences of `closed.md`.
- `docs/evidence/issue-204-completion.md:13`, `:16-18`, `:52`.
- `README.md:9`, `docs/current-contract.md:252`, `.github/workflows/README.md:7`, `apps/web/src/operations/README.md:32`, `docs/simplification-implementation.md:111` and `:246`: the links to the cutover file.
- `.github/workflows/scripts/deploy-migrations.test.mjs:19`: a pattern for the removed runner, not a link to the document.
- `docs/current-contract.md:47`, `:48`, `:51`, `:58`: the rows that hold the 4 holds of the cutover file.

### Item 6, the index

- `apps/web/migrations/0030_review_queue_index.sql:1-3`: the complete index. `0002_work.sql:16` and `0016_comparison_publication.sql:6`: the 2 other indexes. With the primary key: 4 indexes.
- `apps/web/src/operations/review-queue.ts:84-92`: the poll. `packages/service/src/baseline-promotion.ts:26`: the promotion guard. `apps/web/src/operations/closed-summary.ts:312`: the deletion.
- No `INDEXED BY` in `apps/web/src` and `packages` (counted with `git grep`).
- `apps/lab/audit/reports/d1/verification.md:277-284`: the plan on a local D1.
- `apps/lab/audit/reports/round-2/d1-writes/results/review.txt:127`, `:131`, `:132` (5, 4, 4 rows today) and `:309`, `:313`, `:314` (4, 3, 3 rows without the two old indexes). Lines 24, 25, 61, 62: 5 + 22 = 27 today and 4 + 20 = 24.
- `apps/lab/audit/reports/round-2/d1-writes/notes.md:54`: `DROP INDEX` wrote 0 rows, and `CREATE INDEX` wrote 1,001 rows for 1,000 rows. The result file `check/results/ddl.txt` of that note is not in the repository, so I could not read the raw number.
- `docs/current-contract.md:58` and `:42`: the D14 row and "The replacement scope below is exact."
- `git log` of the migration: PR #190, 2026-10-02.

### Item 6, the receipt

- `packages/security/src/webhooks.ts:84-102`: the INSERT and the SELECT. `apps/web/src/api/webhooks.ts:330-335`: the UPDATE. `:338-360`: the receiver.
- `apps/web/src/api/webhooks.ts:37`, `:38`, `:53`, `:182`, `:186`, `:193`, `:225`, `:252`, `:279`: the 9 event names with work.
- `apps/web/src/api/webhooks.ts:225-250`: only a completed `check_run` of GitHub Actions (App 15368) with the Submit job name and success sends the `ingest` message.
- `apps/web/src/operations/github-deliveries.ts:229-246`: the recovery settles a delivery when a receipt exists or when the status is from 200 to 399.
- `apps/web/src/runtime.ts:368-376` and `apps/web/wrangler.jsonc:110`: the scheduled pass of each 5 minutes runs `reconcileStagedWorkflows`, the same step as the `ingest` message.
- Readers of `github_webhook_delivery` (counted with `git grep`, tests not counted): `dashboard.ts:58`, `review.ts:288` (titles, `pull_request` only), `webhooks.ts:123`, `:125`, `:162` (the same delivery), `webhooks.ts:365` (rows that are not processed), `github-deliveries.ts:230`, `packages/security/src/webhooks.ts:99` and `:128` (the same delivery).
- `apps/lab/audit/reports/round-2/d1-writes/results/proposals.txt:2-5`: 3 + 1 rows today, 2 rows for one INSERT, 0 for the second delivery.
- `apps/lab/audit/reports/d1/report.md:443`: 215 bytes for each processed receipt.
- `docs/operations/compact-processed-webhooks.md:3` and `:5`: the purposes of a receipt, and the 30,562 receipts of 2026-09-28.
- `docs/current-contract.md:244`: a real signed `check_run` webhook with HTTP 202 and a settled receipt.

### Item 7

- `docs/current-contract.md:33`, `:50`, `:58`, `:130`, `:137`, `:42`, `:5`.
- `docs/simplification-audit/contract-issue-1.md:336` and `:204`. `docs/simplification-audit/handoff-draft.md:21`.
- `apps/web/src/operations/closed-summary.ts:17-18`, `:21-60`, `:236-245`, `:293-333` (line 315 is the comment), `:363-373`.
- `apps/web/src/api/review.ts:242` and `:678`.
- `packages/service/src/local-comparison.ts:21-37`, `:591`, `:593`, `:612-624`, `:637`. `packages/service/src/review-status.ts:25-35`. `packages/service/src/baseline-promotion.ts:25-27`.
- Foreign keys: `apps/web/migrations/0001_service.sql:141` and `:160`, `0006_acceptance.sql:2-3`, `0024_core_simplification.sql:4`.
- No `DELETE FROM visonaut_decisions` in `apps/web/src` and `packages` outside tests (counted with `git grep`).
- `apps/web/migrations/0034_sparse_inventories.sql:5`: `capture_count` is the only count column of the run row.

## Facts of the record that are wrong or not complete in r7

1. `15-your-answers.html`, part `your-answers-d1-less`, row 3: "You must say if such an event needs a receipt at all: the recovery reads the receipts." The recovery also settles a delivery by the status that GitHub lists (`github-deliveries.ts:236-239`). So the recovery does not need a receipt for a webhook that got its 202. The sentence is true and it gives a wrong reason.
2. `40-data-storage.html`, note `data-scale-checks`: "The reservation of each automatic approval and the copy of each carried approval point at a decision row with a foreign key (migrations 0001 and 0024)." Not complete. `visonaut_decision_replacements` has 2 more foreign keys (`0006_acceptance.sql:2-3`).
3. D-SCALE-03, rationale, and item 9 of the list: the changed rules are not complete. S06 (`current-contract.md:137`, "a permanent compact decision and identity summary" in `handoff-draft.md:21`) and `contract-issue-1.md:336` ("Preserve identity and acceptance history after byte expiry") also change. Two texts of the product promise a "permanent decision summary" (`closed-summary.ts:17-18`, `review.ts:678`), and the record does not name them.
4. `15-your-answers.html`, list item 6 and row 2 of the table: "It needs your word: an earlier decision of yours (D14) says ...". The D14 row is about "Applied backup and transfer tables" (`current-contract.md:58`), and line 42 says that the scope of each row is exact. So no line of the contract forbids the removal of an index. This is a reading that the record leaves open, not an error of fact. D-PRE-22 asks it as a question about the scope of D14.
5. `15-your-answers.html`, part `your-answers-question-history`: "If the gates are still in use, that file stays." The file answers this itself: no gate is pending. The same part does not say that line 252 of the contract calls the file "the current cutover guide" and tells the reader to follow it. That line needs new words, not only a new path.
6. The same part, row 2 of the table of r7 ("24 in place of 27 for a decision, with both old indexes removed"): correct. The 3 rows all come from `work_tasks_review_queue` (counted from `review.txt`), because the second old index is on the receipt table.

## Doubts

1. **The cutover file is closed, not a decision.** The task text expected two small choices for item 5. I made one decision, because the second question is a fact that the repository gives (`AUTHORING.md:463`). If the coordinator wants a panel for it: two options, "It moves" (recommended) and "It stays in `docs/operations/`", with the evidence of `closed.md`.
2. **D-PRE-23, the count of webhooks.** The 2 webhooks for each check run are an assumption. Nobody read the event subscriptions of the GitHub App or the webhook rate of production. One read-only statement gives the fact, and it belongs to the authorized reads of item 3: `SELECT event, COUNT(*), MIN(received_at) FROM github_webhook_delivery GROUP BY event`. With it, the estimate of D-PRE-23 becomes a count. The 33 check runs are from one main commit. A pull request commit can have another number.
3. **D-PRE-23, retention of the other records.** I did not read how long GitHub keeps the delivery list of an App, and how long Cloudflare keeps the Worker log. The option "No row" names both as limited (assumption).
4. **D-PRE-22, the plan check.** My check ran in SQLite 3.51.0 of this computer, and the check of round 1 ran on a local D1. Nobody ran `EXPLAIN QUERY PLAN` in production D1.
5. **D-PRE-22 is the smallest of the three.** Its saving is 4,500 rows in 30 days at 50 decisions each day. If the maintainer says yes, it can be one row of the fix list of D-DATA-01. The wider question about D14 (the 11 tables and 1 view of finding D1-15, row 12 of the compatibility table) is in none of the 11 items. D-PRE-22 does not ask it, and its context says so.
6. **D-SCALE-03, the rule "a later run still needs".** The record does not define it. `closed.md` gives a definition from the code. `visonaut_reservations.decision_id` is `NOT NULL` with a foreign key (`0001_service.sql:160`), so a reservation row must go with its decision, or the run is not released. For the lineage `main`, the reservations always have a later run, so their decision rows can stay with no end. That is one row for each screenshot that was new or removed on main, which is small. Nobody ran the test.
7. **D-SCALE-03, the first deletion in production.** The scheduled step of the deployed code deletes the copies that exist. I read this as a part of "I authorize the implementation", and not as a third write to production D1. The coordinator can confirm this reading.
8. **D-SCALE-03, the contract order.** I read "3. Ok" so: the contract pull request records the selected rule in a map now, and line 33 changes later, in the pull request that ships the deletion. Line 42 of the contract permits a selected target before its code.
9. **Section 15 is in work.** My places for the links in section 15 name parts of revision r7 (`your-answers-question-history`, `your-answers-d1-less`, `your-answers-word`). The fragments themselves go into sections 40 and 45, which nobody edits now.
10. **D-PRE-21, the word counts.** "5 files with 20,625 words" and "4 files with 10,385 words" are the state after step 9 of the order, when `operations/adapter-service-pins.md` is history. Before step 9 the numbers are 6 files with 22,482 words and 5 files with 12,242.
11. **D-PRE-21, the README of `docs/history/`.** The recommended option needs a README there that names the one file in force. That README does not exist, and D-CODE-04 does not name it.
12. **The trial build.** `build.mjs` accepts the 3 decisions and fragments on a copy of r7. I did not look at the panels in a browser, and I did not build them on r8.
