// The one row of a run, for the Queue, History, and the pull request sheet:
// two lines with the review progress at the end (UI-RUN-ROW, `progress`). A
// row has only the fields that its run has, so one design serves the three
// data modes.

import { cx } from "clava";
import { Fragment } from "react";
import type { ReactNode } from "react";
import {
  Button,
  ButtonContent,
  ButtonDescription,
  ButtonGlider,
  ButtonGroup,
  ButtonLabel,
  ButtonSlot,
} from "../../../components/ariakit/components/button.ariakit.react.tsx";
import type { ButtonProps } from "../../../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../../../components/ariakit/components/frame.ariakit.react.tsx";
import type { FrameProps } from "../../../components/ariakit/components/frame.ariakit.react.tsx";
import { Progress } from "../../../components/ariakit/components/progress.ariakit.react.tsx";
import { Text } from "../../../components/ariakit/components/text.ariakit.react.tsx";
import { TextFrame } from "../../../components/ariakit/components/text-frame.ariakit.react.tsx";
import type { button } from "../../../components/ariakit/styles/button.ts";
import {
  formatCount,
  formatDateTime,
  formatRelativeTime,
  shortSha,
} from "../../../fixtures/index.ts";
import type { Run, RunClosedReason } from "../../../fixtures/index.ts";
import { LabLink } from "../../../lab/navigation.tsx";
import { getRunTarget } from "./runs.tsx";
import { getRoleText, getRunResultName, statusStyles } from "./status.tsx";
import type { StatusName } from "./status.tsx";
import { Sheet, Skeleton } from "./surfaces.tsx";
import { mono } from "./tokens.ts";

/** One part of the state text. A part with `danger` has the danger color. */
export interface RunStatusPart {
  text: string;
  danger?: boolean;
}

export interface RunRowProgress {
  done: number;
  total: number;
  /** From 0 to 1. */
  ratio: number;
}

/** What a run row shows, derived from the fields that the run has. */
export interface RunRowModel {
  run: Run;
  /** The status of the leading disc. A closed run shows its last result. */
  status: StatusName;
  /** `#7752` for a pull request run, and `main` for a main run. */
  reference: string;
  /** The pull request title, or the first line of the commit message. */
  title: string | null;
  /** The 7-character commit. */
  sha: string;
  /** Present from attempt 2. */
  attempt: number | null;
  author: string | null;
  /** True for a run that waits for a person. */
  review: boolean;
  /** Variants that still need a verdict: `pending` without the rejected ones. */
  open: number;
  rejected: number;
  /** Null without `counts`. */
  approved: number | null;
  /** Changed, added, and removed variants. Null without `counts`. */
  changes: number | null;
  /** Capture or comparison progress. Null without `progress`. */
  progress: RunRowProgress | null;
  /** The sentence of a failed run. Null when the data has none. */
  error: string | null;
  /** True for a run that a newer run replaced. Its row reads softer. */
  replaced: boolean;
  /** The state text at the end of the row. */
  parts: RunStatusPart[];
}

// A closed run says why it is closed (D-UX-04). Its disc has its last result.
const closedWords: Record<RunClosedReason, string> = {
  replaced: "Replaced",
  "pull-request-closed": "Closed",
  expired: "Expired",
  "baseline-retired": "Retired",
};

function getProgress(run: Run): RunRowProgress | null {
  const { progress } = run;
  if (!progress) return null;
  if (run.state !== "incomplete" && run.state !== "comparing") return null;
  const done = run.state === "incomplete" ? progress.captured : progress.compared;
  const total = progress.expected;
  if (total <= 0) return null;
  return { done, total, ratio: Math.min(1, done / total) };
}

interface PartsSource {
  run: Run;
  status: StatusName;
  review: boolean;
  open: number;
  rejected: number;
  changes: number | null;
  progress: RunRowProgress | null;
}

function getParts({ run, status, review, open, rejected, changes, progress }: PartsSource) {
  const word = statusStyles[status].label;
  if (run.state === "superseded") {
    return [{ text: run.closedReason ? closedWords[run.closedReason] : word }];
  }
  if (review) {
    const parts: RunStatusPart[] = [];
    // A run whose open variants are all rejected has no `0 changes` part.
    if (open > 0 || rejected === 0) {
      parts.push({ text: formatCount(open, "change") });
    }
    if (rejected > 0) {
      parts.push({ text: `${formatCount(rejected)} rejected`, danger: true });
    }
    return parts;
  }
  if (progress) {
    return [{ text: `${word} ${formatCount(progress.done)} of ${formatCount(progress.total)}` }];
  }
  if (status === "passed" && changes) {
    return [{ text: `${word} · ${formatCount(changes, "change")}` }];
  }
  return [{ text: word }];
}

