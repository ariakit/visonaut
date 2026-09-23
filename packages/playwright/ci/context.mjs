import { writeFile } from "node:fs/promises";
import path from "node:path";

function nonzeroId(value) {
  if (!/^[1-9][0-9]*$/.test(String(value ?? ""))) {
    throw new Error("A GitHub numeric identity is required");
  }
  return String(value);
}

export async function bindSignedJob({
  directory,
  repository,
  server,
  browser,
  workflowRunId,
  workflowAttempt,
  testedSha,
  tokenRequestUrl,
  tokenRequestToken,
  githubToken,
  fetchImpl = fetch,
}) {
  nonzeroId(workflowRunId);
  if (
    !Number.isSafeInteger(workflowAttempt) ||
    workflowAttempt < 1 ||
    !/^[a-f0-9]{40}$/.test(testedSha ?? "") ||
    !/^(chromium|firefox|webkit)$/.test(browser ?? "") ||
    !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(repository ?? "")
  ) {
    throw new Error("The signed GitHub job context is invalid");
  }
  const origin = new URL(server).origin;
  const request = new URL(tokenRequestUrl);
  request.searchParams.set("audience", origin);
  const tokenResponse = await fetchImpl(request, {
    headers: { Authorization: `Bearer ${tokenRequestToken}` },
    redirect: "error",
  });
  if (!tokenResponse.ok) throw new Error(`OIDC request failed: ${tokenResponse.status}`);
  const { value } = await tokenResponse.json();
  // The unverified claim only locates a REST job. The service verifies the signed token.
  const claims = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString());
  const checkRunId = nonzeroId(claims.check_run_id);
  const jobs = await fetchImpl(
    `https://api.github.com/repos/${repository}/actions/runs/${workflowRunId}/attempts/${workflowAttempt}/jobs?per_page=100`,
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
  const matches = body.jobs.filter(
    (job) =>
      job.name === `capture / ${browser}` &&
      new URL(job.check_run_url).pathname.endsWith(`/${checkRunId}`),
  );
  if (matches.length !== 1) throw new Error("Current signed workflow job is ambiguous or absent");
  const context = {
    workflowRunId: String(workflowRunId),
    workflowAttempt,
    testedSha,
    jobId: nonzeroId(matches[0].id),
  };
  await writeFile(path.join(directory, "context.json"), `${JSON.stringify(context, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  return context;
}
