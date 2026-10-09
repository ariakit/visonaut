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

function workflowIdentity(environment: Record<string, string | undefined>) {
  const runId = required(environment, "GITHUB_RUN_ID");
  const attempt = Number(required(environment, "GITHUB_RUN_ATTEMPT"));
  const testedSha = required(environment, "GITHUB_SHA");
  if (
    !/^[1-9][0-9]*$/.test(runId) ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    !/^[a-f0-9]{40}$/.test(testedSha)
  ) {
    throw new CliError(
      "Submission requires the current GitHub run, attempt, and tested commit.",
      4,
    );
  }
  return { runId, attempt, testedSha };
}

/** Only the native CI Plan job can attest that capture is unnecessary. */
export async function submitWithoutVisuals(environment: Record<string, string | undefined>) {
  const origin = serverOrigin(required(environment, "VISONAUT_SERVER"));
  const { runId, attempt, testedSha } = workflowIdentity(environment);
  const token = await githubToken(origin, environment, "plan-report");
  await request({
    url: new URL("/v1/plan", origin),
    token,
    method: "POST",
    mediaType: "application/json",
    empty: true,
    body: JSON.stringify({
      schemaVersion: 1,
      workflowRunId: runId,
      workflowAttempt: attempt,
      testedSha,
      planResult: "success",
      visualRequired: false,
    }),
  });
}

export async function beginSubmission(environment: Record<string, string | undefined>) {
  const origin = serverOrigin(required(environment, "VISONAUT_SERVER"));
  const { runId, attempt, testedSha } = workflowIdentity(environment);
  const token = await githubToken(origin, environment, "submit");
  await request({
    url: new URL(`/v1/runs/${runId}/begin`, origin),
    token,
    method: "POST",
    mediaType: "application/json",
    body: JSON.stringify({ schemaVersion: "1.0", workflowAttempt: attempt, testedSha }),
  });
}

/** Download and verify ordinary artifacts only inside the signed Submit job. */
export async function prepareBundleSubmission(
  shards: string[],
  environment: Record<string, string | undefined>,
) {
  const origin = serverOrigin(required(environment, "VISONAUT_SERVER"));
  const workflowAttempt = Number(required(environment, "GITHUB_RUN_ATTEMPT"));
  if (!Number.isSafeInteger(workflowAttempt) || workflowAttempt < 1) {
    throw new CliError("The current workflow attempt is invalid.", 4);
  }
  await beginSubmission(environment);
  const root = await mkdtemp(join(required(environment, "RUNNER_TEMP"), "visonaut-submit-"));
  try {
    const sources = await downloadCaptures({ shards, directory: root, environment });
    const directory = join(root, "combined");
    const pending = await combineBundles({
      bundles: sources,
      directory,
      workflowAttempt,
    });
    await bindSubmission(pending, directory, origin, environment);
    return { directory, server: origin.origin };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
