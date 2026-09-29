-- Historical migrations remain intact. These records mark the forward-only cutover.
ALTER TABLE visonaut_comparison_rows ADD COLUMN original_tuple_json TEXT;
ALTER TABLE visonaut_decisions ADD COLUMN original_tuple_json TEXT;
ALTER TABLE visonaut_decisions ADD COLUMN source_decision_id TEXT REFERENCES visonaut_decisions(id);
ALTER TABLE visonaut_capture_profiles ADD COLUMN rendering_digest TEXT;
ALTER TABLE visonaut_snapshots ADD COLUMN storage_mode TEXT NOT NULL DEFAULT 'protected' CHECK(storage_mode IN ('protected','source'));
CREATE TABLE visonaut_policy_cutovers(id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
INSERT INTO visonaut_policy_cutovers VALUES('forward-owned-approvals',unixepoch()*1000);
-- Copy only approvals valid at cutover, using the old exact-tuple/lineage/replacement rule.
INSERT INTO visonaut_decisions(id,row_id,revision,verdict,kind,actor_id,tuple_json,created_at,source_decision_id)
SELECT 'cutover:' || row.id,row.id,row.decision_revision+1,'approved',source.kind,source.actor_id,row.tuple_json,unixepoch()*1000,source.id
FROM visonaut_comparison_rows row
JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id
JOIN visonaut_runs target_run ON target_run.id=comparison.run_id
JOIN visonaut_decisions source ON source.id=row.source_decision_id
JOIN visonaut_comparison_rows source_row ON source_row.id=source.row_id AND source_row.decision_id=source.id
JOIN visonaut_comparisons source_comparison ON source_comparison.id=source_row.comparison_id
JOIN visonaut_runs source_run ON source_run.id=source_comparison.run_id
WHERE target_run.active=1 AND source.verdict='approved' AND source.revoked=0
AND source.tuple_json=row.tuple_json AND source_run.project_id=target_run.project_id
AND (source_run.id=target_run.id OR EXISTS(SELECT 1 FROM visonaut_lineage lineage WHERE lineage.source_run_id=source_run.id AND lineage.target_run_id=target_run.id))
AND NOT EXISTS(SELECT 1 FROM visonaut_decision_replacements replacement JOIN visonaut_decisions successor ON successor.id=replacement.replacement_decision_id WHERE replacement.source_decision_id=source.id AND successor.revoked=0 AND (replacement.scope='shared' OR replacement.scope_run_id=target_run.id OR EXISTS(SELECT 1 FROM visonaut_lineage lineage WHERE lineage.source_run_id=replacement.scope_run_id AND lineage.target_run_id=target_run.id)));
UPDATE visonaut_comparison_rows SET decision_id='cutover:' || id,decision_revision=decision_revision+1,source_decision_id=NULL WHERE EXISTS(SELECT 1 FROM visonaut_decisions decision WHERE decision.id='cutover:' || visonaut_comparison_rows.id);
-- Invalid live links become unapproved; they must never be revived by a source edit.
UPDATE visonaut_comparison_rows SET source_decision_id=NULL,decision_revision=decision_revision+1 WHERE source_decision_id IS NOT NULL AND comparison_id IN(SELECT comparison.id FROM visonaut_comparisons comparison JOIN visonaut_runs run ON run.id=comparison.run_id WHERE run.active=1);
-- Source attribution on old closed rows is historical evidence only.
CREATE TABLE visonaut_closed_summaries(
 run_id TEXT PRIMARY KEY REFERENCES visonaut_runs(id), source_revision INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'building' CHECK(state IN('building','ready')), converted_at INTEGER NOT NULL, decision_count INTEGER NOT NULL, row_count INTEGER NOT NULL,
 audit_json TEXT NOT NULL CHECK(json_valid(audit_json))
);
CREATE TABLE visonaut_closed_summary_rows(
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES visonaut_closed_summaries(run_id),
 comparison_id TEXT NOT NULL, ordinal INTEGER NOT NULL, item_key TEXT NOT NULL,variant_key TEXT NOT NULL,
 tuple_json TEXT NOT NULL CHECK(json_valid(tuple_json)),outcome TEXT NOT NULL,
 decision_revision INTEGER NOT NULL,decision_id TEXT,source_decision_id TEXT,accepted INTEGER NOT NULL DEFAULT 0 CHECK(accepted IN(0,1)),
 reference_capture_id TEXT,candidate_capture_id TEXT,verdict TEXT,kind TEXT,actor_id TEXT,revoked INTEGER,
 metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),result_json TEXT
);
CREATE INDEX visonaut_closed_summary_order ON visonaut_closed_summary_rows(run_id,comparison_id,ordinal,id);

