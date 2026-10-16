// The geometry of the boxes around the changed regions. Every function is
// pure. A box is in image pixels, so it follows each zoom as a share of the
// image.

import type { Box, Size } from "./geometry.ts";

/** A box is at least this large on screen, so a change of 1 px still shows. */
export const markSize = 24;

/** A region of more than this share of the image gets brackets, not a box. */
const largeShare = 0.4;

export function isLargeMark(region: Box, image: Size) {
  return region.width * region.height > image.width * image.height * largeShare;
}

function getGap(first: Box, second: Box) {
  const gapX = Math.max(first.x - (second.x + second.width), second.x - (first.x + first.width));
  const gapY = Math.max(first.y - (second.y + second.height), second.y - (first.y + first.height));
  return { gapX, gapY };
}

interface ExpandParams {
  start: number;
  length: number;
  padding: number;
  minimum: number;
  /** The length of the image on this axis. */
  limit: number;
}

function expand({ start, length, padding, minimum, limit }: ExpandParams) {
  const size = Math.min(Math.max(length + padding * 2, minimum), limit);
  const centered = start + length / 2 - size / 2;
  return { start: Math.min(Math.max(centered, 0), limit - size), size };
}

export interface MarkRectOptions {
  /** Screen pixels for one image pixel. */
  scale: number;
  /** The space between the region and the line of its box, in screen pixels. */
  padding?: number;
}

/**
 * The boxes of the regions in image pixels. A box is centered on its region
 * and is at least 24 screen pixels large. It stays inside the image, and it
 * gives way where it would cross the box of a neighbor.
 */
export function getMarkRects(
  regions: readonly Box[],
  image: Size,
  { scale, padding = 4 }: MarkRectOptions,
): Box[] {
  const rects = regions.map((region) => {
    const horizontal = expand({
      start: region.x,
      length: region.width,
      padding: padding / scale,
      minimum: markSize / scale,
      limit: image.width,
    });
    const vertical = expand({
      start: region.y,
      length: region.height,
      padding: padding / scale,
      minimum: markSize / scale,
      limit: image.height,
    });
    return {
      x: horizontal.start,
      y: vertical.start,
      width: horizontal.size,
      height: vertical.size,
    };
  });
  // One screen pixel stays free at each side of the line between two boxes.
  const space = 1 / scale;
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const first = rects[i];
      const second = rects[j];
      const firstRegion = regions[i];
      const secondRegion = regions[j];
      if (!first || !second || !firstRegion || !secondRegion) continue;
      const overlap = getGap(first, second);
      if (overlap.gapX >= space * 2) continue;
      if (overlap.gapY >= space * 2) continue;
      // The boxes part on the axis where their regions lie farther apart.
      const { gapX, gapY } = getGap(firstRegion, secondRegion);
      if (gapX >= gapY) {
        const firstLeads = firstRegion.x < secondRegion.x;
        const [before, after] = firstLeads ? [first, second] : [second, first];
        const [beforeRegion, afterRegion] = firstLeads
          ? [firstRegion, secondRegion]
          : [secondRegion, firstRegion];
        const middle = (beforeRegion.x + beforeRegion.width + afterRegion.x) / 2;
        const afterEnd = after.x + after.width;
        before.width = Math.max(middle - space - before.x, 0);
        after.x = middle + space;
        after.width = Math.max(afterEnd - after.x, 0);
        continue;
      }
      const firstLeads = firstRegion.y < secondRegion.y;
      const [before, after] = firstLeads ? [first, second] : [second, first];
      const [beforeRegion, afterRegion] = firstLeads
        ? [firstRegion, secondRegion]
        : [secondRegion, firstRegion];
      const middle = (beforeRegion.y + beforeRegion.height + afterRegion.y) / 2;
      const afterEnd = after.y + after.height;
      before.height = Math.max(middle - space - before.y, 0);
      after.y = middle + space;
      after.height = Math.max(afterEnd - after.y, 0);
    }
  }
  return rects;
}

/** A box as a share of the image, for the style of a child of the image box. */
export function toShare(rect: Box, image: Size) {
  return {
    left: `${(rect.x / image.width) * 100}%`,
    top: `${(rect.y / image.height) * 100}%`,
    width: `${(rect.width / image.width) * 100}%`,
    height: `${(rect.height / image.height) * 100}%`,
  };
}
