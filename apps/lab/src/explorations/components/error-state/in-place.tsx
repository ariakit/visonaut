// The failures that a page scenario does not show, each as the kit
// `ErrorBand` over the region that failed. The region keeps the box that it
// has with content: the run rows, the image well, or the panes of a run.

import { cx } from "clava";
import { ArrowUpRight } from "lucide-react";
import { useId } from "react";
import { Text } from "../../../components/ariakit/components/text.ariakit.react.tsx";
import type { ImageSize } from "../../../fixtures/index.ts";
import type { VariantProps } from "../../../lab/types.ts";
import { ErrorBand, ErrorBandButton } from "../../kits/ariakit/error-band.tsx";
import { RunRow, RunRowList, RunRowSkeleton } from "../../kits/ariakit/run-row.tsx";
import { getExternalLinkProps } from "../../kits/ariakit/shell.tsx";
import { StatusPill } from "../../kits/ariakit/status.tsx";
import { Sheet, Well } from "../../kits/ariakit/surfaces.tsx";
import { pageRoot, tertiary } from "../../kits/ariakit/tokens.ts";
import { busyPulse, Count, DecisionButtons, ImageBox } from "./parts/pieces.tsx";
import {
  getAnnouncement,
  getBandDetail,
  useErrorState,
  useExpiredSubject,
  useFailedRunHref,
  useImageSubject,
  useQueueRuns,
} from "./parts/use-error-state.ts";
import type { ErrorState } from "./parts/use-error-state.ts";

interface BandActionProps {
  state: ErrorState;
}

function BandAction({ state }: BandActionProps) {
  const workflowHref = useFailedRunHref();
  const { action } = state.copy;
  if (!action) return null;
  if (action.kind === "workflow") {
    return (
      <ErrorBandButton
        icon={<ArrowUpRight />}
        render={<a {...getExternalLinkProps(workflowHref)} />}
      >
        {action.label}
      </ErrorBandButton>
    );
  }
  return (
    <ErrorBandButton busy={state.busy} onClick={state.act}>
      {action.label}
      <Count state={state} />
    </ErrorBandButton>
  );
}

interface BandProps {
  state: ErrorState;
  /** The identifier of the title, for a control that the error turns off. */
  titleId: string;
  /** Lays the band flush on the top edge of the frame around it. */
  cover?: boolean;
}

function Band({ state, titleId, cover }: BandProps) {
  const { copy } = state;
  return (
    <ErrorBand
      tone={copy.tone}
      icon={copy.icon}
      title={copy.title}
      detail={getBandDetail(state)}
      narrowDetail={copy.narrowDetail}
      errorId={state.errorId}
      role={copy.role}
      titleId={titleId}
      // The seconds change. A screen reader gets the title, one time.
      detailHidden={state.scenario === "unavailable"}
      announcement={getAnnouncement(state)}
      action={copy.action ? <BandAction state={state} /> : undefined}
      cover={cover}
    />
  );
}

interface PanesProps {
  size: ImageSize;
  /** Names the two panes. Without it, the panes are a still shape only. */
  captions?: boolean;
}

// The two image wells of a run, with the ratio of their images and no picture.
function Panes({ size, captions }: PanesProps) {
  return (
    <Sheet $p={2} aria-hidden={!captions || undefined} className="grid grid-cols-2 gap-2">
      {["Baseline", "Current"].map((label) => (
        <div key={label} className="grid grid-cols-1 gap-1.5">
          {captions && <Text className={cx(tertiary, "text-xs")}>{label}</Text>}
          <ImageBox size={size} $lightnessOffset={captions ? 1 : 2} />
        </div>
      ))}
    </Sheet>
  );
}

function FailedImage({ state, titleId }: BandProps) {
  const subject = useImageSubject();
  return (
    <div className="grid grid-cols-1 gap-2">
      {/* The well keeps its size. The band lies on its top edge. */}
      <Well $p={2} className="grid grid-cols-1 overflow-clip">
        <Band state={state} titleId={titleId} cover />
        <div className="grid justify-items-center px-2 py-6">
          <ImageBox size={subject.size} className={cx(state.busy && busyPulse)} />
        </div>
      </Well>
      <DecisionButtons describedBy={titleId} />
    </div>
  );
}

function ExpiredImages({ state, titleId }: BandProps) {
  const subject = useExpiredSubject();
  return (
    <div className="grid grid-cols-1 gap-2">
      <Band state={state} titleId={titleId} />
      <Panes size={subject.size} captions />
      {/* The decision stays where the decision buttons were. */}
      {subject.verdict && (
        <div className="flex justify-end">
          <StatusPill status={subject.verdict} />
        </div>
      )}
    </div>
  );
}

interface QueueRegionProps extends BandProps {
  /** The rows that loaded earlier stay. Without it, nothing ever loaded. */
  loaded?: boolean;
  /** Draws the rows in soft ink: they are out of date. */
  soft?: boolean;
}

function QueueRegion({ state, titleId, loaded, soft }: QueueRegionProps) {
  const runs = useQueueRuns();
  return (
    <div className="grid grid-cols-1 gap-2">
      <Band state={state} titleId={titleId} />
      {loaded ? (
        // The rows that were on screen before the failure stay links.
        <RunRowList aria-label="Queue">
          {runs.map((run) => (
            <RunRow key={run.id} run={run} soft={soft} />
          ))}
        </RunRowList>
      ) : (
        // Nothing loads while the error shows, so the shape pulses only
        // while a retry runs.
        <RunRowSkeleton still={!state.busy} />
      )}
    </div>
  );
}

function FailedRun({ state, titleId }: BandProps) {
  const subject = useImageSubject();
  return (
    <div className="grid grid-cols-1 gap-2">
      <Band state={state} titleId={titleId} />
      <Panes size={subject.size} />
    </div>
  );
}

export default function InPlace({ scenario }: VariantProps) {
  const state = useErrorState(scenario);
  const titleId = useId();
  const props = { state, titleId };
  return (
    <div className={cx(pageRoot, "isolate w-90 max-w-full")}>
      {state.scenario === "unavailable" && <QueueRegion {...props} />}
      {state.scenario === "offline" && <QueueRegion {...props} />}
      {state.scenario === "stale-list" && <QueueRegion {...props} loaded soft />}
      {state.scenario === "out-of-date" && <QueueRegion {...props} loaded />}
      {state.scenario === "image" && <FailedImage {...props} />}
      {state.scenario === "images-expired" && <ExpiredImages {...props} />}
      {state.scenario === "run-failed" && <FailedRun {...props} />}
      {/* After a crash the page shell can be gone, so nothing is below. */}
      {state.scenario === "crash" && <Band {...props} />}
    </div>
  );
}
