---
"@visonaut/web": patch
---

Dropped the unused D1 column `ingest_staged_manifests.evidence_version` with migration 0045. No code reads or writes it any more. A Submit does not change.
