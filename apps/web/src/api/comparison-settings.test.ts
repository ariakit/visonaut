import type { CaptureComparison } from "@visonaut/protocol";
import { digestJson } from "@visonaut/protocol";
import { expect, it } from "vitest";
import type { InventoryCapture } from "../capture-inventory.ts";
import { checkedComparison, listReference } from "./local-comparison.ts";

const builtIn: CaptureComparison = { threshold: 0.2, maxDiffPixels: 0 };

type Row = [itemKey: string, settings?: CaptureComparison, baseline?: CaptureComparison | null];

/** One capture of a run or of its baseline. */
function inventoryCapture(
  runId: string,
  itemKey: string,
  metadata: Record<string, unknown>,
): InventoryCapture {
  return {
    id: `${runId}-${itemKey}`,
    itemKey,
    variantKey: "light",
    ordinal: 0,
    imageId: `${runId}-${itemKey}`,
    profileDigest: "profile",
    renderingProfileDigest: "profile",
    environmentProfileDigest: "profile",
    testId: "test",
    testRetry: 0,
    image: {
      id: `${runId}-${itemKey}`,
      runId,
      digest: `${runId}-${itemKey}`,
      objectKey: `runs/${runId}/images/${itemKey}`,
      contentType: "image/png",
      bytes: 80,
      width: 10,
      height: 10,
    },
    metadata,
  };
}

/** The settings counts of the comparison of a capture list and its baseline. */
async function counts(rows: Row[]) {
  const references: InventoryCapture[] = [];
  const captures: InventoryCapture[] = [];
  for (const [itemKey, comparison, baseline] of rows) {
    // A changed result needs no reference capture.
    captures.push(
      inventoryCapture("run", itemKey, {
        observedImage: { digest: `run-${itemKey}`, width: 10, height: 10 },
        localResult: { outcome: "changed", changedPixels: 1, ratio: 0.01 },
        ...(comparison ? { comparison, comparisonDigest: await digestJson(comparison) } : {}),
      }),
    );
    if (baseline === undefined) continue;
    references.push(
      inventoryCapture(
        "reference",
        itemKey,
        baseline ? { comparisonDigest: await digestJson(baseline) } : {},
      ),
    );
  }
  const pages = async function* () {
    yield { captures, profiles: [] };
  };
  const comparison = await checkedComparison({
    pages: pages(),
    reference: { snapshotId: "reference", baselineRevision: 1, digest: null },
    references: listReference(references),
  });
  return comparison.settings;
}

it("counts a capture as loose only when its settings permit more than threshold 0.2 and 0 pixels", async () => {
  expect(
    await counts([
      ["built-in", builtIn],
      ["no-pixel-field", { threshold: 0.2 }],
      ["zero-ratio", { threshold: 0.2, maxDiffPixelRatio: 0 }],
      ["stricter", { threshold: 0.1, maxDiffPixels: 0 }],
      ["threshold", { threshold: 0.21, maxDiffPixels: 0 }],
      ["pixels", { threshold: 0.2, maxDiffPixels: 1 }],
      ["ratio", { threshold: 0.2, maxDiffPixelRatio: 0.01 }],
      ["no-settings"],
    ]),
  ).toEqual({ changed: 0, loose: 3 });
});

it("counts a capture as changed when its settings differ from the settings of its baseline", async () => {
  expect(
    await counts([
      ["same", builtIn, builtIn],
      // The digest does not depend on the order of the keys.
      ["same-other-order", { maxDiffPixels: 0, threshold: 0.2 }, builtIn],
      ["looser", { threshold: 0.5, maxDiffPixels: 0 }, builtIn],
      ["stricter", { threshold: 0.1, maxDiffPixels: 0 }, builtIn],
      ["tightened", builtIn, { threshold: 0.5, maxDiffPixels: 0 }],
      // An added capture has no baseline, and an imported baseline has no digest.
      ["added", { threshold: 0.5, maxDiffPixels: 0 }],
      ["imported", { threshold: 0.5, maxDiffPixels: 0 }, null],
    ]),
  ).toEqual({ changed: 3, loose: 3 });
});
