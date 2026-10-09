import { expect, test } from "vitest";
import { parseCapturePage, parseReviewModel } from "../client.ts";
import { compactReviewItems, compactReviewModel } from "../compact-model.ts";
import { fixtureModel } from "./fixture-model.ts";

test("a capture page keeps its items in the compact form", () => {
  const items = fixtureModel().items;
  const page = {
    format: "review-captures-1" as const,
    page: 1,
    pages: 3,
    ...compactReviewItems(items),
  };
  expect(parseCapturePage(page)).toEqual({ page: 1, pages: 3, items });
  expect(() => parseCapturePage({ ...page, format: "compact-review-2" })).toThrow(
    "Refresh before reviewing",
  );
});

test("one compact complete model retains variant-specific evidence and diagnostics", () => {
  const model = fixtureModel();
  const first = model.items[0]?.variants[0];
  const second = model.items[0]?.variants[1];
  if (!first || !second) throw new Error("Missing fixture variants.");
  second.reference = first.reference;
  second.codec = "different-codec";
  const compact = compactReviewModel(model);
  expect(parseReviewModel(compact)).toEqual(model);
  expect(compact.items[0]?.variants[0]?.reference).toBe(compact.items[0]?.variants[1]?.reference);
  expect(compact.metadata).toHaveLength(2);
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(model).length);
});

test("unsupported formats and invalid shared references cannot become actionable evidence", () => {
  const model = fixtureModel();
  expect(() => parseReviewModel(model)).toThrow("Refresh before reviewing");
  const compact = compactReviewModel(model);
  const item = compact.items[0];
  const variant = item?.variants[0];
  if (!item || !variant) throw new Error("Missing fixture variant.");
  for (const invalid of [-1, 0.5, compact.images.length, "0"]) {
    expect(() =>
      parseReviewModel({
        ...compact,
        items: [{ ...item, variants: [{ ...variant, candidate: invalid }] }],
      }),
    ).toThrow();
  }
  expect(() =>
    parseReviewModel({
      ...compact,
      items: [{ ...item, variants: [{ ...variant, metadata: compact.metadata.length }] }],
    }),
  ).toThrow("invalid review metadata");
});
