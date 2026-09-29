import * as ak from "@ariakit/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { ControlButton as Button } from "../components/control-button.tsx";
import {
  Button as FlatButton,
  ButtonGroup,
  ButtonSlot,
} from "../components/ariakit/components/button.ariakit.react.tsx";
import {
  Shell,
  ShellHeader,
  ShellMain,
  ShellMainHeader,
  ShellMainBody,
  ShellFooter,
  ShellSidebar,
  ShellSidebarBody,
  ShellSidebarHeader,
} from "../components/ariakit/components/shell.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Layer } from "../components/ariakit/components/layer.ariakit.react.tsx";
import {
  Disclosure,
  DisclosureButton,
} from "../components/ariakit/components/disclosure.ariakit.react.tsx";
import {
  Tabs,
  Tab,
  TabList,
  TabPanel,
} from "../components/ariakit/components/tabs.ariakit.react.tsx";
import { ScreenshotViewer } from "../components/screenshot-viewer.tsx";
import { ItemList } from "./item-list.tsx";
import { ReviewCommandError } from "./model.ts";
import type {
  ReviewCommand,
  ReviewCommands,
  ReviewModel,
  ReviewMode,
  ReviewPollState,
  ReviewSelection,
  ReviewVerdict,
  ReviewZoom,
  UndoCommand,
} from "./model.ts";
import {
  applySavedReview,
  needsReview,
  nextPending,
  partitionItems,
  reviewTargets,
  verdictLabel,
} from "./navigation.ts";
import { useEvidence } from "./use-evidence.ts";
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

interface SavedCommand {
  id: string;
  selection: ReviewSelection;
}

