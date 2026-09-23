import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { bindSignedJob } from "../../ci/context.mjs";
import { createTrustedPlaywrightConfig } from "../../ci/config.mjs";
import { createTrustedPlan, verifyTrustedPlan } from "../../ci/plan.mjs";
import { writeRenderContext } from "../../ci/render-context.mjs";

const sha = "a".repeat(40);
const lock = {
  packages: {
    "node_modules/@visonaut/playwright": {
      version: "0.1.0",
      integrity: `sha512-${"A".repeat(86)}==`,
    },
    "node_modules/visonaut": { version: "0.1.0", integrity: `sha512-${"B".repeat(86)}==` },
  },
};

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "visonaut-ci-test-"));
  await writeFile(path.join(directory, "package-lock.json"), JSON.stringify(lock));
  await writeFile(
    path.join(directory, "settings.json"),
    JSON.stringify({ repository: "ariakit/example" }),
  );
  return directory;
}

test("trusted plan pins the executor files and package integrity", async () => {
  const directory = await fixture();
  try {
    const { plan } = await createTrustedPlan({
      directory,
      settings: { repositoryId: "123", workflow: ".github/workflows/visonaut.yml" },
      shards: [
        { key: "chromium", jobName: "capture / chromium", collection: { projectName: "chrome" } },
      ],
      environmentProfileDigests: { chromium: ["c".repeat(64)] },
    });
    const planFile = `${directory}.plan`;
    await writeFile(planFile, JSON.stringify(plan));
    assert.deepEqual((await verifyTrustedPlan({ directory, planFile })).plan, plan);
    await writeFile(
      path.join(directory, "settings.json"),
      JSON.stringify({ repository: "ariakit/other" }),
    );
    await assert.rejects(verifyTrustedPlan({ directory, planFile }), /does not match/);
  } finally {
    await rm(`${directory}.plan`, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test("plan rejects missing npm integrity before creating a capture plan", async () => {
  const directory = await fixture();
  try {
    await writeFile(path.join(directory, "package-lock.json"), JSON.stringify({ packages: {} }));
    await assert.rejects(
      createTrustedPlan({
        directory,
        settings: { repositoryId: "123", workflow: ".github/workflows/visonaut.yml" },
        shards: [{ key: "chromium", jobName: "capture / chromium", collection: {} }],
        environmentProfileDigests: { chromium: ["c".repeat(64)] },
      }),
      /complete package integrity mode/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("prepublication plan binds both reviewed package tarball hashes", async () => {
  const directory = await fixture();
  try {
    await writeFile(path.join(directory, "package-lock.json"), JSON.stringify({ packages: {} }));
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({
        dependencies: { "@playwright/test": "1.63.0" },
      }),
    );
    const settings = {
      packages: {
        playwright: { sha256: "a".repeat(64) },
        cli: { sha256: "b".repeat(64) },
      },
    };
    await writeFile(path.join(directory, "settings.json"), JSON.stringify(settings));
    const { executorDigest } = await createTrustedPlan({
      directory,
      settings: { ...settings, repositoryId: "123", workflow: ".github/workflows/visonaut.yml" },
      shards: [{ key: "chromium", jobName: "capture / chromium", collection: {} }],
      environmentProfileDigests: { chromium: ["c".repeat(64)] },
    }).then(({ plan }) => ({ executorDigest: plan.discovery.executorDigest }));
    assert.match(executorDigest, /^[a-f0-9]{64}$/);
    settings.packages.cli.sha256 = "d".repeat(64);
    await writeFile(path.join(directory, "settings.json"), JSON.stringify(settings));
    const changed = await createTrustedPlan({
      directory,
      settings: { ...settings, repositoryId: "123", workflow: ".github/workflows/visonaut.yml" },
      shards: [{ key: "chromium", jobName: "capture / chromium", collection: {} }],
      environmentProfileDigests: { chromium: ["c".repeat(64)] },
    });
    assert.notEqual(changed.plan.discovery.executorDigest, executorDigest);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("render context binds to tested SHA and refuses malformed identity", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "visonaut-context-test-"));
  try {
    await writeRenderContext({
      directory,
      workflowRunId: "123",
      workflowAttempt: 1,
      testedSha: sha,
    });
    const value = JSON.parse(await readFile(path.join(directory, "context.json"), "utf8"));
    assert.deepEqual(value, {
      workflowRunId: "123",
      workflowAttempt: 1,
      testedSha: sha,
      jobId: "1",
    });
    await assert.rejects(
      writeRenderContext({ directory, workflowRunId: "bad", workflowAttempt: 1, testedSha: sha }),
      /GitHub run/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("signed job binding selects only the exact check run and browser", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "visonaut-job-test-"));
  try {
    const token = `e.${Buffer.from(JSON.stringify({ check_run_id: "789" })).toString("base64url")}.s`;
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (calls.length === 1) return { ok: true, json: async () => ({ value: token }) };
      return {
        ok: true,
        json: async () => ({
          jobs: [
            {
              name: "capture / firefox",
              id: 456,
              check_run_url: "https://api.github.com/repos/ariakit/example/check-runs/789",
            },
            {
              name: "capture / chromium",
              id: 999,
              check_run_url: "https://api.github.com/repos/ariakit/example/check-runs/999",
            },
          ],
        }),
      };
    };
    const context = await bindSignedJob({
      directory,
      repository: "ariakit/example",
      server: "https://visonaut.example",
      browser: "firefox",
      workflowRunId: "123",
      workflowAttempt: 2,
      testedSha: sha,
      tokenRequestUrl: "https://token.actions.githubusercontent.com/request",
      tokenRequestToken: "disposable-test-token",
      githubToken: "disposable-test-token",
      fetchImpl,
    });
    assert.equal(context.jobId, "456");
    assert.match(calls[0], /audience=https%3A%2F%2Fvisonaut\.example/);
    assert.match(calls[1], /\/ariakit\/example\/actions\/runs\/123\/attempts\/2\/jobs/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("capture config uses only a pinned plan and measured allowlisted runner", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "visonaut-config-test-"));
  const directory = path.join(root, "executor");
  const results = path.join(root, "app/.visonaut-results");
  const planFile = path.join(root, "visonaut-plan.json");
  const settings = {
    repository: "ariakit/example",
    repositoryId: "123",
    workflow: ".github/workflows/visonaut.yml",
  };
  const oldCI = process.env.CI;
  const oldActions = process.env.GITHUB_ACTIONS;
  const oldVisual = process.env.VISUAL_TEST;
  const oldFontWait = process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
  try {
    await mkdir(directory);
    await mkdir(results, { recursive: true });
    await writeFile(path.join(directory, "package-lock.json"), JSON.stringify(lock));
    await writeFile(path.join(directory, "settings.json"), JSON.stringify(settings));
    const digest = "c".repeat(64);
    const { plan } = await createTrustedPlan({
      directory,
      settings,
      shards: [
        {
          key: "chromium",
          jobName: "capture / chromium",
          collection: {
            projectName: "chrome",
            testDir: "app/src",
            testMatch: ["**/test-browser.ts"],
            testIgnore: [],
            grep: [{ source: "@visual", flags: "" }],
            grepInvert: [],
            shard: null,
            repeatEach: 1,
          },
        },
      ],
      environmentProfileDigests: { chromium: [digest] },
    });
    await writeFile(planFile, JSON.stringify(plan));
    await writeFile(
      path.join(results, "environment-chromium.json"),
      JSON.stringify({
        browser: "chromium",
        profile: {},
        environmentProfiles: [{ digest }],
      }),
    );
    await writeFile(
      path.join(results, "context.json"),
      JSON.stringify({
        workflowRunId: "123",
        workflowAttempt: 1,
        testedSha: sha,
        jobId: "1",
      }),
    );
    process.env.CI = "true";
    process.env.GITHUB_ACTIONS = "true";
    delete process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
    const options = {
      directory,
      planFile,
      repositoryRoot: root,
      browserName: "chromium",
      project: { name: "chrome", device: "Desktop Chrome" },
      settings,
      webServer: [],
    };
    const config = await createTrustedPlaywrightConfig(options);
    assert.deepEqual(config.testMatch, ["**/test-browser.ts"]);
    assert.equal(config.forbidOnly, true);
    assert.equal(config.projects[0].name, "chrome");
    assert.equal(process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY, "1");
    await writeFile(
      path.join(results, "environment-chromium.json"),
      JSON.stringify({
        browser: "chromium",
        profile: {},
        environmentProfiles: [{ digest: "d".repeat(64) }],
      }),
    );
    await assert.rejects(
      createTrustedPlaywrightConfig(options),
      /outside the trusted capture plan/,
    );
  } finally {
    if (oldCI === undefined) delete process.env.CI;
    else process.env.CI = oldCI;
    if (oldActions === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = oldActions;
    if (oldVisual === undefined) delete process.env.VISUAL_TEST;
    else process.env.VISUAL_TEST = oldVisual;
    if (oldFontWait === undefined) delete process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
    else process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = oldFontWait;
    await rm(root, { recursive: true, force: true });
  }
});
