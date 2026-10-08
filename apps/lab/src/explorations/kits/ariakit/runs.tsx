import { formatRelativeTime } from "../../../fixtures/index.ts";
import type { Run } from "../../../fixtures/index.ts";

export interface RunTarget {
  /** The page surface that shows the run. */
  to: "review" | "pull";
  scenario: string;
}

// The lab has one review scenario for each of these pull requests.
const reviewScenarios: Record<number, string> = {
  7749: "passed",
  7751: "changes",
  7752: "large",
  7753: "one-browser",
  7754: "problems",
  7755: "comparing",
  7756: "one-change",
};

/**
 * The lab page that a run opens. The lab has a review scenario for seven
 * runs. Every other run opens the scenario that is nearest to its state. Use
 * it for every link to a run, so that a click opens the run that the row
 * names.
 * @example
 * <Button render={<LabLink {...getRunTarget(run)} />}>…</Button>
 */
export function getRunTarget(run: Run): RunTarget {
  const { state, pullRequestNumber: number } = run;
  if (state === "superseded") {
    const open = run.closedState === "needs-review" || run.closedState === "rejected";
    return { to: "review", scenario: open ? "read-only" : "clean" };
  }
  if (state === "incomplete") return { to: "review", scenario: "comparing" };
  if (state === "comparing") return { to: "review", scenario: "comparing" };
  // The pull request page tells a failed capture. A main run has no such page.
  if (state === "failed" && number != null) return { to: "pull", scenario: "attempts" };
  if (state === "failed") return { to: "review", scenario: "problems" };
  if (state === "needs-recompare") return { to: "review", scenario: "clean" };
  const known =
    number != null && Object.hasOwn(reviewScenarios, number) ? reviewScenarios[number] : undefined;
  if (known) return { to: "review", scenario: known };
  return { to: "review", scenario: state === "passed" ? "passed" : "changes" };
}

/** `#7754` for a pull request run, and `main` for a run of the main branch. */
export function getRunNumber(run: Pick<Run, "pullRequestNumber">): string {
  return run.pullRequestNumber == null ? "main" : `#${run.pullRequestNumber}`;
}

/**
 * True when the API sent words for the run: the pull request title, or the
 * commit message of a main run. Without them, `getRunTitle` gives the kind.
 */
export function hasRunWords(run: Pick<Run, "title" | "commitMessage">): boolean {
  return (run.title ?? run.commitMessage) != null;
}

/** `12 min`, `3 h`, `2 d`: a relative time for a column, without `ago`. */
export function formatAge(timestamp: number): string {
  return formatRelativeTime(timestamp).replace(/ ago$/, "");
}
