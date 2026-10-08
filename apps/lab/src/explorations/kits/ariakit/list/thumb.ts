// What the picture of a row shows: the variant to picture, the images to try
// in order, and the crop around the largest changed region. The pictures are
// the stored images of the run. No thumbnail field is necessary.

import type { SessionItem, SessionVariant } from "../../../../fixtures/hooks/index.ts";
import { isSizeChange } from "../../../../fixtures/index.ts";
import type { ChangedRegion, ReviewImage } from "../../../../fixtures/index.ts";

/** Width divided by height of the picture box: 6em by 4em. */
const thumbAspect = 3 / 2;

// The width of the box in CSS pixels at the default look, for the zoom limit
// of a crop. The box itself is sized in em.
const nominalWidth = 84;

/** The share of the box width that the changed region takes. */
const regionShare = 0.5;

/** A crop never shows an image pixel larger than this many CSS pixels. */
const maximumZoom = 2;

/** The place of an image in the picture box, in percent of the box. */
export interface ThumbCrop {
  width: string;
  left: string;
  top: string;
}

export interface ThumbLayer {
  image: ReviewImage;
  crop: ThumbCrop;
}

/** One picture to try. When its first layer does not load, the next view is tried. */
export interface ThumbView {
  id: string;
  /** The picture, and an optional mask over it. */
  layers: ThumbLayer[];
  /** A removed screenshot shows its baseline at half strength. */
  faded?: boolean;
}

function toPercent(value: number): string {
  return `${Math.round(value * 10000) / 100}%`;
}

interface PlaceParams {
  /** The scaled size of the image on one axis. */
  size: number;
  /** The size of the box on that axis. */
  box: number;
  /** The scaled position that the box centers on. */
  focus: number;
}

function place({ size, box, focus }: PlaceParams): number {
  // A smaller image sits in the middle. A larger one never leaves a gap.
  if (size <= box) return (box - size) / 2;
  return Math.min(0, Math.max(box - size, box / 2 - focus));
}

/**
 * The crop of an image for the picture box. Without a region, the image
 * covers the box from its top left corner, where a card has its heading. With
 * a region, the image is enlarged so that the region takes about half of the
 * box width, and the region is in the middle.
 */
export function getCrop(image: ReviewImage, region?: ChangedRegion): ThumbCrop {
  const boxWidth = nominalWidth;
  const boxHeight = nominalWidth / thumbAspect;
  const cover = Math.max(boxWidth / image.width, boxHeight / image.height);
  let scale = cover;
  if (region) {
    const byWidth = (boxWidth * regionShare) / region.width;
    const byHeight = (boxHeight * 0.7) / region.height;
    scale = Math.max(cover, Math.min(byWidth, byHeight, maximumZoom));
  }
  const width = image.width * scale;
  const height = image.height * scale;
  const focusX = region ? (region.x + region.width / 2) * scale : 0;
  const focusY = region ? (region.y + region.height / 2) * scale : 0;
  return {
    width: toPercent(width / boxWidth),
    left: toPercent(place({ size: width, box: boxWidth, focus: focusX }) / boxWidth),
    top: toPercent(place({ size: height, box: boxHeight, focus: focusY }) / boxHeight),
  };
}

/**
 * The variant that the picture shows: the first one that needs review, else
 * the first one that is not unchanged, else the first one.
 */
export function getSubject(item: SessionItem): SessionVariant | undefined {
  const waiting = item.variants.find((variant) => variant.status === "needs-review");
  if (waiting) return waiting;
  return item.variants.find((variant) => variant.status !== "unchanged") ?? item.variants[0];
}

/**
 * The region that a crop centers on: the largest one, and the first one of
 * equal regions. The first region of a mask can be a single stray pixel.
 */
function getMainRegion(regions: readonly ChangedRegion[] | undefined): ChangedRegion | undefined {
  let main: ChangedRegion | undefined;
  for (const region of regions ?? []) {
    if (!main || region.width * region.height > main.width * main.height) {
      main = region;
    }
  }
  return main;
}

function fitView(id: string, image: ReviewImage | null, faded?: boolean): ThumbView[] {
  if (!image) return [];
  return [{ id, layers: [{ image, crop: getCrop(image) }], ...(faded ? { faded } : {}) }];
}

/**
 * The pictures of a variant, best first. A changed variant shows its current
 * image with the stored mask over it, as a crop around the largest changed
 * region. The baseline is the fallback when the current image does not load.
 * A failed comparison has no picture. `regions` are the regions of the API,
 * or the regions that the browser read from the mask (`regions.ts`).
 *
 * The row never uses the `diffPreview` of the proposed API: that picture has
 * a faded copy of the screenshot, and a crop of it is hard to read at this
 * size. So the row is the same in every data mode.
 */
export function getThumbViews(
  variant: SessionVariant | undefined,
  regions: readonly ChangedRegion[] | undefined,
): ThumbView[] {
  if (!variant) return [];
  const { reference, candidate, diff } = variant;
  if (variant.kind === "error") return [];
  if (variant.kind === "removed") return fitView("baseline", reference, true);
  if (variant.kind !== "changed" || isSizeChange(variant)) {
    const views = fitView("current", candidate);
    // An unchanged variant has one image object for both sides.
    if (reference !== candidate) {
      views.push(...fitView("baseline", reference));
    }
    return views;
  }
  const region = getMainRegion(regions);
  const views: ThumbView[] = [];
  if (candidate) {
    const layers = [{ image: candidate, crop: getCrop(candidate, region) }];
    if (diff) {
      layers.push({ image: diff, crop: getCrop(diff, region) });
    }
    views.push({ id: "current", layers });
  }
  if (reference) {
    views.push({
      id: "baseline",
      layers: [{ image: reference, crop: getCrop(reference, region) }],
    });
  }
  return views;
}
