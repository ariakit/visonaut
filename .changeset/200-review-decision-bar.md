---
"@visonaut/web": patch
---

The decision bar of the review page has one status line

- **One bar.** Undo, the view controls of the stage (the view modes, the mask switch, and the zoom), the status line, **Reject**, **Approve**, and a **More** menu are in one raised bar at the bottom of the stage. The **More** menu has **Approve all N** and **Reject all N** for a screenshot with more than one change, and **Copy link**.
- **Whole screenshot with no dialog.** A decision for the whole screenshot saves at once with **Shift+A** or **Shift+X** and with its item in the **More** menu. The confirmation dialog is gone. The status line shows the number of variants, for example "Saved. 7 variants approved.", and one **Undo** reverses the whole command.
- **One status line.** Each save state, each refusal, and each recovery text shows in the status line, with a mark for its tone. The line has a reserved height, so **Approve** stays in its place when a text shows. A refused key, for example **Shift+X** on a protected variant, and the text for a remembered variant that a screenshot no longer has are on screen and no longer only in a hidden live region.
- **Recovery.** A failed save shows only its text and its recovery buttons in the bar. **Retry same command**, **Retry Undo**, **Refresh current state**, **Sign in again**, and **Go to the Queue** are outside the live region, and the focus goes back to the review page after a recovery button. A refusal that comes after a failed save, a conflict, or a closed run follows its text and does not hide it.
- **Approve off.** A disabled **Approve** has no brand fill, so it no longer looks active while images load or on a read-only run.
- **Closed runs.** The bar names the stored cause of a closed run, for example "The pull request of this run closed.", and not "A newer run replaced this run." for each closed run.
- **Fewer reads.** The receipt of a decision by a person with no stored name no longer makes the page read the run model again, and the state read of a run reads the project row one time.
- **Return to the tab.** A conflict stays on screen when the tab becomes visible again, also when the session ended in another tab.
