// The quiet surroundings of an error in this reference: the seconds of a
// retry, an image box, and the decision buttons that wait. The band itself is
// the kit `ErrorBand`.

import { cx } from "clava";
import { Check, X } from "lucide-react";
import type { CSSProperties } from "react";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { Frame } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import type { FrameProps } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import { ProgressCircular } from "../../../../components/ariakit/components/progress.ariakit.react.tsx";
import type { ImageSize } from "../../../../fixtures/index.ts";
import type { ErrorState } from "./use-error-state.ts";

export interface CountProps {
  state: ErrorState;
}

/**
 * The seconds to the automatic retry, after the label of the action. A screen
 * reader does not get them: an alert that changes each second would speak
 * each second.
 */
export function Count({ state }: CountProps) {
  if (state.scenario !== "unavailable") return null;
  return (
    // The box keeps the width of one digit in parentheses, so the action does
    // not change its width while the request runs.
    <span
      aria-hidden
      className="ms-[0.25em] inline-grid min-w-[3ch] justify-items-center align-bottom tabular-nums"
    >
      {state.seconds == null ? (
        <span className="grid h-lh items-center">
          <span className="block size-[0.9em]">
            <ProgressCircular aria-label="Trying again" $thickness={0.5} />
          </span>
        </span>
      ) : (
        `(${state.seconds})`
      )}
    </span>
  );
}

/** The pulse of a placeholder while its request runs. */
export const busyPulse = "motion-safe:animate-pulse";

/** The CSS size of a box that holds an image: its ratio, and never above 100%. */
function getImageBoxStyle(size: ImageSize): CSSProperties {
  return { aspectRatio: `${size.width} / ${size.height}`, maxWidth: size.width };
}

export type ImageBoxProps = FrameProps & {
  size: ImageSize;
};

/**
 * A box with the exact shape of an image, in the tone of an image that is not
 * there. A ring adds no size, so the box keeps that shape.
 */
export function ImageBox({ size, className, style, ...props }: ImageBoxProps) {
  return (
    <Frame
      $lightnessOffset={2}
      $border
      $borderType="ring"
      $rounded="none"
      {...props}
      className={cx("relative w-full overflow-clip", className)}
      style={{ ...getImageBoxStyle(size), ...style }}
    />
  );
}

export interface DecisionButtonsProps {
  /** The element that says why the buttons are off. */
  describedBy?: string;
  className?: string;
}

/** Reject and Approve, off while the image that they judge is not on screen. */
export function DecisionButtons({ describedBy, className }: DecisionButtonsProps) {
  return (
    <div role="group" aria-label="Decision" className={cx("flex justify-end gap-2", className)}>
      <Button $size="sm" accessibleWhenDisabled disabled aria-describedby={describedBy}>
        <ButtonSlot>
          <X />
        </ButtonSlot>
        <ButtonLabel>Reject</ButtonLabel>
      </Button>
      {/* Approve has the brand color only while it can act. */}
      <Button $size="sm" accessibleWhenDisabled disabled aria-describedby={describedBy}>
        <ButtonSlot>
          <Check />
        </ButtonSlot>
        <ButtonLabel>Approve</ButtonLabel>
      </Button>
    </div>
  );
}
