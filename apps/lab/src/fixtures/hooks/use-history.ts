import { useMemo, useState } from "react";
import { useDataMode } from "../data-mode.ts";
import { filterRuns, getHistoryData } from "../data/history.ts";
import type { Run, RunState, User } from "../types.ts";
import { getRunChangeCount, getRunTitle, runStateOrder } from "./labels.ts";
import { useRefresh } from "./use-refresh.ts";
import type { Refresh } from "./use-refresh.ts";

/**
 * - `created`: the creation time.
 * - `title`: the title, without case. In `today` mode a run has no title, so
 *   this is the order of `getRunTitle`: `Main`, then `Pull request`.
 * - `state`: the result, in the order of `runStateOrder`.
 * - `changes`: changed, added, and removed variants. Only in `improved` mode a
 *   run has counts. Without them this is the number of variants that are not
 *   accepted.
 * - `duration`: the capture and comparison time. Only in `improved` mode a run
 *   has a duration. Without it the runs keep their time order.
 */
export type HistorySortKey = "created" | "title" | "state" | "changes" | "duration";

export interface HistorySort {
  key: HistorySortKey;
  direction: "ascending" | "descending";
}

/** The app today: newest first. */
export const defaultHistorySort: HistorySort = { key: "created", direction: "descending" };

/** The direction that a column takes on its first click. */
const firstDirections: Record<HistorySortKey, HistorySort["direction"]> = {
  created: "descending",
  title: "ascending",
  state: "ascending",
  changes: "descending",
  duration: "descending",
};

function compareRuns(first: Run, second: Run, key: HistorySortKey): number {
  if (key === "title") {
    const one = getRunTitle(first).toLowerCase();
    const two = getRunTitle(second).toLowerCase();
    if (one === two) return 0;
    return one < two ? -1 : 1;
  }
  if (key === "state") {
    return runStateOrder.indexOf(first.state) - runStateOrder.indexOf(second.state);
  }
  if (key === "changes") {
    const one = getRunChangeCount(first) ?? first.pending;
    const two = getRunChangeCount(second) ?? second.pending;
    return one - two;
  }
  if (key === "duration") return (first.durationMs ?? 0) - (second.durationMs ?? 0);
  return first.createdAt - second.createdAt;
}

/** Sorts a copy of the runs. Equal runs stay newest first. */
export function sortRuns(runs: Run[], sort: HistorySort): Run[] {
  const sign = sort.direction === "ascending" ? 1 : -1;
  return runs.toSorted((first, second) => {
    const order = compareRuns(first, second, sort.key) * sign;
    return order || second.createdAt - first.createdAt;
  });
}

export interface HistoryOptions {
  /** Milliseconds of a refresh. Defaults to 700. */
  refreshLatency?: number;
}

interface HistoryBase extends Refresh {
  scenario: string;
}

export interface HistoryLoading extends HistoryBase {
  status: "loading";
}

export interface HistoryError extends HistoryBase {
  status: "error";
  message: string;
  reference?: string;
}

export interface HistoryLoaded extends HistoryBase {
  /** `empty` means that the service has no runs at all. */
  status: "ready" | "empty";
  repository: string;
  user: User;
  /** The largest number of runs that the service returns. */
  limit: number;
  /** The loaded runs, newest first. */
  runs: Run[];
  /** The runs after the query, the result filter, and the sorting. */
  visibleRuns: Run[];
  /** True when runs exist and none passes the query and the filter. */
  noMatch: boolean;
  /**
   * Matches the pull request number and the SHA. In `improved` mode it also
   * matches the title, the branch, the author, and the commit message.
   */
  query: string;
  /** The result filter. */
  filter: RunState | "all";
  sort: HistorySort;
  /** True when the query or the result filter is active. */
  filtered: boolean;
  /**
   * The number of runs for each result. Each count applies the query, so it
   * is the size of the list after a click on that result.
   */
  counts: Record<RunState | "all", number>;
  /** The results that the loaded runs have, in `runStateOrder`. */
  states: RunState[];
  setQuery(query: string): void;
  setFilter(filter: RunState | "all"): void;
  setSort(sort: HistorySort): void;
  /**
   * Sorts by a column. A second call with the same key turns the direction
   * around.
   */
  toggleSort(key: HistorySortKey): void;
  /** Clears the query and the result filter. The sorting stays. */
  resetFilters(): void;
}

export type History = HistoryLoading | HistoryError | HistoryLoaded;

interface HistoryState {
  scenario: string;
  query: string;
  filter: RunState | "all";
  sort: HistorySort;
}

function createState(scenario: string): HistoryState {
  // The search that a scenario starts with is the same in every data mode.
  const data = getHistoryData(scenario, "improved");
  // A scenario can start with a search, for example the one without a match.
  const ready = data.status === "ready";
  return {
    scenario,
    query: ready ? data.query : "",
    filter: ready ? data.filter : "all",
    sort: defaultHistorySort,
  };
}

const noRuns: Run[] = [];

function createCounts(): Record<RunState | "all", number> {
  return {
    all: 0,
    incomplete: 0,
    comparing: 0,
    "needs-review": 0,
    rejected: 0,
    passed: 0,
    failed: 0,
    superseded: 0,
    "needs-recompare": 0,
  };
}

/**
 * The state of the run history for one scenario: a text search, a result
 * filter, sorting, and the number of runs for each result.
 */
export function useHistory(scenario: string, { refreshLatency }: HistoryOptions = {}): History {
  const [state, setState] = useState(() => createState(scenario));
  if (state.scenario !== scenario) {
    setState(createState(scenario));
  }
  const refresh = useRefresh(scenario, refreshLatency);
  const mode = useDataMode();
  const data = getHistoryData(scenario, mode);
  const runs = data.status === "ready" ? data.runs : noRuns;
  const { query, filter, sort } = state;
  // The list has 100 rows. It is filtered and sorted again only when the
  // search, the filter, or the sorting changes.
  const { counts, visibleRuns, states } = useMemo(() => {
    const totals = createCounts();
    for (const run of filterRuns(runs, { query })) {
      totals.all += 1;
      totals[run.state] += 1;
    }
    return {
      counts: totals,
      visibleRuns: sortRuns(filterRuns(runs, { query, state: filter }), sort),
      states: runStateOrder.filter((entry) => runs.some((run) => run.state === entry)),
    };
  }, [runs, query, filter, sort]);
  if (data.status === "loading") return { status: "loading", scenario, ...refresh };
  if (data.status === "error") {
    const { message, reference } = data;
    return { status: "error", scenario, message, ...(reference ? { reference } : {}), ...refresh };
  }

  const update = (patch: Partial<HistoryState>) => {
    setState((current) => ({ ...current, ...patch }));
  };
  return {
    status: runs.length ? "ready" : "empty",
    scenario,
    ...refresh,
    repository: data.repository,
    user: data.user,
    limit: data.limit,
    runs,
    visibleRuns,
    noMatch: runs.length > 0 && !visibleRuns.length,
    query,
    filter,
    sort,
    filtered: query.trim() !== "" || filter !== "all",
    counts,
    states,
    setQuery: (next) => update({ query: next }),
    setFilter: (next) => update({ filter: next }),
    setSort: (next) => update({ sort: next }),
    toggleSort: (key) => {
      setState((current) => {
        const turned = current.sort.direction === "ascending" ? "descending" : "ascending";
        const direction = current.sort.key === key ? turned : firstDirections[key];
        return { ...current, sort: { key, direction } };
      });
    },
    resetFilters: () => update({ query: "", filter: "all" }),
  };
}
