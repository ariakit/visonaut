import {
  atomic,
  claimExpiredRun,
  closedRunRetentionMs,
  completeRetiredRunDeletion,
} from "@visonaut/service";
import { recordEvent, resolveEvents } from "./common.ts";
import type { OperationReport, OperationsContext } from "./types.ts";

/** Protected baseline objects use a separate namespace and are never swept here. */
export async function expireRunImages(context: OperationsContext): Promise<OperationReport> {
  const { database, budget } = context;
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const candidates = await database
    .prepare(`SELECT id,object_prefix FROM work_retained_runs
    WHERE EXISTS(SELECT 1 FROM operations_run_archives archive WHERE archive.run_id=work_retained_runs.id AND archive.state='ready') AND NOT EXISTS(SELECT 1 FROM work_retention_pins WHERE run_id=work_retained_runs.id) AND ((byte_state='live' AND closed_at IS NOT NULL AND closed_at<=?)
       OR (byte_state='deleting' AND deletion_until<=?))
    ORDER BY closed_at,id LIMIT ?`)
    .bind(context.now() - closedRunRetentionMs, context.now(), budget.tasksPerStep)
    .all<{ id: string; object_prefix: string }>();
  let remaining = budget.objectsPerStep;
  for (const candidate of candidates.results ?? []) {
    if (remaining < 1) {
      report.hasMore = true;
      break;
    }
    // The slash boundary prevents run "a" from deleting run "ab".
    const prefix = candidate.object_prefix;
    if (prefix !== `runs/${candidate.id}/` || !/^runs\/[A-Za-z0-9_-]+\/$/u.test(prefix)) {
      await recordEvent(database, {
        kind: "retention",
        subject: candidate.id,
        code: "unsafe-prefix",
        now: context.now(),
      });
      report.attention.push(candidate.id);
      continue;
    }
    const token = crypto.randomUUID();
    const claim = await claimExpiredRun(database, {
      id: candidate.id,
      token,
      now: context.now(),
      leaseMs: budget.leaseMilliseconds,
    });
    if (!claim) continue;
    try {
      let more = false;
      for (const [store, ownedPrefix] of [
        [context.images, prefix],
        [context.images, `derived/${candidate.id}/`],
        [context.quarantine, `quarantine/${candidate.id}/`],
        [context.quarantine, `manifests/${candidate.id}/`],
      ] as const) {
        if (remaining < 1) {
          more = true;
          break;
        }
        const page = await store.list({ prefix: ownedPrefix, limit: remaining });
        if (page.objects.some((object) => !object.key.startsWith(ownedPrefix))) {
          throw new Error("Storage returned an object outside the run prefix.");
        }
        if (page.objects.length) {
          await store.delete(page.objects.map((object) => object.key));
          remaining -= page.objects.length;
        }
        const next = await store.list({ prefix: ownedPrefix, limit: 1 });
        if (next.objects.length || next.truncated) more = true;
      }
      if (more) {
        report.deferred.push(candidate.id);
        report.hasMore = true;
        await database
          .prepare("UPDATE work_retained_runs SET deletion_until=? WHERE id=? AND deletion_token=?")
          .bind(context.now(), candidate.id, token)
          .run();
      } else {
        // Mark byte absence with the same lease guard that completes deletion.
        await atomic(database, [
          database
            .prepare(`INSERT INTO visonaut_assertions(valid)
          SELECT CASE WHEN EXISTS(SELECT 1 FROM work_retained_runs WHERE id=? AND byte_state='deleting' AND deletion_token=? AND deletion_until>?) THEN 1 ELSE 0 END`)
            .bind(candidate.id, token, context.now()),
          database
            .prepare("UPDATE visonaut_images SET bytes_present=0 WHERE run_id=?")
            .bind(candidate.id),
        ]);
        if (
          !(await completeRetiredRunDeletion(database, {
            id: candidate.id,
            token,
            now: context.now(),
          }))
        ) {
          throw new Error("The deletion lease expired before completion.");
        }
        await resolveEvents(database, "retention", candidate.id, context.now());
        report.completed.push(candidate.id);
      }
    } catch {
      await recordEvent(database, {
        kind: "retention",
        subject: candidate.id,
        code: "delete-failed",
        now: context.now(),
      });
      report.attention.push(candidate.id);
    }
  }
  return report;
}
