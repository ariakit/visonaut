import { assertion, atomic, ConflictError, statement } from "./database.ts";
import type { Database } from "./database.ts";
import { affectedHistoryOwners, pruneArchivedImageMetadataStatements } from "./prune.ts";

/** The authorized API resolves this exact replay from the verified private archive. */
export class ArchivedCommandResultError extends Error {
  readonly runId: string;
  readonly commandId: string;

  constructor(runId: string, commandId: string) {
    super("The saved command result is in the private run archive.");
    this.name = "ArchivedCommandResultError";
    this.runId = runId;
    this.commandId = commandId;
  }
}

export async function commandRequestDigest(request: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** Closed-history byte pins can remain while their immutable detail is archived. */
export function archiveEligibilitySql(runAlias: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(runAlias)) throw new Error("Invalid SQL alias");
  return `${runAlias}.active = 0 AND ${runAlias}.closed_at IS NOT NULL
    AND ${runAlias}.detail_archived = 0
    AND NOT EXISTS (SELECT 1 FROM work_retained_runs retained
      WHERE retained.id=${runAlias}.id AND retained.byte_state='deleting')
    AND NOT EXISTS (SELECT 1 FROM visonaut_snapshots snapshot
      WHERE snapshot.run_id=${runAlias}.id AND snapshot.reference_eligible=1)
    AND NOT EXISTS (SELECT 1 FROM visonaut_projects project
      LEFT JOIN visonaut_promotions promotion ON promotion.id=project.promotion_id
      JOIN visonaut_snapshots snapshot ON snapshot.id=project.snapshot_id
        OR snapshot.id=promotion.previous_snapshot_id
      WHERE snapshot.run_id=${runAlias}.id)
    AND NOT EXISTS (SELECT 1 FROM work_retention_pins pin
      WHERE pin.run_id=${runAlias}.id AND NOT (
        pin.reason='comparison' AND (
          EXISTS (SELECT 1 FROM visonaut_runs dependent
            WHERE dependent.active=0 AND pin.owner='inherited-by:' || dependent.id)
          OR EXISTS (SELECT 1 FROM visonaut_comparisons comparison
            JOIN visonaut_runs dependent ON dependent.id=comparison.run_id
            WHERE dependent.active=0 AND pin.owner='comparison:' || comparison.id))))
    AND NOT EXISTS (SELECT 1 FROM visonaut_captures capture
      JOIN visonaut_comparison_rows row ON row.reference_capture_id=capture.id OR row.candidate_capture_id=capture.id
      JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id
      JOIN visonaut_runs dependent ON dependent.id=comparison.run_id
      WHERE capture.run_id=${runAlias}.id AND dependent.id!=${runAlias}.id
        AND dependent.active=1 AND dependent.state IN ('uploading','comparing','reviewing'))`;
}

export interface CompactRunHistoryInput {
  runId: string;
  generation: string;
  token: string;
  sourceRevision: number;
  projectRevision: number;
  objectKey: string;
  digest: string;
  bytes: number;
  pageCount: number;
  now: number;
}

type ArchiveLeaseInput = Pick<
  CompactRunHistoryInput,
  "runId" | "generation" | "token" | "sourceRevision" | "projectRevision" | "now"
>;

function archiveGuard(database: Database, input: ArchiveLeaseInput, requireEligible = true) {
  return assertion(
    database,
    `EXISTS (
    SELECT 1 FROM operations_run_archives archive JOIN visonaut_runs run ON run.id=archive.run_id
    JOIN visonaut_projects project ON project.id=run.project_id
    WHERE archive.run_id=? AND archive.generation=? AND archive.state='building'
      AND archive.lease_token=? AND archive.lease_until>?
      AND archive.source_revision=? AND run.revision=?
      AND archive.project_revision=? AND project.revision=?
      ${requireEligible ? `AND ${archiveEligibilitySql("run")}` : ""})`,
    [
      input.runId,
      input.generation,
      input.token,
      input.now,
      input.sourceRevision,
      input.sourceRevision,
      input.projectRevision,
      input.projectRevision,
    ],
  );
}

/** Prepare one exact replay receipt within the archive writer's bounded command page. */
export async function prepareArchivedCommandReplay(
  database: Database,
  input: ArchiveLeaseInput & { commandId: string; requestJson: string },
) {
  const digest = await commandRequestDigest(input.requestJson);
  await atomic(database, [
    // This only prepares a replay hash. The final destructive batch rechecks all roots.
    archiveGuard(database, input, false),
    assertion(
      database,
      `EXISTS(SELECT 1 FROM visonaut_commands command
      JOIN visonaut_comparisons comparison ON comparison.id=command.comparison_id
      WHERE command.id=? AND comparison.run_id=? AND command.request_json=?)`,
      [input.commandId, input.runId, input.requestJson],
    ),
    statement(database, "UPDATE visonaut_commands SET request_digest=? WHERE id=?", [
      digest,
      input.commandId,
    ]),
  ]);
}

