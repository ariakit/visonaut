// The one bar of the review stage. It merges three picks: the decision bar
// "Floating pill", the viewer toolbar "Merged bar" (Undo, the view controls,
// then the decisions), and the notice "The bar is the message". It is a pill
// that floats over the stage: the answer to UI-STAGE-BAR.

import { cx } from "clava";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { ButtonSeparator } from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import type { FrameProps } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import type { ReviewSessionReady } from "../../../../fixtures/hooks/index.ts";
import type { StageView, StoredView } from "../view-types.ts";
import { DecisionButton, getSavingWords, UndoButton } from "./decisions.tsx";
import { MessageNote, MessageRow } from "./message-row.tsx";
import { getBarMessage } from "./message.ts";
import type { BarMessage } from "./message.ts";
import { MoreMenu } from "./more-menu.tsx";
import { useReceipt } from "./receipt.ts";
import type { Receipt } from "./receipt.ts";
import { useOpenedChanges } from "./run-approval.tsx";
import { useIdle } from "./use-idle.ts";
import { MaskToggle, ModeButtons, RegionStepper } from "./view-controls.tsx";
import { ZoomControl } from "./zoom.tsx";

export interface ReviewBarProps {
  session: ReviewSessionReady;
  /** The zoom and the regions of the stage, from `useStageView`. */
  view: StageView;
  /** The mode and the mask switch, from `useStoredView`. */
  stored: StoredView;
  /**
   * The cover of all variants shows in the place of the stage: the bar has
   * Undo, the mask switch, and the decisions for the whole screenshot.
   */
  cover?: boolean;
  /**
   * The message of the bar. Default: `getBarMessage(session)`. Pass a message
   * for a state that the session does not have, or null for none.
   */
  message?: BarMessage | null;
  /**
   * False while the images of the selected variant are not on screen, or
   * after one failed to load: Reject and Approve are off. Default: true.
   */
  ready?: boolean;
  /**
   * The save feedback of the bar. Default: the receipt of the last decision
   * of the session. Pass one for a still picture of a save state.
   */
  receipt?: Receipt | null;
  /**
   * Forgets the stored view, for the item of the lab menu. Default:
   * `resetStoredView`. Pass it when `stored` is not the store of the browser.
   */
  onResetView?(): void;
  className?: string;
}

// The words of a save for a screen reader. The bar shows a save with marks
// only: a ring, then a check.
function getStatusWords(receipt: Receipt | null) {
  if (!receipt) return "";
  if (receipt.phase === "saving") return getSavingWords(receipt.pending);
  return "Saved";
}

interface DividerProps {
  className?: string;
}

// The rule between two groups of the bar. A stock separator hides beside a
// hovered or selected control, but here its neighbors are groups, so it
// stays.
function Divider({ className }: DividerProps) {
  return <ButtonSeparator $shy={false} className={cx("mx-0.5", className)} />;
}

type BarTint = Exclude<BarMessage["tone"], "neutral">;

// The tint of D-UI-04: the color of the state at 15% with its edge.
function getTintProps(tint: BarTint): FrameProps {
  return { $layer: tint, $mix: 15, $border: true, $edge: tint };
}

interface BarFrameProps {
  /** The color of a message that takes the bar over. */
  tint: BarTint | null;
  /** The pill is faded. */
  idle: boolean;
  children: ReactNode;
}

// The surface of the bar: a raised pill with an edge and a shadow.
function BarFrame({ tint, idle, children }: BarFrameProps) {
  const group = { role: "group", "aria-label": "Review" };
  const row = "flex items-center gap-1 @max-[57rem]:flex-wrap";
  const width = "max-w-full @max-[57rem]:w-full";
  const floating = cx(
    "pointer-events-auto m-4 shadow-xl @max-[57rem]:m-2",
    "transition-opacity duration-300 motion-reduce:transition-none",
    // The pointer and the keyboard focus bring a faded pill back at once.
    // The focus that a click leaves on a button does not hold it.
    idle && "opacity-45 hover:opacity-100 has-focus-visible:opacity-100",
    idle && "motion-reduce:opacity-100",
  );
  if (!tint) {
    return (
      <Frame
        {...group}
        $layer
        $lighten={2}
        $border
        $rounded="3xl"
        $forceRounded
        $p={1}
        className={cx(row, width, floating)}
      >
        {children}
      </Frame>
    );
  }
  return (
    // A tint is a mix with the surface behind it. The well is too dark for
    // that, so the raised surface of the pill stays under the tint.
    <Frame $layer $lighten={2} $rounded="3xl" $forceRounded className={cx("flex", width, floating)}>
      <Frame
        {...group}
        {...getTintProps(tint)}
        $rounded="3xl"
        $forceRounded
        $p={1}
        className={cx(row, "min-w-0 flex-1")}
      >
        {children}
      </Frame>
    </Frame>
  );
}

