import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtempDisposable } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readMainLead, selectDeploy } from "./deploy-tip.mjs";

const commit = "a".repeat(40);
const workflow = readFileSync(new URL("../deploy.yml", import.meta.url), "utf8");

/** The text of one job of the workflow, from its key to the next job key. */
function job(name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `The workflow has no job ${name}`);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
  // The line break before the next job key is the end of the last line of this job.
  return workflow.slice(start + 1, next === -1 ? undefined : start + 2 + next);
}

test("the run continues when main has no newer commit", async () => {
  const selection = await selectDeploy(commit, async () => 0);
  assert.equal(selection.deploy, true);
  assert.equal(selection.level, "notice");
});

test("the run of an older commit deploys nothing", async () => {
  const selection = await selectDeploy(commit, async () => 2);
  assert.equal(selection.deploy, false);
  assert.match(selection.message, /main has 2 newer commit/);
  assert.match(selection.message, /superseded/);
});

test("a run that cannot compare continues with a warning", async () => {
  const selection = await selectDeploy(commit, async () => {
    throw new Error("GitHub answered HTTP 503");
  });
  assert.equal(selection.deploy, true);
  assert.equal(selection.level, "warning");
  assert.match(selection.message, /GitHub answered HTTP 503/);
});

test("the comparison sends the token and returns the count of newer commits", async () => {
  const calls = [];
  const lead = await readMainLead(commit, "token-sentinel", async (url, options) => {
    calls.push({ url, options });
    return Response.json({ status: "ahead", ahead_by: 3, behind_by: 0 });
  });
  assert.equal(lead, 3);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `https://api.github.com/repos/ariakit/visonaut/compare/${commit}...main?per_page=1`,
  );
  assert.equal(calls[0].options.headers.Authorization, "Bearer token-sentinel");
  assert.equal(calls[0].options.redirect, "error");
});

test("a late answer of GitHub that has only older commits does not stop the run", async () => {
  // GitHub compares the commit with an older `main`: `main` is behind, not ahead.
  const lead = await readMainLead(commit, "token", async () =>
    Response.json({ status: "behind", ahead_by: 0, behind_by: 1 }),
  );
  assert.equal((await selectDeploy(commit, async () => lead)).deploy, true);
});

for (const [name, response] of [
  ["a failed status", () => new Response(null, { status: 503 })],
  ["an answer with no count", () => Response.json({ message: "Not Found" })],
  ["an answer with a count that is not a number", () => Response.json({ ahead_by: "1" })],
  ["an answer with a negative count", () => Response.json({ ahead_by: -1 })],
  ["an answer that is not JSON", () => new Response("<html>")],
]) {
  test(`the comparison cannot tell from ${name}`, async () => {
    await assert.rejects(readMainLead(commit, "token", async () => response()));
  });
}

test("the comparison sends no request for a value that is not a commit", async () => {
  let requests = 0;
  const request = async () => {
    requests += 1;
    return Response.json({ ahead_by: 1 });
  };
  await assert.rejects(readMainLead("main/../../other", "token", request), /not a commit/);
  await assert.rejects(readMainLead(undefined, "token", request), /not a commit/);
  assert.equal(requests, 0);
});

test("the script reports that it cannot tell when GitHub has no answer", async () => {
  await using directory = await mkdtempDisposable(resolve(tmpdir(), "visonaut-deploy-tip-"));
  const output = resolve(directory.path, "output");
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./deploy-tip.mjs", import.meta.url))],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        GITHUB_SHA: commit,
        GITHUB_OUTPUT: output,
        GH_TOKEN: "token",
        // No proxy listens on this port, so the request fails at once and never leaves the computer.
        NODE_USE_ENV_PROXY: "1",
        HTTPS_PROXY: "http://127.0.0.1:9",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^::warning::Cannot compare main with/);
  assert.equal(readFileSync(output, "utf8"), "deploy=true\n");
});

test("the deploy job is skipped when main moved during the suite", () => {
  const tip = job("tip");
  assert.match(tip, /\n {4}needs: verify\n/);
  assert.match(tip, /github\.event_name == 'push'/);
  assert.match(tip, /\n {6}deploy: \$\{\{ steps\.tip\.outputs\.deploy \}\}\n/);
  assert.match(tip, /run: node \.github\/workflows\/scripts\/deploy-tip\.mjs/);
  const deploy = job("deploy");
  assert.match(deploy, /\n {4}needs: \[verify, tip\]\n/);
  assert.match(deploy, /needs\.tip\.outputs\.deploy != 'false'/);
  // The hard stop stays: this step fails the job for a superseded commit.
  assert.match(deploy, /run: node \.github\/workflows\/scripts\/deploy-source\.mjs/);
});

test("the checks and the manual dispatch jobs do not wait for the tip test", () => {
  for (const name of ["verify", "schema-migration", "web-cutover"]) {
    const text = job(name);
    assert.doesNotMatch(text, /needs\.tip\./);
    assert.doesNotMatch(text, /\n {4}needs: .*tip/);
  }
});

test("a fault of the tip script cannot stop a deploy", () => {
  const step = job("tip").match(/\n {6}- id: tip\n[\s\S]*$/);
  assert.ok(step, "The job tip has no tip step");
  assert.match(step[0], /\n {8}continue-on-error: true\n/);
});
