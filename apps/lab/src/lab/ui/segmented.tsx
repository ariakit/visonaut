import * as ak from "@ariakit/react";
import type { ReactNode } from "react";
import {
  Button,
  ButtonGlider,
  ButtonGroup,
  ButtonLabel,
  ButtonSlot,
} from "../../components/ariakit/components/button.ariakit.react.tsx";
import type { ButtonGroupProps } from "../../components/ariakit/components/button.ariakit.react.tsx";
import {
  Tooltip,
  TooltipAnchor,
  TooltipProvider,
} from "../../components/ariakit/components/tooltip.ariakit.react.tsx";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /** A short hint for an option that shows only its icon. */
  hint?: string;
}

export interface SegmentedProps<T extends string> extends Omit<
  ButtonGroupProps,
  "onChange" | "children"
> {
  /** The accessible name of the group. */
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Shows icons only. Each label stays as the accessible name and a tooltip. */
  iconOnly?: boolean;
}

/**
 * One choice out of a few, as a radio group in one bordered surface. A
 * glider marks the checked option.
 */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
  iconOnly = false,
  ...props
}: SegmentedProps<T>) {
  const setValue = (next: string | number | null) => {
    const option = options.find((item) => item.value === next);
    if (!option) return;
    onChange(option.value);
  };
  return (
    <ak.RadioProvider value={value} setValue={setValue}>
      <ak.RadioGroup aria-label={label} render={<ButtonGroup $border {...props} />}>
        {options.map((option) => {
          const radio = (
            <ak.Radio
              key={option.value}
              value={option.value}
              render={<Button aria-label={iconOnly ? option.label : undefined} />}
            >
              {option.icon && <ButtonSlot>{option.icon}</ButtonSlot>}
              {!iconOnly && <ButtonLabel>{option.label}</ButtonLabel>}
            </ak.Radio>
          );
          if (!iconOnly) {
            return radio;
          }
          return (
            <TooltipProvider key={option.value} timeout={400}>
              <TooltipAnchor render={radio} />
              <Tooltip>{option.hint ?? option.label}</Tooltip>
            </TooltipProvider>
          );
        })}
        <ButtonGlider $kind="bevel" />
      </ak.RadioGroup>
    </ak.RadioProvider>
  );
}
