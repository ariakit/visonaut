import { atomic, assertion } from "@visonaut/service";
import { digestStream, copyVerifiedObject, recordEvent, resolveEvents } from "./common.ts";
import type { OperationsContext, OperationReport } from "./types.ts";

/** One-time conversion. Keep protected bytes until source readback and all owner pins pass. */
export async function convertSourceBaselines(context: OperationsContext): Promise<OperationReport> {
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const cursorId = "baseline-conversion";
  const cursor = await context.database
    .prepare("SELECT value FROM operations_cursors WHERE id=?")
    .bind(cursorId)
    .first<{ value: string }>();
  const rows = await context.database
    .prepare(`SELECT snapshot.id,snapshot.run_id FROM visonaut_snapshots snapshot
    WHERE snapshot.id>? AND storage_mode='protected' AND (reference_eligible=1 OR EXISTS(SELECT 1 FROM visonaut_pins WHERE snapshot_id=snapshot.id))
    AND NOT EXISTS(SELECT 1 FROM operations_events event WHERE event.kind='baseline-conversion' AND event.subject_id=snapshot.id AND event.code='source-verification-failed' AND event.resolved_at IS NULL AND event.last_seen_at>?)
    ORDER BY snapshot.id LIMIT ?`)
    .bind(
      cursor?.value ?? "",
      context.now() - context.budget.leaseMilliseconds,
      context.budget.tasksPerStep,
    )
    .all<{ id: string; run_id: string }>();
  let remaining = context.budget.objectsPerStep;
  for (const snapshot of rows.results ?? []) {
    try {
      // D1 pins serialize with retention claim. Retention must be live before the pin exists.
      await atomic(context.database, [
        assertion(
          context.database,
          `NOT EXISTS(SELECT 1 FROM visonaut_snapshot_images copy JOIN visonaut_images image ON image.id=copy.image_id
          JOIN work_retained_runs retained ON retained.id=image.run_id WHERE copy.snapshot_id=? AND retained.byte_state='deleting')`,
          [snapshot.id],
        ),
        context.database
          .prepare(`INSERT OR IGNORE INTO work_retention_pins(run_id,owner,reason)
          SELECT retained.id,?,'baseline' FROM work_retained_runs retained
          WHERE retained.byte_state='live' AND (retained.id=? OR retained.id IN(
            SELECT image.run_id FROM visonaut_snapshot_images copy JOIN visonaut_images image ON image.id=copy.image_id WHERE copy.snapshot_id=?))`)
          .bind(`promotion:${snapshot.id}`, snapshot.run_id, snapshot.id),
      ]);
      const pending = await context.database
        .prepare(`SELECT copy.capture_id,copy.object_key AS protected_key,image.object_key AS source_key,copy.digest,image.bytes,image.id
        FROM visonaut_snapshot_images copy JOIN visonaut_images image ON image.id=copy.image_id
        WHERE copy.snapshot_id=? AND copy.object_key!=image.object_key ORDER BY copy.capture_id LIMIT ?`)
        .bind(snapshot.id, remaining)
        .all<{
          capture_id: string;
          protected_key: string;
          source_key: string;
          digest: string;
          bytes: number;
          id: string;
        }>();
      for (const image of pending.results ?? []) {
        const original = await context.images.get(image.source_key);
        if (original) {
          const verified = await digestStream(original.body, context.budget.maximumObjectBytes);
          if (verified.digest !== image.digest || verified.bytes !== image.bytes)
            throw new Error("Source baseline original is corrupt.");
        } else {
          await copyVerifiedObject({
            source: context.images,
            destination: context.images,
            sourceKey: image.protected_key,
            destinationKey: image.source_key,
            expectedDigest: image.digest,
            expectedBytes: image.bytes,
            maximum: context.budget.maximumObjectBytes,
          });
        }
        await atomic(context.database, [
          assertion(
            context.database,
            "EXISTS(SELECT 1 FROM visonaut_snapshots WHERE id=? AND storage_mode='protected')",
            [snapshot.id],
          ),
          context.database
            .prepare(
              "UPDATE visonaut_snapshot_images SET object_key=?,copied=1 WHERE snapshot_id=? AND capture_id=? AND digest=?",
            )
            .bind(image.source_key, snapshot.id, image.capture_id, image.digest),
          context.database
            .prepare("UPDATE visonaut_images SET bytes_present=1 WHERE id=? AND digest=?")
            .bind(image.id, image.digest),
        ]);
        remaining -= 1;
      }
      const unconverted = await context.database
        .prepare(`SELECT 1 FROM visonaut_snapshot_images copy JOIN visonaut_images image ON image.id=copy.image_id
        WHERE copy.snapshot_id=? AND (copy.object_key!=image.object_key OR copy.copied!=1) LIMIT 1`)
        .bind(snapshot.id)
        .first();
      if (unconverted) {
        report.deferred.push(snapshot.id);
        report.hasMore = true;
      } else {
        await atomic(context.database, [
          assertion(
            context.database,
            `NOT EXISTS(SELECT 1 FROM visonaut_snapshot_images copy JOIN visonaut_images image ON image.id=copy.image_id
            WHERE copy.snapshot_id=? AND (copy.object_key!=image.object_key OR copy.copied!=1 OR image.bytes_present!=1))`,
            [snapshot.id],
          ),
          context.database
            .prepare(`INSERT INTO visonaut_baseline_restorations(run_id,snapshot_id,verified_at)
            SELECT retained.id,?,? FROM work_retained_runs retained WHERE retained.byte_state='deleted'
            AND (retained.id=? OR retained.id IN(SELECT image.run_id FROM visonaut_snapshot_images copy JOIN visonaut_images image ON image.id=copy.image_id WHERE copy.snapshot_id=?))
            ON CONFLICT(run_id) DO NOTHING`)
            .bind(snapshot.id, context.now(), snapshot.run_id, snapshot.id),
          context.database
            .prepare(`UPDATE work_retained_runs SET byte_state='live',deletion_token=NULL,deletion_until=NULL,deleted_at=NULL
            WHERE byte_state='deleted' AND id IN(SELECT run_id FROM visonaut_baseline_restorations WHERE snapshot_id=? AND consumed_at IS NULL)`)
            .bind(snapshot.id),
          context.database
            .prepare(`INSERT OR IGNORE INTO work_retention_pins(run_id,owner,reason)
            SELECT ?,?,'baseline' UNION SELECT image.run_id,?,'baseline' FROM visonaut_snapshot_images copy JOIN visonaut_images image ON image.id=copy.image_id WHERE copy.snapshot_id=?`)
            .bind(
              snapshot.run_id,
              `promotion:${snapshot.id}`,
              `promotion:${snapshot.id}`,
              snapshot.id,
            ),
          context.database
            .prepare(
              "UPDATE visonaut_baseline_restorations SET consumed_at=? WHERE snapshot_id=? AND consumed_at IS NULL",
            )
            .bind(context.now(), snapshot.id),
          context.database
            .prepare("UPDATE visonaut_snapshots SET storage_mode='source' WHERE id=?")
            .bind(snapshot.id),
        ]);
        await resolveEvents(context.database, "baseline-conversion", snapshot.id, context.now());
        report.completed.push(snapshot.id);
      }
    } catch {
      await recordEvent(context.database, {
        kind: "baseline-conversion",
        subject: snapshot.id,
        code: "source-verification-failed",
        now: context.now(),
      });
      report.attention.push(snapshot.id);
    }
    await context.database
      .prepare(
        "INSERT INTO operations_cursors(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .bind(cursorId, snapshot.id)
      .run();
    if (remaining < 1) {
      report.hasMore = true;
      break;
    }
  }
  if ((rows.results?.length ?? 0) < context.budget.tasksPerStep && remaining > 0) {
    await context.database
      .prepare("DELETE FROM operations_cursors WHERE id=?")
      .bind(cursorId)
      .run();
  }
  report.hasMore ||= (rows.results?.length ?? 0) === context.budget.tasksPerStep;
  if (!(rows.results?.length ?? 0)) {
    const pending = await context.database
      .prepare(`SELECT 1 FROM visonaut_snapshots snapshot WHERE storage_mode='protected' AND (reference_eligible=1 OR EXISTS(SELECT 1 FROM visonaut_pins WHERE snapshot_id=snapshot.id))
    AND NOT EXISTS(SELECT 1 FROM operations_events event WHERE event.kind='baseline-conversion' AND event.subject_id=snapshot.id AND event.code='source-verification-failed' AND event.resolved_at IS NULL AND event.last_seen_at>?) LIMIT 1`)
      .bind(context.now() - context.budget.leaseMilliseconds)
      .first();
    report.hasMore = Boolean(pending);
  }
  return report;
}
