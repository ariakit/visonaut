import {
  numericId,
  SecurityError,
  type GitHubClient,
  type VerifiedRun,
  type VerifiedWebhook,
} from "@visonaut/security";
import { captureJobNames, workflowSourceDigest } from "@visonaut/protocol";
import { loadVerifiedMergeGroup, type ApiContext } from "./context.js";
import { object } from "./input.js";
import { completeWorkflowJobs } from "./jobs.js";
import { mergeBaseForHead } from "./merge.js";
import {
  completedHistoricalAttempt,
  mainWorkflowCandidate,
  workflowCandidate,
} from "./pre-run-candidates.js";
import {
  attemptCheck,
  ensureStoredCheck,
  externalId,
  recordPreRunCandidate,
  sameCandidate,
  sha,
  storeCandidateCheck,
  storedCheck,
  storedExternalId,
  verifiedCheck,
  type Candidate,
  type PreRunCheck,
} from "./pre-run-checks.js";
import { inheritVisualPlan } from "./pre-run-plan.js";
import { stagedAttemptRetentionMs } from "./workflow-retention.js";
import { afterRestoreSql } from "../operations/recovery.ts";

async function successfulSubmittedPinnedJobs(
  context: ApiContext,
  github: GitHubClient,
  run: Record<string, unknown>,
  row: PreRunCheck,
) {
  const configuration = context.configuration.workflowOwned;
  if (!configuration) return { submitted: false, successful: false };
  const submitted = await context.database
    .prepare(
      "SELECT submit_job_id FROM ingest_staged_runs WHERE repository_id=? AND workflow_run_id=? AND workflow_attempt=? AND tested_sha=? AND submitted_at IS NOT NULL",
    )
    .bind(github.repositoryId, numericId(run.id), run.run_attempt, row.tested_sha)
    .first<{ submit_job_id: string | null }>();
  if (!submitted) return { submitted: false, successful: false };
  const jobs = await completeWorkflowJobs(github, numericId(run.id));
  const captureNames = captureJobNames(configuration.captureJobName);
  const captureJobs = jobs.filter(
    (job) => typeof job.name === "string" && captureNames.shard(job.name) !== undefined,
  );
  const submitJobs = jobs.filter((job) => job.name === configuration.submitJobName);
  const pinnedJobs = [...captureJobs, ...submitJobs];
  return {
    submitted: true,
    successful:
      submitJobs.length === 1 &&
      String(submitJobs[0]?.id) === submitted.submit_job_id &&
      pinnedJobs.every((job) => job.status === "completed" && job.conclusion === "success"),
  };
}

