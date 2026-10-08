// What the variant control reads from the variants of one screenshot: the
// words of a variant, and the counted marks of a long set. All of it comes
// from fields that every data mode has.

import type { SessionItem, SessionVariant } from "../../../../fixtures/hooks/index.ts";
import { getVariantWords } from "../../../../fixtures/index.ts";
import { getStripStatusName, statusStyles } from "../status.tsx";
import type { StatusName } from "../status.tsx";

// The app binds the keys `1` to `6`, so only the first six variants print one.
const printedKeys = 6;

/** The number key that selects a variant, or undefined from the seventh on. */
export function getVariantKey(variant: Pick<SessionVariant, "index">): string | undefined {
  return variant.index < printedKeys ? String(variant.index + 1) : undefined;
}

/** Every part of a variant: `React · Firefox · Desktop · Light`. */
export function getFullName(variant: SessionVariant): string {
  return getVariantWords(variant).join(" · ");
}

/** The word of the state of a variant, as a strip shows it: `Needs review`. */
export function getStateWord(variant: SessionVariant): string {
  return statusStyles[getStripStatusName(variant)].label;
}

/** `Firefox, Dark. Needs review`: the name of a control of one variant. */
export function getVariantName(variant: SessionVariant): string {
  return `${variant.name.replaceAll(" · ", ", ")}. ${getStateWord(variant)}`;
}

/** One counted mark of a long set: a state, its count, and where it leads. */
export interface CountedMark {
  status: StatusName;
  count: number;
  /** The next variant in this state after the selected one. The search wraps. */
  target: SessionVariant;
  /** `Next that needs review`. */
  label: string;
}

// What needs a person comes first.
const countOrder: readonly StatusName[] = [
  "needs-review",
  "rejected",
  "failed",
  "comparing",
  "approved",
  "auto-approved",
  "added",
  "removed",
  "unchanged",
];

function getNextLabel(status: StatusName): string {
  if (status === "needs-review") return "Next that needs review";
  return `Next ${statusStyles[status].label.toLowerCase()}`;
}

/**
 * The counted marks of a screenshot with too many variants for one mark
 * each: `○ 5  = 19`. Each mark leads to the next variant in its state after
 * the selected one, so every mark of the row is a link.
 */
export function getCountedMarks(item: SessionItem, selected: SessionVariant): CountedMark[] {
  const { variants } = item;
  const marks = new Map<StatusName, CountedMark>();
  // The walk starts after the selected variant and ends on it, so the first
  // variant that it meets in a state is the target of that state.
  for (let offset = 1; offset <= variants.length; offset++) {
    const variant = variants[(selected.index + offset) % variants.length];
    if (!variant) continue;
    const status = getStripStatusName(variant);
    const mark = marks.get(status);
    if (mark) {
      mark.count += 1;
      continue;
    }
    marks.set(status, { status, count: 1, target: variant, label: getNextLabel(status) });
  }
  const result: CountedMark[] = [];
  for (const status of countOrder) {
    const mark = marks.get(status);
    if (!mark) continue;
    result.push(mark);
  }
  return result;
}
