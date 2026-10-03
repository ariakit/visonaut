import { processReviewQueue } from "./review-queue.ts";
import { reportComparisonRecovery } from "./comparison-alerts.ts";
import { pruneCaptureProfiles } from "../profiles.ts";
import {
  expireComparisonReferences,
  expireSnapshotImages,
  retireSourceBaselines,
} from "./snapshot-retention.ts";
import { reconcileWork, Service } from "@visonaut/service";
import { deliverGitHubStatuses } from "./checks.ts";
import { publishReviewLinks } from "./review-links.ts";
import { recordEvent, resolveEvents, validateBudget } from "./common.ts";
import { summarizeClosedRuns } from "./closed-summary.ts";
import type { OperationsMessage } from "@visonaut/service";
import { expireExports } from "./exports.ts";
import { promoteBaselines } from "./promotions.ts";
import { expireRunImages } from "./retention.ts";
import type { OperationsContext, OperationReport } from "./types.ts";
export * from "./types.ts";
export * from "./exports.ts";

/** Invoke after ingest reconciliation. Queue a continuation when hasMore is true. */
export async function runOperations(
  context: OperationsContext,
  message: OperationsMessage = { kind: "recovery" },
) {
  validateBudget(context.budget);
  const started = performance.now();
  let promotionMs = 0;
  const reports: Record<string, OperationReport> = {};
  if (message.kind === "recovery" || message.kind === "ingest") {
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
  }
  const steps: [string, () => Promise<OperationReport>][] = [
    ["review-decisions", () => processReviewQueue(context)],
    ["checks", () => deliverGitHubStatuses(context)],
    ["review-links", () => publishReviewLinks(context)],
    ["promotion", () => promoteBaselines(context)],
    ["history", () => summarizeClosedRuns(context)],
    ["reference-retention", () => expireComparisonReferences(context)],
    ["source-retention", () => retireSourceBaselines(context)],
    ["snapshot-retention", () => expireSnapshotImages(context)],
    ["retention", () => expireRunImages(context)],
    [
      "profile-retention",
      () => pruneCaptureProfiles(context.database, context.budget.objectsPerStep),
    ],
  ];
  const statusNames = new Set(["review-decisions", "checks", "review-links", "promotion"]);
  const familyNames = {
    history: new Set(["history"]),
    retention: new Set([
      "reference-retention",
      "source-retention",
      "snapshot-retention",
      "retention",
    ]),
    profiles: new Set(["profile-retention"]),
  };
  for (const [name, operation] of steps) {
    if (message.kind === "status" && !statusNames.has(name)) continue;
    if (message.kind === "maintenance" && !familyNames[message.family].has(name)) continue;
    if (message.kind === "ingest") continue;
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
    }
  }
  const hasMore = Object.values(reports).some((report) => report.hasMore);
  try {
    if (
      message.kind === "recovery" ||
      (message.kind === "maintenance" && message.family === "retention")
    )
      await expireExports(context);
  } finally {
    console.info(
      JSON.stringify({
        event: "operations_pass",
        elapsedMs: Math.round(performance.now() - started),
        promotionMs,
      }),
    );
  }
  return { reports, hasMore };
}
