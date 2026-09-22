import { statement } from "./database.ts";
import type { Database } from "./database.ts";

/** Freeze the owners before the final references are removed in a guarded batch. */
export async function affectedHistoryOwners(database: Database, runId: string) {
  const rows = await database
    .prepare(`WITH affected(id) AS (
    SELECT id FROM visonaut_captures WHERE run_id=?
    UNION SELECT row.reference_capture_id FROM visonaut_comparison_rows row
      JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=?
    UNION SELECT row.candidate_capture_id FROM visonaut_comparison_rows row
      JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=?
  ) SELECT capture.run_id FROM visonaut_captures capture JOIN affected ON affected.id=capture.id
    UNION SELECT image.run_id FROM visonaut_images image JOIN visonaut_captures capture ON capture.image_id=image.id
      JOIN affected ON affected.id=capture.id`)
    .bind(runId, runId, runId)
    .all<{ run_id: string }>();
  return JSON.stringify([...new Set([runId, ...(rows.results ?? []).map((row) => row.run_id)])]);
}

/** Bound cleanup to the runs that owned the removed captures and their image bytes. */
export function pruneArchivedImageMetadataStatements(database: Database, ownersJson: string) {
  return [
    statement(
      database,
      `DELETE FROM visonaut_captures WHERE run_id IN (SELECT value FROM json_each(?))
      AND run_id IN (SELECT id FROM visonaut_runs WHERE detail_archived=1)
      AND NOT EXISTS(SELECT 1 FROM work_retention_pins pin WHERE pin.run_id=visonaut_captures.run_id AND pin.reason='manual')
      AND NOT EXISTS(SELECT 1 FROM visonaut_snapshot_images copy WHERE copy.capture_id=visonaut_captures.id)
      AND NOT EXISTS(SELECT 1 FROM visonaut_comparison_rows row WHERE row.reference_capture_id=visonaut_captures.id OR row.candidate_capture_id=visonaut_captures.id)`,
      [ownersJson],
    ),
    statement(
      database,
      `DELETE FROM visonaut_images WHERE run_id IN (SELECT value FROM json_each(?)) AND bytes_present=0
      AND run_id IN (SELECT id FROM visonaut_runs WHERE detail_archived=1)
      AND NOT EXISTS(SELECT 1 FROM visonaut_captures capture WHERE capture.image_id=visonaut_images.id)
      AND NOT EXISTS(SELECT 1 FROM visonaut_snapshot_images copy WHERE copy.image_id=visonaut_images.id)`,
      [ownersJson],
    ),
  ];
}
