---
"@visonaut/web": patch
---

Made the read of one stored capture page about 2 times faster. In local workerd, a page of 2,000 captures where each capture has its own clip rectangle took about 57 ms to read, and now takes about 23 to 27 ms. Submit and the run page read these pages.
