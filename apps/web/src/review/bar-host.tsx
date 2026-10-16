// The decision bar of the review page. It gives the kit bar
// (`components/kit/bar/`) the review session: the decisions, the one text of
// the status line, and its recovery buttons. The frame gives it the review
// session and the selection, and it reads the keys of the decisions from
// `useBarHost`.

import * as ak from "@ariakit/react";
import { useRef, useState } from "react";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Layer } from "../components/ariakit/components/layer.ariakit.react.tsx";
import { ButtonLabel } from "../components/ariakit/components/button.ariakit.react.tsx";
import { ShellMainFull } from "../components/ariakit/components/shell.ariakit.react.tsx";
import { ReviewBar } from "../components/kit/bar/bar.tsx";
import type { BarView } from "../components/kit/bar/bar.tsx";
import { getBarMessage } from "../components/kit/bar/message.ts";
import type { BarAction, BarMessage } from "../components/kit/bar/message.ts";
import { ControlButton as Button } from "../components/control-button.tsx";
import type {
  ReviewItem,
  ReviewModel,
  ReviewSelection,
  ReviewVariant,
  ReviewVerdict,
} from "./model.ts";
import { reviewTargets } from "./navigation.ts";
import { ReviewStatus } from "./review-status.tsx";
import type { useReviewSession } from "./use-review-session.ts";

type ReviewSession = ReturnType<typeof useReviewSession>;

interface BatchReviewScope {
  comparisonId: string;
  selection: ReviewSelection;
  targetIds: string[];
}

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
  batchValid: boolean;
  openBatch(): void;
  closeBatch(): void;
  /** A decision for the variant, or for the whole screenshot. */
  review(verdict: ReviewVerdict, wholeItem?: boolean): void;
  reviewBatch(verdict: ReviewVerdict): void;
  /** The keys of the bar: a lowercase key gives its action. */
  keys: Partial<Record<string, (event: KeyboardEvent) => void>>;
  /** Cmd/Ctrl+Z. */
  undo(): void;
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

/**
 * The state of the bar: the decisions and the confirmation of a decision for
 * the whole screenshot. The frame calls it once, gives the result to
 * `BarHost`, and sends the keys of `keys`.
 * @example
 * const bar = useBarHost({ session, model, item, variant, selection, ready, onFocusPage });
 * <BarHost bar={bar} />
 */
function isSelection(selection: ReviewSelection, other: ReviewSelection | undefined) {
  if (!other) return false;
  return selection.itemKey === other.itemKey && selection.variantKey === other.variantKey;
}

export function useBarHost(params: UseBarHostParams): BarHostState {
  const { session, model, item, selection, ready } = params;
  const [batchScope, setBatchScope] = useState<BatchReviewScope | null>(null);
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
  const batchValid =
    batchScope !== null &&
    batchScope.comparisonId === model.comparisonId &&
    batchScope.selection.itemKey === selection.itemKey &&
    batchScope.selection.variantKey === selection.variantKey &&
    batchScope.targetIds.length === targets.length &&
    targets.every((target, index) => target.id === batchScope.targetIds[index]);
  if (batchScope && !batchValid) setBatchScope(null);
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
  const reviewBatch = (verdict: ReviewVerdict) => {
    if (!batchValid || !batchScope || !ready || session.reviewBlocked) return;
    session.review(verdict, batchScope.selection, true);
    setBatchScope(null);
  };
  return {
    ...params,
    targets,
    batchValid,
    openBatch: () =>
      setBatchScope({
        comparisonId: model.comparisonId,
        selection: { ...selection },
        targetIds: targets.map((target) => target.id),
      }),
    closeBatch: () => setBatchScope(null),
    review,
    reviewBatch,
    keys: {
      a: (event) => review("approved", event.shiftKey),
      x: (event) => review("rejected", event.shiftKey),
    },
    undo: () => void session.undo(),
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
 * Reject, Approve, and the `⋯` menu with the decision for the whole
 * screenshot. Its confirmation is a modal dialog.
 */
export function BarHost({ bar }: BarHostProps) {
  const { session, model, item, variant, ready, targets, batchValid } = bar;
  const { saveState, busy, reviewBlocked, canUndo } = session;
  const menuButton = useRef<HTMLButtonElement>(null);
  const blocked = !ready || reviewBlocked || saveState.status === "error";
  const selectedTarget = targets.some((entry) => entry.id === variant?.id);
  // A screenshot with one change has no decision for the whole screenshot.
  const wholeItem =
    targets.length > 1 && !model.archived
      ? { count: targets.length, disabled: blocked, onSelect: bar.openBatch }
      : null;
  return (
    <>
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
          menuButtonRef={menuButton}
          onActionDone={bar.onFocusPage}
        />
      </ShellMainFull>
      <ak.Dialog
        open={batchValid}
        onClose={bar.closeBatch}
        unmountOnHide
        // The menu item of the dialog is gone when the dialog closes.
        finalFocus={menuButton}
        // A failed save takes the bar over and removes the More button too:
        // the page then takes the focus.
        autoFocusOnHide={(element) => {
          if (element?.isConnected) return true;
          bar.onFocusPage();
          return false;
        }}
        render={<Frame $layer="canvas" $border $p={6} $rounded="2xl" />}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-auto text-sm"
        backdrop={<Layer $layer="canvas" className="fixed inset-0 z-40 bg-black/50!" />}
      >
        <ak.DialogHeading className="text-lg font-semibold">
          Review all changed views
        </ak.DialogHeading>
        <ak.DialogDescription className="text-sm ak-ink-60 mt-2">
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
            disabled={!batchValid || blocked || !targets.length}
            onClick={() => bar.reviewBatch("rejected")}
          >
            <ButtonLabel>Reject whole item ({targets.length})</ButtonLabel>
          </Button>
          <Button
            $layer="brand"
            disabled={!batchValid || blocked || !targets.length}
            onClick={() => bar.reviewBatch("approved")}
          >
            <ButtonLabel>Approve whole item ({targets.length})</ButtonLabel>
          </Button>
        </div>
      </ak.Dialog>
    </>
  );
}
