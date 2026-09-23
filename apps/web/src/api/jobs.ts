import { digestJson, plannedJobName, type TrustedPlan } from "@visonaut/protocol";
import { type GitHubClient, SecurityError, type VerifiedRun } from "@visonaut/security";
import { IncompleteError } from "@visonaut/service";
import type { ApiContext } from "./context.js";
import { object } from "./input.js";

type RunIdentity = Pick<
  VerifiedRun,
  "workflowRunId" | "workflowAttempt" | "testedSha" | "planDigest" | "sourceHead"
>;

function timestamp(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  if (new Date(parsed).toISOString() !== normalized) return null;
  return parsed;
}

export async function workflowAttempt(
  github: GitHubClient,
  identity: RunIdentity,
  historical = false,
) {
  const suffix = historical ? `/attempts/${identity.workflowAttempt}` : "";
  const metadata = object(
    await github.request(
      `/repos/${github.repository}/actions/runs/${identity.workflowRunId}${suffix}`,
    ),
  );
  if (
    !Number.isSafeInteger(metadata.id) ||
    String(metadata.id) !== identity.workflowRunId ||
    metadata.run_attempt !== identity.workflowAttempt ||
    metadata.head_sha !== identity.sourceHead
  ) {
    throw new IncompleteError(
      "The workflow attempt or source head changed. Start a new capture attempt.",
    );
  }
  return metadata;
}

export async function workflowJobs(github: GitHubClient, externalRunId: string, attempt?: number) {
  const jobs: Record<string, unknown>[] = [];
  const suffix = attempt === undefined ? "jobs?filter=latest&" : `attempts/${attempt}/jobs?`;
  for (let page = 1; page <= 20; page += 1) {
    const response = object(
      await github.request(
        `/repos/${github.repository}/actions/runs/${externalRunId}/${suffix}per_page=100&page=${page}`,
      ),
    );
    if (!Array.isArray(response.jobs)) {
      throw new SecurityError("invalid_jobs", 503, "GitHub capture job metadata is unavailable.");
    }
    jobs.push(...response.jobs.map(object));
    if (response.jobs.length < 100) return jobs;
  }
  throw new SecurityError(
    "jobs_limit",
    503,
    "GitHub capture job reconciliation exceeded its limit.",
  );
}

function execution(job: Record<string, unknown>) {
  const started = timestamp(job.started_at);
  const completed = timestamp(job.completed_at);
  if (
    job.status !== "completed" ||
    job.conclusion !== "success" ||
    started === null ||
    completed === null ||
    completed < started ||
    !Number.isSafeInteger(job.runner_id) ||
    Number(job.runner_id) <= 0 ||
    typeof job.runner_name !== "string" ||
    !job.runner_name ||
    !Array.isArray(job.labels) ||
    !job.labels.length ||
    job.labels.some((label) => typeof label !== "string" || !label) ||
    !Array.isArray(job.steps) ||
    !job.steps.length
  ) {
    throw new IncompleteError("Complete successful job execution evidence is unavailable.");
  }
  let previousNumber = 0;
  const steps = job.steps.map((value) => {
    const step = object(value);
    const stepStarted = timestamp(step.started_at);
    const stepCompleted = timestamp(step.completed_at);
    const skipped =
      step.conclusion === "skipped" && step.started_at === null && step.completed_at === null;
    if (
      typeof step.name !== "string" ||
      !step.name ||
      step.status !== "completed" ||
      typeof step.conclusion !== "string" ||
      !step.conclusion ||
      !Number.isSafeInteger(step.number) ||
      Number(step.number) <= previousNumber ||
      (!skipped &&
        (stepStarted === null ||
          stepCompleted === null ||
          stepStarted < started ||
          stepCompleted < stepStarted ||
          stepCompleted > completed))
    ) {
      throw new IncompleteError("The job step execution evidence is incomplete.");
    }
    previousNumber = Number(step.number);
    return [
      step.number,
      step.name,
      step.status,
      step.conclusion,
      step.started_at,
      step.completed_at,
    ];
  });
  return {
    started,
    completed,
    facts: JSON.stringify([
      job.started_at,
      job.completed_at,
      job.runner_id,
      job.runner_name,
      job.labels,
      steps,
    ]),
  };
}

