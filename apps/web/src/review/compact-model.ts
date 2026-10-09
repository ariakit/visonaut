import type { ReviewImage, ReviewItem, ReviewModel, ReviewVariant } from "./model.ts";

export interface ReviewMetadata {
  engine?: string;
  codec?: string;
  policy?: string;
  threshold?: string;
  referenceProfile?: string;
  candidateProfile?: string;
}

/**
 * A variant of an answer. It has no read-only reason: the header of a closed
 * run has the reason one time, and the reader gives it to each variant.
 */
export interface CompactReviewVariant extends Omit<
  ReviewVariant,
  | keyof ReviewMetadata
  | "reference"
  | "candidate"
  | "diff"
  | "rejectDisabledReason"
  | "approveDisabledReason"
> {
  reference: number | null;
  candidate: number | null;
  diff: number | null;
  metadata: number;
}

export interface CompactReviewModel extends Omit<ReviewModel, "items"> {
  format: "compact-review-2";
  images: ReviewImage[];
  metadata: ReviewMetadata[];
  items: Array<{ key: string; name: string; variants: CompactReviewVariant[] }>;
}

/** The answer of the second request of a run page: one page of unchanged screenshots. */
export interface CompactCapturePage extends Pick<
  CompactReviewModel,
  "images" | "metadata" | "items"
> {
  format: "review-captures-1";
  page: number;
  pages: number;
}

/** Send shared evidence and policy fields once. */
export function compactReviewModel(model: ReviewModel): CompactReviewModel {
  return { ...model, format: "compact-review-2", ...compactReviewItems(model.items) };
}

export function compactReviewItems(
  list: ReviewItem[],
): Pick<CompactReviewModel, "images" | "metadata" | "items"> {
  const images: ReviewImage[] = [];
  const imageIndexes = new Map<string, number>();
  const metadata: ReviewMetadata[] = [];
  const metadataIndexes = new Map<string, number>();
  const imageIndex = (image: ReviewImage | null) => {
    if (!image) return null;
    let index = imageIndexes.get(image.id);
    if (index !== undefined) {
      const existing = images[index];
      if (
        !existing ||
        existing.url !== image.url ||
        existing.digest !== image.digest ||
        existing.width !== image.width ||
        existing.height !== image.height
      ) {
        throw new Error("Shared image identity has inconsistent evidence.");
      }
      return index;
    }
    if (index === undefined) {
      index = images.length;
      images.push(image);
      imageIndexes.set(image.id, index);
    }
    return index;
  };
  const items = list.map((item) => ({
    key: item.key,
    name: item.name,
    variants: item.variants.map((variant) => {
      const {
        reference,
        candidate,
        diff,
        engine,
        codec,
        policy,
        threshold,
        referenceProfile,
        candidateProfile,
        rejectDisabledReason: _rejectDisabledReason,
        approveDisabledReason: _approveDisabledReason,
        ...fields
      } = variant;
      const shared = { engine, codec, policy, threshold, referenceProfile, candidateProfile };
      const key = JSON.stringify(shared);
      let index = metadataIndexes.get(key);
      if (index === undefined) {
        index = metadata.length;
        metadata.push(shared);
        metadataIndexes.set(key, index);
      }
      return {
        ...fields,
        reference: imageIndex(reference),
        candidate: imageIndex(candidate),
        diff: imageIndex(diff),
        metadata: index,
      };
    }),
  }));
  return { images, metadata, items };
}
