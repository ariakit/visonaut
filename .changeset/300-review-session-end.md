---
"@visonaut/web": patch
---

A run page keeps a decision when a session ends

A run page lost a decision when its review session or its sign-in session ended. The page said "Conflict. Your review session ended. Reload the page to continue.", and a reload dropped the decision.

- **A review session that ended.** After a new sign-in with the same account, the page starts a new review session and sends the same decision again, with no action from you. The page can then no longer undo the decisions that it saved before that moment.
- **Another account.** The page names the account that it was loaded for, and the service starts a review session only for that account. While another account is signed in, the page keeps the decision and says "Another account is signed in. Sign in with the account of this page, and then retry."
- **A session that ended.** The decision bar keeps the decision, says "Your session ended. Sign in again, and then retry.", and shows the link "Sign in again", which opens a new tab.
- **Refresh current state.** The button drops a decision that waits for a retry only after its read succeeds.
- **A replaced run.** After a save fails because a newer run replaced the run, the bar says "Not saved. A newer run replaced this run." and links to the Queue.
- **A decision that failed each attempt.** The bar says "Not saved. This decision failed too many times and cannot run again. Check the current state and decide again." in place of the text of a conflict.
