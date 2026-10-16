---
"visonaut": patch
---

Fixed Submit to retry a reference read after a transient HTTP 502, 504, or 503 without an error code, or after a network error. Before, one such error ended the whole Submit. The new `Reference reads` line of the log shows the retry wait.
