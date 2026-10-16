// The header of the review page, as the lab page has it: the way back, the
// run, the screenshot on the stage, and the progress of the review. The
// facts of the run (commit, attempt, baseline) are in the popover of the run.

import { Link } from "@tanstack/react-router";
import { cx } from "clava";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  GitBranch,
  GitPullRequest,
  PanelLeft,
} from "lucide-react";
import type { ReactNode } from "react";
import { useAppSession } from "../app-session.tsx";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../components/ariakit/components/button.ariakit.react.tsx";
import { Heading } from "../components/ariakit/components/heading.ariakit.react.tsx";
import {
  Popover,
  PopoverDisclosure,
  PopoverHeading,
  PopoverProvider,
} from "../components/ariakit/components/popover.ariakit.react.tsx";
import { Separator } from "../components/ariakit/components/separator.ariakit.react.tsx";
import {
  ShellHeader,
  ShellHeaderCenter,
  ShellHeaderEnd,
  ShellHeaderStart,
} from "../components/ariakit/components/shell.ariakit.react.tsx";
import { TextFrame } from "../components/ariakit/components/text-frame.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { Hint, IconButton } from "../components/kit/controls.tsx";
import { formatCount, shortSha } from "../components/kit/format.ts";
import { ReviewBar } from "../components/kit/run-row.tsx";
import type { SessionItem } from "../components/kit/session.ts";
import { getExternalLinkProps } from "../components/kit/shell.tsx";
import { iconStroke, mono, overlayRoot, secondary, tertiary } from "../components/kit/tokens.ts";
import { UserMenu } from "../components/user-menu.tsx";
import type { ReviewModel } from "./model.ts";
import { getClosedWords, getRunProgress } from "./run-words.ts";

export interface RunIdentity {
  /** The pull request number, when the run has one. */
  number: number | null;
  /** The pull request title. Null when the run has none. */
  title: string | null;
  /** `#7751`, `main`, or `Merge queue`. */
  short: string;
  /** The words of the hidden heading. */
  full: string;
}

/**
 * The name of a run. The service sends the pull request number and title in
 * the run title: `#7751 · Fix the dialog focus`.
 */
export function getRunIdentity(run: ReviewModel["run"]): RunIdentity {
  const match = /^#(\d+)(?: · (.+))?$/.exec(run.title ?? "");
  const number = match?.[1] ? Number(match[1]) : null;
  // A title without a number is the whole title.
  const title = match ? (match[2] ?? null) : (run.title ?? null);
  const kindWords = { main: "Main run", pull_request: "Pull request", merge_group: "Merge queue" };
  const short = number != null ? `#${number}` : run.kind === "main" ? "main" : kindWords[run.kind];
  const full = title
    ? `${short} ${title}`
    : number != null
      ? `${short} Pull request`
      : kindWords[run.kind];
  return { number, title, short, full };
}

/** The way back to the Queue: the first control of the header. */
function QueueButton() {
  return (
    <Hint label="Queue">
      <Button aria-label="Queue" render={<Link to="/" />}>
        <ButtonSlot>
          <ArrowLeft strokeWidth={iconStroke} />
        </ButtonSlot>
      </Button>
    </Hint>
  );
}

interface FactProps {
  label: string;
  children: ReactNode;
}

function Fact({ label, children }: FactProps) {
  return (
    <>
      <Text render={<dt />} className={secondary}>
        {label}
      </Text>
      <dd className="flex min-w-0 items-center gap-1.5">{children}</dd>
    </>
  );
}

interface RunCrumbProps {
  model: ReviewModel;
}

