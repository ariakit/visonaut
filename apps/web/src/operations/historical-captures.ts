import {
  assertion,
  atomic,
  beginHistoricalPreparation,
  historicalOwner,
  IncompleteError,
  statement,
} from "@visonaut/service";
import type { SqlValue } from "@visonaut/service";
import { readArchivedSection, readHistoryManifest } from "./history.ts";
import type { HistoryRow } from "./history-format.ts";
import type { OperationsContext } from "./types.ts";

function value(row: HistoryRow, name: string): SqlValue {
  const field = row[name];
  if (field === null || typeof field === "string" || typeof field === "number") return field;
  throw new Error("Stored capture metadata is invalid.");
}

export async function prepareHistoricalCaptures(
  context: OperationsContext,
  input: {
    runId: string;
    comparisonId: string;
    referenceSnapshotId: string | null;
    maximumCaptures: number;
  },
) {
  await beginHistoricalPreparation(context.database, {
    id: input.comparisonId,
    runId: input.runId,
    referenceSnapshotId: input.referenceSnapshotId,
    now: context.now(),
    leaseMs: 900_000,
  });
  const guard = () =>
    assertion(
      context.database,
      `EXISTS (SELECT 1 FROM visonaut_historical_preparations preparation
    JOIN work_retention_pins pin ON pin.run_id = preparation.run_id
    WHERE preparation.id = ? AND preparation.run_id = ? AND preparation.lease_until > ?
      AND pin.owner = ? AND pin.reason = 'manual')`,
      [input.comparisonId, input.runId, context.now(), historicalOwner(input.comparisonId)],
    );
  const missingBytes = await context.database
    .prepare(`SELECT 1 FROM visonaut_captures capture
    LEFT JOIN visonaut_images image ON image.id = capture.image_id WHERE capture.run_id = ?
      AND (image.id IS NULL OR image.bytes_present != 1) LIMIT 1`)
    .bind(input.runId)
    .first();
  if (missingBytes)
    throw new IncompleteError("The stored candidate image bytes have expired or are unavailable.");
  const archive = await readHistoryManifest(context, input.runId);
  const run = await context.database
    .prepare("SELECT detail_archived FROM visonaut_runs WHERE id = ?")
    .bind(input.runId)
    .first<{ detail_archived: number }>();
  if (run?.detail_archived && !archive)
    throw new IncompleteError("The stored capture archive is unavailable.");
  if (archive) {
    for await (const rows of readArchivedSection(context, input.runId, "shards")) {
      const columns = [
        "run_id",
        "key",
        "profile_digest",
        "expected_json",
        "state",
        "manifest_digest",
        "full_profile_digest",
        "discovery_json",
        "source_run_id",
        "source_attempt",
      ];
      await atomic(context.database, [
        guard(),
        ...rows.map((row) => {
          if (row.run_id !== input.runId) throw new Error("Stored shard belongs to another run.");
          return statement(
            context.database,
            `INSERT INTO visonaut_shards(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})
          ON CONFLICT(run_id,key) DO UPDATE SET expected_json=excluded.expected_json, discovery_json=excluded.discovery_json`,
            columns.map((column) => value(row, column)),
          );
        }),
      ]);
    }
    let count = 0;
    for await (const rows of readArchivedSection(context, input.runId, "captures")) {
      count += rows.length;
      if (count > input.maximumCaptures)
        throw new IncompleteError("The stored capture inventory exceeds the configured limit.");
      const columns = [
        "id",
        "run_id",
        "shard_key",
        "item_key",
        "variant_key",
        "ordinal",
        "image_id",
        "profile_digest",
        "test_id",
        "test_retry",
        "metadata_json",
      ];
      const unavailable = await context.database
        .prepare(`SELECT value FROM json_each(?) expected
        WHERE NOT EXISTS (SELECT 1 FROM visonaut_images image WHERE image.id = expected.value AND image.bytes_present = 1 AND image.validated = 1) LIMIT 1`)
        .bind(JSON.stringify(rows.map((row) => value(row, "image_id"))))
        .first();
      if (unavailable)
        throw new IncompleteError(
          "The stored candidate image bytes have expired or are unavailable.",
        );
      await atomic(context.database, [
        guard(),
        ...rows.flatMap((row) => {
          if (row.run_id !== input.runId) throw new Error("Stored capture belongs to another run.");
          return [
            assertion(
              context.database,
              "EXISTS (SELECT 1 FROM visonaut_images WHERE id = ? AND bytes_present = 1 AND validated = 1)",
              [value(row, "image_id")],
            ),
            statement(
              context.database,
              "INSERT OR IGNORE INTO work_retention_pins(run_id,owner,reason) SELECT run_id,?,'manual' FROM visonaut_images WHERE id = ?",
              [historicalOwner(input.comparisonId), value(row, "image_id")],
            ),
            statement(
              context.database,
              `INSERT INTO visonaut_captures(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})
            ON CONFLICT(id) DO UPDATE SET metadata_json=excluded.metadata_json WHERE visonaut_captures.metadata_json='{}'`,
              columns.map((column) => value(row, column)),
            ),
            assertion(
              context.database,
              `EXISTS(SELECT 1 FROM visonaut_captures WHERE ${columns.map((column) => `${column} IS ?`).join(" AND ")})`,
              columns.map((column) => value(row, column)),
            ),
          ];
        }),
      ]);
    }
    return count;
  }
  const result = await context.database
    .prepare("SELECT COUNT(*) AS count FROM visonaut_captures WHERE run_id = ?")
    .bind(input.runId)
    .first<{ count: number }>();
  if (!result || result.count < 1 || result.count > input.maximumCaptures)
    throw new IncompleteError("The complete stored capture inventory is unavailable.");
  return result.count;
}
