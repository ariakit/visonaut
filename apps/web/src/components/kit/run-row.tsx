// The one row of a run, for the Queue, History, and the pull request page:
// two lines with the review progress at the end. A row has only the fields
// that `GET /api/runs` sends.

import { Link } from "@tanstack/react-router";
import { runClosedReasonWords } from "@visonaut/protocol";
import { cx } from "clava";
import { Fragment } from "react";
import type { ReactNode } from "react";
import type { DashboardRun } from "../../api/dashboard.ts";
import {
  Button,
  ButtonContent,
  ButtonDescription,
  ButtonGlider,
  ButtonGroup,
  ButtonLabel,
  ButtonSlot,
} from "../ariakit/components/button.ariakit.react.tsx";
import type { ButtonProps } from "../ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../ariakit/components/frame.ariakit.react.tsx";
import type { FrameProps } from "../ariakit/components/frame.ariakit.react.tsx";
import { Text } from "../ariakit/components/text.ariakit.react.tsx";
import { TextFrame } from "../ariakit/components/text-frame.ariakit.react.tsx";
import type { button } from "../ariakit/styles/button.ts";
import { formatCount, formatDateTime, formatRelativeTime, shortSha } from "./format.ts";
import { getRoleText, getRunResultName, statusStyles } from "./status.tsx";
import type { StatusName } from "./status.tsx";
import { Sheet, Skeleton } from "./surfaces.tsx";
import { mono } from "./tokens.ts";

/** One part of the state text. A part with `danger` has the danger color. */
export interface RunStatusPart {
  text: string;
  danger?: boolean;
}

/** What a run row shows, derived from the fields that the run has. */
export interface RunRowModel {
  run: DashboardRun;
  /** The status of the leading disc. A closed run shows its last result. */
  status: StatusName;
  /** `#7752` for a pull request run, and `main` or `merge queue` for each other run. */
  reference: string;
  /** The pull request title. A run of an older row has none. */
  title: string | null;
  /** The 7-character commit. */
  sha: string;
  /** Present from attempt 2. */
  attempt: number | null;
  /** True for a run that waits for a person. */
  review: boolean;
  /** Variants that still need a verdict: `pending` without the rejected ones. */
  open: number;
  rejected: number;
  approved: number;
  /** True for a run that a newer run replaced. Its row reads softer. */
  replaced: boolean;
  /** The state text at the end of the row. */
  parts: RunStatusPart[];
}

/** The one name of each kind of run. */
export const runKindWords: Record<DashboardRun["kind"], string> = {
  main: "Main",
  pull_request: "Pull request",
  merge_group: "Merge queue",
};

/** `#7754` for a pull request run, and the kind in lower case for each other run. */
export function getRunReference(run: Pick<DashboardRun, "kind" | "pullRequestNumber">) {
  if (run.pullRequestNumber != null) {
    return `#${run.pullRequestNumber}`;
  }
  return runKindWords[run.kind].toLowerCase();
}

interface PartsSource {
  run: DashboardRun;
  status: StatusName;
  review: boolean;
  open: number;
  rejected: number;
}

