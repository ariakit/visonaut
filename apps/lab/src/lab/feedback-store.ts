import { useSyncExternalStore } from "react";
import { catalog } from "./catalog.ts";
import { getDecisionFeedback, getVariantFeedback, reconcileFeedback } from "./feedback.ts";
import type {
  DecisionFeedback,
  FeedbackState,
  StoredFeedback,
  VariantFeedback,
  VariantMark,
} from "./feedback.ts";
import { INCORPORATED_FEEDBACK, record } from "./record.ts";

/** Feedback is saved in this browser only, under this key. */
export const feedbackStorageKey = "visonaut-lab:feedback";

const listeners = new Set<() => void>();
// What a browser without saved feedback starts from. The server renders it too.
const initialFeedback = reconcile();
let feedback: StoredFeedback | undefined;

function reconcile(stored?: StoredFeedback) {
  return reconcileFeedback({ stored, catalog, record, incorporated: INCORPORATED_FEEDBACK });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object") return false;
  if (value == null) return false;
  return !Array.isArray(value);
}

function toVariantFeedback(value: unknown) {
  if (!isRecord(value)) return;
  const result: VariantFeedback = {};
  if (value.mark === "like" || value.mark === "drop") {
    result.mark = value.mark;
  }
  if (typeof value.note === "string") {
    result.note = value.note;
  }
  return result;
}

function toDecisionFeedback(value: unknown) {
  if (!isRecord(value)) return;
  const result: DecisionFeedback = {};
  if (typeof value.pick === "string") {
    result.pick = value.pick;
  }
  if (typeof value.notes === "string") {
    result.notes = value.notes;
  }
  if (isRecord(value.variants)) {
    const variants: Record<string, VariantFeedback> = {};
    for (const [id, entry] of Object.entries(value.variants)) {
      const variant = toVariantFeedback(entry);
      if (!variant) continue;
      variants[id] = variant;
    }
    result.variants = variants;
  }
  const { stale } = value;
  if (isRecord(stale) && typeof stale.pick === "string" && typeof stale.revision === "string") {
    result.stale = { pick: stale.pick, revision: stale.revision };
  }
  return result;
}

// Storage is outside the type system, so every saved entry is rebuilt from
// the fields that have the expected type.
function toFeedbackState(value: unknown) {
  if (!isRecord(value)) return;
  const result: FeedbackState = {};
  for (const [decision, entry] of Object.entries(value)) {
    const feedbackEntry = toDecisionFeedback(entry);
    if (!feedbackEntry) continue;
    result[decision] = feedbackEntry;
  }
  return result;
}

function parseStored(text: string | null): StoredFeedback | undefined {
  if (!text) return;
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)) return;
    if (typeof value.revision !== "string") return;
    const baseline = toFeedbackState(value.baseline);
    const current = toFeedbackState(value.current);
    if (!baseline) return;
    if (!current) return;
    return { revision: value.revision, baseline, current };
  } catch {
    return;
  }
}

function load() {
  try {
    return reconcile(parseStored(localStorage.getItem(feedbackStorageKey)));
  } catch {
    return initialFeedback;
  }
}

function save(next: StoredFeedback) {
  try {
    localStorage.setItem(feedbackStorageKey, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in a private window. The feedback then
    // lasts until the page reloads.
  }
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function onStorage(event: StorageEvent) {
  if (event.key !== feedbackStorageKey) return;
  // Another lab tab saved feedback. Adopt it so that this tab does not
  // write an older state over it.
  feedback = load();
  emit();
}

function subscribe(listener: () => void) {
  if (!listeners.size) {
    window.addEventListener("storage", onStorage);
    // Save the reconciled state, so that a cleared pick and a new baseline
    // survive the next reload even without another change.
    save(getFeedback());
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    window.removeEventListener("storage", onStorage);
  };
}

export function getFeedback(): StoredFeedback {
  if (typeof window === "undefined") {
    return initialFeedback;
  }
  feedback ??= load();
  return feedback;
}

function getServerFeedback() {
  return initialFeedback;
}

function hasContent(decision: DecisionFeedback) {
  if (decision.pick != null) return true;
  if (decision.notes) return true;
  if (decision.stale) return true;
  return Object.keys(decision.variants ?? {}).length > 0;
}

function updateDecision(
  decision: string,
  update: (previous: DecisionFeedback) => DecisionFeedback,
) {
  const stored = getFeedback();
  const next = update(getDecisionFeedback(stored.current, decision) ?? {});
  const current = { ...stored.current };
  if (hasContent(next)) {
    current[decision] = next;
  } else {
    delete current[decision];
  }
  feedback = { ...stored, current };
  save(feedback);
  emit();
}

/** Picks an option, or clears the pick with `undefined`. Notes always stay. */
export function setPick(decision: string, pick: string | undefined) {
  updateDecision(decision, ({ pick: _pick, stale, ...rest }) => {
    // A new pick confirms a current option, so the stale pick is settled.
    if (pick != null) {
      return { ...rest, pick };
    }
    return stale ? { ...rest, stale } : rest;
  });
}

export function setNotes(decision: string, notes: string) {
  updateDecision(decision, ({ notes: _notes, ...rest }) => {
    return notes ? { ...rest, notes } : rest;
  });
}

function updateVariant(
  decision: string,
  variant: string,
  update: (previous: VariantFeedback) => VariantFeedback,
) {
  updateDecision(decision, ({ variants: previous, ...rest }) => {
    const next = update(getVariantFeedback({ variants: previous }, variant) ?? {});
    const variants = { ...previous };
    if (next.mark || next.note) {
      variants[variant] = next;
    } else {
      delete variants[variant];
    }
    return Object.keys(variants).length ? { ...rest, variants } : rest;
  });
}

/** Sets the like or drop mark of one variant, or clears it with `undefined`. */
export function setVariantMark(decision: string, variant: string, mark: VariantMark | undefined) {
  updateVariant(decision, variant, ({ mark: _mark, ...rest }) => {
    return mark ? { ...rest, mark } : rest;
  });
}

export function setVariantNote(decision: string, variant: string, note: string) {
  updateVariant(decision, variant, ({ note: _note, ...rest }) => {
    return note ? { ...rest, note } : rest;
  });
}

/** Returns the current feedback to the baseline. The baseline does not change. */
export function discardFeedbackRound() {
  const stored = getFeedback();
  feedback = reconcile({ ...stored, current: stored.baseline });
  save(feedback);
  emit();
}

export function useFeedback(): StoredFeedback {
  return useSyncExternalStore(subscribe, getFeedback, getServerFeedback);
}
