import type { ComparisonRow, RunRow } from "./types.ts";

/** Only active reviews and the current baseline can publish external check updates. */
export const statusRunEligibleSql = `(run.active=1 OR (run.state='accepted' AND EXISTS(
  SELECT 1 FROM visonaut_projects project JOIN visonaut_snapshots snapshot ON snapshot.id=project.snapshot_id
  WHERE snapshot.run_id=run.id)))`;

export const eligibleAcceptanceSql = `EXISTS (SELECT 1 FROM visonaut_decisions decision
  WHERE decision.id = row.decision_id AND decision.row_id = row.id
  AND decision.verdict = 'approved' AND decision.revoked = 0
  AND decision.tuple_json = row.tuple_json)`;

export const pendingReviewCountSql = `COALESCE(SUM(CASE WHEN row.outcome NOT IN ('changed', 'unchanged')
  OR (row.outcome = 'changed' AND NOT ${eligibleAcceptanceSql}) THEN 1 ELSE 0 END), 0)`;

export const rejectedReviewCountSql = `COALESCE(SUM(CASE WHEN decision.verdict = 'rejected'
  AND decision.revoked = 0 THEN 1 ELSE 0 END), 0)`;

interface ReviewStatusInput {
  run: Pick<RunRow, "active" | "state" | "comparison_id" | "sealed_at">;
  comparison?: Pick<ComparisonRow, "state" | "baseline_revision">;
  failures?: boolean;
  pending?: number;
  rejected?: number;
  baselineRevision?: number;
  currentPromotion?: boolean;
}

type RunReviewStatus =
  | "superseded"
  | "failed"
  | "incomplete"
  | "needs-recompare"
  | "comparing"
  | "passed"
  | "rejected"
  | "needs-review";

interface ReviewStatusSummary {
  status: RunReviewStatus;
  pending: number;
  rejected: number;
}

/** The same status rules serve individual reviews and set-based dashboard reads. */
export function reviewStatus({
  run,
  comparison,
  failures = false,
  pending = 0,
  rejected = 0,
  baselineRevision = comparison?.baseline_revision,
  currentPromotion = false,
}: ReviewStatusInput): ReviewStatusSummary {
  const empty = (status: RunReviewStatus) => ({ status, pending: 0, rejected: 0 });
  if (!run.active) return empty(run.state === "accepted" ? "passed" : "superseded");
  if (run.state === "failed") return empty("failed");
  if (!run.comparison_id || run.sealed_at === null) return empty("incomplete");
  if (comparison?.state === "invalidated") return empty("needs-recompare");
  if (failures) return empty("failed");
  if (comparison?.state !== "ready") return empty("comparing");
  if (pending === 0 && !currentPromotion && comparison.baseline_revision !== baselineRevision) {
    return { status: "needs-recompare", pending, rejected };
  }
  return {
    status: pending === 0 ? "passed" : rejected > 0 ? "rejected" : "needs-review",
    pending,
    rejected,
  };
}
