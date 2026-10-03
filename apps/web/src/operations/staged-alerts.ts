import type { OperationsContext } from "./types.ts";

export function obsoleteStagedReconciliationSql(subject: string) {
  // A replaced unsealed failure needs no reconciliation after its exact check
  // delivery completes; retain the run and failure receipt.
  const deliveredReplacedFailure = `(run.active=1 AND run.kind='main' AND run.state='failed'
    AND run.sealed_at IS NULL AND run.comparison_id IS NULL
    AND run.external_run_id=staged.workflow_run_id AND run.attempt=staged.workflow_attempt
    AND run.tested_sha=staged.tested_sha AND EXISTS(
      SELECT 1 FROM visonaut_projects project
      JOIN visonaut_snapshots snapshot ON snapshot.id=project.snapshot_id
      JOIN visonaut_runs replacement ON replacement.id=snapshot.run_id
      JOIN visonaut_lineage lineage ON lineage.source_run_id=run.id AND lineage.target_run_id=replacement.id
      WHERE project.id=run.project_id AND project.repository_id=staged.repository_id
        AND snapshot.project_id=project.id AND snapshot.state='accepted' AND snapshot.reference_eligible=1
        AND replacement.project_id=project.id AND replacement.id!=run.id AND replacement.kind='main'
        AND replacement.state='accepted' AND replacement.sealed_at IS NOT NULL
        AND replacement.created_at>=run.created_at)
    AND EXISTS(SELECT 1 FROM pre_run_checks pre
      JOIN work_checks sender ON sender.id=pre.check_id
      JOIN work_status_outbox delivery ON delivery.check_id=sender.id AND delivery.revision=sender.desired_revision
      WHERE pre.repository_id=staged.repository_id AND pre.workflow_run_id=staged.workflow_run_id
        AND pre.workflow_attempt=staged.workflow_attempt AND pre.tested_sha=run.tested_sha
        AND pre.kind='main' AND pre.state='active' AND sender.delivered_revision=sender.desired_revision
        AND sender.ambiguous=0 AND sender.request_started=0 AND sender.lease_token IS NULL
        AND sender.lease_until IS NULL AND sender.lease_revision IS NULL
        AND delivery.run_id=run.id AND delivery.attempt=run.attempt
        AND delivery.state='complete' AND delivery.conclusion='failure'))`;
  return `EXISTS(SELECT 1 FROM ingest_staged_runs staged
    JOIN visonaut_runs run ON run.id=staged.id
    WHERE staged.workflow_run_id || ':' || staged.workflow_attempt=${subject}
      AND ((run.active=0 AND run.state='superseded') OR ${deliveredReplacedFailure})
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
