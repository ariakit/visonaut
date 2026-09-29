import { afterEach, describe, expect, it, vi } from "vitest";
import { runWorkflowCommand } from "../src/workflow.js";

const submit = vi.hoisted(() => ({
  prepareBundleSubmission: vi.fn(async () => ({
    directory: "/tmp/combined",
    server: "https://visonaut.com",
  })),
}));
vi.mock("../src/bundle-submit.js", () => submit);
afterEach(() => vi.clearAllMocks());
const environment = {
  GITHUB_RUN_ID: "456",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SHA: "a".repeat(40),
  VISONAUT_SERVER: "https://visonaut.com",
};

describe("one supported workflow capture path", () => {
  it("submits an explicit unique required shard set", async () => {
    expect(
      await runWorkflowCommand(["submit", "--shard", "linux", "--shard", "safari"], environment),
    ).toEqual({ command: "submit", directory: "/tmp/combined", server: "https://visonaut.com" });
    expect(submit.prepareBundleSubmission).toHaveBeenCalledWith(["linux", "safari"], environment);
  });
  it("rejects duplicate or unsafe shard keys before artifact access", async () => {
    for (const shards of [
      ["linux", "linux"],
      ["../linux", "safari"],
    ]) {
      await expect(
        runWorkflowCommand(
          ["submit", "--shard", shards[0] ?? "", "--shard", shards[1] ?? ""],
          environment,
        ),
      ).rejects.toMatchObject({ exitCode: 2 });
    }
    expect(submit.prepareBundleSubmission).not.toHaveBeenCalled();
  });
  it("passes one selected origin to signed submission", async () => {
    await runWorkflowCommand(
      ["submit", "--shard", "linux", "--server", "https://visonaut.com"],
      {},
    );
    expect(submit.prepareBundleSubmission).toHaveBeenCalledWith(["linux"], {
      VISONAUT_SERVER: "https://visonaut.com",
    });
  });
  it("has no pack or per-shard encrypted upload path", async () => {
    expect(
      await runWorkflowCommand(["pack", "--dir", "/tmp/capture"], environment),
    ).toBeUndefined();
    expect(
      await runWorkflowCommand(["upload", "--bundle", "/tmp/capture.enc"], environment),
    ).toBeUndefined();
  });
});