/** The name of the run. Its popover holds the facts that leave the chrome. */
function RunCrumb({ model }: RunCrumbProps) {
  const { run } = model;
  const identity = getRunIdentity(run);
  const repository = run.repository ? `https://github.com/${run.repository}` : null;
  const KindIcon = identity.number == null ? GitBranch : GitPullRequest;
  return (
    <PopoverProvider placement="bottom-start">
      <PopoverDisclosure aria-label={`Run ${identity.full}`} className="min-w-0">
        <ButtonSlot>
          <KindIcon strokeWidth={iconStroke} />
        </ButtonSlot>
        <ButtonLabel $truncate className="min-w-0">
          <Text className={cx(mono, "font-medium")}>{identity.short}</Text>
          {identity.title && (
            <Text className="ms-2 font-normal @max-3xl/shell:hidden">{identity.title}</Text>
          )}
        </ButtonLabel>
        <ButtonSlot $size="sm" $ink={60}>
          <ChevronDown strokeWidth={2} />
        </ButtonSlot>
      </PopoverDisclosure>
      <Popover
        portal
        unmountOnHide
        $rounded="xl"
        $p={3}
        className={cx(overlayRoot, "grid w-80 gap-3")}
      >
        <PopoverHeading className="text-sm font-semibold text-pretty">
          {identity.title ?? identity.full}
        </PopoverHeading>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
          <Fact label="Commit">
            <Text className={mono}>{shortSha(run.testedSha)}</Text>
          </Fact>
          <Fact label="Attempt">
            <Text className="tabular-nums">{run.attempt}</Text>
          </Fact>
          <Fact label="Baseline">
            <Text className="tabular-nums">{model.baselineRevision}</Text>
          </Fact>
        </dl>
        {repository && (
          <>
            <Separator $gap={0} />
            <div className="grid justify-items-start">
              {identity.number != null && (
                <Button
                  $size="sm"
                  render={<a {...getExternalLinkProps(`${repository}/pull/${identity.number}`)} />}
                >
                  <ButtonSlot>
                    <ArrowUpRight strokeWidth={iconStroke} />
                  </ButtonSlot>
                  <ButtonLabel>Open pull request</ButtonLabel>
                </Button>
              )}
              <Button
                $size="sm"
                render={<a {...getExternalLinkProps(`${repository}/commit/${run.testedSha}`)} />}
              >
                <ButtonSlot>
                  <ArrowUpRight strokeWidth={iconStroke} />
                </ButtonSlot>
                <ButtonLabel>Open commit</ButtonLabel>
              </Button>
            </div>
          </>
        )}
      </Popover>
    </PopoverProvider>
  );
}

/** The part of a screenshot key between the family and the leaf, as a note. */
function getGroupNote(item: SessionItem) {
  const { group } = item;
  if (!group) return null;
  if (group === "page") return null;
  return group.replace(/\/page$/, "");
}

export interface ScreenshotStepperProps {
  /** The screenshot on the stage. Null when the page shows no screenshot. */
  item: SessionItem | null;
  /** The family label of the list, without the prefix that most families share. */
  family?: string | null;
  /** The position in the order of Up and Down from 0, or -1. */
  position: number;
  count: number;
  listOpen: boolean;
  onListOpenChange(open: boolean): void;
  /** The id of the list that the list button shows and hides. */
  listId?: string;
  onStep(step: 1 | -1): void;
  /** False when the keys of the page are off. Then the hints show no key. */
  shortcuts: boolean;
  className?: string;
}

/**
 * Names the screenshot on the stage and steps through the list. It repeats
 * Up and Down for the pointer.
 */
export function ScreenshotStepper({
  item,
  family,
  position,
  count,
  listOpen,
  onListOpenChange,
  listId,
  onStep,
  shortcuts,
  className,
}: ScreenshotStepperProps) {
  const note = item ? getGroupNote(item) : null;
  const familyLabel = family ?? item?.family;
  const keys = (key: string) => (shortcuts ? [key] : undefined);
  return (
    <div className={cx("flex max-w-full min-w-0 items-center gap-1", className)}>
      <IconButton
        label={listOpen ? "Hide list" : "Show list"}
        shortcut={keys("[")}
        aria-expanded={listOpen}
        aria-controls={listId}
        aria-keyshortcuts={shortcuts ? "[" : undefined}
        icon={<PanelLeft strokeWidth={iconStroke} />}
        onClick={() => onListOpenChange(!listOpen)}
      />
      {item && (
        // The two steps are side by side and before the name, so they stay
        // in place when the name changes its length.
        <span className="flex flex-none">
          <IconButton
            label="Previous screenshot"
            shortcut={keys("↑")}
            disabled={position <= 0}
            icon={<ChevronUp strokeWidth={iconStroke} />}
            onClick={() => onStep(-1)}
          />
          <IconButton
            label="Next screenshot"
            shortcut={keys("↓")}
            // Outside the order (-1), Next opens its first screenshot.
            disabled={!count || position >= count - 1}
            icon={<ChevronDown strokeWidth={iconStroke} />}
            onClick={() => onStep(1)}
          />
        </span>
      )}
      {item && (
        <Heading className="mt-0 mb-0 flex min-w-0 items-baseline gap-2 px-1 text-base font-semibold">
          {/* The name tells two screenshots apart, so the family gives way
              first when the two do not fit. */}
          <Text
            className={cx(
              tertiary,
              "min-w-0 shrink-[9999] truncate text-sm font-normal @max-xl/shell:hidden",
            )}
          >
            {note ? `${familyLabel} · ${note}` : familyLabel}
          </Text>
          <span className="min-w-0 truncate">{item.label}</span>
        </Heading>
      )}
      {item && (
        <Text className={cx(tertiary, "flex-none px-1 tabular-nums")}>
          {`${position < 0 ? "–" : formatCount(position + 1)} / ${formatCount(count)}`}
        </Text>
      )}
    </div>
  );
}

