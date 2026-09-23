import { digestJson, parseTrustedPlan } from "@visonaut/protocol";
import {
  bearerToken,
  loadTrustedMainFile,
  SecurityError,
  verifyGitHubOidc,
  type GitHubClient,
} from "@visonaut/security";
import type { JWTVerifyGetKey } from "jose";
import { loadVerifiedMergeGroup, type ApiContext } from "./context.js";
import { integer, jsonBody, string } from "./input.js";

const browsers = new Set(["chromium", "firefox", "webkit"]);
const maximumKeyBytes = 4096;

/** Gives the pinned capture job its local transfer key after GitHub provenance checks. */
export async function transferPrivateKey({
  request,
  context,
  github,
  keySet,
}: {
  request: Request;
  context: ApiContext;
  github: GitHubClient;
  keySet?: JWTVerifyGetKey;
}): Promise<Response> {
  const body = await jsonBody(request, 2048);
  const browser = string(body.browser, 16);
  if (!browsers.has(browser)) {
    throw new SecurityError("invalid_transfer_job", 400, "The transfer job is invalid.");
  }
  const workflowRunId = string(body.workflowRunId, 20);
  const workflowAttempt = integer(body.workflowAttempt, 1);
  const testedSha = string(body.testedSha, 40);
  const planSource = await loadTrustedMainFile(github, context.configuration.trustedPlanPath);
  const plan = parseTrustedPlan(JSON.parse(planSource.content));
  const jobName = `capture / ${browser}`;
  const shard = plan.shards.find((entry) => entry.key === browser);
  if (
    plan.repositoryId !== context.configuration.github.repositoryId ||
    !plan.discovery ||
    plan.discovery.executorDigest !== context.configuration.trustedExecutorDigest ||
    shard?.jobName !== jobName
  ) {
    throw new SecurityError("untrusted_executor", 403, "The capture executor is not trusted.");
  }
  const planDigest = await digestJson(plan);
  const verified = await verifyGitHubOidc({
    token: bearerToken(request),
    request: {
      repository: github.repository,
      repositoryId: github.repositoryId,
      workflowRunId,
      workflowAttempt,
      testedSha,
      planDigest,
      shardKey: browser,
    },
    github,
    keySet,
    configuration: {
      audience: new URL("/transfer-key", context.configuration.origin).href,
      allowMainDispatch:
        context.configuration.auth.environment === "preview" &&
        context.configuration.allowMainDispatch === true,
      repositoryOwnerId: context.configuration.repositoryOwnerId,
      workflowPath: plan.workflow,
      reusableWorkflowRef: context.configuration.reusableWorkflowRef,
      reusableWorkflowSha: context.configuration.reusableWorkflowSha,
      planDigest,
      shards: [{ key: browser, jobName }],
      loadMergeGroup: (sha) => loadVerifiedMergeGroup(context, sha),
    },
  });
  const privateKey = context.transferPrivateKey;
  const bytes = privateKey && new TextEncoder().encode(privateKey);
  if (
    !bytes ||
    bytes.byteLength > maximumKeyBytes ||
    !privateKey.startsWith("-----BEGIN PRIVATE KEY-----\n") ||
    !privateKey.trimEnd().endsWith("-----END PRIVATE KEY-----")
  ) {
    throw new SecurityError("transfer_key_unavailable", 503, "The transfer key is unavailable.");
  }
  // Claim the signed job, not its token, so minting another token cannot repeat retrieval.
  const redemption = await context.database
    .prepare(
      "INSERT INTO transfer_key_redemptions (repository_id, workflow_run_id, workflow_attempt, check_run_id, redeemed_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING check_run_id",
    )
    .bind(
      verified.repositoryId,
      verified.workflowRunId,
      verified.workflowAttempt,
      verified.checkRunId,
      Date.now(),
    )
    .first<{ check_run_id: string }>();
  if (!redemption) {
    throw new SecurityError(
      "transfer_key_redeemed",
      409,
      "The transfer key was already retrieved.",
    );
  }
  return new Response(bytes, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
