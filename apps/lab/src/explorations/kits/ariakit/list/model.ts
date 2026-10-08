// The model of the screenshot list: what the status select shows, what the
// search reads, and the words of one row. It is pure: the same input gives
// the same rows on the server and in the browser. Every field comes from data
// that production sends today, so the list is the same in each data mode.

import type { SessionItem, SessionVariant } from "../../../../fixtures/hooks/index.ts";
import { formatRatio, isSizeChange } from "../../../../fixtures/index.ts";
import type { Browser } from "../../../../fixtures/index.ts";
import { getStripStatusName, statusStyles } from "../status.tsx";
import type { StatusName } from "../status.tsx";

/**
 * What the list shows. `changes` is every screenshot with a change, and each
 * other value is the screenshots with a variant in that state. `unchanged`
 * is the rest of the run: 623 of 626 screenshots of a normal pull request.
 */
export type ListStatus = "changes" | "needs-review" | "rejected" | "approved" | "unchanged";

/** The entries of the status select. A separator comes before `unchanged`. */
export const listStatuses: readonly ListStatus[] = [
  "changes",
  "needs-review",
  "rejected",
  "approved",
  "unchanged",
];

export const listStatusLabels: Record<ListStatus, string> = {
  changes: "Changes",
  "needs-review": statusStyles["needs-review"].label,
  rejected: statusStyles.rejected.label,
  approved: statusStyles.approved.label,
  unchanged: statusStyles.unchanged.label,
};

/** The glyph of an entry. `changes` holds every state, so it has none. */
export const listStatusGlyphs: Record<ListStatus, StatusName | null> = {
  changes: null,
  "needs-review": "needs-review",
  rejected: "rejected",
  approved: "approved",
  unchanged: "unchanged",
};

export interface ListFilter {
  /** Every word must match the name, the key, or an axis of a variant. */
  query: string;
  status: ListStatus;
}

export const defaultListFilter: ListFilter = { query: "", status: "changes" };

export interface ListResult {
  /** The screenshots of the selected status, in run order. */
  items: SessionItem[];
  /**
   * The screenshots whose comparison still runs and that have no change yet.
   * The `changes` status lists them after its rows.
   */
  comparing: SessionItem[];
  /**
   * Unchanged screenshots that match the search when no change does. A
   * screenshot is then never unreachable from the default status.
   */
  fallback: SessionItem[];
  /** The number of screenshots behind each status, under the search. */
  counts: Record<ListStatus, number>;
  /** The search words, in lowercase. */
  terms: string[];
}

const browserWords: Record<Browser, string[]> = {
  chromium: ["chromium", "chrome"],
  firefox: ["firefox"],
  webkit: ["webkit", "safari"],
};

interface IndexedItem {
  /** The lowercase text that the search reads. */
  text: string;
  /** The lowercase axis words of each variant, in the order of the variants. */
  words: string[][];
}

// An item object changes only when one of its verdicts changes, and all runs
// share their unchanged items. So the search text of an item is made one time.
const indexedItems = new WeakMap<SessionItem, IndexedItem>();

function indexItem(item: SessionItem): IndexedItem {
  const cached = indexedItems.get(item);
  if (cached) return cached;
  const indexed: IndexedItem = {
    text: `${item.key} ${item.label}`.toLowerCase(),
    words: item.variants.map(({ axes }) => [
      ...browserWords[axes.browser],
      axes.colorScheme,
      axes.framework,
    ]),
  };
  indexedItems.set(item, indexed);
  return indexed;
}

