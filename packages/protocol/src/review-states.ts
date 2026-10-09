/**
 * The one word for each review state of a run (`Service.status`), for the API,
 * the check, and the pages. A reader keeps the code and shows the word. The
 * keys follow the order of the settled vocabulary. `RunState` of the CLI
 * protocol is a different union.
 */
export const reviewStateWords = {
  "needs-review": "Needs review",
  rejected: "Rejected",
  passed: "Passed",
  incomplete: "Capturing",
  comparing: "Comparing",
  "needs-recompare": "Rerun needed",
  superseded: "Replaced",
  failed: "Failed",
} as const;

export type RunReviewState = keyof typeof reviewStateWords;

/**
 * Why a run closed. The service stores the reason in the statement that closes
 * the run. A run that closed before the column existed has none.
 *
 * - `replaced`: a newer attempt, a newer commit of the pull request, or a newer
 *   main run took its place.
 * - `pull-request-closed`: the pull request was merged or closed.
 * - `merge-group-destroyed`: GitHub removed the merge group.
 * - `baseline-retired`: an accepted run whose baseline was retired.
 * - `expired`: the run did not finish. Its state is `failed`.
 */
export const runClosedReasons = [
  "replaced",
  "pull-request-closed",
  "merge-group-destroyed",
  "baseline-retired",
  "expired",
] as const;

export type RunClosedReason = (typeof runClosedReasons)[number];
