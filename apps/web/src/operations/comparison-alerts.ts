import type { OperationsContext } from "./types.ts";
import { recordEvent, resolveEvents } from "./common.ts";

/** Keep private alerts until durable state proves recovery or explicit supersession. */
export async function reportComparisonRecovery(
  context: Pick<OperationsContext, "database" | "now" | "budget">,
  publication: { published: string[]; failed: string[] },
  finalization: { completed: string[]; errors: Array<{ comparisonId: string }> },
) {
  const database = context.database;
  const now = context.now();
  const historicalRecovered = `EXISTS(SELECT 1 FROM ariviso_comparisons recovered
    WHERE recovered.run_id=comparison.run_id AND recovered.purpose='historical'
      AND recovered.ordinal>comparison.ordinal AND recovered.state='ready'
      AND recovered.reference_snapshot_id IS comparison.reference_snapshot_id
      AND recovered.policy_digest=comparison.policy_digest)`;
  for (const subject of publication.failed) {
    await recordEvent(database, {
      kind: "comparison-publication",
      subject,
      code: "publication-failed",
      now,
    });
  }
  for (const subject of publication.published) {
    await resolveEvents(database, "comparison-publication", subject, now);
  }
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
  // A queue consumer can finish between scheduler pages. Absence from a page is
  // never recovery; inspect the recorded subject's durable state instead.
  await database
    .prepare(`UPDATE operations_events SET resolved_at=? WHERE id IN (
    SELECT event.id FROM operations_events event JOIN work_tasks task ON task.id=event.subject_id
    WHERE event.kind='comparison-publication' AND event.resolved_at IS NULL
      AND task.state IN ('leased','complete','dead') AND task.attempts>0 AND task.updated_at>=event.last_seen_at
    ORDER BY event.last_seen_at,event.id LIMIT ?)`)
    .bind(now, context.budget.tasksPerStep)
    .run();
  // Generated comparison IDs have no colon; task IDs append ':' and a capture
  // ID. A verified terminal archive is the receipt after task rows are pruned.
  await database
    .prepare(`UPDATE operations_events SET resolved_at=? WHERE id IN (
    SELECT event.id FROM operations_events event JOIN ariviso_comparisons comparison
      ON comparison.id=substr(event.subject_id,1,instr(event.subject_id,':')-1)
    WHERE event.kind='comparison-publication' AND event.resolved_at IS NULL
      AND instr(event.subject_id,':')>1 AND length(event.subject_id)>length(comparison.id)+1
      AND NOT EXISTS(SELECT 1 FROM work_tasks task WHERE task.id=event.subject_id)
      AND ((comparison.purpose='review' AND EXISTS(SELECT 1 FROM operations_run_archives archive
        WHERE archive.run_id=comparison.run_id AND archive.state='ready'))
        OR (comparison.purpose='historical' AND EXISTS(SELECT 1 FROM operations_comparison_archives archive
          WHERE archive.comparison_id=comparison.id AND archive.state='ready')))
    ORDER BY event.last_seen_at,event.id LIMIT ?)`)
    .bind(now, context.budget.tasksPerStep)
    .run();
  await database
    .prepare(`UPDATE operations_events SET resolved_at=? WHERE id IN (
    SELECT event.id FROM operations_events event JOIN ariviso_comparisons comparison ON comparison.id=event.subject_id
    JOIN ariviso_runs run ON run.id=comparison.run_id
    WHERE event.kind IN ('comparison-finalization','comparison-task') AND event.resolved_at IS NULL
      AND (comparison.state='ready'
        OR (comparison.purpose='review' AND (run.active=0 OR run.comparison_id!=comparison.id))
        OR (comparison.purpose='historical' AND ${historicalRecovered}))
    ORDER BY event.last_seen_at,event.id LIMIT ?)`)
    .bind(now, context.budget.tasksPerStep)
    .run();
  const exhausted = await database
    .prepare(`SELECT DISTINCT comparison.id FROM work_tasks task
    JOIN ariviso_comparison_rows row ON row.id=task.id
    JOIN ariviso_comparisons comparison ON comparison.id=row.comparison_id
    JOIN ariviso_runs run ON run.id=comparison.run_id
    WHERE task.kind='compare' AND task.state='dead'
      AND ((comparison.purpose='review' AND run.active=1 AND run.comparison_id=comparison.id)
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
