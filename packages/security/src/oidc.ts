import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { numericId, record, SecurityError, textField } from "./errors.js";
import type { GitHubClient } from "./github.js";

export interface TrustedShardIdentity {
  key: string;
  jobName: string;
}

export interface MergeGroupIdentity {
  repositoryId: string;
  headSha: string;
  headRef: string;
  baseSha: string;
  baseRef: string;
}

export interface OidcConfiguration {
  audience: string;
  /** Preview diagnostics only; still requires main and the immutable executor. */
  allowMainDispatch?: boolean;
  repositoryOwnerId: string;
  workflowPath: string;
  reusableWorkflowRef: string;
  reusableWorkflowSha: string;
  /** Approved Git blob for direct jobs in this repository's app workflow. */
  trustedWorkflowPath?: string;
  planDigest: string;
  shards: readonly TrustedShardIdentity[];
  /** Read only records stored after successful webhook signature verification. */
  loadMergeGroup: (testedSha: string) => Promise<MergeGroupIdentity | null>;
}

export interface RunReservation {
  repository: string;
  repositoryId: string;
  workflowRunId: string;
  workflowAttempt: number;
  testedSha: string;
  planDigest: string;
  shardKey: string;
}

export interface VerifiedRun extends RunReservation {
  jobId: string;
  checkRunId: string;
  event: "push" | "pull_request" | "merge_group" | "workflow_dispatch";
  ref: string;
  sourceHead: string;
  targetHead: string;
  pullRequestNumber?: number;
  mergeGroup?: MergeGroupIdentity;
}

function requireEqual(actual: unknown, expected: unknown, check: string): void {
  if (actual !== expected) {
    // Fixed check names make production denials actionable without recording identity tokens.
    console.warn(JSON.stringify({ event: "oidc_rejected", check }));
    throw new SecurityError(
      "untrusted_run",
      403,
      "The workflow does not match the trusted capture plan.",
    );
  }
}

function sha(value: unknown): string {
  const result = textField(value);
  if (!/^[a-f0-9]{40}$/.test(result)) {
    throw new SecurityError("untrusted_run", 403, "A full tested commit is required.");
  }
  return result;
}

function attemptNumber(value: unknown): number {
  const result = Number(numericId(value));
  if (!Number.isSafeInteger(result)) {
    throw new SecurityError("untrusted_run", 403, "The workflow attempt is invalid.");
  }
  return result;
}

interface VerifyGitHubOidcParams {
  token: string;
  request: RunReservation;
  configuration: OidcConfiguration;
  github: GitHubClient;
  /** Supply a local JWKS only in cryptographic tests. Production uses GitHub. */
  keySet?: JWTVerifyGetKey;
}

