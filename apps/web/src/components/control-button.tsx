import { Button } from "./ariakit/components/button.ariakit.react.tsx";
import type { ButtonProps } from "./ariakit/components/button.ariakit.react.tsx";

// The upstream Button infers its recipe from the props. A wrapper without a
// custom recipe omits that prop, so the variant props keep their types.
type ControlButtonProps = Omit<ButtonProps, "recipe">;

export function ControlButton({ className = "", ...props }: ControlButtonProps) {
  return (
    <Button $kind="flat" $rounded="lg" $p={2.5} className={`shrink-0 ${className}`} {...props} />
  );
}
