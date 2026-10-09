// The pure model of History: the search, the result options, the fold of the
// earlier runs of a pull request, and the day groups. A day is a day of the
// clock of the machine, so only the browser builds the ledger.

import type { RunReviewState } from "@visonaut/protocol";
import type { DashboardRun } from "../api/dashboard.ts";
import { formatDate } from "../components/kit/format.ts";
import { runKindWords } from "../components/kit/run-row.tsx";
import { getRunResultName, getRunStatusName, statusStyles } from "../components/kit/status.tsx";
import type { HistorySort } from "./history-search.ts";

/** The largest number of runs that `GET /api/runs` sends for History. */
export const historyLimit = 100;

export const sortLabels: Record<HistorySort, string> = {
  newest: "Newest",
  oldest: "Oldest",
};

export const sorts: readonly HistorySort[] = ["newest", "oldest"];

/** A run state as the result filter, or `all` for no filter. */
export type ResultFilter = RunReviewState | "all";

export const allResultsLabel = "All results";

// The results in the order of the select: what needs a person first.
const resultOrder: readonly RunReviewState[] = [
  "needs-review",
  "rejected",
  "failed",
  "needs-recompare",
  "comparing",
  "incomplete",
  "passed",
  "superseded",
];

/**
 * True when the result of the run is the state. A closed run has its last
 * result, so a run that passed before it closed is a passed run here.
 */
export function hasResult(run: DashboardRun, state: RunReviewState) {
  return getRunResultName(run) === getRunStatusName(state);
}

/** The runs whose title, number, commit, or kind has the text. */
export function searchRuns(runs: readonly DashboardRun[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...runs];
  }
  return runs.filter((run) => {
    const number = run.pullRequestNumber == null ? "" : `#${run.pullRequestNumber}`;
    const haystack = `${run.title ?? ""} ${number} ${run.testedSha} ${runKindWords[run.kind]}`;
    return haystack.toLowerCase().includes(needle);
  });
}

export interface ResultOption {
  value: ResultFilter;
  label: string;
  /** The number of runs behind the option. */
  count: number;
}

/**
 * The options of the result select for a list of runs, with their sizes. The
 * selected result stays an option when no run has it.
 */
export function getResultOptions(
  runs: readonly DashboardRun[],
  selected: ResultFilter,
): ResultOption[] {
  const options: ResultOption[] = [{ value: "all", label: allResultsLabel, count: runs.length }];
  for (const state of resultOrder) {
    const count = runs.filter((run) => hasResult(run, state)).length;
    if (!count && state !== selected) continue;
    options.push({ value: state, label: statusStyles[getRunStatusName(state)].label, count });
  }
  return options;
}

export interface LedgerRow {
  /** Stable for the pull request, or for the run of a row without a fold. */
  key: string;
  /** The run of the row: the newest run of its pull request in the list. */
  run: DashboardRun;
  /** The other runs of the pull request in the list, newest first. */
  earlier: DashboardRun[];
}

export interface LedgerDay {
  /** The date of the day, for example `2026-10-05`. */
  id: string;
  /** `Today`, `Yesterday`, or a date. */
  label: string;
  rows: LedgerRow[];
}

function byNewest(first: DashboardRun, second: DashboardRun) {
  return second.createdAt - first.createdAt;
}

// The start of the day of a time, on the clock of the machine.
function dayStart(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayLabel(start: number, now: number) {
  const today = dayStart(now);
  if (start === today) return "Today";
  // A day can have 23 or 25 hours, so the day before is the day of noon less 24 hours.
  if (start === dayStart(today - 12 * 60 * 60 * 1000)) return "Yesterday";
  return formatDate(start, now);
}

/**
 * The rows of History by day. The runs of one pull request are one row: the
 * newest run, with the other runs under it. The row has the place of its
 * newest run.
 */
export function buildLedger(
  runs: readonly DashboardRun[],
  sort: HistorySort,
  now = Date.now(),
): LedgerDay[] {
  const byPull = new Map<number, LedgerRow>();
  const rows: LedgerRow[] = [];
  for (const run of runs.toSorted(byNewest)) {
    const number = run.kind === "pull_request" ? run.pullRequestNumber : undefined;
    const row = number == null ? undefined : byPull.get(number);
    if (row) {
      row.earlier.push(run);
      continue;
    }
    const next: LedgerRow = { key: number == null ? run.id : `pull-${number}`, run, earlier: [] };
    rows.push(next);
    if (number != null) {
      byPull.set(number, next);
    }
  }
  if (sort === "oldest") {
    rows.reverse();
  }
  const days: LedgerDay[] = [];
  for (const row of rows) {
    const start = dayStart(row.run.createdAt);
    const id = new Date(start).toLocaleDateString("en-CA");
    let day = days.at(-1);
    if (day?.id !== id) {
      day = { id, label: dayLabel(start, now), rows: [] };
      days.push(day);
    }
    day.rows.push(row);
  }
  return days;
}
