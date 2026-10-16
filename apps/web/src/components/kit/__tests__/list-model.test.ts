import { expect, test } from "vitest";
import { defaultListFilter, filterList, getRowName, groupByFamily } from "../list/model.ts";
import type { ListFilter } from "../list/model.ts";
import { getCountedMarks } from "../variants/model.ts";
import { createItem } from "./session-fixtures.ts";

const items = [
  createItem("button/page/one", [{ status: "needs-review" }, { status: "approved" }]),
  createItem("button/page/two", [{ status: "unchanged" }, { status: "unchanged" }]),
  createItem("dialog/page/three", [{ status: "rejected" }]),
  createItem("dialog/page/four", [{ status: "comparing" }]),
  createItem("dialog/page/five", [
    { status: "needs-review", axes: { browser: "webkit", colorScheme: "dark" } },
  ]),
  createItem("dialog/page/six", [{ status: "problem" }]),
];

function keys(list: readonly { key: string }[]) {
  return list.map((item) => item.key);
}

function filter(change: Partial<ListFilter>): ListFilter {
  return { ...defaultListFilter, ...change };
}

test("the changes status lists the screenshots with a change in run order", () => {
  const result = filterList(items, defaultListFilter);
  expect(keys(result.items)).toEqual([
    "button/page/one",
    "dialog/page/three",
    "dialog/page/five",
    "dialog/page/six",
  ]);
  expect(keys(result.comparing)).toEqual(["dialog/page/four"]);
  expect(result.fallback).toEqual([]);
});

test("each status counts the screenshots behind it and lists them in run order", () => {
  const { counts } = filterList(items, defaultListFilter);
  expect(counts).toEqual({
    changes: 4,
    "needs-review": 2,
    rejected: 1,
    approved: 1,
    unchanged: 1,
  });
  const needsReview = filterList(items, filter({ status: "needs-review" }));
  expect(keys(needsReview.items)).toEqual(["button/page/one", "dialog/page/five"]);
  const unchanged = filterList(items, filter({ status: "unchanged" }));
  expect(keys(unchanged.items)).toEqual(["button/page/two"]);
});

test("a search word that is not in the name keeps the screenshots with a matching axis", () => {
  const result = filterList(items, filter({ query: "webkit dark" }));
  expect(keys(result.items)).toEqual(["dialog/page/five"]);
  expect(result.terms).toEqual(["webkit", "dark"]);
});

test("a search that no change matches falls back to the unchanged screenshots", () => {
  const result = filterList(items, filter({ query: "two" }));
  expect(result.items).toEqual([]);
  expect(keys(result.fallback)).toEqual(["button/page/two"]);
  const withChange = filterList(items, filter({ query: "one" }));
  expect(withChange.fallback).toEqual([]);
});

test("the screenshots of a list group by family in the order of the list", () => {
  const labels = new Map([["dialog", "Dialog"]]);
  const groups = groupByFamily(
    [items[2], items[0], items[4]].flatMap((item) => (item ? [item] : [])),
    labels,
  );
  expect(groups.map(({ family, label }) => ({ family, label }))).toEqual([
    { family: "dialog", label: "Dialog" },
    { family: "button", label: "button" },
  ]);
  expect(keys(groups[0]?.items ?? [])).toEqual(["dialog/page/three", "dialog/page/five"]);
});

test("the name of a row says the count of each state", () => {
  const item = createItem("button/page/many", [
    { status: "needs-review" },
    { status: "needs-review" },
    { status: "rejected" },
  ]);
  expect(getRowName(item)).toBe("button/page/many. 2 need review, 1 rejected");
});

test("the counted marks lead to the next variant in each state after the selected one", () => {
  const item = createItem("button/page/long", [
    { status: "approved" },
    { status: "needs-review" },
    { status: "rejected" },
    { status: "needs-review" },
    { status: "approved" },
  ]);
  const [selected] = item.variants;
  if (!selected) throw new Error("The fixture has no variant.");
  const marks = getCountedMarks(item, selected).map(({ status, count, target }) => ({
    status,
    count,
    target: target.index,
  }));
  expect(marks).toEqual([
    { status: "needs-review", count: 2, target: 1 },
    { status: "rejected", count: 1, target: 2 },
    { status: "approved", count: 2, target: 4 },
  ]);
});
