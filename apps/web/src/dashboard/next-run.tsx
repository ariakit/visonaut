import { Link } from "@tanstack/react-router";
import { cx } from "clava";
import { useId } from "react";
import type { DashboardRun } from "../api/dashboard.ts";
import { Button, ButtonLabel } from "../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import type { FrameProps } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Heading } from "../components/ariakit/components/heading.ariakit.react.tsx";
import { Link as TextLink } from "../components/ariakit/components/link.ariakit.react.tsx";
import { Text } from "../components/ariakit/components/text.ariakit.react.tsx";
import { shortSha } from "../components/kit/format.ts";
import {
  getRunReference,
  getRunRow,
  RunAge,
  runKindWords,
  RunStatusText,
} from "../components/kit/run-row.tsx";
import { getExternalLinkProps } from "../components/kit/shell.tsx";
import { SkeletonLine } from "../components/kit/skeleton-line.tsx";
import { StatusPill } from "../components/kit/status.tsx";
import { Skeleton } from "../components/kit/surfaces.tsx";
import { mono, secondary } from "../components/kit/tokens.ts";

export interface RunHeading {
  /** The fact that the heading has. The line above then does not repeat it. */
  has?: "number" | "commit";
  title: string;
}

/**
 * The words of the next run card. A run with a title has its number on the
 * line above. Without a title, `Pull request` alone names nothing, so the
 * heading then takes the number: `Pull request #7754`.
 */
export function getRunHeading(
  run: Pick<DashboardRun, "kind" | "pullRequestNumber" | "testedSha" | "title">,
): RunHeading {
  if (run.title) {
    return { title: run.title };
  }
  const kind = runKindWords[run.kind];
  if (run.pullRequestNumber != null) {
    return { has: "number", title: `${kind} #${run.pullRequestNumber}` };
  }
  return { has: "commit", title: `${kind} ${shortSha(run.testedSha)}` };
}

// The frame of the next run card: brand at 15% with a border.
function CardFrame({ className, ...props }: FrameProps) {
  return (
    <Frame
      $layer="brand"
      $mix={15}
      $border
      $rounded="2xl"
      $p="1.5rem"
      // The shadow of a sheet, so the card lies on the plane of the sheets.
      className={cx("ak-light:shadow-sm", className)}
      {...props}
    />
  );
}

export interface NextRunProps {
  /** The next run to review: the first run of the review group. */
  run: DashboardRun;
  /** The repository as `owner/name`, for the links to GitHub. */
  repository: string;
}

/**
 * The next run to review, as the one card of the Queue: its number, its
 * commit, and its age, its title, what is left, and the one brand action of
 * the page. The number and the commit open GitHub. A run row is one link, so
 * only the card has these two links. A run with no title has its number or
 * its commit in the heading, and the line above does not repeat it.
 */
export function NextRun({ run, repository }: NextRunProps) {
  const headingId = useId();
  const heading = getRunHeading(run);
  const row = getRunRow(run);
  const github = `https://github.com/${repository}`;
  const pullRequest = run.pullRequestNumber != null && heading.has !== "number";
  return (
    <CardFrame
      render={<article aria-labelledby={headingId} />}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4"
    >
      <div className="grid min-w-0 gap-1">
        <Text
          render={<p />}
          className={cx(secondary, "flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs")}
        >
          <StatusPill status={row.status} compact className="me-0.5" />
          {pullRequest && (
            <>
              <TextLink
                {...getExternalLinkProps(`${github}/pull/${run.pullRequestNumber}`)}
                aria-label={`Pull request ${getRunReference(run)} on GitHub`}
              >
                {getRunReference(run)}
              </TextLink>
              <span aria-hidden>·</span>
            </>
          )}
          {heading.has !== "commit" && (
            <>
              <TextLink
                {...getExternalLinkProps(`${github}/commit/${run.testedSha}`)}
                aria-label={`Commit ${row.sha} on GitHub`}
                className={mono}
              >
                {row.sha}
              </TextLink>
              <span aria-hidden>·</span>
            </>
          )}
          <RunAge value={run.createdAt} />
        </Text>
        <Heading
          id={headingId}
          className="mt-0 mb-0 line-clamp-2 text-lg font-semibold text-balance"
        >
          {heading.title}
        </Heading>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-4">
        <Text render={<p />} className={cx(secondary, "min-w-0 tabular-nums")}>
          <RunStatusText row={row} />
        </Text>
        <Button
          $kind="bevel"
          $layer="brand"
          render={<Link to="/runs/$runId" params={{ runId: run.id }} />}
          className="flex-none"
        >
          <ButtonLabel>Review</ButtonLabel>
        </Button>
      </div>
    </CardFrame>
  );
}

/**
 * The shape of the next run card before the runs load: the same frame, one
 * block for each line, and a block with the box of the button.
 */
export function NextRunSkeleton() {
  return (
    <CardFrame aria-hidden className="grid min-w-0 gap-4">
      <div className="grid gap-1">
        <SkeletonLine soft className="w-32 text-xs" />
        <SkeletonLine className="w-3/5 text-lg" />
      </div>
      <div className="flex items-center justify-between gap-4">
        <SkeletonLine soft className="w-36" />
        {/* The padding and the line box of the button that replaces it. */}
        <Skeleton $rounded="md" $p={2} className="w-20 flex-none">
          <div className="h-lh" />
        </Skeleton>
      </div>
    </CardFrame>
  );
}