function getTerms(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/**
 * The variants of a screenshot that the search keeps. A word that is not in
 * the name can still be the browser, the color scheme, or the framework of a
 * variant, so `webkit dark` narrows the list without an axis control.
 */
function matchVariants(item: SessionItem, terms: readonly string[]): readonly SessionVariant[] {
  if (!terms.length) return item.variants;
  const { text, words } = indexItem(item);
  const openTerms = terms.filter((term) => !text.includes(term));
  if (!openTerms.length) return item.variants;
  return item.variants.filter((_variant, index) => {
    const variantWords = words[index] ?? [];
    return openTerms.every((term) => variantWords.some((word) => word.startsWith(term)));
  });
}

function createCounts(): Record<ListStatus, number> {
  return { changes: 0, "needs-review": 0, rejected: 0, approved: 0, unchanged: 0 };
}

/**
 * The screenshots of a list under its filter, with the count of each status.
 * One pass over the variants of the run: 3,832 in production.
 */
export function filterList(items: readonly SessionItem[], filter: ListFilter): ListResult {
  const terms = getTerms(filter.query);
  const counts = createCounts();
  const byStatus: Record<ListStatus, SessionItem[]> = {
    changes: [],
    "needs-review": [],
    rejected: [],
    approved: [],
    unchanged: [],
  };
  const comparing: SessionItem[] = [];
  for (const item of items) {
    const matches = matchVariants(item, terms);
    if (!matches.length) continue;
    let changed = false;
    let waiting = false;
    const seen = new Set<ListStatus>();
    for (const variant of matches) {
      if (variant.status === "unchanged") continue;
      if (variant.status === "comparing") {
        waiting = true;
        continue;
      }
      changed = true;
      if (variant.status === "problem") continue;
      seen.add(variant.status);
    }
    if (changed) {
      seen.add("changes");
    } else if (waiting) {
      comparing.push(item);
    } else {
      seen.add("unchanged");
    }
    for (const status of seen) {
      counts[status] += 1;
      byStatus[status].push(item);
    }
  }
  const selected = byStatus[filter.status];
  const searchFoundNoChange =
    filter.status === "changes" && terms.length > 0 && !selected.length && !comparing.length;
  return {
    items: selected,
    comparing: filter.status === "changes" ? comparing : [],
    fallback: searchFoundNoChange ? byStatus.unchanged : [],
    counts,
    terms,
  };
}

// ---------------------------------------------------------------------------
// The words of a row
// ---------------------------------------------------------------------------

/** How strong a row reads: with work, finished, or unchanged. */
export type RowStrength = "open" | "done" | "same";

export function getRowStrength(item: SessionItem): RowStrength {
  if (item.status === "unchanged") return "same";
  return item.status === "approved" ? "done" : "open";
}

/** The short family and the group of a screenshot: `button/page`. */
export function getContextPath(item: SessionItem, familyLabel: string): string {
  return item.group ? `${familyLabel}/${item.group}` : familyLabel;
}

/**
 * The largest change of a screenshot, from the variants with a mask. A size
 * change has no mask: its ratio is 1, and `100%` is wrong for it.
 */
export function getLargestRatio(item: SessionItem): number | null {
  let largest: number | null = null;
  for (const variant of item.variants) {
    if (!variant.diff || variant.ratio == null) continue;
    if (largest == null || variant.ratio > largest) {
      largest = variant.ratio;
    }
  }
  return largest;
}

/** True when a variant of the screenshot changed its size. */
export function hasSizeChange(item: SessionItem): boolean {
  return item.variants.some((variant) => variant.kind === "changed" && isSizeChange(variant));
}

/** The measure of the change: the largest ratio, or the words for a size change. */
export function getMeasure(item: SessionItem): string | null {
  if (item.status === "unchanged") return null;
  const ratio = getLargestRatio(item);
  if (ratio != null) return formatRatio(ratio);
  return hasSizeChange(item) ? "Size changed" : null;
}

/** The number of variants in each state of a strip, in the order of a legend. */
export interface StripCount {
  status: StatusName;
  count: number;
}

const stripOrder: readonly StatusName[] = [
  "needs-review",
  "rejected",
  "failed",
  "comparing",
  "approved",
  "auto-approved",
  "added",
  "removed",
  "unchanged",
];

export function countStripStatuses(variants: readonly SessionVariant[]): StripCount[] {
  const counts = new Map<StatusName, number>();
  for (const variant of variants) {
    const status = getStripStatusName(variant);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const result: StripCount[] = [];
  for (const status of stripOrder) {
    const count = counts.get(status);
    if (!count) continue;
    result.push({ status, count });
  }
  return result;
}

/** `6 need review, 1 rejected`: the counts as words, for an accessible name. */
export function describeStripCounts(counts: readonly StripCount[]): string {
  return counts
    .map(({ status, count }) => {
      if (status === "needs-review") return `${count} ${count === 1 ? "needs" : "need"} review`;
      return `${count} ${statusStyles[status].label.toLowerCase()}`;
    })
    .join(", ");
}

/** `{key}. 6 need review. Largest change 0.15%`. */
export function getRowName(item: SessionItem): string {
  const summary = describeStripCounts(countStripStatuses(item.variants));
  const ratio = getLargestRatio(item);
  if (item.status === "unchanged") return `${item.key}. ${summary}`;
  if (ratio != null) return `${item.key}. ${summary}. Largest change ${formatRatio(ratio)}`;
  if (hasSizeChange(item)) return `${item.key}. ${summary}. Size changed`;
  return `${item.key}. ${summary}`;
}

/**
 * What a whole screenshot is when the service decided all of it: a new
 * screenshot, or one that is gone. Null for every other screenshot.
 */
export function getItemKind(item: SessionItem): "added" | "removed" | null {
  const changed = item.variants.filter((variant) => variant.status !== "unchanged");
  if (!changed.length) return null;
  if (changed.every((variant) => getStripStatusName(variant) === "added")) return "added";
  if (changed.every((variant) => getStripStatusName(variant) === "removed")) return "removed";
  return null;
}

export interface ListFamily {
  family: string;
  /** The family without the prefix that most families of the run share. */
  label: string;
  items: SessionItem[];
}

/** The screenshots of a list by family, in the order of the list. */
export function groupByFamily(
  items: readonly SessionItem[],
  labels: ReadonlyMap<string, string>,
): ListFamily[] {
  const groups = new Map<string, ListFamily>();
  for (const item of items) {
    let group = groups.get(item.family);
    if (!group) {
      group = { family: item.family, label: labels.get(item.family) ?? item.family, items: [] };
      groups.set(item.family, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}
