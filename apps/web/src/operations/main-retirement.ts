import { ConflictError, replacedMainRunSql, Service } from "@visonaut/service";
import type { OperationReport, OperationsContext } from "./types.ts";
import { noteCause } from "./failure.ts";

export async function retireReplacedMainRuns(context: OperationsContext): Promise<OperationReport> {
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const rows = await context.database
    .prepare(`SELECT run.id,project.snapshot_id FROM visonaut_runs run
      JOIN visonaut_projects project ON project.id=run.project_id
      WHERE project.repository_id=? AND run.active=1 AND run.state='reviewing' AND run.closed_at IS NULL
        AND ${replacedMainRunSql("run")}
      ORDER BY run.created_at,run.id LIMIT ?`)
    .bind(context.github.repositoryId, context.budget.tasksPerStep)
    .all<{ id: string; snapshot_id: string }>();
  const service = new Service(context.database);
  for (const run of rows.results ?? []) {
    try {
      await service.retireRun({
        runId: run.id,
        reason: "replaced",
        replacementSnapshotId: run.snapshot_id,
        now: context.now(),
      });
      report.completed.push(run.id);
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      noteCause(report, error);
      report.deferred.push(run.id);
    }
  }
  report.hasMore = (rows.results?.length ?? 0) === context.budget.tasksPerStep;
  return report;
}
