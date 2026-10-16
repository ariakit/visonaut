// The review stage: one recessed well with the images of one variant in the
// mode on screen, the mask, and the label of each image. It binds no key.
// The page gives it the view of `useStageView` and the image state of
// `useEvidence`, and the view controls drive the same view.
//
// The state chip and the marks of the changed regions (step 3 of #274) add
// to this file.

import { cx } from "clava";
import { ChevronsLeftRight } from "lucide-react";
import { useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import type { EvidenceRole, ImageEvidence } from "../../../review/use-evidence.ts";
import { Frame } from "../../ariakit/components/frame.ariakit.react.tsx";
import type { FrameProps } from "../../ariakit/components/frame.ariakit.react.tsx";
import { Well } from "../surfaces.tsx";
import { iconStroke } from "../tokens.ts";
import type { ViewMode } from "../view-types.ts";
import { ImageLabel, MaskPicture, Picture, PixelGrid } from "./canvas.tsx";
import type { PictureStatus } from "./canvas.tsx";
import { clamp } from "./geometry.ts";
import { usePanGesture, useStageWheel } from "./gestures.ts";
import { modeNames } from "./model.ts";
import type { StageEngine } from "./view.ts";

// The layout of a pane, in em of the stage. The pane has `p-3 pt-10`: the
// top gutter is the row of the label of an image that fills the pane.
const rowTop = 0.5;
const rowHeight = 1.75;
const labelGap = 0.25;
// A swipe shows the size on both labels only when the image has this width.
const twoSizesWidth = 24;

/** What one pane draws: both images in one place, or one image alone. */
type PaneContent = ViewMode | "baseline-pane" | "current-pane";

interface SwipeHandleProps {
  position: number;
  onChange(position: number): void;
}

/**
 * The line between the baseline and the current image in a swipe. A drag on
 * it moves it. It has no key: the arrows are the review keys of the page.
 */
function SwipeHandle({ position, onChange }: SwipeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const move = (event: PointerEvent<HTMLElement>) => {
    const track = event.currentTarget.parentElement;
    if (!track) return;
    const bounds = track.getBoundingClientRect();
    if (!bounds.width) return;
    onChange(clamp((event.clientX - bounds.left) / bounds.width, 0, 1));
  };
  return (
    <div
      data-stage-control=""
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        move(event);
      }}
      onPointerMove={(event) => {
        if (!dragging) return;
        move(event);
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      className="absolute inset-y-0 w-6 -translate-x-1/2 cursor-ew-resize touch-none"
      style={{ left: `${position * 100}%` }}
    >
      <Frame
        $layer="brand"
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2"
      />
      <Frame
        $layer="brand"
        $rounded="full"
        $forceRounded
        $p={1}
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-1/2"
      >
        <ChevronsLeftRight strokeWidth={iconStroke} className="size-4" />
      </Frame>
    </div>
  );
}

interface LabelPlace {
  style: CSSProperties;
  /** The side of its box that the label is at. */
  justify: "start" | "end";
  /** True when the label lies on pixels of the image. */
  raised: boolean;
}

/**
 * The place of a label: above a top corner of its image, outside the
 * pixels. When the image leaves the pane at the top, the label stays in the
 * top row, on the pixels.
 */
function getLabelPlace(view: StageEngine, corner: "start" | "end"): LabelPlace | null {
  const { place, pane, subject } = view;
  if (!place || !pane) return null;
  const { em, padding } = pane;
  const top = Math.max(place.y - (rowHeight + labelGap) * em, rowTop * em);
  const height = rowHeight * em;
  const raised = place.y < padding.top - 0.5;
  const paneStart = padding.left;
  const paneEnd = pane.width - padding.right;
  if (corner === "end") {
    const end = Math.min(place.x + subject.bounds.width * place.scale, paneEnd);
    return {
      style: { top, height, right: pane.width - end, width: Math.max(0, end - paneStart) },
      justify: "end",
      raised,
    };
  }
  const left = Math.max(place.x, paneStart);
  return {
    style: { top, height, left, maxWidth: Math.max(0, paneEnd - left) },
    justify: "start",
    raised,
  };
}

function getStatus(result: ImageEvidence | undefined): PictureStatus {
  if (!result) return "loading";
  return result.status === "ready" ? "ready" : "failed";
}

interface PaneLabel {
  /** The corner of the image that the label is at. */
  corner: "start" | "end";
  name: string;
  /** The image whose size the label has. */
  side: "baseline" | "current";
}

function getPaneLabels(content: PaneContent): PaneLabel[] {
  switch (content) {
    case "swipe":
      return [
        { corner: "start", name: "Baseline", side: "baseline" },
        { corner: "end", name: "Current", side: "current" },
      ];
    case "overlay":
      return [{ corner: "start", name: "Overlay", side: "current" }];
    case "original":
    case "baseline-pane":
      return [{ corner: "start", name: "Baseline", side: "baseline" }];
    default:
      return [{ corner: "start", name: "Current", side: "current" }];
  }
}

interface StagePaneProps extends Pick<
  ReviewStageProps,
  "view" | "name" | "mask" | "images" | "requestKey" | "onReport"
> {
  content: PaneContent;
  /** True for the pane that the view measures. */
  measured: boolean;
  swipe: number;
  onSwipe(position: number): void;
}

function StagePane({
  view,
  content,
  name,
  mask,
  images,
  requestKey,
  onReport,
  measured,
  swipe,
  onSwipe,
}: StagePaneProps) {
  const { subject, place, pane, pannable, animated } = view;
  const { baseline, current, bounds, resize } = subject;
  const { handlers, dragging } = usePanGesture(view);
  const scale = place?.scale ?? 1;
  const showsBaseline = content !== "new" && content !== "current-pane";
  const showsCurrent = content !== "original" && content !== "baseline-pane";
  // The first pane keeps both images in each mode, so that a change of mode
  // needs no request. The second pane of two panes has the current image.
  const hasBaseline = !!baseline && !baseline.expired && content !== "current-pane";
  const hasCurrent = !!current && !current.expired;
  const currentStatus = getStatus(images.candidate);
  const wide = !!pane && bounds.width * scale >= twoSizesWidth * pane.em;
  const cursor = dragging ? "cursor-grabbing" : "cursor-grab";
  return (
    <div
      ref={measured ? view.setPane : undefined}
      data-stage-pane=""
      {...handlers}
      className={cx(
        // The margin keeps the ring of an image that is as wide as the room.
        "relative min-h-0 min-w-0 overflow-clip p-3 pt-10 [overflow-clip-margin:1px]",
        pannable && cx(cursor, "touch-none"),
      )}
    >
      <div
        className={cx(
          "absolute top-0 left-0",
          !place && "invisible",
          animated &&
            "transition-[translate,width,height] duration-200 ease-out motion-reduce:transition-none",
        )}
        style={{
          width: bounds.width * scale,
          height: bounds.height * scale,
          translate: `${place?.x ?? 0}px ${place?.y ?? 0}px`,
        }}
      >
        {/* An image with no bytes sends no request. The baseline is always
            plain. */}
        {hasBaseline && (
          <Picture
            image={baseline}
            bounds={bounds}
            status={getStatus(images.reference)}
            requestKey={requestKey}
            alt={showsBaseline ? `Baseline: ${name}` : ""}
            scale={scale}
            onReport={(result) => onReport("reference", result)}
            className={showsBaseline ? undefined : "invisible"}
          />
        )}
        {hasCurrent && (
          <div
            className={cx("pointer-events-none absolute inset-0", !showsCurrent && "invisible")}
            // In a swipe the baseline is before the line and the current
            // image after it.
            style={content === "swipe" ? { clipPath: `inset(0 0 0 ${swipe * 100}%)` } : undefined}
          >
            <Picture
              image={current}
              bounds={bounds}
              status={currentStatus}
              requestKey={requestKey}
              alt={showsCurrent ? `Current: ${name}` : ""}
              scale={scale}
              faded={content === "overlay"}
              onReport={(result) => onReport("candidate", result)}
            />
            {subject.mask && !subject.mask.expired && (
              <MaskPicture
                mask={subject.mask}
                bounds={bounds}
                status={getStatus(images.diff)}
                requestKey={requestKey}
                // The mask lies on the current image after it is there.
                shown={mask && currentStatus === "ready"}
                onReport={(result) => onReport("diff", result)}
              />
            )}
          </div>
        )}
        <PixelGrid scale={scale} />
        {content === "swipe" && <SwipeHandle position={swipe} onChange={onSwipe} />}
      </div>
      {getPaneLabels(content).map((label) => {
        const image = subject[label.side];
        const labelPlace = getLabelPlace(view, label.corner);
        if (!image || !labelPlace) return null;
        return (
          <div
            key={label.name}
            className={cx(
              "pointer-events-none absolute flex items-center",
              labelPlace.justify === "end" && "justify-end",
              animated &&
                "transition-[top,left,right] duration-200 ease-out motion-reduce:transition-none",
            )}
            style={labelPlace.style}
          >
            <ImageLabel
              name={label.name}
              // Two labels of a narrow image have the names only.
              size={content === "swipe" && !wide ? null : image}
              // The size of the current image is the one that changed.
              resize={label.side === "current" ? resize : null}
              raised={labelPlace.raised}
            />
          </div>
        );
      })}
    </div>
  );
}

export interface ReviewStageProps extends Omit<FrameProps, "children"> {
  view: StageEngine;
  /** The name of the variant, for the text of the images. */
  name: string;
  /** The mask switch. The mask still loads while it is off. */
  mask: boolean;
  /** The result of each image of `useEvidence`. */
  images: Partial<Record<EvidenceRole, ImageEvidence>>;
  /** Changes with each request of the images, as `identity` of `useEvidence`. */
  requestKey: string;
  /** Reports the result of one image to `useEvidence`. */
  onReport(role: EvidenceRole, result: ImageEvidence): void;
}

/**
 * The stage of one variant. It takes all the room that its parent gives.
 *
 * - First view: the current image at Fit with the mask on it. The baseline
 *   shows in the same place, so `F` and `G` change only the pixels.
 * - Two panes (`side`) put the baseline and the current image side by side.
 *   Both panes show the same place: a pan or a zoom in one moves both.
 * - A swipe shows the baseline before a line and the current image after
 *   it. A drag on the line moves it.
 * - An overlay shows the current image at half strength on the baseline.
 * - An image shows only after its checks passed: `decode()`, and the stored
 *   size. Until then its box is a placeholder.
 * - Each image has its name and its size at a top corner.
 * - Gestures: a drag pans, the wheel pans, and the wheel with Ctrl or a
 *   pinch zooms at the pointer.
 * @example
 * const stored = useStoredView();
 * const view = useStageView({ variant, mode: stored.mode });
 * const evidence = useEvidence({ comparisonId, variant, retry });
 * <ReviewStage
 *   view={view}
 *   name={variant.label}
 *   mask={stored.mask}
 *   images={evidence.images}
 *   requestKey={evidence.identity}
 *   onReport={evidence.report}
 *   className="h-96"
 * />
 */
export function ReviewStage({
  view,
  name,
  mask,
  images,
  requestKey,
  onReport,
  className,
  ...props
}: ReviewStageProps) {
  const { subject, mode } = view;
  // The gestures keep the view in a ref. The lint rule of refs then treats
  // each later read of the view as a ref read, so the reads come first.
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [swipe, setSwipe] = useState(0.5);
  useStageWheel(root, view);
  const contents: PaneContent[] = mode === "side" ? ["baseline-pane", "current-pane"] : [mode];
  return (
    <Well
      ref={setRoot}
      role="group"
      aria-label={name ? `Images of ${name}` : "Images"}
      {...props}
      className={cx("relative grid min-h-0 min-w-0 overflow-clip select-none", className)}
    >
      <div className={cx("grid min-h-0 min-w-0", mode === "side" && "grid-cols-2 gap-3")}>
        {contents.map((content, index) => (
          <StagePane
            // The first pane stays in each mode, with its images and its
            // measure. The view measures it: both panes have one size.
            key={index === 0 ? "pane" : content}
            view={view}
            content={content}
            name={name}
            mask={mask}
            images={images}
            requestKey={requestKey}
            onReport={onReport}
            measured={index === 0}
            swipe={swipe}
            onSwipe={setSwipe}
          />
        ))}
      </div>
      <span role="status" className="sr-only">
        {`${modeNames[mode]}${subject.mask ? `, mask ${mask ? "on" : "off"}` : ""}`}
      </span>
    </Well>
  );
}
