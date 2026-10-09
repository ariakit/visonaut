import { cx } from "clava";
import {
  ArrowRight,
  Check,
  CheckCheck,
  Circle,
  CircleArrowRight,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleMinus,
  CirclePlus,
  CircleX,
  Equal,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Badge, BadgeLabel, BadgeSlot } from "../ariakit/components/badge.ariakit.react.tsx";
import type { BadgeProps } from "../ariakit/components/badge.ariakit.react.tsx";
import { Text } from "../ariakit/components/text.ariakit.react.tsx";
import { reviewStateWords, type RunReviewState } from "@visonaut/protocol";
import { markStroke, stampMotion } from "./tokens.ts";

/**
 * The one status vocabulary: the eight run states, the seven variant states
 * (four of them are also run states), and the two kinds that a strip shows
 * for a decided variant (`added` and `removed`).
 */
export type StatusName =
  | "needs-review"
  | "rejected"
  | "failed"
  | "rerun-needed"
  | "comparing"
  | "capturing"
  | "passed"
  | "replaced"
  | "approved"
  | "auto-approved"
  | "unchanged"
  | "added"
  | "removed";

/** The state of a variant in a review session. */
export type ReviewStatus =
  | "problem"
  | "needs-review"
  | "comparing"
  | "rejected"
  | "approved"
  | "unchanged";

/** What a variant is, against the baseline. */
export type VariantKind = "added" | "changed" | "removed" | "unchanged" | "pending" | "error";

export type StatusRole = "brand" | "success" | "warning" | "danger" | "neutral";

export interface StatusStyle {
  /** One or two words. This is the only name of the status in the product. */
  label: string;
  role: StatusRole;
  /** The icon of the pill. */
  icon: LucideIcon;
  /** The bare shape for a strip of marks: the icon of the pill without its circle. */
  glyph: LucideIcon;
  /** The icon turns. Only one status moves, so a long list stays calm. */
  turns?: boolean;
  /** Closed work without a result: the pill has no fill. */
  quiet?: boolean;
}

export const statusStyles: Record<StatusName, StatusStyle> = {
  "needs-review": {
    label: reviewStateWords["needs-review"],
    role: "warning",
    icon: CircleDot,
    glyph: Circle,
  },
  rejected: { label: reviewStateWords.rejected, role: "danger", icon: CircleX, glyph: X },
  failed: {
    label: reviewStateWords.failed,
    role: "danger",
    icon: TriangleAlert,
    glyph: TriangleAlert,
  },
  "rerun-needed": {
    label: reviewStateWords["needs-recompare"],
    role: "warning",
    icon: RefreshCw,
    glyph: RefreshCw,
  },
  comparing: {
    label: reviewStateWords.comparing,
    role: "neutral",
    icon: LoaderCircle,
    glyph: LoaderCircle,
    turns: true,
  },
  capturing: {
    label: reviewStateWords.incomplete,
    role: "neutral",
    icon: CircleDashed,
    glyph: CircleDashed,
  },
  passed: { label: reviewStateWords.passed, role: "success", icon: CircleCheck, glyph: Check },
  replaced: {
    label: reviewStateWords.superseded,
    role: "neutral",
    icon: CircleArrowRight,
    glyph: ArrowRight,
    quiet: true,
  },
  approved: { label: "Approved", role: "success", icon: CircleCheck, glyph: Check },
  "auto-approved": { label: "Auto-approved", role: "neutral", icon: CheckCheck, glyph: CheckCheck },
  // `Minus` is a removed screenshot in a strip, so an unchanged one is `Equal`
  // in both forms.
  unchanged: { label: "Unchanged", role: "neutral", icon: Equal, glyph: Equal, quiet: true },
  added: { label: "Added", role: "success", icon: CirclePlus, glyph: Plus },
  removed: { label: "Removed", role: "danger", icon: CircleMinus, glyph: Minus },
};

/** The run states in the order of a legend: work first, results last. */
export const runStatusOrder: readonly StatusName[] = [
  "needs-review",
  "rejected",
  "failed",
  "rerun-needed",
  "comparing",
  "capturing",
  "passed",
  "replaced",
];

/**
 * The variant states in the order of the run legend: the four words that a
 * run shares come first and keep their place, and the settled states follow.
 */
export const variantStatusOrder: readonly StatusName[] = [
  "needs-review",
  "rejected",
  "failed",
  "comparing",
  "approved",
  "auto-approved",
  "unchanged",
];

const runStatusNames: Record<RunReviewState, StatusName> = {
  incomplete: "capturing",
  comparing: "comparing",
  "needs-review": "needs-review",
  rejected: "rejected",
  passed: "passed",
  failed: "failed",
  superseded: "replaced",
  "needs-recompare": "rerun-needed",
};

/** The status name of a run state. */
function getRunStatusName(state: RunReviewState): StatusName {
  return runStatusNames[state];
}

/** The two fields of a run that give its status. */
export interface RunResultSource {
  state: RunReviewState;
  closedState?: RunReviewState;
}

/**
 * The status of a run with the last result of a closed run. The API has one
 * state for every closed run. With `closedState` (D-UX-04), a run that
 * finished before it closed shows that result: `passed`, `rejected`, or
 * `failed`. Every other closed run is `replaced`.
 */
