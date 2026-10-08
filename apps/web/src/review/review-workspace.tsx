import * as ak from "@ariakit/react";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Check,
  ChevronDown,
  GitCommitHorizontal,
  GitBranch,
  Keyboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Undo2,
  X,
  Columns2Icon,
  ScanIcon,
  ImageIcon,
  ImageMinusIcon,
  DiffIcon,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { ControlButton as Button } from "../components/control-button.tsx";
import {
  Button as FlatButton,
  ButtonGroup,
  ButtonGlider,
  ButtonSlot,
  ButtonLabel,
} from "../components/ariakit/components/button.ariakit.react.tsx";
import {
  Shell,
  ShellMain,
  ShellMainHeader,
  ShellMainFull,
  ShellMainIntro,
  ShellMainBody,
  ShellFooter,
  ShellSidebar,
  ShellSidebarBody,
  ShellSidebarHeader,
} from "../components/ariakit/components/shell.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Layer } from "../components/ariakit/components/layer.ariakit.react.tsx";
import { AppHeader } from "../components/app-shell.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { ReviewStatus } from "./review-status.tsx";
import { sidebarStorageKey } from "./sidebar-preference.ts";
import { Nav, NavLink } from "../components/ariakit/components/nav.ariakit.react.tsx";
import { ScreenshotViewer } from "../components/screenshot-viewer.tsx";
import { ItemList } from "./item-list.tsx";
import type {
  ReviewCommands,
  ReviewModel,
  ReviewMode,
  ReviewSelection,
  ReviewVerdict,
  ReviewZoom,
} from "./model.ts";
import { needsReview, partitionItems, reviewTargets, verdictLabel } from "./navigation.ts";
import { useEvidence } from "./use-evidence.ts";
import { useReviewSession } from "./use-review-session.ts";
import { VariantSummary } from "./variant-summary.tsx";
import "../review.css";

export interface ReviewWorkspaceProps {
  model: ReviewModel;
  commands: ReviewCommands;
  route?: ReviewRoute;
  headerEnd?: ReactNode;
}

export interface ReviewRoute {
  runId: string;
  comparisonId?: string;
  selection?: ReviewSelection;
  onSelect(selection: ReviewSelection): void;
}

interface BatchReviewScope {
  comparisonId: string;
  selection: ReviewSelection;
  targetIds: string[];
}

function excludesShortcuts(event: globalThis.KeyboardEvent) {
  const target = event.target;
  if (!target) return true;
  if (!("nodeType" in target)) return true;
  if (target.nodeType !== 1) return true;
  const element = target as HTMLElement;
  return !!element.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menu"], [role="menubar"], [role="dialog"], [role="alertdialog"], [role="tablist"], [data-screenshot-search]',
  );
}

// Scroll only the strip. `scrollIntoView` also moves the page.
function revealSelectedVariant(strip: HTMLElement) {
  const chip = strip.querySelector<HTMLElement>('[aria-current="page"]');
  if (!chip) return;
  const stripBox = strip.getBoundingClientRect();
  const chipBox = chip.getBoundingClientRect();
  if (chipBox.left >= stripBox.left && chipBox.right <= stripBox.right) return;
  const centered = (stripBox.width - chipBox.width) / 2;
  strip.scrollLeft += chipBox.left - stripBox.left - centered;
}

function followVariantLink(event: KeyboardEvent<HTMLElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a"));
  const index = links.findIndex((link) => link === event.target);
  if (index < 0) return;
  const nextIndex =
    event.key === "ArrowLeft"
      ? index - 1
      : event.key === "ArrowRight"
        ? index + 1
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? links.length - 1
            : undefined;
  if (nextIndex === undefined) return;
  event.preventDefault();
  const next = links[nextIndex];
  if (!next) return;
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
  next.click();
}

function initialSelection(model: ReviewModel): ReviewSelection {
  for (const index of partitionItems(model.items).order) {
    const item = model.items[index];
    const variant = item?.variants.find(needsReview) ?? item?.variants[0];
    if (item && variant) {
      return { itemKey: item.key, variantKey: variant.key };
    }
  }
  return { itemKey: "", variantKey: "" };
}

function terminalEvidenceMessage(model: ReviewModel) {
  switch (model.run.status) {
    case "superseded":
      return "A newer attempt replaced this comparison. Its evidence cannot be reviewed.";
    case "needs-recompare":
      return "This comparison is out of date. Run the trusted workflow again to submit a fresh comparison.";
    case "failed":
      return "This capture or comparison failed. Its evidence cannot be reviewed.";
    default:
      return "This comparison was invalidated. Its evidence cannot be reviewed.";
  }
}

