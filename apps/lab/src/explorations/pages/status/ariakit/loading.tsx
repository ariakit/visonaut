import { Progress } from "../../../../components/ariakit/components/progress.ariakit.react.tsx";
import { SkeletonLine } from "../../../kits/ariakit/skeleton-line.tsx";
import { Sheet, Skeleton } from "../../../kits/ariakit/surfaces.tsx";

export interface StatusSkeletonProps {
  /** A still shape under an `ErrorBand`: nothing loads while the error shows. */
  still?: boolean;
}

/**
 * The shape of the page before the status loads: a neutral card of the
 * height of the health card, and two meters with empty tracks. It shows no
 * words. The region around it says that it is busy.
 */
export function StatusSkeleton({ still }: StatusSkeletonProps) {
  return (
    <div aria-hidden className="grid min-w-0 gap-4">
      {/* The padding and the row of the health card: a mark, the verdict, the
          check time, and one icon button. */}
      <Sheet className="flex items-center gap-3">
        <Skeleton still={still} $rounded="full" className="size-[1.5em] flex-none" />
        {/* The verdict takes the free width, and its block is as long as its
            words. */}
        <div className="min-w-0 flex-1">
          <SkeletonLine still={still} className="w-40 text-lg" />
        </div>
        <SkeletonLine soft still={still} className="w-24 text-xs @max-3xl/shell:hidden" />
        <Skeleton soft still={still} $rounded="md" $p={2} className="flex-none">
          <div className="size-[1lh]" />
        </Skeleton>
      </Sheet>
      <div className="grid gap-4 @3xl/shell:grid-cols-2">
        {[0, 1].map((index) => (
          <Sheet key={index} className="grid content-start gap-3">
            <SkeletonLine soft still={still} className="w-20 text-xs" />
            <SkeletonLine still={still} className="w-44 text-lg" />
            <Progress aria-label="Loading" value={0} />
          </Sheet>
        ))}
      </div>
    </div>
  );
}
