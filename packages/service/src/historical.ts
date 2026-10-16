import { assertion, atomic, IncompleteError, statement } from "./database.ts";
import type { Database, Statement } from "./database.ts";

export function historicalOwner(comparisonId: string) {
  return `historical:${comparisonId}`;
}

/** The pins fence byte deletion while a task runs. */
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

export async function finalizeHistoricalComparison(database: Database, comparisonId: string) {
  const unavailableReference = await database
    .prepare(`SELECT 1 FROM visonaut_comparisons comparison
    JOIN visonaut_snapshots snapshot ON snapshot.id = comparison.reference_snapshot_id
    WHERE comparison.id = ? AND snapshot.reference_eligible != 1`)
    .bind(comparisonId)
    .first();
  const failedRow = await database
    .prepare(
      "SELECT 1 FROM visonaut_comparison_rows WHERE comparison_id = ? AND outcome = 'error' LIMIT 1",
    )
    .bind(comparisonId)
    .first();
  const pending = await database
    .prepare(
      "SELECT 1 FROM visonaut_comparison_rows WHERE comparison_id = ? AND outcome = 'pending' LIMIT 1",
    )
    .bind(comparisonId)
    .first();
  const failed = Boolean(failedRow || unavailableReference);
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
        ]
      : []),
  ]);
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
