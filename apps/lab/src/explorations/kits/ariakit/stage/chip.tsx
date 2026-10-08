// The one status slot of the stage: a chip at its top center. It shows only
// when the stage is not one or two loaded images of equal size.

import { cx } from "clava";
import { Hourglass, MoveHorizontal, MoveVertical, Scaling, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Badge,
  BadgeLabel,
  BadgeSlot,
} from "../../../../components/ariakit/components/badge.ariakit.react.tsx";
import {
  Button,
  ButtonGroup,
  ButtonSeparator,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { ProgressCircular } from "../../../../components/ariakit/components/progress.ariakit.react.tsx";
import { TextFrame } from "../../../../components/ariakit/components/text-frame.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import {
  Tooltip,
  TooltipAnchor,
  TooltipProvider,
} from "../../../../components/ariakit/components/tooltip.ariakit.react.tsx";
import { focus } from "../../../../components/ariakit/styles/focus.ts";
import { statusStyles } from "../status.tsx";
import { overlayRoot } from "../tokens.ts";
import { formatSize } from "./geometry.ts";
import type { StageImages } from "./images.ts";
import { formatSizeDelta } from "./model.ts";
import type { ImageSide, SizeChange, StageSubject } from "./model.ts";

/**
 * The state that the chip shows.
 *
 * - `failed`: the image of one side did not load. The chip has Retry.
 * - `slow`: a request runs for 6 s or more. The chip has Retry.
 * - `loading`: a request runs for 400 ms or more.
 * - `expired`, `comparing`, `error`, `added`, `removed`, `not-uploaded`, and
 *   `resized`: the state of the variant.
 */
export type ChipState =
  | { kind: "failed"; side: ImageSide }
  | { kind: "slow" }
  | { kind: "loading" }
  | { kind: "expired" }
  | { kind: "comparing" }
  | { kind: "error"; detail: string }
  | { kind: "added" }
  | { kind: "removed" }
  | { kind: "not-uploaded" }
  | { kind: "resized"; resize: SizeChange };

/**
 * The state of a stage for its chip, or null for a stage with one or two
 * loaded images of equal size. A failed request comes first, then a slow
 * one, then one that runs, then the state of the variant. A request that
 * runs for less than 400 ms shows no chip.
 */
export function getChipState(subject: StageSubject, images: StageImages): ChipState | null {
  if (images.failed) return { kind: "failed", side: images.failed };
  if (images.slow) return { kind: "slow" };
  if (images.late) return { kind: "loading" };
  if (images.loading) return null;
  if (subject.kind === "expired") return { kind: "expired" };
  if (subject.comparing) return { kind: "comparing" };
  if (subject.error) return { kind: "error", detail: subject.error };
  if (subject.kind === "added") return { kind: "added" };
  if (subject.kind === "removed") return { kind: "removed" };
  if (subject.kind === "not-uploaded") return { kind: "not-uploaded" };
  if (subject.resize) return { kind: "resized", resize: subject.resize };
  return null;
}

interface Chip {
  icon: LucideIcon;
  label: string;
  /** The second fact. It shows in the tooltip of the chip. */
  detail: string;
  layer?: "success" | "danger" | "warning";
}

function getResizeIcon({ width, height }: SizeChange) {
  if (!width) return MoveVertical;
  if (!height) return MoveHorizontal;
  return Scaling;
}

function getChip(state: ChipState): Chip | null {
  if (state.kind === "expired") {
    return { icon: Hourglass, label: "Images expired", detail: "The decisions remain" };
  }
  if (state.kind === "error") {
    return {
      icon: statusStyles.failed.glyph,
      label: "Comparison failed",
      detail: state.detail,
      layer: "danger",
    };
  }
  if (state.kind === "added") {
    return {
      icon: statusStyles.added.glyph,
      label: "Added",
      detail: "No baseline",
      layer: "success",
    };
  }
  if (state.kind === "removed") {
    return {
      icon: statusStyles.removed.glyph,
      label: "Removed",
      detail: "No current image",
      layer: "danger",
    };
  }
  if (state.kind === "not-uploaded") {
    return {
      icon: statusStyles.unchanged.glyph,
      label: "No visible change",
      detail: "CI did not upload this image",
    };
  }
  if (state.kind === "resized") {
    const { resize } = state;
    return {
      icon: getResizeIcon(resize),
      label: formatSizeDelta(resize),
      detail: `${formatSize(resize.from)} → ${formatSize(resize.to)}`,
      layer: "warning",
    };
  }
  return null;
}

