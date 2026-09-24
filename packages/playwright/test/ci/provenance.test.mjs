import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { bindSignedJob, githubOidcRequestUrl } from "../../ci/context.mjs";
import { createCaptureConfig } from "../../ci/config.mjs";
import { measureEnvironment } from "../../ci/environment.mjs";
import { writeRenderContext } from "../../ci/render-context.mjs";
import { parseArguments, render } from "../../ci/runner.mjs";
import { trustedServer } from "../../ci/settings.mjs";

const testedSha = "a".repeat(40);
const workflowSha = "b".repeat(40);
const bundleSha256 = "c".repeat(64);
const policyDigest = "d".repeat(64);

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "visonaut-ci-test-"));
  await mkdir(path.join(root, "app/src"), { recursive: true });
  await mkdir(path.join(root, "fonts"));
  await writeFile(path.join(root, "fonts/fixture.ttf"), "synthetic font");
  await writeFile(path.join(root, "app/package.json"), "{}\n");
  await mkdir(path.join(root, ".visonaut-results"));
  await writeFile(
    path.join(root, ".visonaut-results/environment.json"),
    JSON.stringify({
      profile: {
        osImageDigest: "e".repeat(64),
        fontsDigest: "f".repeat(64),
        comparisonPolicyDigest: policyDigest,
        comparisonEngineVersion: "rgba-visible-1",
      },
    }),
  );
  return root;
}

function githubEnvironment(root) {
  return {
    CI: "true",
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "ariakit/example",
    GITHUB_REPOSITORY_ID: "123",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_RUN_ID: "456",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_SHA: testedSha,
    GITHUB_WORKSPACE: root,
  };
}

test("render options are generic and reject a malformed shard or missing policy", () => {
  const flags = [
    "--repository-root",
    "/tmp/work",
    "--test-dir",
    "app/src",
    "--test-patterns",
    '["/test[^/]*-browser"]',
    "--project",
    "desktop",
    "--browser",
    "chromium",
    "--device",
    "Desktop Chrome",
    "--base-url",
    "http://localhost:4321",
    "--shard",
    "desktop-42",
    "--comparison-policy-digest",
    policyDigest,
    "--bundle-sha256",
    bundleSha256,
    "--output",
    "/tmp/shard.enc",
  ];
  assert.equal(parseArguments(["render", ...flags]).options["--shard"], "desktop-42");
  assert.throws(
    () => parseArguments(["render", ...flags.slice(0, -4), "--output", "/tmp/shard.enc"]),
    /missing an option/,
  );
  assert.throws(() => {
    const invalid = [...flags];
    invalid[invalid.indexOf("--shard") + 1] = "../escape";
    parseArguments(["render", ...invalid]);
  }, /invalid/);
  const uploadFlags = [
    "upload",
    "--shard",
    "desktop-42",
    "--comparison-policy-digest",
    policyDigest,
    "--bundle-sha256",
    bundleSha256,
    "--input",
    "/tmp/shard.enc",
    "--output-directory",
    "/tmp/upload",
  ];
  assert.equal(parseArguments(uploadFlags).options["--shard"], "desktop-42");
  assert.throws(() => parseArguments([...uploadFlags, "--workflow-sha", workflowSha]), /known/);
});

test("render rejects OIDC before reading any candidate workspace", async () => {
  await assert.rejects(
    render({ options: {}, environment: { ACTIONS_ID_TOKEN_REQUEST_URL: "present" } }),
    /must not receive GitHub OIDC/,
  );
});

test("signed upload only sends GitHub identity to Visonaut-owned origins", () => {
  assert.equal(trustedServer({}), "https://visonaut.com");
  assert.equal(
    trustedServer({ VISONAUT_SERVER: "https://diagnostics.visonaut.com" }),
    "https://diagnostics.visonaut.com",
  );
  assert.equal(
    trustedServer({ VISONAUT_SERVER: "https://preview.visonaut.com" }),
    "https://preview.visonaut.com",
  );
  for (const server of [
    "http://diagnostics.visonaut.com",
    "https://visonaut.com.evil.example",
    "https://visonaut.com@evil.example",
    "https://visonaut.com/private",
  ]) {
    assert.throws(() => trustedServer({ VISONAUT_SERVER: server }), /untrusted/);
  }
});

