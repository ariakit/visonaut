import { Link } from "@tanstack/react-router";
import { cx } from "clava";
import { Check, Undo2, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { Button, ButtonLabel, ButtonSlot } from "../../ariakit/components/button.ariakit.react.tsx";
import { formatCount } from "../format.ts";
import { EmptyState } from "../surfaces.tsx";
import { iconStroke } from "../tokens.ts";

export interface ResultNextRun {
  /** `#7754`, or `main`. */
  label: string;
  runId: string;
}

export interface ResultPageProps {
  /** `All approved`, `2 rejected`, or `Nothing to review`. */
  title: string;
  /** One sentence with the state of the run and the counts. */
  sentence: string;
  /** A rejected change marks the result as a failure. */
  rejected?: boolean;
  /** The next run of the Queue that waits for a decision. Null: the Queue. */
  next: ResultNextRun | null;
  /** The number of screenshots of the run, unchanged ones too. */
  screenshots: number;
  onShowAll(): void;
  /** The Undo of the last decision. Null when the page has nothing to undo. */
  onUndo: (() => void) | null;
  className?: string;
}

/**
 * The end of a review (D-WORK-05): the result, the counts, and the way on,
 * in the place of the variant row, the stage, and the bar. A run with nothing
 * to review opens here. The bar does not show with it, so it has its own
 * Undo.
 * @example
 * <ResultPage
 *   title="All approved"
 *   sentence="Run state: Passed. 9 changes in 3 screenshots: 9 approved, 0 rejected."
 *   next={{ label: "#7754", runId: "run-2" }}
 *   screenshots={626}
 *   onShowAll={showUnchanged}
 *   onUndo={undo}
 * />
 */
export function ResultPage({
  title,
  sentence,
  rejected,
  next,
  screenshots,
  onShowAll,
  onUndo,
  className,
}: ResultPageProps) {
  const mainAction = useRef<HTMLAnchorElement>(null);
  const titleId = useId();
  const sentenceId = useId();

  // The main action takes the focus when the result shows, so Enter opens
  // the next run. A control that has the focus keeps it: only the page root
  // or the document body gives it away.
  useEffect(() => {
    const action = mainAction.current;
    if (!action) return;
    const active = action.ownerDocument.activeElement;
    if (active && !active.contains(action)) return;
    action.focus({ preventScroll: true });
  }, []);

  const describedBy = `${titleId} ${sentenceId}`;
  return (
    <section
      aria-labelledby={titleId}
      className={cx(
        "grid min-h-[min(75dvh,60rem)] flex-1 place-items-center overflow-y-auto",
        className,
      )}
    >
      <EmptyState
        bare
        icon={rejected ? X : Check}
        tone={rejected ? "danger" : "success"}
        title={<span id={titleId}>{title}</span>}
        action={
          <div className="grid justify-items-center gap-3">
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                $kind="bevel"
                $layer="brand"
                aria-describedby={describedBy}
                render={
                  next ? (
                    <Link ref={mainAction} to="/runs/$runId" params={{ runId: next.runId }} />
                  ) : (
                    <Link ref={mainAction} to="/" />
                  )
                }
              >
                <ButtonLabel>{next ? `Next run · ${next.label}` : "Queue"}</ButtonLabel>
              </Button>
              {next && (
                <Button $lightnessOffset render={<Link to="/" />}>
                  <ButtonLabel>Queue</ButtonLabel>
                </Button>
              )}
            </div>
            <div className="flex flex-wrap justify-center gap-1">
              {onUndo && (
                <Button $size="sm" onClick={onUndo}>
                  <ButtonSlot>
                    <Undo2 strokeWidth={iconStroke} />
                  </ButtonSlot>
                  <ButtonLabel>Undo last decision</ButtonLabel>
                </Button>
              )}
              <Button $size="sm" onClick={onShowAll}>
                <ButtonLabel>{`All ${formatCount(screenshots, "screenshot")}`}</ButtonLabel>
              </Button>
            </div>
          </div>
        }
      >
        <span id={sentenceId}>{sentence}</span>
      </EmptyState>
    </section>
  );
}
