import type { DataMode, HistoryData, Run, RunState } from "../types.ts";
import { memoize } from "./memoize.ts";
import { currentUser, repository } from "./people.ts";
import { getRunList, runListLimit } from "./runs.ts";
import { toTodayUser } from "./today.ts";

export type HistoryScenario = "full" | "no-match" | "empty" | "loading" | "error";

export interface RunFilter {
  /**
   * Matches the pull request number and the SHA. In `improved` mode it also
   * matches the title, the branch, the author, and the commit message.
   */
  query?: string;
  state?: RunState | "all";
}

/** Filters loaded runs in the browser, as the history page does today. */
export function filterRuns(runs: Run[], { query = "", state = "all" }: RunFilter): Run[] {
  const needle = query.trim().toLowerCase();
  return runs.filter((run) => {
    if (state !== "all" && run.state !== state) return false;
    if (!needle) return true;
    const haystack = [
      run.title,
      run.pullRequestNumber == null ? undefined : `#${run.pullRequestNumber}`,
      run.testedSha,
      run.branch,
      run.author?.login,
      run.commitMessage,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

function build(scenario: string, mode: DataMode): HistoryData {
  if (scenario === "loading") return { status: "loading" };
  if (scenario === "error") {
    return { status: "error", message: "The run list is temporarily unavailable. Please retry." };
  }
  const user = mode === "improved" ? currentUser : toTodayUser(currentUser);
  const ready = { status: "ready", repository, limit: runListLimit, user } as const;
  if (scenario === "empty") {
    return { ...ready, runs: [], query: "", filter: "all", visibleRuns: [] };
  }
  const runs = getRunList(mode);
  if (scenario === "no-match") {
    const query = "datepicker";
    return { ...ready, runs, query, filter: "all", visibleRuns: filterRuns(runs, { query }) };
  }
  return { ...ready, runs, query: "", filter: "all", visibleRuns: runs };
}

const cached = memoize(build);

/**
 * Returns the run history data of a scenario in one data mode. An unknown
 * scenario gives the full history. The same arguments return the same object.
 * In a component, call `useHistoryData(scenario)`: it follows the Data control.
 */
export function getHistoryData(
  scenario: HistoryScenario | (string & {}),
  mode: DataMode,
): HistoryData {
  return cached(scenario, mode);
}
