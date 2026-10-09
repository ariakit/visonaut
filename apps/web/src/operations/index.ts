import { processReviewQueue } from "./review-queue.ts";
import { reportComparisonRecovery } from "./comparison-alerts.ts";
import { pruneCaptureProfiles } from "../profiles.ts";
import {
  expireComparisonReferences,
  expireSnapshotImages,
  retireSourceBaselines,
} from "./snapshot-retention.ts";
import { Service } from "@visonaut/service";
import { deliverGitHubStatuses } from "./checks.ts";
import { publishReviewLinks } from "./review-links.ts";
import { eventId, recordEvent, resolveEventIds, validateBudget } from "./common.ts";
import { summarizeClosedRuns } from "./closed-summary.ts";
import type { OperationsMessage } from "@visonaut/service";
import { expireExports } from "./exports.ts";
import { promoteBaselines } from "./promotions.ts";
import { expireRunImages } from "./retention.ts";
import { retireReplacedMainRuns } from "./main-retirement.ts";
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
  // A failed step raises its alert and does not stop the steps after it. The
  // alert has the name of the step as its kind, and it closes at the end of
  // the next pass that completes the step.
  const completedStepAlerts: string[] = [];
  const runStep = async (name: string, operation: () => Promise<OperationReport>) => {
    const alert = { kind: name, subject: "scheduler", code: "step-failed" };
    try {
      reports[name] = await operation();
      completedStepAlerts.push(eventId(alert));
    } catch {
      await recordEvent(context.database, { ...alert, now: context.now() });
      reports[name] = { completed: [], deferred: [], attention: ["scheduler"], hasMore: false };
    }
  };
  if (message.kind === "recovery" || message.kind === "ingest") {
    await runStep("main-retirement", () => retireReplacedMainRuns(context));
    // The alert report needs the result of the finalization, so the two are
    // one step.
    await runStep("finalization", async () => {
      const service = new Service(context.database);
      const finalized = await service.reconcileComparisons({
        now: context.now(),
        limit: context.budget.tasksPerStep,
      });
      await reportComparisonRecovery(context, { published: [], failed: [] }, finalized);
      return {
        completed: finalized.completed,
        deferred: [],
        attention: finalized.errors.map((error) => error.comparisonId),
        hasMore: finalized.completed.length === context.budget.tasksPerStep,
      };
    });
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
    await runStep(name, operation);
    if (name === "promotion") {
      promotionMs = Math.round(performance.now() - stepStarted);
    }
  }
  if (
    message.kind === "recovery" ||
    (message.kind === "maintenance" && message.family === "retention")
  ) {
    await runStep("exports", async () => {
      await expireExports(context);
      return { completed: [], deferred: [], attention: [], hasMore: false };
    });
  }
  await resolveEventIds(context.database, completedStepAlerts, context.now());
  console.info(
    JSON.stringify({
      event: "operations_pass",
      elapsedMs: Math.round(performance.now() - started),
      promotionMs,
    }),
  );
  const hasMore = Object.values(reports).some((report) => report.hasMore);
  return { reports, hasMore };
}
