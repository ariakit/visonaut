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

The **Status** page shows the open service alerts: GitHub check, comparison, baseline, storage, webhook, and recovery alerts, and the steps of the scheduler that failed. The link **Status** in the header has the number of open alerts. One card has the verdict, **All systems normal** or the number of alerts, and one row for each alert with the affected subject and the time of the last occurrence. Open a row to read what to do, the first-seen time, and the kind, the code, and the subject of the alert. A row has the button **Open guide** only when the operations guide has a procedure for that alert.

The page also shows three alerts that it finds in its reads: a scheduled pass that is late (the last capacity sample is older than 15 minutes, and no pass reported that it could not measure the database), review decisions that failed each attempt, and a run that has 90% or more of the screenshot limit. The header does not count these three. Under the card, three meters show the database size, the capture runs in progress, and the largest run against the screenshot limit.

Alerts refresh every minute while the Status page is open and its tab is visible. A hidden tab sends no request, and the page reads the alerts again when the tab becomes visible. If a read fails, a band says **Could not refresh the status** with the age of the shown status, and offers **Try again**. No external notifications are sent. Open the Status page to check service health.

The page is read-only. A successful operation clears its event through the service; there is no dismiss or acknowledge action. **All systems normal** reports the alert list at the shown check time. It does not certify every service dependency.

## Open the correct run

The **Queue** lists each run that needs a decision or attention: the next run to review as a card, then the other runs to review, the runs under **Running**, and the runs under **Needs attention**. **History** lists the latest 100 runs by day, with one row for each pull request: the row of its newest run, and a button such as **2 earlier** that shows its earlier runs. On History, search by title, number, or commit, filter by result, and select the order. The search, the filter, and the order are in the address of the page. A row of the Queue shows the pull request title and number (or the branch kind and the commit), the attempt from the second attempt, the age, and the state. Select a row to open its review workspace. The list reads again when the tab becomes visible, and each minute while it is visible (each 15 seconds while a run is capturing or comparing). A hidden tab sends no request. When a read fails, the page keeps the list, says **Could not refresh runs** with the age of the list, and offers **Try again**.

Check the run before you save a decision. The header names it with the pull request number and title, or with `main` or `Merge queue`. Select the name to see the commit, the attempt, and the baseline. When the repository is known, it also has the links **Open pull request** (for a pull request) and **Open commit**. A new workflow attempt is a separate run. A superseded attempt cannot accept review commands.

A run must have its complete capture and finished comparison before review actions become available. The page reports capture, comparison, and access errors. Use the shown retry control after you resolve the cause.

## Inspect a screenshot

The screenshot list shows each screenshot with a change, in run order, with all its variants in one row: a picture of the change, the name, the family, status marks for its variants, and the largest change. The status select of the list shows **Changes**, **Needs review**, **Rejected**, **Approved**, or **Unchanged**. The search reads the name and the key of each screenshot, and the browser, the color scheme, and the framework of each variant. Up, Down, and the advance after a decision follow the screenshots that the list shows. A link to a screenshot brings its row into view. Select a screenshot, then select a variant with the variant control. Its stepper has **Previous variant** and **Next variant**, and between them the selected variant with its status mark and its position, for example `2 / 6`. The middle button opens a list of all variants. When there is room, the control also shows status marks that are links. A screenshot with few variants has one mark for each variant. A screenshot with many variants has one counted mark for each state, and a mark opens a variant in that state. A screenshot with one variant shows its name and no stepper. A click on a screenshot, or a link that names no variant, opens the first variant that needs review, else the first change, else the first variant. Up, Down, and the buttons **Previous screenshot** and **Next screenshot** open the variant that you selected last in that screenshot. The button **Hide list** (or **Show list**) hides the screenshot list, and in a wide window `[` does the same. The header also shows the progress of the review: the share of approved, rejected, and open changes, and a count such as `9 left`, `All approved`, or `2 rejected`. When the run has a result, the progress is a button that shows the result again.

Screenshots with a new variant stay in the main list for inspection, including after approval. Automatically accepted new variants do not add to the pending review count. **Unchanged** loads the unchanged screenshots of the run and shows them by family.

The picture of a row shows the first variant that needs review, else the first change, else the first variant: the current image with the mask on top, cropped around the largest changed region. A removed variant shows its baseline. Selecting another variant changes the viewer, not the picture.

