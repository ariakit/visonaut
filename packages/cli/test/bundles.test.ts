import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXED_DIGEST } from "@visonaut/protocol";
import type { Manifest } from "@visonaut/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { combineBundles } from "../src/bundles.js";
import { mergeCaptureRecords } from "../src/submission.js";
import { bundlePair, imageBytes } from "./fixture.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("combined signed submission", () => {
  it("writes one sorted record file for each capture job and stores each image one time", async () => {
    const { linux, safari, output } = await bundlePair(directories);
    const pending = await combineBundles({
      bundles: [
        { shard: "linux", directory: linux.directory },
        { shard: "safari", directory: safari.directory },
      ],
      directory: output,
      workflowAttempt: 1,
    });
    expect(pending.run.planDigest).toBe(FIXED_DIGEST);
    expect(pending.producer).toEqual(linux.manifest.producer);
    expect(pending.files).toEqual(["records/0.ndjson", "records/1.ndjson"]);
    const records = [];
    for await (const record of mergeCaptureRecords(output, pending.files)) {
      records.push(record);
    }
    // Both captures have the item key "dialog/open", so the variant key gives the order.
    expect(records.map(({ test, variant }) => [variant.key, test.id, variant.browser])).toEqual([
      ["react-light", "linux/test-1", "chromium"],
      ["react-safari", "safari/test-1", "webkit"],
    ]);
    expect(records[0]).toEqual({
      itemKey: "dialog/open",
      name: "Open dialog",
      variant: linux.capture.variant,
      test: { id: "linux/test-1", file: "dialog.test.ts", titlePath: ["dialog", "open"], retry: 1 },
      profile: linux.manifest.profiles[0]?.profile,
      profileDigest: linux.capture.profileDigest,
      comparison: { threshold: 0.2 },
      image: { digest: linux.capture.image.digest, bytes: imageBytes.length, width: 1, height: 1 },
    });
    // The two captures have the same bytes, so the directory has one image file.
    expect(await readdir(join(output, "images"))).toEqual([`${linux.capture.image.digest}.png`]);
    expect(await readFile(join(output, "images", `${linux.capture.image.digest}.png`))).toEqual(
      await readFile(join(linux.directory, linux.capture.image.path)),
    );
  });

  it("sorts the captures of one capture job by the item key and then the variant key", async () => {
    const { linux, output } = await bundlePair(directories);
    const variant = (key: string) => ({ ...linux.capture.variant, key });
    linux.manifest.captures = [
      { ...linux.capture, itemKey: "menu", variant: variant("b"), ordinal: 0 },
      { ...linux.capture, itemKey: "dialog/open", variant: variant("b"), ordinal: 1 },
      { ...linux.capture, itemKey: "menu", variant: variant("a"), ordinal: 2 },
      { ...linux.capture, itemKey: "dialog", variant: variant("c"), ordinal: 3 },
    ];
    await writeFile(linux.manifestPath, JSON.stringify(linux.manifest));
    const pending = await combineBundles({
      bundles: [{ shard: "linux", directory: linux.directory }],
      directory: output,
      workflowAttempt: 1,
    });
    const records = [];
    for await (const record of mergeCaptureRecords(output, pending.files)) {
      records.push([record.itemKey, record.variant.key]);
    }
    expect(records).toEqual([
      ["dialog", "c"],
      ["dialog/open", "b"],
      ["menu", "a"],
      ["menu", "b"],
    ]);
  });

  it("keeps a test title with a line separator character in one record", async () => {
    const { linux, output } = await bundlePair(directories);
    const [test] = linux.manifest.tests;
    if (!test) throw new Error("The fixture has no test.");
    // The reader of the record files ends a line at these two characters.
    test.titlePath = ["dialog\u2028open", "second\u2029part"];
    linux.capture.name = "Open\u2028dialog";
    await writeFile(linux.manifestPath, JSON.stringify(linux.manifest));
    const pending = await combineBundles({
      bundles: [{ shard: "linux", directory: linux.directory }],
      directory: output,
      workflowAttempt: 1,
    });
    const records = [];
    for await (const record of mergeCaptureRecords(output, pending.files)) {
      records.push(record);
    }
    expect(records).toHaveLength(1);
    expect(records[0]?.test.titlePath).toEqual(["dialog\u2028open", "second\u2029part"]);
    expect(records[0]?.name).toBe("Open\u2028dialog");
  });

  it("has no limit for the count of capture jobs: 17 bundles", async () => {
    const { linux, output } = await bundlePair(directories);
    const bundles = [];
    for (let index = 0; index < 17; index++) {
      const shard = `job-${index}`;
      const directory = await mkdtemp(join(tmpdir(), "visonaut-many-test-"));
      directories.push(directory);
      const manifest = structuredClone(linux.manifest);
      manifest.shard.key = shard;
      const [capture] = manifest.captures;
      if (!capture) throw new Error("The fixture has no capture.");
      capture.itemKey = `item-${String(index).padStart(2, "0")}`;
      await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
      await writeFile(join(directory, capture.image.path), imageBytes);
      bundles.push({ shard, directory });
    }
    const pending = await combineBundles({ bundles, directory: output, workflowAttempt: 1 });
    expect(pending.files).toHaveLength(17);
    const keys = [];
    for await (const record of mergeCaptureRecords(output, pending.files)) {
      keys.push(record.itemKey);
    }
    expect(keys).toHaveLength(17);
    expect(keys).toEqual([...keys].sort());
  });

  it("refuses two captures with the same keys in two capture jobs, and names the screenshot", async () => {
    const { linux, safari, output } = await bundlePair(directories);
    safari.manifest.captures = [{ ...linux.capture }];
    safari.manifest.profiles = linux.manifest.profiles;
    await writeFile(safari.manifestPath, JSON.stringify(safari.manifest));
    const pending = await combineBundles({
      bundles: [
        { shard: "linux", directory: linux.directory },
        { shard: "safari", directory: safari.directory },
      ],
      directory: output,
      workflowAttempt: 1,
    });
    const read = async () => {
      for await (const _record of mergeCaptureRecords(output, pending.files)) {
        // Read each record.
      }
    };
    await expect(read()).rejects.toThrow(
      "dialog/open (react-light): Two captures have this item key and variant key.",
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
    const pending = await combineBundles({
      bundles: [
        { shard: "linux", directory: linux.directory },
        { shard: "safari", directory: safari.directory },
      ],
      directory: output,
      workflowAttempt: 2,
    });
    expect(pending.run.workflowAttempt).toBe(2);
    expect(pending.files).toHaveLength(2);
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
