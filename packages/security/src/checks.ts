import { reviewStateWords, runClosedWords, type RunReviewState } from "@visonaut/protocol";
import { SecurityError } from "./errors.js";
import { GitHubUnavailableError } from "./github.js";

/** Structural match for the service's durable outbox intent. */
export interface StatusDelivery {
  check_id: string;
  revision: number;
  run_id: string;
  attempt: number;
  comparison_revision: number;
  source_revision: number;
  conclusion: "pending" | "success" | "failure";
  /** The four review values are NULL for a check with no known state and for an old row. */
  review_state: RunReviewState | null;
  review_pending: number | null;
  review_rejected: number | null;
  review_approved: number | null;
  details_url: string;
  attempts: number;
  max_attempts: number;
}

/**
 * The review state of a run and its three counts, with the one definition of
 * the run list: `pending` includes the rejected changes.
 */
export interface CheckReview {
  state: RunReviewState;
  pending: number;
  rejected: number;
  approved: number;
}

/** The review values of a stored status update. An update with no state has none. */
export function checkReview(delivery: StatusDelivery): CheckReview | null {
  if (delivery.review_state == null) return null;
  return {
    state: delivery.review_state,
    pending: delivery.review_pending ?? 0,
    rejected: delivery.review_rejected ?? 0,
    approved: delivery.review_approved ?? 0,
  };
}

/** Structural match for the sender result that the service retries with no lock. */
export interface StatusReadFailure {
  readError: string;
  /** The caught error. A caller reads its class and its fixed code for a log. */
  error: unknown;
}

/**
 * The result of a sender whose GitHub read failed before its write request.
 * The text has the HTTP status of GitHub. A failure with no answer has none.
 */
export function statusReadFailure(error: unknown): StatusReadFailure {
  const status = error instanceof GitHubUnavailableError ? error.upstreamStatus : undefined;
  return {
    readError: status ? `${String(error)} GitHub status: ${status}.` : String(error),
    error,
  };
}

/** The review link of a run on this origin. Any other link throws. */
export function reviewUrl(url: string, origin: string): string {
  const parsed = new URL(url);
  if (
    parsed.origin !== origin ||
    !/^\/runs\/[A-Za-z0-9_-]+$/.test(parsed.pathname) ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new SecurityError("invalid_review_link", 500, "The check review link is invalid.");
  }
  return parsed.href;
}

/** The text of a result before the service read the state of its run. */
export const startingCheckTitle = "Checking visual coverage";

function changes(count: number, singular: string, plural: string) {
  return count === 1 ? `1 change ${singular}` : `${count} changes ${plural}`;
}

export interface CheckText {
  title: string;
  /** Who acts next. */
  next: string;
  /** True when the summary has the three counts. The other states read no counts. */
  counted?: boolean;
}

// The maintainer approved each sentence on 2026-10-09 (the table of #267).
// GitHub shows the text on each pull request, so a change needs a new approval.
// The check and the pull request comment both read it.
export function checkText({ state, pending, rejected, approved }: CheckReview): CheckText {
  switch (state) {
    case "needs-review":
      return {
        // A rejected change has a verdict, so it does not wait for a review.
        title: changes(pending - rejected, "needs review", "need review"),
        next: "Next: a maintainer approves or rejects each change. If a change is not intended, the author pushes a commit that removes it.",
        counted: true,
      };
    case "rejected":
      return {
        title: changes(rejected, "rejected", "rejected"),
        next: "Next: the author pushes a commit that corrects the rejected changes. A maintainer can also change a decision.",
        counted: true,
      };
    case "passed":
      // A run with no change has no approval, and the accepted baseline run
      // reads no counts. The text of both has no number.
      if (approved === 0) {
        return {
          title: reviewStateWords.passed,
          next: "No action is necessary. No change needs review.",
        };
      }
      return {
        title: changes(approved, "approved", "approved"),
        next: "No action is necessary. Each change is approved.",
        counted: true,
      };
    case "incomplete":
      return {
        title: `${reviewStateWords.incomplete} screenshots`,
        next: "No action is necessary. CI captures the screenshots of this commit.",
      };
    case "comparing":
      return {
        title: `${reviewStateWords.comparing} screenshots`,
        next: "No action is necessary. Visonaut compares the screenshots with the baseline.",
      };
    case "needs-recompare":
      return {
        title: reviewStateWords["needs-recompare"],
        next: "Next: a maintainer runs the CI workflow of this commit again. The baseline changed after the comparison of this run.",
      };
    case "superseded":
      return {
        // A run closes for more than one cause, and the update stores none.
        title: runClosedWords,
        next: "This run is closed, and its result does not change. Next: the author pushes a commit, or a maintainer runs the CI workflow again, to start a new run.",
      };
    case "failed":
      return {
        title: "Capture or comparison failed",
        next: "The capture or the comparison did not complete. Next: a maintainer runs the CI workflow again, or the author pushes a commit.",
      };
  }
}
