import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Read from GitHub how many commits `main` has that `commit` does not have.
 * It throws when it cannot tell.
 */
export async function readMainLead(commit, token, request = fetch) {
  if (!/^[a-f0-9]{40}$/.test(commit ?? "")) {
    throw new Error("GITHUB_SHA is not a commit");
  }
  const response = await request(
    `https://api.github.com/repos/ariakit/visonaut/compare/${commit}...main?per_page=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub answered HTTP ${response.status}`);
  }
  const comparison = await response.json();
  const lead = comparison?.ahead_by;
  if (!Number.isSafeInteger(lead) || lead < 0) {
    throw new Error("The answer of GitHub has no commit count");
  }
  return lead;
}

/**
 * Select if the run of `commit` continues. Only a known newer commit on
 * `main` stops it. A late answer that does not have the commit yet, or no
 * answer, continues the run as before this check existed: `deploy-source.mjs`
 * in the deploy job still refuses a superseded commit.
 */
export async function selectDeploy(commit, readLead) {
  let lead;
  try {
    lead = await readLead();
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    return {
      deploy: true,
      level: "warning",
      message: `Cannot compare main with ${commit} (${cause}). The run continues, and the deploy job checks the tip again.`,
    };
  }
  if (lead === 0) {
    return { deploy: true, level: "notice", message: `main has no commit after ${commit}.` };
  }
  return {
    deploy: false,
    level: "notice",
    message: `main has ${lead} newer commit(s). The run of ${commit} is superseded and deploys nothing. Make sure that the newest commit has a deploy run.`,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { GITHUB_SHA: commit, GITHUB_OUTPUT: output, GH_TOKEN: token } = process.env;
  const selection = await selectDeploy(commit, () => readMainLead(commit, token));
  console.log(`::${selection.level}::${selection.message}`);
  if (!output) {
    throw new Error("GITHUB_OUTPUT is missing, so the job cannot report its result");
  }
  await appendFile(output, `deploy=${selection.deploy}\n`);
}
