---
"@visonaut/web": patch
---

Reduced image writes during Submit. In the small local D1 fixture, declaring, completing, and registering one uploaded image now writes 10 rows instead of 12, a 16.7% reduction. The count includes image and index writes and excludes transaction checks, run admission, retries, and retention.
