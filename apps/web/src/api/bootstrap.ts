import { digestJson, parseTrustedPlan, sha256 } from "@visonaut/protocol";
import {
  bearerToken,
  loadTrustedMainFile,
  SecurityError,
  verifyGitHubOidc,
  type GitHubClient,
} from "@visonaut/security";
import type { JWTVerifyGetKey } from "jose";
import { loadVerifiedMergeGroup, type ApiContext } from "./context.js";
import { integer, jsonBody, object, string } from "./input.js";

const maximumPackageBytes = 10 * 1024 * 1024;
const settingsPath = ".github/visonaut/settings.json";
const browsers = new Set(["chromium", "firefox", "webkit"]);
const stages = new Set(["render", "capture"]);

function bootstrapRequest(body: Record<string, unknown>) {
  const browser = string(body.browser, 16);
  const stage = string(body.stage, 16);
  if (!browsers.has(browser) || !stages.has(stage)) {
    throw new SecurityError("invalid_bootstrap_job", 400, "The bootstrap job is invalid.");
  }
  return {
    browser,
    stage,
    workflowRunId: string(body.workflowRunId, 20),
    workflowAttempt: integer(body.workflowAttempt, 1),
    testedSha: string(body.testedSha, 40),
  };
}

function packagePin(settings: Record<string, unknown>, name: string) {
  const packages = settings.packages;
  if (!packages || typeof packages !== "object" || Array.isArray(packages)) {
    throw new SecurityError("bootstrap_unavailable", 503, "The package is unavailable.");
  }
  const value = (packages as Record<string, unknown>)[name];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SecurityError("bootstrap_unavailable", 503, "The package is unavailable.");
  }
  const { sha256: digest, bytes } = value as Record<string, unknown>;
  if (
    typeof digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(digest) ||
    typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    bytes > maximumPackageBytes
  ) {
    throw new SecurityError("bootstrap_unavailable", 503, "The package is unavailable.");
  }
  return { digest, bytes };
}

/** Returns only a main-pinned, audited future-public client archive to a signed CI job. */
export async function bootstrapPackage({
  request,
  context,
  packageName,
  github,
  keySet,
}: {
  request: Request;
  context: ApiContext;
  packageName: string;
  github: GitHubClient;
  keySet?: JWTVerifyGetKey;
}): Promise<Response> {
  if (packageName !== "playwright" && packageName !== "cli") {
    throw new SecurityError("bootstrap_not_found", 404, "The package was not found.");
  }
  if (!context.bootstrap) {
    throw new SecurityError("bootstrap_unavailable", 503, "The package is unavailable.");
  }
  const job = bootstrapRequest(await jsonBody(request, 2048));
  const [planSource, settingsSource] = await Promise.all([
    loadTrustedMainFile(github, context.configuration.trustedPlanPath),
    loadTrustedMainFile(github, settingsPath),
  ]);
  if (planSource.mainSha !== settingsSource.mainSha) {
    throw new SecurityError("bootstrap_plan_changed", 409, "The main capture plan changed.");
  }
  const plan = parseTrustedPlan(JSON.parse(planSource.content));
  if (
    plan.repositoryId !== context.configuration.github.repositoryId ||
    !plan.discovery ||
    plan.discovery.executorDigest !== context.configuration.trustedExecutorDigest
  ) {
    throw new SecurityError("untrusted_executor", 403, "The capture executor is not trusted.");
  }
  const shard = plan.shards.find((entry) => entry.key === job.browser);
  if (!shard) {
    throw new SecurityError("unknown_shard", 403, "The browser is not in the capture plan.");
  }
  const planDigest = await digestJson(plan);
  await verifyGitHubOidc({
    token: bearerToken(request),
    request: {
      repository: github.repository,
      repositoryId: github.repositoryId,
      workflowRunId: job.workflowRunId,
      workflowAttempt: job.workflowAttempt,
      testedSha: job.testedSha,
      planDigest,
      shardKey: `${job.stage}-${job.browser}`,
    },
    github,
    keySet,
    configuration: {
      audience: new URL("/bootstrap", context.configuration.origin).href,
      allowMainDispatch:
        context.configuration.auth.environment === "preview" &&
        context.configuration.allowMainDispatch === true,
      repositoryOwnerId: context.configuration.repositoryOwnerId,
      workflowPath: plan.workflow,
      reusableWorkflowRef: context.configuration.reusableWorkflowRef,
      reusableWorkflowSha: context.configuration.reusableWorkflowSha,
      planDigest,
      shards: [
        {
          key: `${job.stage}-${job.browser}`,
          jobName: job.stage === "render" ? `capture / render-${job.browser}` : shard.jobName,
        },
      ],
      loadMergeGroup: (testedSha) => loadVerifiedMergeGroup(context, testedSha),
    },
  });
  const pin = packagePin(object(JSON.parse(settingsSource.content)), packageName);
  // This binding is private. The object key can only be one of two main-pinned hashes.
  const archive = await context.bootstrap.get(`packages/${pin.digest}.tgz`);
  if (!archive || archive.size !== pin.bytes) {
    throw new SecurityError("bootstrap_unavailable", 503, "The package is unavailable.");
  }
  const bytes = new Uint8Array(await archive.arrayBuffer());
  if (bytes.byteLength !== pin.bytes || (await sha256(bytes)) !== pin.digest) {
    throw new SecurityError("bootstrap_integrity", 503, "The package failed its integrity check.");
  }
  return new Response(bytes, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
