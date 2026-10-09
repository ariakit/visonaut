import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FIXED_DIGEST } from "@visonaut/protocol";
import type { Manifest } from "@visonaut/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { combineBundles } from "../src/bundles.js";
import { bundlePair } from "./fixture.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("combined signed submission", () => {
  it("preserves both browser captures and binds one manifest", async () => {
    const { linux, safari, output } = await bundlePair(directories);
    const manifest = await combineBundles({
      bundles: [
        { shard: "linux", directory: linux.directory },
        { shard: "safari", directory: safari.directory },
      ],
      directory: output,
      workflowAttempt: 1,
    });
    expect(manifest.shard.key).toBe("combined");
    expect(manifest.run.planDigest).toBe(FIXED_DIGEST);
    expect(manifest.discovery?.executorDigest).toBe(FIXED_DIGEST);
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
    const { linux, safari, output } = await bundlePair(directories);
    safari.manifest.run.testedSha = "f".repeat(40);
    await writeFile(safari.manifestPath, JSON.stringify(safari.manifest));
    await expect(
      combineBundles({
        bundles: [
          { shard: "linux", directory: linux.directory },
          { shard: "safari", directory: safari.directory },
        ],
        directory: output,
        workflowAttempt: 1,
      }),
    ).rejects.toThrow("different workflow runs");
  });

  it("rejects a bundle of another shard", async () => {
    const { linux, safari, output } = await bundlePair(directories);
    safari.manifest.shard.key = "other";
    await writeFile(safari.manifestPath, JSON.stringify(safari.manifest));
    await expect(
      combineBundles({
        bundles: [
          { shard: "linux", directory: linux.directory },
          { shard: "safari", directory: safari.directory },
        ],
        directory: output,
        workflowAttempt: 1,
      }),
    ).rejects.toMatchObject({ message: "A capture bundle has the wrong shard.", exitCode: 4 });
  });

  it("rejects a bundle with no discovery record", async () => {
    const { linux, safari, output } = await bundlePair(directories);
    delete safari.manifest.discovery;
    await writeFile(safari.manifestPath, JSON.stringify(safari.manifest));
    await expect(
      combineBundles({
        bundles: [
          { shard: "linux", directory: linux.directory },
          { shard: "safari", directory: safari.directory },
        ],
        directory: output,
        workflowAttempt: 1,
      }),
    ).rejects.toMatchObject({
      message:
        "A capture bundle has no discovery record. Set the discovery option of the reporter.",
      exitCode: 4,
    });
  });

  // An adapter of an older release sends a package digest of its own.
  it.each([
    [
      "another run.planDigest",
      (manifest: Manifest) => {
        manifest.run.planDigest = "e".repeat(64);
      },
    ],
    [
      "another discovery.executorDigest",
      (manifest: Manifest) => {
        if (manifest.discovery) {
          manifest.discovery.executorDigest = "e".repeat(64);
        }
      },
    ],
  ])("rejects a bundle with %s", async (_name, change) => {
    const { linux, safari, output } = await bundlePair(directories);
    change(safari.manifest);
    await writeFile(safari.manifestPath, JSON.stringify(safari.manifest));
    await expect(
      combineBundles({
        bundles: [
          { shard: "linux", directory: linux.directory },
          { shard: "safari", directory: safari.directory },
        ],
        directory: output,
        workflowAttempt: 1,
      }),
    ).rejects.toMatchObject({
      message:
        "A capture bundle does not have the digest that this CLI expects. Use the same release of visonaut and @visonaut/playwright.",
      exitCode: 4,
    });
  });

  it("combines a carried pack with a pack from the current rerun", async () => {
    const { linux, safari, output } = await bundlePair(directories);
    safari.manifest.run.workflowAttempt = 2;
    safari.manifest.shard.sourceAttempt = 2;
    await writeFile(safari.manifestPath, JSON.stringify(safari.manifest));
    const manifest = await combineBundles({
      bundles: [
        { shard: "linux", directory: linux.directory },
        { shard: "safari", directory: safari.directory },
      ],
      directory: output,
      workflowAttempt: 2,
    });
    expect(manifest.run.workflowAttempt).toBe(2);
    expect(manifest.captures).toHaveLength(2);
  });

  it("rejects a pack from a later attempt than the signed job", async () => {
    const { linux, safari, output } = await bundlePair(directories);
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
        workflowAttempt: 1,
      }),
    ).rejects.toThrow("later workflow attempt");
  });
});
