// The one bar of the review page: the bottom row of the panel sheet, with
// Undo, the view controls of the stage, the status line, Reject, Approve, and
// the `⋯` menu.

import { cx } from "clava";
import { useLayoutEffect, useRef } from "react";
import { ButtonSeparator } from "../../ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../../ariakit/components/frame.ariakit.react.tsx";
import { hasMaskLayer } from "../stage/model.ts";
import type { StageEngine } from "../stage/view.ts";
import type { StoredView } from "../view-types.ts";
import { DecisionButton, UndoButton } from "./decisions.tsx";
import type { BarControl } from "./decisions.tsx";
import { StatusLine } from "./message-row.tsx";
import type { BarMessage } from "./message.ts";
import { MoreMenu } from "./more-menu.tsx";
import type { WholeItemCommand } from "./more-menu.tsx";
import type { RunApprovalCommand } from "./run-approval.tsx";
import { MaskToggle, ModeButtons, RegionStepper } from "./view-controls.tsx";
import { ZoomControl } from "./zoom.tsx";

/** The view of the stage that the view controls change. */
export interface BarView {
  /** The mode and the mask switch, which the browser remembers. */
  stored: StoredView;
  /** The view on screen: the subject, the mode, and the zoom. */
  engine: StageEngine;
}

export interface ReviewBarProps {
  /** The id of the row, the target of the skip link of the page. */
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

/**
 * The bar of the review page: Undo, the view controls of the stage (modes,
 * mask, zoom, and the region stepper), the status line, Reject, Approve, and
 * the `⋯` menu, in that order.
 *
 * - The bar has no surface: its controls sit in the sheet, with the gutter of
 *   the sheet, and the row has the width of the sheet.
 * - The status line has a reserved height, and the buttons are at the bottom
 *   of the row. A longer text grows the row upward, so Approve stays in
 *   its place when a message shows.
 * - A failed save takes the bar over: the bar then has only its words and
 *   its recovery buttons.
 * - Below 57rem of its own width, the bar has rows: the view controls, the
 *   status line, then Undo and the decisions. An empty status line has no
 *   height there.
 * - A message with recovery buttons tints the status line.
 *
 * The bar is its own size container. Put it last in a sheet with no padding.
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
    // The row has the layer of the sheet, so the stage does not show through
    // it where the row sticks to the bottom of a short window. The gutter of
    // the sheet is its padding, and the stage above it has the gap.
    <Frame
      ref={rootRef}
      id={id}
      tabIndex={-1}
      role="region"
      aria-label="Review actions"
      $layer
      $p={2}
      className={cx(
        "review-actions @container flex min-w-0 flex-none flex-wrap items-end gap-1 pt-0",
        className,
      )}
    >
      {/* The siblings of the status line keep their places in the tree, so
            the live region stays mounted. */}
      {!takeover && <UndoButton control={undo} />}
      {!takeover && <Divider className="@max-[57rem]:hidden" />}
      {!takeover && view && (
        <div
          className={cx(
            "flex flex-none items-center justify-center gap-1",
            // A narrow bar gives the view controls the first row. In a
            // very narrow bar, the zoom takes a row of its own.
            "@max-[57rem]:order-first @max-[57rem]:basis-full @max-[57rem]:flex-wrap",
          )}
        >
          <ModeButtons stored={view.stored} subject={view.engine.subject} mode={view.engine.mode} />
          <Divider />
          <MaskToggle stored={view.stored} available={hasMaskLayer(view.engine.subject)} />
          {/* The divider goes where the row has no room for it, and the
                zoom then takes a row of its own. */}
          <Divider className="@max-[24.75rem]:hidden" />
          <ZoomControl view={view.engine} className="flex-none" />
          {/* Below 65rem the stepper and its divider leave the row: they take
                119 px, which would leave the status line 96 px in a window of
                1280 px. A box on the stage still zooms to its region. */}
          <Divider className="@max-[65rem]:hidden" />
          <RegionStepper view={view.engine} className="flex-none @max-[65rem]:hidden" />
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
              // the bottom of the row, so a text that shows moves no
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
    </Frame>
  );
}
