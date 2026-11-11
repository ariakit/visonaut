import { reviewStateWords, type RunReviewState } from "@visonaut/protocol";
import { expect, it } from "vitest";
import { checkText, startingCheckTitle, type CheckReview } from "../src/index.js";

interface ApprovedRow extends CheckReview {
  title: string;
  /** Who acts next. */
  next: string;
}

// The table that the maintainer approved on 2026-10-09 (#267). GitHub shows
// the title on each pull request, and the pull request comment shows both, so
// a change of a word needs a new approval.
// `pending` includes the rejected changes: 79 pending with 3 rejected is 76
// that need review.
const approved: ApprovedRow[] = [
  {
    state: "needs-review",
    pending: 79,
    rejected: 0,
    approved: 12,
    title: "79 changes need review",
    next: "Next: a maintainer approves or rejects each change. If a change is not intended, the author pushes a commit that removes it.",
  },
  {
    state: "rejected",
    pending: 79,
    rejected: 3,
    approved: 0,
    title: "3 changes rejected",
    next: "Next: the author pushes a commit that corrects the rejected changes. A maintainer can also change a decision.",
  },
  {
    state: "passed",
    pending: 0,
    rejected: 0,
    approved: 12,
    title: "12 changes approved",
    next: "No action is necessary. Each change is approved.",
  },
  {
    state: "incomplete",
    pending: 0,
    rejected: 0,
    approved: 0,
    title: "Capturing screenshots",
    next: "No action is necessary. CI captures the screenshots of this commit.",
  },
  {
    state: "comparing",
    pending: 0,
    rejected: 0,
    approved: 0,
    title: "Comparing screenshots",
    next: "No action is necessary. Visonaut compares the screenshots with the baseline.",
  },
  {
    state: "needs-recompare",
    pending: 0,
    rejected: 0,
    approved: 0,
    title: "Rerun needed",
    next: "Next: a maintainer runs the CI workflow of this commit again. The baseline changed after the comparison of this run.",
  },
  {
    state: "superseded",
    pending: 0,
    rejected: 0,
    approved: 0,
    title: "No longer active",
    next: "This run is closed, and its result does not change. Next: the author pushes a commit, or a maintainer runs the CI workflow again, to start a new run.",
  },
  {
    state: "failed",
    pending: 0,
    rejected: 0,
    approved: 0,
    title: "Capture or comparison failed",
    next: "The capture or the comparison did not complete. Next: a maintainer runs the CI workflow again, or the author pushes a commit.",
  },
];

it("has one approved row for each state of the shared map", () => {
  expect(approved.map((row) => row.state)).toEqual(Object.keys(reviewStateWords));
});

it.each(approved)("gives the state $state the approved title and next step", (row) => {
  // The text has no image and no result of one image.
  expect(checkText(row)).toMatchObject({ title: row.title, next: row.next });
});

it.each([
  ["needs-review", { pending: 1, rejected: 0, approved: 0 }, "1 change needs review"],
  ["rejected", { pending: 1, rejected: 1, approved: 0 }, "1 change rejected"],
  ["passed", { pending: 0, rejected: 0, approved: 1 }, "1 change approved"],
] as const)("uses the singular form for one change of the state %s", (state, counts, title) => {
  expect(checkText({ state, ...counts }).title).toBe(title);
});

// A run with no change has no approval, and the accepted baseline run reads no counts.
it("gives a passed run with no approved change a text with no number", () => {
  expect(checkText({ state: "passed", pending: 0, rejected: 0, approved: 0 })).toEqual({
    title: "Passed",
    next: "No action is necessary. No change needs review.",
  });
});

it("counts a rejected change as rejected and not as a change that needs review", () => {
  expect(checkText({ state: "rejected", pending: 3, rejected: 3, approved: 9 }).title).toBe(
    "3 changes rejected",
  );
  expect(checkText({ state: "needs-review", pending: 3, rejected: 1, approved: 9 }).title).toBe(
    "2 changes need review",
  );
});

// The titles that other code writes on the same status, and the start text.
const otherTitles = [
  startingCheckTitle,
  "Visual capture is not required",
  "Visual capture was superseded",
  "Visual capture did not complete",
];

it("gives no two states the same title, for each set of counts", () => {
  const states = Object.keys(reviewStateWords) as RunReviewState[];
  const counts = [0, 1, 2, 79];
  const stateOfTitle = new Map<string, RunReviewState>();
  for (const state of states) {
    for (const rejected of counts) {
      for (const waiting of counts) {
        for (const approvedCount of counts) {
          const { title } = checkText({
            state,
            pending: waiting + rejected,
            rejected,
            approved: approvedCount,
          });
          expect(otherTitles).not.toContain(title);
          expect(stateOfTitle.get(title) ?? state).toBe(state);
          stateOfTitle.set(title, state);
        }
      }
    }
  }
  expect(new Set(stateOfTitle.values()).size).toBe(8);
});

it("gives a result with no state yet a title that names no state", () => {
  expect(startingCheckTitle).toBe("Checking visual coverage");
});
