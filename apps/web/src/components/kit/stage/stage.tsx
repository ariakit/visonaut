// The review stage: one recessed well with the images of one variant in the
// mode on screen, the mask, the boxes around the changed regions, the label
// of each image, and one status row. It binds no key. The page gives it the
// view of `useStageView`, the image state of `useEvidence`, and the content
// of the status row, and the view controls drive the same view.

import { cx } from "clava";
import { ChevronsLeftRight } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import type { EvidenceRole, ImageEvidence } from "../../../review/use-evidence.ts";
import { Frame } from "../../ariakit/components/frame.ariakit.react.tsx";
import type { FrameProps } from "../../ariakit/components/frame.ariakit.react.tsx";
import { Well } from "../surfaces.tsx";
import { iconStroke } from "../tokens.ts";
import type { ViewMode } from "../view-types.ts";
import { ImageLabel, MaskPicture, Picture, PixelGrid, RegionBoxes, SizeBand } from "./canvas.tsx";
import type { Edges, PictureStatus } from "./canvas.tsx";
import { clamp } from "./geometry.ts";
import { usePanGesture, useStageWheel } from "./gestures.ts";
import { hasMaskLayer, modeNames } from "./model.ts";
import type { StageEngine } from "./view.ts";

// The layout of a pane, in em of the stage. The pane has `p-3 pt-10`: the
// top gutter is the status row, and the label of an image that fills the
// pane lies in that row.
const rowTop = 0.5;
const rowHeight = 1.75;
const labelGap = 0.25;
const paneGap = 0.75;
// A label gives way to the status with this space between them. It needs
// about this room for a name with a size, for example `Baseline 1440 × 900`,
// and this room for the name alone.
const statusSpace = 0.5;
const labelRoom = 9.5;
const nameRoom = 4;
// A swipe shows the size on both labels only when the image has this width.
const twoSizesWidth = 24;

/** The width of an element in pixels, or 0 without an element. */
function useElementWidth() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    const read = () => setWidth(element.offsetWidth);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, element ? width : 0] as const;
}

/** The left and the right side of the status, in the pixels of a pane. */
interface StatusBox {
  left: number;
  right: number;
}

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
  /** True when the place has room for the name only, without the size. */
  compact: boolean;
}

interface LabelPlaceParams {
  view: StageEngine;
  /** The corner of the image that the label is at. */
  corner: "start" | "end";
  /** The status in the pixels of this pane, or null without a status. */
  status: StatusBox | null;
}

/**
 * The place of a label: above the corner of its image, outside the pixels.
 * When the image leaves the pane at the top, the label stays in the status
 * row, on the pixels. In that row it gives way to the status and keeps its
 * corner: it ends before the status, without the size when the room is only
 * enough for the name. It leaves its corner only when the name has no room
 * there.
 */
function getLabelPlace({ view, corner, status }: LabelPlaceParams): LabelPlace | null {
  const { place, pane, subject } = view;
  if (!place || !pane) return null;
  const { em, padding } = pane;
  const top = Math.max(place.y - (rowHeight + labelGap) * em, rowTop * em);
  const raised = place.y < padding.top - 0.5;
  const inStatusRow = top < (rowTop + rowHeight) * em;
  const obstacle = inStatusRow ? status : null;
  const height = rowHeight * em;
  const room = labelRoom * em;
  const paneStart = padding.left;
  const paneEnd = pane.width - padding.right;
  const before = obstacle ? obstacle.left - statusSpace * em : paneEnd;
  const after = obstacle ? obstacle.right + statusSpace * em : paneStart;
  const fromStart = (left: number, limit: number, compact = false): LabelPlace => {
    return {
      style: { top, height, left, maxWidth: Math.max(0, limit - left) },
      justify: "start",
      raised,
      compact,
    };
  };
  const fromEnd = (end: number, limit: number, compact = false): LabelPlace => {
    return {
      style: { top, height, right: pane.width - end, width: Math.max(0, end - limit) },
      justify: "end",
      raised,
      compact,
    };
  };
  if (corner === "end") {
    const end = Math.min(place.x + subject.bounds.width * place.scale, paneEnd);
    if (!obstacle || end <= before) return fromEnd(end, paneStart);
    if (end - after >= room) return fromEnd(end, after);
    if (end - after >= nameRoom * em) return fromEnd(end, after, true);
    if (paneEnd - after >= room) return fromStart(after, paneEnd);
    return fromEnd(before, paneStart);
  }
  const start = Math.max(place.x, paneStart);
  if (!obstacle || start >= after) return fromStart(start, paneEnd);
  if (before - start >= room) return fromStart(start, before);
  if (before - start >= nameRoom * em) return fromStart(start, before, true);
  if (before - paneStart >= room) return fromEnd(before, paneStart);
  return fromStart(after, paneEnd);
}

