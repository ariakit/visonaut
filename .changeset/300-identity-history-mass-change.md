---
"@visonaut/web": patch
"@visonaut/service": patch
---

Fixed the materialization and the promotion of a run where many captures changed, which read rows for each pair of a capture and a changed capture to record the identity history. In local D1, one materialization of a run of 20,000 captures where each capture changed now reads 601,382 rows in place of 400,621,386 (about 666× fewer), and 120,424 in place of 16,124,418 at 4,000 captures. The run writes the same rows.