The viewer is one stage. It opens on the current image, with the red mask on top for a changed variant. The bar has the buttons of the modes, the mask, and the zoom, and most of them have a key. The tooltip of a button shows its name and its key. A mode button is off when the stage cannot show that mode for the selected variant, for example **Baseline** for an added variant. The key of a mode button that is off does nothing, so the next variant opens in the mode of before.

| Control            | What the stage shows                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Current, `F`       | The current image. This is the first view.                                                                                                                                     |
| Baseline, `G`      | The baseline image, in the same place as the current image.                                                                                                                    |
| Two panes, `S`     | A baseline pane and a current pane. One pan and one zoom move both panes.                                                                                                      |
| Swipe, `W`         | The baseline before a line and the current image after it. Drag the line to move it. The line has no key.                                                                      |
| Overlay, `O`       | The current image at half strength on the baseline.                                                                                                                            |
| Mask, `D`          | A switch for the red mask on the changed regions. It is on at first.                                                                                                           |
| Zoom               | The percent and its menu: **Fit**, **Fit width**, 50%, 100%, 200%, 400%, 800%, and **Actual pixels**. The buttons **Zoom out** and **Zoom in** step the zoom. Zoom has no key. |
| Drag, or the wheel | Move within an image that is larger than the stage. The wheel with Ctrl or Command, or a pinch, zooms at the pointer. The arrow keys never pan.                                |

There is no held key for the baseline. Press `F`, then `G`, to blink between the two images in one place. The browser keeps the mode and the mask switch, and the next variant opens with them.

The mask loads with the two images when they have one size. It is required evidence: **Approve** and **Reject** stay off until the baseline, the current image, and the mask, when the variant has one, are loaded and decoded. Turning the mask off only hides it.

The stage says the state of the variant in its status row, so the images do not move:

| State of the variant | What the stage shows                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Added                | **Added** and **No baseline**. The stage shows the current image only.                         |
| Removed              | **Removed** and **No current image**. The stage shows the baseline only.                       |
| No visible change    | **No visible change** and **CI did not upload this image**. The stage shows the baseline only. |
| Size changed         | **Size changed** with the two sizes, for example `600 × 400 → 600 × 420`. There is no mask.    |
| Comparing            | **Comparing**, while the service compares the variant.                                         |

An image that fails to load or to decode shows **Image evidence unavailable** in the status row, with **Retry images** when a retry can help. The stage does not treat a failed image as an addition, removal, or unchanged result.

Review actions wait for the current selection's required images to load and decode. This prevents a decision from using pixels left over from a different selection. A decision key that you press before then prints **Nothing changed. The images are not on screen yet.** in the status line of the bar. The button **Details** opens the capture details: the changed pixels, the image sizes, the CLI version of the Submit, the policy and the threshold, and the capture profiles, when they are available.

## Save a decision

Choose **Approve** or **Reject** for the selected variant, or press `A` or `X`. The page can show the requested verdict and move to the next pending variant before saving finishes, in the screenshots that the list shows, wrapping once through them. See **Finish a review** for the end of the run. The status line of the bar says **Saving…** until the service confirms the decision, and the browser asks before you leave the page until then. After 30 seconds the line says **Saving… Still queued after 30 seconds.** When the receipt is final, the line says what was saved, for example **Saved. 1 variant approved.** Only server-confirmed decisions are saved. A queued receipt is not a saved verdict.

**Rejected** means the variant has been reviewed, but it still fails the visual check. **Accepted automatically** identifies a service decision and is skipped by next-pending navigation. It does not name a human reviewer.

**Approve all N** and **Reject all N** are in the **More** menu (**⋯**) of the bar, with the keys `Shift+A` and `Shift+X`. They apply one command to all added, changed, and removed variants of the selected screenshot, where N is the number of those variants. The command saves at once, with no confirmation, and the status line says what was saved, for example **Saved. 4 variants approved.** One **Undo** reverses the command. The menu items show only for a screenshot with more than one change. The command saves every target or none. One command can have 200 targets at most: for a screenshot with more changed variants, review the variants one at a time. If a target is stale or protected, the page keeps the selection and explains the refusal. You can select an eligible variant and review it separately.

