import * as ak from "@ariakit/react";
import { useEvent } from "@ariakit/react-utils";
import { Settings2, X } from "lucide-react";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ControlButton as Button } from "../components/control-button.tsx";
import { ButtonLabel, ButtonSlot } from "../components/ariakit/components/button.ariakit.react.tsx";
import {
  Shell,
  ShellMain,
  ShellMainFull,
  ShellMainBody,
  ShellFooter,
  ShellSidebar,
  ShellSidebarBody,
  ShellSidebarHeader,
} from "../components/ariakit/components/shell.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Layer } from "../components/ariakit/components/layer.ariakit.react.tsx";
import { Heading, HeadingLevel } from "../components/ariakit/components/heading.ariakit.react.tsx";
import { Link } from "../components/ariakit/components/link.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { ScreenshotList } from "../components/kit/list/screenshot-list.tsx";
import { useScreenshotList } from "../components/kit/list/use-screenshot-list.ts";
import type { ScreenshotListState } from "../components/kit/list/use-screenshot-list.ts";
import { shellRadius } from "../components/kit/tokens.ts";
import { VariantNav } from "../components/kit/variants/variant-nav.tsx";
import { BarHost, useBarHost } from "./bar-host.tsx";
import { CaptureDetails } from "./capture-details.tsx";
import type { ReviewCommands, ReviewModel, ReviewSelection } from "./model.ts";
import { RunHeader, ScreenshotStepper, getRunIdentity } from "./run-header.tsx";
import { getFamilyLabels, getSessionItem, pickItem, pickVariant } from "./session-items.ts";
import { ShortcutHelp } from "./shortcut-help.tsx";
import { sidebarStorageKey } from "./sidebar-preference.ts";
import { StageHost, useStageHost } from "./stage-host.tsx";
import { useReviewSession } from "./use-review-session.ts";
import { useUnchangedScreenshots } from "./use-unchanged-screenshots.ts";

export interface ReviewWorkspaceProps {
  model: ReviewModel;
  commands: ReviewCommands;
  route?: ReviewRoute;
  /** Tells the route when a decision is not sent or not saved. */
  onUnsentDecisionsChange?(unsent: boolean): void;
}

export interface ReviewRoute {
  runId: string;
  comparisonId?: string;
  /**
   * The place of the link. A link with a screenshot and no variant opens the
   * variant of a row click.
   */
  selection?: { itemKey: string; variantKey?: string };
  onSelect(selection: ReviewSelection): void;
}

function excludesShortcuts(event: globalThis.KeyboardEvent) {
  const target = event.target;
  if (!target) return true;
  if (!("nodeType" in target)) return true;
  if (target.nodeType !== 1) return true;
  const element = target as HTMLElement;
  return !!element.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menu"], [role="menubar"], [role="dialog"], [role="alertdialog"], [role="tablist"]',
  );
}

function initialSelection(model: ReviewModel): ReviewSelection {
  const item = pickItem(model.items);
  const variant = item && pickVariant(item);
  if (!item || !variant) return { itemKey: "", variantKey: "" };
  return { itemKey: item.key, variantKey: variant.key };
}

export function ReviewWorkspace(props: ReviewWorkspaceProps) {
  return <ReviewSession key={props.model.run.id} {...props} />;
}

/**
 * The frame of the review page: the header with the run progress, the list
 * of the screenshots, the variant control, the stage, and the decision bar.
 * The stage and the bar are hosts in their own files (`stage-host.tsx` and
 * `bar-host.tsx`), so a new stage or a new bar changes one file.
 */
