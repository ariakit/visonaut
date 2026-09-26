import * as ak from "@ariakit/react";
import { cv, splitProps } from "clava";
import type { VariantProps } from "clava";
import { frame } from "./frame.ariakit.react.tsx";

// The header, body, and footer tracks are the part of Ariakit UI's Shell used
// by Visonaut. Keep the copied recipe beside its React component.
const shell = cv({
  extend: [frame],
  class: [
    "shell isolate grid @container/shell min-h-dvh rounded-none!",
    "grid-cols-[[shell-start]_minmax(0,1fr)_[shell-end]]",
    "grid-rows-[[header-start]_auto_[header-end_body-start]_minmax(0,1fr)_[body-end_footer-start]_auto_[footer-end]]",
    "print:h-auto print:min-h-0",
  ],
  defaultVariants: {
    $layer: "canvas",
    $rounded: "none",
    $p: "none",
  },
});

export interface ShellProps extends ak.RoleProps<"div">, VariantProps<typeof shell> {}

/** Places page chrome and content in one page-height grid. */
export function Shell(props: ShellProps) {
  const [variantProps, rest] = splitProps(props, shell);
  return <ak.Role.div {...shell.jsx(variantProps)} {...rest} />;
}
