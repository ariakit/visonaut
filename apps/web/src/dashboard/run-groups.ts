import type { DashboardRun } from "../api/dashboard.ts";

/** A run whose captures or comparison are in progress. */
export function isInProgress(run: Pick<DashboardRun, "state">) {
  return run.state === "comparing" || run.state === "incomplete";
}

/** A run that needs a new capture or a new CI run, not a decision. */
export function needsRecovery(run: Pick<DashboardRun, "state">) {
  return run.state === "needs-recompare" || run.state === "failed";
}

/**
 * A run of the Queue that waits for a decision. The Queue lists these runs
 * first, and the header has their number.
 */
export function awaitsReview(run: Pick<DashboardRun, "state">) {
  return !isInProgress(run) && !needsRecovery(run);
}
