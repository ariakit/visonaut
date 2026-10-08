// Deterministic text helpers. They never read the clock, the locale, or the
// time zone of the machine, so the server and the browser render the same
// text.

import { DAY, HOUR, MINUTE, NOW } from "./now.ts";
import type { ReviewVariant, RunKind, RunState } from "./types.ts";

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** For example `Oct 5`. The date is in UTC. */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${monthNames[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** For example `Oct 5, 15:18`. The time is in UTC. */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${formatDate(timestamp)}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** For example `now`, `12 min ago`, `3 h ago`, `2 d ago`, or `Sep 12`. */
export function formatRelativeTime(timestamp: number, now = NOW): string {
  const elapsed = now - timestamp;
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} d ago`;
  return formatDate(timestamp);
}

/** For example `48s`, `4m 12s`, or `1h 05m`. */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${pad(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

/** For example `412.6 MiB`. */
export function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/** A changed pixel ratio as a percentage, for example `0.05%` or `<0.01%`. */
export function formatRatio(ratio: number): string {
  const percent = ratio * 100;
  if (percent === 0) return "0%";
  if (percent < 0.01) return "<0.01%";
  if (percent < 10) return `${percent.toFixed(2)}%`;
  return `${Math.round(percent)}%`;
}

/** The first seven characters of a commit SHA. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

const runStateLabels: Record<RunState, string> = {
  incomplete: "Waiting for screenshots",
  comparing: "Comparing",
  "needs-review": "Needs review",
  rejected: "Changes rejected",
  passed: "Passed",
  failed: "Failed",
  superseded: "Replaced",
  "needs-recompare": "New capture needed",
};

/** A short label for a run state. A design can use its own words. */
export function runStateLabel(state: RunState): string {
  return runStateLabels[state];
}

const runKindLabels: Record<RunKind, string> = {
  main: "Main",
  pull_request: "Pull request",
  merge_group: "Merge queue",
};

export function runKindLabel(kind: RunKind): string {
  return runKindLabels[kind];
}

/** The status of one variant, in the words of the app today. */
export function variantStatusLabel(variant: Pick<ReviewVariant, "kind" | "verdict" | "source">) {
  if (variant.kind === "error") return "Comparison error";
  if (variant.kind === "pending") return "Comparing";
  if (variant.kind === "unchanged") return "Unchanged";
  if (variant.verdict === "rejected") return "Rejected";
  if (variant.verdict === "approved" && variant.source === "automatic") {
    return "Accepted automatically";
  }
  if (variant.verdict === "approved") return "Approved";
  return "Needs review";
}
