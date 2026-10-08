import { cx } from "clava";
import { Frame } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import type { SessionItem } from "../../../../fixtures/hooks/index.ts";
import { StatusGlyph, getStripStatusName } from "../status.tsx";
import { secondary } from "../tokens.ts";
import { countStripStatuses } from "./model.ts";

// With more variants than this, a row shows one glyph and one number for each
// state. 591 of 626 screenshots have 6 variants or less.
const longestStrip = 8;

export interface VariantMarksProps {
  item: SessionItem;
  /** The variant on the stage, when the row is the selected one. */
  selectedKey?: string | null;
  className?: string;
}

/**
 * The strip of a row: one glyph for each variant of a screenshot, in declared
 * order, so the position of a glyph is the number key of its variant. The
 * accessible name of the row has the words, so the strip is decoration.
 */
export function VariantMarks({ item, selectedKey, className }: VariantMarksProps) {
  if (item.variants.length > longestStrip) {
    return (
      <span aria-hidden className={cx("flex flex-none items-center gap-2 tabular-nums", className)}>
        {countStripStatuses(item.variants).map(({ status, count }) => (
          <span key={status} className="flex items-center gap-1">
            <StatusGlyph status={status} decorative />
            <Text className={secondary}>{count}</Text>
          </span>
        ))}
      </span>
    );
  }
  return (
    // Each glyph has a frame with a padding for the selected mark. The strip
    // takes that padding back at both ends, so its first and its last glyph
    // stand on the edges of the text around it.
    <span aria-hidden className={cx("-mx-0.5 flex flex-none items-center", className)}>
      {item.variants.map((variant) => {
        const selected = variant.key === selectedKey;
        return (
          <Frame
            key={variant.key}
            $rounded="sm"
            $forceRounded
            $p={0.5}
            $lightnessOffset={selected ? 3 : undefined}
            $border={selected}
            $borderType={selected ? "ring" : undefined}
            className="flex"
            render={<span />}
          >
            <StatusGlyph status={getStripStatusName(variant)} decorative />
          </Frame>
        );
      })}
    </span>
  );
}
