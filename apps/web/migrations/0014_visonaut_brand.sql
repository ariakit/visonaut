-- Rename the brand-specific SQL objects after all prior migrations.
-- Existing databases keep their data and foreign-key relationships.
DROP TRIGGER ariviso_capture_profile_insert;
DROP TRIGGER ariviso_capture_profile_update;
DROP TRIGGER ariviso_snapshot_no_new_pin;
DROP TRIGGER ariviso_snapshot_no_new_reference;
DROP TRIGGER ariviso_snapshot_retention_insert;
ALTER TABLE ariviso_ancestry RENAME TO visonaut_ancestry;
ALTER TABLE ariviso_assertions RENAME TO visonaut_assertions;
ALTER TABLE ariviso_audit RENAME TO visonaut_audit;
ALTER TABLE ariviso_capture_profiles RENAME TO visonaut_capture_profiles;
ALTER TABLE ariviso_captures RENAME TO visonaut_captures;
ALTER TABLE ariviso_checks RENAME TO visonaut_checks;
ALTER TABLE ariviso_commands RENAME TO visonaut_commands;
ALTER TABLE ariviso_comparison_rows RENAME TO visonaut_comparison_rows;
ALTER TABLE ariviso_comparisons RENAME TO visonaut_comparisons;
ALTER TABLE ariviso_decision_replacements RENAME TO visonaut_decision_replacements;
ALTER TABLE ariviso_decisions RENAME TO visonaut_decisions;
ALTER TABLE ariviso_historical_preparations RENAME TO visonaut_historical_preparations;
ALTER TABLE ariviso_identity_history RENAME TO visonaut_identity_history;
ALTER TABLE ariviso_images RENAME TO visonaut_images;
ALTER TABLE ariviso_lineage RENAME TO visonaut_lineage;
ALTER TABLE ariviso_lineage_edges RENAME TO visonaut_lineage_edges;
ALTER TABLE ariviso_pins RENAME TO visonaut_pins;
ALTER TABLE ariviso_policies RENAME TO visonaut_policies;
ALTER TABLE ariviso_projects RENAME TO visonaut_projects;
ALTER TABLE ariviso_promotions RENAME TO visonaut_promotions;
ALTER TABLE ariviso_reservations RENAME TO visonaut_reservations;
ALTER TABLE ariviso_runs RENAME TO visonaut_runs;
ALTER TABLE ariviso_shards RENAME TO visonaut_shards;
ALTER TABLE ariviso_snapshot_images RENAME TO visonaut_snapshot_images;
ALTER TABLE ariviso_snapshot_retention RENAME TO visonaut_snapshot_retention;
ALTER TABLE ariviso_snapshots RENAME TO visonaut_snapshots;
ALTER TABLE ariviso_status_outbox RENAME TO visonaut_status_outbox;
DROP INDEX ariviso_capture_image;
CREATE INDEX visonaut_capture_image ON visonaut_captures(image_id);
DROP INDEX ariviso_captures_profile_digest;
CREATE INDEX visonaut_captures_profile_digest ON visonaut_captures(profile_digest);
DROP INDEX ariviso_captures_run;
CREATE INDEX visonaut_captures_run ON visonaut_captures(run_id, ordinal);
DROP INDEX ariviso_copying_snapshot_scan;
CREATE INDEX visonaut_copying_snapshot_scan ON visonaut_snapshots(created_at, id)
  WHERE state = 'copying';
DROP INDEX ariviso_decisions_pixels;
CREATE INDEX visonaut_decisions_pixels ON visonaut_decisions(
  json_extract(tuple_json,'$.referenceDigest'),
  json_extract(tuple_json,'$.candidateDigest'), revoked, verdict
);
DROP INDEX ariviso_historical_comparing_run;
CREATE UNIQUE INDEX visonaut_historical_comparing_run ON visonaut_comparisons(run_id) WHERE purpose = 'historical' AND state = 'comparing';
DROP INDEX ariviso_images_run;
CREATE INDEX visonaut_images_run ON visonaut_images(run_id);
DROP INDEX ariviso_images_run_role_key;
CREATE INDEX visonaut_images_run_role_key ON visonaut_images(run_id,role,object_key);
DROP INDEX ariviso_lineage_edges_target;
CREATE INDEX visonaut_lineage_edges_target ON visonaut_lineage_edges(target_run_id,source_run_id);
DROP INDEX ariviso_lineage_target;
CREATE INDEX visonaut_lineage_target ON visonaut_lineage(target_run_id,source_run_id);
DROP INDEX ariviso_main_promotion_scan;
CREATE INDEX visonaut_main_promotion_scan ON visonaut_runs(created_at, id)
  WHERE active = 1 AND kind = 'main' AND state != 'accepted';
