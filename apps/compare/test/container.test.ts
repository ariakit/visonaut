import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import {
  compareImages,
  createThumbnail,
  decodeImage,
  validateImage,
  type ImageCodecs,
} from "@visonaut/compare";
import type { ComparisonTask } from "@visonaut/service";
import { nodeCodecs } from "../../../packages/compare/test/codecs.ts";
import { processComparisonTaskInContainer, type ContainerTransport } from "../src/container.ts";
import type { ArtifactStorage } from "../src/process.ts";

const codecVersion = "sharp-0.35.4-vips-8.18.6";
const policy = { id: "exact", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 };

class Images implements ArtifactStorage {
  objects = new Map<string, Uint8Array<ArrayBuffer>>();
  async get(key: string) {
    const bytes = this.objects.get(key);
    return bytes ? { size: bytes.length, body: new Blob([bytes]).stream() } : null;
  }
  async put(key: string, bytes: Uint8Array<ArrayBuffer>) {
    if (this.objects.has(key)) return null;
    this.objects.set(key, bytes.slice());
    return { key };
  }
}

let original: Uint8Array<ArrayBuffer>;
let codecs: ImageCodecs;
let task: ComparisonTask;

beforeAll(async () => {
  original = Uint8Array.from(
    await readFile(new URL("../../../packages/compare/test/fixtures/rgba.png", import.meta.url)),
  );
  codecs = await nodeCodecs();
  const validated = await validateImage(original);
  const image = {
    imageId: "original",
    objectKey: "runs/run/original",
    digest: validated.digest,
    width: validated.width,
    height: validated.height,
    bytes: original.length,
    contentType: "image/png" as const,
  };
  task = {
    id: "comparison-task",
    comparisonId: "comparison",
    runId: "run",
    policyDigest: "trusted-policy",
    policy,
    reference: image,
    candidate: image,
  };
});

function artifact(bytes: Uint8Array) {
  return {
    base64: Buffer.from(bytes).toString("base64"),
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function reply(changed: boolean) {
  const source = await decodeImage(await validateImage(original), codecs);
  const candidate = {
    ...source,
    data: source.data.slice(),
  };
  if (changed) candidate.data[0] = 0;
  const comparison = compareImages(source, candidate, policy);
  const thumbnail = artifact(new Uint8Array(await codecs.encodePng(createThumbnail(candidate))));
  const mask =
    comparison.outcome === "changed"
      ? artifact(new Uint8Array(await codecs.encodePng(comparison.mask)))
      : null;
  return {
    outcome: comparison.outcome,
    changedPixels: comparison.changedPixels,
    ratio: comparison.ratio,
    engineVersion: comparison.engineVersion,
    codecVersion,
    thumbnail,
    mask,
  };
}

it("sends verified originals and commits repeat-safe Container artifacts", async () => {
  const images = new Images();
  images.objects.set("runs/run/original", original);
  const result = await reply(false);
  const container: ContainerTransport = {
    async fetch(request) {
      const sent = await request.json();
      expect(sent).toMatchObject({
        policy,
        reference: { digest: task.reference?.digest },
        candidate: { digest: task.candidate?.digest },
      });
      expect(Buffer.from(sent.candidate.base64, "base64")).toEqual(Buffer.from(original));
      return Response.json(result);
    },
  };
  const first = await processComparisonTaskInContainer({ task, images, container });
  const replay = await processComparisonTaskInContainer({ task, images, container });
  expect(replay).toEqual(first);
  expect(first.result).toMatchObject({
    outcome: "unchanged",
    maskExpected: false,
    changedPixels: 0,
    codecVersion,
  });
  expect(first.artifacts.map((entry) => entry.role)).toEqual(["thumbnail"]);
  expect(images.objects.size).toBe(2);
  expect(images.objects.get("runs/run/original")).toEqual(original);
});

it("writes a validated full-size mask for a changed pair", async () => {
  const images = new Images();
  images.objects.set("runs/run/original", original);
  const changed = await reply(true);
  const container: ContainerTransport = { fetch: async () => Response.json(changed) };
  const processed = await processComparisonTaskInContainer({ task, images, container });
  expect(processed.result).toMatchObject({
    outcome: "changed",
    changedPixels: 1,
    maskExpected: true,
  });
  expect(processed.artifacts.map((entry) => entry.role)).toEqual(["thumbnail", "mask"]);
  const mask = processed.artifacts[1];
  expect(mask).toMatchObject({ width: 3, height: 2, contentType: "image/png" });
  expect(mask && images.objects.get(mask.objectKey)).toBeDefined();
});

it("keeps an absent reference as a changed item without a mask", async () => {
  const images = new Images();
  images.objects.set("runs/run/original", original);
  const base = await reply(false);
  const container: ContainerTransport = {
    async fetch(request) {
      expect(await request.json()).toMatchObject({ reference: null });
      return Response.json({
        ...base,
        outcome: "changed",
        changedPixels: 6,
        ratio: 1,
        mask: null,
      });
    },
  };
  const processed = await processComparisonTaskInContainer({
    task: { ...task, reference: null },
    images,
    container,
  });
  expect(processed.result).toMatchObject({ outcome: "changed", maskExpected: false });
  expect(processed.artifacts).toHaveLength(1);
});

it("rejects corrupt results before writing derived objects", async () => {
  const images = new Images();
  images.objects.set("runs/run/original", original);
  const base = await reply(false);
  const container: ContainerTransport = {
    fetch: async () => Response.json({ ...base, ratio: 1 }),
  };
  await expect(processComparisonTaskInContainer({ task, images, container })).rejects.toThrow(
    "Container result failed validation",
  );
  expect(images.objects.size).toBe(1);
});

it("rejects a truncated existing artifact even when its reported size matches", async () => {
  const images = new Images();
  images.objects.set("runs/run/original", original);
  const result = await reply(false);
  const container: ContainerTransport = { fetch: async () => Response.json(result) };
  await processComparisonTaskInContainer({ task, images, container });
  const get = images.get.bind(images);
  images.get = async (key) => {
    const object = await get(key);
    if (!object || !key.startsWith("derived/")) {
      return object;
    }
    const bytes = images.objects.get(key);
    if (!bytes) {
      throw new Error("Existing artifact is missing.");
    }
    return { ...object, body: new Blob([bytes.subarray(0, bytes.length - 1)]).stream() };
  };
  await expect(processComparisonTaskInContainer({ task, images, container })).rejects.toThrow(
    "Existing Container artifact differs",
  );
});
