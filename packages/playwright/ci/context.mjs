import { writeFile } from "node:fs/promises";
import path from "node:path";

function nonzeroId(value) {
  if (!/^[1-9][0-9]*$/.test(String(value ?? ""))) {
    throw new Error("A GitHub numeric identity is required");
  }
  return String(value);
}

export function githubOidcRequestUrl(endpoint, audience) {
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".actions.githubusercontent.com") ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("GitHub OIDC must use its Actions HTTPS endpoint");
  }
  url.searchParams.set("audience", audience);
  return url;
}

export async function bindSignedJob({
  directory,
  repository,
  server,
  shard,
  workflowRunId,
  workflowAttempt,
  testedSha,
  tokenRequestUrl,
  tokenRequestToken,
  githubToken,
  trustedWorkflowSha,
  fetchImpl = fetch,
}) {
  nonzeroId(workflowRunId);
  if (
    !Number.isSafeInteger(workflowAttempt) ||
    workflowAttempt < 1 ||
    !/^[a-f0-9]{40}$/.test(testedSha ?? "") ||
    !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(shard ?? "") ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")
  ) {
    throw new Error("The signed GitHub job context is invalid");
  }
  const origin = new URL(server).origin;
  const request = githubOidcRequestUrl(tokenRequestUrl, origin);
  const tokenResponse = await fetchImpl(request, {
    headers: { Authorization: `Bearer ${tokenRequestToken}` },
    redirect: "error",
  });
  if (!tokenResponse.ok) throw new Error(`OIDC request failed: ${tokenResponse.status}`);
  const { value } = await tokenResponse.json();
  // These unverified claims identify the job and workflow source locally. The service verifies the signed token.
  const claims = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString());
  const checkRunId = nonzeroId(claims.check_run_id);
  if (trustedWorkflowSha && claims.job_workflow_sha !== testedSha) {
    throw new Error("Signed upload job did not use this commit's app workflow");
  }
  const workflowSha = trustedWorkflowSha ?? claims.job_workflow_sha;
  if (!/^[a-f0-9]{40}$/.test(workflowSha ?? "")) {
    throw new Error("Signed upload job has no reusable workflow source SHA");
  }
  const matches = [];
  for (let page = 1; page <= 10; page += 1) {
    const jobs = await fetchImpl(
      `https://api.github.com/repos/${repository}/actions/runs/${workflowRunId}/attempts/${workflowAttempt}/jobs?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        redirect: "error",
      },
    );
    if (!jobs.ok) throw new Error(`Cannot locate current workflow job: ${jobs.status}`);
    const body = await jobs.json();
    if (!Array.isArray(body.jobs)) throw new Error("GitHub returned an invalid job list");
    // The service verifies the signed token and expected job name. This lookup
    // only ties its check-run ID to GitHub's numeric job ID.
    matches.push(
      ...body.jobs.filter(
        (job) =>
          typeof job.name === "string" &&
          new URL(job.check_run_url).pathname.endsWith(`/${checkRunId}`),
      ),
    );
    if (body.jobs.length < 100) break;
  }
  if (matches.length !== 1) throw new Error("Current signed workflow job is ambiguous or absent");
  const context = {
    workflowRunId: String(workflowRunId),
    workflowAttempt,
    testedSha,
    jobId: nonzeroId(matches[0].id),
    workflowSha,
    jobName: matches[0].name,
  };
  await writeFile(path.join(directory, "context.json"), `${JSON.stringify(context, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return context;
}
