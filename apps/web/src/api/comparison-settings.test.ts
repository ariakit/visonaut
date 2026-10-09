import type { CaptureComparison, Manifest } from "@visonaut/protocol";
import { digestJson } from "@visonaut/protocol";
import type { ReferenceCaptureInput } from "@visonaut/service";
import { expect, it } from "vitest";
import { comparisonSettingsCounts } from "./local-comparison.ts";

const builtIn: CaptureComparison = { threshold: 0.2, maxDiffPixels: 0 };

type Row = [itemKey: string, settings?: CaptureComparison, baseline?: CaptureComparison | null];

/** The counts of a manifest and a baseline that have only the fields that the counts read. */
async function counts(rows: Row[]) {
  const references = [];
  for (const [itemKey, , baseline] of rows) {
    if (baseline === undefined) continue;
    references.push({
      itemKey,
      variantKey: "light",
      metadata: baseline ? { comparisonDigest: await digestJson(baseline) } : {},
    });
  }
  const manifest = {
    captures: rows.map(([itemKey, comparison]) => ({
      itemKey,
      variant: { key: "light" },
      comparison,
    })),
  };
  // The counts read no other field, so the test gives no complete manifest.
  return comparisonSettingsCounts(manifest as Manifest, references as ReferenceCaptureInput[]);
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
