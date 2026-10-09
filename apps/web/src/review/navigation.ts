import type {
  ReviewCommand,
  ReviewItem,
  ReviewModel,
  ReviewSaveResult,
  ReviewSelection,
  ReviewVariant,
} from "./model.ts";

export function needsReview(variant: ReviewVariant) {
  if (variant.kind === "unchanged") return false;
  if (variant.kind === "error") return false;
  if (variant.kind === "pending") return false;
  return variant.verdict === null;
}

export function isAccepted(item: ReviewItem) {
  return (
    item.variants.length > 0 &&
    item.variants.every(
      (variant) =>
        variant.kind === "unchanged" ||
        (variant.kind !== "error" && variant.kind !== "pending" && variant.verdict === "approved"),
    )
  );
}

export interface ItemEntry {
  item: ReviewItem;
  index: number;
  position: number;
}

export function partitionItems(items: ReviewItem[]) {
  const attention: ItemEntry[] = [];
  const accepted: ItemEntry[] = [];
  for (const [index, item] of items.entries()) {
    const hasAddedVariant = item.variants.some((variant) => variant.kind === "added");
    const group = isAccepted(item) && !hasAddedVariant ? accepted : attention;
    group.push({ item, index, position: group.length });
  }
  return {
    attention,
    accepted,
    order: [...attention, ...accepted].map((entry) => entry.index),
  };
}

/**
 * The items of the first response with the unchanged screenshots of the loaded
 * pages, in the order of the page numbers. A screenshot that the first
 * response has stays as it is there.
 */
export function withUnchangedItems(
  items: ReviewItem[],
  pages: ReadonlyMap<number, ReviewItem[]>,
): ReviewItem[] {
  if (!pages.size) {
    return items;
  }
  const merged = [...items];
  const indexByKey = new Map(items.map((item, index) => [item.key, index]));
  const numbers = [...pages.keys()].sort((first, second) => first - second);
  for (const number of numbers) {
    for (const item of pages.get(number) ?? []) {
      const index = indexByKey.get(item.key);
      const current = index === undefined ? undefined : merged[index];
      if (index === undefined || !current) {
        indexByKey.set(item.key, merged.length);
        merged.push(item);
        continue;
      }
      const known = new Set(current.variants.map((variant) => variant.key));
      const added = item.variants.filter((variant) => !known.has(variant.key));
      if (added.length) {
        merged[index] = { ...current, variants: [...current.variants, ...added] };
      }
    }
  }
  return merged;
}

export function reviewTargets(item: ReviewItem) {
  return item.variants.filter(
    (variant) =>
      variant.kind === "added" || variant.kind === "changed" || variant.kind === "removed",
  );
}

export function applyPendingReviews(model: ReviewModel, commands: ReviewCommand[]): ReviewModel {
  const changes = new Map<string, { revision: number; verdict: ReviewCommand["verdict"] }>();
  for (const command of commands) {
    for (const target of command.targets) {
      // Later queued decisions follow the preceding decision's revision.
      changes.set(target.id, { revision: target.expectedRevision + 1, verdict: command.verdict });
    }
  }
  return {
    ...model,
    items: model.items.map((item) => ({
      ...item,
      variants: item.variants.map((variant) => {
        const change = changes.get(variant.id);
        if (!change) return variant;
        // The receipt of the decision brings the name of the reviewer.
        return { ...variant, ...change, source: "human", reviewer: undefined, ownDecision: true };
      }),
    })),
  };
}

/**
 * The sentence for a decision that the service refused because a person
 * decided for one of its variants first. The model is the state of the refusal.
 * The result is null when no target has a newer decision of a person.
 */
export function decisionConflict(model: ReviewModel, command: ReviewCommand): string | null {
  const variants = new Map(
    model.items.flatMap((item) => item.variants).map((variant) => [variant.id, variant]),
  );
  const decided = command.targets.flatMap((target) => {
    const variant = variants.get(target.id);
    if (!variant?.verdict) return [];
    if (variant.source !== "human") return [];
    if (variant.revision === target.expectedRevision) return [];
    return [variant];
  });
  // A decision for the whole item has each changed variant as a target. The
  // page keeps the selection, so the sentence is about that variant if it can be.
  const selected = model.items
    .find((item) => item.key === command.selection.itemKey)
    ?.variants.find((variant) => variant.key === command.selection.variantKey);
  const variant = decided.find((entry) => entry === selected) ?? decided[0];
  if (!variant) return null;
  // The other decision is one of the same person, for example in another tab.
  const reviewer = variant.ownDecision ? "You already" : (variant.reviewer ?? "Another reviewer");
  const place = variant === selected ? "this variant" : "another variant of this item";
  const refused = command.verdict === "approved" ? "approval" : "rejection";
  return `${reviewer} ${variant.verdict} ${place}. Your ${refused} was not saved.`;
}

