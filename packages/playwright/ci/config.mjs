import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { verifyTrustedPlan } from "./plan.mjs";

const reporter = fileURLToPath(new URL("../dist/reporter.js", import.meta.url));

export async function createTrustedPlaywrightConfig({
  directory,
  planFile,
  repositoryRoot,
  browserName,
  project,
  settings,
  webServer,
}) {
  if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true") {
    throw new Error("Trusted captures run only in GitHub Actions");
  }
  if (!/^(chromium|firefox|webkit)$/.test(browserName) || !devices[project?.device]) {
    throw new Error("Unknown browser shard or Playwright device");
  }
  const { plan, planDigest } = await verifyTrustedPlan({ directory, planFile });
  if (
    plan.repositoryId !== settings.repositoryId ||
    plan.workflow !== settings.workflow ||
    JSON.stringify(plan.invocation) !==
      JSON.stringify(["playwright", "test", "--config", "playwright.config.mjs"])
  ) {
    throw new Error("Trusted plan does not match the repository configuration");
  }
  const shard = plan.shards.find((entry) => entry.key === browserName);
  if (!shard || shard.collection.projectName !== project.name) {
    throw new Error("Trusted plan has no matching browser collection");
  }
  const app = path.join(repositoryRoot, "app");
  const environment = JSON.parse(
    await readFile(path.join(app, `.visonaut-results/environment-${browserName}.json`), "utf8"),
  );
  const context = JSON.parse(
    await readFile(path.join(app, ".visonaut-results/context.json"), "utf8"),
  );
  if (
    environment.browser !== browserName ||
    !Array.isArray(environment.environmentProfiles) ||
    !environment.environmentProfiles.length ||
    environment.environmentProfiles.some(
      (entry) => !shard.environmentProfileDigests.includes(entry.digest),
    )
  ) {
    throw new Error("The runner environment is outside the trusted capture plan");
  }
  // Playwright's internal font promise can stay pending in Firefox after a
  // navigation. The visual adapter waits for the font faces themselves.
  process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = "1";
  process.env.VISUAL_TEST = "true";
  return defineConfig({
    tsconfig: path.join(directory, "tsconfig.json"),
    forbidOnly: true,
    fullyParallel: true,
    workers: "100%",
    reportSlowTests: null,
    testDir: path.join(app, "src"),
    testMatch: shard.collection.testMatch,
    testIgnore: [],
    grep: /@visual/,
    grepInvert: [],
    repeatEach: 1,
    retries: browserName === "webkit" ? 3 : browserName === "firefox" ? 2 : 1,
    outputDir: path.join(app, ".visonaut-test-results"),
    reporter: [
      ["github"],
      ["dot"],
      [
        reporter,
        {
          outputFile: path.join(app, ".visonaut-results/manifest.json"),
          repositoryRoot,
          plan,
          run: {
            repository: settings.repository,
            repositoryId: settings.repositoryId,
            workflowRunId: context.workflowRunId,
            workflowAttempt: context.workflowAttempt,
            testedSha: context.testedSha,
            planDigest,
          },
          shard: {
            key: browserName,
            jobId: context.jobId,
            sourceAttempt: context.workflowAttempt,
          },
        },
      ],
    ],
    webServer,
    projects: [
      {
        name: project.name,
        metadata: { visonaut: { profile: environment.profile } },
        use: {
          ...devices[project.device],
          viewport: { width: 1280, height: 800 },
          baseURL: "http://localhost:4321",
          locale: "en-US",
          timezoneId: "UTC",
          reducedMotion: "reduce",
          screenshot: "only-on-failure",
          trace: "on-first-retry",
          ...(browserName === "chromium" ? { channel: "chromium" } : {}),
          launchOptions: { timeout: 45_000 },
        },
      },
    ],
  });
}
