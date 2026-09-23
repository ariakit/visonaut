import { assertion, atomic, ConflictError, IncompleteError, statement } from "./database.ts";
import type { Database, Statement } from "./database.ts";

export function historicalOwner(comparisonId: string) {
  return `historical:${comparisonId}`;
}

/** The pins fence both byte deletion and archive compaction while a task runs. */
export function historicalGuard(
  database: Database,
  comparisonId: string,
  requireEligible = true,
): Statement {
  return assertion(
    database,
    `EXISTS (SELECT 1 FROM visonaut_comparisons comparison
    JOIN visonaut_runs run ON run.id = comparison.run_id
    JOIN work_retained_runs retained ON retained.id = run.id
    JOIN work_retention_pins pin ON pin.run_id = run.id
    WHERE comparison.id = ? AND comparison.purpose = 'historical' AND comparison.state = 'comparing'
      AND run.active = 0 AND run.sealed_at IS NOT NULL AND retained.byte_state = 'live'
      AND pin.owner = ? AND pin.reason = 'manual')
    AND NOT EXISTS (SELECT 1 FROM visonaut_comparison_rows row
      JOIN visonaut_captures capture ON capture.id = row.candidate_capture_id
      JOIN visonaut_images image ON image.id = capture.image_id
      WHERE row.comparison_id = ? AND (image.bytes_present != 1 OR NOT EXISTS (
        SELECT 1 FROM work_retention_pins pin JOIN work_retained_runs retained ON retained.id = pin.run_id
        WHERE pin.run_id = image.run_id AND pin.owner = ? AND pin.reason = 'manual' AND retained.byte_state = 'live')))
    AND NOT EXISTS (SELECT 1 FROM visonaut_comparisons comparison
      WHERE comparison.id = ? AND comparison.reference_snapshot_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM visonaut_snapshots snapshot
        JOIN visonaut_snapshot_retention retention ON retention.snapshot_id = snapshot.id
        JOIN visonaut_pins pin ON pin.snapshot_id = snapshot.id
        WHERE snapshot.id = comparison.reference_snapshot_id AND (? = 0 OR snapshot.reference_eligible = 1)
          AND retention.byte_state = 'live' AND pin.reason = 'historical' AND pin.owner_id = comparison.id))`,
    [
      comparisonId,
      historicalOwner(comparisonId),
      comparisonId,
      historicalOwner(comparisonId),
      comparisonId,
      requireEligible ? 1 : 0,
    ],
  );
}

export function releaseHistoricalPins(database: Database, comparisonId: string) {
  return [
    statement(database, "DELETE FROM work_retention_pins WHERE owner = ? AND reason = 'manual'", [
      historicalOwner(comparisonId),
    ]),
    statement(database, "DELETE FROM visonaut_pins WHERE owner_id = ? AND reason = 'historical'", [
      comparisonId,
    ]),
  ];
}

export async function finalizeHistoricalComparison(database: Database, comparisonId: string) {
  const unavailableReference = await database
    .prepare(`SELECT 1 FROM visonaut_comparisons comparison
    JOIN visonaut_snapshots snapshot ON snapshot.id = comparison.reference_snapshot_id
    WHERE comparison.id = ? AND snapshot.reference_eligible != 1`)
    .bind(comparisonId)
    .first();
  const failedTask = await database
    .prepare(`SELECT 1 FROM visonaut_comparison_rows row
    LEFT JOIN work_tasks task ON task.id = row.id
    WHERE row.comparison_id = ? AND (row.outcome = 'error' OR (row.outcome = 'pending' AND task.state = 'dead')) LIMIT 1`)
    .bind(comparisonId)
    .first();
  const pending = await database
    .prepare(
      "SELECT 1 FROM visonaut_comparison_rows WHERE comparison_id = ? AND outcome = 'pending' LIMIT 1",
    )
    .bind(comparisonId)
    .first();
  const failed = Boolean(failedTask || unavailableReference);
  if (pending && !failed) {
    throw new IncompleteError("Required historical comparisons have not completed.");
  }
  await atomic(database, [
    historicalGuard(database, comparisonId, !failed),
    assertion(
      database,
      `NOT EXISTS (SELECT 1 FROM visonaut_comparison_rows row WHERE row.comparison_id = ?
      AND (row.decision_id IS NOT NULL OR row.source_decision_id IS NOT NULL OR row.decision_revision != 0))`,
      [comparisonId],
    ),
    statement(
      database,
      "UPDATE visonaut_comparisons SET state = ? WHERE id = ? AND purpose = 'historical' AND state = 'comparing'",
      [failed ? "invalidated" : "ready", comparisonId],
    ),
    ...(failed
      ? [
          statement(
            database,
            "UPDATE visonaut_comparison_rows SET outcome = 'error' WHERE comparison_id = ? AND outcome = 'pending'",
            [comparisonId],
          ),
          statement(
            database,
            `UPDATE work_tasks SET state = 'dead', lease_token = NULL, lease_until = NULL,
      last_error = 'Historical comparison failed' WHERE id IN (SELECT id FROM visonaut_comparison_rows WHERE comparison_id = ?) AND state IN ('queued', 'leased')`,
            [comparisonId],
          ),
        ]
      : []),
    // The verified supplement releases these roots after preserving the result.
  ]);
}

