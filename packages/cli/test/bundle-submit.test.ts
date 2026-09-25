import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { prepareBundleSubmission } from "../src/bundle-submit.js";

const adapter = vi.hoisted(() => ({
  decryptTransfer: vi.fn(async (_file: string, directory: string) => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(directory, { recursive: true });
  }),
  bindSignedJob: vi.fn(async () => ({ jobId: "22" })),
  rebindManifest: vi.fn(async () => ({ artifactName: "visonaut-discovery-test" })),
}));
const bundles = vi.hoisted(() => ({
  combineBundles: vi.fn(async () => ({
    run: {
      repository: "ariakit/ariakit",
      repositoryId: "104133653",
      workflowRunId: "123",
      workflowAttempt: 1,
      testedSha: "a".repeat(40),
    },
  })),
}));

vi.mock("@visonaut/playwright/ci", () => adapter);
vi.mock("../src/bundles.js", () => bundles);
vi.mock("../src/http.js", () => ({
  githubToken: vi.fn(async () => "oidc-token"),
  serverOrigin: (value: string) => new URL(value),
}));

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

it("binds a carried pack to the current signed Submit attempt", async () => {
  const runnerTemp = await mkdtemp(join(tmpdir(), "visonaut-submit-test-"));
  directories.push(runnerTemp);
  const output = join(runnerTemp, "github-output");
  await writeFile(output, "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----")),
  );
  await prepareBundleSubmission([{ shard: "linux", file: join(runnerTemp, "linux.enc") }], {
    RUNNER_TEMP: runnerTemp,
    GITHUB_OUTPUT: output,
    GITHUB_RUN_ID: "123",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_SHA: "a".repeat(40),
    GH_TOKEN: "github-token",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.githubusercontent.com/test",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token",
    VISONAUT_SERVER: "https://visonaut.com",
    VISONAUT_PACKAGE_SHA256: "b".repeat(64),
    VISONAUT_WORKFLOW_SOURCE_SHA: "c".repeat(40),
  });
  expect(adapter.bindSignedJob).toHaveBeenCalledWith(
    expect.objectContaining({ workflowAttempt: 2 }),
  );
  expect(bundles.combineBundles).toHaveBeenCalledWith(
    expect.objectContaining({ workflowAttempt: 2 }),
  );
  expect(await readFile(output, "utf8")).toContain("name=visonaut-discovery-test");
});
