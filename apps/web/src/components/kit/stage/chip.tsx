// The state chip of the stage: one badge at its top center. It shows only
// when the stage is not two loaded images of equal size.

import { cx } from "clava";
import { MoveHorizontal, MoveVertical, Scaling } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, BadgeLabel, BadgeSlot } from "../../ariakit/components/badge.ariakit.react.tsx";
import { ProgressCircular } from "../../ariakit/components/progress.ariakit.react.tsx";
import { statusStyles } from "../status.tsx";
import { tertiary } from "../tokens.ts";
import { formatSize } from "./geometry.ts";
import type { SizeChange, StageSubject } from "./model.ts";

/**
 * The state that the chip shows.
 *
 * - `loading`: the images load for 400 ms or more.
 * - `comparing`: the service still compares the variant.
 * - `added`, `removed`, `not-uploaded`, and `resized`: the state of the
 *   variant.
 */
export type ChipState =
  | { kind: "loading" }
  | { kind: "comparing" }
  | { kind: "added" }
  | { kind: "removed" }
  | { kind: "not-uploaded" }
  | { kind: "resized"; resize: SizeChange };

/** A load that ends before this time shows no chip. */
const lateLoad = 400;

/**
 * True when `loading` stayed true for 400 ms since it started or since
 * `requestKey` changed, so that a fast load shows no signal.
 * @example
 * const late = useLateLoad(evidence.status === "loading", evidence.identity);
 */
export function useLateLoad(loading: boolean, requestKey: string) {
  const [lateKey, setLateKey] = useState<string | null>(null);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setLateKey(requestKey), lateLoad);
    return () => clearTimeout(timer);
  }, [loading, requestKey]);
  return loading && lateKey === requestKey;
}

/**
 * The state of a stage for its chip, or null for two loaded images of equal
 * size. A late load comes first, then the state of the variant.
 */
export function getChipState(subject: StageSubject, late: boolean): ChipState | null {
  if (late) return { kind: "loading" };
  if (subject.kind === "added") return { kind: "added" };
  if (subject.kind === "removed") return { kind: "removed" };
  if (subject.kind === "not-uploaded") return { kind: "not-uploaded" };
  if (subject.resize) return { kind: "resized", resize: subject.resize };
  return null;
}

interface Chip {
  icon: LucideIcon;
  label: string;
  /** The second fact, after the label. */
  detail: string;
  layer?: "success" | "danger" | "warning";
}

function getResizeIcon({ width, height }: SizeChange) {
  if (!width) return MoveVertical;
  if (!height) return MoveHorizontal;
  return Scaling;
}

function getChip(state: ChipState): Chip | null {
  switch (state.kind) {
    case "added":
      return {
        icon: statusStyles.added.glyph,
        label: statusStyles.added.label,
        detail: "No baseline",
        layer: "success",
      };
    case "removed":
      return {
        icon: statusStyles.removed.glyph,
        label: statusStyles.removed.label,
        detail: "No current image",
        layer: "danger",
      };
    case "not-uploaded":
      return {
        icon: statusStyles.unchanged.glyph,
        label: "No visible change",
        detail: "CI did not upload this image",
      };
    case "resized":
      return {
        icon: getResizeIcon(state.resize),
        label: "Size changed",
        detail: `${formatSize(state.resize.from)} → ${formatSize(state.resize.to)}`,
        layer: "warning",
      };
    default:
      return null;
  }
}

export interface StateChipProps {
  /** Null renders nothing. See `getChipState`. */
  state: ChipState | null;
}

/**
 * The state of the stage as one badge: an icon, one to three words, and the
 * second fact. Put it in the status row of the stage, which always has the
 * height of a badge, so that a chip never moves an image.
 * @example
 * <StateChip state={getChipState(view.subject, late)} />
 */
export function StateChip({ state }: StateChipProps) {
  if (!state) return null;
  if (state.kind === "loading" || state.kind === "comparing") {
    const loading = state.kind === "loading";
    const label = loading ? "Loading images" : statusStyles.comparing.label;
    // A live region says why a decision waits. The ring is only a picture.
    return (
      <Badge role="status" $forceRounded>
        <BadgeSlot>
          <ProgressCircular aria-hidden $thickness={0.5} />
        </BadgeSlot>
        <BadgeLabel className={loading ? "sr-only" : undefined}>{label}</BadgeLabel>
      </Badge>
    );
  }
  const chip = getChip(state);
  if (!chip) return null;
  return (
    <Badge $layer={chip.layer ?? true} $forceRounded className="max-w-full">
      <BadgeSlot>
        <chip.icon />
      </BadgeSlot>
      {/* Two inline parts, as in the label of an image: the label of a badge
          trims its line box, which a flex row does not. */}
      <BadgeLabel className="min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap tabular-nums">
        <span className="font-medium">{chip.label}</span>
        <span className={cx(tertiary, "ms-1.5")}>{chip.detail}</span>
      </BadgeLabel>
    </Badge>
  );
}
