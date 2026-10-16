// The decision bar of the review page. It gives the kit bar
// (`components/kit/bar/`) the review session: the decisions, the one text of
// the status line, and its recovery buttons. The frame gives it the review
// session and the selection, and it reads the keys of the decisions from
// `useBarHost`.

import { useEffect, useRef, useState } from "react";
import { ShellMainFull } from "../components/ariakit/components/shell.ariakit.react.tsx";
import { ReviewBar } from "../components/kit/bar/bar.tsx";
import type { BarView } from "../components/kit/bar/bar.tsx";
import { getBarMessage } from "../components/kit/bar/message.ts";
import type { BarAction, BarMessage } from "../components/kit/bar/message.ts";
import type { RunApprovalCounts } from "../components/kit/bar/run-approval.tsx";
import type {
  ReviewItem,
  ReviewModel,
  ReviewSelection,
  ReviewVariant,
  ReviewVerdict,
} from "./model.ts";
import { reviewTargets, runApprovalTargets } from "./navigation.ts";
import type { useReviewSession } from "./use-review-session.ts";

type ReviewSession = ReturnType<typeof useReviewSession>;

export interface UseBarHostParams {
  session: ReviewSession;
  /** The run model of the session, with the loaded unchanged screenshots. */
  model: ReviewModel;
  /** The screenshot on the stage. */
  item: ReviewItem | undefined;
  /** The variant on the stage. */
  variant: ReviewVariant | undefined;
  selection: ReviewSelection;
  /**
   * True when the run takes decisions and each image of the stage is on
   * screen. A decision waits for it.
   */
  ready: boolean;
  /** Moves the focus to the review page, after a recovery button. */
  onFocusPage(): void;
  /** The view controls of the stage. Null for a stage with no images. */
  view: BarView | null;
}

export interface BarHostState extends UseBarHostParams {
  /** The changed variants of the screenshot: the targets of a whole decision. */
  targets: ReviewVariant[];
  /**
   * A decision for the variant, or for the whole screenshot. It saves at once
   * on the key and on the button: Undo reverses it.
   */
  review(verdict: ReviewVerdict, wholeItem?: boolean): void;
  /** The keys of the bar: a lowercase key gives its action. */
  keys: Partial<Record<string, (event: KeyboardEvent) => void>>;
  /** Cmd/Ctrl+Z. */
  undo(): void;
  /** The numbers of the confirmation of a run approval. */
  getRunApprovalCounts(): RunApprovalCounts;
}

interface Refusal {
  text: string;
  waitsForImages?: boolean;
}

/**
 * The reason that a decision waits, as the text of the status line, or
 * undefined when the decision can save.
 */
function getRefusal({ session, model, ready }: UseBarHostParams): Refusal | undefined {
  // A failed save is the first reason: the session says to resolve it.
  if (session.saveState.status === "error") return undefined;
  if (model.archived) return { text: "Nothing changed. This run is read-only." };
  if (!ready && (session.terminalComparison || !model.reviewReady)) {
    return { text: "Nothing changed. Review is unavailable for this run now." };
  }
  if (!ready) {
    return { text: "Nothing changed. The images are not on screen yet.", waitsForImages: true };
  }
  if (session.reviewBlocked) {
    return { text: "Nothing changed. Wait for the current command to finish." };
  }
  return undefined;
}

function isSelection(selection: ReviewSelection, other: ReviewSelection | undefined) {
  if (!other) return false;
  return selection.itemKey === other.itemKey && selection.variantKey === other.variantKey;
}

/**
 * The state of the bar: the decisions for the variant and for the whole
 * screenshot. The frame calls it once, gives the result to `BarHost`, and
 * sends the keys of `keys`.
 * @example
 * const bar = useBarHost({ session, model, item, variant, selection, ready, onFocusPage });
 * <BarHost bar={bar} />
 */
export function useBarHost(params: UseBarHostParams): BarHostState {
  const { session, model, item, variant, selection, ready } = params;
  // The variants that were the selected variant with their images on screen
  // in this page. The confirmation of a run approval names the changes that
  // are not in it. A reload empties it: the number informs, it is no gate.
  const opened = useRef(new Set<string>());
  const variantId = variant?.id;
  useEffect(() => {
    if (!ready) return;
    if (!variantId) return;
    opened.current.add(variantId);
  }, [ready, variantId]);
  // A notice for one selection ends when the page leaves that selection, so
  // it does not come back after a return. A notice can name the next
  // selection before the page shows it (the remembered variant of a routed
  // page), so only a move away from its own selection ends it.
  const [previousSelection, setPreviousSelection] = useState(selection);
  if (!isSelection(selection, previousSelection)) {
    setPreviousSelection(selection);
    if (isSelection(previousSelection, session.notice?.selection)) {
      session.clearNotice();
    }
  }
  const targets = item ? reviewTargets(item) : [];
  const review = (verdict: ReviewVerdict, wholeItem = false) => {
    // A refused key prints its reason in the status line.
    const refusal = getRefusal(params);
    if (refusal) {
      session.announce(refusal.text, "warning", {
        selection,
        waitsForImages: refusal.waitsForImages,
      });
      return;
    }
    session.review(verdict, selection, wholeItem);
  };
  return {
    ...params,
    targets,
    review,
    keys: {
      a: (event) => review("approved", event.shiftKey),
      x: (event) => review("rejected", event.shiftKey),
    },
    undo: () => void session.undo(),
    getRunApprovalCounts: () => {
      const changes = runApprovalTargets(model.items);
      const rejected = model.items
        .flatMap(reviewTargets)
        .filter((entry) => entry.verdict === "rejected");
      return {
        changes: changes.length,
        unopened: changes.filter((entry) => !opened.current.has(entry.id)).length,
        rejected: rejected.length,
      };
    },
  };
}

