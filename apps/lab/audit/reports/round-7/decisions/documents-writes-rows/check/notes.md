# Independent check of the drafts for items 5, 6, and 7

Date: 2026-10-07. Worktree: `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`. I wrote only below `/Users/diegohaz/.claude/jobs/f65a6229/tmp/round7/decisions/documents-writes-rows`. No file of the worktree changed, no GitHub write, no request to production.

Skills that I loaded and followed: `ariakit-general-workflow`, `ariakit-general-markdown`, `ariakit-ariakit-api-design`.

## Result

| Thing                                       | Author                                           | After the check                                            |
| ------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| D-PRE-21, place of the saved issue #1 text  | Decision, recommended "It moves with its folder" | Decision, same recommendation, text repaired               |
| D-PRE-22, the unused index                  | Decision, recommended "Remove the index"         | Closed (`closed.md`, part 2). The panel is in `withdrawn/` |
| D-PRE-23, receipt of a webhook with no work | Decision, recommended "No row"                   | Decision, same recommendation, text repaired               |
| `operations/simplification-cutover.md`      | Closed                                           | Closed, with a new text for contract line 252              |
| Row deletion of D-SCALE-03                  | Closed                                           | Closed, with the complete list of changed texts            |

## Files

- `decisions.json`: 2 open decisions (D-PRE-21, D-PRE-23).
- `fragments/D-PRE-21.html`, `fragments/D-PRE-23.html`: one fragment with one placeholder each.
- `fragments/closed-index.html`: the text for the index, with no placeholder.
- `closed.md`: the 3 closed things.
- `withdrawn/D-PRE-22.json`, `withdrawn/D-PRE-22.html`: the panel for the index, corrected, for the case that the coordinator wants a question.
- `check/author-copy/`: the files of the author before any repair.
- `check/scripts/`: each script that I ran. `check/trial/`: the trial builds.

## Corrections

