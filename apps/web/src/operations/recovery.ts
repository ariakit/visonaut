import { digestStream } from "./common.ts";
import { readCaptureInventory } from "../capture-inventory.ts";
import type { OperationsContext } from "./types.ts";
import type { Database } from "@visonaut/service";

export const restoreCutoffSql =
  "COALESCE((SELECT last_seen_at FROM operations_events WHERE id='restore:activation:secrets-required'),0)";

/** Keep restored evidence outside work selection without changing its history. */
export function afterRestoreSql(timestampColumn: string) {
  return `NOT EXISTS(SELECT 1 FROM operations_events restore WHERE restore.id='restore:activation:secrets-required' AND ${timestampColumn}<=restore.last_seen_at)`;
}

/** A newer HTTP receipt cannot renew an already charged restored delivery. */
export function restoredDeliveryGuidSql(guidExpression: string) {
  return `EXISTS(SELECT 1 FROM github_webhook_recovery recovery JOIN operations_events restore
    ON restore.id='restore:activation:secrets-required'
    WHERE recovery.guid=${guidExpression} AND COALESCE(recovery.last_requested_at,0)<=restore.last_seen_at)`;
}

/**
 * The payload of a processed delivery. A pull request keeps its number, title,
 * and repository ID because the Queue reads the title from here. Every other
 * delivery keeps `{}`. Running it on a settled row gives the same value.
 */
export const settledPayloadSql = `CASE WHEN event='pull_request'
  AND json_extract(payload_json,'$.pull_request.number') IS NOT NULL
  THEN json_object(
    'pull_request',json_object(
      'number',json_extract(payload_json,'$.pull_request.number'),
      'title',json_extract(payload_json,'$.pull_request.title')),
    'repository',json_object('id',json_extract(payload_json,'$.repository.id')))
  ELSE '{}' END`;

export async function readRestoreCutoff(database: Database) {
  return (
    (await database.prepare(`SELECT ${restoreCutoffSql} AS cutoff`).first<{ cutoff: number }>())
      ?.cutoff ?? 0
  );
}

/** Run only in the isolated restore target, before deploying new secrets and activating it. */
export async function sanitizeRestoredDatabase(database: Database, now: number) {
  const tables = await database
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all<{ name: string }>();
  const names = new Set((tables.results ?? []).map((row) => row.name));
  const commands: string[] = [];
  for (const table of ["session", "verification", "ingest_review_sessions", "rateLimit"]) {
    if (names.has(table)) commands.push(`DELETE FROM "${table}"`);
  }
  if (names.has("account"))
    commands.push(
      "UPDATE account SET accessToken=NULL,refreshToken=NULL,idToken=NULL,accessTokenExpiresAt=NULL,refreshTokenExpiresAt=NULL",
    );
  for (const table of ["operations_run_archives", "operations_comparison_archives"]) {
    if (names.has(table)) commands.push(`DELETE FROM "${table}" WHERE state='building'`);
  }
  commands.push(
    // Old external writes cannot be proven settled by reading a backup. Keep them fenced.
    "UPDATE work_checks SET ambiguous=1",
    "UPDATE work_status_outbox SET state='obsolete' WHERE state!='complete'",
    "UPDATE operations_check_creations SET state='dead',last_error='restored-environment' WHERE state!='complete'",
    "UPDATE work_tasks SET state='dead',lease_token=NULL,lease_until=NULL,last_error='restored-environment' WHERE state!='complete'",
    // The restore fails each run that it closes. A run that a newer run replaced
    // before the backup keeps that cause.
    "UPDATE visonaut_runs SET active=0,state=CASE WHEN state='accepted' OR (active=0 AND state='superseded') THEN state ELSE 'failed' END",
    "UPDATE visonaut_snapshots SET state='revoked',reference_eligible=0 WHERE state='copying'",
    "DELETE FROM work_retention_pins WHERE reason IN ('recovery','promotion')",
    "DELETE FROM visonaut_pins WHERE reason='export'",
    "DELETE FROM operations_exports",
    "DELETE FROM operations_cursors",
  );
  await database.batch([
    ...commands.map((sql) => database.prepare(sql)),
    // Restored work cannot resume; retire its review ownership with its retention clock.
    database.prepare("UPDATE visonaut_runs SET closed_at=COALESCE(closed_at,?)").bind(now),
    database.prepare(
      `UPDATE work_retained_runs SET closed_at=COALESCE(closed_at,
        (SELECT closed_at FROM visonaut_runs WHERE id=work_retained_runs.id))`,
    ),
    database.prepare(
      `DELETE FROM work_retention_pins WHERE reason='review' AND owner='review:'||run_id
        AND EXISTS(SELECT 1 FROM visonaut_runs run
          WHERE run.id=work_retention_pins.run_id AND run.active=0 AND run.closed_at IS NOT NULL)`,
    ),
    database
      .prepare(
        `UPDATE github_webhook_delivery SET processed_at=COALESCE(processed_at,?),payload_json=${settledPayloadSql}`,
      )
      .bind(now),
    // The cutoff must commit with access/work fencing, before any new capture.
    database
      .prepare(
        "INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at) VALUES('restore:activation:secrets-required','restore','activation','secrets-required',?,?) ON CONFLICT(id) DO UPDATE SET resolved_at=NULL,last_seen_at=MAX(last_seen_at,excluded.last_seen_at)",
      )
      .bind(now, now),
  ]);
  const violations = await database.prepare("PRAGMA foreign_key_check").all();
  if (violations.results?.length) throw new Error("Restored database contains broken references.");
}

