import { findVariant, isSettled } from "./surfaces.ts";
import type { Catalog, SurfaceEntry } from "./types.ts";

/** The pick value of the explicit option "None of these". */
export const NONE_OF_THESE = "@none";

export type VariantMark = "like" | "drop";

export interface VariantFeedback {
  mark?: VariantMark;
  note?: string;
}

/** A pick that the catalog no longer offers. */
export interface StalePick {
  pick: string;
  /** The record revision in which the lab cleared the pick. */
  revision: string;
}

export interface DecisionFeedback {
  /** A variant identifier, or `NONE_OF_THESE`. Absent means open. */
  pick?: string;
  notes?: string;
  /** Marks and notes by variant identifier. */
  variants?: Record<string, VariantFeedback>;
  stale?: StalePick;
}

/** Feedback by decision identifier. */
export type FeedbackState = Record<string, DecisionFeedback>;

export interface FeedbackRecord {
  title: string;
  revision: string;
  auditDocument: string;
  labPath: string;
}

export interface StoredFeedback {
  /** The record revision that the baseline belongs to. */
  revision: string;
  /** The feedback that the living record already contains. */
  baseline: FeedbackState;
  current: FeedbackState;
}

export interface DecisionStatus {
  answered: boolean;
  /** `Open`, the name of the picked variant, or `None of these`. */
  label: string;
  /** The decision differs from the baseline in this feedback round. */
  changed: boolean;
}

/** Reads a decision without matching inherited keys such as `constructor`. */
export function getDecisionFeedback(
  state: FeedbackState,
  decision: string,
): DecisionFeedback | undefined {
  if (!Object.hasOwn(state, decision)) return;
  return state[decision];
}

export function getVariantFeedback(
  feedback: DecisionFeedback | undefined,
  variant: string,
): VariantFeedback | undefined {
  const variants = feedback?.variants;
  if (!variants) return;
  if (!Object.hasOwn(variants, variant)) return;
  return variants[variant];
}

function isCurrentOption(surface: SurfaceEntry, pick: string) {
  if (pick === NONE_OF_THESE) return true;
  return !!findVariant(surface, pick);
}

/**
 * Reduces one decision to its meaning, so that two states compare by value.
 * Empty notes and empty marks equal no feedback. A stale pick counts only in
 * the revision that cleared it: a later revision has already merged it.
 */