/** Builds the row of one run from the fields that the run has. */
export function getRunRow(run: Run): RunRowModel {
  const status = getRunResultName(run);
  const closed = run.state === "superseded";
  const review = !closed && (status === "needs-review" || status === "rejected");
  const rejected = review ? run.rejected : 0;
  // `pending` counts the rejected variants too.
  const open = review ? Math.max(0, run.pending - run.rejected) : 0;
  const progress = getProgress(run);
  const { counts } = run;
  const changes = counts ? counts.changed + counts.added + counts.removed : null;
  return {
    run,
    status,
    reference: run.pullRequestNumber == null ? "main" : `#${run.pullRequestNumber}`,
    title: run.title ?? run.commitMessage ?? null,
    sha: shortSha(run.testedSha),
    attempt: run.attempt > 1 ? run.attempt : null,
    author: run.author?.login ?? null,
    review,
    open,
    rejected,
    approved: counts ? counts.approved : null,
    changes,
    progress,
    error: !closed && run.error ? run.error : null,
    replaced: closed && (run.closedReason ?? "replaced") === "replaced",
    parts: getParts({ run, status, review, open, rejected, changes, progress }),
  };
}

/** The state text as one string, for example `17 changes · 1 rejected`. */
export function getRunStatusText(row: Pick<RunRowModel, "parts">): string {
  return row.parts.map((part) => part.text).join(" · ");
}

/** The parts of a review bar: approved, rejected, and open variants. */
export interface ReviewShares {
  approved: number;
  rejected: number;
  open: number;
  total: number;
  /** For example `14 approved, 1 rejected, 17 open`. */
  label: string;
}

/**
 * The shares of a run that waits for a person. Without `counts` the run has
 * no approved number, and the bar has two parts: rejected and open.
 */
export function getReviewShares(
  row: Pick<RunRowModel, "review" | "approved" | "rejected" | "open">,
): ReviewShares | null {
  if (!row.review) return null;
  const approved = row.approved ?? 0;
  const total = approved + row.rejected + row.open;
  if (total <= 0) return null;
  const words = [`${formatCount(row.rejected)} rejected`, `${formatCount(row.open)} open`];
  if (row.approved != null) {
    words.unshift(`${formatCount(approved)} approved`);
  }
  return { approved, rejected: row.rejected, open: row.open, total, label: words.join(", ") };
}

export interface ReviewBarProps extends Omit<FrameProps, "children"> {
  shares: ReviewShares;
}

/**
 * How far the review of a run is: the approved share, the rejected share, and
 * the open rest as the empty track. It has the track of the stock `Progress`.
 * @example
 * <ReviewBar shares={{ approved: 14, rejected: 1, open: 17, total: 32, label }} />
 */
export function ReviewBar({ shares, className, ...props }: ReviewBarProps) {
  return (
    <Frame
      role="img"
      aria-label={shares.label}
      $lightnessOffset={2}
      $border
      $borderType="inset"
      $edgeWeight="adaptive"
      $rounded="full"
      $forceRounded
      className={cx("flex h-1.5 w-full overflow-clip", className)}
      {...props}
    >
      {shares.approved > 0 && (
        <Frame
          $layer="success"
          $contrast={50}
          className="min-w-1 basis-0"
          style={{ flexGrow: shares.approved }}
        />
      )}
      {shares.rejected > 0 && (
        <Frame
          $layer="danger"
          $contrast={50}
          className="min-w-1 basis-0"
          style={{ flexGrow: shares.rejected }}
        />
      )}
      {shares.open > 0 && <span className="basis-0" style={{ flexGrow: shares.open }} />}
    </Frame>
  );
}

// The text takes the free width and the end block has a fixed width, so the
// bars align down the list. In a narrow container the end block goes under
// the identity line and takes the full width.
const contentGrid = cx(
  "grid items-center gap-x-6",
  "grid-cols-[minmax(0,1fr)_auto]",
  "@max-md:grid-cols-1 @max-md:gap-y-0",
);

const endBlock = cx(
  // The width is in em, so the longest state text fits at every density.
  "col-start-2 row-span-2 row-start-1 grid w-[14em] gap-1.5 text-end",
  "@max-md:col-start-1 @max-md:row-span-1 @max-md:row-start-3 @max-md:mt-2 @max-md:w-full @max-md:text-start",
);

