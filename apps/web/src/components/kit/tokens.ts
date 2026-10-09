// The type, ink, and motion choices of the app as class constants. Each page
// uses these names, so one change here restyles each page.

/**
 * The root classes of a page. `text-sm` makes 14 px the base of every spacing
 * step, so the sign-in page is the only page that does not use it.
 */
export const pageRoot = "text-sm";

/**
 * Portals leave the page root, so a popover, a menu, a dialog, or a tooltip
 * needs the base size again.
 */
export const overlayRoot = "text-sm";

/**
 * The radius of the page shell. The stock shell has a fixed radius of 20 px,
 * and every frame near its edge takes a concentric share of it: the header
 * buttons, the rows of a list beside the main area, the main panel. A fixed value
 * does not follow the Radius control of the lab. This named step is 21 px at
 * the default radius, so the stock look stays, and it follows the control.
 */
export const shellRadius = "3xl";

/** Commit SHAs, branch names, pull request numbers in a title, and Error IDs. */
export const mono = "font-mono";

/** Secondary text. Never use an opacity class for soft text. */
export const secondary = "ak-ink-70";

/** Tertiary text: meta, times, and counts beside a name. */
export const tertiary = "ak-ink-60";

/**
 * The color role of the diff: the mask tint, the region boxes, and a changed
 * dimension. Pass it to `$layer`, `$edge`, and `$text`. The contract paints
 * differences red, so a rejection and the diff share the role.
 */
export const diffColor = "danger";

/** The stroke of every lucide icon that is not a status mark. */
export const iconStroke = 1.5;

/** The stroke of a status mark, so that it reads at 12 px. */
export const markStroke = 2.25;

/** A skeleton pulses, and it is still with reduced motion. */
export const skeletonMotion = "animate-pulse motion-reduce:animate-none";

/**
 * A verdict stamp: the mark scales from 0.6 to 1 and fades in, in 160 ms.
 * With reduced motion it is a color change only. Set `--stamp-delay` for a
 * cascade.
 */
export const stampMotion =
  "motion-safe:starting:scale-60 motion-safe:starting:opacity-0 motion-safe:transition-[scale,opacity] motion-safe:duration-160 motion-safe:ease-out motion-safe:delay-(--stamp-delay,0ms)";

/** An image fades in over 80 ms after a selection. */
export const imageMotion =
  "motion-safe:starting:opacity-0 motion-safe:transition-opacity motion-safe:duration-80";
