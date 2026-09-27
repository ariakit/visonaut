import type { GitHubClient } from "@visonaut/security";
import { object } from "./input.js";

interface SameCurrentMergeTreeParams {
  github: Pick<GitHubClient, "repository" | "request">;
  testedSha: string;
  currentSha: string;
  testedBaseSha?: string;
  sourceSha: string;
}

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

/** A regenerated PR merge is equivalent only while both bases remain in main history. */
export async function sameCurrentMergeTree({
  github,
  testedSha,
  currentSha,
  testedBaseSha,
  sourceSha,
}: SameCurrentMergeTreeParams) {
  const root = `/repos/${github.repository}`;
  const tested = mergeCommit(
    object(await github.request(`${root}/git/commits/${testedSha}`)),
    sourceSha,
  );
  if (!tested) return false;
  if (testedBaseSha && tested.baseSha !== testedBaseSha) return false;
  const current =
    testedSha === currentSha
      ? tested
      : mergeCommit(object(await github.request(`${root}/git/commits/${currentSha}`)), sourceSha);
  if (!current || tested.treeSha !== current.treeSha) return false;
  const mainSha = await currentMainSha(github);
  if (!mainSha) return false;
  if (!(await mainContainsBase(github, tested.baseSha, mainSha))) return false;
  if (testedSha === currentSha) return true;
  return mainContainsBase(github, current.baseSha, mainSha);
}
