import {
  createGitHubClient,
  numericId,
  SecurityError,
  verifyGitHubOidc,
  type GitHubClient,
  type VerifiedWebhook,
} from "@visonaut/security";
import { assertConfiguredProject, loadVerifiedMergeGroup, type ApiContext } from "./context.js";
import { integer, jsonBody, object, string } from "./input.js";
import { jobExecutedInAttempt } from "./jobs.js";
import { ensureSignedAttemptCheck } from "./pre-run-attempts.js";
import { candidateForWebhook } from "./pre-run-candidates.js";
import { attemptCheck, storeCandidateCheck, type Candidate } from "./pre-run-checks.js";
import { completeNoVisualPlan, nativePlanJob } from "./pre-run-plan.js";
import { readRestoreCutoff } from "../operations/recovery.ts";

export { ensureSignedAttemptCheck, settlePreRunWorkflow } from "./pre-run-attempts.js";
export { candidateForWebhook } from "./pre-run-candidates.js";
export {
  findPreRunCheck,
  reconcileEquivalentPullRequestChecks,
  recordPreRunCandidate,
} from "./pre-run-checks.js";
export { recordRequiredVisualPlan, requireVisualPlan } from "./pre-run-plan.js";

/** Keep this path for checks created after a signed submit is verified. */
export async function ensurePreRunCheck(
  context: ApiContext,
  github: GitHubClient,
  candidate: Candidate,
  webhook: VerifiedWebhook,
  currentCandidate: () => Promise<Candidate | null> = () => candidateForWebhook(github, webhook),
) {
  await storeCandidateCheck({
    context,
    github,
    candidate,
    currentCandidate,
    validateBeforeCreation: false,
    createCheck: true,
  });
}

/** Native Plan submits only an explicit false after its calculator succeeds. */
export async function reportVisualPlan(request: Request, context: ApiContext) {
  await assertConfiguredProject(context);
  const configuration = context.configuration.workflowOwned;
  if (!configuration)
    throw new SecurityError("workflow_configuration", 503, "The trusted workflow is unavailable.");
  const body = await jsonBody(request, 16_384);
  if (body.schemaVersion !== 1 || body.planResult !== "success" || body.visualRequired !== false) {
    throw new SecurityError(
      "invalid_plan_report",
      400,
      "A successful, explicit Plan result is required.",
    );
  }
  const testedSha = string(body.testedSha, 40);
  if (!/^[a-f0-9]{40}$/.test(testedSha))
    throw new SecurityError("invalid_plan_report", 400, "A full tested commit is required.");
  const workflowRunId = numericId(body.workflowRunId);
  const workflowAttempt = integer(body.workflowAttempt, 1);
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer "))
    throw new SecurityError("invalid_oidc", 401, "A signed Plan report is required.");
  const github = await createGitHubClient(context.configuration.github);
  const identity = await verifyGitHubOidc({
    token: header.slice(7),
    github,
    request: {
      repository: github.repository,
      repositoryId: github.repositoryId,
      workflowRunId,
      workflowAttempt,
      testedSha,
      shardKey: "plan-report",
    },
    configuration: {
      audience: `${context.configuration.origin}/plan-report`,
      issuedAfter: await readRestoreCutoff(context.database),
      repositoryOwnerId: context.configuration.repositoryOwnerId,
      workflowPath: configuration.callerWorkflowPath,
      shards: [{ key: "plan-report", jobName: "Plan" }],
      loadMergeGroup: (commit) => loadVerifiedMergeGroup(context, commit),
    },
  });
  const plan = await nativePlanJob(github, identity);
  const run = object(
    await github.request(
      `/repos/${github.repository}/actions/runs/${workflowRunId}/attempts/${workflowAttempt}`,
    ),
  );
  if (
    numericId(plan.id) !== identity.jobId ||
    plan.run_attempt !== workflowAttempt ||
    !(
      (plan.status === "in_progress" && plan.conclusion === null) ||
      (plan.status === "completed" && plan.conclusion === "success")
    ) ||
    !jobExecutedInAttempt(plan, run.run_started_at)
  ) {
    throw new SecurityError("plan_unverified", 409, "The current Plan job did not succeed.");
  }
  const existing = await attemptCheck(context, workflowRunId, workflowAttempt);
  if (existing?.plan_visual_required !== null && existing?.plan_visual_required !== undefined) {
    if (
      existing.tested_sha !== testedSha ||
      existing.plan_visual_required !== Number(body.visualRequired)
    ) {
      throw new SecurityError(
        "plan_conflict",
        409,
        "This attempt already has a different Plan result.",
      );
    }
    await completeNoVisualPlan(context, github, existing);
    return new Response(null, { status: 204 });
  }
  await ensureSignedAttemptCheck(context, github, identity);
  const row = await attemptCheck(context, workflowRunId, workflowAttempt);
  if (row?.plan_visual_required === 0) {
    await completeNoVisualPlan(context, github, row);
    return new Response(null, { status: 204 });
  }
  if (!row?.check_id || row.state !== "active")
    throw new SecurityError("check_pending", 503, "The current App check is not ready.");
  const recorded = await context.database
    .prepare(`UPDATE pre_run_checks SET plan_visual_required=?,plan_reported_at=?,updated_at=?,plan_job_id=?
    WHERE external_id=? AND state='active' AND (plan_visual_required IS NULL OR plan_visual_required=?) RETURNING external_id`)
    .bind(
      Number(body.visualRequired),
      Date.now(),
      Date.now(),
      numericId(plan.id),
      row.external_id,
      Number(body.visualRequired),
    )
    .first();
  if (!recorded)
    throw new SecurityError("plan_conflict", 409, "The Plan result changed during verification.");
  await completeNoVisualPlan(context, github, row);
  return new Response(null, { status: 204 });
}
