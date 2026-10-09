---
"@visonaut/web": patch
---

The decision bar says "Saving…" until a decision is confirmed

The decision bar of a run page no longer says that the window can close while a decision waits in the queue of the service.

- **One text.** The bar says "Saving…" until the service confirms each decision. After 30 seconds it says "Saving… Still queued after 30 seconds."
- **The leave prompt.** The browser asks before the reviewer leaves the page until the service confirms each decision. Before, it stopped when the service had queued the decision.
- **A faster result.** The page reads the result of a decision after 100 ms in place of 500 ms. It makes no read while the tab is hidden.
