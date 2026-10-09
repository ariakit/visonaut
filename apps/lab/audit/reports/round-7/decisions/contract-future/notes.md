# Notes: items 9, 10, and 11 (contract and future)

Date: 2026-10-07. Worktree: `/Users/diegohaz/Developer/visonaut/.claude/worktrees/serialized-dazzling-pixel`. This lane wrote only below `/Users/diegohaz/.claude/jobs/f65a6229/tmp/round7/decisions/contract-future`. It changed no file of the worktree, made no commit, and wrote nothing on GitHub. It sent no request to production.

Skills loaded: `ariakit-general-workflow`, `ariakit-general-markdown`.

## After the independent check

An independent check repaired `decisions.json`, the two fragments, `closed.md`, and `contract-changes.json` on 2026-10-07. Its notes are in `check/notes.md`, and the files of the author are in `check/author-copy`. These statements of the notes below no longer hold:

- "5 reversals". The check verified 4 rules that the design breaks and 1 that it extends (zoom). Line 260 of the saved requirements is not verified as a change: the rule that the design changes for Approve and Reject is the earlier decision U02.
- "CP-1 first, then the move". The plan that the maintainer answered with "3. Ok" has the move first. See `closed.md`.
- Doubt 1, "The record does not say if it is in place or a cutover". Section 40 of r7 (anchor `data-inventory-cost`) names two ways for the baseline, and one writes nothing outside a normal deployment.
- "The service does not need a report" (the first draft of `D-PRE-32`). The app has the 3 sibling rules today, and it does not edit a copied file (D-UI-02). So the review page keeps that cost until Ariakit UI changes.
- "The words of the maintainer of 2026-10-07 are in the task of this lane only". The plan that he answered is in `/Users/diegohaz/.claude/jobs/f65a6229/timeline.jsonl`, line 367.
- "The fragments were not built". The check built both on a copy of r7 and on a copy of the working content: no error.

## Files of this folder

