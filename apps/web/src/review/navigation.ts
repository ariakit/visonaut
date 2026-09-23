import type { ReviewItem, ReviewSelection, ReviewVariant } from "./model.ts";

export function needsReview(variant: ReviewVariant) {
  if (variant.kind === "unchanged") return false;
  if (variant.kind === "error") return false;
  return variant.verdict === null;
}

export function reviewTargets(item: ReviewItem) {
  return item.variants.filter(
    (variant) =>
      variant.kind === "added" || variant.kind === "changed" || variant.kind === "removed",
  );
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
  if (variant.kind === "unchanged") return "Unchanged";
  if (variant.verdict === "rejected") return "Rejected";
  if (variant.verdict === "approved" && variant.source === "automatic") {
    return "Accepted automatically";
  }
  if (variant.verdict === "approved") return "Approved";
  return "Needs review";
}

export function itemThumbnail(item: ReviewItem) {
  const candidate = item.variants.find((variant) => variant.candidate);
  if (candidate) {
    return candidate.thumbnail ?? candidate.candidate?.url;
  }
  return item.variants.find((variant) => variant.reference)?.reference?.url;
}
