// The contract between the review page, the stage, and the bar. The page
// calls the two hooks and gives their results to both parts, so the stage and
// the bar never import each other.

import type { ViewerMode } from "../../../fixtures/index.ts";

/** The five modes of D-WORK-02. The mask is a switch, not a mode. */
export type ViewMode = Extract<ViewerMode, "new" | "original" | "side" | "swipe" | "overlay">;

export type ZoomLevel = "fit" | "width" | number;

/**
 * The zoom factors of the pick "Stepper with presets": 50 to 800%. The stage
 * steps through them, and the bar lists them in its preset menu.
 */
export const zoomSteps: readonly number[] = [0.5, 1, 2, 4, 8];

/** What the local storage keeps between screenshots, variants, and runs. */
export interface StoredView {
  mode: ViewMode;
  mask: boolean;
  setMode(mode: ViewMode): void;
  setMask(mask: boolean): void;
}

/** The zoom and the regions of the stage on screen. The bar reads it. */
export interface StageView {
  level: ZoomLevel;
  /**
   * The scale on screen, also at Fit. Null before the stage has a size, and
   * for a stage without an image.
   */
  scale: number | null;
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomIn(): void;
  zoomOut(): void;
  setLevel(level: ZoomLevel | "actual"): void;
  regionCount: number;
  region: number | null;
  goToRegion(step: 1 | -1): void;
}
