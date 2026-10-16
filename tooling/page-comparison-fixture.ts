import type { LocalComparisonReceipt } from "../packages/protocol/src/types.ts";
import type { ReferenceCaptureInput } from "../packages/service/src/types.ts";

/**
 * The comparison input of the service for a run in pages, from the complete
 * receipt of a test fixture. The service takes only the results that are not
 * unchanged, their reference captures, and the removed references, with the
 * counts that a Submit checks one page at a time.
 */
export function pageComparison(
  receipt: LocalComparisonReceipt,
  references: readonly ReferenceCaptureInput[],
) {
  const identity = (capture: { itemKey: string; variantKey: string }) =>
    JSON.stringify([capture.itemKey, capture.variantKey]);
  const captures = receipt.captures.filter((result) => result.outcome !== "unchanged");
  const kept = new Set([...captures, ...receipt.removals].map(identity));
  return {
    localComparison: { ...receipt, captures },
    referenceCaptures: references.filter((capture) => kept.has(identity(capture))),
    checked: {
      captureCount: receipt.captures.length,
      referenceImageRunIds: [...new Set(references.map((capture) => capture.image.runId))],
    },
  };
}