function getDecisionSignature(feedback: DecisionFeedback | undefined, revision?: string) {
  const variants = Object.entries(feedback?.variants ?? {})
    .map(([id, value]) => [id, value.mark ?? null, value.note?.trim() ?? ""] as const)
    .filter(([, mark, note]) => mark != null || note !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  const stale = feedback?.stale;
  return JSON.stringify({
    pick: feedback?.pick ?? null,
    notes: feedback?.notes?.trim() ?? "",
    variants,
    stale: stale && stale.revision === revision ? stale.pick : null,
  });
}

export function isDecisionChanged(stored: StoredFeedback, decision: string) {
  const current = getDecisionFeedback(stored.current, decision);
  const baseline = getDecisionFeedback(stored.baseline, decision);
  return getDecisionSignature(current, stored.revision) !== getDecisionSignature(baseline);
}

export function getDecisionStatus(stored: StoredFeedback, surface: SurfaceEntry): DecisionStatus {
  const pick = getDecisionFeedback(stored.current, surface.decision)?.pick;
  const changed = isDecisionChanged(stored, surface.decision);
  if (pick === NONE_OF_THESE) {
    return { answered: true, label: "None of these", changed };
  }
  const variant = findVariant(surface, pick);
  if (variant) {
    return { answered: true, label: variant.name, changed };
  }
  return { answered: false, label: "Open", changed };
}

/** The surfaces whose decision the maintainer can still make, in catalog order. */
export function getOpenSurfaces(catalog: Catalog) {
  return catalog.surfaces.filter((surface) => !isSettled(surface));
}

/** The surfaces whose decision the record already has, in catalog order. */
export function getSettledSurfaces(catalog: Catalog) {
  return catalog.surfaces.filter(isSettled);
}

/**
 * The number of open decisions with an answer. Only an explicit pick of a
 * current option counts as answered, and a settled decision does not count.
 */
export function countAnswered(stored: StoredFeedback, catalog: Catalog) {
  return getOpenSurfaces(catalog).filter((surface) => getDecisionStatus(stored, surface).answered)
    .length;
}

export function getChangedSurfaces(stored: StoredFeedback, catalog: Catalog) {
  return catalog.surfaces.filter((surface) => isDecisionChanged(stored, surface.decision));
}

interface ReconcileFeedbackParams {
  /** The saved feedback, when the browser has any. */
  stored?: StoredFeedback;
  catalog: Catalog;
  record: FeedbackRecord;
  /** The feedback that the living record already contains. */
  incorporated: FeedbackState;
}

/**
 * Aligns saved feedback with the code. A new record revision replaces the
 * baseline and keeps the current feedback. A pick that the catalog no longer
 * offers becomes a stale pick: the notes stay and the decision is open.
 */
export function reconcileFeedback({
  stored,
  catalog,
  record,
  incorporated,
}: ReconcileFeedbackParams): StoredFeedback {
  const baseline = stored?.revision === record.revision ? stored.baseline : incorporated;
  const current = { ...(stored?.current ?? incorporated) };
  for (const surface of catalog.surfaces) {
    const feedback = getDecisionFeedback(current, surface.decision);
    if (feedback?.pick == null) continue;
    if (isCurrentOption(surface, feedback.pick)) continue;
    const { pick, ...rest } = feedback;
    current[surface.decision] = { ...rest, stale: { pick, revision: record.revision } };
  }
  return { revision: record.revision, baseline, current };
}

function describePick(surface: SurfaceEntry, feedback: DecisionFeedback | undefined) {
  const pick = feedback?.pick;
  if (pick === NONE_OF_THESE) return "None of these";
  const variant = findVariant(surface, pick);
  if (!variant) return "OPEN";
  return `${variant.name} (variant \`${variant.id}\`)`;
}

function describeNotes(notes: string | undefined) {
  const text = notes?.trim();
  if (!text) {
    return ["Notes: none"];
  }
  if (!text.includes("\n")) {
    return [`Notes: ${text}`];
  }
  return ["Notes:", ...text.split("\n").map((line) => `  ${line}`)];
}

function describeVariants(surface: SurfaceEntry, feedback: DecisionFeedback | undefined) {
  const lines: string[] = [];
  for (const [id, value] of Object.entries(feedback?.variants ?? {})) {
    const note = value.note?.trim();
    if (!value.mark && !note) continue;
    const variant = findVariant(surface, id);
    const name = variant ? `${variant.name} (\`${id}\`)` : `\`${id}\` (no longer in the catalog)`;
    const mark = value.mark ?? "note";
    lines.push(note ? `- ${mark}: ${name}: ${note}` : `- ${mark}: ${name}`);
  }
  if (!lines.length) {
    return ["Variant marks: none"];
  }
  return ["Variant marks:", ...lines];
}

function describeDecision(stored: StoredFeedback, surface: SurfaceEntry) {
  const current = getDecisionFeedback(stored.current, surface.decision);
  const baseline = getDecisionFeedback(stored.baseline, surface.decision);
  const lines = [
    `${surface.decision}: ${surface.question}`,
    `Surface: ${surface.title} (${surface.kind} \`${surface.id}\`)`,
  ];
  if (isSettled(surface)) {
    lines.push("State: settled in an earlier round. The notes are comments on the settled design.");
  }
  lines.push(`Answer: ${describePick(surface, current)}`);
  const stale = current?.stale;
  if (!current?.pick && stale?.revision === stored.revision) {
    lines.push(
      `Reason: the earlier pick \`${stale.pick}\` is no longer an option. The maintainer has not confirmed a current option.`,
    );
  }
  lines.push(`Answer in the living record: ${describePick(surface, baseline)}`);
  lines.push(...describeNotes(current?.notes));
  lines.push(...describeVariants(surface, current));
  return lines.join("\n");
}

// The line of the prompt that says how many open decisions have an answer.
function describeAnswers(open: SurfaceEntry[], unanswered: SurfaceEntry[]) {
  if (!open.length) return "No decision is open.";
  if (!unanswered.length) {
    return `Every open decision has an answer (${open.length} of ${open.length}).`;
  }
  const decisions = unanswered.map((surface) => surface.decision).join(", ");
  return `Open decisions without an answer (${unanswered.length} of ${open.length}): ${decisions}.`;
}

interface BuildContinuationPromptParams {
  stored: StoredFeedback;
  catalog: Catalog;
  record: FeedbackRecord;
}

/**
 * Builds the handoff text for the next agent. It lists only the decisions
 * that differ from the baseline. It never changes the baseline.
 */
export function buildContinuationPrompt({
  stored,
  catalog,
  record,
}: BuildContinuationPromptParams) {
  const changed = getChangedSurfaces(stored, catalog);
  const open = getOpenSurfaces(catalog);
  const unanswered = open.filter((surface) => !getDecisionStatus(stored, surface).answered);
  const updates = changed.length
    ? [
        `Decisions updated in this feedback round (${changed.length}). The other decisions did not change and are not listed.`,
        "",
        changed.map((surface) => describeDecision(stored, surface)).join("\n\n"),
      ]
    : ["No decision changed in this feedback round."];
  return [
    `Continue the design review of "${record.title}".`,
    "",
    "Living record",
    `- Title: ${record.title}`,
    `- Revision: ${record.revision}`,
    `- Audit document: ${record.auditDocument}`,
    `- Design lab: ${record.labPath} (decisions: ${record.labPath}/src/lab/catalog.ts, incorporated feedback: ${record.labPath}/src/lab/record.ts)`,
    "",
    ...updates,
    "",
    describeAnswers(open, unanswered),
    "",
    "Instructions",
    "1. Load the complete living record before you change anything: the audit document, the lab catalog, and the incorporated feedback.",
    "2. Merge the updates above into the living record. Preserve every decision that is not listed here.",
    "3. Treat only an explicit maintainer choice as a decision. Notes and variant marks give context. They are not decisions.",
    "4. Keep every OPEN item open. Do not settle it for the maintainer.",
    "5. If a note conflicts with the selected answer, ask the maintainer to resolve the conflict.",
    "6. If a note raises a new alternative, compare it with the current options before you change the design.",
    "7. Production implementation and GitHub publication are out of scope unless the maintainer authorizes them separately.",
    `8. After the merge, set INCORPORATED_FEEDBACK in ${record.labPath}/src/lab/record.ts to the merged feedback and change the revision in the same file and in the audit document. This starts the next feedback round.`,
  ].join("\n");
}