function getParts({ run, status, review, open, rejected }: PartsSource): RunStatusPart[] {
  const word = statusStyles[status].label;
  // A closed run says why it closed. Its disc has its last result.
  if (run.state === "superseded") {
    return [{ text: run.closedReason ? runClosedReasonWords[run.closedReason] : word }];
  }
  if (!review) {
    return [{ text: word }];
  }
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

/** Builds the row of one run from the fields that the run has. */
export function getRunRow(run: DashboardRun): RunRowModel {
  const status = getRunResultName(run);
  const closed = run.state === "superseded";
  const review = !closed && (status === "needs-review" || status === "rejected");
  const rejected = review ? run.rejected : 0;
  // `pending` counts the rejected variants too.
  const open = review ? Math.max(0, run.pending - run.rejected) : 0;
  return {
    run,
    status,
    reference: getRunReference(run),
    title: run.title ?? null,
    sha: shortSha(run.testedSha),
    attempt: run.attempt > 1 ? run.attempt : null,
    review,
    open,
    rejected,
    approved: review ? run.approved : 0,
    replaced: closed && (run.closedReason ?? "replaced") === "replaced",
    parts: getParts({ run, status, review, open, rejected }),
  };
}

/** The state text as one string, for example `17 changes · 1 rejected`. */
export function getRunStatusText(row: Pick<RunRowModel, "parts">) {
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

/** The shares of a run that waits for a person. Each other run has none. */
export function getReviewShares(
  row: Pick<RunRowModel, "review" | "approved" | "rejected" | "open">,
): ReviewShares | null {
  if (!row.review) return null;
  const total = row.approved + row.rejected + row.open;
  if (total <= 0) return null;
  const label = [
    `${formatCount(row.approved)} approved`,
    `${formatCount(row.rejected)} rejected`,
    `${formatCount(row.open)} open`,
  ].join(", ");
  return { approved: row.approved, rejected: row.rejected, open: row.open, total, label };
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

export interface RunAgeProps {
  /** Milliseconds since the epoch. */
  value: number;
}

/**
 * The age of a run as a `time` element: `23 min ago`, with the date and the
 * time as its title.
 * @example
 * <RunAge value={run.createdAt} />
 */
export function RunAge({ value }: RunAgeProps) {
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
  if (row.title) {
    return row.title;
  }
  // Without a title, the number is the label of the row.
  if (row.run.pullRequestNumber != null) {
    return row.reference;
  }
  return (
    <>
      {row.reference} <span className={mono}>{row.sha}</span>
    </>
  );
}

interface IdentityPart {
  key: string;
  node: ReactNode;
}

// The parts of the identity line, with a middle dot between them.
function Identity({ row }: RowPartProps) {
  const parts: IdentityPart[] = [];
  if (row.title) {
    parts.push({ key: "reference", node: row.reference });
  }
  if (row.attempt != null) {
    parts.push({ key: "attempt", node: `attempt ${row.attempt}` });
  }
  parts.push({ key: "age", node: <RunAge value={row.run.createdAt} /> });
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {/* The line can wrap only before a dot. */}
          {index > 0 && " "}
          <span className="whitespace-nowrap">
            {index > 0 && <span aria-hidden>· </span>}
            {index > 0 && <span className="sr-only">, </span>}
            {part.node}
          </span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * The state text of a run, with the rejected count in the danger color:
 * `17 changes · 1 rejected`.
 */
export function RunStatusText({ row }: RowPartProps) {
  return (
    <>
      {row.parts.map((part, index) => (
        <span key={part.text} className="whitespace-nowrap">
          {index > 0 && <span aria-hidden> · </span>}
          {index > 0 && <span className="sr-only">, </span>}
          {part.danger ? <Text $text="danger">{part.text}</Text> : part.text}
        </span>
      ))}
    </>
  );
}

function EndBlock({ row }: RowPartProps) {
  const shares = getReviewShares(row);
  return (
    <span className={endBlock}>
      {shares && <ReviewBar shares={shares} />}
      <Text className="tabular-nums ak-ink-70">
        <RunStatusText row={row} />
      </Text>
    </span>
  );
}

// The state word of the disc, for a row whose visible text does not say it:
// a count, or the reason of a closed run.
function getHiddenWord(row: RunRowModel) {
  const word = statusStyles[row.status].label;
  // A closed run without a last result has the arrow of `Replaced`. Its
  // reason at the end of the row is the state, also when it is `Closed`.
  if (row.run.state === "superseded" && row.status === "replaced") return null;
  return getRunStatusText(row).startsWith(word) ? null : word;
}

export type RunRowProps = Omit<ButtonProps, "recipe" | "children"> & {
  run: DashboardRun;
  /** Soft ink, for an earlier run that lies under the newest run of its pull request. */
  soft?: boolean;
};

/**
 * One run as a link to its page: the status as a tinted disc, the title, the
 * identity line (`#7753 · attempt 2 · 23 min ago`), and at the end the state
 * text. A run to review has the review bar over its count. The link covers
 * the row, and its name has the title, the number, and the state. Put the
 * rows in a `RunRowList`.
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
      render={<Link to="/runs/$runId" params={{ runId: run.id }} />}
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
