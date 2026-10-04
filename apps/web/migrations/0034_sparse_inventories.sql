-- Complete inventories remain immutable in R2; D1 owns state and changed rows.
ALTER TABLE visonaut_runs ADD COLUMN inventory_key TEXT;
ALTER TABLE visonaut_runs ADD COLUMN inventory_digest TEXT;
ALTER TABLE visonaut_runs ADD COLUMN inventory_bytes INTEGER;
ALTER TABLE visonaut_runs ADD COLUMN capture_count INTEGER;
ALTER TABLE visonaut_snapshots ADD COLUMN inventory_key TEXT;
ALTER TABLE visonaut_snapshots ADD COLUMN inventory_digest TEXT;
ALTER TABLE visonaut_snapshots ADD COLUMN inventory_bytes INTEGER;
ALTER TABLE visonaut_snapshots ADD COLUMN capture_count INTEGER;
ALTER TABLE visonaut_snapshots ADD COLUMN inventory_verified INTEGER NOT NULL DEFAULT 0 CHECK (inventory_verified IN (0,1));

-- R2 evidence uses the same descriptor fence without temporary D1 pages.
DROP TRIGGER ingest_staged_images_admitted_insert;
DROP TRIGGER ingest_staged_images_admitted_update;
DROP TRIGGER ingest_staged_images_admitted_delete;
CREATE TRIGGER ingest_staged_images_admitted_insert BEFORE INSERT ON ingest_staged_images
WHEN EXISTS (SELECT 1 FROM ingest_staged_manifests WHERE run_id = NEW.run_id AND job_id = NEW.job_id AND declaration_complete = 1)
BEGIN SELECT RAISE(ABORT, 'The admitted image set is immutable.'); END;
CREATE TRIGGER ingest_staged_images_admitted_update BEFORE UPDATE ON ingest_staged_images
WHEN EXISTS (SELECT 1 FROM ingest_staged_manifests WHERE run_id = OLD.run_id AND job_id = OLD.job_id AND declaration_complete = 1)
  AND (NEW.run_id IS NOT OLD.run_id OR NEW.job_id IS NOT OLD.job_id OR NEW.digest IS NOT OLD.digest OR NEW.media_type IS NOT OLD.media_type OR NEW.bytes IS NOT OLD.bytes OR NEW.width IS NOT OLD.width OR NEW.height IS NOT OLD.height OR NEW.image_id IS NOT OLD.image_id OR NEW.object_key IS NOT OLD.object_key OR NEW.quarantine_key IS NOT OLD.quarantine_key OR NEW.complete < OLD.complete)
BEGIN SELECT RAISE(ABORT, 'The admitted image descriptor is immutable.'); END;
CREATE TRIGGER ingest_staged_images_admitted_delete BEFORE DELETE ON ingest_staged_images
WHEN EXISTS (SELECT 1 FROM ingest_staged_manifests manifest JOIN ingest_staged_runs staged ON staged.id = manifest.run_id WHERE manifest.run_id = OLD.run_id AND manifest.job_id = OLD.job_id AND manifest.declaration_complete = 1 AND staged.retention_state = 'live')
BEGIN SELECT RAISE(ABORT, 'Live admitted images cannot be removed.'); END;
