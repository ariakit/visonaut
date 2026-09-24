import {
  digestJson,
  parseTrustedPlan,
  validateKey,
  workflowSourceDigest,
} from "@visonaut/protocol";
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
import { workflowConfiguration } from "./workflow-owned.js";

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
  const shardKey = string(body.shardKey ?? body.browser, 256);
  validateKey(shardKey, "shardKey");
  if (!context.configuration.workflowOwned && !browsers.has(shardKey)) {
    throw new SecurityError("invalid_transfer_job", 400, "The transfer job is invalid.");
  }
  const workflowRunId = string(body.workflowRunId, 20);
  const workflowAttempt = integer(body.workflowAttempt, 1);
  const testedSha = string(body.testedSha, 40);
  const workflowOwned = context.configuration.workflowOwned
    ? workflowConfiguration(context)
    : undefined;
  let planDigest: string;
  let jobName: string;
  let workflowPath: string;
  let reusableWorkflowRef = context.configuration.reusableWorkflowRef;
  let reusableWorkflowSha = context.configuration.reusableWorkflowSha;
  if (workflowOwned) {
    planDigest = await workflowSourceDigest(workflowOwned.reusableWorkflowSha);
    jobName = `${workflowOwned.captureJobPrefix}${shardKey}`;
    workflowPath = workflowOwned.callerWorkflowPath;
    reusableWorkflowRef = workflowOwned.reusableWorkflowRef;
    reusableWorkflowSha = workflowOwned.reusableWorkflowSha;
  } else {
    const planSource = await loadTrustedMainFile(github, context.configuration.trustedPlanPath);
    const plan = parseTrustedPlan(JSON.parse(planSource.content));
    jobName = `capture / ${shardKey}`;
    const shard = plan.shards.find((entry) => entry.key === shardKey);
    if (
      plan.repositoryId !== context.configuration.github.repositoryId ||
      !plan.discovery ||
      plan.discovery.executorDigest !== context.configuration.trustedExecutorDigest ||
      shard?.jobName !== jobName
    ) {
      throw new SecurityError("untrusted_executor", 403, "The capture executor is not trusted.");
    }
    planDigest = await digestJson(plan);
    workflowPath = plan.workflow;
  }
  const verified = await verifyGitHubOidc({
    token: bearerToken(request),
    request: {
      repository: github.repository,
      repositoryId: github.repositoryId,
      workflowRunId,
      workflowAttempt,
      testedSha,
      planDigest,
      shardKey,
    },
    github,
    keySet,
    configuration: {
      audience: new URL("/transfer-key", context.configuration.origin).href,
      allowMainDispatch:
        context.configuration.auth.environment === "preview" &&
        context.configuration.allowMainDispatch === true,
      repositoryOwnerId: context.configuration.repositoryOwnerId,
      workflowPath,
      reusableWorkflowRef,
      reusableWorkflowSha,
      planDigest,
      shards: [{ key: shardKey, jobName }],
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
