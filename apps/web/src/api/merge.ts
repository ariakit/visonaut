import type { GitHubClient } from "@visonaut/security";
import { object } from "./input.js";

function sha(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value) ? value : null;
}

function mergeCommit(commit: Record<string, unknown>, sourceSha: string) {
  if (!Array.isArray(commit.parents) || commit.parents.length !== 2) return null;
  const baseSha = sha(object(commit.parents[0]).sha);
  const headSha = sha(object(commit.parents[1]).sha);
  const treeSha = sha(object(commit.tree).sha);
  if (!baseSha || headSha !== sourceSha || !treeSha) return null;
  return { baseSha, treeSha };
}

async function currentMainSha(github: Pick<GitHubClient, "repository" | "request">) {
  const root = `/repos/${github.repository}`;
  const mainRef = object(await github.request(`${root}/git/ref/heads/main`));
  return sha(object(mainRef.object).sha);
}

async function mainContainsBase(
  github: Pick<GitHubClient, "repository" | "request">,
  baseSha: string,
  mainSha: string,
) {
  if (baseSha === mainSha) return true;
  const root = `/repos/${github.repository}`;
  const comparison = object(
    await github.request(`${root}/compare/${baseSha}...${mainSha}?per_page=1`),
  );
  return comparison.status === "ahead";
}

export async function mergeBaseForHead(
  github: Pick<GitHubClient, "repository" | "request">,
  mergeSha: string,
  sourceSha: string,
) {
  const root = `/repos/${github.repository}`;
  const merge = mergeCommit(
    object(await github.request(`${root}/git/commits/${mergeSha}`)),
    sourceSha,
  );
  if (!merge) return null;
  const mainSha = await currentMainSha(github);
  if (!mainSha || !(await mainContainsBase(github, merge.baseSha, mainSha))) return null;
  return merge.baseSha;
}