interface SaveState {
  status: "idle" | "saving" | "error" | "conflict";
  message: string;
  failed?: ReviewCommand;
  failedUndo?: UndoCommand;
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

function followFocusedTab(event: KeyboardEvent<HTMLElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const list = event.currentTarget;
  const before = list.ownerDocument.activeElement;
  // Ariakit moves focus first. Follow that tab's existing route afterwards.
  requestAnimationFrame(() => {
    const next = list.ownerDocument.activeElement;
    if (next === before || !next || !list.contains(next)) return;
    if (next.tagName !== "A" && next.tagName !== "BUTTON") return;
    (next as HTMLElement).click();
  });
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

function runStatusLabel(status: string) {
  switch (status) {
    case "compared":
      return "Comparison complete";
    case "needs-review":
      return "Changes need review";
    case "passed":
      return "Check passed";
    case "rejected":
      return "Rejected changes";
    case "incomplete":
      return "Waiting for the complete capture";
    case "comparing":
      return "Comparing stored captures";
    case "needs-recompare":
      return "A new comparison is required";
    case "superseded":
      return "A newer attempt is active";
    case "failed":
      return "Capture or comparison failed";
    default:
      return status;
  }
}

function runStopped(status: string) {
  return ["failed", "superseded", "needs-recompare"].includes(status);
}

function comparisonReady(state: ReviewPollState | ReviewModel) {
  return (
    !runStopped(state.run.status) &&
    (state.reviewReady || (state.archived && state.comparisonState === "ready"))
  );
}

function comparisonFailed(state: ReviewPollState | ReviewModel) {
  return state.comparisonState === "invalidated" || runStopped(state.run.status);
}

function terminalEvidenceMessage(model: ReviewModel) {
  switch (model.run.status) {
    case "superseded":
      return "A newer attempt replaced this comparison. Its evidence cannot be reviewed.";
    case "needs-recompare":
      return "The baseline changed. This comparison is out of date and cannot be reviewed.";
    case "failed":
      return "This capture or comparison failed. Its evidence cannot be reviewed.";
    default:
      return "This comparison was invalidated. Its evidence cannot be reviewed.";
  }
}

function ShortcutHelp() {
  return (
    <ak.DialogProvider>
      <ak.DialogDisclosure render={<Button className="text-xs" />}>
        Keyboard help
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
          <dt>Tab / Escape</dt>
          <dd>Move to controls or close this help.</dd>
        </dl>
        <ak.DialogDismiss render={<Button className="text-xs" />}>Close help</ak.DialogDismiss>
      </ak.Dialog>
    </ak.DialogProvider>
  );
}

export function ReviewWorkspace(props: ReviewWorkspaceProps) {
  return <ReviewSession key={props.model.run.id} {...props} />;
}

function ReviewSession({ model: suppliedModel, commands, route, headerEnd }: ReviewWorkspaceProps) {
  const [previousModel, setPreviousModel] = useState(suppliedModel);
  const [model, setModel] = useState(suppliedModel);
  const [localSelection, setLocalSelection] = useState(() => initialSelection(suppliedModel));
  const [mode, setMode] = useState<ReviewMode>("side");
  const [zoom, setZoom] = useState<ReviewZoom>("fit");
  const [shortcuts, setShortcuts] = useState(true);
  const [retry, setRetry] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle", message: "" });
  const [history, setHistory] = useState<SavedCommand[]>([]);
  const [pendingComparison, setPendingComparison] = useState(false);
  const [exportState, setExportState] = useState({ pending: false, message: "" });
  const remembered = useRef(
    new Map<string, string>(
      route?.selection ? [[route.selection.itemKey, route.selection.variantKey]] : [],
    ),
  );
  const workspace = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
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
  const terminalComparison = comparisonFailed(model);
  const ready =
    !model.archived &&
    !pendingComparison &&
    !terminalComparison &&
    model.reviewReady &&
    evidence.status === "ready";
  const busy = saveState.status === "saving";
  const targets = item ? reviewTargets(item) : [];
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
  const awaitingComparison =
    pendingComparison ||
    model.comparisonState === "comparing" ||
    (!model.comparisonState &&
      !model.reviewReady &&
      ["incomplete", "comparing"].includes(model.run.status));
  const recompareAllowed = model.recompareAllowed ?? !model.archived;
  const recompareDisabledReason =
    model.recompareDisabledReason ??
    (model.archived ? "Stored images are not available for a new comparison." : undefined);
  const retryImages =
    !terminalComparison && (evidence.failure === "load" || evidence.failure === "decode");
  const recompareEvidence =
    terminalComparison ||
    evidence.failure === "comparison" ||
    evidence.failure === "missing" ||
    evidence.failure === "dimensions";

  if (previousModel !== suppliedModel) {
    setPreviousModel(suppliedModel);
    setModel(suppliedModel);
  }
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
  useEffect(() => {
    if (saveState.status !== "saving" && saveState.status !== "error") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState.status]);
  useEffect(() => {
    if (!awaitingComparison) return;
    let cancelled = false;
    let finished = false;
    let inFlight = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const schedule = (delay: number) => {
      if (cancelled || finished || inFlight || document.visibilityState !== "visible") return;
      clearTimeout(timeout);
      timeout = setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (cancelled || finished || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const state = await commands.pollStatus();
        if (cancelled || document.visibilityState !== "visible") return;
        if (comparisonReady(state) || comparisonFailed(state)) {
          const current = await commands.refresh();
          if (cancelled || document.visibilityState !== "visible") return;
          if (comparisonReady(current) || comparisonFailed(current)) {
            finished = true;
            setModel(current);
            setPendingComparison(false);
            setSaveState({
              status: "idle",
              message: comparisonReady(current)
                ? "The new comparison is ready."
                : (current.run.error ?? runStatusLabel(current.run.status)),
            });
            return;
          }
        }
        setSaveState({
          status: "idle",
          message: `${runStatusLabel(state.run.status)}. Review actions are unavailable until it is ready.`,
        });
      } catch (error) {
        if (cancelled) return;
        setSaveState({
          status: "idle",
          message:
            error instanceof Error
              ? `Waiting for the new comparison. ${error.message}`
              : "Waiting for the new comparison. The service is unavailable.",
        });
      } finally {
        inFlight = false;
        schedule(2000);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        schedule(0);
      } else {
        clearTimeout(timeout);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule(2000);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [awaitingComparison, commands]);

  const focusWorkspace = () => workspace.current?.focus({ preventScroll: true });
  const select = (next: ReviewSelection) => {
    if (route) route.onSelect(next);
    else setLocalSelection(next);
  };
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
  const reportError = (error: unknown, failed?: ReviewCommand, failedUndo?: UndoCommand) => {
    const message =
      error instanceof Error
        ? error.message
        : "The command could not be saved. Check your connection.";
    if (error instanceof ReviewCommandError && error.model) {
      setModel(error.model);
    }
    const conflict = error instanceof ReviewCommandError && error.conflict;
    const reviewer =
      error instanceof ReviewCommandError && error.reviewer ? ` Updated by ${error.reviewer}.` : "";
    setSaveState({
      status: conflict ? "conflict" : "error",
      message: `${conflict ? "Conflict. " : "Not saved. "}${message}${reviewer}`,
      failed: conflict ? undefined : failed,
      failedUndo: conflict ? undefined : failedUndo,
    });
  };
  const save = async (command: ReviewCommand) => {
    if (model.archived) return;
    if (saving.current) return;
    saving.current = true;
    setSaveState({
      status: "saving",
      message: `Saving ${command.targets.length} variant${command.targets.length === 1 ? "" : "s"}…`,
    });
    try {
      const result = await commands.save(command);
      const nextModel = applySavedReview(model, command, result);
      setModel(nextModel);
      if (!result.noop) {
        setHistory((entries) => [
          ...entries,
          { id: result.commandId, selection: command.selection },
        ]);
      }
      setSaveState({
        status: "idle",
        message: result.noop
          ? "This acceptance is already saved."
          : `${command.targets.length} variant${command.targets.length === 1 ? "" : "s"} ${command.verdict}. Saved.`,
      });
      if (!result.noop) {
        const next = nextPending(nextModel.items, command.selection);
        if (next) {
          select(next);
        } else {
          setAnnouncement("Review complete. No variants need review.");
        }
      }
      focusWorkspace();
    } catch (error) {
      reportError(error, command);
    } finally {
      saving.current = false;
    }
  };
  const review = (verdict: ReviewVerdict, wholeItem = false) => {
    if (!item || !variant) return;
    if (!ready || saving.current) return;
    if (saveState.status === "error") {
      setAnnouncement("Resolve the unsaved command before saving another review.");
      return;
    }
    const selectedTargets = wholeItem
      ? targets
      : targets.filter((entry) => entry.id === variant.id);
    if (!selectedTargets.length) return;
    const protectedTarget = selectedTargets.find((entry) =>
      verdict === "approved" ? entry.approveDisabledReason : entry.rejectDisabledReason,
    );
    if (protectedTarget) {
      const reason =
        verdict === "approved"
          ? protectedTarget.approveDisabledReason
          : protectedTarget.rejectDisabledReason;
      setAnnouncement(
        `${reason} No variants were changed.${wholeItem ? " Select an eligible variant and review it individually." : ""}`,
      );
      return;
    }
    void save({
      commandId: crypto.randomUUID(),
      comparisonId: model.comparisonId,
      verdict,
      targets: selectedTargets.map((entry) => ({ id: entry.id, expectedRevision: entry.revision })),
      wholeItemKey: wholeItem ? item.key : undefined,
      expectedPromotionId: model.promotionId ?? undefined,
      expectedBaselineRevision: model.baselineRevision,
      expectedRunRevision: model.comparisonRevision,
      selection: { itemKey: item.key, variantKey: variant.key },
    });
  };
  const undo = async (retryCommand?: UndoCommand) => {
    if (model.archived) return;
    const latest = history.at(-1);
    if (!latest || saving.current) return;
    if (saveState.status === "error" && !retryCommand) return;
    const command = retryCommand ?? {
      commandId: latest.id,
      undoCommandId: crypto.randomUUID(),
      expectedBaselineRevision: model.baselineRevision,
    };
    saving.current = true;
    setSaveState({ status: "saving", message: "Saving Undo…" });
    try {
      const result = await commands.undo(command);
      setModel(result.model);
      setHistory((entries) => entries.slice(0, -1));
      select(result.selection);
      setSaveState({
        status: "idle",
        message: "Undo saved. The original selection and verdicts were restored.",
      });
      focusWorkspace();
    } catch (error) {
      if (error instanceof ReviewCommandError && error.conflict) {
        setHistory((entries) => entries.filter((entry) => entry.id !== command.commandId));
      }
      reportError(error, undefined, command);
    } finally {
      saving.current = false;
    }
  };
  const refresh = async () => {
    if (saving.current) return;
    saving.current = true;
    setSaveState({ status: "saving", message: "Refreshing the current comparison…" });
    try {
      setModel(await commands.refresh());
      setRetry((value) => value + 1);
      setSaveState({
        status: "idle",
        message: "Current state loaded. Check the evidence before saving a new command.",
      });
    } catch (error) {
      reportError(error);
    } finally {
      saving.current = false;
    }
  };
  const recompare = async () => {
    if (!recompareAllowed || awaitingComparison) return;
    if (!commands.recompare || saving.current) return;
    if (saveState.status === "error") return;
    saving.current = true;
    setSaveState({ status: "saving", message: "Creating a new comparison from stored captures…" });
    try {
      const next = await commands.recompare();
      if (next.reviewReady || (next.archived && next.comparisonState === "ready")) {
        setModel(next);
      } else if (next.comparisonState === "invalidated") {
        setModel(next);
      } else {
        if (next.archived) {
          setModel((previous) => ({
            ...previous,
            archived: true,
            reviewReady: false,
            readOnlyReason: next.readOnlyReason,
          }));
        }
        setPendingComparison(true);
      }
      setSaveState({
        status: "idle",
        message:
          next.comparisonState === "invalidated"
            ? (next.run.error ?? "The new comparison failed.")
            : "New comparison requested. Results will open when comparison completes.",
      });
    } catch (error) {
      reportError(error);
    } finally {
      saving.current = false;
    }
  };
  const exportRun = async () => {
    if (!commands.export || exportState.pending) return;
    setExportState({ pending: true, message: "Preparing a private export…" });
    try {
      await commands.export();
      setExportState({ pending: false, message: "Export prepared. The download was requested." });
    } catch (error) {
      setExportState({
        pending: false,
        message:
          error instanceof Error ? `Export failed. ${error.message}` : "Export failed. Try again.",
      });
    }
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
    if (!item || !variant) return;
    const itemIndex = model.items.indexOf(item);
    const order = partitionItems(model.items).order;
    const itemPosition = order.indexOf(itemIndex);
    const variantIndex = item.variants.indexOf(variant);
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
  });
  useEffect(() => {
    const document = workspace.current?.ownerDocument;
    if (!document) return;
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <Shell
      className="review-workspace max-md:flex! max-md:flex-col! max-md:[&>.shell-sidebar]:w-full!"
      ref={workspace}
      tabIndex={0}
      aria-label="Review workspace"
      $layer="canvas"
    >
      <ShellHeader
        $height="lg"
        $stackCenter
        start={
          <a href="/" className="text-sm font-semibold">
            Visonaut
          </a>
        }
        center={
          <div className="min-w-0">
            <p className="text-xs ak-ink-60">{model.run.repository ?? "Repository"}</p>
            <h1 className="text-sm font-semibold wrap-anywhere">
              {model.run.title ??
                `${model.run.kind === "main" ? "Main" : model.run.kind === "merge_group" ? "Merge queue" : "Pull request"} visual review`}
            </h1>
          </div>
        }
        end={<div className="flex items-center gap-2">{headerEnd}</div>}
      />
      <ShellSidebar
        $show={true}
        $width="md"
        render={<aside />}
        className="review-sidebar max-md:w-full! max-md:[&>.shell-sidebar-panel]:w-full! max-md:[&>.shell-sidebar-panel]:relative!"
        aria-label="Review navigation"
      >
        <ShellSidebarHeader className="flex justify-between text-xs" $p={3}>
          <strong>Items</strong>
          <span>{model.items.length}</span>
        </ShellSidebarHeader>
        <ShellSidebarBody $p={2} className="review-sidebar-body">
          <ItemList
            items={model.items}
            selectedIndex={item ? model.items.indexOf(item) : -1}
            selectItem={selectItem}
            route={route}
            variantKeyForItem={(entry) =>
              entry.variants.find(needsReview)?.key ?? entry.variants[0]?.key
            }
          />
        </ShellSidebarBody>
      </ShellSidebar>
      <ShellMain $maxWidth="100%" $p={0} className="review-main max-md:block!">
        <ShellMainHeader className="max-md:block!" $p={0}>
          <Frame $p={3} className="flex flex-wrap items-center justify-between gap-3">
            <div className="review-result-heading min-w-0">
              <h2 className="text-sm font-semibold wrap-anywhere">
                {item?.name ?? "Visual review"}
              </h2>
              {variant && (
                <p className="text-xs ak-ink-60 wrap-anywhere">
                  {variant.label} · {verdictLabel(variant)}
                  {variant.reviewer ? ` · ${variant.reviewer}` : ""}
                  {variant.kind === "added"
                    ? " · New image"
                    : variant.kind === "removed"
                      ? " · Removed"
                      : ""}
                </p>
              )}
              <p className="text-xs ak-ink-60">
                {pending} of {total} need review · {runStatusLabel(model.run.status)}
              </p>
            </div>
            <div className="review-actions flex flex-wrap gap-2 items-center">
              <Button
                disabled={
                  !ready ||
                  busy ||
                  saveState.status === "error" ||
                  !targets.some((entry) => entry.id === variant?.id) ||
                  !!variant?.approveDisabledReason
                }
                title={variant?.approveDisabledReason}
                onClick={() => review("approved")}
              >
                Approve <ButtonSlot $kind="shortcut">A</ButtonSlot>
              </Button>
              <Button
                disabled={
                  !ready ||
                  busy ||
                  saveState.status === "error" ||
                  !targets.some((entry) => entry.id === variant?.id) ||
                  !!variant?.rejectDisabledReason
                }
                title={variant?.rejectDisabledReason}
                onClick={() => review("rejected")}
              >
                Reject <ButtonSlot $kind="shortcut">X</ButtonSlot>
              </Button>
              <Button
                disabled={model.archived || !history.length || busy || saveState.status === "error"}
                onClick={() => void undo()}
              >
                Undo <ButtonSlot $kind="shortcut">⌘/Ctrl Z</ButtonSlot>
              </Button>
            </div>
            <div
              className="review-save-state basis-full flex flex-wrap items-center gap-2 text-xs ak-ink-60"
              role={
                saveState.status === "error" || saveState.status === "conflict" ? "alert" : "status"
              }
            >
              {saveState.message || "Review commands are saved after server confirmation."}
              {!model.archived && saveState.status === "error" && saveState.failed && (
                <Button
                  className="text-xs"
                  onClick={() => {
                    if (saveState.failed) void save(saveState.failed);
                  }}
                >
                  Retry same command
                </Button>
              )}
              {!model.archived && saveState.status === "error" && saveState.failedUndo && (
                <Button className="text-xs" onClick={() => void undo(saveState.failedUndo)}>
                  Retry Undo
                </Button>
              )}
              {(saveState.status === "conflict" || saveState.status === "error") && (
                <Button className="text-xs" onClick={() => void refresh()}>
                  Refresh current state
                </Button>
              )}
            </div>
          </Frame>
        </ShellMainHeader>
        <ShellMainBody className="max-md:block!">
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
          {item && variant ? (
            <>
              <Tabs selectedId={variant.id} selectOnMove={false}>
                <TabList
                  aria-label="Variants"
                  className="overflow-x-auto max-w-full"
                  onKeyDownCapture={(event) => followFocusedTab(event)}
                >
                  {item.variants.map((entry, index) => (
                    <Tab
                      key={entry.id}
                      id={entry.id}
                      className="review-variant"
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
                        if (!route) selectVariant(index);
                      }}
                      aria-label={`${index + 1}. ${entry.label}. ${verdictLabel(entry)}`}
                    >
                      <VariantSummary variant={entry} index={index} />
                      <small className="text-xs ak-ink-60">{verdictLabel(entry)}</small>
                    </Tab>
                  ))}
                </TabList>
                <TabPanel single className="review-result" tabIndex={-1}>
                  {!model.archived &&
                    (variant.approveDisabledReason || variant.rejectDisabledReason) && (
                      <p className="text-xs ak-ink-60 px-3 pb-3">
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
                      <div className="flex flex-wrap justify-between gap-3 p-3">
                        <ButtonGroup
                          $p={0}
                          $gap="none"
                          className="min-w-0 max-w-full overflow-x-auto"
                          aria-label="Image view"
                        >
                          <FlatButton
                            className="text-xs"
                            aria-pressed={effectiveMode === "side"}
                            $lightnessOffset={effectiveMode === "side"}
                            onClick={() => setView("side")}
                          >
                            Side by side <ButtonSlot $kind="shortcut">S</ButtonSlot>
                          </FlatButton>
                          <FlatButton
                            className="text-xs"
                            aria-pressed={effectiveMode === "diff"}
                            $lightnessOffset={effectiveMode === "diff"}
                            aria-disabled={!variant.reference || !variant.candidate}
                            onClick={() => setView("diff")}
                          >
                            Pixel diff <ButtonSlot $kind="shortcut">D</ButtonSlot>
                          </FlatButton>
                          <FlatButton
                            className="text-xs"
                            aria-pressed={effectiveMode === "new"}
                            $lightnessOffset={effectiveMode === "new"}
                            onClick={() => setView("new")}
                          >
                            New only <ButtonSlot $kind="shortcut">F</ButtonSlot>
                          </FlatButton>
                          <FlatButton
                            className="text-xs"
                            aria-pressed={effectiveMode === "original"}
                            $lightnessOffset={effectiveMode === "original"}
                            onClick={() => setView("original")}
                          >
                            Original only <ButtonSlot $kind="shortcut">G</ButtonSlot>
                          </FlatButton>
                        </ButtonGroup>
                        <ButtonGroup $p={0} $gap="none" aria-label="Image zoom">
                          {(["fit", 1, 2] as const).map((value) => (
                            <FlatButton
                              key={value}
                              className="text-xs"
                              aria-pressed={zoom === value}
                              $lightnessOffset={zoom === value}
                              onClick={() => setZoom(value)}
                            >
                              {value === "fit" ? "Fit" : `${value * 100}%`}
                            </FlatButton>
                          ))}
                        </ButtonGroup>
                      </div>
                      {(!variant.reference || !variant.candidate) && (
                        <p className="text-xs ak-ink-60 px-3 pb-3">
                          Pixel diff requires both a reference and a new image.
                        </p>
                      )}
                      <Frame
                        $layer="canvas"
                        $border
                        $p={0}
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
                                    ? "Comparison needs to be rerun"
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
                  <div className="flex flex-wrap items-center gap-2 p-3">
                    <span>
                      {targets.length} changed variant{targets.length === 1 ? "" : "s"} in this item
                    </span>
                    <Button
                      className="text-xs"
                      disabled={!ready || busy || saveState.status === "error" || !targets.length}
                      onClick={() => review("approved", true)}
                    >
                      Approve whole item ({targets.length}){" "}
                      <ButtonSlot $kind="shortcut">Shift A</ButtonSlot>
                    </Button>
                    <Button
                      className="text-xs"
                      disabled={!ready || busy || saveState.status === "error" || !targets.length}
                      onClick={() => review("rejected", true)}
                    >
                      Reject whole item ({targets.length}){" "}
                      <ButtonSlot $kind="shortcut">Shift X</ButtonSlot>
                    </Button>
                  </div>
                  <Disclosure
                    className="review-metadata"
                    $p={3}
                    button={<DisclosureButton>Details</DisclosureButton>}
                  >
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
                    <dl className="grid grid-cols-[auto_1fr] gap-3 my-5">
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
                        {variant.referenceProfile ?? "Absent"} →{" "}
                        {variant.candidateProfile ?? "Absent"}
                      </dd>
                      <dt>Comparison</dt>
                      <dd>
                        {model.comparisonId} · {variant.id} · decision revision {variant.revision}
                      </dd>
                    </dl>
                  </Disclosure>
                </TabPanel>
              </Tabs>
            </>
          ) : (
            <div className="p-6">
              <h2>No comparison items</h2>
              <p>
                {model.reviewReady
                  ? "This run contains no review items."
                  : "Images will appear after the complete run is processed."}
              </p>
            </div>
          )}
        </ShellMainBody>
      </ShellMain>
      <ShellFooter className="flex! flex-wrap gap-3" $p={3}>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="text-xs"
            aria-pressed={shortcuts}
            onClick={() => setShortcuts((value) => !value)}
          >
            Shortcuts {shortcuts ? "on" : "off"}
          </Button>
          <ShortcutHelp />
          {commands.recompare && !model.preview && (
            <Button
              className="text-xs"
              disabled={
                !recompareAllowed || busy || awaitingComparison || saveState.status === "error"
              }
              title={!recompareAllowed ? recompareDisabledReason : undefined}
              onClick={() => void recompare()}
            >
              Recompare stored run
            </Button>
          )}
          {commands.export && !model.preview && (
            <Button
              className="text-xs"
              disabled={exportState.pending}
              onClick={() => void exportRun()}
            >
              Export run
            </Button>
          )}
        </div>
        {commands.recompare && !model.preview && !recompareAllowed && recompareDisabledReason && (
          <p>{recompareDisabledReason}</p>
        )}
        {exportState.message && <p role="status">{exportState.message}</p>}
        <p
          className="text-xs ak-ink-60 basis-full"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </p>
      </ShellFooter>
    </Shell>
  );
}
