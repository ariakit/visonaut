---
"@visonaut/web": patch
---

Fewer GitHub requests and no plan object for a Submit

This update removes repeated work from the Submit path:

- **Reference selection stops at the first ancestor.** In the local fixture with 100 accepted baseline commits, the first reference page of a run sends 1 compare request to GitHub instead of 100. The selected reference does not change.
- **No plan evidence object in R2.** A new run no longer writes `plans/workflow/<digest>.json` to the quarantine bucket. The provenance row in D1 keeps the same evidence.
- **Fewer repeated GitHub reads.** The service reads the workflow run of a first attempt 2 times instead of 3 while it reconciles the job set, and it reads the pull request 1 time instead of 2 for a pull request webhook that can record a candidate.