async function retireBoundHistoricalCheck(
  context: ApiContext,
  github: GitHubClient,
  row: PreRunCheck,
  output: { title: string; summary: string },
) {
  if (!row.check_id) {
    throw new SecurityError("check_pending", 503, "The historical check is unavailable.");
  }
  const check = await verifiedCheck(github, row, row.check_id);
  if (check.status === "completed") {
    if (check.conclusion === "success" || check.conclusion === "neutral") return true;
    if (check.conclusion !== "failure") {
      throw new SecurityError("pre_run_check", 503, "The historical check is incomplete.");
    }
  }
  const fenced = await context.database
    .prepare(`UPDATE pre_run_checks SET state='failed',updated_at=?
      WHERE external_id=? AND state='active' AND check_id=?
        AND NOT EXISTS (SELECT 1 FROM work_checks sender
          WHERE sender.id=pre_run_checks.check_id
            AND (sender.request_started=1 OR sender.ambiguous=1))
      RETURNING external_id`)
    .bind(Date.now(), row.external_id, row.check_id)
    .first();
  if (!fenced) {
    const current = await storedExternalId(context, row.external_id);
    const sending = await context.database
      .prepare(
        "SELECT 1 AS found FROM work_checks WHERE id=? AND (request_started=1 OR ambiguous=1)",
      )
      .bind(row.check_id)
      .first();
    if (current?.state !== "failed" || sending) {
      throw new SecurityError("check_pending", 503, "The prior check delivery is still pending.");
    }
  }
  const closed = await verifiedCheck(github, row, row.check_id);
  if (closed.status === "completed") {
    if (["success", "neutral", "failure"].includes(String(closed.conclusion))) return true;
    throw new SecurityError("pre_run_check", 503, "The historical check is incomplete.");
  }
  if (closed.status === "in_progress" || closed.status === "queued") {
    await github.request(`/repos/${github.repository}/check-runs/${row.check_id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        conclusion: "failure",
        completed_at: new Date().toISOString(),
        output,
      }),
    });
    const completed = await verifiedCheck(github, row, row.check_id);
    if (completed.status !== "completed" || completed.conclusion !== "failure") {
      throw new SecurityError("check_pending", 503, "The historical check did not close.");
    }
    return true;
  }
  throw new SecurityError("pre_run_check", 503, "The historical check has an unknown status.");
}

async function historicalMainStageCanMaterialize(context: ApiContext, row: PreRunCheck) {
  const configuration = context.configuration.workflowOwned;
  if (!configuration || !row.workflow_run_id || row.workflow_attempt === null) return false;
  const digest = await workflowSourceDigest(configuration.reusableWorkflowSha);
  // Match the durable reconciler's retention and workflow-pin admission
  // before acknowledging a receipt that leaves its App check pending.
  const staged = await context.database
    .prepare(
      `SELECT 1 AS found FROM ingest_staged_runs staged
      LEFT JOIN visonaut_runs materialized ON materialized.id=staged.id
      WHERE staged.repository_id=? AND staged.workflow_run_id=?
        AND staged.workflow_attempt=? AND staged.tested_sha=?
        AND staged.retention_state='live' AND staged.submitted_at IS NOT NULL
        AND staged.created_at>? AND staged.submit_job_id IS NOT NULL
        AND staged.submit_verified_json IS NOT NULL
        AND staged.workflow_source_digest=? AND staged.caller_workflow_path=?
        AND staged.reusable_workflow_ref=? AND staged.capture_job_prefix=?
        AND staged.submit_job_name=?
        AND (materialized.id IS NULL OR (materialized.active=1
          AND materialized.sealed_at IS NULL AND materialized.state='uploading'))
        AND NOT EXISTS (SELECT 1 FROM visonaut_runs newer
          WHERE newer.project_id=? AND newer.external_run_id=staged.workflow_run_id
            AND newer.attempt>staged.workflow_attempt AND newer.sealed_at IS NOT NULL)
      LIMIT 1`,
    )
    .bind(
      row.repository_id,
      row.workflow_run_id,
      row.workflow_attempt,
      row.tested_sha,
      Date.now() - stagedAttemptRetentionMs,
      digest,
      configuration.callerWorkflowPath,
      configuration.reusableWorkflowRef,
      configuration.captureJobName,
      configuration.submitJobName,
      context.configuration.projectId,
    )
    .first();
  return Boolean(staged);
}

interface HistoricalWorkflowParams {
  context: ApiContext;
  github: GitHubClient;
  run: Record<string, unknown>;
  action: string;
}

async function retireSupersededMainAttempt({
  context,
  github,
  run,
  action,
}: HistoricalWorkflowParams) {
  if (run.event !== "push" || run.status !== "completed" || run.head_branch !== "main") {
    return false;
  }
  const runId = numericId(run.id);
  const attempt = run.run_attempt;
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 1) {
    return false;
  }
  const testedSha = sha(run.head_sha);
  const row = await attemptCheck(context, runId, attempt);
  if (
    !testedSha ||
    !row ||
    row.repository_id !== github.repositoryId ||
    row.kind !== "main" ||
    row.ref !== "refs/heads/main" ||
    row.source_sha !== testedSha ||
    row.tested_sha !== testedSha ||
    row.pull_request_number !== null ||
    !row.check_id
  ) {
    return false;
  }
  const ref = object(await github.request(`/repos/${github.repository}/git/ref/heads/main`));
  const currentSha = sha(object(ref.object).sha);
  if (!currentSha || currentSha === testedSha) return false;
  const check = await verifiedCheck(github, row, row.check_id);
  // A delayed progress delivery may arrive after the live run completes.
  if (action !== "completed") return true;
  if (check.status !== "completed" && row.state === "active") {
    const sealed = await context.database
      .prepare(
        "SELECT 1 AS found FROM visonaut_runs WHERE project_id=? AND external_run_id=? AND attempt=? AND tested_sha=? AND active=1 AND sealed_at IS NOT NULL AND state!='failed' LIMIT 1",
      )
      .bind(context.configuration.projectId, runId, attempt, testedSha)
      .first();
    if (sealed) return true;
    const submitted = await successfulSubmittedPinnedJobs(context, github, run, row);
    // A successful signed Submit can still materialize after the workflow ends.
    if (submitted.successful && (await historicalMainStageCanMaterialize(context, row))) {
      return true;
    }
  }
  return retireBoundHistoricalCheck(context, github, row, {
    title: "Visual capture was superseded",
    summary: "Main advanced before this workflow attempt completed.",
  });
}

async function retireSupersededPullRequestAttempt({
  context,
  github,
  run,
  action,
}: HistoricalWorkflowParams) {
  if (run.event !== "pull_request") return false;
  const runId = numericId(run.id);
  const attempt = run.run_attempt;
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 1) {
    return false;
  }
  const row = await attemptCheck(context, runId, attempt);
  if (
    !row ||
    row.repository_id !== github.repositoryId ||
    row.kind !== "pull_request" ||
    row.source_sha !== run.head_sha ||
    row.pull_request_number === null ||
    row.ref !== `refs/pull/${row.pull_request_number}/merge` ||
    !Array.isArray(run.pull_requests) ||
    (run.pull_requests.length !== 0 &&
      !run.pull_requests.some((value) => object(value).number === row.pull_request_number))
  ) {
    return false;
  }
  const root = `/repos/${github.repository}`;
  const pull = object(await github.request(`${root}/pulls/${row.pull_request_number}`));
  const head = object(pull.head);
  const base = object(pull.base);
  if (
    numericId(object(head.repo).id) !== github.repositoryId ||
    numericId(object(base.repo).id) !== github.repositoryId
  ) {
    throw new SecurityError("workflow_identity", 503, "The pull-request repository changed.");
  }
  // GitHub drops a closed PR from workflow_run.pull_requests, but the bound
  // attempt and its verified App check still identify the original PR.
  if (run.pull_requests.length === 0 && pull.state !== "closed") return false;
  if (action !== "completed") {
    if (run.pull_requests.length !== 0 || pull.state !== "closed" || !row.check_id) {
      return false;
    }
    await verifiedCheck(github, row, row.check_id);
    // Only a completed delivery may close the check, even when the live run
    // has finished since this progress delivery was sent.
    return true;
  }
  if (run.status !== "completed") return false;
  // A temporary merge-ref mismatch stays retryable while GitHub updates it.
  if (
    pull.state === "open" &&
    base.ref === "main" &&
    head.ref === run.head_branch &&
    head.sha === row.source_sha
  ) {
    const currentMergeSha = sha(pull.merge_commit_sha);
    if (!currentMergeSha) return false;
    const mergeRef = object(
      await github.request(`${root}/git/ref/pull/${row.pull_request_number}/merge`),
    );
    if (object(mergeRef.object).sha !== currentMergeSha) return false;
    if (
      (await mergeBaseForHead(github, currentMergeSha, row.source_sha)) &&
      (await mergeBaseForHead(github, row.tested_sha, row.source_sha)) === row.base_sha
    ) {
      return false;
    }
  }
  return retireBoundHistoricalCheck(context, github, row, {
    title: "Visual capture was superseded",
    summary: "The pull request head or target changed before capture completed.",
  });
}

async function retireUnboundTerminalPullRequestAttempt(
  context: ApiContext,
  github: GitHubClient,
  run: Record<string, unknown>,
) {
  if (run.event !== "pull_request" || run.status !== "completed") return false;
  const runId = numericId(run.id);
  const attempt = run.run_attempt;
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 1) {
    return false;
  }
  if (await attemptCheck(context, runId, attempt)) return false;
  const previous = await context.database
    .prepare(
      `SELECT * FROM pre_run_checks WHERE workflow_run_id=? AND workflow_attempt<? AND ${afterRestoreSql("pre_run_checks.created_at")} ORDER BY workflow_attempt DESC`,
    )
    .bind(runId, attempt)
    .all<PreRunCheck>();
  const bound = previous.results.find((row) => row.check_id);
  const checkId = bound?.check_id;
  const number = bound?.pull_request_number;
  if (
    !bound ||
    !checkId ||
    !number ||
    bound.repository_id !== github.repositoryId ||
    bound.kind !== "pull_request" ||
    bound.source_sha !== run.head_sha ||
    bound.ref !== `refs/pull/${number}/merge` ||
    previous.results.some(
      (row) =>
        row.repository_id !== bound.repository_id ||
        row.kind !== bound.kind ||
        row.source_sha !== bound.source_sha ||
        row.pull_request_number !== number ||
        row.ref !== bound.ref,
    ) ||
    !Array.isArray(run.pull_requests) ||
    (run.pull_requests.length !== 0 &&
      (run.pull_requests.length !== 1 || object(run.pull_requests[0]).number !== number))
  ) {
    return false;
  }
  await verifiedCheck(github, bound, checkId);
  const pull = object(await github.request(`/repos/${github.repository}/pulls/${number}`));
  const head = object(pull.head);
  const base = object(pull.base);
  if (
    numericId(object(head.repo).id) !== github.repositoryId ||
    numericId(object(base.repo).id) !== github.repositoryId
  ) {
    return false;
  }
  if (pull.state === "closed") return true;
  if (pull.state !== "open") return false;
  if (base.ref !== "main" || head.ref !== run.head_branch || head.sha !== bound.source_sha) {
    return true;
  }
  const currentMergeSha = sha(pull.merge_commit_sha);
  if (!currentMergeSha) return false;
  const mergeRef = object(
    await github.request(`/repos/${github.repository}/git/ref/pull/${number}/merge`),
  );
  if (object(mergeRef.object).sha !== currentMergeSha) return false;
  return (
    !(await mergeBaseForHead(github, currentMergeSha, bound.source_sha)) ||
    (await mergeBaseForHead(github, bound.tested_sha, bound.source_sha)) !== bound.base_sha
  );
}

async function bindWorkflowCheck(
  context: ApiContext,
  github: GitHubClient,
  run: Record<string, unknown>,
  candidate: PreRunCheck,
) {
  const runId = numericId(run.id);
  const attempt = run.run_attempt;
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 1) {
    throw new SecurityError("workflow_identity", 503, "The workflow attempt is unavailable.");
  }
  const existing = await attemptCheck(context, runId, attempt);
  if (existing) {
    if (
      existing.repository_id !== github.repositoryId ||
      existing.tested_sha !== candidate.tested_sha ||
      !sameCandidate(existing, {
        testedSha: candidate.tested_sha,
        sourceSha: candidate.source_sha,
        baseSha: candidate.base_sha,
        kind: candidate.kind,
        ref: candidate.ref,
        pullRequestNumber: candidate.pull_request_number,
        docsOnly: Boolean(candidate.docs_only),
      })
    ) {
      throw new SecurityError("workflow_conflict", 409, "The workflow attempt changed candidate.");
    }
    await ensureStoredCheck(context, github, existing, async () => {
      const current = await workflowCandidate({ context, github, run });
      return current?.tested_sha === existing.tested_sha;
    });
    return (await attemptCheck(context, runId, attempt)) ?? existing;
  }
  if (candidate.state === "active" && candidate.workflow_run_id === null) {
    if (!candidate.check_id) {
      throw new SecurityError("check_pending", 503, "The candidate check is unavailable.");
    }
    const check = await verifiedCheck(github, candidate, candidate.check_id);
    if (check.status !== "completed") {
      await context.database
        .prepare(
          "UPDATE pre_run_checks SET workflow_run_id=?,workflow_attempt=?,updated_at=? WHERE external_id=? AND state='active' AND workflow_run_id IS NULL",
        )
        .bind(runId, attempt, Date.now(), candidate.external_id)
        .run();
      const bound = await attemptCheck(context, runId, attempt);
      if (bound) return bound;
    }
  }
  if (
    candidate.state === "pending" ||
    candidate.state === "creating" ||
    candidate.state === "ambiguous"
  ) {
    throw new SecurityError("check_pending", 503, "The first candidate check is not ready.");
  }
  if (!candidate.check_id) {
    throw new SecurityError("pre_run_check", 503, "The previous candidate check is unavailable.");
  }
  const previous = await verifiedCheck(github, candidate, candidate.check_id);
  if (previous.status !== "completed") {
    if (
      candidate.workflow_run_id !== runId ||
      candidate.workflow_attempt === null ||
      candidate.workflow_attempt >= attempt
    ) {
      throw new SecurityError(
        "check_pending",
        503,
        "The previous workflow check is still pending.",
      );
    }
    await completedHistoricalAttempt(github, run, candidate.workflow_attempt);
  }
  // A sender that already passed its current-check guard remains visible as
  // request_started until its remote PATCH finishes. Do not race that send.
  await context.database
    .prepare(
      "UPDATE pre_run_checks SET state='failed',updated_at=? WHERE external_id=? AND state='active'",
    )
    .bind(Date.now(), candidate.external_id)
    .run();
  const sending = await context.database
    .prepare("SELECT 1 AS found FROM work_checks WHERE id=? AND (request_started=1 OR ambiguous=1)")
    .bind(candidate.check_id)
    .first();
  if (sending) {
    throw new SecurityError("check_pending", 503, "The prior check delivery is still pending.");
  }
  const settled = await verifiedCheck(github, candidate, candidate.check_id);
  if (settled.status !== "completed") {
    await github.request(`/repos/${github.repository}/check-runs/${candidate.check_id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "completed",
        conclusion: "failure",
        completed_at: new Date().toISOString(),
        output: {
          title: "Visual capture was superseded",
          summary: `A verified rerun started as workflow attempt ${attempt}.`,
        },
      }),
    });
    const closed = await verifiedCheck(github, candidate, candidate.check_id);
    if (closed.status !== "completed" || closed.conclusion !== "failure") {
      throw new SecurityError("check_pending", 503, "The previous workflow check did not close.");
    }
  }
  const nextGeneration = candidate.generation + 1;
  const now = Date.now();
  await context.database
    .prepare(
      "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,check_head_sha,workflow_run_id,workflow_attempt,created_at,updated_at) SELECT tested_sha,generation+1,repository_id,source_sha,base_sha,kind,ref,pull_request_number,0,?,check_head_sha,?,?,?,? FROM pre_run_checks WHERE external_id=? ON CONFLICT DO NOTHING",
    )
    .bind(
      externalId(candidate.tested_sha, nextGeneration),
      runId,
      attempt,
      now,
      now,
      candidate.external_id,
    )
    .run();
  const next = await attemptCheck(context, runId, attempt);
  if (!next || next.generation !== nextGeneration) {
    throw new SecurityError("workflow_conflict", 503, "The next attempt check is not ready.");
  }
  await ensureStoredCheck(context, github, next, async () => {
    const current = await workflowCandidate({ context, github, run });
    return current?.external_id === next.external_id;
  });
  return (await attemptCheck(context, runId, attempt)) ?? next;
}

