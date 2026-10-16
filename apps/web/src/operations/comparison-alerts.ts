import type { OperationsContext } from "./types.ts";
import { recordEvent, resolveEvents } from "./common.ts";
import { resolveSupersededStagedAlerts } from "./staged-alerts.ts";

/** Keep private alerts until durable state proves recovery or explicit supersession. */
export async function reportComparisonRecovery(
  context: Pick<OperationsContext, "database" | "now" | "budget">,
  finalization: { completed: string[]; errors: Array<{ comparisonId: string }> },
) {
  const database = context.database;
  const now = context.now();
  await resolveSupersededStagedAlerts(context);
  const historicalRecovered = `EXISTS(SELECT 1 FROM visonaut_comparisons recovered
    WHERE recovered.run_id=comparison.run_id AND recovered.purpose='historical'
      AND recovered.ordinal>comparison.ordinal AND recovered.state='ready'
      AND recovered.reference_snapshot_id IS comparison.reference_snapshot_id
      AND recovered.policy_digest=comparison.policy_digest)`;
  for (const failure of finalization.errors) {
    await recordEvent(database, {
      kind: "comparison-finalization",
      subject: failure.comparisonId,
      code: "finalization-failed",
      now,
    });
  }
  for (const subject of finalization.completed) {
    await resolveEvents(database, "comparison-finalization", subject, now);
  }
  await database
    .prepare(`UPDATE operations_events SET resolved_at=? WHERE id IN (
    SELECT event.id FROM operations_events event JOIN visonaut_comparisons comparison ON comparison.id=event.subject_id
    JOIN visonaut_runs run ON run.id=comparison.run_id
    WHERE event.kind IN ('comparison-finalization','comparison-task') AND event.resolved_at IS NULL
      AND (comparison.state='ready'
        OR (comparison.purpose='review' AND (run.active=0 OR run.comparison_id!=comparison.id
          OR comparison.state='invalidated'))
        OR (comparison.purpose='historical' AND ${historicalRecovered}))
    ORDER BY event.last_seen_at,event.id LIMIT ?)`)
    .bind(now, context.budget.tasksPerStep)
    .run();
  const exhausted = await database
    .prepare(`SELECT DISTINCT comparison.id FROM work_tasks task
    JOIN visonaut_comparison_rows row ON row.id=task.id
    JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id
    JOIN visonaut_runs run ON run.id=comparison.run_id
    WHERE task.kind='compare' AND task.state='dead'
      AND ((comparison.purpose='review' AND run.active=1 AND run.comparison_id=comparison.id
        AND comparison.state!='invalidated')
        OR (comparison.purpose='historical' AND NOT ${historicalRecovered}))
      AND comparison.state!='ready' AND NOT EXISTS(SELECT 1 FROM operations_events event
        WHERE event.kind='comparison-task' AND event.subject_id=comparison.id AND event.code='attempts-exhausted')
    ORDER BY comparison.id LIMIT ?`)
    .bind(context.budget.tasksPerStep)
    .all<{ id: string }>();
  for (const { id: subject } of exhausted.results ?? []) {
    await recordEvent(database, {
      kind: "comparison-task",
      subject,
      code: "attempts-exhausted",
      now,
    });
  }
}
