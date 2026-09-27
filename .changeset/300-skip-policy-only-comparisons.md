---
"@visonaut/web": patch
---

Skipped pixel comparison when validated screenshots have identical bytes and their capture profiles differ only in comparison policy. In the two-pair policy-change fixture, queued pixel tasks fell from two to zero, a 100% reduction.