DROP INDEX ariviso_replacements_successor;
CREATE INDEX visonaut_replacements_successor ON visonaut_decision_replacements(replacement_decision_id);
DROP INDEX ariviso_rows_candidate_capture;
CREATE INDEX visonaut_rows_candidate_capture ON visonaut_comparison_rows(candidate_capture_id) WHERE candidate_capture_id IS NOT NULL;
DROP INDEX ariviso_rows_comparison;
CREATE INDEX visonaut_rows_comparison ON visonaut_comparison_rows(comparison_id, ordinal);
DROP INDEX ariviso_rows_reference_capture;
CREATE INDEX visonaut_rows_reference_capture ON visonaut_comparison_rows(reference_capture_id) WHERE reference_capture_id IS NOT NULL;
DROP INDEX ariviso_runs_active;
CREATE INDEX visonaut_runs_active ON visonaut_runs(project_id, external_run_id, active);
DROP INDEX ariviso_snapshot_capture;
CREATE INDEX visonaut_snapshot_capture ON visonaut_snapshot_images(capture_id);
DROP INDEX ariviso_snapshot_image;
CREATE INDEX visonaut_snapshot_image ON visonaut_snapshot_images(image_id);
DROP INDEX ariviso_snapshot_images_key;
CREATE INDEX visonaut_snapshot_images_key ON visonaut_snapshot_images(snapshot_id,object_key);
-- Move the former profile marker on retained rows before the new trigger checks it.
UPDATE visonaut_captures
SET metadata_json = json_set(
  json_remove(metadata_json, '$.profile.$arivisoProfileDigest'),
  '$.profile.$visonautProfileDigest', profile_digest
)
WHERE json_type(metadata_json, '$.profile.$arivisoProfileDigest') IS NOT NULL;

CREATE TRIGGER visonaut_capture_profile_insert BEFORE INSERT ON visonaut_captures WHEN json_type(NEW.metadata_json,'$.profile.$visonautProfileDigest') IS NOT NULL AND (json_type(NEW.metadata_json,'$.profile.$visonautProfileDigest')<>'text' OR json_extract(NEW.metadata_json,'$.profile.$visonautProfileDigest')<>NEW.profile_digest OR NOT EXISTS(SELECT 1 FROM visonaut_capture_profiles WHERE digest=NEW.profile_digest)) BEGIN SELECT RAISE(ABORT,'Capture profile reference unavailable'); END;
CREATE TRIGGER visonaut_capture_profile_update BEFORE UPDATE OF metadata_json,profile_digest ON visonaut_captures WHEN json_type(NEW.metadata_json,'$.profile.$visonautProfileDigest') IS NOT NULL AND (json_type(NEW.metadata_json,'$.profile.$visonautProfileDigest')<>'text' OR json_extract(NEW.metadata_json,'$.profile.$visonautProfileDigest')<>NEW.profile_digest OR NOT EXISTS(SELECT 1 FROM visonaut_capture_profiles WHERE digest=NEW.profile_digest)) BEGIN SELECT RAISE(ABORT,'Capture profile reference unavailable'); END;
CREATE TRIGGER visonaut_snapshot_no_new_pin BEFORE INSERT ON visonaut_pins
WHEN EXISTS(SELECT 1 FROM visonaut_snapshot_retention WHERE snapshot_id=NEW.snapshot_id AND byte_state!='live')
BEGIN SELECT RAISE(ABORT,'Retired snapshot cannot acquire a new pin'); END;
CREATE TRIGGER visonaut_snapshot_no_new_reference BEFORE UPDATE OF reference_eligible ON visonaut_snapshots
WHEN NEW.reference_eligible=1 AND EXISTS(SELECT 1 FROM visonaut_snapshot_retention WHERE snapshot_id=NEW.id AND byte_state!='live')
BEGIN SELECT RAISE(ABORT,'Retired snapshot cannot acquire a new reference'); END;
CREATE TRIGGER visonaut_snapshot_retention_insert AFTER INSERT ON visonaut_snapshots
BEGIN INSERT INTO visonaut_snapshot_retention(snapshot_id) VALUES(NEW.id); END;