interface InheritedShardParams {
  runId: string;
  identity: RunIdentity & Pick<VerifiedRun, "event">;
  shard: TrustedPlan["shards"][number];
  plan: TrustedPlan;
  job: Record<string, unknown>;
  attemptStartedAt: unknown;
}

/** Resolve GitHub's carried-job wrapper to the original verified capture execution. */
export async function verifiedInheritedShard(
  context: ApiContext,
  github: GitHubClient,
  { runId, identity, shard, plan, job, attemptStartedAt }: InheritedShardParams,
) {
  const sources = await context.database
    .prepare(
      "SELECT s.manifest_digest, s.full_profile_digest, m.job_id, r.attempt, original.discovery_json FROM visonaut_shards s JOIN visonaut_runs carrier ON carrier.id=s.run_id JOIN ingest_manifests m ON m.shard_key=s.key AND m.digest=s.manifest_digest AND m.finalized=1 JOIN visonaut_runs r ON r.id=m.run_id JOIN visonaut_shards original ON original.run_id=r.id AND original.key=s.key JOIN ingest_run_provenance provenance ON provenance.run_id=r.id WHERE s.run_id=? AND s.key=? AND s.state='complete' AND s.profile_digest=? AND carrier.project_id=? AND carrier.external_run_id=? AND carrier.tested_sha=? AND carrier.plan_digest=? AND r.project_id=carrier.project_id AND r.external_run_id=carrier.external_run_id AND r.tested_sha=carrier.tested_sha AND r.plan_digest=carrier.plan_digest AND r.attempt=s.source_attempt AND r.attempt<? AND original.state='complete' AND original.manifest_digest=m.digest AND original.full_profile_digest=s.full_profile_digest AND original.profile_digest=s.profile_digest AND json_extract(provenance.verified_json,'$.sourceHead')=? AND json_extract(provenance.verified_json,'$.reusableWorkflowRef')=? AND json_extract(provenance.verified_json,'$.reusableWorkflowSha')=? LIMIT 2",
    )
    .bind(
      runId,
      shard.key,
      await digestJson(shard.environmentProfileDigests),
      context.configuration.projectId,
      identity.workflowRunId,
      identity.testedSha,
      identity.planDigest,
      identity.workflowAttempt,
      identity.sourceHead,
      context.configuration.reusableWorkflowRef,
      context.configuration.reusableWorkflowSha,
    )
    .all<{
      manifest_digest: string;
      full_profile_digest: string;
      job_id: string;
      attempt: number;
      discovery_json: string | null;
    }>();
  const source = sources.results[0];
  if (
    sources.results.length !== 1 ||
    !source ||
    !/^[a-f0-9]{64}$/.test(source.manifest_digest) ||
    !/^[a-f0-9]{64}$/.test(source.full_profile_digest) ||
    !/^[1-9]\d*$/.test(source.job_id)
  ) {
    throw new IncompleteError(
      "One complete earlier shard with its original verified manifest is required.",
    );
  }
  if (plan.discovery) {
    if (!source.discovery_json) {
      throw new IncompleteError("The original independent discovery receipt is unavailable.");
    }
    const proof = object(JSON.parse(source.discovery_json ?? "null"));
    if (
      proof.jobId !== source.job_id ||
      proof.attempt !== source.attempt ||
      proof.externalRunId !== identity.workflowRunId ||
      proof.testedSha !== identity.testedSha ||
      proof.executorDigest !== plan.discovery.executorDigest ||
      proof.configurationDigest !== (await digestJson(shard.collection)) ||
      typeof proof.inventoryDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(proof.inventoryDigest) ||
      typeof proof.verificationDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(proof.verificationDigest)
    ) {
      throw new IncompleteError("The original independent discovery receipt is unavailable.");
    }
  }
  const original = object(
    await github.request(`/repos/${github.repository}/actions/jobs/${source.job_id}`),
  );
  if (
    !Number.isSafeInteger(original.id) ||
    String(original.id) !== source.job_id ||
    original.run_attempt !== source.attempt ||
    !Number.isSafeInteger(job.id) ||
    Number(job.id) <= 0 ||
    typeof job.run_attempt !== "number" ||
    !Number.isSafeInteger(job.run_attempt) ||
    job.run_attempt < source.attempt ||
    job.run_attempt > identity.workflowAttempt ||
    (String(job.id) === source.job_id
      ? job.run_attempt !== source.attempt
      : job.run_attempt <= source.attempt) ||
    [original, job].some(
      (entry) =>
        !Number.isSafeInteger(entry.run_id) ||
        String(entry.run_id) !== identity.workflowRunId ||
        entry.name !== plannedJobName(shard.jobName, identity.event) ||
        entry.head_sha !== identity.sourceHead,
    )
  ) {
    throw new IncompleteError(
      "The inherited job does not identify the original workflow execution.",
    );
  }
  const previous = execution(original);
  const current = execution(job);
  const attemptStarted = timestamp(attemptStartedAt);
  // GitHub issues a new job ID/attempt for a carried success. Only its execution
  // facts may match; wrapper IDs, creation time, URLs, and runner group may change.
  if (
    attemptStarted === null ||
    previous.completed >= attemptStarted ||
    previous.facts !== current.facts
  ) {
    throw new IncompleteError(
      "An inherited job was rerun or its execution proof changed. Run the full capture again.",
    );
  }
  return {
    key: shard.key,
    manifestDigest: source.manifest_digest,
    captureProfileDigest: source.full_profile_digest,
  };
}

