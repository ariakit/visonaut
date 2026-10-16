---
"@visonaut/web": patch
---

Made the conversion of a Submit into a run about one third faster. The one pass over the staged pages now also makes the comparison of the run, so the conversion no longer reads the stored pages of the run and the reference pages again after the seal. In local workerd, with one profile for each capture and measured again on the commit before this change, the conversion of a run of 2 pages (4,000 captures) took about 434 ms and now takes about 300 ms, and a run of 10 pages (20,000 captures) took about 2,139 ms and now takes about 1,403 ms.
