import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryId = 1380751023;
// The one required check of the branch rule of `main`. It passes only when
// each other job of checks.yml passed.
const requiredCheck = "Gate";
// The GitHub Actions app. A check of another app with the same name does not count.
const actionsAppId = 15368;

/** A normal reason to run the suite. A fault is an `Error` of another kind. */
class NotTested extends Error {}

/** Read one JSON answer of the GitHub API of this repository. It throws when it cannot. */
export async function readGitHub(path, token, request = fetch) {
  const response = await request(`https://api.github.com/repos/ariakit/visonaut/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub answered HTTP ${response.status} for ${path}`);
  }
  return response.json();
}

function isCommit(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

/** Read the tree and the parents of one commit. The answer must be for that commit. */
async function readCommit(commit, read) {
  const answer = await read(`commits/${commit}`);
  const tree = answer?.commit?.tree?.sha;
  const parents = answer?.parents;
  if (answer?.sha !== commit || !isCommit(tree) || !Array.isArray(parents)) {
    throw new Error(`The answer of GitHub does not describe the commit ${commit}`);
  }
  return { tree, parents: parents.map((parent) => parent?.sha) };
}

/**
 * Prove that the suite already passed for the tree of `commit`, a commit of
 * `main`. `read` returns the JSON answer of one path of the GitHub API.
 *
 * It throws `NotTested` when a fact does not hold, and another error when it
 * cannot tell. The facts, in order:
 *
 * 1. This is the first attempt of the run. A second attempt must not skip a
 *    suite that failed in the first one.
 * 2. The commit has one parent, and exactly one pull request introduced it.
 * 3. That pull request is merged into `main` as this commit, from a branch of
 *    this repository and not of a fork.
 * 4. The last commit of the pull request has the same tree as the commit.
 * 5. That last commit has the parent in its history. So a run of the checks
 *    for a pull request into `main` tested this tree, and not the tree of a
 *    merge with an older `main`.
 * 6. Each `Gate` check run of that last commit, each attempt included, is a
 *    completed, successful check of GitHub Actions, and at least one exists.
 *
 * Not proved: that each of these checks is of a run for a pull request into
 * `main`. A check of a run for another base branch counts, as it does for
 * the branch rule.
 */
export async function proveTestedTree(commit, attempt, read) {
  if (!isCommit(commit)) {
    throw new Error("GITHUB_SHA is not a commit");
  }
  if (attempt !== "1") {
    throw new NotTested(`This is the attempt ${attempt} of the run, and not the first one`);
  }
  const merge = await readCommit(commit, read);
  const [parent] = merge.parents;
  if (merge.parents.length !== 1 || !isCommit(parent)) {
    throw new NotTested(`${commit} has ${merge.parents.length} parents, so it is no squash merge`);
  }

  const pullRequests = await read(`commits/${commit}/pulls?per_page=100`);
  if (!Array.isArray(pullRequests)) {
    throw new Error("The answer of GitHub has no list of pull requests");
  }
  if (pullRequests.length !== 1) {
    throw new NotTested(`${pullRequests.length} pull requests introduced ${commit}, and not one`);
  }
  const [pullRequest] = pullRequests;
  const number = pullRequest?.number;
  const head = pullRequest?.head?.sha;
  if (!Number.isSafeInteger(number) || !isCommit(head)) {
    throw new Error("The answer of GitHub does not describe a pull request");
  }
  if (typeof pullRequest.merged_at !== "string" || pullRequest.merge_commit_sha !== commit) {
    throw new NotTested(`The pull request #${number} is not merged as ${commit}`);
  }
  if (pullRequest.base?.ref !== "main" || pullRequest.base?.repo?.id !== repositoryId) {
    throw new NotTested(`The pull request #${number} is not a pull request into main`);
  }
  if (pullRequest.head?.repo?.id !== repositoryId) {
    throw new NotTested(`The branch of the pull request #${number} is not in this repository`);
  }

  const { tree } = await readCommit(head, read);
  if (tree !== merge.tree) {
    throw new NotTested(
      `The tree ${merge.tree} of ${commit} is not the tree ${tree} of ${head}, the last commit of the pull request #${number}`,
    );
  }

  const comparison = await read(`compare/${parent}...${head}?per_page=1`);
  const missing = comparison?.behind_by;
  if (!Number.isSafeInteger(missing) || missing < 0) {
    throw new Error("The answer of GitHub has no commit count");
  }
  if (missing !== 0) {
    throw new NotTested(
      `The pull request #${number} does not have ${missing} commit(s) of main, so its checks tested another merge result`,
    );
  }

  const name = encodeURIComponent(requiredCheck);
  // The filter "all" also returns the earlier attempts of a check. So a check
  // that passed only in a second attempt runs the suite.
  const checks = await read(
    `commits/${head}/check-runs?check_name=${name}&filter=all&per_page=100`,
  );
  const runs = checks?.check_runs;
  if (!Array.isArray(runs) || checks.total_count !== runs.length) {
    throw new Error("The answer of GitHub does not have each check run");
  }
  if (runs.length === 0) {
    throw new NotTested(`${head} has no check ${requiredCheck}`);
  }
  for (const run of runs) {
    if (run?.name !== requiredCheck || run.head_sha !== head) {
      throw new Error(`GitHub answered with a check that is not ${requiredCheck} of ${head}`);
    }
    if (run.app?.id !== actionsAppId) {
      throw new NotTested(`A check ${requiredCheck} of ${head} is not from GitHub Actions`);
    }
    if (run.status !== "completed" || run.conclusion !== "success") {
      throw new NotTested(
        `A check ${requiredCheck} of ${head} is ${run.status} with the conclusion ${run.conclusion}`,
      );
    }
  }
  return { number, head, tree };
}

/**
 * Select if the suite runs for `commit`. Only a complete proof skips it. A
 * fact that does not hold, or no answer, runs the suite as before this check
 * existed.
 */
export async function selectSuite(commit, attempt, read) {
  try {
    const { number, head, tree } = await proveTestedTree(commit, attempt, read);
    return {
      suite: "skip",
      level: "notice",
      message: `The suite does not run again: ${commit} has the tree ${tree} of ${head}, the last commit of the pull request #${number}, and the check ${requiredCheck} passed for it.`,
    };
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    if (error instanceof NotTested) {
      return { suite: "run", level: "notice", message: `The suite runs: ${cause}.` };
    }
    return {
      suite: "run",
      level: "warning",
      message: `The suite runs: cannot tell if the tree of ${commit} is tested (${cause}).`,
    };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {
    GITHUB_SHA: commit,
    GITHUB_RUN_ATTEMPT: attempt,
    GITHUB_OUTPUT: output,
    GH_TOKEN: token,
  } = process.env;
  const selection = await selectSuite(commit, attempt, (path) => readGitHub(path, token));
  console.log(`::${selection.level}::${selection.message}`);
  if (!output) {
    throw new Error("GITHUB_OUTPUT is missing, so the job cannot report its result");
  }
  await appendFile(output, `suite=${selection.suite}\n`);
}
