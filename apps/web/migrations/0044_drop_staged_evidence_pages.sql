-- No statement of the Worker reads or writes the evidence page table since the
-- page index replaced the evidence pages. Production holds no row of it. The
-- column ingest_staged_manifests.evidence_version stays until the Worker of
-- this release is deployed, because the previous Worker still writes it.
DROP TRIGGER IF EXISTS ingest_staged_evidence_update;
DROP TRIGGER IF EXISTS ingest_staged_evidence_admitted_delete;
DROP TABLE ingest_staged_evidence_pages;
