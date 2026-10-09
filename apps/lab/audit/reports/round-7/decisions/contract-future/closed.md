# Items 9, 10, and 11: what is not a decision

This file says how the record closes each thing of items 9, 10, and 11 of the list "What still needs your word" that is not a choice of the maintainer. Two things of these items are real choices: `D-PRE-31` (item 9) and `D-PRE-32` (item 11). They are in `decisions.json`.

Fact labels: "counted" is a fact from a file of today, with file and line. "Measured" is the result of a command of today. "Assumption" is not verified.

An independent check repaired this file on 2026-10-07. The file of the author is in `check/author-copy/closed.md`, and each change has its reason in `check/notes.md`.

## Item 9: the contract

### What closes it

The plan that the maintainer answered on 2026-10-07 had this item: "3. Update the contract first. Contract line 5 says that only an approved change replaces a rule, and your answers change about ten earlier decisions. One pull request moves the history (D-CODE-04), and a second one edits the contract lines. After that, the contract is the source for each later change, not the audit page." (counted: `/Users/diegohaz/.claude/jobs/f65a6229/timeline.jsonl`, line 367). The maintainer answered: "3. Ok".

Each of the 58 answers is also an approval of its own rule. Example: the rationale of D-UI-02 says that "the contract needs a new approved line", and the maintainer selected that option.

So the review of the contract pull request is the approval that contract line 5 requires. The record does not need a decision for the wording of a row.

### Why these things are not decisions

