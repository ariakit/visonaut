import { assertion, atomic, ConflictError, IncompleteError, statement } from "./database.ts";
import {
  statusRunEligibleSql,
  reviewStatus,
  pendingReviewCountSql,
  rejectedReviewCountSql,
} from "./review-status.ts";
import { statusIntentStatements } from "./work.ts";
import type { StatusDelivery } from "./work.ts";
import type { Database, SqlValue } from "./database.ts";
import type { Service } from "./service.ts";
import { projectGuard } from "./run-guards.ts";

async function readRows<T>(database: Database, sql: string, values: SqlValue[] = []) {
  return (await statement(database, sql, values).all<T>()).results ?? [];
}

async function readOne<T>(database: Database, sql: string, values: SqlValue[] = []) {
  const row = await statement(database, sql, values).first<T>();
  if (!row) {
    throw new IncompleteError("The requested record does not exist.");
  }
  return row;
}

export async function readRunStatus(service: Service, runId: string) {
  const run = await service.run(runId);
  const initial = reviewStatus({ run });
  if (initial.status === "passed") {
    const comparison = run.comparison_id ? await service.comparison(run.comparison_id) : undefined;
    return { run, comparison, ...initial };
  }
  if (initial.status === "superseded" || initial.status === "incomplete") {
    return { run, ...initial };
  }
  if (initial.status === "failed") {
    const failures = await readRows<{ id: string; last_error: string | null }>(
      service.database,
      "SELECT id, json_extract(detail_json, '$.reason') AS last_error FROM visonaut_audit WHERE run_id = ? AND action = 'capture-failed' ORDER BY created_at DESC, id LIMIT 1",
      [run.id],
    );
    return { run, ...initial, failures };
  }
  if (!run.comparison_id) throw new IncompleteError("The run comparison is missing.");
  const comparison = await service.comparison(run.comparison_id);
  const preliminary = reviewStatus({ run, comparison });
  if (preliminary.status === "needs-recompare") return { run, comparison, ...preliminary };
  const failures = await readRows<{ id: string; last_error: string | null }>(
    service.database,
    "SELECT task.id, task.last_error FROM work_tasks task JOIN visonaut_comparison_rows row ON row.id = task.id WHERE row.comparison_id = ? AND task.state = 'dead' ORDER BY task.id LIMIT 20",
    [comparison.id],
  );
  const state = reviewStatus({ run, comparison, failures: failures.length > 0 });
  if (state.status === "failed") return { run, comparison, ...state, failures };
  if (state.status === "comparing") return { run, comparison, ...state };
  const counts = await readOne<{ pending: number; rejected: number }>(
    service.database,
    `SELECT ${pendingReviewCountSql} AS pending, ${rejectedReviewCountSql} AS rejected FROM visonaut_comparison_rows row LEFT JOIN visonaut_decisions decision ON decision.id = row.decision_id WHERE row.comparison_id = ?`,
    [comparison.id],
  );
  const project = await service.project(run.project_id);
  const currentPromotion = project.promotion_id
    ? await statement(
        service.database,
        "SELECT 1 AS found FROM visonaut_promotions WHERE id = ? AND comparison_id = ? AND revoked = 0",
        [project.promotion_id, comparison.id],
      ).first()
    : null;
  return {
    run,
    comparison,
    ...reviewStatus({
      run,
      comparison,
      ...counts,
      baselineRevision: project.baseline_revision,
      currentPromotion: currentPromotion !== null,
    }),
  };
}

export async function prepareStatusIntent(
  service: Service,
  input: {
    runId: string;
    checkId: string;
    detailsUrl: string;
    maxAttempts: number;
    now: number;
  },
) {
  const run = await service.run(input.runId);
  const project = await service.project(run.project_id);
  const status = await service.status(run.id);
  if (status.status === "superseded") {
    throw new ConflictError("A superseded attempt cannot publish a check.");
  }
  const conclusion =
    status.status === "passed"
      ? "success"
      : status.status === "rejected" ||
          status.status === "failed" ||
          (status.status === "needs-review" && run.kind !== "merge_group")
        ? "failure"
        : "pending";
  const comparison = run.comparison_id ? await service.comparison(run.comparison_id) : null;
  await atomic(service.database, [
    projectGuard(service.database, project),
    assertion(
      service.database,
      `EXISTS(SELECT 1 FROM visonaut_runs run WHERE run.id=? AND run.revision=? AND ${statusRunEligibleSql})`,
      [run.id, run.revision],
    ),
    statement(
      service.database,
      "INSERT INTO visonaut_checks (id, project_id, external_run_id) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
      [input.checkId, project.id, run.external_run_id],
    ),
    assertion(
      service.database,
      "EXISTS (SELECT 1 FROM visonaut_checks WHERE id = ? AND project_id = ? AND external_run_id = ?)",
      [input.checkId, project.id, run.external_run_id],
    ),
    ...statusIntentStatements(service.database, {
      checkId: input.checkId,
      revision: project.revision,
      runId: run.id,
      attempt: run.attempt,
      comparisonRevision: comparison?.ordinal ?? 0,
      sourceRevision: project.revision,
      conclusion,
      detailsUrl: input.detailsUrl,
      maxAttempts: input.maxAttempts,
      now: input.now,
    }),
    statement(
      service.database,
      "UPDATE visonaut_status_outbox SET delivered_at = ? WHERE run_id = ? AND run_revision <= ?",
      [input.now, run.id, run.revision],
    ),
  ]);
  return { revision: project.revision, conclusion };
}

export async function isStatusIntentCurrent(service: Service, intent: StatusDelivery) {
  const current = await statement(
    service.database,
    `SELECT 1 AS found FROM visonaut_runs run JOIN visonaut_projects project ON project.id = run.project_id LEFT JOIN visonaut_comparisons comparison ON comparison.id = run.comparison_id WHERE run.id = ? AND ${statusRunEligibleSql} AND run.attempt = ? AND project.revision = ? AND COALESCE(comparison.ordinal, 0) = ?`,
    [intent.run_id, intent.attempt, intent.source_revision, intent.comparison_revision],
  ).first();
  return current !== null;
}
