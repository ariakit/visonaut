import { assertion, atomic, ConflictError, statement } from "./database.ts";
import type { Database } from "./database.ts";
import { closedRunRetentionMs } from "./work.ts";
import { affectedHistoryOwners, pruneArchivedImageMetadataStatements } from "./prune.ts";

/** A retained candidate baseline does not indefinitely retain its earlier reference. */
export async function releaseExpiredComparisonReferences(
  database: Database,
  input: { runId: string; now: number },
) {
  await atomic(database, [
    assertion(
      database,
      `EXISTS(SELECT 1 FROM visonaut_runs run JOIN work_retained_runs retained ON retained.id=run.id
      WHERE run.id=? AND run.active=0 AND run.closed_at<=? AND retained.references_released_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM work_retention_pins pin WHERE pin.run_id=run.id
          AND pin.reason IN ('manual','review','command','recovery','promotion')))`,
      [input.runId, input.now - closedRunRetentionMs],
    ),
    statement(
      database,
      "DELETE FROM work_retention_pins WHERE owner IN (SELECT 'comparison:' || id FROM visonaut_comparisons WHERE run_id=?)",
      [input.runId],
    ),
    statement(
      database,
      "DELETE FROM visonaut_pins WHERE reason='comparison' AND owner_id IN (SELECT id FROM visonaut_comparisons WHERE run_id=?)",
      [input.runId],
    ),
    statement(database, "UPDATE work_retained_runs SET references_released_at=? WHERE id=?", [
      input.now,
      input.runId,
    ]),
  ]);
}

/** This is distinct from byte retention: closed history is served from its archive. */
function snapshotDetailRootsSql(snapshot: string) {
  return `EXISTS(SELECT 1 FROM visonaut_projects project
    LEFT JOIN visonaut_promotions promotion ON promotion.id=project.promotion_id
    WHERE project.snapshot_id=${snapshot}.id OR promotion.previous_snapshot_id=${snapshot}.id)
    OR EXISTS(SELECT 1 FROM visonaut_runs run WHERE run.id=${snapshot}.run_id
      AND run.active=1 AND run.state IN ('uploading','comparing','reviewing'))
    OR EXISTS(SELECT 1 FROM visonaut_comparisons comparison JOIN visonaut_runs run ON run.id=comparison.run_id
      WHERE comparison.reference_snapshot_id=${snapshot}.id AND run.active=1
        AND run.state IN ('uploading','comparing','reviewing'))
    OR EXISTS(SELECT 1 FROM work_retention_pins pin WHERE pin.run_id=${snapshot}.run_id
      AND pin.reason IN ('manual','command','recovery','promotion'))
    OR EXISTS(SELECT 1 FROM visonaut_pins pin WHERE pin.snapshot_id=${snapshot}.id
      AND pin.reason NOT IN ('comparison','rollback','promotion'))`;
}

export async function retireSnapshot(
  database: Database,
  input: { snapshotId: string; now: number; graceMs?: number },
) {
  const grace = input.graceMs ?? 86_400_000;
  if (!Number.isSafeInteger(grace) || grace < 0) throw new Error("Invalid snapshot grace period");
  const snapshot = await database
    .prepare(`SELECT snapshot.*,project.revision AS project_revision,
    retention.byte_state FROM visonaut_snapshots snapshot JOIN visonaut_projects project ON project.id=snapshot.project_id
    JOIN visonaut_snapshot_retention retention ON retention.snapshot_id=snapshot.id WHERE snapshot.id=?`)
    .bind(input.snapshotId)
    .first<{
      id: string;
      run_id: string;
      project_id: string;
      project_revision: number;
      byte_state: string;
    }>();
  if (!snapshot) throw new Error("Unknown snapshot");
  if (snapshot.byte_state !== "live") return;
  await atomic(database, [
    assertion(
      database,
      `EXISTS(SELECT 1 FROM visonaut_snapshots snapshot
      JOIN visonaut_projects project ON project.id=snapshot.project_id
      JOIN visonaut_snapshot_retention retention ON retention.snapshot_id=snapshot.id
      WHERE snapshot.id=? AND snapshot.state!='copying' AND retention.byte_state='live'
        AND project.revision=? AND NOT (${snapshotDetailRootsSql("snapshot")}))`,
      [snapshot.id, snapshot.project_revision],
    ),
    statement(database, "UPDATE visonaut_snapshots SET reference_eligible=0 WHERE id=?", [
      snapshot.id,
    ]),
    statement(
      database,
      "UPDATE visonaut_snapshot_retention SET byte_state='retiring',retired_at=?,delete_after=? WHERE snapshot_id=?",
      [input.now, input.now + grace, snapshot.id],
    ),
    statement(
      database,
      "DELETE FROM visonaut_pins WHERE snapshot_id=? AND reason IN ('promotion','rollback')",
      [snapshot.id],
    ),
    statement(
      database,
      "DELETE FROM work_retention_pins WHERE run_id=? AND owner=? AND reason='baseline'",
      [snapshot.run_id, `promotion:${snapshot.id}`],
    ),
    statement(
      database,
      `UPDATE visonaut_runs SET active=0,state='superseded',closed_at=COALESCE(closed_at,?),revision=revision+1
      WHERE id=? AND state='accepted' AND NOT EXISTS(SELECT 1 FROM visonaut_projects project
        JOIN visonaut_snapshots current ON current.id=project.snapshot_id WHERE current.run_id=visonaut_runs.id)`,
      [input.now, snapshot.run_id],
    ),
    statement(
      database,
      `UPDATE work_retained_runs SET closed_at=COALESCE(closed_at,?) WHERE id=?
      AND EXISTS(SELECT 1 FROM visonaut_runs run WHERE run.id=work_retained_runs.id AND run.active=0)`,
      [input.now, snapshot.run_id],
    ),
    statement(
      database,
      `DELETE FROM work_retention_pins WHERE run_id=? AND owner=? AND reason='review'
      AND EXISTS(SELECT 1 FROM visonaut_runs run WHERE run.id=work_retention_pins.run_id AND run.active=0)`,
      [snapshot.run_id, `review:${snapshot.run_id}`],
    ),
    statement(database, "UPDATE visonaut_projects SET revision=revision+1 WHERE id=?", [
      snapshot.project_id,
    ]),
    statement(
      database,
      "INSERT INTO visonaut_audit(id,project_id,run_id,action,detail_json,created_at) VALUES(?,?,?,'retire-snapshot',?,?)",
      [
        crypto.randomUUID(),
        snapshot.project_id,
        snapshot.run_id,
        JSON.stringify({ snapshotId: snapshot.id }),
        input.now,
      ],
    ),
  ]);
}

