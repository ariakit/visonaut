// Named variants of the review runs, for a component surface that shows one
// viewer, one thumbnail, or one variant picker and needs a real case of each
// kind without a search through 626 screenshots.

import type { DataMode, ReviewItem, ReviewVariant } from "../types.ts";
import { getReviewRun } from "./review.ts";
import type { ReviewScenario } from "./review.ts";

interface SampleSeed {
  /** What the sample shows, in a few words. */
  title: string;
  scenario: ReviewScenario;
  itemKey: string;
  /** The position of the variant in its item, from 0. */
  variant: number;
  /** True for an image size that production does not send today. */
  labOnly?: boolean;
}

const button = "ariakit-ui-button/page";
const wideViewport = "ariakit-ui-shell/sidebar-combinations/ltr-sidebar-closed";

const seeds = {
  // Changed variants by image size.
  card: {
    title: "Card, 416 × 136, 107 changed pixels in one region",
    scenario: "changes",
    itemKey: `${button}/default`,
    variant: 0,
  },
  "card-dark": {
    title: "Card in the dark scheme, 416 × 148, 4 regions",
    scenario: "changes",
    itemKey: `${button}/segmented-control`,
    variant: 1,
  },
  "card-token": {
    title: "Card of the token change, 416 × 170",
    scenario: "large",
    itemKey: "ariakit-ui-kbd/page/shortcut-list",
    variant: 0,
  },
  "card-webkit": {
    title: "Card that changed only in WebKit: the fifth of six variants",
    scenario: "one-browser",
    itemKey: "ariakit-ui-link/page/default",
    variant: 4,
  },
  clip: {
    title: "Small clip, 317 × 80, 249 changed pixels",
    scenario: "probes",
    itemKey: "ariakit-tailwind-7466/applied-light-week-hover",
    variant: 2,
  },
  "wide-card": {
    title: "Wide card, 1248 × 348, a change of 2 × 2 pixels",
    scenario: "probes",
    itemKey: "ariakit-ui-table/page/selected-rows",
    variant: 2,
  },
  viewport: {
    title: "Viewport capture, 1280 × 800, 3,898 changed pixels in 12 regions",
    scenario: "problems",
    itemKey: "ariakit-ui-shell/docs-site",
    variant: 0,
  },
  "viewport-wide": {
    title: "Viewport capture, 1440 × 900",
    scenario: "probes",
    itemKey: wideViewport,
    variant: 4,
  },
  // The smallest changes.
  "one-pixel": {
    title: "Card with one changed pixel",
    scenario: "probes",
    itemKey: `${button}/default`,
    variant: 0,
  },
  "four-pixels": {
    title: "Card with a change of 2 × 2 pixels",
    scenario: "probes",
    itemKey: `${button}/default`,
    variant: 2,
  },
  // Every kind and verdict that a variant can have.
  "size-change": {
    title: "Size change of 2 pixels: no mask, and a ratio of 1",
    scenario: "problems",
    itemKey: `${button}/brand`,
    variant: 0,
  },
  added: {
    title: "New screenshot: no reference, approved by the service",
    scenario: "problems",
    itemKey: `${button}/loading`,
    variant: 0,
  },
  removed: {
    title: "Removed screenshot: no candidate, approved by the service",
    scenario: "problems",
    itemKey: `${button}/dimmed-button`,
    variant: 0,
  },
  approved: {
    title: "Change that a person approved",
    scenario: "problems",
    itemKey: `${button}/default`,
    variant: 0,
  },
  rejected: {
    title: "Change that a person rejected",
    scenario: "problems",
    itemKey: `${button}/default`,
    variant: 2,
  },
  error: {
    title: "Comparison without evidence",
    scenario: "problems",
    itemKey: `${button}/danger`,
    variant: 2,
  },
  pending: {
    title: "Comparison that did not finish yet",
    scenario: "comparing",
    itemKey: "previews/separator/_component",
    variant: 0,
  },
  unchanged: {
    title: "Unchanged: reference and candidate are one image object",
    scenario: "changes",
    itemKey: `${button}/pill`,
    variant: 0,
  },
  "candidate-omitted": {
    title: "Unchanged, and the new image was not uploaded: no candidate",
    scenario: "probes",
    itemKey: wideViewport,
    variant: 0,
  },
  // Items with an unusual set of variants, or an unusual name.
  "three-variants": {
    title: "Three variants: the browsers",
    scenario: "changes",
    itemKey: "ariakit-tailwind-7466/applied-light-week-hover",
    variant: 0,
  },
  "four-variants": {
    title: "Four variants: forced colors in two browsers",
    scenario: "changes",
    itemKey: "ariakit-ui-badge/forced-colors/default",
    variant: 0,
  },
  "twelve-variants": {
    title: "Twelve variants: with and without forced colors",
    scenario: "changes",
    itemKey: "ariakit-ui-combobox/page/default",
    variant: 0,
  },
  "two-viewports": {
    title: "Twelve variants: two viewports, 1440 × 900 and 560 × 900",
    scenario: "changes",
    itemKey: "ariakit-ui-shell/docs-responsive",
    variant: 0,
  },
  "twenty-four-variants": {
    title: "Twenty-four variants: framework, viewport, and style",
    scenario: "changes",
    itemKey: "previews/separator/_component",
    variant: 0,
  },
  "longest-name": {
    title: "The longest key: 68 characters",
    scenario: "changes",
    itemKey: "ariakit-ui-combobox/page/combobox-select-content-conditional-content",
    variant: 0,
  },
  // The dark capture of a card is 2 pixels taller than the light one.
  "tallest-image": {
    title: "The largest stored image: 1248 × 1240",
    scenario: "changes",
    itemKey: "ariakit-ui-layer/page/layer-color-values",
    variant: 1,
  },
  // Production has this size only as a second viewport of two screenshots.
  // Here it has a change. The item itself is a lab probe.
  "viewport-narrow": {
    title: "Viewport capture, 560 × 900, 2,296 changed pixels",
    scenario: "probes",
    itemKey: "lab-only/page-narrow-560x900",
    variant: 4,
  },
  // Sizes that production does not send today.
  "phone-page": {
    title: "Lab only: a 390 × 844 page",
    scenario: "probes",
    itemKey: "lab-only/mobile-390x844",
    variant: 4,
    labOnly: true,
  },
  "full-page": {
    title: "Lab only: a 1280 × 1640 full page with one changed pixel",
    scenario: "probes",
    itemKey: "lab-only/full-page-1280x1640",
    variant: 0,
    labOnly: true,
  },
} satisfies Record<string, SampleSeed>;

