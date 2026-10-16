import { cx } from "clava";
import { Check, Undo2, X } from "lucide-react";
import { Button, ButtonLabel, ButtonSlot } from "../../ariakit/components/button.ariakit.react.tsx";
import { Hint } from "../controls.tsx";
import { ShortcutSlot, useShortcuts } from "../keys.tsx";
import { iconStroke } from "../tokens.ts";

export interface BarControl {
  disabled: boolean;
  /** Why the control is off, for its tooltip. */
  reason?: string;
  onClick(): void;
}

type DecisionVerb = "approve" | "reject";

// The width of the widest content of each button, so the two buttons stay in
// one place. In a narrow bar the buttons take the width of their words.
const buttonWidths: Record<DecisionVerb, string> = {
  approve: "@min-[36rem]:min-w-[7.5em]",
  reject: "@min-[36rem]:min-w-[7em]",
};

export interface DecisionButtonProps {
  action: DecisionVerb;
  control: BarControl;
  className?: string;
}

/**
 * Reject or Approve for the selected variant. Approve is the one brand
 * surface of the view while it is the next action: a disabled Approve has no
 * brand layer, so it does not look active.
 */
export function DecisionButton({ action, control, className }: DecisionButtonProps) {
  // The page ignores the keys while the keyboard switch is off.
  const { enabled: shortcuts } = useShortcuts();
  const approves = action === "approve";
  const key = approves ? "A" : "X";
  const brand = approves && !control.disabled;
  return (
    <Button
      $kind={brand ? "bevel" : undefined}
      $layer={brand ? "brand" : undefined}
      $border={!brand}
      aria-keyshortcuts={shortcuts ? key : undefined}
      disabled={control.disabled}
      title={control.reason}
      onClick={control.onClick}
      className={cx("flex-none", buttonWidths[action], className)}
    >
      <ButtonSlot>{approves ? <Check /> : <X />}</ButtonSlot>
      <ButtonLabel>{approves ? "Approve" : "Reject"}</ButtonLabel>
      {/* A narrow bar has no key hints, so its buttons fit in one row. */}
      <ShortcutSlot keys={[key]} className="@max-[30rem]:hidden" />
    </Button>
  );
}

export interface UndoButtonProps {
  control: BarControl;
  className?: string;
}

/** Undo as an icon, with its name and key in a tooltip. */
export function UndoButton({ control, className }: UndoButtonProps) {
  const { enabled: shortcuts } = useShortcuts();
  return (
    <Hint label="Undo" shortcut={["⌘", "Z"]}>
      <Button
        aria-label="Undo"
        aria-keyshortcuts={shortcuts ? "Meta+Z Control+Z" : undefined}
        disabled={control.disabled}
        // Undo turns itself off. It keeps the focus then.
        accessibleWhenDisabled
        onClick={control.onClick}
        className={cx("flex-none", className)}
      >
        <ButtonSlot>
          <Undo2 strokeWidth={iconStroke} />
        </ButtonSlot>
      </Button>
    </Hint>
  );
}
