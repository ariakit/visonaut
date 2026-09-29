import {
  affectedHistoryOwners,
  assertion,
  atomic,
  closedRunRetentionMs,
  commandRequestDigest,
  pruneArchivedImageMetadataStatements,
  type Database,
} from "@visonaut/service";
import { parseHistoryPage, type ArchivedRunHistory, type HistoryRow } from "./history-format.ts";
import { readComparisonHistoryManifest } from "./history-supplement.ts";
import { readHistoryManifest, readVerifiedHistoryObject } from "./history.ts";
import { recordEvent, resolveEvents } from "./common.ts";
import type { OperationReport, OperationsContext } from "./types.ts";

const expiredReason =
  "This closed review has a permanent decision summary. Image replay has ended. Capture a new run for review.";

/** The API reads only D1 summaries. R2 archive reading belongs to the one-time converter. */
export async function readClosedSummary(
  database: Database,
  runId: string,
): Promise<ArchivedRunHistory | null> {
  const saved = await database
    .prepare("SELECT 1 FROM visonaut_closed_summaries WHERE run_id=? AND state='ready'")
    .bind(runId)
    .first();
  if (!saved) return null;
  const [run, comparisons, rows, decisions] = await database.batch([
    database.prepare("SELECT * FROM visonaut_runs WHERE id=?").bind(runId),
    database.prepare("SELECT * FROM visonaut_comparisons WHERE run_id=?").bind(runId),
    database
      .prepare("SELECT * FROM visonaut_closed_summary_rows WHERE run_id=? ORDER BY ordinal,id")
      .bind(runId),
    database
      .prepare(
        "SELECT * FROM visonaut_closed_summary_decisions WHERE run_id=? ORDER BY row_id,revision,id",
      )
      .bind(runId),
  ]);
  const entries = (rows?.results ?? []) as HistoryRow[];
  const recordedDecisions = (decisions?.results ?? []) as HistoryRow[];
  return {
    viewUnavailableReason: expiredReason,
    manifest: { version: 1, runId, generation: "summary", pages: [], counts: {} },
    sections: {
      run: run?.results ?? [],
      comparisons: comparisons?.results ?? [],
      comparisonRows: entries,
      captures: entries.map((row) => ({
        id: row.candidate_capture_id ?? row.reference_capture_id,
        image_id: "",
        metadata_json: row.metadata_json,
      })),
      decisions: recordedDecisions,
      acceptance: entries.filter((row) => row.accepted === 1).map((row) => ({ id: row.id })),
    },
  };
}

const pendingLegacySummaryRootSql = `SELECT root.kind,root.comparison_id,root.object_key FROM(
  SELECT 0 AS kind,NULL AS comparison_id,object_key FROM operations_run_archives WHERE run_id=? AND state='ready'
  UNION ALL SELECT 1 AS kind,comparison_id,object_key FROM operations_comparison_archives WHERE run_id=? AND state='ready'
) root WHERE NOT EXISTS(SELECT 1 FROM visonaut_summary_conversion_pages saved WHERE saved.run_id=? AND saved.page_key=root.object_key AND saved.section='verified-root') ORDER BY root.kind,root.comparison_id LIMIT 1`;