1. **D-PRE-22 is not a decision.** The one reason for the question was the earlier decision D14. The repository answers if D14 applies: the D14 row is about "Applied backup and transfer tables" and its scope "is exact" (`docs/current-contract.md:58` and `:42`). A new fact: the D14 row came into the contract with pull request #208 on 2026-10-02, and the maintainer wrote and merged pull request #237 on 2026-10-03, whose migration starts with `DROP INDEX visonaut_images_run_role_key;` (`apps/web/migrations/0032_upload_indexes.sql:1`), for the reason "These indexes add writes to every uploaded image." No option gives something up (0 rows for the removal, no plan changes, one `CREATE INDEX` reverses it), and the saving is 0.009% of the included rows. So it fails the test "product policy, scope, or a material tradeoff". It is now part 2 of `closed.md`.
2. **"43 in place of 46 for 4 variants (measured, local D1)" was not measured.** Only the case with one variant ran without the index (`results/review.txt:61-62`). The 43 is 46 minus 3, because a decision for 4 variants runs each of the 3 task statements one time (`review.txt:173`, `:178-179`). Label: estimate.
3. **D-PRE-21, "3 lines change" and "No line of the contract changes".** Line 7 of the contract changes in each option: it also links `handoff-draft.md` and `prior-r9.json` of the same folder. The difference between the first two options is 2 lines (contract line 48 and `.gitattributes:5`) against 16 lines in 5 moved files.
4. **D-PRE-21, "about 2 times the words".** The words in `docs/` are 2 times as many when the file stays. The words in force are the same in the first two options, because the file is in force in both. The text now says so. The first version could make a reader think that the move reduces what a person must read to know each rule.
5. **D-PRE-21, the last option.** It did not say clearly that it opens a part of D-CODE-04 again (the option "A short contract with a word limit", which the maintainer did not select). It says so now.
6. **D-PRE-23, "nobody read the times" of the two other records.** Read on 2026-10-07: GitHub lists the deliveries of the past 3 days, and Cloudflare keeps the log of a Worker for 7 days on Workers Paid. `apps/web/wrangler.jsonc:15-16` has `"observability": { "enabled": true`, which turns the Worker log on (assumption: nobody read the setting in the Cloudflare account). The option "No row" now has the two numbers.
7. **D-PRE-23, one case that "No row" makes worse was missing.** When GitHub lists a webhook with no work as failed although the service got it, the recovery writes a row to `github_webhook_recovery` and asks GitHub to send it again (`github-deliveries.ts:247-282`). Today the receipt settles it (`:237`). The case is rare, and it is in the option now.
8. **D-PRE-23 did not name D-DATA-04.** The option "Give each class an end" of D-DATA-04 had "Processed webhook receipts ... are deleted by age", and the maintainer did not select it. D-PRE-23 deletes no row, so it does not open D-DATA-04 again. The context and the fragment say so.
9. **D-PRE-23 did not say why the question is material for the maintainer.** His standing rule 1 is about D1 writes that repeat. In the estimate of the audit, receipts are the largest group of such writes (`reports/round-2/d1-writes/notes.md:503-507`: 6,400 to 20,400 rows each day). The context and the fragment say so.
10. **D-PRE-23, "The newest main commit".** The commit `a7c8be2` was the newest when the author read it. The text now says "One main commit (a7c8be2, 2026-10-07)". I read it again: 33 check runs, 32 of GitHub Actions and 1 of Visonaut.
11. **D-PRE-23, an alternative with no record.** Fewer webhooks at the source (the GitHub App does not get `check_run` events) is a different design. The fragment now rejects it with its reason: that event starts the import of a run when the Submit job ends (`webhooks.ts:246-249`).
12. **The contexts were long.** The rule is "One or two sentences" (`AUTHORING.md:448`). The contexts are shorter now, start with what the thing is in simple words, and have one example each. They are still longer than two sentences, as the contexts of the settled decisions are.
13. **Cutover file: the proposed new line 252 removed a rule.** Line 26 of the file says that its conditions "remain limits on later target changes", and line 252 tells the reader to follow the file. The author's text for line 252 only named a "dated cutover record". Contract line 5 permits no silent change. The new text keeps the sentence: "Its issue #204 conditions remain limits on a later target change."
14. **Cutover file: the example of "when this closure is wrong" did not hold.** It named a later removal in the preview environment. The preview has no D1, no R2, and no queue today (`docs/current-contract.md:188`), so the conditions cannot apply to it again.
15. **D-SCALE-03: the list of changed texts was not complete.** The author named 4 (D05, contract line 33, S06, saved line 336). `../contract-future/contract-changes.json` (map row `MR-05`, `CC-08`, `CC-10`, `CC-18`) also has contract lines 26 and 184, the saved line 210, and `docs/review-guide.md:63`. I compared each with the repository. `closed.md` now points at that file and does not propose a second text for the map row.
16. **D-SCALE-03: "which is small" for the rows that stay on main.** That holds for Ariakit (about 19 new captures each day). For a new repository, the first complete main run introduces each capture with an automatic approval (`contract-issue-1.md:203`, `local-comparison.ts:627`), so one decision row stays for each capture of that run with the definition of step 4. `closed.md` has this as a limit, with the other form (a reservation with no link to a decision row).

## What I confirmed with no change

- Each count of item 5: 58 files in the audit folder, 17 in `docs/operations`, 10,240 words and 491 lines and 24 headings, 5 files with 12,242 words, 4 files with 10,385, 20,625 and 22,482, 16 lines in 5 moved files, 3 lines outside (`check/scripts/item5.mjs`).
- The first lines of both files, the 5 sentences of the cutover file, the 3 rows of `issue-204-completion.md`, and the state of issue #204 (`gh issue view 204`: closed as completed, 2026-10-02T21:50:26Z).
- The index: the complete migration, the 4 indexes of `work_tasks`, the rows 5/4/4 and 4/3/3, 27 and 24, 0 rows for `DROP INDEX`, and the same 5 query plans with and without the index (I ran `scripts/plan.sql` in SQLite 3.51.0).
- The receipt: the 2 statements and their 4 rows, the 2 rows of the one INSERT, 215 bytes, the recovery condition, the 4 kinds of read, the 9 event names, and each number of the estimate.
- The 5 foreign keys to a decision row or a comparison row, and that no runtime code deletes a decision row or writes `visonaut_decision_replacements`.
- Each option agrees with the 5 standing rules. No option reduces a D1 write by adding another that repeats, except the rare case of correction 7.

