import { reviewStateWords, type RunReviewState } from "@visonaut/protocol";

/** The order of History. `newest` is the default, and the URL does not have it. */
export type HistorySort = "newest" | "oldest";

/** The search text, the result filter, and the order of the History page. They are in the URL. */
export interface HistorySearch {
  q?: string;
  state?: RunReviewState;
  sort?: "oldest";
}

function isRunState(value: unknown): value is RunReviewState {
  return typeof value === "string" && Object.hasOwn(reviewStateWords, value);
}

// The router reads `?q=7754` as a number. A person can type such a link.
function searchText(value: unknown) {
  if (typeof value === "number") {
    return String(value);
  }
  return typeof value === "string" && value ? value : undefined;
}

/** Reads the search parameters of the History page and drops each unknown value. */
export function historySearch(search: Record<string, unknown>): HistorySearch {
  return {
    q: searchText(search.q),
    state: isRunState(search.state) ? search.state : undefined,
    sort: search.sort === "oldest" ? "oldest" : undefined,
  };
}
