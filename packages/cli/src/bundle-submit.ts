import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { combineBundles } from "./bundles.js";
import { CliError } from "./errors.js";
import { githubToken, request, serverOrigin } from "./http.js";
import { downloadCaptures } from "./github-artifacts.js";
import { bindSubmission } from "./signed-context.js";

function required(environment: Record<string, string | undefined>, name: string): string {
  const value = environment[name];
  if (!value) {
    throw new CliError(`${name} is required for signed submission.`, 2);
  }
  return value;
}

export async function beginSubmission(environment: Record<string, string | undefined>) {
  const origin = serverOrigin(required(environment, "VISONAUT_SERVER"));
  const runId = required(environment, "GITHUB_RUN_ID");
  const attempt = Number(required(environment, "GITHUB_RUN_ATTEMPT"));
  const testedSha = required(environment, "GITHUB_SHA");
  if (
    !/^[1-9][0-9]*$/.test(runId) ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    !/^[a-f0-9]{40}$/.test(testedSha)
  ) {
    throw new CliError("Begin requires the current GitHub run, attempt, and tested commit.", 4);
  }
  try {
    const token = await githubToken(origin, environment, "submit");
    await request({
      url: new URL(`/v1/runs/${runId}/begin`, origin),
      token,
      method: "POST",
      mediaType: "application/json",
      body: JSON.stringify({ schemaVersion: "1.0", workflowAttempt: attempt, testedSha }),
    });
  } catch {
    throw new CliError("The signed Submit check could not be started.", 4);
  }
}

/** Download and verify ordinary artifacts only inside the pinned signed Submit job. */
export async function prepareBundleSubmission(
  shards: string[],
  environment: Record<string, string | undefined>,
) {
  const origin = serverOrigin(required(environment, "VISONAUT_SERVER"));
  const packageDigest = required(environment, "VISONAUT_PACKAGE_SHA256");
  const workflowSha = required(environment, "VISONAUT_WORKFLOW_SOURCE_SHA");
  if (!/^[a-f0-9]{64}$/.test(packageDigest) || !/^[a-f0-9]{40}$/.test(workflowSha)) {
    throw new CliError("The pinned package or workflow digest is invalid.", 4);
  }
  const workflowAttempt = Number(required(environment, "GITHUB_RUN_ATTEMPT"));
  if (!Number.isSafeInteger(workflowAttempt) || workflowAttempt < 1) {
    throw new CliError("The current workflow attempt is invalid.", 4);
  }
  await beginSubmission(environment);
  const root = await mkdtemp(join(required(environment, "RUNNER_TEMP"), "visonaut-submit-"));
  try {
    const sources = await downloadCaptures({ shards, directory: root, environment });
    const directory = join(root, "combined");
    const manifest = await combineBundles({
      bundles: sources,
      directory,
      packageDigest,
      workflowAttempt,
    });
    await bindSubmission(manifest, directory, origin, environment);
    return { directory, server: origin.origin };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
