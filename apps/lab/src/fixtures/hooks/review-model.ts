// The pure model behind `useReviewSession`: statuses, groups, filters, the
// navigation order, decisions, and Undo. It has no React and no timers, so the
// reducer gives the same result on the server and in the browser.
//
// A production run has 626 screenshots and 3,832 variants. Everything that is
// derived from one item is cached for that item object, and a decision
// replaces only the items that it changes. So a decision costs one pass over
// 626 cached items, not a new model.

import { getReviewRun } from "../data/review.ts";
import {
  countVariants,
  getFamilyLabels,
  getItemLabel,
  getItemTally,
  getVariantAxes,
  getVariantLabel,
  groupItemsByFamily,
  splitItemKey,
} from "../derive.ts";
import type { FamilyGroup } from "../derive.ts";
import { NOW } from "../now.ts";
import type {
  Browser,
  ColorScheme,
  DataMode,
  Framework,
  ReviewData,
  ReviewItem,
  ReviewRun,
  ReviewSelection,
  ReviewVariant,
  ReviewVerdict,
  RunCounts,
  RunState,
  User,
  VariantAxes,
  VariantKind,
} from "../types.ts";
import { formatCount } from "./labels.ts";
import type { ColorRole, StateLabel } from "./labels.ts";

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

/**
 * The review state of one variant, and of one item. An item takes the first
 * status in `reviewStatusOrder` that one of its variants has.
 *
 * - `problem`: the comparison has no evidence (kind `error`).
 * - `needs-review`: a change without a verdict.
 * - `comparing`: the comparison did not finish yet (kind `pending`).
 * - `rejected`: a change with a rejected verdict.
 * - `approved`: a change that a person or the service approved.
 * - `unchanged`: the images match.
 */
export type ReviewStatus =
  | "problem"
  | "needs-review"
  | "comparing"
  | "rejected"
  | "approved"
  | "unchanged";

/** The order of the groups in an item list. Navigation follows it. */
export const reviewStatusOrder: ReviewStatus[] = [
  "problem",
  "needs-review",
  "comparing",
  "rejected",
  "approved",
  "unchanged",
];

export const reviewStatusLabels: Record<ReviewStatus, StateLabel> = {
  problem: { short: "Problem", plain: "Comparison failed" },
  "needs-review": { short: "Review", plain: "Needs review" },
  comparing: { short: "Comparing", plain: "Comparison in progress" },
  rejected: { short: "Rejected", plain: "Rejected" },
  approved: { short: "Approved", plain: "Approved" },
  unchanged: { short: "Same", plain: "No visible change" },
};

export const reviewStatusRoles: Record<ReviewStatus, ColorRole> = {
  problem: "danger",
  "needs-review": "warning",
  comparing: "neutral",
  rejected: "danger",
  approved: "success",
  unchanged: "neutral",
};

export function getVariantStatus(variant: Pick<ReviewVariant, "kind" | "verdict">): ReviewStatus {
  if (variant.kind === "error") return "problem";
  if (variant.kind === "pending") return "comparing";
  if (variant.kind === "unchanged") return "unchanged";
  if (variant.verdict === "rejected") return "rejected";
  if (variant.verdict === "approved") return "approved";
  return "needs-review";
}

/** Only added, changed, and removed variants take a verdict. */
export function isReviewable(variant: Pick<ReviewVariant, "kind">): boolean {
  return variant.kind === "added" || variant.kind === "changed" || variant.kind === "removed";
}

// ---------------------------------------------------------------------------
// Items and variants of a session
// ---------------------------------------------------------------------------

export interface SessionVariant extends ReviewVariant {
  itemKey: string;
  /** The readable name of the item: `getItemLabel(item)`. */
  itemName: string;
  /** The position in the item, from 0. */
  index: number;
  /**
   * The short label: only the axes that differ inside the item, for example
   * `Chromium · Dark`. `label` is the long text that production builds.
   */
  name: string;
  /** The typed axes, in every data mode. See `getVariantAxes`. */
  axes: VariantAxes;
  status: ReviewStatus;
  /** True for an added, changed, or removed variant. */
  reviewable: boolean;
  /** True when the service approved the variant, not a person. */
  automatic: boolean;
}

/** Variant totals of one item. */
export interface ItemCounts {
  total: number;
  /** Variants that take a verdict: changed, added, and removed. */
  reviewable: number;
  undecided: number;
  approved: number;
  rejected: number;
  unchanged: number;
  problems: number;
  comparing: number;
}

export interface SessionItem extends ReviewItem {
  /** The position in the run, from 0. */
  index: number;
  variants: SessionVariant[];
  /** The variants that pass the filters. Without a filter: every variant. */
  matches: SessionVariant[];
  status: ReviewStatus;
  counts: ItemCounts;
  /** The first segment of the key, in every data mode. */
  family: string;
  /**
   * The segments between the family and the leaf, in every data mode. Absent
   * for a key of two segments.
   */
  group?: string;
  /** The last segment of the key, in every data mode. */
  leaf: string;
  /**
   * A readable name in every data mode: the display name when the API sends
   * one, else the last key segment as words. `name` is the whole key.
   */
  label: string;
  /**
   * Not in the API today. The thumbnail of the first variant that takes a
   * verdict, else of the first variant.
   */
  thumbnail?: string;
  /**
   * True when the app today keeps the item in its main list: the item is not
   * accepted yet, or it has a new variant. False for the `Accepted` section.
   */
  attention: boolean;
}

