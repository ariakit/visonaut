// The stage of the review page: the images of the selected variant on one
// stage. The frame gives it the run, the variant, and the state of the
// comparison, and it reads the keys of the views from `useStageHost`.

import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { ControlButton as Button } from "../components/control-button.tsx";
import { MaskToggle, ModeButtons } from "../components/kit/bar/view-controls.tsx";
import { ZoomControl } from "../components/kit/bar/zoom.tsx";
import { ReviewStage } from "../components/kit/stage/stage.tsx";
import { useStageView } from "../components/kit/stage/view.ts";
import type { StageEngine } from "../components/kit/stage/view.ts";
import { useStoredView } from "../components/kit/view-store.ts";
import type { StoredView } from "../components/kit/view-types.ts";
import type { ReviewModel, ReviewVariant } from "./model.ts";
import { getClosedWords } from "./run-words.ts";
import { noImageBytes, useEvidence } from "./use-evidence.ts";

export interface UseStageHostParams {
  model: ReviewModel;
  /** The variant on the stage. */
  variant: ReviewVariant | undefined;
  /** A new number loads the images again. */
  retry: number;
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
 * off and on. No held key shows the baseline.
 * @example
 * const stage = useStageHost({ model, variant, retry });
 * <StageHost stage={stage} model={model} variant={variant} … />
 */
export function useStageHost({ model, variant, retry }: UseStageHostParams): StageHostState {
  const stored = useStoredView();
  const summary = model.evidenceState === "summary";
  const view = useStageView({ variant, mode: stored.mode, expired: summary });
  const evidence = useEvidence({
    comparisonId: model.comparisonId,
    variant: summary ? undefined : variant,
    retry,
  });
  return {
    stored,
    view,
    evidence,
    ready: evidence.status === "ready",
    keys: {
      f: () => stored.setMode("new"),
      g: () => stored.setMode("original"),
      s: () => stored.setMode("side"),
      w: () => stored.setMode("swipe"),
      o: () => stored.setMode("overlay"),
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

// The one image of a variant that has no pair. Step 3 of #274 moves this
// fact into the stage.
function getSingleImageNote(variant: ReviewVariant) {
  if (variant.reference && variant.candidate) return;
  if (variant.candidateOmitted) return "Matched locally. The new image was not uploaded.";
  if (variant.candidate) return "New screenshot. It has no baseline.";
  if (variant.reference) return "Removed. It has no current image.";
}

/**
 * The stage: the read-only reason, the view and zoom controls, the state of
 * the images, and the images. A closed review with no image bytes shows a
 * summary.
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
  const retryImages = !terminal && (evidence.failure === "load" || evidence.failure === "decode");
  const note = getSingleImageNote(variant);
  return (
    <Frame
      $cover
      $border
      $borderType="border"
      $rounded="none"
      $orientation="vertical"
      $p={0}
      render={<section />}
      aria-label="Selected variant"
      tabIndex={-1}
    >
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
          {/* The floating bar of #275 takes these controls. */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="flex items-center gap-1">
              <ModeButtons stored={stored} subject={view.subject} mode={view.mode} />
              <MaskToggle stored={stored} available={!!view.subject.mask} />
            </div>
            <ZoomControl view={view} />
          </div>
          {note && <p className="text-xs ak-ink-60 px-3 pb-3">{note}</p>}
          <div
            className="review-evidence grid"
            data-evidence={terminal ? "terminal" : evidence.status}
          >
            {evidence.status === "loading" && !terminal && (
              <div
                className="flex flex-wrap justify-center items-center gap-2 p-3 text-sm ak-ink-60"
                role="status"
              >
                {variant.kind === "pending"
                  ? "Comparison is still running…"
                  : "Loading this comparison’s images…"}
              </div>
            )}
            {(terminal || evidence.status === "error") && (
              <div
                className="flex flex-wrap justify-center items-center gap-2 p-3 text-sm ak-ink-60"
                role={terminal || evidence.failure === "expired" ? "status" : "alert"}
              >
                <strong>
                  {terminal
                    ? terminalTitle(model)
                    : evidence.failure === "expired"
                      ? "Image history expired"
                      : retryImages
                        ? "Image evidence unavailable"
                        : "Comparison evidence incomplete"}
                </strong>
                <p>{terminal ? terminalMessage(model) : evidence.error}</p>
                {terminal && variant.error && <p>{variant.error}</p>}
                {retryImages && (
                  <Button $size="xs" disabled={busy} onClick={onRetryImages}>
                    Retry images
                  </Button>
                )}
              </div>
            )}
            <ReviewStage
              view={view}
              name={variant.label}
              mask={stored.mask}
              images={evidence.images}
              requestKey={evidence.identity}
              onReport={evidence.report}
              aria-busy={evidence.status === "loading" || undefined}
              className="mx-3 mb-3 h-[min(75dvh,60rem)] min-h-80"
            />
          </div>
        </>
      )}
    </Frame>
  );
}
