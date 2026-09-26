---
"@visonaut/web": patch
---

Skipped pixel comparison for validated screenshots with identical bytes and capture profiles. In the two-pair identical-image regression fixture, queued pixel tasks fell from two to zero, a 100% reduction. Changed screenshots still use the comparator.
