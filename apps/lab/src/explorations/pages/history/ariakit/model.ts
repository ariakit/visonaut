// The pure model of the Folio run history: the result options, the fold of
// the earlier runs of a pull request, and the day groups. Nothing here reads
// the document or the time.

import { groupRunsByDay } from "../../../../fixtures/index.ts";
import type { Run } from "../../../../fixtures/index.ts";
import { getRunResultName, statusStyles } from "../../../kits/ariakit/status.tsx";
import type { StatusName } from "../../../kits/ariakit/status.tsx";

/** `newest` and `oldest` sort by time. `changes` puts the largest run first. */
export type LedgerSort = "newest" | "oldest" | "changes";

export const sortLabels: Record<LedgerSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  changes: "Most changes",
};

/** A status name, or `all` for no result filter. */
export type ResultFilter = StatusName | "all";

export const allResultsLabel = "All results";

// The results in the order of the select: what needs a person first.
const resultOrder: readonly StatusName[] = [
  "needs-review",
  "rejected",
  "failed",
  "rerun-needed",
  "comparing",
  "capturing",
  "passed",
  "replaced",
];

export interface ResultOption {
  value: ResultFilter;
  label: string;
  /** The number of runs behind the option. */
  count: number;
}

/**
 * The options of the result select for a list of runs, with their sizes. The
 * selected result stays an option when a search leaves it no run.
 */
export function getResultOptions(runs: readonly Run[], selected: ResultFilter): ResultOption[] {
  const counts = new Map<StatusName, number>();
  for (const run of runs) {
    const result = getRunResultName(run);
    counts.set(result, (counts.get(result) ?? 0) + 1);
  }
  const options: ResultOption[] = [{ value: "all", label: allResultsLabel, count: runs.length }];
  for (const result of resultOrder) {
    const count = counts.get(result) ?? 0;
    if (!count && result !== selected) continue;
    options.push({ value: result, label: statusStyles[result].label, count });
  }
  return options;
}

export interface LedgerRow {
  /** Stable for the pull request, or for the run of a row without a fold. */
  key: string;
  /** The run of the row: the newest run of its pull request in the list. */
  run: Run;
  /** The other runs of the pull request in the list, newest first. */
  earlier: Run[];
}

export interface LedgerDay {
  /** The UTC date, or `all` for a list without day labels. */
  id: string;
  /** `Today`, `Yesterday`, or a date. Null for a list without day labels. */
  label: string | null;
  rows: LedgerRow[];
}

function byNewest(first: Run, second: Run): number {
  return second.createdAt - first.createdAt;
}

/**
 * The rows of the history. With a time sort, the runs of one pull request are
 * one row: the newest run, with the other runs under it. The row has the
 * place of its newest run, and the days have labels. With another sort,
 * every run is a row of its own, because the fold would hide the run that
 * the sort asks for.
 */
export function buildLedger(runs: readonly Run[], sort: LedgerSort): LedgerDay[] {
  if (sort === "changes") {
    const rows = runs.map((run): LedgerRow => ({ key: run.id, run, earlier: [] }));
    return rows.length ? [{ id: "all", label: null, rows }] : [];
  }
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
  const rowsByRun = new Map(rows.map((row) => [row.run.id, row]));
  const days: LedgerDay[] = [];
  for (const day of groupRunsByDay(rows.map((row) => row.run))) {
    const dayRows: LedgerRow[] = [];
    for (const run of day.runs) {
      const row = rowsByRun.get(run.id);
      if (row) {
        dayRows.push(row);
      }
    }
    days.push({ id: day.id, label: day.label, rows: dayRows });
  }
  return days;
}
