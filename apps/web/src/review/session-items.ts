// The screenshots and the variants of the run model in the shape that the
// kit parts read (`components/kit/session.ts`). The rules come from the lab
// fixtures: the axes from the label parts and the key, the short name from
// the axes that differ inside a screenshot, and the status of each part.

import type { SessionItem, SessionVariant, VariantAxes } from "../components/kit/session.ts";
import type { VariantAxisName } from "../components/kit/session.ts";
import { formatKeySegment, getVariantWords, variantAxisOrder } from "../components/kit/session.ts";
import type { ReviewStatus } from "../components/kit/status.tsx";
import type { ReviewItem, ReviewVariant } from "./model.ts";
import { needsReview } from "./navigation.ts";

/**
 * The typed axes of a variant. The five fixed axes come from the label parts.
 * The viewport and the style are only inside the key: the Ariakit consumer
 * builds it as framework, project, viewport, style, color scheme, contrast,
 * and forced colors with hyphens between them. For another key format, the
 * two are absent.
 */
export function getVariantAxes(variant: Pick<ReviewVariant, "key" | "labelParts">): VariantAxes {
  const values: Partial<Record<string, string>> = {};
  for (const part of variant.labelParts ?? []) {
    values[part.kind] = part.value;
  }
  const axes: VariantAxes = {
    framework: values.framework === "solid" ? "solid" : "react",
    browser:
      values.browser === "firefox" || values.browser === "webkit" ? values.browser : "chromium",
    colorScheme: values.colorScheme === "dark" ? "dark" : "light",
    contrast: values.contrast === "more" ? "more" : "no-preference",
    forcedColors: values.forcedColors === "active" ? "active" : "none",
  };
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

/** The state of one variant, as the list and the variant control show it. */
export function getVariantStatus(variant: Pick<ReviewVariant, "kind" | "verdict">): ReviewStatus {
  if (variant.kind === "error") return "problem";
  if (variant.kind === "pending") return "comparing";
  if (variant.kind === "unchanged") return "unchanged";
  if (variant.verdict === "rejected") return "rejected";
  if (variant.verdict === "approved") return "approved";
  return "needs-review";
}

/** The state of a screenshot: what needs a person comes first. */
function getItemStatus(variants: readonly SessionVariant[]): ReviewStatus {
  const order: ReviewStatus[] = [
    "problem",
    "needs-review",
    "comparing",
    "rejected",
    "approved",
    "unchanged",
  ];
  const present = new Set(variants.map((variant) => variant.status));
  return order.find((status) => present.has(status)) ?? "unchanged";
}

/**
 * The short name of each variant: only the axes that differ inside its
 * screenshot, for example `Chromium · Dark`. Two variants with the same axes
 * differ in a part of the key that the axes do not explain, so each variant
 * then has its key as name.
 */
function getShortNames(variants: ReadonlyArray<{ key: string; axes: VariantAxes }>) {
  // The style follows the color scheme for almost every screenshot. Then it
  // is not an axis of its own.
  const styleFollowsScheme = variants.every(
    (variant) => variant.axes.style === variant.axes.colorScheme,
  );
  const varying: VariantAxisName[] = [];
  for (const axis of variantAxisOrder) {
    if (axis === "style" && styleFollowsScheme) continue;
    const values = new Set(variants.map((variant) => variant.axes[axis]));
    values.delete(undefined);
    if (values.size > 1) {
      varying.push(axis);
    }
  }
  const words = variants.map((variant) => getVariantWords(variant, varying).join(" · "));
  const collision = new Set(words).size < words.length;
  return variants.map((variant, index) => {
    if (collision) return variant.key;
    // A screenshot with one variant has no axis that differs.
    return words[index] || getVariantWords(variant, ["browser"]).join(" · ");
  });
}

function toSessionItem(item: ReviewItem): SessionItem {
  const segments = item.key.split("/");
  const family = segments[0] ?? item.key;
  const middle = segments.slice(1, -1);
  const leaf = segments.length > 1 ? (segments.at(-1) ?? item.key) : item.key;
  const sources = item.variants.map((variant) => ({
    key: variant.key,
    axes: getVariantAxes(variant),
  }));
  const names = getShortNames(sources);
  const variants = item.variants.map((variant, index): SessionVariant => ({
    ...variant,
    itemKey: item.key,
    index,
    name: names[index] ?? variant.label,
    axes: sources[index]?.axes ?? getVariantAxes(variant),
    status: getVariantStatus(variant),
    // A copy needed no person on this run, so it has the mark of an automatic
    // approval. The capture details name the run that it came from.
    automatic: variant.source === "automatic" || variant.copiedFrom !== undefined,
  }));
  return {
    ...item,
    // A name that differs from the key is a name that the capture declared.
    label: item.name && item.name !== item.key ? item.name : formatKeySegment(leaf),
    family,
    ...(middle.length ? { group: middle.join("/") } : {}),
    variants,
    status: getItemStatus(variants),
  };
}

// The run model keeps an item object while it does not change, so the kit
// item of each one is built once.
const sessionItems = new WeakMap<ReviewItem, SessionItem>();

/** The kit shape of one screenshot of the run model. */
export function getSessionItem(item: ReviewItem): SessionItem {
  let sessionItem = sessionItems.get(item);
  if (!sessionItem) {
    sessionItem = toSessionItem(item);
    sessionItems.set(item, sessionItem);
  }
  return sessionItem;
}

/**
 * The variant that a screenshot opens on after a click on its row, or from a
 * link that names no variant: the first one to review, else the first
 * change, else the first variant. So a screenshot never opens on an unchanged
 * variant while it has a change.
 */
export function pickVariant(item: ReviewItem): ReviewVariant | undefined {
  return (
    item.variants.find(needsReview) ??
    item.variants.find((variant) => variant.kind !== "unchanged") ??
    item.variants[0]
  );
}

/**
 * The screenshot that a page opens on without a link: the first one with a
 * variant to review, else the first change, else the first screenshot. The
 * run order is the order of the list.
 */
export function pickItem(items: readonly ReviewItem[]): ReviewItem | undefined {
  return (
    items.find((item) => item.variants.some(needsReview)) ??
    items.find((item) => item.variants.some((variant) => variant.kind !== "unchanged")) ??
    items[0]
  );
}

/**
 * Short family names, the rule of the lab. It removes the prefix that most
 * families share and that ends with a hyphen: `ariakit-ui-` for 24 of the 26
 * Ariakit families. A family without the prefix keeps its name.
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
