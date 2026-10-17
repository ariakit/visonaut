// The words of the run header and of the result page: why a run closed, and
// how far its review is. Only changes count: almost every variant of a normal
// run is unchanged, and an unchanged variant is not work.

import {
  reviewStateWords,
  runClosedReasonWords,
  runClosedWords,
  type RunReviewState,
} from "@visonaut/protocol";
import type { ReviewShares } from "../components/kit/run-row.tsx";
import { formatCount } from "../components/kit/format.ts";
import type { ReviewModel } from "./model.ts";
import { needsReview } from "./navigation.ts";

/**
 * The words of a closed run: the stored reason, or words that name no cause
 * for a run that closed before the service stored one. Undefined for an open
 * run. It follows the rule of a run row.
 */
export function getClosedWords(run: ReviewModel["run"]): string | undefined {
  if (run.closedReason) return runClosedReasonWords[run.closedReason];
  if (run.status === "superseded") return runClosedWords;
  return undefined;
}

/**
 * - `comparing`: review is not open yet.
 * - `reviewing`: at least one change needs review.
 * - `closed`: a read-only run with changes that nobody decided.
 * - `done`: nothing is left to review.
 */
export type RunProgressPhase = "comparing" | "reviewing" | "closed" | "done";

export interface RunProgress {
  phase: RunProgressPhase;
  /** `9 left`, `All approved`, `2 rejected`, `Comparing`, `228 not reviewed`. */
  label: string;
  /** The parts of the bar. Null for a run without a change, and while it compares. */
  shares: ReviewShares | null;
  /** The variants whose comparison failed. */
  failed: number;
  /** The screenshots with at least one change that has a verdict or needs one. */
  screenshots: number;
}

/** What the run progress of the header shows, from the variants of the first response. */
export function getRunProgress(model: ReviewModel): RunProgress {
  let approved = 0;
  let rejected = 0;
  let open = 0;
  let failed = 0;
  let comparing = 0;
  let screenshots = 0;
  for (const item of model.items) {
    let changed = false;
    for (const variant of item.variants) {
      if (variant.kind === "error") {
        failed += 1;
      } else if (variant.kind === "pending") {
        comparing += 1;
      } else if (needsReview(variant)) {
        open += 1;
        changed = true;
      } else if (variant.kind !== "unchanged" && variant.verdict === "approved") {
        approved += 1;
        changed = true;
      } else if (variant.kind !== "unchanged" && variant.verdict === "rejected") {
        rejected += 1;
        changed = true;
      }
    }
    if (changed) {
      screenshots += 1;
    }
  }
  if (comparing > 0 || model.comparisonState === "comparing") {
    return { phase: "comparing", label: "Comparing", shares: null, failed, screenshots };
  }
  const total = approved + rejected + open;
  const shares: ReviewShares | null = total
    ? {
        approved,
        rejected,
        open,
        total,
        label: [
          `${formatCount(approved)} approved`,
          `${formatCount(rejected)} rejected`,
          `${formatCount(open)} open`,
        ].join(", "),
      }
    : null;
  if (!open) {
    // A failed comparison has no verdict, and a run with one cannot pass, so
    // it comes first.
    const label = failed
      ? `${formatCount(failed)} failed`
      : rejected
        ? `${formatCount(rejected)} rejected`
        : total
          ? "All approved"
          : "No changes";
    return { phase: "done", label, shares, failed, screenshots };
  }
  if (model.archived) {
    const label = `${formatCount(open)} not reviewed`;
    return { phase: "closed", label, shares, failed, screenshots };
  }
  return { phase: "reviewing", label: `${formatCount(open)} left`, shares, failed, screenshots };
}

function isRunState(status: string): status is RunReviewState {
  return Object.hasOwn(reviewStateWords, status);
}

/**
 * The state of a run in the words of the pages: `Passed`, or `Replaced`.
 * Undefined for a status that is not a run state, such as `compared` for an
 * earlier comparison of the run.
 */
export function getRunStateWords(run: ReviewModel["run"]): string | undefined {
  const closed = getClosedWords(run);
  if (closed) return closed;
  if (!isRunState(run.status)) return undefined;
  return reviewStateWords[run.status];
}

export interface RunResult {
  /** `All approved`, `2 rejected`, or `Nothing to review`. */
  title: string;
  /**
   * `Run state: Rejected. 9 changes in 3 screenshots: 7 approved, 2 rejected.`
   * An earlier comparison has no run state, so its sentence has the counts only.
   */
  sentence: string;
  /** At least one change is rejected. */
  rejected: boolean;
}

/**
 * The result of a run with nothing left to review (D-WORK-05). It is null
 * while a change is open or a comparison runs. A failed comparison has no
 * verdict, so a run with one has no result: the stage shows the error.
 */
export function getRunResult(model: ReviewModel): RunResult | null {
  const progress = getRunProgress(model);
  if (progress.phase !== "done") return null;
  if (progress.failed) return null;
  const words = getRunStateWords(model.run);
  const state = words ? `Run state: ${words}. ` : "";
  const { shares } = progress;
  if (!shares) {
    return {
      title: "Nothing to review",
      sentence: `${state}No screenshot changed from baseline ${model.baselineRevision}.`,
      rejected: false,
    };
  }
  const changes = formatCount(shares.total, "change");
  const screenshots = formatCount(progress.screenshots, "screenshot");
  const verdicts = `${formatCount(shares.approved)} approved, ${formatCount(shares.rejected)} rejected`;
  return {
    title: progress.label,
    sentence: `${state}${changes} in ${screenshots}: ${verdicts}.`,
    rejected: shares.rejected > 0,
  };
}
