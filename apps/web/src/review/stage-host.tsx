// The stage of the review page: the image views of the selected variant. It
// hosts the viewer of today. The frame gives it the run, the variant, and the
// state of the comparison, and it reads the keys of the views from
// `useStageHost`. The stage of #274 replaces this file only.

import { Columns2Icon, DiffIcon, ImageIcon, ImageMinusIcon, ScanIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Button as FlatButton,
  ButtonGlider,
  ButtonGroup,
  ButtonLabel,
  ButtonSlot,
} from "../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { ControlButton as Button } from "../components/control-button.tsx";
import { useShortcuts } from "../components/kit/keys.tsx";
import { ScreenshotViewer } from "../components/screenshot-viewer.tsx";
import type { ReviewMode, ReviewModel, ReviewVariant, ReviewZoom } from "./model.ts";
import { getClosedWords } from "./run-words.ts";
import { noImageBytes, useEvidence } from "./use-evidence.ts";

export interface UseStageHostParams {
  model: ReviewModel;
  /** The variant on the stage. */
  variant: ReviewVariant | undefined;
  /** A new number loads the images again. */
  retry: number;
  /** Says a sentence in the status line of the page. */
  onAnnounce(message: string): void;
}

export interface StageHostState {
  /** The view on the stage. A diff without two images shows side by side. */
  mode: ReviewMode;
  setMode(mode: ReviewMode): void;
  zoom: ReviewZoom;
  setZoom(zoom: ReviewZoom): void;
  evidence: ReturnType<typeof useEvidence>;
  /** True when each image of the stage is on screen. A decision waits for it. */
  ready: boolean;
  /** The keys of the stage: a lowercase key gives its action. */
  keys: Partial<Record<string, () => void>>;
}

/**
 * The state of the stage: the view, the zoom, and the images. The frame calls
 * it once, gives the result to `StageHost`, and sends the keys of `keys`.
 * @example
 * const stage = useStageHost({ model, variant, retry, onAnnounce });
 * <StageHost stage={stage} model={model} variant={variant} … />
 */
export function useStageHost({
  model,
  variant,
  retry,
  onAnnounce,
}: UseStageHostParams): StageHostState {
  const [mode, setStoredMode] = useState<ReviewMode>("side");
  const [zoom, setZoom] = useState<ReviewZoom>("fit");
  const diffable = !!variant?.reference && !!variant.candidate;
  const effectiveMode = mode === "diff" && !diffable ? "side" : mode;
  const evidence = useEvidence({
    comparisonId: model.comparisonId,
    variant: model.evidenceState === "summary" ? undefined : variant,
    mode: effectiveMode,
    retry,
  });
  const setMode = (next: ReviewMode) => {
    if (next === "diff" && !diffable) {
      onAnnounce(
        "Pixel diff requires both a reference and a new image. The current view has not changed.",
      );
      return;
    }
    setStoredMode(next);
  };
  return {
    mode: effectiveMode,
    setMode,
    zoom,
    setZoom,
    evidence,
    ready: evidence.status === "ready",
    keys: {
      s: () => setMode("side"),
      d: () => setMode("diff"),
      f: () => setMode("new"),
      g: () => setMode("original"),
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

interface ViewButtonProps {
  stage: StageHostState;
  mode: ReviewMode;
  label: string;
  shortcut: string;
  icon: ReactNode;
  disabled?: boolean;
}

function ViewButton({ stage, mode, label, shortcut, icon, disabled }: ViewButtonProps) {
  // The key hint hides while the keyboard switch is off.
  const { enabled: shortcuts } = useShortcuts();
  return (
    <FlatButton
      $size="xs"
      className="whitespace-nowrap"
      $p={1.5}
      $rounded="md"
      aria-pressed={stage.mode === mode}
      $lightnessOffset={stage.mode === mode}
      aria-disabled={disabled}
      onClick={() => stage.setMode(mode)}
    >
      <ButtonSlot aria-hidden>{icon}</ButtonSlot>
      <ButtonLabel>{label}</ButtonLabel>{" "}
      {shortcuts && <ButtonSlot $kind="shortcut">{shortcut}</ButtonSlot>}
    </FlatButton>
  );
}

/**
 * The stage of today: the read-only reason, the view and zoom controls, the
 * state of the images, and the viewer. A closed review with no image bytes
 * shows a summary.
 */
export function StageHost({
  stage,
  model,
  variant,
  terminal,
  busy,
  onRetryImages,
}: StageHostProps) {
  const { evidence } = stage;
  const retryImages = !terminal && (evidence.failure === "load" || evidence.failure === "decode");
  return (
    <Frame
      $cover
      $border
      $borderType="border"
      $rounded="none"
      $orientation="vertical"
      $p={0}
      className="review-result"
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
          <Frame
            $cover
            $border
            $borderType="border"
            $layer="canvas"
            $p={3}
            className="review-view-controls flex flex-wrap items-center justify-between gap-2"
          >
            <ButtonGroup
              $p={0.5}
              $gap="xs"
              $rounded="md"
              $forceRounded
              $layer
              className="min-w-0 max-w-full overflow-x-auto"
              aria-label="Image view"
            >
              <ViewButton
                stage={stage}
                mode="side"
                label="Compare"
                shortcut="S"
                icon={<Columns2Icon />}
              />
              <ViewButton
                stage={stage}
                mode="diff"
                label="Difference"
                shortcut="D"
                icon={<DiffIcon />}
                disabled={!variant.reference || !variant.candidate}
              />
              <ViewButton
                stage={stage}
                mode="new"
                label="Current"
                shortcut="F"
                icon={<ImageIcon />}
              />
              <ViewButton
                stage={stage}
                mode="original"
                label="Baseline"
                shortcut="G"
                icon={<ImageMinusIcon />}
              />
              <ButtonGlider $rounded="md" />
            </ButtonGroup>
            <ButtonGroup
              $p={0.5}
              $gap="xs"
              $rounded="md"
              $forceRounded
              $border={false}
              aria-label="Image zoom"
            >
              {(["fit", 1, 2] as const).map((value) => (
                <FlatButton
                  key={value}
                  $size="xs"
                  $p={1.5}
                  $rounded="md"
                  aria-pressed={stage.zoom === value}
                  $lightnessOffset={stage.zoom === value}
                  onClick={() => stage.setZoom(value)}
                >
                  {value === "fit" && (
                    <ButtonSlot aria-hidden>
                      <ScanIcon />
                    </ButtonSlot>
                  )}
                  <ButtonLabel>{value === "fit" ? "Fit" : `${value * 100}%`}</ButtonLabel>
                </FlatButton>
              ))}
              <ButtonGlider $rounded="md" />
            </ButtonGroup>
          </Frame>
          {(!variant.reference || !variant.candidate) && (
            <p className="text-xs ak-ink-60 px-3 pb-3">
              {variant.candidateOmitted
                ? "Matched locally. The new image was not uploaded."
                : "Pixel diff requires both a reference and a new image."}
            </p>
          )}
          <Frame
            $layer="canvas"
            $border
            $p={0}
            $rounded="none"
            $forceRounded
            className="review-evidence"
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
            <ScreenshotViewer
              variant={variant}
              mode={stage.mode}
              zoom={stage.zoom}
              ready={evidence.status === "ready"}
              images={evidence.images}
              identity={evidence.identity}
              report={evidence.report}
            />
          </Frame>
        </>
      )}
    </Frame>
  );
}
