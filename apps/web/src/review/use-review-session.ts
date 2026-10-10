import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAppSession } from "../app-session.tsx";
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
  decisionConflict,
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
  /** The saves, the Undos, and the manual reads that the session started. */
  started: number;
}

interface SaveState {
  status: "idle" | "saving" | "error" | "conflict";
  message: string;
  failed?: ReviewCommand;
  failedUndo?: UndoCommand;
}

/** The text of the decision bar while a decision has no final receipt. */
const savingMessage = "Saving…";
const stillQueuedMessage = `${savingMessage} Still queued after 30 seconds.`;
const stillQueuedMilliseconds = 30_000;

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
  // The oldest decision with no receipt, when it waited 30 seconds.
  const [stillQueued, setStillQueued] = useState<string>();
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle", message: "" });
  const [history, setHistory] = useState<SavedCommand[]>([]);
  const [pendingComparison, setPendingComparison] = useState(false);
  const commandSession = useRef<CommandSession>({
    saving: false,
    queue: [],
    durableCommands: new Set(),
    started: 0,
  });
  const model = useMemo(
    () => pendingReviewModel(savedModel, pendingReviews),
    [savedModel, pendingReviews],
  );
  const busy = saveState.status === "saving";
  const reviewBlocked = busy && !pendingReviews.length;
  const oldestPending = pendingReviews[0]?.commandId;
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
      setHistory([]);
      setSaveState({ status: "idle", message: "" });
    } else {
      setModel(latestReviewModel(savedModel, suppliedModel));
    }
  }
  // Close old browser waits before new comparison actions can start. Server work continues.
  useLayoutEffect(() => {
    const session: CommandSession = {
      saving: false,
      queue: [],
      durableCommands: new Set(),
      started: 0,
    };
    commandSession.current = session;
    return () => {
      for (const entry of session.queue) {
        entry.controller?.abort();
      }
      session.queue = [];
    };
  }, [suppliedModel.comparisonId]);
  // True until the receipt of each decision is final. The browser then asks
  // before it leaves the page. A decision that the service queued also counts:
  // the page cannot show its result after it closes.
  const unsentDecisions = saveState.status === "saving" || saveState.status === "error";
  useEffect(() => {
    if (!oldestPending) return;
    const timeout = setTimeout(() => setStillQueued(oldestPending), stillQueuedMilliseconds);
    return () => {
      clearTimeout(timeout);
      // A retry of the same command starts with the short text again.
      setStillQueued(undefined);
    };
  }, [oldestPending]);
  useEffect(() => {
    if (!unsentDecisions) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsentDecisions]);
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
  const { deny } = useAppSession();
  const returnReadInFlight = useRef(false);
  // One read of the small state when the tab becomes visible. The page reads
  // the run model only when the state differs from the model that it holds.
  const readStateOnReturn = useEffectEvent(async () => {
    const session = commandSession.current;
    // The receipt of a decision brings the newer state of the run.
    if (session.saving) return;
    // A command that waits for a retry keeps the page with its buttons. Its
    // retry shows the state of the service.
    if (saveState.status === "error") return;
    if (returnReadInFlight.current) return;
    returnReadInFlight.current = true;
    // True when a save, an Undo, or a manual read started during this read.
    // Its answer brings the newer state, or its failure waits for a retry.
    const started = session.started;
    const superseded = () => session !== commandSession.current || session.started !== started;
    try {
      const state = await commands.pollStatus();
      if (superseded()) return;
      if (document.visibilityState !== "visible") return;
      const unchanged =
        state.comparisonRevision === savedModel.comparisonRevision &&
        state.run.status === savedModel.run.status;
      if (unchanged) return;
      const current = await commands.refresh();
      if (superseded()) return;
      setModel((model) => latestReviewModel(model, current));
      if (!runStopped(current.run.status)) return;
      // A conflict keeps its text and its button.
      setSaveState((saved) =>
        saved.status === "idle"
          ? { status: "idle", message: current.run.error ?? runStatusLabel(current.run.status) }
          : saved,
      );
    } catch (error) {
      if (superseded()) return;
      if (!(error instanceof ReviewCommandError)) return;
      // The session ended in another tab, or the account lost its access. The
      // layout route shows the sign-in page or the no access page. Each other
      // failure keeps the page, and the next return reads again.
      if (error.status === 401 || error.status === 403) {
        deny(error.status);
      }
    } finally {
      returnReadInFlight.current = false;
    }
  });
  useEffect(() => {
    // The poll of a comparison that is not ready reads the state on a return.
    if (awaitingComparison) return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void readStateOnReturn();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [awaitingComparison]);

  const reportError = (error: unknown, failed?: ReviewCommand, failedUndo?: UndoCommand) => {
    const namedConflict =
      failed && error instanceof ReviewCommandError && error.code === "conflict" && error.model
        ? decisionConflict(error.model, failed)
        : null;
    const message =
      namedConflict ??
      (error instanceof Error
        ? error.message
        : "The command could not be saved. Check your connection.");
    if (error instanceof ReviewCommandError && error.model) {
      const currentModel = error.model;
      setModel((model) => latestReviewModel(model, currentModel));
    }
    const conflict = error instanceof ReviewCommandError && error.conflict;
    setSaveState({
      status: conflict ? "conflict" : "error",
      message: `${conflict ? "Conflict. " : "Not saved. "}${message}`,
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
    setSaveState({ status: "saving", message: savingMessage });
    const optimisticModel = pendingReviewModel(savedModel, queued);
    const next = nextPending(optimisticModel.items, queued.at(-1)?.selection ?? command.selection);
    if (next) {
      onSelect(next);
    }
    onFocus();
    if (session.saving) return;
    session.saving = true;
    session.started += 1;
    let currentModel = savedModel;
    // The newest run revision that a receipt of this loop named.
    let newestRunRevision = 0;
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
          newestRunRevision = Math.max(newestRunRevision, result.currentRunRevision ?? 0);
          const applied = applySavedReview(currentModel, currentCommand, result);
          // A later decision of this page explains a newer run revision. The
          // receipt of the last decision must be the newest state of the run
          // that a receipt of this loop named: the receipt reads can end in
          // another order than the decisions.
          const current = session.queue.length > 1 || newestRunRevision === result.runRevision;
          const confirmed = applied && current ? applied : await commands.refresh();
          if (session.queue[0] !== entry) return;
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
              ? savingMessage
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
              message: `Could not confirm the queued decisions. The server will continue processing them. Retry to check their status.${error instanceof ReviewCommandError && error.reference ? ` Reference: ${error.reference}.` : ""}`,
            }));
          }
          if (discarded) {
            setSaveState((state) => ({
              ...state,
              message: `${state.message} Later queued decisions were not saved. Review them again.`,
            }));
          }
          const conflictModel = error instanceof ReviewCommandError ? error.model : undefined;
          if (conflict && (conflictModel ?? currentModel).comparisonRevision < newestRunRevision) {
            // A receipt before this conflict named a newer run than the state
            // of the conflict. The alert stays, and it has the manual read.
            void commands.refresh().then(
              (current) => {
                if (session !== commandSession.current) return;
                setModel((model) => latestReviewModel(model, current));
              },
              () => {},
            );
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
    // The selected variant can be an unchanged one, which this model does not
    // have. A decision for the whole item does not need it.
    if (!variant && !wholeItem) return;
    if (reviewBlocked) return;
    const targets = reviewTargets(item);
    if (saveState.status === "error") {
      onAnnounce("Resolve the unsaved command before saving another review.");
      return;
    }
    const selectedTargets = wholeItem
      ? targets
      : targets.filter((entry) => entry.id === variant?.id);
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
      selection: { itemKey: item.key, variantKey: selection.variantKey },
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
    session.started += 1;
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
    session.started += 1;
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
    session.started += 1;
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
    saveState:
      busy && oldestPending && oldestPending === stillQueued
        ? { ...saveState, message: stillQueuedMessage }
        : saveState,
    busy,
    reviewBlocked,
    canUndo: history.length > 0,
    pendingComparison,
    awaitingComparison,
    terminalComparison,
    unsentDecisions,
    runStatus: runStatusLabel(model.run.status),
    save,
    review,
    undo,
    refresh,
    recompare,
  };
}
