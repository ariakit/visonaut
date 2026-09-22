import { assertion, statement } from "./database.ts";
import type { Database } from "./database.ts";

/** Materialize once per live target; permanent proofs remain direct edges. */
export function materializeLineageStatements(
  database: Database,
  targetRunId: string,
  proofDigest: string,
) {
  const ancestors = `WITH RECURSIVE ancestors(id) AS (
    SELECT source_run_id FROM ariviso_lineage_edges WHERE target_run_id=?
    UNION SELECT edge.source_run_id FROM ariviso_lineage_edges edge JOIN ancestors ON edge.target_run_id=ancestors.id
  )`;
  return [
    assertion(database, `(${ancestors} SELECT COUNT(*) FROM ancestors)<=100000`, [targetRunId]),
    statement(
      database,
      `${ancestors} INSERT INTO ariviso_lineage(source_run_id,target_run_id,proof_digest)
      SELECT id,?,? FROM ancestors WHERE id!=? ON CONFLICT(source_run_id,target_run_id) DO NOTHING`,
      [targetRunId, targetRunId, proofDigest, targetRunId],
    ),
  ];
}