export async function verifyGitHubOidc({
  token,
  request,
  configuration,
  github,
  keySet,
}: VerifyGitHubOidcParams): Promise<VerifiedRun> {
  let claims;
  try {
    const keys =
      keySet ??
      createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"), {
        timeoutDuration: 10_000,
      });
    const result = await jwtVerify(token, keys, {
      issuer: "https://token.actions.githubusercontent.com",
      audience: configuration.audience,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "exp", "iat", "nbf", "jti"],
      maxTokenAge: "10m",
    });
    claims = result.payload;
  } catch {
    throw new SecurityError(
      "invalid_oidc",
      401,
      "The GitHub identity token is invalid or expired.",
    );
  }
  requireEqual(numericId(claims.repository_id), github.repositoryId, "claim.repository_id");
  requireEqual(claims.repository, github.repository, "claim.repository");
  requireEqual(
    numericId(claims.repository_owner_id),
    configuration.repositoryOwnerId,
    "claim.repository_owner_id",
  );
  if (configuration.trustedWorkflowPath) {
    const source = configuration.trustedWorkflowPath;
    const claimedSource = claims.job_workflow_sha;
    requireEqual(sha(claimedSource), sha(claims.sha), "claim.direct_workflow_sha");
    if (!String(claims.job_workflow_ref ?? "").startsWith(`${github.repository}/${source}@`)) {
      throw new SecurityError("untrusted_run", 403, "The workflow source is not trusted.");
    }
    const file = record(
      await github.request(`/repos/${github.repository}/contents/${source}?ref=${claimedSource}`),
    );
    requireEqual(file.type, "file", "rest.direct_workflow_type");
    requireEqual(file.path, source, "rest.direct_workflow_path");
    requireEqual(file.sha, configuration.reusableWorkflowSha, "rest.direct_workflow_blob");
  } else {
    requireEqual(
      claims.job_workflow_ref,
      configuration.reusableWorkflowRef,
      "claim.job_workflow_ref",
    );
    requireEqual(
      claims.job_workflow_sha,
      configuration.reusableWorkflowSha,
      "claim.job_workflow_sha",
    );
  }
  requireEqual(request.repositoryId, github.repositoryId, "request.repository_id");
  requireEqual(request.repository, github.repository, "request.repository");
  requireEqual(request.planDigest, configuration.planDigest, "request.plan_digest");
  requireEqual(numericId(claims.run_id), request.workflowRunId, "claim.run_id");
  requireEqual(attemptNumber(claims.run_attempt), request.workflowAttempt, "claim.run_attempt");
  requireEqual(sha(claims.sha), sha(request.testedSha), "claim.sha");
  const ref = textField(claims.ref);
  const event = claims.event_name;
  if (
    event !== "push" &&
    event !== "pull_request" &&
    event !== "merge_group" &&
    !(event === "workflow_dispatch" && configuration.allowMainDispatch)
  ) {
    throw new SecurityError("unsupported_event", 403, "This workflow event is not supported.");
  }
  requireEqual(
    claims.workflow_ref,
    `${github.repository}/${configuration.workflowPath}@${ref}`,
    "claim.workflow_ref",
  );
  const [owner, repository] = github.repository.split("/");
  const subjectSuffix = event === "pull_request" ? "pull_request" : `ref:${ref}`;
  const legacySubject = `repo:${github.repository}:${subjectSuffix}`;
  const immutableSubject = `repo:${owner}@${configuration.repositoryOwnerId}/${repository}@${github.repositoryId}:${subjectSuffix}`;
  if (claims.sub !== legacySubject && claims.sub !== immutableSubject) {
    throw new SecurityError("untrusted_subject", 403, "This workflow subject is not allowed.");
  }
  const shard = configuration.shards.find((entry) => entry.key === request.shardKey);
  if (!shard) {
    throw new SecurityError("unknown_shard", 403, "The shard is not in the trusted capture plan.");
  }
  const root = `/repos/${github.repository}`;
  const current = record(await github.request(`${root}/actions/runs/${request.workflowRunId}`));
  requireEqual(attemptNumber(current.run_attempt), request.workflowAttempt, "rest.current_attempt");
  const run = record(
    await github.request(
      `${root}/actions/runs/${request.workflowRunId}/attempts/${request.workflowAttempt}`,
    ),
  );
  requireEqual(numericId(run.id), request.workflowRunId, "rest.run_id");
  requireEqual(attemptNumber(run.run_attempt), request.workflowAttempt, "rest.run_attempt");
  requireEqual(numericId(record(run.repository).id), github.repositoryId, "rest.repository_id");
  requireEqual(
    numericId(record(record(run.repository).owner).id),
    configuration.repositoryOwnerId,
    "rest.repository_owner_id",
  );
  requireEqual(run.event, event, "rest.event");
  requireEqual(run.path, configuration.workflowPath, "rest.workflow_path");
  if (run.status !== "in_progress" && run.conclusion !== "success") {
    throw new SecurityError(
      "inactive_run",
      409,
      "The workflow attempt is not active or successful.",
    );
  }
  const checkRunId = numericId(claims.check_run_id);
  const job = await findSignedJob(github, request, checkRunId);
  requireEqual(job.name, shard.jobName, "rest.job_name");
  requireEqual(attemptNumber(job.run_attempt), request.workflowAttempt, "rest.job_attempt");
  requireEqual(numericId(job.run_id), request.workflowRunId, "rest.job_run_id");
  if (job.status !== "in_progress" && job.conclusion !== "success") {
    throw new SecurityError("inactive_job", 409, "The capture job is not active or successful.");
  }
  const base = { ...request, jobId: numericId(job.id), checkRunId, event, ref };
  if (event === "push" || event === "workflow_dispatch") {
    requireEqual(ref, "refs/heads/main", "main.ref");
    requireEqual(run.head_sha, request.testedSha, "main.tested_sha");
    requireEqual(run.head_branch, "main", "main.branch");
    return { ...base, event, sourceHead: request.testedSha, targetHead: request.testedSha };
  }
  if (event === "pull_request") {
    const match = /^refs\/pull\/([1-9]\d*)\/merge$/.exec(ref);
    const number = match?.[1];
    if (!number) {
      throw new SecurityError("untrusted_ref", 403, "The pull request merge ref is required.");
    }
    const pull = record(await github.request(`${root}/pulls/${number}`));
    const head = record(pull.head);
    const target = record(pull.base);
    requireEqual(pull.state, "open", "pull.state");
    requireEqual(target.ref, "main", "pull.base_ref");
    requireEqual(numericId(record(head.repo).id), github.repositoryId, "pull.head_repository_id");
    requireEqual(numericId(record(target.repo).id), github.repositoryId, "pull.base_repository_id");
    requireEqual(pull.merge_commit_sha, request.testedSha, "pull.merge_sha");
    requireEqual(claims.head_ref, head.ref, "pull.head_ref_claim");
    requireEqual(claims.base_ref, "main", "pull.base_ref_claim");
    requireEqual(run.head_sha, head.sha, "pull.workflow_head_sha");
    const sourceHead = sha(head.sha);
    const mainRef = record(await github.request(`${root}/git/ref/heads/main`));
    const targetHead = sha(record(mainRef.object).sha);
    const commit = record(await github.request(`${root}/git/commits/${request.testedSha}`));
    const parents = Array.isArray(commit.parents)
      ? commit.parents.map((parent) => sha(record(parent).sha))
      : [];
    requireEqual(parents.length, 2, "pull.parent_count");
    requireEqual(parents[0], targetHead, "pull.base_parent");
    requireEqual(parents[1], sourceHead, "pull.head_parent");
    return { ...base, event, sourceHead, targetHead, pullRequestNumber: Number(number) };
  }
  if (!ref.startsWith("refs/heads/gh-readonly-queue/main/")) {
    throw new SecurityError("untrusted_ref", 403, "The merge queue must target main.");
  }
  const mergeGroup = await configuration.loadMergeGroup(request.testedSha);
  if (!mergeGroup) {
    throw new SecurityError(
      "missing_merge_group",
      409,
      "Verified merge-group metadata is not available yet.",
    );
  }
  requireEqual(mergeGroup.repositoryId, github.repositoryId, "merge.repository_id");
  requireEqual(mergeGroup.headSha, request.testedSha, "merge.head_sha");
  requireEqual(mergeGroup.headRef, ref, "merge.head_ref");
  requireEqual(mergeGroup.baseRef, "refs/heads/main", "merge.base_ref");
  requireEqual(run.head_sha, request.testedSha, "merge.workflow_head_sha");
  const queueRef = record(await github.request(`${root}/git/ref/${ref.slice("refs/".length)}`));
  requireEqual(record(queueRef.object).sha, request.testedSha, "merge.current_ref_sha");
  return {
    ...base,
    event,
    sourceHead: request.testedSha,
    targetHead: sha(mergeGroup.baseSha),
    mergeGroup,
  };
}

