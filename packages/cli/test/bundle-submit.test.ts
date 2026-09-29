import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { prepareBundleSubmission } from "../src/bundle-submit.js";

const captures = vi.hoisted(() => ({
  downloadCaptures: vi.fn(async () => [{ shard: "linux", directory: "/tmp/source" }]),
}));
const bundles = vi.hoisted(() => ({
  combineBundles: vi.fn(async () => ({ run: { workflowAttempt: 1 } })),
}));
const signed = vi.hoisted(() => ({ bindSubmission: vi.fn(async () => ({})) }));
vi.mock("../src/github-artifacts.js", () => captures);
vi.mock("../src/bundles.js", () => bundles);
vi.mock("../src/signed-context.js", () => signed);
vi.mock("../src/http.js", () => ({
  serverOrigin: (value: string) => new URL(value),
  githubToken: async () => "token",
  request: async () => ({ state: "pending" }),
}));
const directories: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});
it("binds a verified carried artifact to a fresh current Submit bundle", async () => {
  const runnerTemp = await mkdtemp(join(tmpdir(), "visonaut-submit-test-"));
  directories.push(runnerTemp);
  const environment = {
    RUNNER_TEMP: runnerTemp,
    GITHUB_RUN_ID: "123",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_RUN_ATTEMPT: "2",
    VISONAUT_SERVER: "https://visonaut.com",
    VISONAUT_PACKAGE_SHA256: "b".repeat(64),
    VISONAUT_WORKFLOW_SOURCE_SHA: "c".repeat(40),
  };
  const prepared = await prepareBundleSubmission(["linux"], environment);
  expect(captures.downloadCaptures).toHaveBeenCalledWith(
    expect.objectContaining({ shards: ["linux"] }),
  );
  expect(bundles.combineBundles).toHaveBeenCalledWith(
    expect.objectContaining({ workflowAttempt: 2 }),
  );
  expect(signed.bindSubmission).toHaveBeenCalledOnce();
  expect(prepared.server).toBe("https://visonaut.com");
});
it("does not request artifact credentials for an invalid workflow pin", async () => {
  await expect(
    prepareBundleSubmission(["linux"], {
      VISONAUT_SERVER: "https://visonaut.com",
      VISONAUT_PACKAGE_SHA256: "b".repeat(64),
      VISONAUT_WORKFLOW_SOURCE_SHA: "main",
    }),
  ).rejects.toMatchObject({ exitCode: 4 });
  expect(captures.downloadCaptures).not.toHaveBeenCalled();
});
