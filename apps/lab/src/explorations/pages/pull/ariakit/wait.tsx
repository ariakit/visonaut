import { cx } from "clava";
import { ArrowUpRight, Check, RefreshCw, TriangleAlert } from "lucide-react";
import { Fragment } from "react";
import type { ReactNode } from "react";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { HeadingLevel } from "../../../../components/ariakit/components/heading.ariakit.react.tsx";
import { List, ListItem } from "../../../../components/ariakit/components/list.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import type { PullReady } from "../../../../fixtures/hooks/index.ts";
import { formatCount, shortSha } from "../../../../fixtures/index.ts";
import type { Run } from "../../../../fixtures/index.ts";
import { LabLink } from "../../../../lab/navigation.tsx";
import { ErrorBand, ErrorBandButton } from "../../../kits/ariakit/error-band.tsx";
import { ReviewBar, getReviewShares, getRunRow } from "../../../kits/ariakit/run-row.tsx";
import type { RunRowModel } from "../../../kits/ariakit/run-row.tsx";
import { getRunTarget } from "../../../kits/ariakit/runs.tsx";
import { PageTitle, getExternalLinkProps } from "../../../kits/ariakit/shell.tsx";
import { SkeletonLine } from "../../../kits/ariakit/skeleton-line.tsx";
import { StatusPill } from "../../../kits/ariakit/status.tsx";
import { EmptyState, Sheet, Skeleton } from "../../../kits/ariakit/surfaces.tsx";
import { iconStroke, mono, secondary } from "../../../kits/ariakit/tokens.ts";
import { getPullUrl, getWorkflowUrl } from "./runs.ts";

// A long title takes a second line, and the GitHub button stays beside it.
const titleRow = "flex-nowrap!";
// Each state of the page is one row: the state at the start and the one
// action at the end. In a narrow sheet the action takes a row of its own.
const sheetRow = "flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3";
const sheetAction = "ms-auto flex-none";
// The state text has the width of the state text of a run row, so the bar
// has the size that it has in the Queue.
const stateBlock = "grid w-[14em] max-w-full gap-1.5 empty:hidden";

interface GitHubButtonProps {
  repository: string;
  number: number;
}

function GitHubButton({ repository, number }: GitHubButtonProps) {
  return (
    <Button
      $size="sm"
      $border
      render={<a {...getExternalLinkProps(getPullUrl(repository, number))} />}
    >
      <ButtonLabel>GitHub</ButtonLabel>
      <ButtonSlot>
        <ArrowUpRight strokeWidth={iconStroke} />
      </ButtonSlot>
    </Button>
  );
}

export interface WaitingPullProps {
  pull: PullReady;
}

/**
 * The pull request page that waits for the newest run: the title, the
 * commit, and the attempt, then one sheet with the state of the newest run
 * and one action. It lists no other run.
 */
export function WaitingPull({ pull }: WaitingPullProps) {
  const { number, repository, title } = pull.pull;
  const run = pull.latestRun;
  // Without the head commit of the pull request, the newest run has it.
  const sha = pull.pull.headSha ?? run?.testedSha;
  return (
    <>
      <PageTitle
        // Without a title the heading has the number: `Pull request #7754`.
        prefix={title ? `#${number}` : undefined}
        className={titleRow}
        meta={
          sha && (
            <span>
              <span className={mono}>{shortSha(sha)}</span>
              {run && ` · attempt ${run.attempt}`}
            </span>
          )
        }
        actions={<GitHubButton repository={repository} number={number} />}
      >
        {title ?? `Pull request #${number}`}
      </PageTitle>
      {/* The title block holds the `h1`. */}
      <HeadingLevel>
        <PullState pull={pull} />
      </HeadingLevel>
    </>
  );
}

function PullState({ pull }: WaitingPullProps) {
  const { outcome, latestRun: run } = pull;
  const { repository } = pull.pull;
  if (outcome === "not-required") {
    return (
      <Sheet>
        <EmptyState bare $p="1rem" icon={Check} tone="success" title="No visual review needed">
          No screenshots were captured for this pull request
        </EmptyState>
      </Sheet>
    );
  }
  if (outcome === "capture-failed" || outcome === "failed") {
    return (
      <WorkflowBand
        title={outcome === "failed" ? "Run failed" : "Capture failed"}
        detail={run?.error}
        repository={repository}
      />
    );
  }
  if (outcome === "needs-recompare") {
    return <WorkflowBand tone="warning" title="Rerun needed" repository={repository} />;
  }
  if (!run || outcome === "incomplete" || outcome === "comparing") {
    return <Steps run={run} />;
  }
  return <RunSheet run={run} />;
}

interface WorkflowBandProps {
  tone?: "danger" | "warning";
  title: string;
  /** The sentence of the service. Without it, the band names the fix. */
  detail?: string;
  repository: string;
}

// A run that only a new workflow run repairs: the band names the fix, and
// its one action opens the workflows.
function WorkflowBand({ tone = "danger", title, detail, repository }: WorkflowBandProps) {
  return (
    <ErrorBand
      tone={tone}
      role="status"
      icon={tone === "danger" ? TriangleAlert : RefreshCw}
      title={title}
      detail={detail ?? "rerun the visual tests in CI"}
      action={
        <ErrorBandButton
          icon={<ArrowUpRight strokeWidth={iconStroke} />}
          render={<a {...getExternalLinkProps(getWorkflowUrl(repository))} />}
        >
          Open workflow
        </ErrorBandButton>
      }
    />
  );
}

