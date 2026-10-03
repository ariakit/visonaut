---
"@visonaut/web": patch
---

Fixed pending visual checks for admitted main runs whose signed local reference became stale before a workflow or executor rollout. Reconciliation now detects the old baseline before source validation, fails the unsealed uploading run, and retains its evidence.