/**
 * The bar of the review stage: Undo, the view controls, Reject, Approve, and
 * the `⋯` menu, in that order.
 *
 * - The pressed button is the save feedback. The bar keeps its width while a
 *   decision saves.
 * - A message that takes the bar over leaves only its own actions. A run
 *   that takes no decision keeps the view controls.
 * - Below 57rem of its own width the bar has two rows: the view controls,
 *   then Undo and the decisions.
 *
 * The pill lays itself over the nearest positioned element: put it beside
 * the stage in a `relative` box, and give `ReviewStage` a bottom gutter of
 * 4rem.
 * @example
 * const stored = useStoredView();
 * const view = useStageView({ variant, mode: stored.mode });
 * <div className="relative flex min-h-0 flex-1">
 *   <ReviewStage variant={variant} item={item} view={view} mode={stored.mode} mask={stored.mask} gutterBottom={4} />
 *   <ReviewBar session={session} view={view} stored={stored} />
 * </div>
 */
export function ReviewBar({
  session,
  view,
  stored,
  cover = false,
  message = getBarMessage(session),
  ready = true,
  receipt: forcedReceipt,
  onResetView,
  className,
}: ReviewBarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const sessionReceipt = useReceipt(session);
  const receipt = forcedReceipt === undefined ? sessionReceipt : forcedReceipt;
  useOpenedChanges(session, ready);

  const saving = receipt?.phase === "saving";
  const takeover = !!message?.takeover;
  const tint = message?.takeover && message.tone !== "neutral" ? message.tone : null;
  // A faded pill can hide a save or a message that waits for an answer, so
  // it fades only at rest. A run that takes no decision is at rest too.
  const idle = useIdle(rootRef, !takeover && !saving && !menuOpen);

  const { item, variant, readOnly } = session;
  const hasMask = cover ? !!item?.variants.some((entry) => entry.diff) : !!variant?.diff;

  return (
    <div
      ref={rootRef}
      className={cx(
        // The size container of the bar: its rows follow the width of the
        // stage.
        "@container pointer-events-none absolute inset-0 z-10 flex items-end justify-center",
        className,
      )}
    >
      <BarFrame tint={tint} idle={idle}>
        {takeover && message ? (
          <MessageRow message={message} />
        ) : (
          <>
            {/* A run that takes no decision has no Undo. */}
            {!readOnly && (
              <div className="flex">
                <UndoButton session={session} receipt={receipt} />
              </div>
            )}
            {!readOnly && <Divider className="@max-[57rem]:hidden" />}
            <div
              className={cx(
                "flex flex-none items-center gap-1",
                "@max-[57rem]:order-first @max-[57rem]:basis-full @max-[57rem]:flex-wrap @max-[57rem]:justify-center",
              )}
            >
              {!cover && (
                <>
                  <ModeButtons stored={stored} variant={variant} />
                  <Divider />
                </>
              )}
              <MaskToggle stored={stored} available={hasMask} />
              {!cover && (
                <>
                  <Divider className="@max-[30rem]:hidden" />
                  <ZoomControl view={view} onOpenChange={setMenuOpen} className="flex-none" />
                  <Divider className="@max-[30rem]:hidden" />
                  <RegionStepper view={view} className="flex-none @max-[30rem]:hidden" />
                </>
              )}
            </div>
            <Divider className="@max-[57rem]:hidden" />
            <div className="flex flex-none items-center justify-end gap-1 @max-[57rem]:ms-auto">
              {message ? (
                <MessageNote message={message} />
              ) : (
                <>
                  <DecisionButton
                    action="reject"
                    session={session}
                    receipt={receipt}
                    cover={cover}
                    ready={ready}
                  />
                  <DecisionButton
                    action="approve"
                    session={session}
                    receipt={receipt}
                    cover={cover}
                    ready={ready}
                  />
                </>
              )}
              <MoreMenu
                session={session}
                cover={cover}
                ready={ready}
                onResetView={onResetView}
                onOpenChange={setMenuOpen}
              />
            </div>
          </>
        )}
      </BarFrame>
      <Text role="status" className="sr-only">
        {getStatusWords(receipt)}
      </Text>
    </div>
  );
}
