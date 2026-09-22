import {
  discoveryArtifactPrefix,
  type Manifest,
  type TrustedPlan,
  type VerifiedDiscoveryEvidence,
} from "@ariviso/protocol";
import { type GitHubClient, SecurityError } from "@ariviso/security";
import { object } from "./input.js";

/** The fixed executor publishes this artifact after its reporter succeeds. */
export async function discoveryEvidence(
  github: GitHubClient,
  manifest: Manifest,
  plan: TrustedPlan,
  workflowHeadSha: string,
): Promise<VerifiedDiscoveryEvidence | undefined> {
  if (!plan.discovery) return undefined;
  const prefix = discoveryArtifactPrefix({
    workflowAttempt: manifest.run.workflowAttempt,
    jobId: manifest.shard.jobId,
    shardKey: manifest.shard.key,
  });
  const matches: string[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = object(
      await github.request(
        `/repos/${github.repository}/actions/runs/${manifest.run.workflowRunId}/artifacts?per_page=100&page=${page}`,
      ),
    );
    if (!Array.isArray(response.artifacts)) {
      throw new SecurityError(
        "missing_receipt",
        503,
        "Trusted discovery receipt metadata is unavailable.",
      );
    }
    for (const value of response.artifacts) {
      const artifact = object(value);
      if (typeof artifact.name !== "string" || !artifact.name.startsWith(prefix)) continue;
      const workflow = object(artifact.workflow_run);
      const digest = artifact.name.slice(prefix.length);
      if (
        artifact.expired !== false ||
        !/^[a-f0-9]{64}$/.test(digest) ||
        String(workflow.id) !== manifest.run.workflowRunId ||
        String(workflow.repository_id) !== github.repositoryId ||
        String(workflow.head_repository_id) !== github.repositoryId ||
        workflow.head_sha !== workflowHeadSha
      ) {
        throw new SecurityError(
          "invalid_receipt",
          409,
          "The discovery receipt does not match this successful workflow.",
        );
      }
      matches.push(digest);
    }
    if (response.artifacts.length < 100) break;
    if (page === 20) {
      throw new SecurityError(
        "receipt_limit",
        503,
        "Trusted receipt reconciliation exceeded its limit.",
      );
    }
  }
  const manifestDigest = matches[0];
  if (matches.length !== 1 || !manifestDigest) {
    throw new SecurityError(
      "missing_receipt",
      409,
      "One exact trusted discovery receipt is required for this shard.",
    );
  }
  return {
    workflowRunId: manifest.run.workflowRunId,
    workflowAttempt: manifest.run.workflowAttempt,
    testedSha: manifest.run.testedSha,
    jobId: manifest.shard.jobId,
    executorDigest: plan.discovery.executorDigest,
    manifestDigest,
    conclusion: "success",
  };
}
