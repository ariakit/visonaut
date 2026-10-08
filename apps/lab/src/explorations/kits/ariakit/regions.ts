// The one reader of changed regions. The service sends the mask of a change
// and no regions (D-UX-04), so the browser reads the regions from the mask
// image. The stage, the list row, and the cover all read them here, so each
// mask of the document is loaded and scanned one time.

import { useEffect, useSyncExternalStore } from "react";
import type { ChangedRegion, ReviewVariant } from "../../../fixtures/index.ts";

/** The two fields of a variant that give its regions. */
export type RegionSource = Pick<ReviewVariant, "regions" | "diff">;

// One entry for each mask URL of the document.
const regionsByMask = new Map<string, readonly ChangedRegion[]>();
const requested = new Set<string>();
const listeners = new Set<() => void>();
// The version of a store with no mask, which is also the version of the
// server: the server reads no mask.
const emptyVersion = 0;
let version = emptyVersion;

// Changed pixels that lie at most this far apart are one region, as in the
// regions that the proposed API sends. The mask is read in cells of this
// size.
const cellSize = 8;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getVersion() {
  return version;
}

// The server and the first browser render agree: no mask is read yet.
function getServerVersion() {
  return emptyVersion;
}

function settle(url: string, regions: readonly ChangedRegion[]) {
  regionsByMask.set(url, regions);
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

interface CellBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The regions of a mask: one box around each group of painted pixels. Two
 * groups are one region when their cells touch, also at a corner. The result
 * is in image pixels, from top to bottom.
 */
export function findMaskRegions(pixels: Uint8ClampedArray, width: number, height: number) {
  const columns = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const cells = new Map<number, CellBox>();
  // Phase 1: the box of the painted pixels of each cell. A pixel has four
  // bytes, and the last one is its alpha.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pixels[(y * width + x) * 4 + 3]) continue;
      const index = Math.floor(y / cellSize) * columns + Math.floor(x / cellSize);
      const box = cells.get(index);
      if (!box) {
        cells.set(index, { left: x, top: y, right: x, bottom: y });
        continue;
      }
      box.left = Math.min(box.left, x);
      box.right = Math.max(box.right, x);
      box.bottom = y;
    }
  }
  // Phase 2: join the cells that touch, and take the box of each group.
  const regions: ChangedRegion[] = [];
  const seen = new Set<number>();
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    const group: CellBox = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (let next = queue.pop(); next != null; next = queue.pop()) {
      const box = cells.get(next);
      if (!box) continue;
      group.left = Math.min(group.left, box.left);
      group.top = Math.min(group.top, box.top);
      group.right = Math.max(group.right, box.right);
      group.bottom = Math.max(group.bottom, box.bottom);
      const column = next % columns;
      const row = Math.floor(next / columns);
      for (let rowStep = -1; rowStep <= 1; rowStep++) {
        for (let columnStep = -1; columnStep <= 1; columnStep++) {
          const nearColumn = column + columnStep;
          const nearRow = row + rowStep;
          if (nearColumn < 0 || nearColumn >= columns) continue;
          if (nearRow < 0 || nearRow >= rows) continue;
          const near = nearRow * columns + nearColumn;
          if (seen.has(near)) continue;
          if (!cells.has(near)) continue;
          seen.add(near);
          queue.push(near);
        }
      }
    }
    regions.push({
      x: group.left,
      y: group.top,
      width: group.right - group.left + 1,
      height: group.bottom - group.top + 1,
    });
  }
  return regions.sort((first, second) => first.y - second.y || first.x - second.x);
}

function readMask(url: string) {
  if (requested.has(url)) return;
  requested.add(url);
  const image = new Image();
  image.addEventListener("error", () => settle(url, []));
  image.addEventListener("load", () => {
    const { naturalWidth: width, naturalHeight: height } = image;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || !width || !height) {
      settle(url, []);
      return;
    }
    context.drawImage(image, 0, 0);
    try {
      settle(url, findMaskRegions(context.getImageData(0, 0, width, height).data, width, height));
    } catch {
      // A mask of another origin without CORS headers cannot be read. The
      // variant then has no regions: a crop shows the whole picture.
      settle(url, []);
    }
  });
  image.src = url;
}

export type RegionLookup = (variant: RegionSource) => readonly ChangedRegion[] | undefined;

/**
 * The changed regions of variants: the regions of the API when it sends
 * them, else the regions that the browser reads from the mask. The result is
 * undefined until the mask is read, and for a variant without a mask. An
 * empty list means that the mask has no painted pixel, or cannot be read.
 * @example
 * const getRegions = useRegionLookup(item.variants);
 * const regions = getRegions(variant);
 */
export function useRegionLookup(variants: readonly RegionSource[]): RegionLookup {
  // The version of the store renders the caller again when a mask is read.
  const seenVersion = useSyncExternalStore(subscribe, getVersion, getServerVersion);
  const urls = variants
    .filter((variant) => !variant.regions && variant.diff)
    .map((variant) => variant.diff?.url ?? "")
    .join("\n");
  useEffect(() => {
    if (!urls) return;
    for (const url of urls.split("\n")) {
      readMask(url);
    }
  }, [urls]);
  return (variant) => {
    if (variant.regions) return variant.regions;
    if (!variant.diff) return undefined;
    // While the browser takes over the server markup, this render has the
    // version of the server. Another part of the document can have read the
    // mask by then, and the store must not show it to this render.
    if (seenVersion === emptyVersion) return undefined;
    return regionsByMask.get(variant.diff.url);
  };
}

/**
 * The changed regions of one variant. See `useRegionLookup`.
 * @example
 * const regions = useRegions(variant);
 */
export function useRegions(variant: RegionSource | null | undefined) {
  const getRegions = useRegionLookup(variant ? [variant] : []);
  return variant ? getRegions(variant) : undefined;
}
