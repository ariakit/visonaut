import { useEffect, useMemo, useState } from "react";
import type { ReviewSessionReady, SessionItem } from "../../../../fixtures/hooks/index.ts";
import { defaultListFilter, filterList, groupByFamily } from "./model.ts";
import type { ListFamily, ListFilter, ListStatus } from "./model.ts";

// The app loads the unchanged screenshots in a second request (D-RUN-02).
// The lab shows the wait of that request one time.
const unchangedLatency = 400;

export interface ScreenshotListState {
  filter: ListFilter;
  setStatus(status: ListStatus): void;
  setQuery(query: string): void;
  /** Back to every change, with no search text. */
  reset(): void;
  /** The number of screenshots behind each status, under the search. */
  counts: Record<ListStatus, number>;
  /** The rows of the selected status, in run order. Empty for `unchanged`. */
  rows: readonly SessionItem[];
  /** Screenshots whose comparison still runs. Only the default status has them. */
  comparing: readonly SessionItem[];
  comparingOpen: boolean;
  setComparingOpen(open: boolean): void;
  /**
   * The unchanged screenshots by family: the `unchanged` status, and the
   * result of a search that no change matches. Null for every other list.
   */
  families: readonly ListFamily[] | null;
  /** True when `families` is the result of a search that no change matches. */
  fallback: boolean;
  /** False while the unchanged screenshots load. */
  familiesReady: boolean;
  isFamilyOpen(family: string): boolean;
  setFamilyOpen(family: string, open: boolean): void;
  /** The family labels of the whole run, by family. */
  labels: ReadonlyMap<string, string>;
  selectedKey: string | null;
  selectedVariantKey: string | null;
  /** The screenshot keys that the arrow keys step through, in list order. */
  order: readonly string[];
  /** The place of the selected screenshot in `order`, or -1. */
  position: number;
  /** Selects the previous or the next screenshot of the list. It stops at each end. */
  step(direction: 1 | -1): void;
  select(itemKey: string): void;
}

const noItems: readonly SessionItem[] = [];

// A search with at most this many unchanged matches opens their families,
// so the result is on screen. A wider result keeps the families closed, and
// the page does not render hundreds of rows.
const mostOpenMatches = 60;

/**
 * The state of the screenshot list of one review session: the status, the
 * search text, the rows, and the order that the arrow keys follow. The page
 * calls it, gives the result to `ScreenshotList`, and binds Up and Down to
 * `step`, so the keys follow the list on screen.
 * @example
 * const list = useScreenshotList(session);
 * useReviewShortcuts(session, {
 *   keys: { arrowup: () => list.step(-1), arrowdown: () => list.step(1) },
 * });
 * <ScreenshotList list={list} />
 */
export function useScreenshotList(session: ReviewSessionReady): ScreenshotListState {
  const [filter, setFilter] = useState(defaultListFilter);
  const [openFamilies, setOpenFamilies] = useState<ReadonlySet<string>>(() => new Set());
  const [comparingOpen, setComparingOpen] = useState(false);
  const [familiesLoaded, setFamiliesLoaded] = useState(false);
  const { items, selection, selectItem } = session;
  // A new scenario is a new run: the list starts again, as the session does.
  const [scenario, setScenario] = useState(session.scenario);
  if (scenario !== session.scenario) {
    setScenario(session.scenario);
    setFilter(defaultListFilter);
    setOpenFamilies(new Set());
    setComparingOpen(false);
  }

  const result = useMemo(() => filterList(items, filter), [items, filter]);
  // The session gives each family its label of the whole run.
  const labels = useMemo(() => {
    return new Map(session.families.map((group) => [group.family, group.label]));
  }, [session.families]);

  const changes = filter.status === "changes";
  const rows: readonly SessionItem[] = filter.status === "unchanged" ? noItems : result.items;
  const { counts } = result;
  const fallback = changes && !rows.length && result.fallback.length > 0;
  let unchanged: readonly SessionItem[] | null = null;
  if (filter.status === "unchanged") {
    unchanged = result.items;
  } else if (fallback) {
    unchanged = result.fallback;
  }
  const families = useMemo(() => {
    return unchanged ? groupByFamily(unchanged, labels) : null;
  }, [unchanged, labels]);

  const wantsFamilies = families != null;
  useEffect(() => {
    if (!wantsFamilies) return;
    if (familiesLoaded) return;
    const timeout = setTimeout(() => setFamiliesLoaded(true), unchangedLatency);
    return () => clearTimeout(timeout);
  }, [wantsFamilies, familiesLoaded]);

  const selectedKey = selection?.itemKey ?? null;
  const { comparing } = result;
  const order = useMemo(() => {
    if (unchanged) return unchanged.map((item) => item.key);
    const keys = rows.map((item) => item.key);
    if (!comparingOpen) return keys;
    return [...keys, ...comparing.map((item) => item.key)];
  }, [unchanged, rows, comparing, comparingOpen]);
  const position = selectedKey == null ? -1 : order.indexOf(selectedKey);

  const searchOpens = result.terms.length > 0 && (unchanged?.length ?? 0) <= mostOpenMatches;
  const setFamilyOpen = (family: string, open: boolean) => {
    setOpenFamilies((current) => {
      const next = new Set(current);
      if (open) {
        next.add(family);
      } else {
        next.delete(family);
      }
      return next;
    });
  };

  return {
    filter,
    setStatus: (status) => setFilter((current) => ({ ...current, status })),
    setQuery: (query) => setFilter((current) => ({ ...current, query })),
    reset: () => setFilter(defaultListFilter),
    counts,
    rows,
    comparing,
    comparingOpen,
    setComparingOpen,
    families,
    fallback,
    familiesReady: familiesLoaded,
    isFamilyOpen: (family) => searchOpens || openFamilies.has(family),
    setFamilyOpen,
    labels,
    selectedKey,
    selectedVariantKey: selection?.variantKey ?? null,
    order,
    position,
    step: (direction) => {
      // Without a selection in the list, a step selects its first screenshot.
      const key = order[position < 0 ? 0 : position + direction];
      if (key == null) return;
      // A step into a closed family opens it, so the selected row is on screen.
      const family = unchanged?.find((item) => item.key === key)?.family;
      if (family != null) {
        setFamilyOpen(family, true);
      }
      selectItem(key);
    },
    select: selectItem,
  };
}
