import { Button } from "./ariakit/components/button.ariakit.react.tsx";
import type { ButtonProps } from "./ariakit/components/button.ariakit.react.tsx";

export function ControlButton(props: ButtonProps) {
  return <Button $kind="bevel" $rounded="sm" {...props} />;
}