// The bar is 6em wide, so it follows the size of the text.
const barBox = "block w-24 flex-none self-center";

interface RunProgressProps {
  model: ReviewModel;
  className?: string;
}

/**
 * The run progress of the header: the review bar of a run row and one count.
 * The bar has the approved share, the rejected share, and the open rest.
 */
function RunProgress({ model, className }: RunProgressProps) {
  const { label, shares } = getRunProgress(model);
  return (
    <TextFrame
      $p={2}
      className={cx(
        "review-run-progress flex flex-none items-center gap-3 font-medium tabular-nums",
        className,
      )}
    >
      {shares && (
        <span className={barBox}>
          <ReviewBar shares={shares} render={<span />} />
        </span>
      )}
      <span>{label}</span>
    </TextFrame>
  );
}

interface StatusLinkProps {
  /** The open alerts. */
  count: number;
}

/** The way to the alerts, with the count that the Status link of the list pages has. */
function StatusLink({ count }: StatusLinkProps) {
  return (
    <Button $ink={70} render={<Link to="/status" />}>
      <ButtonLabel>Status</ButtonLabel>
      {/* A count of 0 shows nothing, as in the nav of the list pages. */}
      {count > 0 && (
        <ButtonSlot $kind="badge" $layer="danger" aria-label={formatCount(count, "open alert")}>
          {formatCount(count)}
        </ButtonSlot>
      )}
    </Button>
  );
}

export interface RunHeaderProps {
  /** The run model of the first response. */
  model: ReviewModel;
  /** The screenshot stepper of a wide window. A narrow window has it above the panel. */
  stepper: ReactNode;
}

/**
 * The header of the review page: the way back, the run, the screenshot on the
 * stage, why the run closed, the count of loose comparison settings, the
 * progress of the review, the alerts, and the account.
 */
export function RunHeader({ model, stepper }: RunHeaderProps) {
  const { facts, signingOut, signOutError, signOut } = useAppSession();
  const closed = getClosedWords(model.run);
  const loose = model.run.comparisonSettings?.loose ?? 0;
  return (
    <ShellHeader
      $height="sm"
      $border={false}
      start={
        <ShellHeaderStart $shrink>
          <QueueButton />
          <RunCrumb model={model} />
        </ShellHeaderStart>
      }
      center={
        <ShellHeaderCenter $shrink className="@max-3xl/shell:hidden">
          {stepper}
        </ShellHeaderCenter>
      }
      end={
        <ShellHeaderEnd>
          {closed && (
            <Text className={cx(secondary, "review-run-closed whitespace-nowrap")}>{closed}</Text>
          )}
          {loose > 0 && (
            <Text className={cx(secondary, "whitespace-nowrap")}>
              {formatCount(loose, "capture with loose settings", "captures with loose settings")}
            </Text>
          )}
          {/* The count stays on one line, also when the header measures how
              narrow it can be. */}
          <RunProgress model={model} className="whitespace-nowrap" />
          {facts.alertCount != null && <StatusLink count={facts.alertCount} />}
          {facts.signedIn && (
            <UserMenu
              login={facts.login}
              preview={facts.preview}
              signingOut={signingOut}
              error={signOutError}
              onSignOut={() => void signOut()}
            />
          )}
        </ShellHeaderEnd>
      }
    />
  );
}