interface ShownEdgesParams {
  view: StageEngine;
  /** The share of the width that a swipe hides. */
  swipe: number;
}

/** The part of the image box that the pane shows, as shares of its size. */
function getShownEdges({ view, swipe }: ShownEdgesParams): Edges {
  const { place, pane, subject } = view;
  if (!place || !pane) return { left: swipe, top: 0, right: 1, bottom: 1 };
  const width = subject.bounds.width * place.scale;
  const height = subject.bounds.height * place.scale;
  return {
    left: Math.max(swipe, -place.x / width),
    top: Math.max(0, -place.y / height),
    right: Math.min(1, (pane.width - place.x) / width),
    bottom: Math.min(1, (pane.height - place.y) / height),
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
  /** The status in the pixels of this pane, or null without a status. */
  status: StatusBox | null;
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
  status,
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
  // The marks lie on the current image where it shows, after it is there.
  // The hidden current image of the first pane of two panes has none. The
  // mask switch turns the boxes and the band of a size change off with the
  // mask, so that it can show all the pixels.
  const marked = mask && showsCurrent && currentStatus === "ready";
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
            {marked && resize && <SizeBand resize={resize} bounds={bounds} />}
            {marked && subject.mask && (
              <RegionBoxes
                regions={view.regions}
                image={current}
                bounds={bounds}
                scale={scale}
                active={view.region}
                onSelect={view.goTo}
                shown={getShownEdges({ view, swipe: content === "swipe" ? swipe : 0 })}
              />
            )}
          </div>
        )}
        <PixelGrid scale={scale} />
        {content === "swipe" && <SwipeHandle position={swipe} onChange={onSwipe} />}
      </div>
      {getPaneLabels(content).map((label) => {
        const image = subject[label.side];
        const labelPlace = getLabelPlace({ view, corner: label.corner, status });
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
              size={labelPlace.compact || (content === "swipe" && !wide) ? null : image}
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
  /**
   * The status row at the top center: the state chip, or an error. It lies
   * on the stage, so a status never moves an image.
   */
  status?: ReactNode;
}

/**
 * The stage of one variant. It takes all the room that its parent gives.
 *
 * - First view: the current image at Fit with the mask on it, and one box
 *   around each changed region. The baseline shows in the same place, so
 *   `F` and `G` change only the pixels. A click on a box zooms to its
 *   region.
 * - A size change has no mask: a band marks the rows and the columns that
 *   only one image has. The mask switch turns the mask, the boxes, and the
 *   band off.
 * - Two panes (`side`) put the baseline and the current image side by side.
 *   Both panes show the same place: a pan or a zoom in one moves both.
 * - A swipe shows the baseline before a line and the current image after
 *   it. A drag on the line moves it.
 * - An overlay shows the current image at half strength on the baseline.
 * - An image shows only after its checks passed: `decode()`, and the stored
 *   size. Until then its box is a placeholder.
 * - Each image has its name and its size at a top corner. In the status
 *   row, a label gives way to the status.
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
 *   status={<StateChip state={getChipState(view.subject, late)} />}
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
  status,
  className,
  ...props
}: ReviewStageProps) {
  const { subject, mode, pane } = view;
  // The gestures keep the view in a ref. The lint rule of refs then treats
  // each later read of the view as a ref read, so the reads come first.
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [setStatus, statusWidth] = useElementWidth();
  const [swipe, setSwipe] = useState(0.5);
  useStageWheel(root, view);
  const contents: PaneContent[] = mode === "side" ? ["baseline-pane", "current-pane"] : [mode];
  // The status is in the middle of the stage. Each pane gets its place in the
  // pixels of that pane, so that a label can give way to it.
  const getStatusBox = (index: number): StatusBox | null => {
    if (!pane || !statusWidth) return null;
    const gap = paneGap * pane.em;
    const stageWidth = pane.width * contents.length + gap * (contents.length - 1);
    const left = (stageWidth - statusWidth) / 2 - index * (pane.width + gap);
    return { left, right: left + statusWidth };
  };
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
            status={getStatusBox(index)}
            swipe={swipe}
            onSwipe={setSwipe}
          />
        ))}
      </div>
      {/* The row has the height of a chip. A longer error grows down over
          the image and moves nothing. */}
      <div className="pointer-events-none absolute inset-x-0 top-2 flex min-h-7 items-start justify-center px-3">
        <div ref={setStatus} className="pointer-events-auto flex max-w-full">
          {status}
        </div>
      </div>
      <span role="status" className="sr-only">
        {`${modeNames[mode]}${hasMaskLayer(subject) ? `, mask ${mask ? "on" : "off"}` : ""}`}
      </span>
    </Well>
  );
}
