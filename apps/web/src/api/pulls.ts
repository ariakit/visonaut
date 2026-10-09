import { SecurityError } from "@visonaut/security";
import type { Database } from "@visonaut/service";

export type PullCaptureState = "pending" | "ready" | "failed" | "not-required" | "replaced";

/** The answer of `GET /api/pulls/:number`. */
export interface PullAnswer {
  repository: string;
  pullNumber: number;
  /** The run to open. It is set only when the state is `ready`. */
  runId: string | null;
  state: PullCaptureState;
  /** The title of the pull request, when a webhook delivered it. */
  title?: string;
  /** The head commit of the pull request that the check belongs to. */
  headSha: string;
  /** The attempt of the workflow run, when the check has one. */
  attempt?: number;
  /** The page of that attempt on GitHub, when the check has one. */
  workflowUrl?: string;
}

interface PullContext {
  database: Database;
  configuration: {
    projectId: string;
    github: { repositoryId: string; repository: string };
  };
}

interface PullParams {
  context: PullContext;
  pullNumber: number;
  /**
   * The external ID of one check. Without it, the answer is for the newest
   * head commit of the pull request: its newest check that is bound to a
   * workflow attempt, or its newest check when none is bound.
   */
  check: string | null;
}

interface PullRow {
  sourceSha: string;
  docsOnly: number;
  visualRequired: number | null;
  checkState: string;
  workflowRunId: string | null;
  workflowAttempt: number | null;
  runId: string | null;
  runState: string | null;
  runSealedAt: number | null;
  title: string | null;
}

// The head commit of the newest check of the pull request. It binds the
// repository and the pull request number again, so it does not depend on the
// outer row and runs one time.
const newestHeadSql = `pre.source_sha=(SELECT newest.source_sha FROM pre_run_checks newest
  WHERE newest.repository_id=? AND newest.kind='pull_request' AND newest.pull_request_number=?
  ORDER BY newest.created_at DESC, newest.generation DESC LIMIT 1)`;

function captureState(row: PullRow): PullCaptureState {
  // A check for documents only, or a Plan that selected no visual capture, has
  // no run to wait for.
  const notRequired = row.docsOnly === 1 || row.visualRequired === 0;
  const hasRun = !notRequired && row.runId !== null;
  if (hasRun && row.runState === "failed") return "failed";
  if (hasRun && row.runSealedAt !== null) return "ready";
  // A run that closed before it sealed has no review to open.
  if (hasRun && row.runState === "superseded") return "replaced";
  if (row.checkState === "failed") return "failed";
  if (notRequired) return "not-required";
  return "pending";
}

/** A check that does not belong to the pull request has no answer. */
export async function pullAnswer({ context, pullNumber, check }: PullParams): Promise<PullAnswer> {
  const { projectId, github } = context.configuration;
  // One statement finds the check, the run of its workflow attempt, and the title.
  // Among the checks of one head commit, a check that is bound to a workflow
  // attempt comes first, as for the review link (`review-links.ts`): an unbound
  // regenerated merge must not replace the attempt that actually ran.
  // The title lookup compares with `+0`: a bare integer column there hides the
  // pull request number from the index `github_webhook_delivery_pr_title`.
  const row = await context.database
    .prepare(`SELECT pre.source_sha AS sourceSha, pre.docs_only AS docsOnly,
      pre.plan_visual_required AS visualRequired, pre.state AS checkState,
      pre.workflow_run_id AS workflowRunId, pre.workflow_attempt AS workflowAttempt,
      run.id AS runId, run.state AS runState, run.sealed_at AS runSealedAt,
      (SELECT json_extract(delivery.payload_json,'$.pull_request.title')
        FROM github_webhook_delivery delivery
        WHERE delivery.event='pull_request'
          AND CAST(json_extract(delivery.payload_json,'$.repository.id') AS TEXT)=pre.repository_id
          AND json_extract(delivery.payload_json,'$.pull_request.number')=pre.pull_request_number+0
        ORDER BY delivery.received_at DESC LIMIT 1) AS title
      FROM pre_run_checks pre
      LEFT JOIN visonaut_runs run ON run.project_id=? AND run.external_run_id=pre.workflow_run_id
        AND run.attempt=pre.workflow_attempt AND run.kind='pull_request'
        AND run.lineage_key='pr:' || pre.pull_request_number AND run.tested_sha=pre.tested_sha
      WHERE pre.repository_id=? AND pre.kind='pull_request' AND pre.pull_request_number=?
        AND ${check === null ? newestHeadSql : "pre.external_id=?"}
      ORDER BY pre.workflow_run_id IS NULL, pre.created_at DESC, pre.generation DESC LIMIT 1`)
    .bind(
      projectId,
      github.repositoryId,
      pullNumber,
      ...(check === null ? [github.repositoryId, pullNumber] : [check]),
    )
    .first<PullRow>();
  if (!row) {
    throw new SecurityError("not_found", 404, "The pull-request check was not found.");
  }
  const state = captureState(row);
  const answer: PullAnswer = {
    repository: github.repository,
    pullNumber,
    runId: state === "ready" ? row.runId : null,
    state,
    headSha: row.sourceSha,
  };
  if (row.title) {
    answer.title = row.title;
  }
  if (row.workflowRunId && row.workflowAttempt) {
    answer.attempt = row.workflowAttempt;
    answer.workflowUrl = `https://github.com/${github.repository}/actions/runs/${encodeURIComponent(row.workflowRunId)}/attempts/${row.workflowAttempt}`;
  }
  return answer;
}
