# Review a visual run

Open Visonaut in Chrome Desktop. Sign in with a GitHub account that has current write permission to the configured repository. A review link does not grant access. The [current system guide](current-contract.md) owns the requirements and selected changes. Validated image URLs need no session; anyone with a URL can view and copy those pixels. Labels, verdicts, audit data, export files, and quarantine remain private.

## Read the GitHub check

Each run has one check with the name **Visonaut** on its commit. The title of the check names the state of the run, and its summary says who acts next. You do not need access to Visonaut to read it. The check shows totals only: it has no screenshot name and no reviewer name.

| Title of the check                 | State of the run | Meaning                                                        | Who acts next                                                                           |
| ---------------------------------- | ---------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `79 changes need review`           | Needs review     | Screenshots changed, and one or more changes have no decision. | A maintainer approves or rejects each change.                                           |
| `3 changes rejected`               | Rejected         | A maintainer rejected one or more changes.                     | The author pushes a commit that corrects them. A maintainer can also change a decision. |
| `12 changes approved`, or `Passed` | Passed           | Each change is approved, or no change needs review.            | Nobody.                                                                                 |
| `Capturing screenshots`            | Capturing        | CI captures the screenshots of the commit.                     | CI.                                                                                     |
| `Comparing screenshots`            | Comparing        | Visonaut compares the screenshots with the baseline.           | CI.                                                                                     |
| `Rerun needed`                     | Rerun needed     | The baseline changed after the comparison of the run.          | A maintainer runs the CI workflow of the commit again.                                  |
| `No longer active`                 | Replaced         | The run is closed, and its result does not change.             | The author pushes a commit, or a maintainer runs the CI workflow again.                 |
| `Capture or comparison failed`     | Failed           | The capture or the comparison did not complete.                | A maintainer runs the CI workflow again, or the author pushes a commit.                 |

A closed run usually keeps the last title of its check, for example `79 changes need review` on an older commit. So read the check of the newest commit of the pull request. Only the check of an old pull request can show `No longer active`. The tested commit of such a pull request is from before the change of 2026-10-02 that put the check on the head commit of each pull request.

The summary of a run that needs review, is rejected, or has approved changes also has the three totals, for example `Changes: 76 need review, 3 rejected, 0 approved.` A rejected change is not in the number of changes that need review.

The check of a pull request is red while a review waits: it is completed with the conclusion `failure`, so the required check blocks the merge until each change is approved. A check in progress is yellow, and a passed check is green.

If you are the author of a pull request and you have no write access to the repository, you cannot open the review link of the summary. Read the title. `79 changes need review` waits for a maintainer: push a commit only if a change is not intended. `3 changes rejected` waits for you: push a commit that corrects the rejected changes.

The check can also show a title that is not a state of a run, for example `Checking visual coverage` before the run starts, or `Visual capture is not required` when the workflow selected no visual capture for the commit.

Only a pull request whose branch is in this repository gets a Visonaut check. A pull request from a fork gets none, so its author has no title to read.

## Check service attention

The dashboard shows unresolved backup, GitHub check, baseline, storage, and recovery alerts. Each alert gives a recovery action, the affected subject, and first-seen and last-seen times. Use **Open the operations and recovery guide** for the next steps.

Alerts refresh every minute while the dashboard is open. Browser suspension can delay a refresh. Use **Refresh alerts** to check now. If a check fails, the panel marks the shown alerts as possibly out of date and offers **Retry alerts**. No external notifications are sent. Open the dashboard to check service health.

The panel is read-only. A successful operation clears its event through the service; there is no dismiss or acknowledge action. **No unresolved operation alerts** reports the event list at the shown check time. It does not certify every service dependency.

## Open the correct run

The Runs page shows the run type, tested commit, state, attempt, and creation time. Select a run to open its review workspace. Use **Refresh runs** to fetch the current list.

Check the run identity above the images before you save a decision. A new workflow attempt is a separate run. A superseded attempt cannot accept review commands.

A run must have its complete capture and finished comparison before review actions become available. The page reports capture, comparison, and access errors. Use the shown retry control after you resolve the cause.

## Inspect an item

The item list groups all variants for one item. Select an item, then select a variant. The full variant label and result appear above the image controls. Counts show how many variants still need review.

Items with a new variant stay in the main list for inspection, including after approval. Automatically accepted new variants do not add to the pending review count. Ordinary accepted and unchanged items stay under **Accepted**.

The thumbnail stays tied to the item's first declared candidate variant. A wholly removed item uses its first reference variant. Selecting another variant changes the viewer, not the thumbnail.

| Control            | Image shown                                  |
| ------------------ | -------------------------------------------- |
| Side by side, `S`  | Reference and candidate                      |
| Pixel diff, `D`    | Differences in red                           |
| New only, `F`      | Full candidate image in the viewer           |
| Original only, `G` | Reference image in the viewer                |
| Fit                | Image scaled to the available viewer width   |
| 100% / 200%        | Original-size or enlarged inspection         |
| Pan controls       | Move within a zoomed image with the keyboard |

