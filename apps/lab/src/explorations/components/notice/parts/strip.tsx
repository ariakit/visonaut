// The bar of a cell with its context: a strip of the main panel of the review
// page, with the kit stage of the variant that takes the next decision. The
// pill floats over the stage.

import { ReviewBar } from "../../../kits/ariakit/bar/bar.tsx";
import type { ReviewBarProps } from "../../../kits/ariakit/bar/bar.tsx";
import { ReviewStage } from "../../../kits/ariakit/stage/stage.tsx";
import { useStageView } from "../../../kits/ariakit/stage/view.ts";
import { Sheet } from "../../../kits/ariakit/surfaces.tsx";

export type StripProps = Omit<ReviewBarProps, "view" | "ready" | "className">;

/**
 * A piece of the main panel: the stage, and the bar over it. The strip has a
 * view of its own, so its zoom and its region stepper work.
 */
export function Strip({ session, stored, ...props }: StripProps) {
  const { item, variant } = session;
  const view = useStageView({ variant, mode: stored.mode });
  return (
    <Sheet $p={1.5} className="grid grid-cols-1">
      {/* The pill lays itself over the nearest positioned element. */}
      <div className="relative grid grid-cols-1">
        <ReviewStage
          variant={variant}
          item={item}
          view={view}
          mode={stored.mode}
          mask={stored.mask}
          // The pill covers 4rem at the bottom of the stage, as on the page.
          gutterBottom={4}
          className="h-72"
        />
        <ReviewBar
          session={session}
          stored={stored}
          view={view}
          ready={!view.images.failed}
          {...props}
        />
      </div>
    </Sheet>
  );
}
