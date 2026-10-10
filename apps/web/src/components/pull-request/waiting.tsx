import { cx } from "clava";
import { ArrowUpRight, Check, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button, ButtonLabel, ButtonSlot } from "../ariakit/components/button.ariakit.react.tsx";
import { HeadingLevel } from "../ariakit/components/heading.ariakit.react.tsx";
import { List, ListItem } from "../ariakit/components/list.ariakit.react.tsx";
import { Text } from "../ariakit/components/text.ariakit.react.tsx";
import { ErrorBand, ErrorBandButton } from "../kit/error-band.tsx";
import { shortSha } from "../kit/format.ts";
import { getExternalLinkProps, PageTitle } from "../kit/shell.tsx";
import { SkeletonLine } from "../kit/skeleton-line.tsx";
import { StatusPill } from "../kit/status.tsx";
import { EmptyState, Sheet, Skeleton } from "../kit/surfaces.tsx";
import { iconStroke, mono, secondary } from "../kit/tokens.ts";
import { getPullUrl, getWorkflowsUrl } from "./pull-data.ts";
import type { PullRead } from "./pull-data.ts";

// A long title takes a second line, and the GitHub button stays beside it.
const titleRow = "flex-nowrap!";
// Each state of the page is one row: the state at the start and the action at
// the end. In a narrow sheet the action takes a row of its own.
const sheetRow = "flex min-w-0 flex-wrap items-center gap-x-4 gap-y-3";
const sheetAction = "ms-auto flex-none";

interface GitHubButtonProps {
  repository: string;
  pullNumber: string;
}

function GitHubButton({ repository, pullNumber }: GitHubButtonProps) {
  return (
    <Button
      $size="sm"
      $border
      render={<a {...getExternalLinkProps(getPullUrl(repository, pullNumber))} />}
    >
      <ButtonLabel>GitHub</ButtonLabel>
      <ButtonSlot>
        <ArrowUpRight strokeWidth={iconStroke} />
      </ButtonSlot>
    </Button>
  );
}

interface CheckAgainProps {
  /** True while a read runs. */
  busy: boolean;
  onClick: () => void;
}

// Only a pending capture waits for an answer. A failed or closed run gets its
// next answer from a new check, which has its own link.
function CheckAgain({ busy, onClick }: CheckAgainProps) {
  return (
    <ErrorBandButton busy={busy} onClick={onClick}>
      Check again
    </ErrorBandButton>
  );
}

export interface WaitingPullProps {
  pull: PullRead;
  pullNumber: string;
  /** True while a read runs. */
  reading: boolean;
  onCheckAgain: () => void;
  /** The band of a failed later read. It lies between the title and the state. */
  band?: ReactNode;
}

/**
 * The pull request page for a run that is not ready: the title, the commit,
 * and the attempt, then one sheet with the state and one action. It lists no
 * other run. A run that is ready opens its review at once.
 */
export function WaitingPull({ pull, pullNumber, reading, onCheckAgain, band }: WaitingPullProps) {
  const { repository, title, headSha, attempt } = pull;
  return (
    <>
      <PageTitle
        // Without a title the heading has the number: `Pull request #7754`.
        prefix={title ? `#${pullNumber}` : undefined}
        className={titleRow}
        meta={
          (headSha || attempt) && (
            <span>
              {headSha && <span className={mono}>{shortSha(headSha)}</span>}
              {headSha && attempt && " · "}
              {attempt && `attempt ${attempt}`}
            </span>
          )
        }
        actions={<GitHubButton repository={repository} pullNumber={pullNumber} />}
      >
        {title ?? `Pull request #${pullNumber}`}
      </PageTitle>
      {band}
      {/* The title block holds the `h1`. */}
      <HeadingLevel>
        <PullState pull={pull} reading={reading} onCheckAgain={onCheckAgain} />
      </HeadingLevel>
    </>
  );
}

interface PullStateProps {
  pull: PullRead;
  reading: boolean;
  onCheckAgain: () => void;
}

function PullState({ pull, reading, onCheckAgain }: PullStateProps) {
  if (pull.state === "not-required") {
    return (
      <Sheet>
        <EmptyState bare $p="1rem" icon={Check} tone="success" title="No visual review needed">
          No screenshots were captured for this pull request
        </EmptyState>
      </Sheet>
    );
  }
  if (pull.state === "failed") {
    return (
      <ErrorBand
        // The state lasts until a new workflow run, so the band waits its turn.
        role="status"
        icon={TriangleAlert}
        title="Capture failed"
        detail="rerun the visual tests in CI"
        action={
          <ErrorBandButton
            icon={<ArrowUpRight strokeWidth={iconStroke} />}
            render={
              <a {...getExternalLinkProps(pull.workflowUrl ?? getWorkflowsUrl(pull.repository))} />
            }
          >
            Open workflow
          </ErrorBandButton>
        }
      />
    );
  }
  if (pull.state === "replaced") {
    return (
      <Sheet className={sheetRow}>
        <StatusPill status="replaced" />
        <Text className={secondary}>The run closed before its screenshots were complete.</Text>
      </Sheet>
    );
  }
  return <Steps checkAgain={<CheckAgain busy={reading} onClick={onCheckAgain} />} />;
}

interface StepsProps {
  checkAgain: ReactNode;
}

// The three steps to a review. The page opens the review when the run is
// ready. The answer has no count, so half a ring says that the capture runs.
function Steps({ checkAgain }: StepsProps) {
  return (
    <Sheet className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      {/* The steps are one row: the list is a grid, so it flows in columns.
          A row of a list keeps room before its marker, so the list starts
          that much earlier and the first marker lies on the sheet padding. */}
      <List
        aria-label="Steps"
        className="-ms-1.5 grid-flow-col auto-cols-max justify-start gap-x-6"
      >
        <ListItem progress={0.5}>Capture</ListItem>
        <ListItem checked={false}>Compare</ListItem>
        <ListItem checked={false}>Review</ListItem>
      </List>
      <div className="flex items-center gap-3">
        <Text className={secondary}>Opens when ready</Text>
        {checkAgain}
      </div>
    </Sheet>
  );
}

export interface WaitingPullSkeletonProps {
  /** The number from the address. It shows at once, before any data. */
  pullNumber: string;
  /** The repository, when the page already knows it. Without it, no GitHub button. */
  repository?: string;
  /** A still shape under an `ErrorBand`. */
  still?: boolean;
  /** The `ErrorBand` of a failed load. It lies over the sheet, under the title. */
  band?: ReactNode;
}

/**
 * The shape of the page before the pull request loads. The number is the
 * only fact that the address holds, so it shows at once. Blocks hold the
 * place of the title, the commit, and the sheet.
 */
export function WaitingPullSkeleton({
  pullNumber,
  repository,
  still,
  band,
}: WaitingPullSkeletonProps) {
  return (
    <>
      <PageTitle
        prefix={`#${pullNumber}`}
        className={titleRow}
        meta={<SkeletonLine soft still={still} className="w-36" />}
        actions={
          repository ? <GitHubButton repository={repository} pullNumber={pullNumber} /> : undefined
        }
      >
        <span className="sr-only"> Pull request</span>
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
