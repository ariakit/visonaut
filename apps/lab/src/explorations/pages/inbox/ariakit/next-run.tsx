import { cx } from "clava";
import { Fragment, useId } from "react";
import {
  Button,
  ButtonLabel,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import type { FrameProps } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import { Heading } from "../../../../components/ariakit/components/heading.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import { formatDateTime, formatRelativeTime } from "../../../../fixtures/index.ts";
import type { Run } from "../../../../fixtures/index.ts";
import { LabLink } from "../../../../lab/navigation.tsx";
import { Avatar } from "../../../kits/ariakit/controls.tsx";
import { PreviewWell } from "../../../kits/ariakit/preview-well.tsx";
import { getRunRow } from "../../../kits/ariakit/run-row.tsx";
import { getRunTarget } from "../../../kits/ariakit/runs.tsx";
import { SkeletonLine } from "../../../kits/ariakit/skeleton-line.tsx";
import { StatusPill } from "../../../kits/ariakit/status.tsx";
import { Skeleton } from "../../../kits/ariakit/surfaces.tsx";
import { secondary } from "../../../kits/ariakit/tokens.ts";
import { getRunHeading } from "./model.ts";

// The frame of the next run card: brand at 15% with a border, the answer to
// `UI-HERO-LAYER`.
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
  run: Run;
}

/**
 * The next run to review, as the one card of the Queue: its number and its
 * age, its title, what is left, and the one brand action of the page. When
 * the data has them, the author shows before the age and one row of preview
 * pictures under the title.
 */
export function NextRun({ run }: NextRunProps) {
  const headingId = useId();
  const target = getRunTarget(run);
  const heading = getRunHeading(run);
  const row = getRunRow(run);
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
          {heading.number && (
            <>
              <span>{heading.number}</span>
              <span aria-hidden>·</span>
            </>
          )}
          {run.author && (
            <>
              <Avatar user={run.author} />
              <span className="truncate">{run.author.login}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <time
            dateTime={new Date(run.createdAt).toISOString()}
            title={formatDateTime(run.createdAt)}
          >
            {formatRelativeTime(run.createdAt)}
          </time>
        </Text>
        <Heading
          id={headingId}
          className="mt-0 mb-0 line-clamp-2 text-lg font-semibold text-balance"
        >
          {heading.title}
        </Heading>
      </div>
      {/* Only the data mode with every proposed field has previews. The well
          is as wide as its pictures, so one picture does not fill the card. */}
      <PreviewWell
        previews={run.previews}
        scenario={target.scenario}
        className="justify-self-start"
      />
      <div className="flex min-w-0 items-center justify-between gap-4">
        <Text render={<p />} className={cx(secondary, "min-w-0 tabular-nums")}>
          {row.parts.map((part, index) => (
            <Fragment key={part.text}>
              {index > 0 && " · "}
              {part.danger ? <Text $text="danger">{part.text}</Text> : part.text}
            </Fragment>
          ))}
        </Text>
        <Button
          $kind="bevel"
          $layer="brand"
          render={<LabLink to={target.to} scenario={target.scenario} />}
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
