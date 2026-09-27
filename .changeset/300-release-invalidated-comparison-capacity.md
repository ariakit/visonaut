---
"@visonaut/web": patch
"@visonaut/compare-worker": patch
---

Fixed baseline promotion and rollback so invalidated pull request comparisons stop using active comparison capacity. Reconciliation now frees their stale Queue slots so other reviews can proceed while those pull requests await recompare.
