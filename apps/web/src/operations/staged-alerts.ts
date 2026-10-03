import type { OperationsContext } from "./types.ts";

export function obsoleteStagedReconciliationSql(subject: string) {
  return `EXISTS(SELECT 1 FROM ingest_staged_runs staged
    JOIN visonaut_runs run ON run.id=staged.id
    WHERE staged.workflow_run_id || ':' || staged.workflow_attempt=${subject}
      AND run.active=0 AND run.state='superseded'
      AND NOT EXISTS(SELECT 1 FROM pre_run_checks pre
        LEFT JOIN work_checks sender ON sender.id=pre.check_id
        WHERE pre.repository_id=staged.repository_id
          AND pre.workflow_run_id=staged.workflow_run_id AND pre.workflow_attempt=staged.workflow_attempt
          AND (pre.state='ambiguous' OR (pre.state='creating' AND pre.request_started=1)
            OR sender.ambiguous=1 OR sender.request_started=1 OR sender.lease_token IS NOT NULL)))`;
}

export async function resolveSupersededStagedAlerts(
  context: Pick<OperationsContext, "database" | "now" | "budget">,
) {
  await context.database
    .prepare(`UPDATE operations_events SET resolved_at=? WHERE id IN (
      SELECT id FROM operations_events WHERE kind='staged-reconciliation' AND resolved_at IS NULL
        AND ${obsoleteStagedReconciliationSql("subject_id")}
      ORDER BY last_seen_at,id LIMIT ?)`)
    .bind(context.now(), context.budget.tasksPerStep)
    .run();
}
