import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { combineBundles } from "./bundles.js";
import { CliError } from "./errors.js";
import { githubToken, serverOrigin } from "./http.js";

interface EncryptedBundle {
  shard: string;
  file: string;
}

function required(environment: Record<string, string | undefined>, name: string): string {
  const value = environment[name];
  if (!value) throw new CliError(`${name} is required for signed submission.`, 2);
  return value;
}

async function transferPrivateKey(
  origin: URL,
  environment: Record<string, string | undefined>,
): Promise<string> {
  const token = await githubToken(origin, environment, "transfer-key");
  let response: Response;
  try {
    response = await fetch(new URL("/v1/transfer/private-key", origin), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        shardKey: "combined",
        workflowRunId: required(environment, "GITHUB_RUN_ID"),
        workflowAttempt: Number(required(environment, "GITHUB_RUN_ATTEMPT")),
        testedSha: required(environment, "GITHUB_SHA"),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new CliError("The Visonaut transfer key could not be retrieved.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new CliError(`The Visonaut transfer key request failed (HTTP ${response.status}).`);
  }
  if (Number(response.headers.get("Content-Length")) > 16_384) {
    await response.body?.cancel();
    throw new CliError("The Visonaut transfer key is too large.");
  }
  const key = await response.text();
  if (
    key.length > 16_384 ||
    !key.startsWith("-----BEGIN PRIVATE KEY-----\n") ||
    !key.trimEnd().endsWith("-----END PRIVATE KEY-----")
  ) {
    throw new CliError("Visonaut returned an invalid transfer key.");
  }
  return key;
}

/** Decrypt and combine unsigned packs only inside the signed Submit job. */
export async function prepareBundleSubmission(
  bundles: EncryptedBundle[],
  environment: Record<string, string | undefined>,
) {
  const origin = serverOrigin(required(environment, "VISONAUT_SERVER"));
  const packageDigest = required(environment, "VISONAUT_PACKAGE_SHA256");
  const workflowSha = required(environment, "VISONAUT_WORKFLOW_SOURCE_SHA");
  if (!/^[a-f0-9]{64}$/.test(packageDigest) || !/^[a-f0-9]{40}$/.test(workflowSha)) {
    throw new CliError("The pinned Visonaut package or workflow digest is invalid.", 4);
  }
  const workflowAttempt = Number(required(environment, "GITHUB_RUN_ATTEMPT"));
  if (!Number.isSafeInteger(workflowAttempt) || workflowAttempt < 1) {
    throw new CliError("The current GitHub workflow attempt is invalid.", 4);
  }
  const root = await mkdtemp(join(required(environment, "RUNNER_TEMP"), "visonaut-submit-"));
  try {
    const { bindSignedJob, decryptTransfer, rebindManifest } =
      await import("@visonaut/playwright/ci");
    const privateKey = await transferPrivateKey(origin, environment);
    const sources: { shard: string; directory: string }[] = [];
    for (const [index, bundle] of bundles.entries()) {
      const directory = join(root, `source-${index}`);
      await decryptTransfer(bundle.file, directory, bundle.shard, privateKey, environment);
      sources.push({ shard: bundle.shard, directory });
    }
    const directory = join(root, "combined");
    const manifest = await combineBundles({
      bundles: sources,
      directory,
      packageDigest,
      workflowAttempt,
    });
    for (const source of sources) {
      await rm(source.directory, { recursive: true, force: true });
    }
    if (
      manifest.run.workflowRunId !== environment.GITHUB_RUN_ID ||
      manifest.run.testedSha !== environment.GITHUB_SHA
    ) {
      throw new CliError("Capture bundles belong to another GitHub run or commit.", 4);
    }
    const jobOptions = {
      directory,
      repository: manifest.run.repository,
      server: origin.origin,
      shard: "combined",
      workflowRunId: manifest.run.workflowRunId,
      workflowAttempt,
      testedSha: manifest.run.testedSha,
      tokenRequestUrl: required(environment, "ACTIONS_ID_TOKEN_REQUEST_URL"),
      tokenRequestToken: required(environment, "ACTIONS_ID_TOKEN_REQUEST_TOKEN"),
      githubToken: required(environment, "GH_TOKEN"),
      trustedWorkflowSha: workflowSha,
    };
    const signedJob = await bindSignedJob(jobOptions);
    const receipt = await rebindManifest({
      directory,
      shard: "combined",
      repository: manifest.run.repository,
      repositoryId: manifest.run.repositoryId,
      bundleSha256: packageDigest,
      context: signedJob,
    });
    await appendFile(
      required(environment, "GITHUB_OUTPUT"),
      `name=${receipt.artifactName}\npath=${join(directory, "receipt.json")}\n`,
    );
    return { directory, server: origin.origin };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
