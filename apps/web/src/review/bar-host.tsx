// The decision bar of the review page. It hosts the decision controls of
// today with the texts and the states of #268. The frame gives it the review
// session and the selection, and it reads the keys of the decisions from
// `useBarHost`. The bar of #275 replaces this file only.

import * as ak from "@ariakit/react";
import { Check, ChevronDown, Undo2, X } from "lucide-react";
import { useState } from "react";
import {
  ButtonGroup,
  ButtonLabel,
  ButtonSlot,
} from "../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Layer } from "../components/ariakit/components/layer.ariakit.react.tsx";
import { ShellMainFull } from "../components/ariakit/components/shell.ariakit.react.tsx";
import { useShortcuts } from "../components/kit/keys.tsx";
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

/**
 * The state of the bar: the decisions and the confirmation of a decision for
 * the whole screenshot. The frame calls it once, gives the result to
 * `BarHost`, and sends the keys of `keys`.
 * @example
 * const bar = useBarHost({ session, model, item, variant, selection, ready });
 * <BarHost bar={bar} />
 */
export function useBarHost(params: UseBarHostParams): BarHostState {
  const { session, model, item, selection, ready } = params;
  const [batchScope, setBatchScope] = useState<BatchReviewScope | null>(null);
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
    if (!ready) return;
    if (session.reviewBlocked) return;
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

export interface BarHostProps {
  bar: BarHostState;
}

/**
 * The decision controls of today: Undo, the decision for all changed views,
 * Reject, Approve, and the save state with its links. The confirmation of a
 * decision for the whole screenshot is a modal dialog.
 */
/** The id of the decision bar, the target of the skip link of the page. */
export const reviewActionsId = "review-actions";

export function BarHost({ bar }: BarHostProps) {
  const { session, model, item, variant, ready, targets, batchValid } = bar;
  const { saveState, busy, reviewBlocked, canUndo, save, undo, refresh } = session;
  const blocked = !ready || reviewBlocked || saveState.status === "error";
  const selectedTarget = targets.some((entry) => entry.id === variant?.id);
  // The key hints hide while the keyboard switch is off.
  const { enabled: shortcuts } = useShortcuts();
  return (
    <>
      <ShellMainFull className="sticky bottom-0 z-20">
        <Frame
          $cover
          $layer="canvas"
          $lighten={2}
          $border
          $borderType="border"
          $rounded="none"
          $p={2}
          id={reviewActionsId}
          // The skip link of the page moves the focus here.
          tabIndex={-1}
          role="region"
          aria-label="Review actions"
          className="review-actions flex flex-wrap items-center justify-between gap-x-2 gap-y-1"
        >
          <div className="flex items-center gap-2">
            <Button
              $p={1.5}
              disabled={model.archived || !canUndo || busy || saveState.status === "error"}
              onClick={() => void undo()}
            >
              <ButtonSlot>
                <Undo2 />
              </ButtonSlot>
              <ButtonLabel>Undo</ButtonLabel>
            </Button>
            <div className="h-5 w-px bg-current/10" />
            <Button $p={1.5} disabled={blocked || !targets.length} onClick={bar.openBatch}>
              <ButtonLabel>All {targets.length} changed views…</ButtonLabel>
              <ButtonSlot>
                <ChevronDown />
              </ButtonSlot>
            </Button>
          </div>
          <ButtonGroup $gap="sm">
            <Button
              $border
              disabled={blocked || !selectedTarget || !!variant?.rejectDisabledReason}
              title={variant?.rejectDisabledReason}
              onClick={() => bar.review("rejected")}
            >
              <ButtonSlot>
                <X />
              </ButtonSlot>
              <ButtonLabel>Reject view</ButtonLabel>
              {shortcuts && <ButtonSlot $kind="shortcut">X</ButtonSlot>}
            </Button>
            <Button
              $layer="brand"
              disabled={blocked || !selectedTarget || !!variant?.approveDisabledReason}
              title={variant?.approveDisabledReason}
              onClick={() => bar.review("approved")}
            >
              <ButtonSlot>
                <Check />
              </ButtonSlot>
              <ButtonLabel>Approve &amp; next</ButtonLabel>
              {shortcuts && <ButtonSlot $kind="shortcut">A</ButtonSlot>}
            </Button>
          </ButtonGroup>
          {(saveState.message ||
            busy ||
            saveState.status === "error" ||
            saveState.status === "conflict") && (
            <div className="basis-full px-1.5">
              <div
                className="review-save-state flex flex-wrap items-center gap-2 text-xs ak-ink-60 empty:hidden"
                role={
                  saveState.status === "error" || saveState.status === "conflict"
                    ? "alert"
                    : "status"
                }
              >
                {saveState.message}
                {!model.archived && saveState.status === "error" && saveState.failed && (
                  <Button
                    onClick={() => {
                      if (saveState.failed) void save(saveState.failed);
                    }}
                  >
                    <ButtonLabel>Retry same command</ButtonLabel>
                  </Button>
                )}
                {!model.archived && saveState.status === "error" && saveState.failedUndo && (
                  <Button onClick={() => void undo(saveState.failedUndo)}>
                    <ButtonLabel>Retry Undo</ButtonLabel>
                  </Button>
                )}
                {saveState.link === "sign-in" && (
                  // The sign-in opens in a new tab: this page holds the
                  // decision, and a sign-in in this tab loads a new document.
                  <Button render={<a href="/" target="_blank" rel="noopener" />}>
                    <ButtonLabel>Sign in again</ButtonLabel>
                  </Button>
                )}
                {saveState.link === "queue" && (
                  <Button render={<a href="/" />}>
                    <ButtonLabel>Go to the Queue</ButtonLabel>
                  </Button>
                )}
                {(saveState.status === "conflict" || saveState.status === "error") && (
                  <Button onClick={() => void refresh()}>
                    <ButtonLabel>Refresh current state</ButtonLabel>
                  </Button>
                )}
              </div>
            </div>
          )}
        </Frame>
      </ShellMainFull>
      <ak.Dialog
        open={batchValid}
        onClose={bar.closeBatch}
        unmountOnHide
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