async function convertLegacySummary(
  context: OperationsContext,
  run: { id: string; revision: number },
  reads: { remaining: number },
) {
  const nextRoot = () =>
    context.database
      .prepare(pendingLegacySummaryRootSql)
      .bind(run.id, run.id, run.id)
      .first<{ kind: number; comparison_id: string | null; object_key: string }>();
  const pending = await nextRoot();
  if (pending && !reads.remaining) return false;
  if (pending) reads.remaining -= 1;
  const root = pending
    ? pending.kind === 0
      ? await readHistoryManifest(context, run.id)
      : await readComparisonHistoryManifest(context, {
          runId: run.id,
          comparisonId: pending.comparison_id ?? "",
        })
    : null;
  if (pending && !root) throw new Error("Required legacy history archive is missing.");
  const cursorId = `summary-conversion:${run.id}`;
  const position = await context.database
    .prepare("SELECT value FROM operations_cursors WHERE id=?")
    .bind(cursorId)
    .first<{ value: string }>();
  const progress: unknown = JSON.parse(position?.value ?? "0");
  const start =
    typeof progress === "number"
      ? progress
      : progress &&
          typeof progress === "object" &&
          "root" in progress &&
          progress.root === pending?.object_key &&
          "page" in progress &&
          typeof progress.page === "number"
        ? progress.page
        : 0;
  const pages = root?.manifest.pages.slice(start, start + reads.remaining) ?? [];
  await context.database
    .prepare(
      "INSERT INTO visonaut_closed_summaries(run_id,source_revision,converted_at,decision_count,row_count,audit_json) VALUES(?,?,?,0,0,'{}') ON CONFLICT DO NOTHING",
    )
    .bind(run.id, run.revision, context.now())
    .run();
  const header = await context.database
    .prepare(
      "SELECT source_revision FROM visonaut_closed_summaries WHERE run_id=? AND state='building'",
    )
    .bind(run.id)
    .first<{ source_revision: number }>();
  if (header?.source_revision !== run.revision)
    throw new Error("Legacy summary source revision changed.");
  for (const reference of pages) {
    if (!root) throw new Error("Summary root is unavailable.");
    reads.remaining -= 1;
    const page = parseHistoryPage(
      await readVerifiedHistoryObject(context, reference),
      root.manifest,
      reference,
    );
    if (reference.section === "comparisonRows") {
      const serialized = JSON.stringify(page.rows);
      await context.database
        .prepare(`INSERT INTO visonaut_closed_summary_rows(id,run_id,comparison_id,ordinal,item_key,variant_key,tuple_json,outcome,decision_revision,decision_id,source_decision_id,reference_capture_id,candidate_capture_id,metadata_json,result_json)
        SELECT json_extract(value,'$.id'),?,json_extract(value,'$.comparison_id'),json_extract(value,'$.ordinal'),json_extract(value,'$.item_key'),json_extract(value,'$.variant_key'),json_extract(value,'$.tuple_json'),json_extract(value,'$.outcome'),json_extract(value,'$.decision_revision'),json_extract(value,'$.decision_id'),json_extract(value,'$.source_decision_id'),json_extract(value,'$.reference_capture_id'),json_extract(value,'$.candidate_capture_id'),'{}',json_extract(value,'$.result_json') FROM json_each(?) WHERE true ON CONFLICT(id) DO UPDATE SET tuple_json=excluded.tuple_json,outcome=excluded.outcome,result_json=excluded.result_json,decision_revision=excluded.decision_revision,decision_id=excluded.decision_id,source_decision_id=excluded.source_decision_id`)
        .bind(run.id, serialized)
        .run();
      await context.database
        .prepare(
          "INSERT INTO visonaut_summary_conversion_pages(run_id,page_key,section,rows_json) VALUES(?,?,'row-ids',?) ON CONFLICT DO NOTHING",
        )
        .bind(run.id, reference.key, JSON.stringify(page.rows.map((row) => ({ id: row.id }))))
        .run();
    }
    // Sections may precede comparisonRows. Save small exact source pages in D1
    // conversion staging, then join them only after every page is verified.
    if (
      ["captures", "referenceCaptures", "decisions", "audit", "acceptance"].includes(
        reference.section,
      )
    ) {
      await context.database
        .prepare(
          "INSERT INTO visonaut_summary_conversion_pages(run_id,page_key,section,rows_json) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
        )
        .bind(run.id, reference.key, reference.section, JSON.stringify(page.rows))
        .run();
    }
    await context.database
      .prepare(
        "INSERT INTO operations_cursors(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .bind(
        cursorId,
        JSON.stringify({ root: pending?.object_key, page: start + pages.indexOf(reference) + 1 }),
      )
      .run();
  }
  if (root && start + pages.length < root.manifest.pages.length) return false;
  if (root)
    await atomic(context.database, [
      context.database
        .prepare(
          "INSERT INTO visonaut_summary_conversion_pages(run_id,page_key,section,rows_json) VALUES(?,?,'verified-root',?) ON CONFLICT DO NOTHING",
        )
        .bind(run.id, root.pointer.object_key, JSON.stringify([{ digest: root.pointer.digest }])),
      context.database.prepare("DELETE FROM operations_cursors WHERE id=?").bind(cursorId),
    ]);
  if (await nextRoot()) return false;
  const owners = await affectedHistoryOwners(context.database, run.id);
  await atomic(context.database, [
    assertion(
      context.database,
      `NOT EXISTS(${pendingLegacySummaryRootSql}) AND EXISTS(SELECT 1 FROM visonaut_runs WHERE id=? AND (detail_archived=0 OR EXISTS(SELECT 1 FROM operations_run_archives WHERE run_id=? AND state='ready')))`,
      [run.id, run.id, run.id, run.id, run.id],
    ),
    assertion(
      context.database,
      "EXISTS(SELECT 1 FROM visonaut_runs WHERE id=? AND revision=? AND active=0)",
      [run.id, run.revision],
    ),
    assertion(
      context.database,
      "(SELECT COUNT(*) FROM visonaut_closed_summary_rows WHERE run_id=?)=(SELECT COUNT(*) FROM (SELECT json_extract(entry.value,'$.id') AS id FROM visonaut_summary_conversion_pages page,json_each(page.rows_json) entry WHERE page.run_id=? AND page.section='row-ids' UNION SELECT row.id FROM visonaut_comparison_rows row JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=?))",
      [run.id, run.id, run.id],
    ),
    context.database
      .prepare(
        `UPDATE visonaut_closed_summary_rows AS row SET metadata_json=COALESCE((SELECT json_object('name',json_extract(json_extract(entry.value,'$.metadata_json'),'$.name'),'variant',json_extract(json_extract(entry.value,'$.metadata_json'),'$.variant')) FROM visonaut_summary_conversion_pages page,json_each(page.rows_json) entry WHERE page.run_id=row.run_id AND page.section IN ('captures','referenceCaptures') AND json_extract(entry.value,'$.id')=COALESCE(row.candidate_capture_id,row.reference_capture_id) LIMIT 1),row.metadata_json) WHERE run_id=?`,
      )
      .bind(run.id),
    context.database
      .prepare(
        `UPDATE visonaut_closed_summary_rows AS row SET (verdict,kind,actor_id,revoked)=(SELECT json_extract(entry.value,'$.verdict'),json_extract(entry.value,'$.kind'),json_extract(entry.value,'$.actor_id'),json_extract(entry.value,'$.revoked') FROM visonaut_summary_conversion_pages page,json_each(page.rows_json) entry WHERE page.run_id=row.run_id AND page.section='decisions' AND json_extract(entry.value,'$.id')=COALESCE(row.source_decision_id,row.decision_id) LIMIT 1) WHERE run_id=? AND EXISTS(SELECT 1 FROM visonaut_summary_conversion_pages page,json_each(page.rows_json) entry WHERE page.run_id=row.run_id AND page.section='decisions' AND json_extract(entry.value,'$.id')=COALESCE(row.source_decision_id,row.decision_id))`,
      )
      .bind(run.id),
    context.database
      .prepare(
        "UPDATE visonaut_closed_summary_rows AS row SET accepted=EXISTS(SELECT 1 FROM visonaut_summary_conversion_pages page,json_each(page.rows_json) entry WHERE page.run_id=row.run_id AND page.section='acceptance' AND json_extract(entry.value,'$.id')=row.id) WHERE run_id=? AND EXISTS(SELECT 1 FROM visonaut_summary_conversion_pages page,json_each(page.rows_json) entry WHERE page.run_id=row.run_id AND page.section='row-ids' AND json_extract(entry.value,'$.id')=row.id)",
      )
      .bind(run.id),
    assertion(
      context.database,
      "NOT EXISTS(SELECT 1 FROM visonaut_closed_summary_rows WHERE run_id=? AND COALESCE(source_decision_id,decision_id) IS NOT NULL AND (verdict IS NULL OR verdict NOT IN('approved','rejected') OR kind IS NULL OR kind NOT IN('human','automatic') OR revoked IS NULL OR revoked NOT IN(0,1)))",
      [run.id],
    ),
    context.database
      .prepare(`INSERT INTO visonaut_closed_summary_decisions(id,run_id,row_id,revision,verdict,kind,actor_id,command_id,tuple_json,original_tuple_json,source_decision_id,revoked,created_at)
      SELECT json_extract(entry.value,'$.id'),?,json_extract(entry.value,'$.row_id'),json_extract(entry.value,'$.revision'),json_extract(entry.value,'$.verdict'),json_extract(entry.value,'$.kind'),json_extract(entry.value,'$.actor_id'),json_extract(entry.value,'$.command_id'),json_extract(entry.value,'$.tuple_json'),json_extract(entry.value,'$.original_tuple_json'),json_extract(entry.value,'$.source_decision_id'),json_extract(entry.value,'$.revoked'),json_extract(entry.value,'$.created_at') FROM visonaut_summary_conversion_pages page,json_each(page.rows_json) entry WHERE page.run_id=? AND page.section='decisions' ON CONFLICT(run_id,id) DO NOTHING`)
      .bind(run.id, run.id),
    context.database
      .prepare(
        `UPDATE visonaut_closed_summaries SET state='ready',row_count=(SELECT COUNT(*) FROM visonaut_closed_summary_rows WHERE run_id=?),decision_count=(SELECT COUNT(*) FROM visonaut_closed_summary_decisions WHERE run_id=?),audit_json=CASE WHEN EXISTS(SELECT 1 FROM visonaut_summary_conversion_pages WHERE run_id=? AND section='audit') THEN COALESCE((SELECT json_group_array(json(action_count)) FROM (SELECT json_object('action',json_extract(entry.value,'$.action'),'count',COUNT(*)) AS action_count FROM visonaut_summary_conversion_pages page,json_each(page.rows_json) entry WHERE page.run_id=? AND page.section='audit' GROUP BY json_extract(entry.value,'$.action'))),'[]') ELSE audit_json END WHERE run_id=?`,
      )
      .bind(run.id, run.id, run.id, run.id, run.id),
    ...finishClosedSummary(context.database, run.id, owners),
    context.database
      .prepare("DELETE FROM visonaut_summary_conversion_pages WHERE run_id=?")
      .bind(run.id),
    context.database.prepare("DELETE FROM operations_cursors WHERE id=?").bind(cursorId),
  ]);
  return true;
}

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
    database
      .prepare(
        "UPDATE visonaut_runs SET plan_json='{}',detail_archived=1,revision=revision+1 WHERE id=? AND detail_archived=0",
      )
      .bind(runId),
    database
      .prepare(
        "DELETE FROM work_tasks WHERE state='complete' AND id IN(SELECT row.id FROM visonaut_comparison_rows row JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id WHERE comparison.run_id=?)",
      )
      .bind(runId),
    // Exact tuples and decision stubs still serve baseline and source approval checks.
    database
      .prepare(
        "UPDATE visonaut_comparison_rows SET reference_capture_id=NULL,candidate_capture_id=NULL,result_json=NULL WHERE comparison_id IN(SELECT id FROM visonaut_comparisons WHERE run_id=?)",
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
  building = false,
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
      COALESCE((SELECT json_group_array(json(action_count)) FROM (SELECT json_object('action',action,'count',COUNT(*)) AS action_count FROM visonaut_audit WHERE run_id=? GROUP BY action)),'[]'),?`)
      .bind(
        run.id,
        run.revision,
        context.now(),
        run.id,
        run.id,
        run.id,
        run.id,
        building ? "building" : "ready",
      ),
    context.database
      .prepare(`INSERT INTO visonaut_closed_summary_rows(id,run_id,comparison_id,ordinal,item_key,variant_key,tuple_json,outcome,decision_revision,decision_id,source_decision_id,accepted,verdict,kind,actor_id,revoked,reference_capture_id,candidate_capture_id,metadata_json,result_json)
      SELECT row.id,?,row.comparison_id,row.ordinal,row.item_key,row.variant_key,row.tuple_json,row.outcome,row.decision_revision,row.decision_id,row.source_decision_id,COALESCE(${historicalAcceptance},0),decision.verdict,decision.kind,decision.actor_id,decision.revoked,row.reference_capture_id,row.candidate_capture_id,
      json_object('name',json_extract(capture.metadata_json,'$.name'),'variant',json_extract(capture.metadata_json,'$.variant')),row.result_json
      FROM visonaut_comparison_rows row JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id LEFT JOIN visonaut_decisions decision ON decision.id=COALESCE(row.source_decision_id,row.decision_id)
      LEFT JOIN visonaut_captures capture ON capture.id=COALESCE(row.candidate_capture_id,row.reference_capture_id) WHERE comparison.run_id=?`)
      .bind(run.id, run.id),
    context.database
      .prepare(`INSERT INTO visonaut_closed_summary_decisions(id,run_id,row_id,revision,verdict,kind,actor_id,command_id,tuple_json,original_tuple_json,source_decision_id,revoked,created_at)
      SELECT decision.id,?,decision.row_id,decision.revision,decision.verdict,decision.kind,decision.actor_id,decision.command_id,decision.tuple_json,decision.original_tuple_json,decision.source_decision_id,decision.revoked,decision.created_at FROM visonaut_decisions decision WHERE ${summaryDecisionScope}`)
      .bind(run.id, run.id, run.id),
    ...(building ? [] : finishClosedSummary(context.database, run.id, owners)),
  ]);
}

/** Preserve compact identity and actor evidence before the existing 30-day byte collector. */
export async function summarizeClosedRuns(context: OperationsContext): Promise<OperationReport> {
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  // A root and one page are the smallest useful conversion turn.
  const reads = { remaining: Math.max(2, context.budget.objectsPerStep) };
  const commandBudget = { remaining: context.budget.tasksPerStep };
  const cursorId = "closed-summary-candidates";
  const cursor = await context.database
    .prepare("SELECT value FROM operations_cursors WHERE id=?")
    .bind(cursorId)
    .first<{ value: string }>();
  const candidates = await context.database
    .prepare(`SELECT run.id,run.revision,run.detail_archived,summary.state AS summary_state,EXISTS(SELECT 1 FROM operations_comparison_archives WHERE run_id=run.id AND state='ready') AS has_supplements FROM visonaut_runs run
    LEFT JOIN visonaut_closed_summaries summary ON summary.run_id=run.id
    WHERE run.id>? AND run.active=0 AND run.closed_at<=? AND (summary.run_id IS NULL OR summary.state='building')
    AND NOT EXISTS(SELECT 1 FROM visonaut_comparisons comparison WHERE comparison.run_id=run.id AND comparison.purpose='historical' AND comparison.state='comparing')
    AND NOT EXISTS(SELECT 1 FROM operations_events event WHERE event.kind='history' AND event.subject_id=run.id AND event.code='summary-conversion-failed' AND event.resolved_at IS NULL AND event.last_seen_at>?)
    ORDER BY run.id LIMIT ?`)
    .bind(
      cursor?.value ?? "",
      context.now() - closedRunRetentionMs,
      context.now() - context.budget.leaseMilliseconds,
      context.budget.tasksPerStep,
    )
    .all<{
      id: string;
      revision: number;
      detail_archived: number;
      summary_state: string | null;
      has_supplements: number;
    }>();
  for (const run of candidates.results ?? []) {
    try {
      let complete = false;
      if (await prepareClosedCommandDigests({ context, run, budget: commandBudget })) {
        const needsConversion =
          run.detail_archived || run.has_supplements || run.summary_state === "building";
        if (!run.detail_archived && run.summary_state === null) {
          await summarizeLiveClosedRun(context, run, !!needsConversion);
        }
        complete = needsConversion ? await convertLegacySummary(context, run, reads) : true;
      }
      if (complete) await resolveEvents(context.database, "history", run.id, context.now());
      (complete ? report.completed : report.deferred).push(run.id);
      if (!complete) report.hasMore = true;
    } catch {
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
        "INSERT INTO operations_cursors(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
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
