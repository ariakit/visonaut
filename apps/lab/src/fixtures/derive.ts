// Helpers that derive what a design needs from the fields that production
// sends today. None of them needs an API change, so each one gives the same
// result in every data mode. Each result is cached, so a call in a render is
// cheap.

import type {
  Browser,
  ColorScheme,
  Contrast,
  ForcedColors,
  Framework,
  ReviewItem,
  ReviewVariant,
  RunCounts,
  VariantAxes,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Screenshot keys
// ---------------------------------------------------------------------------

export interface ItemKeyParts {
  /** The first segment, for example `ariakit-ui-button`. */
  family: string;
  /**
   * The segments between the family and the leaf, for example `page` or
   * `forced-colors/page`. Null for a key of two segments.
   */
  group: string | null;
  /** The last segment, for example `segmented-control`. */
  leaf: string;
  segments: string[];
}

const keyParts = new Map<string, ItemKeyParts>();

/**
 * Splits a screenshot key into family, group, and leaf. In production, 62% of
 * the characters of a key are the family and the group, and the leaf is what
 * tells two rows apart.
 * @example
 * splitItemKey("ariakit-ui-button/page/segmented-control");
 * // { family: "ariakit-ui-button", group: "page", leaf: "segmented-control" }
 */
export function splitItemKey(key: string): ItemKeyParts {
  const cached = keyParts.get(key);
  if (cached) return cached;
  const segments = key.split("/");
  const family = segments[0] ?? key;
  const middle = segments.slice(1, -1);
  const parts: ItemKeyParts = {
    family,
    group: middle.length ? middle.join("/") : null,
    leaf: segments.length > 1 ? (segments.at(-1) ?? key) : key,
    segments,
  };
  keyParts.set(key, parts);
  return parts;
}

/** `segmented-control` gives `Segmented control`. */
export function formatKeySegment(segment: string): string {
  const words = segment.replaceAll("-", " ").replaceAll("_", " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A readable name for a screenshot: its display name when the API sends one,
 * else the last segment of its key as words.
 */
export function getItemLabel(item: Pick<ReviewItem, "key" | "displayName">): string {
  return item.displayName ?? formatKeySegment(splitItemKey(item.key).leaf);
}

/**
 * Short family names. It removes the prefix that most families share and that
 * ends with a hyphen: `ariakit-ui-` for 24 of the 26 Ariakit families. A
 * family without the prefix keeps its name. Pass the families of the whole
 * run: the prefix of a part of the run can be another one.
 */
export function getFamilyLabels(families: Iterable<string>): Map<string, string> {
  const names = [...new Set(families)];
  const prefixCounts = new Map<string, number>();
  for (const name of names) {
    for (let end = name.indexOf("-"); end >= 0; end = name.indexOf("-", end + 1)) {
      const prefix = name.slice(0, end + 1);
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
  }
  let shared = "";
  for (const [prefix, count] of prefixCounts) {
    if (count * 2 <= names.length) continue;
    if (prefix.length > shared.length) {
      shared = prefix;
    }
  }
  const labels = new Map<string, string>();
  for (const name of names) {
    const short = shared && name.startsWith(shared) ? name.slice(shared.length) : name;
    labels.set(name, short || name);
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

/** Variant totals of one screenshot, or of a group of screenshots. */
export interface VariantTally {
  /** Screenshots. It is 1 for one item. */
  items: number;
  /** Screenshots with at least one changed, added, or removed variant. */
  changedItems: number;
  /** Screenshots with at least one variant that waits for a verdict. */
  undecidedItems: number;
  variants: number;
  changed: number;
  added: number;
  removed: number;
  unchanged: number;
  /** Variants with kind `error`. */
  error: number;
  /** Variants with kind `pending`. */
  comparing: number;
  approved: number;
  /** Approvals of the service. They are a part of `approved`. */
  automatic: number;
  rejected: number;
  /** Changed, added, or removed variants without a verdict. */
  undecided: number;
}

export function createTally(): VariantTally {
  return {
    items: 0,
    changedItems: 0,
    undecidedItems: 0,
    variants: 0,
    changed: 0,
    added: 0,
    removed: 0,
    unchanged: 0,
    error: 0,
    comparing: 0,
    approved: 0,
    automatic: 0,
    rejected: 0,
    undecided: 0,
  };
}

/**
 * Adds the counts of `part` to `total`. A run adds 626 tallies for each
 * decision, so each field has its own statement: a loop over the field names
 * is ten times slower.
 */
export function addTally(total: VariantTally, part: VariantTally): VariantTally {
  total.items += part.items;
  total.changedItems += part.changedItems;
  total.undecidedItems += part.undecidedItems;
  total.variants += part.variants;
  total.changed += part.changed;
  total.added += part.added;
  total.removed += part.removed;
  total.unchanged += part.unchanged;
  total.error += part.error;
  total.comparing += part.comparing;
  total.approved += part.approved;
  total.automatic += part.automatic;
  total.rejected += part.rejected;
  total.undecided += part.undecided;
  return total;
}

// An item object changes only when one of its verdicts changes, so the tally
// of an untouched item is counted one time for the whole session.
const itemTallies = new WeakMap<object, VariantTally>();

type TallyVariant = Pick<ReviewVariant, "kind" | "verdict" | "source">;

/** The variant totals of one screenshot. The result is cached for the item. */
export function getItemTally(item: { variants: readonly TallyVariant[] }): VariantTally {
  const cached = itemTallies.get(item);
  if (cached) return cached;
  const tally = createTally();
  tally.items = 1;
  for (const variant of item.variants) {
    tally.variants += 1;
    if (variant.kind === "pending") {
      tally.comparing += 1;
      continue;
    }
    tally[variant.kind] += 1;
    if (variant.kind === "unchanged" || variant.kind === "error") continue;
    if (variant.verdict === "approved") {
      tally.approved += 1;
      if (variant.source === "automatic") {
        tally.automatic += 1;
      }
    } else if (variant.verdict === "rejected") {
      tally.rejected += 1;
    } else {
      tally.undecided += 1;
    }
  }
  tally.changedItems = tally.changed + tally.added + tally.removed > 0 ? 1 : 0;
  tally.undecidedItems = tally.undecided > 0 ? 1 : 0;
  itemTallies.set(item, tally);
  return tally;
}

const listCounts = new WeakMap<object, RunCounts>();

/**
 * Counts the variants of a review model by kind and by decision. Production
 * sends no totals, so a client must count them like this. The result is cached
 * for the array.
 */
export function countVariants(items: ReadonlyArray<{ variants: readonly TallyVariant[] }>) {
  const cached = listCounts.get(items);
  if (cached) return cached;
  const total = createTally();
  for (const item of items) {
    addTally(total, getItemTally(item));
  }
  const counts: RunCounts = {
    items: total.items,
    total: total.variants,
    changed: total.changed,
    added: total.added,
    removed: total.removed,
    unchanged: total.unchanged,
    error: total.error,
    comparing: total.comparing,
    approved: total.approved,
    rejected: total.rejected,
    undecided: total.undecided,
  };
  listCounts.set(items, counts);
  return counts;
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

export interface FamilySection<T> {
  /** The group of `splitItemKey`, for example `page`. Null for no group. */
  group: string | null;
  /** The screenshots of the section, in run order. */
  items: T[];
  counts: VariantTally;
}

export interface FamilyGroup<T> {
  /** The first segment of the keys, for example `ariakit-ui-button`. */
  family: string;
  /** The family without the prefix that most families share: `button`. */
  label: string;
  /** Every screenshot of the family, in run order. */
  items: T[];
  /** The screenshots by the group of their key, in run order. */
  sections: Array<FamilySection<T>>;
  /** Screenshots, variants, and changes of the family. */
  counts: VariantTally;
}

type GroupedItem = Pick<ReviewItem, "key"> & { variants: readonly TallyVariant[] };

export interface GroupItemsOptions {
  /**
   * The label of each family, from `getFamilyLabels`. Pass the labels of the
   * whole run when `items` is a part of it, for example a search result.
   * Without it, the labels come from the families of `items`, and a family
   * can get another label when the list changes.
   */
  labels?: ReadonlyMap<string, string>;
}

const familyGroups = new WeakMap<object, Array<FamilyGroup<GroupedItem>>>();

/**
 * Groups screenshots by family, in the order of the run, with the counts of
 * each family and of each group inside it. Production has 26 families with 1
 * to 106 screenshots. The result is cached for the array.
 * @example
 * for (const group of groupItemsByFamily(review.items)) {
 *   // "button · 3 changed of 106"
 *   `${group.label} · ${group.counts.changedItems} changed of ${group.counts.items}`;
 * }
 */
export function groupItemsByFamily<T extends GroupedItem>(
  items: readonly T[],
  options: GroupItemsOptions = {},
) {
  const cached = familyGroups.get(items);
  // The cache holds groups of the items of this array, so they are `T`.
  if (cached) return cached as Array<FamilyGroup<T>>;
  const groups = new Map<string, FamilyGroup<T>>();
  for (const item of items) {
    const { family, group: section } = splitItemKey(item.key);
    let group = groups.get(family);
    if (!group) {
      group = { family, label: family, items: [], sections: [], counts: createTally() };
      groups.set(family, group);
    }
    const tally = getItemTally(item);
    group.items.push(item);
    addTally(group.counts, tally);
    let target = group.sections.find((entry) => entry.group === section);
    if (!target) {
      target = { group: section, items: [], counts: createTally() };
      group.sections.push(target);
    }
    target.items.push(item);
    addTally(target.counts, tally);
  }
  const labels = options.labels ?? getFamilyLabels(groups.keys());
  const result = [...groups.values()];
  for (const group of result) {
    group.label = labels.get(group.family) ?? group.family;
  }
  familyGroups.set(items, result);
  return result;
}

// ---------------------------------------------------------------------------
// Variant axes
// ---------------------------------------------------------------------------

export type VariantAxisName = keyof VariantAxes;

/** The axes in the order that a label lists them. */
export const variantAxisOrder: VariantAxisName[] = [
  "framework",
  "browser",
  "viewport",
  "colorScheme",
  "style",
  "contrast",
  "forcedColors",
];

type AxesSource = Pick<ReviewVariant, "key" | "labelParts" | "axes">;

const parsedAxes = new Map<string, VariantAxes>();

function parseAxes(variant: AxesSource): VariantAxes {
  const values: Partial<Record<string, string>> = {};
  for (const part of variant.labelParts) {
    values[part.kind] = part.value;
  }
  const framework: Framework = values.framework === "solid" ? "solid" : "react";
  let browser: Browser = "chromium";
  if (values.browser === "firefox" || values.browser === "webkit") {
    browser = values.browser;
  }
  const colorScheme: ColorScheme = values.colorScheme === "dark" ? "dark" : "light";
  const contrast: Contrast = values.contrast === "more" ? "more" : "no-preference";
  const forcedColors: ForcedColors = values.forcedColors === "active" ? "active" : "none";
  const axes: VariantAxes = { framework, browser, colorScheme, contrast, forcedColors };
  // The Ariakit consumer builds the key as framework, project, viewport,
  // style, color scheme, contrast, and forced colors with hyphens between
  // them. The API sends all but the three middle values as label parts, so
  // what remains between them is the project, the viewport, and the style.
  const start = `${values.framework}-`;
  const end = `-${values.colorScheme}-${values.contrast}-${values.forcedColors}`;
  const { key } = variant;
  if (key.startsWith(start) && key.endsWith(end) && key.length > start.length + end.length) {
    const middle = key.slice(start.length, key.length - end.length).split("-");
    const [, viewport, style] = middle;
    if (middle.length === 3 && viewport && style) {
      axes.viewport = viewport;
      axes.style = style;
    }
  }
  return axes;
}

/**
 * The typed axes of a variant. In `improved` mode they come from the API. In
 * `today` mode the five fixed axes come from `labelParts`, and the viewport
 * and the style are read from the key text, because the API does not send
 * them. That rule fits the keys of the Ariakit consumer. For another key
 * format, `viewport` and `style` are absent.
 */
export function getVariantAxes(variant: AxesSource): VariantAxes {
  if (variant.axes) return variant.axes;
  const cached = parsedAxes.get(variant.key);
  if (cached) return cached;
  const axes = parseAxes(variant);
  parsedAxes.set(variant.key, axes);
  return axes;
}

const axisWords: Partial<Record<VariantAxisName, Record<string, string>>> = {
  framework: { react: "React", solid: "Solid" },
  browser: { chromium: "Chromium", firefox: "Firefox", webkit: "WebKit" },
  colorScheme: { light: "Light", dark: "Dark" },
  contrast: { more: "More contrast", "no-preference": "" },
  forcedColors: { active: "Forced colors", none: "" },
  viewport: { default: "" },
  style: { default: "", light: "Light style", dark: "Dark style" },
};

/**
 * One axis value as a word, in the words of the app today: `chromium` gives
 * `Chromium`, and `active` gives `Forced colors`. A value that is the normal
 * case gives an empty string: no contrast preference, no forced colors, and
 * the `default` viewport and style.
 */
export function formatAxisValue(axis: VariantAxisName, value: string | undefined): string {
  if (value == null) return "";
  return axisWords[axis]?.[value] ?? formatKeySegment(value);
}

/**
 * The words of a variant for the given axes, without empty words. Without
 * axes, it lists every axis: `React · Chromium · Desktop · Light`.
 */
export function getVariantWords(
  variant: AxesSource,
  axes: readonly VariantAxisName[] = variantAxisOrder,
): string[] {
  const values = getVariantAxes(variant);
  const words: string[] = [];
  for (const axis of variantAxisOrder) {
    if (!axes.includes(axis)) continue;
    // The style repeats the color scheme for almost every screenshot.
    if (axis === "style" && axes.includes("colorScheme") && values.style === values.colorScheme) {
      continue;
    }
    const word = formatAxisValue(axis, values[axis]);
    if (word) {
      words.push(word);
    }
  }
  return words;
}

export interface VariantMatrixRow<V> {
  /** Stable in the screenshot, for example `dark` or `wide/dark`. */
  id: string;
  /** For example `Dark` or `Wide · Dark`. Empty when the matrix has one row. */
  label: string;
  /** The value of each row axis. */
  values: Partial<Record<VariantAxisName, string>>;
  /** One cell for each column. Null when no variant has this combination. */
  cells: Array<V | null>;
}

export interface VariantMatrix<V> {
  /** The browsers of the screenshot, in the order Chromium, Firefox, WebKit. */
  columns: Browser[];
  /** One row for each combination of the other axes that differ. */
  rows: Array<VariantMatrixRow<V>>;
  /**
   * The axes with more than one value in this screenshot, in label order. For
   * 591 of the 626 production screenshots it is the browser and the color
   * scheme, or the browser alone.
   */
  varying: VariantAxisName[];
  /** `varying` without the browser: the axes that make the rows. */
  rowAxes: VariantAxisName[];
  /** The value of each axis that is the same for every variant. */
  constant: Partial<Record<VariantAxisName, string>>;
  /** The constant values as words, for example `React · Desktop`. */
  caption: string;
  /** The short label of each variant, by variant key. See `getVariantLabel`. */
  labels: Map<string, string>;
}

const browserOrder: Browser[] = ["chromium", "firefox", "webkit"];

/** A matrix whose cells hold variant positions in place of variants. */
type MatrixLayout = VariantMatrix<number>;

function buildLayout(variants: readonly AxesSource[]): MatrixLayout {
  const axesOf = variants.map((variant) => getVariantAxes(variant));
  const distinct = new Map<VariantAxisName, Set<string>>();
  for (const axis of variantAxisOrder) {
    const values = new Set<string>();
    for (const axes of axesOf) {
      const value = axes[axis];
      if (value != null) {
        values.add(value);
      }
    }
    distinct.set(axis, values);
  }
  // The style follows the color scheme for 613 of 626 screenshots. Then it is
  // not an axis of its own.
  const styleFollowsScheme = axesOf.every((axes) => axes.style === axes.colorScheme);
  const varying: VariantAxisName[] = [];
  const constant: Partial<Record<VariantAxisName, string>> = {};
  for (const axis of variantAxisOrder) {
    const values = distinct.get(axis);
    if (!values?.size) continue;
    if (axis === "style" && styleFollowsScheme) continue;
    const [first] = values;
    if (values.size > 1) {
      varying.push(axis);
    } else if (first != null) {
      constant[axis] = first;
    }
  }
  const rowAxes = varying.filter((axis) => axis !== "browser");
  const columns = browserOrder.filter((browser) => distinct.get("browser")?.has(browser));

  const build = (byKey: boolean) => {
    const rows = new Map<string, VariantMatrixRow<number>>();
    let collision = false;
    for (const [position, variant] of variants.entries()) {
      const axes = axesOf[position];
      if (!axes) continue;
      const id = byKey ? variant.key : rowAxes.map((axis) => axes[axis] ?? "").join("/");
      let row = rows.get(id);
      if (!row) {
        const values: Partial<Record<VariantAxisName, string>> = {};
        for (const axis of rowAxes) {
          values[axis] = axes[axis];
        }
        const label = byKey ? variant.key : getVariantWords(variant, rowAxes).join(" · ");
        row = { id, label, values, cells: columns.map(() => null) };
        rows.set(id, row);
      }
      const column = columns.indexOf(axes.browser);
      if (row.cells[column] != null) {
        collision = true;
      }
      row.cells[column] = position;
    }
    return { rows: [...rows.values()], collision };
  };
  let { rows, collision } = build(false);
  // Two variants in one cell differ only in a part of the key that the axes
  // do not explain. Each variant then gets its own row with the key as label.
  if (collision) {
    rows = build(true).rows;
  }

  const captionWords: string[] = [];
  for (const axis of variantAxisOrder) {
    // A constant color scheme says nothing when the style changes the colors.
    if (axis === "colorScheme" && varying.includes("style")) continue;
    const word = formatAxisValue(axis, constant[axis]);
    if (word) {
      captionWords.push(word);
    }
  }
  const labels = new Map<string, string>();
  for (const variant of variants) {
    const words = collision ? [variant.key] : getVariantWords(variant, varying);
    // A screenshot with one variant has no axis that differs.
    const label = words.length ? words : getVariantWords(variant, ["browser"]);
    labels.set(variant.key, label.join(" · "));
  }
  return {
    columns,
    rows,
    varying,
    rowAxes,
    constant,
    caption: captionWords.join(" · "),
    labels,
  };
}

// Production has 15 distinct lists of variant keys for 626 screenshots, so
// the layout of a matrix is computed for each list and not for each item.
const layoutsByKeys = new Map<string, MatrixLayout>();
const layoutsByItem = new WeakMap<object, MatrixLayout>();

function getLayout(item: { variants: readonly AxesSource[] }): MatrixLayout {
  let layout = layoutsByItem.get(item);
  if (layout) return layout;
  let signature = "";
  for (const variant of item.variants) {
    signature += `${variant.key}|`;
  }
  layout = layoutsByKeys.get(signature);
  if (!layout) {
    layout = buildLayout(item.variants);
    layoutsByKeys.set(signature, layout);
  }
  layoutsByItem.set(item, layout);
  return layout;
}

const matrices = new WeakMap<object, VariantMatrix<AxesSource>>();

/**
 * The variants of one screenshot as a matrix: browsers as columns, and one
 * row for each combination of the other axes that differ (the color scheme,
 * then forced colors, the viewport, the style, or the framework when the
 * screenshot has them). 523 of the 626 production screenshots are 3 browsers
 * by 2 color schemes. The result is cached for the item.
 * @example
 * const matrix = getVariantMatrix(item);
 * matrix.columns; // ["chromium", "firefox", "webkit"]
 * matrix.rows.map((row) => row.label); // ["Light", "Dark"]
 * matrix.rows[0]?.cells; // [variant, variant, variant]
 * matrix.varying; // ["browser", "colorScheme"]
 * matrix.caption; // "React · Desktop"
 */
export function getVariantMatrix<V extends AxesSource>(item: {
  variants: readonly V[];
}): VariantMatrix<V> {
  const cached = matrices.get(item);
  // The cache holds the matrix of the variants of this item, so they are `V`.
  if (cached) return cached as VariantMatrix<V>;
  const layout = getLayout(item);
  const rows = layout.rows.map((row): VariantMatrixRow<V> => {
    const cells = row.cells.map((position) => {
      return position == null ? null : (item.variants[position] ?? null);
    });
    return { ...row, cells };
  });
  const matrix: VariantMatrix<V> = { ...layout, rows };
  matrices.set(item, matrix);
  return matrix;
}

/**
 * The short label of a variant: only the axes that differ inside its
 * screenshot, for example `Chromium · Dark`. The label that production builds
 * is `variant.label`: six values, the last one the whole key.
 */
export function getVariantLabel(
  variant: AxesSource,
  item: { variants: readonly AxesSource[] },
): string {
  return getLayout(item).labels.get(variant.key) ?? getVariantWords(variant).join(" · ");
}

// ---------------------------------------------------------------------------
// Image sizes
// ---------------------------------------------------------------------------

/**
 * The size classes of production images, from their dimensions alone.
 *
 * - `clip`: a small clip, less than 400 pixels wide (317 x 80 to 345 x 280).
 * - `card`: one example card, 416 or 432 pixels wide and 98 to 640 pixels
 *   tall. Nine of ten production screenshots.
 * - `wide-card`: a card that spans two or three columns: 624, 1248, or 1264
 *   pixels wide and up to 1,240 pixels tall.
 * - `viewport`: a capture of the whole viewport: 1280 x 800, 1440 x 900,
 *   560 x 400, or 560 x 900.
 * - `phone-page` and `full-page`: lab only. Production has no 390 pixel page
 *   and no full-page capture today.
 */
export type SizeClass = "clip" | "card" | "wide-card" | "viewport" | "phone-page" | "full-page";

export interface SizeClassInfo {
  label: string;
  /** What the class holds, with its sizes. */
  description: string;
  /** True for a size that production does not send today. */
  labOnly: boolean;
}

export const sizeClasses: Record<SizeClass, SizeClassInfo> = {
  clip: {
    label: "Small clip",
    description: "A control group, an overlay, or a preview. Less than 400 px wide.",
    labOnly: false,
  },
  card: {
    label: "Card",
    description: "One example card. 416 or 432 px wide, 98 to 640 px tall.",
    labOnly: false,
  },
  "wide-card": {
    label: "Wide card",
    description: "A card across two or three columns. 624, 1248, or 1264 px wide.",
    labOnly: false,
  },
  viewport: {
    label: "Viewport",
    description: "The whole viewport: 1280 × 800, 1440 × 900, 560 × 400, or 560 × 900.",
    labOnly: false,
  },
  "phone-page": {
    label: "Phone page",
    description: "A 390 × 844 page. Production has none today.",
    labOnly: true,
  },
  "full-page": {
    label: "Full page",
    description: "A page taller than its viewport. Production stores none today.",
    labOnly: true,
  },
};

// Width and height of the viewport captures that the Ariakit consumer sends.
const viewportSizes = [
  [1280, 800],
  [1440, 900],
  [560, 400],
  [560, 900],
];

export interface ImageSize {
  width: number;
  height: number;
}

/** The size class of an image. It reads only the width and the height. */
export function getSizeClass({ width, height }: ImageSize): SizeClass {
  const isViewport = viewportSizes.some(([viewportWidth, viewportHeight]) => {
    return viewportWidth === width && viewportHeight === height;
  });
  if (isViewport) return "viewport";
  if (width === 390 && height > 640) return "phone-page";
  // A page capture has the full viewport width. A wide card is narrower,
  // because the page has a margin around its cards.
  if ((width === 1280 || width === 1440) && height > 900) return "full-page";
  if (width < 400) return "clip";
  if (width <= 432) return "card";
  return "wide-card";
}

export interface FitZoomOptions {
  /** The largest zoom to return. Defaults to 4. */
  maximum?: number;
}

/**
 * The zoom at which an image fits a stage: the largest whole number that
 * fits, and a fraction only when the image is larger than the stage. At a
 * whole-number zoom each image pixel is a square of screen pixels, so use
 * `image-rendering: pixelated`. Nine of ten production images are smaller
 * than a pane, and the app today shows them at 1.
 * @example
 * getFitZoom({ width: 416, height: 136 }, { width: 1146, height: 468 }); // 2
 * getFitZoom({ width: 1280, height: 800 }, { width: 555, height: 468 }); // 0.43
 */
export function getFitZoom(image: ImageSize, stage: ImageSize, options: FitZoomOptions = {}) {
  const { maximum = 4 } = options;
  if (image.width <= 0 || image.height <= 0) return 1;
  const contain = Math.min(stage.width / image.width, stage.height / image.height);
  if (contain < 1) return Math.max(contain, 0);
  return Math.max(1, Math.min(Math.floor(contain), maximum));
}

type SizedVariant = Pick<ReviewVariant, "reference" | "candidate">;

/**
 * True when the baseline and the current image have different dimensions.
 * Production then sends no mask, `ratio` is 1, and `changedPixels` is the
 * number of all pixels, so the metric line "100% changed" is wrong.
 */
export function isSizeChange({ reference, candidate }: SizedVariant): boolean {
  if (!reference || !candidate) return false;
  return reference.width !== candidate.width || reference.height !== candidate.height;
}
