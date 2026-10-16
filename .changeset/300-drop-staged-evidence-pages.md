---
"@visonaut/web": patch
---

Dropped the unused D1 table `ingest_staged_evidence_pages` and the unused column `ingest_staged_manifests.evidence_version` with migration 0044. No code read or wrote them any more. The table held no row in production, and no manifest there used `evidence_version = 2`. A Submit does not change.
