---
"@visonaut/web": patch
---

The review page shows the result of a run

- **Nothing to review.** A run with no change to review opens on a short result in the place of the stage and the decision bar. It names the state of the run and the counts, for example "Run state: Rejected. 9 changes in 3 screenshots: 7 approved, 2 rejected." It links the next run of the Queue that waits for a decision, the Queue, and all screenshots of the run.
- **The end of a review.** After the last decision is saved, the same result shows, with "Undo last decision". Undo brings the stage back with the selection of the undone decision. A row click or an arrow key also goes back to a screenshot.
- **One vocabulary.** The capture details name the state of the run with the words of the pages, such as "Passed" and "Needs review", in place of "Check passed" and "Changes need review". The status line no longer says "Review complete. No variants need review.".