For an addition, there is no reference image; Original only says **New image, no reference**. For a removal, the old image remains visible in Side by side and Original only, and New only says **Removed, no new image**. Pixel diff is unavailable when either image is absent. An image that fails to load shows an error and **Retry**. It is not treated as an addition, removal, or unchanged result.

Review actions wait for the current selection's required images to load and decode. This prevents a decision from using pixels left over from a different selection. The details panel provides the image dimensions, digests, profiles, comparison engine, policy, and threshold when available.

## Save a decision

Choose **Approve** or **Reject** for the selected variant. The page can show the requested verdict and move to the next pending variant before saving finishes, wrapping once through the list. If none remain, the selection stays in place. **Sending** still needs the browser. **Queued on server** confirms durable admission; processing continues after the window closes. Only server-confirmed decisions are saved. A queued receipt is not a saved verdict.

**Rejected** means the variant has been reviewed, but it still fails the visual check. **Accepted automatically** identifies a service decision and is skipped by next-pending navigation. It does not name a human reviewer.

**Approve whole item** and **Reject whole item** apply one command to all added, changed, and removed variants in that sealed item. The button shows the number of targets. The command saves every target or none. If a target is stale or protected, the page keeps the selection and explains the refusal. You can select an eligible variant and review it separately.

A failed connection shows **Not saved**. **Retry same command** uses the original command identity and targets, so a lost response cannot create a second decision. **Refresh current state** loads the current server state. Inspect that state before making a new decision.

An unexpected service failure shows **Reference:** beside the retry error. Include that reference in a support report so a maintainer can find the matching safe server log. If the decision is already queued, the notice still says that server processing will continue. Retry checks the same command; it does not cancel admitted work.

A concurrent change shows **Conflict** and current state. The message identifies the conflicting reviewer when one is available. A refused command restores the prior local state and does not overwrite the newer decision.

## Undo and accepted history

Use **Undo** or `Cmd/Ctrl+Z` to undo the last eligible command saved in this page's review session. Undo restores its prior verdicts and original selection. Reloading the page clears the local Undo stack; the audit history remains stored.

Undo succeeds only while the affected decision and baseline revisions still match. It cannot replace another reviewer's later decision. If the newest command is stale, the page reports the conflict; an older independent command may still be eligible.

Promoted history is read-only, including human and automatic approvals. A correction requires a new complete main capture. Closed history keeps the original decisions and available evidence; it cannot promise image replay after unpinned bytes expire.

## Keyboard controls

Review shortcuts work across the page while enabled, subject to the native input, menu, and dialog rules below. **Keyboard help** lists them in the app. **Shortcuts on/off** lets you disable them.

| Key                   | Action                                     |
| --------------------- | ------------------------------------------ |
| Up / Down             | Previous or next item; stop at each end    |
| Left / Right          | Previous or next variant in declared order |
| `1` through `6`       | Select that variant position, if it exists |
| `A` / `X`             | Approve or reject the current variant      |
| `Shift+A` / `Shift+X` | Approve or reject the whole item           |
| `S` / `D` / `F`       | Side by side, Pixel diff, or New only      |
| `G`                   | Original only                              |
| `Cmd/Ctrl+Z`          | Undo the last eligible saved command       |
| Tab                   | Move through controls                      |
| Escape                | Close help or a menu                       |

Each item remembers its last selected variant. A first visit opens the first variant that needs review. If no variant needs review, it opens the first variant. If a remembered variant is no longer available, the page selects the first and announces the change. Arrow keys and visible controls reach variants beyond the first six.

Held keys do not repeat review commands. Text fields, editable content, menus, and dialogs keep their own keys. Native Select All, Cut, and text-field Undo remain available. Escape never rejects an image.

## Recompare and export

**Recompare stored run** is retired. Every closed run is read-only, including retained legacy detail. A new comparison requires a fresh complete capture through trusted local Submit. Local Submit runs cannot recreate omitted candidate bytes from stored representatives. Existing historical comparison links keep their original results or an explicit pending, failed, missing, or expired state. Outstanding historical work can still finish.

New product exports are retired, and the **Export run** control is removed. The final retirement release removes export endpoints and links, including existing links whose promised expiry has not passed. Requests then return `404 not_found`; a download lease does not preserve endpoint availability. Retained export pages and pins remain subject to ordinary expiry and cleanup. Review retained evidence in run history, or capture a new complete run for new evidence. Product exports cannot be recreated.

Use **All runs** to return to the dashboard and **Sign out** to end your session. If repository access cannot be checked, retry after the service recovers. A confirmed access denial requires an account with write permission.

The layout stacks the list and images on narrow screens. Launch review validation targets Chrome Desktop and keyboard operation. Mobile workflows, other review browsers, and screen-reader certification have separate validation scope.