- The new approved line for D-UI-02. Its text is row MR-14 of `contract-changes.md`. It repeats the settled answer and the three earlier rules that the answer replaces (issue #204 D10, U01, and line 247 of the saved issue #1 requirements). The maintainer can change a word in the review of the pull request.
- D-SCALE-03 and D-DATA-04 disagree about the D1 rows of a closed run. The record already says which wins: the later answer (D-SCALE-03) changes D-DATA-04 for rows, and only with step 2 of D-DATA-02. Rows MR-05 and MR-06 say so. The conditions of the row deletion are item 7 of the list, which another part of this round has.
- D-OPS-04 and D-CODE-02 meet in one sentence: "the Submit job is the validator". Row MR-02 names the limit. The question if that limit is sufficient is item 1 of the list, which another part of this round has (`D-PRE-01`). Its answer can change one sentence of MR-02.
- D-UX-04 says "there are no thumbnails", and the lab decision UI-ROW-PICTURE has a picture in each list row. The maintainer resolved this in lab round 2: the picture comes from the stored images, with no thumbnail field (counted: `apps/lab/src/lab/record.ts:325-329`, and section 70 of the record). The text of D-UX-04 was not changed after that.
- D-WORK-02 names the keys W and O. The rationale of D-WORK-03 says that the letters "are not selected". The lab has W and O (counted: `apps/lab/src/explorations/kits/ariakit/keys.tsx:197-198`). So the two answers agree in the built design, and row MR-09 uses W and O.
- Row 4 of D-UI-01 restores the bar glider of the variant strip, and the lab design replaces that strip with a stepper. The two do not disagree: row 4 is a fix of the app of today, and the stepper comes with the review page (counted: section 50 of the record, anchor `ui-system-no-regret`, row 4; `apps/lab/docs/design/round-2.md:227`). The implementation can leave out row 4 only if the stepper lands first.
- When each line changes. This is a task of the implementation: a line that is wrong today changes in the contract pull request CP-1, and a line about behavior that is not built changes with the pull request that ships the behavior.

### What the implementation must do

1. Do the move of D-CODE-04 first, in one commit that changes paths only. This is the order that the maintainer agreed to, and step 2 of the order of revision r7 says the same. 76 relative links of the contract point to files that move (counted today, the same number as the record). The move needs the answer to `D-PRE-21` (the place of `contract-issue-1.md`).
2. Open the pull request CP-1 directly after the move, and before each other implementation pull request. It adds the section "Visonaut Audit supersession map" with 18 rows, the section "No backward compatibility while Ariakit is the only consumer", and, if the coordinator wants it, the section "Authorization of 2026-10-07". It changes line 7. It corrects the text that is wrong today: lines 24, 32, and 188 say that the service or the Worker validates image bytes, and the code checks only the size and the digest (counted: `apps/web/src/api/workflow-owned.ts:1042` and `:1066-1067`).
3. If the move must wait for `D-PRE-21`, CP-1 can go first, because it adds no link to a file that moves. That order differs from the agreed plan. The coordinator must say so in the record, and not hide it.
4. In each implementation pull request, change the present-tense lines that the field "When" of `contract-changes.md` names for that decision. Example: the pull request that removes the file check of D-OPS-04 changes lines 22, 24, 182, 218, 224, and 238.
5. Do not edit a row of the two tables of earlier selections (lines 44 to 61 and 132 to 178). The new map replaces their scope, as contract line 130 says. This form is a proposal of this part. The maintainer sees it in the review of CP-1.
6. Add the row MR-19 only after the answer to `D-PRE-31`, and only when the tag of the lab is public (`D-PRE-42`).

### Where the record states it

- Section 15, anchor `your-answers-fit`, row "Documents": replace the sentence about "10 answers of round 1" with the three classes of `contract-changes.md`: 15 answers replace an earlier rule, 16 add or clarify one sentence, and 27 need no contract text.
- Section 15, anchor `your-answers-order`, step "Documents": the move stays first, and CP-1 is named directly after it.
- Section 70, new anchor `design-lab-contract`: the fragment of `D-PRE-31`.
- The files `contract-changes.md` and `contract-changes.json` go to `apps/lab/audit/reports/` with the research of this round. The coordinator selects the folder.

## Item 10: rule 2 before the first other customer

### What it is

Rule 2 is the note of feedback round 1 (2026-10-06): "we don't need backward compatibility since this is still under development and only used internally by Ariakit itself. We can change anything that makes sense." (counted: `apps/lab/audit/reports/round-2/feedback.md:10` and `:24`).

The reason of the rule is in its words: "only used internally by Ariakit itself". The note to D-OPS-04 says: "in the future we might open the service to other customers and repositories." (counted: `apps/lab/audit/content/record.json`, the notes of D-OPS-04). When a second repository uses the service, the reason of rule 2 ends.

### Why it is not a decision

Nothing changes now, and no option exists today. It is a reminder with a condition. A decision would ask the maintainer about a day that has no date.

### Where the record keeps it

1. In the contract. The new section "No backward compatibility while Ariakit is the only consumer" (NS-2 of `contract-changes.md`) ends with: "The rule ends when a second repository or customer uses the service. Ask the maintainer again before that day." The contract is the file that each later implementer reads, and the lab with the record goes to a branch.
2. In the record. Section 15, anchor `your-answers-rules`, the item "Other customers" of the list "Two notes of round 2 are facts about the future". Revision r7 ends this item with "see item 10 of the list above". When the list goes, the item needs the sentence itself: "Rule 2 holds while Ariakit is the only consumer. Before the first other repository, the record asks you again."
3. In one issue, if the coordinator files a tracking issue for "other customers". It is the last node of the order and blocks nothing. It names what to ask again on that day: rule 2, an API key as a second proof of a CI run (D-OPS-04 says that it can be added later), and a check for a pull request from a fork (finding TRUST-08).

## Item 11: implementation and publication

### What closes it

The plan that the maintainer answered ended with the list "What needs your separate authorization": "the implementation itself, step by step", "GitHub writes (the branch, the issues, the pull requests)", "the two writes to production D1", and "the package publication and the change in `ariakit/ariakit`" (counted: `/Users/diegohaz/.claude/jobs/f65a6229/timeline.jsonl`, line 367).

The maintainer wrote on 2026-10-07: "I authorize the implementation, the GitHub writes, the two writes to production D1, and the package publication and the change in ariakit/ariakit."

Two other answers of the same message set the form: "2. Yes, I think we should put it in a branch when we're done with the audit." (the lab) and "4. You can file the issues yourself. I just think we should group findings into fewer issues that make sense together and have a topological order for issues so we can work on some in parallel while others wait."

### What the words cover

| Words of the maintainer           | What the record reads                                                                                                                                                          | Limit                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| "the implementation"              | The code changes of the 58 answers in `ariakit/visonaut`. The plan says of each pull request: "you review each one". A deployment follows a merge through the deploy workflow. | Not a manual change of a Cloudflare resource, and not a manual write to production.                     |
| "the GitHub writes"               | The branch, the issues, and the pull requests of the implementation in `ariakit/visonaut`, as the plan listed them                                                             | The repository is public, so each issue and each branch is public.                                      |
| "the two writes to production D1" | The UPDATE of D-AUTH-05, which clears the stored GitHub user tokens. And the measurement that sets the limit of D-SCALE-02.                                                    | D-SCALE-02 says "Nothing is built for it now", so the second write does not run in this implementation. |
| "the package publication"         | One release of `visonaut` and one of `@visonaut/playwright`, with the Changesets flow of contract line 234                                                                     | A published version cannot change.                                                                      |
| "the change in ariakit/ariakit"   | The one pull request in Ariakit that takes the new versions and deletes the line of the repository variable (D-OPS-04, D-DATA-02)                                              | One pull request.                                                                                       |

### What the words do not name

These things are not in the sentence. Only the first is a decision. The others are tasks with a stated way, so that the coordinator can see them.

- The report to Ariakit UI of the two tested rewrites. It is a public issue or pull request in `ariakit/ariakit` about `packages/ariakit-ui`. The plan had the line "Send the two tested rewrites to Ariakit UI early", and its authorization list did not name it. The list of revision r7 named it in a sentence of its own. "The change in ariakit/ariakit" is singular and fits the consumer change. So the words do not cover the report in a clear way, and they do not say its form. It is the decision `D-PRE-32`.
- The read-only reads of production (item 3 of the list). Another part of this round has them (`D-PRE-11`).
- The new form of the accepted baseline (D-DATA-02). The record names two ways, and one needs no production write outside a normal deployment: "The reader of today can stay for the baseline until the next main run replaces it: that writes nothing to D1. Or a script converts the baseline one time: the R2 writes and the pointer update of 2 rows in D1." (counted: section 40 of r7, anchor `data-inventory-cost`, and section 15 of r7, anchor `your-answers-d1-once`, which gives 0 or 2 written rows for the two ways). So the implementation takes the first way. The script of the second way is a write to production that is not one of "the two writes": it needs a separate word of the maintainer. A second cutover to a new database is not necessary, and r7 says that it "needs your separate instruction".
- The deletion of the comparison Worker in Cloudflare (step 3 of D-CODE-02). The code change ships with a pull request. The deletion of the Worker resource is one command outside the deploy workflow (assumption: a deployment of the app does not delete another Worker). Contract line 63 asks for a separate instruction for a cloud mutation, and line 252 says: "Read back exact Cloudflare and Infisical state before removing a resource or grant." So the implementation asks the maintainer for that one command when step 3 is ready. It is not a decision of the record: the maintainer already selected the removal.
- A change of a GitHub rule. No answer needs one: D-CODE-03 says that the branch rule does not change.

### The one date

The retention tests must be in the repository before 2026-11-03.

- Counted: the code of today deletes the images of a closed run with no pin 30 days after the run closed. The constant is `closedRunRetentionMs` in `packages/service/src/work.ts:695`. Each operations pass runs the step (`apps/web/src/operations/index.ts:56`, `expireRunImages` in `apps/web/src/operations/retention.ts:47`).
- Counted: the import of the baseline writes the time of the import as the time when the run closed (`apps/web/tooling/baseline-reset/reset.ts:298-311`). So no row of the new database is 30 days old before 30 days after the import.
- Counted: the storage form of today came with commit [`6219fdf`](https://github.com/ariakit/visonaut/commit/6219fdf652c8e9603db737e5e59abb36b388d351) (2026-10-04 18:06 -03:00), and the new production database with commit [`0b629ce`](https://github.com/ariakit/visonaut/commit/0b629cea49e2ca0a3246a95788c5aeaffeec5bef) (2026-10-04 23:42 -03:00). So the import was not before 2026-10-04, and the first deletion is not before 2026-11-03.
- Assumption: the time of the real import in production, and that production runs the code of the branch main. Nobody read production (the record says the same: `apps/lab/audit/reports/gap-storage-lifecycle/verification.md:199`).

This date does not depend on the implementation. The code that deletes is in the repository today, and it starts with no new deployment. So the retention tests are in the first work of the order, with rows 1 to 3 of D-OPS-01, and they have a deadline that no other work has. The release of D-DATA-04 comes only after these tests pass.

### What the implementation must do

1. Put the retention tests in the first work, with the date 2026-11-03 in their issue.
2. Name one owner for each external write: each deployment, the UPDATE of D-AUTH-05, the two package releases, and the pull request in Ariakit. Contract line 63 asks for "one external owner".
3. Run the UPDATE of D-AUTH-05 only after the allow-list of D-AUTH-01 and the token hook are deployed, as the record orders it.
4. Do not write a report in `ariakit/ariakit` about Ariakit UI before the answer to `D-PRE-32`.
5. Give the accepted baseline its new form with no script, or ask the maintainer before the script runs.
6. Ask the maintainer before the command that deletes the comparison Worker in Cloudflare.

### Where the record states it

- Section 15, anchor `your-answers-order`. The first paragraph of r7 says: "Implementation is out of scope until you authorize it." Replace it with the exact words of 2026-10-07. Step "Service fixes" says that the UPDATE "waits for your separate instruction", and step "One CLI release" says "Needs your separate instruction": both now name the authorization.
- The contract, section NS-3 of `contract-changes.md` (optional).
- Section 40, the number "First image deletion on the new form: 2026-11-03", already has the date. The order of work must name it as a deadline.
- Section 50, new anchor `ui-system-speed-report`: the fragment of `D-PRE-32`.
