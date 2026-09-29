import type { ReviewImage, ReviewModel, ReviewVariant } from "./model.ts";

export interface ReviewMetadata {
  engine?: string;
  codec?: string;
  policy?: string;
  threshold?: string;
  referenceProfile?: string;
  candidateProfile?: string;
}

export interface CompactReviewVariant extends Omit<
  ReviewVariant,
  keyof ReviewMetadata | "reference" | "candidate" | "diff"
> {
  reference: number | null;
  candidate: number | null;
  diff: number | null;
  metadata: number;
}

export interface CompactReviewModel extends Omit<ReviewModel, "items"> {
  format: "compact-review-1";
  images: ReviewImage[];
  metadata: ReviewMetadata[];
  items: Array<{ key: string; name: string; variants: CompactReviewVariant[] }>;
}

/** Keep one complete read while sending shared evidence and policy fields once. */
export function compactReviewModel(model: ReviewModel): CompactReviewModel {
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
  const items = model.items.map((item) => ({
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
  return { ...model, format: "compact-review-1", images, metadata, items };
}
