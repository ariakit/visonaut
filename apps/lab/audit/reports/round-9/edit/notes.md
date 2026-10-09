# Notes of the edit of revision r11 (2026-10-08)

The edit changed no decision. It made each sentence of the record true for the state of 2026-10-08.

## Files of this folder

- `verify.sh`, `verify2.sh`, `verify3.sh`: the read-only gh and git commands. `verify.log`, `verify2.log`, `verify3.log`: their output. `verify/`: the raw answers (labels, issues, issue bodies, `nav.ts` and `ui.css` of ariakit/ariakit).
- `scan.sh`, `scan-15.txt`, `scan-other.txt`: the pattern search for sentences that are history.
- `add-rationale.mjs`: adds one sentence to 5 rationales, and compares each field of `decisions.json` with the copy of r10.
- `add-issue-column.mjs`: adds the cell "Issue" to the 22 rows of the plan table, from `private/kit/filed.json`.
- `build.sh`, `build.log`: oxfmt and `build.mjs --strict`. `check.sh`, `check.log`: `check.mjs`.
- `shots.mjs`, `shots/`: the pictures at 1440 px and 400 px.

## Facts that the editor verified (measured, 2026-10-08, 03:21 to 03:40 UTC)

| Fact                                                                                                     | Command                                                                                                          |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Secret scanning alerts on, push protection off                                                           | `gh api repos/ariakit/visonaut --jq .security_and_analysis`                                                      |
| Private vulnerability reporting on                                                                       | `gh api repos/ariakit/visonaut/private-vulnerability-reporting`                                                  |
| 0 secret scanning alerts                                                                                 | `gh api "repos/ariakit/visonaut/secret-scanning/alerts?per_page=100" --jq length`                                |
| No `SECURITY.md` on main                                                                                 | `gh api "repos/ariakit/visonaut/contents/SECURITY.md?ref=main"` (404, also for `.github/SECURITY.md`)            |
| 13 labels, with names, colors, and descriptions                                                          | `gh api --paginate "repos/ariakit/visonaut/labels?per_page=100"`                                                 |
| 10 labels equal to ariakit/ariakit, but for the description of `bug`                                     | `gh api --paginate "repos/ariakit/ariakit/labels?per_page=100"` (29 labels)                                      |
| ariakit-bot: read in ariakit/visonaut, write in ariakit/ariakit                                          | `gh api repos/<repo>/collaborators/ariakit-bot/permission`                                                       |
| Branch `design-lab` at `54ae76f`, one commit on top of main (`4a87f44`)                                  | `gh api repos/ariakit/visonaut/branches/design-lab`, `gh api "repos/ariakit/visonaut/compare/main...design-lab"` |
| Tag `design-lab-r10` (annotated) at the same commit                                                      | `gh api repos/ariakit/visonaut/git/ref/tags/design-lab-r10`, `git ls-remote origin`                              |
| The commit has 2,841 files: 2,840 below `apps/lab`, and `pnpm-lock.yaml`. 0 files below `apps/lab/audit` | `git diff --name-only HEAD~1 HEAD`, `git ls-tree -r --name-only HEAD`                                            |
| `apps/lab/audit` is not on GitHub at the tag                                                             | `gh api "repos/ariakit/visonaut/contents/apps/lab/audit?ref=design-lab-r10"` (404)                               |
| `record.ts` has `auditDocument: ""`, and the README has the sentence about the folder audit              | `grep` in the worktree (counted from code)                                                                       |
| 23 issues #254 to #276, open, author diegohaz, no label, the 22 titles of the plan                       | `gh issue list --repo ariakit/visonaut --state all --search "created:>=2026-10-07" --json ...`                   |
| 43 issues in all, 0 with a label                                                                         | `gh issue list --repo ariakit/visonaut --state all --limit 300 --json number,labels`                             |
| 2 comments on #254, 1 on #255, 1 on #265 (the link to the report), 0 on #257                             | `gh api repos/ariakit/visonaut/issues/<n>/comments`                                                              |
| #257 has the short form: its body names the private brief, steps 1 to 5, and the UPDATE of step 8        | `gh api repos/ariakit/visonaut/issues/257 --jq .body`                                                            |
| 9 bodies name the tag `design-lab-r10`: #254 and 8 issues                                                | the same command for #254 to #276                                                                                |
| ariakit/ariakit#7806: title, open, labels perf, ui, p2, each set by ariakit-bot                          | `gh issue view 7806 --repo ariakit/ariakit --json ...`, `gh api repos/ariakit/ariakit/issues/7806/events`        |
| The four lines 391, 395, 1344, 1535 on main of ariakit/ariakit (`89105a18`)                              | `gh api "repos/ariakit/ariakit/contents/packages/ariakit-ui/src/styles/<file>?ref=main"`                         |
| No route name of a token route in the lab commit and in the 23 issue bodies                              | `git grep` on `HEAD`, `grep` on the saved bodies                                                                 |
| `/Users/diegohaz` in 11 files of the lab commit                                                          | `git grep -l` on `HEAD -- apps/lab`                                                                              |
| 1,568 files below `apps/lab/audit` that git would add (1,540 reports, 28 others)                         | `git ls-files --others --exclude-standard apps/lab/audit`                                                        |
| No pull request created since 2026-10-07                                                                 | `gh pr list --repo ariakit/visonaut --state all --search "created:>=2026-10-07"` (empty)                         |

