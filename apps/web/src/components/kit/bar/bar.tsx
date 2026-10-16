// The one bar of the review page, from the lab: a raised pill with Undo, the
// view controls of the stage, the status line, Reject, Approve, and the `⋯`
// menu.

import { cx } from "clava";
import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { ButtonSeparator } from "../../ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../../ariakit/components/frame.ariakit.react.tsx";
import type { FrameProps } from "../../ariakit/components/frame.ariakit.react.tsx";
import type { StageEngine } from "../stage/view.ts";
import type { StoredView } from "../view-types.ts";
import { DecisionButton, UndoButton } from "./decisions.tsx";
import type { BarControl } from "./decisions.tsx";
import { StatusLine } from "./message-row.tsx";
import type { BarMessage } from "./message.ts";
import { MoreMenu } from "./more-menu.tsx";
import type { WholeItemCommand } from "./more-menu.tsx";
import type { RunApprovalCommand } from "./run-approval.tsx";
import { MaskToggle, ModeButtons } from "./view-controls.tsx";
import { ZoomControl } from "./zoom.tsx";

/** The view of the stage that the view controls change. */
export interface BarView {
  /** The mode and the mask switch, which the browser remembers. */
  stored: StoredView;
  /** The view on screen: the subject, the mode, and the zoom. */
  engine: StageEngine;
}

export interface ReviewBarProps {
  /** The id of the pill, the target of the skip link of the page. */
  id?: string;
  /** The one text of the status line, or null for none. */
  message: BarMessage | null;
  /** The view controls of the stage. Null for a stage with no images. */
  view: BarView | null;
  undo: BarControl;
  reject: BarControl;
  approve: BarControl;
  /** The decisions for the whole screenshot, in the `⋯` menu. */
  wholeItem: WholeItemCommand | null;
  /** The approval of each change of the run, in the `⋯` menu. */
  runApproval: RunApprovalCommand | null;
  /** Runs after a recovery button, so the focus goes back to the page. */
  onActionDone?(): void;
  className?: string;
}

interface DividerProps {
  className?: string;
}

// The rule between two groups of the bar. A stock separator hides beside a
// hovered control, but here its neighbors are groups, so it stays.
function Divider({ className }: DividerProps) {
  return <ButtonSeparator $shy={false} className={cx("mx-0.5", className)} />;
}

type BarTint = "warning" | "danger";

// The tint of a message with recovery buttons: the color of its state at 15%
// with its edge.
function getTint(message: BarMessage | null): BarTint | null {
  if (!message?.actions.length) return null;
  if (message.tone === "danger") return "danger";
  if (message.tone === "warning") return "warning";
  return null;
}

function getTintProps(tint: BarTint): FrameProps {
  return { $layer: tint, $mix: 15, $border: true, $edge: tint };
}

interface BarFrameProps {
  id?: string;
  tint: BarTint | null;
  children: ReactNode;
}

// The surface of the bar: a raised pill with an edge and a shadow. The skip
// link of the page moves the focus to it. A tint is a mix with the surface
// behind it. The stage is too dark for that, so the raised surface of the
// pill stays under the tint. The tree is the same with and without a tint,
// so the live region and the focus stay.
function BarFrame({ id, tint, children }: BarFrameProps) {
  return (
    <Frame
      $layer
      $lighten={2}
      $rounded="3xl"
      $forceRounded
      className="pointer-events-auto flex w-full max-w-[72rem] shadow-xl"
    >
      <Frame
        id={id}
        tabIndex={-1}
        role="region"
        aria-label="Review actions"
        {...(tint ? getTintProps(tint) : { $border: true })}
        $rounded="3xl"
        $forceRounded
        $p={1}
        className="review-actions flex min-w-0 flex-1 flex-wrap items-end gap-1"
      >
        {children}
      </Frame>
    </Frame>
  );
}

