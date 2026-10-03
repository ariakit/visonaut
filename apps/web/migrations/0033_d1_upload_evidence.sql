-- Legacy declarations keep their R2 reader. New pages are temporary canonical
-- UTF-8 evidence, retained until the comparison owns the durable review data.
ALTER TABLE ingest_staged_manifests ADD COLUMN evidence_version INTEGER NOT NULL DEFAULT 1 CHECK (evidence_version IN (1, 2));
ALTER TABLE ingest_staged_manifests ADD COLUMN evidence_bytes INTEGER;
ALTER TABLE ingest_staged_manifests ADD COLUMN evidence_page_count INTEGER;
ALTER TABLE ingest_staged_manifests ADD COLUMN evidence_page_bytes INTEGER;
ALTER TABLE ingest_staged_manifests ADD COLUMN capture_manifest_digest TEXT;
ALTER TABLE ingest_staged_manifests ADD COLUMN declaration_complete INTEGER NOT NULL DEFAULT 0 CHECK (declaration_complete IN (0, 1));
ALTER TABLE ingest_staged_manifests ADD COLUMN local_receipt_validated INTEGER NOT NULL DEFAULT 0 CHECK (local_receipt_validated IN (0, 1));
CREATE TABLE ingest_staged_evidence_pages (
  run_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number >= 0),
  content BLOB NOT NULL CHECK (typeof(content) = 'blob' AND length(content) BETWEEN 1 AND 262144),
  PRIMARY KEY (run_id, job_id, page_number),
  FOREIGN KEY (run_id, job_id) REFERENCES ingest_staged_manifests(run_id, job_id)
);
-- Version 2 pointers identify compact D1 records, not missing R2 documents.
ALTER TABLE ingest_manifests ADD COLUMN storage_version INTEGER NOT NULL DEFAULT 1 CHECK (storage_version IN (1, 2));
ALTER TABLE ingest_run_provenance ADD COLUMN storage_version INTEGER NOT NULL DEFAULT 1 CHECK (storage_version IN (1, 2));

-- Once admission proves the exact descriptor inventory, only byte-completion
-- updates are allowed. Finalization can then atomically check count/completeness
-- without rebinding the complete manifest in one D1 query or batch.
CREATE TRIGGER ingest_staged_images_admitted_insert BEFORE INSERT ON ingest_staged_images
WHEN EXISTS (SELECT 1 FROM ingest_staged_manifests WHERE run_id = NEW.run_id AND job_id = NEW.job_id AND evidence_version = 2 AND declaration_complete = 1)
BEGIN SELECT RAISE(ABORT, 'The admitted image set is immutable.'); END;
CREATE TRIGGER ingest_staged_images_admitted_update BEFORE UPDATE ON ingest_staged_images
WHEN EXISTS (SELECT 1 FROM ingest_staged_manifests WHERE run_id = OLD.run_id AND job_id = OLD.job_id AND evidence_version = 2 AND declaration_complete = 1)
  AND (NEW.run_id IS NOT OLD.run_id OR NEW.job_id IS NOT OLD.job_id OR NEW.digest IS NOT OLD.digest OR NEW.media_type IS NOT OLD.media_type OR NEW.bytes IS NOT OLD.bytes OR NEW.width IS NOT OLD.width OR NEW.height IS NOT OLD.height OR NEW.image_id IS NOT OLD.image_id OR NEW.object_key IS NOT OLD.object_key OR NEW.quarantine_key IS NOT OLD.quarantine_key OR NEW.complete < OLD.complete)
BEGIN SELECT RAISE(ABORT, 'The admitted image descriptor is immutable.'); END;
CREATE TRIGGER ingest_staged_images_admitted_delete BEFORE DELETE ON ingest_staged_images
WHEN EXISTS (SELECT 1 FROM ingest_staged_manifests manifest JOIN ingest_staged_runs staged ON staged.id = manifest.run_id WHERE manifest.run_id = OLD.run_id AND manifest.job_id = OLD.job_id AND manifest.evidence_version = 2 AND manifest.declaration_complete = 1 AND staged.retention_state = 'live')
BEGIN SELECT RAISE(ABORT, 'Live admitted images cannot be removed.'); END;
CREATE TRIGGER ingest_staged_evidence_admitted_insert BEFORE INSERT ON ingest_staged_evidence_pages
WHEN EXISTS (SELECT 1 FROM ingest_staged_manifests WHERE run_id = NEW.run_id AND job_id = NEW.job_id AND (declaration_complete = 1 OR NEW.page_number >= evidence_page_count))
BEGIN SELECT RAISE(ABORT, 'The admitted evidence pages are immutable.'); END;
CREATE TRIGGER ingest_staged_evidence_update BEFORE UPDATE ON ingest_staged_evidence_pages
BEGIN SELECT RAISE(ABORT, 'Evidence pages are immutable.'); END;
CREATE TRIGGER ingest_staged_evidence_admitted_delete BEFORE DELETE ON ingest_staged_evidence_pages
WHEN EXISTS (SELECT 1 FROM ingest_staged_manifests manifest JOIN ingest_staged_runs staged ON staged.id = manifest.run_id WHERE manifest.run_id = OLD.run_id AND manifest.job_id = OLD.job_id AND manifest.declaration_complete = 1 AND staged.retention_state = 'live')
BEGIN SELECT RAISE(ABORT, 'Live admitted evidence cannot be removed.'); END;
