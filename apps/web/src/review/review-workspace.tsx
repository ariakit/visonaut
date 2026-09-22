import * as ak from "@ariakit/react";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Button } from "../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Kbd } from "../components/ariakit/components/kbd.ariakit.react.tsx";
import {
  Tab,
  TabList,
  TabPanel,
  TabProvider,
} from "../components/ariakit/components/tabs.ariakit.react.tsx";
import { ScreenshotViewer } from "../components/screenshot-viewer.tsx";
import { ItemList } from "./item-list.tsx";
import { ReviewCommandError } from "./model.ts";
import type {
  ReviewCommand,
  ReviewCommands,
  ReviewModel,
  ReviewMode,
  ReviewSelection,
  ReviewVerdict,
  ReviewZoom,
  UndoCommand,
} from "./model.ts";
import { needsReview, nextPending, reviewTargets, verdictLabel } from "./navigation.ts";
import { useEvidence } from "./use-evidence.ts";
import "../review.css";

export interface ReviewWorkspaceProps {
  model: ReviewModel;
  commands: ReviewCommands;
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

function excludesShortcuts(event: KeyboardEvent<HTMLElement>) {
  const target = event.target;
  if (!("nodeType" in target)) return true;
  if (target.nodeType !== 1) return true;
  const element = target as HTMLElement;
  return !!element.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menu"], [role="menubar"], [role="dialog"], [role="alertdialog"]',
  );
}

