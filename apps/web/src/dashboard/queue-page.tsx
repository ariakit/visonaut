import { Link as RouterLink } from "@tanstack/react-router";
import { cx } from "clava";
import { Check, ImagePlus } from "lucide-react";
import type { DashboardRun } from "../api/dashboard.ts";
import { Button, ButtonLabel } from "../components/ariakit/components/button.ariakit.react.tsx";
import { Link } from "../components/ariakit/components/link.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { formatCount } from "../components/kit/format.ts";
import { RunRow, RunRowList, RunRowSkeleton } from "../components/kit/run-row.tsx";
import { getExternalLinkProps } from "../components/kit/shell.tsx";
import { EmptyState } from "../components/kit/surfaces.tsx";
import { tertiary } from "../components/kit/tokens.ts";
import type { DashboardShape } from "./dashboard-page.tsx";
import { NextRun, NextRunSkeleton } from "./next-run.tsx";
import { awaitsReview, isInProgress, needsRecovery } from "./run-groups.ts";

// The part of the README that says how a repository starts to capture.
const setupGuide = "https://github.com/ariakit/visonaut#capture-and-submit";

// The blocks of the page are six steps apart. A group label is two steps
// above its sheet, and it starts where the status discs of the rows start.
const pageStack = "grid min-w-0 gap-6";
const groupStack = "grid min-w-0 gap-2";

export interface QueueProps {
  /** Each run that needs a decision or attention, the newest first. */
  runs: DashboardRun[];
  /** The revision of the baseline. It is 0 before the first baseline. */
  baselineRevision: number;
  /** The repository as `owner/name`. */
  repository: string;
}

/**
 * The Queue: one card for the next run to review, then one row design for
 * each other run, in three groups by priority. The page has no toolbar and
 * binds no key.
 */
export function Queue({ runs, baselineRevision, repository }: QueueProps) {
  if (!runs.length && !baselineRevision) {
    return (
      <EmptyState
        icon={ImagePlus}
        title="No baseline yet"
        action={<Link {...getExternalLinkProps(setupGuide)}>Setup guide</Link>}
      >
        The first full run on main creates it
      </EmptyState>
    );
  }
  if (!runs.length) {
    return (
      <EmptyState
        icon={Check}
        tone="success"
        title="All reviewed"
        action={
          <Button $lightnessOffset render={<RouterLink to="/history" />}>
            <ButtonLabel>Open History</ButtonLabel>
          </Button>
        }
      >
        {`Baseline ${formatCount(baselineRevision)}`}
      </EmptyState>
    );
  }
  // The card of the next run to review, the other runs to review without a
  // label, then the runs that take no decision now.
  const [next, ...others] = runs.filter(awaitsReview);
  const running = runs.filter(isInProgress);
  const attention = runs.filter(needsRecovery);
  return (
    <div className={pageStack}>
      {next && <NextRun run={next} repository={repository} />}
      {others.length > 0 && <RunGroup name="Runs to review" runs={others} />}
      {running.length > 0 && <RunGroup label="Running" runs={running} />}
      {attention.length > 0 && <RunGroup label="Needs attention" runs={attention} />}
    </div>
  );
}

/** The name and the shape of the Queue while it has no run list. */
export const queueShape: DashboardShape = {
  heading: "Queue",
  shape: (still) => {
    if (still) {
      return <RunRowSkeleton count={3} still />;
    }
    return (
      <>
        <NextRunSkeleton />
        <RunRowSkeleton count={3} />
      </>
    );
  },
};

interface RunGroupProps {
  /** The visible label above the sheet. */
  label?: string;
  /** The name of a group that has no visible label. */
  name?: string;
  runs: readonly DashboardRun[];
}

function RunGroup({ label, name, runs }: RunGroupProps) {
  const list = (
    <RunRowList aria-label={label ?? name}>
      {runs.map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </RunRowList>
  );
  if (!label) {
    return list;
  }
  return (
    <div className={groupStack}>
      {/* The page has a hidden `h1`. A `Heading` has full ink and a weight
          of its own, and a label is plain soft text. */}
      <Text render={<h2 />} className={cx(tertiary, "px-5")}>
        {label}
      </Text>
      {list}
    </div>
  );
}
