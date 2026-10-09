---
"@visonaut/web": patch
---

Fixed the conflict text of the run page, which named no reviewer for a queued decision and showed a GitHub user ID in other cases. The text now names the reviewer of the newer decision with the stored profile name, for example "Conflict. Kenji Mori rejected this variant. Your approval was not saved." For a decision of your own, for example in another tab, it says "Conflict. You already approved this variant. Your rejection was not saved." The Details panel shows the same name in place of the GitHub user ID.
