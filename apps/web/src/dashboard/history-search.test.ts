import { expect, test } from "vitest";
import { historySearch } from "./history-search.ts";

test("keeps the search text, a known run state, and the order", () => {
  expect(historySearch({ q: "dialog", state: "needs-review", sort: "oldest" })).toEqual({
    q: "dialog",
    state: "needs-review",
    sort: "oldest",
  });
});

test("drops an empty text, an unknown state, an unknown order, and each other parameter", () => {
  expect(historySearch({ q: "", state: "all", sort: "newest", view: "history" })).toEqual({
    q: undefined,
    state: undefined,
    sort: undefined,
  });
  expect(historySearch({ q: ["dialog"], state: ["passed"], sort: 1 })).toEqual({
    q: undefined,
    state: undefined,
    sort: undefined,
  });
});

test("keeps a search text that the router read as a number", () => {
  expect(historySearch({ q: 7754 }).q).toBe("7754");
});

test("does not take a property of the prototype as a run state", () => {
  expect(historySearch({ state: "toString" }).state).toBeUndefined();
  expect(historySearch({ state: "constructor" }).state).toBeUndefined();
});
