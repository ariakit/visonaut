---
"@visonaut/web": patch
---

A run page reads the state of its run when its tab becomes visible

A run page that stayed open in a hidden tab showed the state of the time when it was loaded. The page learned of a change only from the answer to a decision.

- **One small read.** When the tab becomes visible, the page reads the small state of the run one time. It reads the run again only when the state changed. A hidden tab sends no request, and the page has no timer for this read.
- **A replaced run.** After a newer attempt replaced the run, the page says "A newer attempt is active" and shows that the evidence cannot be reviewed, with no save.
- **A decision of another reviewer.** The page shows the decision when you return.
- **A session that ended in another tab.** The page shows the sign-in page.
