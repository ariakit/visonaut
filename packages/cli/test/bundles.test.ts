import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson } from "@visonaut/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { combineBundles } from "../src/bundles.js";
import { fixture } from "./fixture.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function bundlePair() {
  const linux = await fixture();
  const safari = await fixture();
  const output = await mkdtemp(join(tmpdir(), "visonaut-combined-test-"));
  directories.push(linux.directory, safari.directory, output);
  linux.manifest.shard.key = "linux";
  safari.manifest.shard.key = "safari";
  safari.manifest.profiles[0]!.profile.browser = "webkit";
  safari.manifest.profiles[0]!.digest = await digestJson(safari.manifest.profiles[0]!.profile);
  safari.manifest.captures[0]!.profileDigest = safari.manifest.profiles[0]!.digest;
  safari.manifest.captures[0]!.variant = {
    ...safari.manifest.captures[0]!.variant,
    key: "react-safari",
    browser: "webkit",
  };
  for (const source of [linux, safari]) {
    source.manifest.discovery = {
      executorDigest: "e".repeat(64),
      configurationDigest: await digestJson(source.manifest.shard.key),
      inventoryDigest: await digestJson(source.manifest.tests),
    };
    await writeFile(source.manifestPath, JSON.stringify(source.manifest));
  }
  return { linux, safari, output };
}

describe("combined signed submission", () => {
  it("preserves both browser captures and binds one manifest", async () => {
    const { linux, safari, output } = await bundlePair();
    const manifest = await combineBundles({
      bundles: [
        { shard: "linux", directory: linux.directory },
        { shard: "safari", directory: safari.directory },
      ],
      directory: output,
      packageDigest: "e".repeat(64),
      workflowAttempt: 1,
    });
    expect(manifest.shard.key).toBe("combined");
    expect(manifest.tests.map(({ id }) => id)).toEqual(["linux/test-1", "safari/test-1"]);
    expect(
      manifest.captures.map(({ ordinal, testId, variant }) => [ordinal, testId, variant.browser]),
    ).toEqual([
      [0, "linux/test-1", "chromium"],
      [1, "safari/test-1", "webkit"],
    ]);
    expect(manifest.profiles).toHaveLength(2);
    expect(manifest.captures[0]?.image.path).toBe(manifest.captures[1]?.image.path);
    expect(await readFile(join(output, manifest.captures[0]!.image.path))).toEqual(
      await readFile(join(linux.directory, linux.capture.image.path)),
    );
  });

  it("rejects a bundle from another tested commit", async () => {
    const { linux, safari, output } = await bundlePair();
    safari.manifest.run.testedSha = "f".repeat(40);
    await writeFile(safari.manifestPath, JSON.stringify(safari.manifest));
    await expect(
      combineBundles({
        bundles: [
          { shard: "linux", directory: linux.directory },
          { shard: "safari", directory: safari.directory },
        ],
        directory: output,
        packageDigest: "e".repeat(64),
        workflowAttempt: 1,
      }),
    ).rejects.toThrow("different workflow runs");
  });

  it("combines a carried pack with a pack from the current rerun", async () => {
    const { linux, safari, output } = await bundlePair();
    safari.manifest.run.workflowAttempt = 2;
    safari.manifest.shard.sourceAttempt = 2;
    await writeFile(safari.manifestPath, JSON.stringify(safari.manifest));
    const manifest = await combineBundles({
      bundles: [
        { shard: "linux", directory: linux.directory },
        { shard: "safari", directory: safari.directory },
      ],
      directory: output,
      packageDigest: "e".repeat(64),
      workflowAttempt: 2,
    });
    expect(manifest.run.workflowAttempt).toBe(2);
    expect(manifest.captures).toHaveLength(2);
  });

  it("rejects a pack from a later attempt than the signed job", async () => {
    const { linux, safari, output } = await bundlePair();
    safari.manifest.run.workflowAttempt = 2;
    safari.manifest.shard.sourceAttempt = 2;
    await writeFile(safari.manifestPath, JSON.stringify(safari.manifest));
    await expect(
      combineBundles({
        bundles: [
          { shard: "linux", directory: linux.directory },
          { shard: "safari", directory: safari.directory },
        ],
        directory: output,
        packageDigest: "e".repeat(64),
        workflowAttempt: 1,
      }),
    ).rejects.toThrow("later workflow attempt");
  });
});
