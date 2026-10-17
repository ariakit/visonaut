import { useState } from "react";
import type { ReviewItem, ReviewSelection, ReviewVariant } from "./model.ts";
import { pickVariant } from "./session-items.ts";

export interface RecalledVariant {
  variant: ReviewVariant;
  /** The remembered variant is gone, so `variant` is the one of a row click. */
  lost: boolean;
}

export interface VariantMemory {
  /** Keeps the variant as the one that the reviewer selected in its screenshot. */
  remember(selection: ReviewSelection): void;
  /**
   * The variant to open in a screenshot: the remembered one, else the first
   * variant that needs review.
   */
  recall(item: ReviewItem): RecalledVariant | undefined;
}

/**
 * The variant that the reviewer selected last in each screenshot. Up, Down,
 * and the two screenshot buttons open it. A row click and a decision do not
 * change it. It is state of the page: a reload forgets it, and an address
 * with a variant starts it.
 * @example
 * const memory = useVariantMemory(route?.selection);
 * memory.remember({ itemKey: item.key, variantKey: variant.key });
 * const recalled = memory.recall(nextItem);
 */
export function useVariantMemory(initial?: { itemKey: string; variantKey?: string }) {
  const [memory] = useState((): VariantMemory => {
    const variants = new Map<string, string>();
    if (initial?.variantKey) {
      variants.set(initial.itemKey, initial.variantKey);
    }
    return {
      remember: ({ itemKey, variantKey }) => {
        variants.set(itemKey, variantKey);
      },
      recall: (item) => {
        const previous = variants.get(item.key);
        const remembered = item.variants.find((entry) => entry.key === previous);
        if (remembered) return { variant: remembered, lost: false };
        const variant = pickVariant(item);
        if (!variant) return undefined;
        return { variant, lost: !!previous };
      },
    };
  });
  return memory;
}