A save that can be retried, for example after a failed connection or a service error, shows a notice such as **Not saved. No connection.** in the status line, and the bar then has only its words and its recovery buttons. **Retry same command** uses the original command identity and targets, so a lost response cannot create a second decision. **Refresh current state** loads the current server state. Inspect that state before making a new decision. A failed Undo has **Retry Undo** in the place of **Retry same command**.

An unexpected service failure shows **Reference:** beside the retry error. Include that reference in a support report so a maintainer can find the matching safe server log. If the decision is already queued, the notice still says that server processing will continue. Retry checks the same command; it does not cancel admitted work.

A concurrent change shows **Conflict.** and the current state. When a person decided first, the message names the reviewer, for example **Another reviewer approved this variant. Your rejection was not saved.** **You already** replaces the name when the other decision is your own, for example from another tab. Another conflict shows a general sentence, for example **Another change was saved at the same time. Check the current state and decide again.** The bar keeps its controls. A refused command restores the prior local state and does not overwrite the newer decision.

When you return to the tab of a run, the page reads the state of the run one time. If another reviewer saved a decision, or a newer attempt replaced the run, the page shows the current state with no save. A hidden tab sends no request. If the session ended in another tab, the page shows the sign-in page.

If your review session ends while the page is open, for example after you sign in again, the page starts a new review session and sends the decision again. You do nothing. The page can then no longer undo the decisions that it saved before that moment. The page does not send a decision while another account is signed in: sign in with the first account and select **Retry same command**.

If your session ended when you save, the bar keeps the decision and shows **Sign in again**. The link opens a new tab. Sign in there, return to the run, and select **Retry same command**. **Refresh current state** drops a decision that waits for a retry only after the page read the current state.

If a save fails because a newer run replaced the run, the status line says **Not saved. A newer run replaced this run.** and the bar shows **Go to the Queue**. Another cause of a closed run has its own sentence after **Not saved.**, for example **The pull request of this run closed.** or **This run expired.** A decision that failed too many times says so. Check the current state and decide again.

## Approve the run

Use **Approve the run…** in the **More** menu (**⋯**) of the bar to approve each change of the run that has no decision. The menu item has no key. The item is off while a save runs, after a failed save that waits for a retry, while the run is not ready for review, after a failed comparison, and when no change is left. A closed run is read-only and has no such item.

The item opens a confirmation with the title **Approve N changes?** and a note such as **12 were not opened. 3 rejected variants stay rejected.** A change is not opened when you never had its images on screen as the selected variant on this page. A reload clears that count: the number informs you, and it does not block the approval. **Cancel** has the focus, so `Enter` approves nothing. Select **Approve** to save.

The command covers each added, changed, and removed variant with no decision. It leaves a rejected variant as it is, and it skips a variant whose comparison failed. It saves at once, and the status line says what was saved, for example **Saved. 246 variants approved.** One **Undo** reverses the whole command. No other decision starts while the approval waits.

The service saves nothing when the run changed after the page read it, or when the count of the page differs from its own. The status line then says **Conflict.** and the page loads the current state. If the service cannot complete the approval, the status line says **Not saved. The approval of the run failed. Approve one screenshot at a time, or try again.** The item stays on, so you can open **Approve the run…** again at once. A failed Undo of the approval says **Not saved. The Undo of the run approval failed. Nothing was undone. Try again.** With no connection, it says **Not saved. No connection. Nothing was undone. Try again.** Both offer **Retry Undo**.

## Finish a review

When no change is left to review and the last save is final, a result replaces the variant control, the stage, and the bar. A run with nothing to review opens on the result. The result has a title (**All approved**, **2 rejected**, or **Nothing to review**) and one sentence with the state of the run and the counts: `Run state: Passed. 11 changes in 4 screenshots: 11 approved, 0 rejected.` A run with no change says `Run state: Passed. No screenshot changed from baseline 4.` A failed save keeps the bar with its recovery buttons, and a run with a variant whose comparison failed has no result.

The main action is **Next run · #7754**, the next run of the Queue that waits for a decision. When the Queue has none, or the page cannot read it, the main action is **Queue**. When a change is rejected, the result has **Show rejected**, which opens the first rejected change. Else, when the main action is **Next run**, the result also has **Queue**. It also has **Undo last decision**, **All N screenshots**, and **Pull request** for a run of a pull request. **Undo last decision** shows only when this page has a command to undo, and it brings the stage back with the selection of the undone command. **All N screenshots** opens the list with the status **Unchanged**. **Pull request** opens the pull request on GitHub.

