import { expect, test } from "vitest";
import type { ReviewItem, ReviewVariant } from "../model.ts";
import { withUnchangedItems } from "../navigation.ts";

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
