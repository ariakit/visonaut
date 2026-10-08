// Words and color roles for the states of the product. Everything here is a
// pure function or a plain record, so the server and the browser agree and
// every variant names a state in the same way.

import { DAY, NOW } from "../now.ts";
import { formatDate, runKindLabel } from "../format.ts";
import type { Run, RunKind, RunState, ServiceAlert, VariantKind } from "../types.ts";

export { formatRelativeTime, shortSha } from "../format.ts";

/**
 * The meaning of a color. For a layer prop, map `neutral` to the parent color:
 * `$layer={role === "neutral" ? true : role}`.
 */
export type ColorRole = "success" | "warning" | "danger" | "neutral";

export interface StateLabel {
  /** One or two words, for a badge or a dense row. */
  short: string;
  /** A plain phrase that needs no other context. */
  plain: string;
}

/** For example `1234567` gives `1,234,567`. It does not read the locale. */
function groupDigits(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * A number with digit groups and an optional noun. `formatCount(1234)` gives
 * `1,234`. `formatCount(1, "variant")` gives `1 variant` and
 * `formatCount(22, "variant")` gives `22 variants`. Pass the plural when it is
 * irregular: `formatCount(2, "match", "matches")`.
 */
export function formatCount(count: number, singular?: string, plural?: string): string {
  const number = groupDigits(count);
  if (!singular) return number;
  const noun = Math.round(count) === 1 ? singular : (plural ?? `${singular}s`);
  return `${number} ${noun}`;
}

export const runStateLabels: Record<RunState, StateLabel> = {
  incomplete: { short: "Capturing", plain: "Waiting for screenshots" },
  comparing: { short: "Comparing", plain: "Comparing images" },
  "needs-review": { short: "Review", plain: "Needs review" },
  rejected: { short: "Rejected", plain: "Changes rejected" },
  passed: { short: "Passed", plain: "Check passed" },
  failed: { short: "Failed", plain: "Capture or comparison failed" },
  superseded: { short: "Replaced", plain: "Replaced by a newer run" },
  "needs-recompare": { short: "Stale", plain: "New capture needed" },
};

export const runStateRoles: Record<RunState, ColorRole> = {
  incomplete: "neutral",
  comparing: "neutral",
  "needs-review": "warning",
  rejected: "danger",
  passed: "success",
  failed: "danger",
  superseded: "neutral",
  "needs-recompare": "danger",
};

/** The run states in the order that a filter or a legend lists them. */
export const runStateOrder: RunState[] = [
  "needs-review",
  "rejected",
  "failed",
  "needs-recompare",
  "comparing",
  "incomplete",
  "passed",
  "superseded",
];

export const runKindLabels: Record<RunKind, StateLabel> = {
  main: { short: "Main", plain: "Main branch" },
  pull_request: { short: "PR", plain: "Pull request" },
  merge_group: { short: "Queue", plain: "Merge queue" },
};

export const variantKindLabels: Record<VariantKind, StateLabel> = {
  changed: { short: "Changed", plain: "Changed screenshot" },
  added: { short: "New", plain: "New screenshot" },
  removed: { short: "Removed", plain: "Removed screenshot" },
  unchanged: { short: "Same", plain: "No visible change" },
  pending: { short: "Comparing", plain: "Comparison in progress" },
  error: { short: "Error", plain: "Comparison failed" },
};

/** The diff convention: new is green, removed is red, changed is amber. */
export const variantKindRoles: Record<VariantKind, ColorRole> = {
  changed: "warning",
  added: "success",
  removed: "danger",
  unchanged: "neutral",
  pending: "neutral",
  error: "danger",
};

/** The API today has no severity. An alert without one counts as a warning. */
export type AlertSeverity = NonNullable<ServiceAlert["severity"]>;

export const alertSeverityLabels: Record<AlertSeverity, StateLabel> = {
  critical: { short: "Critical", plain: "Blocks reviews or captures" },
  warning: { short: "Warning", plain: "Needs attention soon" },
};

export const alertSeverityRoles: Record<AlertSeverity, ColorRole> = {
  critical: "danger",
  warning: "warning",
};

/**
 * The line that names a run. A pull request run has its title in `decided`
 * and `improved` mode, and a main run has the first line of its commit message
 * in `improved` mode. A run with neither reads `Pull request` or `Main`, as in
 * production. Put the number before it: `#7754 · Pull request`.
 */
export function getRunTitle(run: Pick<Run, "title" | "commitMessage" | "kind">): string {
  return run.title ?? run.commitMessage ?? runKindLabel(run.kind);
}

/** Changed, added, and removed variants of a run. Null without counts. */
export function getRunChangeCount(run: Pick<Run, "counts">): number | null {
  if (!run.counts) return null;
  return run.counts.changed + run.counts.added + run.counts.removed;
}

export interface RunDayGroup {
  /** The UTC date, for example `2026-10-05`. */
  id: string;
  /** `Today`, `Yesterday`, or a date such as `Oct 3`. */
  label: string;
  runs: Run[];
}

/**
 * Splits runs by the UTC day of their creation and keeps their order. Use it
 * for date headings in a list that is sorted by time.
 */
export function groupRunsByDay(runs: Run[], now = NOW): RunDayGroup[] {
  const today = Math.floor(now / DAY);
  const groups: RunDayGroup[] = [];
  for (const run of runs) {
    const day = Math.floor(run.createdAt / DAY);
    const id = new Date(day * DAY).toISOString().slice(0, 10);
    let group = groups.at(-1);
    if (group?.id !== id) {
      const age = today - day;
      const label = age === 0 ? "Today" : age === 1 ? "Yesterday" : formatDate(run.createdAt);
      group = { id, label, runs: [] };
      groups.push(group);
    }
    group.runs.push(run);
  }
  return groups;
}

export interface RunPullGroup {
  /** `pull-7754` for a pull request. The run identifier for another run. */
  id: string;
  kind: Run["kind"];
  /** Present for the runs of a pull request. */
  pullRequestNumber?: number;
  /** The runs of the group, in the order of the list. */
  runs: Run[];
  /** The newest run of the group. */
  latest: Run;
  /** The number of distinct tested commits. */
  commits: number;
}

/**
 * Puts the runs of one pull request in one group. The group takes the place
 * of its first run in the list, and every other run is a group of its own. It
 * needs no API change, because each row has its pull request number. The
 * production history has 100 rows, and most of them are closed attempts of
 * about 30 pull requests.
 */
export function groupRunsByPullRequest(runs: Run[]): RunPullGroup[] {
  const groups: RunPullGroup[] = [];
  const byNumber = new Map<number, RunPullGroup>();
  const commits = new Map<RunPullGroup, Set<string>>();
  for (const run of runs) {
    const number = run.kind === "pull_request" ? run.pullRequestNumber : undefined;
    let group = number == null ? undefined : byNumber.get(number);
    if (!group) {
      group = {
        id: number == null ? run.id : `pull-${number}`,
        kind: run.kind,
        ...(number == null ? {} : { pullRequestNumber: number }),
        runs: [],
        latest: run,
        commits: 0,
      };
      groups.push(group);
      commits.set(group, new Set());
      if (number != null) {
        byNumber.set(number, group);
      }
    }
    group.runs.push(run);
    if (run.createdAt > group.latest.createdAt) {
      group.latest = run;
    }
    const shas = commits.get(group);
    shas?.add(run.testedSha);
    group.commits = shas?.size ?? 1;
  }
  return groups;
}
