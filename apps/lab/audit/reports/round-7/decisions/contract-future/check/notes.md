# Independent check of the drafts for items 9, 10, and 11

Date: 2026-10-07. The check wrote only below `/Users/diegohaz/.claude/jobs/f65a6229/tmp/round7/decisions/contract-future`. It changed no file of the worktree, made no commit, wrote nothing on GitHub, and sent no request to production. The `gh` commands were read only.

Skills loaded: `ariakit-general-workflow`, `ariakit-general-markdown`, `ariakit-ariakit-api-design`.

Fact labels: "counted" is a fact from a file of today, with file and line. "Measured" is the result of a command of today. "Assumption" is not verified.

## Result

- The two decisions stay: `D-PRE-31` and `D-PRE-32`. Each is a real choice. The check wrote both again, because each had a wrong fact in its base.
- No decision was added. Two things that the author reported as doubts have a way with no new word of the maintainer. They are tasks in `closed.md` now.
- The files of the author are in `check/author-copy`. The repaired files are `decisions.json`, `fragments/D-PRE-31.html`, `fragments/D-PRE-32.html`, `closed.md`, `contract-changes.json`, `contract-changes.md` (written again by `scripts/make-md.mjs`), `notes.md` (one new part), and `scripts/verify.mjs` (it skips `check/trial`).

## Corrections

### 1. `D-PRE-32` said that the service does not need the report

- Claim: "Your answer to D-PERF-01 (the bar glider only) removes the cost from the review page with no change of a primitive, so the service does not need a report." The fragment said the same.
- Problem: this is true for rewrite 1 only. Counted: the app has the 3 rules of the sibling rule form today (`apps/web/src/components/ariakit/styles/glider.ts:129` and `:138`, `apps/web/src/components/ariakit/components/tabs.ariakit.react.tsx:561`). The rationale of D-PERF-01 says that a key that removes tooltips "still recalculates 2,435 of 2,589 elements until Ariakit UI has the rewrite of the sibling rule shape". D-UI-02 says that the app does not edit a copied file. So the review page gets rewrite 3 only through upstream.
- Fix: the context, the options, the rationale, and the fragment now say which rewrite has value for the service. The option "No report" and the option "One issue" say that the cost of item 3 stays. The table of the fragment has a column for it.

### 2. `D-PRE-32` did not name the plan line about the rewrites

- Claim: "The list that you answered named the report in a sentence of its own."
- Problem: the maintainer answered a plan, not the list of the record. Counted: the plan had the line "Send the two tested rewrites to Ariakit UI early", and its list "What needs your separate authorization" named "GitHub writes (the branch, the issues, the pull requests)" and "the package publication and the change in `ariakit/ariakit`" (`/Users/diegohaz/.claude/jobs/f65a6229/timeline.jsonl`, line 367). The author did not have this file.
- Fix: the context and the fragment cite the plan line. The judgment stays: the words do not name the report and do not say its form, so it is a small decision.

### 3. `D-PRE-32` did not say that rewrite 1 leaves a cost

- Claim: the draft issue gave only "1,217 as built, and 72 with the rewrite".
- Problem: counted from section 50 of the record (table of the anchor `ui-system-speed-list`, form 4): with rewrites 1 and 3, the pointer over 6 rows still costs 265 ms of style and layout, against 483 ms as built and 24 ms with the bar glider only. A public issue with only the good number misleads.
- Fix: the limits of the draft issue and the consequences of the option "One pull request" have the three numbers.

### 4. `D-PRE-32`: facts of upstream were not complete

- Claim: "nav.ts lines 391 and 395" as the one fact about upstream.
- Problem: rewrite 3 is in another file, and nobody read it upstream.
- Fix: measured with `gh api` on 2026-10-07: `packages/ariakit-ui/src/styles/ui.css` on main has `ui-focus-visible` in line 1344 and `ui-sibling-selected` in line 1535, each in the form as built. `nav.ts` has the two rules in lines 391 and 395 (confirmed). The commit `643a23af` of ariakit/ariakit exists (2026-10-05). The texts name these lines.

### 5. `D-PRE-31`: "5 reversals" was not exact

