import { expect, test } from "vitest";
import type { DashboardRun } from "../../../api/dashboard.ts";
import { getRunRow, getRunStatusText } from "../run-row.tsx";

const run: DashboardRun = {
  id: "run",
  kind: "pull_request",
  testedSha: "0123456789abcdef",
  state: "needs-review",
  attempt: 1,
  createdAt: 0,
  comparisonId: "comparison",
  pullRequestNumber: 7,
  pending: 3,
  rejected: 1,
  approved: 2,
};

test("an open run shows its open and rejected changes", () => {
  const row = getRunRow(run);
  expect(getRunStatusText(row)).toBe("2 changes · 1 rejected");
  expect(row).toMatchObject({ review: true, open: 2, rejected: 1, approved: 2 });
});

test("a closed run with no stored counts shows no count of changes", () => {
  const counts = { pending: null, rejected: null, approved: null };
  for (const state of ["superseded", "passed"] as const) {
    const row = getRunRow({ ...run, ...counts, state });
    expect(row).toMatchObject({ review: false, open: 0, rejected: 0, approved: 0 });
    expect(getRunStatusText(row)).not.toMatch(/change/);
  }
});
