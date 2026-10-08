import { useEffect, useMemo, useReducer, useState } from "react";
import type { Dispatch } from "react";
import { useDataMode } from "../data-mode.ts";
import type { FamilyGroup } from "../derive.ts";
import type { ReviewRun, ReviewSelection, RunCounts, User } from "../types.ts";
import {
  createSessionState,
  deriveRunStatus,
  getReadOnlyState,
  getReviewView,
  sessionReducer,
  summarizeReview,
} from "./review-model.ts";
import type {
  DecisionAction,
  ItemGroup,
  ReadOnlyKind,
  ReviewCommand,
  ReviewFacets,
  ReviewFilters,
  ReviewOrder,
  ReviewProgress,
  SaveState,
  SessionAction,
  SessionItem,
  SessionVariant,
} from "./review-model.ts";
import { useRefresh } from "./use-refresh.ts";
import type { Refresh } from "./use-refresh.ts";
import { useViewer } from "./use-viewer.ts";
import type { Viewer } from "./use-viewer.ts";

export interface ReviewSessionOptions {
  /**
   * The order of the items and of the navigation. `status` lists the items by
   * group, as the app does. `declared` keeps the order of the run. Defaults to
   * `status`.
   */
  order?: ReviewOrder;
  /**
   * Moves the selection to the next variant that needs review after a
   * decision, as the app does. Defaults to true.
   */
  autoAdvance?: boolean;
  /** Milliseconds that a save stays in `saving`. Defaults to 450. */
  saveLatency?: number;
  /** Milliseconds that a save stays in `saved`. Defaults to 1600. */
  savedDuration?: number;
  /** Milliseconds of a refresh. Defaults to 700. */
  refreshLatency?: number;
}

/** A variant of the session, or its item key and variant key. */
export type ReviewTarget = ReviewSelection | SessionVariant;

/** Positions from 0. A position is -1 when the filters hide the selection. */
export interface ReviewPosition {
  /** The selected item in `visibleItems`. */
  item: number;
  itemCount: number;
  /** The selected variant in its item. */
  variant: number;
  variantCount: number;
  /** The selected variant in `queue`. */
  queue: number;
  queueCount: number;
}

/** What the page can do now. Use these values to disable controls. */
export interface ReviewAbilities {
  /** False for a read-only run and while a failed save waits. */
  decide: boolean;
  /** The selected variant takes this verdict and does not have it yet. */
  approve: boolean;
  reject: boolean;
  /** The selected variant has a verdict of a person. */
  clear: boolean;
  /** The selected item has a variant that this decision changes. */
  approveItem: boolean;
  rejectItem: boolean;
  /** At least one variant of the run needs review. */
  approveRemaining: boolean;
  undo: boolean;
}

export interface ReviewSessionActions {
  setFilters(filters: Partial<ReviewFilters>): void;
  setQuery(query: string): void;
  resetFilters(): void;
  /** Selects a variant and remembers it for its item. */
  select(target: ReviewTarget): void;
  /**
   * Selects an item with the variant that it had last, or its first variant
   * that needs review, or its first variant.
   */
  selectItem(itemKey: string): void;
  /** Selects a variant of the selected item by key, or by position from 0. */
  selectVariant(variant: string | number): void;
  /** The next variant in `queue`: it crosses items. It stops at the end. */
  next(): void;
  previous(): void;
  /** The next item in `visibleItems`. It stops at the end. */
  nextItem(): void;
  previousItem(): void;
  /** The next variant of the selected item. It stops at the end. */
  nextVariant(): void;
  previousVariant(): void;
  /** The next variant in `queue` that needs review. It wraps. */
  nextUndecided(): void;
  previousUndecided(): void;
  /**
   * Approves the selected variant, or the given variants. When the decision
   * covers the selection, the selection moves to the next variant that needs
   * review.
   */
  approve(targets?: ReviewTarget | ReviewTarget[]): void;
  reject(targets?: ReviewTarget | ReviewTarget[]): void;
  /** Removes the verdict of a person. The selection stays. */
  clear(targets?: ReviewTarget | ReviewTarget[]): void;
  /**
   * Approves every changed, added, and removed variant of the selected item,
   * or of the given item, as one command.
   */
  approveItem(itemKey?: string): void;
  rejectItem(itemKey?: string): void;
  /**
   * Approves every variant that needs review as one command. `visible` limits
   * it to the variants that pass the filters. Defaults to `run`.
   */
  approveRemaining(scope?: "run" | "visible"): void;
  /** Takes back the last command and returns to its selection. */
  undo(): void;
  /** Makes the next save fail, to show the error state. */
  failNextSave(fail?: boolean): void;
  /** Sends the failed decisions again. */
  retrySave(): void;
  /** Drops the failed decisions and unblocks the page. */
  discardFailedSave(): void;
}

interface ReviewSessionBase extends Refresh {
  /** The scenario of the state. */
  scenario: string;
}

export interface ReviewSessionLoading extends ReviewSessionBase {
  status: "loading";
}

