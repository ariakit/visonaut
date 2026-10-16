import { assertion, statement } from "./database.ts";
import type { Database } from "./database.ts";

/** Materialize once per live target; permanent proofs remain direct edges. */
export function materializeLineageStatements(
  database: Database,
  targetRunId: string,
  proofDigest: string,
) {
  const ancestors = `WITH RECURSIVE ancestors(id) AS (
    SELECT source_run_id FROM visonaut_lineage_edges WHERE target_run_id=?
    UNION SELECT edge.source_run_id FROM visonaut_lineage_edges edge JOIN ancestors ON edge.target_run_id=ancestors.id
  )`;
  // Only the newest run of another pull request is an indirect source, because
  // only its final state merges. Its same-pr edges reach the earlier runs, and
  // older proofs can still name them. A direct proof, such as a queue member,
  // keeps its edge. CROSS JOIN keeps the ancestors as the outer loop, so each
  // one reads its run by ID and the statement reads no other run.
  const superseded = `superseded(id) AS (
    SELECT id FROM (SELECT run.id, ROW_NUMBER() OVER (PARTITION BY run.lineage_key ORDER BY run.created_at DESC, run.id DESC) AS position
      FROM ancestors CROSS JOIN visonaut_runs run ON run.id=ancestors.id
      WHERE run.kind='pull_request' AND run.lineage_key!=(SELECT lineage_key FROM visonaut_runs WHERE id=?))
    WHERE position>1
  )`;
  return [
    assertion(database, `(${ancestors} SELECT COUNT(*) FROM ancestors)<=100000`, [targetRunId]),
    statement(
      database,
      `${ancestors}, ${superseded} INSERT INTO visonaut_lineage(source_run_id,target_run_id,proof_digest)
      SELECT id,?,? FROM ancestors WHERE id!=? AND (id NOT IN superseded OR id IN (SELECT source_run_id FROM visonaut_lineage_edges WHERE target_run_id=?))
      ON CONFLICT(source_run_id,target_run_id) DO NOTHING`,
      [targetRunId, targetRunId, targetRunId, proofDigest, targetRunId, targetRunId],
    ),
  ];
}
