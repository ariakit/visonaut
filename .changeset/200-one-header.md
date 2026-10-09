---
"@visonaut/web": patch
---

One header for each page

Each page now has the same header, and a click on one of its links changes the page with no reload of the document.

- **Page names.** The links of the header are `Queue`, `History`, and `Status`. The Queue link has the number of runs to review.

- **Alerts.** The link `Status` has the number of open service alerts, and it is the one entry to them. The bell and its panel are removed. The Status page reads the alerts each minute while its tab is visible. A hidden tab sends no request.

- **Account.** The account menu shows the GitHub login of the viewer.

- **Run page.** A click on a link of the header while a decision is not saved asks before it leaves the run.