function ReviewSession({
  model: suppliedModel,
  commands,
  route,
  onUnsentDecisionsChange,
}: ReviewWorkspaceProps) {
  const [localSelection, setLocalSelection] = useState(() => initialSelection(suppliedModel));
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
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches,
  );
  const detailsTrigger = useRef<HTMLButtonElement>(null);
  const toggleSidebar = () => setSidebarOpen((open) => !open);
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
  // The variant that the reviewer selected last in each screenshot. Up, Down,
  // and the two screenshot buttons open it. A row click and a decision do not
  // change it. It is state of the page: a reload forgets it.
  const remembered = useRef(
    new Map<string, string>(
      route?.selection?.variantKey ? [[route.selection.itemKey, route.selection.variantKey]] : [],
    ),
  );
  // The keys of the screenshots that the list shows, for the advance after a
  // decision. The list comes after the session, so a ref gives it the order.
  const visibleOrder = useRef<readonly string[]>([]);
  const workspace = useRef<HTMLDivElement>(null);
  const variantRow = useRef<HTMLDivElement>(null);
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
    getOrder: () => visibleOrder.current,
  });
  const {
    model: changedModel,
    saveState,
    busy,
    pendingComparison,
    awaitingComparison,
    terminalComparison,
    unsentDecisions,
    runStatus,
    recompare,
  } = session;
  useEffect(() => {
    onUnsentDecisionsChange?.(unsentDecisions);
  }, [onUnsentDecisionsChange, unsentDecisions]);
  const routedSelection = route?.selection;
  const onRouteSelect = route?.onSelect;
  const unchanged = useUnchangedScreenshots({
    model: changedModel,
    commands,
    selection: routedSelection,
  });
  // The page shows the items of the first response with each unchanged
  // screenshot that is loaded. The session keeps the first response.
  const model = useMemo(
    () => ({ ...changedModel, items: unchanged.items }),
    [changedModel, unchanged.items],
  );
  const routedItem = model.items.find((entry) => entry.key === routedSelection?.itemKey);
  const routedVariant = routedItem?.variants.find(
    (entry) => entry.key === routedSelection?.variantKey,
  );
  const routedFallback = routedItem && pickVariant(routedItem);
  const selection = route
    ? routedItem && routedFallback
      ? { itemKey: routedItem.key, variantKey: routedVariant?.key ?? routedFallback.key }
      : initialSelection(model)
    : localSelection;
  const item = model.items.find((entry) => entry.key === selection.itemKey) ?? model.items[0];
  const variant =
    item?.variants.find((entry) => entry.key === selection.variantKey) ?? item?.variants[0];
  const stage = useStageHost({ model, variant, retry, onAnnounce: setAnnouncement });
  const ready =
    !model.archived &&
    !pendingComparison &&
    !terminalComparison &&
    model.reviewReady &&
    stage.ready;
  const bar = useBarHost({ session, model, item, variant, selection, ready });
  const recompareAllowed = !model.archived && (model.recompareAllowed ?? true);
  const recompareDisabledReason =
    model.recompareDisabledReason ??
    (model.archived ? "This closed review is read-only. Capture a new complete run." : undefined);

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
    // The address can name an unchanged screenshot of a page that is not loaded yet.
    if (unchanged.locating) return;
    onRouteSelect({ itemKey: item.key, variantKey: variant.key });
  }, [item, variant, routedSelection, onRouteSelect, unchanged.locating]);

  // Up, Down, and the two screenshot buttons: the remembered variant, else
  // the variant of a row click.
  const selectItem = (itemKey: string) => {
    const next = model.items.find((entry) => entry.key === itemKey);
    if (!next) return;
    const previous = remembered.current.get(next.key);
    const selected = next.variants.find((entry) => entry.key === previous) ?? pickVariant(next);
    if (!selected) return;
    select({ itemKey: next.key, variantKey: selected.key });
    if (previous && previous !== selected.key) {
      setAnnouncement(`The remembered variant is unavailable. Selected ${selected.label}.`);
    }
  };
  // A click on a row has no memory (pull request #104): the first variant
  // that needs review.
  // The rows are memoized, so the function keeps its identity.
  const selectRow = useEvent((itemKey: string) => {
    const next = model.items.find((entry) => entry.key === itemKey);
    const selected = next && pickVariant(next);
    if (!next || !selected) return;
    select({ itemKey: next.key, variantKey: selected.key });
  });
  // Left, Right, 1 to 6, and the variant control. The memory holds it.
  const selectVariant = (index: number) => {
    if (!item) return;
    const next = item.variants[index];
    if (!next) return;
    remembered.current.set(item.key, next.key);
    select({ itemKey: item.key, variantKey: next.key });
  };
  const variantIndex = item && variant ? item.variants.indexOf(variant) : -1;
  const sessionItems = useMemo(() => model.items.map(getSessionItem), [model.items]);
  const families = useMemo(() => {
    const labels = getFamilyLabels(sessionItems.map((entry) => entry.family));
    return [...labels].map(([family, label]) => ({ family, label }));
  }, [sessionItems]);
  const sessionList = useScreenshotList({
    items: sessionItems,
    families,
    selection,
    selectItem: selectRow,
    unchangedReady: unchanged.complete || unchanged.failed,
  });
  // Up and Down follow the order of the list, also with a filter.
  const stepItem = (step: 1 | -1) => {
    const { order, position } = sessionList;
    const itemKey = order[position < 0 ? 0 : position + step];
    if (itemKey == null) return;
    // A step into a closed family opens it, so the selected row is on screen.
    const family = sessionList.families?.find((group) =>
      group.items.some((entry) => entry.key === itemKey),
    )?.family;
    if (family != null) {
      sessionList.setFamilyOpen(family, true);
    }
    selectItem(itemKey);
  };
  const loadUnchanged = unchanged.loadAll;
  const list: ScreenshotListState = {
    ...sessionList,
    // Until each page is loaded, the run model has the number of the
    // unchanged screenshots.
    counts: unchanged.complete
      ? sessionList.counts
      : { ...sessionList.counts, unchanged: unchanged.count },
    // A search reads each screenshot, so it needs each page.
    setQuery: (query) => {
      sessionList.setQuery(query);
      if (query.trim()) {
        loadUnchanged();
      }
    },
    step: stepItem,
  };
  useLayoutEffect(() => {
    visibleOrder.current = sessionList.order;
  }, [sessionList.order]);
  // A link to an unchanged screenshot shows its family, and a link to a
  // screenshot whose comparison runs opens their group, so its row is in view.
  const [linkedKey, setLinkedKey] = useState(route?.selection?.itemKey);
  const linkedItem = linkedKey ? sessionItems.find((entry) => entry.key === linkedKey) : undefined;
  // The reviewer left the link before its screenshot loaded, for example
  // after a failed page: the list keeps the status of the reviewer.
  if (linkedKey && !linkedItem && routedSelection?.itemKey !== linkedKey) {
    setLinkedKey(undefined);
  }
  if (linkedItem) {
    setLinkedKey(undefined);
    if (linkedItem.status === "unchanged") {
      sessionList.setStatus("unchanged");
      sessionList.setFamilyOpen(linkedItem.family, true);
    } else if (sessionList.comparing.includes(linkedItem)) {
      sessionList.setComparingOpen(true);
    }
  }
  // The status of the unchanged screenshots needs each page. Only a new
  // choice of the status, or Try again, loads again after a failure.
  const showsUnchanged = sessionList.filter.status === "unchanged";
  const loadForStatus = useEffectEvent(() => loadUnchanged());
  useEffect(() => {
    if (!showsUnchanged) return;
    loadForStatus();
  }, [showsUnchanged]);
  const itemPosition = sessionList.position;
  const stepVariant = (step: 1 | -1) => selectVariant(variantIndex + step);
  const onKeyDown = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || !shortcuts) return;
    if (excludesShortcuts(event)) return;
    if (event.altKey) return;
    const key = event.key.toLowerCase();
    if (event.metaKey || event.ctrlKey) {
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        bar.undo();
      }
      return;
    }
    if (key === "[" && !narrow) {
      event.preventDefault();
      toggleSidebar();
      return;
    }
    if (!item || !variant) return;
    const action = bar.keys[key] ?? stage.keys[key];
    if (key === "arrowup") {
      stepItem(-1);
    } else if (key === "arrowdown") {
      stepItem(1);
    } else if (key === "arrowleft") {
      stepVariant(-1);
    } else if (key === "arrowright") {
      stepVariant(1);
    } else if (/^[1-6]$/.test(key)) {
      selectVariant(Number(key) - 1);
    } else if (action) {
      action(event);
    } else {
      return;
    }
    event.preventDefault();
  });
  useEffect(() => {
    const document = workspace.current?.ownerDocument;
    if (!document) return;
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // An arrow key or a number key on a focused mark moves the focus to the
  // mark of the new variant, so Enter does not select the old one again.
  const selectedVariantKey = variant?.key;
  useLayoutEffect(() => {
    const row = variantRow.current;
    if (!row) return;
    const active = row.ownerDocument.activeElement;
    if (!active || !row.contains(active)) return;
    const marks = active.closest('[aria-label="Variants"]');
    if (!marks) return;
    const current = marks.querySelector<HTMLElement>('a[aria-current="true"]');
    if (!current || current === active) return;
    current.focus({ preventScroll: true });
  }, [selectedVariantKey]);

  const sessionItem = item ? getSessionItem(item) : null;
  const sessionVariant =
    sessionItem && variantIndex >= 0 ? sessionItem.variants[variantIndex] : null;
  const identity = getRunIdentity(model.run);
  const itemNavigation = (
    <>
      {unchanged.failed && (
        <Text render={<p />} role="alert" className="mx-2 text-xs">
          The unchanged screenshots could not be loaded.{" "}
          <Link render={<button type="button" />} onClick={loadUnchanged}>
            Try again
          </Link>
        </Text>
      )}
      <ScreenshotList list={list} />
    </>
  );
  const stepperProps = {
    item: sessionItem,
    family: sessionItem ? sessionList.labels.get(sessionItem.family) : null,
    position: itemPosition,
    count: sessionList.order.length,
    onStep: stepItem,
    shortcuts,
  };

  return (
    <HeadingLevel level={1}>
      <Shell
        className="review-workspace text-sm"
        ref={workspace}
        tabIndex={0}
        aria-label="Review workspace"
        $layer="canvas"
        $rounded={shellRadius}
      >
        <RunHeader
          model={changedModel}
          stepper={
            <HeadingLevel>
              <ScreenshotStepper
                {...stepperProps}
                listOpen={narrow ? itemsOpen : sidebarOpen}
                onListOpenChange={narrow ? setItemsOpen : setSidebarOpen}
                listId={narrow ? undefined : "review-screenshots"}
                className="w-[min(36em,36cqi)]"
              />
            </HeadingLevel>
          }
        />
        <ShellSidebar
          id="review-screenshots"
          $show="5xl"
          $from="main"
          $width="lg"
          $border={false}
          open={sidebarOpen}
          render={<nav />}
          aria-label="Screenshots"
        >
          {!narrow && itemNavigation}
        </ShellSidebar>
        <ShellMain $maxWidth="100%" $p="clamp(1rem,2.5vw,2rem)" className="review-main">
          <ShellMainBody className="pb-0!">
            <Heading className="sr-only">{`Review of ${identity.full}`}</Heading>
            <HeadingLevel>
              <div className="grid min-w-0 gap-3 mb-3">
                <ScreenshotStepper
                  {...stepperProps}
                  listOpen={narrow ? itemsOpen : sidebarOpen}
                  onListOpenChange={narrow ? setItemsOpen : setSidebarOpen}
                  className="@3xl/shell:hidden"
                />
                {model.run.error && (
                  <Frame $layer="warning" $mix={15} $p={3} role="alert" render={<p />}>
                    {model.run.error}
                  </Frame>
                )}
                {model.archived && (
                  <Frame $layer="warning" $mix={15} $p={3} role="status" render={<p />}>
                    {model.readOnlyReason ??
                      "This closed run is read-only. Its review history remains available."}
                  </Frame>
                )}
                {!model.archived && !model.reviewReady && !terminalComparison && (
                  <Frame $layer="warning" $mix={15} $p={3} role="status" render={<p />}>
                    Review is unavailable until the run is sealed and all comparisons are complete.
                  </Frame>
                )}
                {pendingComparison && (
                  <Frame $layer="warning" $mix={15} $p={3} role="status" render={<p />}>
                    A new comparison is being prepared from stored captures. The previous comparison
                    remains visible until the new evidence is ready.
                  </Frame>
                )}
                {sessionItem && sessionVariant && variant && (
                  <div
                    ref={variantRow}
                    className="review-variant-row @container flex flex-wrap items-center gap-x-3 gap-y-2"
                  >
                    <div className="flex min-w-[min(100%,27.5em)] flex-1">
                      <VariantNav
                        item={sessionItem}
                        variant={sessionVariant}
                        onStep={stepVariant}
                        onSelect={(variantKey) =>
                          selectVariant(
                            sessionItem.variants.findIndex((entry) => entry.key === variantKey),
                          )
                        }
                      />
                    </div>
                    {variant.changedPixels != null && (
                      <Text className="flex-none text-xs ak-ink-60 @max-[44rem]:hidden">
                        {variant.ratio != null
                          ? (variant.ratio * 100).toFixed(2) + "% changed · "
                          : ""}
                        {variant.changedPixels.toLocaleString()} changed pixels
                      </Text>
                    )}
                    <Button
                      $border
                      ref={detailsTrigger}
                      className="ms-auto flex-none"
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
                )}
              </div>
              {item && variant ? (
                <ShellMainFull>
                  <StageHost
                    stage={stage}
                    model={model}
                    variant={variant}
                    terminal={terminalComparison}
                    busy={busy}
                    onRetryImages={() => setRetry((value) => value + 1)}
                    recompare={
                      commands.recompare && recompareAllowed
                        ? {
                            offered: true,
                            disabled: busy || awaitingComparison || saveState.status === "error",
                            onRecompare: () => void recompare(),
                          }
                        : undefined
                    }
                  />
                </ShellMainFull>
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
              <BarHost bar={bar} />
            </HeadingLevel>
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
            <Text className="text-xs uppercase tracking-[0.14em] font-semibold ak-ink-60">
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
          <ShellSidebarBody $p={5}>
            {!narrow && variant && (
              <CaptureDetails model={model} variant={variant} runStatus={runStatus} />
            )}
          </ShellSidebarBody>
        </ShellSidebar>
        <ShellFooter
          $height="sm"
          $p={3}
          className="flex! flex-wrap items-center gap-x-3 gap-y-0 min-h-10!"
        >
          <div className="flex flex-wrap items-center gap-2">
            <ShortcutHelp />
            <Button
              $size="xs"
              aria-pressed={shortcuts}
              onClick={() => setShortcuts((value) => !value)}
            >
              <ButtonLabel>Shortcuts {shortcuts ? "on" : "off"}</ButtonLabel>
            </Button>
            {commands.recompare && !model.preview && (
              <Button
                $size="xs"
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
          className="fixed inset-4 z-50 flex flex-col gap-4 text-sm"
          backdrop={<Layer $layer="canvas" className="fixed inset-0 z-40 bg-black/50!" />}
        >
          <div className="flex items-center justify-between">
            <ak.DialogHeading className="text-base">Screenshots</ak.DialogHeading>
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
          className="fixed inset-4 z-50 overflow-auto text-sm"
          backdrop={<Layer $layer="canvas" className="fixed inset-0 z-40 bg-black/50!" />}
        >
          <div className="flex items-center justify-between mb-5">
            <ak.DialogHeading className="text-base">Capture details</ak.DialogHeading>
            <ak.DialogDismiss render={<Button aria-label="Close capture details" />}>
              <ButtonSlot>
                <X />
              </ButtonSlot>
            </ak.DialogDismiss>
          </div>
          {narrow && variant && (
            <CaptureDetails model={model} variant={variant} runStatus={runStatus} />
          )}
        </ak.Dialog>
      </Shell>
    </HeadingLevel>
  );
}
