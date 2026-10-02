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
        return { ...variant, ...change, source: "human", reviewer: undefined };
      }),
    })),
  };
}

export function latestReviewModel(current: ReviewModel, next: ReviewModel): ReviewModel {
  // Receipt polls can finish in a different order from their commands.
  if (next.run.id === current.run.id && next.comparisonRevision < current.comparisonRevision) {
    return current;
  }
  return next;
}

export function applySavedReview(
  model: ReviewModel,
  command: ReviewCommand,
  result: ReviewSaveResult,
): ReviewModel {
  if (result.model) return latestReviewModel(model, result.model);
  if (result.noop) return model;
  if (
    result.runRevision === undefined ||
    result.reviewer === undefined ||
    result.runStatus === undefined
  ) {
    throw new Error("The saved review is incomplete. Refresh before reviewing.");
  }
  if (command.comparisonId !== model.comparisonId || result.commandId !== command.commandId) {
    throw new Error("The saved review does not match this comparison. Refresh before reviewing.");
  }
  const revisions = new Map(result.revisions.map((entry) => [entry.id, entry.expectedRevision]));
  if (revisions.size !== command.targets.length) {
    throw new Error(
      "The saved review returned an incomplete target list. Refresh before reviewing.",
    );
  }
  for (const target of command.targets) {
    if (revisions.get(target.id) !== target.expectedRevision + 1) {
      throw new Error(
        "The saved review returned an unexpected revision. Refresh before reviewing.",
      );
    }
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
        reviewer: result.reviewer,
      };
    }),
  }));
  if (updated !== revisions.size) {
    throw new Error("The saved review changed unknown evidence. Refresh before reviewing.");
  }
  return {
    ...model,
    run: { ...model.run, status: result.runStatus },
    comparisonRevision: result.runRevision,
    baselineRevision: result.baselineRevision,
    promotionId: result.promotionId,
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