export function getRunResultName(run: RunResultSource): StatusName {
  if (run.state !== "superseded") return getRunStatusName(run.state);
  const { closedState } = run;
  if (closedState === "passed") return "passed";
  if (closedState === "rejected") return "rejected";
  if (closedState === "failed") return "failed";
  return "replaced";
}

export interface StatusSource {
  status: ReviewStatus;
  /** True when the service approved the variant, not a person. */
  automatic?: boolean;
}

/** The status name of a session variant, or of a session item. */
export function getReviewStatusName({ status, automatic }: StatusSource): StatusName {
  if (status === "problem") return "failed";
  if (status === "approved") return automatic ? "auto-approved" : "approved";
  return status;
}

export interface StripSource extends StatusSource {
  kind: VariantKind;
}

/**
 * The status name of a variant for a strip of glyphs. An approved variant
 * shows what the approval accepted: a new screenshot is `added`, and one that
 * is gone is `removed`.
 */
export function getStripStatusName(variant: StripSource): StatusName {
  const name = getReviewStatusName(variant);
  if (variant.status !== "approved") return name;
  if (variant.kind === "added") return "added";
  if (variant.kind === "removed") return "removed";
  return name;
}

/** The layer value of a role: a neutral role paints the parent color. */
export function getRoleLayer(role: StatusRole) {
  return role === "neutral" ? true : role;
}

/** The text color value of a role: a neutral role has no color. */
export function getRoleText(role: StatusRole) {
  return role === "neutral" ? undefined : role;
}

const turning = "animate-spin [animation-duration:2.4s] motion-reduce:animate-none";

export interface StatusPillProps extends Omit<BadgeProps, "children"> {
  status: StatusName;
  /** The state text when it is not the state word, for example `246 changes`. */
  children?: ReactNode;
  /** The icon alone, which makes a disc. The word is the accessible name. */
  compact?: boolean;
  /**
   * On a solid color surface a tint has no contrast, so the pill takes the
   * inverted neutral and the icon alone tells the state.
   */
  invert?: boolean;
}

/**
 * The status as the stock badge: a tint and a ring in the color of the
 * state, its icon, and its word. A state that is closed work has no fill, so
 * a column of pills keeps its weight for the states that count. Use it
 * wherever a status shows outside a strip of marks.
 * @example
 * <StatusPill status={getRunResultName(run)} />
 * <StatusPill status="needs-review">246 changes</StatusPill>
 * <StatusPill status="failed" compact />
 */
export function StatusPill({ status, children, compact, invert, ...props }: StatusPillProps) {
  const { label, role, icon: Icon, turns, quiet } = statusStyles[status];
  const layer = quiet ? "transparent" : getRoleLayer(role);
  return (
    <Badge
      $layer={invert ? undefined : layer}
      $invert={invert}
      // The stock text is a tint of the layer. On a selected row the layer is
      // a mix with the tint of the row, and a warning pill would read green.
      // The named color keeps the hue of the state.
      $text={invert ? undefined : getRoleText(role)}
      $edgeWeight={quiet && !invert ? "normal" : undefined}
      $forceRounded
      role={compact ? "img" : undefined}
      aria-label={compact ? label : undefined}
      {...props}
    >
      <BadgeSlot>
        <Icon aria-hidden className={cx(turns && turning)} />
      </BadgeSlot>
      {!compact && (
        // Tabular figures also widen a hyphen, so only a count takes them.
        <BadgeLabel className={cx(children != null && "tabular-nums")}>
          {children != null && <span className="sr-only">{`${label}: `}</span>}
          {children ?? label}
        </BadgeLabel>
      )}
    </Badge>
  );
}

export interface StatusGlyphProps {
  status: StatusName;
  /** Replaces the status name as the accessible name. */
  label?: string;
  /** Hides the glyph from assistive technology when text beside it names it. */
  decorative?: boolean;
  /**
   * Milliseconds before the stamp motion starts. Pass a number only in the
   * render that changes the status, so that a glyph does not stamp on load.
   */
  stamp?: number;
  className?: string;
}

/**
 * The status as one bare shape, for a strip of marks: one glyph for each
 * variant of a screenshot. Six pills in a row are too heavy, so a strip is
 * the only place of the glyph. In a slot, the slot sizes it. Outside a slot
 * it is 1em wide.
 * @example
 * <ButtonSlot>
 *   <StatusGlyph status={getStripStatusName(variant)} />
 * </ButtonSlot>
 */
export function StatusGlyph({ status, label, decorative, stamp, className }: StatusGlyphProps) {
  const { label: name, role, glyph: Icon, turns } = statusStyles[status];
  // A custom property is not a key of the style type.
  const delay = { "--stamp-delay": `${stamp ?? 0}ms` } as CSSProperties;
  return (
    <Text
      $text={getRoleText(role)}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : (label ?? name)}
      aria-hidden={decorative || undefined}
      style={stamp == null ? undefined : delay}
      className={cx(
        "size-[1em] flex-none",
        role === "neutral" && "ak-ink-50",
        // The open circle is the widest shape of the set. A smaller one has
        // the optical weight of the other glyphs.
        status === "needs-review" && "scale-80",
        turns && turning,
        stamp != null && stampMotion,
        className,
      )}
      render={<Icon strokeWidth={markStroke} />}
    />
  );
}
