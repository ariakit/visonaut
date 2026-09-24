import { assertion, atomic, Service, type Database } from "@visonaut/service";
import { recordEvent, resolveEvents } from "../operations/common.ts";
import type { ObjectStore, OperationReport, OperationsBudget } from "../operations/types.ts";

// GitHub permits reruns for 30 days after the initial run and a workflow
// attempt can last 35 days. Five extra days cover scheduling and clock skew.
// https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs
// https://docs.github.com/en/actions/reference/limits
export const stagedAttemptRetentionMs = 70 * 24 * 60 * 60 * 1000;
export const stagedMaterializationLeaseMs = 6 * 60 * 60 * 1000;

interface StagedRetentionContext {
  database: Database;
  images: Pick<ObjectStore, "list" | "delete">;
  quarantine: Pick<ObjectStore, "list" | "delete">;
  budget: Pick<OperationsBudget, "tasksPerStep" | "objectsPerStep" | "leaseMilliseconds">;
  now(): number;
}

interface StagedCandidate {
  id: string;
}

const stagedDeletionEligibility = `(
  (EXISTS (SELECT 1 FROM visonaut_runs run
      WHERE run.id = ingest_staged_runs.id
        AND (run.sealed_at IS NOT NULL OR (run.active = 0 AND run.closed_at IS NOT NULL)))
    OR (NOT EXISTS (SELECT 1 FROM visonaut_runs run WHERE run.id = ingest_staged_runs.id)
      AND NOT EXISTS (SELECT 1 FROM visonaut_images image
        WHERE image.object_key LIKE 'runs/' || ingest_staged_runs.id || '/images/%')))
  AND NOT EXISTS (SELECT 1 FROM ingest_staged_runs newer
    WHERE newer.repository_id = ingest_staged_runs.repository_id
      AND newer.workflow_run_id = ingest_staged_runs.workflow_run_id
      AND newer.workflow_attempt > ingest_staged_runs.workflow_attempt
      AND newer.tested_sha = ingest_staged_runs.tested_sha
      AND newer.workflow_source_digest = ingest_staged_runs.workflow_source_digest
      AND newer.submitted_at IS NOT NULL AND newer.retention_state = 'live'
      AND newer.created_at > ?
      AND NOT EXISTS (SELECT 1 FROM visonaut_runs run
        WHERE run.id = newer.id AND run.sealed_at IS NOT NULL))
)`;

const stagedChildTables = [
  "ingest_staged_images",
  "ingest_staged_manifests",
  "ingest_staged_bundles",
] as const;

interface DeleteChildPageParams {
  database: Database;
  table: (typeof stagedChildTables)[number];
  runId: string;
  token: string;
  now: number;
  limit: number;
}

async function deleteChildPage({
  database,
  table,
  runId,
  token,
  now,
  limit,
}: DeleteChildPageParams) {
  if (limit < 1) return { deleted: 0, more: true };
  const rows = await database
    .prepare(`SELECT 1 AS found FROM ${table} WHERE run_id = ? LIMIT ?`)
    .bind(runId, limit + 1)
    .all<{ found: number }>();
  const rowCount = rows.results?.length ?? 0;
  const count = Math.min(rowCount, limit);
  if (!count) return { deleted: 0, more: false };
  await atomic(database, [
    assertion(
      database,
      "EXISTS (SELECT 1 FROM ingest_staged_runs WHERE id = ? AND retention_state = 'deleting' AND deletion_token = ? AND deletion_until > ?)",
      [runId, token, now],
    ),
    database
      .prepare(`DELETE FROM ${table} WHERE rowid IN
        (SELECT rowid FROM ${table} WHERE run_id = ? LIMIT ?)`)
      .bind(runId, count),
  ]);
  return { deleted: count, more: rowCount > count };
}

async function deletePrefix(
  store: Pick<ObjectStore, "list" | "delete">,
  prefix: string,
  limit: number,
) {
  const page = await store.list({ prefix, limit });
  if (page.objects.some((object) => !object.key.startsWith(prefix))) {
    throw new Error("Storage returned an object outside the staged prefix.");
  }
  if (page.objects.length) await store.delete(page.objects.map((object) => object.key));
  const next = await store.list({ prefix, limit: 1 });
  return { deleted: page.objects.length, more: next.objects.length > 0 || next.truncated };
}

async function hasReferencedManifest(database: Database, runId: string) {
  const reference = await database
    .prepare("SELECT 1 AS found FROM ingest_manifests WHERE object_key LIKE ? LIMIT 1")
    .bind(`manifests/${runId}/%`)
    .first<{ found: number }>();
  return reference !== null;
}

