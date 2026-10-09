import type { RunReviewState } from "@visonaut/protocol";
import type { ComparisonRow, RunRow } from "./types.ts";

/** Only a verified accepted descendant can replace an invalidated main review. */
export function replacedMainRunSql(run: string) {
  return `(${run}.kind='main' AND ${run}.active=1 AND ${run}.state='reviewing'
    AND ${run}.closed_at IS NULL AND ${run}.sealed_at IS NOT NULL AND EXISTS(
    SELECT 1 FROM visonaut_projects project
    JOIN visonaut_snapshots snapshot ON snapshot.id=project.snapshot_id
    JOIN visonaut_runs replacement ON replacement.id=snapshot.run_id
    JOIN visonaut_comparisons comparison ON comparison.id=${run}.comparison_id
    WHERE project.id=${run}.project_id AND snapshot.project_id=project.id
      AND replacement.project_id=project.id AND replacement.kind='main'
      AND replacement.id!=${run}.id AND replacement.state='accepted'
      AND replacement.sealed_at IS NOT NULL AND replacement.created_at>=${run}.created_at
      AND snapshot.state='accepted' AND snapshot.reference_eligible=1
      AND comparison.run_id=${run}.id AND comparison.purpose='review' AND comparison.state='invalidated'
      AND comparison.baseline_revision<project.baseline_revision
      AND (EXISTS(SELECT 1 FROM visonaut_lineage lineage
        WHERE lineage.source_run_id=${run}.id AND lineage.target_run_id=replacement.id)
        OR EXISTS(SELECT 1 FROM visonaut_ancestry ancestry
          WHERE ancestry.run_id=replacement.id AND ancestry.ancestor_sha=${run}.tested_sha))))`;
}

/**
 * Only active reviews and the current baseline can publish external check updates.
 *
 * The baseline runs are a list that SQLite reads one time for each statement:
 * one snapshot for each project, by its primary key. A subquery that names the
 * run makes SQLite scan every snapshot for each closed accepted run.
 */
export const statusRunEligibleSql = `(run.active=1 OR (run.state='accepted' AND run.id IN (
  SELECT snapshot.run_id FROM visonaut_snapshots snapshot
  WHERE snapshot.id IN (SELECT project.snapshot_id FROM visonaut_projects project))))`;

export const eligibleAcceptanceSql = `EXISTS (SELECT 1 FROM visonaut_decisions decision
  WHERE decision.id = row.decision_id AND decision.row_id = row.id
  AND decision.verdict = 'approved' AND decision.revoked = 0
  AND decision.tuple_json = row.tuple_json)`;

/**
 * The three review counts, with one definition for every reader. Select them
 * from `visonaut_comparison_rows row LEFT JOIN visonaut_decisions decision ON
 * decision.id=row.decision_id`, with one group for each comparison.
 *
 * - `pending`: every row that is neither unchanged nor approved. It includes
 *   the rejected rows and the rows that have no result yet.
 * - `rejected`: the rows with a rejection that is in force.
 * - `approved`: the changed rows with an approval that is in force.
 *
 * The changes that wait for a verdict are `pending - rejected`.
 */
export const reviewCountsSql = `COALESCE(SUM(CASE WHEN row.outcome NOT IN ('changed', 'unchanged')
  OR (row.outcome = 'changed' AND NOT ${eligibleAcceptanceSql}) THEN 1 ELSE 0 END), 0) AS pending,
  COALESCE(SUM(CASE WHEN decision.verdict = 'rejected'
  AND decision.revoked = 0 THEN 1 ELSE 0 END), 0) AS rejected,
  COALESCE(SUM(CASE WHEN row.outcome = 'changed' AND ${eligibleAcceptanceSql}
  THEN 1 ELSE 0 END), 0) AS approved`;

export interface ReviewCounts {
  pending: number;
  rejected: number;
  approved: number;
}

interface ReviewStatusInput {
  run: Pick<RunRow, "kind" | "active" | "state" | "comparison_id" | "sealed_at">;
  comparison?: Pick<ComparisonRow, "state" | "baseline_revision">;
  failures?: boolean;
  pending?: number;
  rejected?: number;
  approved?: number;
  baselineRevision?: number;
  currentPromotion?: boolean;
}

interface ReviewStatusSummary extends ReviewCounts {
  status: RunReviewState;
}

/** The same status rules serve individual reviews and set-based dashboard reads. */
export function reviewStatus({
  run,
  comparison,
  failures = false,
  pending = 0,
  rejected = 0,
  approved = 0,
  baselineRevision = comparison?.baseline_revision,
  currentPromotion = false,
}: ReviewStatusInput): ReviewStatusSummary {
  const empty = (status: RunReviewState) => ({ status, pending: 0, rejected: 0, approved: 0 });
  // A failed run can be closed too. Its cause is the failure and not a newer run.
  if (run.state === "failed") return empty("failed");
  if (!run.active) return empty(run.state === "accepted" ? "passed" : "superseded");
  if (!run.comparison_id || run.sealed_at === null) return empty("incomplete");
  if (comparison?.state === "invalidated") return empty("needs-recompare");
  if (failures) return empty("failed");
  if (comparison?.state !== "ready") return empty("comparing");
  if (
    run.kind !== "pull_request" &&
    pending === 0 &&
    !currentPromotion &&
    comparison.baseline_revision !== baselineRevision
  ) {
    return { status: "needs-recompare", pending, rejected, approved };
  }
  return {
    status: pending === 0 ? "passed" : rejected > 0 ? "rejected" : "needs-review",
    pending,
    rejected,
    approved,
  };
}
