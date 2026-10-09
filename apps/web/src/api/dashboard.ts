import { runClosedReasons, type RunClosedReason, type RunReviewState } from "@visonaut/protocol";
import { SecurityError } from "@visonaut/security";
import {
  IncompleteError,
  replacedMainRunSql,
  reviewCountsSql,
  reviewStatus,
  type Database,
} from "@visonaut/service";
import { integer, string } from "./input.js";
import { unresolvedAlertsSql } from "./operations.js";

export interface DashboardRun {
  id: string;
  kind: "main" | "pull_request" | "merge_group";
  testedSha: string;
  state: RunReviewState;
  attempt: number;
  createdAt: number;
  comparisonId: string | null;
  pullRequestNumber?: number;
  title?: string;
  pending: number;
  rejected: number;
  approved: number;
  /** Why a closed run closed. A run that closed before the service stored it has none. */
  closedReason?: RunClosedReason;
  /**
   * The state that a run had before it closed, when `state` is `superseded`.
   * The service does not store it. It is absent when the stored rows cannot
   * give it: the run closed before it sealed, or its history is compacted.
   */
  closedState?: RunReviewState;
}

/** The answer of `GET /api/runs`, for the server and the client. */
export interface RunsAnswer {
  runs: DashboardRun[];
  actionable: DashboardRun[];
  project: {
    repository: string;
    baselineRevision: number;
    snapshotId: string | null;
    promotionId: string | null;
  };
  alertCount: number;
  /** Only the preview deployment sends it. */
  preview?: boolean;
  user: { id: string; githubUserId: string; login: string };
}

function closedReason(value: unknown) {
  if (value == null) return undefined;
  const reason = runClosedReasons.find((candidate) => candidate === value);
  if (!reason) {
    throw new Error("The dashboard returned an invalid closed reason.");
  }
  return reason;
}

type ReviewStatusInput = Parameters<typeof reviewStatus>[0];

/**
 * The status of a closed run with its stored rows, as if the run were open.
 * The baseline of the project can move after the close, so the comparison is
 * read against its own baseline revision.
 */
function stateBeforeClose(input: ReviewStatusInput, compacted: boolean) {
  // A run that closed before it sealed was capturing or had failed, and the
  // close replaced that state.
  if (input.run.sealed_at === null) return;
  // Compaction removes the undecided rows and the tuples of the other rows.
  if (compacted) return;
  return reviewStatus({
    ...input,
    baselineRevision: input.comparison?.baseline_revision,
    run: { ...input.run, active: 1, state: "reviewing" },
  }).status;
}

interface DashboardContext {
  database: Database;
  configuration: { projectId: string; github: { repositoryId: string; repository: string } };
}

/**
 * Actionable work is independent of the bounded historical list.
 *
 * The joins start from the selected runs, so a read touches their rows only.
 * The title lookup compares with `substr(...)+0`: a CAST there hides the
 * pull request number from the index `github_webhook_delivery_pr_title`.
 */
export async function dashboard(context: DashboardContext): Promise<Omit<RunsAnswer, "user">> {
  const readRuns = (selection: string) =>
    context.database
      .prepare(`WITH selected_runs AS (
      SELECT * FROM visonaut_runs WHERE project_id=? ${selection}
    ), counts AS (
      SELECT row.comparison_id, ${reviewCountsSql}
      FROM selected_runs selected
      CROSS JOIN visonaut_comparison_rows row ON row.comparison_id=selected.comparison_id
      LEFT JOIN visonaut_decisions decision ON decision.id=row.decision_id
      GROUP BY row.comparison_id
    )
    SELECT run.id,run.kind,run.tested_sha AS testedSha,run.state,run.attempt,
      run.created_at AS createdAt,run.comparison_id AS comparisonId,
      run.active,run.sealed_at AS sealedAt,run.closed_reason AS closedReason,
      run.detail_archived=1 AND run.inventory_key IS NULL AS compacted,
      comparison.state AS comparisonState,
      comparison.baseline_revision AS comparisonBaselineRevision,
      project.baseline_revision AS baselineRevision,
      EXISTS(SELECT 1 FROM visonaut_promotions promotion
        WHERE promotion.id=project.promotion_id AND promotion.comparison_id=run.comparison_id
          AND promotion.revoked=0) AS currentPromotion,
      EXISTS(SELECT 1 FROM work_tasks task JOIN visonaut_comparison_rows row ON row.id=task.id
        WHERE row.comparison_id=run.comparison_id AND task.state='dead') AS failures,
      COALESCE(counts.pending,0) AS pending,COALESCE(counts.rejected,0) AS rejected,
      COALESCE(counts.approved,0) AS approved,
      CASE WHEN run.kind='pull_request' THEN CAST(substr(run.lineage_key,4) AS INTEGER) END AS pullRequestNumber,
      CASE WHEN run.kind='pull_request' THEN (SELECT json_extract(delivery.payload_json,'$.pull_request.title')
        FROM github_webhook_delivery delivery
        WHERE delivery.event='pull_request'
          AND CAST(json_extract(delivery.payload_json,'$.repository.id') AS TEXT)=project.repository_id
          AND json_extract(delivery.payload_json,'$.pull_request.number')=substr(run.lineage_key,4)+0
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
    context.database.prepare(
      `SELECT count(*) AS alertCount FROM operations_events WHERE ${unresolvedAlertsSql}`,
    ),
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
      const input: ReviewStatusInput = {
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
        approved: integer(row.approved),
        failures: integer(row.failures) !== 0,
        baselineRevision: integer(row.baselineRevision),
        currentPromotion: integer(row.currentPromotion) !== 0,
      };
      const summary = reviewStatus(input);
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
        approved: summary.approved,
        pullRequestNumber:
          row.pullRequestNumber == null ? undefined : integer(row.pullRequestNumber, 1),
        title: row.title == null ? undefined : string(row.title),
        closedReason: closedReason(row.closedReason),
        closedState:
          summary.status === "superseded"
            ? stateBeforeClose(input, integer(row.compacted) !== 0)
            : undefined,
      };
    });
  };
  return {
    runs: rows(0),
    actionable: rows(1).filter((run) => run.state !== "passed"),
    alertCount: integer(queries[3]?.results?.[0]?.alertCount),
    project: {
      repository: context.configuration.github.repository,
      baselineRevision: integer(project.baseline_revision),
      snapshotId: project.snapshot_id == null ? null : string(project.snapshot_id),
      promotionId: project.promotion_id == null ? null : string(project.promotion_id),
    },
  };
}