export async function claimRetiredSnapshotDeletion(
  database: Database,
  input: { snapshotId: string; token: string; now: number; leaseMs: number },
) {
  if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs <= 0)
    throw new Error("Invalid deletion lease");
  return database
    .prepare(`UPDATE visonaut_snapshot_retention SET byte_state='deleting',lease_token=?,lease_until=?
    WHERE snapshot_id=? AND ((byte_state='retiring' AND delete_after<=?) OR (byte_state='deleting' AND lease_until<=?))
      AND NOT EXISTS(SELECT 1 FROM operations_backups WHERE state IN ('exporting','copying'))
      AND EXISTS(SELECT 1 FROM visonaut_snapshots snapshot JOIN operations_run_archives archive ON archive.run_id=snapshot.run_id
        WHERE snapshot.id=visonaut_snapshot_retention.snapshot_id AND snapshot.reference_eligible=0 AND archive.state='ready'
          AND NOT (${snapshotDetailRootsSql("snapshot")})
          AND NOT EXISTS(SELECT 1 FROM work_retention_pins pin WHERE pin.run_id=snapshot.run_id)
          AND NOT EXISTS(SELECT 1 FROM visonaut_pins pin JOIN visonaut_comparisons comparison ON comparison.id=pin.owner_id
            JOIN work_retained_runs retained ON retained.id=comparison.run_id
            WHERE pin.snapshot_id=snapshot.id AND pin.reason='comparison' AND retained.byte_state!='deleted'))
    RETURNING snapshot_id,lease_token,lease_until`)
    .bind(input.token, input.now + input.leaseMs, input.snapshotId, input.now, input.now)
    .first<{ snapshot_id: string; lease_token: string; lease_until: number }>();
}

/** The unique protected prefix has been completely removed under this lease. */
export async function completeRetiredSnapshotDeletion(
  database: Database,
  input: { snapshotId: string; token: string; now: number },
) {
  const snapshot = await database
    .prepare("SELECT run_id FROM visonaut_snapshots WHERE id=?")
    .bind(input.snapshotId)
    .first<{ run_id: string }>();
  if (!snapshot) throw new Error("Unknown snapshot");
  const owners = await affectedHistoryOwners(database, snapshot.run_id);
  await atomic(database, [
    assertion(
      database,
      "EXISTS(SELECT 1 FROM visonaut_snapshot_retention WHERE snapshot_id=? AND byte_state='deleting' AND lease_token=? AND lease_until>?)",
      [input.snapshotId, input.token, input.now],
    ),
    statement(
      database,
      "UPDATE visonaut_snapshot_retention SET byte_state='deleted',deleted_at=?,lease_until=NULL WHERE snapshot_id=?",
      [input.now, input.snapshotId],
    ),
    statement(database, "DELETE FROM visonaut_pins WHERE snapshot_id=?", [input.snapshotId]),
    statement(database, "DELETE FROM visonaut_snapshot_images WHERE snapshot_id=?", [
      input.snapshotId,
    ]),
    ...pruneArchivedImageMetadataStatements(database, owners),
  ]);
}

/** Settle the byte lease and its outgoing evidence references together. */
export async function completeRetiredRunDeletion(
  database: Database,
  input: { id: string; token: string; now: number },
) {
  const owners = await affectedHistoryOwners(database, input.id);
  try {
    await atomic(database, [
      assertion(
        database,
        "EXISTS (SELECT 1 FROM work_retained_runs WHERE id = ? AND byte_state = 'deleting' AND deletion_token = ? AND deletion_until > ?)",
        [input.id, input.token, input.now],
      ),
      statement(
        database,
        "UPDATE work_retained_runs SET byte_state = 'deleted', deletion_until = NULL, deleted_at = ?, references_released_at=COALESCE(references_released_at,?) WHERE id = ?",
        [input.now, input.now, input.id],
      ),
      statement(
        database,
        "DELETE FROM work_retention_pins WHERE owner = ? OR owner IN (SELECT 'comparison:' || id FROM visonaut_comparisons WHERE run_id = ?)",
        [`inherited-by:${input.id}`, input.id],
      ),
      statement(
        database,
        "DELETE FROM visonaut_pins WHERE reason = 'comparison' AND owner_id IN (SELECT id FROM visonaut_comparisons WHERE run_id = ?)",
        [input.id],
      ),
      statement(database, "UPDATE visonaut_images SET bytes_present=0 WHERE run_id=?", [input.id]),
      ...pruneArchivedImageMetadataStatements(database, owners),
    ]);
    return true;
  } catch (error) {
    if (error instanceof ConflictError) return false;
    throw error;
  }
}
