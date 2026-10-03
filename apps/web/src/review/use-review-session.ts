import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ReviewCommandError } from "./model.ts";
import type {
  ReviewCommand,
  ReviewCommands,
  ReviewModel,
  ReviewPollState,
  ReviewSaveResult,
  ReviewSelection,
  ReviewVerdict,
  UndoCommand,
} from "./model.ts";
import {
  applyPendingReviews,
  applySavedReview,
  latestReviewModel,
  nextPending,
  reviewTargets,
} from "./navigation.ts";

interface UseReviewSessionParams {
  model: ReviewModel;
  commands: ReviewCommands;
  onSelect(selection: ReviewSelection): void;
  onFocus(): void;
  onAnnounce(message: string): void;
  onRefresh(): void;
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

interface CommandSession {
  saving: boolean;
  queue: QueuedReview[];
  durableCommands: Set<string>;
}

interface SaveState {
  status: "idle" | "saving" | "error" | "conflict";
  message: string;
  failed?: ReviewCommand;
  failedUndo?: UndoCommand;
  durable?: boolean;
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

function pendingReviewModel(model: ReviewModel, commands: ReviewCommand[]) {
  const revisions = new Map(
    model.items.flatMap((item) => item.variants.map((variant) => [variant.id, variant.revision])),
  );
  // A confirmed verdict can be newer than a receipt that the browser still awaits.
  const pending = commands
    .filter((command) => command.comparisonId === model.comparisonId)
    .map((command) => ({
      ...command,
      targets: command.targets.filter(
        (target) => (revisions.get(target.id) ?? Infinity) <= target.expectedRevision,
      ),
    }));
  return applyPendingReviews(model, pending);
}

export function useReviewSession({
  model: suppliedModel,
  commands,
  onSelect,
  onFocus,
  onAnnounce,
  onRefresh,
}: UseReviewSessionParams) {
  const [previousModel, setPreviousModel] = useState(suppliedModel);
  const [savedModel, setModel] = useState(suppliedModel);
  const [pendingReviews, setPendingReviews] = useState<ReviewCommand[]>([]);
  const [queuedCommands, setQueuedCommands] = useState(new Set<string>());
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle", message: "" });
  const [history, setHistory] = useState<SavedCommand[]>([]);
  const [pendingComparison, setPendingComparison] = useState(false);
  const commandSession = useRef<CommandSession>({
    saving: false,
    queue: [],
    durableCommands: new Set(),
  });
  const model = useMemo(
    () => pendingReviewModel(savedModel, pendingReviews),
    [savedModel, pendingReviews],
  );
  const busy = saveState.status === "saving";
  const reviewBlocked = busy && !pendingReviews.length;
  const sendingCount = pendingReviews.filter(
    (command) => !queuedCommands.has(command.commandId),
  ).length;
  const queuedCount = pendingReviews.length - sendingCount;
  const terminalComparison = comparisonFailed(model);
  const awaitingComparison =
    pendingComparison ||
    model.comparisonState === "comparing" ||
    (!model.comparisonState &&
      !model.reviewReady &&
      ["incomplete", "comparing"].includes(model.run.status));
  const recompareAllowed = !model.archived && (model.recompareAllowed ?? true);

  if (previousModel !== suppliedModel) {
    setPreviousModel(suppliedModel);
    if (previousModel.comparisonId !== suppliedModel.comparisonId) {
      setModel(suppliedModel);
      setPendingReviews([]);
      setQueuedCommands(new Set());
      setHistory([]);
      setSaveState({ status: "idle", message: "" });
    } else {
      setModel(latestReviewModel(savedModel, suppliedModel));
    }
  }
  // Close old browser waits before new comparison actions can start. Server work continues.
  useLayoutEffect(() => {
    const session: CommandSession = { saving: false, queue: [], durableCommands: new Set() };
    commandSession.current = session;
    return () => {
      for (const entry of session.queue) {
        entry.controller?.abort();
      }
      session.queue = [];
    };
  }, [suppliedModel.comparisonId]);
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
      if (cancelled) return;
      if (finished) return;
      if (inFlight) return;
      if (document.visibilityState !== "visible") return;
      clearTimeout(timeout);
      timeout = setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (cancelled) return;
      if (finished) return;
      if (inFlight) return;
      if (document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const state = await commands.pollStatus();
        if (cancelled) return;
        if (document.visibilityState !== "visible") return;
        if (comparisonReady(state) || comparisonFailed(state)) {
          const current = await commands.refresh();
          if (cancelled) return;
          if (document.visibilityState !== "visible") return;
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
    const session = commandSession.current;
    if (session.saving && !session.queue.length) return;
    if (!session.queue.some((entry) => entry.command.commandId === command.commandId)) {
      session.queue.push({ command });
    }
    session.queue = session.queue.map((entry) => {
      if (entry.response) {
        return entry;
      }
      const controller = new AbortController();
      const response = commands
        .save(entry.command, {
          signal: controller.signal,
          onQueued: () => {
            session.durableCommands.add(entry.command.commandId);
            if (session !== commandSession.current) return;
            setQueuedCommands((previous) => new Set([...previous, entry.command.commandId]));
          },
        })
        .then(
          (result) => ({ result }),
          (error) => ({ error }),
        );
      return { ...entry, controller, response };
    });
    const queued = session.queue.map((entry) => entry.command);
    setPendingReviews(queued);
    setSaveState({
      status: "saving",
      message: `Saving ${queued.length} decision${queued.length === 1 ? "" : "s"}…`,
    });
    const optimisticModel = pendingReviewModel(savedModel, queued);
    const next = nextPending(optimisticModel.items, queued.at(-1)?.selection ?? command.selection);
    if (next) {
      onSelect(next);
    }
    onFocus();
    if (session.saving) return;
    session.saving = true;
    let currentModel = savedModel;
    try {
      while (session.queue.length) {
        const entry = session.queue[0];
        if (!entry) break;
        const currentCommand = entry.command;
        try {
          const response = await entry.response;
          if (!response) {
            throw new Error("The decision has not been submitted.");
          }
          if ("error" in response) {
            throw response.error;
          }
          const result = response.result;
          if (session.queue[0] !== entry) return;
          const confirmed = applySavedReview(currentModel, currentCommand, result);
          currentModel = confirmed;
          setModel((model) => latestReviewModel(model, confirmed));
          session.queue.shift();
          if (result.noop) {
            const discarded = session.queue.length;
            for (const pending of session.queue) {
              pending.controller?.abort();
            }
            session.queue = [];
            setPendingReviews([]);
            setSaveState({
              status: "idle",
              message: `This acceptance is already saved.${discarded ? " Later queued decisions were not saved. Review them again." : ""}`,
            });
            onSelect(currentCommand.selection);
            return;
          }
          setHistory((entries) => [
            ...entries,
            { id: result.commandId, selection: currentCommand.selection },
          ]);
          const remaining = session.queue.map((entry) => entry.command);
          setPendingReviews(remaining);
          setSaveState({
            status: remaining.length ? "saving" : "idle",
            message: remaining.length
              ? `Saving ${remaining.length} decision${remaining.length === 1 ? "" : "s"}…`
              : `${currentCommand.targets.length} variant${currentCommand.targets.length === 1 ? "" : "s"} ${currentCommand.verdict}. Saved.`,
          });
          if (!remaining.length && !nextPending(currentModel.items, currentCommand.selection)) {
            onAnnounce("Review complete. No variants need review.");
          }
        } catch (error) {
          if (session.queue[0] !== entry) return;
          setPendingReviews([]);
          onSelect(currentCommand.selection);
          const conflict = error instanceof ReviewCommandError && error.conflict;
          const discarded = conflict && session.queue.length > 1;
          for (const pending of session.queue) {
            pending.controller?.abort();
          }
          session.queue = conflict ? [] : session.queue.map(({ command }) => ({ command }));
          reportError(error, currentCommand);
          if (session.durableCommands.has(currentCommand.commandId) && !conflict) {
            setSaveState((state) => ({
              ...state,
              durable: session.queue.every((entry) =>
                session.durableCommands.has(entry.command.commandId),
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
      session.saving = false;
    }
  };
  const review = (verdict: ReviewVerdict, selection: ReviewSelection, wholeItem = false) => {
    const item = model.items.find((entry) => entry.key === selection.itemKey);
    const variant = item?.variants.find((entry) => entry.key === selection.variantKey);
    if (!item) return;
    if (!variant) return;
    if (reviewBlocked) return;
    const targets = reviewTargets(item);
    if (saveState.status === "error") {
      onAnnounce("Resolve the unsaved command before saving another review.");
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
      onAnnounce(
        `${reason} No variants were changed.${wholeItem ? " Select an eligible variant and review it individually." : ""}`,
      );
      return;
    }
    void save({
      commandId: crypto.randomUUID(),
      previousCommandId: commandSession.current.queue.at(-1)?.command.commandId,
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
    const session = commandSession.current;
    const latest = history.at(-1);
    if (!latest) return;
    if (session.saving) return;
    if (saveState.status === "error" && !retryCommand) return;
    const command = retryCommand ?? {
      commandId: latest.id,
      undoCommandId: crypto.randomUUID(),
      expectedBaselineRevision: model.baselineRevision,
    };
    session.saving = true;
    setSaveState({ status: "saving", message: "Saving Undo…" });
    try {
      const result = await commands.undo(command);
      if (session !== commandSession.current) return;
      // Undo replaces its starting snapshot without replacing newer route evidence.
      setModel((current) =>
        current === savedModel ? result.model : latestReviewModel(current, result.model),
      );
      setHistory((entries) => entries.slice(0, -1));
      onSelect(result.selection);
      setSaveState({
        status: "idle",
        message: "Undo saved. The original selection and verdicts were restored.",
      });
      onFocus();
    } catch (error) {
      if (session !== commandSession.current) return;
      if (error instanceof ReviewCommandError && error.conflict) {
        setHistory((entries) => entries.filter((entry) => entry.id !== command.commandId));
      }
      reportError(error, undefined, command);
    } finally {
      session.saving = false;
    }
  };
  const refresh = async () => {
    const session = commandSession.current;
    if (session.saving) return;
    for (const pending of session.queue) {
      pending.controller?.abort();
    }
    session.queue = [];
    setPendingReviews([]);
    session.saving = true;
    setSaveState({ status: "saving", message: "Refreshing the current comparison…" });
    try {
      const current = await commands.refresh();
      if (session !== commandSession.current) return;
      setModel((model) => latestReviewModel(model, current));
      onRefresh();
      setSaveState({
        status: "idle",
        message: "Current state loaded. Check the evidence before saving a new command.",
      });
    } catch (error) {
      if (session !== commandSession.current) return;
      reportError(error);
    } finally {
      session.saving = false;
    }
  };
  const recompare = async () => {
    const session = commandSession.current;
    if (!recompareAllowed) return;
    if (awaitingComparison) return;
    if (!commands.recompare) return;
    if (session.saving) return;
    if (saveState.status === "error") return;
    session.saving = true;
    setSaveState({ status: "saving", message: "Creating a new comparison from stored captures…" });
    try {
      const next = await commands.recompare();
      if (session !== commandSession.current) return;
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
      if (session !== commandSession.current) return;
      reportError(error);
    } finally {
      session.saving = false;
    }
  };

  return {
    model,
    pendingReviews,
    saveState,
    busy,
    reviewBlocked,
    sendingCount,
    queuedCount,
    canUndo: history.length > 0,
    pendingComparison,
    awaitingComparison,
    terminalComparison,
    runStatus: runStatusLabel(model.run.status),
    save,
    review,
    undo,
    refresh,
    recompare,
  };
}
