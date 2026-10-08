// Builds review items from the generated census: the 626 screenshots and the
// 3,832 variants of a production run. The unchanged items are built one time
// for each data mode and every run shares them, so a run costs only its
// changed items.

import { formatKeySegment, splitItemKey } from "../derive.ts";
import { images, items as censusItems, shapes, titles, variantKeys } from "../real/census.ts";
import { maskRegions } from "../real/changes.ts";
import type { CensusItem } from "../real/types.ts";
import type {
  Browser,
  ChangedRegion,
  ColorScheme,
  Contrast,
  DataMode,
  ForcedColors,
  Framework,
  ReviewImage,
  ReviewItem,
  ReviewVariant,
  ReviewVariantPart,
  ReviewVerdict,
  User,
  VariantAxes,
  VariantKind,
} from "../types.ts";

// The values that production sends for a run of the local comparison path.
const engine = "playwright-pixelmatch-1.63.0";
const codec = "pngjs-7.0.0";
// The digest of `{"threshold":0.2,"maxDiffPixels":0}`.
const policy = "dbef2aa4ac25a1b6c859087a1100054b17bdd349512579571f0b939d6fdb0d2b";
// The server joins three parts. The Ariakit consumer sets no ratio, so the
// sentence ends with the separator.
const threshold = "Color threshold 0.2; maximum 0 pixels; ";

// Variant identifiers have the production form: comparison identifier, run
// identifier, and the digest of the capture. The two UUIDs are the same in
// every scenario, so that all runs can share their unchanged variants.
const idPrefix = "9bb0a53b-93f9-4130-898e-2b9bb79b953f:7f761661-571e-44bd-8aa3-7588073fa858:";

/** The number of screenshots in the census. */
export const censusItemCount = censusItems.length;

// ---------------------------------------------------------------------------
// Identifiers and images
// ---------------------------------------------------------------------------

/** The finalizer of MurmurHash3: spreads a 32-bit integer over all bits. */
function scramble(value: number): number {
  let result = value | 0;
  result = Math.imul(result ^ (result >>> 16), 0x85ebca6b);
  result = Math.imul(result ^ (result >>> 13), 0xc2b2ae35);
  return (result ^ (result >>> 16)) >>> 0;
}

/**
 * Sixty-four hexadecimal characters for a seed. The fixtures need about
 * 4,000 of them for one run, so this is much cheaper than a string hash.
 */
function digest(seed: number): string {
  let result = "";
  for (let word = 0; word < 8; word += 1) {
    result += scramble(seed * 8 + word + 0x9e3779b9)
      .toString(16)
      .padStart(8, "0");
  }
  return result;
}

/** The digest moved by a number of characters, as another digest. */
function rotate(value: string, by: number): string {
  return value.slice(by) + value.slice(0, by);
}

