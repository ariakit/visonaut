---
"@visonaut/web": patch
---

Fixed the run page of a closed run, which returned 0 for each of the three review counts. The scheduled maintenance pass now stores the counts in the run when it makes the closed summary, so the page keeps them after the rows of the run are gone.
