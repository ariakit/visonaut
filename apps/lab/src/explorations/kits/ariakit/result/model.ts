// The words of the run progress in the header, and of the result page that
// shows when nothing is left to review. Only changes count: 3,823 of 3,832
// variants of a normal pull request are unchanged, and they are not work.

import type { ReviewSessionReady } from "../../../../fixtures/hooks/index.ts";
import { formatCount } from "../../../../fixtures/index.ts";
import type { InboxData, Run } from "../../../../fixtures/index.ts";
import type { ReviewShares } from "../run-row.tsx";
import { getRunNumber, getRunTarget } from "../runs.tsx";
import type { RunTarget } from "../runs.tsx";

type ProgressSource = Pick<
  ReviewSessionReady,
  "progress" | "counts" | "review" | "readOnly" | "readOnlyKind"
>;

/**
 * - `comparing`: review is not open yet.
 * - `reviewing`: at least one change needs review.
 * - `closed`: a closed run with changes that nobody decided.
 * - `done`: nothing is left to review.
 */
export type ProgressPhase = "comparing" | "reviewing" | "closed" | "done";

export interface RunProgressModel {
  phase: ProgressPhase;
  /** `9 left`, `All approved`, `2 rejected`, `Comparing 2,342 of 3,832`, `228 not reviewed`. */
  label: string;
  /** The parts of the bar. Null for a run without a change, and while it compares. */
  shares: ReviewShares | null;
  /** From 0 to 1, while the run compares and the data has the progress. */
  compared: number | null;
}

/**
 * The result of a run with nothing left to review. A failed comparison has
 * no verdict, and a run with one cannot pass, so it comes first.
 */
export function getResultWord({ progress, counts }: ProgressSource): string {
  if (counts.error > 0) return `${formatCount(counts.error)} failed`;
  if (progress.rejected > 0) return `${formatCount(progress.rejected)} rejected`;
  if (!progress.total) return "Nothing to review";
  return "All approved";
}

function getShares({ progress }: ProgressSource): ReviewShares | null {
  if (!progress.total) return null;
  const { approved, rejected, remaining } = progress;
  const words = [
    `${formatCount(approved)} approved`,
    `${formatCount(rejected)} rejected`,
    `${formatCount(remaining)} open`,
  ];
  return { approved, rejected, open: remaining, total: progress.total, label: words.join(", ") };
}

/** What the run progress of the header shows. */
export function getRunProgress(session: ProgressSource): RunProgressModel {
  const { progress, counts, review } = session;
  if (session.readOnlyKind === "comparing" || counts.comparing > 0) {
    // Only the proposed API has the progress of a comparison.
    const compared = review.progress?.compared;
    if (compared == null || counts.total <= 0) {
      return { phase: "comparing", label: "Comparing", shares: null, compared: null };
    }
    return {
      phase: "comparing",
      label: `Comparing ${formatCount(compared)} of ${formatCount(counts.total)}`,
      shares: null,
      compared: Math.min(1, compared / counts.total),
    };
  }
  const shares = getShares(session);
  if (!progress.remaining) {
    const label = progress.total ? getResultWord(session) : "No changes";
    return { phase: "done", label, shares, compared: null };
  }
  if (session.readOnly) {
    const label = `${formatCount(progress.remaining)} not reviewed`;
    return { phase: "closed", label, shares, compared: null };
  }
  const label = `${formatCount(progress.remaining)} left`;
  return { phase: "reviewing", label, shares, compared: null };
}

/** `9 changes in 3 screenshots`. */
export function getResultFacts({ progress }: ProgressSource): string {
  const changes = formatCount(progress.total, "change");
  return `${changes} in ${formatCount(progress.items.total, "screenshot")}`;
}

export interface NextRun {
  /** `#7754`, or `main`. */
  label: string;
  target: RunTarget;
}

function waitsForReview(run: Run): boolean {
  return run.state === "needs-review" || run.state === "rejected";
}

/** The next run of the Queue that waits for a person, or null. */
export function findNextRun(inbox: InboxData, currentRunId: string): NextRun | null {
  if (inbox.status !== "ready") return null;
  const run = inbox.runs.find((entry) => entry.id !== currentRunId && waitsForReview(entry));
  if (!run) return null;
  return { label: getRunNumber(run), target: getRunTarget(run) };
}

/**
 * The pull request of a run on GitHub. The API today sends the number only
 * inside the run title (`#7751 · Pull request visual review`).
 */
export function getPullRequestUrl({ review }: Pick<ReviewSessionReady, "review">): string | null {
  if (review.pullRequest?.url) return review.pullRequest.url;
  const match = /^#(\d+)/.exec(review.run.title ?? "");
  const number = review.pullRequest?.number ?? (match?.[1] ? Number(match[1]) : null);
  if (number == null) return null;
  return `https://github.com/${review.run.repository}/pull/${number}`;
}
