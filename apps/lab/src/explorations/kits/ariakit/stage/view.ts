// The one stage engine: one scale and one place for every pane and layer of
// the review stage, with the Fit rule, the zoom levels, zoom about a point,
// pan, and the jump to a changed region. The page calls `useStageView` and
// gives the result to the stage and to the bar.

import { useLayoutEffect, useMemo, useState } from "react";
import type { ChangedRegion } from "../../../../fixtures/index.ts";
import { useRegions } from "../regions.ts";
import { zoomSteps } from "../view-types.ts";
import type { StageView, ViewMode, ZoomLevel } from "../view-types.ts";
import { clamp, getBoxCenter } from "./geometry.ts";
import type { Box, Point, Size } from "./geometry.ts";
import { useStageImages } from "./images.ts";
import type { StageImages } from "./images.ts";
import { getStageMode, getStageSubject } from "./model.ts";
import type { StageSubject, StageVariant } from "./model.ts";

/** The zoom from which the stage draws the grid of the image pixels. */
export const pixelGridScale = 8;

// A jump zooms by whole steps until the region takes this share of the
// stage, and never above 400%: the pixels around a small change stay in view.
const regionFill = 1 / 3;
const jumpSteps = [1, 2, 4];

// An image that is taller than this many stages fits the width, and the
// stage pans it. A shorter one shows whole.
const tallStages = 1.5;

const epsilon = 0.001;

interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The size of a pane in pixels, the pixels of 1em in it, and its gutters. */
export interface PaneMeasure extends Size {
  em: number;
  /** The padding of the pane: the space that an image at Fit leaves free. */
  padding: Insets;
  /** The height at the bottom that a floating bar covers. */
  clearance: number;
}

function isSameMeasure(first: PaneMeasure | null, second: PaneMeasure) {
  if (!first) return false;
  if (first.width !== second.width) return false;
  if (first.height !== second.height) return false;
  if (first.em !== second.em) return false;
  if (first.clearance !== second.clearance) return false;
  const sides = ["top", "right", "bottom", "left"] as const;
  return sides.every((side) => first.padding[side] === second.padding[side]);
}

/**
 * Measures a pane and follows its size. The first result is null: the server
 * and the first browser render do not know the size. The gutters are the
 * padding of the pane, and the element with `data-stage-clearance` gives the
 * height that a floating bar covers, so both follow the CSS of the stage.
 */
function usePaneMeasure() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [measure, setMeasure] = useState<PaneMeasure | null>(null);
  useLayoutEffect(() => {
    if (!element) return;
    const probe = element.querySelector<HTMLElement>("[data-stage-clearance]");
    const read = () => {
      const style = getComputedStyle(element);
      const next: PaneMeasure = {
        width: element.clientWidth,
        height: element.clientHeight,
        em: Number.parseFloat(style.fontSize) || 16,
        padding: {
          top: Number.parseFloat(style.paddingTop) || 0,
          right: Number.parseFloat(style.paddingRight) || 0,
          bottom: Number.parseFloat(style.paddingBottom) || 0,
          left: Number.parseFloat(style.paddingLeft) || 0,
        },
        clearance: probe?.offsetHeight ?? 0,
      };
      setMeasure((current) => (isSameMeasure(current, next) ? current : next));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    if (probe) {
      observer.observe(probe);
    }
    return () => observer.disconnect();
  }, [element]);
  return [setElement, element ? measure : null] as const;
}

/** Whole steps keep sharp pixels: 200%, 100%, or a scale below 100%. */
function getStepScale(ratio: number) {
  if (ratio >= 2) return 2;
  return Math.min(1, ratio);
}

/** What Fit means for an image: a tall one fits the width of the room. */
export function getFitMode(image: Size, room: Size): "contain" | "width" {
  const widthScale = Math.min(1, room.width / image.width);
  return image.height * widthScale > room.height * tallStages ? "width" : "contain";
}

/**
 * The scale of a zoom level for an image in a room.
 *
 * - `fit`: the whole image, enlarged by whole steps to 200% at most. A tall
 *   image takes the width of the room, at 100% at most, and pans.
 * - `width`: the width of the room, by whole steps above 100%.
 * - A number: the zoom factor. 1 is 100%.
 */
