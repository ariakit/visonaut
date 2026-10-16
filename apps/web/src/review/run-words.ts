// The words of the run header: why a run closed, and how far its review is.
// Only changes count: almost every variant of a normal run is unchanged, and
// an unchanged variant is not work.

import { runClosedReasonWords, runClosedWords } from "@visonaut/protocol";
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
}

/** What the run progress of the header shows, from the variants of the first response. */
export function getRunProgress(model: ReviewModel): RunProgress {
  let approved = 0;
  let rejected = 0;
  let open = 0;
  let failed = 0;
  let comparing = 0;
  for (const item of model.items) {
    for (const variant of item.variants) {
      if (variant.kind === "error") {
        failed += 1;
      } else if (variant.kind === "pending") {
        comparing += 1;
      } else if (needsReview(variant)) {
        open += 1;
      } else if (variant.kind !== "unchanged" && variant.verdict === "approved") {
        approved += 1;
      } else if (variant.kind !== "unchanged" && variant.verdict === "rejected") {
        rejected += 1;
      }
    }
  }
  if (comparing > 0 || model.comparisonState === "comparing") {
    return { phase: "comparing", label: "Comparing", shares: null };
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
    return { phase: "done", label, shares };
  }
  if (model.archived) {
    return { phase: "closed", label: `${formatCount(open)} not reviewed`, shares };
  }
  return { phase: "reviewing", label: `${formatCount(open)} left`, shares };
}