/** Bind the pending check before a signed Submit reads capture artifacts. */
export async function ensureSignedAttemptCheck(
  context: ApiContext,
  github: GitHubClient,
  identity: Pick<
    VerifiedRun,
    | "workflowRunId"
    | "workflowAttempt"
    | "testedSha"
    | "sourceHead"
    | "targetHead"
    | "event"
    | "ref"
    | "pullRequestNumber"
  >,
) {
  const configuration = context.configuration.workflowOwned;
  if (!configuration) {
    throw new SecurityError("workflow_configuration", 503, "The trusted workflow is unavailable.");
  }
  const run = object(
    await github.request(`/repos/${github.repository}/actions/runs/${identity.workflowRunId}`),
  );
  if (
    numericId(run.id) !== identity.workflowRunId ||
    run.run_attempt !== identity.workflowAttempt ||
    run.head_sha !== identity.sourceHead ||
    run.event !== identity.event ||
    run.path !== configuration.callerWorkflowPath ||
    numericId(object(run.repository).id) !== github.repositoryId
  ) {
    throw new SecurityError("workflow_identity", 503, "The signed workflow attempt changed.");
  }
  const reported = await context.database
    .prepare(`SELECT *,${afterRestoreSql("pre_run_checks.created_at")} AS current_epoch
    FROM pre_run_checks WHERE workflow_run_id=? AND workflow_attempt=?`)
    .bind(identity.workflowRunId, identity.workflowAttempt)
    .first<PreRunCheck & { current_epoch: number }>();
  // Restored attempt identities stay fixed, even when a new token is issued.
  if (reported && !reported.current_epoch) {
    throw new SecurityError(
      "restored_attempt",
      409,
      "The workflow attempt predates recovery. Start a new attempt.",
    );
  }
  if (reported?.plan_visual_required === 0)
    throw new SecurityError(
      "visual_not_required",
      409,
      "The trusted Plan selected no visual capture.",
    );
  if (
    identity.event === "pull_request" &&
    identity.pullRequestNumber &&
    !(await storedCheck(context, identity.testedSha))
  ) {
    const signedCandidate: Candidate = {
      testedSha: identity.testedSha,
      sourceSha: identity.sourceHead,
      baseSha: identity.targetHead,
      kind: "pull_request",
      ref: identity.ref,
      pullRequestNumber: identity.pullRequestNumber,
      docsOnly: false,
    };
    await storeCandidateCheck({
      context,
      github,
      candidate: signedCandidate,
      currentCandidate: async () => {
        const current = await workflowCandidate({
          context,
          github,
          run,
          testedSha: identity.testedSha,
        });
        return current && sameCandidate(current, signedCandidate) ? signedCandidate : null;
      },
      validateBeforeCreation: true,
      createCheck: true,
    });
  }
  if (
    (identity.event === "push" || identity.event === "workflow_dispatch") &&
    (await storedCheck(context, identity.testedSha))?.kind !== "main"
  ) {
    const signedCandidate = await mainWorkflowCandidate(
      context,
      github,
      identity.workflowRunId,
      identity.workflowAttempt,
    );
    if (!signedCandidate || signedCandidate.testedSha !== identity.testedSha) {
      throw new SecurityError(
        "workflow_candidate",
        503,
        "The signed main candidate is unavailable.",
      );
    }
    await storeCandidateCheck({
      context,
      github,
      candidate: signedCandidate,
      currentCandidate: async () => {
        const current = await workflowCandidate({ context, github, run });
        return current && sameCandidate(current, signedCandidate) ? signedCandidate : null;
      },
      validateBeforeCreation: true,
      createCheck: true,
    });
  }
  if (identity.event === "merge_group" && !(await storedCheck(context, identity.testedSha))) {
    const group = await loadVerifiedMergeGroup(context, identity.testedSha);
    if (
      !group ||
      group.repositoryId !== github.repositoryId ||
      group.headSha !== identity.testedSha ||
      group.headRef !== identity.ref ||
      group.baseRef !== "refs/heads/main" ||
      group.baseSha !== identity.targetHead ||
      identity.sourceHead !== identity.testedSha ||
      !identity.ref.startsWith("refs/heads/gh-readonly-queue/main/")
    ) {
      throw new SecurityError("workflow_candidate", 503, "The verified merge group changed.");
    }
    const signedCandidate: Candidate = {
      testedSha: identity.testedSha,
      sourceSha: identity.sourceHead,
      baseSha: identity.targetHead,
      kind: "merge_group",
      ref: identity.ref,
      pullRequestNumber: null,
      docsOnly: false,
    };
    await storeCandidateCheck({
      context,
      github,
      candidate: signedCandidate,
      currentCandidate: async () => {
        const current = await workflowCandidate({ context, github, run });
        return current && sameCandidate(current, signedCandidate) ? signedCandidate : null;
      },
      validateBeforeCreation: true,
      createCheck: true,
    });
  }
  const candidate = await workflowCandidate({
    context,
    github,
    run,
    testedSha: identity.testedSha,
  });
  if (!candidate || candidate.tested_sha !== identity.testedSha || candidate.docs_only) {
    throw new SecurityError("workflow_candidate", 503, "The signed candidate is unavailable.");
  }
  if (
    identity.event === "pull_request" &&
    (candidate.kind !== "pull_request" ||
      candidate.pull_request_number !== identity.pullRequestNumber ||
      candidate.ref !== identity.ref ||
      candidate.base_sha !== identity.targetHead ||
      candidate.source_sha !== identity.sourceHead)
  ) {
    throw new SecurityError("workflow_candidate", 503, "The signed pull request changed.");
  }
  if (
    identity.event === "merge_group" &&
    (candidate.kind !== "merge_group" ||
      candidate.ref !== identity.ref ||
      candidate.base_sha !== identity.targetHead ||
      candidate.source_sha !== identity.sourceHead)
  ) {
    throw new SecurityError("workflow_candidate", 503, "The signed merge group changed.");
  }
  await ensureStoredCheck(context, github, candidate, async () => {
    const current = await workflowCandidate({
      context,
      github,
      run,
      testedSha: identity.testedSha,
    });
    return current?.external_id === candidate.external_id;
  });
  const ready = await storedExternalId(context, candidate.external_id);
  if (!ready) {
    throw new SecurityError("check_pending", 503, "The signed submit check is unavailable.");
  }
  const bound = await bindWorkflowCheck(context, github, run, ready);
  await inheritVisualPlan(context, github, run, bound);
}

