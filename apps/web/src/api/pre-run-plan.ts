import { numericId, SecurityError, type GitHubClient, type VerifiedRun } from "@visonaut/security";
import type { ApiContext } from "./context.js";
import { object } from "./input.js";
import { completeWorkflowJobs, jobExecutedInAttempt, verifyCarriedExecution } from "./jobs.js";
import { completedHistoricalAttempt } from "./pre-run-candidates.js";
import {
  attemptCheck,
  storedCheck,
  storedExternalId,
  verifiedCheck,
  type PreRunCheck,
} from "./pre-run-checks.js";
import { afterRestoreSql } from "../operations/recovery.ts";

/** Capture admission and materialization require the current explicit Plan=true proof. */
export async function requireVisualPlan(
  context: ApiContext,
  identity: { testedSha: string; workflowRunId: string; workflowAttempt: number },
) {
  const row = await attemptCheck(context, identity.workflowRunId, identity.workflowAttempt);
  if (
    !row ||
    row.tested_sha !== identity.testedSha ||
    row.plan_visual_required !== 1 ||
    row.plan_workflow_sha !== context.configuration.workflowOwned?.callerWorkflowBlobSha ||
    row.state !== "active"
  ) {
    throw new SecurityError(
      "plan_unverified",
      409,
      "The current trusted Plan must select app=true.",
    );
  }
}

export function callerPlanBlob(context: ApiContext) {
  const pin = context.configuration.workflowOwned?.callerWorkflowBlobSha;
  if (!pin || !/^[a-f0-9]{40}$/.test(pin)) {
    throw new SecurityError(
      "workflow_configuration",
      503,
      "The trusted Plan source is unavailable.",
    );
  }
  return pin;
}

function successfulPlanStep(plan: Record<string, unknown>) {
  const steps = Array.isArray(plan.steps)
    ? plan.steps.map(object).filter((step) => step.name === "Plan CI")
    : [];
  const step = steps[0];
  return steps.length === 1 && step?.status === "completed" && step.conclusion === "success";
}

export async function nativePlanJob(
  github: GitHubClient,
  identity: Pick<VerifiedRun, "workflowRunId" | "workflowAttempt" | "sourceHead">,
) {
  const jobs = await completeWorkflowJobs(github, identity.workflowRunId, identity.workflowAttempt);
  const plans = jobs.filter((job) => job.name === "Plan");
  const plan = plans[0];
  if (
    plans.length !== 1 ||
    !plan ||
    !Number.isSafeInteger(plan.run_id) ||
    String(plan.run_id) !== identity.workflowRunId ||
    plan.head_sha !== identity.sourceHead ||
    !Number.isSafeInteger(plan.run_attempt) ||
    Number(plan.run_attempt) < 1 ||
    Number(plan.run_attempt) > identity.workflowAttempt ||
    !successfulPlanStep(plan)
  ) {
    throw new SecurityError(
      "plan_unverified",
      409,
      "The trusted Plan calculation did not succeed.",
    );
  }
  return plan;
}

/** Signed Submit proves the true branch of the pinned caller after Plan succeeds. */
export async function recordRequiredVisualPlan(
  context: ApiContext,
  github: GitHubClient,
  identity: VerifiedRun,
) {
  const pin = callerPlanBlob(context);
  const row = await attemptCheck(context, identity.workflowRunId, identity.workflowAttempt);
  if (
    !row ||
    row.tested_sha !== identity.testedSha ||
    row.state !== "active" ||
    row.plan_visual_required === 0
  ) {
    throw new SecurityError(
      "plan_unverified",
      409,
      "The current attempt cannot require visual work.",
    );
  }
  if (row.plan_visual_required === 1 && row.plan_workflow_sha === pin && row.plan_job_id) return;
  const plan = await nativePlanJob(github, identity);
  if (plan.status !== "completed" || plan.conclusion !== "success") {
    throw new SecurityError("plan_unverified", 409, "The native Plan job did not succeed.");
  }
  const run = object(
    await github.request(
      `/repos/${github.repository}/actions/runs/${identity.workflowRunId}/attempts/${identity.workflowAttempt}`,
    ),
  );
  let originalId = numericId(plan.id);
  if (jobExecutedInAttempt(plan, run.run_started_at)) {
    if (plan.run_attempt !== identity.workflowAttempt) {
      throw new SecurityError("plan_unverified", 409, "The Plan execution has another attempt.");
    }
  } else {
    // Capture can fail before Submit. Attempt start times locate its original
    // Plan without an earlier signed row; full execution proof below rejects
    // changed wrappers, whose attempt number can identify a later rerun.
    let first = 1;
    let last = identity.workflowAttempt - 1;
    let sourceAttempt = 0;
    while (first <= last) {
      const attempt = first + Math.floor((last - first) / 2);
      const sourceRun = await completedHistoricalAttempt(github, run, attempt);
      if (jobExecutedInAttempt(plan, sourceRun.run_started_at)) {
        sourceAttempt = attempt;
        first = attempt + 1;
      } else {
        last = attempt - 1;
      }
    }
    if (!sourceAttempt) {
      throw new SecurityError(
        "plan_unverified",
        409,
        "The original Plan execution is unavailable.",
      );
    }
    const source = await nativePlanJob(github, { ...identity, workflowAttempt: sourceAttempt });
    originalId = numericId(source.id);
    await verifyCarriedExecution(github, originalId, plan, {
      workflowRunId: identity.workflowRunId,
      workflowAttempt: identity.workflowAttempt,
      sourceAttempt,
      sourceHead: identity.sourceHead,
      jobName: "Plan",
      attemptStartedAt: run.run_started_at,
    });
  }
  const recorded = await context.database
    .prepare(
      `UPDATE pre_run_checks SET plan_visual_required=1,plan_reported_at=?,updated_at=?,plan_job_id=?,plan_workflow_sha=?
    WHERE external_id=? AND state='active' AND plan_visual_required IS NULL RETURNING external_id`,
    )
    .bind(Date.now(), Date.now(), originalId, pin, row.external_id)
    .first();
  if (!recorded) {
    throw new SecurityError("plan_conflict", 409, "The current Plan result changed.");
  }
}

