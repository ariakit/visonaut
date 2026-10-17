---
"@visonaut/web": patch
---

Fixed texts and keys of the review page

- **A selected variant that is gone.** When the address names a variant that the run does not have, for example after a newer state of the run, the status line now says "The selected variant is unavailable." and names the variant that the page shows.
- **A mode key that is off.** A mode key does nothing when its mode button is off. Before, `S` on an added variant stored the mode "Two panes", and the next changed variant opened in two panes.
- **The Undo of a run approval with no connection.** The status line now says "Not saved. No connection. Nothing was undone. Try again." Before, it said only "Not saved. No connection."
- **Screenshot in place of item.** The keyboard help, the conflict text of a decision for a whole screenshot, and the empty review page now say "screenshot" and not "item".
