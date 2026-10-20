import { expect, test } from "vitest";
import type { ReviewItem, ReviewModel, ReviewVariant } from "../model.ts";
import {
  applyPendingReviews,
  applySavedReview,
  decisionConflict,
  nextPending,
  verdictLabel,
  withUnchangedItems,
} from "../navigation.ts";
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

test("the next variant to review follows the order of the list, once around", () => {
  const items = [
    item("a", [variant("light", "changed"), variant("dark", "changed")]),
    item("b", [variant("light", "changed")]),
    item("c", [variant("light", "unchanged"), variant("dark", "added")]),
  ];
  const selection = { itemKey: "a", variantKey: "light" };
  // Without an order, the run order.
  expect(nextPending(items, selection)).toEqual({ itemKey: "a", variantKey: "dark" });
  // A filter hides `a` and shows `c` before `b`. The selection is not in the
  // list, so the first variant to review of the list comes next.
  expect(nextPending(items, selection, ["c", "b"])).toEqual({ itemKey: "c", variantKey: "dark" });
  expect(nextPending(items, { itemKey: "c", variantKey: "dark" }, ["c", "b"])).toEqual({
    itemKey: "b",
    variantKey: "light",
  });
  // Once around: the variant of `c` again.
  expect(nextPending(items, { itemKey: "b", variantKey: "light" }, ["c", "b"])).toEqual({
    itemKey: "c",
    variantKey: "dark",
  });
  // A list with no variant to review: no advance.
  expect(nextPending(items, selection, [])).toBeNull();
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
    "Kenji Mori rejected another variant of this screenshot. Your approval was not saved.",
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

test("an approval of the whole screenshot keeps each approval of the screenshot", () => {
  const model = fixtureModel();
  const [copied, pending] = model.items[0]?.variants ?? [];
  if (!copied || !pending) throw new Error("Missing review variants.");
  Object.assign(copied, {
    revision: 1,
    verdict: "approved",
    source: "human",
    reviewer: "Aiko Tanaka",
    copiedFrom: { runId: "run-7", pullRequestNumber: 7999 },
  });
  const command = {
    commandId: "command",
    comparisonId: model.comparisonId,
    verdict: "approved" as const,
    targets: [copied, pending].map((variant) => ({
      id: variant.id,
      expectedRevision: variant.revision,
    })),
    wholeItemKey: "dialog/open",
    expectedBaselineRevision: model.baselineRevision,
    expectedRunRevision: model.comparisonRevision,
    selection: { itemKey: "dialog/open", variantKey: pending.key },
  };
  const variants = (result: ReviewModel | null) => result?.items[0]?.variants.slice(0, 2);
  expect(variants(applyPendingReviews(model, [command]))).toEqual([
    copied,
    { ...pending, revision: 1, verdict: "approved", source: "human", ownDecision: true },
  ]);
  const result = {
    commandId: "command",
    selection: command.selection,
    revisions: [{ id: pending.id, expectedRevision: 1 }],
    baselineRevision: model.baselineRevision,
    promotionId: model.promotionId,
    previousRunRevision: model.comparisonRevision,
    runRevision: model.comparisonRevision + 1,
    reviewer: "Aiko Tanaka",
    runStatus: "needs-review",
    counts: { pending: 9, rejected: 0, approved: 2 },
  };
  expect(variants(applySavedReview(model, command, result))).toEqual([
    copied,
    {
      ...pending,
      revision: 1,
      verdict: "approved",
      source: "human",
      reviewer: "Aiko Tanaka",
      ownDecision: true,
    },
  ]);
  // A rejection of the whole screenshot changes each variant, so the page
  // reads the model again when the receipt has no revision for one.
  expect(applySavedReview(model, { ...command, verdict: "rejected" }, result)).toBeNull();
});

test("a copied approval names the pull request where a person approved it", () => {
  const copied = {
    ...variant("light", "changed"),
    verdict: "approved" as const,
    source: "human" as const,
  };
  expect(verdictLabel({ ...copied, copiedFrom: { runId: "run-7", pullRequestNumber: 7999 } })).toBe(
    "Approved in #7999",
  );
  expect(verdictLabel({ ...copied, copiedFrom: { runId: "run-7" } })).toBe(
    "Approved in an earlier run",
  );
  expect(verdictLabel(copied)).toBe("Approved");
});
