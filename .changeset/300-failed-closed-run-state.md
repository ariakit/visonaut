---
"@visonaut/web": patch
"@visonaut/service": patch
---

Fixed the state of a closed run that failed: it is now `failed`, not `superseded`. This applies to a run that expired before its screenshots arrived, which History labeled "Replaced by a newer run", and to each run that is not accepted after a database restore.
