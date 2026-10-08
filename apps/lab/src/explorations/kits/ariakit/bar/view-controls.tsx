import * as ak from "@ariakit/react";
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
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import type { SessionVariant } from "../../../../fixtures/hooks/index.ts";
import { Hint, IconButton } from "../controls.tsx";
import { iconStroke, tertiary } from "../tokens.ts";
import type { StageView, StoredView, ViewMode } from "../view-types.ts";

interface ModeEntry {
  id: ViewMode;
  label: string;
  key: string;
  icon: LucideIcon;
}

/** The five modes of D-WORK-02, in the order of the bar, each with its key. */
export const viewModes: readonly ModeEntry[] = [
  { id: "new", label: "Current", key: "F", icon: Image },
  { id: "original", label: "Baseline", key: "G", icon: History },
  { id: "side", label: "Side by side", key: "S", icon: Columns2 },
  { id: "swipe", label: "Swipe", key: "W", icon: SquareSplitHorizontal },
  { id: "overlay", label: "Overlay", key: "O", icon: Layers },
];

type ModeSubject = Pick<SessionVariant, "kind" | "reference" | "candidate">;

/** True when the images of a variant can show a mode. */
export function canShowMode(mode: ViewMode, variant: ModeSubject | null) {
  if (!variant) return false;
  const { reference, candidate } = variant;
  if (mode === "new") return !!candidate;
  // An unchanged variant has one picture, so it has nothing to compare.
  if (variant.kind === "unchanged") return false;
  if (mode === "original") return !!reference;
  return !!reference && !!candidate;
}

/**
 * The mode on screen for a variant. A variant that cannot show the stored
 * mode shows its one image, for that variant only: the stored mode stays.
 */
export function getShownMode(mode: ViewMode, variant: ModeSubject | null): ViewMode | null {
  if (!variant) return null;
  if (canShowMode(mode, variant)) return mode;
  if (canShowMode("new", variant)) return "new";
  if (canShowMode("original", variant)) return "original";
  return null;
}

export interface ModeButtonsProps {
  stored: StoredView;
  variant: SessionVariant | null;
}

/**
 * The view modes as icon buttons with the stock selected glider. Each tooltip
 * has the name and the key. They are buttons and not radios: a radio group
 * keeps the arrow keys, which belong to the list and the variants. The mode
 * on screen is the current one of the set (`aria-current`), which is also
 * the state that the glider follows.
 */
export function ModeButtons({ stored, variant }: ModeButtonsProps) {
  const shown = getShownMode(stored.mode, variant);
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
              disabled={!canShowMode(mode.id, variant)}
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
      <ButtonGlider $state="focus" />
    </ButtonGroup>
  );
}

export interface MaskToggleProps {
  stored: StoredView;
  /** False when no variant on screen has a mask: a size change, a new screenshot. */
  available: boolean;
}

/**
 * Turns the red tint and the region boxes off and on (`D`). The mask is a
 * switch, not a mode, so it is a switch here too.
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
      <ButtonGlider $state="focus" />
    </ButtonGroup>
  );
}

export interface RegionStepperProps {
  view: StageView;
  className?: string;
}

/**
 * The steps through the changed regions with their counter. A step zooms to
 * the region. The stepper is always in the bar, so that Reject and Approve
 * stay in one place from variant to variant. It is off for a variant that
 * has no region: a size change, a new screenshot.
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
      {/* The width of `12/14`, so the bar does not move at each step or
          from variant to variant. */}
      <Text
        role="status"
        className={cx(tertiary, "min-w-[4.5ch] self-center text-center tabular-nums")}
      >
        {!none && (
          <>
            <span aria-hidden>{`${position}/${regionCount}`}</span>
            <ak.VisuallyHidden>{words}</ak.VisuallyHidden>
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
