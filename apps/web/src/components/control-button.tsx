import { Button } from "./ariakit/components/button.ariakit.react.tsx";
import type { ButtonProps } from "./ariakit/components/button.ariakit.react.tsx";

export function ControlButton({ className = "", ...props }: ButtonProps) {
  return (
    <Button
      $kind="flat"
      $rounded="lg"
      $p={2.5}
      className={`text-[13px] leading-5 shrink-0 ${className}`}
      {...props}
    />
  );
}