## Commands

| Command                                                               | Purpose                                        | Result                                           |
| --------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `git remote -v`                                                       | Repository check                               | `origin https://github.com/ariakit/visonaut.git` |
| `node check/scripts/backup.mjs`                                       | Copy of the author files                       | 5 entries copied to `check/author-copy/`         |
| `node check/scripts/show.mjs --list`                                  | The record                                     | Revision r8, 58 decisions, all settled           |
| `node check/scripts/item5.mjs`                                        | Counts of item 5                               | All equal to the drafts                          |
| `node check/scripts/lines.mjs ...`                                    | Each quoted file:line                          | Read by eye                                      |
| `gh issue view 204`, `gh pr view 237`, `gh api .../check-runs`        | Read-only facts                                | See corrections 1 and 10                         |
| `git log -S"D14: inventory retired data" -- docs/current-contract.md` | When D14 came into the contract                | Pull request #208, 2026-10-02                    |
| `sqlite3 :memory: ".read scripts/plan.sql"`                           | Query plans                                    | The same 5 plans with and without the index      |
| `node check/scripts/others.mjs`, `node check/scripts/mr.mjs ...`      | Drafts of the other groups (read only)         | `MR-05`, `CC-08`, `CC-10`, `CC-18`, `CC-31`      |
| `node check/scripts/validate.mjs`                                     | Form, ids, fragments, 51 quoted lines, 10 sums | See the last run in the report                   |
| `node check/scripts/trial.mjs r7`                                     | Record build on the copy of r7                 | 60 decisions, no error                           |
| `node check/scripts/trial.mjs live`                                   | Record build on a copy of the live content     | 60 decisions, no error                           |
| `node check/scripts/trial.mjs r7 --withdrawn`                         | Build with the withdrawn panel                 | 61 decisions, no error                           |

Two public documents read with a fetch tool: `docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries` and `developers.cloudflare.com/workers/observability/logs/workers-logs/`. A third gave the action names of the `check_run` event.

Not run: `check.mjs` (the browser checks of the record). I did not look at the panels in a browser.

## Doubts that stay

1. **The index is closed with no explicit word of the maintainer.** The closure adds one statement (`DROP INDEX`) to the pull request of an accepted fix. The record states it with its reason. If the coordinator wants an explicit word, the panel is in `withdrawn/`.
2. **D-PRE-21 is a small decision.** The evidence cannot select between "stay" and "move": it is a choice of how a reader finds the rules. The recommended option needs a README in `docs/history/` that names the one file in force. That README does not exist, and D-CODE-04 does not name it.
3. **D-PRE-23, the 66 webhooks.** The 2 webhooks for each check run are an assumption. One read-only statement in production gives the fact: `SELECT event, COUNT(*), MIN(received_at) FROM github_webhook_delivery GROUP BY event`. It belongs to the reads of item 3.
4. **D-PRE-23, the two retention times** come from a fetch tool that summarizes a page. I did not read the raw pages.
5. **D-SCALE-03, the definition of "a later run still needs"** is from the code and not tested. The limit of correction 16 is an assumption.
6. **D-SCALE-03, the first deletion in production** by the scheduled step of the deployed code is read as a part of "I authorize the implementation", and not as a third write to production D1. The coordinator can confirm.
7. **The contract order for D-SCALE-03** (the map row now, lines 26, 33, and 184 with the code) follows `../contract-future/contract-changes.json`. If that file changes, part 3 of `closed.md` must follow it.
8. **Section 15 is in work.** The fragments go into sections 40 and 45. The links from section 15 name parts of r7 (`your-answers-question-history`, `your-answers-d1-less`, `your-answers-word`), which exist in the live content today.
9. **The files of the other groups can change** after my read.
