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
