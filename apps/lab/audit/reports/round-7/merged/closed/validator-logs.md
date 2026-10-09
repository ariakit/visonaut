<!--
  Merged copy with the final decision ids.
  Source: /Users/diegohaz/.claude/jobs/f65a6229/tmp/round7/decisions/validator-logs/closed.md
  A path that starts with check/, withdrawn/, evidence/, or scripts/, and the file notes.md,
  are in the source folder.
  A path fragments/<decision id>.html, a path closed-fragments/..., and the draft decisions.json
  are in the merged folder: /Users/diegohaz/.claude/jobs/f65a6229/tmp/round7/merged
  The files contract-changes.md, contract-changes.json, and sensitive-findings.json are in the
  folder data/ of the merged folder.
-->

# Items 1 and 8: the things that are not decisions

Items 1 and 8 of the list "What still needs your word" (`15-your-answers.html`, anchor `your-answers-word`) hold three real choices. They are D-PRE-01, D-PRE-02, and D-PRE-03 in `decisions.json`. The six things below are in the same two items, and they are not choices any more.

The two sentences of the maintainer that close them, in his exact words of 2026-10-07:

- "3. Ok" (the reply to the proposal that the contract is updated first, in its own pull requests).
- "I authorize the implementation, the GitHub writes, the two writes to production D1, and the package publication and the change in ariakit/ariakit."

A second agent checked this file on 2026-10-07. Its changes are in `check/check-notes.md`.

## C1. The contract sentence about the validator

What it is: the settled answer to D-CODE-02 says "The contract then says that the Submit job is the validator". Its rationale says "The contract sentence about the validator must name this limit". The limit is the run with a replaced Submit job.

Why it is not a choice: the contract change is approved. Only the words of one sentence depend on D-PRE-01.

Words that close it: "3. Ok".

What the implementation must do: in the contract pull request, change `docs/current-contract.md` lines 24 and 32, the row D03 at line 48, and line 188, as D-CODE-02 says. Write the sentence about the limit from the answer to D-PRE-01. The rest of the contract pull request does not wait for D-PRE-01.

| Answer to D-PRE-01 | The sentence                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Option 1           | The CLI in the Submit job decodes each image. When a pull request replaces that job, the service checks only the size and the digest of the bytes. It does not confirm that the bytes are an image. |
| Option 2           | The same, and: the service also checks the PNG signature and the size in the PNG header. It does not read the image data.                                                                           |
| Option 3           | The service parses the structure of each uploaded PNG. It does not decode the pixels.                                                                                                               |
| Option 4           | Lines 32 and 188 stay as they are, and the code changes to do what they say.                                                                                                                        |

The sentence for option 1 must not name the review page as a protection. Measured on 2026-10-07 (`check/browser-bad-images.json`): the three steps of the review page refuse a text file and a false header size in Chromium, Firefox, and WebKit, but they accept a damaged PNG in Chromium and WebKit and a cut PNG in all three.

Where the record states it: `45-code-ci-docs.html`, anchor `code-comparison-worker`, the note "Revision r4" (lines 657 to 665 in revision r7), and the rationale of D-CODE-02 in `decisions.json`.

## C2. The removal of the comparison Worker

What it is: the three steps of the settled answer to D-CODE-02.

Why it is not a choice: the answer is settled, and the implementation is authorized. D-PRE-01 changes it only if the maintainer selects option 4. Then the removal stops after step 2 (the old task processor and the three unused bindings go, `POST /validate` stays).

Words that close it: "I authorize the implementation".

What the implementation must do: follow the order of D-CODE-02. Change the startup check (`apps/web/src/runtime.ts`, line 49), the deploy workflow, and its guards in the same build as the removal of the service binding. One condition of D-CODE-02 is a read of production, the request count of the Worker in Cloudflare. That read is in item 3 of the list, which another part of this round handles.

Where the record states it: the settled answer and the rationale of D-CODE-02, and `45-code-ci-docs.html`, anchor `code-comparison-worker`.

## C3. The two image checks of the review page go into the new page

What it is: the review page of today shows an image only after `element.decode()` passed and `naturalWidth` and `naturalHeight` are equal to the stored size (`apps/web/src/components/screenshot-viewer.tsx`, lines 49 to 71). Approve and Reject are off until then (`apps/web/src/review/review-workspace.tsx`, lines 302 to 307, 386, and 391). The lab stage tests only that the image loaded (`apps/lab/src/explorations/kits/ariakit/stage/canvas.tsx`, line 73).

Why it is not a choice: it is a rule that the product has today. `docs/review-guide.md`, line 41: "Review actions wait for the current selection's required images to load and decode." A new page that loses the rule is a regression.

Words that close it: "I authorize the implementation".

What the implementation must do:

- Keep both checks when the settled design goes into `apps/web`.
- Give bytes that are not an image their own text. Today the text is "The image could not be loaded. Check your connection and retry." (`screenshot-viewer.tsx`, line 158), which names a wrong cause.

What the checks stop, measured on 2026-10-07 with the same three steps (load, decode, size) and not with the review page itself: a text file and a PNG with a false header size, in Chromium 153, Firefox 155, and WebKit 26.6. They do not stop a damaged PNG in Chromium and WebKit, and they do not stop a cut PNG in each of the three. For those two kinds of file the size comparison adds nothing, and only option 3 or option 4 of D-PRE-01 refuses them.

