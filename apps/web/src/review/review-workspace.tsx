import { useEvent } from "@ariakit/react-utils";
import { cx } from "clava";
import { Settings2 } from "lucide-react";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ControlButton as Button } from "../components/control-button.tsx";
import { ButtonLabel, ButtonSlot } from "../components/ariakit/components/button.ariakit.react.tsx";
import {
  Shell,
  ShellMain,
  ShellMainBody,
  ShellSidebar,
} from "../components/ariakit/components/shell.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Heading, HeadingLevel } from "../components/ariakit/components/heading.ariakit.react.tsx";
import { Link } from "../components/ariakit/components/link.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { ScreenshotList } from "../components/kit/list/screenshot-list.tsx";
import { useScreenshotList } from "../components/kit/list/use-screenshot-list.ts";
import type { ScreenshotListState } from "../components/kit/list/use-screenshot-list.ts";
import { ShortcutsProvider, useShortcuts } from "../components/kit/keys.tsx";
import { ResultPage } from "../components/kit/result/result-page.tsx";
import { besideList, PanelSheet, Sheet } from "../components/kit/surfaces.tsx";
import { shellRadius } from "../components/kit/tokens.ts";
import { VariantNav } from "../components/kit/variants/variant-nav.tsx";
import { BarHost, reviewActionsId, useBarHost } from "./bar-host.tsx";
import { CaptureDetailsPanel } from "./capture-details.tsx";
import type { ReviewCommands, ReviewModel, ReviewSelection, ReviewVariant } from "./model.ts";
import { RunHeader, ScreenshotStepper, getPullRequestUrl, getRunIdentity } from "./run-header.tsx";
import { getRunResult } from "./run-words.ts";
import { getFamilyLabels, getSessionItem, pickItem, pickVariant } from "./session-items.ts";
import {
  readSidebarPreference,
  sidebarStorageKey,
  writeSidebarPreference,
} from "./sidebar-preference.ts";
import { getPixelLine, StageHost, useStageHost } from "./stage-host.tsx";
import { nextPending } from "./navigation.ts";
import { usePreload } from "./use-evidence.ts";
import { useNextRun } from "./use-next-run.ts";
import { useReviewKeys } from "./use-review-keys.ts";
import { useReviewSession } from "./use-review-session.ts";
import { narrowProbeClass, useNarrowShell } from "./use-narrow-shell.ts";
import { useUnchangedScreenshots } from "./use-unchanged-screenshots.ts";
import { useVariantMemory } from "./use-variant-memory.ts";

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

/**
 * The first Tab stop of the page: a link to the decision bar, over the page
 * while it has the focus. The link moves the focus itself: a jump to the
 * fragment would add an entry to the history of the run.
 */
function SkipLink() {
  return (
    <div className="sr-only focus-within:not-sr-only focus-within:fixed focus-within:start-3 focus-within:top-3 focus-within:z-50">
      <Button
        $layer="brand"
        render={<a href={`#${reviewActionsId}`} />}
        onClick={(event) => {
          event.preventDefault();
          event.currentTarget.ownerDocument.getElementById(reviewActionsId)?.focus();
        }}
      >
        <ButtonLabel>Skip to review actions</ButtonLabel>
      </Button>
    </div>
  );
}

function findRejected(items: ReviewModel["items"]): ReviewSelection | null {
  for (const item of items) {
    for (const variant of item.variants) {
      if (variant.kind === "unchanged") continue;
      if (variant.verdict !== "rejected") continue;
      return { itemKey: item.key, variantKey: variant.key };
    }
  }
  return null;
}

function initialSelection(model: ReviewModel): ReviewSelection {
  const item = pickItem(model.items);
  const variant = item && pickVariant(item);
  if (!item || !variant) return { itemKey: "", variantKey: "" };
  return { itemKey: item.key, variantKey: variant.key };
}