export async function inheritedShards(
  context: ApiContext,
  github: GitHubClient,
  verified: VerifiedRun,
  plan: TrustedPlan,
) {
  const rerunShardKeys = plan.shards.map((shard) => shard.key);
  if (verified.workflowAttempt === 1) return { rerunShardKeys };
  const latest = await workflowAttempt(github, verified);
  const metadata = await workflowAttempt(github, verified, true);
  const attemptStarted = timestamp(metadata.run_started_at);
  if (attemptStarted === null) {
    throw new IncompleteError("The current workflow attempt start is unavailable.");
  }
  if (
    [latest, metadata].some(
      (entry) => entry.status === "completed" && entry.conclusion !== "success",
    )
  ) {
    throw new IncompleteError("The current workflow attempt did not succeed.");
  }
  const jobs = await workflowJobs(github, verified.workflowRunId);
  const source = await context.database
    .prepare(
      "SELECT id FROM visonaut_runs WHERE project_id=? AND external_run_id=? AND tested_sha=? AND plan_digest=? AND attempt<? ORDER BY attempt DESC LIMIT 1",
    )
    .bind(
      context.configuration.projectId,
      verified.workflowRunId,
      verified.testedSha,
      verified.planDigest,
      verified.workflowAttempt,
    )
    .first<{ id: string }>();
  const verifiedInheritedShards: Array<Awaited<ReturnType<typeof verifiedInheritedShard>>> = [];
  for (const shard of plan.shards) {
    const matching = jobs.filter(
      (job) => job.name === plannedJobName(shard.jobName, verified.event),
    );
    const job = matching[0];
    if (
      matching.length !== 1 ||
      !job ||
      typeof job.run_attempt !== "number" ||
      !Number.isSafeInteger(job.run_attempt) ||
      job.run_attempt < 1 ||
      job.run_attempt > verified.workflowAttempt
    ) {
      throw new IncompleteError(
        "The complete rerun job matrix is unavailable. Retry after GitHub schedules every job.",
      );
    }
    if (shard.key === verified.shardKey) {
      if (job.run_attempt !== verified.workflowAttempt || String(job.id) !== verified.jobId) {
        throw new IncompleteError("The signed job is not the current rerun job.");
      }
      continue;
    }
    const started = timestamp(job.started_at);
    if (
      job.run_attempt === verified.workflowAttempt &&
      (job.status !== "completed" || (started !== null && started >= attemptStarted))
    )
      continue;
    if (!source) {
      throw new IncompleteError(
        "The successful earlier shard evidence is unavailable. Rerun the full workflow.",
      );
    }
    verifiedInheritedShards.push(
      await verifiedInheritedShard(context, github, {
        runId: source.id,
        identity: verified,
        shard,
        plan,
        job,
        attemptStartedAt: metadata.run_started_at,
      }),
    );
  }
  const current = await workflowAttempt(github, verified);
  if (current.status === "completed" && current.conclusion !== "success") {
    throw new IncompleteError("The workflow attempt changed during inheritance verification.");
  }
  if (!verifiedInheritedShards.length || !source) return { rerunShardKeys };
  return {
    rerunShardKeys: rerunShardKeys.filter(
      (key) => !verifiedInheritedShards.some((shard) => shard.key === key),
    ),
    inheritFromRunId: source.id,
    verifiedInheritedShards,
  };
}