/**
 * The bar of the review page: Undo, the view controls of the stage, the status
 * line, Reject, Approve, and the `⋯` menu, in that order.
 *
 * - The status line has a reserved height, and the buttons are at the bottom
 *   of the pill. A longer text grows the pill upward, so Approve stays in
 *   its place when a message shows.
 * - A failed save takes the bar over: the bar then has only its words and
 *   its recovery buttons.
 * - Below 57rem of its own width, the bar has rows: the view controls, the
 *   status line, then Undo and the decisions. An empty status line has no
 *   height there.
 * - A message with recovery buttons tints the pill.
 *
 * The bar is its own size container. Put it in a box with the width of the
 * stage.
 * @example
 * <ReviewBar
 *   message={getBarMessage({ text: "Saving…", tone: "saving" })}
 *   undo={{ disabled: true, onClick: undo }}
 *   reject={{ disabled: false, onClick: reject }}
 *   approve={{ disabled: false, onClick: approve }}
 *   wholeItem={null}
 *   runApproval={null}
 * />
 */
export function ReviewBar({
  id,
  message,
  view,
  undo,
  reject,
  approve,
  wholeItem,
  runApproval,
  onActionDone,
  className,
}: ReviewBarProps) {
  // A failed save takes the bar over, as in the lab: no decision can save
  // until its recovery buttons run, so the bar shows no other control. A
  // conflict and a closed run keep the controls of the bar.
  const takeover = !!message?.actions.length && message.tone === "danger";
  const rootRef = useRef<HTMLDivElement>(null);
  // The takeover removes each control of the bar. A control that had the
  // focus leaves it on the body, so the page takes it.
  useLayoutEffect(() => {
    if (!takeover) return;
    const document = rootRef.current?.ownerDocument;
    if (!document) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    onActionDone?.();
  }, [takeover, onActionDone]);
  return (
    <div
      ref={rootRef}
      className={cx(
        "@container pointer-events-none flex justify-center px-2 pb-2 @min-[36rem]:pb-4",
        className,
      )}
    >
      <BarFrame id={id} tint={getTint(message)}>
        {/* The siblings of the status line keep their places in the tree, so
            the live region stays mounted. */}
        {!takeover && <UndoButton control={undo} />}
        {!takeover && <Divider className="@max-[57rem]:hidden" />}
        {!takeover && view && (
          <div
            className={cx(
              "flex flex-none items-center justify-center gap-1",
              // A narrow bar gives the view controls the first row.
              "@max-[57rem]:order-first @max-[57rem]:basis-full",
            )}
          >
            <ModeButtons
              stored={view.stored}
              subject={view.engine.subject}
              mode={view.engine.mode}
            />
            <Divider />
            <MaskToggle stored={view.stored} available={!!view.engine.subject.mask} />
            <Divider />
            <ZoomControl view={view.engine} className="flex-none" />
          </div>
        )}
        {!takeover && view && <Divider className="@max-[57rem]:hidden" />}
        <StatusLine
          message={message}
          onActionDone={onActionDone}
          className={cx(
            "flex-1 self-stretch",
            takeover
              ? "basis-full"
              : // A narrow bar gives the line a row of its own above the
                // buttons. An empty line has no height there, so the bar
                // keeps two rows at 400% zoom (A11Y-14). The buttons are at
                // the bottom of the pill, so a text that shows moves no
                // button. The line stays in the tree: it is the live region.
                "@max-[57rem]:order-first @max-[57rem]:basis-full @max-[57rem]:has-[.review-save-state:empty]:h-0 @max-[57rem]:has-[.review-save-state:empty]:overflow-hidden",
          )}
        />
        {!takeover && <Divider className="@max-[57rem]:hidden" />}
        {!takeover && (
          <div className="ms-auto flex flex-none items-center gap-1">
            <DecisionButton action="reject" control={reject} />
            <DecisionButton action="approve" control={approve} />
            <MoreMenu wholeItem={wholeItem} runApproval={runApproval} />
          </div>
        )}
      </BarFrame>
    </div>
  );
}
