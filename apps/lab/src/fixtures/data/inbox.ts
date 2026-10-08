import { ago } from "../now.ts";
import { hex } from "../random.ts";
import { baselineRun } from "../real/census.ts";
import type { Baseline, DataMode, InboxData } from "../types.ts";
import { memoize } from "./memoize.ts";
import { currentUser, repository } from "./people.ts";
import { getActionableRuns, getQuietRunList, getRunList, getSingleRuns } from "./runs.ts";
import { toTodayBaseline, toTodayUser } from "./today.ts";

export type InboxScenario = "busy" | "single" | "empty" | "first-run" | "loading" | "error";

const baseline: Baseline = {
  revision: baselineRun.baselineRevision,
  snapshotId: "94b3b191-acf6-4029-8fbb-53c2b5e39366",
  promotionId: baselineRun.promotionId,
  updatedAt: ago({ hours: 3, minutes: 9 }),
  testedSha: hex("sha:baseline:412", 40),
  screenshots: 3832,
};

function build(scenario: string, mode: DataMode): InboxData {
  if (scenario === "loading") return { status: "loading" };
  if (scenario === "error") {
    return { status: "error", message: "The run list is temporarily unavailable. Please retry." };
  }
  const improved = mode === "improved";
  const user = improved ? currentUser : toTodayUser(currentUser);
  if (scenario === "first-run") {
    return {
      status: "ready",
      repository,
      baseline: { revision: 0, snapshotId: null, promotionId: null },
      runs: [],
      recentRuns: [],
      alertCount: 0,
      user,
    };
  }
  const ready = {
    status: "ready",
    repository,
    baseline: improved ? baseline : toTodayBaseline(baseline),
    user,
  } as const;
  const quiet = getQuietRunList(mode);
  if (scenario === "empty") {
    return { ...ready, runs: [], recentRuns: quiet, alertCount: 0 };
  }
  if (scenario === "single") {
    const runs = getSingleRuns(mode);
    return { ...ready, runs, recentRuns: [...runs, ...quiet], alertCount: 0 };
  }
  return { ...ready, runs: getActionableRuns(mode), recentRuns: getRunList(mode), alertCount: 3 };
}

const cached = memoize(build);

/**
 * Returns the inbox data of a scenario in one data mode. An unknown scenario
 * gives the busy inbox. The same arguments return the same object. In a
 * component, call `useInboxData(scenario)`: it follows the Data control.
 */
export function getInboxData(scenario: InboxScenario | (string & {}), mode: DataMode): InboxData {
  return cached(scenario, mode);
}
