import { useDataMode } from "../data-mode.ts";
import { getPullData } from "../data/pull.ts";
import type { PullRequest, Run, RunState, User } from "../types.ts";
import { runStateLabels, runStateRoles } from "./labels.ts";
import type { ColorRole, StateLabel } from "./labels.ts";
import { useRefresh } from "./use-refresh.ts";
import type { Refresh } from "./use-refresh.ts";

/**
 * The one state that a pull request page reports. It is the state of the
 * newest run. Without a run, it is the capture state of the head commit.
 *
 * - `waiting`: a capture is on its way.
 * - `capture-failed`: the capture did not arrive.
 * - `not-required`: the change needs no screenshots.
 */
export type PullOutcome = RunState | "waiting" | "capture-failed" | "not-required";

export const pullOutcomeLabels: Record<PullOutcome, StateLabel> = {
  ...runStateLabels,
  waiting: { short: "Waiting", plain: "Waiting for the capture" },
  "capture-failed": { short: "No capture", plain: "The capture did not arrive" },
  "not-required": { short: "Skipped", plain: "No screenshots needed" },
};

export const pullOutcomeRoles: Record<PullOutcome, ColorRole> = {
  ...runStateRoles,
  waiting: "neutral",
  "capture-failed": "danger",
  "not-required": "neutral",
};

/** The runs of one tested commit. A workflow retry adds an attempt. */
export interface PullCommit {
  /** The 40 character SHA of the tested commit. */
  sha: string;
  /** True for the current head commit of the pull request. */
  head: boolean;
  /** The runs of the commit, newest first. */
  attempts: Run[];
  /** The newest attempt. */
  latest: Run;
}

export interface PullOptions {
  /** Milliseconds of a refresh. Defaults to 700. */
  refreshLatency?: number;
}

interface PullBase extends Refresh {
  scenario: string;
}

export interface PullLoading extends PullBase {
  status: "loading";
}

export interface PullError extends PullBase {
  status: "error";
  message: string;
  reference?: string;
}

export interface PullReady extends PullBase {
  status: "ready";
  pull: PullRequest;
  user: User;
  outcome: PullOutcome;
  /**
   * Every run of the pull request, newest first. The pull request API does
   * not return them, today and in the decided API: they come from the run
   * list, which has the latest 100 runs.
   */
  runs: Run[];
  /** The runs by tested commit, newest commit first. */
  commits: PullCommit[];
  /** The newest run, or null without a run. */
  latestRun: Run | null;
  /**
   * The newest run that takes decisions now: its state is `needs-review` or
   * `rejected`. Null when no run waits for a person.
   */
  reviewRun: Run | null;
  /** Every run but the newest: earlier attempts and earlier commits. */
  earlierRuns: Run[];
}

export type Pull = PullLoading | PullError | PullReady;

function getOutcome(pull: PullRequest, latestRun: Run | null): PullOutcome {
  if (latestRun) return latestRun.state;
  if (pull.capture === "failed") return "capture-failed";
  if (pull.capture === "not-required") return "not-required";
  return "waiting";
}

function groupByCommit(runs: Run[], headSha: string | undefined): PullCommit[] {
  const commits: PullCommit[] = [];
  for (const run of runs) {
    const commit = commits.find((entry) => entry.sha === run.testedSha);
    if (commit) {
      commit.attempts.push(run);
      continue;
    }
    commits.push({
      sha: run.testedSha,
      head: run.testedSha === headSha,
      attempts: [run],
      latest: run,
    });
  }
  return commits;
}

/**
 * The state of the pull request page for one scenario: the pull request, its
 * runs by commit and attempt, and the newest run to review.
 */
export function usePull(scenario: string, { refreshLatency }: PullOptions = {}): Pull {
  const refresh = useRefresh(scenario, refreshLatency);
  const mode = useDataMode();
  const data = getPullData(scenario, mode);
  if (data.status === "loading") return { status: "loading", scenario, ...refresh };
  if (data.status === "error") {
    const { message, reference } = data;
    return { status: "error", scenario, message, ...(reference ? { reference } : {}), ...refresh };
  }
  const { pull, runs, user } = data;
  const latestRun = runs[0] ?? null;
  const reviewRun =
    runs.find((run) => run.state === "needs-review" || run.state === "rejected") ?? null;
  // The API today does not send the head commit. The run that the pull
  // request points to is the run of its head commit.
  const headRun = runs.find((run) => run.id === pull.runId);
  const headSha = pull.headSha ?? headRun?.testedSha;
  return {
    status: "ready",
    scenario,
    ...refresh,
    pull,
    user,
    outcome: getOutcome(pull, latestRun),
    runs,
    commits: groupByCommit(runs, headSha),
    latestRun,
    reviewRun,
    earlierRuns: runs.slice(1),
  };
}