export async function beginHistoricalPreparation(
  database: Database,
  input: {
    id: string;
    runId: string;
    referenceSnapshotId: string | null;
    now: number;
    leaseMs: number;
  },
) {
  if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1 || input.leaseMs > 900_000) {
    throw new Error("Invalid historical preparation lease.");
  }
  await expireHistoricalPreparations(database, input.now);
  await atomic(database, [
    assertion(
      database,
      `EXISTS (SELECT 1 FROM visonaut_runs run JOIN work_retained_runs retained ON retained.id = run.id
      WHERE run.id = ? AND run.active = 0 AND run.sealed_at IS NOT NULL AND retained.byte_state = 'live')`,
      [input.runId],
    ),
    ...(input.referenceSnapshotId
      ? [
          assertion(
            database,
            `EXISTS (SELECT 1 FROM visonaut_snapshots snapshot
        JOIN visonaut_runs run ON run.id = ? AND run.project_id = snapshot.project_id
        JOIN visonaut_ancestry ancestry ON ancestry.run_id = run.id AND ancestry.ancestor_sha = snapshot.tested_sha
        WHERE snapshot.id = ? AND snapshot.reference_eligible = 1
          AND NOT EXISTS (SELECT 1 FROM visonaut_snapshot_images image WHERE image.snapshot_id = snapshot.id AND image.copied != 1))`,
            [input.runId, input.referenceSnapshotId],
          ),
          statement(
            database,
            "INSERT INTO visonaut_pins(snapshot_id, reason, owner_id) VALUES (?, 'historical', ?)",
            [input.referenceSnapshotId, input.id],
          ),
          statement(
            database,
            "INSERT OR IGNORE INTO work_retention_pins(run_id, owner, reason) SELECT run_id, ?, 'manual' FROM visonaut_snapshots WHERE id = ?",
            [historicalOwner(input.id), input.referenceSnapshotId],
          ),
        ]
      : []),
    statement(
      database,
      "INSERT INTO visonaut_historical_preparations(id, run_id, lease_until) VALUES (?, ?, ?)",
      [input.id, input.runId, input.now + input.leaseMs],
    ),
    statement(
      database,
      "INSERT OR IGNORE INTO work_retention_pins(run_id, owner, reason) VALUES (?, ?, 'manual')",
      [input.runId, historicalOwner(input.id)],
    ),
  ]).catch((error) => {
    if (error instanceof ConflictError) {
      throw new IncompleteError(
        "The stored captures are unavailable or their image bytes have expired.",
      );
    }
    throw error;
  });
}

