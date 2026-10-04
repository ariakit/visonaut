import {
  canonicalJson,
  digestEnvironmentProfile,
  digestJson,
  digestRenderingProfile,
  LOCAL_COMPARISON_CODEC,
  LOCAL_COMPARISON_ENGINE,
  sha256,
  type CaptureProfile,
  type Manifest,
} from "@visonaut/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  inventoryMetadata,
  maximumCaptureInventoryBytes,
  readCaptureInventory,
  writeCaptureInventory,
  type CaptureInventory,
  type CaptureInventoryPointer,
} from "./capture-inventory.ts";

const profile: CaptureProfile = {
  browser: "chromium",
  browserVersion: "149",
  osImageDigest: "a".repeat(64),
  fontsDigest: "b".repeat(64),
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  locale: "en-US",
  timezone: "UTC",
  reducedMotion: "reduce",
  colorScheme: "light",
  contrast: "no-preference",
  forcedColors: "none",
  animationPolicy: "disabled",
  captureOptions: { fullPage: false },
};

function objectStore() {
  const objects = new Map<string, Uint8Array>();
  const put = vi.fn(async (key: string, value: string) => {
    objects.set(key, new TextEncoder().encode(value));
  });
  const get = vi.fn(async (key: string) => {
    const value = objects.get(key);
    if (!value) return null;
    return {
      size: value.byteLength,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(value.slice());
          controller.close();
        },
      }),
    };
  });
  return { objects, put, get };
}

async function fixture(withManifest = false, testId = "test-1"): Promise<CaptureInventory> {
  const profileDigest = await digestJson(profile);
  const representative = {
    id: "image-seed",
    runId: "seed",
    digest: "c".repeat(64),
    objectKey: "runs/seed/original.png",
    contentType: "image/png" as const,
    bytes: 23,
    width: 1,
    height: 1,
  };
  const observed = {
    digest: "d".repeat(64),
    mediaType: "image/png" as const,
    bytes: 24,
    width: 1,
    height: 1,
    path: "images/actual.png",
  };
  const inventory: CaptureInventory = {
    schemaVersion: "baseline-delta-v1",
    projectId: "project",
    runId: "run",
    testedSha: "a".repeat(40),
    referenceSnapshotId: "snapshot-seed",
    profiles: [{ digest: profileDigest, profile }],
    captures: [
      {
        id: "capture-run",
        itemKey: "dialog/open",
        variantKey: "light",
        ordinal: 0,
        imageId: representative.id,
        image: representative,
        profileDigest,
        renderingProfileDigest: await digestRenderingProfile(profile),
        environmentProfileDigest: await digestEnvironmentProfile(profile),
        testId,
        testRetry: 0,
        metadata: {
          name: "Dialog",
          variant: { key: "light", browser: "chromium" },
          profile: { $visonautProfileDigest: profileDigest },
          localMode: "local-v1",
          observedImage: observed,
          candidateStored: false,
          comparison: { threshold: 0.2 },
          comparisonDigest: await digestJson({ threshold: 0.2 }),
          localResult: {
            outcome: "unchanged",
            changedPixels: 0,
            ratio: 0,
            engineVersion: LOCAL_COMPARISON_ENGINE,
            codecVersion: LOCAL_COMPARISON_CODEC,
            maskExpected: false,
          },
        },
      },
    ],
  };
  if (!withManifest) {
    return inventory;
  }
  const manifest: Manifest = {
    schemaVersion: "1.0",
    producer: {
      name: "visonaut",
      version: "1.0.0",
      nodeVersion: "24",
      playwrightVersion: "1.63.0",
    },
    run: {
      repository: "ariakit/ariakit",
      repositoryId: "123",
      workflowRunId: "456",
      workflowAttempt: 1,
      testedSha: inventory.testedSha,
      planDigest: "e".repeat(64),
    },
    shard: { key: "combined", jobId: "789", sourceAttempt: 1 },
    profiles: inventory.profiles,
    tests: [
      {
        id: testId,
        file: "dialog.test.ts",
        titlePath: ["Dialog", "Open"],
        retry: 0,
        status: "passed",
      },
    ],
    captures: [
      {
        itemKey: "dialog/open",
        variant: { key: "light", browser: "chromium" },
        ordinal: 0,
        testId,
        testRetry: 0,
        profileDigest,
        image: observed,
      },
    ],
    localComparison: {
      mode: "local-v1",
      engineVersion: LOCAL_COMPARISON_ENGINE,
      codecVersion: LOCAL_COMPARISON_CODEC,
      reference: {
        manifestDigest: "f".repeat(64),
        snapshotId: "snapshot-seed",
        baselineRevision: 1,
        inventoryDigest: "1".repeat(64),
        captureCount: 1,
      },
      captures: [
        {
          itemKey: "dialog/open",
          variantKey: "light",
          candidateDigest: observed.digest,
          referenceDigest: representative.digest,
          outcome: "unchanged",
          changedPixels: 0,
          ratio: 0,
          sizeChanged: false,
        },
      ],
      removals: [],
    },
  };
  return { ...inventory, manifest };
}