export function getLevelScale(level: ZoomLevel, image: Size, room: Size) {
  if (typeof level === "number") return level;
  if (level === "width") return getStepScale(room.width / image.width);
  if (getFitMode(image, room) === "width") return Math.min(1, room.width / image.width);
  return getStepScale(Math.min(room.width / image.width, room.height / image.height));
}

/** The place of an image in a pane: the scale, and the top-left corner. */
export interface ViewPlace {
  scale: number;
  x: number;
  y: number;
}

function placeAxis(center: number, length: number, start: number, room: number, scale: number) {
  const scaled = length * scale;
  // An image that fits stays in the middle. A larger one stops at the gutter,
  // so each part of it can show in the room.
  if (scaled <= room) return start + (room - scaled) / 2;
  const offset = start + room / 2 - center * scale;
  return Math.min(start, Math.max(start + room - scaled, offset));
}

function getCenter(place: ViewPlace, room: Box): Point {
  return {
    x: (room.x + room.width / 2 - place.x) / place.scale,
    y: (room.y + room.height / 2 - place.y) / place.scale,
  };
}

/**
 * The image point to put in the middle of a room to show a region. On an
 * axis where the region is larger than the room, the region shows from its
 * start, because a middle part can be a blank one.
 */
function getRegionAnchor(region: Box, scale: number, room: Size): Point {
  const center = getBoxCenter(region);
  const width = room.width / scale;
  const height = room.height / scale;
  return {
    x: region.width > width ? region.x + width / 2 : center.x,
    y: region.height > height ? region.y + height / 2 : center.y,
  };
}

interface ViewState {
  /** The variant that the place and the region belong to. */
  subjectId: string;
  /** The zoom stays between the variants and the screenshots of one run. */
  level: ZoomLevel;
  /** The image point in the middle of the room. Null: the first view. */
  center: Point | null;
  region: number | null;
  /** True after a jump, so that the image moves with a short transition. */
  animated: boolean;
}

type ViewChange = Partial<Pick<ViewState, "level" | "center" | "region">>;

export interface StageViewOptions {
  /** The selected variant. Without one, the stage is empty. */
  variant: StageVariant | null | undefined;
  /** The stored mode. `side` gives each image a pane of half the stage. */
  mode: ViewMode;
  /** True when the run is closed and its images are deleted. */
  expired?: boolean;
  /**
   * Another state of the image requests, for a surface that shows a load
   * that does not end. Default: the requests of the browser.
   */
  images?: StageImages;
}

/**
 * The view of the stage on screen. The bar reads the `StageView` part. The
 * stage reads all of it.
 */
export interface StageEngine extends StageView {
  subject: StageSubject;
  /** The mode that the subject allows. See `getStageMode`. */
  mode: ViewMode;
  images: StageImages;
  /** From the API, else from the mask after it is read. Empty until then. */
  regions: readonly ChangedRegion[];
  /**
   * Null until the pane has a size, and for a stage without an image. Draw
   * nothing that depends on it. `scale` is null in the same cases.
   */
  place: ViewPlace | null;
  pane: PaneMeasure | null;
  /** The part of the pane that the image uses at Fit, in pane pixels. */
  room: Box | null;
  /** True when a part of the image is outside the room. */
  pannable: boolean;
  /** True after a jump, so that the image moves with a short transition. */
  animated: boolean;
  /** The ref of the pane that the view measures. Every pane has its size. */
  setPane(element: HTMLElement | null): void;
  /** Moves the image. It returns false when the image is at its limit. */
  panBy(x: number, y: number): boolean;
  /** A free zoom by a factor about a point of the pane, for a pinch. */
  zoomBy(factor: number, anchor: Point): void;
  /** Zooms to a region, so that it takes about a third of the stage. */
  goTo(region: number): void;
}

const noRegions: readonly ChangedRegion[] = [];

/**
 * The view of the review stage for one variant.
 *
 * - The zoom level stays between variants and screenshots. The place starts
 *   again with each variant: Fit shows the whole image, a tall image opens on
 *   its first changed region, and a kept zoom opens on that region too.
 * - A browser with a floating bar over the stage gives the stage a clearance
 *   (`gutterBottom` of `ReviewStage`). An image that would reach under the
 *   bar then fits the room above it. A smaller image keeps the full stage.
 * @example
 * const stored = useStoredView();
 * const view = useStageView({ variant, mode: stored.mode });
 * <ReviewStage variant={variant} item={item} view={view} mode={stored.mode} mask={stored.mask} />
 */
