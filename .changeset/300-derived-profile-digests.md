---
"@visonaut/web": patch
---

Made the conversion of a Submit into a run about two times faster when each capture has its own clip rectangle. The check of each written and read page no longer computes the profile digests that the page build derived from the same rows. In local workerd, the conversion of a run of 2 pages (4,000 captures, one profile for each capture) took about 892 ms and now takes about 484 ms, and a run of 10 pages (20,000 captures) took about 4,897 ms and now takes about 2,311 ms. A run where all captures share one profile takes about 7% to 11% less time.
