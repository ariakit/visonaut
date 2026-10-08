// The `decided` data mode: the `today` record with the fields that the audit
// answers add. D-UX-04 adds the fields that the service already holds: the
// pull request title, the reason that a run closed and its last result, and
// the commit of a pull request. D-RUN-02 puts the counts in the first response
// of a run. Each result is cached for its source, so the same run is the same
// object on every page.

import type { DataMode, PullRequest, Run } from "../types.ts";
import { toTodayPull, toTodayRun, toTodayRuns } from "./today.ts";

const runs = new WeakMap<Run, Run>();

/** The row of `GET /api/runs` with the title and the two closed fields. */
export function toDecidedRun(run: Run): Run {
  let result = runs.get(run);
  if (!result) {
    const { title, closedReason, closedState } = run;
    result = {
      ...toTodayRun(run),
      ...(title == null ? {} : { title }),
      ...(closedReason == null ? {} : { closedReason }),
      ...(closedState == null ? {} : { closedState }),
    };
    runs.set(run, result);
  }
  return result;
}

const runLists = new WeakMap<Run[], Run[]>();

export function toDecidedRuns(list: Run[]): Run[] {
  let result = runLists.get(list);
  if (!result) {
    result = list.map(toDecidedRun);
    runLists.set(list, result);
  }
  return result;
}

/** The answer of `GET /api/pulls/:number` with the title and the commit. */
export function toDecidedPull(pull: PullRequest): PullRequest {
  const { title, headSha } = pull;
  return {
    ...toTodayPull(pull),
    ...(title == null ? {} : { title }),
    ...(headSha == null ? {} : { headSha }),
  };
}

/** Removes from `improved` runs the fields that a data mode does not have. */
export function toModeRuns(list: Run[], mode: DataMode): Run[] {
  if (mode === "improved") return list;
  if (mode === "decided") return toDecidedRuns(list);
  return toTodayRuns(list);
}

/** Removes from an `improved` pull request the fields that a data mode does not have. */
export function toModePull(pull: PullRequest, mode: DataMode): PullRequest {
  if (mode === "improved") return pull;
  if (mode === "decided") return toDecidedPull(pull);
  return toTodayPull(pull);
}

/**
 * The data mode of the screenshots and the variants of a run. The `decided`
 * mode adds no field to them, so it shares the objects of the `today` mode.
 */
export function getItemMode(mode: DataMode): "today" | "improved" {
  return mode === "improved" ? "improved" : "today";
}
