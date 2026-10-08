import type { ChangedRegion } from "../types.ts";
import type { Palette } from "./palette.ts";

export type SceneId =
  | "button"
  | "checkbox"
  | "combobox"
  | "dialog"
  | "disclosure"
  | "form"
  | "menu"
  | "page"
  | "popover"
  | "select"
  | "table"
  | "tabs"
  | "toolbar"
  | "tooltip";

export type SceneSize = "small" | "medium" | "wide" | "tall";

export interface Dimensions {
  width: number;
  height: number;
}

export const sceneSizes: Record<SceneSize, Dimensions> = {
  small: { width: 320, height: 120 },
  medium: { width: 640, height: 400 },
  wide: { width: 1280, height: 720 },
  tall: { width: 800, height: 1600 },
};

/** The kind of regression that the current image of a scene shows. */
export type ChangeKind =
  | "shift"
  | "color"
  | "shadow"
  | "text"
  | "state"
  | "radius"
  | "focus-ring"
  | "alignment"
  | "size";

export interface SceneContext {
  palette: Palette;
  /** True to draw the regression (the current image). */
  changed: boolean;
  /**
   * Prefix for element identifiers. The diff image holds the baseline and the
   * current markup in one document, so their identifiers must differ.
   */
  prefix: string;
}

export interface SceneDefinition {
  id: SceneId;
  /** The component under test, for example `Dialog`. */
  title: string;
  size: SceneSize;
  width: number;
  height: number;
  /** The height of the current image when the regression changes the size. */
  changedHeight?: number;
  change: {
    kind: ChangeKind;
    /** One short sentence, for example `The popover lost its shadow.` */
    summary: string;
  };
  /** Bounding boxes of the regression in current image pixels. */
  regions: ChangedRegion[];
  /** The estimated share of region pixels that differ, from 0 to 1. */
  density: number;
  /** Returns false when the regression has no visible effect in a palette. */
  visibleIn?(palette: Palette): boolean;
  render(context: SceneContext): string;
}