interface AgeProps {
  /** Milliseconds since the epoch. */
  value: number;
}

function Age({ value }: AgeProps) {
  return (
    <time dateTime={new Date(value).toISOString()} title={formatDateTime(value)}>
      {formatRelativeTime(value)}
    </time>
  );
}

interface RowPartProps {
  row: RunRowModel;
}

function RowLabel({ row }: RowPartProps) {
  if (row.title) return row.title;
  // Without a title, the number is the label of the row.
  if (row.reference !== "main") return row.reference;
  return (
    <>
      main <span className={mono}>{row.sha}</span>
    </>
  );
}

interface IdentityPart {
  key: string;
  node: ReactNode;
  /** A narrow container has no room for this part. */
  wideOnly?: boolean;
}

// The parts of the identity line, with a middle dot between them.
function Identity({ row }: RowPartProps) {
  const parts: IdentityPart[] = [];
  if (row.title) {
    parts.push({ key: "reference", node: row.reference });
  }
  if (row.author) {
    // The first part has no dot before it, so it always stays.
    parts.push({ key: "author", node: row.author, wideOnly: parts.length > 0 });
  }
  if (row.attempt != null) {
    parts.push({ key: "attempt", node: `attempt ${row.attempt}` });
  }
  parts.push({ key: "age", node: <Age value={row.run.createdAt} /> });
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {/* The line can wrap only before a dot. */}
          {index > 0 && " "}
          <span className={cx("whitespace-nowrap", part.wideOnly && "@max-md:hidden")}>
            {index > 0 && <span aria-hidden>· </span>}
            {index > 0 && <span className="sr-only">, </span>}
            {part.node}
          </span>
        </Fragment>
      ))}
    </>
  );
}

function StatusText({ row }: RowPartProps) {
  return (
    <Text className="tabular-nums ak-ink-70">
      {row.parts.map((part, index) => (
        <span key={part.text} className="whitespace-nowrap">
          {index > 0 && <span aria-hidden> · </span>}
          {index > 0 && <span className="sr-only">, </span>}
          {part.danger ? <Text $text="danger">{part.text}</Text> : part.text}
        </span>
      ))}
    </Text>
  );
}

function EndBlock({ row }: RowPartProps) {
  if (row.error) {
    return (
      // An error sentence is longer than a state text, so its block is wider
      // and the sentence takes the two lines of the row. It never takes more
      // than two fifths of the row: the title comes first.
      <span
        className={cx(endBlock, "w-auto max-w-[min(28em,40cqw)] min-w-[14em] @max-md:max-w-none")}
      >
        <Text $text="danger" title={row.error} className="line-clamp-2 text-balance">
          {row.error}
        </Text>
      </span>
    );
  }
  const shares = getReviewShares(row);
  return (
    <span className={endBlock}>
      {shares && <ReviewBar shares={shares} />}
      {row.progress && (
        <Progress aria-label={getRunStatusText(row)} value={row.progress.ratio} $thickness={1.5} />
      )}
      <StatusText row={row} />
    </span>
  );
}

// The state word of the disc, for a row whose visible text does not say it:
// a count, an error sentence, or the reason of a closed run.
function getHiddenWord(row: RunRowModel): string | null {
  const word = statusStyles[row.status].label;
  if (row.error) return word;
  // A closed run without a last result has the arrow of `Replaced`. Its
  // reason at the end of the row is the state, also when it is `Closed`.
  if (row.run.state === "superseded" && row.status === "replaced") return null;
  return getRunStatusText(row).startsWith(word) ? null : word;
}

export type RunRowProps = Omit<ButtonProps, "recipe" | "children"> & {
  run: Run;
  /** Soft ink, for an earlier run that lies under the newest run of its pull request. */
  soft?: boolean;
};

/**
 * One run as a link to its page: the status as a tinted disc, the title, the
 * identity line (`#7753 · attempt 2 · 23 min ago`), and at the end the state
 * text. A run to review has the review bar over its count: two parts with
 * the data of today, and three when the run has `counts`. A running run has
 * the stock `Progress` only when the data has the progress, and a failed run
 * its error sentence only when the data has one. Put the rows in a
 * `RunRowList`.
 * @example
 * <RunRowList aria-label="Runs to review">
 *   {runs.map((run) => (
 *     <RunRow key={run.id} run={run} />
 *   ))}
 * </RunRowList>
 */
