import {
  postCommitStatus,
  SecurityError,
  startingCommitStatus,
  statusTargetUrl,
  type GitHubClient,
} from "@visonaut/security";
import type { ApiContext } from "./context.js";
import { ownsCommitStatusSql } from "../operations/check-state.ts";
import { afterRestoreSql } from "../operations/recovery.ts";

export interface Candidate {
  testedSha: string;
  sourceSha: string;
  baseSha: string;
  kind: "main" | "pull_request" | "merge_group";
  ref: string;
  pullRequestNumber: number | null;
  docsOnly: boolean;
}

export interface PreRunCheck {
  tested_sha: string;
  generation: number;
  repository_id: string;
  source_sha: string;
  base_sha: string;
  kind: Candidate["kind"];
  ref: string;
  pull_request_number: number | null;
  docs_only: number;
  plan_visual_required: number | null;
  plan_reported_at: number | null;
  plan_job_id: string | null;
  external_id: string;
  /**
   * The key of the status outbox: the external ID of the row. A row from the
   * time of check runs stores the ID of its check run.
   */
  check_id: string | null;
  check_head_sha: string | null;
  status_state: "pending" | "success" | "failure" | null;
  state: "pending" | "creating" | "active" | "docs_complete" | "failed";
  request_started: number;
  lease_until: number | null;
  workflow_run_id: string | null;
  workflow_attempt: number | null;
}

export function sha(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value) ? value : null;
}

export function externalId(testedSha: string, generation: number) {
  return `visonaut:pre:${testedSha}${generation ? `:${generation}` : ""}`;
}

export async function storedCheck(context: ApiContext, testedSha: string) {
  return context.database
    .prepare(
      `SELECT * FROM pre_run_checks WHERE tested_sha = ? AND ${afterRestoreSql("pre_run_checks.created_at")} ORDER BY generation DESC LIMIT 1`,
    )
    .bind(testedSha)
    .first<PreRunCheck>();
}

export async function attemptCheck(
  context: ApiContext,
  workflowRunId: string,
  workflowAttempt: number,
) {
  return context.database
    .prepare(
      `SELECT * FROM pre_run_checks WHERE workflow_run_id = ? AND workflow_attempt = ? AND ${afterRestoreSql("pre_run_checks.created_at")}`,
    )
    .bind(workflowRunId, workflowAttempt)
    .first<PreRunCheck>();
}

/** The page of a pre-run row: its pull request page with its identity, or the home page. */
function preRunDetailsUrl(context: ApiContext, row: PreRunCheck) {
  const { origin } = context.configuration;
  if (row.kind !== "pull_request" || !row.pull_request_number) return origin;
  return new URL(
    `/pulls/${row.pull_request_number}?check=${encodeURIComponent(row.external_id)}`,
    origin,
  ).href;
}

async function ownsCommitStatus(context: ApiContext, row: PreRunCheck) {
  const owner = await context.database
    .prepare(
      `SELECT 1 AS found FROM pre_run_checks row WHERE row.external_id=? AND ${ownsCommitStatusSql("row")}`,
    )
    .bind(row.external_id)
    .first();
  return owner !== null;
}

/**
 * The result that a pre-run row shows: `in_progress`, or `completed` with its
 * conclusion. All rows of a commit share one commit status, so GitHub cannot
 * give the result of one row. A row reads its newest delivered update, or the
 * state that the service wrote directly. A closed row keeps the state that it
 * wrote last.
 */
export async function preRunResult(
  context: ApiContext,
  row: PreRunCheck,
): Promise<{ status: "in_progress" | "completed"; conclusion: string | null }> {
  const current = (await storedExternalId(context, row.external_id)) ?? row;
  const delivered = await context.database
    .prepare(`SELECT outbox.conclusion FROM work_checks checks
      JOIN work_status_outbox outbox
        ON outbox.check_id=checks.id AND outbox.revision=checks.delivered_revision
      WHERE checks.id=?`)
    .bind(current.check_id)
    .first<{ conclusion: string }>();
  const closed = current.state === "failed" || current.state === "docs_complete";
  const state =
    (closed && current.status_state) || delivered?.conclusion || current.status_state || "pending";
  if (state === "pending") return { status: "in_progress", conclusion: null };
  return { status: "completed", conclusion: state };
}

interface CompletePreRunResultParams {
  context: ApiContext;
  github: GitHubClient;
  row: PreRunCheck;
  conclusion: "success" | "failure";
  output: { title: string; summary: string };
}

/**
 * Completes the result of a pre-run row. The row posts the commit status only
 * when no newer row of its commit started its status, so that an older row
 * never hides the result of a newer one.
 * The POST comes before the stored state, so a later attempt sends a failed
 * POST again. A newer row can start between the owner read and the POST; its
 * next delivered update shows its result again.
 */