interface StepsProps {
  /** Null while the capture has not sent a screenshot yet. */
  run: Run | null;
}

// The three steps to a review. The page opens the review when the run is
// ready, so the sheet has no action.
function Steps({ run }: StepsProps) {
  const comparing = run?.state === "comparing";
  const progress = run?.progress;
  const known = progress != null && progress.expected > 0;
  const done = comparing ? progress?.compared : progress?.captured;
  // Without the progress of the run, half a ring says that the step runs.
  const ratio = known && done != null ? Math.min(1, done / progress.expected) : 0.5;
  return (
    <Sheet className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      {/* The steps are one row: the list is a grid, so it flows in columns.
          A row of a list keeps room before its marker, so the list starts
          that much earlier and the first marker lies on the sheet padding. */}
      <List
        aria-label="Steps"
        className="-ms-1.5 grid-flow-col auto-cols-max justify-start gap-x-6"
      >
        <ListItem checked={comparing ? true : undefined} progress={comparing ? undefined : ratio}>
          Capture
        </ListItem>
        <ListItem checked={comparing ? undefined : false} progress={comparing ? ratio : undefined}>
          Compare
        </ListItem>
        <ListItem checked={false}>Review</ListItem>
      </List>
      <Text className={secondary}>Opens when ready</Text>
    </Sheet>
  );
}

interface StateTextProps {
  row: RunRowModel;
}

// What the state word of the pill does not say: the count of a run to
// review, the changes of a run that passed, the reason of a closed run.
function StateText({ row }: StateTextProps) {
  if (row.review) {
    return (
      <Text className={cx(secondary, "tabular-nums")}>
        {row.parts.map((part, index) => (
          <Fragment key={part.text}>
            {index > 0 && " · "}
            {part.danger ? <Text $text="danger">{part.text}</Text> : part.text}
          </Fragment>
        ))}
      </Text>
    );
  }
  if (row.run.state === "superseded") {
    const reason = row.parts.map((part) => part.text).join(" · ");
    return <Text className={secondary}>{reason}</Text>;
  }
  if (!row.changes) return null;
  return (
    <Text className={cx(secondary, "tabular-nums")}>{formatCount(row.changes, "change")}</Text>
  );
}

interface RunSheetProps {
  run: Run;
}

// The state of the newest run with one action, in one row: the pill with its
// word, the review bar over the count, and the button that opens the run.
function RunSheet({ run }: RunSheetProps) {
  const row = getRunRow(run);
  const shares = getReviewShares(row);
  const target = getRunTarget(run);
  return (
    <Sheet className={sheetRow}>
      <StatusPill status={row.status} />
      <div className={stateBlock}>
        {shares && <ReviewBar shares={shares} />}
        <StateText row={row} />
      </div>
      {row.review ? (
        <Button
          $kind="bevel"
          $layer="brand"
          render={<LabLink to={target.to} scenario={target.scenario} />}
          className={sheetAction}
        >
          {/* The count is beside the button, as on the next run card of the
              Queue. */}
          <ButtonLabel>Review</ButtonLabel>
        </Button>
      ) : (
        <Button
          $lightnessOffset
          render={<LabLink to={target.to} scenario={target.scenario} />}
          className={sheetAction}
        >
          <ButtonLabel>Open run</ButtonLabel>
        </Button>
      )}
    </Sheet>
  );
}

export interface WaitingPullSkeletonProps {
  /** The number from the address. It shows at once, before any data. */
  number: number;
  repository: string;
  /** A still shape under an `ErrorBand`. */
  still?: boolean;
  /** The `ErrorBand` of a failed load. It lies over the sheet, under the title. */
  band?: ReactNode;
}

/**
 * The shape of the page before the pull request loads. The number is the
 * only fact that the address holds, so it shows at 0 ms with the GitHub
 * button. Blocks hold the place of the title, the commit, and the sheet.
 */
export function WaitingPullSkeleton({ number, repository, still, band }: WaitingPullSkeletonProps) {
  return (
    <>
      <PageTitle
        prefix={`#${number}`}
        className={titleRow}
        meta={<SkeletonLine soft still={still} className="w-36" />}
        actions={<GitHubButton repository={repository} number={number} />}
      >
        {/* A span, so the block can lie in the heading after the number. */}
        <Skeleton
          still={still}
          render={<span />}
          className="inline-block h-[0.75em] w-48 align-baseline"
        />
      </PageTitle>
      {band ? (
        <div className="grid min-w-0 gap-2">
          {band}
          <WaitingSheetSkeleton still={still} />
        </div>
      ) : (
        <WaitingSheetSkeleton still={still} />
      )}
    </>
  );
}

interface WaitingSheetSkeletonProps {
  still?: boolean;
}

function WaitingSheetSkeleton({ still }: WaitingSheetSkeletonProps) {
  return (
    <Sheet aria-hidden className={sheetRow}>
      {/* The box of a status pill. */}
      <Skeleton still={still} $rounded="full" $forceRounded className="h-5.5 w-24" />
      <SkeletonLine soft still={still} className="w-28" />
      {/* The padding and the line box of the button that replaces it. */}
      <Skeleton still={still} $rounded="md" $p={2} className={cx(sheetAction, "w-24")}>
        <div className="h-lh" />
      </Skeleton>
    </Sheet>
  );
}
