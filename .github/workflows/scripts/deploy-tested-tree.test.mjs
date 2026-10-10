import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtempDisposable } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { proveTestedTree, readGitHub, selectSuite } from "./deploy-tested-tree.mjs";

const commit = "a".repeat(40);
const parent = "b".repeat(40);
const head = "c".repeat(40);
const tree = "d".repeat(40);
const other = "e".repeat(40);
const repositoryId = 1380751023;
const checksPath = `commits/${head}/check-runs?check_name=Gate&filter=all&per_page=100`;
const workflow = readFileSync(new URL("../deploy.yml", import.meta.url), "utf8");
const checks = readFileSync(new URL("../checks.yml", import.meta.url), "utf8");

function gate(change) {
  return {
    name: "Gate",
    head_sha: head,
    status: "completed",
    conclusion: "success",
    app: { id: 15368 },
    ...change,
  };
}

/**
 * The answers of GitHub for a squash merge of a current, tested branch, by
 * request path. `change` edits them for one case. The reader refuses each
 * other path, so a test also proves the exact requests.
 */
function github(change) {
  const answers = {
    [`commits/${commit}`]: {
      sha: commit,
      commit: { tree: { sha: tree } },
      parents: [{ sha: parent }],
    },
    [`commits/${commit}/pulls?per_page=100`]: [
      {
        number: 379,
        state: "closed",
        merged_at: "2026-10-10T01:04:41Z",
        merge_commit_sha: commit,
        head: { sha: head, repo: { id: repositoryId } },
        base: { ref: "main", repo: { id: repositoryId } },
      },
    ],
    [`commits/${head}`]: {
      sha: head,
      commit: { tree: { sha: tree } },
      parents: [{ sha: parent }],
    },
    [`compare/${parent}...${head}?per_page=1`]: { status: "ahead", ahead_by: 1, behind_by: 0 },
    [checksPath]: { total_count: 1, check_runs: [gate()] },
  };
  change?.(answers);
  const paths = [];
  const read = async (path) => {
    paths.push(path);
    assert.ok(Object.hasOwn(answers, path), `The script sent an unknown request: ${path}`);
    const answer = answers[path];
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  };
  return { read, paths };
}

function pullRequest(answers) {
  return answers[`commits/${commit}/pulls?per_page=100`][0];
}

