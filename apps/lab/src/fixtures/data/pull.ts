import { ago } from "../now.ts";
import { hex } from "../random.ts";
import type { DataMode, PullCaptureState, PullData, PullRequest, Run } from "../types.ts";
import { toModePull } from "./decided.ts";
import { memoize } from "./memoize.ts";
import { currentUser, repository } from "./people.ts";
import { pulls } from "./pulls.ts";
import type { PullSeed } from "./pulls.ts";
import { getPullRuns } from "./runs.ts";
import { toTodayUser } from "./today.ts";

export type PullScenario =
  | "attempts"
  | "single"
  | "no-runs"
  | "loading"
  // The scenarios below are extras. The catalog does not list them.
  | "waiting"
  | "capture-failed"
  | "error";

interface PullOptions {
  seed: PullSeed;
  capture: PullCaptureState;
  /** The newest run of the pull request, when it has one. */
  newest?: Run;
  createdAt: number;
  updatedAt: number;
  draft?: boolean;
}

/** A pull request with every `improved` field. */
function pullRequest({ seed, capture, newest, createdAt, updatedAt, draft = false }: PullOptions) {
  const pull: PullRequest = {
    number: seed.number,
    repository,
    capture,
    runId: capture === "ready" && newest ? newest.id : null,
    title: seed.title,
    author: seed.author,
    branch: seed.branch,
    baseBranch: "main",
    state: "open",
    draft,
    headSha: newest?.testedSha ?? hex(`sha:pull:${seed.number}`, 40),
    createdAt,
    updatedAt,
  };
  return pull;
}

function build(scenario: string, mode: DataMode): PullData {
  if (scenario === "loading") return { status: "loading" };
  if (scenario === "error") {
    return {
      status: "error",
      message: "This Visonaut check was not found. Open the latest check on GitHub.",
    };
  }
  const user = mode === "improved" ? currentUser : toTodayUser(currentUser);
  const ready = (pull: PullRequest, runs: Run[]): PullData => {
    return { status: "ready", pull: toModePull(pull, mode), runs, user };
  };
  if (scenario === "single") {
    // One run, and every change of it is approved.
    const runs = getPullRuns(pulls.passed.number, mode);
    const pull = pullRequest({
      seed: pulls.passed,
      capture: "ready",
      newest: runs[0],
      createdAt: ago({ hours: 5 }),
      updatedAt: ago({ hours: 1, minutes: 37 }),
    });
    return ready(pull, runs);
  }
  if (scenario === "no-runs" || scenario === "waiting" || scenario === "capture-failed") {
    // A documentation change needs no capture. The extras cover the other
    // states without a run: a capture that is on its way, and one that failed.
    const capture: PullCaptureState =
      scenario === "waiting"
        ? "pending"
        : scenario === "capture-failed"
          ? "failed"
          : "not-required";
    const pull = pullRequest({
      seed: scenario === "no-runs" ? pulls.docs : pulls.waiting,
      capture,
      createdAt: ago({ hours: 1, minutes: 30 }),
      updatedAt: ago({ minutes: scenario === "waiting" ? 2 : 26 }),
      draft: scenario === "waiting",
    });
    return ready(pull, []);
  }
  // Three attempts of one commit, newest first. The newest one has a rejected
  // variant and 15 variants without a verdict. The service closed the two
  // earlier attempts when the next one started.
  const runs = getPullRuns(pulls.mixed.number, mode);
  const pull = pullRequest({
    seed: pulls.mixed,
    capture: "ready",
    newest: runs[0],
    createdAt: ago({ days: 2, hours: 4 }),
    updatedAt: ago({ minutes: 16 }),
  });
  return ready(pull, runs);
}

const cached = memoize(build);

/**
 * Returns the pull request data of a scenario in one data mode. An unknown
 * scenario gives the pull request with several attempts. The same arguments
 * return the same object. In a component, call `usePullData(scenario)`: it
 * follows the Data control.
 */
export function getPullData(scenario: PullScenario | (string & {}), mode: DataMode): PullData {
  return cached(scenario, mode);
}