/** A terminal pinned workflow settles only a check started by signed submit. */
export async function settlePreRunWorkflow(
  context: ApiContext,
  github: GitHubClient,
  webhook: VerifiedWebhook,
) {
  const configuration = context.configuration.workflowOwned;
  if (!configuration || webhook.event !== "workflow_run") return;
  if (!["requested", "in_progress", "completed"].includes(String(webhook.payload.action))) return;
  const event = object(webhook.payload.workflow_run);
  if (event.path !== configuration.callerWorkflowPath) return;
  const runId = numericId(event.id);
  const run = object(await github.request(`/repos/${github.repository}/actions/runs/${runId}`));
  if (
    typeof event.run_attempt === "number" &&
    Number.isSafeInteger(event.run_attempt) &&
    typeof run.run_attempt === "number" &&
    event.run_attempt < run.run_attempt
  ) {
    const historical = await completedHistoricalAttempt(github, run, event.run_attempt);
    if (
      historical.head_sha !== event.head_sha ||
      historical.path !== event.path ||
      historical.event !== event.event ||
      (webhook.payload.action === "completed" && historical.conclusion !== event.conclusion)
    ) {
      throw new SecurityError("workflow_identity", 503, "The prior workflow result changed.");
    }
    return "historical" as const;
  }
  if (
    numericId(run.id) !== runId ||
    typeof run.run_attempt !== "number" ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt < 1 ||
    run.run_attempt !== event.run_attempt ||
    run.head_sha !== event.head_sha ||
    run.path !== event.path ||
    run.event !== event.event ||
    run.path !== configuration.callerWorkflowPath ||
    numericId(object(run.repository).id) !== github.repositoryId ||
    (webhook.payload.action === "completed" &&
      (run.status !== "completed" || run.conclusion !== event.conclusion))
  ) {
    throw new SecurityError(
      "workflow_identity",
      503,
      "The pinned workflow identity is unavailable.",
    );
  }
  if (run.event === "workflow_dispatch") {
    const candidate = await mainWorkflowCandidate(context, github, runId, Number(run.run_attempt));
    if (!candidate) {
      throw new SecurityError(
        "workflow_candidate",
        503,
        "The signed main dispatch candidate is unavailable.",
      );
    }
    await recordPreRunCandidate(context, github, candidate);
  }
  let candidate: PreRunCheck | null;
  try {
    candidate = await workflowCandidate({
      context,
      github,
      run,
      allowTerminalSingleCandidate: webhook.payload.action === "completed",
    });
  } catch (error) {
    const historical = { context, github, run, action: String(webhook.payload.action) };
    if (
      !(error instanceof SecurityError) ||
      error.code !== "workflow_candidate" ||
      (!(await retireSupersededMainAttempt(historical)) &&
        !(await retireSupersededPullRequestAttempt(historical)) &&
        !(await retireUnboundTerminalPullRequestAttempt(context, github, run)))
    ) {
      throw error;
    }
    return "historical" as const;
  }
  if (!candidate || candidate.docs_only) return;
  if (
    candidate.state === "docs_complete" &&
    candidate.workflow_run_id === runId &&
    candidate.workflow_attempt === run.run_attempt
  )
    return;
  if (!candidate.check_id) return;
  if (!(await attemptCheck(context, runId, run.run_attempt))) {
    // A carried Gate job does not start a new visual attempt. Only an actual
    // signed Plan report or Submit can supersede the earlier visual check.
    if (candidate.workflow_run_id !== null) return;
    const unbound = await verifiedCheck(github, candidate, candidate.check_id);
    if (unbound.status === "completed") return;
  }
  let row = await bindWorkflowCheck(context, github, run, candidate);
  await inheritVisualPlan(context, github, run, row);
  row = (await attemptCheck(context, runId, Number(run.run_attempt))) ?? row;
  if (webhook.payload.action !== "completed" || row.state === "docs_complete") return;
  if (row.state === "failed") return;
  const materialized = await context.database
    .prepare(
      "SELECT 1 AS found FROM visonaut_runs WHERE project_id=? AND external_run_id=? AND attempt=? AND tested_sha=?",
    )
    .bind(context.configuration.projectId, runId, run.run_attempt, row.tested_sha)
    .first();
  if (materialized) return;
  if (row.state !== "active" || !row.check_id) {
    throw new SecurityError("pre_run_check", 503, "The candidate App check is not ready.");
  }
  const check = await verifiedCheck(github, row, row.check_id);
  if (check.status === "completed" && check.conclusion === "failure") {
    await context.database
      .prepare(
        "UPDATE pre_run_checks SET state='failed',updated_at=? WHERE external_id=? AND state='active'",
      )
      .bind(Date.now(), row.external_id)
      .run();
    return;
  }
  if (check.status !== "in_progress" && check.status !== "queued") {
    throw new SecurityError("pre_run_check", 409, "The current attempt check is already complete.");
  }
  // A signed submit stays eligible while Gate waits for review, even if Gate
  // makes the enclosing workflow fail before reconciliation finishes.
  const submitted = await successfulSubmittedPinnedJobs(context, github, run, row);
  if (submitted.successful && row.plan_visual_required === 1) return;
  const reason =
    row.plan_visual_required === null
      ? "The trusted Plan or signed Submit is missing. Missing Plan never means no visual work."
      : submitted.submitted
        ? "A pinned capture or submit job did not complete successfully."
        : run.conclusion === "success"
          ? "The capture workflow finished without a signed Visonaut submit job."
          : `The pinned capture workflow ended with ${String(run.conclusion)}.`;
  await github.request(`/repos/${github.repository}/check-runs/${row.check_id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "completed",
      conclusion: "failure",
      completed_at: new Date().toISOString(),
      output: { title: "Visual capture did not complete", summary: reason },
    }),
  });
  await context.database
    .prepare(
      "UPDATE pre_run_checks SET state='failed',updated_at=? WHERE external_id=? AND state='active' AND check_id=?",
    )
    .bind(Date.now(), row.external_id, row.check_id)
    .run();
}
