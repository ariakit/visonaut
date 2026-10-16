import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RunClosedReason } from "@visonaut/protocol";
import { useAppSession } from "../app-session.tsx";
import { ReviewCommandError } from "./model.ts";
import { getClosedWords } from "./run-words.ts";
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
  onRefresh(): void;
  /**
   * The keys of the screenshots that the list shows, in its order. The
   * advance after a decision goes to the next variant to review among them.
   */
  getOrder?(): readonly string[];
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
  /** The admitted commands of a review session that ended. They have no Undo. */
  endedCommands: Set<string>;
  /** The saves, the Undos, and the manual reads that the session started. */
  started: number;
  /**
   * True from a failed save or a conflict until the next save state, also
   * before React commits that state. A return read must not start then.
   */
  failed: boolean;
}

function newCommandSession(): CommandSession {
  return {
    saving: false,
    queue: [],
    durableCommands: new Set(),
    endedCommands: new Set(),
    started: 0,
    failed: false,
  };
}

interface SaveState {
  status: "idle" | "saving" | "error" | "conflict";
  message: string;
  /** A final receipt: the message is a success. */
  saved?: boolean;
  failed?: ReviewCommand;
  failedUndo?: UndoCommand;
  /** The link of the decision bar: the sign-in in a new tab, or the review queue. */
  link?: "sign-in" | "queue";
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

/**
 * A text of the status line that is not a save state: a refusal, the
 * remembered variant that a screenshot no longer has, or the end of a review.
 * The next save state replaces it.
 */
export interface ReviewNotice {
  text: string;
  tone: "neutral" | "success" | "warning";
  /** The notice is true only for this selection, and the bar hides it after. */
  selection?: ReviewSelection;
  /**
   * The notice is about images that are not on screen: the bar hides it when
   * they are.
   */
  waitsForImages?: boolean;
}

const closedRunMessages: Record<RunClosedReason, string> = {
  replaced: "A newer run replaced this run.",
  "pull-request-closed": "The pull request of this run closed.",
  "merge-group-destroyed": "The merge queue removed this run.",
  "baseline-retired": "The baseline of this run was retired.",
  expired: "This run expired.",
};

/**
 * The text of the decision bar for a closed run: the stored reason, or a
 * sentence with no cause for a run that closed before the service stored one.
 */
function closedRunMessage(run: ReviewModel["run"]) {
  if (run.closedReason) return closedRunMessages[run.closedReason];
  return "This run is no longer active.";
}

const signedOutMessage = "Your session ended. Sign in again, and then retry.";

/** The state of the decision bar for a run that stopped, with no save. */
function stoppedRunState(model: ReviewModel): SaveState {
  if (model.run.error) {
    return { status: "idle", message: model.run.error };
  }
  if (model.run.status !== "superseded") {
    return { status: "idle", message: runStatusLabel(model.run.status) };
  }
  return { status: "idle", message: closedRunMessage(model.run), link: "queue" };
}

/**
 * The sentence of a failure that comes from the session and not from the
 * decision: the session ended, or the review session cannot continue. The
 * page then holds the decision.
 */
function sessionFailure(error: unknown) {
  if (!(error instanceof ReviewCommandError)) return;
  if (error.status === 401) {
    return signedOutMessage;
  }
  if (error.code === "review_session_expired" || error.code === "reviewer_changed") {
    return error.message;
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
  onRefresh,
  getOrder,
}: UseReviewSessionParams) {
  const [previousModel, setPreviousModel] = useState(suppliedModel);
  const [savedModel, setModel] = useState(suppliedModel);
  const [pendingReviews, setPendingReviews] = useState<ReviewCommand[]>([]);
  // The oldest decision with no receipt, when it waited 30 seconds.
  const [stillQueued, setStillQueued] = useState<string>();
  const [saveState, storeSaveState] = useState<SaveState>({ status: "idle", message: "" });
  const [notice, setNotice] = useState<ReviewNotice | null>(null);
  const [history, setHistory] = useState<SavedCommand[]>([]);
  const commandSession = useRef(newCommandSession());
  // Each save state replaces the notice: the status line shows the newest text.
  const setSaveState = (next: SaveState | ((state: SaveState) => SaveState)) => {
    // An update function keeps the status: it changes the text only.
    if (typeof next !== "function") {
      commandSession.current.failed = next.status === "error" || next.status === "conflict";
    }
    setNotice(null);
    storeSaveState(next);
  };
  const announce = (
    text: string,
    tone: ReviewNotice["tone"] = "neutral",
    scope?: Pick<ReviewNotice, "selection" | "waitsForImages">,
  ) => {
    setNotice({ text, tone, ...scope });
  };
  const model = useMemo(
    () => pendingReviewModel(savedModel, pendingReviews),
    [savedModel, pendingReviews],
  );
  const busy = saveState.status === "saving";
  const reviewBlocked = busy && !pendingReviews.length;
  const oldestPending = pendingReviews[0]?.commandId;
  const terminalComparison = comparisonFailed(model);
  const awaitingComparison =
    model.comparisonState === "comparing" ||
    (!model.comparisonState &&
      !model.reviewReady &&
      ["incomplete", "comparing"].includes(model.run.status));

  if (previousModel !== suppliedModel) {
    setPreviousModel(suppliedModel);
    if (previousModel.comparisonId !== suppliedModel.comparisonId) {
      setModel(suppliedModel);
      setPendingReviews([]);
      setHistory([]);
      // The layout effect below starts a new command session with no failure.
      setNotice(null);
      storeSaveState({ status: "idle", message: "" });
    } else {
      setModel(latestReviewModel(savedModel, suppliedModel));
    }
  }
  // Close old browser waits before new comparison actions can start. Server work continues.
  useLayoutEffect(() => {
    const session = newCommandSession();
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
            setSaveState(
              comparisonReady(current)
                ? { status: "idle", message: "The new comparison is ready." }
                : stoppedRunState(current),
            );
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
    // retry shows the state of the service. A conflict keeps its text and its
    // buttons too, so a 401 of this read does not replace them with the
    // sign-in page. The command session has a failure that React did not
    // commit yet.
    if (session.failed) return;
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
      setSaveState((saved) => (saved.status === "idle" ? stoppedRunState(current) : saved));
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
    const failure = error instanceof ReviewCommandError ? error : undefined;
    const currentModel = failure?.model;
    const namedConflict =
      failed && failure?.code === "conflict" && currentModel
        ? decisionConflict(currentModel, failed)
        : null;
    const message =
      namedConflict ??
      sessionFailure(error) ??
      (error instanceof Error
        ? error.message
        : "The command could not be saved. Check your connection.");
    if (currentModel) {
      setModel((model) => latestReviewModel(model, currentModel));
    }
    const conflict = failure?.conflict ?? false;
    if (conflict && currentModel?.run.status === "superseded") {
      setSaveState({
        status: "conflict",
        message: `Not saved. ${closedRunMessage(currentModel.run)}`,
        link: "queue",
      });
      return;
    }
    // A decision that failed each attempt is not a conflict with another
    // decision. It has the state of a conflict: the same command cannot run again.
    const refused = conflict && failure?.code !== "decision_failed";
    setSaveState({
      status: conflict ? "conflict" : "error",
      message: `${refused ? "Conflict. " : "Not saved. "}${message}`,
      failed: conflict ? undefined : failed,
      failedUndo: conflict ? undefined : failedUndo,
      link: failure?.status === 401 ? "sign-in" : undefined,
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
          onSessionRenewed: () => {
            // An Undo needs the review session of its command. The commands
            // that the service admitted before this moment have the ended one.
            session.endedCommands = new Set(session.durableCommands);
            setHistory([]);
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
    const next = nextPending(
      optimisticModel.items,
      queued.at(-1)?.selection ?? command.selection,
      getOrder?.(),
    );
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
          if (!session.endedCommands.has(result.commandId)) {
            setHistory((entries) => [
              ...entries,
              { id: result.commandId, selection: currentCommand.selection },
            ]);
          }
          const remaining = session.queue.map((entry) => entry.command);
          setPendingReviews(remaining);
          setSaveState(
            remaining.length
              ? { status: "saving", message: savingMessage }
              : {
                  status: "idle",
                  saved: true,
                  message: `Saved. ${currentCommand.targets.length} variant${currentCommand.targets.length === 1 ? "" : "s"} ${currentCommand.verdict}.`,
                },
          );
          if (!remaining.length && !nextPending(currentModel.items, currentCommand.selection)) {
            announce("Review complete. No variants need review.", "success");
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
            const cause = sessionFailure(error);
            setSaveState((state) => ({
              ...state,
              message: cause
                ? `Not confirmed. ${cause}`
                : `Could not confirm the queued decisions. The server will continue processing them. Retry to check their status.${error instanceof ReviewCommandError && error.reference ? ` Reference: ${error.reference}.` : ""}`,
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
    const refuseUnchanged = () =>
      announce(
        wholeItem
          ? "Nothing changed. This screenshot has no change to review."
          : "Nothing changed. This variant has no change to review.",
        "warning",
        { selection },
      );
    // The selected variant can be an unchanged one, which this model does not
    // have. A decision for the whole item does not need it.
    if (!variant && !wholeItem) {
      refuseUnchanged();
      return;
    }
    if (reviewBlocked) return;
    const targets = reviewTargets(item);
    if (saveState.status === "error") {
      announce("Resolve the unsaved command before saving another review.", "warning");
      return;
    }
    const selectedTargets = wholeItem
      ? targets
      : targets.filter((entry) => entry.id === variant?.id);
    if (!selectedTargets.length) {
      refuseUnchanged();
      return;
    }
    const protectedTarget = selectedTargets.find((entry) =>
      verdict === "approved" ? entry.approveDisabledReason : entry.rejectDisabledReason,
    );
    if (protectedTarget) {
      const reason =
        verdict === "approved"
          ? protectedTarget.approveDisabledReason
          : protectedTarget.rejectDisabledReason;
      announce(
        `${reason} No variants were changed.${wholeItem ? " Select an eligible variant and review it individually." : ""}`,
        "warning",
        { selection },
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
        saved: true,
        message: "Undo saved. The original selection and verdicts were restored.",
      });
      onFocus();
    } catch (error) {
      if (session !== commandSession.current) return;
      if (error instanceof ReviewCommandError && error.code === "review_session_expired") {
        // An Undo needs the review session of its command, and that session
        // ended. No retry can undo a command of this history.
        setHistory([]);
        setSaveState({
          status: "conflict",
          message:
            "Not undone. Your review session ended. This page cannot undo the decisions of that session.",
        });
        return;
      }
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
    // The held commands leave the queue for the time of the read, so that no
    // save can start during it. A read that fails puts them back, with the
    // command that waits for a retry.
    const held = session.queue;
    const { failed, failedUndo } = saveState;
    for (const pending of held) {
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
      session.queue = held.map(({ command }) => ({ command }));
      reportError(error, failed, failedUndo);
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
    awaitingComparison,
    terminalComparison,
    unsentDecisions,
    // A closed run has the words of the header: its stored cause, or no cause.
    runStatus: getClosedWords(model.run) ?? runStatusLabel(model.run.status),
    notice,
    announce,
    clearNotice: () => setNotice(null),
    save,
    review,
    undo,
    refresh,
  };
}
