import { useEffect, useState } from "react";
import type { ChangedRegion, ViewerMode, ViewerZoom } from "../types.ts";

/**
 * What marks the changed pixels on top of an image, in any mode.
 *
 * - `mask`: the red pixel mask (`variant.diff`).
 * - `regions`: one box around each changed area (`variant.regions`).
 */
export type ViewerHighlight = "none" | "mask" | "regions";

export type ViewerSide = "reference" | "candidate";

/** The images of one comparison. A `ReviewVariant` fits this shape. */
export interface ViewerSubject {
  /** A change of this value clears the focused region. */
  id?: string;
  /** The baseline image, or null when the screenshot is new. */
  reference: object | null;
  /** The new image, or null when the screenshot was removed. */
  candidate: object | null;
  /** Not in the API today. Without regions, `regionCount` is 0. */
  regions?: ChangedRegion[];
}

export interface ViewerOptions {
  /** The first mode. Defaults to `side`, as in the app. */
  mode?: ViewerMode;
  /** The first zoom. Defaults to `fit`, as in the app. */
  zoom?: ViewerZoom;
  /** Defaults to `none`. */
  highlight?: ViewerHighlight;
  /** From 0 to 1. Defaults to 0.6. */
  overlayOpacity?: number;
  /** From 0 to 1. Defaults to 0.5. */
  swipePosition?: number;
  /** Milliseconds for each side in `blink` mode. Defaults to 700. */
  blinkInterval?: number;
}

/** Every mode: the four of the app, then the modes that only the lab has. */
export const viewerModes: ViewerMode[] = [
  "side",
  "diff",
  "new",
  "original",
  "overlay",
  "swipe",
  "blink",
];

/**
 * Every zoom, from small to large. The app has `fit`, `1`, and `2`. Nine of
 * ten production images are small card crops: `getFitZoom` gives the largest
 * whole-number zoom at which an image fits a stage.
 */
export const viewerZooms: ViewerZoom[] = ["fit", 0.5, 1, 2, 3, 4];

export interface Viewer {
  /** The mode that the person chose. */
  mode: ViewerMode;
  /**
   * The mode to render. It is `side` when the chosen mode needs an image that
   * this variant does not have, for example `diff` on a new screenshot.
   */
  effectiveMode: ViewerMode;
  /** The modes that the current images support. */
  available: Record<ViewerMode, boolean>;
  zoom: ViewerZoom;
  /** The zoom as a factor. Null for `fit`. */
  scale: number | null;
  /** `overlay` mode: the opacity of the layer on top, from 0 to 1. */
  overlayOpacity: number;
  /** `swipe` mode: the divider position from the start edge, from 0 to 1. */
  swipePosition: number;
  /** `blink` mode: the image that shows now. It alternates by itself. */
  blinkSide: ViewerSide;
  blinkPaused: boolean;
  blinkInterval: number;
  highlight: ViewerHighlight;
  /** The index of the focused changed region, or null. */
  region: number | null;
  regionCount: number;
  /** Ignored when the current images do not support the mode. */
  setMode(mode: ViewerMode): void;
  setZoom(zoom: ViewerZoom): void;
  /** One step up. From `fit`, the next step is 100%. */
  zoomIn(): void;
  /** One step down. Below 50%, the next step is `fit`. */
  zoomOut(): void;
  setOverlayOpacity(opacity: number): void;
  setSwipePosition(position: number): void;
  setBlinkPaused(paused: boolean): void;
  setBlinkInterval(milliseconds: number): void;
  /** Shows the other image in `blink` mode, for a manual blink. */
  flipBlink(): void;
  setHighlight(highlight: ViewerHighlight): void;
  /** Turns the highlight off, or back on with the last kind. */
  toggleHighlight(): void;
  setRegion(region: number | null): void;
  /** Focuses the next changed region and wraps at the end. */
  nextRegion(): void;
  previousRegion(): void;
}

interface ViewerState {
  subjectId: string | undefined;
  mode: ViewerMode;
  zoom: ViewerZoom;
  overlayOpacity: number;
  swipePosition: number;
  blinkSide: ViewerSide;
  blinkPaused: boolean;
  blinkInterval: number;
  highlight: ViewerHighlight;
  lastHighlight: Exclude<ViewerHighlight, "none">;
  region: number | null;
}