export function latestReviewModel(current: ReviewModel, next: ReviewModel): ReviewModel {
  // Receipt polls can finish in a different order from their commands.
  if (next.run.id === current.run.id && next.comparisonRevision < current.comparisonRevision) {
    return current;
  }
  return next;
}

/**
 * The model of the page after the receipt of a saved decision. The result is
 * null when the page must read the model again: the receipt does not start
 * from the run revision that the page holds, or it does not have each value
 * that the decision changes in a model.
 */
export function applySavedReview(
  model: ReviewModel,
  command: ReviewCommand,
  result: ReviewSaveResult,
): ReviewModel | null {
  if (command.comparisonId !== model.comparisonId || result.commandId !== command.commandId) {
    throw new Error("The saved review does not match this comparison. Refresh before reviewing.");
  }
  const { runRevision, reviewer, runStatus, counts } = result;
  if (result.noop) return null;
  if (runRevision === undefined) return null;
  // A receipt has no name for a person with no stored name. A new model then
  // gives the state.
  if (reviewer === undefined) return null;
  if (runStatus === undefined) return null;
  if (counts === undefined) return null;
  // Each other status also changes values of the model that a receipt does not have.
  if (!["passed", "rejected", "needs-review"].includes(runStatus)) return null;
  // Another write came between the model of the page and this decision.
  if (result.previousRunRevision !== model.comparisonRevision) return null;
  // A change of the baseline can change what an approval is worth.
  if (result.baselineRevision !== model.baselineRevision) return null;
  if (result.promotionId !== model.promotionId) return null;
  const revisions = new Map(result.revisions.map((entry) => [entry.id, entry.expectedRevision]));
  if (revisions.size !== command.targets.length) return null;
  for (const target of command.targets) {
    if (revisions.get(target.id) !== target.expectedRevision + 1) return null;
  }
  let updated = 0;
  const items = model.items.map((item) => ({
    ...item,
    variants: item.variants.map((variant) => {
      const revision = revisions.get(variant.id);
      if (revision === undefined) return variant;
      updated++;
      return {
        ...variant,
        revision,
        verdict: command.verdict,
        source: "human" as const,
        reviewer,
        ownDecision: true,
      };
    }),
  }));
  if (updated !== revisions.size) return null;
  return {
    ...model,
    run: { ...model.run, status: runStatus },
    comparisonRevision: runRevision,
    counts,
    items,
  };
}

export function nextPending(items: ReviewItem[], selection: ReviewSelection) {
  const variants = items.flatMap((item) =>
    item.variants.map((variant) => ({
      itemKey: item.key,
      variantKey: variant.key,
      pending: needsReview(variant),
    })),
  );
  const current = variants.findIndex(
    (variant) =>
      variant.itemKey === selection.itemKey && variant.variantKey === selection.variantKey,
  );
  for (let offset = 1; offset <= variants.length; offset++) {
    const variant = variants[(current + offset) % variants.length];
    if (variant?.pending) {
      return { itemKey: variant.itemKey, variantKey: variant.variantKey };
    }
  }
  return null;
}

export function verdictLabel(variant: ReviewVariant) {
  if (variant.kind === "error") return "Comparison error";
  if (variant.kind === "pending") return "Comparing";
  if (variant.kind === "unchanged") return "Unchanged";
  if (variant.verdict === "rejected") return "Rejected";
  if (variant.verdict === "approved" && variant.source === "automatic") {
    return "Accepted automatically";
  }
  if (variant.verdict === "approved") return "Approved";
  return "Needs review";
}

export function itemThumbnail(item: ReviewItem) {
  return item.variants.find((variant) => variant.thumbnail)?.thumbnail;
}
