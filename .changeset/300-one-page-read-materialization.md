---
"@visonaut/web": patch
---

Made the conversion of a Submit into a run about 20% faster. The conversion now reads each staged page one time, not two times, and each reference page two times, not three times. In local workerd, the conversion of a run of 2 pages (4,000 captures) took about 536 ms and now takes about 426 ms, and a run of 10 pages (20,000 captures) took about 2,697 ms and now takes about 2,080 ms.
