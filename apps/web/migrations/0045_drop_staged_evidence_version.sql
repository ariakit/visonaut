-- No Worker reads or writes ingest_staged_manifests.evidence_version since the
-- Worker of the release with migration 0044 is deployed. No trigger, index, or
-- view names the column, so the drop needs no other statement.
ALTER TABLE ingest_staged_manifests DROP COLUMN evidence_version;
