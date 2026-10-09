import { cx } from "clava";
import { Skeleton } from "./surfaces.tsx";

export interface SkeletonLineProps {
  /** A softer bar, for the second line of a row. */
  soft?: boolean;
  /** A bar that does not pulse, under an `ErrorBand`. */
  still?: boolean;
  /**
   * The text size of the line that the bar stands for, and the width of the
   * bar: `w-40 text-xs`.
   */
  className?: string;
}

/**
 * A skeleton bar in a box with the height of one line of text. A row of
 * these has the exact height of the words that replace it, at every density.
 * @example
 * <SkeletonLine className="w-2/3 text-lg" />
 * <SkeletonLine soft className="w-24 text-xs" />
 */
export function SkeletonLine({ soft, still, className }: SkeletonLineProps) {
  return (
    <div aria-hidden className={cx("flex h-lh max-w-full items-center", className)}>
      <Skeleton soft={soft} still={still} className="h-[0.75em] w-full" />
    </div>
  );
}
