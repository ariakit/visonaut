// The review page before its run is here, as the lab has it (the pick
// "Destination skeleton"): the real header, and one block with the size of
// each part that loads. No spinner and no sentence.

import { cx } from "clava";
import { Frame } from "../components/ariakit/components/frame.ariakit.react.tsx";
import { Heading, HeadingLevel } from "../components/ariakit/components/heading.ariakit.react.tsx";
import {
  Shell,
  ShellHeader,
  ShellHeaderCenter,
  ShellFooter,
  ShellHeaderStart,
  ShellMain,
  ShellMainBody,
  ShellSidebar,
} from "../components/ariakit/components/shell.ariakit.react.tsx";
import { ScreenshotListSkeleton } from "../components/kit/list/screenshot-list.tsx";
import { besideList, PanelSheet, Skeleton, Well } from "../components/kit/surfaces.tsx";
import { shellRadius } from "../components/kit/tokens.ts";
import { QueueButton } from "./run-header.tsx";

// The heights of the controls of the page: the variant control and the
// stepper of a narrow window, `Details`, and the bar.
const navHeight = "h-[calc(1lh+--spacing(5))]";
// The stepper of a narrow window is lower than the variant control.
const stepperHeight = "h-[calc(1lh+--spacing(4))]";
const buttonHeight = "h-[calc(1lh+--spacing(4)+2px)]";
const barHeight = "h-[calc(1lh+--spacing(5)+1px)]";

// The row above the panel, with the stepper of a narrow window. The row stays
// in the grid at each width, so the panel keeps its place in the second row.
function StepperShape() {
  return (
    <div className={cx("mb-2 grid min-w-0 @3xl/shell:mb-0", besideList)}>
      <Skeleton className={cx(stepperHeight, "w-full @3xl/shell:hidden")} />
    </div>
  );
}

// The variant row before its screenshot is here: the variant control, one
// mark for each variant of a normal screenshot, and `Details`. It is a frame
// in the panel, as on the page.
function VariantRowShape() {
  return (
    <Frame $p={2} className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-[min(100%,27.5em)] flex-1 items-center gap-3">
        <Skeleton className={cx(navHeight, "w-60 max-w-full")} />
        <div className="flex items-center gap-2 @max-[44rem]/shell:hidden">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} soft $rounded="full" className="size-3.5" />
          ))}
        </div>
      </div>
      <Skeleton $rounded="md" className={cx(buttonHeight, "ms-auto w-24")} />
    </Frame>
  );
}

// The stage before its image is here: the well with the median image box,
// 416 by 170, and the bar under it, in the room of the panel.
function StageShape() {
  return (
    <Frame $p={2} className="flex min-h-0 flex-1 flex-col gap-2 pt-0">
      <Well className="grid min-h-80 min-w-0 flex-1 place-items-center">
        <Skeleton soft $rounded="none" className="aspect-[416/170] w-full max-w-[416px]" />
      </Well>
      <Skeleton
        soft
        $rounded="3xl"
        $forceRounded
        className={cx(barHeight, "mx-auto w-full max-w-[72rem]")}
      />
    </Frame>
  );
}

/**
 * The review page while the first read of its run runs. The header has the
 * way back to the Queue, so the person can leave before the run is here.
 * @example
 * pendingComponent: () => <RunLoading />
 */
export function RunLoading() {
  return (
    <HeadingLevel level={1}>
      <Shell className="review-workspace text-sm" $layer="canvas" $rounded={shellRadius}>
        <ShellHeader
          $height="sm"
          $border={false}
          start={
            <ShellHeaderStart $shrink>
              <QueueButton />
              <Skeleton className="ms-2 h-3.5 w-64 @max-3xl/shell:w-20" />
            </ShellHeaderStart>
          }
          center={
            <ShellHeaderCenter $shrink className="@max-3xl/shell:hidden">
              <Skeleton className="h-3.5 w-[min(36em,36cqi)]" />
            </ShellHeaderCenter>
          }
        />
        <ShellSidebar
          $show="5xl"
          $from="main"
          $width="lg"
          $border={false}
          render={<nav />}
          aria-label="Screenshots"
        >
          <ScreenshotListSkeleton />
        </ShellSidebar>
        <ShellMain $maxWidth="100%" $p={2} className="review-main">
          <ShellMainBody
            aria-busy="true"
            aria-label="Loading run"
            className="grid-rows-[auto_minmax(0,1fr)] content-stretch"
          >
            <Heading className="sr-only">Review</Heading>
            <StepperShape />
            <PanelSheet className={besideList}>
              <VariantRowShape />
              <StageShape />
            </PanelSheet>
          </ShellMainBody>
        </ShellMain>
        {/* The footer of the page, with its height, so the panel ends where it
            ends on the page. */}
        <ShellFooter $height="sm" $p={3} aria-hidden className="min-h-10!" />
      </Shell>
    </HeadingLevel>
  );
}