export function RunRow({ run, soft, className, ...props }: RunRowProps) {
  const row = getRunRow(run);
  const { role, icon: Icon, turns } = statusStyles[row.status];
  const quiet = soft || row.replaced;
  const hiddenWord = getHiddenWord(row);
  return (
    <Button<typeof button>
      $p={3}
      title={row.title ?? undefined}
      render={<LabLink {...getRunTarget(run)} />}
      className={cx("w-full justify-start text-start", className)}
      {...props}
    >
      {/* The compact pill: the tint of the status pill as a disc. The text at
          the end of the row says the state. */}
      <ButtonSlot
        $kind="avatar"
        $size="lg"
        $rowSpan={2}
        $layer={getRoleText(role) ?? true}
        $mix={role === "neutral" ? undefined : 15}
      >
        <Text $text={getRoleText(role)} className={cx("flex", role === "neutral" && "ak-ink-60")}>
          <Icon
            aria-hidden
            className={cx(
              "size-[1.125em]",
              turns && "animate-spin [animation-duration:2.4s] motion-reduce:animate-none",
            )}
          />
        </Text>
      </ButtonSlot>
      <ButtonContent $orientation="unset" className={contentGrid}>
        <ButtonLabel
          className={cx("@max-md:line-clamp-2 @max-md:whitespace-normal", quiet && "ak-ink-60")}
        >
          {hiddenWord && <span className="sr-only">{`${hiddenWord}: `}</span>}
          <RowLabel row={row} />
        </ButtonLabel>
        <ButtonDescription $truncate={false} className={cx("tabular-nums", quiet && "ak-ink-50")}>
          <Identity row={row} />
        </ButtonDescription>
        <EndBlock row={row} />
      </ButtonContent>
    </Button>
  );
}

export interface RunRowListProps extends Omit<FrameProps, "children"> {
  /** `RunRow` elements. */
  children: ReactNode;
}

/**
 * One group of run rows: a sheet around a vertical group with a hover and a
 * focus glider. The sheet is a size container, so a row follows its width
 * and not the viewport. Name the group with `aria-label`.
 * @example
 * <RunRowList aria-label="Running">…</RunRowList>
 */
export function RunRowList({
  children,
  className,
  "aria-label": label,
  ...props
}: RunRowListProps) {
  return (
    <Sheet $p={1} className={cx("@container min-w-0", className)} {...props}>
      <ButtonGroup role="group" aria-label={label} $layout="vertical" $p="none" className="w-full">
        {children}
        <ButtonGlider $state="hover" />
        <ButtonGlider $state="focus" />
      </ButtonGroup>
    </Sheet>
  );
}

const titleWidths = ["w-1/2", "w-1/3", "w-2/5"];

export interface RunRowSkeletonProps extends Omit<FrameProps, "children"> {
  /** The number of rows. Default: 3. */
  count?: number;
  /** A still shape under an `ErrorBand`: nothing loads while the error shows. */
  still?: boolean;
}

/**
 * The shape of a `RunRowList` before its runs load: the same sheet, with one
 * row of blocks for each run, each with the height of a row.
 * @example
 * <RunRowSkeleton count={3} />
 */
export function RunRowSkeleton({ count = 3, still, className, ...props }: RunRowSkeletonProps) {
  return (
    <Sheet $p={1} aria-hidden className={cx("@container grid min-w-0", className)} {...props}>
      {Array.from({ length: count }, (_, index) => (
        // The gap is the gap of a control, so the blocks start where the text
        // of a row starts.
        <TextFrame key={index} $p={3} className="flex gap-[calc(var(--px)-0.15em)]">
          <ButtonSlot $kind="avatar" $size="lg" $rowSpan={2} $layer="transparent">
            <Skeleton still={still} $rounded="full" $forceRounded className="size-full" />
          </ButtonSlot>
          <span className={cx(contentGrid, "flex-1")}>
            <span className="flex h-lh items-center">
              <Skeleton
                still={still}
                className={cx("h-3.5", titleWidths[index % titleWidths.length])}
              />
            </span>
            {/* Two lines of 1lh are the height of the title and the identity
                line of a row, so the list does not move when the runs come. */}
            <span className="flex h-lh items-center">
              <Skeleton soft still={still} className="h-2.5 w-48 max-w-full" />
            </span>
            <span className={endBlock}>
              <span className="flex h-lh items-center justify-end @max-md:justify-start">
                <Skeleton soft still={still} className="h-3 w-20" />
              </span>
            </span>
          </span>
        </TextFrame>
      ))}
    </Sheet>
  );
}
