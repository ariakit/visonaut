import { appendFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createDiscoveryReceipt,
  parseManifest,
  workflowSourceDigest,
  type Manifest,
} from "@visonaut/protocol";
import { CliError, record } from "./errors.js";
import { githubToken } from "./http.js";

export async function bindSubmission(
  manifest: Manifest,
  directory: string,
  origin: URL,
  environment: Record<string, string | undefined>,
) {
  const token = await githubToken(origin, environment);
  const encoded = token.split(".")[1];
  if (!encoded) {
    throw new CliError("GitHub returned an invalid signed identity.", 4);
  }
  const claims: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  const workflowSha = environment.VISONAUT_WORKFLOW_SOURCE_SHA;
  if (
    !record(claims) ||
    !/^[a-f0-9]{40}$/.test(workflowSha ?? "") ||
    claims.job_workflow_sha !== environment.GITHUB_SHA ||
    !/^[1-9][0-9]*$/.test(String(claims.check_run_id))
  ) {
    throw new CliError("Submit did not use this commit's pinned visual workflow.", 4);
  }
  const matches: Record<string, unknown>[] = [];
  for (let page = 1; page <= 20; page++) {
    const response = await fetch(
      `https://api.github.com/repos/${manifest.run.repository}/actions/runs/${manifest.run.workflowRunId}/attempts/${environment.GITHUB_RUN_ATTEMPT}/jobs?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${environment.GH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        redirect: "error",
      },
    );
    if (!response.ok) {
      throw new CliError("The signed Submit job is unavailable.");
    }
    const body: unknown = await response.json();
    if (!record(body) || !Array.isArray(body.jobs)) {
      throw new CliError("The signed Submit job list is invalid.");
    }
    for (const job of body.jobs) {
      if (
        record(job) &&
        job.check_run_url ===
          `https://api.github.com/repos/${manifest.run.repository}/check-runs/${claims.check_run_id}`
      ) {
        matches.push(job);
      }
    }
    if (body.jobs.length < 100) {
      break;
    }
  }
  const job = matches[0];
  if (
    matches.length !== 1 ||
    !job ||
    !Number.isSafeInteger(job.id) ||
    Number(job.id) < 1 ||
    job.name !== environment.VISONAUT_SUBMIT_JOB_NAME
  ) {
    throw new CliError("The signed Submit job identity is ambiguous.", 4);
  }
  const rebound = parseManifest({
    ...manifest,
    run: {
      ...manifest.run,
      workflowAttempt: Number(environment.GITHUB_RUN_ATTEMPT),
      planDigest: await workflowSourceDigest(String(workflowSha)),
    },
    shard: {
      key: "combined",
      jobId: String(job.id),
      sourceAttempt: Number(environment.GITHUB_RUN_ATTEMPT),
    },
  });
  const file = join(directory, "manifest.json");
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(rebound)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, file);
  const receipt = await createDiscoveryReceipt(rebound);
  const receiptFile = join(directory, "receipt.json");
  await writeFile(receiptFile, `${JSON.stringify(receipt)}\n`, { flag: "wx", mode: 0o600 });
  if (!environment.GITHUB_OUTPUT) {
    throw new CliError("GITHUB_OUTPUT is required.", 2);
  }
  await appendFile(
    environment.GITHUB_OUTPUT,
    `name=${receipt.artifactName}\npath=${receiptFile}\n`,
  );
  return rebound;
}
