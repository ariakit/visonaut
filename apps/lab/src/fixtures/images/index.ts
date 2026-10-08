// Lab-only synthetic screenshots. Every image is an SVG data URI that a pure
// function builds. No page scenario uses them: the review runs have real
// Ariakit captures from `public/fixtures`. These scenes stay for sizes that
// production does not have, for example a tall page of 800 x 1600 pixels.

import type { ChangedRegion } from "../types.ts";
import { appearanceKey, getPalette } from "./palette.ts";
import type { Appearance } from "./palette.ts";
import type { SceneDefinition, SceneId } from "./scene.ts";
import { getScene } from "./scenes/index.ts";
import { element, group, rect, svgDocument, toDataUri } from "./svg.ts";

export { getPalette } from "./palette.ts";
export type { Appearance, Palette } from "./palette.ts";
export { sceneSizes } from "./scene.ts";
export type { ChangeKind, Dimensions, SceneDefinition, SceneId, SceneSize } from "./scene.ts";
export { getScene, scenes } from "./scenes/index.ts";

/**
 * - `baseline`: the reference image.
 * - `current`: the candidate image, with the regression of the scene.
 * - `diff`: the pixel mask. Opaque red where a pixel changed, transparent
 *   elsewhere. This is what the API serves as the diff image today.
 * - `diffPreview`: the mask over a faded copy of the current image.
 */
export type ScreenshotState = "baseline" | "current" | "diff" | "diffPreview";

export interface Screenshot {
  url: string;
  /** Natural width in pixels. */
  width: number;
  /** Natural height in pixels. */
  height: number;
}

export interface ScreenshotOptions extends Partial<Appearance> {
  scene: SceneId;
  /** Defaults to `baseline`. */
  state?: ScreenshotState;
}

export interface ScreenshotSet {
  scene: SceneDefinition;
  baseline: Screenshot;
  current: Screenshot;
  /** Null when the regression has no visible effect in this appearance. */
  diff: Screenshot | null;
  /** Null when the regression has no visible effect in this appearance. */
  diffPreview: Screenshot | null;
  /** Bounding boxes of the changed areas in current image pixels. */
  regions: ChangedRegion[];
  /** An estimate. A size change counts every pixel, as the real engine does. */
  changedPixels: number;
  /** `changedPixels` divided by all pixels of the current image. */
  ratio: number;
  /** True when baseline and current have different dimensions. */
  sizeChanged: boolean;
}

/** A data URI that always fails to load. Use it to design image error states. */
export const brokenImageUrl = "data:image/png;base64,AAAA";

const diffColor = "#ff0000";
const fadedOpacity = 0.18;

/**
 * The filter that turns the difference of two images into a mask. The matrix
 * moves the sum of the color differences into the alpha channel and paints the
 * pixel red. The transfer function has 25 steps of 0.04. It makes every pixel
 * whose sum is at least 0.08 fully opaque and drops the rest, like a
 * comparison threshold. A lower threshold marks single anti-aliased pixels
 * that the browser rasterizes differently in the two copies.
 */
function maskFilter(width: number, height: number): string {
  return element(
    "filter",
    {
      id: "mask",
      filterUnits: "userSpaceOnUse",
      x: 0,
      y: 0,
      width,
      height,
      "color-interpolation-filters": "sRGB",
    },
    element("feColorMatrix", { values: "0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 1 1 1 0 0" }) +
      element(
        "feComponentTransfer",
        {},
        element("feFuncA", { type: "discrete", tableValues: `0 0${" 1".repeat(23)}` }),
      ),
  );
}

function resolveAppearance(options: Partial<Appearance>): Appearance {
  return {
    scheme: options.scheme ?? "light",
    contrast: options.contrast ?? "no-preference",
    forcedColors: options.forcedColors ?? "none",
  };
}

function currentHeight(scene: SceneDefinition): number {
  return scene.changedHeight ?? scene.height;
}

function hasVisibleChange(scene: SceneDefinition, appearance: Appearance): boolean {
  return scene.visibleIn ? scene.visibleIn(getPalette(appearance)) : true;
}

