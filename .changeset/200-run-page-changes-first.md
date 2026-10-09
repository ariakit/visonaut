---
"@visonaut/web": patch
"@visonaut/service": patch
---

Changed the first answer of a run page to the changed, added, and removed screenshots, with the review counts of the run and the number of unchanged screenshots. The unchanged screenshots load in pages of 2,000 when the reviewer opens their group, searches, or follows a link to one of them. Submit stores the baseline image with each changed and each removed screenshot, so the service reads this answer from the database only. A run that was submitted before this update has no stored baseline image, and its answer still reads the two capture lists of the run.