function initialSelection(model: ReviewModel): ReviewSelection {
  const item = model.items.find((entry) => entry.variants.length);
  return { itemKey: item?.key ?? "", variantKey: item?.variants[0]?.key ?? "" };
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

function ShortcutHelp() {
  return (
    <ak.DialogProvider>
      <ak.DialogDisclosure render={<Button className="review-control" />}>
        Keyboard help
      </ak.DialogDisclosure>
      <ak.Dialog
        className="review-help-dialog"
        backdrop={<div className="review-dialog-backdrop" />}
      >
        <ak.DialogHeading>Review with the keyboard</ak.DialogHeading>
        <ak.DialogDescription>
          Shortcuts work while focus is in the review workspace. Text fields, menus, and dialogs
          keep their own keys.
        </ak.DialogDescription>
        <dl>
          <dt>↑ / ↓</dt>
          <dd>Previous or next item. Stop at either end.</dd>
          <dt>← / → · 1–6</dt>
          <dd>Select a variant.</dd>
          <dt>A / X</dt>
          <dd>Approve or reject, then move to the next pending variant.</dd>
          <dt>Shift+A / Shift+X</dt>
          <dd>Review all changed variants in this item as one command.</dd>
          <dt>S / D / F</dt>
          <dd>Side by side, red pixel diff, or full new image.</dd>
          <dt>Cmd/Ctrl+Z</dt>
          <dd>Undo your last saved command in this session.</dd>
          <dt>Tab / Escape</dt>
          <dd>Move to controls or close this help.</dd>
        </dl>
        <ak.DialogDismiss render={<Button className="review-control" />}>
          Close help
        </ak.DialogDismiss>
      </ak.Dialog>
    </ak.DialogProvider>
  );
}

export function ReviewWorkspace(props: ReviewWorkspaceProps) {
  return <ReviewSession key={props.model.run.id} {...props} />;
}

function ReviewSession({ model: suppliedModel, commands }: ReviewWorkspaceProps) {
  const [previousModel, setPreviousModel] = useState(suppliedModel);
  const [model, setModel] = useState(suppliedModel);
  const [selection, setSelection] = useState(() => initialSelection(suppliedModel));
  const [mode, setMode] = useState<ReviewMode>("side");
  const [zoom, setZoom] = useState<ReviewZoom>("fit");
  const [shortcuts, setShortcuts] = useState(true);
  const [retry, setRetry] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle", message: "" });
  const [history, setHistory] = useState<SavedCommand[]>([]);
  const [pendingComparison, setPendingComparison] = useState(false);
  const [exportState, setExportState] = useState({ pending: false, message: "" });
  const remembered = useRef(new Map<string, string>());
  const workspace = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const item = model.items.find((entry) => entry.key === selection.itemKey) ?? model.items[0];
  const variant =
    item?.variants.find((entry) => entry.key === selection.variantKey) ?? item?.variants[0];
  const effectiveMode =
    mode === "diff" && (!variant?.reference || !variant.candidate) ? "side" : mode;
  const evidence = useEvidence({
    comparisonId: model.comparisonId,
    variant,
    mode: effectiveMode,
    retry,
  });
  const ready =
    !model.archived && !pendingComparison && model.reviewReady && evidence.status === "ready";
  const busy = saveState.status === "saving";
  const targets = item ? reviewTargets(item) : [];
  const pending = model.items.reduce(
    (count, entry) => count + entry.variants.filter(needsReview).length,
    0,
  );
  const total = model.items.reduce((count, entry) => count + entry.variants.length, 0);
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

  if (previousModel !== suppliedModel) {
    setPreviousModel(suppliedModel);
    setModel(suppliedModel);
  }
  if (item && variant && (item.key !== selection.itemKey || variant.key !== selection.variantKey)) {
    setSelection({ itemKey: item.key, variantKey: variant.key });
    setAnnouncement(`The remembered variant is unavailable. Selected ${variant.label}.`);
  }
  useEffect(() => {
    if (item && variant) remembered.current.set(item.key, variant.key);
  }, [item, variant]);
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
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const current = await commands.refresh();
        if (cancelled) return;
        if (current.reviewReady || (current.archived && current.comparisonState === "ready")) {
          setModel(current);
          setPendingComparison(false);
          setSaveState({ status: "idle", message: "The new comparison is ready." });
          return;
        }
        if (
          current.comparisonState === "invalidated" ||
          ["failed", "superseded", "needs-recompare"].includes(current.run.status)
        ) {
          setModel(current);
          setPendingComparison(false);
          setSaveState({
            status: "idle",
            message: current.run.error ?? runStatusLabel(current.run.status),
          });
          return;
        }
        setSaveState({
          status: "idle",
          message: `${runStatusLabel(current.run.status)}. Review actions are unavailable until it is ready.`,
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
      }
      timeout = setTimeout(poll, 2000);
    };
    timeout = setTimeout(poll, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [awaitingComparison, commands]);

  const focusWorkspace = () => workspace.current?.focus({ preventScroll: true });
  const select = (next: ReviewSelection) => {
    remembered.current.set(next.itemKey, next.variantKey);
    setSelection(next);
  };
  const selectItem = (index: number) => {
    const next = model.items[index];
    if (!next) return;
    const previous = remembered.current.get(next.key);
    const selected = next.variants.find((entry) => entry.key === previous) ?? next.variants[0];
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
      setModel(result.model);
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
        const next = nextPending(result.model.items, command.selection);
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
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
    const variantIndex = item.variants.indexOf(variant);
    if (key === "arrowup") selectItem(itemIndex - 1);
    else if (key === "arrowdown") selectItem(itemIndex + 1);
    else if (key === "arrowleft") selectVariant(variantIndex - 1);
    else if (key === "arrowright") selectVariant(variantIndex + 1);
    else if (/^[1-6]$/.test(key)) selectVariant(Number(key) - 1);
    else if (key === "a") review("approved", event.shiftKey);
    else if (key === "x") review("rejected", event.shiftKey);
    else if (key === "s") setView("side");
    else if (key === "d") setView("diff");
    else if (key === "f") setView("new");
    else return;
    event.preventDefault();
  };

  return (
    <Frame
      className="review-workspace"
      ref={workspace}
      tabIndex={0}
      aria-label="Review workspace"
      onKeyDown={onKeyDown}
    >
      <header className="review-run-header">
        <div>
          <p className="review-eyebrow">Visonaut · ariakit/ariakit</p>
          <h1>
            {model.run.title ??
              `${model.run.kind === "main" ? "Main" : model.run.kind === "merge_group" ? "Merge queue" : "Pull request"} visual review`}
          </h1>
          <p className="review-run-identity">
            <code title={model.run.testedSha}>{model.run.testedSha.slice(0, 12)}</code>
            <span>Run {model.run.id}</span>
            <span>Attempt {model.run.attempt}</span>
            <span>Comparison {model.comparisonRevision}</span>
          </p>
        </div>
        <div className="review-run-state">
          <strong>
            {pending} of {total} need review
          </strong>
          <span>{runStatusLabel(model.run.status)}</span>
        </div>
      </header>
      {!!model.historicalComparisons?.length && (
        <nav className="review-banner" aria-label="Comparison history">
          <a
            href={`/runs/${encodeURIComponent(model.run.id)}`}
            aria-current={
              model.historicalComparisons.some((comparison) => comparison.id === model.comparisonId)
                ? undefined
                : "page"
            }
          >
            Original comparison
          </a>
          {model.historicalComparisons.map((comparison) => (
            <span key={comparison.id}>
              {" · "}
              <a
                href={`/runs/${encodeURIComponent(model.run.id)}?comparison=${encodeURIComponent(comparison.id)}`}
                aria-current={comparison.id === model.comparisonId ? "page" : undefined}
                title={new Date(comparison.createdAt).toLocaleString()}
              >
                Historical comparison {comparison.ordinal} ·{" "}
                {comparison.state === "ready"
                  ? "Complete"
                  : comparison.state === "invalidated"
                    ? "Failed"
                    : "Comparing"}
              </a>
            </span>
          ))}
        </nav>
      )}
      {model.run.error && (
        <p role="alert" className="review-banner">
          {model.run.error}
        </p>
      )}
      {model.archived && (
        <p className="review-banner" role="status">
          {model.readOnlyReason ??
            "This closed run is read-only. Its review history remains available."}
        </p>
      )}
      {!model.archived && !model.reviewReady && (
        <p className="review-banner" role="status">
          Review is unavailable until the run is sealed and all comparisons are complete.
        </p>
      )}
      {pendingComparison && (
        <p className="review-banner" role="status">
          A new comparison is being prepared from stored captures. The previous comparison remains
          visible until the new evidence is ready.
        </p>
      )}
      <div className="review-shell">
        <aside className="review-sidebar" aria-label="Review items">
          <div className="review-sidebar-heading">
            <strong>Items</strong>
            <span>{model.items.length}</span>
          </div>
          <ItemList
            items={model.items}
            selectedIndex={item ? model.items.indexOf(item) : -1}
            selectItem={selectItem}
          />
        </aside>
        <main className="review-main">
          {item && variant ? (
            <>
              <div className="review-item-heading">
                <h2>{item.name}</h2>
                <code>{item.key}</code>
              </div>
              <TabProvider
                selectedId={variant.id}
                setSelectedId={(id) => {
                  const index = item.variants.findIndex((entry) => entry.id === id);
                  selectVariant(index);
                }}
              >
                <TabList className="review-variants" aria-label="Variants">
                  {item.variants.map((entry, index) => (
                    <Tab key={entry.id} id={entry.id} className="review-variant">
                      <span>
                        {index + 1} · {entry.label}
                      </span>
                      <small>{verdictLabel(entry)}</small>
                    </Tab>
                  ))}
                </TabList>
                <TabPanel single className="review-result" tabIndex={-1}>
                  <div className="review-result-heading">
                    <div>
                      <h3>{variant.label}</h3>
                      <p>
                        {verdictLabel(variant)}
                        {variant.reviewer ? ` · ${variant.reviewer}` : ""}
                        {variant.kind === "added"
                          ? " · New image"
                          : variant.kind === "removed"
                            ? " · Removed"
                            : ""}
                      </p>
                    </div>
                    <div className="review-actions">
                      <Button
                        className="review-control"
                        disabled={
                          !ready ||
                          busy ||
                          saveState.status === "error" ||
                          !targets.some((entry) => entry.id === variant.id) ||
                          !!variant.approveDisabledReason
                        }
                        title={variant.approveDisabledReason}
                        onClick={() => review("approved")}
                      >
                        Approve <Kbd>A</Kbd>
                      </Button>
                      <Button
                        className="review-control"
                        disabled={
                          !ready ||
                          busy ||
                          saveState.status === "error" ||
                          !targets.some((entry) => entry.id === variant.id) ||
                          !!variant.rejectDisabledReason
                        }
                        title={variant.rejectDisabledReason}
                        onClick={() => review("rejected")}
                      >
                        Reject <Kbd>X</Kbd>
                      </Button>
                    </div>
                  </div>
                  {(variant.approveDisabledReason || variant.rejectDisabledReason) && (
                    <p className="review-protection">
                      {variant.rejectDisabledReason ?? variant.approveDisabledReason}
                    </p>
                  )}
                  <div className="review-view-tools">
                    <div className="review-control-group" aria-label="Image view">
                      <Button
                        className="review-control"
                        aria-pressed={effectiveMode === "side"}
                        onClick={() => setView("side")}
                      >
                        Side by side <Kbd>S</Kbd>
                      </Button>
                      <Button
                        className="review-control"
                        aria-pressed={effectiveMode === "diff"}
                        aria-disabled={!variant.reference || !variant.candidate}
                        onClick={() => setView("diff")}
                      >
                        Pixel diff <Kbd>D</Kbd>
                      </Button>
                      <Button
                        className="review-control"
                        aria-pressed={effectiveMode === "new"}
                        onClick={() => setView("new")}
                      >
                        New only <Kbd>F</Kbd>
                      </Button>
                    </div>
                    <div className="review-control-group" aria-label="Image zoom">
                      {(["fit", 1, 2] as const).map((value) => (
                        <Button
                          key={value}
                          className="review-control"
                          aria-pressed={zoom === value}
                          onClick={() => setZoom(value)}
                        >
                          {value === "fit" ? "Fit" : `${value * 100}%`}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {(!variant.reference || !variant.candidate) && (
                    <p className="review-view-note">
                      Pixel diff requires both a reference and a new image.
                    </p>
                  )}
                  <div className="review-evidence" data-evidence={evidence.status}>
                    <ScreenshotViewer
                      variant={variant}
                      mode={effectiveMode}
                      zoom={zoom}
                      ready={evidence.status === "ready"}
                      identity={evidence.identity}
                      report={evidence.report}
                    />
                    {evidence.status === "loading" && (
                      <div className="review-evidence-message" role="status">
                        Loading this comparison’s images…
                      </div>
                    )}
                    {evidence.status === "error" && (
                      <div className="review-evidence-message" role="alert">
                        <strong>Image evidence unavailable</strong>
                        <p>{evidence.error}</p>
                        <Button
                          className="review-control"
                          disabled={busy}
                          onClick={() => {
                            setRetry((value) => value + 1);
                          }}
                        >
                          Retry images
                        </Button>
                        <Button
                          className="review-control"
                          disabled={busy}
                          onClick={() => void refresh()}
                        >
                          Refresh comparison
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="review-whole-item">
                    <span>
                      {targets.length} changed variant{targets.length === 1 ? "" : "s"} in this item
                    </span>
                    <Button
                      className="review-control"
                      disabled={!ready || busy || saveState.status === "error" || !targets.length}
                      onClick={() => review("approved", true)}
                    >
                      Approve whole item ({targets.length}) <Kbd>Shift A</Kbd>
                    </Button>
                    <Button
                      className="review-control"
                      disabled={!ready || busy || saveState.status === "error" || !targets.length}
                      onClick={() => review("rejected", true)}
                    >
                      Reject whole item ({targets.length}) <Kbd>Shift X</Kbd>
                    </Button>
                  </div>
                  <details className="review-metadata">
                    <summary>Comparison details</summary>
                    <dl>
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
                  </details>
                </TabPanel>
              </TabProvider>
            </>
          ) : (
            <div className="review-empty">
              <h2>No comparison items</h2>
              <p>
                {model.reviewReady
                  ? "This run contains no review items."
                  : "Images will appear after the complete run is processed."}
              </p>
            </div>
          )}
        </main>
      </div>
      <footer className="review-footer">
        <div
          className="review-save-state"
          role={
            saveState.status === "error" || saveState.status === "conflict" ? "alert" : "status"
          }
        >
          {saveState.message || "Review commands are saved after server confirmation."}
          {!model.archived && saveState.status === "error" && saveState.failed && (
            <Button
              className="review-control"
              onClick={() => {
                if (saveState.failed) void save(saveState.failed);
              }}
            >
              Retry same command
            </Button>
          )}
          {!model.archived && saveState.status === "error" && saveState.failedUndo && (
            <Button className="review-control" onClick={() => void undo(saveState.failedUndo)}>
              Retry Undo
            </Button>
          )}
          {(saveState.status === "conflict" || saveState.status === "error") && (
            <Button className="review-control" onClick={() => void refresh()}>
              Refresh current state
            </Button>
          )}
        </div>
        <div className="review-footer-controls">
          <Button
            className="review-control"
            disabled={model.archived || !history.length || busy || saveState.status === "error"}
            onClick={() => void undo()}
          >
            Undo <Kbd>⌘/Ctrl Z</Kbd>
          </Button>
          <Button
            className="review-control"
            aria-pressed={shortcuts}
            onClick={() => setShortcuts((value) => !value)}
          >
            Shortcuts {shortcuts ? "on" : "off"}
          </Button>
          <ShortcutHelp />
          {commands.recompare && (
            <Button
              className="review-control"
              disabled={
                !recompareAllowed || busy || awaitingComparison || saveState.status === "error"
              }
              title={!recompareAllowed ? recompareDisabledReason : undefined}
              onClick={() => void recompare()}
            >
              Recompare stored run
            </Button>
          )}
          {commands.export && (
            <Button
              className="review-control"
              disabled={exportState.pending}
              onClick={() => void exportRun()}
            >
              Export run
            </Button>
          )}
        </div>
        {commands.recompare && !recompareAllowed && recompareDisabledReason && (
          <p>{recompareDisabledReason}</p>
        )}
        {exportState.message && <p role="status">{exportState.message}</p>}
      </footer>
      <p className="review-announcement" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </Frame>
  );
}
