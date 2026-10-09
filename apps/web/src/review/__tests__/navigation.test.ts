import { expect, test } from "vitest";
import type { ReviewItem, ReviewVariant } from "../model.ts";
import { decisionConflict, withUnchangedItems } from "../navigation.ts";
import { fixtureModel } from "./fixture-model.ts";

function variant(key: string, kind: ReviewVariant["kind"]): ReviewVariant {
  return {
    id: `row-${key}-${kind}`,
    key,
    label: key,
    kind,
    revision: 0,
    verdict: null,
    source: null,
    reference: null,
    candidate: null,
    diff: null,
  };
}

function item(key: string, variants: ReviewVariant[]): ReviewItem {
  return { key, name: key, variants };
}

test("the unchanged screenshots of the loaded pages follow the items of the first response", () => {
  const first = [item("b", [variant("light", "changed")]), item("d", [variant("light", "added")])];
  // Page 1 loaded before page 0, as after a link to a screenshot of page 1.
  const pages = new Map([
    [1, [item("e", [variant("light", "unchanged")])]],
    [
      0,
      [
        item("a", [variant("light", "unchanged")]),
        // The first response has this screenshot as changed, and has no dark one.
        item("b", [variant("dark", "unchanged"), variant("light", "unchanged")]),
      ],
    ],
  ]);
  expect(
    withUnchangedItems(first, pages).map((entry) => [
      entry.key,
      entry.variants.map((entry) => `${entry.key}:${entry.kind}`),
    ]),
  ).toEqual([
    ["b", ["light:changed", "dark:unchanged"]],
    ["d", ["light:added"]],
    ["a", ["light:unchanged"]],
    ["e", ["light:unchanged"]],
  ]);
  expect(first[0]?.variants).toHaveLength(1);
});

test("an item that two pages divide has the variants of both pages", () => {
  const pages = new Map([
    [0, [item("a", [variant("dark", "unchanged")])]],
    [1, [item("a", [variant("light", "unchanged")])]],
  ]);
  expect(withUnchangedItems([], pages)).toEqual([
    item("a", [variant("dark", "unchanged"), variant("light", "unchanged")]),
  ]);
});

test("no loaded page keeps the list of the first response", () => {
  const first = [item("a", [variant("light", "changed")])];
  expect(withUnchangedItems(first, new Map())).toBe(first);
});

test("the sentence of a conflict names the person of the newer decision", () => {
  const model = fixtureModel();
  const [first, second, third] = model.items[0]?.variants ?? [];
  if (!first || !second || !third) throw new Error("Missing review variants.");
  const command = {
    commandId: "command",
    comparisonId: model.comparisonId,
    verdict: "approved" as const,
    targets: [first, second, third].map((variant) => ({ id: variant.id, expectedRevision: 0 })),
    expectedBaselineRevision: model.baselineRevision,
    expectedRunRevision: model.comparisonRevision,
    selection: { itemKey: "dialog/open", variantKey: first.key },
  };
  // No target has a newer decision.
  expect(decisionConflict(model, command)).toBeNull();
  // A newer state that is not the decision of a person names nobody.
  Object.assign(first, { revision: 1, verdict: null, source: null });
  Object.assign(second, { revision: 1, verdict: "approved", source: "automatic" });
  expect(decisionConflict(model, command)).toBeNull();
  // The selected variant is the first one, and the newer decision is for the third one.
  Object.assign(third, {
    revision: 1,
    verdict: "rejected",
    source: "human",
    reviewer: "Kenji Mori",
  });
  expect(decisionConflict(model, command)).toBe(
    "Kenji Mori rejected another variant of this item. Your approval was not saved.",
  );
  const selected = { ...command, selection: { itemKey: "dialog/open", variantKey: third.key } };
  expect(decisionConflict(model, selected)).toBe(
    "Kenji Mori rejected this variant. Your approval was not saved.",
  );
  third.reviewer = undefined;
  expect(decisionConflict(model, selected)).toBe(
    "Another reviewer rejected this variant. Your approval was not saved.",
  );
  Object.assign(third, { verdict: "approved", reviewer: "Aiko Tanaka", ownDecision: true });
  expect(decisionConflict(model, { ...selected, verdict: "rejected" })).toBe(
    "You already approved this variant. Your rejection was not saved.",
  );
  // The sentence is about the selected variant when two targets have a newer decision.
  Object.assign(second, { verdict: "rejected", source: "human", reviewer: "Kenji Mori" });
  expect(decisionConflict(model, { ...selected, verdict: "rejected" })).toBe(
    "You already approved this variant. Your rejection was not saved.",
  );
  // A decision that the command expects is not a conflict.
  expect(
    decisionConflict(model, { ...selected, targets: [{ id: third.id, expectedRevision: 1 }] }),
  ).toBeNull();
});
