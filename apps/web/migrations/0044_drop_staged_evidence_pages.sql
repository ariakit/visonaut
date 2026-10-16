-- No statement reads or writes the evidence page table or evidence_version
-- since the page index replaced the evidence pages. Production holds no
-- evidence page row and no manifest with evidence_version 2. The three image
-- triggers of 0034 do not name the column, so SQLite allows its removal after
-- the table and its two remaining triggers.
DROP TRIGGER IF EXISTS ingest_staged_evidence_update;
DROP TRIGGER IF EXISTS ingest_staged_evidence_admitted_delete;
DROP TABLE ingest_staged_evidence_pages;
ALTER TABLE ingest_staged_manifests DROP COLUMN evidence_version;
