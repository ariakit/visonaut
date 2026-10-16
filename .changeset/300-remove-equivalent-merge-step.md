---
"@visonaut/web": patch
---

Removed the `check-aliases` step of the scheduled pass. It closed the pending check of a regenerated pull request merge after the tested result passed, and it read GitHub and wrote D1 in each pass while that result had not passed. The webhook no longer creates such a check, and production had no row that the step could read. An unbound pull request check now waits for its own workflow run, which closes it.
