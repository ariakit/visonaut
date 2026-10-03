import { SecurityError } from "@visonaut/security";
import {
  IncompleteError,
  pendingReviewCountSql,
  rejectedReviewCountSql,
  replacedMainRunSql,
  reviewStatus,
  type Database,
} from "@visonaut/service";
import { integer, string } from "./input.js";

export interface DashboardRun {
  id: string;
  kind: "main" | "pull_request" | "merge_group";
  testedSha: string;
  state: string;
  attempt: number;
  createdAt: number;
  comparisonId: string | null;
  pullRequestNumber?: number;
  title?: string;
  pending: number;
  rejected: number;
}

interface DashboardContext {
  database: Database;
  configuration: { projectId: string; github: { repositoryId: string; repository: string } };
}

/** Actionable work is independent of the bounded historical list. */
export async function dashboard(context: DashboardContext) {
  const readRuns = (selection: string) =>
    context.database
      .prepare(`WITH selected_runs AS (
      SELECT * FROM visonaut_runs WHERE project_id=? ${selection}
    ), counts AS (
      SELECT row.comparison_id, ${pendingReviewCountSql} AS pending,
        ${rejectedReviewCountSql} AS rejected
      FROM visonaut_comparison_rows row
      JOIN selected_runs selected ON selected.comparison_id=row.comparison_id
      LEFT JOIN visonaut_decisions decision ON decision.id=row.decision_id
      GROUP BY row.comparison_id
    )
    SELECT run.id,run.kind,run.tested_sha AS testedSha,run.state,run.attempt,
      run.created_at AS createdAt,run.comparison_id AS comparisonId,
      run.active,run.sealed_at AS sealedAt,comparison.state AS comparisonState,
      comparison.baseline_revision AS comparisonBaselineRevision,
      project.baseline_revision AS baselineRevision,
      EXISTS(SELECT 1 FROM visonaut_promotions promotion
        WHERE promotion.id=project.promotion_id AND promotion.comparison_id=run.comparison_id
          AND promotion.revoked=0) AS currentPromotion,
      EXISTS(SELECT 1 FROM work_tasks task JOIN visonaut_comparison_rows row ON row.id=task.id
        WHERE row.comparison_id=run.comparison_id AND task.state='dead') AS failures,
      COALESCE(counts.pending,0) AS pending,COALESCE(counts.rejected,0) AS rejected,
      CASE WHEN run.kind='pull_request' THEN CAST(substr(run.lineage_key,4) AS INTEGER) END AS pullRequestNumber,
      CASE WHEN run.kind='pull_request' THEN (SELECT json_extract(delivery.payload_json,'$.pull_request.title')
        FROM github_webhook_delivery delivery
        WHERE delivery.event='pull_request'
          AND CAST(json_extract(delivery.payload_json,'$.repository.id') AS TEXT)=project.repository_id
          AND json_extract(delivery.payload_json,'$.pull_request.number')=CAST(substr(run.lineage_key,4) AS INTEGER)
        ORDER BY delivery.received_at DESC LIMIT 1) END AS title
    FROM selected_runs run JOIN visonaut_projects project ON project.id=run.project_id
      LEFT JOIN visonaut_comparisons comparison ON comparison.id=run.comparison_id
      LEFT JOIN counts ON counts.comparison_id=run.comparison_id
    ORDER BY run.created_at DESC`)
      .bind(context.configuration.projectId);
  const queries = await context.database.batch([
    readRuns("ORDER BY created_at DESC LIMIT 100"),
    readRuns(`AND active=1 AND closed_at IS NULL
      AND state NOT IN ('failed','superseded','accepted')
      AND NOT ${replacedMainRunSql("visonaut_runs")}
      AND NOT EXISTS(SELECT 1 FROM visonaut_promotions promotion
        JOIN visonaut_comparisons promoted ON promoted.id=promotion.comparison_id
        WHERE promoted.run_id=visonaut_runs.id)`),
    context.database
      .prepare(
        "SELECT repository_id,baseline_revision,snapshot_id,promotion_id FROM visonaut_projects WHERE id=?",
      )
      .bind(context.configuration.projectId),
  ]);
  const project = queries[2]?.results?.[0];
  if (!project) throw new IncompleteError("The requested record does not exist.");
  if (project.repository_id !== context.configuration.github.repositoryId) {
    throw new SecurityError(
      "repository_configuration",
      503,
      "The configured repository does not match this project.",
    );
  }
  const rows = (index: number) => {
    const query = queries[index];
    if (!query) throw new Error("The dashboard query is incomplete.");
    return (query.results ?? []).map((row): DashboardRun => {
      const kind = row.kind;
      if (kind !== "main" && kind !== "pull_request" && kind !== "merge_group") {
        throw new Error("The dashboard returned an invalid run kind.");
      }
      const comparisonId = row.comparisonId == null ? null : string(row.comparisonId);
      const summary = reviewStatus({
        run: {
          kind,
          active: integer(row.active),
          state: string(row.state),
          comparison_id: comparisonId,
          sealed_at: row.sealedAt == null ? null : integer(row.sealedAt),
        },
        comparison:
          row.comparisonState == null
            ? undefined
            : {
                state: string(row.comparisonState),
                baseline_revision: integer(row.comparisonBaselineRevision),
              },
        pending: integer(row.pending),
        rejected: integer(row.rejected),
        failures: integer(row.failures) !== 0,
        baselineRevision: integer(row.baselineRevision),
        currentPromotion: integer(row.currentPromotion) !== 0,
      });
      return {
        id: string(row.id),
        kind,
        testedSha: string(row.testedSha),
        state: summary.status,
        attempt: integer(row.attempt, 1),
        createdAt: integer(row.createdAt),
        comparisonId,
        pending: summary.pending,
        rejected: summary.rejected,
        pullRequestNumber:
          row.pullRequestNumber == null ? undefined : integer(row.pullRequestNumber, 1),
        title: row.title == null ? undefined : string(row.title),
      };
    });
  };
  return {
    runs: rows(0),
    actionable: rows(1).filter((run) => run.state !== "passed"),
    project: {
      repository: context.configuration.github.repository,
      baselineRevision: integer(project.baseline_revision),
      snapshotId: project.snapshot_id == null ? null : string(project.snapshot_id),
      promotionId: project.promotion_id == null ? null : string(project.promotion_id),
    },
  };
}