async function rawInventory(
  store: ReturnType<typeof objectStore>,
  inventory: CaptureInventory,
  encoded = canonicalJson(inventory),
): Promise<CaptureInventoryPointer> {
  const bytes = new TextEncoder().encode(encoded);
  const digest = await sha256(bytes);
  const objectKey = `runs/${inventory.runId}/inventory/${digest}.json`;
  store.objects.set(objectKey, bytes);
  return { objectKey, digest, bytes: bytes.byteLength, captureCount: inventory.captures.length };
}

describe("complete immutable capture inventory", () => {
  it.each([
    ["CLI shard prefix", "linux/08636fa1c499c43994f3-ac12060dba0c4211590c"],
    ["spaces and Unicode", "chromium/Dialog opens 🧪"],
    ["maximum length", "t".repeat(1_024)],
  ])("preserves manifest test IDs with %s through storage", async (_label, testId) => {
    const store = objectStore();
    const inventory = await fixture(true, testId);
    const pointer = await writeCaptureInventory(store, inventory);
    const loaded = await readCaptureInventory(store, pointer);
    expect(loaded).toEqual(inventory);
    expect(loaded.captures[0]?.testId).toBe(testId);
    expect(loaded.manifest?.tests[0]?.id).toBe(testId);
    expect(loaded.manifest?.captures[0]?.testId).toBe(testId);
  });

  it.each(["", "t".repeat(1_025), "test\u0000", "test\u001f", "test\u007f"])(
    "rejects invalid protocol test ID %j at write and read boundaries",
    async (testId) => {
      const store = objectStore();
      const inventory = await fixture(false, testId);
      await expect(writeCaptureInventory(store, inventory)).rejects.toThrow();
      expect(store.put).not.toHaveBeenCalled();
      const pointer = await rawInventory(store, inventory);
      await expect(readCaptureInventory(store, pointer)).rejects.toThrow();
    },
  );

  it.each(["projectId", "runId", "referenceSnapshotId"] as const)(
    "retains strict %s validation",
    async (key) => {
      const store = objectStore();
      const inventory = await fixture();
      inventory[key] = "invalid/id";
      await expect(writeCaptureInventory(store, inventory)).rejects.toThrow("identity is invalid");
      expect(store.put).not.toHaveBeenCalled();
    },
  );

  it.each(["id", "imageId"] as const)("retains strict capture %s validation", async (key) => {
    const store = objectStore();
    const inventory = await fixture();
    const capture = inventory.captures[0];
    if (!capture) throw new Error("Missing capture.");
    capture[key] = "invalid/id";
    await expect(writeCaptureInventory(store, inventory)).rejects.toThrow("identity is invalid");
    expect(store.put).not.toHaveBeenCalled();
  });

  it.each(["id", "runId"] as const)("retains strict image %s validation", async (key) => {
    const store = objectStore();
    const inventory = await fixture();
    const capture = inventory.captures[0];
    if (!capture) throw new Error("Missing capture.");
    capture.image[key] = "invalid/id";
    await expect(writeCaptureInventory(store, inventory)).rejects.toThrow("identity is invalid");
    expect(store.put).not.toHaveBeenCalled();
  });

  it("enforces the hard document cap before storage, including caller overrides", async () => {
    const store = objectStore();
    const inventory = await fixture();
    await expect(
      writeCaptureInventory(store, inventory, maximumCaptureInventoryBytes + 1),
    ).rejects.toThrow();
    const pointer = await rawInventory(store, inventory);
    pointer.bytes = maximumCaptureInventoryBytes + 1;
    await expect(readCaptureInventory(store, pointer)).rejects.toThrow();
    expect(store.get).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it("fits a complete 3,832-capture receipt within the Worker document budget", async ({
    annotate,
  }) => {
    const store = objectStore();
    const inventory = await fixture(true);
    const template = inventory.captures[0];
    const manifest = inventory.manifest;
    const observed = manifest?.captures[0];
    const result = manifest?.localComparison?.captures[0];
    if (!template || !manifest || !observed || !result || !manifest.localComparison) {
      throw new Error("Missing scale fixture.");
    }
    inventory.captures = [];
    inventory.profiles = [];
    manifest.captures = [];
    manifest.profiles = inventory.profiles;
    manifest.tests = [];
    manifest.localComparison.captures = [];
    manifest.localComparison.reference.captureCount = 3_832;
    // Distinct geometry profiles include the dictionary duplicated in the receipt.
    for (let ordinal = 0; ordinal < 3_832; ordinal++) {
      const currentProfile = { ...profile, viewport: { width: 1280, height: 800 + ordinal } };
      const profileDigest = await digestJson(currentProfile);
      inventory.profiles.push({ digest: profileDigest, profile: currentProfile });
      const itemKey = `examples/dialog/open-${ordinal}`;
      const test = {
        id: `test-${ordinal}`,
        file: `app/src/examples/dialog-${ordinal}/test.ts`,
        titlePath: ["Dialog", "keeps focus within the dialog and returns focus to its trigger"],
        retry: 0,
        status: "passed" as const,
      };
      inventory.captures.push({
        ...template,
        id: `capture-${ordinal}`,
        itemKey,
        ordinal,
        profileDigest,
        renderingProfileDigest: await digestRenderingProfile(currentProfile),
        environmentProfileDigest: await digestEnvironmentProfile(currentProfile),
        testId: test.id,
        metadata: {
          ...template.metadata,
          name: `Dialog ${ordinal}`,
          profile: { $visonautProfileDigest: profileDigest },
          source: test,
        },
      });
      manifest.captures.push({ ...observed, itemKey, ordinal, profileDigest, testId: test.id });
      manifest.tests.push(test);
      manifest.localComparison.captures.push({ ...result, itemKey });
    }
    const pointer = await writeCaptureInventory(store, inventory);
    await annotate(`Complete inventory: ${pointer.bytes} bytes; 3,832 captures and profiles.`);
    expect(pointer.captureCount).toBe(3_832);
    expect(pointer.bytes).toBeLessThan(maximumCaptureInventoryBytes);
    expect((await readCaptureInventory(store, pointer)).captures).toHaveLength(3_832);
  });

  it("writes canonical content and hydrates profiles without fetching a predecessor or D1", async () => {
    const store = objectStore();
    const inventory = await fixture(true);
    const pointer = await writeCaptureInventory(store, inventory);
    expect(pointer).toEqual({
      objectKey: `runs/run/inventory/${await digestJson(inventory)}.json`,
      digest: await digestJson(inventory),
      bytes: new TextEncoder().encode(canonicalJson(inventory)).byteLength,
      captureCount: 1,
    });
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(store.objects.get(pointer.objectKey))).toBe(
      canonicalJson(inventory),
    );
    const loaded = await readCaptureInventory(store, pointer);
    expect(loaded.captures[0]?.image.digest).toBe("c".repeat(64));
    expect(loaded.captures[0]?.metadata.observedImage).toEqual(
      inventory.captures[0]?.metadata.observedImage,
    );
    expect(inventoryMetadata(loaded)[0]?.metadata.profile).toEqual(profile);
    expect(loaded.captures[0]?.metadata.profile).toEqual({
      $visonautProfileDigest: await digestJson(profile),
    });
    expect(store.get.mock.calls.map(([key]) => key)).toEqual([pointer.objectKey]);
    expect(await writeCaptureInventory(store, inventory)).toEqual(pointer);
  });

  it("stores imported baseline facts under a protected prefix without a capture receipt", async () => {
    const store = objectStore();
    const inventory = await fixture();
    const capture = inventory.captures[0];
    if (!capture) throw new Error("Missing capture.");
    capture.image.objectKey = "baselines/import/replacement/originals/image.png";
    const pointer = await writeCaptureInventory(store, inventory, {
      prefix: "baselines/import/replacement",
    });
    expect(pointer.objectKey).toBe(`baselines/import/replacement/inventory/${pointer.digest}.json`);
    expect(await readCaptureInventory(store, pointer)).toEqual(inventory);
  });

  it("keeps uploaded zero-pixel evidence while normalizing its review outcome", async () => {
    const store = objectStore();
    const inventory = await fixture(true);
    const capture = inventory.captures[0];
    const receipt = inventory.manifest?.localComparison?.captures[0];
    const observed = inventory.manifest?.captures[0]?.image;
    if (!capture || !receipt || !observed) throw new Error("Missing receipt.");
    receipt.outcome = "changed";
    capture.metadata.candidateStored = true;
    capture.image = { ...capture.image, digest: observed.digest, bytes: observed.bytes };
    const loaded = await readCaptureInventory(store, await writeCaptureInventory(store, inventory));
    expect(loaded.manifest?.localComparison?.captures[0]?.outcome).toBe("changed");
    expect(loaded.captures[0]?.metadata.localResult).toMatchObject({ outcome: "unchanged" });
    expect(loaded.captures[0]?.metadata.candidateStored).toBe(true);
    expect(loaded.captures[0]?.image.digest).toBe(observed.digest);
  });

  it.each(["checksum", "count", "run key", "noncanonical", "missing", "oversized"])(
    "rejects %s evidence at the storage boundary",
    async (mode) => {
      const store = objectStore();
      const inventory = await fixture();
      const pointer = await rawInventory(
        store,
        inventory,
        mode === "noncanonical" ? JSON.stringify(inventory, null, 2) : undefined,
      );
      if (mode === "checksum") {
        store.objects.set(pointer.objectKey, new Uint8Array(pointer.bytes).fill(32));
      }
      if (mode === "count") {
        pointer.captureCount += 1;
      }
      if (mode === "run key") {
        const body = store.objects.get(pointer.objectKey);
        if (!body) throw new Error("Missing object.");
        pointer.objectKey = pointer.objectKey.replace("runs/run/", "runs/other/");
        store.objects.set(pointer.objectKey, body);
      }
      if (mode === "missing") {
        store.objects.clear();
      }
      await expect(
        readCaptureInventory(store, pointer, mode === "oversized" ? pointer.bytes - 1 : undefined),
      ).rejects.toThrow();
      if (mode === "oversized") {
        expect(store.get).not.toHaveBeenCalled();
      }
    },
  );

  it("cancels a stream when stored size or streamed bytes exceed the signed bound", async () => {
    const store = objectStore();
    const pointer = await rawInventory(store, await fixture());
    const cancel = vi.fn();
    const body = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(pointer.bytes + 1));
        },
        cancel,
      });
    store.get.mockImplementationOnce(async () => ({ size: pointer.bytes + 1, body: body() }));
    await expect(readCaptureInventory(store, pointer)).rejects.toThrow("stored size");
    expect(cancel).toHaveBeenCalledTimes(1);
    store.get.mockImplementationOnce(async () => ({ size: pointer.bytes, body: body() }));
    await expect(readCaptureInventory(store, pointer)).rejects.toThrow("size limit");
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it.each([
    "profile digest",
    "rendering digest",
    "profile reference",
    "image identity",
    "image owner",
    "duplicate item",
    "duplicate ordinal",
    "receipt observation",
    "receipt count",
  ])("rejects mismatched %s before publishing its pointer", async (mode) => {
    const store = objectStore();
    const inventory = await fixture(true);
    const capture = inventory.captures[0];
    if (!capture) throw new Error("Missing capture.");
    if (mode === "profile digest") {
      inventory.profiles[0] = { digest: "2".repeat(64), profile };
    }
    if (mode === "rendering digest") {
      capture.renderingProfileDigest = "2".repeat(64);
    }
    if (mode === "profile reference") {
      capture.metadata.profile = { $visonautProfileDigest: "2".repeat(64) };
    }
    if (mode === "image identity") {
      capture.imageId = "other";
    }
    if (mode === "image owner") {
      capture.image.runId = "other";
    }
    if (mode === "duplicate item") {
      inventory.captures.push({ ...capture, id: "capture-other", ordinal: 1 });
    }
    if (mode === "duplicate ordinal") {
      inventory.captures.push({ ...capture, id: "capture-other", itemKey: "other" });
    }
    if (mode === "receipt observation") {
      capture.metadata.observedImage = { digest: "2".repeat(64) };
    }
    if (mode === "receipt count") {
      inventory.captures = [];
    }
    await expect(writeCaptureInventory(store, inventory)).rejects.toThrow();
    expect(store.put).not.toHaveBeenCalled();
  });
});