export async function completeNoVisualPlan(
  context: ApiContext,
  github: GitHubClient,
  row: PreRunCheck,
) {
  const current = await storedExternalId(context, row.external_id);
  if (!current || current.plan_visual_required !== 0 || !current.check_id) return;
  if (current.plan_workflow_sha !== callerPlanBlob(context)) return;
  if (current.state === "docs_complete") return;
  await verifiedCheck(github, row, current.check_id);
  const latest = await storedCheck(context, row.tested_sha);
  if (latest?.external_id !== row.external_id)
    throw new SecurityError("stale_plan", 409, "A newer attempt supersedes this Plan.");
  await github.request(`/repos/${github.repository}/check-runs/${current.check_id}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "completed",
      conclusion: "success",
      completed_at: new Date().toISOString(),
      output: {
        title: "Visual capture is not required",
        summary: "The successful trusted Plan selected app=false for this attempt.",
      },
    }),
  });
  await context.database
    .prepare(
      "UPDATE pre_run_checks SET state='docs_complete',updated_at=? WHERE external_id=? AND state='active' AND plan_visual_required=0",
    )
    .bind(Date.now(), row.external_id)
    .run();
}

/** A carried Plan must retain the execution already authenticated by a signed report. */
export async function inheritVisualPlan(
  context: ApiContext,
  github: GitHubClient,
  run: Record<string, unknown>,
  row: PreRunCheck,
) {
  if (
    row.plan_visual_required !== null ||
    !row.workflow_run_id ||
    !row.workflow_attempt ||
    row.workflow_attempt < 2
  )
    return;
  const configuration = context.configuration.workflowOwned;
  if (!configuration) return;
  const prior = await context.database
    .prepare(`SELECT * FROM pre_run_checks WHERE tested_sha=? AND workflow_run_id=?
    AND ${afterRestoreSql("pre_run_checks.created_at")}
    AND workflow_attempt<? AND plan_visual_required IS NOT NULL AND plan_job_id IS NOT NULL AND plan_workflow_sha=?
    ORDER BY workflow_attempt DESC LIMIT 1`)
    .bind(row.tested_sha, row.workflow_run_id, row.workflow_attempt, callerPlanBlob(context))
    .first<PreRunCheck>();
  if (
    !prior ||
    !prior.plan_job_id ||
    prior.source_sha !== row.source_sha ||
    run.head_sha !== row.source_sha
  )
    return;
  const jobs = await completeWorkflowJobs(github, row.workflow_run_id, row.workflow_attempt);
  const plans = jobs.filter((job) => job.name === "Plan");
  const plan = plans[0];
  if (plans.length !== 1 || !plan || plan.status !== "completed" || plan.conclusion !== "success")
    return;
  if (jobExecutedInAttempt(plan, run.run_started_at)) return;
  const source = object(
    await github.request(`/repos/${github.repository}/actions/jobs/${prior.plan_job_id}`),
  );
  if (
    typeof source.run_attempt !== "number" ||
    !Number.isSafeInteger(source.run_attempt) ||
    source.run_attempt < 1 ||
    source.run_attempt > Number(prior.workflow_attempt)
  )
    return;
  await verifyCarriedExecution(github, prior.plan_job_id, plan, {
    workflowRunId: row.workflow_run_id,
    workflowAttempt: row.workflow_attempt,
    sourceAttempt: source.run_attempt,
    sourceHead: row.source_sha,
    jobName: "Plan",
    attemptStartedAt: run.run_started_at,
  });
  const inherited = await context.database
    .prepare(`UPDATE pre_run_checks SET plan_visual_required=?,plan_reported_at=?,plan_job_id=?,plan_workflow_sha=?
    WHERE external_id=? AND state='active' AND plan_visual_required IS NULL RETURNING external_id`)
    .bind(
      prior.plan_visual_required,
      Date.now(),
      prior.plan_job_id,
      prior.plan_workflow_sha,
      row.external_id,
    )
    .first();
  if (inherited && prior.plan_visual_required === 0)
    await completeNoVisualPlan(context, github, row);
}