test("a merge with an equal, tested tree selects no second suite", async () => {
  const { read, paths } = github();
  const selection = await selectSuite(commit, "1", read);
  assert.equal(selection.suite, "skip");
  assert.equal(selection.level, "notice");
  assert.match(selection.message, new RegExp(`${commit} has the tree ${tree} of ${head}`));
  assert.match(selection.message, /pull request #379/);
  assert.deepEqual(paths, [
    `commits/${commit}`,
    `commits/${commit}/pulls?per_page=100`,
    `commits/${head}`,
    `compare/${parent}...${head}?per_page=1`,
    checksPath,
  ]);
});

test("a merge with a different tree selects the suite", async () => {
  const { read, paths } = github((answers) => {
    answers[`commits/${head}`].commit.tree.sha = other;
  });
  const selection = await selectSuite(commit, "1", read);
  assert.equal(selection.suite, "run");
  assert.equal(selection.level, "notice");
  assert.match(selection.message, new RegExp(`The tree ${tree} of ${commit} is not the tree`));
  // A different tree asks for no check: no check can count for it.
  assert.equal(paths.includes(checksPath), false);
});

// Each case is a fact that does not hold. The suite runs, with a notice.
for (const [name, change, message] of [
  [
    "a commit that no pull request introduced",
    (answers) => {
      answers[`commits/${commit}/pulls?per_page=100`] = [];
    },
    /0 pull requests introduced/,
  ],
  [
    "a commit of more than one pull request",
    (answers) => {
      answers[`commits/${commit}/pulls?per_page=100`].push({
        ...pullRequest(answers),
        number: 380,
      });
    },
    /2 pull requests introduced/,
  ],
  [
    "a pull request that is not merged",
    (answers) => {
      pullRequest(answers).merged_at = null;
    },
    /is not merged as/,
  ],
  [
    "a pull request that is merged as another commit",
    (answers) => {
      pullRequest(answers).merge_commit_sha = other;
    },
    /is not merged as/,
  ],
  [
    "a pull request into another branch",
    (answers) => {
      pullRequest(answers).base.ref = "next";
    },
    /not a pull request into main/,
  ],
  [
    "a pull request into another repository",
    (answers) => {
      pullRequest(answers).base.repo.id = 1;
    },
    /not a pull request into main/,
  ],
  [
    "a pull request from a fork",
    (answers) => {
      pullRequest(answers).head.repo.id = 1;
    },
    /not in this repository/,
  ],
  [
    "a pull request from a deleted fork",
    (answers) => {
      pullRequest(answers).head.repo = null;
    },
    /not in this repository/,
  ],
  [
    "a merge commit with two parents",
    (answers) => {
      answers[`commits/${commit}`].parents.push({ sha: head });
    },
    /has 2 parents/,
  ],
  [
    "a commit with no parent",
    (answers) => {
      answers[`commits/${commit}`].parents = [];
    },
    /has 0 parents/,
  ],
  [
    "a branch that did not have each commit of main",
    (answers) => {
      answers[`compare/${parent}...${head}?per_page=1`] = {
        status: "diverged",
        ahead_by: 1,
        behind_by: 2,
      };
    },
    /does not have 2 commit\(s\) of main/,
  ],
  [
    "a missing check",
    (answers) => {
      answers[checksPath] = { total_count: 0, check_runs: [] };
    },
    /has no check Gate/,
  ],
  [
    "a check that failed",
    (answers) => {
      answers[checksPath].check_runs = [gate({ conclusion: "failure" })];
    },
    /is completed with the conclusion failure/,
  ],
  [
    "a check that was skipped",
    (answers) => {
      answers[checksPath].check_runs = [gate({ conclusion: "skipped" })];
    },
    /is completed with the conclusion skipped/,
  ],
  [
    "a check that still runs",
    (answers) => {
      answers[checksPath].check_runs = [gate({ status: "in_progress", conclusion: null })];
    },
    /is in_progress with the conclusion null/,
  ],
  [
    "a check that is not completed, also with a conclusion",
    (answers) => {
      answers[checksPath].check_runs = [gate({ status: "queued" })];
    },
    /is queued with the conclusion success/,
  ],
  [
    "a second check, or an earlier attempt of the check, that did not pass",
    (answers) => {
      answers[checksPath] = {
        total_count: 2,
        check_runs: [gate(), gate({ conclusion: "cancelled" })],
      };
    },
    /is completed with the conclusion cancelled/,
  ],
  [
    "a check of another app with the same name",
    (answers) => {
      answers[checksPath].check_runs = [gate({ app: { id: 5028451 } })];
    },
    /is not from GitHub Actions/,
  ],
]) {
  test(`the suite runs for ${name}`, async () => {
    const selection = await selectSuite(commit, "1", github(change).read);
    assert.equal(selection.suite, "run");
    assert.equal(selection.level, "notice");
    assert.match(selection.message, message);
  });
}

// Each case is an answer that the script cannot use. The suite runs, with a warning.
for (const [name, change] of [
  ...[
    `commits/${commit}`,
    `commits/${commit}/pulls?per_page=100`,
    `commits/${head}`,
    `compare/${parent}...${head}?per_page=1`,
    checksPath,
  ].map((path) => [
    `a failed request for ${path}`,
    (answers) => {
      answers[path] = new Error("GitHub answered HTTP 503");
    },
  ]),
  [
    "an answer for another merge commit",
    (answers) => {
      answers[`commits/${commit}`].sha = other;
    },
  ],
  [
    "an answer for another last commit",
    (answers) => {
      answers[`commits/${head}`].sha = other;
    },
  ],
  [
    "an answer with no tree",
    (answers) => {
      answers[`commits/${head}`].commit = {};
    },
  ],
  [
    "an answer that is no list of pull requests",
    (answers) => {
      answers[`commits/${commit}/pulls?per_page=100`] = { message: "Not Found" };
    },
  ],
  [
    "a pull request with no last commit",
    (answers) => {
      pullRequest(answers).head.sha = "main";
    },
  ],
  [
    "a comparison with no count",
    (answers) => {
      answers[`compare/${parent}...${head}?per_page=1`] = { message: "Not Found" };
    },
  ],
  [
    "a list of checks that is not complete",
    (answers) => {
      answers[checksPath].total_count = 101;
    },
  ],
  [
    "an answer with no list of checks",
    (answers) => {
      answers[checksPath] = { message: "Not Found" };
    },
  ],
  [
    "a check with another name",
    (answers) => {
      answers[checksPath].check_runs = [gate({ name: "Gate 2" })];
    },
  ],
  [
    "a check of another commit",
    (answers) => {
      answers[checksPath].check_runs = [gate({ head_sha: other })];
    },
  ],
]) {
  test(`the suite runs when the script cannot tell from ${name}`, async () => {
    const selection = await selectSuite(commit, "1", github(change).read);
    assert.equal(selection.suite, "run");
    assert.equal(selection.level, "warning");
    assert.match(selection.message, /cannot tell/);
  });
}

test("two successful checks of the last commit count", async () => {
  const { read } = github((answers) => {
    answers[checksPath] = { total_count: 2, check_runs: [gate(), gate()] };
  });
  assert.deepEqual(await proveTestedTree(commit, "1", read), { number: 379, head, tree });
});

test("a second attempt of the run selects the suite and sends no request", async () => {
  // A new run of all jobs must not skip a suite that failed in the first attempt.
  const { read, paths } = github();
  for (const attempt of ["2", "10", "", undefined]) {
    const selection = await selectSuite(commit, attempt, read);
    assert.equal(selection.suite, "run");
    assert.equal(selection.level, "notice");
    assert.match(selection.message, /and not the first one/);
  }
  assert.deepEqual(paths, []);
});

test("the script sends no request for a value that is not a commit", async () => {
  const { read, paths } = github();
  for (const value of ["main/../../other", undefined]) {
    const selection = await selectSuite(value, "1", read);
    assert.equal(selection.suite, "run");
    assert.equal(selection.level, "warning");
  }
  assert.deepEqual(paths, []);
});

test("a request goes to this repository with the token and follows no redirect", async () => {
  const calls = [];
  const answer = await readGitHub(`commits/${commit}`, "token-sentinel", async (url, options) => {
    calls.push({ url, options });
    return Response.json({ sha: commit });
  });
  assert.deepEqual(answer, { sha: commit });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.github.com/repos/ariakit/visonaut/commits/${commit}`);
  assert.equal(calls[0].options.headers.Authorization, "Bearer token-sentinel");
  assert.equal(calls[0].options.redirect, "error");
});

for (const [name, response] of [
  ["a failed status", () => new Response(null, { status: 503 })],
  ["an answer that is not JSON", () => new Response("<html>")],
]) {
  test(`a request cannot tell from ${name}`, async () => {
    await assert.rejects(readGitHub(`commits/${commit}`, "token", async () => response()));
  });
}

test("the script selects the suite when GitHub has no answer", async () => {
  await using directory = await mkdtempDisposable(resolve(tmpdir(), "visonaut-deploy-tested-"));
  const output = resolve(directory.path, "output");
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./deploy-tested-tree.mjs", import.meta.url))],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        GITHUB_SHA: commit,
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_OUTPUT: output,
        GH_TOKEN: "token",
        // No proxy listens on this port, so the request fails at once and never leaves the computer.
        NODE_USE_ENV_PROXY: "1",
        HTTPS_PROXY: "http://127.0.0.1:9",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^::warning::The suite runs: cannot tell/);
  assert.equal(readFileSync(output, "utf8"), "suite=run\n");
});

/** The text of one job of the workflow, from its key to the next job key. */
function job(name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `The workflow has no job ${name}`);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
  return workflow.slice(start + 1, next === -1 ? undefined : start + 2 + next);
}

/** The text of the condition of one job. */
function conditionText(name) {
  const text = job(name);
  const block = text.match(/\n {4}if: >-\n((?: {6}.*\n)+)/);
  const line = text.match(/\n {4}if: (?!>-)(.+)\n/);
  const expression = block?.[1] ?? line?.[1];
  assert.ok(expression, `The job ${name} has no condition`);
  return expression;
}

/**
 * Evaluate the condition of one job. Each condition of this workflow uses
 * only operators and literals that JavaScript reads in the same way.
 */
function runs(name, { github: context, inputs = {}, needs = {}, cancelled = false }) {
  const condition = new Function(
    "github",
    "inputs",
    "needs",
    "cancelled",
    `return (${conditionText(name)});`,
  );
  return Boolean(condition(context, inputs, needs, () => cancelled));
}

/**
 * Follow one run of the workflow, job by job, and return the jobs that start.
 * `tested` is the result of the first job when it starts, `suite` is the
 * result of the checks when they start, and `tip` is the output of the tip job.
 */
function simulate({ event = "push", inputs, tested, suite = "success", tip = "true" }) {
  const context = { repository_id: "1380751023", ref: "refs/heads/main", event_name: event };
  const needs = {};
  const started = [];
  let cancelled = false;
  const start = (name, result) => {
    if (!runs(name, { github: context, inputs, needs, cancelled })) {
      needs[name] = { result: "skipped", outputs: {} };
      return;
    }
    started.push(name);
    needs[name] = result;
  };
  start("tested", { result: "success", outputs: {}, ...tested });
  start("verify", { result: suite, outputs: {} });
  // A cancelled suite is a cancelled run.
  cancelled = needs.verify.result === "cancelled";
  start("tip", { result: "success", outputs: { deploy: tip } });
  start("deploy", { result: "success", outputs: {} });
  start("schema-migration", { result: "success", outputs: {} });
  start("web-cutover", { result: "success", outputs: {} });
  return started;
}

test("a push with a tested tree deploys with no suite", () => {
  assert.deepEqual(simulate({ tested: { outputs: { suite: "skip" } } }), [
    "tested",
    "tip",
    "deploy",
  ]);
});

test("a push with a tree that is not tested deploys after the suite", () => {
  assert.deepEqual(simulate({ tested: { outputs: { suite: "run" } } }), [
    "tested",
    "verify",
    "tip",
    "deploy",
  ]);
});

test("a fault of the first job runs the suite", () => {
  // The step failed and wrote no output, or the job failed before the step.
  for (const tested of [
    { outputs: {} },
    { outputs: { suite: "" } },
    { result: "failure", outputs: {} },
    { outputs: { suite: "true" } },
  ]) {
    assert.deepEqual(simulate({ tested }), ["tested", "verify", "tip", "deploy"]);
  }
});

test("a failed or cancelled suite deploys nothing", () => {
  for (const suite of ["failure", "cancelled"]) {
    assert.deepEqual(simulate({ tested: { outputs: { suite: "run" } }, suite }), [
      "tested",
      "verify",
    ]);
  }
});

test("a skipped suite deploys nothing without the output of the first job", () => {
  const context = { repository_id: "1380751023", ref: "refs/heads/main", event_name: "push" };
  for (const suite of ["run", "", undefined]) {
    const needs = {
      tested: { result: "success", outputs: { suite } },
      verify: { result: "skipped", outputs: {} },
      tip: { result: "success", outputs: { deploy: "true" } },
    };
    assert.equal(runs("tip", { github: context, needs }), false);
    assert.equal(runs("deploy", { github: context, needs }), false);
  }
});

test("a suite result that is not a success deploys nothing, also with the output skip", () => {
  const context = { repository_id: "1380751023", ref: "refs/heads/main", event_name: "push" };
  for (const result of ["failure", "cancelled"]) {
    const needs = {
      tested: { result: "success", outputs: { suite: "skip" } },
      verify: { result, outputs: {} },
      tip: { result: "success", outputs: { deploy: "true" } },
    };
    assert.equal(runs("tip", { github: context, needs }), false);
    assert.equal(runs("deploy", { github: context, needs }), false);
  }
});

test("a cancelled run starts no later job", () => {
  const context = { repository_id: "1380751023", ref: "refs/heads/main", event_name: "push" };
  const needs = {
    tested: { result: "success", outputs: { suite: "run" } },
    verify: { result: "success", outputs: {} },
    tip: { result: "success", outputs: { deploy: "true" } },
  };
  for (const name of ["verify", "tip", "deploy"]) {
    assert.equal(runs(name, { github: context, needs }), true);
    assert.equal(runs(name, { github: context, needs, cancelled: true }), false);
  }
});

test("the tip job still stops a superseded deploy, with and without the suite", () => {
  for (const suite of ["skip", "run"]) {
    const started = simulate({ tested: { outputs: { suite } }, tip: "false" });
    assert.equal(started.includes("tip"), true);
    assert.equal(started.includes("deploy"), false);
  }
  // A fault of the tip step gives no output, and the deploy job continues.
  assert.equal(
    simulate({ tested: { outputs: { suite: "skip" } }, tip: "" }).includes("deploy"),
    true,
  );
  // A fault of the tip job outside its step stops the deploy, as before.
  const context = { repository_id: "1380751023", ref: "refs/heads/main", event_name: "push" };
  const needs = {
    tested: { result: "success", outputs: { suite: "skip" } },
    verify: { result: "skipped", outputs: {} },
    tip: { result: "failure", outputs: {} },
  };
  assert.equal(runs("deploy", { github: context, needs }), false);
});

test("a manual dispatch keeps its suite and its job", () => {
  const preview = { action: "preview-web", target: "preview", consumers_fenced: false };
  const fence = { action: "production-fence", target: "production", consumers_fenced: true };
  const migrate = { action: "migrate", target: "production" };
  for (const inputs of [preview, fence]) {
    assert.deepEqual(simulate({ event: "workflow_dispatch", inputs }), ["verify", "web-cutover"]);
    for (const suite of ["failure", "cancelled"]) {
      assert.deepEqual(simulate({ event: "workflow_dispatch", inputs, suite }), ["verify"]);
    }
  }
  assert.deepEqual(simulate({ event: "workflow_dispatch", inputs: migrate }), ["schema-migration"]);
});

test("the output skip changes nothing for a manual dispatch", () => {
  // The first job does not start for a dispatch. This is the second barrier.
  const context = {
    repository_id: "1380751023",
    ref: "refs/heads/main",
    event_name: "workflow_dispatch",
  };
  const inputs = { action: "production-fence", target: "production", consumers_fenced: true };
  const needs = {
    tested: { result: "success", outputs: { suite: "skip" } },
    verify: { result: "skipped", outputs: {} },
    tip: { result: "skipped", outputs: {} },
  };
  assert.equal(runs("verify", { github: context, inputs, needs }), true);
  assert.equal(runs("web-cutover", { github: context, inputs, needs }), false);
  assert.equal(runs("tip", { github: context, inputs, needs }), false);
  assert.equal(runs("deploy", { github: context, inputs, needs }), false);
});

test("no job starts in another repository or on another branch", () => {
  const inputs = { action: "preview-web", target: "preview" };
  for (const context of [
    { repository_id: "1", ref: "refs/heads/main" },
    { repository_id: "1380751023", ref: "refs/heads/next" },
  ]) {
    for (const event of ["push", "workflow_dispatch"]) {
      const needs = {
        tested: { result: "success", outputs: { suite: "skip" } },
        verify: { result: "success", outputs: {} },
        tip: { result: "success", outputs: { deploy: "true" } },
      };
      for (const name of ["tested", "verify", "tip", "deploy", "schema-migration", "web-cutover"]) {
        const started = runs(name, { github: { ...context, event_name: event }, inputs, needs });
        assert.equal(started, false, `${name} starts for ${JSON.stringify(context)}`);
      }
    }
  }
});

test("each job after the first job has a status function in its condition", () => {
  // Without one, GitHub skips a job when a job before it in the chain is skipped.
  for (const name of ["verify", "tip", "deploy", "schema-migration", "web-cutover"]) {
    assert.match(conditionText(name), /^ *!cancelled\(\) &&\n/, `The job ${name} has none`);
  }
  assert.match(job("verify"), /\n {4}needs: tested\n/);
  assert.match(job("tip"), /\n {4}needs: \[tested, verify\]\n/);
  assert.match(job("deploy"), /\n {4}needs: \[tested, verify, tip\]\n/);
  assert.match(job("schema-migration"), /\n {4}needs: verify\n/);
  assert.match(job("web-cutover"), /\n {4}needs: verify\n/);
});

test("the first job reads GitHub with a read token, and its fault cannot stop a run", () => {
  const tested = job("tested");
  assert.doesNotMatch(tested, /\n {4}needs:/);
  assert.match(tested, /\n {4}continue-on-error: true\n/);
  assert.match(
    tested,
    /\n {4}permissions:\n {6}contents: read\n {6}checks: read\n {6}pull-requests: read\n {4}outputs:\n/,
  );
  assert.match(tested, /\n {6}suite: \$\{\{ steps\.tested\.outputs\.suite \}\}\n/);
  const step = tested.match(/\n {6}- id: tested\n[\s\S]*$/);
  assert.ok(step, "The job tested has no tested step");
  assert.match(step[0], /\n {8}run: node \.github\/workflows\/scripts\/deploy-tested-tree\.mjs\n/);
  assert.match(step[0], /\n {8}continue-on-error: true\n/);
});

test("the check Gate passes only when each other job of the checks passed", () => {
  const names = [...checks.slice(checks.indexOf("\njobs:\n")).matchAll(/\n {2}([a-z-]+):\n/g)].map(
    ([, name]) => name,
  );
  const gateJob = checks.slice(checks.indexOf("\n  gate:\n"));
  assert.match(gateJob, /^\n {2}gate:\n {4}name: Gate\n {4}if: always\(\)\n/);
  const needs = gateJob.match(/\n {4}needs: \[(.+)\]\n/);
  assert.ok(needs, "The job gate has no list of jobs");
  assert.deepEqual(
    needs[1].split(", "),
    names.filter((name) => name !== "gate"),
  );
  assert.match(gateJob, /\.filter\(\(\[, job\]\) => job\.result !== "success"\)/);
  assert.match(gateJob, /process\.exit\(1\)/);
});
