---
"@visonaut/web": patch
"@visonaut/service": patch
---

Stored the reason that each run closed: a newer run replaced it, the pull request closed, the merge group was destroyed, its baseline was retired, or it expired before it finished. A run that closed before this update has no stored reason.