/** The caller has written and read-back verified the immutable root and every page. */
export async function compactRunHistory(database: Database, input: CompactRunHistoryInput) {
  if (
    !/^[A-Za-z0-9_-]+$/.test(input.runId) ||
    !/^[A-Za-z0-9_-]+$/.test(input.generation) ||
    input.objectKey !== `history/${input.runId}/${input.generation}/manifest.json` ||
    !/^[a-f0-9]{64}$/.test(input.digest) ||
    !Number.isSafeInteger(input.bytes) ||
    input.bytes < 1 ||
    !Number.isSafeInteger(input.pageCount) ||
    input.pageCount < 1
  ) {
    throw new Error("Invalid verified history archive proof");
  }
  const existing = await database
    .prepare("SELECT state,generation,digest FROM operations_run_archives WHERE run_id=?")
    .bind(input.runId)
    .first<{ state: string; generation: string; digest: string }>();
  if (existing?.state === "ready") {
    if (existing.generation !== input.generation || existing.digest !== input.digest)
      throw new ConflictError("Another archive generation is already linked.");
    return;
  }
  const owners = await affectedHistoryOwners(database, input.runId);
  await atomic(database, [
    archiveGuard(database, input),
    assertion(
      database,
      `NOT EXISTS(SELECT 1 FROM visonaut_commands command JOIN visonaut_comparisons comparison ON comparison.id=command.comparison_id WHERE comparison.run_id=? AND command.request_digest IS NULL)`,
      [input.runId],
    ),
    statement(
      database,
      `DELETE FROM work_tasks WHERE state='complete' AND id IN (SELECT row.id FROM visonaut_comparison_rows row JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=?)`,
      [input.runId],
    ),
    statement(
      database,
      `DELETE FROM visonaut_comparison_rows WHERE comparison_id IN (SELECT id FROM visonaut_comparisons WHERE run_id=?) AND NOT EXISTS(SELECT 1 FROM visonaut_decisions decision WHERE decision.row_id=visonaut_comparison_rows.id)`,
      [input.runId],
    ),
    statement(
      database,
      `UPDATE visonaut_comparison_rows SET reference_capture_id=NULL,candidate_capture_id=NULL,tuple_json='{}',result_json=NULL WHERE comparison_id IN (SELECT id FROM visonaut_comparisons WHERE run_id=?)`,
      [input.runId],
    ),
    statement(
      database,
      `DELETE FROM visonaut_captures WHERE run_id=? AND NOT EXISTS(SELECT 1 FROM visonaut_snapshot_images copy WHERE copy.capture_id=visonaut_captures.id) AND NOT EXISTS(SELECT 1 FROM visonaut_comparison_rows row WHERE row.reference_capture_id=visonaut_captures.id OR row.candidate_capture_id=visonaut_captures.id)`,
      [input.runId],
    ),
    statement(database, "UPDATE visonaut_captures SET metadata_json='{}' WHERE run_id=?", [
      input.runId,
    ]),
    statement(
      database,
      `DELETE FROM visonaut_shards WHERE run_id=? AND NOT EXISTS(SELECT 1 FROM visonaut_captures capture WHERE capture.run_id=visonaut_shards.run_id AND capture.shard_key=visonaut_shards.key)`,
      [input.runId],
    ),
    statement(
      database,
      "UPDATE visonaut_shards SET expected_json='{}',discovery_json=NULL WHERE run_id=?",
      [input.runId],
    ),
    statement(
      database,
      `UPDATE visonaut_commands SET request_json='{}',previous_json='{}',result_json='{}' WHERE comparison_id IN (SELECT id FROM visonaut_comparisons WHERE run_id=?)`,
      [input.runId],
    ),
    statement(database, "DELETE FROM ingest_uploads WHERE run_id=?", [input.runId]),
    statement(database, "DELETE FROM visonaut_audit WHERE run_id=?", [input.runId]),
    statement(database, "DELETE FROM visonaut_lineage WHERE target_run_id=?", [input.runId]),
    statement(
      database,
      "UPDATE visonaut_runs SET plan_json='{}',detail_archived=1,revision=revision+1 WHERE id=?",
      [input.runId],
    ),
    ...pruneArchivedImageMetadataStatements(database, owners),
    statement(
      database,
      "UPDATE visonaut_projects SET revision=revision+1 WHERE id=(SELECT project_id FROM visonaut_runs WHERE id=?)",
      [input.runId],
    ),
    statement(
      database,
      "INSERT INTO visonaut_audit(id,project_id,run_id,action,detail_json,created_at) SELECT ?,project_id,id,'archive-history',?,? FROM visonaut_runs WHERE id=?",
      [
        crypto.randomUUID(),
        JSON.stringify({ generation: input.generation, digest: input.digest }),
        input.now,
        input.runId,
      ],
    ),
    statement(
      database,
      `UPDATE operations_run_archives SET state='ready',digest=?,bytes=?,page_count=?,verified_at=?,progress_json='{}',lease_token=NULL,lease_until=NULL WHERE run_id=?`,
      [input.digest, input.bytes, input.pageCount, input.now, input.runId],
    ),
  ]);
}