const sideNames: Record<ImageSide, string> = { baseline: "Baseline", current: "Current" };

function Spinner() {
  return (
    <span className="size-[1lh] p-0.5">
      <ProgressCircular aria-label="Loading images" $thickness={0.5} />
    </span>
  );
}

export interface StateChipProps {
  /** Null renders nothing. See `getChipState`. */
  state: ChipState | null;
  /** Requests the images again. The failed and the slow chip call it. */
  onRetry?(): void;
}

/**
 * The state of the stage as one chip: an icon with one to three words, and
 * the second fact in a tooltip. A failed or a slow request has Retry in the
 * chip. Put it at the top center of the stage, in a row that always has the
 * height of a chip, so that a chip never moves an image.
 * @example
 * <StateChip state={getChipState(view.subject, view.images)} onRetry={view.images.retry} />
 */
export function StateChip({ state, onRetry }: StateChipProps) {
  if (!state) return null;
  if (state.kind === "failed") {
    const message = `${sideNames[state.side]} could not load`;
    return (
      <ButtonGroup
        $layer="danger"
        $mix={15}
        $border
        // An inset edge adds no height, so this chip is as tall as a badge.
        $borderType="inset"
        $edge="danger"
        $rounded="full"
        $forceRounded
        $size="sm"
        $p="none"
        role="alert"
        aria-label={message}
        className="max-w-full"
      >
        <TextFrame $p={1} className="flex min-w-0 items-center gap-1.5 font-medium">
          <Text $text="danger" className="flex flex-none">
            <TriangleAlert className="size-[1em]" />
          </Text>
          <span className="truncate">{message}</span>
        </TextFrame>
        <ButtonSeparator />
        <Button $p={1} onClick={onRetry}>
          Retry
        </Button>
      </ButtonGroup>
    );
  }
  if (state.kind === "slow") {
    return (
      <ButtonGroup
        $layer
        $lightnessOffset
        $border
        $borderType="inset"
        $rounded="full"
        $forceRounded
        $size="sm"
        $p="none"
        aria-label="Loading images"
      >
        <TextFrame $p={1} className="flex items-center">
          <Spinner />
          <span className="sr-only">Slow</span>
        </TextFrame>
        <ButtonSeparator />
        <Button $p={1} onClick={onRetry}>
          Retry
        </Button>
      </ButtonGroup>
    );
  }
  if (state.kind === "loading") {
    return (
      <Badge $forceRounded>
        <BadgeSlot>
          <ProgressCircular aria-label="Loading images" $thickness={0.5} />
        </BadgeSlot>
      </Badge>
    );
  }
  if (state.kind === "comparing") {
    return (
      <Badge $forceRounded>
        <BadgeSlot>
          <ProgressCircular aria-label="Comparing" $thickness={0.5} />
        </BadgeSlot>
        <BadgeLabel>{statusStyles.comparing.label}</BadgeLabel>
      </Badge>
    );
  }
  const chip = getChip(state);
  if (!chip) return null;
  return (
    <TooltipProvider>
      {/* The chip takes the focus, so that the second fact is not only for a
          pointer. */}
      <TooltipAnchor
        render={<Badge $layer={chip.layer ?? true} $forceRounded tabIndex={0} />}
        className={focus.class({ $focus: true, $focusOffset: 1 })}
      >
        <BadgeSlot>
          <chip.icon />
        </BadgeSlot>
        <BadgeLabel className="tabular-nums">{chip.label}</BadgeLabel>
      </TooltipAnchor>
      <Tooltip className={cx(overlayRoot, "tabular-nums")}>{chip.detail}</Tooltip>
    </TooltipProvider>
  );
}
