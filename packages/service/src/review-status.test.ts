import { expect, it } from "vitest";
import { reviewStatus } from "./review-status.ts";

const run = {
  kind: "pull_request" as const,
  active: 1,
  state: "reviewing",
  comparison_id: "comparison",
  sealed_at: 1,
};

it("tests the failed state before the inactive state", () => {
  // The scheduled expiry of an incomplete run closes it with the state failed.
  expect(reviewStatus({ run: { ...run, active: 0, state: "failed" } }).status).toBe("failed");
  expect(reviewStatus({ run: { ...run, active: 0, state: "reviewing" } }).status).toBe(
    "superseded",
  );
  expect(reviewStatus({ run: { ...run, active: 0, state: "accepted" } }).status).toBe("passed");
});

it("returns the three counts of an open run and zero counts for a failed run", () => {
  const comparison = { state: "ready", baseline_revision: 0 };
  expect(reviewStatus({ run, comparison, pending: 3, rejected: 1, approved: 2 })).toEqual({
    status: "rejected",
    pending: 3,
    rejected: 1,
    approved: 2,
  });
  expect(reviewStatus({ run: { ...run, active: 0, state: "failed" }, pending: 3 })).toEqual({
    status: "failed",
    pending: 0,
    rejected: 0,
    approved: 0,
  });
});

it("returns the stored counts of a closed run, and null for each count before they are stored", () => {
  const closed = { ...run, active: 0, state: "reviewing" };
  const stored = { review_pending: 3, review_rejected: 1, review_approved: 2 };
  expect(reviewStatus({ run: { ...closed, ...stored }, pending: 9 })).toEqual({
    status: "superseded",
    pending: 3,
    rejected: 1,
    approved: 2,
  });
  expect(reviewStatus({ run: { ...closed, ...stored, state: "accepted" } })).toEqual({
    status: "passed",
    pending: 3,
    rejected: 1,
    approved: 2,
  });
  expect(reviewStatus({ run: closed, pending: 9 })).toEqual({
    status: "superseded",
    pending: null,
    rejected: null,
    approved: null,
  });
  // The closed summary stores the three counts together. Part of them gives none.
  expect(reviewStatus({ run: { ...closed, review_pending: 3 } }).pending).toBeNull();
  // An open run ignores the stored columns.
  expect(
    reviewStatus({
      run: { ...run, ...stored },
      comparison: { state: "ready", baseline_revision: 0 },
      pending: 1,
    }),
  ).toMatchObject({ pending: 1, rejected: 0, approved: 0 });
});
