ALTER TABLE ariviso_runs ADD COLUMN detail_archived INTEGER NOT NULL DEFAULT 0 CHECK(detail_archived IN (0,1));
ALTER TABLE ariviso_commands ADD COLUMN request_digest TEXT;
ALTER TABLE work_retained_runs ADD COLUMN references_released_at INTEGER;

CREATE TABLE ariviso_snapshot_retention (
  snapshot_id TEXT PRIMARY KEY REFERENCES ariviso_snapshots(id),
  byte_state TEXT NOT NULL DEFAULT 'live' CHECK(byte_state IN ('live','retiring','deleting','deleted')),
  retired_at INTEGER,
  delete_after INTEGER,
  lease_token TEXT,
  lease_until INTEGER,
  deleted_at INTEGER
);
INSERT INTO ariviso_snapshot_retention(snapshot_id) SELECT id FROM ariviso_snapshots;
CREATE TRIGGER ariviso_snapshot_retention_insert AFTER INSERT ON ariviso_snapshots
BEGIN INSERT INTO ariviso_snapshot_retention(snapshot_id) VALUES(NEW.id); END;
CREATE TRIGGER ariviso_snapshot_no_new_reference BEFORE UPDATE OF reference_eligible ON ariviso_snapshots
WHEN NEW.reference_eligible=1 AND EXISTS(SELECT 1 FROM ariviso_snapshot_retention WHERE snapshot_id=NEW.id AND byte_state!='live')
BEGIN SELECT RAISE(ABORT,'Retired snapshot cannot acquire a new reference'); END;
CREATE TRIGGER ariviso_snapshot_no_new_pin BEFORE INSERT ON ariviso_pins
WHEN EXISTS(SELECT 1 FROM ariviso_snapshot_retention WHERE snapshot_id=NEW.snapshot_id AND byte_state!='live')
BEGIN SELECT RAISE(ABORT,'Retired snapshot cannot acquire a new pin'); END;

CREATE TABLE ariviso_lineage_edges (
  source_run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  target_run_id TEXT NOT NULL REFERENCES ariviso_runs(id),
  proof_digest TEXT NOT NULL,
  PRIMARY KEY(source_run_id,target_run_id)
);
INSERT INTO ariviso_lineage_edges SELECT source_run_id,target_run_id,proof_digest FROM ariviso_lineage;
CREATE INDEX ariviso_lineage_edges_target ON ariviso_lineage_edges(target_run_id,source_run_id);
CREATE INDEX ariviso_lineage_target ON ariviso_lineage(target_run_id,source_run_id);

-- Bound archive and retention ownership probes to the affected rows.
CREATE INDEX ariviso_rows_reference_capture ON ariviso_comparison_rows(reference_capture_id) WHERE reference_capture_id IS NOT NULL;
CREATE INDEX ariviso_rows_candidate_capture ON ariviso_comparison_rows(candidate_capture_id) WHERE candidate_capture_id IS NOT NULL;
CREATE INDEX ariviso_snapshot_capture ON ariviso_snapshot_images(capture_id);
CREATE INDEX ariviso_snapshot_image ON ariviso_snapshot_images(image_id);
CREATE INDEX ariviso_capture_image ON ariviso_captures(image_id);
CREATE INDEX ariviso_images_run ON ariviso_images(run_id);

-- Pixel digests are selective existing keys. Canonical full tuple equality remains mandatory.
DROP INDEX ariviso_decisions_tuple;
CREATE INDEX ariviso_decisions_pixels ON ariviso_decisions(
  json_extract(tuple_json,'$.referenceDigest'),
  json_extract(tuple_json,'$.candidateDigest'), revoked, verdict
);
