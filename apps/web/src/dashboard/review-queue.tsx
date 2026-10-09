import { Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  CheckCheckIcon,
  Clock3Icon,
  GitPullRequestIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type { DashboardRun } from "../api/dashboard.ts";
import { ButtonLabel, ButtonSlot } from "../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { ControlButton as Button } from "../components/control-button.tsx";
import {
  awaitsReview,
  isInProgress,
  kindLabels,
  needsRecovery,
  RunIdentity,
  RunStatus,
  stateLabels,
} from "./run-parts.tsx";

export interface ReviewQueueProps {
  runs: DashboardRun[];
  repository: string;
  baselineRevision: number;
  onRefresh(): void;
}

export function ReviewQueue({ runs, repository, baselineRevision, onRefresh }: ReviewQueueProps) {
  const inProgress = runs.filter(isInProgress);
  const recovery = runs.filter(needsRecovery);
  const review = runs.filter(awaitsReview);
  const pending = runs.reduce((total, run) => total + run.pending, 0);
  const rejected = runs.reduce((total, run) => total + run.rejected, 0);
  return (
    <>
      <div className="flex flex-wrap justify-between items-start gap-5">
        <div>
          <Text render={<p />} className="text-xs uppercase tracking-widest font-medium ak-ink-60">
            {repository}
          </Text>
          <Text render={<h1 />} className="text-3xl sm:text-4xl font-semibold tracking-tight mt-3">
            Your review queue.
          </Text>
          <Text render={<p />} className="text-sm leading-relaxed ak-ink-60 mt-3">
            {review.length
              ? `${review.length} run${review.length === 1 ? " is" : "s are"} ready for review.`
              : runs.length
                ? "Captures in progress and runs that need attention appear here."
                : "No runs need a decision or recovery."}
          </Text>
        </div>
        <Button $border onClick={onRefresh}>
          <ButtonSlot>
            <RotateCcwIcon />
          </ButtonSlot>
          <ButtonLabel>Refresh runs</ButtonLabel>
        </Button>
      </div>
      <div className="grid grid-cols-3 my-8 border-y border-(--ak-edge) py-5">
        {[
          [review.length, "Runs to review"],
          [pending, "Awaiting approval"],
          [rejected, "Rejected views"],
        ].map(([count, label], index) => (
          <div
            key={label}
            className={`min-w-0 px-2 sm:px-6 ${index ? "border-l border-(--ak-edge)" : "sm:pl-0"}`}
          >
            <Text className="block text-3xl font-medium tracking-tight tabular-nums">{count}</Text>
            <Text className="block text-xs ak-ink-60 mt-1">{label}</Text>
          </div>
        ))}
      </div>
      {review.length > 0 && (
        <section aria-labelledby="ready-heading">
          <Text
            render={<h2 id="ready-heading" />}
            className="text-xs uppercase tracking-widest font-semibold ak-ink-60 mb-4"
          >
            Ready to review
          </Text>
          <div className="grid gap-4">
            {review.map((run) => (
              <Frame
                key={run.id}
                $layer
                $lighten
                $border
                $rounded="2xl"
                $p={6}
                render={<article />}
                className="grid gap-5"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Frame $layer $darken={3} $rounded="lg" $p={2}>
                    <GitPullRequestIcon size={18} aria-hidden="true" />
                  </Frame>
                  <Text className="text-xs ak-ink-60">
                    {run.pullRequestNumber ? `#${run.pullRequestNumber}` : kindLabels[run.kind]}
                  </Text>
                  <RunStatus state={run.state} />
                </div>
                <div>
                  <Text
                    render={<h3 />}
                    className="text-xl sm:text-2xl font-semibold tracking-tight wrap-anywhere"
                  >
                    {run.title ?? kindLabels[run.kind]}
                  </Text>
                  <Text render={<p />} className="text-sm ak-ink-60 mt-3">
                    {run.pending} view{run.pending === 1 ? "" : "s"} await approval
                    {run.rejected ? `, including ${run.rejected} rejected.` : "."}
                  </Text>
                </div>
                <RunIdentity run={run} />
                <Button
                  $layer="brand"
                  className="justify-self-start"
                  render={<Link to="/runs/$runId" params={{ runId: run.id }} />}
                >
                  <ButtonLabel>Review changes</ButtonLabel>
                  <ButtonSlot>
                    <ArrowRightIcon />
                  </ButtonSlot>
                </Button>
              </Frame>
            ))}
          </div>
        </section>
      )}
      {!runs.length && (
        <Frame
          $layer
          $lighten
          $border
          $rounded="2xl"
          $p={8}
          className="grid justify-items-center text-center gap-3"
        >
          <Text $text="success" className="flex">
            <CheckCheckIcon size={32} aria-hidden="true" />
          </Text>
          <Text render={<h2 />} className="text-xl font-semibold">
            {baselineRevision ? "All reviews are complete." : "No captures yet."}
          </Text>
          <Text render={<p />} className="text-sm ak-ink-60 max-w-md">
            {baselineRevision
              ? "New visual changes will appear here."
              : "Run the visual test workflow to create your first baseline."}
          </Text>
        </Frame>
      )}
      {inProgress.length > 0 && <RunGroup title="In progress" runs={inProgress} />}
      {recovery.length > 0 && <RunGroup title="Needs attention" runs={recovery} />}
      <div className="flex flex-wrap items-center gap-3 mt-8 text-xs ak-ink-60">
        <ShieldCheckIcon size={15} aria-hidden="true" />
        <Text>
          {baselineRevision ? `Baseline revision ${baselineRevision}` : "No baseline yet"}
        </Text>
        <Button className="sm:ml-auto" render={<Link to="/history" />}>
          <ButtonLabel>View history</ButtonLabel>
          <ButtonSlot>
            <ArrowRightIcon />
          </ButtonSlot>
        </Button>
      </div>
    </>
  );
}

function RunGroup({ title, runs }: { title: string; runs: DashboardRun[] }) {
  return (
    <section className="mt-8" aria-label={title}>
      <Text
        render={<h2 />}
        className="text-xs uppercase tracking-widest font-semibold ak-ink-60 mb-4"
      >
        {title}
      </Text>
      <div className="grid gap-3">
        {runs.map((run) => (
          <Frame
            key={run.id}
            $layer
            $lighten
            $border
            $rounded="xl"
            $p={4}
            className="flex flex-wrap items-center gap-4"
          >
            <Frame $layer $darken={3} $rounded="lg" $p={2.5}>
              <Clock3Icon size={18} aria-hidden="true" />
            </Frame>
            <div className="flex-1 min-w-40">
              <Text render={<h3 />} className="text-sm font-semibold wrap-anywhere">
                {run.pullRequestNumber ? `#${run.pullRequestNumber} · ` : ""}
                {run.title ?? kindLabels[run.kind]}
              </Text>
              <Text render={<p />} className="text-xs ak-ink-60 mt-1">
                {stateLabels[run.state]} · Attempt {run.attempt}
              </Text>
            </div>
            <Button $border render={<Link to="/runs/$runId" params={{ runId: run.id }} />}>
              <ButtonLabel>Open run</ButtonLabel>
              <ButtonSlot>
                <ArrowRightIcon />
              </ButtonSlot>
            </Button>
          </Frame>
        ))}
      </div>
    </section>
  );
}
