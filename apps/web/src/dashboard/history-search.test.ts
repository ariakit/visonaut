import { expect, test } from "vitest";
import { historySearch } from "./history-search.ts";

test("keeps the search text and a known run state", () => {
  expect(historySearch({ q: "dialog", state: "needs-review" })).toEqual({
    q: "dialog",
    state: "needs-review",
  });
});

test("drops an empty text, an unknown state, and each other parameter", () => {
  expect(historySearch({ q: "", state: "all", view: "history" })).toEqual({
    q: undefined,
    state: undefined,
  });
  expect(historySearch({ q: 7, state: ["passed"] })).toEqual({ q: undefined, state: undefined });
});

test("does not take a property of the prototype as a run state", () => {
  expect(historySearch({ state: "toString" }).state).toBeUndefined();
  expect(historySearch({ state: "constructor" }).state).toBeUndefined();
});