export interface ReviewSessionError extends ReviewSessionBase {
  status: "error";
  message: string;
  reference?: string;
}

export interface ReviewSessionReady extends ReviewSessionBase, ReviewSessionActions {
  status: "ready";
  user: User;
  /**
   * The run with the local decisions: its items, its run status, and its
   * counts when the data mode has them (not `today`). For counts in every
   * data mode, read `counts`.
   */
  review: ReviewRun;
  run: ReviewRun["run"];
  /** Every item, in run order, with its status and counts. */
  items: SessionItem[];
  /** The items with a matching variant, in navigation order. */
  visibleItems: SessionItem[];
  /** The visible items by status, in list order. Skip the empty groups. */
  groups: ItemGroup[];
  /**
   * The visible items by family, in run order, with the counts of each family
   * and of each key group inside it. Production has 26 families.
   */
  families: Array<FamilyGroup<SessionItem>>;
  /** The matching variants of the visible items, in navigation order. */
  queue: SessionVariant[];
  counts: RunCounts;
  progress: ReviewProgress;
  /** True when no variant waits for a verdict or a comparison. */
  complete: boolean;

  filters: ReviewFilters;
  /** True when a filter or a query is active. */
  filtered: boolean;
  facets: ReviewFacets;

  selection: ReviewSelection | null;
  item: SessionItem | null;
  variant: SessionVariant | null;
  position: ReviewPosition;

  /** Mode, zoom, and compare controls for the selected variant. */
  viewer: Viewer;

  can: ReviewAbilities;
  readOnly: boolean;
  readOnlyKind: ReadOnlyKind | null;
  /** Why the run takes no decisions, as a sentence. Null when it does. */
  readOnlyReason: string | null;

  save: SaveState;
  /** The undo stack, oldest first. */
  history: ReviewCommand[];
  lastCommand: ReviewCommand | null;

  /** The latest event as a sentence. Put it in a polite live region. */
  announcement: string;
  shortcutsEnabled: boolean;
  setShortcutsEnabled(enabled: boolean): void;
}

export type ReviewSession = ReviewSessionLoading | ReviewSessionError | ReviewSessionReady;

function toSelection(target: ReviewTarget): ReviewSelection {
  if ("variantKey" in target) return target;
  return { itemKey: target.itemKey, variantKey: target.key };
}

function toSelections(targets: ReviewTarget | ReviewTarget[] | undefined) {
  if (!targets) return;
  return (Array.isArray(targets) ? targets : [targets]).map(toSelection);
}

function createActions(dispatch: Dispatch<SessionAction>): ReviewSessionActions {
  const decide = (action: DecisionAction, targets?: ReviewTarget | ReviewTarget[]) => {
    dispatch({
      type: "decide",
      request: { action, scope: "variant", targets: toSelections(targets) },
    });
  };
  const decideItem = (action: DecisionAction, itemKey?: string) => {
    dispatch({ type: "decide", request: { action, scope: "item", itemKey } });
  };
  return {
    setFilters: (filters) => dispatch({ type: "setFilters", filters }),
    setQuery: (query) => dispatch({ type: "setFilters", filters: { query } }),
    resetFilters: () => dispatch({ type: "resetFilters" }),
    select: (target) => dispatch({ type: "select", selection: toSelection(target) }),
    selectItem: (itemKey) => dispatch({ type: "selectItem", itemKey }),
    selectVariant: (variant) => dispatch({ type: "selectVariant", variant }),
    next: () => dispatch({ type: "move", target: "queue", step: 1 }),
    previous: () => dispatch({ type: "move", target: "queue", step: -1 }),
    nextItem: () => dispatch({ type: "move", target: "item", step: 1 }),
    previousItem: () => dispatch({ type: "move", target: "item", step: -1 }),
    nextVariant: () => dispatch({ type: "move", target: "variant", step: 1 }),
    previousVariant: () => dispatch({ type: "move", target: "variant", step: -1 }),
    nextUndecided: () => dispatch({ type: "move", target: "undecided", step: 1 }),
    previousUndecided: () => dispatch({ type: "move", target: "undecided", step: -1 }),
    approve: (targets) => decide("approve", targets),
    reject: (targets) => decide("reject", targets),
    clear: (targets) => decide("clear", targets),
    approveItem: (itemKey) => decideItem("approve", itemKey),
    rejectItem: (itemKey) => decideItem("reject", itemKey),
    approveRemaining: (scope = "run") => {
      dispatch({
        type: "decide",
        request: { action: "approve", scope: "run", visibleOnly: scope === "visible" },
      });
    },
    undo: () => dispatch({ type: "undo" }),
    failNextSave: (fail = true) => dispatch({ type: "failNext", fail }),
    retrySave: () => dispatch({ type: "retry" }),
    discardFailedSave: () => dispatch({ type: "discard" }),
  };
}

function changes(variant: SessionVariant, verdict: "approved" | "rejected") {
  if (!variant.reviewable) return false;
  if (verdict === "approved" ? variant.approveDisabledReason : variant.rejectDisabledReason) {
    return false;
  }
  return !(variant.verdict === verdict && variant.source === "human");
}