CREATE TABLE visonaut_summary_conversion_pages(run_id TEXT NOT NULL REFERENCES visonaut_closed_summaries(run_id),page_key TEXT NOT NULL,section TEXT NOT NULL,rows_json TEXT NOT NULL CHECK(json_valid(rows_json)),PRIMARY KEY(run_id,page_key));

-- Each actor decision remains evidence even after a later decision replaces it.
CREATE TABLE visonaut_closed_summary_decisions(
 id TEXT NOT NULL,run_id TEXT NOT NULL REFERENCES visonaut_closed_summaries(run_id),
 row_id TEXT NOT NULL,revision INTEGER NOT NULL,verdict TEXT NOT NULL,kind TEXT NOT NULL,actor_id TEXT,command_id TEXT,
 tuple_json TEXT NOT NULL CHECK(json_valid(tuple_json)),original_tuple_json TEXT,source_decision_id TEXT,
 revoked INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(run_id,id)
);
CREATE INDEX visonaut_closed_summary_decision_order ON visonaut_closed_summary_decisions(run_id,row_id,revision);

-- Only the verified one-time protected-baseline conversion can restore expired source bytes.
CREATE TABLE visonaut_baseline_restorations(run_id TEXT PRIMARY KEY REFERENCES work_retained_runs(id),snapshot_id TEXT NOT NULL REFERENCES visonaut_snapshots(id),verified_at INTEGER NOT NULL,consumed_at INTEGER);
DROP TRIGGER work_no_byte_resurrection;
CREATE TRIGGER work_no_byte_resurrection BEFORE UPDATE OF byte_state ON work_retained_runs
WHEN OLD.byte_state!='live' AND NEW.byte_state='live' AND NOT(
 OLD.byte_state='deleted' AND EXISTS(SELECT 1 FROM visonaut_baseline_restorations receipt
 JOIN visonaut_snapshots snapshot ON snapshot.id=receipt.snapshot_id
 WHERE receipt.run_id=OLD.id AND receipt.consumed_at IS NULL AND snapshot.storage_mode='protected'
 AND NOT EXISTS(SELECT 1 FROM visonaut_snapshot_images copy JOIN visonaut_images image ON image.id=copy.image_id
 WHERE copy.snapshot_id=snapshot.id AND (copy.object_key!=image.object_key OR copy.copied!=1 OR image.bytes_present!=1))))
BEGIN SELECT RAISE(ABORT,'Deleting run bytes cannot be restored in place'); END;

-- Promotion closes review detail; baseline pins retain only the required original bytes.
UPDATE visonaut_runs SET active=0,closed_at=COALESCE(closed_at,(SELECT MAX(promotion.created_at) FROM visonaut_promotions promotion JOIN visonaut_comparisons comparison ON comparison.id=promotion.comparison_id WHERE comparison.run_id=visonaut_runs.id)),revision=revision+1
WHERE state='accepted' AND active=1 AND EXISTS(SELECT 1 FROM visonaut_promotions promotion JOIN visonaut_comparisons comparison ON comparison.id=promotion.comparison_id WHERE comparison.run_id=visonaut_runs.id);
UPDATE work_retained_runs SET closed_at=COALESCE(closed_at,(SELECT closed_at FROM visonaut_runs WHERE id=work_retained_runs.id)) WHERE id IN(SELECT id FROM visonaut_runs WHERE state='accepted' AND active=0);
DELETE FROM work_retention_pins WHERE reason='review' AND owner IN(SELECT 'review:' || id FROM visonaut_runs WHERE state='accepted' AND active=0);
