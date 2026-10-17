// The stage of the review page: the images of the selected variant on one
// stage, with the state of the images in the status row of the stage. The
// frame gives it the run, the variant, and the state of the comparison, and
// it reads the keys of the views from `useStageHost`.

import { useEffect, useEffectEvent } from "react";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Hourglass, TriangleAlert } from "lucide-react";
import { canShowMode } from "../components/kit/bar/view-controls.tsx";
import { ErrorBand, ErrorBandButton } from "../components/kit/error-band.tsx";
import { formatCount, formatRatio } from "../components/kit/format.ts";
import { getChipState, StateChip, useLateLoad } from "../components/kit/stage/chip.tsx";
import { ReviewStage } from "../components/kit/stage/stage.tsx";
import { formatSize } from "../components/kit/stage/geometry.ts";
import { getStageSubject } from "../components/kit/stage/model.ts";
import { useStageView } from "../components/kit/stage/view.ts";
import type { StageEngine } from "../components/kit/stage/view.ts";
import { useStoredView } from "../components/kit/view-store.ts";
import type { StoredView, ViewMode } from "../components/kit/view-types.ts";
import type { ReviewModel, ReviewVariant } from "./model.ts";
import { getClosedWords } from "./run-words.ts";
import { noImageBytes, useEvidence } from "./use-evidence.ts";

export interface UseStageHostParams {
  model: ReviewModel;
  /** The variant on the stage. */
  variant: ReviewVariant | undefined;
  /** A new number loads the images again. */
  retry: number;
  /** Gives a new `retry`, as Retry images does. */
  onRetry(): void;
}

export interface StageHostState {
  /** The mode and the mask switch, which the browser remembers. */
  stored: StoredView;
  /** The view on the stage: the mode on screen, the zoom, and the place. */
  view: StageEngine;
  evidence: ReturnType<typeof useEvidence>;
  /** True when each image of the stage passed its checks. A decision waits for it. */
  ready: boolean;
  /** The keys of the stage: a lowercase key gives its action. */
  keys: Partial<Record<string, () => void>>;
}

/**
 * The state of the stage: the stored view, the view on screen, and the
 * images. The frame calls it once, gives the result to `StageHost`, and sends
 * the keys of `keys`. F shows the current image, G the baseline in the same
 * place, S the two panes, W the swipe, O the overlay, and D turns the mask
 * off and on. No held key shows the baseline. When the browser is online
 * again, an image that failed to load loads again.
 * @example
 * const stage = useStageHost({ model, variant, retry, onRetry });
 * <StageHost stage={stage} model={model} variant={variant} … />
 */
