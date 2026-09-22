import {
  assertion,
  atomic,
  claimRetiredSnapshotDeletion,
  closedRunRetentionMs,
  completeRetiredSnapshotDeletion,
  ConflictError,
  releaseExpiredComparisonReferences,
  retireSnapshot,
} from "@visonaut/service";
import { recordEvent, resolveEvents, safeKey } from "./common.ts";
import type { OperationReport, OperationsContext } from "./types.ts";

async function afterCursor(context: OperationsContext, id: string) {
  const row = await context.database
    .prepare("SELECT value FROM operations_cursors WHERE id=?")
    .bind(id)
    .first<{ value: string | null }>();
  return row?.value ?? "";
}
async function saveCursor(context: OperationsContext, id: string, after: string) {
  await context.database
    .prepare(
      "INSERT INTO operations_cursors(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    )
    .bind(id, after)
    .run();
}

/** Release expired outgoing comparison roots before considering protected-copy deletion. */
export async function expireComparisonReferences(
  context: OperationsContext,
): Promise<OperationReport> {
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const cursor = "snapshot-reference-retention";
  const rows = await context.database
    .prepare(`SELECT run.id FROM visonaut_runs run JOIN work_retained_runs retained ON retained.id=run.id
    WHERE run.id>? AND run.active=0 AND run.closed_at<=? AND retained.references_released_at IS NULL
    ORDER BY run.id LIMIT ?`)
    .bind(
      await afterCursor(context, cursor),
      context.now() - closedRunRetentionMs,
      context.budget.tasksPerStep,
    )
    .all<{ id: string }>();
  const candidates = rows.results ?? [];
  for (const row of candidates) {
    try {
      await releaseExpiredComparisonReferences(context.database, {
        runId: row.id,
        now: context.now(),
      });
      await resolveEvents(context.database, "reference-retention", row.id, context.now());
      report.completed.push(row.id);
    } catch (error) {
      if (error instanceof ConflictError) {
        report.deferred.push(row.id);
        continue;
      }
      await recordEvent(context.database, {
        kind: "reference-retention",
        subject: row.id,
        code: "release-failed",
        now: context.now(),
      });
      report.attention.push(row.id);
    }
  }
  await saveCursor(
    context,
    cursor,
    candidates.length === context.budget.tasksPerStep ? (candidates.at(-1)?.id ?? "") : "",
  );
  report.hasMore = candidates.length === context.budget.tasksPerStep && report.completed.length > 0;
  return report;
}

/** Retire reference eligibility first; delete only the unique old prefix after the guarded grace. */
export async function expireSnapshotImages(context: OperationsContext): Promise<OperationReport> {
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const cursor = "snapshot-byte-retention";
  const rows = await context.database
    .prepare(`SELECT snapshot.id,snapshot.prefix,retention.byte_state FROM visonaut_snapshots snapshot
    JOIN visonaut_snapshot_retention retention ON retention.snapshot_id=snapshot.id WHERE snapshot.id>? AND (
      (retention.byte_state='live' AND snapshot.state!='copying') OR (retention.byte_state='retiring' AND retention.delete_after<=?)
      OR (retention.byte_state='deleting' AND retention.lease_until<=?)) ORDER BY snapshot.id LIMIT ?`)
    .bind(
      await afterCursor(context, cursor),
      context.now(),
      context.now(),
      context.budget.tasksPerStep,
    )
    .all<{ id: string; prefix: string; byte_state: string }>();
  const candidates = rows.results ?? [];
  let remaining = context.budget.objectsPerStep;
  let processed = "";
  let progress = 0;
  for (const row of candidates) {
    if (remaining < 1) {
      report.hasMore = true;
      break;
    }
    processed = row.id;
    try {
      if (row.byte_state === "live") {
        await retireSnapshot(context.database, { snapshotId: row.id, now: context.now() });
        progress += 1;
        report.deferred.push(row.id);
        continue;
      }
      safeKey(row.prefix);
      if (!row.prefix.startsWith("baselines/") || row.prefix.endsWith("/"))
        throw new Error("Invalid protected snapshot prefix.");
      const prefix = `${row.prefix}/`;
      const token = crypto.randomUUID();
      const claim = await claimRetiredSnapshotDeletion(context.database, {
        snapshotId: row.id,
        token,
        now: context.now(),
        leaseMs: context.budget.leaseMilliseconds,
      });
      if (!claim) {
        report.deferred.push(row.id);
        continue;
      }
      const page = await context.images.list({ prefix, limit: remaining });
      if (page.objects.some((object) => !object.key.startsWith(prefix)))
        throw new Error("Protected deletion escaped its prefix.");
      await context.images.delete(page.objects.map((object) => object.key));
      remaining -= page.objects.length;
      const next = await context.images.list({ prefix, limit: 1 });
      if (next.objects.length || next.truncated) {
        await atomic(context.database, [
          assertion(
            context.database,
            "EXISTS(SELECT 1 FROM visonaut_snapshot_retention WHERE snapshot_id=? AND byte_state='deleting' AND lease_token=? AND lease_until>?)",
            [row.id, token, context.now()],
          ),
          context.database
            .prepare(
              "UPDATE visonaut_snapshot_retention SET lease_until=? WHERE snapshot_id=? AND lease_token=?",
            )
            .bind(context.now(), row.id, token),
        ]);
        report.deferred.push(row.id);
        report.hasMore = true;
      } else {
        await completeRetiredSnapshotDeletion(context.database, {
          snapshotId: row.id,
          token,
          now: context.now(),
        });
        await resolveEvents(context.database, "snapshot-retention", row.id, context.now());
        report.completed.push(row.id);
      }
      progress += 1;
    } catch (error) {
      if (error instanceof ConflictError) {
        report.deferred.push(row.id);
        continue;
      }
      await recordEvent(context.database, {
        kind: "snapshot-retention",
        subject: row.id,
        code: "delete-failed",
        now: context.now(),
      });
      report.attention.push(row.id);
    }
  }
  await saveCursor(
    context,
    cursor,
    processed === candidates.at(-1)?.id && candidates.length < context.budget.tasksPerStep
      ? ""
      : processed,
  );
  report.hasMore ||= candidates.length === context.budget.tasksPerStep && progress > 0;
  return report;
}