function toUuid(value: string): string {
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

/** The URL of a file under `public/fixtures`. */
export function fixtureUrl(path: string): string {
  return `/fixtures/${path}`;
}

/**
 * The URL of the small copy of a fixture image: at most 160 pixels on its
 * longest side. Every baseline and current image has one. A mask has none.
 */
export function getThumbnailUrl(image: Pick<ReviewImage, "url">): string {
  return image.url.replace("/fixtures/", "/fixtures/thumbnails/");
}

/** An image object for a file of the generated image table. */
export function createImage(index: number, seed: string): ReviewImage {
  const row = images[index];
  if (!row) throw new Error(`The fixture image ${index} does not exist.`);
  const [path, width, height] = row;
  return { id: toUuid(seed), url: fixtureUrl(path), digest: rotate(seed, 32), width, height };
}

// ---------------------------------------------------------------------------
// Variant keys
// ---------------------------------------------------------------------------

interface VariantTemplate {
  key: string;
  label: string;
  labelParts: ReviewVariantPart[];
  axes: VariantAxes;
}

// The generated values are plain strings. These guards keep the typed axes
// honest without a cast.
function toFramework(value: string): Framework {
  return value === "solid" ? "solid" : "react";
}

function toBrowser(value: string): Browser {
  return value === "firefox" || value === "webkit" ? value : "chromium";
}

function toColorScheme(value: string): ColorScheme {
  return value === "dark" ? "dark" : "light";
}

function toContrast(value: string): Contrast {
  return value === "more" ? "more" : "no-preference";
}

function toForcedColors(value: string): ForcedColors {
  return value === "active" ? "active" : "none";
}

let templates: VariantTemplate[] | undefined;

/** One shared template for each of the 66 distinct variant keys. */
function getTemplates(): VariantTemplate[] {
  templates ??= variantKeys.map(
    ([key, framework, browser, viewport, style, colorScheme, contrast, forcedColors]) => {
      // The label of `apps/web/src/api/review.ts`: five fixed fields, then
      // the key. It does not read the viewport or the style.
      const labelParts: ReviewVariantPart[] = [
        { kind: "framework", value: framework },
        { kind: "browser", value: browser },
        { kind: "colorScheme", value: colorScheme },
        { kind: "contrast", value: contrast },
        { kind: "forcedColors", value: forcedColors },
        { kind: "key", value: key },
      ];
      return {
        key,
        label: labelParts.map((part) => part.value).join(" · "),
        labelParts,
        axes: {
          framework: toFramework(framework),
          browser: toBrowser(browser),
          colorScheme: toColorScheme(colorScheme),
          contrast: toContrast(contrast),
          forcedColors: toForcedColors(forcedColors),
          viewport,
          style,
        },
      };
    },
  );
  return templates;
}

/** The number of variants of a census row. */
export function getVariantCount(row: CensusItem): number {
  return shapes[row[1]]?.[0].length ?? 0;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

// One shared empty list, so an unchanged variant allocates none.
const noRegions: ChangedRegion[] = [];

/**
 * Builds one unchanged item from a census row. `index` is the position of the
 * row: a census index, or a larger number for an extra item of one run.
 */
export function buildItem(row: CensusItem, index: number, mode: DataMode): ReviewItem {
  const [key, shapeIndex, ...imageIndexes] = row;
  const shape = shapes[shapeIndex];
  if (!shape) throw new Error(`The item ${key} has no shape.`);
  const [keys, slots] = shape;
  const improved = mode === "improved";
  const all = getTemplates();
  const variants: ReviewVariant[] = [];
  for (const [position, keyIndex] of keys.entries()) {
    const template = all[keyIndex];
    const imageIndex = imageIndexes[slots[position] ?? 0];
    if (!template || imageIndex == null) throw new Error(`The item ${key} is incomplete.`);
    const seed = digest((index + 1) * 64 + position);
    const image = createImage(imageIndex, seed);
    // The profile digest includes the clip, so each capture has its own.
    const profile = rotate(seed, 16);
    const variant: ReviewVariant = {
      id: idPrefix + seed,
      key: template.key,
      label: template.label,
      labelParts: template.labelParts,
      kind: "unchanged",
      revision: 0,
      verdict: null,
      source: null,
      reference: image,
      // Production keeps the reference as the capture of an unchanged
      // variant, so both fields hold one object.
      candidate: image,
      diff: null,
      changedPixels: 0,
      ratio: 0,
      maskExpected: false,
      engine,
      codec,
      policy,
      threshold,
      referenceProfile: profile,
      candidateProfile: profile,
    };
    if (improved) {
      variant.axes = template.axes;
      variant.thumbnail = getThumbnailUrl(image);
      variant.diffPreview = null;
      variant.regions = noRegions;
    }
    variants.push(variant);
  }
  if (!improved) return { key, name: key, variants };
  const { family, group, leaf } = splitItemKey(key);
  return {
    key,
    name: key,
    variants,
    displayName: titles[index] ?? formatKeySegment(leaf),
    family,
    ...(group == null ? {} : { group }),
    leaf,
  };
}

const bases = new Map<DataMode, ReviewItem[]>();

/**
 * The 626 unchanged screenshots of the census in production order, for one
 * data mode. The same array returns for the same mode. Do not change it.
 */
export function getBaseItems(mode: DataMode): ReviewItem[] {
  let base = bases.get(mode);
  if (!base) {
    base = censusItems.map((row, index) => buildItem(row, index, mode));
    bases.set(mode, base);
  }
  return base;
}

let keyIndexes: Map<string, number> | undefined;

/** The census index of a screenshot key. */
export function getCensusIndex(key: string): number {
  keyIndexes ??= new Map(censusItems.map((row, index) => [row[0], index]));
  const index = keyIndexes.get(key);
  if (index == null) throw new Error(`The census has no screenshot ${key}.`);
  return index;
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

export interface Decision {
  verdict: ReviewVerdict;
  reviewer: User;
  decidedAt: number;
}

/** What one run does to one variant. Image fields are indexes, or -1. */
export interface VariantChange {
  /** A census index, or a larger number for an extra item of the run. */
  item: number;
  /** The position of the variant in its item. */
  variant: number;
  kind: VariantKind;
  candidate: number;
  mask: number;
  preview: number;
  changedPixels: number;
  /** An unchanged variant whose new image was not uploaded. */
  candidateOmitted?: boolean;
  /** The verdict of a person. Added and removed variants need none. */
  decision?: Decision;
  /** The sentence of an `error` variant. */
  error?: string;
}

function toRegions(maskIndex: number): ChangedRegion[] {
  const flat = maskRegions[maskIndex] ?? [];
  const regions: ChangedRegion[] = [];
  for (let i = 0; i + 3 < flat.length; i += 4) {
    const [x = 0, y = 0, width = 0, height = 0] = flat.slice(i, i + 4);
    regions.push({ x, y, width, height });
  }
  return regions;
}

/** Applies the change of a run to an unchanged variant of the base. */
export function applyChange(base: ReviewVariant, change: VariantChange, mode: DataMode) {
  const improved = mode === "improved";
  // The digest of the variant is the last part of its identifier.
  const seed = base.id.slice(idPrefix.length);
  const { kind, decision } = change;
  let reference = base.reference;
  let candidate: ReviewImage | null = null;
  let diff: ReviewImage | null = null;
  let diffPreview: ReviewImage | null = null;
  if (kind === "added") {
    reference = null;
  }
  if (change.candidate >= 0) {
    candidate = createImage(change.candidate, rotate(seed, 8));
  } else if (kind === "pending" || kind === "error") {
    // The capture arrived, but the comparison has no result for it.
    candidate = base.reference && { ...base.reference, id: toUuid(rotate(seed, 8)) };
  }
  if (change.mask >= 0) {
    diff = createImage(change.mask, rotate(seed, 24));
  }
  if (change.preview >= 0) {
    diffPreview = createImage(change.preview, rotate(seed, 40));
  }

  const automatic = kind === "added" || kind === "removed";
  let verdict: ReviewVerdict | null = automatic ? "approved" : null;
  let source: ReviewVariant["source"] = automatic ? "automatic" : null;
  if (decision && (automatic || kind === "changed")) {
    verdict = decision.verdict;
    source = "human";
  }

  // Only a finished comparison has metrics and an engine. A removal, a
  // pending comparison, and a failed comparison have no result.
  let metrics: Partial<ReviewVariant> = {};
  if (kind === "unchanged") {
    metrics = { changedPixels: 0, ratio: 0, maskExpected: false, engine, codec };
  } else if (candidate && (kind === "added" || kind === "changed")) {
    // A new image and a size change count every pixel, and have no mask.
    const pixels = candidate.width * candidate.height;
    const changedPixels = diff ? change.changedPixels : pixels;
    metrics = { changedPixels, ratio: changedPixels / pixels, maskExpected: !!diff, engine, codec };
  }

  const picture = candidate ?? reference;
  const variant: ReviewVariant = {
    id: base.id,
    key: base.key,
    label: base.label,
    labelParts: base.labelParts,
    kind,
    revision: verdict ? 1 : 0,
    verdict,
    source,
    ...(source === "human" && decision ? { reviewer: decision.reviewer.githubUserId } : {}),
    reference,
    candidate,
    diff,
    ...metrics,
    ...(change.candidateOmitted ? { candidateOmitted: true } : {}),
    policy,
    threshold,
    ...(reference ? { referenceProfile: base.referenceProfile } : {}),
    // The capture of an omitted candidate exists. Only its bytes were not
    // uploaded, so production still sends its profile.
    ...(candidate || change.candidateOmitted ? { candidateProfile: base.candidateProfile } : {}),
    ...(kind === "error" ? { error: change.error ?? "Comparison evidence is unavailable." } : {}),
  };
  if (!improved) return variant;
  variant.axes = base.axes;
  if (picture) {
    variant.thumbnail = getThumbnailUrl(picture);
  }
  variant.diffPreview = diffPreview;
  variant.regions = diff ? toRegions(change.mask) : noRegions;
  if (source === "human" && decision) {
    variant.reviewerLogin = decision.reviewer.login;
    variant.decidedAt = decision.decidedAt;
  }
  return variant;
}