export function ReviewWorkspace(props: ReviewWorkspaceProps) {
  // The provider keeps the keyboard switch in the browser, and the key hints
  // of the page hide while the switch is off.
  return (
    <ShortcutsProvider>
      <ReviewSession key={props.model.run.id} {...props} />
    </ShortcutsProvider>
  );
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
  const { enabled: shortcuts } = useShortcuts();
  const [retry, setRetry] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(readSidebarPreference);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // The list of a narrow shell, in the page above the variant row.
  const [itemsOpen, setItemsOpen] = useState(false);
  // The dialog of the details holds the narrow layout (see useNarrowShell).
  const [narrowProbe, narrow] = useNarrowShell(detailsOpen);
  const detailsTrigger = useRef<HTMLButtonElement>(null);
  const toggleSidebar = () => setSidebarOpen((open) => !open);
  useEffect(() => {
    writeSidebarPreference(sidebarOpen);
  }, [sidebarOpen]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === sidebarStorageKey || event.key === null)
        setSidebarOpen(event.newValue !== "false");
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const memory = useVariantMemory(route?.selection);
  // The keys of the screenshots that the list shows, for the advance after a
  // decision. The list comes after the session, so a ref gives it the order.
  const visibleOrder = useRef<readonly string[]>([]);
  const workspace = useRef<HTMLDivElement>(null);
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
    onRefresh: () => setRetry((value) => value + 1),
    getOrder: () => visibleOrder.current,
  });
  const { model: changedModel, busy, terminalComparison, unsentDecisions, runStatus } = session;
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
  const retryImages = () => setRetry((value) => value + 1);
  const stage = useStageHost({ model, variant, retry, onRetry: retryImages });
  const ready = !model.archived && !terminalComparison && model.reviewReady && stage.ready;
  const bar = useBarHost({
    session,
    model,
    item,
    variant,
    selection,
    ready,
    onFocusPage: focusWorkspace,
    // A closed review with no image bytes has no view to change.
    view:
      item && variant && model.evidenceState !== "summary"
        ? { stored: stage.stored, engine: stage.view }
        : null,
  });
  const pixelLine = variant && getPixelLine(variant);
  // The result takes the place of the stage when nothing is left to review.
  // It waits for the receipt of the last decision, and a failed save keeps
  // the bar with its recovery buttons.
  const runResult = getRunResult(model);
  const resultReady =
    !!runResult &&
    (model.reviewReady || !!model.archived) &&
    !terminalComparison &&
    session.saveState.status === "idle";
  // A step to a screenshot leaves the result, and an address that names a
  // screenshot opens on it. The result shows again after the run has a
  // change to review again, for example after Undo.
  const [resultLeft, setResultLeft] = useState(() => !!route?.selection);
  if (resultLeft && !runResult) {
    setResultLeft(false);
  }
  const showResult = resultReady && !resultLeft;
  const leaveResult = () => {
    if (showResult) setResultLeft(true);
  };
  const nextRun = useNextRun(model.run.id, showResult);
  const besideListClass = cx(sidebarOpen && besideList);

  if (
    !route &&
    item &&
    variant &&
    (item.key !== selection.itemKey || variant.key !== selection.variantKey)
  ) {
    setLocalSelection({ itemKey: item.key, variantKey: variant.key });
    session.announce(
      `The remembered variant is unavailable. Selected ${variant.label}.`,
      "neutral",
      {
        selection: { itemKey: item.key, variantKey: variant.key },
      },
    );
  }
  const announceFallback = useEffectEvent((itemKey: string, shown: ReviewVariant) => {
    session.announce(`The selected variant is unavailable. Selected ${shown.label}.`, "neutral", {
      selection: { itemKey, variantKey: shown.key },
    });
  });
  useEffect(() => {
    if (!routedSelection || !onRouteSelect || !item || !variant) return;
    if (item.key === routedSelection.itemKey && variant.key === routedSelection.variantKey) return;
    // The address can name an unchanged screenshot of a page that is not loaded yet.
    if (unchanged.locating) return;
    onRouteSelect({ itemKey: item.key, variantKey: variant.key });
    // The address named a variant that the run does not have, for example
    // after a newer model of the run. An address with no variant names none.
    if (!routedSelection.variantKey) return;
    announceFallback(item.key, variant);
  }, [item, variant, routedSelection, onRouteSelect, unchanged.locating]);

  // Up, Down, and the two screenshot buttons: the remembered variant, else
  // the variant of a row click.
  const selectItem = (itemKey: string) => {
    const next = model.items.find((entry) => entry.key === itemKey);
    const recalled = next && memory.recall(next);
    if (!next || !recalled) return;
    const selected = recalled.variant;
    select({ itemKey: next.key, variantKey: selected.key });
    if (recalled.lost) {
      session.announce(
        `The remembered variant is unavailable. Selected ${selected.label}.`,
        "neutral",
        {
          selection: { itemKey: next.key, variantKey: selected.key },
        },
      );
    }
  };
  // A click on a row has no memory (pull request #104): the first variant
  // that needs review.
  // The rows are memoized, so the function keeps its identity.
  const selectRow = useEvent((itemKey: string) => {
    const next = model.items.find((entry) => entry.key === itemKey);
    const selected = next && pickVariant(next);
    if (!next || !selected) return;
    leaveResult();
    select({ itemKey: next.key, variantKey: selected.key });
  });
  // Left, Right, 1 to 6, and the variant control. The memory holds it.
  const selectVariant = (index: number) => {
    if (!item) return;
    const next = item.variants[index];
    if (!next) return;
    leaveResult();
    const selected = { itemKey: item.key, variantKey: next.key };
    memory.remember(selected);
    select(selected);
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
    // The result has no screenshot on the stage, so the list marks no row.
    selection: showResult ? null : selection,
    selectItem: selectRow,
    unchangedReady: unchanged.complete || unchanged.failed,
  });
  // Up and Down follow the order of the list, also with a filter.
  const stepItem = (step: 1 | -1) => {
    const { order, position } = sessionList;
    const itemKey = order[position < 0 ? 0 : position + step];
    if (itemKey == null) return;
    leaveResult();
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
  // Until each page is loaded, the run model has the number of the unchanged
  // screenshots.
  const listCounts = unchanged.complete
    ? sessionList.counts
    : { ...sessionList.counts, unchanged: unchanged.count };
  const list: ScreenshotListState = {
    ...sessionList,
    counts: listCounts,
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
  // The variant that a decision opens next, as the advance of the session
  // finds it. Its images load when the images on the stage are ready.
  const { itemKey: selectedItem, variantKey: selectedVariant } = selection;
  const nextVariant = useMemo(() => {
    const current = { itemKey: selectedItem, variantKey: selectedVariant };
    const next = nextPending(model.items, current, sessionList.order);
    if (!next) return undefined;
    // The only variant to review is the one on the stage.
    if (next.itemKey === selectedItem && next.variantKey === selectedVariant) return undefined;
    return model.items
      .find((entry) => entry.key === next.itemKey)
      ?.variants.find((entry) => entry.key === next.variantKey);
  }, [model.items, selectedItem, selectedVariant, sessionList.order]);
  usePreload(nextVariant, ready);
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
  // The first rejected change of the run, which the result can open.
  const rejectedVariant = showResult ? findRejected(model.items) : null;
  const showRejected = () => {
    if (!rejectedVariant) return;
    leaveResult();
    memory.remember(rejectedVariant);
    select(rejectedVariant);
    // The button goes with the result, so the page takes the focus, as
    // after Undo.
    focusWorkspace();
  };
  useReviewKeys({
    root: workspace,
    enabled: shortcuts,
    hasVariant: !!item && !!variant,
    undo: bar.undo,
    toggleList: narrow ? undefined : toggleSidebar,
    stepItem,
    stepVariant,
    selectVariant,
    // The result has no stage and no bar, so their keys do nothing there.
    getAction: (key) => (showResult ? undefined : (bar.keys[key] ?? stage.keys[key])),
  });

  const sessionItem = item ? getSessionItem(item) : null;
  const sessionVariant =
    sessionItem && variantIndex >= 0 ? sessionItem.variants[variantIndex] : null;
  const identity = getRunIdentity(model.run);
  // The list of a narrow shell is over the stage, so a choice closes it, and
  // the page takes the focus of the row. The rows are memoized, so the
  // function keeps its identity.
  const selectInline = useEvent((itemKey: string) => {
    selectRow(itemKey);
    setItemsOpen(false);
    focusWorkspace();
  });
  const renderNavigation = (state: ScreenshotListState) => (
    <>
      {unchanged.failed && (
        <Text render={<p />} role="alert" className="mx-2 text-xs">
          The unchanged screenshots could not be loaded.{" "}
          <Link render={<button type="button" />} onClick={loadUnchanged}>
            Try again
          </Link>
        </Text>
      )}
      <ScreenshotList list={state} />
    </>
  );
  // The list of the unchanged screenshots: with the changes, each screenshot
  // of the run.
  const showAllScreenshots = () => {
    sessionList.setStatus("unchanged");
    if (narrow) setItemsOpen(true);
    else setSidebarOpen(true);
  };
  // The result names no screenshot in the header either.
  const stepperItem = showResult ? null : sessionItem;
  const stepperProps = {
    item: stepperItem,
    family: stepperItem ? sessionList.labels.get(stepperItem.family) : null,
    position: itemPosition,
    count: sessionList.order.length,
    onStep: stepItem,
    shortcuts,
  };

  return (
    <HeadingLevel level={1}>
      {/* The page root takes the focus after a decision, so the keys of the
          page work at once. It is not a Tab stop: the first Tab stop is the
          skip link to the decision bar. */}
      <Shell
        className="review-workspace text-sm"
        ref={workspace}
        tabIndex={-1}
        role="group"
        aria-label="Review workspace"
        $layer="canvas"
        $rounded={shellRadius}
      >
        {!showResult && <SkipLink />}
        <span ref={narrowProbe} aria-hidden className={narrowProbeClass} />
        <RunHeader
          model={changedModel}
          onShowResult={resultReady ? () => setResultLeft(false) : null}
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
          {!narrow && renderNavigation(list)}
        </ShellSidebar>
        {/* The panel has the gutter of the lab panel. The result takes the
            height that the page has left, or more with its content, and the
            stage takes the height that the page has left. */}
        <ShellMain $maxWidth="100%" $p={2}>
          <ShellMainBody
            className={
              showResult
                ? "grid-rows-[auto_1fr] content-stretch"
                : "grid-rows-[auto_minmax(0,1fr)] content-stretch"
            }
          >
            <Heading className="sr-only">{`Review of ${identity.full}`}</Heading>
            <HeadingLevel>
              {/* Above the panel, the row keeps its margin only while it shows
                  the stepper of a narrow window, the list, or a notice. */}
              <div
                className={cx(
                  "mb-2 grid min-w-0 gap-3 @3xl/shell:mb-0 @3xl/shell:has-[>p,>nav]:mb-2",
                  besideListClass,
                )}
              >
                <ScreenshotStepper
                  {...stepperProps}
                  listOpen={narrow ? itemsOpen : sidebarOpen}
                  onListOpenChange={narrow ? setItemsOpen : setSidebarOpen}
                  className="@3xl/shell:hidden"
                />
                {narrow && itemsOpen && (
                  <Sheet
                    $p="none"
                    render={<nav aria-label="Screenshots" />}
                    className="flex max-h-72 min-h-0 flex-col"
                  >
                    {renderNavigation({ ...list, select: selectInline })}
                  </Sheet>
                )}
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
              </div>
              {showResult && runResult ? (
                <PanelSheet className={besideListClass}>
                  <ResultPage
                    {...runResult}
                    next={nextRun}
                    screenshots={listCounts.changes + listCounts.unchanged}
                    onShowAll={showAllScreenshots}
                    onShowRejected={rejectedVariant ? showRejected : null}
                    pullRequestUrl={getPullRequestUrl(model.run)}
                    onUndo={session.canUndo ? bar.undo : null}
                  />
                </PanelSheet>
              ) : (
                <PanelSheet className={besideListClass}>
                  {/* A frame, so the variant control takes the radius that is
                      concentric with the panel. */}
                  {item && variant && sessionItem && sessionVariant && (
                    <Frame
                      $p={2}
                      className="review-variant-row @container flex flex-none flex-wrap items-center gap-x-3 gap-y-2"
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
                      {pixelLine && (
                        <Text className="flex-none text-xs ak-ink-60 tabular-nums @max-[44rem]:hidden">
                          {pixelLine}
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
                    </Frame>
                  )}
                  <Frame $p={2} className="flex min-h-0 flex-1 flex-col gap-2 pt-0">
                    {item && variant ? (
                      <StageHost
                        stage={stage}
                        model={model}
                        variant={variant}
                        terminal={terminalComparison}
                        busy={busy}
                        onRetryImages={retryImages}
                      />
                    ) : (
                      <div className="grid min-h-0 flex-1 content-start gap-1 p-4">
                        <Text render={<h2 />}>No screenshots to compare</Text>
                        <Text render={<p />}>
                          {model.reviewReady
                            ? "This run contains no screenshots to review."
                            : "Images will appear after the complete run is processed."}
                        </Text>
                      </div>
                    )}
                    <BarHost bar={bar} />
                  </Frame>
                </PanelSheet>
              )}
            </HeadingLevel>
          </ShellMainBody>
        </ShellMain>
        <CaptureDetailsPanel
          model={model}
          variant={variant}
          runStatus={runStatus}
          open={detailsOpen}
          narrow={narrow}
          onClose={() => setDetailsOpen(false)}
          trigger={detailsTrigger}
        />
      </Shell>
    </HeadingLevel>
  );
}
