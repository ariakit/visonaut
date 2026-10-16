-- No statement reads or writes these three columns of the staged manifests
-- since the page index replaced the evidence pages. The only schema object
-- that names one is the insert guard of the unwritten evidence page table,
-- which SQLite requires us to drop before the column. The other two triggers
-- and the table itself stay until the removal of the evidence pages.
DROP TRIGGER ingest_staged_evidence_admitted_insert;
ALTER TABLE ingest_staged_manifests DROP COLUMN evidence_page_count;
ALTER TABLE ingest_staged_manifests DROP COLUMN evidence_page_bytes;
ALTER TABLE ingest_staged_manifests DROP COLUMN capture_manifest_digest;
