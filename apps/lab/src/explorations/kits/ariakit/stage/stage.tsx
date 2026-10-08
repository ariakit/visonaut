// The review stage: one recessed well with the images of one variant in the
// stored mode, the mask, the boxes around the changed regions, the label of
// each image, and one state chip. It binds no key. The page gives it the
// view of `useStageView`, and the bar drives the same view.

import { cx } from "clava";
import { ChevronsLeftRight } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { Frame } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import type { FrameProps } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import { focus } from "../../../../components/ariakit/styles/focus.ts";
import { getItemLabel, getVariantLabel } from "../../../../fixtures/index.ts";
import type { ReviewItem, ReviewVariant } from "../../../../fixtures/index.ts";
import { Well } from "../surfaces.tsx";
import { iconStroke } from "../tokens.ts";
import type { ViewMode } from "../view-types.ts";
import { ImageLabel, Picture, PixelGrid, RegionBoxes, SizeBand, Tint } from "./canvas.tsx";
import { getChipState, StateChip } from "./chip.tsx";
import { usePanGesture, useStageWheel } from "./gestures.ts";
import { clamp } from "./geometry.ts";
import { getStageMode, modeNames } from "./model.ts";
import type { ImageSide } from "./model.ts";
import type { StageEngine } from "./view.ts";

// The layout of a pane, in em of the stage. The pane has `p-3 pt-10`: the
// top gutter is the row of the chip, and the label of an image that fills
// the pane lies in that row.
const rowTop = 0.5;
const rowHeight = 1.75;
const labelGap = 0.25;
const paneGap = 0.75;
// A label gives way to the chip with this space between them. It needs about
// this room for a name with a size, for example `Baseline 1440 × 900`, and
// this room for the name alone.
const chipSpace = 0.5;
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

/** What one pane draws: both images in one place, or one image alone. */
type PaneContent = ViewMode | "baseline-pane" | "current-pane";

interface SwipeHandleProps {
  position: number;
  onChange(position: number): void;
}

/**
 * The line between the baseline and the current image in a swipe. A drag on
 * it moves it, and the range input moves it with the arrow keys.
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
  const style = { left: `${position * 100}%` };
  return (
    <>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={position}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Swipe position"
        className="peer sr-only"
      />
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
        style={style}
      >
        <Frame
          $layer="brand"
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2"
        />
      </div>
      {/* The grip follows the input, so it shows the focus of the input. */}
      <Frame
        $layer="brand"
        $rounded="full"
        $forceRounded
        $p={1}
        aria-hidden
        className={cx(
          "pointer-events-none absolute top-1/2 -translate-1/2 peer-focus-visible:outline-2",
          focus.class({ $focusColor: "brand", $focusOffset: 2 }),
        )}
        style={style}
      >
        <ChevronsLeftRight strokeWidth={iconStroke} className="size-4" />
      </Frame>
    </>
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
  /** The chip in the pixels of this pane, or null without a chip. */
  chip: { left: number; right: number } | null;
}

/**
 * The place of a label: above the corner of its image, outside the pixels.
 * When the image leaves the pane at the top, the label stays in the row of
 * the chip, on the pixels. In that row it gives way to the chip and keeps
 * its corner: it ends before the chip, without the size when the room is
 * only enough for the name. It leaves its corner only when the name has no
 * room there.
 */
