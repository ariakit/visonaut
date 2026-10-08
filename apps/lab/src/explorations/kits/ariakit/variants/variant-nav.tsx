import { cx } from "clava";
import { LayoutGrid } from "lucide-react";
import {
  Button,
  ButtonLabel,
  ButtonSlot,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import type { SessionItem, SessionVariant } from "../../../../fixtures/hooks/index.ts";
import { StatusGlyph, getStripStatusName } from "../status.tsx";
import { iconStroke } from "../tokens.ts";
import { getFullName } from "./model.ts";
import { VariantPager } from "./pager.tsx";
import { VariantStepper } from "./stepper.tsx";
import { useRowFit } from "./use-row-fit.ts";

export interface VariantNavProps {
  item: SessionItem;
  /** The variant on the stage. */
  variant: SessionVariant;
  /** The cover shows in the place of the stage. */
  cover?: boolean;
  /**
   * The `All` button was pressed. Leave it out for a screenshot without a
   * cover: the control then has no `All` button.
   */
  onCoverChange?(cover: boolean): void;
  /** The previous or the next variant of the screenshot. */
  onStep(step: 1 | -1): void;
  /** A variant of the list of the stepper. */
  onSelect(variantKey: string): void;
  className?: string;
}

/**
 * The control that moves between the variants of a screenshot, at the start
 * of the variant row: the stepper with its list, the pager of marks as links,
 * and the `All` button that shows the cover (the answer to UI-VARIANT-NAV).
 * It takes the free width of its row, and the pager hides when that width has
 * no room for it. A screenshot with one variant shows the name of that
 * variant as text.
 *
 * The stepper is a bordered group, so it is taller than a button. Give the
 * row its padding with a `Frame`, not with a padding class: the stepper and
 * the selected mark then take the corner radius that is concentric with the
 * panel. With a padding class on a panel without padding, they take the
 * radius of the panel and become pills.
 * @example
 * <Frame $p={2} className="flex flex-none items-center gap-3">
 *   <VariantNav
 *     item={item}
 *     variant={variant}
 *     cover={cover}
 *     onCoverChange={setCover}
 *     onStep={(step) => (step > 0 ? session.nextVariant() : session.previousVariant())}
 *     onSelect={session.selectVariant}
 *   />
 *   <ChangeLine … />
 * </Frame>
 */
export function VariantNav({
  item,
  variant,
  cover = false,
  onCoverChange,
  onStep,
  onSelect,
  className,
}: VariantNavProps) {
  const hasCover = onCoverChange != null;
  // The names of the variants, the number of marks, and the `All` button set
  // what the row needs.
  const { rowRef, fits } = useRowFit<HTMLDivElement>(`${hasCover}:${item.key}`);
  if (item.variants.length < 2) {
    return (
      <div className={cx("flex min-w-0 flex-1 items-center gap-2 px-2", className)}>
        <StatusGlyph status={getStripStatusName(variant)} />
        <Text className="truncate font-medium">{getFullName(variant)}</Text>
      </div>
    );
  }
  return (
    <div className={cx("min-w-0 flex-1", className)}>
      {/* The side padding leaves room for a focus ring inside the clip. */}
      <div ref={rowRef} className="relative -mx-1 flex items-center gap-3 overflow-x-clip px-1">
        <VariantStepper
          item={item}
          variant={variant}
          onStep={onStep}
          onSelect={onSelect}
          // The stepper keeps its width, so the row can tell what fits.
          className="max-w-full flex-none"
        />
        {/* A pager that does not fit leaves the flow and stays in the
            document, so the row still knows its width. A control is
            positioned by its recipe, so a wrapper takes it out of the flow. */}
        <span className={cx("flex flex-none", !fits && "invisible absolute")}>
          <VariantPager item={item} variant={variant} />
        </span>
        {hasCover && (
          <Button
            $size="sm"
            $lightnessOffset={cover ? 2 : undefined}
            aria-pressed={cover}
            onClick={() => onCoverChange(!cover)}
            className="flex-none"
          >
            <ButtonSlot>
              <LayoutGrid strokeWidth={iconStroke} />
            </ButtonSlot>
            <ButtonLabel>All</ButtonLabel>
          </Button>
        )}
      </div>
    </div>
  );
}
