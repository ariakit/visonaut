import { CheckCheckIcon, CircleAlertIcon, Clock3Icon, GitCommitHorizontalIcon } from "lucide-react";
import { runClosedReasonWords, runClosedWords, type RunReviewState } from "@visonaut/protocol";
import type { DashboardRun } from "../api/dashboard.ts";
import {
  Badge,
  BadgeLabel,
  BadgeSlot,
} from "../components/ariakit/components/badge.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";

export const kindLabels: Record<DashboardRun["kind"], string> = {
  main: "Main",
  pull_request: "Pull request",
  merge_group: "Merge queue",
};

// A closed run with no stored reason has words that name no cause.
export const stateLabels: Record<RunReviewState, string> = {
  "needs-recompare": "New capture needed",
  "needs-review": "Needs review",
  incomplete: "Waiting for screenshots",
  comparing: "Comparing images",
  passed: "Passed",
  rejected: "Changes rejected",
  failed: "Run failed",
  superseded: runClosedWords,
};

/** A run that closed for a stored reason shows that reason and no other cause. */
export function closedRunLabel(run: Pick<DashboardRun, "state" | "closedReason">) {
  if (run.closedReason) {
    return runClosedReasonWords[run.closedReason];
  }
  return stateLabels[run.state];
}

/** A run whose captures or comparison are in progress. */
export function isInProgress(run: Pick<DashboardRun, "state">) {
  return run.state === "comparing" || run.state === "incomplete";
}

/** A run that needs a new capture or a new CI run, not a decision. */
export function needsRecovery(run: Pick<DashboardRun, "state">) {
  return run.state === "needs-recompare" || run.state === "failed";
}

/**
 * A run of the Queue that waits for a decision. The Queue lists these runs
 * under "Ready to review", and the header has their number.
 */
export function awaitsReview(run: Pick<DashboardRun, "state">) {
  return !isInProgress(run) && !needsRecovery(run);
}

function stateColor(state: RunReviewState): "success" | "warning" | "danger" | undefined {
  if (state === "passed") return "success";
  if (state === "needs-review" || state === "comparing" || state === "incomplete") {
    return "warning";
  }
  if (state === "failed" || state === "rejected" || state === "needs-recompare") {
    return "danger";
  }
  return;
}

export function runDate(value: number) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export interface RunStatusProps {
  state: RunReviewState;
  label?: string;
}

export function RunStatus({ state, label = stateLabels[state] }: RunStatusProps) {
  const color = stateColor(state);
  const Icon =
    state === "passed" ? CheckCheckIcon : color === "danger" ? CircleAlertIcon : Clock3Icon;
  return (
    <Badge $layer={color ?? true} $rounded="full" className="max-w-full">
      <BadgeSlot>
        <Icon aria-hidden="true" />
      </BadgeSlot>
      <BadgeLabel className="whitespace-normal">{label}</BadgeLabel>
    </Badge>
  );
}

export function RunIdentity({ run }: { run: DashboardRun }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs ak-ink-60">
      <Text className="inline-flex items-center gap-1.5">
        <GitCommitHorizontalIcon size={14} aria-hidden="true" />
        <code title={run.testedSha}>{run.testedSha.slice(0, 12)}</code>
      </Text>
      <Text>Attempt {run.attempt}</Text>
      <Text render={<time />}>{runDate(run.createdAt)}</Text>
    </div>
  );
}
