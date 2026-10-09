import { reviewStateWords, type RunReviewState } from "@visonaut/protocol";

/** The search text and the result filter of the History page. They are in the URL. */
export interface HistorySearch {
  q?: string;
  state?: RunReviewState;
}

function isRunState(value: unknown): value is RunReviewState {
  return typeof value === "string" && Object.hasOwn(reviewStateWords, value);
}

/** Reads the search parameters of the History page and drops each unknown value. */
export function historySearch(search: Record<string, unknown>): HistorySearch {
  return {
    q: typeof search.q === "string" && search.q ? search.q : undefined,
    state: isRunState(search.state) ? search.state : undefined,
  };
}