/** Retire staging evidence after every possible inherited rerun has ended. */
export async function expireStagedAttempts(
  context: StagedRetentionContext,
): Promise<OperationReport> {
  const { database, budget } = context;
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const cutoff = context.now() - stagedAttemptRetentionMs;
  const incomplete = await database
    .prepare(`SELECT staged.id
      FROM ingest_staged_runs staged JOIN visonaut_runs run ON run.id = staged.id
      WHERE staged.created_at <= ? AND staged.retention_state = 'live'
        AND staged.submitted_at IS NOT NULL
        AND COALESCE(staged.materialization_lease_until, 0) <= ?
        AND run.active = 1 AND run.sealed_at IS NULL
      ORDER BY staged.created_at, staged.id LIMIT ?`)
    .bind(cutoff, context.now(), budget.tasksPerStep)
    .all<StagedCandidate>();
  if ((incomplete.results?.length ?? 0) === budget.tasksPerStep) report.hasMore = true;
  const service = new Service(database);
  for (const candidate of incomplete.results ?? []) {
    try {
      const expired = await service.expireIncompleteWorkflowRun({
        runId: candidate.id,
        cutoff,
        now: context.now(),
      });
      if (expired) report.attention.push(candidate.id);
    } catch {
      await recordEvent(database, {
        kind: "staged-retention",
        subject: candidate.id,
        code: "terminalize-failed",
        now: context.now(),
      });
      report.attention.push(candidate.id);
    }
  }
  const candidates = await database
    .prepare(`SELECT id FROM ingest_staged_runs
      WHERE created_at <= ?
        AND COALESCE(materialization_lease_until, 0) <= ?
        AND (retention_state = 'live'
          OR (retention_state = 'deleting' AND deletion_until <= ?))
        AND ${stagedDeletionEligibility}
      ORDER BY created_at, id LIMIT ?`)
    .bind(cutoff, context.now(), context.now(), cutoff, budget.tasksPerStep)
    .all<StagedCandidate>();
  let remaining = budget.objectsPerStep;
  for (const candidate of candidates.results ?? []) {
    if (remaining < 1) {
      report.hasMore = true;
      break;
    }
    if (!/^[a-f0-9-]{36}$/u.test(candidate.id)) {
      await recordEvent(database, {
        kind: "staged-retention",
        subject: candidate.id,
        code: "unsafe-prefix",
        now: context.now(),
      });
      report.attention.push(candidate.id);
      continue;
    }
    const token = crypto.randomUUID();
    const claim = await database
      .prepare(`UPDATE ingest_staged_runs
        SET retention_state = 'deleting', deletion_token = ?, deletion_until = ?
        WHERE id = ? AND created_at <= ?
          AND COALESCE(materialization_lease_until, 0) <= ?
          AND (retention_state = 'live'
            OR (retention_state = 'deleting' AND deletion_until <= ?))
          AND ${stagedDeletionEligibility}
        RETURNING id`)
      .bind(
        token,
        context.now() + budget.leaseMilliseconds,
        candidate.id,
        cutoff,
        context.now(),
        context.now(),
        cutoff,
      )
      .first<StagedCandidate>();
    if (!claim) continue;
    try {
      const materialized = await database
        .prepare("SELECT 1 AS found FROM visonaut_runs WHERE id = ?")
        .bind(candidate.id)
        .first<{ found: number }>();
      const referencedManifest = await hasReferencedManifest(database, candidate.id);
      const prefixes: Array<[Pick<ObjectStore, "list" | "delete">, string]> = [];
      if (!materialized) {
        prefixes.push([context.images, `runs/${candidate.id}/images/`]);
      }
      prefixes.push([context.quarantine, `quarantine/staged/${candidate.id}/`]);
      if (!referencedManifest) {
        prefixes.push([context.quarantine, `manifests/${candidate.id}/`]);
      }
      let more = false;
      for (const [store, prefix] of prefixes) {
        if (remaining < 1) {
          more = true;
          break;
        }
        await database
          .prepare(
            "UPDATE ingest_staged_runs SET deletion_until = ? WHERE id = ? AND deletion_token = ? AND retention_state = 'deleting'",
          )
          .bind(context.now() + budget.leaseMilliseconds, candidate.id, token)
          .run();
        const page = await deletePrefix(store, prefix, remaining);
        remaining -= page.deleted;
        if (page.more) more = true;
      }
      if (!more) {
        for (const table of stagedChildTables) {
          const page = await deleteChildPage({
            database,
            table,
            runId: candidate.id,
            token,
            now: context.now(),
            limit: remaining,
          });
          remaining -= page.deleted;
          if (page.more) {
            more = true;
            break;
          }
        }
      }
      if (more) {
        report.deferred.push(candidate.id);
        report.hasMore = true;
        await database
          .prepare(
            "UPDATE ingest_staged_runs SET deletion_until = ? WHERE id = ? AND deletion_token = ?",
          )
          .bind(context.now(), candidate.id, token)
          .run();
        continue;
      }
      await atomic(database, [
        assertion(
          database,
          `EXISTS (SELECT 1 FROM ingest_staged_runs
            WHERE id = ? AND retention_state = 'deleting' AND deletion_token = ?
              AND deletion_until > ?
              AND NOT EXISTS (SELECT 1 FROM ingest_staged_images WHERE run_id = ingest_staged_runs.id)
              AND NOT EXISTS (SELECT 1 FROM ingest_staged_manifests WHERE run_id = ingest_staged_runs.id)
              AND NOT EXISTS (SELECT 1 FROM ingest_staged_bundles WHERE run_id = ingest_staged_runs.id))`,
          [candidate.id, token, context.now()],
        ),
        database
          .prepare(
            "DELETE FROM work_retention_pins WHERE run_id = ? AND owner = ? AND reason = 'comparison'",
          )
          .bind(candidate.id, `workflow-rerun:${candidate.id}`),
        database
          .prepare(
            "UPDATE ingest_staged_runs SET retention_state = 'deleted', deletion_token = NULL, deletion_until = NULL, deleted_at = ? WHERE id = ? AND deletion_token = ?",
          )
          .bind(context.now(), candidate.id, token),
      ]);
      await resolveEvents(database, "staged-retention", candidate.id, context.now());
      report.completed.push(candidate.id);
    } catch {
      await recordEvent(database, {
        kind: "staged-retention",
        subject: candidate.id,
        code: "delete-failed",
        now: context.now(),
      });
      report.attention.push(candidate.id);
    }
  }
  return report;
}
