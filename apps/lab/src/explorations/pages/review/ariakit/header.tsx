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
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { Heading } from "../../../../components/ariakit/components/heading.ariakit.react.tsx";
import {
  Popover,
  PopoverDisclosure,
  PopoverHeading,
  PopoverProvider,
} from "../../../../components/ariakit/components/popover.ariakit.react.tsx";
import { Separator } from "../../../../components/ariakit/components/separator.ariakit.react.tsx";
import {
  ShellHeader,
  ShellHeaderCenter,
  ShellHeaderEnd,
  ShellHeaderStart,
} from "../../../../components/ariakit/components/shell.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import type { ReviewSessionReady, SessionItem } from "../../../../fixtures/hooks/index.ts";
import { formatCount, formatRelativeTime, shortSha } from "../../../../fixtures/index.ts";
import type { ReviewRun } from "../../../../fixtures/index.ts";
import { LabLink } from "../../../../lab/navigation.tsx";
import { Avatar, Hint, IconButton } from "../../../kits/ariakit/controls.tsx";
import { RunProgress } from "../../../kits/ariakit/result/run-progress.tsx";
import {
  AccountMenu,
  AlertsLink,
  getExternalLinkProps,
  useWorldCounts,
} from "../../../kits/ariakit/shell.tsx";
import {
  iconStroke,
  mono,
  overlayRoot,
  secondary,
  tertiary,
} from "../../../kits/ariakit/tokens.ts";
import { getGroupNote, getRunIdentity } from "./model.ts";

/** The way back to the Queue: the first control of the header. */
export function QueueButton() {
  return (
    <Hint label="Queue">
      <Button aria-label="Queue" render={<LabLink to="inbox" scenario="busy" />}>
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
  review: ReviewRun;
}

/** The name of the run. Its popover holds the facts that leave the chrome. */
function RunCrumb({ review }: RunCrumbProps) {
  const identity = getRunIdentity(review);
  const { run, pullRequest } = review;
  const repository = `https://github.com/${run.repository}`;
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
        {/* Only the proposed API sends the author, the branch, and the time. */}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
          {pullRequest?.author && (
            <Fact label="Author">
              <Avatar user={pullRequest.author} />
              <Text className="truncate">{pullRequest.author.login}</Text>
            </Fact>
          )}
          {pullRequest?.branch && (
            <Fact label="Branch">
              <Text className={cx(mono, "break-all")}>{pullRequest.branch}</Text>
            </Fact>
          )}
          <Fact label="Commit">
            <Text className={mono}>{shortSha(run.testedSha)}</Text>
          </Fact>
          <Fact label="Attempt">
            <Text className="tabular-nums">{run.attempt}</Text>
          </Fact>
          <Fact label="Baseline">
            <Text className="tabular-nums">{review.baselineRevision}</Text>
          </Fact>
          {run.createdAt != null && (
            <Fact label="Captured">
              <Text>{formatRelativeTime(run.createdAt)}</Text>
            </Fact>
          )}
        </dl>
        <Separator $gap={0} />
        <div className="grid justify-items-start">
          {identity.number != null && (
            <Button
              $size="sm"
              render={
                <a
                  {...getExternalLinkProps(
                    pullRequest?.url ?? `${repository}/pull/${identity.number}`,
                  )}
                />
              }
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
      </Popover>
    </PopoverProvider>
  );
}

export interface StepperProps {
  /** The screenshot on the stage. Null when the panel shows no screenshot. */
  item: SessionItem | null;
  /** The family of the screenshot without the shared prefix. */
  family: string | null;
  /** The position in the list from 0, or -1 when the list does not show it. */
  position: number;
  count: number;
  listOpen: boolean;
  onListOpenChange(open: boolean): void;
  onStep(step: 1 | -1): void;
  className?: string;
}

/**
 * Names the screenshot on the stage and steps through the list. It repeats
 * Up and Down for the pointer, and it is the only list control of a narrow
 * window.
 */
export function Stepper({
  item,
  family,
  position,
  count,
  listOpen,
  onListOpenChange,
  onStep,
  className,
}: StepperProps) {
  const note = item ? getGroupNote(item) : null;
  return (
    <div className={cx("flex max-w-full min-w-0 items-center gap-1", className)}>
      <IconButton
        label={listOpen ? "Hide list" : "Show list"}
        shortcut={["["]}
        aria-expanded={listOpen}
        icon={<PanelLeft strokeWidth={iconStroke} />}
        onClick={() => onListOpenChange(!listOpen)}
      />
      {item && (
        // The two steps are side by side and before the name, so they stay
        // in place when the name changes its length.
        <span className="flex flex-none">
          <IconButton
            label="Previous screenshot"
            shortcut={["↑"]}
            disabled={position <= 0}
            icon={<ChevronUp strokeWidth={iconStroke} />}
            onClick={() => onStep(-1)}
          />
          <IconButton
            label="Next screenshot"
            shortcut={["↓"]}
            disabled={position >= count - 1}
            icon={<ChevronDown strokeWidth={iconStroke} />}
            onClick={() => onStep(1)}
          />
        </span>
      )}
      {item && (
        <Heading className="mt-0 mb-0 flex min-w-0 items-baseline gap-2 px-1 text-base font-semibold">
          {family && (
            // The name tells two screenshots apart, so the family gives way
            // first when the two do not fit.
            <Text
              className={cx(
                tertiary,
                "min-w-0 shrink-[9999] truncate text-sm font-normal @max-xl/shell:hidden",
              )}
            >
              {note ? `${family} · ${note}` : family}
            </Text>
          )}
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

export interface WorkspaceHeaderProps {
  session: ReviewSessionReady;
  /** The stepper of a wide window. A narrow window has it above the panel. */
  stepper: ReactNode;
  /** Shows the result page again. The progress of a complete run calls it. */
  onShowResult(): void;
}

/**
 * The 49 px header of the workspace: the way back, the run, the screenshot
 * on the stage, and the progress of the review.
 */
export function WorkspaceHeader({ session, stepper, onShowResult }: WorkspaceHeaderProps) {
  const { alertCount } = useWorldCounts();
  return (
    <ShellHeader
      $height="sm"
      $border={false}
      start={
        <ShellHeaderStart $shrink>
          <QueueButton />
          <RunCrumb review={session.review} />
        </ShellHeaderStart>
      }
      center={
        <ShellHeaderCenter $shrink className="@max-3xl/shell:hidden">
          {stepper}
        </ShellHeaderCenter>
      }
      end={
        <ShellHeaderEnd>
          {/* The count stays on one line, also when the header measures how
              narrow it can be. */}
          <RunProgress
            session={session}
            onShowResult={onShowResult}
            className="whitespace-nowrap"
          />
          <AlertsLink count={alertCount} />
          <AccountMenu user={session.user} />
        </ShellHeaderEnd>
      }
    />
  );
}
