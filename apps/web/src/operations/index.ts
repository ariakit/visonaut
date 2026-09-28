import { reportComparisonRecovery } from "./comparison-alerts.ts";
import { pruneCaptureProfiles } from "../profiles.ts";
import { expireComparisonReferences, expireSnapshotImages } from "./snapshot-retention.ts";
import { reconcileWork, Service } from "@visonaut/service";
import { backupDaily, expireBackups, type DatabaseExporter } from "./backups.ts";
import { deliverGitHubStatuses } from "./checks.ts";
import { publishReviewLinks } from "./review-links.ts";
import { recordEvent, resolveEvents, validateBudget } from "./common.ts";
import { archiveHistoricalComparisons } from "./history-supplement.ts";
import { archiveClosedRuns } from "./history.ts";
import { expireExports } from "./exports.ts";
import { promoteBaselines } from "./promotions.ts";
import { expireRunImages } from "./retention.ts";
import type { OperationsContext, OperationReport } from "./types.ts";
export * from "./types.ts";
export * from "./backups.ts";
export * from "./exports.ts";
export * from "./cloudflare-export.ts";
export * from "./recovery.ts";
export * from "./history.ts";
export * from "./history-format.ts";
export * from "./history-supplement.ts";

/** Invoke after ingest reconciliation. Queue a continuation when hasMore is true. */
export async function runOperations(context: OperationsContext, exporter: DatabaseExporter) {
  validateBudget(context.budget);
  const started = performance.now();
  let promotionMs = 0;
  let backupMs = 0;
  const reports: Record<string, OperationReport> = {};
  const publication = await reconcileWork(context.database, {
    kind: "compare",
    scope: "current-comparison",
    now: context.now(),
    limit: context.budget.tasksPerStep,
    publish: (taskId, publicationAttempt) =>
      context.comparisons.send({ taskId, publicationAttempt }),
  });
  reports.comparisons = {
    completed: publication.published,
    deferred: publication.failed,
    attention: [],
    hasMore: publication.hasMore,
  };
  // Queue receipts and bounded continuation feed the consumer without flooding it.
  const service = new Service(context.database);
  const finalized = await service.reconcileComparisons({
    now: context.now(),
    limit: context.budget.tasksPerStep,
  });
  reports.finalization = {
    completed: finalized.completed,
    deferred: [],
    attention: finalized.errors.map((error) => error.comparisonId),
    hasMore: finalized.completed.length === context.budget.tasksPerStep,
  };
  await reportComparisonRecovery(context, publication, finalized);
  const steps: [string, () => Promise<OperationReport>][] = [
    ["checks", () => deliverGitHubStatuses(context)],
    ["review-links", () => publishReviewLinks(context)],
    ["promotion", () => promoteBaselines(context)],
    ["backup", () => backupDaily(context, exporter, { allowNew: false })],
    ["historical-archive", () => archiveHistoricalComparisons(context)],
    ["history", () => archiveClosedRuns(context)],
    ["reference-retention", () => expireComparisonReferences(context)],
    ["snapshot-retention", () => expireSnapshotImages(context)],
    ["retention", () => expireRunImages(context)],
    [
      "profile-retention",
      () => pruneCaptureProfiles(context.database, context.budget.objectsPerStep),
    ],
    ["backup-retention", () => expireBackups(context)],
  ];
  for (const [name, operation] of steps) {
    const stepStarted = performance.now();
    try {
      reports[name] = await operation();
      await resolveEvents(context.database, name, "scheduler", context.now());
    } catch {
      await recordEvent(context.database, {
        kind: name,
        subject: "scheduler",
        code: "step-failed",
        now: context.now(),
      });
      reports[name] = { completed: [], deferred: [], attention: ["scheduler"], hasMore: false };
    } finally {
      if (name === "promotion") {
        promotionMs = Math.round(performance.now() - stepStarted);
      }
      if (name === "backup") {
        backupMs = Math.round(performance.now() - stepStarted);
      }
    }
  }
  const hasMore = Object.values(reports).some((report) => report.hasMore);
  try {
    await expireExports(context);
    await resolveEvents(context.database, "backup", "freshness", context.now());
  } finally {
    console.info(
      JSON.stringify({
        event: "operations_pass",
        elapsedMs: Math.round(performance.now() - started),
        promotionMs,
        backupMs,
        backupHasMore: reports.backup?.hasMore ?? false,
      }),
    );
  }
  return { reports, hasMore };
}