export function useStageHost({
  model,
  variant,
  retry,
  onRetry,
}: UseStageHostParams): StageHostState {
  const stored = useStoredView();
  const summary = model.evidenceState === "summary";
  const view = useStageView({ variant, mode: stored.mode, expired: summary });
  const evidence = useEvidence({
    comparisonId: model.comparisonId,
    variant: summary ? undefined : variant,
    retry,
  });
  // A connection that comes back cannot fix bytes that do not decode, so
  // only a failed load starts a new request.
  const failedLoad = evidence.failure === "load";
  const onOnline = useEffectEvent(onRetry);
  useEffect(() => {
    if (!failedLoad) return;
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [failedLoad]);
  // A key for a mode that the images cannot show does nothing, as its
  // disabled button does, so the stored mode stays for the next variant.
  const setMode = (mode: ViewMode) => {
    if (!canShowMode(mode, view.subject)) return;
    stored.setMode(mode);
  };
  return {
    stored,
    view,
    evidence,
    ready: evidence.status === "ready",
    keys: {
      f: () => setMode("new"),
      g: () => setMode("original"),
      s: () => setMode("side"),
      w: () => setMode("swipe"),
      o: () => setMode("overlay"),
      // A variant with no mask keeps the switch, as its disabled button does.
      d: () => {
        if (!view.subject.mask) return;
        stored.setMask(!stored.mask);
      },
    },
  };
}

export interface StageHostProps {
  stage: StageHostState;
  model: ReviewModel;
  variant: ReviewVariant;
  /** The comparison stopped: it failed, it is out of date, or the run closed. */
  terminal: boolean;
  /** A command is being saved. */
  busy: boolean;
  onRetryImages(): void;
}

function terminalTitle(model: ReviewModel) {
  const closed = getClosedWords(model.run);
  if (closed) return closed;
  if (model.run.status === "needs-recompare") return "Comparison needs fresh Submit";
  return "Comparison failed";
}

function terminalMessage(model: ReviewModel) {
  if (getClosedWords(model.run)) return "This run is closed. Its evidence cannot be reviewed.";
  switch (model.run.status) {
    case "needs-recompare":
      return "This comparison is out of date. Run the trusted workflow again to submit a fresh comparison.";
    case "failed":
      return "This capture or comparison failed. Its evidence cannot be reviewed.";
    default:
      return "This comparison was invalidated. Its evidence cannot be reviewed.";
  }
}

/**
 * The line of the pixel counts of a variant, or null without one. Only two
 * images of one size have a count: a size change says the two sizes, and an
 * added or a removed variant has no line.
 * @example
 * getPixelLine(variant) // "0.05% changed · 120 changed pixels"
 */
export function getPixelLine(variant: ReviewVariant) {
  const { reference, candidate, changedPixels, ratio } = variant;
  if (!reference || !candidate) return null;
  const resize = getStageSubject(variant).resize;
  if (resize) return `Size changed · ${formatSize(resize.from)} → ${formatSize(resize.to)}`;
  if (changedPixels == null) return null;
  const count = formatCount(changedPixels, "changed pixel");
  if (ratio == null) return count;
  return `${formatRatio(ratio)} changed · ${count}`;
}

interface StageProblemProps {
  stage: StageHostState;
  model: ReviewModel;
  variant: ReviewVariant;
  terminal: boolean;
  busy: boolean;
  onRetryImages(): void;
}

/**
 * The error of the stage, for its status row: a stopped comparison, missing
 * or expired evidence, or an image that failed its checks. A failed load and
 * bytes that do not decode have Retry images.
 */
function StageProblem({ stage, model, variant, terminal, busy, onRetryImages }: StageProblemProps) {
  const { evidence } = stage;
  const expired = !terminal && evidence.failure === "expired";
  const retryImages = !terminal && (evidence.failure === "load" || evidence.failure === "decode");
  let title = "Comparison evidence incomplete";
  if (terminal) {
    title = terminalTitle(model);
  } else if (expired) {
    title = "Image history expired";
  } else if (retryImages) {
    title = "Image evidence unavailable";
  }
  return (
    <ErrorBand
      tone={terminal || expired ? "neutral" : "danger"}
      icon={expired ? Hourglass : TriangleAlert}
      role={terminal || expired ? "status" : "alert"}
      title={title}
      detail={
        terminal ? (
          <>
            {terminalMessage(model)}
            {variant.error && ` ${variant.error}`}
          </>
        ) : (
          evidence.error
        )
      }
      action={
        retryImages && (
          <ErrorBandButton disabled={busy} onClick={onRetryImages}>
            Retry images
          </ErrorBandButton>
        )
      }
      // The band has a container query, so it needs a width of its own.
      className="w-160 max-w-full"
    />
  );
}

/**
 * The stage: the read-only reason, and the images with their state in the
 * status row of the stage. The decision bar has the view and zoom controls.
 * A closed review with no image bytes shows a summary.
 */
export function StageHost({
  stage,
  model,
  variant,
  terminal,
  busy,
  onRetryImages,
}: StageHostProps) {
  const { evidence, view, stored } = stage;
  const loading = evidence.status === "loading" && !terminal;
  const late = useLateLoad(loading && variant.kind !== "pending", evidence.identity);
  let status = <StateChip state={getChipState(view.subject, late)} />;
  if (terminal || evidence.status === "error") {
    status = (
      <StageProblem
        stage={stage}
        model={model}
        variant={variant}
        terminal={terminal}
        busy={busy}
        onRetryImages={onRetryImages}
      />
    );
  } else if (variant.kind === "pending") {
    status = <StateChip state={{ kind: "comparing" }} />;
  }
  return (
    <section aria-label="Selected variant" tabIndex={-1} className="flex min-h-0 flex-1 flex-col">
      {!model.archived && (variant.approveDisabledReason || variant.rejectDisabledReason) && (
        <p className="text-xs ak-ink-60 px-3 py-2">
          {variant.rejectDisabledReason ?? variant.approveDisabledReason}
        </p>
      )}
      {model.evidenceState === "summary" ? (
        <Frame $p={4} $layer $border>
          <h3 className="text-sm font-semibold">
            {model.imagesExpired ? "Image history expired" : "Closed review summary"}
          </h3>
          <p className="text-sm ak-ink-60 mt-2">{noImageBytes}</p>
        </Frame>
      ) : (
        <>
          <div
            className="review-evidence grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]"
            data-evidence={terminal ? "terminal" : evidence.status}
          >
            <ReviewStage
              view={view}
              name={variant.label}
              mask={stored.mask}
              images={evidence.images}
              requestKey={evidence.identity}
              onReport={evidence.report}
              status={status}
              aria-busy={evidence.status === "loading" || undefined}
              className="min-h-80"
            />
          </div>
        </>
      )}
    </section>
  );
}