## Statements that the editor could not verify

- The 6 private briefs are not on GitHub. The editor saw the 6 files in the ignored folder `apps/lab/audit/private/issues`, and no comment on #257. It did not search GitHub for their text.
- The implementation started on 2026-10-08. GitHub listed no pull request of that work at 03:21 UTC.
- The time order of the setting change and of the push of the branch.
- Which account created the labels.
- That a search of the open issues of ariakit/ariakit ran before the report was filed.
- The button "Report a vulnerability": the editor did not open the Advisories page.

## Places that changed (content against the copy of r10)

- `record.json`: `revision` is `r11`, and `date` is `2026-10-08`. Nothing else.
- `decisions.json`: one sentence at the end of the rationale of D-PRE-08, D-PRE-09, D-PRE-10, D-PRE-11, and D-PRE-12. No other field.
- `terms.json`: 8 new terms at the end: tracking issue, lab branch, second commit of the lab branch, held text, coordinator, label plan, p0, lock file.
- `findings.json`: no change.
- `sections/10-summary.html`: the comment, row 4 of the answers table, the part `summary-start`, the paragraph of the earlier revisions, the bullet about production, one bullet of "How to use this document".
- `sections/15-your-answers.html`: the comment, the heading, the lead, the parts list, two new parts (`your-answers-done`, `your-answers-left`, with the ids `your-answers-bot-role` and `your-answers-second-commit`), the heading and 5 items of `your-answers-holds`, item 11 of `your-answers-word`, the intro and the first 5 rows of the table `your-answers-round-6`, the bot item of `your-answers-later`, the intro, the limits, and steps 1 and 7 of the order demo, the plan note, a new item of "How to read the plan", a new paragraph `your-answers-plan-table` with the tracking issue, the column "Issue" of the plan table (22 links), 3 cells of the last column, 2 min-width values of the table head, the limits, the labels, and one description of the levels demo, 2 items of `your-answers-plan-rules`, the coverage paragraph, and the limits note.
- `sections/30-access-trust.html`: the comment, and the parts `access-public-issues` (first paragraph, a new list item, the caption and one row of the options table, the paragraph after the panel of D-PRE-09) and `access-repository-settings` (first paragraph, the table, a second code block, one list item, the limits note, the paragraph after the panel of D-PRE-12).
- `sections/45-code-ci-docs.html`: the comment, the paragraph after the panel of D-PRE-05, and the parts `code-lab-branch` (first paragraph, the paragraphs after the panel of D-PRE-10) and `code-issue-labels` (first paragraph, 2 list items, the text and the comments of the command block, a new table `code-issue-labels-now` with a paragraph, the limits note, the paragraphs after the panel of D-PRE-11).
- `sections/50-ui-system.html`: the comment, and the part `ui-system-speed-report` (4 paragraphs and the limits note).
- `sections/70-design-lab.html`: the comment, one sentence of the state note, a new paragraph in `design-lab-run`, the limits note of `design-lab-contract`, the last table row.
- `sections/90-decision-record.html` and `sections/95-feedback.html`: the comment and the text.
- Sections 20, 25, 35, 40, 55, 60, 65, and 80: no change.
