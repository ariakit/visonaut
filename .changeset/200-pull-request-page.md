---
"@visonaut/web": patch
---

The pull request page names the pull request and keeps waiting after a failed read

The page that a GitHub check opens has the design of the Queue, the History, and the Status page. It opens the review as soon as the newest run is ready. Until then it shows where the capture is.

- **Context.** The title block has the number, the title of the pull request, the short commit, and the attempt of the workflow, for example `c344d23 · attempt 3`. A `GitHub` button opens the pull request. A page with no title shows `Pull request #7`.

- **One sheet for each state.** A capture that is on its way shows the steps `Capture`, `Compare`, and `Review` with `Opens when ready`. A failed capture shows the band `Capture failed` with `Open workflow`, which opens the attempt on GitHub. A run that closed before its screenshots were complete shows `Replaced`. A pull request that needs no capture shows `No visual review needed`.

- **One failed read keeps the state.** While the capture is pending, the page reads each 15 seconds in a visible tab. After a failed read it keeps the steps under the band `Could not refresh the pull request`, and it reads again after 45 seconds. Before this update, one failed read replaced the page with `Review unavailable` and ended the waiting.

- **Check again.** The button `Check again` is in the steps sheet, and it is busy while its read runs. The first read of a page that opens in a hidden tab starts when the tab becomes visible.

- **Loading and errors.** While the lookup runs, the page shows its shape in place of a sentence. When the first read fails, a band says `Could not load the pull request` with the cause and the Error ID. The text `Finding this pull request’s visual review…` is removed.

- **Faster start of the run page.** The page loads the code of the run page while the lookup runs, so the review opens sooner after the answer.

- **Removed.** The button `Review queue`, the line `Visual review · Pull request #7`, and the button `Open on GitHub` of the page card are removed. The `GitHub` button is in the title block.
