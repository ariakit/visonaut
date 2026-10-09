# What the 58 settled answers of the Visonaut Audit change in docs/current-contract.md

Verified on 2026-10-07 against `docs/current-contract.md` (252 lines, 5773 words, last commit [`0b629ce`](https://github.com/ariakit/visonaut/commit/0b629cea49e2ca0a3246a95788c5aeaffeec5bef) (2026-10-04)) and `docs/simplification-audit/contract-issue-1.md`. Each 'today' text is an exact part of the named line. The script scripts/verify.mjs checks each one against the file of today.

Fact labels in this file: a quoted text of a file is counted from the file of today. A proposed text is a draft. Nothing in this file is built or approved.

## How the contract changes

- Line 5 of the contract says: 'Only an explicit approved change supersedes a requirement.' So each changed rule needs approved text in the contract.
- The contract has three kinds of text. (1) Two tables of earlier selections: the issue #204 map (lines 44 to 61) and 'Original selected rules' (lines 132 to 178). (2) Present-tense text that says what production does (for example lines 24, 26, 188, 218 to 230, 238). (3) Dated evidence (for example lines 22, 236, 240).
- Proposal for kind 1: do not edit a row. Add one new table, 'Visonaut Audit supersession map', with one row for each changed earlier selection. This is the method of the contract (line 130: 'Later approved rules below control the replaced scope').
- Proposal for kind 2: change the line only when it is true. A line that is wrong today changes in the contract pull request CP-1. A line about behavior that is not built changes in the pull request that ships the behavior, or in a contract pull request directly before it.
- Proposal for kind 3: change it with the release or the deployment that makes the new evidence.
- A map row permits the named work. It does not prove that code, clients, live data, or deployed resources have moved (the same rule as contract line 42).

## The pull requests

### CP-MOVE: Move the history to docs/history/ (D-CODE-04)

- When: First. This is the order that the maintainer agreed to on 2026-10-07 (plan item 3: 'One pull request moves the history (D-CODE-04), and a second one edits the contract lines'), and step 2 of the order of revision r7 says the same. One commit that changes paths only. It needs the answer to D-PRE-05 (the place of contract-issue-1.md).
- Content: 76 relative links of the contract point to files that move (counted today: 50 to simplification-audit/, 12 to evidence/, 6 to simplification-implementation.md, 6 to operations/, 1 to design-r9.html, 1 to issue-204-handoff-draft.md). After D-OPS-04, operations/adapter-service-pins.md moves too: 77.

### CP-1: Record the approved audit changes in the contract

- When: Directly after CP-MOVE, and before each other implementation pull request. Text only. CP-1 adds no link to a file that moves, so it can go before CP-MOVE if CP-MOVE must wait for D-PRE-05. That order differs from the agreed plan: the coordinator must say so in the record.
- Content: The new section 'Visonaut Audit supersession map' (all rows of 'mapRows'). The new section 'No backward compatibility while Ariakit is the only consumer'. The new section 'Authorization of 2026-10-07'. The change of line 7 (CC-01). The corrections of text that is wrong or misleads today: CC-05, CC-09, CC-22, and the two bucket sentences of CC-19.
- Approval: The review of this pull request by the maintainer is the approval that line 5 requires. Each row repeats an answer that the maintainer already selected.

### STEP: Present-tense edits, one for each implementation step

- When: With the pull request that ships the behavior. The field 'when' of each change names the decision.
- Content: Each change whose field 'when' starts with 'With' or 'After': CC-02 to CC-04, CC-06 to CC-08, CC-10, CC-11, CC-14 to CC-18, CC-20, CC-21, CC-24 to CC-26, CC-28 to CC-30, and the second form of CC-09 and CC-19.

## New sections

### NS-1: `## Visonaut Audit supersession map`

Place: After line 65 (the end of the section 'Issue #204 supersession map'), before '## Product export endpoint retirement' (line 67).

Proposed first paragraph:

```markdown
On 2026-10-06 and 2026-10-07, the maintainer settled 58 decisions of the Visonaut Audit. This map records the answers that replace an earlier promise. An audit identifier such as D-OPS-04 is separate from an issue #204 D-number and from a revision 9 D-number. A row permits the named work; it does not prove that code, clients, live data, or deployed resources have moved to it. The present-tense text of this guide changes when the behavior ships.
```

Source: The dates are the dates of the four feedback files: apps/lab/audit/reports/round-2/feedback.md:1 and round-3/feedback.md:1 (2026-10-06), round-4/feedback.md:1 and round-5/feedback.md:1 (2026-10-07). The 3 answers of feedback round 5 (D-PERF-01 to D-PERF-03) are of 2026-10-07.

### NS-2: `## No backward compatibility while Ariakit is the only consumer`

Place: After line 214 (the end of 'Approved PR baseline independence'), before '## Native Plan and Submit' (line 216).

Proposed text:

```markdown
On 2026-10-06, the maintainer stated: 'we don't need backward compatibility since this is still under development and only used internally by Ariakit itself. We can change anything that makes sense.' This supersedes each compatibility promise of this guide and of the saved issue #1 requirements for the forms that Visonaut gave to Ariakit: old data forms, old URLs, old CLI and adapter versions, and code for a finished rollout. One release of each package and one cutover are sufficient; a release that accepts both forms is not necessary. A pull request that removes an old form names the line that it replaces.

The rule does not cover seven things. Keep the review decisions since 2026-10-04, the accepted baseline with its images and pins, each stored run that an open pull request or a GitHub check links to, the check name `Visonaut` and the App identity at GitHub, each applied D1 migration file, and each published package version. The pin between the two repositories stays until the D-OPS-04 work removes it.

The reason of the rule is that Ariakit is the only consumer. The rule ends when a second repository or customer uses the service. Ask the maintainer again before that day.
```

Source: apps/lab/audit/reports/round-2/feedback.md:10 and :24 (the exact words). The seven exceptions: section 15 of the record, anchor your-answers-compat-unsafe.

Source of the date: apps/lab/audit/reports/round-2/feedback.md:1 names 2026-10-06 for feedback round 1, which has the note.

### NS-3: `## Authorization of 2026-10-07`

Place: After NS-2.

Proposed text:

```markdown
On 2026-10-07, the maintainer wrote: 'I authorize the implementation, the GitHub writes, the two writes to production D1, and the package publication and the change in ariakit/ariakit.' This is the separate instruction that the issue #204 map requires for these actions. The two writes to production D1 are the UPDATE that clears the stored GitHub user tokens (D-AUTH-05) and the measurement that sets the limit of changed captures (D-SCALE-02), when that limit is built. Each external write has one owner. The authorization names no other cloud mutation, no GitHub rule change, and no hosted diagnostic run.
```

Note: This section is optional. The contract can keep the authorization in the record only. The plan that the maintainer answered listed the GitHub writes as 'the branch, the issues, the pull requests'. If the decision D-PRE-08 selects a report to Ariakit UI, add one sentence that names it.

## The rows of the new map (NS-1)

The table is ready for the contract. The row MR-19 is not in it: it is the proposed text of one option of decision D-PRE-07.

```markdown
| Selected rule                                                            | Earlier promise or source rule                                                                                                                                                                                                                                             | Exact replacement and retained scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-OPS-04: the OIDC token alone proves a CI run                           | A02 (line 156, 'Pin one small visual workflow'). Revision 9 D39 as superseded on 2026-09-25 (saved requirements line 447: the pinned `app.yml` owns the matrix). Lines 24, 218 to 230, and 238. Saved requirements lines 29, 33, 142, and 149.                             | The service accepts a run from the signed GitHub Actions identity alone. Keep the checks of issuer, audience, expiry, repository and owner IDs, event, ref, run, attempt, the signed job and its name, the tested commit, and the pull request state. Remove the comparison of the two workflow Git blobs and of the adapter executor digest, the repository variable `VISONAUT_WORKFLOW_SOURCE_SHA`, and the pin runbook. The consumer needs no secret and no API key. Accepted limit: a pull request from an account with push access can replace the Submit job, or send the no-visual report for itself. The workflow edit is in the diff of that pull request. A pull request from a fork gets no check, as before.                                                                                                                                                                                                                                       |
| D-CODE-02: remove the comparison Worker in steps                         | Issue #204 D03 (line 48, 'Keep the Worker's image validation, required codecs/readers'). C04 (line 140). Issue #204 D16 (line 59, the word 'validated'). Issue #204 D17 (line 60, 'Two deployable apps'). Lines 24, 32, 77, and 188. Saved requirements lines 151 and 364. | Step 1: this guide says what the code does. Step 2: delete the old task processor and the unused D1, R2, and queue bindings of the Worker. Step 3: delete the server-comparison branch of the upload path, the `COMPARATOR` binding, and the Worker; read the request count of the Worker in Cloudflare first. The Submit job is the validator: it decodes each capture when it compares. For each uploaded image the service checks the size (2 MiB at most) and the SHA-256 digest, and it does not decode the bytes. In a run whose pull request replaced the Submit job (D-OPS-04), no step decodes the images. Keep immutable old engine and codec identity and stored approval tuples. Both R2 buckets stay: IMAGES holds the uploaded images and each run inventory, and QUARANTINE holds manifest and plan evidence and no image. After step 3 the repository has one deployable app. The diagnostic probes and the codec package are a separate step. |
| D-DATA-02: capture pages in place of one inventory object                | Line 26 ('one complete, immutable R2 inventory per run'). Line 28. Saved requirements line 129 ('Test old-client/new-server compatibility').                                                                                                                               | The CLI sends the captures as rows, 2,000 in each page, in the order of the item name and the variant name. The service stores pages of rows and one immutable page index for each run, and D1 points to the index. Review reads the unchanged captures one page at a time. In step 1, Submit validation, materialization, promotion, and the recovery check keep their code, and the service refuses a run above the capture limit with a clear reason. The limit is a setting of the service; a measurement in a Worker sets it (revision 9 D54). Step 2 makes these steps work on one page at a time and changes the service only. The accepted baseline gets the new form one time. Runs in the earlier form lose their capture list.                                                                                                                                                                                                                      |
| D-RUN-02: the first response of a run has the changes only               | P01 (line 148, 'One compact complete model'). Line 26 ('Review reads the full inventory to show unchanged items').                                                                                                                                                         | The first response of a run has the run header, the counts, and the rows that D1 stores: changed, added, and removed captures. The unchanged variants load in a second request when the reviewer opens them, searches, or follows a link to one of them. Submit stores the baseline image, the name, and the variant with each changed or removed row, in a column of a row that it already writes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D-SCALE-03: release the D1 rows of a closed run with its images          | Issue #204 D05 (line 50, 'Preserve original decisions, exact tuples'). Line 33. S06 (line 137, 'compact closed history'). Line 184. Saved requirements lines 210 and 336.                                                                                                  | This comes with step 2 of D-DATA-02, and not before. After the 30-day window, the step that deletes the images of a closed run also deletes its changed rows and its decisions in D1, in parts of a fixed size, and it writes no copy. Keep the run row, its counts, and its capture pages in R2. Do not release a run that is the baseline or that a later run still needs. A closed run that is older than the window shows its counts and its capture list, and no decision of a single variant. An approval that is older than the window is not copied to a later run. Three things come first: a test that carried approvals and the baseline checks work without these rows, a rule for the rows that reference a decision row, and the three review counts in the run row.                                                                                                                                                                             |
| D-DATA-04: the 30-day window also applies to replaced baselines          | Line 184 ('Active baselines and open reviews pin every original they need'). Saved requirements line 336 (the 30-day window and its exceptions).                                                                                                                           | The service releases the inherited-by retention pins 30 days after the newer run closes. The images of a replaced baseline are then deleted. Inventories and bookkeeping rows stay, until MR-05 applies. The retention tests exist before the first release. C01 made promoted history read-only, so no rollback predecessor needs these images.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D-OPS-06: a newer Reject stops new copies of an approval                 | C02 (line 139, 'Copy verified approval into each new run'). Line 184.                                                                                                                                                                                                      | The service makes no new copy of an approval when the lineage has a current Reject of the same exact tuple that is newer than the approval. A newer first-hand approval makes copies possible again. No existing copy is revoked, and closed history is not written.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D-OPS-07: the public check text has state titles and totals              | Revision 9 D25 ('Generic status plus a sign-in review link'). Saved requirements line 324.                                                                                                                                                                                 | Each run state has its own check title, and the summary says who acts next: a maintainer, the author, or CI. The text has three totals: the changes that need review, that are rejected, and that are approved, for example '79 changes need review'. The check, the queue, and the review page use one definition of the three totals. The text has no screenshot name, no reviewer name, no thumbnail, and no result of a single image. The review link stays and grants no access.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D-WORK-02: one stage, with the mask on at load                           | P02 (line 149, 'Load diff when selected'). Saved requirements lines 264 and 276 (the modes S, D, F and fit, 100%, 200%).                                                                                                                                                   | The viewer opens on one stage: the current image, with the mask on top for each changed variant. The mask loads with the two images and is required evidence for a decision on a changed variant. Each mode has one key: F current, G baseline in the same place, D mask off and on, S two panes, W swipe, O overlay. No held key shows the baseline. Fit enlarges a small image by whole steps. A size change, an addition, and a removal have no mask. The mask stays red.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D-WORK-03: the keys of today stay                                        | Saved requirements lines 269 to 278 (the key table has no row for G and for the left bracket key).                                                                                                                                                                         | The keys are the arrows, 1 to 6, A, X, Shift+A, Shift+X, S, D, F, G, Cmd/Ctrl+Z, and the left bracket key for the list, with W and O of D-WORK-02. The question mark key opens nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D-WORK-04: one command can approve each open change of a run             | Revision 9 D02 ('Current variant; separate whole-item actions') and D21 ('Shift+A / Shift+X'). Saved requirements line 229.                                                                                                                                                | Variant and whole screenshot stay. One menu item with no key approves each change of the run that has no decision. Four rules apply. (1) The command waits for no image; a confirmation names the count of changes and how many of them the reviewer did not open. (2) The targets are each change with no decision at the run revision that the page shows; the request carries that run revision and the count, and no list. (3) One Undo sets each target back to needs review and restores the selection. (4) When the run revision or the count differs, the server saves nothing. The server writes one decision row for each change in one transaction. A rejected variant and a failed comparison are not targets.                                                                                                                                                                                                                                     |
| D-WORK-05 and D-WORK-06: the review end and the whole-screenshot command | Saved requirements line 274 ('If none remain, stay and announce completion').                                                                                                                                                                                              | After the last review decision, a short result shows in the place of the stage, with Undo. A run with no variant to review opens on the same result: one sentence, the counts, and links to all screenshots, the queue, and the next run. A decision for the whole screenshot saves at once on the key and on the button, with no dialog; the status line shows the number of variants and an Undo button.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D-RES-02: the page promises only what it can show                        | Line 196 ('The client distinguishes sending, queued, and saved decisions'). The later approved change of 2026-10-02 (pull request #190).                                                                                                                                   | The page shows a decision as saving until its receipt is final, and then as saved. It does not say that the window can close, and the leave prompt stays on until the receipt is final. The server rule does not change: an admitted command survives a closed window, and a queue receipt is not a saved verdict.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D-UI-02: an unmodified copy of the Ariakit UI primitives                 | Issue #204 D10 (line 54, 'No pruning or replacement is selected'). U01 (line 142). Saved requirements line 247 ('Group the recipe and React component in the same file when appropriate').                                                                                 | The folder of the primitives in the app is an exact copy of upstream Ariakit UI at one pin, with all 27 components, in the upstream file layout. A script copies the files, writes NOTICE, and fails when a file differs from upstream. The app does not edit a copied file. Keep the license and the source notice. The app sets one base size in each shell and defines no size of its own (D-UI-03).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D-AUTH-05: no stored GitHub user token                                   | Saved requirements line 316 ('Encrypt stored GitHub tokens').                                                                                                                                                                                                              | The service stores no GitHub user token of a sign-in: a database hook sets the 5 token columns to NULL. One UPDATE clears the rows of today in production. The sentence about encryption then has no object.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D-CODE-03: no second run of the suite for a tree that passed             | Issue #204 D11 (line 55, 'Keep required job names and dependencies unless evidence supports a later change'). Line 65.                                                                                                                                                     | A first job of the deploy workflow compares the Git tree of the merge commit with the tree of the last commit of the pull request. When they are equal and the required checks passed, the deploy starts with no second run of the suite. When they differ, or when the job cannot tell, the full suite runs. The evidence is a count: 71 of the last 100 merges had an equal tree. Gate and the branch rule do not change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D-CODE-04 and D-CODE-05: where the documents are, and a local backend    | Q03 (line 177). Line 7 (history stays preserved). Line 188 (the environments).                                                                                                                                                                                             | The current guides stay in `docs/`. Dated records, old designs, and raw evidence move to `docs/history/` in this repository; nothing is deleted. One documented command starts the app with a local D1 database, local R2 storage, seed data, a signed local session, and a GitHub stub. Its Wrangler environment never deploys.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Notes with no replaced rule                                              | Line 83. Issue #204 D12 (line 56). Line 186. Line 198. Saved requirements line 247 ('mostly flat neutral controls').                                                                                                                                                       | Line 83 describes the D13 change and does not freeze a status code or a message: three access fixes change an answer code in an edge case (D-AUTH-01), and a conflict names the other reviewer by the stored profile name (D-RES-05, D-OPS-03). One read of `/health` after a deploy is not a second smoke project (D-CODE-01). A positive result of a live write check can serve later reads for at most 60 seconds; a write still makes its own check, with the 10-second exception for Approve and Reject (D-LOAD-03). A clean save returns the receipt and the run revision, and the page reads the model again only when the run revision is not the expected one, which keeps the rule of line 198 (D-RUN-05). One brand action in each view fits 'mostly flat neutral controls' (D-UI-04). The old `/?view=` links get no redirect (D-UX-02).                                                                                                           |
```

Code facts and dependencies of the rows:

- MR-01 (D-OPS-04: the OIDC token alone proves a CI run). Code: packages/security/src/oidc.ts:157-206 (the file check); apps/web/wrangler.jsonc:61-62 (the three pinned values); packages/cli/src/signed-context.ts:24-28 (the CLI checks only the form of the variable).
- MR-02 (D-CODE-02: remove the comparison Worker in steps). Code: apps/web/src/api/workflow-owned.ts:1042 (size and digest); apps/web/src/api/workflow-owned.ts:1066-1067 (the only call of /validate, for a mode that is not local); apps/web/src/api/workflow-owned.ts:175-182 (the service refuses each other mode); apps/web/src/api/workflow-owned.ts:1103 (the image goes to IMAGES); apps/web/src/runtime.ts:49 (the startup check requires COMPARATOR). Depends on: Item 1 of the list (the validator after D-OPS-04) is a decision of another part of this round. Its answer can change the sentence about the limit.
- MR-03 (D-DATA-02: capture pages in place of one inventory object). Depends on: Item 2 of the list (the capture limit) is a decision of another part of this round.
- MR-05 (D-SCALE-03: release the D1 rows of a closed run with its images). Code: packages/service/src/work.ts:695 (the 30-day constant). Depends on: Item 7 of the list (the row deletion) is a decision of another part of this round.
- MR-13 (D-RES-02: the page promises only what it can show). Code: apps/web/src/review/review-workspace.tsx:1113 (the text 'You can close this window.').

### MR-19, for decision D-PRE-07 only

Proposed text for the option 'rule-by-reference' of decision D-PRE-07. Not approved. The row can go in only when the tag of the lab is public, which depends on decision D-PRE-10 of another part of this round.

```markdown
| The settled design of the lab (30 lab decisions, lab record r3) | U02 (line 143: Approve, Reject, the save state, and Undo in the header of the main panel). Line 192, which replaced the U03 tabs. Line 194. Saved requirements line 262 (the thumbnail rule) and line 264 (the zoom levels). Each other rule about the layout, the place of a control, or the look, where the design differs. | The pages follow the settled design of the lab at <tag>: `apps/lab/README.md` and the folder `apps/lab/docs/design`. Where an earlier rule about the layout, the place of a control, or the look differs, the design replaces it. Verified differences: (1) a variant stepper and a row of marks that are links, with a cover on request, in place of variant links with a bar glider; (2) Approve, Reject, and Undo in a floating bar at the bottom of the stage, in place of the header of the main panel; (3) the list shows the screenshots with a change, and 'Unchanged' is an entry of the status select, in place of the group Accepted; (4) the picture of a list row shows the first variant that needs review, cropped to the change, from the stored images, in place of the first declared variant; (5) zoom keeps fit, 100%, and 200%, and adds 50%, 400%, and 800%. Not changed: the keys (MR-10), what a decision covers (MR-11), the readiness of evidence before a decision, the save and Undo rules, the privacy rules, the red mask, and Chrome Desktop as the supported browser. After the pages are in the app, a later change of the layout needs a new row. |
```

Code: apps/lab/src/lab/record.ts:297-329 (the 5 decisions of round 2); apps/lab/docs/design/round-2.md:221 (the status select), :227 (the variant row), :239 (the floating bar), :289 (the zoom levels); apps/lab/src/explorations/kits/ariakit/list/model.ts:17 (the 5 entries of the status select; no group Accepted); apps/lab/src/explorations/kits/ariakit/list/thumb.ts:93-97 (the variant of the row picture); apps/lab/src/explorations/kits/ariakit/view-types.ts:16 (zoom steps 0.5 to 8); apps/web/src/review/item-list.tsx:378 (the app of today has the group 'Accepted'); docs/simplification-audit/audit-data.json, decision U02, option single-shell ('ShellMainHeader for selected variant, Approve/Reject, save state and Undo'); finding RULE-09.

## Each changed line of the contract

### CC-01: line 7

- Text of today: "The later approved sections and [issue #204 map](#issue-204-supersession-map) control their replaced scope."
- Changed by: all changed answers
- Kind: edit in place
- Proposed: The later approved sections, the [issue #204 map](#issue-204-supersession-map), and the [Visonaut Audit map](#visonaut-audit-supersession-map) control their replaced scope.
- When: CP-1

### CC-02: line 18

- Text of today: "Playwright capture -> trusted CLI comparison -> service validation"
- Changed by: D-OPS-04, D-CODE-02
- Kind: edit in place, optional
- Proposed: Playwright capture -> CLI comparison in the signed Submit job -> service checks
- When: With D-OPS-04. The word 'trusted' came from the pinned workflow file.

### CC-03: line 22

- Text of today: "Its service pins and workflow source variable are live and verified."
- Changed by: D-OPS-04
- Kind: dated evidence
- Proposed: Remove the sentence when the service stops the comparison. The versions of the same paragraph (CLI `visonaut@0.5.4`, adapter `@visonaut/playwright@0.5.0`) change with the one release of each package.
- When: With D-OPS-04, and at the package release

### CC-04: line 24

- Text of today: "Trusted Submit verifies native Plan, the tested commit, exact workflow Git blobs, source attempts, successful required jobs, artifact digests, and the complete capture inventory."
- Changed by: D-OPS-04
- Earlier decision: A02, revision 9 D39
- Kind: edit in place
- Proposed: Submit verifies native Plan, the tested commit, source attempts, successful required jobs, artifact digests, and the complete capture inventory. The service accepts it from the signed GitHub Actions job identity and compares no workflow file.
- When: With D-OPS-04

### CC-05: line 24

- Text of today: "The service validates signed provenance, reference binding, receipt metrics, and image bytes before importing the result."
- Changed by: D-CODE-02
- Earlier decision: issue #204 D03
- Kind: edit in place: the text is wrong today
- Proposed: The service validates signed provenance, reference binding, and receipt metrics before importing the result. For each uploaded image it checks the size and the SHA-256 digest; it does not decode the bytes. The Submit job decodes each capture when it compares.
- When: CP-1
- Code: apps/web/src/api/workflow-owned.ts:1042; apps/web/src/api/workflow-owned.ts:1066-1067

### CC-06: line 26

- Text of today: "New storage uses one complete, immutable R2 inventory per run."
- Changed by: D-DATA-02
- Kind: edit in place
- Proposed: Storage uses pages of capture rows and one immutable page index in R2 for each run: 2,000 rows in each page, in the order of the item name and the variant name. D1 points to the index.
- When: With step 1 of D-DATA-02

### CC-07: line 26

- Text of today: "Review reads the full inventory to show unchanged items."
- Changed by: D-RUN-02, D-DATA-02
- Earlier decision: P01
- Kind: edit in place
- Proposed: The first response of a run has the run header, the counts, and the changed, added, and removed rows that D1 stores. Review reads the unchanged captures one page at a time, when the reviewer opens them, searches, or follows a link.
- When: With D-RUN-02 (one piece of work with step 1 of D-DATA-02)

### CC-08: line 26

- Text of today: "D1 keeps run and snapshot pointers, changed capture and comparison rows, decisions, and image ownership pins."
- Changed by: D-SCALE-03
- Earlier decision: issue #204 D05
- Kind: edit in place, later
- Proposed: D1 keeps run and snapshot pointers and image ownership pins. It keeps the changed capture and comparison rows and the decisions of a run until the release of that closed run, 30 days after it closed.
- When: With D-SCALE-03, which comes with step 2 of D-DATA-02 and not before

### CC-11: line 28

- Text of today: "Old history is not migrated."
- Changed by: D-DATA-02
- Kind: add one sentence
- Proposed: Add after the paragraph: With the page form of D-DATA-02, the accepted baseline gets the new form one time, and runs in the earlier form lose their capture list. If that conversion is a cutover, this runbook applies.
- When: With step 1 of D-DATA-02. The record does not say if the conversion is in place or a cutover.

### CC-09: line 32

- Text of today: "The private Worker validates PNG/WebP through fetch; legacy producers and queue handlers are removed."
- Changed by: D-CODE-02
- Earlier decision: issue #204 D03
- Kind: edit in place: the text is wrong today
- Proposed: The Submit job decodes each capture, and the service checks the size and the digest of each upload. The private Worker keeps PNG/WebP validation code that no upload calls; legacy producers and queue handlers are removed.
- Proposed after step 3: The Submit job decodes each capture, and the service checks the size and the digest of each upload. The comparison Worker is removed.
- When: CP-1, and again with step 3 of D-CODE-02

### CC-10: line 33

- Text of today: "Existing links, decisions, approval tuples, available images, and terminal states remain readable."
- Changed by: D-SCALE-03
- Earlier decision: issue #204 D05
- Kind: edit in place, later
- Proposed: Existing links, the run row, its counts, its capture pages, available images, and terminal states remain readable. The decisions and approval tuples of a closed run remain readable until its release, 30 days after it closed.
- When: With D-SCALE-03

### CC-23: line 59

- Text of today: "Keep public validated image bytes and private metadata, export files, and quarantine."
- Changed by: D-CODE-02
- Earlier decision: issue #204 D16
- Kind: no edit of the row: map row MR-02
- Proposed: The row stays as the record of D16. MR-02 says what 'validated' means: the size and the digest, with the decode in the Submit job. If the maintainer wants the row itself changed: Keep public image bytes that passed the size and digest checks, and private metadata, export files, and quarantine.
- When: CP-1

### CC-12: line 63

- Text of today: "Cloud mutations, deployments, package publication, consumer changes, GitHub rules, and issue updates each need a separate instruction and one external owner."
- Changed by: the authorization of 2026-10-07
- Kind: no edit
- Proposed: The line stays. The section NS-3 records the instruction of 2026-10-07 with the exact words of the maintainer.
- When: CP-1

### CC-13: line 65

- Text of today: "Keep every other build and setup step, required job name, dependency and fail-closed Gate."
- Changed by: D-CODE-03
- Earlier decision: issue #204 D11
- Kind: no edit: map row MR-16
- Proposed: The line stays. MR-16 is the later change that D11 permits when evidence supports it.
- When: CP-1

### CC-14: line 77

- Text of today: "sealed local Submit recovery, image validation, and retained data readers remain"
- Changed by: D-CODE-02
- Earlier decision: issue #204 D03
- Kind: edit in place
- Proposed: sealed local Submit recovery and retained data readers remain. The image validation of the comparison Worker is removed.
- When: With step 3 of D-CODE-02. The record of revision r7 does not name this line.

### CC-15: line 182

- Text of today: "Capture trust binds the tested commit, exact workflow attempt, successful native Plan, signed Submit, and complete shard set."
- Changed by: D-OPS-04
- Kind: add one sentence
- Proposed: Add after the sentence: The service does not check which workflow file ran. A pull request from an account with push access can replace the Submit job or send the no-visual report for itself; the edit is in the diff of that pull request.
- When: With D-OPS-04

### CC-16: line 184

- Text of today: "C02 gives a verified copied approval to the new run; later edits to the source do not revoke that copy."
- Changed by: D-OPS-06
- Earlier decision: C02
- Kind: add one sentence
- Proposed: Add after the sentence: The service makes no new copy when the lineage has a current Reject of the same tuple that is newer than the approval; a newer first-hand approval makes copies possible again.
- When: With D-OPS-06

### CC-17: line 184

- Text of today: "Active baselines and open reviews pin every original they need."
- Changed by: D-DATA-04
- Kind: add one sentence
- Proposed: Add after the sentence: A replaced baseline keeps its images for 30 days after the newer run closes; then the service releases its pins and deletes the images.
- When: With D-DATA-04, after the retention tests

### CC-18: line 184

- Text of today: "Closed-run summaries must not promise image replay after unpinned bytes expire."
- Changed by: D-SCALE-03
- Kind: edit in place, later
- Proposed: A closed run must not promise image replay after unpinned bytes expire. After its release it keeps the run row, the counts, and the capture pages, and no decision of a single variant.
- When: With D-SCALE-03

### CC-19: line 188

- Text of today: "with one D1 database and separate IMAGES and QUARANTINE R2 buckets"
- Changed by: D-CODE-02, D-CODE-05
- Earlier decision: S01
- Kind: add two sentences
- Proposed: Add after the first sentence: IMAGES holds the uploaded images and each run inventory. QUARANTINE holds manifest and plan evidence and no image. With D-CODE-05, add at the end of the paragraph: One documented local command runs the app with a local D1 database, local R2 storage, seed data, a signed local session, and a GitHub stub; its Wrangler environment never deploys.
- When: CP-1 for the two bucket sentences (true today). With D-CODE-05 for the local command.

### CC-20: line 188

- Text of today: "Trusted CLI Submit performs normal PNG comparison."
- Changed by: D-OPS-04
- Kind: edit in place, optional
- Proposed: CLI Submit performs normal PNG comparison in the signed Submit job.
- When: With D-OPS-04

### CC-21: line 188

- Text of today: "The production compare Worker retains image validation and its codecs; W08 retired legacy comparison producers and handlers after the recorded checks."
- Changed by: D-CODE-02
- Earlier decision: issue #204 D03, C04
- Kind: edit in place
- Proposed: The comparison Worker is removed. The service checks the size and the digest of each uploaded image, and the Submit job decodes each capture. W08 retired legacy comparison producers and handlers after the recorded checks.
- When: With step 3 of D-CODE-02. In CP-1 the sentence gets the words of CC-22.

### CC-22: line 188

- Text of today: "The production compare Worker retains image validation and its codecs"
- Changed by: D-CODE-02
- Kind: edit in place: the text misleads today
- Proposed: The production compare Worker retains image validation code and its codecs, and no upload calls them
- When: CP-1

### CC-32: line 192

- Text of today: "Run views and variants use navigation links with a bar glider; variant links replace the original U03 tabs."
- Changed by: the settled design of the lab (UI-VARIANT-NAV, 'Stepper and cover'), D-UI-01 row 4
- Earlier decision: U03, pull request #184
- Kind: open: decision D-PRE-07
- Proposed: With the option 'rule-by-reference' of D-PRE-07: no edit of the line, and one map row (see 'labRow'). The 58 answers alone do not change this line: row 4 of D-UI-01 restores the bar glider that the line names. That row is a fix of the app of today, and the stepper of the lab design replaces the variant strip later.
- When: After the answer to D-PRE-07
- Code: apps/web/src/review/review-workspace.tsx:719-727 (the glider is flat with a border today, since commit [`f83fef6`](https://github.com/ariakit/visonaut/commit/f83fef6bfcaeb44ad0ed8fa91d5ae6cd4a1ecc90))

### CC-33: line 194

- Text of today: "Ordinary accepted and unchanged items stay under **Accepted**."
- Changed by: the settled design of the lab (the list shows the screenshots with a change; 'Unchanged' is an entry of the status select)
- Kind: open: decision D-PRE-07
- Proposed: With the option 'rule-by-reference' of D-PRE-07: no edit of the line, and one map row (see 'labRow').
- When: After the answer to D-PRE-07
- Code: apps/web/src/review/item-list.tsx:378 (the app of today has the group 'Accepted'); apps/lab/src/explorations/kits/ariakit/list/model.ts:17 (the lab has 5 entries of a status select and no group Accepted)

### CC-24: line 196

- Text of today: "The client distinguishes sending, queued, and saved decisions; a queue receipt is not a saved verdict."
- Changed by: D-RES-02
- Kind: edit in place
- Proposed: The page shows a decision as saving until its receipt is final, and then as saved; a queue receipt is not a saved verdict. The page does not say that the window can close, and the leave prompt stays on until the receipt is final.
- When: With D-RES-02

### CC-25: line 218

- Text of today: "Pin the exact Git blobs of `.github/workflows/ci.yml` and `.github/workflows/app.yml`."
- Changed by: D-OPS-04
- Earlier decision: A02, revision 9 D39
- Kind: remove the sentence
- Proposed: The service pins no workflow file. The native CI job is `Plan`. (The rest of the line stays.)
- When: With D-OPS-04

### CC-26: line 224

- Text of today: "Native Plan tokens may omit both job-workflow claims."
- Changed by: D-OPS-04
- Kind: remove three sentences
- Proposed: Remove from 'Native Plan tokens may omit both job-workflow claims.' to 'This does not admit a different reusable workflow.' The code of these sentences is oidc.ts:173-181, inside the 50 lines that the answer removes. The other sentences of the line stay.
- When: With D-OPS-04
- Code: packages/security/src/oidc.ts:173-181

### CC-27: line 230

- Text of today: "Set `VISONAUT_CAPTURE_JOB_NAME` to `App / Visual Capture ({shard})` and `VISONAUT_SUBMIT_JOB_NAME` to `App / Visual Submit`."
- Changed by: D-OPS-04
- Kind: no edit
- Proposed: The line stays. The service still compares the name of the signed job (oidc.ts:259).
- When: No change
- Code: packages/security/src/oidc.ts:259

### CC-28: line 236

- Text of today: "CLI `visonaut@0.5.4` and adapter `@visonaut/playwright@0.5.0` are published and verified under `latest`."
- Changed by: D-OPS-04, D-OPS-05, D-DATA-02, D-CODE-01, D-DATA-01
- Kind: dated evidence
- Proposed: Replace the paragraph with the versions and the proof of the one new release of each package and of the one pull request in ariakit/ariakit. The paragraph of today becomes history.
- When: After the release and the consumer change

### CC-29: line 238

- Text of today: "Production trusts native CI Git blob `4d34ca17315b19fa90083501eb347ea23d88dda9` and App Git blob `202fd63a37199f5ac4350bd7c4e4bc44ea442216` with adapter executor digest `be4439ac7ce5eccea7b0d253687cae53b114884deed179d9dd17fd966b722e22`."
- Changed by: D-OPS-04
- Kind: edit in place
- Proposed: Production pins no workflow Git blob and no adapter executor digest. The earlier trust tuple, its dated readbacks, and its rollback record are history: see the adapter service pins record.
- When: With D-OPS-04
- Code: apps/web/wrangler.jsonc:61; apps/web/wrangler.jsonc:62

### CC-30: line 238

- Text of today: "The matching workflow source variable B is verified."
- Changed by: D-OPS-04
- Kind: remove the sentence
- Proposed: Remove. The repository variable goes away.
- When: With D-OPS-04

### CC-31: line 252

- Text of today: "Follow the approved recovery scope above and the [current cutover guide](operations/simplification-cutover.md)."
- Changed by: D-CODE-04
- Kind: depends on another decision
- Proposed: No text from this list. Item 5 of the list asks if the gates of this guide are still in use. Its answer decides if the link stays, and where the file is.
- When: With CP-MOVE

## Each changed earlier decision

| Earlier decision | Where it is                                | What it selected                                                                                                       | Changed by                                                                                                                                                                                                                                                                                             | Map row                                            | In item 9 of r7 |
| ---------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | --------------- |
| A02              | Original selected rules, contract line 156 | Pin one small visual workflow                                                                                          | D-OPS-04                                                                                                                                                                                                                                                                                               | MR-01                                              | Yes             |
| D39 (revision 9) | saved requirements line 447                | Ariakit's pinned `app.yml` owns the visual matrix and the single signed Submit dependency                              | D-OPS-04                                                                                                                                                                                                                                                                                               | MR-01                                              | Yes             |
| D25 (revision 9) | saved requirements line 433                | Generic status plus a sign-in review link                                                                              | D-OPS-07                                                                                                                                                                                                                                                                                               | MR-08                                              | Yes             |
| D10 (issue #204) | contract line 54                           | Keep copied components                                                                                                 | D-UI-02                                                                                                                                                                                                                                                                                                | MR-14                                              | Yes             |
| D02 (revision 9) | saved requirements line 410                | Current variant; separate whole-item actions                                                                           | D-WORK-04                                                                                                                                                                                                                                                                                              | MR-11                                              | Yes             |
| D21 (revision 9) | saved requirements line 429                | Shift+A / Shift+X                                                                                                      | D-WORK-04 (the two scopes stay, and a third scope is added)                                                                                                                                                                                                                                            | MR-11                                              | Yes             |
| P01              | contract line 148                          | One compact complete model                                                                                             | D-RUN-02                                                                                                                                                                                                                                                                                               | MR-04                                              | Yes             |
| P02              | contract line 149                          | Load diff when selected                                                                                                | D-WORK-02                                                                                                                                                                                                                                                                                              | MR-09                                              | Yes             |
| D03 (issue #204) | contract line 48                           | Retire legacy comparison in stages; keep the Worker's image validation                                                 | D-CODE-02                                                                                                                                                                                                                                                                                              | MR-02                                              | Yes             |
| D05 (issue #204) | contract line 50                           | All closed history is read-only; preserve original decisions, exact tuples                                             | D-SCALE-03                                                                                                                                                                                                                                                                                             | MR-05                                              | Yes             |
| C04              | contract line 140                          | Worker in production; Container as a separate probe                                                                    | D-CODE-02                                                                                                                                                                                                                                                                                              | MR-02                                              | No              |
| D16 (issue #204) | contract line 59                           | Document public validated images                                                                                       | D-CODE-02 (the meaning of 'validated')                                                                                                                                                                                                                                                                 | MR-02                                              | No              |
| D17 (issue #204) | contract line 60                           | Keep boundaries: two deployable apps                                                                                   | D-CODE-02 (one deployable app after step 3)                                                                                                                                                                                                                                                            | MR-02                                              | No              |
| S06              | contract line 137                          | Detailed active reviews, compact closed history                                                                        | D-SCALE-03 (no copy for the history of a closed run)                                                                                                                                                                                                                                                   | MR-05                                              | No              |
| C02              | contract line 139                          | Copy verified approval into each new run                                                                               | D-OPS-06 (one more condition; no reversal)                                                                                                                                                                                                                                                             | MR-07                                              | No              |
| D11 (issue #204) | contract line 55                           | Measure CI setup; keep job dependencies unless evidence supports a later change                                        | D-CODE-03 (the later change, with the count as evidence)                                                                                                                                                                                                                                               | MR-16                                              | No              |
| U01              | contract line 142                          | Use the copied components throughout                                                                                   | D-UI-02 (the copy is now unmodified)                                                                                                                                                                                                                                                                   | MR-14                                              | No              |
| Q03              | contract line 177                          | Keep a short current contract in the repo                                                                              | D-CODE-04 (the history moves; the contract text is not written again)                                                                                                                                                                                                                                  | MR-17                                              | No              |
| U02              | contract line 143                          | Use one review shell: the header of the main panel has the selected variant, Approve, Reject, the save state, and Undo | the settled design of the lab (UI-STAGE-BAR, 'Floating pill'), not one of the 58 answers. The app of today already differs (finding RULE-09)                                                                                                                                                           | MR-19 (D-PRE-07)                                   | No              |
| U03 to U06       | contract lines 144 to 147                  | Item links and variant tabs, the focused variant, page-wide arrows, review work first                                  | not compared one by one. Line 192 already replaced the U03 tabs. U05 (review work first, with a history view) agrees with the Queue and History pages of the lab. U04 and U06 are rules about arrow keys, and D-WORK-03 keeps the keys of today. The pan buttons of U04 were not compared with the lab | MR-19 (D-PRE-07), only where a difference is found | No              |
| D53 (revision 9) | saved requirements line 461                | Chrome Desktop and keyboard-only review                                                                                | none: D-RES-04 keeps it                                                                                                                                                                                                                                                                                | none                                               | No              |
| D54 (revision 9) | saved requirements line 462                | Measure first, then select numeric limits                                                                              | none: it is a condition of the capture limit of D-DATA-02 (item 2 of the list)                                                                                                                                                                                                                         | MR-03                                              | No              |

## Saved issue #1 requirements that a map row replaces

File: `docs/simplification-audit/contract-issue-1.md`. The file is a saved copy and does not change. Contract line 7 keeps each of its requirements binding until an approved rule replaces it, so each line below needs its map row.

| Line | Text of today                                                                                                                        | Changed by                                                                                                                                                                   | Map row                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 29   | The service pins the reviewed `app.yml` Git blob and signed job identity                                                             | D-OPS-04                                                                                                                                                                     | MR-01                   |
| 33   | It accepts submission only from the pinned Submit job                                                                                | D-OPS-04                                                                                                                                                                     | MR-01                   |
| 129  | Test old-client/new-server compatibility.                                                                                            | standing rule 2, D-DATA-02                                                                                                                                                   | NS-2, MR-03             |
| 142  | The service-approved `app.yml` Git blob owns the suite invocation and capture matrix.                                                | D-OPS-04                                                                                                                                                                     | MR-01                   |
| 149  | pinned app workflow source                                                                                                           | D-OPS-04                                                                                                                                                                     | MR-01                   |
| 151  | Image bytes pass through the Worker into private quarantine.                                                                         | D-CODE-02                                                                                                                                                                    | MR-02                   |
| 210  | Keep identity/removal/acceptance metadata when historical bytes expire.                                                              | D-SCALE-03                                                                                                                                                                   | MR-05                   |
| 229  | Whole-item commands freeze all added, changed, and removed comparison IDs in the current sealed item.                                | D-WORK-04                                                                                                                                                                    | MR-11                   |
| 247  | Group the recipe and React component in the same file when appropriate.                                                              | D-UI-02                                                                                                                                                                      | MR-14                   |
| 247  | Use compact, mostly flat neutral controls.                                                                                           | D-UI-04 (a reading, not a reversal)                                                                                                                                          | MR-18                   |
| 260  | review actions next to the result; commit/run identity above                                                                         | not verified as a change: the floating bar of the lab is on the stage, next to the image. The rule that the design changes for Approve and Reject is U02 (contract line 143) | none                    |
| 262  | first declared candidate variant, not the selected variant                                                                           | the settled design of the lab (UI-ROW-PICTURE): the picture shows the first variant that needs review (apps/lab/src/explorations/kits/ariakit/list/thumb.ts:93-97)           | MR-19 (D-PRE-07)        |
| 264  | Provide fit/100%/200% inspection without changing stored reference pixels.                                                           | D-WORK-02 (a Fit that enlarges) and the settled design of the lab, which keeps fit, 100%, and 200%, and adds 50%, 400%, and 800%. The rule is extended and not reversed      | MR-09, MR-19 (D-PRE-07) |
| 264  | Pixel diff paints differences red.                                                                                                   | none: the rule stays                                                                                                                                                         | MR-09                   |
| 274  | If none remain, stay and announce completion.                                                                                        | D-WORK-05                                                                                                                                                                    | MR-12                   |
| 276  | \| S / D / F \| Side-by-side / red pixel diff / full new image only.                                                                 | D-WORK-02, D-WORK-03                                                                                                                                                         | MR-09, MR-10            |
| 316  | Encrypt stored GitHub tokens.                                                                                                        | D-AUTH-05                                                                                                                                                                    | MR-15                   |
| 324  | Public checks expose only a fixed allowlist: check name, tested commit, generic running/pass/fail status, and a sign-in review link. | D-OPS-07                                                                                                                                                                     | MR-08                   |
| 336  | Preserve identity and acceptance history after byte expiry.                                                                          | D-SCALE-03                                                                                                                                                                   | MR-05                   |
| 364  | Deploy web and comparison Workers separately so decode work does not consume request-handler resources.                              | D-CODE-02                                                                                                                                                                    | MR-02                   |

## The 58 answers in three classes

- Replace an earlier rule (15): D-OPS-04, D-CODE-02, D-SCALE-03, D-DATA-02, D-RUN-02, D-WORK-02, D-WORK-04, D-WORK-05, D-OPS-07, D-OPS-06, D-UI-02, D-RES-02, D-AUTH-05, D-CODE-03, D-CODE-04.
- Add or clarify one sentence, with no reversal (16): D-DATA-04, D-CODE-05, D-WORK-03, D-WORK-06, D-RES-05, D-RUN-05, D-LOAD-03, D-AUTH-01, D-CODE-01, D-UI-04, D-UI-03, D-UX-02, D-UX-03, D-AUTH-04, D-SCALE-02, D-OPS-05.
- No contract text (27): D-LOAD-01, D-LOAD-02, D-LOAD-04, D-LOAD-05, D-RUN-01, D-RUN-03, D-RUN-04, D-AUTH-02, D-AUTH-03, D-OPS-01, D-OPS-02, D-OPS-03, D-DATA-01, D-DATA-03, D-SCALE-01, D-UI-01, D-PERF-01, D-PERF-02, D-PERF-03, D-UX-01, D-UX-04, D-UX-05, D-WORK-01, D-RES-01, D-RES-03, D-RES-04, D-RES-06.

## Other documents that change with the same answers

| File and line                    | Text of today                                                                                                                           | Changed by                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `docs/review-guide.md`:25        | Ordinary accepted and unchanged items stay under **Accepted**.                                                                          | the settled design of the lab                                                     |
| `docs/review-guide.md`:27        | The thumbnail stays tied to the item's first declared candidate variant.                                                                | the settled design of the lab (UI-ROW-PICTURE)                                    |
| `docs/review-guide.md`:32        | \| Pixel diff, `D` \| Differences in red \|                                                                                             | D-WORK-02 (D turns the mask off and on; W and O are new)                          |
| `docs/review-guide.md`:36        | \| 100% / 200% \| Original-size or enlarged inspection \|                                                                               | D-WORK-02 and the settled design of the lab                                       |
| `docs/review-guide.md`:45        | processing continues after the window closes                                                                                            | D-RES-02. The record names line 21 for this sentence: line 21 is a heading today. |
| `docs/review-guide.md`:45        | If none remain, the selection stays in place.                                                                                           | D-WORK-05                                                                         |
| `docs/review-guide.md`:49        | **Approve whole item** and **Reject whole item** apply one command to all added, changed, and removed variants in that sealed item.     | D-WORK-04 (the run approval is a third scope), D-WORK-06 (no dialog)              |
| `docs/review-guide.md`:55        | The message identifies the conflicting reviewer when one is available.                                                                  | D-RES-05 makes the sentence true                                                  |
| `docs/review-guide.md`:63        | Closed history keeps the original decisions and available evidence                                                                      | D-SCALE-03, later                                                                 |
| `docs/review-guide.md`:76        | \| `S` / `D` / `F` \| Side by side, Pixel diff, or New only \|                                                                          | D-WORK-02, D-WORK-03                                                              |
| `docs/review-guide.md`:15        | The Runs page shows the run type, tested commit, state, attempt, and creation time.                                                     | D-UX-03 (Queue, History, Status)                                                  |
| `packages/security/README.md`:19 | The default `access: "write"` checks current permission and numeric identity live, even after a cached read.                            | D-LOAD-03 (a positive write check also stores the grant for reads)                |
| `packages/security/README.md`:26 | A failed live check removes the cached grant                                                                                            | D-LOAD-03                                                                         |
| `packages/security/README.md`:34 | `verifyGitHubOidc` requires a pinned reusable workflow reference and SHA or an approved direct-workflow file blob at the signed commit. | D-OPS-04                                                                          |

## What item 9 of revision r7 does not name

- Contract line 77 ('image validation ... remain') changes with D-CODE-02.
- Contract lines 60 (D17, 'Two deployable apps') and 140 (C04) change with D-CODE-02.
- Contract line 137 (S06, 'compact closed history') and line 184 change with D-SCALE-03.
- Contract lines 55 and 65 (D11) are the base of D-CODE-03.
- Contract lines 139 and 184 (C02) get one more condition with D-OPS-06.
- Contract line 28 gets one sentence with D-DATA-02.
- Contract line 182 needs the limit of D-OPS-04 in words.
- Standing rule 2 (no backward compatibility) has no approved text in the contract. Lines 7 and 130 keep each 'compatibility promise' binding.
- The settled design of the lab changes contract lines 192 and 194, the earlier decision U02, and line 262 of the saved requirements, and it extends the zoom levels of line 264. Item 9 of r7 names none of them. Section 70 of r7 names one: 'The levels above 200% change a contract rule.' This is decision D-PRE-07.
