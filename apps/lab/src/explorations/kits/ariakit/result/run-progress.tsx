import { cx } from "clava";
import {
  Button,
  ButtonLabel,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { Progress } from "../../../../components/ariakit/components/progress.ariakit.react.tsx";
import { TextFrame } from "../../../../components/ariakit/components/text-frame.ariakit.react.tsx";
import type { ReviewSessionReady } from "../../../../fixtures/hooks/index.ts";
import { ReviewBar } from "../run-row.tsx";
import { getRunProgress } from "./model.ts";

// The bar is 6em wide, so it follows the Density control.
const barBox = "block w-24 flex-none self-center";

export interface RunProgressProps {
  session: Pick<
    ReviewSessionReady,
    "progress" | "counts" | "review" | "readOnly" | "readOnlyKind" | "complete"
  >;
  /**
   * Shows the result page again. With it, the progress of a complete run is
   * a button. A run with a failed comparison is never complete.
   */
  onShowResult?(): void;
  className?: string;
}

/**
 * The run progress of the review header (UI-REVIEW-PROGRESS, `segments`):
 * the review bar of a run row and one count. The bar has the approved share,
 * the rejected share, and the open rest. While the run compares, it is the
 * stock `Progress`.
 * @example
 * <RunProgress session={session} onShowResult={() => setResultOpen(true)} />
 */
export function RunProgress({ session, onShowResult, className }: RunProgressProps) {
  const { phase, label, shares, compared } = getRunProgress(session);
  const bar = (
    <>
      {phase === "comparing" && (
        <span className={barBox}>
          <Progress aria-label={label} value={compared ?? undefined} $thickness={1.5} />
        </span>
      )}
      {shares && (
        <span className={barBox}>
          <ReviewBar shares={shares} render={<span />} />
        </span>
      )}
    </>
  );
  if (session.complete && onShowResult) {
    return (
      <Button $gap="lg" onClick={onShowResult} className={cx("flex-none", className)}>
        {bar}
        <ButtonLabel className="tabular-nums">{label}</ButtonLabel>
      </Button>
    );
  }
  return (
    // The text frame starts its text where the label of a button starts, so
    // the count does not move when the progress becomes a button.
    <TextFrame
      $p={2}
      className={cx("flex flex-none items-center gap-3 font-medium tabular-nums", className)}
    >
      {bar}
      <span>{label}</span>
    </TextFrame>
  );
}
