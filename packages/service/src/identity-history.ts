import { statement } from "./database.ts";
import type { Database } from "./database.ts";
import type { RunRow } from "./types.ts";

interface IdentityHistoryParams {
  database: Database;
  projectId: string;
  lineageKey: string;
  run: Pick<RunRow, "id" | "inventory_key">;
  comparisonId: string;
}

/**
 * Record the identities that a run adds to the history of a lineage. A run
 * with a capture list adds the captures of its rows with no reference, and an
 * older run adds each capture.
 */
export function identityHistoryStatement({
  database,
  projectId,
  lineageKey,
  run,
  comparisonId,
}: IdentityHistoryParams) {
  if (!run.inventory_key) {
    return statement(
      database,
      "INSERT OR IGNORE INTO visonaut_identity_history (project_id, lineage_key, item_key, variant_key) SELECT ?, ?, item_key, variant_key FROM visonaut_captures WHERE run_id = ?",
      [projectId, lineageKey, run.id],
    );
  }
  // CROSS JOIN keeps the rows of the comparison as the outer loop, so the
  // statement reads each row and one capture for it. A mass change has one row
  // for each capture, and a search of all rows for each capture reads N².
  return statement(
    database,
    "INSERT OR IGNORE INTO visonaut_identity_history (project_id, lineage_key, item_key, variant_key) SELECT ?, ?, capture.item_key, capture.variant_key FROM visonaut_comparison_rows row CROSS JOIN visonaut_captures capture ON capture.id = row.candidate_capture_id WHERE row.comparison_id = ? AND capture.run_id = ? AND json_extract(row.tuple_json,'$.referenceDigest') IS NULL",
    [projectId, lineageKey, comparisonId, run.id],
  );
}
