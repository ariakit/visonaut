import * as ak from "@ariakit/react";
import { Columns2Icon, ScanIcon, ImageIcon, ImageMinusIcon, DiffIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { ControlButton as Button } from "../components/control-button.tsx";
import {
  Button as FlatButton,
  ButtonGroup,
  ButtonGlider,
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
import { Nav, NavLink } from "../components/ariakit/components/nav.ariakit.react.tsx";
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
  ReviewSaveResult,
  ReviewZoom,
  UndoCommand,
} from "./model.ts";
import {
  applyPendingReviews,
  applySavedReview,
  latestReviewModel,
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

interface QueuedReview {
  command: ReviewCommand;
  controller?: AbortController;
  response?: Promise<
    { result: ReviewSaveResult; error?: never } | { error: unknown; result?: never }
  >;
}

interface SaveState {
  status: "idle" | "saving" | "error" | "conflict";
  message: string;
  failed?: ReviewCommand;
  failedUndo?: UndoCommand;
  durable?: boolean;
}

function excludesShortcuts(event: globalThis.KeyboardEvent) {
  const target = event.target;
  if (!target) return true;
  if (!("nodeType" in target)) return true;
  if (target.nodeType !== 1) return true;
  const element = target as HTMLElement;
  return !!element.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menu"], [role="menubar"], [role="dialog"], [role="alertdialog"], [role="tablist"], .review-variants',
  );
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
  const [savedModel, setModel] = useState(suppliedModel);
  const [pendingReviews, setPendingReviews] = useState<ReviewCommand[]>([]);
  const [queuedCommands, setQueuedCommands] = useState(new Set<string>());
  const model = useMemo(
    () => applyPendingReviews(savedModel, pendingReviews),
    [savedModel, pendingReviews],
  );
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
  const reviewQueue = useRef<QueuedReview[]>([]);
  const durableCommands = useRef(new Set<string>());
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
  const reviewBlocked = busy && !pendingReviews.length;
  const sendingCount = pendingReviews.filter(
    (command) => !queuedCommands.has(command.commandId),
  ).length;
  const queuedCount = pendingReviews.length - sendingCount;
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
    if (!pendingReviews.length && !saveState.failed) {
      setModel(suppliedModel);
    }
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
    return () => {
      for (const entry of reviewQueue.current) {
        entry.controller?.abort();
      }
      reviewQueue.current = [];
    };
  }, []);
  useEffect(() => {
    if (saveState.status !== "saving" && saveState.status !== "error") return;
    if (pendingReviews.length && !sendingCount) return;
    if (saveState.durable) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState.status, saveState.durable, pendingReviews.length, sendingCount]);
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
      const currentModel = error.model;
      setModel((model) => latestReviewModel(model, currentModel));
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
    if (saving.current && !reviewQueue.current.length) return;
    if (!reviewQueue.current.some((entry) => entry.command.commandId === command.commandId)) {
      reviewQueue.current.push({ command });
    }
    reviewQueue.current = reviewQueue.current.map((entry) => {
      if (entry.response) return entry;
      const controller = new AbortController();
      const response = commands
        .save(entry.command, {
          signal: controller.signal,
          onQueued: () => {
            durableCommands.current.add(entry.command.commandId);
            setQueuedCommands((previous) => new Set([...previous, entry.command.commandId]));
          },
        })
        .then(
          (result) => ({ result }),
          (error) => ({ error }),
        );
      return { ...entry, controller, response };
    });
    const queued = reviewQueue.current.map((entry) => entry.command);
    setPendingReviews(queued);
    setSaveState({
      status: "saving",
      message: `Saving ${queued.length} decision${queued.length === 1 ? "" : "s"}…`,
    });
    const optimisticModel = applyPendingReviews(savedModel, queued);
    const next = nextPending(optimisticModel.items, queued.at(-1)?.selection ?? command.selection);
    if (next) {
      select(next);
    }
    focusWorkspace();
    if (saving.current) return;
    saving.current = true;
    let currentModel = savedModel;
    try {
      while (reviewQueue.current.length) {
        const entry = reviewQueue.current[0];
        if (!entry) break;
        const currentCommand = entry.command;
        try {
          const response = await entry.response;
          if (!response) throw new Error("The decision has not been submitted.");
          if ("error" in response) throw response.error;
          const result = response.result;
          if (reviewQueue.current[0] !== entry) return;
          currentModel = applySavedReview(currentModel, currentCommand, result);
          setModel(currentModel);
          reviewQueue.current.shift();
          if (result.noop) {
            const discarded = reviewQueue.current.length;
            for (const pending of reviewQueue.current) {
              pending.controller?.abort();
            }
            reviewQueue.current = [];
            setPendingReviews([]);
            setSaveState({
              status: "idle",
              message: `This acceptance is already saved.${discarded ? " Later queued decisions were not saved. Review them again." : ""}`,
            });
            select(currentCommand.selection);
            return;
          }
          setHistory((entries) => [
            ...entries,
            { id: result.commandId, selection: currentCommand.selection },
          ]);
          const remaining = reviewQueue.current.map((entry) => entry.command);
          setPendingReviews(remaining);
          setSaveState({
            status: remaining.length ? "saving" : "idle",
            message: remaining.length
              ? `Saving ${remaining.length} decision${remaining.length === 1 ? "" : "s"}…`
              : `${currentCommand.targets.length} variant${currentCommand.targets.length === 1 ? "" : "s"} ${currentCommand.verdict}. Saved.`,
          });
          if (!remaining.length && !nextPending(currentModel.items, currentCommand.selection)) {
            setAnnouncement("Review complete. No variants need review.");
          }
        } catch (error) {
          if (reviewQueue.current[0] !== entry) return;
          setPendingReviews([]);
          select(currentCommand.selection);
          const conflict = error instanceof ReviewCommandError && error.conflict;
          const discarded = conflict && reviewQueue.current.length > 1;
          for (const pending of reviewQueue.current) {
            pending.controller?.abort();
          }
          reviewQueue.current = conflict
            ? []
            : reviewQueue.current.map(({ command }) => ({ command }));
          reportError(error, currentCommand);
          if (durableCommands.current.has(currentCommand.commandId) && !conflict) {
            setSaveState((state) => ({
              ...state,
              durable: reviewQueue.current.every((entry) =>
                durableCommands.current.has(entry.command.commandId),
              ),
              message: `Could not confirm the queued decisions. The server will continue processing them. Retry to check their status.${error instanceof ReviewCommandError && error.reference ? ` Reference: ${error.reference}.` : ""}`,
            }));
          }
          if (discarded) {
            setSaveState((state) => ({
              ...state,
              message: `${state.message} Later queued decisions were not saved. Review them again.`,
            }));
          }
          return;
        }
      }
    } finally {
      saving.current = false;
    }
  };
  const review = (verdict: ReviewVerdict, wholeItem = false) => {
    if (!item || !variant) return;
    if (!ready || reviewBlocked) return;
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
      previousCommandId: reviewQueue.current.at(-1)?.command.commandId,
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
    for (const pending of reviewQueue.current) {
      pending.controller?.abort();
    }
    reviewQueue.current = [];
    setPendingReviews([]);
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
        $height="sm"
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
        <ShellSidebarHeader className="flex justify-between text-xs min-h-10!" $p={3}>
          <strong>Items</strong>
          <span>{model.items.length}</span>
        </ShellSidebarHeader>
        <ShellSidebarBody
          $p={2}
          className="review-sidebar-body flex flex-col overflow-hidden! max-md:h-64 max-md:flex-none"
        >
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
          <Frame $p={3} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="review-result-heading min-w-0 flex-1 basis-48">
              <h2 className="text-sm font-semibold truncate" title={item?.name}>
                {item?.name ?? "Visual review"}
              </h2>
              <p className="text-xs ak-ink-60 flex flex-wrap gap-x-3">
                <span>
                  {pending} of {total} need review
                </span>
                {variant && <span>{verdictLabel(variant)}</span>}
              </p>
            </div>
            <div className="review-actions flex flex-wrap gap-1 items-center text-xs">
              <Button
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
                Approve <ButtonSlot $kind="shortcut">A</ButtonSlot>
              </Button>
              <Button
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
                Reject <ButtonSlot $kind="shortcut">X</ButtonSlot>
              </Button>
              <Button
                disabled={model.archived || !history.length || busy || saveState.status === "error"}
                onClick={() => void undo()}
              >
                Undo <ButtonSlot $kind="shortcut">⌘/Ctrl Z</ButtonSlot>
              </Button>
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
              <Nav
                $layout="horizontal"
                $rounded="none"
                $forceRounded
                $p={0}
                $gap={0}
                glider={{ $kind: "bar", $barOffset: "frame" }}
                aria-label="Variants"
                className="review-variants max-w-full border-b border-(--ak-edge)"
                onKeyDown={followVariantLink}
              >
                {item.variants.map((entry, index) => (
                  <NavLink
                    $kind="flat"
                    $selectedPush={false}
                    $p={2}
                    aria-current={entry.id === variant.id ? "page" : undefined}
                    href={route ? undefined : `#variant-${encodeURIComponent(entry.key)}`}
                    key={entry.id}
                    id={entry.id}
                    className="review-variant max-w-56 min-w-0 text-xs"
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
              <section className="review-result" aria-label="Selected variant" tabIndex={-1}>
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
                    <div className="review-view-controls flex flex-wrap items-center justify-between gap-2 px-3 py-2">
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
                          Side by side <ButtonSlot $kind="shortcut">S</ButtonSlot>
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
                          Pixel diff <ButtonSlot $kind="shortcut">D</ButtonSlot>
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
                          New only <ButtonSlot $kind="shortcut">F</ButtonSlot>
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
                          Original only <ButtonSlot $kind="shortcut">G</ButtonSlot>
                        </FlatButton>
                        <ButtonGlider $rounded="md" />
                      </ButtonGroup>
                      <ButtonGroup
                        $p={0.5}
                        $gap="xs"
                        $rounded="md"
                        $forceRounded
                        $border
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
                            {value === "fit" ? "Fit" : `${value * 100}%`}
                          </FlatButton>
                        ))}
                        <ButtonGlider $rounded="md" />
                      </ButtonGroup>
                    </div>
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
                              disabled={busy || awaitingComparison || saveState.status === "error"}
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
                    disabled={
                      !ready || reviewBlocked || saveState.status === "error" || !targets.length
                    }
                    onClick={() => review("approved", true)}
                  >
                    Approve whole item ({targets.length}){" "}
                    <ButtonSlot $kind="shortcut">Shift A</ButtonSlot>
                  </Button>
                  <Button
                    className="text-xs"
                    disabled={
                      !ready || reviewBlocked || saveState.status === "error" || !targets.length
                    }
                    onClick={() => review("rejected", true)}
                  >
                    Reject whole item ({targets.length}){" "}
                    <ButtonSlot $kind="shortcut">Shift X</ButtonSlot>
                  </Button>
                </div>
                <Disclosure
                  className="review-metadata"
                  $rounded="none"
                  $forceRounded
                  $p={3}
                  button={<DisclosureButton>Details</DisclosureButton>}
                >
                  <p className="text-xs wrap-anywhere">
                    {variant.label} · {verdictLabel(variant)}
                    {variant.reviewer ? ` · ${variant.reviewer}` : ""}
                  </p>
                  <p className="text-xs">{runStatusLabel(model.run.status)}</p>
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
              </section>
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
      <ShellFooter className="flex! flex-wrap items-center gap-3" $p={3}>
        <div
          className="review-save-state flex flex-wrap items-center gap-2 text-xs ak-ink-60 empty:hidden"
          role={
            saveState.status === "error" || saveState.status === "conflict" ? "alert" : "status"
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
