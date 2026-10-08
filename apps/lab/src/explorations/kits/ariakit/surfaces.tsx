import { cx } from "clava";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Frame } from "../../../components/ariakit/components/frame.ariakit.react.tsx";
import type { FrameProps } from "../../../components/ariakit/components/frame.ariakit.react.tsx";
import { Heading } from "../../../components/ariakit/components/heading.ariakit.react.tsx";
import { Text } from "../../../components/ariakit/components/text.ariakit.react.tsx";
import type { StatusRole } from "./status.tsx";
import { iconStroke, secondary, skeletonMotion } from "./tokens.ts";

/**
 * A raised surface on the desk: cards, a group of run rows, the main panel. Its
 * children keep their own radius, because the padding is 1rem.
 * @example
 * <Sheet className="grid gap-3">…</Sheet>
 */
export function Sheet({ className, ...props }: FrameProps) {
  return (
    <Frame
      $lighten
      $border
      $rounded="2xl"
      $p="1rem"
      // On the light canvas a raised frame has almost the canvas color, so
      // the shadow and the ring carry the depth.
      className={cx("ak-light:shadow-sm", className)}
      {...props}
    />
  );
}

/**
 * A recessed surface inside a sheet: the stage, a preview strip, a table
 * head. It has no border. Depth separates it.
 * @example
 * <Well $p={1.5} className="grid grid-flow-col gap-1.5">…</Well>
 */
export function Well(props: FrameProps) {
  return <Frame $darken={1.5} $rounded="xl" {...props} />;
}

export interface EmptyStateProps extends Omit<FrameProps, "title"> {
  icon: LucideIcon;
  /** The tint of the mark. Default: `brand`. */
  tone?: Exclude<StatusRole, "neutral">;
  /** The heading of the state, in `text-xl`. */
  title: ReactNode;
  /** One line under the heading. */
  children?: ReactNode;
  /** One button or one link. */
  action?: ReactNode;
  /** Without the dashed frame, for a state inside a well or a table body. */
  bare?: boolean;
}

/**
 * The empty pattern: a tint mark, a heading, one line, and one action, in a
 * dashed frame. One pattern for "all reviewed", "no baseline", "no match",
 * and "nothing to review".
 * @example
 * <EmptyState icon={Check} tone="success" title="All reviewed" action={openHistory}>
 *   Baseline 412 · updated 2 h ago
 * </EmptyState>
 */
export function EmptyState({
  icon: Icon,
  tone = "brand",
  title,
  children,
  action,
  bare,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <Frame
      $border={bare ? undefined : true}
      $borderType={bare ? undefined : "dashed"}
      $rounded="2xl"
      $p="2rem"
      className={cx("grid justify-items-center gap-4 text-center", className)}
      {...props}
    >
      <Frame $layer={tone} $mix={15} $rounded="full" $forceRounded $p={3}>
        <Text $text={tone} className="flex">
          <Icon aria-hidden strokeWidth={iconStroke} className="size-6" />
        </Text>
      </Frame>
      <div className="grid max-w-md gap-1">
        <Heading className="mt-0 mb-0 text-xl font-semibold text-balance">{title}</Heading>
        {children != null && <Text className={cx(secondary, "text-pretty")}>{children}</Text>}
      </div>
      {action}
    </Frame>
  );
}

export interface SkeletonProps extends FrameProps {
  /** A softer block, for the second line of a row. */
  soft?: boolean;
  /**
   * A block that does not pulse, for the shape of a region under an
   * `ErrorBand`: nothing loads while the error shows.
   */
  still?: boolean;
}

/**
 * A placeholder with the exact size of the content that replaces it. Give it
 * the size with classes. Put `aria-busy` and a name on the region around the
 * skeletons, not on each one.
 * @example
 * <Skeleton className="h-3.5 w-2/3" />
 */
export function Skeleton({ soft, still, className, ...props }: SkeletonProps) {
  return (
    <Frame
      aria-hidden
      $lightnessOffset={soft ? 1 : 2}
      $rounded="sm"
      className={cx(!still && skeletonMotion, className)}
      {...props}
    />
  );
}
