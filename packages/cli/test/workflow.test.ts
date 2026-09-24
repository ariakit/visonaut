import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";
import { runWorkflowCommand } from "../src/workflow.js";
import { fixture } from "./fixture.js";

const adapter = vi.hoisted(() => ({
  loadTransferPublicKey: vi.fn(async () => "public-key"),
  encryptTransferWithPublicKey: vi.fn(async () => {}),
  uploadEncryptedTransfer: vi.fn(async () => ({
    directory: "/tmp/upload",
    server: "https://visonaut.com",
  })),
}));

vi.mock("@visonaut/playwright/ci", () => adapter);

const directories: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

const environment = {
  GITHUB_RUN_ID: "456",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SHA: "a".repeat(40),
  VISONAUT_SERVER: "https://visonaut.com",
};

describe("workflow artifact commands", () => {
  it("packs only a validated capture from the current unsigned run", async () => {
    const capture = await fixture();
    directories.push(capture.directory);
    const output = join(capture.directory, "capture.enc");
    const code = await runCli({
      argv: ["pack", "--dir", capture.directory, "--output", output],
      environment: { ...environment, GITHUB_SHA: capture.manifest.run.testedSha },
    });
    expect(code).toBe(0);
    expect(adapter.loadTransferPublicKey).toHaveBeenCalledOnce();
    expect(adapter.encryptTransferWithPublicKey).toHaveBeenCalledWith(
      await realpath(capture.directory),
      capture.manifest.shard.key,
      output,
      "public-key",
      expect.objectContaining({ GITHUB_RUN_ID: "456" }),
    );
  });

  it("refuses to pack when candidate tests can request OIDC", async () => {
    const capture = await fixture();
    directories.push(capture.directory);
    const code = await runCli({
      argv: ["pack", "--dir", capture.directory, "--output", join(capture.directory, "out.enc")],
      environment: { ...environment, ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.test" },
      stderr: () => {},
    });
    expect(code).toBe(4);
    expect(adapter.loadTransferPublicKey).not.toHaveBeenCalled();
  });

  it("routes an encrypted bundle to the separate signed upload", async () => {
    const runnerTemp = await mkdtemp(join(tmpdir(), "visonaut-cli-workflow-"));
    directories.push(runnerTemp);
    const result = await runWorkflowCommand(
      ["upload", "--bundle", join(runnerTemp, "capture.enc")],
      {
        ...environment,
        RUNNER_TEMP: runnerTemp,
        VISONAUT_SHARD: "linux",
        VISONAUT_COMPARISON_POLICY_DIGEST: "b".repeat(64),
        VISONAUT_PACKAGE_SHA256: "c".repeat(64),
        VISONAUT_FONT_PACKAGE: "@fontsource-variable/inter",
      },
    );
    expect(result).toEqual({ directory: "/tmp/upload", server: "https://visonaut.com" });
    expect(adapter.uploadEncryptedTransfer).toHaveBeenCalledWith({
      options: {
        "--shard": "linux",
        "--comparison-policy-digest": "b".repeat(64),
        "--bundle-sha256": "c".repeat(64),
        "--input": join(runnerTemp, "capture.enc"),
        "--output-directory": join(runnerTemp, "visonaut-upload-linux"),
        "--font-package": "@fontsource-variable/inter",
      },
      environment: expect.objectContaining({ VISONAUT_SHARD: "linux" }),
    });
  });

  it("allows a signed upload that uses only system fonts", async () => {
    const runnerTemp = await mkdtemp(join(tmpdir(), "visonaut-cli-workflow-"));
    directories.push(runnerTemp);
    await runWorkflowCommand(["upload", "--bundle", join(runnerTemp, "capture.enc")], {
      ...environment,
      RUNNER_TEMP: runnerTemp,
      VISONAUT_SHARD: "linux",
      VISONAUT_COMPARISON_POLICY_DIGEST: "b".repeat(64),
      VISONAUT_PACKAGE_SHA256: "c".repeat(64),
    });
    expect(adapter.uploadEncryptedTransfer).toHaveBeenCalledWith({
      options: expect.not.objectContaining({ "--font-package": expect.anything() }),
      environment: expect.anything(),
    });
  });
});
