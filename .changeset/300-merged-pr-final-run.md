---
"@visonaut/web": patch
"@visonaut/service": patch
---

Fixed approvals of earlier runs of a merged pull request that were reused by later runs of `main` and of other pull requests. Only the newest run of a merged pull request is now a lineage source of these runs, with the approvals that it holds, also the approvals that it copied from its earlier runs. While a pull request is open, its earlier approvals still apply to its own newer runs, and a merge group still uses each run of its queued pull requests.
