import {
  CHECK_NAME,
  findGitHubCheck,
  numericId,
  SecurityError,
  startingCheckOutput,
  type GitHubClient,
} from "@visonaut/security";
import type { ApiContext } from "./context.js";
import { object } from "./input.js";
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
  check_id: string | null;
  check_head_sha: string | null;
  state: "pending" | "creating" | "ambiguous" | "active" | "docs_complete" | "failed";
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

export async function verifiedCheck(github: GitHubClient, row: PreRunCheck, checkId: string) {
  const check = object(await github.request(`/repos/${github.repository}/check-runs/${checkId}`));
  if (
    numericId(check.id) !== checkId ||
    check.name !== CHECK_NAME ||
    check.external_id !== row.external_id ||
    check.head_sha !== (row.check_head_sha ?? row.tested_sha) ||
    numericId(object(check.app).id) !== github.appId
  ) {
    throw new SecurityError("wrong_check", 409, "The check does not belong to this commit.");
  }
  return check;
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

async function finishCreation(
  context: ApiContext,
  github: GitHubClient,
  row: PreRunCheck,
  stillCurrent: () => Promise<boolean>,
) {
  const checkId = row.check_id;
  if (!checkId) throw new SecurityError("check_pending", 503, "The check is not available yet.");
  await verifiedCheck(github, row, checkId);
  if (!(await stillCurrent())) {
    throw new SecurityError("stale_candidate", 503, "The candidate changed before check creation.");
  }
  await context.database
    .prepare(
      "UPDATE pre_run_checks SET state=?,lease_until=NULL,updated_at=? WHERE external_id=? AND state='creating' AND check_id=?",
    )
    .bind("active", Date.now(), row.external_id, checkId)
    .run();
}

export async function ensureStoredCheck(
  context: ApiContext,
  github: GitHubClient,
  initial: PreRunCheck,
  stillCurrent: () => Promise<boolean>,
) {
  const now = Date.now();
  let row = initial;
  if (row.state === "active" || row.state === "docs_complete" || row.state === "failed") return;
  if (row.state === "creating" && (row.lease_until ?? 0) <= now) {
    await context.database
      .prepare(
        "UPDATE pre_run_checks SET state=CASE WHEN request_started=1 THEN 'ambiguous' ELSE 'pending' END,lease_until=NULL WHERE external_id=? AND state='creating' AND lease_until<=?",
      )
      .bind(row.external_id, now)
      .run();
    row = (await storedExternalId(context, row.external_id)) ?? row;
  }
  if (row.state === "ambiguous") {
    const found = await findGitHubCheck({
      github,
      testedSha: row.check_head_sha ?? row.tested_sha,
      externalId: row.external_id,
    });
    if (!found) {
      throw new SecurityError("ambiguous_check", 503, "Check creation needs reconciliation.");
    }
    await context.database
      .prepare(
        "UPDATE pre_run_checks SET state='creating',check_id=?,lease_until=?,updated_at=? WHERE external_id=? AND state='ambiguous'",
      )
      .bind(found, now + 120_000, now, row.external_id)
      .run();
    row = (await storedExternalId(context, row.external_id)) ?? row;
  }
  if (row.state === "creating" && row.lease_until && row.lease_until > now && row.check_id) {
    await finishCreation(context, github, row, stillCurrent);
    return;
  }
  if (row.state === "creating") {
    throw new SecurityError("check_pending", 503, "Check creation is in progress.");
  }
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
    // A failed POST is ambiguous. Never make a second POST after it has started.
    const found = await findGitHubCheck({
      github,
      testedSha: row.check_head_sha ?? row.tested_sha,
      externalId: row.external_id,
    });
    let checkId = found;
    if (!checkId) {
      const started = await context.database
        .prepare(
          "UPDATE pre_run_checks SET request_started=1 WHERE external_id=? AND state='creating' AND lease_until>? RETURNING tested_sha",
        )
        .bind(row.external_id, Date.now())
        .first();
      if (!started) return;
      const created = object(
        await github.request(`/repos/${github.repository}/check-runs`, {
          method: "POST",
          body: JSON.stringify({
            name: CHECK_NAME,
            head_sha: row.check_head_sha ?? row.tested_sha,
            external_id: row.external_id,
            details_url:
              row.kind === "pull_request" && row.pull_request_number
                ? new URL(
                    `/pulls/${row.pull_request_number}?check=${encodeURIComponent(row.external_id)}`,
                    context.configuration.origin,
                  ).href
                : context.configuration.origin,
            status: "in_progress",
            output: startingCheckOutput,
          }),
        }),
      );
      checkId = numericId(created.id);
    }
    await context.database
      .prepare("UPDATE pre_run_checks SET check_id=? WHERE external_id=? AND state='creating'")
      .bind(checkId, row.external_id)
      .run();
    const current = await storedExternalId(context, row.external_id);
    if (current?.state === "creating") await finishCreation(context, github, current, stillCurrent);
  } catch (error) {
    await context.database
      .prepare(
        "UPDATE pre_run_checks SET state=CASE WHEN request_started=1 THEN 'ambiguous' ELSE 'pending' END,lease_until=NULL,updated_at=? WHERE external_id=? AND state='creating'",
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
    const check = await verifiedCheck(github, previous, previous.check_id);
    if (
      check.status !== "completed" ||
      (check.conclusion !== "success" && check.conclusion !== "neutral")
    ) {
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
      "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,check_head_sha,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM pre_run_checks WHERE tested_sha=? AND generation>=?) ON CONFLICT DO NOTHING",
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
      INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,check_head_sha,created_at,updated_at)
      SELECT ?,value,?,?,?,?,?,?,?,'visonaut:pre:'||?||CASE WHEN value=0 THEN '' ELSE ':'||value END,
        CASE WHEN EXISTS(SELECT 1 FROM pre_run_checks legacy WHERE legacy.tested_sha=? AND legacy.kind='pull_request' AND legacy.check_head_sha IS NULL) THEN NULL ELSE ? END,?,?
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
  const check = await verifiedCheck(github, row, row.check_id);
  if (check.status !== "in_progress" && check.status !== "queued") {
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
