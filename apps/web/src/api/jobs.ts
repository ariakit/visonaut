import type { TrustedPlan } from "@ariviso/protocol";
import { type GitHubClient, SecurityError, type VerifiedRun } from "@ariviso/security";
import { IncompleteError } from "@ariviso/service";
import type { ApiContext } from "./context.js";
import { object } from "./input.js";

export async function workflowJobs(github: GitHubClient, externalRunId: string, attempt?: number) {
  const jobs: Record<string, unknown>[] = [];
  const suffix = attempt === undefined ? "jobs?filter=latest&" : `attempts/${attempt}/jobs?`;
  for (let page = 1; page <= 20; page += 1) {
    const response = object(
      await github.request(
        `/repos/${github.repository}/actions/runs/${externalRunId}/${suffix}per_page=100&page=${page}`,
      ),
    );
    if (!Array.isArray(response.jobs))
      throw new SecurityError("invalid_jobs", 503, "GitHub capture job metadata is unavailable.");
    jobs.push(...response.jobs.map(object));
    if (response.jobs.length < 100) return jobs;
  }
  throw new SecurityError(
    "jobs_limit",
    503,
    "GitHub capture job reconciliation exceeded its limit.",
  );
}

export async function inheritedShards(
  context: ApiContext,
  github: GitHubClient,
  verified: VerifiedRun,
  plan: TrustedPlan,
) {
  const rerunShardKeys = plan.shards.map((shard) => shard.key);
  if (verified.workflowAttempt === 1) return { rerunShardKeys };
  const jobs = await workflowJobs(github, verified.workflowRunId);
  const inherited: Array<{ key: string; jobId: string }> = [];
  for (const shard of plan.shards) {
    const matching = jobs.filter((job) => job.name === shard.jobName);
    const job = matching[0];
    if (
      matching.length !== 1 ||
      !job ||
      typeof job.run_attempt !== "number" ||
      job.run_attempt > verified.workflowAttempt
    ) {
      throw new IncompleteError(
        "The complete rerun job matrix is unavailable. Retry after GitHub schedules every job.",
      );
    }
    if (
      shard.key === verified.shardKey &&
      (job.run_attempt !== verified.workflowAttempt || String(job.id) !== verified.jobId)
    ) {
      throw new IncompleteError("The signed job is not the current rerun job.");
    }
    if (job.run_attempt === verified.workflowAttempt) continue;
    if (job.conclusion !== "success" || job.status !== "completed")
      throw new IncompleteError("Only successful jobs that were not rerun can be inherited.");
    inherited.push({ key: shard.key, jobId: String(job.id) });
  }
  if (!inherited.length) return { rerunShardKeys };
  const source = await context.database
    .prepare(
      "SELECT id FROM ariviso_runs WHERE project_id = ? AND external_run_id = ? AND tested_sha = ? AND plan_digest = ? AND attempt < ? ORDER BY attempt DESC LIMIT 1",
    )
    .bind(
      context.configuration.projectId,
      verified.workflowRunId,
      verified.testedSha,
      verified.planDigest,
      verified.workflowAttempt,
    )
    .first<{ id: string }>();
  if (!source)
    throw new IncompleteError(
      "The successful earlier shard evidence is unavailable. Rerun the full workflow.",
    );
  const verifiedInheritedShards = [];
  for (const shard of inherited) {
    const stored = await context.database
      .prepare(
        "SELECT s.manifest_digest, s.full_profile_digest FROM ariviso_shards s WHERE s.run_id = ? AND s.key = ? AND s.state = 'complete' AND EXISTS (SELECT 1 FROM ingest_manifests m JOIN ariviso_runs r ON r.id = m.run_id WHERE m.shard_key = s.key AND m.digest = s.manifest_digest AND m.job_id = ? AND m.finalized = 1 AND r.project_id = ? AND r.external_run_id = ? AND r.tested_sha = ? AND r.plan_digest = ?)",
      )
      .bind(
        source.id,
        shard.key,
        shard.jobId,
        context.configuration.projectId,
        verified.workflowRunId,
        verified.testedSha,
        verified.planDigest,
      )
      .first<{ manifest_digest: string; full_profile_digest: string }>();
    if (!stored?.full_profile_digest)
      throw new IncompleteError(
        "The successful earlier shard must finish verification before this rerun can start.",
      );
    verifiedInheritedShards.push({
      key: shard.key,
      manifestDigest: stored.manifest_digest,
      captureProfileDigest: stored.full_profile_digest,
    });
  }
  return {
    rerunShardKeys: rerunShardKeys.filter((key) => !inherited.some((shard) => shard.key === key)),
    inheritFromRunId: source.id,
    verifiedInheritedShards,
  };
}
