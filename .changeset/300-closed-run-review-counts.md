---
"@visonaut/web": patch
---

Fixed the run list answer (`GET /api/runs`) to give a closed run the review counts that its closed summary stored, and `null` for each count before the summary runs, instead of 0.
