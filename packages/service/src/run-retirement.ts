import { assertion, atomic, ConflictError, statement } from "./database.ts";
import { touchRunStatusStatements } from "./status-touch.ts";
import type { Service } from "./service.ts";
import { projectGuard, activeGuard } from "./run-guards.ts";
import { auditRunChange } from "./service-audit.ts";

// The scheduled reconciler drains tasks beyond the run transition's first page.
export const reviewTaskRetirementPageSize = 100;

export async function retireRun(service: Service, input: { runId: string; now: number }) {
  const run = await service.run(input.runId);
  const project = await service.project(run.project_id);
  await atomic(service.database, [
    projectGuard(service.database, project),
    assertion(
      service.database,
      "NOT EXISTS (SELECT 1 FROM visonaut_projects project JOIN visonaut_snapshots snapshot ON snapshot.id = project.snapshot_id WHERE snapshot.run_id = ?)",
      [run.id],
    ),
    statement(
      service.database,
      "UPDATE visonaut_runs SET active = 0, state = 'superseded', closed_at = COALESCE(closed_at, ?) WHERE id = ?",
      [input.now, run.id],
    ),
    statement(
      service.database,
      `UPDATE work_tasks SET state = 'complete', result = 'superseded',
          lease_token = NULL, lease_until = NULL, publication_token = NULL,
          last_error = NULL, updated_at = ?
        WHERE id IN (SELECT task.id FROM work_tasks task
          JOIN visonaut_comparison_rows row ON row.id = task.id
          JOIN visonaut_comparisons comparison ON comparison.id = row.comparison_id
          WHERE task.kind = 'compare' AND task.state IN ('queued', 'leased')
            AND comparison.purpose = 'review' AND comparison.run_id = ?
          ORDER BY task.id LIMIT ?)`,
      [input.now, run.id, reviewTaskRetirementPageSize],
    ),
    statement(
      service.database,
      "UPDATE work_retained_runs SET closed_at = COALESCE(closed_at, ?) WHERE id = ?",
      [input.now, run.id],
    ),
    statement(
      service.database,
      "DELETE FROM work_retention_pins WHERE run_id = ? AND owner = ? AND reason = 'review'",
      [run.id, `review:${run.id}`],
    ),
    ...touchRunStatusStatements(
      service.database,
      { id: run.id, projectId: run.project_id },
      input.now,
    ),
    auditRunChange({
      database: service.database,
      run: run,
      action: "retire",
      detail: {},
      now: input.now,
    }),
  ]);
}

export async function expireIncompleteWorkflowRun(
  service: Service,
  input: { runId: string; cutoff: number; now: number },
) {
  const run = await service.run(input.runId);
  if (!run.active || run.sealed_at !== null) return false;
  const project = await service.project(run.project_id);
  try {
    await atomic(service.database, [
      projectGuard(service.database, project),
      activeGuard(service.database, run),
      assertion(
        service.database,
        "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND sealed_at IS NULL)",
        [run.id],
      ),
      assertion(
        service.database,
        `EXISTS (SELECT 1 FROM ingest_staged_runs staged
            WHERE staged.id = ? AND staged.created_at <= ?
              AND staged.submitted_at IS NOT NULL AND staged.retention_state = 'live'
              AND COALESCE(staged.materialization_lease_until, 0) <= ?)`,
        [run.id, input.cutoff, input.now],
      ),
      assertion(
        service.database,
        "NOT EXISTS (SELECT 1 FROM visonaut_projects project JOIN visonaut_snapshots snapshot ON snapshot.id = project.snapshot_id WHERE snapshot.run_id = ?)",
        [run.id],
      ),
      statement(
        service.database,
        "UPDATE visonaut_runs SET active = 0, state = 'failed', closed_at = COALESCE(closed_at, ?) WHERE id = ?",
        [input.now, run.id],
      ),
      statement(
        service.database,
        "UPDATE work_retained_runs SET closed_at = COALESCE(closed_at, ?) WHERE id = ?",
        [input.now, run.id],
      ),
      statement(
        service.database,
        "DELETE FROM work_retention_pins WHERE run_id = ? AND owner = ? AND reason = 'review'",
        [run.id, `review:${run.id}`],
      ),
      statement(
        service.database,
        `UPDATE pre_run_checks SET state = 'failed', updated_at = ?
            WHERE state = 'active' AND EXISTS (SELECT 1 FROM ingest_staged_runs staged
              WHERE staged.id = ? AND staged.repository_id = pre_run_checks.repository_id
                AND staged.workflow_run_id = pre_run_checks.workflow_run_id
                AND staged.workflow_attempt = pre_run_checks.workflow_attempt
                AND staged.tested_sha = pre_run_checks.tested_sha)`,
        [input.now, run.id],
      ),
      statement(
        service.database,
        `INSERT INTO operations_events
            (id, kind, subject_id, code, first_seen_at, last_seen_at)
            SELECT 'staged-reconciliation:' || workflow_run_id || ':' || workflow_attempt || ':expired-incomplete',
              'staged-reconciliation', workflow_run_id || ':' || workflow_attempt,
              'expired-incomplete', ?, ? FROM ingest_staged_runs WHERE id = ?
            ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at,
              resolved_at = NULL`,
        [input.now, input.now, run.id],
      ),
      ...touchRunStatusStatements(
        service.database,
        { id: run.id, projectId: run.project_id },
        input.now,
      ),
      auditRunChange({
        database: service.database,
        run: run,
        action: "workflow-expired",
        detail: { reason: "incomplete-materialization" },
        now: input.now,
      }),
    ]);
    return true;
  } catch (error) {
    if (error instanceof ConflictError) return false;
    throw error;
  }
}
