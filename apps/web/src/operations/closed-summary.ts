import {
  affectedHistoryOwners,
  assertion,
  atomic,
  closedRunRetentionMs,
  commandRequestDigest,
  comparisonResultSql,
  comparisonReviewCountsSql,
  pruneArchivedImageMetadataStatements,
  type Database,
} from "@visonaut/service";
import type { ArchivedRunHistory, HistoryRow } from "./history-format.ts";
import { recordEvent, resolveEvents } from "./common.ts";
import type { OperationReport, OperationsContext } from "./types.ts";
import { noteCause } from "./failure.ts";

const summaryDecisionScope = `decision.row_id IN(SELECT row.id FROM visonaut_comparison_rows row JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=?)
  OR decision.id IN(SELECT source_decision_id FROM visonaut_comparison_rows row JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=?)`;

const historicalAcceptance = `decision.verdict='approved' AND decision.revoked=0 AND decision.tuple_json=row.tuple_json
  AND (row.source_decision_id IS NULL OR EXISTS(
    SELECT 1 FROM visonaut_comparison_rows source_row
    JOIN visonaut_comparisons source_comparison ON source_comparison.id=source_row.comparison_id
    JOIN visonaut_runs source_run ON source_run.id=source_comparison.run_id
    JOIN visonaut_runs target_run ON target_run.id=comparison.run_id
    WHERE source_row.id=decision.row_id AND source_row.decision_id=decision.id AND source_run.project_id=target_run.project_id
    AND (source_run.id=target_run.id OR EXISTS(SELECT 1 FROM visonaut_lineage WHERE source_run_id=source_run.id AND target_run_id=target_run.id))
    AND NOT EXISTS(SELECT 1 FROM visonaut_decision_replacements replacement JOIN visonaut_decisions successor ON successor.id=replacement.replacement_decision_id
      WHERE replacement.source_decision_id=decision.id AND successor.revoked=0 AND (replacement.scope='shared' OR replacement.scope_run_id=target_run.id OR EXISTS(SELECT 1 FROM visonaut_lineage WHERE source_run_id=replacement.scope_run_id AND target_run_id=target_run.id)))))`;

const expiredReason =
  "This review closed more than 30 days ago. It shows its counts, its capture list, and the decisions that the database still keeps. Images can be expired. Capture a new run for review.";

/**
 * The page of a closed run after its summary: the run, its comparisons, and
 * the rows and the decisions that D1 still keeps. The summary copies no row,
 * and the capture lists give the captures of the rows.
 */
export async function readClosedSummary(
  database: Database,
  runId: string,
): Promise<ArchivedRunHistory | null> {
  const saved = await database
    .prepare("SELECT 1 FROM visonaut_closed_summaries WHERE run_id=? AND state='ready'")
    .bind(runId)
    .first();
  if (!saved) return null;
  const [run, comparisons, rows, decisions, acceptance] = await database.batch([
    database.prepare("SELECT * FROM visonaut_runs WHERE id=?").bind(runId),
    database.prepare("SELECT * FROM visonaut_comparisons WHERE run_id=?").bind(runId),
    database
      .prepare(
        `SELECT row.id,row.comparison_id,row.item_key,row.variant_key,row.ordinal,row.reference_capture_id,row.candidate_capture_id,row.tuple_json,row.outcome,row.result_json,row.decision_revision,row.decision_id,row.source_decision_id
        FROM visonaut_comparison_rows row JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=? ORDER BY row.ordinal,row.id`,
      )
      .bind(runId),
    database
      .prepare(`SELECT * FROM visonaut_decisions decision WHERE ${summaryDecisionScope}`)
      .bind(runId, runId),
    database
      .prepare(
        `SELECT row.id FROM visonaut_comparison_rows row JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id
        JOIN visonaut_decisions decision ON decision.id=COALESCE(row.source_decision_id,row.decision_id) WHERE comparison.run_id=? AND ${historicalAcceptance}`,
      )
      .bind(runId),
  ]);
  return {
    viewUnavailableReason: expiredReason,
    sections: {
      run: run?.results ?? [],
      comparisons: comparisons?.results ?? [],
      comparisonRows: (rows?.results ?? []) as HistoryRow[],
      decisions: (decisions?.results ?? []) as HistoryRow[],
      acceptance: (acceptance?.results ?? []) as HistoryRow[],
    },
  };
}