export async function completePreRunResult({
  context,
  github,
  row,
  conclusion,
  output,
}: CompletePreRunResultParams) {
  if (await ownsCommitStatus(context, row)) {
    const { origin } = context.configuration;
    await postCommitStatus({
      github,
      sha: row.check_head_sha ?? row.tested_sha,
      status: {
        state: conclusion,
        // A status has no summary.
        description: output.title,
        target_url: statusTargetUrl(preRunDetailsUrl(context, row), origin),
      },
    });
  }
  await context.database
    .prepare("UPDATE pre_run_checks SET status_state=?,updated_at=? WHERE external_id=?")
    .bind(conclusion, Date.now(), row.external_id)
    .run();
}

export function sameCandidate(row: PreRunCheck, candidate: Candidate) {
  return (
    row.tested_sha === candidate.testedSha &&
    row.source_sha === candidate.sourceSha &&
    row.base_sha === candidate.baseSha &&
    row.kind === candidate.kind &&
    row.ref === candidate.ref &&
    row.pull_request_number === candidate.pullRequestNumber &&
    row.docs_only === Number(candidate.docsOnly)
  );
}

export async function storedExternalId(context: ApiContext, externalId: string) {
  return context.database
    .prepare(
      `SELECT * FROM pre_run_checks WHERE external_id = ? AND ${afterRestoreSql("pre_run_checks.created_at")}`,
    )
    .bind(externalId)
    .first<PreRunCheck>();
}

/**
 * Posts the starting commit status of a row and activates the row. A status
 * has no ID to learn, so no POST is ambiguous. The claim keeps a late
 * starting POST from hiding a result that the outbox delivered after it.
 */
export async function ensureStoredCheck(
  context: ApiContext,
  github: GitHubClient,
  initial: PreRunCheck,
  stillCurrent: () => Promise<boolean>,
) {
  const now = Date.now();
  const row = initial;
  if (row.state === "active" || row.state === "docs_complete" || row.state === "failed") return;
  // A claim that its invocation did not end is free again.
  await context.database
    .prepare(
      "UPDATE pre_run_checks SET state='pending',lease_until=NULL WHERE external_id=? AND state='creating' AND lease_until<=?",
    )
    .bind(row.external_id, now)
    .run();
  const claimed = await context.database
    .prepare(
      "UPDATE pre_run_checks SET state='creating',lease_until=?,updated_at=? WHERE external_id=? AND state='pending' RETURNING tested_sha",
    )
    .bind(now + 120_000, now, row.external_id)
    .first();
  if (!claimed) {
    throw new SecurityError("check_pending", 503, "Check creation is in progress.");
  }
  try {
    if (!(await stillCurrent())) {
      throw new SecurityError(
        "stale_candidate",
        503,
        "The candidate changed before check creation.",
      );
    }
    if (await ownsCommitStatus(context, row)) {
      await postCommitStatus({
        github,
        sha: row.check_head_sha ?? row.tested_sha,
        status: startingCommitStatus(preRunDetailsUrl(context, row), context.configuration.origin),
      });
    }
    await context.database
      .prepare(
        "UPDATE pre_run_checks SET state='active',check_id=external_id,lease_until=NULL,updated_at=? WHERE external_id=? AND state='creating'",
      )
      .bind(Date.now(), row.external_id)
      .run();
  } catch (error) {
    await context.database
      .prepare(
        "UPDATE pre_run_checks SET state='pending',lease_until=NULL,updated_at=? WHERE external_id=? AND state='creating'",
      )
      .bind(Date.now(), row.external_id)
      .run();
    throw error;
  }
}

async function mainSuccessor(context: ApiContext, github: GitHubClient, candidate: Candidate) {
  if (candidate.kind !== "main") return;
  const previous = await storedCheck(context, candidate.testedSha);
  if (!previous || previous.kind === "main") return;
  if (previous.repository_id !== github.repositoryId) {
    throw new SecurityError("check_conflict", 409, "The previous commit check is unavailable.");
  }
  if (previous.check_id) {
    const check = await preRunResult(context, previous);
    if (check.status !== "completed" || check.conclusion !== "success") {
      throw new SecurityError("check_conflict", 409, "The previous commit check has not passed.");
    }
  } else if (
    previous.state !== "pending" ||
    previous.request_started ||
    previous.workflow_run_id !== null
  ) {
    throw new SecurityError("check_conflict", 409, "The previous commit check is unavailable.");
  }
  const generation = previous.generation + 1;
  const now = Date.now();
  await context.database
    .prepare(
      "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,check_head_sha,surface,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,'status',?,? WHERE NOT EXISTS(SELECT 1 FROM pre_run_checks WHERE tested_sha=? AND generation>=?) ON CONFLICT DO NOTHING",
    )
    .bind(
      candidate.testedSha,
      generation,
      github.repositoryId,
      candidate.sourceSha,
      candidate.baseSha,
      candidate.kind,
      candidate.ref,
      candidate.pullRequestNumber,
      0,
      externalId(candidate.testedSha, generation),
      candidate.testedSha,
      now,
      now,
      candidate.testedSha,
      generation,
    )
    .run();
}

/** Preserve candidate provenance without publishing a GitHub check. */
export async function recordPreRunCandidate(
  context: ApiContext,
  github: GitHubClient,
  candidate: Candidate,
) {
  await storeCandidateCheck({
    context,
    github,
    candidate,
    currentCandidate: () => Promise.resolve(candidate),
    validateBeforeCreation: false,
    createCheck: false,
  });
}

