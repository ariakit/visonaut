// The shapes that the list and the variant control read: a screenshot and a
// variant of a review session, with the fields that the page derives from the
// run model (`review/model.ts`). The page builds them. The kit only reads
// them, so the same parts work for each page that has a session.

import type { ReviewItem, ReviewVariant } from "../../review/model.ts";
import type { ReviewStatus } from "./status.tsx";

export type Framework = "react" | "solid";
export type Browser = "chromium" | "firefox" | "webkit";
export type ColorScheme = "light" | "dark";
export type Contrast = "more" | "no-preference";
export type ForcedColors = "active" | "none";

/**
 * The axes of one variant as typed values. The five fixed axes come from the
 * label parts of the run model. The viewport and the style are inside the
 * variant key only.
 */
export interface VariantAxes {
  framework: Framework;
  browser: Browser;
  colorScheme: ColorScheme;
  contrast: Contrast;
  forcedColors: ForcedColors;
  /** `desktop`, `wide`, `narrow`, `mobile`, or `default`. */
  viewport?: string;
  /** `light`, `dark`, or `default`. */
  style?: string;
}

export type VariantAxisName = keyof VariantAxes;

/** A rectangle in the pixel space of the candidate image. */
export interface ChangedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SessionVariant extends ReviewVariant {
  itemKey: string;
  /** The position in the screenshot, from 0. */
  index: number;
  /**
   * The short label: only the axes that differ inside the screenshot, for
   * example `Chromium · Dark`. `label` is the long text.
   */
  name: string;
  axes: VariantAxes;
  status: ReviewStatus;
  /** True when the service approved the variant, not a person. */
  automatic: boolean;
  /**
   * The changed regions, when the service sends them. Without them, the
   * browser reads the regions from the mask (`regions.ts`).
   */
  regions?: ChangedRegion[];
}

export interface SessionItem extends Omit<ReviewItem, "variants"> {
  /** A readable name, for example `Segmented control`. */
  label: string;
  /** The first segment of the key. */
  family: string;
  /** The segments between the family and the last one. Absent for two segments. */
  group?: string;
  variants: SessionVariant[];
  status: ReviewStatus;
}

/** The order of the axes in a label. */
export const variantAxisOrder: readonly VariantAxisName[] = [
  "framework",
  "browser",
  "viewport",
  "colorScheme",
  "style",
  "contrast",
  "forcedColors",
];

/** `segmented-control` gives `Segmented control`. */
function formatKeySegment(segment: string): string {
  const words = segment.replaceAll("-", " ").replaceAll("_", " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// An empty word is the normal case: no contrast preference, no forced colors,
// and the default viewport and style.
const axisWords: Partial<Record<VariantAxisName, Record<string, string>>> = {
  framework: { react: "React", solid: "Solid" },
  browser: { chromium: "Chromium", firefox: "Firefox", webkit: "WebKit" },
  colorScheme: { light: "Light", dark: "Dark" },
  contrast: { more: "More contrast", "no-preference": "" },
  forcedColors: { active: "Forced colors", none: "" },
  viewport: { default: "" },
  style: { default: "", light: "Light style", dark: "Dark style" },
};

function formatAxisValue(axis: VariantAxisName, value: string | undefined): string {
  if (value == null) return "";
  return axisWords[axis]?.[value] ?? formatKeySegment(value);
}

/**
 * The words of a variant for the given axes, without empty words. Without
 * axes, it lists every axis: `React · Chromium · Desktop · Light`.
 */
export function getVariantWords(
  variant: Pick<SessionVariant, "axes">,
  axes: readonly VariantAxisName[] = variantAxisOrder,
): string[] {
  const words: string[] = [];
  for (const axis of variantAxisOrder) {
    if (!axes.includes(axis)) continue;
    // The style repeats the color scheme for almost every screenshot.
    if (
      axis === "style" &&
      axes.includes("colorScheme") &&
      variant.axes.style === variant.axes.colorScheme
    ) {
      continue;
    }
    const word = formatAxisValue(axis, variant.axes[axis]);
    if (word) {
      words.push(word);
    }
  }
  return words;
}

/**
 * True when the baseline and the current image have different dimensions. The
 * service then sends no mask, `ratio` is 1, and `changedPixels` is the number
 * of all pixels, so the line "100% changed" is wrong.
 */
export function isSizeChange({
  reference,
  candidate,
}: Pick<ReviewVariant, "reference" | "candidate">): boolean {
  if (!reference || !candidate) return false;
  return reference.width !== candidate.width || reference.height !== candidate.height;
}
