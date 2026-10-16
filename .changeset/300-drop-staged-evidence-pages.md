---
"@visonaut/web": patch
---

Dropped the unused D1 table `ingest_staged_evidence_pages` with migration 0044, and stopped writing the unused column `ingest_staged_manifests.evidence_version`. No code read or wrote the table any more, and it held no row in production. A Submit does not change.