- Claim: the design reverses 5 rules: line 192, line 194, line 260, line 262, and line 264 of the saved requirements.
- Problem, line 260: the rule is "review actions next to the result". The floating bar of the lab is on the stage, next to the image, so the lab does not clearly break this rule. The rule that it breaks is the earlier decision U02, whose selected answer has "ShellMainHeader for selected variant, Approve/Reject, save state and Undo" (counted: `docs/simplification-audit/audit-data.json`, decision U02, option `single-shell`; finding RULE-09).
- Problem, line 264: the rule is "Provide fit/100%/200% inspection". The lab keeps fit, 100%, and 200%, and adds 50%, 400%, and 800% (counted: `apps/lab/src/explorations/kits/ariakit/view-types.ts:16`, `apps/lab/docs/design/round-2.md:289`). This extends the rule. Section 70 of r7 already says: "The levels above 200% change a contract rule."
- Problem, line 262: the author gave no code fact for the variant of the picture. Counted: the picture shows "the first one that needs review, else the first one that is not unchanged, else the first one" (`apps/lab/src/explorations/kits/ariakit/list/thumb.ts:93-97`). So the rule is broken.
- Problem, line 194: the cell "The app of today" said "Not checked". Counted: the app has the group "Accepted" (`apps/web/src/review/item-list.tsx:378`), and the lab has 5 entries of a status select and no group (`apps/lab/src/explorations/kits/ariakit/list/model.ts:17`).
- Fix: 4 rules that the design breaks and 1 that it extends, in the decision, the fragment, row MR-19, and the lists of `contract-changes.json`.

### 6. `D-PRE-31`: "the rows U02 to U06" was too wide

- Claim: the lab design replaces U02 to U06, and the option `layout-out` said that "the rows U02 to U06 ... then bind nothing".
- Problem: counted from `docs/simplification-audit/audit-data.json`: U04 and U06 are rules about arrow keys, and the same option says that the keys stay. U05 (review work first, with a history view) agrees with the Queue and History pages of the lab. Line 192 already replaced the U03 tabs.
- Fix: the texts name U02, and the layout parts of U02 and U03 for the option `layout-out`. The list of earlier decisions has one row for U02 and one for U03 to U06 with what was not compared.

### 7. `D-PRE-31` did not use the two answers of 2026-10-07

- Claim: the recommendation rested on "contract line 192 already has this form".
- Problem: line 192 names pull request #184 and says the new rule in words in the contract. It is a similar form, not the same form. The stronger base is in the plan that the maintainer answered: the lab is "the reference" of each implementation session on a branch (answer 2), and "After that, the contract is the source for each later change, not the audit page" (answer 3).
- Fix: the rationale names the two answers first and line 192 as a similar form. The option `with-each-page` now says that it differs from answer 3 for the UI rules.

### 8. `D-PRE-31` did not name two dependencies

- Problem: the tag of the option `rule-by-reference` is public only after the lab branch is pushed. That is the decision `D-PRE-42` of another part of this round, and its recommended option pushes after the security fixes. And 2 of the 5 rules are in the saved issue #1 text, whose force is the decision `D-PRE-21`.
- Fix: the consequences of the option, the rationale, the fragment, and step 6 of `closed.md` name them. The fragment has the two ids as code text, not as links, so that the build passes if an id changes.

### 9. `D-PRE-31`: the option `layout-out` named lines 258 to 267 as layout

- Problem: counted: line 266 of the saved requirements is "Enable variant verdict actions only when its required evidence is ready", which the same option keeps.
- Fix: the option names "the layout sentences of the saved issue #1 text (for example the thumbnail rule of line 262)".

### 10. `closed.md`: the order of the two contract pull requests

- Claim: "Open the pull request CP-1 before each other implementation pull request", and then "Do the move of D-CODE-04". The author also asked the record to name CP-1 before the move.
- Problem: the plan item that the maintainer answered with "3. Ok" says: "One pull request moves the history (D-CODE-04), and a second one edits the contract lines." Step 2 of the order of r7 says: "It is first, so that each later contract edit is made one time, in the new place."
- Fix: the move is first, and CP-1 is directly after it. CP-1 can go first only if the move must wait for `D-PRE-21`, and then the coordinator says so in the record. `contract-changes.json` has the same order.

### 11. `closed.md`: the baseline of D-DATA-02 was reported as an open doubt

- Claim: "The record does not say how: in place, or with the manual cutover job."
- Problem: counted: section 40 of r7 (anchor `data-inventory-cost`) says: "The reader of today can stay for the baseline until the next main run replaces it: that writes nothing to D1. Or a script converts the baseline one time: the R2 writes and the pointer update of 2 rows in D1." Section 15 of r7 (anchor `your-answers-d1-once`) gives "0 or 2" rows.
- Fix: `closed.md` says that the implementation takes the first way, and that the script needs a separate word. It is a task, not a decision.

### 12. `closed.md`: the date had no code fact for the import

- Claim: "no run in the form of today closed before 2026-10-04", from commit dates only.
- Problem: the step that carries the claim was not cited. Counted: the import writes the time of the import as `closed_at` (`apps/web/tooling/baseline-reset/reset.ts:298-311`). Without this fact, an imported run with an old close time could be deleted sooner.
- Fix: `closed.md` cites the lines. The date 2026-11-03 holds (2026-10-04 plus 30 days). The words "is in production today" became an assumption: nobody read production.

### 13. `closed.md`: "the first work of the order"