const zoomFactors = [0.5, 1, 2, 3, 4] as const;

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function getAvailableModes(subject: ViewerSubject | null | undefined): Record<ViewerMode, boolean> {
  const reference = Boolean(subject?.reference);
  const candidate = Boolean(subject?.candidate);
  const both = reference && candidate;
  return {
    side: reference || candidate,
    diff: both,
    new: candidate,
    original: reference,
    overlay: both,
    swipe: both,
    blink: both,
  };
}

/**
 * The state of a screenshot viewer as plain values: mode, zoom, and the
 * controls of the compare techniques. It draws nothing and reads no element.
 * `useReviewSession` returns one as `viewer`. Use this hook directly in a
 * component surface that has no review session.
 */
export function useViewer(subject?: ViewerSubject | null, options: ViewerOptions = {}): Viewer {
  const [state, setState] = useState<ViewerState>(() => {
    const highlight = options.highlight ?? "none";
    return {
      subjectId: subject?.id,
      mode: options.mode ?? "side",
      zoom: options.zoom ?? "fit",
      overlayOpacity: clamp(options.overlayOpacity ?? 0.6),
      swipePosition: clamp(options.swipePosition ?? 0.5),
      blinkSide: "reference",
      blinkPaused: false,
      blinkInterval: options.blinkInterval ?? 700,
      highlight,
      lastHighlight: highlight === "none" ? "mask" : highlight,
      region: null,
    };
  });
  // Mode and zoom stay with the person across variants, as in the app. The
  // focused region belongs to one image.
  if (state.subjectId !== subject?.id) {
    setState({ ...state, subjectId: subject?.id, region: null });
  }

  const available = getAvailableModes(subject);
  const effectiveMode = available[state.mode] ? state.mode : "side";
  const regionCount = subject?.regions?.length ?? 0;
  const blinking = effectiveMode === "blink" && !state.blinkPaused;

  useEffect(() => {
    if (!blinking) return;
    const interval = setInterval(() => {
      setState((current) => ({
        ...current,
        blinkSide: current.blinkSide === "reference" ? "candidate" : "reference",
      }));
    }, state.blinkInterval);
    return () => clearInterval(interval);
  }, [blinking, state.blinkInterval]);

  const update = (patch: Partial<ViewerState>) => {
    setState((current) => ({ ...current, ...patch }));
  };
  const stepRegion = (step: 1 | -1) => {
    if (!regionCount) return;
    setState((current) => {
      const start = current.region ?? (step > 0 ? -1 : 0);
      return { ...current, region: (start + step + regionCount) % regionCount };
    });
  };

  return {
    mode: state.mode,
    effectiveMode,
    available,
    zoom: state.zoom,
    scale: state.zoom === "fit" ? null : state.zoom,
    overlayOpacity: state.overlayOpacity,
    swipePosition: state.swipePosition,
    blinkSide: state.blinkSide,
    blinkPaused: state.blinkPaused,
    blinkInterval: state.blinkInterval,
    highlight: state.highlight,
    region: state.region != null && state.region < regionCount ? state.region : null,
    regionCount,
    setMode: (mode) => {
      if (!available[mode]) return;
      update({ mode });
    },
    setZoom: (zoom) => update({ zoom }),
    zoomIn: () => {
      setState((current) => {
        const index = current.zoom === "fit" ? 0 : zoomFactors.indexOf(current.zoom);
        return { ...current, zoom: zoomFactors[index + 1] ?? current.zoom };
      });
    },
    zoomOut: () => {
      setState((current) => {
        if (current.zoom === "fit") return current;
        const index = zoomFactors.indexOf(current.zoom);
        return { ...current, zoom: zoomFactors[index - 1] ?? "fit" };
      });
    },
    setOverlayOpacity: (opacity) => update({ overlayOpacity: clamp(opacity) }),
    setSwipePosition: (position) => update({ swipePosition: clamp(position) }),
    setBlinkPaused: (blinkPaused) => update({ blinkPaused }),
    setBlinkInterval: (blinkInterval) => update({ blinkInterval: Math.max(100, blinkInterval) }),
    flipBlink: () => {
      setState((current) => ({
        ...current,
        blinkSide: current.blinkSide === "reference" ? "candidate" : "reference",
      }));
    },
    setHighlight: (highlight) => {
      update(highlight === "none" ? { highlight } : { highlight, lastHighlight: highlight });
    },
    toggleHighlight: () => {
      setState((current) => ({
        ...current,
        highlight: current.highlight === "none" ? current.lastHighlight : "none",
      }));
    },
    setRegion: (region) => update({ region }),
    nextRegion: () => stepRegion(1),
    previousRegion: () => stepRegion(-1),
  };
}