function buildSvg(scene: SceneDefinition, appearance: Appearance, state: ScreenshotState): string {
  const palette = getPalette(appearance);
  const { width } = scene;
  if (state === "baseline") {
    const body = scene.render({ palette, changed: false, prefix: "a" });
    return svgDocument(width, scene.height, body);
  }
  const height = currentHeight(scene);
  const current = scene.render({ palette, changed: true, prefix: "b" });
  if (state === "current") {
    return svgDocument(width, height, current);
  }
  const paper = rect({ x: 0, y: 0, width, height, fill: "#ffffff" });
  // The real engine marks every pixel when the dimensions differ.
  if (height !== scene.height) {
    const everyPixel = rect({ x: 0, y: 0, width, height, fill: diffColor });
    if (state === "diff") {
      return svgDocument(width, height, everyPixel);
    }
    const fadedCopy = group(current, { opacity: fadedOpacity });
    return svgDocument(width, height, paper + fadedCopy + group(everyPixel, { opacity: 0.5 }));
  }
  const baseline = scene.render({ palette, changed: false, prefix: "a" });
  const regions = scene.regions.map((region) => rect({ ...region, fill: "#000000" })).join("");
  const definitions = element(
    "defs",
    {},
    group(baseline, { id: "a" }) +
      group(current, { id: "b" }) +
      maskFilter(width, height) +
      element("clipPath", { id: "regions" }, regions),
  );
  // The difference blend leaves black where both images match. Both images
  // blend over black, so the browser rasterizes them through the same kind of
  // offscreen layer. A direct draw can anti-alias thin strokes differently,
  // which would mark unchanged icons. The filter isolates the group, so the
  // blend never reaches the faded copy under it. The clip path applies after
  // the filter. It limits the mask to the declared regions, because a scaled
  // image can still differ by one stray pixel on an unchanged edge.
  const blended = "mix-blend-mode:difference";
  const mask = group(
    rect({ x: 0, y: 0, width, height, fill: "#000000" }) +
      element("use", { href: "#a", style: blended }) +
      element("use", { href: "#b", style: blended }),
    { filter: "url(#mask)", "clip-path": "url(#regions)" },
  );
  if (state === "diff") {
    return svgDocument(width, height, definitions + mask);
  }
  const fadedCopy = element("use", { href: "#b", opacity: fadedOpacity });
  return svgDocument(width, height, definitions + paper + fadedCopy + mask);
}

const cache = new Map<string, Screenshot>();

/** Returns one image of a scene. The result is cached and stable. */
export function getScreenshot({ scene: id, state = "baseline", ...rest }: ScreenshotOptions) {
  const appearance = resolveAppearance(rest);
  const key = `${id}:${appearanceKey(appearance)}:${state}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const scene = getScene(id);
  const screenshot: Screenshot = {
    url: toDataUri(buildSvg(scene, appearance, state)),
    width: scene.width,
    height: state === "baseline" ? scene.height : currentHeight(scene),
  };
  cache.set(key, screenshot);
  return screenshot;
}

/** Returns every state of a scene with its changed regions and metrics. */
export function getScreenshotSet({
  scene: id,
  ...rest
}: Omit<ScreenshotOptions, "state">): ScreenshotSet {
  const appearance = resolveAppearance(rest);
  const scene = getScene(id);
  const options = { scene: id, ...appearance };
  const baseline = getScreenshot({ ...options, state: "baseline" });
  const current = getScreenshot({ ...options, state: "current" });
  const sizeChanged = currentHeight(scene) !== scene.height;
  if (!hasVisibleChange(scene, appearance)) {
    return {
      scene,
      baseline,
      current: baseline,
      diff: null,
      diffPreview: null,
      regions: [],
      changedPixels: 0,
      ratio: 0,
      sizeChanged: false,
    };
  }
  const totalPixels = current.width * current.height;
  let changedPixels = totalPixels;
  if (!sizeChanged) {
    changedPixels = 0;
    for (const region of scene.regions) {
      changedPixels += Math.round(region.width * region.height * scene.density);
    }
  }
  return {
    scene,
    baseline,
    current,
    diff: getScreenshot({ ...options, state: "diff" }),
    diffPreview: getScreenshot({ ...options, state: "diffPreview" }),
    regions: scene.regions,
    changedPixels,
    ratio: changedPixels / totalPixels,
    sizeChanged,
  };
}
