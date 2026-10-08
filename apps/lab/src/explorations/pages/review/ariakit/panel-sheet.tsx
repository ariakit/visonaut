import { cx } from "clava";
import type { FrameProps } from "../../../../components/ariakit/components/frame.ariakit.react.tsx";
import { Sheet } from "../../../kits/ariakit/surfaces.tsx";
import { panelClass, panelEdge } from "./layout.ts";

/**
 * The main panel of the workspace: a sheet without padding that takes the
 * height that the page has left, with its edge inside its frame.
 * @example
 * <PanelSheet>
 *   <ResultPage session={session} />
 * </PanelSheet>
 */
export function PanelSheet({ className, ...props }: FrameProps) {
  return (
    <Sheet $p="none" $borderType={panelEdge} className={cx(panelClass, className)} {...props} />
  );
}