export async function expireHistoricalPreparations(database: Database, now: number) {
  await atomic(database, [
    statement(
      database,
      `DELETE FROM work_retention_pins WHERE reason = 'manual' AND owner IN (
      SELECT 'historical:' || id FROM visonaut_historical_preparations WHERE lease_until <= ?)`,
      [now],
    ),
    statement(
      database,
      "DELETE FROM visonaut_pins WHERE reason = 'historical' AND owner_id IN (SELECT id FROM visonaut_historical_preparations WHERE lease_until <= ?)",
      [now],
    ),
    statement(
      database,
      `DELETE FROM visonaut_captures WHERE run_id IN (
      SELECT preparation.run_id FROM visonaut_historical_preparations preparation
      JOIN visonaut_runs run ON run.id = preparation.run_id WHERE preparation.lease_until <= ? AND run.detail_archived = 1)
      AND NOT EXISTS (SELECT 1 FROM visonaut_comparison_rows row WHERE row.candidate_capture_id = visonaut_captures.id OR row.reference_capture_id = visonaut_captures.id)
      AND NOT EXISTS (SELECT 1 FROM visonaut_snapshot_images image WHERE image.capture_id = visonaut_captures.id)
      AND NOT EXISTS (SELECT 1 FROM work_retention_pins pin WHERE pin.run_id = visonaut_captures.run_id AND pin.reason = 'manual')`,
      [now],
    ),
    statement(
      database,
      `DELETE FROM visonaut_shards WHERE run_id IN (
      SELECT preparation.run_id FROM visonaut_historical_preparations preparation JOIN visonaut_runs run ON run.id = preparation.run_id
      WHERE preparation.lease_until <= ? AND run.detail_archived = 1)
      AND NOT EXISTS (SELECT 1 FROM visonaut_captures capture WHERE capture.run_id = visonaut_shards.run_id AND capture.shard_key = visonaut_shards.key)
      AND NOT EXISTS (SELECT 1 FROM work_retention_pins pin WHERE pin.run_id = visonaut_shards.run_id AND pin.reason = 'manual')`,
      [now],
    ),
    statement(
      database,
      `UPDATE visonaut_shards SET expected_json = '{}', discovery_json = NULL WHERE run_id IN (
      SELECT preparation.run_id FROM visonaut_historical_preparations preparation JOIN visonaut_runs run ON run.id = preparation.run_id
      WHERE preparation.lease_until <= ? AND run.detail_archived = 1)
      AND NOT EXISTS (SELECT 1 FROM work_retention_pins pin WHERE pin.run_id = visonaut_shards.run_id AND pin.reason = 'manual')`,
      [now],
    ),
    statement(database, "DELETE FROM visonaut_historical_preparations WHERE lease_until <= ?", [
      now,
    ]),
  ]);
}

export interface CompactHistoricalComparisonParams {
  comparisonId: string;
  generation: string;
  token: string;
  objectKey: string;
  digest: string;
  bytes: number;
  pageCount: number;
  now: number;
}