test("GitHub identity requests accept the runner endpoint but reject altered authorities", () => {
  const audience = "https://diagnostics.visonaut.com";
  const request = githubOidcRequestUrl(
    "https://run.actions.githubusercontent.com/id-token?api-version=2.0",
    audience,
  );
  assert.equal(request.searchParams.get("audience"), audience);
  for (const endpoint of [
    "http://run.actions.githubusercontent.com/id-token",
    "https://run.actions.githubusercontent.com.evil.example/id-token",
    "https://user@run.actions.githubusercontent.com/id-token",
    "https://run.actions.githubusercontent.com/id-token#fragment",
  ]) {
    assert.throws(() => githubOidcRequestUrl(endpoint, audience), /GitHub OIDC/);
  }
});

test("workflow-owned config forces a complete visual project and ignores candidate selection", async () => {
  const root = await fixture();
  const environment = githubEnvironment(root);
  const previous = Object.fromEntries(
    [
      "CI",
      "GITHUB_ACTIONS",
      "GITHUB_REPOSITORY",
      "GITHUB_REPOSITORY_ID",
      "GITHUB_RUN_ID",
      "GITHUB_RUN_ATTEMPT",
      "GITHUB_SHA",
    ].map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, environment);
  try {
    await writeFile(
      path.join(root, "app/playwright.config.ts"),
      'export default { testMatch: ["nothing"], testIgnore: ["**/*"], grepInvert: /@visual/ };\n',
    );
    const config = await createCaptureConfig({
      repositoryRoot: root,
      testDir: "app/src",
      patterns: '["/test[^/]*-browser","/tests/[^/]*-browser"]',
      projectName: "desktop",
      browser: "chromium",
      device: "Desktop Chrome",
      baseUrl: "http://localhost:4321",
      shardKey: "desktop-42",
      bundleSha256,
      webServerJson: JSON.stringify([
        { command: "pnpm run preview --port 4321", cwd: "app", port: 4321 },
      ]),
    });
    assert.equal(config.projects.length, 1);
    assert.equal(config.projects[0].name, "desktop");
    assert.equal(config.projects[0].use.browserName, "chromium");
    assert.equal(config.projects[0].use.baseURL, "http://localhost:4321/");
    assert.deepEqual(config.testIgnore, []);
    assert.deepEqual(config.grepInvert, []);
    assert.equal(config.grep.source, "@visual");
    assert.equal(config.testMatch.length, 2);
    assert.equal(config.webServer[0].cwd, path.join(await realpath(root), "app"));
    await assert.rejects(
      createCaptureConfig({
        repositoryRoot: root,
        testDir: "app/src",
        patterns: '["/test[^/]*-browser"]',
        projectName: "desktop",
        browser: "webkit",
        device: "Desktop Chrome",
        baseUrl: "http://localhost:4321",
        shardKey: "desktop-42",
        bundleSha256,
        webServerJson: '[{"command":"true","cwd":"app"}]',
      }),
      /project, device/,
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("environment records font and OS base without a hypothetical profile catalogue", async () => {
  const root = await fixture();
  try {
    const result = await measureEnvironment({
      appPackageFile: path.join(root, "app/package.json"),
      outputDirectory: path.join(root, "measured"),
      comparisonPolicyDigest: policyDigest,
      comparisonEngineVersion: "rgba-visible-1",
      systemFontRoots: [path.join(root, "fonts")],
    });
    assert.equal(result.fonts.length, 1);
    assert.equal(result.profile.comparisonPolicyDigest, policyDigest);
    assert.equal(Object.hasOwn(result, "environmentProfiles"), false);
    const file = JSON.parse(await readFile(path.join(root, "measured/environment.json"), "utf8"));
    assert.equal(file.profile.fontsDigest, result.profile.fontsDigest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("signed upload job selects its exact check run and pinned workflow source", async () => {
  const root = await fixture();
  try {
    const token = `e.${Buffer.from(
      JSON.stringify({ check_run_id: "789", job_workflow_sha: workflowSha }),
    ).toString("base64url")}.s`;
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (calls.length === 1) return { ok: true, json: async () => ({ value: token }) };
      return {
        ok: true,
        json: async () => ({
          jobs: [
            {
              name: "App / Visonaut / upload / desktop-42",
              id: 456,
              check_run_url: "https://api.github.com/repos/ariakit/example/check-runs/789",
            },
          ],
        }),
      };
    };
    const context = await bindSignedJob({
      directory: root,
      repository: "ariakit/example",
      server: "https://visonaut.com",
      shard: "desktop-42",
      workflowRunId: "456",
      workflowAttempt: 2,
      testedSha,
      tokenRequestUrl: "https://run.actions.githubusercontent.com/request",
      tokenRequestToken: "disposable-test-token",
      githubToken: "disposable-test-token",
      fetchImpl,
    });
    assert.equal(context.jobId, "456");
    assert.equal(context.workflowSha, workflowSha);
    assert.match(calls[1], /page=1/);
    const invalidToken = `e.${Buffer.from(
      JSON.stringify({ check_run_id: "789", job_workflow_sha: "not-a-sha" }),
    ).toString("base64url")}.s`;
    await assert.rejects(
      bindSignedJob({
        directory: path.join(root, "missing"),
        repository: "ariakit/example",
        server: "https://visonaut.com",
        shard: "desktop-42",
        workflowRunId: "456",
        workflowAttempt: 2,
        testedSha,
        tokenRequestUrl: "https://run.actions.githubusercontent.com/request",
        tokenRequestToken: "disposable-test-token",
        githubToken: "disposable-test-token",
        fetchImpl: async () => ({ ok: true, json: async () => ({ value: invalidToken }) }),
      }),
      /no reusable workflow source SHA/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("direct upload binds the approved workflow blob to this tested commit", async () => {
  const root = await fixture();
  try {
    const token = `e.${Buffer.from(
      JSON.stringify({ check_run_id: "789", job_workflow_sha: testedSha }),
    ).toString("base64url")}.s`;
    const fetchImpl = async (url) => ({
      ok: true,
      json: async () =>
        String(url).includes("api.github.com")
          ? {
              jobs: [
                {
                  name: "App / upload / desktop-42",
                  id: 456,
                  check_run_url: "https://api.github.com/repos/ariakit/example/check-runs/789",
                },
              ],
            }
          : { value: token },
    });
    const request = {
      directory: root,
      repository: "ariakit/example",
      server: "https://visonaut.com",
      shard: "desktop-42",
      workflowRunId: "456",
      workflowAttempt: 2,
      testedSha,
      trustedWorkflowSha: workflowSha,
      tokenRequestUrl: "https://run.actions.githubusercontent.com/request",
      tokenRequestToken: "disposable-test-token",
      githubToken: "disposable-test-token",
      fetchImpl,
    };
    const context = await bindSignedJob(request);
    assert.equal(context.workflowSha, workflowSha);
    await assert.rejects(
      bindSignedJob({
        ...request,
        directory: path.join(root, "invalid"),
        testedSha: "c".repeat(40),
      }),
      /did not use this commit's app workflow/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("render context binds the tested commit", async () => {
  const root = await fixture();
  try {
    const value = await writeRenderContext({
      directory: path.join(root, "context"),
      workflowRunId: "456",
      workflowAttempt: 2,
      testedSha,
    });
    assert.equal(value.testedSha, testedSha);
    await assert.rejects(
      writeRenderContext({
        directory: path.join(root, "invalid"),
        workflowRunId: "bad",
        workflowAttempt: 2,
        testedSha,
      }),
      /GitHub run/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
