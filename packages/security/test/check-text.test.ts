import { reviewStateWords, type RunReviewState } from "@visonaut/protocol";
import { expect, it } from "vitest";
import { genericCheckOutput, startingCheckOutput, type CheckReview } from "../src/index.js";

const url = "https://visonaut.example/runs/run-1";
const link = `[Open the run in Visonaut](${url}). Only a person with write access to the repository can open it.`;

interface ApprovedRow extends CheckReview {
  title: string;
  /** The paragraphs before the link. */
  summary: string[];
}

// The table that the maintainer approved on 2026-10-09 (#267). GitHub shows
// this text on each pull request, so a change of a word needs a new approval.
// `pending` includes the rejected changes: 79 pending with 3 rejected is 76
// that need review.
const approved: ApprovedRow[] = [
  {
    state: "needs-review",
    pending: 79,
    rejected: 0,
    approved: 12,
    title: "79 changes need review",
    summary: [
      "Next: a maintainer approves or rejects each change. If a change is not intended, the author pushes a commit that removes it.",
      "Changes: 79 need review, 0 rejected, 12 approved.",
    ],
  },
  {
    state: "rejected",
    pending: 79,
    rejected: 3,
    approved: 0,
    title: "3 changes rejected",
    summary: [
      "Next: the author pushes a commit that corrects the rejected changes. A maintainer can also change a decision.",
      "Changes: 76 need review, 3 rejected, 0 approved.",
    ],
  },
  {
    state: "passed",
    pending: 0,
    rejected: 0,
    approved: 12,
    title: "12 changes approved",
    summary: [
      "No action is necessary. Each change is approved.",
      "Changes: 0 need review, 0 rejected, 12 approved.",
    ],
  },
  {
    state: "incomplete",
    pending: 0,
    rejected: 0,
    approved: 0,
    title: "Capturing screenshots",
    summary: ["No action is necessary. CI captures the screenshots of this commit."],
  },
  {
    state: "comparing",
    pending: 0,
    rejected: 0,
    approved: 0,
    title: "Comparing screenshots",
    summary: ["No action is necessary. Visonaut compares the screenshots with the baseline."],
  },
  {
    state: "needs-recompare",
    pending: 0,
    rejected: 0,
    approved: 0,
    title: "Rerun needed",
    summary: [
      "Next: a maintainer runs the CI workflow of this commit again. The baseline changed after the comparison of this run.",
    ],
  },
  {
    state: "superseded",
    pending: 0,
    rejected: 0,
    approved: 0,
    title: "No longer active",
    summary: [
      "This run is closed, and its result does not change. Next: the author pushes a commit, or a maintainer runs the CI workflow again, to start a new run.",
    ],
  },
  {
    state: "failed",
    pending: 0,
    rejected: 0,
    approved: 0,
    title: "Capture or comparison failed",
    summary: [
      "The capture or the comparison did not complete. Next: a maintainer runs the CI workflow again, or the author pushes a commit.",
    ],
  },
];

it("has one approved row for each state of the shared map", () => {
  expect(approved.map((row) => row.state)).toEqual(Object.keys(reviewStateWords));
});

it.each(approved)("gives the state $state the approved title and summary", (row) => {
  const output = genericCheckOutput(row, url);
  // The output has a title and a summary only: no image and no result of one image.
  expect(output).toEqual({ title: row.title, summary: [...row.summary, link].join("\n\n") });
});

it.each([
  ["needs-review", { pending: 1, rejected: 0, approved: 0 }, "1 change needs review"],
  ["rejected", { pending: 1, rejected: 1, approved: 0 }, "1 change rejected"],
  ["passed", { pending: 0, rejected: 0, approved: 1 }, "1 change approved"],
] as const)("uses the singular form for one change of the state %s", (state, counts, title) => {
  expect(genericCheckOutput({ state, ...counts }, url).title).toBe(title);
});

// A run with no change has no approval, and the accepted baseline run reads no counts.
it("gives a passed run with no approved change a text with no number", () => {
  expect(
    genericCheckOutput({ state: "passed", pending: 0, rejected: 0, approved: 0 }, url),
  ).toEqual({
    title: "Passed",
    summary: ["No action is necessary. No change needs review.", link].join("\n\n"),
  });
});

it("counts a rejected change as rejected and not as a change that needs review", () => {
  const output = genericCheckOutput(
    { state: "rejected", pending: 3, rejected: 3, approved: 9 },
    url,
  );
  expect(output.title).toBe("3 changes rejected");
  expect(output.summary).toContain("Changes: 0 need review, 3 rejected, 9 approved.");
});

// The titles that other code writes on the same check, and the start text.
const otherTitles = [
  startingCheckOutput.title,
  "Visual capture is not required",
  "Visual capture was superseded",
  "Visual capture did not complete",
  "Equivalent merge check retired",
];

it("gives no two states the same title, for each set of counts", () => {
  const states = Object.keys(reviewStateWords) as RunReviewState[];
  const counts = [0, 1, 2, 79];
  const stateOfTitle = new Map<string, RunReviewState>();
  for (const state of states) {
    for (const rejected of counts) {
      for (const waiting of counts) {
        for (const approvedCount of counts) {
          const { title } = genericCheckOutput(
            { state, pending: waiting + rejected, rejected, approved: approvedCount },
            url,
          );
          expect(otherTitles).not.toContain(title);
          expect(stateOfTitle.get(title) ?? state).toBe(state);
          stateOfTitle.set(title, state);
        }
      }
    }
  }
  expect(new Set(stateOfTitle.values()).size).toBe(8);
});

it("gives a check with no state yet a text that names no state", () => {
  expect(startingCheckOutput).toEqual({
    title: "Checking visual coverage",
    summary: "Visonaut is verifying this commit.",
  });
});
