import type { SessionItem, SessionVariant, VariantAxes } from "../session.ts";
import type { ReviewStatus } from "../status.tsx";

interface VariantParams {
  status: ReviewStatus;
  axes?: Partial<VariantAxes>;
  automatic?: boolean;
}

const kinds: Record<ReviewStatus, SessionVariant["kind"]> = {
  problem: "error",
  comparing: "pending",
  unchanged: "unchanged",
  "needs-review": "changed",
  rejected: "changed",
  approved: "changed",
};

export function createVariant(
  itemKey: string,
  index: number,
  { status, axes, automatic = false }: VariantParams,
): SessionVariant {
  const key = `${itemKey}-variant-${index}`;
  return {
    id: key,
    key,
    label: key,
    kind: kinds[status],
    revision: 0,
    verdict: null,
    source: null,
    reference: null,
    candidate: null,
    diff: null,
    itemKey,
    index,
    name: key,
    axes: {
      framework: "react",
      browser: "chromium",
      colorScheme: "light",
      contrast: "no-preference",
      forcedColors: "none",
      ...axes,
    },
    status,
    automatic,
  };
}

// A screenshot takes the first status of this list that one of its variants has.
const itemStatusOrder: readonly ReviewStatus[] = [
  "problem",
  "needs-review",
  "comparing",
  "rejected",
  "approved",
  "unchanged",
];

/** A screenshot of the given variants. The key is `family/leaf`. */
export function createItem(key: string, variants: VariantParams[]): SessionItem {
  const [family = key, ...rest] = key.split("/");
  const sessionVariants = variants.map((params, index) => createVariant(key, index, params));
  const status = itemStatusOrder.find((name) => variants.some((entry) => entry.status === name));
  return {
    key,
    name: key,
    label: rest.join(" "),
    family,
    status: status ?? "unchanged",
    variants: sessionVariants,
  };
}
