---
"@visonaut/web": patch
---

Staged unchanged screenshots with bounded parallel image reuse. In the two-original regression fixture, both source reads and both target writes overlapped, doubling in-flight R2 operations in each phase. Available sources are verified before any target write starts; missing sources still fall back to upload.