| File                      | Content                                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract-changes.json`   | The complete list: 3 pull requests, 3 new sections, 18 map rows, 33 line entries, 20 saved requirements, 21 earlier decisions, the 58 answers in 3 classes, 14 lines of other documents |
| `contract-changes.md`     | The same list for a reader. `scripts/make-md.mjs` writes it from the JSON file.                                                                                                         |
| `decisions.json`          | 2 open decisions: `D-PRE-31` and `D-PRE-32`                                                                                                                                             |
| `fragments/D-PRE-31.html` | For `content/sections/70-design-lab.html`, after the table of the anchor `design-lab-settled`, before `<h3 id="design-lab-data">`                                                       |
| `fragments/D-PRE-32.html` | For `content/sections/50-ui-system.html`, after the note "Limits" of the anchor `ui-system-speed-ariakit`, before `<h4 id="ui-system-speed-gallery">`                                   |
| `closed.md`               | The things of items 9, 10, and 11 that are not decisions                                                                                                                                |
| `scripts/verify.mjs`      | Checks each quote, each finding id, the form of the decisions, and the dashes                                                                                                           |

The ids `D-PRE-33` to `D-PRE-39` are not used.

## Commands

Each command ran from the worktree or with absolute paths. Each is read only for the repository.

| Command                                                                                                                                         | Result                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `git remote -v`                                                                                                                                 | `origin https://github.com/ariakit/visonaut.git`                                               |
| `wc -l docs/current-contract.md`                                                                                                                | 252 lines                                                                                      |
| `node scripts/contract-links.mjs words`                                                                                                         | 252 lines, 5,773 words (the record says the same)                                              |
| `node scripts/contract-links.mjs links`                                                                                                         | 98 relative links. 76 point to files that D-CODE-04 moves (the record says 76).                |
| `git log -4 -- docs/review-guide.md docs/current-contract.md`                                                                                   | Last commit `0b629ce`, 2026-10-04. Neither file changed after that.                            |
| `git log -6 --date=iso-strict 0b629ce`                                                                                                          | `0b629ce` 2026-10-04T23:42:20-03:00, `6219fdf` 2026-10-04T18:06:31-03:00                       |
| `node scripts/list-decisions.mjs summary`                                                                                                       | 58 decisions, each with the status settled                                                     |
| `node scripts/selected.mjs --full <ids>`                                                                                                        | The full text of 29 decisions                                                                  |
| `node scripts/prior-one.mjs D02 D21 D25 D39 D53 D54 ...`                                                                                        | The revision 9 decisions in `docs/simplification-audit/prior-r9.json`                          |
| `node scripts/findings.mjs exists <ids>`                                                                                                        | Each evidence id of the two decisions exists in `findings.json` (568 findings)                 |
| `gh api -H "Accept: application/vnd.github.raw" "repos/ariakit/ariakit/contents/packages/ariakit-ui/src/styles/nav.ts?ref=main"` with `grep -n` | Lines 391 and 395 have the two hover rules as built                                            |
| `gh issue list --repo ariakit/ariakit --search "glider has hover style recalculation in:title,body" --state all`                                | No issue                                                                                       |
| `gh pr list --repo ariakit/ariakit --search "glider hover has in:title,body" --state all`                                                       | 6 merged pull requests (#7500, #7536, #7551, #7393, #7554, #7465). No title names this change. |
| `gh repo view ariakit/ariakit --json visibility,hasIssuesEnabled`                                                                               | PUBLIC, issues enabled                                                                         |
| `node scripts/verify.mjs`                                                                                                                       | See the last section                                                                           |

## Facts that this lane verified in the files of today

### The contract and the saved requirements

- `docs/current-contract.md:5`: "Only an explicit approved change supersedes a requirement."
- `docs/current-contract.md:7`: each saved issue #1 requirement "remains binding unless an explicit approved rule below supersedes it".
- `docs/current-contract.md:42`: a selected target "does not prove that code, clients, live data, or deployed resources have moved to it". The new map uses the same rule.
- `docs/current-contract.md:130`: "Later approved rules below control the replaced scope." This is the reason to add a map and not to edit the rows of lines 132 to 178.
- `docs/current-contract.md:63`: "each need a separate instruction and one external owner".
- Each "text of today" of `contract-changes.json` is on its line: `scripts/verify.mjs` checks 33 line entries, 20 saved requirements, and 14 lines of other documents (67 quotes).
- `docs/simplification-audit/contract-issue-1.md:410`, `:429`, `:433`, `:447`, `:461`, `:462`: the rows D02, D21, D25, D39, D53, D54 of the revision 9 ledger.
- The name D02 has two meanings: the revision 9 D02 ("Current variant; separate whole-item actions") and the issue #204 D02 ("remove after exit checks", contract line 47). The same is true for D03, D05, D10, D11, and D16. Contract line 42 says that the two number sets are separate. Item 9 of r7 uses both sets with no label.

### Code

- `packages/security/src/oidc.ts:157-206`: the file check that D-OPS-04 removes. Lines 173 to 181 inside it are the rule of contract line 224 about the job-workflow claims.
- `packages/security/src/oidc.ts:223-227` and `:259`: the checks of `workflow_ref` and of the job name stay.
- `apps/web/wrangler.jsonc:61`: the two blob values `202fd63a...` and `4d34ca17...`. `:62`: the executor digest `be4439ac...`. They are the values of contract line 238.
- `packages/cli/src/signed-context.ts:24-28`: the CLI checks only the form of `VISONAUT_WORKFLOW_SOURCE_SHA`.
- `apps/web/src/api/workflow-owned.ts:1042`: the size and digest check. `:1066-1067`: the only call of `/validate`, in a branch for a mode that is not local. `:175-182`: the service refuses each other mode. `:1103`: the image goes to the IMAGES bucket.
- `apps/web/src/runtime.ts:49`: the startup check requires the bindings `QUARANTINE` and `COMPARATOR`.
- `apps/web/src/api/workflow-evidence.ts:203` and `apps/web/src/api/workflow-materialize.ts:707`: QUARANTINE gets manifest and plan evidence.
- `packages/service/src/work.ts:695`: `closedRunRetentionMs = 30 * 24 * 60 * 60 * 1000`.
- `apps/web/src/operations/index.ts:56` and `apps/web/src/operations/retention.ts:47`: each operations pass runs `expireRunImages`.
- `packages/service/src/work.ts:701`, `packages/service/src/retention.ts:49` and `:92`: the retention reason "rollback" is in a type, in one exclusion, and in one delete. No source file outside the tests writes a pin with this reason (one `grep` of `packages/service/src` and `apps/web/src`).
- `apps/web/src/review/review-workspace.tsx:719-727`: the variant glider has `$kind: "flat"` with a border. Contract line 192 says "bar glider".
- `apps/web/src/review/item-list.tsx:307`: the list has the bar glider.
- `apps/web/src/review/review-workspace.tsx:1113`: the text "You can close this window."
- `apps/lab/src/lab/record.ts:297-329`: the 5 lab decisions of round 2 (`UI-STAGE-BAR` "Floating pill", `UI-VARIANT-NAV` "Stepper and cover", `UI-PULL-SCOPE` "Waiting page", `UI-ROW-PICTURE` "Picture").
- `apps/lab/src/explorations/kits/ariakit/view-types.ts:16`: `zoomSteps = [0.5, 1, 2, 4, 8]`.
- `apps/lab/src/explorations/kits/ariakit/keys.tsx:194-199`: the view keys F, G, S, W, O, D.
- `apps/lab/src/components/ariakit/styles/nav.ts:381` and `:385`: the two hover rules in the lab copy.
- `apps/lab/docs/design/round-2.md:221`, `:227`, `:239`, `:289`: the status select with "Unchanged", the variant row, the floating bar, and the zoom steps.
- `packages/security/README.md:19`, `:26`, `:34`: the paragraphs that D-LOAD-03 and D-OPS-04 change.

### The words of the maintainer

- Rule 2: `apps/lab/audit/reports/round-2/feedback.md:10` and `:24`. The file is feedback round 1, dated 2026-10-06 (`:1`).
- "other customers and repositories": the notes of D-OPS-04 in `apps/lab/audit/content/record.json`.
- The words of 2026-10-07 are in the task of this lane. This lane has no file that holds them.

## Facts of the record that are wrong or incomplete today

1. **The review guide line of D-RES-02.** The decision D-RES-02 (option `no-promise` and the rationale) and section 15 say "line 21 of the review guide". Line 21 of `docs/review-guide.md` is the heading "## Inspect an item". The sentence "processing continues after the window closes" is in line 45. The file did not change after 2026-10-04.
2. **Item 9 names 9 line groups and says "among others".** The lines 24, 26, 32, 33, 48, 188, 196, 218 to 230, and 238 are correct. The list does not name these lines, which also change: 28 (D-DATA-02), 50 (D-SCALE-03; the item names D05 and not its line), 54 (D-UI-02; the item names D10), 59 and 60 (D-CODE-02), 77 (D-CODE-02), 137 (D-SCALE-03), 139 and 184 (D-OPS-06, D-DATA-04, D-SCALE-03), 140 (D-CODE-02), 148 and 149 (P01, P02; named by id), 156 (A02; named by id), 182 (D-OPS-04), 55 and 65 (D-CODE-03).
3. **Item 9 names no earlier decision for six changes.** C04, issue #204 D16 and D17, S06, C02, and issue #204 D11 also change or get a condition.
4. **"10 answers of round 1 change lines of the contract"** (section 15, row "Documents" of `your-answers-fit`). This lane could not find which 10. Its own count for all rounds is: 15 answers replace an earlier rule, 16 add or clarify one sentence, 27 need no contract text.
5. **Line 134 in D-CODE-02.** The option `correct-text` names line 134 (S01, "One D1 plus two R2 buckets") as a line to change. The text is true today and stays true: both buckets stay. Only the sentence about what each bucket holds is new (line 188).
6. **The keys W and O.** D-WORK-02 settles W and O. The rationale of D-WORK-03 says that the letters "are not selected". The lab has W and O. The two texts of the record disagree, and the repository agrees with D-WORK-02.
7. **"No thumbnails" in D-UX-04.** The lab decision UI-ROW-PICTURE has a picture in each list row, from the stored images. Section 70 of the record explains it. The settled text of D-UX-04 still ends with "there are no thumbnails".
8. **Standing rule 2 has no approved text in the contract.** The record uses the rule in 17 places. Contract lines 7 and 130 keep each "compatibility promise" binding. Item 9 does not name this.
9. **The settled design of the lab changes contract rules that no answer names.** Lines 192 and 194, the rows U02 to U06, and lines 258 to 267 of the saved requirements. This is `D-PRE-31`.

## Judgments

- **The review of the contract pull request is the approval** for each row that repeats a settled answer. No decision is necessary for the wording of D-UI-02, D-OPS-07, D-SCALE-03, or the other rows.
- **One real choice in item 9: `D-PRE-31`.** It is a choice of scope: what the contract binds about the UI, and if the contract on main can name a design that is on a branch. Four options are materially different. The evidence supports the second (the contract already has this form at line 192; the lab is the settled source), so it is recommended.
- **One small choice in item 11: `D-PRE-32`.** The words of 2026-10-07 do not name the report to Ariakit UI. "The GitHub writes" can include it. "The change in ariakit/ariakit" is singular, and the list of r7 named the report in another sentence. So this lane asks.
- **Item 10 is a reminder.** It has no option today.

## Doubts

1. **The baseline conversion of D-DATA-02 in production.** It writes to production D1 and R2, and it is not one of "the two writes" of the authorization. The record does not say if it is in place or a cutover. The coordinator must confirm that "the implementation" covers it, or ask.
2. **The deletion of the comparison Worker in Cloudflare.** If step 3 of D-CODE-02 needs a command outside the deploy workflow, it is a cloud mutation that the authorization does not name by its name.
3. **The list of UI rules in `D-PRE-31` is not complete.** This lane verified 5 reversals. Nobody compared each UI rule of the contract with each page of the lab. Candidates that this lane did not verify: P04 ("Add a virtual scrolling list") against the lab list, U06 ("Open the focused variant immediately") against the cover, and line 280 of the saved requirements ("Provide visible buttons and a shortcut toggle") against the account menu.
4. **Four entries depend on decisions of other parts of this round.** MR-02 (item 1, the validator), MR-03 (item 2, the capture limit), MR-05 (item 7, the row deletion), and CC-31 with the move (item 5). If an answer there changes a rule, the entry changes.
5. **The form of the contract edits is a proposal.** This lane proposes one new map and no edit of the old table rows. The settled text of D-CODE-02 says "correct the contract text" and its option names line 59, which is a row of the issue #204 map. `contract-changes.json` (CC-23) gives both forms.
6. **Present-tense lines.** The maintainer agreed that the contract is updated first. This lane reads that as: the approval (the map) is first, and a line that describes production changes when production changes. If the maintainer wants each line changed in the first pull request, lines 24, 218 to 230, and 238 would then describe code that is not deployed.
7. **Where the contract links the 58 answers.** The lab goes to a branch. The map rows repeat each answer in full, so the contract needs no file of the branch. A link to the record needs a tag that stays.
8. **The search in ariakit/ariakit is weak.** One issue search and one pull request search with a few words. The two rules are on main today, which is the stronger fact.
9. **The section files 50 and 70 are in work for revision r8.** The two anchors (`ui-system-speed-ariakit`, `design-lab-settled`) exist in the working copy today. If r8 moves them, the place of each fragment moves with them.
10. **The dates of the commits are not the time of the production import.** The date 2026-11-03 is the earliest day from commit dates.
11. **Each "when" of a line entry follows the order of work of r7.** If the issues get another order, the field changes.

## Result of the check

The last run of `node scripts/verify.mjs` gave this output:

```text
quotes checked: 67
decisions in the record: 58; classed: 58
decisions that are not settled: 0
D-PRE-31: 4 options, 1 recommended, 6 findings
D-PRE-32: 3 options, 1 recommended, 4 findings
OK: no failure
```

The script does not run the build of the record. The two fragments are not in a section file, so `apps/lab/audit/check.mjs` did not see them.