/** The recovery buttons of the save state. */
function getRecoveryActions(session: ReviewSession, model: ReviewModel): BarAction[] {
  const { saveState, save, undo, refresh } = session;
  const actions: BarAction[] = [];
  const { failed, failedUndo } = saveState;
  if (!model.archived && saveState.status === "error" && failed) {
    actions.push({ label: "Retry same command", primary: true, onClick: () => void save(failed) });
  }
  if (!model.archived && saveState.status === "error" && failedUndo) {
    actions.push({ label: "Retry Undo", primary: true, onClick: () => void undo(failedUndo) });
  }
  if (saveState.link === "sign-in") {
    // The sign-in opens in a new tab: this page holds the decision, and a
    // sign-in in this tab loads a new document.
    actions.push({ label: "Sign in again", href: "/", newTab: true });
  }
  if (saveState.link === "queue") {
    actions.push({ label: "Go to the Queue", href: "/" });
  }
  if (saveState.status === "conflict" || saveState.status === "error") {
    actions.push({ label: "Refresh current state", onClick: () => void refresh() });
  }
  return actions;
}

/**
 * The notice while it is true: a notice for a selection hides after a move to
 * another variant, and a notice about images hides when they are on screen.
 */
function getShownNotice({ session, selection, ready }: BarHostState) {
  const { notice } = session;
  if (!notice) return null;
  if (notice.selection && !isSelection(selection, notice.selection)) return null;
  if (notice.waitsForImages && ready) return null;
  return notice;
}

/**
 * The one text of the status line: the newest of the notice of the page and
 * the save state. A save state replaces the notice. A save state with
 * recovery buttons waits for the reviewer, so a notice comes after its text
 * and does not hide it.
 */
function getStatusMessage(bar: BarHostState): BarMessage | null {
  const { session, model } = bar;
  const { saveState } = session;
  const notice = getShownNotice(bar);
  const actions = getRecoveryActions(session, model);
  if (notice && !actions.length) return getBarMessage({ ...notice, actions });
  const { status } = saveState;
  const tone =
    status === "error"
      ? "danger"
      : status === "conflict"
        ? "warning"
        : status === "saving"
          ? "saving"
          : saveState.saved
            ? "success"
            : "neutral";
  return getBarMessage({
    text: notice ? `${saveState.message} ${notice.text}` : saveState.message,
    tone,
    urgent: status === "error" || status === "conflict",
    actions,
  });
}

export interface BarHostProps {
  bar: BarHostState;
}

/** The id of the decision bar, the target of the skip link of the page. */
export const reviewActionsId = "review-actions";

/**
 * The decision bar: Undo, the view controls of the stage, the status line,
 * Reject, Approve, and the `⋯` menu with the decisions for the whole
 * screenshot.
 */
export function BarHost({ bar }: BarHostProps) {
  const { session, model, variant, ready, targets } = bar;
  const { saveState, busy, reviewBlocked, canUndo } = session;
  const blocked = !ready || reviewBlocked || saveState.status === "error";
  const selectedTarget = targets.some((entry) => entry.id === variant?.id);
  // A screenshot with one change has no decision for the whole screenshot.
  const wholeItem =
    targets.length > 1 && !model.archived
      ? {
          count: targets.length,
          disabled: blocked,
          onApprove: () => bar.review("approved", true),
          onReject: () => bar.review("rejected", true),
        }
      : null;
  // The run approval waits for no image. It waits for each save, because each
  // queued decision changes the run revision that it names.
  const runApproval = model.archived
    ? null
    : {
        disabled:
          busy ||
          saveState.status === "error" ||
          !model.reviewReady ||
          session.terminalComparison ||
          !runApprovalTargets(model.items).length,
        getCounts: bar.getRunApprovalCounts,
        onApprove: () => session.approveRun(bar.selection),
      };
  return (
    <ShellMainFull className="sticky bottom-0 z-20 pointer-events-none">
      <ReviewBar
        id={reviewActionsId}
        message={getStatusMessage(bar)}
        view={bar.view}
        undo={{
          disabled: model.archived || !canUndo || busy || saveState.status === "error",
          onClick: () => void session.undo(),
        }}
        reject={{
          disabled: blocked || !selectedTarget || !!variant?.rejectDisabledReason,
          reason: variant?.rejectDisabledReason,
          onClick: () => bar.review("rejected"),
        }}
        approve={{
          disabled: blocked || !selectedTarget || !!variant?.approveDisabledReason,
          reason: variant?.approveDisabledReason,
          onClick: () => bar.review("approved"),
        }}
        wholeItem={wholeItem}
        runApproval={runApproval}
        onActionDone={bar.onFocusPage}
      />
    </ShellMainFull>
  );
}
