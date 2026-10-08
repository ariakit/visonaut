import { cx } from "clava";
import { Check, CloudOff, ImagePlus } from "lucide-react";
import {
  Button,
  ButtonLabel,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { Link } from "../../../../components/ariakit/components/link.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import { useInbox } from "../../../../fixtures/hooks/index.ts";
import type { InboxError, InboxLoaded } from "../../../../fixtures/hooks/index.ts";
import { formatCount } from "../../../../fixtures/index.ts";
import type { Run } from "../../../../fixtures/index.ts";
import { LabLink } from "../../../../lab/navigation.tsx";
import type { VariantProps } from "../../../../lab/types.ts";
import { ErrorBand, ErrorBandButton } from "../../../kits/ariakit/error-band.tsx";
import { RunRow, RunRowList, RunRowSkeleton } from "../../../kits/ariakit/run-row.tsx";
import { FolioShell, getExternalLinkProps } from "../../../kits/ariakit/shell.tsx";
import { EmptyState } from "../../../kits/ariakit/surfaces.tsx";
import { tertiary } from "../../../kits/ariakit/tokens.ts";
import { NextRun, NextRunSkeleton } from "./next-run.tsx";

// The blocks of the page are six steps apart. A group label is two steps
// above its sheet, and it starts where the status discs of the rows start.
const pageStack = "grid min-w-0 gap-6";
const groupStack = "grid min-w-0 gap-2";

/**
 * The Queue: one card for the next run to review, then one row design for
 * every other run, in three groups. The page has no toolbar and binds no
 * key. It reads the list again on focus and on an interval.
 */
export function InboxPage({ scenario }: VariantProps) {
  const inbox = useInbox(scenario);
  // Before the list is here, the header keeps the last known counts.
  const loaded = inbox.status !== "loading" && inbox.status !== "error";
  const reviewCount = loaded ? inbox.counts.review : undefined;
  return (
    <FolioShell
      current="inbox"
      heading="Queue"
      title={reviewCount ? `(${reviewCount}) Queue` : "Queue"}
      user={loaded ? inbox.user : undefined}
      reviewCount={reviewCount}
      alertCount={loaded ? inbox.alertCount : undefined}
    >
      {inbox.status === "loading" && (
        <div aria-busy="true" aria-label="Loading runs" className={pageStack}>
          <NextRunSkeleton />
          <RunRowSkeleton count={3} />
        </div>
      )}
      {inbox.status === "error" && <QueueFailure inbox={inbox} />}
      {inbox.status === "first-use" && (
        <EmptyState
          icon={ImagePlus}
          title="No baseline yet"
          action={
            <Link {...getExternalLinkProps("https://github.com/ariakit/visonaut#setup")}>
              Setup guide
            </Link>
          }
        >
          The first full run on main creates it
        </EmptyState>
      )}
      {inbox.status === "empty" && (
        <EmptyState
          icon={Check}
          tone="success"
          title="All reviewed"
          action={
            <Button $lightnessOffset render={<LabLink to="history" scenario="full" />}>
              <ButtonLabel>Open History</ButtonLabel>
            </Button>
          }
        >
          {`Baseline ${formatCount(inbox.baseline.revision)}`}
        </EmptyState>
      )}
      {inbox.status === "ready" && <Queue inbox={inbox} />}
    </FolioShell>
  );
}

interface QueueFailureProps {
  inbox: InboxError;
}

// The list keeps its shape under the band: a still skeleton, because nothing
// loads while the error shows. The band has no sentence of the service: the
// title says what failed, and the sentence repeats it and the button.
function QueueFailure({ inbox }: QueueFailureProps) {
  return (
    <div className={groupStack}>
      <ErrorBand
        icon={CloudOff}
        title="Could not load runs"
        errorId={inbox.reference}
        action={
          <ErrorBandButton busy={inbox.refreshing} onClick={inbox.refresh}>
            Try again
          </ErrorBandButton>
        }
      />
      <RunRowSkeleton count={3} still />
    </div>
  );
}

interface QueueProps {
  inbox: InboxLoaded;
}

// The runs by priority: the card of the next run to review, the other runs
// to review without a label, then the runs that take no decision now.
function Queue({ inbox }: QueueProps) {
  const groups = new Map(inbox.groups.map((group) => [group.id, group.runs]));
  const [next, ...others] = groups.get("review") ?? [];
  const running = groups.get("progress") ?? [];
  const attention = groups.get("attention") ?? [];
  return (
    <div className={pageStack}>
      {next && <NextRun run={next} />}
      {others.length > 0 && <RunGroup name="Runs to review" runs={others} />}
      {running.length > 0 && <RunGroup label="Running" runs={running} />}
      {attention.length > 0 && <RunGroup label="Needs attention" runs={attention} />}
    </div>
  );
}

interface RunGroupProps {
  /** The visible label above the sheet. */
  label?: string;
  /** The name of a group that has no visible label. */
  name?: string;
  runs: readonly Run[];
}

function RunGroup({ label, name, runs }: RunGroupProps) {
  const list = (
    <RunRowList aria-label={label ?? name}>
      {runs.map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </RunRowList>
  );
  if (!label) return list;
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