export function useStageView({
  variant,
  mode: storedMode,
  expired = false,
  images: givenImages,
}: StageViewOptions): StageEngine {
  const subject = useMemo(() => getStageSubject(variant, expired), [variant, expired]);
  const mode = getStageMode(subject, storedMode);
  const browserImages = useStageImages(subject);
  const images = givenImages ?? browserImages;
  const regions = useRegions(subject.mask ? variant : null) ?? noRegions;
  const [setPane, pane] = usePaneMeasure();
  const [stored, setState] = useState<ViewState>({
    subjectId: subject.id,
    level: "fit",
    center: null,
    region: null,
    animated: false,
  });
  const restart = (state: ViewState): ViewState => {
    if (state.subjectId === subject.id) return state;
    return { ...state, subjectId: subject.id, center: null, region: null, animated: false };
  };
  let state = stored;
  if (stored.subjectId !== subject.id) {
    state = restart(stored);
    setState(state);
  }

  const { bounds } = subject;
  // A stage without an image has no place, no scale, and no zoom.
  const ready = !!pane && (!!subject.baseline || !!subject.current);
  const padding = pane?.padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const fullRoom: Box = {
    x: padding.left,
    y: padding.top,
    width: Math.max(1, (pane?.width ?? 0) - padding.left - padding.right),
    height: Math.max(1, (pane?.height ?? 0) - padding.top - padding.bottom),
  };
  const clearance = Math.min(pane?.clearance ?? 0, fullRoom.height / 2);
  const clearRoom: Box = { ...fullRoom, height: fullRoom.height - clearance };

  // The room and the scale of a level. An image that would reach under the
  // floating bar when it is in the middle of the stage uses the room above
  // the bar, so the bar covers no pixel at Fit.
  const getFrame = (level: ZoomLevel) => {
    const scale = getLevelScale(level, bounds, fullRoom);
    if (!clearance) return { room: fullRoom, scale };
    if (bounds.height * scale <= fullRoom.height - clearance * 2) return { room: fullRoom, scale };
    return { room: clearRoom, scale: getLevelScale(level, bounds, clearRoom) };
  };
  const fitScale = getFrame("fit").scale;
  const toLevel = (scale: number): ZoomLevel => {
    return Math.abs(scale - fitScale) < epsilon ? "fit" : scale;
  };

  // The first view of a variant. An image that is larger than the room opens
  // on its first changed region, not at its top, where the change can be out
  // of view. An image that fits shows whole, whatever the point is.
  const getHome = (level: ZoomLevel): Point => {
    const { room, scale } = getFrame(level);
    const first = regions[0];
    if (!first) return { x: bounds.width / 2, y: 0 };
    return getRegionAnchor(first, scale, room);
  };
  const resolve = (level: ZoomLevel, center: Point | null): ViewPlace => {
    const { room, scale } = getFrame(level);
    const point = center ?? getHome(level);
    return {
      scale,
      x: Math.round(placeAxis(point.x, bounds.width, room.x, room.width, scale)),
      y: Math.round(placeAxis(point.y, bounds.height, room.y, room.height, scale)),
    };
  };

  const { room } = getFrame(state.level);
  const place = resolve(state.level, state.center);

  // Each change starts from the newest state, so two events before a render
  // add up. The stored center is the one that the limits allow, so that a
  // pan against a limit does not add up out of sight.
  const update = (compute: (now: ViewPlace, state: ViewState) => ViewChange, animated: boolean) => {
    if (!ready) return;
    setState((previous) => {
      const base = restart(previous);
      const next = { ...base, ...compute(resolve(base.level, base.center), base), animated };
      const allowed = resolve(next.level, next.center);
      return { ...next, center: getCenter(allowed, getFrame(next.level).room) };
    });
  };
  const zoomAbout = (
    getScale: (now: ViewPlace) => number,
    anchor: Point | null,
    animated: boolean,
  ) => {
    update((now) => {
      const scale = getScale(now);
      const level = toLevel(scale);
      const frame = getFrame(level);
      const point = anchor ?? getBoxCenter(frame.room);
      const imagePoint = { x: (point.x - now.x) / now.scale, y: (point.y - now.y) / now.scale };
      const next = { scale, x: point.x - imagePoint.x * scale, y: point.y - imagePoint.y * scale };
      return { level, center: getCenter(next, frame.room) };
    }, animated);
  };

  // Fit has its place between the steps. Below 100%, no step is under Fit.
  const limit = Math.max(zoomSteps.at(-1) ?? 1, fitScale);
  const floor = Math.min(fitScale, 1);
  const ladder = [...new Set([fitScale, ...zoomSteps])]
    .filter((step) => step >= floor - epsilon)
    .sort((first, second) => first - second);
  const stepUp = ladder.find((step) => step > place.scale + epsilon);
  const stepDown = ladder.findLast((step) => step < place.scale - epsilon);
  const pannable =
    bounds.width * place.scale > room.width + 0.5 ||
    bounds.height * place.scale > room.height + 0.5;

  const focused = state.region == null ? undefined : regions[state.region];
  const goTo = (index: number) => {
    const region = regions[index];
    if (!region) return;
    update(() => {
      const fit = getFrame("fit");
      const wanted = Math.min(
        (fit.room.width * regionFill) / region.width,
        (fit.room.height * regionFill) / region.height,
      );
      const step = jumpSteps.findLast((value) => value <= wanted) ?? 1;
      const scale = Math.max(step, fit.scale);
      const level = toLevel(scale);
      return {
        level,
        center: getRegionAnchor(region, scale, getFrame(level).room),
        region: index,
      };
    }, true);
  };

  return {
    level: state.level,
    scale: ready ? place.scale : null,
    canZoomIn: ready && stepUp != null,
    canZoomOut: ready && stepDown != null,
    zoomIn: () => {
      if (stepUp == null) return;
      // The first zoom from an image that shows whole goes to the change.
      const target = focused ?? regions[0];
      if (!pannable && target) {
        update(() => {
          const level = toLevel(stepUp);
          return { level, center: getRegionAnchor(target, stepUp, getFrame(level).room) };
        }, true);
        return;
      }
      zoomAbout(() => stepUp, null, true);
    },
    zoomOut: () => {
      if (stepDown == null) return;
      zoomAbout(() => stepDown, null, true);
    },
    setLevel: (level) => {
      // One image pixel for each device pixel.
      const next = level === "actual" ? 1 / (window.devicePixelRatio || 1) : level;
      const target = focused ?? regions[0];
      update(() => {
        if (typeof next !== "number") return { level: next };
        const nextLevel = toLevel(next);
        // A zoom from an image that shows whole goes to the change.
        if (pannable || !target) return { level: nextLevel };
        return {
          level: nextLevel,
          center: getRegionAnchor(target, next, getFrame(nextLevel).room),
        };
      }, true);
    },
    regionCount: regions.length,
    region: focused ? state.region : null,
    goToRegion: (step) => {
      const count = regions.length;
      if (!count) return;
      const start = focused && state.region != null ? state.region : step > 0 ? -1 : 0;
      goTo((start + step + count) % count);
    },
    subject,
    mode,
    images,
    regions,
    place: ready ? place : null,
    pane,
    room: pane ? room : null,
    pannable: ready && pannable,
    animated: state.animated,
    setPane,
    panBy: (x, y) => {
      if (!ready) return false;
      const moved = resolve(
        state.level,
        getCenter({ ...place, x: place.x + x, y: place.y + y }, room),
      );
      if (moved.x === place.x && moved.y === place.y) return false;
      update((now, base) => {
        const frame = getFrame(base.level);
        return { center: getCenter({ ...now, x: now.x + x, y: now.y + y }, frame.room) };
      }, false);
      return true;
    },
    zoomBy: (factor, anchor) => {
      const getScale = (now: ViewPlace) => {
        return clamp(now.scale * factor, Math.min(floor, now.scale), Math.max(limit, now.scale));
      };
      zoomAbout(getScale, anchor, false);
    },
    goTo,
  };
}
