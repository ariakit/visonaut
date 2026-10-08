import { cx } from "clava";
import { ArrowUpRight, Check, TriangleAlert, Undo2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import type { ReviewSessionReady } from "../../../../fixtures/hooks/index.ts";
import { formatCount, useInboxData } from "../../../../fixtures/index.ts";
import { LabLink } from "../../../../lab/navigation.tsx";
import { getExternalLinkProps } from "../shell.tsx";
import { EmptyState } from "../surfaces.tsx";
import { iconStroke } from "../tokens.ts";
import { findNextRun, getPullRequestUrl, getResultFacts, getResultWord } from "./model.ts";

export interface ResultPageProps {
  session: ReviewSessionReady;
  /**
   * The person went back to a screenshot: `Show rejected`. The page shows
   * the stage again. Undo also leaves the result, because the run then has a
   * change to review.
   */
  onLeave?(): void;
  /** `All 626 screenshots`: the list shows the unchanged screenshots. */
  onShowAll?(): void;
  /**
   * Gives the focus to the main action when the page shows, so Enter opens
   * the next run. Default: true.
   */
  autoFocus?: boolean;
  className?: string;
}

/**
 * The end of a review (D-WORK-05): the result, the counts, and the way on,
 * in the place of the variant row and the stage. A run with no change opens
 * here too. The bar does not show with it: the page has its own Undo.
 * @example
 * {resultOpen && session.complete ? (
 *   <ResultPage
 *     session={session}
 *     onLeave={() => setResultOpen(false)}
 *     onShowAll={() => list.setStatus("unchanged")}
 *   />
 * ) : (
 *   <ReviewStage … />
 * )}
 */
export function ResultPage({
  session,
  onLeave,
  onShowAll,
  autoFocus = true,
  className,
}: ResultPageProps) {
  const mainAction = useRef<HTMLAnchorElement>(null);
  const inbox = useInboxData("busy");
  const next = findNextRun(inbox, session.run.id);
  const pullRequestUrl = getPullRequestUrl(session);
  const { progress, counts, items } = session;
  const failed = counts.error > 0;
  const rejected = session.queue.find((variant) => variant.status === "rejected");
  const screenshots = formatCount(items.length, "screenshot");

  useEffect(() => {
    if (!autoFocus) return;
    mainAction.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  let icon = Check;
  if (failed) {
    icon = TriangleAlert;
  } else if (rejected) {
    icon = X;
  }
  const mainTarget = next?.target ?? { to: "inbox", scenario: "empty" };
  return (
    <div className={cx("grid min-h-0 flex-1 place-items-center overflow-y-auto", className)}>
      <EmptyState
        bare
        icon={icon}
        tone={failed || rejected ? "danger" : "success"}
        title={getResultWord(session)}
        action={
          <div className="grid justify-items-center gap-3">
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                $kind="bevel"
                $layer="brand"
                render={<LabLink ref={mainAction} {...mainTarget} />}
              >
                <ButtonLabel>{next ? `Next run · ${next.label}` : "Queue"}</ButtonLabel>
              </Button>
              {rejected && (
                <Button
                  $lightnessOffset
                  onClick={() => {
                    session.select(rejected);
                    onLeave?.();
                  }}
                >
                  <ButtonLabel>Show rejected</ButtonLabel>
                </Button>
              )}
              {!rejected && next && (
                <Button $lightnessOffset render={<LabLink to="inbox" scenario="busy" />}>
                  <ButtonLabel>Queue</ButtonLabel>
                </Button>
              )}
            </div>
            <div className="flex flex-wrap justify-center gap-1">
              {session.can.undo && (
                <Button $size="sm" onClick={session.undo}>
                  <ButtonSlot>
                    <Undo2 strokeWidth={iconStroke} />
                  </ButtonSlot>
                  <ButtonLabel>Undo last decision</ButtonLabel>
                </Button>
              )}
              <Button $size="sm" onClick={onShowAll}>
                <ButtonLabel>{`All ${screenshots}`}</ButtonLabel>
              </Button>
              {pullRequestUrl && (
                <Button $size="sm" render={<a {...getExternalLinkProps(pullRequestUrl)} />}>
                  <ButtonLabel>Pull request</ButtonLabel>
                  <ButtonSlot $size="sm" $ink={60}>
                    <ArrowUpRight strokeWidth={iconStroke} />
                  </ButtonSlot>
                </Button>
              )}
            </div>
          </div>
        }
      >
        {progress.total
          ? getResultFacts(session)
          : `Every screenshot matches baseline ${session.review.baselineRevision}`}
      </EmptyState>
    </div>
  );
}