export type ReviewSampleId = keyof typeof seeds;

/** Every sample identifier, in the order of the guide. */
export const reviewSampleIds = Object.keys(seeds).filter((id): id is ReviewSampleId => {
  return Object.hasOwn(seeds, id);
});

export interface ReviewSample {
  id: ReviewSampleId;
  /** What the sample shows, in a few words. */
  title: string;
  /** The review scenario that has the sample. */
  scenario: ReviewScenario;
  item: ReviewItem;
  variant: ReviewVariant;
  /** True for an image size that production does not send today. */
  labOnly: boolean;
}

const cache = new Map<string, ReviewSample>();

/**
 * Returns one named variant of the review runs in one data mode, with its
 * item. The same arguments return the same object. In a component, call
 * `useReviewSample(id)`: it follows the Data control.
 */
export function getReviewSample(id: ReviewSampleId, mode: DataMode): ReviewSample {
  const cacheKey = `${mode}:${id}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const seed: SampleSeed = seeds[id];
  const data = getReviewRun(seed.scenario, mode);
  const items = data.status === "ready" ? data.review.items : [];
  const item = items.find((entry) => entry.key === seed.itemKey);
  const variant = item?.variants[seed.variant];
  if (!item || !variant) throw new Error(`The review sample ${id} does not exist.`);
  const sample: ReviewSample = {
    id,
    title: seed.title,
    scenario: seed.scenario,
    item,
    variant,
    labOnly: seed.labOnly ?? false,
  };
  cache.set(cacheKey, sample);
  return sample;
}
