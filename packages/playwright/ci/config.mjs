import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const reporter = fileURLToPath(new URL("../dist/reporter.js", import.meta.url));

function within(root, file) {
  const relative = path.relative(root, file);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("The visual test directory must stay inside the candidate repository");
  }
}

function testPatterns(value) {
  const sources = JSON.parse(value);
  if (
    !Array.isArray(sources) ||
    !sources.length ||
    sources.length > 16 ||
    sources.some((source) => typeof source !== "string" || !source || source.length > 256)
  ) {
    throw new Error("The pinned workflow needs complete visual test patterns");
  }
  return sources.map((source) => new RegExp(source));
}

function webServers(value, root) {
  const servers = JSON.parse(value);
  if (!Array.isArray(servers) || !servers.length || servers.length > 8) {
    throw new Error("The pinned workflow needs its preview server commands");
  }
  return servers.map((server) => {
    if (
      !server ||
      typeof server.command !== "string" ||
      !server.command ||
      typeof server.cwd !== "string"
    ) {
      throw new Error("The pinned workflow has an invalid preview server");
    }
    const cwd = path.resolve(root, server.cwd);
    within(root, cwd);
    return { ...server, cwd, reuseExistingServer: false };
  });
}

/** Build one complete workflow-owned collection without reading candidate test selection. */
export async function createCaptureConfig({
  repositoryRoot,
  testDir,
  patterns,
  projectName,
  browser,
  device,
  baseUrl,
  shardKey,
  bundleSha256,
  retries = 1,
  workers = 4,
  webServerJson,
}) {
  if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true") {
    throw new Error("Workflow capture runs only in GitHub Actions");
  }
  if (
    !/^[a-f0-9]{64}$/.test(bundleSha256) ||
    !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(shardKey) ||
    !["chromium", "firefox", "webkit"].includes(browser) ||
    devices[device]?.defaultBrowserType !== browser ||
    typeof projectName !== "string" ||
    !projectName ||
    projectName.length > 80 ||
    !Number.isInteger(retries) ||
    retries < 0 ||
    retries > 3 ||
    !Number.isInteger(workers) ||
    workers < 1 ||
    workers > 16
  ) {
    throw new Error("The workflow capture project, device, or package digest is invalid");
  }
  const origin = new URL(baseUrl);
  if (
    origin.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(origin.hostname) ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("Visual captures need the pinned loopback app origin");
  }
  const root = await realpath(repositoryRoot);
  const selectedTestDir = await realpath(path.resolve(root, testDir));
  within(root, selectedTestDir);
  const results = path.join(root, ".visonaut-results");
  const environment = JSON.parse(await readFile(path.join(results, "environment.json"), "utf8"));
  const profile = environment.profile;
  if (
    !profile ||
    !["osImageDigest", "fontsDigest", "comparisonPolicyDigest"].every((key) =>
      /^[a-f0-9]{64}$/.test(profile[key]),
    ) ||
    typeof profile.comparisonEngineVersion !== "string"
  ) {
    throw new Error("The measured capture environment is invalid");
  }
  const workflowAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  if (!Number.isSafeInteger(workflowAttempt) || workflowAttempt < 1) {
    throw new Error("GitHub workflow attempt is invalid");
  }
  process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1";
  process.env.VISUAL_TEST = "true";
  return defineConfig({
    tsconfig: path.join(import.meta.dirname, "tsconfig.json"),
    testDir: selectedTestDir,
    testMatch: testPatterns(patterns),
    testIgnore: [],
    grep: /@visual/,
    grepInvert: [],
    forbidOnly: true,
    fullyParallel: true,
    workers,
    repeatEach: 1,
    retries,
    outputDir: path.join(root, ".visonaut-test-results"),
    reporter: [
      ["github"],
      ["dot"],
      [
        reporter,
        {
          outputFile: path.join(results, "manifest.json"),
          run: {
            repository: process.env.GITHUB_REPOSITORY,
            repositoryId: process.env.GITHUB_REPOSITORY_ID,
            workflowRunId: process.env.GITHUB_RUN_ID,
            workflowAttempt,
            testedSha: process.env.GITHUB_SHA,
            // Rebound to the signed reusable-workflow source by the upload job.
            planDigest: bundleSha256,
          },
          shard: { key: shardKey, jobId: "1", sourceAttempt: workflowAttempt },
          discovery: { executorDigest: bundleSha256, repositoryRoot: root },
        },
      ],
    ],
    webServer: webServers(webServerJson, root),
    projects: [
      {
        name: projectName,
        metadata: { visonaut: { profile } },
        use: {
          ...devices[device],
          browserName: browser,
          baseURL: origin.href,
          locale: "en-US",
          timezoneId: "UTC",
          reducedMotion: "reduce",
          screenshot: "only-on-failure",
          trace: "on-first-retry",
          ...(browser === "chromium" ? { channel: "chromium" } : {}),
          launchOptions: { timeout: 45_000 },
        },
      },
    ],
  });
}