/** Read-only evidence check after the isolated database rewind, before reactivation. */
export async function inspectRecoveryImages(context: OperationsContext, afterId = "") {
  const rows = await context.database
    .prepare(
      "SELECT id,object_key,digest,bytes FROM visonaut_images WHERE id>? AND bytes_present=1 AND role='original' ORDER BY id LIMIT ?",
    )
    .bind(afterId, context.budget.objectsPerStep)
    .all<{ id: string; object_key: string; digest: string; bytes: number }>();
  const missing: string[] = [];
  const corrupt: string[] = [];
  for (const image of rows.results ?? []) {
    const object = await context.images.get(image.object_key);
    if (!object) {
      missing.push(image.id);
      continue;
    }
    try {
      const checked = await digestStream(object.body, context.budget.maximumObjectBytes);
      if (checked.digest !== image.digest || checked.bytes !== image.bytes) corrupt.push(image.id);
    } catch {
      corrupt.push(image.id);
    }
  }
  return {
    checked: rows.results?.length ?? 0,
    missing,
    corrupt,
    nextAfterId: rows.results?.at(-1)?.id ?? afterId,
    hasMore: (rows.results?.length ?? 0) === context.budget.objectsPerStep,
  };
}

export interface RecoveryInventoryCursor {
  afterId: string;
  imageIndex: number;
}

interface RecoveryInventory {
  id: string;
  run_id: string;
  project_id: string;
  tested_sha: string;
  inventory_key: string;
  inventory_digest: string;
  inventory_bytes: number;
  capture_count: number;
  verify_images: number;
}

const recoveryInventoriesSql = `SELECT 'run:'||run.id AS id,run.id AS run_id,run.project_id,run.tested_sha,
  run.inventory_key,run.inventory_digest,run.inventory_bytes,run.capture_count,
  run.active=1 AND EXISTS(SELECT 1 FROM work_retained_runs retained WHERE retained.id=run.id AND retained.byte_state='live') AS verify_images
  FROM visonaut_runs run WHERE run.inventory_key IS NOT NULL
  UNION ALL SELECT 'snapshot:'||snapshot.id,snapshot.run_id,snapshot.project_id,snapshot.tested_sha,
  snapshot.inventory_key,snapshot.inventory_digest,snapshot.inventory_bytes,snapshot.capture_count,
  snapshot.reference_eligible=1 OR EXISTS(SELECT 1 FROM visonaut_projects project WHERE project.snapshot_id=snapshot.id)
    OR EXISTS(SELECT 1 FROM visonaut_pins pin WHERE pin.snapshot_id=snapshot.id)
  FROM visonaut_snapshots snapshot WHERE snapshot.inventory_key IS NOT NULL`;

/** Inventories can reference baseline originals that have no D1 image row. */
export async function inspectRecoveryInventories(
  context: OperationsContext,
  cursor: RecoveryInventoryCursor = { afterId: "", imageIndex: 0 },
) {
  if (!Number.isSafeInteger(cursor.imageIndex) || cursor.imageIndex < 0) {
    throw new Error("Recovery inventory cursor is invalid.");
  }
  const row = await context.database
    .prepare(`SELECT * FROM (${recoveryInventoriesSql}) WHERE id>? ORDER BY id LIMIT 1`)
    .bind(cursor.afterId)
    .first<RecoveryInventory>();
  const missing: string[] = [];
  const corrupt: string[] = [];
  if (!row) {
    return {
      checkedInventories: 0,
      checkedImages: 0,
      missing,
      corrupt,
      nextCursor: cursor,
      hasMore: false,
    };
  }
  let checkedImages = 0;
  let nextCursor: RecoveryInventoryCursor = { afterId: row.id, imageIndex: 0 };
  try {
    const inventory = await readCaptureInventory(context.images, {
      objectKey: row.inventory_key,
      digest: row.inventory_digest,
      bytes: row.inventory_bytes,
      captureCount: row.capture_count,
    });
    if (
      inventory.runId !== row.run_id ||
      inventory.projectId !== row.project_id ||
      inventory.testedSha !== row.tested_sha
    ) {
      throw new Error("Recovery inventory belongs to another run.");
    }
    if (row.verify_images) {
      const images = [
        ...new Map(
          inventory.captures.map((capture) => [capture.image.objectKey, capture.image]),
        ).values(),
      ].sort((left, right) =>
        left.objectKey < right.objectKey ? -1 : left.objectKey > right.objectKey ? 1 : 0,
      );
      if (cursor.imageIndex > images.length) {
        throw new Error("Recovery inventory cursor exceeds its image count.");
      }
      const maximum = Math.max(1, Math.min(context.budget.objectsPerStep, 50));
      for (const image of images.slice(cursor.imageIndex, cursor.imageIndex + maximum)) {
        checkedImages += 1;
        const object = await context.images.get(image.objectKey);
        if (!object) {
          missing.push(image.objectKey);
          continue;
        }
        try {
          const checked = await digestStream(object.body, context.budget.maximumObjectBytes);
          if (checked.digest !== image.digest || checked.bytes !== image.bytes) {
            corrupt.push(image.objectKey);
          }
        } catch {
          corrupt.push(image.objectKey);
        }
      }
      const imageIndex = cursor.imageIndex + checkedImages;
      if (imageIndex < images.length) {
        nextCursor = { afterId: cursor.afterId, imageIndex };
      }
    }
  } catch {
    const object = await context.images.get(row.inventory_key);
    if (object) {
      await object.body.cancel();
      corrupt.push(row.inventory_key);
    } else {
      missing.push(row.inventory_key);
    }
  }
  const hasMore =
    nextCursor.imageIndex > 0 ||
    !!(await context.database
      .prepare(`SELECT 1 FROM (${recoveryInventoriesSql}) WHERE id>? LIMIT 1`)
      .bind(nextCursor.afterId)
      .first());
  return { checkedInventories: 1, checkedImages, missing, corrupt, nextCursor, hasMore };
}