- Problem: step 3 of the order of r7 says: "Rows 1 to 3 of D-OPS-01 and the retention tests of D-DATA-01 are first." The plan has the rows of D-OPS-01 first and the retention tests next.
- Fix: "in the first work of the order, with rows 1 to 3 of D-OPS-01".

### 14. Row MR-19 named two files of the lab

- Problem: `apps/lab/README.md` of today names `docs/design/round-4.md`, and that file does not exist yet (the lab is in work for r8).
- Fix: the row names `apps/lab/README.md` and the folder `apps/lab/docs/design`.

### 15. Commit hashes

- Problem: `closed.md` and `contract-changes.md` had bare commit hashes. The Markdown rule of the organization asks for a link.
- Fix: links to [`6219fdf`](https://github.com/ariakit/visonaut/commit/6219fdf652c8e9603db737e5e59abb36b388d351), [`0b629ce`](https://github.com/ariakit/visonaut/commit/0b629cea49e2ca0a3246a95788c5aeaffeec5bef), and [`f83fef6`](https://github.com/ariakit/visonaut/commit/f83fef6bfcaeb44ad0ed8fa91d5ae6cd4a1ecc90).

## What the check confirmed with no change

- Counted: `docs/current-contract.md` has 252 lines and 5,773 words. Lines 5, 7, 42, 63, 130, 143 to 147, 192, 194, and 252 have the quoted texts.
- Counted: `docs/simplification-audit/contract-issue-1.md` lines 245 to 280 are the section "Review UI and keyboard behavior". Lines 260, 262, and 264 have the quoted texts.
- Counted: `apps/web/src/review/review-workspace.tsx:719-727` has the flat glider, and `git blame` gives commit `f83fef6b` for each of these lines.
- Counted: `apps/lab/src/lab/record.ts` has 30 settled lab decisions (25 and 5). Lines 297 to 329 have the 5 of round 2.
- Counted: `apps/lab/docs/design/round-2.md` has 798 lines and 17,652 words. `round-3.md` has 120 lines. Lines 221, 227, 239, and 289 of `round-2.md` have the cited content.
- Counted: `apps/lab/src/explorations/kits/ariakit/keys.tsx:194-199` has F, G, S, W, O, D.
- Counted: `packages/service/src/work.ts:695`, `apps/web/src/operations/index.ts:56`, and `apps/web/src/operations/retention.ts:47`.
- Counted: `apps/lab/audit/reports/round-2/feedback.md:10` has the exact words of rule 2.
- Counted: each of the 10 evidence ids exists in `findings.json` (568 findings): RULE-05, RULE-09, RULE-02, RULE-15, RULE-16, VIEW-14, PERF-03, PERF-05, PERF-04, PERF-09.
- Counted: the numbers of PERF-03 and PERF-05 and of the table of section 50 agree with the texts: 1,217 of 1,734, 72, 483 ms, 24 ms, 63 selectors, 6,646 bytes, Chrome 154.
- Counted: `docs/review-guide.md` line 21 is a heading, and line 45 has "processing continues after the window closes". The author is correct about this error of the record.
- The JSON form has the 9 keys of a decision and the 5 keys of an option, as `content/decisions.json`. The ids `D-PRE-31` and `D-PRE-32` are not in the record.
- The anchors `design-lab-settled`, `design-lab-data`, `ui-system-speed-ariakit`, and `ui-system-speed-gallery` exist in r7 and in the working copy. The ids `design-lab-contract` and `ui-system-speed-report` are free.

## Is each decision a real choice?

- `D-PRE-31`: yes. It is a choice of scope: does the contract bind layout, and can the contract on main name a design that is on a branch? The four options differ in what binds a later pull request. The minimal option is present (`with-each-page`). The two answers of 2026-10-07 point to the recommended option, but they do not select it: the maintainer did not see that the contract would name a branch, and the option `layout-out` is a policy that only he can select.
- `D-PRE-32`: yes, a small one. The words of 2026-10-07 do not name the report. The plan proposed to "send" the rewrites and did not say a form. An issue and a pull request in a public repository are different writes with different costs.
- Item 10 is not a choice now. Item 11 is closed by the exact words. The new line for D-UI-02 is closed by the selected option.
- Hidden choices: none found. The baseline form and the deletion of the Worker are tasks with a stated way (corrections 11 and the list "What the words do not name" of `closed.md`).

## Standing rules and settled answers

- No option of the two decisions writes to D1 (rule 1) or keeps code for an old form (rule 2).
- Rule 3: the option `layout-out` is the simplest contract. The rationale of `D-PRE-31` says when it is correct.
- `D-PRE-31`, option `with-each-page`: it differs from answer 3 of 2026-10-07 for the UI rules. The option says so.
- `D-PRE-31`, option `rules-in-contract`: it goes against the earlier decision Q03 (a short contract). The option says so. It does not change D-CODE-04.
- `D-PRE-32`: no option changes D-PERF-01 or D-UI-02. The option `pull-request` says that D-PERF-01 stays.

## Commands

| Command                                                                                                                                 | Result                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `git remote -v`                                                                                                                         | `origin https://github.com/ariakit/visonaut.git`                                         |
| `node check/scripts/dump.mjs summary`                                                                                                   | 58 decisions, each settled. 568 findings.                                                |
| `node check/scripts/dump.mjs finding <10 ids>`                                                                                          | Each id exists.                                                                          |
| `node check/scripts/settled.mjs <ids>`                                                                                                  | The settled answers of 17 decisions                                                      |
| `node check/scripts/old-audit.mjs U02 U03 U04 U05 U06 P04`                                                                              | The selected options of the old audit                                                    |
| `node check/scripts/timeline.mjs` and `timeline-line.mjs 367`                                                                           | The plan that the maintainer answered                                                    |
| `git blame -L 719,727 -- apps/web/src/review/review-workspace.tsx`                                                                      | Commit `f83fef6b` for each line                                                          |
| `git rev-parse 6219fdf 0b629ce f83fef6`                                                                                                 | The three full hashes                                                                    |
| `gh api ... repos/ariakit/ariakit/contents/packages/ariakit-ui/src/styles/nav.ts?ref=main`                                              | Lines 391 and 395 have the two hover rules. Copy: `check/upstream-nav.ts`                |
| `gh api ... repos/ariakit/ariakit/contents/packages/ariakit-ui/src/styles/ui.css?ref=main`                                              | Lines 1344 and 1535 have the two custom variants as built. Copy: `check/upstream-ui.css` |
| `gh api repos/ariakit/ariakit/commits/643a23af`                                                                                         | The commit exists, 2026-10-05                                                            |
| `gh issue list --repo ariakit/ariakit --search "glider :has hover recalculation" --state all`                                           | No issue                                                                                 |
| `gh issue list --repo ariakit/ariakit --search "style recalculation ariakit-ui" --state all`                                            | 1 issue, about another subject (#7358)                                                   |
| `gh pr list --repo ariakit/ariakit --search "ui-focus-visible OR ui-sibling-selected OR invalidation" --state all --limit 10`           | 10 merged pull requests. No title names this change.                                     |
| `node check/scripts/repair-json.mjs`, `repair-json-2.mjs`, `repair-json-3.mjs`, then `node scripts/make-md.mjs`                         | `contract-changes.json` and `contract-changes.md` repaired                               |
| `node check/scripts/make-trial.mjs r7`, then `node apps/lab/audit/build.mjs --content check/trial/r7/content --out check/trial/r7/dist` | 16 sections, 60 decisions, no error                                                      |
| `node check/scripts/make-trial.mjs working`, then the same build with `check/trial/working`                                             | 16 sections, 60 decisions, no error                                                      |
| `node scripts/verify.mjs`                                                                                                               | 67 quotes checked. "OK: no failure"                                                      |

## Doubts that stay

1. The check did not open the trial build in a browser. `build.mjs` accepts both fragments and both decisions. `check.mjs` (the browser checks of the record) did not run.
2. The trial used the working copy of sections 50 and 70 at one moment. Revision r8 is in work, so the anchors can move before the merge.
3. In document order, `D-PRE-32` (section 50) comes before `D-PRE-31` (section 70). The merge must put them in that order in `decisions.json`: `D-PRE-32` after `D-PERF-02`.
4. The list of UI rules that the design changes is not complete. Not compared: the virtual list of P04, the pan buttons of U04, and each other sentence of lines 258 to 267 of the saved requirements.
5. `D-PRE-31` depends on `D-PRE-42` (when the lab branch is public) and on `D-PRE-21` (the force of the saved issue #1 text). If the coordinator changes one of these ids, two texts change.
6. The deletion of the comparison Worker in Cloudflare is one command outside the deploy workflow (assumption). The check closed it as "ask at that step". If the coordinator reads "the implementation" as a cover for it, the task goes away.
7. The proposed contract section NS-2 keeps "the review decisions since 2026-10-04", and row MR-05 (D-SCALE-03) deletes the decisions of a closed run after 30 days. The two texts need one sentence that joins them. Item 7 of the list is in another part of this round, so the check changed neither text.
8. The form of the contract edits (one new map, no edit of the old table rows) is a proposal of the author. The check did not change it. The maintainer sees it in the review of CP-1.
9. The check did not verify each of the 67 quotes by hand. The script `scripts/verify.mjs` checks each quote against its line, and the check read the script.
10. The date 2026-11-03 is the earliest day from commit dates. Nobody read the time of the real import in production.
11. The effort values ("about one hour", "Effort M", "about 150 words") are estimates of the author. The check did not measure them.
