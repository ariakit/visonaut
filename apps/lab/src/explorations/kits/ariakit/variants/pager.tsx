import { cx } from "clava";
import {
  Button,
  ButtonGlider,
  ButtonGroup,
  ButtonLabel,
  ButtonSlot,
} from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import type { SessionItem, SessionVariant } from "../../../../fixtures/hooks/index.ts";
import { Hint } from "../controls.tsx";
import { PlaceLink } from "../place.tsx";
import { StatusGlyph, getStripStatusName } from "../status.tsx";
import { getCountedMarks, getStateWord, getVariantName } from "./model.ts";

// With more variants than this, the pager shows counted marks. A mark is a
// link with the size of a small button, so twelve of them do not fit beside
// the stepper and the change summary at 1440 px. 591 of 626 screenshots have
// 6 variants or less.
const longestPager = 8;

export interface VariantPagerProps {
  item: SessionItem;
  /** The variant on the stage. */
  variant: SessionVariant;
  className?: string;
}

/**
 * The marks of the variant control: one glyph for each variant of the
 * screenshot, in declared order, each one a link to its variant. The stock
 * selected glider marks the variant on the stage. A screenshot with more than
 * 8 variants shows one counted mark for each state, and each one is a link
 * to the next variant in that state.
 */
export function VariantPager({ item, variant: selected, className }: VariantPagerProps) {
  const counted = item.variants.length > longestPager;
  return (
    <ButtonGroup
      aria-label={counted ? "Variants by state" : "Variants"}
      $size="sm"
      $p="none"
      $gap="xs"
      className={cx("flex-none", className)}
    >
      {counted &&
        getCountedMarks(item, selected).map((mark) => (
          <Hint key={mark.status} label={mark.label}>
            <Button
              aria-label={`${mark.label}: ${mark.count}`}
              render={<PlaceLink itemKey={item.key} variantKey={mark.target.key} />}
            >
              <ButtonSlot>
                <StatusGlyph status={mark.status} decorative />
              </ButtonSlot>
              <ButtonLabel className="font-normal tabular-nums">{mark.count}</ButtonLabel>
            </Button>
          </Hint>
        ))}
      {!counted &&
        item.variants.map((variant) => (
          <Hint key={variant.key} label={`${variant.name} · ${getStateWord(variant)}`}>
            <Button
              aria-label={getVariantName(variant)}
              aria-current={variant.key === selected.key ? "true" : undefined}
              render={<PlaceLink itemKey={item.key} variantKey={variant.key} />}
            >
              <ButtonSlot>
                <StatusGlyph status={getStripStatusName(variant)} decorative />
              </ButtonSlot>
            </Button>
          </Hint>
        ))}
      {!counted && <ButtonGlider />}
      <ButtonGlider $state="hover" />
      <ButtonGlider $state="focus" />
    </ButtonGroup>
  );
}
