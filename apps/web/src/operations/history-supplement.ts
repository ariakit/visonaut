import { assertion, atomic, compactHistoricalComparison, ConflictError } from "@ariviso/service";
import { recordEvent, resolveEvents } from "./common.ts";
import {
  historyPrefix,
  maximumHistoryProgressBytes,
  parseHistoryManifest,
  type ArchivedRunHistory,
  type HistoryPointer,
} from "./history-format.ts";
import {
  readVerifiedHistoryObject,
  readHistoryView,
  readHistoryManifest,
  readArchivedSection,
  writeHistoryStep,
  type HistoryProgress,
} from "./history.ts";
import type { OperationReport, OperationsContext } from "./types.ts";

const eligible = `comparison.purpose='historical' AND comparison.state IN('ready','invalidated')
  AND NOT EXISTS(SELECT 1 FROM work_tasks task JOIN ariviso_comparison_rows row ON row.id=task.id
    WHERE row.comparison_id=comparison.id AND task.state IN('queued','leased'))`;
interface ComparisonArchive extends HistoryPointer {
  comparison_id: string;
  state: "building" | "ready";
  progress_json: string;
  lease_until: number | null;
}

export async function readComparisonHistoryManifest(
  context: Pick<OperationsContext, "database" | "images" | "budget">,
  input: { runId: string; comparisonId: string },
) {
  const pointer = await context.database
    .prepare(
      "SELECT * FROM operations_comparison_archives WHERE run_id=? AND comparison_id=? AND state='ready'",
    )
    .bind(input.runId, input.comparisonId)
    .first<ComparisonArchive>();
  if (!pointer) return null;
  if (pointer.object_key !== `${historyPrefix(input.runId, pointer.generation)}manifest.json`)
    throw new Error("Historical comparison root is outside its private namespace.");
  const manifest = parseHistoryManifest(
    await readVerifiedHistoryObject(context, {
      key: pointer.object_key,
      digest: pointer.digest,
      bytes: pointer.bytes,
    }),
    {
      runId: input.runId,
      generation: pointer.generation,
      maximumObjectBytes: context.budget.maximumObjectBytes,
    },
  );
  if (manifest.pages.length !== pointer.page_count)
    throw new Error("Historical comparison page count is inconsistent.");
  return { pointer, manifest };
}

