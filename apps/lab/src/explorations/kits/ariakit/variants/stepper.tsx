import { cx } from "clava";
import { ChevronLeft, ChevronRight, Circle } from "lucide-react";
import { ButtonGroup } from "../../../../components/ariakit/components/button.ariakit.react.tsx";
import {
  ComboboxItem,
  ComboboxItemCheck,
  ComboboxItemLabel,
  ComboboxItemSlot,
  ComboboxPopover,
  ComboboxProvider,
  ComboboxSelect,
} from "../../../../components/ariakit/components/combobox.ariakit.react.tsx";
import { Text } from "../../../../components/ariakit/components/text.ariakit.react.tsx";
import type { SessionItem, SessionVariant } from "../../../../fixtures/hooks/index.ts";
import { IconButton } from "../controls.tsx";
import { useShortcuts } from "../keys.tsx";
import { StatusGlyph, getStripStatusName } from "../status.tsx";
import { iconStroke, overlayRoot, tertiary } from "../tokens.ts";
import { getVariantKey, getVariantName } from "./model.ts";

export interface VariantStepperProps {
  item: SessionItem;
  /** The variant on the stage. */
  variant: SessionVariant;
  /** The previous or the next variant of the screenshot. */
  onStep(step: 1 | -1): void;
  /** A variant of the list. */
  onSelect(variantKey: string): void;
  className?: string;
}

/**
 * The stepper of the variant control (UI-VARIANT-SWITCHER, `stepper`):
 * previous, the variant on the stage with its position, and next. The width
 * is the same for 2 and for 24 variants. The middle button opens the list of
 * all variants, where the first six print their number key.
 */
export function VariantStepper({
  item,
  variant: selected,
  onStep,
  onSelect,
  className,
}: VariantStepperProps) {
  const { enabled } = useShortcuts();
  const { variants } = item;
  const position = `${selected.index + 1} / ${variants.length}`;
  const spokenPosition = `${selected.index + 1} of ${variants.length}`;
  const spokenName = getVariantName(selected);
  return (
    <>
      <ButtonGroup $border $size="sm" aria-label="Variant" className={cx("min-w-0", className)}>
        <IconButton
          label="Previous variant"
          shortcut={["←"]}
          icon={<ChevronLeft strokeWidth={iconStroke} />}
          // At an end the button stays in the Tab order, so that the focus does
          // not leave the control when the last step disables it.
          disabled={selected.index <= 0}
          accessibleWhenDisabled
          onClick={() => onStep(-1)}
        />
        <ComboboxProvider
          selectedValue={selected.key}
          setSelectedValue={(value) => {
            if (typeof value !== "string") return;
            onSelect(value);
          }}
        >
          <ComboboxSelect
            $layer="transparent"
            aria-label={`Variant: ${spokenName}. ${spokenPosition}`}
            // Left and Right step through the variants, here and on the page.
            // Down opens the list.
            moveOnKeyDown={false}
            icon={<StatusGlyph status={getStripStatusName(selected)} decorative />}
            displayValue={
              <span className="flex items-center gap-3">
                {/* Every name takes the same place, so the control has the
                  width of the longest one and does not change with the
                  selection. */}
                <span className="grid min-w-0 flex-1 items-center">
                  {variants.map((variant) => (
                    <span
                      key={variant.key}
                      aria-hidden={variant.key !== selected.key}
                      className={cx(
                        "col-start-1 row-start-1 truncate",
                        variant.key !== selected.key && "invisible",
                      )}
                    >
                      {variant.name}
                    </span>
                  ))}
                </span>
                <Text className={cx(tertiary, "grid flex-none justify-items-end font-normal")}>
                  <span aria-hidden className="invisible col-start-1 row-start-1 tabular-nums">
                    {`${variants.length} / ${variants.length}`}
                  </span>
                  <span className="col-start-1 row-start-1 tabular-nums">{position}</span>
                </Text>
              </span>
            }
            className="min-w-0 items-center justify-start"
          />
          <ComboboxPopover unmountOnHide className={overlayRoot}>
            {variants.map((variant) => {
              const key = getVariantKey(variant);
              return (
                <ComboboxItem
                  key={variant.key}
                  value={variant.key}
                  aria-label={getVariantName(variant)}
                >
                  <ComboboxItemCheck $size="xs">
                    <Circle fill="currentColor" />
                  </ComboboxItemCheck>
                  <ComboboxItemSlot>
                    <StatusGlyph status={getStripStatusName(variant)} decorative />
                  </ComboboxItemSlot>
                  <ComboboxItemLabel className="flex-1">{variant.name}</ComboboxItemLabel>
                  {enabled && key && (
                    <ComboboxItemSlot $kind="shortcut" aria-hidden>
                      <kbd>{key}</kbd>
                    </ComboboxItemSlot>
                  )}
                </ComboboxItem>
              );
            })}
          </ComboboxPopover>
        </ComboboxProvider>
        <IconButton
          label="Next variant"
          shortcut={["→"]}
          icon={<ChevronRight strokeWidth={iconStroke} />}
          disabled={selected.index >= variants.length - 1}
          accessibleWhenDisabled
          onClick={() => onStep(1)}
        />
      </ButtonGroup>
      {/* The focus stays on a step button, so this line says the new variant. */}
      <span aria-live="polite" aria-atomic className="sr-only">
        {`${spokenName}. ${spokenPosition}`}
      </span>
    </>
  );
}
