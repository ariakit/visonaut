// The shapes of the generated data in `census.ts` and `changes.ts`. The rows
// are tuples, so the two modules stay small. `generate.mjs` writes them.

/** Path under `/fixtures/`, width, height. */
export type CensusImage = [path: string, width: number, height: number];

/**
 * One distinct variant key of the Ariakit consumer with the values that the
 * consumer joins into it. `browser` is the engine name that the API sends
 * (`chromium`, `firefox`, `webkit`). The key has the project name instead
 * (`chrome`, `firefox`, `safari`).
 */
export type CensusVariantKey = [
  key: string,
  framework: string,
  browser: string,
  viewport: string,
  style: string,
  colorScheme: string,
  contrast: string,
  forcedColors: string,
];

/**
 * The variants of an item: indexes of `variantKeys`, then for each variant the
 * position of its image in the image list of the item.
 */
export type CensusShape = [keys: number[], slots: number[]];

/** Key, index of `shapes`, then the indexes of `images` that the item uses. */
export type CensusItem = [key: string, shape: number, ...images: number[]];

/**
 * - 0: changed.
 * - 1: added.
 * - 2: removed.
 * - 3: unchanged, and the new image was not uploaded.
 */
export type ChangeKindCode = 0 | 1 | 2 | 3;

export type ChangeRow = [
  item: number,
  variant: number,
  kind: number,
  /** The current image, or -1. */
  candidate: number,
  /** The mask image, or -1. */
  mask: number,
  /** The diff preview image, or -1. */
  preview: number,
  changedPixels: number,
  /** The verdict of a person: 0 none, 1 approved, 2 rejected. */
  verdict: number,
];

export type ChangeSetName = "typical" | "token" | "browser" | "mixed" | "probes";

export interface ChangeSet {
  /** The scenario name in the audit data. */
  source: string;
  run: { id: string; comparisonId: string; testedSha: string };
  /** Items that the census does not have: a new card, or a lab-only size. */
  extraItems: CensusItem[];
  changes: ChangeRow[];
}
