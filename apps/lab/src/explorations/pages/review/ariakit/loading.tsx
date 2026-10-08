import { cx } from "clava";
import { CloudOff, PanelLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Frame } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import {
  Heading,
  HeadingLevel,
} from "../../../../components/ariakit/components/heading.ariakit.react.tsx";
import {
  Shell,
  ShellHeader,
  ShellHeaderCenter,
  ShellMain,
  ShellMainBody,
  ShellSidebar,
} from "../../../../components/ariakit/components/shell.ariakit.react.tsx";
import { IconButton } from "../../../kits/ariakit/controls.tsx";
import { ErrorBand, ErrorBandButton } from "../../../kits/ariakit/error-band.tsx";
import { ScreenshotListSkeleton } from "../../../kits/ariakit/list/screenshot-list.tsx";
import { AccountMenu, useDocumentTitle } from "../../../kits/ariakit/shell.tsx";
import { SkeletonLine } from "../../../kits/ariakit/skeleton-line.tsx";
import { Skeleton, Well } from "../../../kits/ariakit/surfaces.tsx";
import { iconStroke, pageRoot, shellRadius } from "../../../kits/ariakit/tokens.ts";
import { QueueButton } from "./header.tsx";
import {
  besideList,
  panelClass,
  panelGutter,
  stageRoomClass,
  stepperWidth,
  variantRowClass,
  wideRowOnly,
} from "./layout.ts";
import { PanelSheet } from "./panel-sheet.tsx";

interface WorkspaceFrameProps {
  /** The start of the header after the way back. */
  crumb?: ReactNode;
  /** The list on the desk. */
  list: ReactNode;
  children: ReactNode;
}

/** The header and the columns of the workspace, before a run is here. */
function WorkspaceFrame({ crumb, list, children }: WorkspaceFrameProps) {
  useDocumentTitle("Review");
  return (
    <HeadingLevel level={1}>
      <Shell $rounded={shellRadius} className={cx(pageRoot, "h-dvh")}>
        <ShellHeader
          $height="sm"
          $border={false}
          start={
            <>
              <QueueButton />
              {crumb}
            </>
          }
          center={
            <ShellHeaderCenter $shrink className="@max-3xl/shell:hidden">
              {/* The place of the list button in the stepper of the run. */}
              <div className={cx("flex max-w-full", stepperWidth)}>
                <IconButton
                  label="Hide list"
                  disabled
                  icon={<PanelLeft strokeWidth={iconStroke} />}
                />
              </div>
            </ShellHeaderCenter>
          }
          end={<AccountMenu />}
        />
        <ShellSidebar $width="lg" $border={false} aria-label="Screenshots" render={<nav />}>
          {list}
        </ShellSidebar>
        <ShellMain $p="none" $maxWidth="100%">
          <ShellMainBody className="grid-rows-[minmax(0,1fr)]">
            <Frame $p={2} className={cx(panelGutter, besideList)}>
              <Heading className="sr-only">Review</Heading>
              {children}
            </Frame>
          </ShellMainBody>
        </ShellMain>
      </Shell>
    </HeadingLevel>
  );
}

interface StageShapeProps {
  /** A shape that does not pulse, under an `ErrorBand`. */
  still?: boolean;
}

// The stage before its image is here: the well with the median image box,
// 416 by 170. Fit shows a card at 200% when the stage has the room.
function StageShape({ still }: StageShapeProps) {
  return (
    <Well className="@container grid min-h-0 flex-1 place-items-center overflow-clip p-3">
      <Skeleton
        soft
        still={still}
        $rounded="none"
        className="aspect-[416/170] w-[416px] max-w-full @min-[856px]:w-[832px]"
      />
    </Well>
  );
}

// The height of the stepper and of the pill: one line of text, and the
// padding of a control and of its group. Both have an edge too: a border on a
// dark surface, which adds to their box, and a ring on a light one, which
// does not.
const groupHeight = "h-[calc(1lh+--spacing(6))] ak-dark:h-[calc(1lh+--spacing(6)+2px)]";
// The height of a button: `Details`, `All`, and the box of one mark.
const buttonHeight = "h-[calc(1lh+--spacing(4))]";
const markBox = "size-[calc(1lh+--spacing(4))]";
// The widths of the parts of a normal screenshot at the default density: the
// stepper with the name `Chromium · Light`, `All`, the numbers of a change
// with one region, and `Details`.
const stepperShape = "w-86.5 ak-dark:w-87";
const allShape = "w-17.5";
const lineShape = "w-48";
const detailsShape = "w-25.5";

// The variant row before its screenshot is here: the stepper, one mark for
// each variant of a normal screenshot, `All`, the numbers, and `Details`.
// Each block starts where its part starts.
function VariantRowShape() {
  return (
    <Frame $p={2} className={variantRowClass}>
      <Skeleton className={cx(groupHeight, stepperShape, "max-w-full")} />
      <div className={cx("flex items-center gap-0.5", wideRowOnly)}>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <span key={index} className={cx(markBox, "grid place-items-center")}>
            <Skeleton soft $rounded="full" className="size-3.5" />
          </span>
        ))}
      </div>
      <Skeleton soft $rounded="md" className={cx(buttonHeight, allShape, wideRowOnly)} />
      <span className="flex-1" />
      <SkeletonLine soft className={cx(lineShape, wideRowOnly)} />
      <Skeleton $rounded="md" className={cx(buttonHeight, detailsShape)} />
    </Frame>
  );
}

// The bar before the run is here: a block with its size, in its place.
function BarShape() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-end justify-center">
      <Skeleton
        soft
        $rounded="full"
        $forceRounded
        className={cx(groupHeight, "m-4 w-[62.5em] max-w-[calc(100%-2rem)]")}
      />
    </div>
  );
}

/**
 * The workspace before the run is here: the real header, and one block with
 * the size of each part that loads (the pick "Destination skeleton"). No
 * spinner and no sentence.
 */
export function LoadingWorkspace() {
  return (
    <WorkspaceFrame
      crumb={<Skeleton className="ms-2 h-3.5 w-64 @max-3xl/shell:w-20" />}
      list={<ScreenshotListSkeleton />}
    >
      <div aria-busy="true" aria-label="Loading run" className={panelClass}>
        <PanelSheet>
          <VariantRowShape />
          <Frame $p={2} className={stageRoomClass}>
            {/* The pill lies over this box, as on the page. */}
            <div className="relative flex min-h-0 flex-1">
              <StageShape />
              <BarShape />
            </div>
          </Frame>
        </PanelSheet>
      </div>
    </WorkspaceFrame>
  );
}

export interface FailedWorkspaceProps {
  /** The identifier of the failed request. */
  reference?: string;
  onRetry(): void;
  retrying: boolean;
}

/**
 * The workspace when the run did not load (the pick "In place"): the header
 * stays, and the panel keeps its shape under one band.
 */
export function FailedWorkspace({ reference, onRetry, retrying }: FailedWorkspaceProps) {
  return (
    <WorkspaceFrame list={<ScreenshotListSkeleton still />}>
      <PanelSheet>
        <Frame $p={2} className="flex min-h-0 flex-1 flex-col gap-2">
          <ErrorBand
            icon={CloudOff}
            title="Could not load the run"
            errorId={reference}
            action={
              <ErrorBandButton busy={retrying} onClick={onRetry}>
                Try again
              </ErrorBandButton>
            }
          />
          <StageShape still />
        </Frame>
      </PanelSheet>
    </WorkspaceFrame>
  );
}