/** Commit the verified immutable supplement before its D1 detail is removed. */
export async function compactHistoricalComparison(
  database: Database,
  input: CompactHistoricalComparisonParams,
) {
  const pointer = await database
    .prepare(
      "SELECT run_id, generation, state, object_key, digest FROM operations_comparison_archives WHERE comparison_id = ?",
    )
    .bind(input.comparisonId)
    .first<{
      run_id: string;
      generation: string;
      state: string;
      object_key: string | null;
      digest: string | null;
    }>();
  if (
    !pointer ||
    input.objectKey !== `history/${pointer.run_id}/${input.generation}/manifest.json` ||
    !/^[a-f0-9]{64}$/u.test(input.digest) ||
    !Number.isSafeInteger(input.bytes) ||
    input.bytes < 1 ||
    !Number.isSafeInteger(input.pageCount) ||
    input.pageCount < 1 ||
    input.pageCount > 4096
  ) {
    throw new Error("The historical archive proof is invalid.");
  }
  if (
    pointer.state === "ready" &&
    pointer.generation === input.generation &&
    pointer.digest === input.digest &&
    pointer.object_key === input.objectKey
  )
    return;
  await atomic(database, [
    assertion(
      database,
      `EXISTS (SELECT 1 FROM operations_comparison_archives archive
      JOIN visonaut_comparisons comparison ON comparison.id = archive.comparison_id
      WHERE archive.comparison_id = ? AND archive.generation = ? AND archive.state = 'building'
        AND archive.lease_token = ? AND archive.lease_until > ? AND archive.object_key = ?
        AND comparison.purpose = 'historical' AND comparison.state IN ('ready', 'invalidated')
        AND comparison.run_id = archive.run_id)
      AND NOT EXISTS (SELECT 1 FROM work_tasks task JOIN visonaut_comparison_rows row ON row.id = task.id
        WHERE row.comparison_id = ? AND task.state IN ('queued', 'leased'))`,
      [
        input.comparisonId,
        input.generation,
        input.token,
        input.now,
        input.objectKey,
        input.comparisonId,
      ],
    ),
    statement(
      database,
      `UPDATE operations_comparison_archives SET state = 'ready', object_key = ?, digest = ?, bytes = ?,
      page_count = ?, verified_at = ?, lease_token = NULL, lease_until = NULL, progress_json = '{}' WHERE comparison_id = ?`,
      [input.objectKey, input.digest, input.bytes, input.pageCount, input.now, input.comparisonId],
    ),
    statement(
      database,
      "DELETE FROM work_tasks WHERE id IN (SELECT id FROM visonaut_comparison_rows WHERE comparison_id = ?)",
      [input.comparisonId],
    ),
    statement(database, "DELETE FROM visonaut_comparison_rows WHERE comparison_id = ?", [
      input.comparisonId,
    ]),
    statement(
      database,
      `DELETE FROM visonaut_captures WHERE run_id = (SELECT run_id FROM visonaut_comparisons WHERE id = ?)
      AND run_id IN (SELECT id FROM visonaut_runs WHERE detail_archived = 1)
      AND NOT EXISTS (SELECT 1 FROM visonaut_comparison_rows row WHERE row.candidate_capture_id = visonaut_captures.id OR row.reference_capture_id = visonaut_captures.id)
      AND NOT EXISTS (SELECT 1 FROM visonaut_snapshot_images image WHERE image.capture_id = visonaut_captures.id)
      AND NOT EXISTS (SELECT 1 FROM work_retention_pins pin WHERE pin.run_id = visonaut_captures.run_id AND pin.reason = 'manual' AND pin.owner != ?)`,
      [input.comparisonId, historicalOwner(input.comparisonId)],
    ),
    statement(
      database,
      `DELETE FROM visonaut_shards WHERE run_id = (SELECT run_id FROM visonaut_comparisons WHERE id = ?)
      AND run_id IN (SELECT id FROM visonaut_runs WHERE detail_archived = 1)
      AND NOT EXISTS (SELECT 1 FROM visonaut_captures capture WHERE capture.run_id = visonaut_shards.run_id AND capture.shard_key = visonaut_shards.key)
      AND NOT EXISTS (SELECT 1 FROM work_retention_pins pin WHERE pin.run_id = visonaut_shards.run_id AND pin.reason = 'manual' AND pin.owner != ?)`,
      [input.comparisonId, historicalOwner(input.comparisonId)],
    ),
    statement(
      database,
      `UPDATE visonaut_shards SET expected_json = '{}', discovery_json = NULL WHERE run_id = (SELECT run_id FROM visonaut_comparisons WHERE id = ?)
      AND run_id IN (SELECT id FROM visonaut_runs WHERE detail_archived = 1)
      AND NOT EXISTS (SELECT 1 FROM work_retention_pins pin WHERE pin.run_id = visonaut_shards.run_id AND pin.reason = 'manual' AND pin.owner != ?)`,
      [input.comparisonId, historicalOwner(input.comparisonId)],
    ),
    statement(
      database,
      `UPDATE visonaut_captures SET metadata_json = '{}' WHERE run_id = (SELECT run_id FROM visonaut_comparisons WHERE id = ?)
      AND run_id IN (SELECT id FROM visonaut_runs WHERE detail_archived = 1)
      AND NOT EXISTS (SELECT 1 FROM work_retention_pins pin WHERE pin.run_id = visonaut_captures.run_id AND pin.reason = 'manual' AND pin.owner != ?)`,
      [input.comparisonId, historicalOwner(input.comparisonId)],
    ),
    ...releaseHistoricalPins(database, input.comparisonId),
  ]);
}

export async function cancelHistoricalPreparation(
  database: Database,
  comparisonId: string,
  now: number,
) {
  await database
    .prepare("UPDATE visonaut_historical_preparations SET lease_until = ? WHERE id = ?")
    .bind(now, comparisonId)
    .run();
  await expireHistoricalPreparations(database, now);
}