interface PrepareClosedCommandDigestsParams {
  context: OperationsContext;
  run: { id: string; revision: number };
  budget: { remaining: number };
}

async function prepareClosedCommandDigests({
  context,
  run,
  budget,
}: PrepareClosedCommandDigestsParams) {
  const commands = await context.database
    .prepare(
      "SELECT command.id,command.request_json FROM visonaut_commands command JOIN visonaut_comparisons comparison ON comparison.id=command.comparison_id WHERE comparison.run_id=? AND command.request_digest IS NULL ORDER BY command.id LIMIT ?",
    )
    .bind(run.id, budget.remaining)
    .all<{ id: string; request_json: string }>();
  const updates = [];
  for (const command of commands.results ?? []) {
    updates.push(
      context.database
        .prepare(
          "UPDATE visonaut_commands SET request_digest=? WHERE id=? AND request_json=? AND request_digest IS NULL",
        )
        .bind(await commandRequestDigest(command.request_json), command.id, command.request_json),
    );
    budget.remaining -= 1;
  }
  if (updates.length) {
    await atomic(context.database, [
      assertion(
        context.database,
        "EXISTS(SELECT 1 FROM visonaut_runs WHERE id=? AND active=0 AND revision=? AND closed_at<=?)",
        [run.id, run.revision, context.now() - closedRunRetentionMs],
      ),
      ...updates,
    ]);
  }
  return !(await context.database
    .prepare(
      "SELECT 1 FROM visonaut_commands command JOIN visonaut_comparisons comparison ON comparison.id=command.comparison_id WHERE comparison.run_id=? AND command.request_digest IS NULL LIMIT 1",
    )
    .bind(run.id)
    .first());
}

function finishClosedSummary(database: Database, runId: string, owners: string) {
  return [
    assertion(
      database,
      "EXISTS(SELECT 1 FROM visonaut_closed_summaries WHERE run_id=? AND state='ready') AND NOT EXISTS(SELECT 1 FROM visonaut_commands command JOIN visonaut_comparisons comparison ON comparison.id=command.comparison_id WHERE comparison.run_id=? AND command.request_digest IS NULL)",
      [runId, runId],
    ),
    // A closed run takes no decision, so its counts are final. They go into
    // the run row that this statement already writes, before a later step
    // deletes the rows.
    database
      .prepare(
        `UPDATE visonaut_runs SET plan_json='{}',detail_archived=1,revision=revision+1,
        (review_pending,review_rejected,review_approved)=(${comparisonReviewCountsSql("visonaut_runs.comparison_id")})
        WHERE id=? AND detail_archived=0`,
      )
      .bind(runId),
    database
      .prepare(
        "DELETE FROM work_tasks WHERE kind='review' AND json_extract(payload, '$.comparisonId') IN (SELECT id FROM visonaut_comparisons WHERE run_id=?)",
      )
      .bind(runId),
    // Exact tuples and decision stubs still serve baseline and source approval
    // checks. The row keeps its result for the page of the closed run: a
    // result that names its capture gets the copy that the capture holds,
    // because the capture can go.
    database
      .prepare(
        `UPDATE visonaut_comparison_rows SET reference_capture_id=NULL,candidate_capture_id=NULL,result_json=${comparisonResultSql("visonaut_comparison_rows")} WHERE comparison_id IN(SELECT id FROM visonaut_comparisons WHERE run_id=?)`,
      )
      .bind(runId),
    database
      .prepare(
        "UPDATE visonaut_commands SET request_json='{}',previous_json='{}',result_json='{}' WHERE comparison_id IN(SELECT id FROM visonaut_comparisons WHERE run_id=?)",
      )
      .bind(runId),
    database
      .prepare("UPDATE visonaut_shards SET expected_json='{}',discovery_json=NULL WHERE run_id=?")
      .bind(runId),
    database.prepare("DELETE FROM visonaut_audit WHERE run_id=?").bind(runId),
    database.prepare("DELETE FROM ingest_uploads WHERE run_id=?").bind(runId),
    ...pruneArchivedImageMetadataStatements(database, owners),
  ];
}

