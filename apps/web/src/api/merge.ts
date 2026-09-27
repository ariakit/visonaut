import type { GitHubClient } from "@visonaut/security";
import { object } from "./input.js";

interface SameCurrentMergeTreeParams {
  github: Pick<GitHubClient, "repository" | "request">;
  testedSha: string;
  currentSha: string;
  baseSha: string;
  sourceSha: string;
}

function sha(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value) ? value : null;
}

function currentParents(commit: Record<string, unknown>, baseSha: string, sourceSha: string) {
  return (
    Array.isArray(commit.parents) &&
    commit.parents.length === 2 &&
    object(commit.parents[0]).sha === baseSha &&
    object(commit.parents[1]).sha === sourceSha
  );
}

/** A changed synthetic merge SHA is equivalent only for the current parents and tree. */
export async function sameCurrentMergeTree({
  github,
  testedSha,
  currentSha,
  baseSha,
  sourceSha,
}: SameCurrentMergeTreeParams) {
  const root = `/repos/${github.repository}`;
  const tested = object(await github.request(`${root}/git/commits/${testedSha}`));
  if (!currentParents(tested, baseSha, sourceSha)) return false;
  if (testedSha === currentSha) return true;
  const current = object(await github.request(`${root}/git/commits/${currentSha}`));
  return (
    currentParents(current, baseSha, sourceSha) &&
    sha(object(tested.tree).sha) !== null &&
    object(tested.tree).sha === object(current.tree).sha
  );
}