function ShortcutHelp() {
  return (
    <ak.DialogProvider>
      <ak.DialogDisclosure render={<Button $p={1.5} aria-label="Keyboard help" />}>
        <ButtonSlot>
          <Keyboard />
        </ButtonSlot>
      </ak.DialogDisclosure>
      <ak.Dialog
        render={<Frame $layer="canvas" $border $rounded="lg" $p={5} />}
        className="review-help-dialog fixed inset-[50%_auto_auto_50%] -translate-x-1/2 -translate-y-1/2 w-[min(540px,calc(100vw-32px))] max-h-[calc(100dvh-32px)] overflow-auto z-50 text-sm"
        backdrop={<Layer $layer="canvas" className="fixed inset-0 z-40 bg-black/50!" />}
      >
        <ak.DialogHeading>Review with the keyboard</ak.DialogHeading>
        <ak.DialogDescription>
          Shortcuts work across this page. Text fields, tabs, menus, and dialogs keep their own
          keys. Use the visible pan buttons to move zoomed images.
        </ak.DialogDescription>
        <dl className="grid grid-cols-[auto_1fr] gap-3 my-5">
          <dt>↑ / ↓</dt>
          <dd>Previous or next item. Stop at either end.</dd>
          <dt>← / → · 1–6</dt>
          <dd>Select a variant.</dd>
          <dt>A / X</dt>
          <dd>Approve or reject, then move to the next pending variant.</dd>
          <dt>Shift+A / Shift+X</dt>
          <dd>Review all changed variants in this item as one command.</dd>
          <dt>S / D / F / G</dt>
          <dd>Side by side, red pixel diff, new image only, or original only.</dd>
          <dt>Cmd/Ctrl+Z</dt>
          <dd>Undo your last saved command in this session.</dd>
          <dt>[</dt>
          <dd>Collapse or expand the screenshot sidebar.</dd>
          <dt>Tab / Escape</dt>
          <dd>Move to controls or close this help.</dd>
        </dl>
        <ak.DialogDismiss render={<Button className="text-xs" />}>
          <ButtonLabel>Close help</ButtonLabel>
        </ak.DialogDismiss>
      </ak.Dialog>
    </ak.DialogProvider>
  );
}

export function ReviewWorkspace(props: ReviewWorkspaceProps) {
  return <ReviewSession key={props.model.run.id} {...props} />;
}

function ReviewSession({ model: suppliedModel, commands, route, headerEnd }: ReviewWorkspaceProps) {
  const [localSelection, setLocalSelection] = useState(() => initialSelection(suppliedModel));
  const [mode, setMode] = useState<ReviewMode>("side");
  const [zoom, setZoom] = useState<ReviewZoom>("fit");
  const [shortcuts, setShortcuts] = useState(true);
  const [retry, setRetry] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(
    () =>
      typeof document === "undefined" ||
      document.documentElement.dataset.reviewSidebarOpen !== "false",
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [batchScope, setBatchScope] = useState<BatchReviewScope | null>(null);
  const [order, setOrder] = useState(() => partitionItems(suppliedModel.items).order);
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches,
  );
  const sidebarTrigger = useRef<HTMLButtonElement>(null);
  const detailsTrigger = useRef<HTMLButtonElement>(null);
  const toggleSidebar = () => {
    setSidebarOpen((open) => !open);
    sidebarTrigger.current?.focus();
  };
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.reviewSidebarOpen = String(sidebarOpen);
    try {
      localStorage.setItem(sidebarStorageKey, String(sidebarOpen));
    } catch {
      /* Keep the control usable when storage is unavailable. */
    }
  }, [sidebarOpen]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === sidebarStorageKey || event.key === null)
        setSidebarOpen(event.newValue !== "false");
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const remembered = useRef(
    new Map<string, string>(
      route?.selection ? [[route.selection.itemKey, route.selection.variantKey]] : [],
    ),
  );
  const workspace = useRef<HTMLDivElement>(null);
  const variantStrip = useRef<HTMLElement>(null);
  const focusWorkspace = () => workspace.current?.focus({ preventScroll: true });
  const select = (next: ReviewSelection) => {
    if (route) route.onSelect(next);
    else setLocalSelection(next);
  };
  const session = useReviewSession({
    model: suppliedModel,
    commands,
    onSelect: select,
    onFocus: focusWorkspace,
    onAnnounce: setAnnouncement,
    onRefresh: () => setRetry((value) => value + 1),
  });
  const {
    model,
    pendingReviews,
    saveState,
    busy,
    reviewBlocked,
    sendingCount,
    queuedCount,
    canUndo,
    pendingComparison,
    awaitingComparison,
    terminalComparison,
    runStatus,
    save,
    undo,
    refresh,
    recompare,
  } = session;
  const routedSelection = route?.selection;
  const onRouteSelect = route?.onSelect;
  const routedItem = model.items.find((entry) => entry.key === routedSelection?.itemKey);
  const routedVariant = routedItem?.variants.find(
    (entry) => entry.key === routedSelection?.variantKey,
  );
  const routedFallback = routedItem?.variants.find(needsReview) ?? routedItem?.variants[0];
  const selection = route
    ? routedFallback
      ? { itemKey: routedItem?.key ?? "", variantKey: routedVariant?.key ?? routedFallback.key }
      : initialSelection(model)
    : localSelection;
  const item = model.items.find((entry) => entry.key === selection.itemKey) ?? model.items[0];
  const variant =
    item?.variants.find((entry) => entry.key === selection.variantKey) ?? item?.variants[0];
  const effectiveMode =
    mode === "diff" && (!variant?.reference || !variant.candidate) ? "side" : mode;
  const evidence = useEvidence({
    comparisonId: model.comparisonId,
    variant: model.evidenceState === "summary" ? undefined : variant,
    mode: effectiveMode,
    retry,
  });
  const ready =
    !model.archived &&
    !pendingComparison &&
    !terminalComparison &&
    model.reviewReady &&
    evidence.status === "ready";
  const targets = item ? reviewTargets(item) : [];
  const batchValid =
    batchScope !== null &&
    batchScope.comparisonId === model.comparisonId &&
    batchScope.selection.itemKey === selection.itemKey &&
    batchScope.selection.variantKey === selection.variantKey &&
    batchScope.targetIds.length === targets.length &&
    targets.every((target, index) => target.id === batchScope.targetIds[index]);
  if (batchScope && !batchValid) setBatchScope(null);
  const counts = useMemo(
    () => ({
      pending: model.items.reduce(
        (count, entry) => count + entry.variants.filter(needsReview).length,
        0,
      ),
      total: model.items.reduce((count, entry) => count + entry.variants.length, 0),
    }),
    [model.items],
  );
  const { pending, total } = counts;
  const recompareAllowed = !model.archived && (model.recompareAllowed ?? true);
  const recompareDisabledReason =
    model.recompareDisabledReason ??
    (model.archived ? "This closed review is read-only. Capture a new complete run." : undefined);
  const retryImages =
    !terminalComparison && (evidence.failure === "load" || evidence.failure === "decode");
  const recompareEvidence =
    terminalComparison ||
    evidence.failure === "comparison" ||
    evidence.failure === "missing" ||
    evidence.failure === "dimensions";

  if (
    !route &&
    item &&
    variant &&
    (item.key !== selection.itemKey || variant.key !== selection.variantKey)
  ) {
    setLocalSelection({ itemKey: item.key, variantKey: variant.key });
    setAnnouncement(`The remembered variant is unavailable. Selected ${variant.label}.`);
  }
  useEffect(() => {
    if (!routedSelection || !onRouteSelect || !item || !variant) return;
    if (item.key === routedSelection.itemKey && variant.key === routedSelection.variantKey) return;
    onRouteSelect({ itemKey: item.key, variantKey: variant.key });
  }, [item, variant, routedSelection, onRouteSelect]);

  const selectedVariantId = variant?.id;
  useLayoutEffect(() => {
    if (variantStrip.current) {
      revealSelectedVariant(variantStrip.current);
    }
  }, [selectedVariantId]);

  const selectItem = (index: number) => {
    const next = model.items[index];
    if (!next) return;
    const previous = remembered.current.get(next.key);
    const selected =
      next.variants.find((entry) => entry.key === previous) ??
      next.variants.find(needsReview) ??
      next.variants[0];
    if (!selected) return;
    select({ itemKey: next.key, variantKey: selected.key });
    if (previous && previous !== selected.key) {
      setAnnouncement(`The remembered variant is unavailable. Selected ${selected.label}.`);
    }
  };
  const selectVariant = (index: number) => {
    if (!item) return;
    const next = item.variants[index];
    if (!next) return;
    remembered.current.set(item.key, next.key);
    select({ itemKey: item.key, variantKey: next.key });
  };
  const setView = (next: ReviewMode) => {
    if (next === "diff" && (!variant?.reference || !variant.candidate)) {
      setAnnouncement(
        "Pixel diff requires both a reference and a new image. The current view has not changed.",
      );
      return;
    }
    setMode(next);
  };
  const review = (verdict: ReviewVerdict, wholeItem = false) => {
    if (!ready) return;
    if (reviewBlocked) return;
    session.review(verdict, selection, wholeItem);
  };
  const reviewBatch = (verdict: ReviewVerdict) => {
    if (!batchValid || !batchScope || !ready || reviewBlocked) return;
    session.review(verdict, batchScope.selection, true);
    setBatchScope(null);
  };
  const onKeyDown = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || !shortcuts) return;
    if (excludesShortcuts(event)) return;
    if (event.altKey) return;
    const key = event.key.toLowerCase();
    if (event.metaKey || event.ctrlKey) {
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        void undo();
      }
      return;
    }
    if (key === "[" && !narrow) {
      event.preventDefault();
      toggleSidebar();
      return;
    }
    if (!item || !variant) return;
    const itemIndex = model.items.indexOf(item);
    const itemPosition = order.indexOf(itemIndex);
    const variantIndex = item.variants.indexOf(variant);
    const selectsByKey = key.startsWith("arrow") || /^[1-6]$/.test(key);
    if (key === "arrowup") {
      selectItem(order[itemPosition - 1] ?? -1);
    } else if (key === "arrowdown") {
      selectItem(order[itemPosition + 1] ?? -1);
    } else if (key === "arrowleft") {
      selectVariant(variantIndex - 1);
    } else if (key === "arrowright") {
      selectVariant(variantIndex + 1);
    } else if (/^[1-6]$/.test(key)) {
      selectVariant(Number(key) - 1);
    } else if (key === "a") {
      review("approved", event.shiftKey);
    } else if (key === "x") {
      review("rejected", event.shiftKey);
    } else if (key === "s") {
      setView("side");
    } else if (key === "d") {
      setView("diff");
    } else if (key === "f") {
      setView("new");
    } else if (key === "g") {
      setView("original");
    } else {
      return;
    }
    event.preventDefault();
    // A selection key can change the selection while a chip has focus. Move
    // focus away so that the strip does not step from the stale chip. The
    // target is a node here, because excludesShortcuts checked it.
    if (selectsByKey && variantStrip.current?.contains(event.target as Node)) {
      focusWorkspace();
    }
  });
  useEffect(() => {
    const document = workspace.current?.ownerDocument;
    if (!document) return;
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const itemNavigation = (
    <ItemList
      items={model.items}
      onOrderChange={setOrder}
      selectedIndex={item ? model.items.indexOf(item) : -1}
      selectItem={selectItem}
      route={route}
      variantKeyForItem={(entry) => entry.variants.find(needsReview)?.key ?? entry.variants[0]?.key}
    />
  );
  const captureDetails = variant && (
    <div className="grid gap-3 text-xs">
      {" "}
      <p className="text-xs wrap-anywhere">
        {variant.label} · {verdictLabel(variant)}
        {variant.reviewer ? ` · ${variant.reviewer}` : ""}
      </p>
      <p className="text-xs">{runStatus}</p>
      <p className="review-run-identity text-xs">
        Run {model.run.id} · Attempt {model.run.attempt} · Commit{" "}
        <code>{model.run.testedSha.slice(0, 12)}</code> ·{" "}
        <span>Comparison {model.comparisonRevision}</span>
      </p>
      <nav aria-label="Comparison history" className="flex flex-wrap gap-3 text-xs">
        <a href={`/runs/${encodeURIComponent(model.run.id)}`}>Original comparison</a>
        {model.historicalComparisons?.map((comparison) => (
          <a
            key={comparison.id}
            href={`/runs/${encodeURIComponent(model.run.id)}?comparison=${encodeURIComponent(comparison.id)}`}
            aria-current={comparison.id === model.comparisonId ? "page" : undefined}
          >
            Historical comparison {comparison.ordinal} ·{" "}
            {comparison.state === "ready"
              ? "Complete"
              : comparison.state === "invalidated"
                ? "Failed"
                : "Comparing"}
          </a>
        ))}
      </nav>
      <dl className="grid grid-cols-1 gap-2 my-5 [&>dt]:mt-2 [&>dt]:opacity-50 [&>dd]:wrap-anywhere">
        <dt>Changed pixels</dt>
        <dd>
          {variant.changedPixels?.toLocaleString() ?? "—"}
          {variant.ratio != null ? ` (${(variant.ratio * 100).toFixed(4)}%)` : ""}
        </dd>
        <dt>Dimensions</dt>
        <dd>
          {variant.reference
            ? `${variant.reference.width} × ${variant.reference.height}`
            : "Absent"}{" "}
          →{" "}
          {variant.candidate
            ? `${variant.candidate.width} × ${variant.candidate.height}`
            : "Absent"}
        </dd>
        <dt>Engine / codec</dt>
        <dd>
          {variant.engine ?? "—"} / {variant.codec ?? "—"}
        </dd>
        <dt>Policy / threshold</dt>
        <dd>
          {variant.policy ?? "—"} / {variant.threshold ?? "—"}
        </dd>
        <dt>Capture profiles</dt>
        <dd>
          {variant.referenceProfile ?? "Absent"} → {variant.candidateProfile ?? "Absent"}
        </dd>
        <dt>Comparison</dt>
        <dd>
          {model.comparisonId} · {variant.id} · decision revision {variant.revision}
        </dd>
      </dl>
    </div>
  );
  const itemPosition = item ? order.indexOf(model.items.indexOf(item)) : -1;

  return (
    <Shell
      className="review-workspace [--shell-header-step:calc(48px/14)]"
      ref={workspace}
      tabIndex={0}
      aria-label="Review workspace"
      $layer="canvas"
    >
      <AppHeader repository={model.run.repository} end={headerEnd} />
      <ShellSidebar
        id="review-screenshots"
        $show="5xl"
        $from="main"
        $width="md"
        $border
        open={sidebarOpen}
        render={<aside />}
        className="review-sidebar"
        aria-label="Review navigation"
      >
        <ShellSidebarHeader $height="sm" $p={4} className="flex items-center justify-between">
          <Text className="text-[10px] uppercase tracking-[0.14em] font-semibold opacity-60">
            Screenshots
          </Text>
          <Text className="text-[11px] opacity-50">
            {model.items.length} {model.items.length === 1 ? "item" : "items"}
          </Text>
        </ShellSidebarHeader>
        <ShellSidebarBody
          $p={5}
          className="review-sidebar-body min-h-0 flex flex-col overflow-hidden! pt-0!"
        >
          {!narrow && itemNavigation}
        </ShellSidebarBody>
      </ShellSidebar>
      <ShellMain $maxWidth="100%" $p="clamp(1rem,2.5vw,2rem)" className="review-main">
        <ShellMainHeader $height="sm" $border>
          <ShellMainFull>
            <div className="flex min-w-0 items-center justify-between gap-3 px-4 sm:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <Button
                  ref={sidebarTrigger}
                  $p={2}
                  className="@max-5xl/shell:hidden"
                  aria-label={sidebarOpen ? "Collapse screenshots" : "Expand screenshots"}
                  aria-expanded={sidebarOpen}
                  aria-controls="review-screenshots"
                  aria-keyshortcuts={shortcuts ? "[" : undefined}
                  title="Toggle screenshots ([)"
                  onClick={toggleSidebar}
                >
                  <ButtonSlot>{sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}</ButtonSlot>
                </Button>
                <Button $p={1} render={<a href="/" />}>
                  <ButtonSlot>
                    <ArrowLeft />
                  </ButtonSlot>
                  <ButtonLabel>Queue</ButtonLabel>
                </Button>
                <Text className="truncate text-xs font-medium">
                  {model.run.title ??
                    (model.run.kind === "main"
                      ? "Main visual review"
                      : model.run.kind === "merge_group"
                        ? "Merge queue visual review"
                        : "Pull request visual review")}
                </Text>
              </div>
              <div className="review-run-progress flex shrink-0 items-center gap-3">
                <Text className="text-xs opacity-60">
                  {pending} of {total} need review
                </Text>
                <progress
                  aria-label="Review progress"
                  max={Math.max(total, 1)}
                  value={total - pending}
                  className="hidden sm:block h-1.5 w-16 accent-brand"
                />
              </div>
            </div>
          </ShellMainFull>
        </ShellMainHeader>
        <ShellMainIntro className="py-0! border-b border-(--ak-edge)">
          <div className="flex flex-wrap items-center gap-4 py-2 text-[10px] opacity-50">
            <span className="flex items-center gap-1">
              <GitCommitHorizontal size={12} />
              {model.run.testedSha.slice(0, 7)}
            </span>
            <span>Attempt {model.run.attempt}</span>
            <span className="flex items-center gap-1">
              <GitBranch size={12} />
              Baseline revision {model.baselineRevision}
            </span>
            <span className="ml-auto">{runStatus}</span>
          </div>
        </ShellMainIntro>
        <ShellMainBody className="pb-0!">
          <div className="min-w-0">
            {narrow && (
              <Button $border className="mb-4" onClick={() => setItemsOpen(true)}>
                <ButtonLabel>Screenshots</ButtonLabel>
                <ButtonSlot>
                  <ChevronDown />
                </ButtonSlot>
              </Button>
            )}
            <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
              <div className="review-result-heading min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <Text
                    render={<h1 />}
                    className="text-2xl sm:text-[28px] font-semibold tracking-tight wrap-anywhere"
                  >
                    {item?.name ?? "Visual review"}
                  </Text>
                  {variant && <ReviewStatus variant={variant} />}
                </div>
                {variant && (
                  <Text render={<p />} className="mt-2 text-xs opacity-55">
                    {variant.ratio != null ? (variant.ratio * 100).toFixed(2) + "% changed · " : ""}
                    {variant.changedPixels?.toLocaleString() ?? "—"} changed pixels
                  </Text>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  $p={2}
                  aria-label="Previous screenshot"
                  title="Previous screenshot (↑)"
                  disabled={itemPosition <= 0}
                  onClick={() => selectItem(order[itemPosition - 1] ?? -1)}
                >
                  <ButtonSlot>
                    <ArrowUp />
                  </ButtonSlot>
                </Button>
                <Button
                  $p={2}
                  aria-label="Next screenshot"
                  title="Next screenshot (↓)"
                  disabled={!order.length || itemPosition >= order.length - 1}
                  onClick={() => selectItem(order[itemPosition + 1] ?? -1)}
                >
                  <ButtonSlot>
                    <ArrowDown />
                  </ButtonSlot>
                </Button>
                <Button
                  $border
                  ref={detailsTrigger}
                  aria-label="Details"
                  aria-expanded={detailsOpen}
                  aria-controls="capture-details"
                  onClick={() => setDetailsOpen((open) => !open)}
                >
                  <ButtonSlot>
                    <Settings2 />
                  </ButtonSlot>
                  <ButtonLabel>Details</ButtonLabel>
                </Button>
              </div>
            </div>
            {model.run.error && (
              <p role="alert" className="text-sm p-3 ak-layer-warning">
                {model.run.error}
              </p>
            )}
            {model.archived && (
              <p className="text-sm p-3 ak-layer-warning" role="status">
                {model.readOnlyReason ??
                  "This closed run is read-only. Its review history remains available."}
              </p>
            )}
            {!model.archived && !model.reviewReady && !terminalComparison && (
              <p className="text-sm p-3 ak-layer-warning" role="status">
                Review is unavailable until the run is sealed and all comparisons are complete.
              </p>
            )}
            {pendingComparison && (
              <p className="text-sm p-3 ak-layer-warning" role="status">
                A new comparison is being prepared from stored captures. The previous comparison
                remains visible until the new evidence is ready.
              </p>
            )}

            {item && variant && (
              <Nav
                $layout="horizontal"
                $rounded="full"
                $forceRounded
                $p={1}
                $gap={1.5}
                glider={{
                  $kind: "flat",
                  $rounded: "full",
                  $forceRounded: true,
                  $lightnessPush: false,
                  $lightnessOffset: false,
                  $lighten: 2,
                  $border: true,
                }}
                aria-label="Variants"
                className="review-variants max-w-full mb-4"
                ref={variantStrip}
                onKeyDown={followVariantLink}
              >
                {item.variants.map((entry, index) => (
                  <NavLink
                    $kind="flat"
                    $rounded="full"
                    $forceRounded
                    $size="sm"
                    $border
                    $selectedPush={false}
                    $p={2}
                    $px="0.75rem"
                    aria-current={entry.id === variant.id ? "page" : undefined}
                    href={route ? undefined : `#variant-${encodeURIComponent(entry.key)}`}
                    key={entry.id}
                    id={entry.id}
                    className="review-variant min-w-0 text-xs"
                    title={`${entry.label} · ${verdictLabel(entry)}`}
                    render={
                      route ? (
                        <Link
                          to="/runs/$runId"
                          params={{ runId: route.runId }}
                          search={{
                            comparison: route.comparisonId,
                            item: item.key,
                            variant: entry.key,
                          }}
                        />
                      ) : undefined
                    }
                    onClick={(event) => {
                      if (
                        event.button !== 0 ||
                        event.altKey ||
                        event.ctrlKey ||
                        event.metaKey ||
                        event.shiftKey
                      )
                        return;
                      remembered.current.set(item.key, entry.key);
                      if (!route) {
                        event.preventDefault();
                        selectVariant(index);
                      }
                    }}
                    aria-label={`${index + 1}. ${entry.label}. ${verdictLabel(entry)}`}
                  >
                    <VariantSummary variant={entry} index={index} />
                  </NavLink>
                ))}
              </Nav>
            )}
          </div>
          {item && variant ? (
            <>
              <ShellMainFull>
                <Frame
                  $cover
                  $border
                  $borderType="border"
                  $rounded="none"
                  $orientation="vertical"
                  $p={0}
                  className="review-result"
                  render={<section />}
                  aria-label="Selected variant"
                  tabIndex={-1}
                >
                  {!model.archived &&
                    (variant.approveDisabledReason || variant.rejectDisabledReason) && (
                      <p className="text-xs opacity-60 px-3 py-2">
                        {variant.rejectDisabledReason ?? variant.approveDisabledReason}
                      </p>
                    )}
                  {model.evidenceState === "summary" ? (
                    <Frame $p={4} $layer $border>
                      <h3 className="text-sm font-semibold">
                        {model.imagesExpired ? "Image history expired" : "Closed review summary"}
                      </h3>
                      <p className="text-sm ak-ink-60 mt-2">
                        Review results and capture identity remain available. This view does not
                        contain image bytes.
                      </p>
                    </Frame>
                  ) : (
                    <>
                      <Frame
                        $cover
                        $border
                        $borderType="border"
                        $layer="canvas"
                        $p={3}
                        className="review-view-controls flex flex-wrap items-center justify-between gap-2"
                      >
                        <ButtonGroup
                          $p={0.5}
                          $gap="xs"
                          $rounded="md"
                          $forceRounded
                          $layer
                          className="min-w-0 max-w-full overflow-x-auto"
                          aria-label="Image view"
                        >
                          <FlatButton
                            className="text-xs whitespace-nowrap"
                            $p={1.5}
                            $rounded="md"
                            aria-pressed={effectiveMode === "side"}
                            $lightnessOffset={effectiveMode === "side"}
                            onClick={() => setView("side")}
                          >
                            <ButtonSlot aria-hidden>
                              <Columns2Icon />
                            </ButtonSlot>
                            <ButtonLabel>Compare</ButtonLabel>{" "}
                            <ButtonSlot $kind="shortcut">S</ButtonSlot>
                          </FlatButton>
                          <FlatButton
                            className="text-xs whitespace-nowrap"
                            $p={1.5}
                            $rounded="md"
                            aria-pressed={effectiveMode === "diff"}
                            $lightnessOffset={effectiveMode === "diff"}
                            aria-disabled={!variant.reference || !variant.candidate}
                            onClick={() => setView("diff")}
                          >
                            <ButtonSlot aria-hidden>
                              <DiffIcon />
                            </ButtonSlot>
                            <ButtonLabel>Difference</ButtonLabel>{" "}
                            <ButtonSlot $kind="shortcut">D</ButtonSlot>
                          </FlatButton>
                          <FlatButton
                            className="text-xs whitespace-nowrap"
                            $p={1.5}
                            $rounded="md"
                            aria-pressed={effectiveMode === "new"}
                            $lightnessOffset={effectiveMode === "new"}
                            onClick={() => setView("new")}
                          >
                            <ButtonSlot aria-hidden>
                              <ImageIcon />
                            </ButtonSlot>
                            <ButtonLabel>Current</ButtonLabel>{" "}
                            <ButtonSlot $kind="shortcut">F</ButtonSlot>
                          </FlatButton>
                          <FlatButton
                            className="text-xs whitespace-nowrap"
                            $p={1.5}
                            $rounded="md"
                            aria-pressed={effectiveMode === "original"}
                            $lightnessOffset={effectiveMode === "original"}
                            onClick={() => setView("original")}
                          >
                            <ButtonSlot aria-hidden>
                              <ImageMinusIcon />
                            </ButtonSlot>
                            <ButtonLabel>Baseline</ButtonLabel>{" "}
                            <ButtonSlot $kind="shortcut">G</ButtonSlot>
                          </FlatButton>
                          <ButtonGlider $rounded="md" />
                        </ButtonGroup>
                        <ButtonGroup
                          $p={0.5}
                          $gap="xs"
                          $rounded="md"
                          $forceRounded
                          $border={false}
                          aria-label="Image zoom"
                        >
                          {(["fit", 1, 2] as const).map((value) => (
                            <FlatButton
                              key={value}
                              className="text-xs"
                              $p={1.5}
                              $rounded="md"
                              aria-pressed={zoom === value}
                              $lightnessOffset={zoom === value}
                              onClick={() => setZoom(value)}
                            >
                              {value === "fit" && (
                                <ButtonSlot aria-hidden>
                                  <ScanIcon />
                                </ButtonSlot>
                              )}
                              <ButtonLabel>
                                {value === "fit" ? "Fit" : `${value * 100}%`}
                              </ButtonLabel>
                            </FlatButton>
                          ))}
                          <ButtonGlider $rounded="md" />
                        </ButtonGroup>
                      </Frame>
                      {(!variant.reference || !variant.candidate) && (
                        <p className="text-xs ak-ink-60 px-3 pb-3">
                          {variant.candidateOmitted
                            ? "Matched locally. The new image was not uploaded."
                            : "Pixel diff requires both a reference and a new image."}
                        </p>
                      )}
                      <Frame
                        $layer="canvas"
                        $border
                        $p={0}
                        $rounded="none"
                        $forceRounded
                        className="review-evidence"
                        data-evidence={terminalComparison ? "terminal" : evidence.status}
                      >
                        {evidence.status === "loading" && !terminalComparison && (
                          <div
                            className="flex flex-wrap justify-center items-center gap-2 p-3 text-sm ak-ink-60"
                            role="status"
                          >
                            {variant.kind === "pending"
                              ? "Comparison is still running…"
                              : "Loading this comparison’s images…"}
                          </div>
                        )}
                        {(terminalComparison || evidence.status === "error") && (
                          <div
                            className="flex flex-wrap justify-center items-center gap-2 p-3 text-sm ak-ink-60"
                            role={terminalComparison ? "status" : "alert"}
                          >
                            <strong>
                              {terminalComparison
                                ? model.run.status === "superseded"
                                  ? "Comparison superseded"
                                  : model.run.status === "needs-recompare"
                                    ? "Comparison needs fresh Submit"
                                    : "Comparison failed"
                                : retryImages
                                  ? "Image evidence unavailable"
                                  : "Comparison evidence incomplete"}
                            </strong>
                            <p>
                              {terminalComparison ? terminalEvidenceMessage(model) : evidence.error}
                            </p>
                            {terminalComparison && variant.error && <p>{variant.error}</p>}
                            {retryImages && (
                              <Button
                                className="text-xs"
                                disabled={busy}
                                onClick={() => setRetry((value) => value + 1)}
                              >
                                Retry images
                              </Button>
                            )}
                            {recompareEvidence && commands.recompare && recompareAllowed && (
                              <Button
                                className="text-xs"
                                disabled={
                                  busy || awaitingComparison || saveState.status === "error"
                                }
                                onClick={() => void recompare()}
                              >
                                Recompare now
                              </Button>
                            )}
                          </div>
                        )}
                        <ScreenshotViewer
                          variant={variant}
                          mode={effectiveMode}
                          zoom={zoom}
                          ready={evidence.status === "ready"}
                          images={evidence.images}
                          identity={evidence.identity}
                          report={evidence.report}
                        />
                      </Frame>
                    </>
                  )}
                </Frame>
              </ShellMainFull>
            </>
          ) : (
            <Frame $p={6} $border $rounded="xl">
              <Text render={<h2 />}>No comparison items</Text>
              <Text render={<p />}>
                {model.reviewReady
                  ? "This run contains no review items."
                  : "Images will appear after the complete run is processed."}
              </Text>
            </Frame>
          )}
          <ShellMainFull className="sticky bottom-0 z-20">
            <Frame
              $cover
              $layer="canvas"
              $lighten={2}
              $border
              $borderType="border"
              $rounded="none"
              $p={2}
              role="region"
              aria-label="Review actions"
              className="review-actions flex flex-wrap items-center justify-between gap-x-2 gap-y-1"
            >
              <div className="flex items-center gap-2">
                <Button
                  $p={1.5}
                  disabled={model.archived || !canUndo || busy || saveState.status === "error"}
                  onClick={() => void undo()}
                >
                  <ButtonSlot>
                    <Undo2 />
                  </ButtonSlot>
                  <ButtonLabel>Undo</ButtonLabel>
                </Button>
                <div className="h-5 w-px bg-current/10" />
                <Button
                  $p={1.5}
                  disabled={
                    !ready || reviewBlocked || saveState.status === "error" || !targets.length
                  }
                  onClick={() =>
                    setBatchScope({
                      comparisonId: model.comparisonId,
                      selection: { ...selection },
                      targetIds: targets.map((target) => target.id),
                    })
                  }
                >
                  <ButtonLabel>All {targets.length} changed views…</ButtonLabel>
                  <ButtonSlot>
                    <ChevronDown />
                  </ButtonSlot>
                </Button>
              </div>
              <ButtonGroup $gap="sm">
                <Button
                  $border
                  disabled={
                    !ready ||
                    reviewBlocked ||
                    saveState.status === "error" ||
                    !targets.some((entry) => entry.id === variant?.id) ||
                    !!variant?.rejectDisabledReason
                  }
                  title={variant?.rejectDisabledReason}
                  onClick={() => review("rejected")}
                >
                  <ButtonSlot>
                    <X />
                  </ButtonSlot>
                  <ButtonLabel>Reject view</ButtonLabel>
                  <ButtonSlot $kind="shortcut">X</ButtonSlot>
                </Button>
                <Button
                  $layer="brand"
                  disabled={
                    !ready ||
                    reviewBlocked ||
                    saveState.status === "error" ||
                    !targets.some((entry) => entry.id === variant?.id) ||
                    !!variant?.approveDisabledReason
                  }
                  title={variant?.approveDisabledReason}
                  onClick={() => review("approved")}
                >
                  <ButtonSlot>
                    <Check />
                  </ButtonSlot>
                  <ButtonLabel>Approve &amp; next</ButtonLabel>
                  <ButtonSlot $kind="shortcut">A</ButtonSlot>
                </Button>
              </ButtonGroup>
              {(saveState.message ||
                busy ||
                saveState.status === "error" ||
                saveState.status === "conflict") && (
                <div className="basis-full px-1.5">
                  <div
                    className="review-save-state flex flex-wrap items-center gap-2 text-xs ak-ink-60 empty:hidden"
                    role={
                      saveState.status === "error" || saveState.status === "conflict"
                        ? "alert"
                        : "status"
                    }
                  >
                    {busy && pendingReviews.length
                      ? `${sendingCount ? `Sending ${sendingCount} decision${sendingCount === 1 ? "" : "s"}… ` : ""}${queuedCount ? `${queuedCount} queued on server.${sendingCount ? "" : " You can close this window."}` : ""}`
                      : saveState.message}
                    {!model.archived && saveState.status === "error" && saveState.failed && (
                      <Button
                        className="text-xs"
                        onClick={() => {
                          if (saveState.failed) void save(saveState.failed);
                        }}
                      >
                        <ButtonLabel>Retry same command</ButtonLabel>
                      </Button>
                    )}
                    {!model.archived && saveState.status === "error" && saveState.failedUndo && (
                      <Button className="text-xs" onClick={() => void undo(saveState.failedUndo)}>
                        <ButtonLabel>Retry Undo</ButtonLabel>
                      </Button>
                    )}
                    {(saveState.status === "conflict" || saveState.status === "error") && (
                      <Button className="text-xs" onClick={() => void refresh()}>
                        <ButtonLabel>Refresh current state</ButtonLabel>
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </Frame>
          </ShellMainFull>
        </ShellMainBody>
      </ShellMain>
      <ShellSidebar
        id="capture-details"
        $side="end"
        $from="intro"
        $width="md"
        $show="5xl"
        $border
        open={detailsOpen && !narrow}
        render={<aside />}
        aria-label="Capture details"
      >
        <ShellSidebarHeader $height="sm" $p={4} className="flex items-center justify-between">
          <Text className="text-[10px] uppercase tracking-[0.14em] font-semibold opacity-60">
            Capture details
          </Text>
          <Button
            $p={1}
            aria-label="Close capture details"
            onClick={() => {
              setDetailsOpen(false);
              detailsTrigger.current?.focus();
            }}
          >
            <ButtonSlot>
              <X />
            </ButtonSlot>
          </Button>
        </ShellSidebarHeader>
        <ShellSidebarBody $p={5}>{!narrow && captureDetails}</ShellSidebarBody>
      </ShellSidebar>
      <ShellFooter
        $height="sm"
        $p={3}
        className="flex! flex-wrap items-center gap-x-3 gap-y-0 min-h-10!"
      >
        <div className="flex flex-wrap items-center gap-2">
          <ShortcutHelp />
          <Button
            className="text-xs"
            aria-pressed={shortcuts}
            onClick={() => setShortcuts((value) => !value)}
          >
            <ButtonLabel>Shortcuts {shortcuts ? "on" : "off"}</ButtonLabel>
          </Button>
          {commands.recompare && !model.preview && (
            <Button
              className="text-xs"
              disabled={
                !recompareAllowed || busy || awaitingComparison || saveState.status === "error"
              }
              title={!recompareAllowed ? recompareDisabledReason : undefined}
              onClick={() => void recompare()}
            >
              <ButtonLabel>Recompare stored run</ButtonLabel>
            </Button>
          )}
        </div>
        {commands.recompare && !model.preview && !recompareAllowed && recompareDisabledReason && (
          <p>{recompareDisabledReason}</p>
        )}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </ShellFooter>
      <ak.Dialog
        open={itemsOpen && narrow}
        onClose={() => setItemsOpen(false)}
        render={<Frame $layer="canvas" $border $p={5} $rounded="2xl" />}
        className="fixed inset-4 z-50 flex flex-col gap-4"
        backdrop={<Layer $layer="canvas" className="fixed inset-0 z-40 bg-black/50!" />}
      >
        <div className="flex items-center justify-between">
          <ak.DialogHeading>Screenshots</ak.DialogHeading>
          <ak.DialogDismiss render={<Button aria-label="Close screenshots" />}>
            <ButtonSlot>
              <X />
            </ButtonSlot>
          </ak.DialogDismiss>
        </div>
        {narrow && itemNavigation}
      </ak.Dialog>
      <ak.Dialog
        open={detailsOpen && narrow}
        onClose={() => setDetailsOpen(false)}
        unmountOnHide
        finalFocus={detailsTrigger}
        render={<Frame $layer="canvas" $border $p={5} $rounded="2xl" />}
        className="fixed inset-4 z-50 overflow-auto"
        backdrop={<Layer $layer="canvas" className="fixed inset-0 z-40 bg-black/50!" />}
      >
        <div className="flex items-center justify-between mb-5">
          <ak.DialogHeading>Capture details</ak.DialogHeading>
          <ak.DialogDismiss render={<Button aria-label="Close capture details" />}>
            <ButtonSlot>
              <X />
            </ButtonSlot>
          </ak.DialogDismiss>
        </div>
        {narrow && captureDetails}
      </ak.Dialog>
      <ak.Dialog
        open={batchValid}
        onClose={() => setBatchScope(null)}
        unmountOnHide
        render={<Frame $layer="canvas" $border $p={6} $rounded="2xl" />}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-auto"
        backdrop={<Layer $layer="canvas" className="fixed inset-0 z-40 bg-black/50!" />}
      >
        <ak.DialogHeading className="text-lg font-semibold">
          Review all changed views
        </ak.DialogHeading>
        <ak.DialogDescription className="text-sm opacity-60 mt-2">
          This decision applies to all {targets.length} changed views in {item?.name}, including
          views with a previous decision.
        </ak.DialogDescription>
        <ul className="my-5 grid gap-2">
          {targets.map((target) => (
            <li key={target.id} className="text-xs flex items-center justify-between gap-3">
              <span>{target.label}</span>
              <ReviewStatus variant={target} />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 justify-end">
          <ak.DialogDismiss render={<Button />}>
            <ButtonLabel>Cancel</ButtonLabel>
          </ak.DialogDismiss>
          <Button
            $border
            disabled={
              !batchValid ||
              !ready ||
              reviewBlocked ||
              saveState.status === "error" ||
              !targets.length
            }
            onClick={() => reviewBatch("rejected")}
          >
            <ButtonLabel>Reject whole item ({targets.length})</ButtonLabel>
          </Button>
          <Button
            $layer="brand"
            disabled={
              !batchValid ||
              !ready ||
              reviewBlocked ||
              saveState.status === "error" ||
              !targets.length
            }
            onClick={() => reviewBatch("approved")}
          >
            <ButtonLabel>Approve whole item ({targets.length})</ButtonLabel>
          </Button>
        </div>
      </ak.Dialog>
    </Shell>
  );
}