While the result shows, the list marks no screenshot, and the header names no screenshot. On the result, `Cmd/Ctrl+Z` undoes the last command. The decision keys and the view keys do nothing there, and the link **Skip to review actions** does not show. Opening a screenshot or a variant, by key, by a click on the list, or by an address, leaves the result. After an Undo that leaves a change to review, the stage shows again. When no change is left again, the result shows again. The run progress in the header also shows the result again.

## Undo and accepted history

Use the button **Undo** of the bar, or `Cmd/Ctrl+Z` to undo the last eligible command saved in this page's review session. **Undo** is off when the page has nothing to undo. Undo restores its prior verdicts and original selection, and the status line says **Undo saved. The original selection and verdicts were restored.** One Undo reverses a whole-screenshot command or a run approval. Reloading the page clears the local Undo stack; the audit history remains stored.

Undo succeeds only while the affected decision and baseline revisions still match. It cannot replace another reviewer's later decision. If the newest command is stale, the page reports the conflict; an older independent command may still be eligible.

Promoted history is read-only, including human and automatic approvals. A correction requires a new complete main capture. Closed history keeps the original decisions and available evidence; it cannot promise image replay after unpinned bytes expire.

## Keyboard controls

Review shortcuts work across the page while enabled, subject to the native input, menu, and dialog rules below. **Keyboard help** (the keyboard button in the footer) lists them in the app. The button **Shortcuts on** (or **Shortcuts off**) next to it shows the state and switches it. The browser keeps that choice, and the key hints hide while the shortcuts are off.

| Key                   | Action                                                 |
| --------------------- | ------------------------------------------------------ |
| Up / Down             | Previous or next screenshot; stop at each end          |
| Left / Right          | Previous or next variant in declared order             |
| Home / End            | On a variant mark: first or last variant               |
| `1` through `6`       | Select that variant position, if it exists             |
| `A` / `X`             | Approve or reject the current variant                  |
| `Shift+A` / `Shift+X` | Approve or reject the whole screenshot                 |
| `F` / `G`             | Show the current image or the baseline                 |
| `S` / `W` / `O`       | Show two panes, the swipe, or the overlay              |
| `D`                   | Turn the mask on or off                                |
| `Cmd/Ctrl+Z`          | Undo the last eligible saved command                   |
| `[`                   | Hide or show the screenshot list (wide windows)        |
| Tab                   | Move through controls, from **Skip to review actions** |
| Escape                | Close help or a menu                                   |

Each screenshot remembers its last selected variant. A first visit opens the first variant that needs review. If no variant needs review, it opens the first change, else the first variant. If a remembered variant is no longer available, the page selects the variant that a first visit would open and announces the change in the status line. If the address names a variant that the run does not have, for example after a newer state of the run, the page also selects the variant that a first visit would open, and the status line says **The selected variant is unavailable.** with the name of the variant that it shows. Arrow keys and visible controls reach variants beyond the first six.

Held keys do not repeat review commands. Text fields, editable content, menus, and dialogs keep their own keys. Native Select All, Cut, and text-field Undo remain available. Escape never rejects an image.

## Closed runs and export

The review page has no control to compare a run again. Every closed run is read-only, including retained legacy detail. A new comparison requires a fresh complete capture through trusted local Submit. Local Submit runs cannot recreate omitted candidate bytes from stored representatives. Existing historical comparison links keep their original results or an explicit pending, failed, missing, or expired state. Outstanding historical work can still finish.

New product exports are retired, and the **Export run** control is removed. The final retirement release removes export endpoints and links, including existing links whose promised expiry has not passed. Requests then return `404 not_found`; a download lease does not preserve endpoint availability. Retained export pages and pins remain subject to ordinary expiry and cleanup. Review retained evidence in run history, or capture a new complete run for new evidence. Product exports cannot be recreated.

Use **Queue** to return to the Queue and **Sign out** to end your session. If repository access cannot be checked, retry after the service recovers. A confirmed access denial requires an account with write permission.

On a narrow screen, the screenshot list opens in a dialog from the button **Show list**. Launch review validation targets Chrome Desktop and keyboard operation. Mobile workflows, other review browsers, and screen-reader certification have separate validation scope.