function getLabelPlace({ view, corner, chip }: LabelPlaceParams): LabelPlace | null {
  const { place, pane, subject } = view;
  if (!place || !pane) return null;
  const { em, padding } = pane;
  const natural = place.y - (rowHeight + labelGap) * em;
  const top = Math.max(natural, rowTop * em);
  const raised = place.y < padding.top - 0.5;
  const inChipRow = top < (rowTop + rowHeight) * em;
  const obstacle = inChipRow ? chip : null;
  const height = rowHeight * em;
  const room = labelRoom * em;
  const paneStart = padding.left;
  const paneEnd = pane.width - padding.right;
  const before = obstacle ? obstacle.left - chipSpace * em : paneEnd;
  const after = obstacle ? obstacle.right + chipSpace * em : paneStart;
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
    const imageEnd = place.x + subject.bounds.width * place.scale;
    const end = Math.min(imageEnd, paneEnd);
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

interface PaneLabel {
  key: string;
  /** The corner of the image that the label is at. */
  corner: "start" | "end";
  name: string;
  /** The image whose size the label has. */
  side: ImageSide;
}

interface StagePaneProps {
  view: StageEngine;
  content: PaneContent;
  mask: boolean;
  /** The screenshot and the variant, for the text of each image. */
  name: string;
  /** True for the pane that the view measures. */
  measured: boolean;
  /** The height that a floating bar covers, as a CSS length. */
  clearance: string | undefined;
  chip: { left: number; right: number } | null;
  swipe: number;
  onSwipe(position: number): void;
}

function StagePane({
  view,
  content,
  mask,
  name,
  measured,
  clearance,
  chip,
  swipe,
  onSwipe,
}: StagePaneProps) {
  const { subject, images, place, pane } = view;
  const { baseline, current, bounds, resize } = subject;
  const { handlers, dragging } = usePanGesture(view);
  const scale = place?.scale ?? 1;

  const showsBaseline = content !== "new" && content !== "current-pane";
  const showsCurrent = content !== "original" && content !== "baseline-pane";
  // Both images of a pane with one place stay in the document, so that the
  // change from one to the other needs no request.
  const hasBaseline = !!baseline && content !== "current-pane";
  const hasCurrent = !!current && content !== "baseline-pane";
  const settle = (side: ImageSide) => (attempt: number, loaded: boolean) => {
    images.settle(side, attempt, loaded);
  };

  // The mask lies on the current image wherever that image shows. The
  // baseline is always plain.
  const marked = mask && images.current.status === "loaded";
  const cursor = dragging ? "cursor-grabbing" : "cursor-grab";

  const labels: PaneLabel[] = [];
  if (content === "swipe") {
    labels.push({ key: "baseline", corner: "start", name: "Baseline", side: "baseline" });
    labels.push({ key: "current", corner: "end", name: "Current", side: "current" });
  } else if (content === "overlay") {
    labels.push({ key: "overlay", corner: "start", name: "Overlay", side: "current" });
  } else if (showsCurrent) {
    labels.push({ key: "current", corner: "start", name: "Current", side: "current" });
  } else {
    labels.push({ key: "baseline", corner: "start", name: "Baseline", side: "baseline" });
  }
  const wide = !!pane && bounds.width * scale >= twoSizesWidth * pane.em;

  return (
    <div
      ref={measured ? view.setPane : undefined}
      data-stage-pane=""
      {...handlers}
      className={cx(
        // The margin keeps the ring of an image that is as wide as the room.
        "relative min-h-0 min-w-0 overflow-clip p-3 pt-10 [overflow-clip-margin:1px]",
        view.pannable && cx(cursor, "touch-none"),
      )}
    >
      {measured && (
        <span
          data-stage-clearance=""
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 w-0"
          style={{ height: clearance }}
        />
      )}
      <div
        className={cx(
          "absolute top-0 left-0",
          !place && "invisible",
          view.animated &&
            "transition-[translate,width,height] duration-200 ease-out motion-reduce:transition-none",
        )}
        style={{
          width: bounds.width * scale,
          height: bounds.height * scale,
          translate: `${place?.x ?? 0}px ${place?.y ?? 0}px`,
        }}
      >
        {hasBaseline && (
          <Picture
            image={baseline}
            bounds={bounds}
            slot={images.baseline}
            alt={showsBaseline ? `Baseline: ${name}` : ""}
            scale={scale}
            onSettle={settle("baseline")}
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
              slot={images.current}
              alt={showsCurrent ? `Current: ${name}` : ""}
              scale={scale}
              onSettle={settle("current")}
              imageClassName={content === "overlay" ? "opacity-50" : undefined}
            />
            {marked && subject.mask && <Tint mask={subject.mask} bounds={bounds} />}
            {marked && resize && <SizeBand resize={resize} bounds={bounds} />}
            {marked && subject.mask && (
              <RegionBoxes
                regions={view.regions}
                image={current}
                bounds={bounds}
                scale={scale}
                active={view.region}
                onSelect={view.goTo}
              />
            )}
          </div>
        )}
        <PixelGrid scale={scale} />
        {content === "swipe" && <SwipeHandle position={swipe} onChange={onSwipe} />}
      </div>
      {labels.map((label) => {
        const image = subject[label.side];
        const labelPlace = getLabelPlace({ view, corner: label.corner, chip });
        if (!image || !labelPlace) return null;
        return (
          <div
            key={label.key}
            className={cx(
              "pointer-events-none absolute flex items-center",
              labelPlace.justify === "end" && "justify-end",
              view.animated &&
                "transition-[top,left,right] duration-200 ease-out motion-reduce:transition-none",
            )}
            style={labelPlace.style}
          >
            <ImageLabel
              name={label.name}
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
  /** The selected variant. Give the same one to `useStageView`. */
  variant: ReviewVariant | null | undefined;
  /** Its screenshot, for the text of the images. */
  item: Pick<ReviewItem, "key" | "displayName" | "variants"> | null | undefined;
  view: StageEngine;
  /** The stored mode. A variant that cannot show it shows its one image. */
  mode: ViewMode;
  /** The mask switch: the tint, the boxes, and the band of a size change. */
  mask: boolean;
  /**
   * The height at the bottom of the stage that a floating bar covers: a
   * number of rem, or a CSS length. An image that would reach under the bar
   * fits the stage without this height.
   */
  gutterBottom?: number | string;
}

/**
 * The stage of one variant. It takes all the room that its parent gives.
 *
 * - First view: the current image at Fit, the mask as a tint, and one box
 *   around each changed region. The baseline shows in the same place.
 * - Each image has its name and its size at its top-left corner.
 * - One chip at the top center says the state when the stage is not one or
 *   two loaded images of equal size.
 * - Gestures: a drag pans, the wheel pans, the wheel with Ctrl or a pinch
 *   zooms at the pointer, and a click on a box zooms to its region.
 * @example
 * const stored = useStoredView();
 * const view = useStageView({ variant, mode: stored.mode });
 * <ReviewStage
 *   variant={variant}
 *   item={item}
 *   view={view}
 *   mode={stored.mode}
 *   mask={stored.mask}
 *   gutterBottom={4}
 *   className="flex-1"
 * />
 */
export function ReviewStage({
  variant,
  item,
  view,
  mode: storedMode,
  mask,
  gutterBottom,
  className,
  ...props
}: ReviewStageProps) {
  const { subject, images, pane } = view;
  const mode = getStageMode(subject, storedMode);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [setChip, chipWidth] = useElementWidth();
  const [swipe, setSwipe] = useState(0.5);
  useStageWheel(root, view);

  const name = variant && item ? `${getItemLabel(item)}, ${getVariantLabel(variant, item)}` : "";
  const state = variant ? getChipState(subject, images) : null;
  const contents: PaneContent[] = mode === "side" ? ["baseline-pane", "current-pane"] : [mode];
  const clearance = typeof gutterBottom === "number" ? `${gutterBottom}rem` : gutterBottom;
  const marks = !!subject.mask || !!subject.resize;

  // The chip is in the middle of the stage. Each pane gets its place in the
  // pixels of that pane, so that a label can give way to it.
  const getChipBox = (index: number) => {
    if (!pane || !chipWidth) return null;
    const gap = paneGap * pane.em;
    const stageWidth = pane.width * contents.length + gap * (contents.length - 1);
    const left = (stageWidth - chipWidth) / 2 - index * (pane.width + gap);
    return { left, right: left + chipWidth };
  };

  return (
    <Well
      ref={setRoot}
      role="group"
      aria-label={name ? `Images of ${name}` : "Images"}
      aria-busy={images.loading || undefined}
      {...props}
      className={cx("relative grid min-h-0 min-w-0 overflow-clip select-none", className)}
    >
      <div className={cx("grid min-h-0 min-w-0", mode === "side" && "grid-cols-2 gap-3")}>
        {contents.map((content, index) => (
          <StagePane
            // One pane element for every mode with one place, so the change
            // of the mode needs no new measure.
            key={mode === "side" ? content : "pane"}
            view={view}
            content={content}
            mask={mask}
            name={name}
            measured={index === 0}
            clearance={clearance}
            chip={getChipBox(index)}
            swipe={swipe}
            onSwipe={setSwipe}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-2 flex h-7 items-center justify-center px-3">
        <div ref={setChip} className="pointer-events-auto flex max-w-full">
          <StateChip state={state} onRetry={images.retry} />
        </div>
      </div>
      <span role="status" className="sr-only">
        {variant && `${modeNames[mode]}${marks ? `, mask ${mask ? "on" : "off"}` : ""}`}
      </span>
    </Well>
  );
}
