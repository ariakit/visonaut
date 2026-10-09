---
"@visonaut/web": patch
"@visonaut/service": patch
---

Stored the review state of the run and its three review counts with each update of the GitHub check. The text of the check does not change with this update, and an update that was stored before it has no review state and no counts.