interface StoreCandidateCheckParams {
  context: ApiContext;
  github: GitHubClient;
  candidate: Candidate;
  currentCandidate: () => Promise<Candidate | null>;
  validateBeforeCreation: boolean;
  createCheck: boolean;
}

export async function storeCandidateCheck({
  context,
  github,
  candidate,
  currentCandidate,
  validateBeforeCreation,
  createCheck,
}: StoreCandidateCheckParams) {
  const now = Date.now();
  await mainSuccessor(context, github, candidate);
  // A restored check keeps its identity; a new capture gets a new generation.
  await context.database
    .prepare(
      `WITH next_generation AS (SELECT COALESCE(MAX(generation),-1)+1 AS value FROM pre_run_checks WHERE tested_sha=?)
      INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,check_head_sha,surface,created_at,updated_at)
      SELECT ?,value,?,?,?,?,?,?,?,'visonaut:pre:'||?||CASE WHEN value=0 THEN '' ELSE ':'||value END,
        CASE WHEN EXISTS(SELECT 1 FROM pre_run_checks legacy WHERE legacy.tested_sha=? AND legacy.kind='pull_request' AND legacy.check_head_sha IS NULL) THEN NULL ELSE ? END,'status',?,?
      FROM next_generation WHERE NOT EXISTS(SELECT 1 FROM pre_run_checks WHERE tested_sha=? AND ${afterRestoreSql("pre_run_checks.created_at")}) ON CONFLICT DO NOTHING`,
    )
    .bind(
      candidate.testedSha,
      candidate.testedSha,
      github.repositoryId,
      candidate.sourceSha,
      candidate.baseSha,
      candidate.kind,
      candidate.ref,
      candidate.pullRequestNumber,
      Number(candidate.docsOnly),
      candidate.testedSha,
      candidate.testedSha,
      candidate.kind === "pull_request" ? candidate.sourceSha : candidate.testedSha,
      now,
      now,
      candidate.testedSha,
    )
    .run();
  const row = await storedCheck(context, candidate.testedSha);
  if (row?.kind === "main" && candidate.kind !== "main") {
    const earlier = await context.database
      .prepare(
        `SELECT * FROM pre_run_checks WHERE tested_sha=? AND kind=? AND ${afterRestoreSql("pre_run_checks.created_at")} ORDER BY generation DESC LIMIT 1`,
      )
      .bind(candidate.testedSha, candidate.kind)
      .first<PreRunCheck>();
    if (earlier && sameCandidate(earlier, candidate)) return;
  }
  if (!row || row.repository_id !== github.repositoryId || !sameCandidate(row, candidate)) {
    throw new SecurityError("check_conflict", 409, "The check identity has different provenance.");
  }
  if (!createCheck) return;
  if (validateBeforeCreation) {
    const current = await currentCandidate();
    if (!current || !sameCandidate(row, current)) {
      throw new SecurityError("workflow_candidate", 503, "The signed candidate changed.");
    }
  }
  await ensureStoredCheck(context, github, row, async () => {
    const current = await currentCandidate();
    return current !== null && sameCandidate(row, current);
  });
}

/** Materialization can adopt only this attempt's already-created, still-pending App check. */
export async function findPreRunCheck(
  context: ApiContext,
  github: GitHubClient,
  identity: { testedSha: string; workflowRunId: string; workflowAttempt: number },
) {
  let row = await attemptCheck(context, identity.workflowRunId, identity.workflowAttempt);
  if (!row) {
    const unbound = await storedCheck(context, identity.testedSha);
    if (unbound?.state === "active" && unbound.workflow_run_id === null) {
      await context.database
        .prepare(
          "UPDATE pre_run_checks SET workflow_run_id=?,workflow_attempt=?,updated_at=? WHERE external_id=? AND state='active' AND workflow_run_id IS NULL",
        )
        .bind(identity.workflowRunId, identity.workflowAttempt, Date.now(), unbound.external_id)
        .run();
      row = await attemptCheck(context, identity.workflowRunId, identity.workflowAttempt);
    }
  }
  const latest = await storedCheck(context, identity.testedSha);
  if (
    !row ||
    !latest ||
    latest.external_id !== row.external_id ||
    row.tested_sha !== identity.testedSha ||
    row.repository_id !== github.repositoryId ||
    row.workflow_run_id !== identity.workflowRunId ||
    row.workflow_attempt !== identity.workflowAttempt ||
    row.state !== "active" ||
    !row.check_id ||
    row.docs_only
  ) {
    throw new SecurityError("pre_run_check", 503, "The candidate App check is not ready.");
  }
  const check = await preRunResult(context, row);
  if (check.status !== "in_progress") {
    throw new SecurityError("pre_run_check", 409, "The candidate App check is already complete.");
  }
  return {
    repositoryId: row.repository_id,
    testedSha: row.tested_sha,
    workflowRunId: row.workflow_run_id,
    workflowAttempt: row.workflow_attempt,
    externalId: row.external_id,
    checkId: row.check_id,
  };
}