What the implementation must not change: a decision for the whole screenshot tests only the shown variant (`review-workspace.tsx`, lines 385 to 394), and the settled answers to D-WORK-04 and D-WORK-06 let one decision cover variants that were never on screen. So the check protects only an image that a reviewer opens. This is a settled design, and this part does not reopen it. D-PRE-01 states it as a limit of option 1.

Where the record states it: the record does not state the two checks today. The fragment `fragments/D-PRE-01.html` states them in the note "For the UI work".

## C4. Row 7 of D-OPS-01, without the cause

What it is: one log line for each pass, with the message kind, the attempt, the queue wait, the failed step, and the time and the counts of each step.

Why it is not a choice: the settled answer to D-OPS-01 puts all 14 rows into the plan. D-PRE-02 decides only the cause.

Words that close it: "I authorize the implementation".

What the implementation must do: write the line in `apps/web/src/operations/index.ts` (today lines 103 to 109). Read the queue wait and the attempt from `message.timestamp` and `message.attempts` of the Cloudflare queue message (`apps/lab/audit/reports/operations/verification.md`, line 258). The counts of each step must hold the items that failed inside a step: a GitHub failure does not stop a step, the step counts it (`apps/web/src/operations/checks.ts`, lines 171 to 191, and `packages/service/src/work.ts`, lines 538 to 549). No D1 write. It ships with an ordinary service deployment.

What row 7 does not hold: a new name for a present log event or for a duration field. The finding OPS-08 names the mix (`elapsedMs`, `elapsedMilliseconds`, `totalMs`), and row 7 as accepted does not rename them. A rename can break a saved log query, so it is a separate change.

Where the record states it: `35-state-checks.html`, anchor `state-checks-fixes`, row 7 of the table (lines 300 to 318 in revision r7), and the settled answer to D-OPS-01.

## C5. The code and the reference of the service in a CLI message

What it is: the row for PKG-02 of the fix list of D-CODE-01. A refused request prints `error.code` and `error.reference`, each with a fixed format.

Why it is not a choice: the settled answer to D-CODE-01 sends all 12 rows to implementation. D-PRE-03 decides only the names of screenshots.

Words that close it: "I authorize the implementation" for the code, "the package publication" for the CLI release, and "the change in ariakit/ariakit" for the version change in the consumer.

What the implementation must do: read the error body for each refused status (`packages/cli/src/http.ts`, line 175, reads it for 503 and 409 only). Print the code only when it matches `^[a-z_]{1,64}$` and the reference only when it matches `^[0-9a-f-]{36}$`. Let `beginSubmission` pass a `CliError` (`packages/cli/src/bundle-submit.ts`, lines 69 to 71). Put this change in the same CLI release as the change of D-OPS-04, so that Ariakit needs one version change.

Where the record states it: `45-code-ci-docs.html`, anchor `code-fixes`, the code block "PKG-02: the cause of a failure" (lines 312 to 334 in revision r7).

## C6. The contract text for the log, if D-PRE-02 adds values

What it is: contract line 81 describes one log line, `operation-failed`: "fixed operation, code, correlation ID, and elapsed-time fields", and "No request body, token, URL, SQL, raw exception, or private label is added to that log." The pass writes another line, `operations_pass` (`apps/web/src/operations/index.ts`, lines 103 to 109). The contract has no sentence about that line.

Why it is not a choice: it follows from the answer to D-PRE-02 and from the place where the implementation writes the values.

| Answer to D-PRE-02 | Values on the line `operations_pass`                                                   | Values on the line `operation-failed`                                     |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Option 1           | No contract line changes                                                               | No contract line changes                                                  |
| Option 2           | No contract line changes. One new sentence can give the pass line the rule of line 81. | The list of fields of line 81 gets three names                            |
| Option 3           | One new sentence must permit the message text for the pass line                        | The words "raw exception" of line 81 change, and the list gets four names |

Words that close it: "3. Ok".

What the implementation must do: put the contract change in the contract pull request, before the code. One correction is independent of D-PRE-02: line 81 does not list the two optional fields that the code already writes, `runId` and `taskId` (`apps/web/src/operations/failure.ts`, lines 22 to 23). The same pull request adds them.

Where the record states it: item 9 of the list "What still needs your word" names the contract lines that the answers change. Line 81 is not in that list today.

## What goes out of the list

When the three decisions are in the page, items 1 and 8 of the list need no text of their own. Each becomes one line with a link:

- Item 1: a link to `#decision-D-PRE-01`.
- Item 8: a link to `#decision-D-PRE-02` and a link to `#decision-D-PRE-03`.
- Row 7 of the table of D-OPS-01 ("needs your word") and the bullet "Failure cause" above D-CODE-01 ("need your yes: write it in the notes") get the same links.
- The sentence before the list says "None is a decision". It needs new words when the list holds links to open decisions.

## Text of the record that the same revision must correct

- The note "Revision r4" (`45-code-ci-docs.html`, lines 657 to 665 in revision r7) and the rationales of D-OPS-04 and D-CODE-02 say that "nothing decodes the images" of a run with a replaced Submit job. More exact: no step of CI and no step of the service decodes them. The review page decodes an image that a reviewer opens.
- Row 7 of the table of D-OPS-01 says that contract line 81 "forbids a raw exception". More exact: line 81 has that rule for the line `operation-failed`. The contract has no rule for the line `operations_pass`.
- The bullet "Failure cause" above D-CODE-01 does not say that the capture job of the same run already prints the file and the title of each test in a public log (measured: 212 lines in job 112966055554 of run 37671649487).