async function summarizeLiveClosedRun(
  context: OperationsContext,
  run: { id: string; revision: number },
) {
  const owners = await affectedHistoryOwners(context.database, run.id);
  await atomic(context.database, [
    assertion(
      context.database,
      `EXISTS(SELECT 1 FROM visonaut_runs WHERE id=? AND active=0 AND revision=? AND closed_at<=?)
      AND NOT EXISTS(SELECT 1 FROM work_retained_runs WHERE id=? AND byte_state='deleting')`,
      [run.id, run.revision, context.now() - closedRunRetentionMs, run.id],
    ),
    context.database
      .prepare(`INSERT INTO visonaut_closed_summaries(run_id,source_revision,converted_at,decision_count,row_count,audit_json,state)
      SELECT ?,?,?,(SELECT COUNT(*) FROM visonaut_decisions decision WHERE ${summaryDecisionScope}),
      (SELECT COUNT(*) FROM visonaut_comparison_rows row JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=?),
      COALESCE((SELECT json_group_array(json(action_count)) FROM (SELECT json_object('action',action,'count',COUNT(*)) AS action_count FROM visonaut_audit WHERE run_id=? GROUP BY action)),'[]'),'ready'`)
      .bind(run.id, run.revision, context.now(), run.id, run.id, run.id, run.id),
    ...finishClosedSummary(context.database, run.id, owners),
  ]);
}

/** Preserve compact identity and actor evidence before the existing 30-day byte collector. */
export async function summarizeClosedRuns(context: OperationsContext): Promise<OperationReport> {
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const commandBudget = { remaining: context.budget.tasksPerStep };
  const cursorId = "closed-summary-candidates";
  const cursor = await context.database
    .prepare("SELECT value FROM operations_cursors WHERE id=?")
    .bind(cursorId)
    .first<{ value: string }>();
  const candidates = await context.database
    .prepare(`SELECT run.id,run.revision FROM visonaut_runs run
    WHERE run.id>? AND run.active=0 AND run.detail_archived=0 AND run.closed_at<=?
    AND NOT EXISTS(SELECT 1 FROM visonaut_closed_summaries summary WHERE summary.run_id=run.id)
    AND NOT EXISTS(SELECT 1 FROM visonaut_comparisons comparison WHERE comparison.run_id=run.id AND comparison.purpose='historical' AND comparison.state='comparing')
    AND NOT EXISTS(SELECT 1 FROM operations_events event WHERE event.kind='history' AND event.subject_id=run.id AND event.code='summary-conversion-failed' AND event.resolved_at IS NULL AND event.last_seen_at>?)
    ORDER BY run.id LIMIT ?`)
    .bind(
      cursor?.value ?? "",
      context.now() - closedRunRetentionMs,
      context.now() - context.budget.leaseMilliseconds,
      context.budget.tasksPerStep,
    )
    .all<{ id: string; revision: number }>();
  for (const run of candidates.results ?? []) {
    try {
      const complete = await prepareClosedCommandDigests({ context, run, budget: commandBudget });
      if (complete) {
        await summarizeLiveClosedRun(context, run);
        await resolveEvents(context.database, "history", run.id, context.now());
      }
      (complete ? report.completed : report.deferred).push(run.id);
      if (!complete) report.hasMore = true;
    } catch (error) {
      noteCause(report, error);
      await recordEvent(context.database, {
        kind: "history",
        subject: run.id,
        code: "summary-conversion-failed",
        now: context.now(),
      });
      report.attention.push(run.id);
    }
    await context.database
      .prepare(
        "INSERT INTO operations_cursors(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value WHERE operations_cursors.value IS NOT excluded.value",
      )
      .bind(cursorId, run.id)
      .run();
  }
  if ((candidates.results?.length ?? 0) < context.budget.tasksPerStep)
    await context.database
      .prepare("DELETE FROM operations_cursors WHERE id=?")
      .bind(cursorId)
      .run();
  report.hasMore ||= (candidates.results?.length ?? 0) === context.budget.tasksPerStep;
  return report;
}