async function findSignedJob(github: GitHubClient, run: RunReservation, checkRunId: string) {
  for (let page = 1; page <= 20; page += 1) {
    const result = record(
      await github.request(
        `/repos/${github.repository}/actions/runs/${run.workflowRunId}/attempts/${run.workflowAttempt}/jobs?per_page=100&page=${page}`,
      ),
    );
    if (!Array.isArray(result.jobs)) {
      throw new SecurityError("invalid_metadata", 503, "Workflow job metadata is unavailable.");
    }
    for (const value of result.jobs) {
      const job = record(value);
      if (
        job.check_run_url ===
        `https://api.github.com/repos/${github.repository}/check-runs/${checkRunId}`
      ) {
        return job;
      }
    }
    if (result.jobs.length < 100) break;
  }
  throw new SecurityError("untrusted_job", 403, "The signed job is not in this workflow attempt.");
}

/** Fetch the plan at a resolved main commit, never at a PR-controlled ref. */
export async function loadTrustedMainFile(github: GitHubClient, path: string) {
  if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.includes("..")) {
    throw new Error("Invalid trusted plan path.");
  }
  const branch = record(await github.request(`/repos/${github.repository}/git/ref/heads/main`));
  const mainSha = sha(record(branch.object).sha);
  const result = record(
    await github.request(`/repos/${github.repository}/contents/${path}?ref=${mainSha}`),
  );
  requireEqual(result.type, "file", "plan.file_type");
  requireEqual(result.encoding, "base64", "plan.encoding");
  const content = textField(result.content).replace(/\n/g, "");
  if (content.length > 2 * 1024 * 1024) {
    throw new SecurityError(
      "plan_too_large",
      503,
      "The trusted capture plan exceeds its size limit.",
    );
  }
  const bytes = Uint8Array.from(atob(content), (character) => character.charCodeAt(0));
  return { mainSha, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
}
