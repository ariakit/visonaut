# Review a visual run

Open Visonaut in Chrome Desktop. Sign in with a GitHub account that has current write permission to the configured repository. A review link does not grant access.

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

The thumbnail stays tied to the item's first declared candidate variant. A wholly removed item uses its first reference variant. Selecting another variant changes the viewer, not the thumbnail.

| Control           | Image shown                                  |
| ----------------- | -------------------------------------------- |
| Side by side, `S` | Reference and candidate                      |
| Pixel diff, `D`   | Differences in red                           |
| New only, `F`     | Full candidate image in the viewer           |
| Fit               | Image scaled to the available viewer width   |
| 100% / 200%       | Original-size or enlarged inspection         |
| Pan controls      | Move within a zoomed image with the keyboard |

For an addition, there is no reference image. For a removal, the old image remains visible in Side by side, and New only says **Removed, no new image**. Pixel diff is unavailable when either image is absent. An image that fails to load shows an error and **Retry**. It is not treated as an addition, removal, or unchanged result.

Review actions wait for the current selection's required images to load and decode. This prevents a decision from using pixels left over from a different selection. The details panel provides the image dimensions, digests, profiles, comparison engine, policy, and threshold when available.

## Save a decision

Choose **Approve** or **Reject** for the selected variant. Wait for server confirmation. After a successful save, the selection moves to the next variant that needs review, wrapping once through the list. If none remain, the selection stays in place.

**Rejected** means the variant has been reviewed, but it still fails the visual check. **Accepted automatically** identifies a service decision and is skipped by next-pending navigation. It does not name a human reviewer.

**Approve whole item** and **Reject whole item** apply one command to all added, changed, and removed variants in that sealed item. The button shows the number of targets. The command saves every target or none. If a target is stale or protected, the page keeps the selection and explains the refusal. You can select an eligible variant and review it separately.

A failed connection shows **Not saved**. **Retry same command** uses the original command identity and targets, so a lost response cannot create a second decision. **Refresh current state** loads the current server state. Inspect that state before making a new decision.

A concurrent change shows **Conflict** and current state. The message identifies the conflicting reviewer when one is available. A refused command does not advance the selection or overwrite the newer decision.

## Undo and accepted history

Use **Undo** or `Cmd/Ctrl+Z` to undo the last eligible command saved in this page's review session. Undo restores its prior verdicts and original selection. Reloading the page clears the local Undo stack; the audit history remains stored.

Undo succeeds only while the affected decision and baseline revisions still match. It cannot replace another reviewer's later decision. If the newest command is stale, the page reports the conflict; an older independent command may still be eligible.

Rejecting a human-approved variant in the current promoted main run can restore the previous baseline. The operation must pass its current decision and baseline checks. It restores the complete previous snapshot, not only one image.

An automatically accepted variant in promoted history is protected. Correct the code and submit a new complete main capture. The page explains why rejection is unavailable. Approving already accepted history does not add an Undo command.

## Keyboard controls

Move focus into the review workspace before using its shortcuts. **Keyboard help** lists them in the app. **Shortcuts on/off** lets you disable them.

| Key                   | Action                                     |
| --------------------- | ------------------------------------------ |
| Up / Down             | Previous or next item; stop at each end    |
| Left / Right          | Previous or next variant in declared order |
| `1` through `6`       | Select that variant position, if it exists |
| `A` / `X`             | Approve or reject the current variant      |
| `Shift+A` / `Shift+X` | Approve or reject the whole item           |
| `S` / `D` / `F`       | Side by side, Pixel diff, or New only      |
| `Cmd/Ctrl+Z`          | Undo the last eligible saved command       |
| Tab                   | Move through controls                      |
| Escape                | Close help or a menu                       |

Each item remembers its last selected variant. A first visit uses the first variant. If a remembered variant is no longer available, the page selects the first and announces the change. Arrow keys and visible controls reach variants beyond the first six.

Held keys do not repeat review commands. Text fields, editable content, menus, and dialogs keep their own keys. Native Select All, Cut, and text-field Undo remain available. Escape never rejects an image.

## Recompare and export

Choose **Recompare stored run** to compare stored originals again without a new capture job. The page keeps the previous evidence visible while the new comparison runs. Review actions stay unavailable until the new result is ready. A comparison failure remains visible.

Choose **Export run** after the sealed comparison is ready. Visonaut prepares a private TAR archive, then requests its download. The archive contains originals and private run, profile, provenance, review, and audit data. Access is checked again when the download starts. Export links expire after 24 hours; create a new export if needed. A complete archive has a final `complete.json` marker with image checksums.

Use **All runs** to return to the dashboard and **Sign out** to end your session. If repository access cannot be checked, retry after the service recovers. A confirmed access denial requires an account with write permission.

The layout stacks the list and images on narrow screens. Launch review validation targets Chrome Desktop and keyboard operation. Mobile workflows, other review browsers, and screen-reader certification have separate validation scope.
