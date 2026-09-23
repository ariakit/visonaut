import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import { decodeImage, validateImage, type ImageCodecs } from "@visonaut/compare";
import type { ComparisonTask } from "@visonaut/service";
import { nodeCodecs } from "../../../packages/compare/test/codecs.ts";
import { processComparisonTask, type ArtifactStorage } from "../src/process.ts";

let codecs: ImageCodecs;
let png: Uint8Array<ArrayBuffer>;
let task: ComparisonTask;

class Images implements ArtifactStorage {
  objects = new Map<string, Uint8Array<ArrayBuffer>>();
  writes = 0;
  failWrites = false;
  async get(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return { size: bytes.length, body: new Blob([bytes]).stream() };
  }
  async put(key: string, bytes: Uint8Array<ArrayBuffer>) {
    if (this.failWrites) {
      throw new Error("R2 unavailable");
    }
    this.writes += 1;
    if (!this.objects.has(key)) {
      this.objects.set(key, bytes.slice());
    }
  }
}

beforeAll(async () => {
  codecs = await nodeCodecs();
  png = Uint8Array.from(
    await readFile(new URL("../../../packages/compare/test/fixtures/rgba.png", import.meta.url)),
  );
  const image = await validateImage(png);
  const record = {
    imageId: "original-id",
    objectKey: "original",
    digest: image.digest,
    width: image.width,
    height: image.height,
    bytes: png.length,
    contentType: "image/png" as const,
  };
  task = {
    id: "task-1",
    comparisonId: "comparison-1",
    runId: "run-1",
    policyDigest: "trusted-policy",
    policy: { id: "test-exact", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 },
    candidate: record,
    reference: record,
  };
});

it("writes validated deterministic artifacts and leaves originals unchanged on replay", async () => {
  const images = new Images();
  images.objects.set("original", png.slice());
  const first = await processComparisonTask({ task, images, codecs });
  const replay = await processComparisonTask({ task, images, codecs });
  expect(replay).toEqual(first);
  expect(first.result).toMatchObject({
    outcome: "unchanged",
    ratio: 0,
    changedPixels: 0,
    maskExpected: false,
  });
  expect(first.artifacts.map((artifact) => artifact.role)).toEqual(["thumbnail"]);
  expect(first.result).not.toHaveProperty("maskImageId");
  expect(images.objects.size).toBe(2);
  expect(images.writes).toBe(1);
  const recomparison = await processComparisonTask({
    task: { ...task, id: "task-2", comparisonId: "comparison-2" },
    images,
    codecs,
  });
  expect(recomparison.result.thumbnailImageId).toBe(first.result.thumbnailImageId);
  expect(images.writes).toBe(1);
  expect(images.objects.get("original")).toEqual(png);
  for (const artifact of first.artifacts) {
    const bytes = images.objects.get(artifact.objectKey);
    expect(bytes).toBeDefined();
    if (!bytes) {
      throw new Error("Missing artifact");
    }
    const validated = await validateImage(bytes);
    expect(validated.digest).toBe(artifact.digest);
    const decoded = await decodeImage(validated, codecs);
    expect(decoded.width).toBe(3);
  }
});

it("treats intentional absence as addition/removal with no pixel-diff artifact", async () => {
  const images = new Images();
  images.objects.set("original", png);
  for (const absent of ["candidate", "reference"] as const) {
    const result = await processComparisonTask({
      task: { ...task, [absent]: null },
      images,
      codecs,
    });
    expect(result.result).toMatchObject({
      outcome: "changed",
      changedPixels: 6,
      ratio: 1,
      maskExpected: false,
    });
    expect(result.result).not.toHaveProperty("maskImageId");
    expect(result.artifacts).toHaveLength(1);
  }
});

it("generates a red diff mask only for changed pairs", async () => {
  const images = new Images();
  images.objects.set("original", png);
  const changed = await decodeImage(await validateImage(png), codecs);
  changed.data[0] = 0;
  const bytes = new Uint8Array(await codecs.encodePng(changed));
  const validated = await validateImage(bytes);
  images.objects.set("changed", bytes);
  const result = await processComparisonTask({
    task: {
      ...task,
      candidate: {
        imageId: "changed-id",
        objectKey: "changed",
        digest: validated.digest,
        width: 3,
        height: 2,
        bytes: bytes.length,
        contentType: "image/png",
      },
    },
    images,
    codecs,
  });
  expect(result.result).toMatchObject({
    outcome: "changed",
    changedPixels: 1,
    ratio: 1 / 6,
    maskExpected: true,
  });
  const artifact = result.artifacts.find((image) => image.role === "mask");
  const mask = artifact && images.objects.get(artifact.objectKey);
  if (!mask) {
    throw new Error("Changed comparison needs a mask");
  }
  const decoded = await decodeImage(await validateImage(mask), codecs);
  expect(Array.from(decoded.data)).toEqual([255, 0, 0, 255, ...new Array(20).fill(0)]);
});

it("refuses a reused thumbnail whose pixels differ from its source", async () => {
  const images = new Images();
  images.objects.set("original", png);
  const first = await processComparisonTask({ task, images, codecs });
  const thumbnail = first.artifacts[0];
  if (!thumbnail) {
    throw new Error("Missing thumbnail");
  }
  const wrong = await decodeImage(await validateImage(png), codecs);
  wrong.data[0] = 0;
  images.objects.set(thumbnail.objectKey, new Uint8Array(await codecs.encodePng(wrong)));
  await expect(processComparisonTask({ task, images, codecs })).rejects.toMatchObject({
    code: "thumbnail-integrity",
  });
});

it("refuses unavailable or corrupted required evidence before deriving images", async () => {
  const images = new Images();
  await expect(processComparisonTask({ task, images, codecs })).rejects.toMatchObject({
    code: "missing-original",
  });
  images.objects.set("original", png);
  const candidate = task.candidate;
  if (!candidate) {
    throw new Error("Missing candidate fixture");
  }
  await expect(
    processComparisonTask({
      task: { ...task, candidate: { ...candidate, digest: "wrong-digest" } },
      images,
      codecs,
    }),
  ).rejects.toMatchObject({ code: "original-integrity" });
  expect(images.writes).toBe(0);
});

it("does not return a result when artifact storage fails", async () => {
  const images = new Images();
  images.objects.set("original", png);
  images.failWrites = true;
  await expect(processComparisonTask({ task, images, codecs })).rejects.toThrow("R2 unavailable");
  expect(images.objects.size).toBe(1);
  images.failWrites = false;
  await expect(processComparisonTask({ task, images, codecs })).resolves.toMatchObject({
    result: { outcome: "unchanged" },
  });
});