export async function archiveHistoricalComparisons(
  context: OperationsContext,
): Promise<OperationReport> {
  const report: OperationReport = { completed: [], deferred: [], attention: [], hasMore: false };
  const candidates = await context.database
    .prepare(`SELECT comparison.id,comparison.run_id FROM ariviso_comparisons comparison WHERE ${eligible}
    AND NOT EXISTS(SELECT 1 FROM operations_comparison_archives archive WHERE archive.comparison_id=comparison.id AND (archive.state='ready' OR archive.lease_until>? OR archive.retry_at>?)) ORDER BY comparison.created_at,comparison.id LIMIT ?`)
    .bind(context.now(), context.now(), context.budget.tasksPerStep)
    .all<{ id: string; run_id: string }>();
  report.hasMore = (candidates.results?.length ?? 0) === context.budget.tasksPerStep;
  let remaining = Math.min(context.budget.objectsPerStep, 20);
  for (const candidate of candidates.results ?? []) {
    if (!remaining) {
      report.hasMore = true;
      break;
    }
    const token = crypto.randomUUID();
    try {
      const prior = await context.database
        .prepare("SELECT * FROM operations_comparison_archives WHERE comparison_id=?")
        .bind(candidate.id)
        .first<ComparisonArchive>();
      if (prior?.state === "ready" || (prior?.lease_until ?? 0) > context.now()) continue;
      const generation = prior?.generation ?? crypto.randomUUID();
      const progress: HistoryProgress = prior
        ? JSON.parse(prior.progress_json)
        : { section: 0, cursor: "", pages: [] };
      await atomic(context.database, [
        assertion(
          context.database,
          `EXISTS(SELECT 1 FROM ariviso_comparisons comparison WHERE comparison.id=? AND ${eligible}) AND NOT EXISTS(SELECT 1 FROM operations_comparison_archives archive WHERE archive.comparison_id=? AND (archive.state='ready' OR archive.lease_until>?))`,
          [candidate.id, candidate.id, context.now()],
        ),
        context.database
          .prepare(
            `INSERT INTO operations_comparison_archives(comparison_id,run_id,generation,state,object_key,page_count,progress_json,lease_token,lease_until,created_at) VALUES(?,?,?,'building',?,0,?,?,?,?) ON CONFLICT(comparison_id) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until`,
          )
          .bind(
            candidate.id,
            candidate.run_id,
            generation,
            `${historyPrefix(candidate.run_id, generation)}manifest.json`,
            JSON.stringify(progress),
            token,
            context.now() + context.budget.leaseMilliseconds,
            context.now(),
          ),
      ]);
      const persist = async () => {
        const encoded = JSON.stringify(progress);
        if (new TextEncoder().encode(encoded).length > maximumHistoryProgressBytes)
          throw new Error("Historical comparison inventory exceeds its bound.");
        await atomic(context.database, [
          assertion(
            context.database,
            "EXISTS(SELECT 1 FROM operations_comparison_archives WHERE comparison_id=? AND state='building' AND lease_token=? AND lease_until>?)",
            [candidate.id, token, context.now()],
          ),
          context.database
            .prepare(
              "UPDATE operations_comparison_archives SET progress_json=?,page_count=?,lease_until=? WHERE comparison_id=? AND lease_token=?",
            )
            .bind(
              encoded,
              progress.pages.length,
              context.now() + context.budget.leaseMilliseconds,
              candidate.id,
              token,
            ),
        ]);
      };
      const written = await writeHistoryStep(context, {
        runId: candidate.run_id,
        comparisonId: candidate.id,
        generation,
        progress,
        limit: remaining,
        onPage: persist,
      });
      remaining -= written.pagesWritten;
      if (written.root) {
        await compactHistoricalComparison(context.database, {
          comparisonId: candidate.id,
          generation,
          token,
          objectKey: written.root.key,
          digest: written.root.digest,
          bytes: written.root.bytes,
          pageCount: progress.pages.length,
          now: context.now(),
        });
        report.completed.push(candidate.id);
        await resolveEvents(context.database, "historical-archive", candidate.id, context.now());
      } else {
        await persist();
        report.deferred.push(candidate.id);
        report.hasMore = true;
      }
    } catch (error) {
      if (error instanceof ConflictError) report.deferred.push(candidate.id);
      else {
        report.attention.push(candidate.id);
        await context.database
          .prepare(
            "UPDATE operations_comparison_archives SET attempts=attempts+1,retry_at=? WHERE comparison_id=? AND state='building' AND lease_token=?",
          )
          .bind(context.now() + 60 * 60 * 1000, candidate.id, token)
          .run();
        await recordEvent(context.database, {
          kind: "historical-archive",
          subject: candidate.id,
          code: "archive-failed",
          now: context.now(),
        });
      }
    } finally {
      await context.database
        .prepare(
          "UPDATE operations_comparison_archives SET lease_token=NULL,lease_until=NULL WHERE comparison_id=? AND state='building' AND lease_token=?",
        )
        .bind(candidate.id, token)
        .run();
    }
  }
  return report;
}

/** A selected comparison uses its own immutable supplement and the original run identity. */
export async function readArchivedComparison(
  context: Pick<OperationsContext, "database" | "images" | "budget">,
  input: { runId: string; comparisonId: string },
): Promise<ArchivedRunHistory | null> {
  const root = await readComparisonHistoryManifest(context, input);
  if (!root) return null;
  const history = await readHistoryView(context, root.manifest);
  const source = await readHistoryManifest(context, input.runId);
  if (source) {
    for await (const rows of readArchivedSection(context, input.runId, "run")) {
      history.sections.run = rows;
    }
  } else {
    const run = await context.database
      .prepare("SELECT * FROM ariviso_runs WHERE id=?")
      .bind(input.runId)
      .first();
    if (!run) throw new Error("Historical comparison run is missing.");
    history.sections.run = [run];
  }
  return history;
}