/** A whole item is all or nothing: one protected variant blocks the command. */
function changesItem(item: SessionItem, verdict: "approved" | "rejected") {
  const targets = item.variants.filter((variant) => variant.reviewable);
  const blocked = targets.some((variant) =>
    verdict === "approved" ? variant.approveDisabledReason : variant.rejectDisabledReason,
  );
  if (blocked) return false;
  return targets.some((variant) => changes(variant, verdict));
}

/**
 * The state of the review workspace for one scenario: the run, the item list
 * with filters and groups, the selection, the viewer, decisions with a
 * simulated save, and Undo. Everything is local React state. Narrow the result
 * on `status` before you read the run.
 */
export function useReviewSession(
  scenario: string,
  options: ReviewSessionOptions = {},
): ReviewSession {
  const {
    order = "status",
    autoAdvance = true,
    saveLatency = 450,
    savedDuration = 1600,
    refreshLatency,
  } = options;
  const mode = useDataMode();
  const [state, dispatch] = useReducer(
    sessionReducer,
    { scenario, mode, order, autoAdvance },
    createSessionState,
  );
  if (state.scenario !== scenario || state.mode !== mode) {
    dispatch({ type: "reset", scenario, mode, order, autoAdvance });
  } else if (state.order !== order || state.autoAdvance !== autoAdvance) {
    dispatch({ type: "configure", order, autoAdvance });
  }
  const [shortcutsEnabled, setShortcutsEnabled] = useState(true);
  const refresh = useRefresh(scenario, refreshLatency);
  const actions = useMemo(() => createActions(dispatch), []);

  const { data, items, filters, selection, history, save } = state;
  const view = getReviewView(items, filters, state.order);
  const item = view.itemsByKey.get(selection?.itemKey ?? "") ?? null;
  const variant = item?.variants.find((entry) => entry.key === selection?.variantKey) ?? null;
  const viewer = useViewer(variant);

  // Each new command or undo restarts the wait, so quick decisions save as
  // one batch.
  useEffect(() => {
    if (save.status !== "saving") return;
    const timeout = setTimeout(() => dispatch({ type: "settle" }), saveLatency);
    return () => clearTimeout(timeout);
  }, [save.status, state.saveSequence, saveLatency]);
  useEffect(() => {
    if (save.status !== "saved") return;
    const timeout = setTimeout(() => dispatch({ type: "rest" }), savedDuration);
    return () => clearTimeout(timeout);
  }, [save.status, state.saveSequence, savedDuration]);

  if (data.status === "loading") return { status: "loading", scenario, ...refresh };
  if (data.status === "error") {
    const { message, reference } = data;
    return { status: "error", scenario, message, ...(reference ? { reference } : {}), ...refresh };
  }

  const { counts, progress } = summarizeReview(items);
  const run = { ...data.review.run, status: deriveRunStatus(data.review.run.status, counts) };
  const readOnly = getReadOnlyState(data.review);
  const decides = !readOnly && save.status !== "error";
  return {
    status: "ready",
    scenario,
    ...refresh,
    ...actions,
    user: data.user,
    // The run keeps the fields of its data mode: the API today sends no
    // counts with a run. `counts` of the session is there in every mode.
    review: {
      ...data.review,
      run,
      items: view.items,
      ...(data.review.counts ? { counts } : {}),
    },
    run,
    items: view.items,
    visibleItems: view.visibleItems,
    groups: view.groups,
    families: view.families,
    queue: view.queue,
    counts,
    progress,
    complete: !counts.undecided && !counts.comparing && !counts.error,
    filters,
    filtered: view.filtered,
    facets: view.facets,
    selection,
    item,
    variant,
    position: {
      item: item ? view.visibleItems.indexOf(item) : -1,
      itemCount: view.visibleItems.length,
      variant: variant ? variant.index : -1,
      variantCount: item ? item.variants.length : 0,
      queue: variant ? view.queue.indexOf(variant) : -1,
      queueCount: view.queue.length,
    },
    viewer,
    can: {
      decide: decides,
      approve: decides && !!variant && changes(variant, "approved"),
      reject: decides && !!variant && changes(variant, "rejected"),
      clear:
        decides &&
        !!variant &&
        variant.reviewable &&
        variant.source === "human" &&
        variant.verdict !== null,
      approveItem: decides && !!item && changesItem(item, "approved"),
      rejectItem: decides && !!item && changesItem(item, "rejected"),
      approveRemaining: decides && progress.remaining > 0,
      undo: history.length > 0 && save.status !== "error",
    },
    readOnly: !!readOnly,
    readOnlyKind: readOnly?.kind ?? null,
    readOnlyReason: readOnly?.reason ?? null,
    save,
    history,
    lastCommand: history.at(-1) ?? null,
    announcement: state.announcement,
    shortcutsEnabled,
    setShortcutsEnabled,
  };
}
