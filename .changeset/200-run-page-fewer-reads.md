---
"@visonaut/web": patch
"@visonaut/service": patch
---

Fewer database reads for the first answer of a run page

This update removes repeated work from the first answer of a run page:

- **Each row is read one time.** The answer reads the run, the project, and the comparison one time each. For a run that waits for a review, the answer makes 10 database round trips instead of 13 in the local test.
- **The read-only reason is sent one time.** The answer of a closed run has its read-only reason in the header only, and not in each screenshot.
- **No copy of a capture list for its digest.** The service hashes the bytes of a capture list with no copy of them.