function getItemStatus(counts: ItemCounts): ReviewStatus {
  if (counts.problems) return "problem";
  if (counts.undecided) return "needs-review";
  if (counts.comparing) return "comparing";
  if (counts.rejected) return "rejected";
  if (counts.approved) return "approved";
  return "unchanged";
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface ReviewFilters {
  /**
   * Every word must be in the key or in the readable name of the item. The
   * search does not read variants: use the other filters for them.
   */
  query: string;
  status: ReviewStatus | "all";
  kind: VariantKind | "all";
  browser: Browser | "all";
  framework: Framework | "all";
  colorScheme: ColorScheme | "all";
  /** The first key segment, for example `ariakit-ui-button`. */
  family: string;
}

export const defaultReviewFilters: ReviewFilters = {
  query: "",
  status: "all",
  kind: "all",
  browser: "all",
  framework: "all",
  colorScheme: "all",
  family: "all",
};

/**
 * The number of variants behind each filter option. Each count applies the
 * other filters and the query, so it is the size of the list after a click.
 */
export interface ReviewFacets {
  status: Record<ReviewStatus | "all", number>;
  kind: Record<VariantKind | "all", number>;
  browser: Record<Browser | "all", number>;
  framework: Record<Framework | "all", number>;
  colorScheme: Record<ColorScheme | "all", number>;
  /** One entry for each family of the run, and `all`. */
  family: Record<string, number>;
}

type FacetName = keyof ReviewFacets;

/** The filters that select variants. The family filter selects items. */
type VariantFacetName = Exclude<FacetName, "family">;

const variantFacetNames: VariantFacetName[] = [
  "status",
  "kind",
  "browser",
  "framework",
  "colorScheme",
];

const filterNames: Array<keyof ReviewFilters> = ["query", "family", ...variantFacetNames];

function createFacets(): ReviewFacets {
  return {
    status: {
      all: 0,
      problem: 0,
      "needs-review": 0,
      comparing: 0,
      rejected: 0,
      approved: 0,
      unchanged: 0,
    },
    kind: { all: 0, changed: 0, added: 0, removed: 0, unchanged: 0, pending: 0, error: 0 },
    browser: { all: 0, chromium: 0, firefox: 0, webkit: 0 },
    framework: { all: 0, react: 0, solid: 0 },
    colorScheme: { all: 0, light: 0, dark: 0 },
    family: { all: 0 },
  };
}

function getFacetValue(variant: SessionVariant, facet: VariantFacetName): string {
  if (facet === "status") return variant.status;
  if (facet === "kind") return variant.kind;
  return variant.axes[facet];
}

function getTerms(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

export function isFiltered(filters: ReviewFilters): boolean {
  if (getTerms(filters.query).length) return true;
  if (filters.family !== "all") return true;
  return variantFacetNames.some((facet) => filters[facet] !== "all");
}

// ---------------------------------------------------------------------------
// The derived data of one item
// ---------------------------------------------------------------------------

/** One facet value of an item with the number of its variants that have it. */
type FacetCount = [facet: VariantFacetName, value: string, count: number];

interface Decoration {
  index: number;
  item: SessionItem;
  /** The part of the item in each facet count when no variant filter is on. */
  facets: FacetCount[];
  /** The lowercase text that the query reads. */
  text: string;
  /** The item with the matches of the last filtered view. */
  filtered?: SessionItem;
}

function isSameList(first: readonly unknown[], second: readonly unknown[]): boolean {
  if (first.length !== second.length) return false;
  return first.every((entry, index) => entry === second[index]);
}

// An item object changes only when one of its verdicts changes, so the
// derived data of an untouched item is made one time for the whole session.
// All runs share their unchanged items, so it also survives a new scenario.
// A run with a new or a removed item has the shared items at other places,
// so an item keeps one entry for each place.
const decorations = new WeakMap<ReviewItem, Decoration[]>();

function decorate(source: ReviewItem, index: number): Decoration {
  let entries = decorations.get(source);
  if (!entries) {
    entries = [];
    decorations.set(source, entries);
  }
  const cached = entries.find((entry) => entry.index === index);
  if (cached) return cached;
  const decoration = createDecoration(source, index);
  entries.push(decoration);
  return decoration;
}

function createDecoration(source: ReviewItem, index: number): Decoration {
  const tally = getItemTally(source);
  const counts: ItemCounts = {
    total: tally.variants,
    reviewable: tally.changed + tally.added + tally.removed,
    undecided: tally.undecided,
    approved: tally.approved,
    rejected: tally.rejected,
    unchanged: tally.unchanged,
    problems: tally.error,
    comparing: tally.comparing,
  };
  const label = getItemLabel(source);
  const facetCounts = new Map<string, FacetCount>();
  let thumbnail: string | undefined;
  let reviewableThumbnail: string | undefined;
  const variants = source.variants.map((variant, position): SessionVariant => {
    const status = getVariantStatus(variant);
    const reviewable = isReviewable(variant);
    thumbnail ??= variant.thumbnail;
    if (reviewable) {
      reviewableThumbnail ??= variant.thumbnail;
    }
    const decorated: SessionVariant = {
      ...variant,
      itemKey: source.key,
      itemName: label,
      index: position,
      name: getVariantLabel(variant, source),
      axes: getVariantAxes(variant),
      status,
      reviewable,
      automatic: variant.verdict === "approved" && variant.source === "automatic",
    };
    for (const facet of variantFacetNames) {
      const value = getFacetValue(decorated, facet);
      const id = `${facet}:${value}`;
      const entry = facetCounts.get(id);
      if (entry) {
        entry[2] += 1;
      } else {
        facetCounts.set(id, [facet, value, 1]);
      }
    }
    return decorated;
  });
  const accepted =
    counts.total > 0 &&
    !counts.problems &&
    !counts.comparing &&
    !counts.undecided &&
    !counts.rejected;
  const { family, group, leaf } = splitItemKey(source.key);
  const preview = reviewableThumbnail ?? thumbnail;
  const item: SessionItem = {
    ...source,
    index,
    variants,
    matches: variants,
    status: getItemStatus(counts),
    counts,
    family,
    ...(group == null ? {} : { group }),
    leaf,
    label,
    ...(preview ? { thumbnail: preview } : {}),
    attention: !accepted || variants.some((variant) => variant.kind === "added"),
  };
  return {
    index,
    item,
    facets: [...facetCounts.values()],
    text: `${source.key} ${label}`.toLowerCase(),
  };
}

// ---------------------------------------------------------------------------
// The view: what a list shows under the current filters
// ---------------------------------------------------------------------------

/**
 * - `status`: the items follow `reviewStatusOrder`, as the item list of the
 *   app does with its `Accepted` section. An item moves when its status
 *   changes.
 * - `declared`: the items keep the order of the run.
 */
export type ReviewOrder = "status" | "declared";

export interface ItemGroup {
  id: ReviewStatus;
  /** The visible items with this status, in run order. */
  items: SessionItem[];
  /** The number of items with this status when no filter is active. */
  total: number;
}

export interface ReviewView {
  /** Every item, in run order. */
  items: SessionItem[];
  /** The items with a matching variant, in navigation order. */
  visibleItems: SessionItem[];
  /** One group for each status, in `reviewStatusOrder`. Some are empty. */
  groups: ItemGroup[];
  /** The visible items by family, in run order, with counts. */
  families: Array<FamilyGroup<SessionItem>>;
  /** The matching variants of the visible items, in navigation order. */
  queue: SessionVariant[];
  facets: ReviewFacets;
  /** True when a filter or a query is active. */
  filtered: boolean;
  itemsByKey: Map<string, SessionItem>;
}

const noVariants: SessionVariant[] = [];

/** Adds to the count of one filter option, and to the count of `all`. */
function addCount(bucket: Record<string, number>, value: string, count: number) {
  bucket[value] = (bucket[value] ?? 0) + count;
  bucket.all = (bucket.all ?? 0) + count;
}

interface MatchVariantsParams {
  item: SessionItem;
  filters: ReviewFilters;
  /** The item passes the family filter. */
  inFamily: boolean;
  /** The counts of the view. The function adds the part of the item. */
  facets: ReviewFacets;
}

/** The variants of an item that pass the variant filters, with their counts. */
function matchVariants({ item, filters, inFamily, facets }: MatchVariantsParams) {
  const matches: SessionVariant[] = [];
  for (const variant of item.variants) {
    let failures = 0;
    let failed: VariantFacetName | undefined;
    for (const facet of variantFacetNames) {
      if (filters[facet] === "all") continue;
      if (filters[facet] === getFacetValue(variant, facet)) continue;
      failures += 1;
      failed = facet;
    }
    // A count applies every other filter. So a variant that fails one filter
    // still counts for the options of that filter.
    if (failures === 1 && failed && inFamily) {
      addCount(facets[failed], getFacetValue(variant, failed), 1);
    }
    if (failures) continue;
    addCount(facets.family, item.family, 1);
    if (!inFamily) continue;
    for (const facet of variantFacetNames) {
      addCount(facets[facet], getFacetValue(variant, facet), 1);
    }
    matches.push(variant);
  }
  return matches;
}

function buildView(items: ReviewItem[], filters: ReviewFilters, order: ReviewOrder): ReviewView {
  const terms = getTerms(filters.query);
  const filtered = isFiltered(filters);
  const variantFiltered = variantFacetNames.some((facet) => filters[facet] !== "all");
  const facets = createFacets();
  const all: SessionItem[] = [];
  const visible: SessionItem[] = [];
  const itemsByKey = new Map<string, SessionItem>();
  const groups = reviewStatusOrder.map((id): ItemGroup => ({ id, items: [], total: 0 }));
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const runFamilies = new Set<string>();

  for (const [index, source] of items.entries()) {
    const decoration = decorate(source, index);
    let item = decoration.item;
    runFamilies.add(item.family);
    let matches = noVariants;
    const inQuery = terms.every((term) => decoration.text.includes(term));
    if (inQuery) {
      const inFamily = filters.family === "all" || filters.family === item.family;
      if (variantFiltered) {
        matches = matchVariants({ item, filters, inFamily, facets });
      } else {
        // No variant filter is on, so every variant of the item counts, and
        // the cached counts of the item are its whole part.
        addCount(facets.family, item.family, item.variants.length);
        if (inFamily) {
          matches = item.variants;
          for (const [facet, value, count] of decoration.facets) {
            addCount(facets[facet], value, count);
          }
        }
      }
    }
    if (matches !== item.variants) {
      // An item keeps its object while the same variants match, so a row
      // that is memoized by its item does not render again after a decision
      // on another item.
      const previous = decoration.filtered;
      item = previous && isSameList(previous.matches, matches) ? previous : { ...item, matches };
      decoration.filtered = item;
    }
    all.push(item);
    itemsByKey.set(item.key, item);
    const group = groupsById.get(item.status);
    if (group) {
      group.total += 1;
    }
    if (!matches.length) continue;
    visible.push(item);
    group?.items.push(item);
  }

  const visibleItems = order === "status" ? groups.flatMap((group) => group.items) : visible;
  const queue: SessionVariant[] = [];
  for (const item of visibleItems) {
    for (const variant of item.matches) {
      queue.push(variant);
    }
  }
  return {
    items: all,
    visibleItems,
    groups,
    // The labels come from every family of the run, so a family keeps its
    // label when a filter hides the other families.
    families: groupItemsByFamily(visible, { labels: getFamilyLabels(runFamilies) }),
    queue,
    facets,
    filtered,
    itemsByKey,
  };
}

interface CachedView {
  filters: ReviewFilters;
  order: ReviewOrder;
  view: ReviewView;
}

// One view for each item array. The reducer and the hook ask for the same
// view in turn, so the second call is free.
const views = new WeakMap<ReviewItem[], CachedView>();

export function getReviewView(
  items: ReviewItem[],
  filters: ReviewFilters,
  order: ReviewOrder,
): ReviewView {
  const cached = views.get(items);
  if (cached && cached.filters === filters && cached.order === order) return cached.view;
  const view = buildView(items, filters, order);
  views.set(items, { filters, order, view });
  return view;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface KindProgress {
  total: number;
  approved: number;
  rejected: number;
  remaining: number;
}

export interface ReviewProgress {
  /** Variants that take a verdict: changed, added, and removed. */
  total: number;
  /** `approved` plus `rejected`. */
  decided: number;
  approved: number;
  rejected: number;
  /** Variants without a verdict. */
  remaining: number;
  /** Approvals of the service. They are a part of `approved`. */
  automatic: number;
  /** `decided / total`, from 0 to 1. It is 1 when nothing takes a verdict. */
  ratio: number;
  byKind: Record<"changed" | "added" | "removed", KindProgress>;
  /** Items with at least one variant that takes a verdict. */
  items: { total: number; remaining: number; done: number };
}

export interface ReviewSummary {
  counts: RunCounts;
  progress: ReviewProgress;
}

const summaries = new WeakMap<ReviewItem[], ReviewSummary>();

function createKindProgress(): KindProgress {
  return { total: 0, approved: 0, rejected: 0, remaining: 0 };
}

/** The run totals and the progress numbers of a list of items. */
export function summarizeReview(items: ReviewItem[]): ReviewSummary {
  const cached = summaries.get(items);
  if (cached) return cached;
  const counts = countVariants(items);
  const byKind = {
    changed: createKindProgress(),
    added: createKindProgress(),
    removed: createKindProgress(),
  };
  const itemProgress = { total: 0, remaining: 0, done: 0 };
  let automatic = 0;
  for (const item of items) {
    const tally = getItemTally(item);
    // Almost every item of a production run is unchanged. Its cached tally
    // says so, and its variants are not read again.
    if (!tally.changedItems) continue;
    automatic += tally.automatic;
    itemProgress.total += 1;
    if (tally.undecided) {
      itemProgress.remaining += 1;
    } else {
      itemProgress.done += 1;
    }
    for (const variant of item.variants) {
      if (variant.kind !== "changed" && variant.kind !== "added" && variant.kind !== "removed") {
        continue;
      }
      const kind = byKind[variant.kind];
      kind.total += 1;
      if (variant.verdict === "approved") {
        kind.approved += 1;
      } else if (variant.verdict === "rejected") {
        kind.rejected += 1;
      } else {
        kind.remaining += 1;
      }
    }
  }
  const total = counts.changed + counts.added + counts.removed;
  const decided = counts.approved + counts.rejected;
  const summary: ReviewSummary = {
    counts,
    progress: {
      total,
      decided,
      approved: counts.approved,
      rejected: counts.rejected,
      remaining: counts.undecided,
      automatic,
      ratio: total ? decided / total : 1,
      byKind,
      items: itemProgress,
    },
  };
  summaries.set(items, summary);
  return summary;
}

/** The run status that the local verdicts imply, as the service computes it. */
export function deriveRunStatus(base: RunState, counts: RunCounts): RunState {
  if (base !== "needs-review" && base !== "rejected" && base !== "passed") return base;
  const open = counts.undecided + counts.rejected + counts.error + counts.comparing;
  if (!open) return "passed";
  return counts.rejected ? "rejected" : "needs-review";
}

// ---------------------------------------------------------------------------
// Read-only runs
// ---------------------------------------------------------------------------

/**
 * Why a run takes no decisions.
 *
 * - `archived`: a closed run that was accepted.
 * - `superseded`: a closed run that was not accepted. A newer run replaced
 *   it, or its pull request closed. The API today has one state for both.
 * - `expired`: a closed run whose images are gone.
 * - `comparing`: the capture or the comparison did not finish yet.
 * - `failed`: the capture or the comparison failed.
 * - `stale`: the baseline changed, so a new capture is necessary.
 */
export type ReadOnlyKind = "archived" | "superseded" | "expired" | "comparing" | "failed" | "stale";

export interface ReadOnlyState {
  kind: ReadOnlyKind;
  /** A sentence that the page can show. */
  reason: string;
}

export function getReadOnlyState(review: ReviewRun): ReadOnlyState | null {
  const { status, error } = review.run;
  if (review.imagesExpired || review.evidenceState === "summary") {
    return {
      kind: "expired",
      reason: review.readOnlyReason ?? "This run is closed. Its images are no longer stored.",
    };
  }
  if (status === "superseded") {
    return {
      kind: "superseded",
      reason: review.readOnlyReason ?? "A newer run replaced this run.",
    };
  }
  if (review.archived) {
    return { kind: "archived", reason: review.readOnlyReason ?? "This closed run is read-only." };
  }
  if (review.reviewReady) return null;
  if (status === "failed") {
    return {
      kind: "failed",
      reason: error ?? "The capture or the comparison failed. A new capture is necessary.",
    };
  }
  if (status === "needs-recompare") {
    return { kind: "stale", reason: "The baseline changed. A new capture is necessary." };
  }
  return { kind: "comparing", reason: "Review opens when every comparison is complete." };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** `clear` removes the verdict of a person. The app has no such action today. */
export type DecisionAction = "approve" | "reject" | "clear";

/**
 * - `variant`: one or more chosen variants.
 * - `item`: every variant of one item that takes a verdict.
 * - `run`: every variant of the run that waits for a verdict.
 */
export type DecisionScope = "variant" | "item" | "run";

export interface VerdictSnapshot {
  verdict: ReviewVerdict | null;
  source: ReviewVariant["source"];
  reviewer?: string;
  reviewerLogin?: string;
  decidedAt?: number;
}

export interface CommandTarget {
  itemKey: string;
  variantKey: string;
  variantId: string;
  /** The verdict before the command. Undo restores it. */
  previous: VerdictSnapshot;
}

/** One decision that changed at least one variant. Undo takes back one command. */
export interface ReviewCommand {
  id: string;
  action: DecisionAction;
  scope: DecisionScope;
  targets: CommandTarget[];
  /** The selection before the command. Undo returns to it. */
  selection: ReviewSelection | null;
  /** The item name, when every target is in one item. */
  itemName?: string;
  /** The variant name, when the command has one target. */
  variantName?: string;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface SaveState {
  /**
   * - `saving`: the simulated server did not confirm yet.
   * - `saved`: it confirmed. The status returns to `idle` after a moment.
   * - `error`: the save failed. The decisions are taken back and wait in
   *   `failed`. New decisions are blocked until `retrySave` or
   *   `discardFailedSave`.
   */
  status: SaveStatus;
  /** Decisions and undos that wait for the simulated server. */
  pending: number;
  /** The commands that a failed save took back. */
  failed: ReviewCommand[];
  /** True after `failNextSave`, until a save fails. */
  failsNext: boolean;
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

export interface SessionConfig {
  scenario: string;
  /** The data mode of the run. A new mode starts a new session. */
  mode: DataMode;
  order: ReviewOrder;
  /** Moves to the next variant that needs review after a decision. */
  autoAdvance: boolean;
}

export interface SessionState extends SessionConfig {
  data: ReviewData;
  /** The items of the run with the local verdicts. */
  items: ReviewItem[];
  filters: ReviewFilters;
  selection: ReviewSelection | null;
  /** The last chosen variant key of each visited item. */
  remembered: ReadonlyMap<string, string>;
  /** The undo stack, oldest first. */
  history: ReviewCommand[];
  save: SaveState;
  /** Identifiers of the commands that the simulated server did not confirm. */
  unsaved: string[];
  /** Grows with every command and undo. It restarts the save timer. */
  saveSequence: number;
  commandCount: number;
  /** The latest event as a sentence, for a live region. */
  announcement: string;
}

export interface DecisionRequest {
  action: DecisionAction;
  scope: DecisionScope;
  /** The chosen variants. Defaults to the selection, or to the scope. */
  targets?: ReviewSelection[];
  /** The item of an `item` decision. Defaults to the selected item. */
  itemKey?: string;
  /** Limits a `run` decision to the variants that pass the filters. */
  visibleOnly?: boolean;
}

export type SessionAction =
  | ({ type: "reset" } & SessionConfig)
  | { type: "configure"; order: ReviewOrder; autoAdvance: boolean }
  | { type: "select"; selection: ReviewSelection }
  | { type: "selectItem"; itemKey: string }
  | { type: "selectVariant"; variant: string | number }
  | { type: "move"; target: "item" | "variant" | "queue" | "undecided"; step: 1 | -1 }
  | { type: "setFilters"; filters: Partial<ReviewFilters> }
  | { type: "resetFilters" }
  | { type: "decide"; request: DecisionRequest }
  | { type: "undo" }
  | { type: "settle" }
  | { type: "rest" }
  | { type: "failNext"; fail: boolean }
  | { type: "retry" }
  | { type: "discard" };

const idleSave: SaveState = { status: "idle", pending: 0, failed: [], failsNext: false };

function toSelection(variant: SessionVariant): ReviewSelection {
  return { itemKey: variant.itemKey, variantKey: variant.key };
}

function isSelected(variant: SessionVariant, selection: ReviewSelection | null) {
  if (!selection) return false;
  return variant.itemKey === selection.itemKey && variant.key === selection.variantKey;
}

function findVariant(view: ReviewView, selection: ReviewSelection | null) {
  if (!selection) return;
  const item = view.itemsByKey.get(selection.itemKey);
  return item?.variants.find((variant) => variant.key === selection.variantKey);
}

/**
 * The next variant that needs review after the selection, in queue order. The
 * search wraps one time through the queue, as the app does. It returns null
 * when no other variant needs review.
 */
function findUndecided(
  queue: SessionVariant[],
  selection: ReviewSelection | null,
  decided: ReadonlySet<string>,
  step: 1 | -1 = 1,
): ReviewSelection | null {
  const size = queue.length;
  const current = queue.findIndex((variant) => isSelected(variant, selection));
  // Without a position, a backward search starts at the last variant.
  const start = current < 0 && step < 0 ? 0 : current;
  for (let offset = 1; offset <= size; offset++) {
    const variant = queue[(((start + offset * step) % size) + size) % size];
    if (!variant) continue;
    if (variant.status !== "needs-review") continue;
    if (decided.has(variant.id)) continue;
    if (isSelected(variant, selection)) continue;
    return toSelection(variant);
  }
  return null;
}

function getFirstSelection(queue: SessionVariant[]): ReviewSelection | null {
  const first = queue.find((variant) => variant.status === "needs-review") ?? queue[0];
  return first ? toSelection(first) : null;
}

/** The variant that opens with an item: remembered, then pending, then first. */
function pickVariant(item: SessionItem, remembered: string | undefined) {
  const pool = item.matches.length ? item.matches : item.variants;
  return (
    pool.find((variant) => variant.key === remembered) ??
    pool.find((variant) => variant.status === "needs-review") ??
    pool[0]
  );
}

function remember(remembered: ReadonlyMap<string, string>, selection: ReviewSelection) {
  if (remembered.get(selection.itemKey) === selection.variantKey) return remembered;
  return new Map(remembered).set(selection.itemKey, selection.variantKey);
}

function announce(state: SessionState, announcement: string): SessionState {
  if (state.announcement === announcement) return state;
  return { ...state, announcement };
}

export function createSessionState(config: SessionConfig): SessionState {
  const data = getReviewRun(config.scenario, config.mode);
  const items = data.status === "ready" ? data.review.items : [];
  const view = getReviewView(items, defaultReviewFilters, config.order);
  return {
    ...config,
    data,
    items,
    filters: defaultReviewFilters,
    selection: getFirstSelection(view.queue),
    remembered: new Map(),
    history: [],
    save: idleSave,
    unsaved: [],
    saveSequence: 0,
    commandCount: 0,
    announcement: "",
  };
}

function getView(state: SessionState): ReviewView {
  return getReviewView(state.items, state.filters, state.order);
}

function withVerdict(variant: ReviewVariant, snapshot: VerdictSnapshot): ReviewVariant {
  const { reviewer: _reviewer, reviewerLogin: _login, decidedAt: _decidedAt, ...rest } = variant;
  return {
    ...rest,
    verdict: snapshot.verdict,
    source: snapshot.source,
    revision: variant.revision + 1,
    ...(snapshot.reviewer ? { reviewer: snapshot.reviewer } : {}),
    ...(snapshot.reviewerLogin ? { reviewerLogin: snapshot.reviewerLogin } : {}),
    ...(snapshot.decidedAt == null ? {} : { decidedAt: snapshot.decidedAt }),
  };
}

interface VerdictPatch {
  itemKey: string;
  variantId: string;
  snapshot: VerdictSnapshot;
}

/**
 * Applies verdicts to the items of a state. Only the items of the patches get
 * a new object. Every other item keeps its identity and its cached data.
 */
function patchVariants(state: SessionState, patches: VerdictPatch[]): ReviewItem[] {
  const view = getView(state);
  const byItem = new Map<number, Map<string, VerdictSnapshot>>();
  for (const { itemKey, variantId, snapshot } of patches) {
    const index = view.itemsByKey.get(itemKey)?.index;
    if (index == null) continue;
    let snapshots = byItem.get(index);
    if (!snapshots) {
      snapshots = new Map();
      byItem.set(index, snapshots);
    }
    snapshots.set(variantId, snapshot);
  }
  const items = state.items.slice();
  for (const [index, snapshots] of byItem) {
    const item = items[index];
    if (!item) continue;
    const variants = item.variants.map((variant) => {
      const snapshot = snapshots.get(variant.id);
      return snapshot ? withVerdict(variant, snapshot) : variant;
    });
    items[index] = { ...item, variants };
  }
  return items;
}

/** The patch that gives a command target its verdict from before the command. */
function toPreviousVerdict({ itemKey, variantId, previous }: CommandTarget): VerdictPatch {
  return { itemKey, variantId, snapshot: previous };
}

function takeSnapshot(variant: ReviewVariant): VerdictSnapshot {
  return {
    verdict: variant.verdict,
    source: variant.source,
    ...(variant.reviewer ? { reviewer: variant.reviewer } : {}),
    ...(variant.reviewerLogin ? { reviewerLogin: variant.reviewerLogin } : {}),
    ...(variant.decidedAt == null ? {} : { decidedAt: variant.decidedAt }),
  };
}

interface NextVerdictParams {
  variant: SessionVariant;
  action: DecisionAction;
  user: User;
  mode: DataMode;
}

function getNextVerdict({ variant, action, user, mode }: NextVerdictParams) {
  if (action === "clear") {
    // The service accepts added and removed variants by itself, so a cleared
    // human verdict goes back to that automatic approval.
    const automatic = variant.kind === "added" || variant.kind === "removed";
    const snapshot: VerdictSnapshot = automatic
      ? { verdict: "approved", source: "automatic" }
      : { verdict: null, source: null };
    return snapshot;
  }
  const snapshot: VerdictSnapshot = {
    verdict: action === "approve" ? "approved" : "rejected",
    source: "human",
    reviewer: user.githubUserId,
    // The API today answers a decision with the account identifier only.
    ...(mode === "improved" ? { reviewerLogin: user.login, decidedAt: NOW } : {}),
  };
  return snapshot;
}

function getProtection(variant: SessionVariant, action: DecisionAction) {
  if (action === "approve") return variant.approveDisabledReason;
  if (action === "reject") return variant.rejectDisabledReason;
  return variant.approveDisabledReason ?? variant.rejectDisabledReason;
}

function changesVerdict(variant: SessionVariant, action: DecisionAction) {
  if (!variant.reviewable) return false;
  if (action === "clear") return variant.source === "human" && variant.verdict !== null;
  const verdict = action === "approve" ? "approved" : "rejected";
  return !(variant.verdict === verdict && variant.source === "human");
}

function resolveTargets(state: SessionState, view: ReviewView, request: DecisionRequest) {
  if (request.targets) {
    const variants: SessionVariant[] = [];
    for (const target of request.targets) {
      const variant = findVariant(view, target);
      if (variant) {
        variants.push(variant);
      }
    }
    return variants;
  }
  if (request.scope === "variant") {
    const variant = findVariant(view, state.selection);
    return variant ? [variant] : [];
  }
  if (request.scope === "item") {
    const item = view.itemsByKey.get(request.itemKey ?? state.selection?.itemKey ?? "");
    return item?.variants.filter((variant) => variant.reviewable) ?? [];
  }
  if (request.visibleOnly) {
    return view.queue.filter((variant) => variant.status === "needs-review");
  }
  // Only the items that wait for a verdict are read, not all 3,832 variants.
  const targets: SessionVariant[] = [];
  for (const item of view.items) {
    if (!item.counts.undecided) continue;
    for (const variant of item.variants) {
      if (variant.status === "needs-review") {
        targets.push(variant);
      }
    }
  }
  return targets;
}

const actionWords: Record<DecisionAction, string> = {
  approve: "Approved",
  reject: "Rejected",
  clear: "Cleared",
};

function describeDecision(action: DecisionAction, count: number, remaining: number) {
  const subject = count === 1 ? "" : ` ${formatCount(count, "variant")}`;
  const rest = remaining ? `${formatCount(remaining)} left.` : "Review complete.";
  return `${actionWords[action]}${subject}. ${rest}`;
}

function decide(state: SessionState, request: DecisionRequest): SessionState {
  if (state.data.status !== "ready") return state;
  const readOnly = getReadOnlyState(state.data.review);
  if (readOnly) return announce(state, readOnly.reason);
  if (state.save.status === "error") {
    return announce(state, "Resolve the unsaved decision before you save another one.");
  }
  const view = getView(state);
  const { action, scope } = request;
  const targets = resolveTargets(state, view, request);
  const blocked = targets.find((variant) => getProtection(variant, action));
  // One chosen variant and a whole item are all or nothing, as in the app.
  if (blocked && (scope === "item" || targets.length === 1)) {
    return announce(state, `${getProtection(blocked, action)} No variants were changed.`);
  }
  const changed = targets.filter(
    (variant) => !getProtection(variant, action) && changesVerdict(variant, action),
  );
  if (!changed.length) return state;

  const { user } = state.data;
  const { mode } = state;
  const patches = changed.map((variant): VerdictPatch => {
    const snapshot = getNextVerdict({ variant, action, user, mode });
    return { itemKey: variant.itemKey, variantId: variant.id, snapshot };
  });
  const items = patchVariants(state, patches);
  const first = changed[0];
  const oneItem = changed.every((variant) => variant.itemKey === first?.itemKey);
  const commandCount = state.commandCount + 1;
  const command: ReviewCommand = {
    id: `command-${commandCount}`,
    action,
    scope,
    targets: changed.map((variant) => ({
      itemKey: variant.itemKey,
      variantKey: variant.key,
      variantId: variant.id,
      previous: takeSnapshot(variant),
    })),
    selection: state.selection,
    ...(oneItem && first ? { itemName: first.itemName } : {}),
    ...(changed.length === 1 && first ? { variantName: first.name } : {}),
  };

  // The selection moves when the decision covers it. A decision on other
  // variants, for example from a grid, leaves the selection in place.
  const { selection } = state;
  const coversSelection =
    scope === "item"
      ? changed.some((variant) => variant.itemKey === selection?.itemKey)
      : changed.some((variant) => isSelected(variant, selection));
  const advances = state.autoAdvance && action !== "clear" && scope !== "run" && coversSelection;
  const decided = new Set(changed.map((variant) => variant.id));
  const next = advances ? findUndecided(view.queue, selection, decided) : null;

  return {
    ...state,
    items,
    selection: next ?? selection,
    history: [...state.history, command],
    unsaved: [...state.unsaved, command.id],
    save: { ...state.save, status: "saving", pending: state.save.pending + 1, failed: [] },
    saveSequence: state.saveSequence + 1,
    commandCount,
    announcement: describeDecision(
      action,
      changed.length,
      summarizeReview(items).progress.remaining,
    ),
  };
}

function undo(state: SessionState): SessionState {
  if (state.data.status !== "ready") return state;
  const command = state.history.at(-1);
  if (!command) return state;
  if (state.save.status === "error") {
    return announce(state, "Resolve the unsaved decision before you undo.");
  }
  return {
    ...state,
    items: patchVariants(state, command.targets.map(toPreviousVerdict)),
    selection: command.selection ?? state.selection,
    history: state.history.slice(0, -1),
    unsaved: state.unsaved.filter((id) => id !== command.id),
    save: { ...state.save, status: "saving", pending: state.save.pending + 1 },
    saveSequence: state.saveSequence + 1,
    announcement: "Undone.",
  };
}

/** Ends the simulated save: confirms the waiting commands, or takes them back. */
function settle(state: SessionState): SessionState {
  if (state.save.status !== "saving") return state;
  const failed = state.save.failsNext
    ? state.history.filter((command) => state.unsaved.includes(command.id))
    : [];
  if (!failed.length) {
    return { ...state, unsaved: [], save: { ...state.save, status: "saved", pending: 0 } };
  }
  // The oldest command is applied last, so each variant gets back the verdict
  // that it had before the first failed command.
  const patches = failed.toReversed().flatMap((command) => command.targets.map(toPreviousVerdict));
  return {
    ...state,
    items: patchVariants(state, patches),
    selection: failed[0]?.selection ?? state.selection,
    history: state.history.filter((command) => !failed.includes(command)),
    unsaved: [],
    save: { status: "error", pending: 0, failed, failsNext: false },
    announcement: "Not saved. The decision was taken back.",
  };
}

/** Sends the failed commands again, in their order. */
function retry(state: SessionState): SessionState {
  if (state.save.status !== "error") return state;
  let next: SessionState = { ...state, save: idleSave };
  for (const command of state.save.failed) {
    next = decide(
      { ...next, selection: command.selection },
      { action: command.action, scope: command.scope, targets: command.targets },
    );
  }
  return next;
}

function selectItem(state: SessionState, item: SessionItem | undefined): SessionState {
  if (!item) return state;
  const variant = pickVariant(item, state.remembered.get(item.key));
  if (!variant) return state;
  if (isSelected(variant, state.selection)) return state;
  return { ...state, selection: toSelection(variant) };
}

function selectVariant(state: SessionState, variant: SessionVariant | undefined): SessionState {
  if (!variant) return state;
  const selection = toSelection(variant);
  const remembered = remember(state.remembered, selection);
  if (isSelected(variant, state.selection) && remembered === state.remembered) return state;
  return { ...state, selection, remembered };
}

function move(
  state: SessionState,
  target: "item" | "variant" | "queue" | "undecided",
  step: 1 | -1,
): SessionState {
  const view = getView(state);
  const { selection } = state;
  if (target === "undecided") {
    const next = findUndecided(view.queue, selection, new Set(), step);
    return selectVariant(state, findVariant(view, next));
  }
  if (target === "item") {
    const index = view.visibleItems.findIndex((item) => item.key === selection?.itemKey);
    // A selection that the filters hide has no position: start at the top.
    return selectItem(state, index < 0 ? view.visibleItems[0] : view.visibleItems[index + step]);
  }
  if (target === "queue") {
    const index = view.queue.findIndex((variant) => isSelected(variant, selection));
    return selectVariant(state, index < 0 ? view.queue[0] : view.queue[index + step]);
  }
  const current = findVariant(view, selection);
  if (!current) return state;
  const item = view.itemsByKey.get(current.itemKey);
  return selectVariant(state, item?.variants[current.index + step]);
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "reset": {
      const { scenario, mode, order, autoAdvance } = action;
      return createSessionState({ scenario, mode, order, autoAdvance });
    }
    case "configure":
      return { ...state, order: action.order, autoAdvance: action.autoAdvance };
    case "select":
      return selectVariant(state, findVariant(getView(state), action.selection));
    case "selectItem":
      return selectItem(state, getView(state).itemsByKey.get(action.itemKey));
    case "selectVariant": {
      const view = getView(state);
      const item = view.itemsByKey.get(state.selection?.itemKey ?? "");
      const { variant } = action;
      if (typeof variant === "number") return selectVariant(state, item?.variants[variant]);
      return selectVariant(
        state,
        item?.variants.find((entry) => entry.key === variant),
      );
    }
    case "move":
      return move(state, action.target, action.step);
    case "setFilters": {
      const filters = { ...state.filters, ...action.filters };
      const same = filterNames.every((name) => filters[name] === state.filters[name]);
      return same ? state : { ...state, filters };
    }
    case "resetFilters":
      return state.filters === defaultReviewFilters
        ? state
        : { ...state, filters: defaultReviewFilters };
    case "decide":
      return decide(state, action.request);
    case "undo":
      return undo(state);
    case "settle":
      return settle(state);
    case "rest":
      return state.save.status === "saved"
        ? { ...state, save: { ...state.save, status: "idle" } }
        : state;
    case "failNext":
      return state.save.failsNext === action.fail
        ? state
        : { ...state, save: { ...state.save, failsNext: action.fail } };
    case "retry":
      return retry(state);
    case "discard":
      return state.save.status === "error"
        ? { ...state, save: idleSave, announcement: "The unsaved decision was discarded." }
        : state;
  }
}
