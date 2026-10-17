// The controls of the stage: the view modes, the mask switch, and the stepper
// of the changed regions.

import { cx } from "clava";
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Diff,
  History,
  Image,
  Layers,
  SquareSplitHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Button,
  ButtonGlider,
  ButtonGroup,
  ButtonSlot,
} from "../../ariakit/components/button.ariakit.react.tsx";
import { Text } from "../../ariakit/components/text.ariakit.react.tsx";
import { Hint, IconButton } from "../controls.tsx";
import { iconStroke, tertiary } from "../tokens.ts";
import { modeNames } from "../stage/model.ts";
import type { StageSubject } from "../stage/model.ts";
import type { StageView, StoredView, ViewMode } from "../view-types.ts";

interface ModeEntry {
  id: ViewMode;
  label: string;
  key: string;
  icon: LucideIcon;
}

/** The modes of the stage (D-WORK-02), in the order of the bar, each with its key. */
export const viewModes: readonly ModeEntry[] = [
  { id: "new", label: modeNames.new, key: "F", icon: Image },
  { id: "original", label: modeNames.original, key: "G", icon: History },
  { id: "side", label: modeNames.side, key: "S", icon: Columns2 },
  { id: "swipe", label: modeNames.swipe, key: "W", icon: SquareSplitHorizontal },
  { id: "overlay", label: modeNames.overlay, key: "O", icon: Layers },
];

type ModeSubject = Pick<StageSubject, "baseline" | "current">;

/**
 * True when the images of a subject can show a mode. It has the rule of
 * `getStageMode`, so a button is on when the stage can show its mode.
 */
export function canShowMode(mode: ViewMode, subject: ModeSubject) {
  const { baseline, current } = subject;
  if (mode === "new") return !!current;
  if (!baseline) return false;
  if (!current) return mode === "original";
  // One image for both sides has nothing to compare.
  return baseline.url !== current.url;
}

export interface ModeButtonsProps {
  stored: StoredView;
  /** The images of the stage, as `view.subject`. */
  subject: ModeSubject;
  /** The mode on screen. The stage gives it as `view.mode`. */
  mode: ViewMode;
}

/**
 * The view modes as icon buttons with the stock selected glider. Each tooltip
 * has the name and the key. They are buttons and not radios: a radio group
 * keeps the arrow keys, which belong to the list and the variants. The mode
 * on screen is the current one of the set (`aria-current`), which is also
 * the state that the glider follows.
 */
export function ModeButtons({ stored, subject, mode: shown }: ModeButtonsProps) {
  return (
    <ButtonGroup aria-label="View mode" $p="none" $gap="xs" className="flex-none">
      {viewModes.map((mode) => {
        const selected = mode.id === shown;
        return (
          <Hint key={mode.id} label={mode.label} shortcut={[mode.key]}>
            <Button
              aria-label={mode.label}
              aria-current={selected ? "true" : undefined}
              aria-keyshortcuts={mode.key}
              disabled={!canShowMode(mode.id, subject)}
              accessibleWhenDisabled
              onClick={() => stored.setMode(mode.id)}
            >
              <ButtonSlot>
                <mode.icon strokeWidth={iconStroke} />
              </ButtonSlot>
            </Button>
          </Hint>
        );
      })}
      <ButtonGlider />
    </ButtonGroup>
  );
}

export interface MaskToggleProps {
  stored: StoredView;
  /** False when the variant on screen has no mask: a size change, a new screenshot. */
  available: boolean;
}

/**
 * Turns the red mask and the boxes of the changed regions off and on (`D`).
 * The mask is a switch, not a mode, so it is a switch here too.
 */
export function MaskToggle({ stored, available }: MaskToggleProps) {
  const on = stored.mask && available;
  return (
    // A group of its own, so that its glider does not follow the modes.
    <ButtonGroup role="presentation" $p="none" className="flex-none">
      <Hint label="Mask" shortcut={["D"]}>
        <Button
          role="switch"
          aria-label="Mask"
          aria-checked={on}
          aria-keyshortcuts="D"
          disabled={!available}
          accessibleWhenDisabled
          onClick={() => stored.setMask(!stored.mask)}
        >
          <ButtonSlot>
            <Diff strokeWidth={iconStroke} />
          </ButtonSlot>
        </Button>
      </Hint>
      <ButtonGlider />
    </ButtonGroup>
  );
}

export interface RegionStepperProps {
  view: StageView;
  className?: string;
}

/**
 * The steps through the changed regions, with their counter. A step zooms the
 * stage to the region, and the box of that region is the current one. The
 * stepper is always in the bar, so that Reject and Approve stay in one place
 * from variant to variant. It is off for a variant with no region: a size
 * change, an addition, a removal.
 * @example
 * <RegionStepper view={engine} />
 */
export function RegionStepper({ view, className }: RegionStepperProps) {
  const { region, regionCount } = view;
  const none = regionCount === 0;
  const position = region == null ? "–" : `${region + 1}`;
  const words =
    region == null
      ? `${regionCount} ${regionCount === 1 ? "region" : "regions"}`
      : `Region ${region + 1} of ${regionCount}`;
  return (
    <ButtonGroup aria-label="Changed regions" $p="none" $gap="none" className={className}>
      <IconButton
        label="Previous region"
        icon={<ChevronLeft strokeWidth={iconStroke} />}
        disabled={none}
        accessibleWhenDisabled
        onClick={() => view.goToRegion(-1)}
      />
      {/* The width of `12/14`, so the bar does not move at each step or from
          variant to variant. The text is a live region, so a step is
          announced. */}
      <Text
        role="status"
        className={cx(tertiary, "min-w-[4.5ch] self-center text-center tabular-nums")}
      >
        {!none && (
          <>
            <span aria-hidden>{`${position}/${regionCount}`}</span>
            <span className="sr-only">{words}</span>
          </>
        )}
      </Text>
      <IconButton
        label="Next region"
        icon={<ChevronRight strokeWidth={iconStroke} />}
        disabled={none}
        accessibleWhenDisabled
        onClick={() => view.goToRegion(1)}
      />
    </ButtonGroup>
  );
}
