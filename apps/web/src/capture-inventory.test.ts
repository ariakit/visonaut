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
  type InventoryCapture,
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
        name: "Dialog",
        variant: { key: "light", browser: "chromium" },
        ordinal: 0,
        testId,
        testRetry: 0,
        profileDigest,
        comparison: { threshold: 0.2 },
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
  const capture = inventory.captures[0];
  const source = manifest.tests[0];
  if (!capture || !source) throw new Error("Missing capture source.");
  capture.metadata.source = source;
  return { ...inventory, manifest };
}

interface StoredInventory extends Omit<
  CaptureInventory,
  "schemaVersion" | "profiles" | "captures"
> {
  schemaVersion: string;
  profiles?: CaptureInventory["profiles"];
  captures: (InventoryCapture & { metadataEncoding?: unknown })[];
}

function storedInventory(store: ReturnType<typeof objectStore>, pointer: CaptureInventoryPointer) {
  const bytes = store.objects.get(pointer.objectKey);
  if (!bytes) throw new Error("Missing inventory object.");
  const inventory: StoredInventory = JSON.parse(new TextDecoder().decode(bytes));
  return inventory;
}

async function scaleFixture(captureCount: number): Promise<CaptureInventory> {
  const inventory = await fixture(true);
  const template = inventory.captures[0];
  const manifest = inventory.manifest;
  const observation = manifest?.captures[0];
  const result = manifest?.localComparison?.captures[0];
  if (!template || !manifest || !observation || !result || !manifest.localComparison) {
    throw new Error("Missing scale fixture.");
  }
  inventory.captures = [];
  inventory.profiles = [];
  manifest.captures = [];
  manifest.profiles = inventory.profiles;
  manifest.tests = [];
  manifest.localComparison.captures = [];
  manifest.localComparison.reference.captureCount = captureCount;
  // Long capture keys and full source metadata exercise the materializer's shape.
  for (let ordinal = 0; ordinal < captureCount; ordinal++) {
    const currentProfile = {
      ...profile,
      viewport: { width: 1280, height: 800 + ordinal },
      captureOptions: { fullPage: false, animations: "disabled", caret: "hide", scale: "css" },
    };
    const profileDigest = await digestJson(currentProfile);
    const itemKey =
      "examples/dialog-nested-select-combobox-with-custom-trigger/" +
      "keyboard-focus-remains-inside-the-open-dialog-and-returns-to-the-trigger/" +
      `selected-option-remains-visible-after-the-dialog-is-opened-${ordinal}`;
    const variant = {
      key: "chromium-desktop-light-en-US-reduced-motion",
      browser: "chromium" as const,
    };
    const name =
      `Dialog ${ordinal}: keeps keyboard focus inside the open dialog, preserves the selected ` +
      "combobox option, and returns focus to the custom trigger when the dialog closes";
    const source = {
      id: `linux/chromium/dialog-focus-and-selection-${ordinal}`,
      file: `app/src/examples/dialog-nested-select-combobox-with-custom-trigger-${ordinal}/test.ts`,
      titlePath: ["Chromium desktop, English, reduced motion", itemKey, name],
      retry: 0,
      status: "passed" as const,
    };
    const image = {
      ...template.image,
      id: `image-seed-${ordinal}`,
      digest: await digestJson(["representative", ordinal]),
      objectKey: `runs/seed/originals/${itemKey}/original.png`,
      bytes: 30_000 + ordinal,
      width: currentProfile.viewport.width,
      height: currentProfile.viewport.height,
    };
    const observedImage = {
      ...observation.image,
      digest: await digestJson(["observed", ordinal]),
      bytes: 32_000 + ordinal,
      width: image.width,
      height: image.height,
      path: `images/${itemKey}/${variant.key}.png`,
    };
    inventory.profiles.push({ digest: profileDigest, profile: currentProfile });
    inventory.captures.push({
      ...template,
      id: `capture-${ordinal}`,
      itemKey,
      variantKey: variant.key,
      ordinal,
      imageId: image.id,
      image,
      profileDigest,
      renderingProfileDigest: await digestRenderingProfile(currentProfile),
      environmentProfileDigest: await digestEnvironmentProfile(currentProfile),
      testId: source.id,
      metadata: {
        ...template.metadata,
        name,
        variant,
        profile: { $visonautProfileDigest: profileDigest },
        source,
        observedImage,
      },
    });
    manifest.captures.push({
      ...observation,
      itemKey,
      name,
      variant,
      ordinal,
      profileDigest,
      testId: source.id,
      image: observedImage,
    });
    manifest.tests.push(source);
    manifest.localComparison.captures.push({
      ...result,
      itemKey,
      variantKey: variant.key,
      candidateDigest: observedImage.digest,
      referenceDigest: image.digest,
    });
  }
  return inventory;
}

async function rawInventory(
  store: ReturnType<typeof objectStore>,
  inventory: { runId: string; captures: unknown[] },
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

  it.for([3_832, 4_000])(
    "fits %i distinct profiles and images within the Worker document budget",
    async (captureCount, { annotate }) => {
      const store = objectStore();
      const inventory = await scaleFixture(captureCount);
      const originalBytes = new TextEncoder().encode(canonicalJson(inventory)).byteLength;
      expect(originalBytes).toBeGreaterThan(maximumCaptureInventoryBytes);
      const pointer = await writeCaptureInventory(store, inventory);
      await annotate(
        `${captureCount} captures: ${originalBytes} original, ${pointer.bytes} stored bytes.`,
      );
      expect(pointer.captureCount).toBe(captureCount);
      expect(pointer.bytes).toBeLessThan(maximumCaptureInventoryBytes);
      const stored = storedInventory(store, pointer);
      expect(stored.schemaVersion).toBe("baseline-delta-v2");
      expect(Object.hasOwn(stored, "profiles")).toBe(false);
      expect(stored.captures.every((capture) => capture.metadataEncoding === "manifest-v1")).toBe(
        true,
      );
      const loaded = await readCaptureInventory(store, pointer);
      expect(loaded).toStrictEqual(inventory);
      expect(new Set(loaded.profiles.map(({ digest }) => digest)).size).toBe(captureCount);
      expect(new Set(loaded.captures.map(({ image }) => image.digest)).size).toBe(captureCount);
      expect(new Set(loaded.captures.map(({ imageId }) => imageId)).size).toBe(captureCount);
      expect(store.get).toHaveBeenCalledTimes(1);
    },
  );

  it("writes canonical content and hydrates profiles without fetching a predecessor or D1", async () => {
    const store = objectStore();
    const inventory = await fixture(true);
    const capture = inventory.captures[0];
    if (!capture) throw new Error("Missing capture.");
    const { profiles: _profiles, ...facts } = inventory;
    const expected = {
      ...facts,
      schemaVersion: "baseline-delta-v2",
      captures: [
        {
          ...capture,
          metadataEncoding: "manifest-v1",
          metadata: {
            profile: capture.metadata.profile,
            comparisonDigest: capture.metadata.comparisonDigest,
          },
        },
      ],
    };
    const encoded = canonicalJson(expected);
    const digest = await sha256(new TextEncoder().encode(encoded));
    const pointer = await writeCaptureInventory(store, inventory);
    expect(pointer).toEqual({
      objectKey: `runs/run/inventory/${digest}.json`,
      digest,
      bytes: new TextEncoder().encode(encoded).byteLength,
      captureCount: 1,
    });
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(store.objects.get(pointer.objectKey))).toBe(encoded);
    expect(pointer.digest).not.toBe(await digestJson(inventory));
    expect(storedInventory(store, pointer)).toStrictEqual(expected);
    const loaded = await readCaptureInventory(store, pointer);
    expect(loaded).toStrictEqual(inventory);
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
    expect(storedInventory(store, pointer)).toStrictEqual(inventory);
    expect(pointer.digest).toBe(await digestJson(inventory));
    expect(await readCaptureInventory(store, pointer)).toStrictEqual(inventory);
  });

  it("reads the original v1 wire format with or without a manifest", async () => {
    for (const withManifest of [false, true]) {
      const store = objectStore();
      const inventory = await fixture(withManifest);
      const pointer = await rawInventory(store, inventory);
      expect(await readCaptureInventory(store, pointer)).toStrictEqual(inventory);
    }
  });

  it("accepts only the public v1 inventory at the write boundary", async () => {
    const store = objectStore();
    const inventory = await fixture(true);
    Reflect.set(inventory, "schemaVersion", "baseline-delta-v2");
    await expect(writeCaptureInventory(store, inventory)).rejects.toThrow("version is unsupported");
    expect(store.put).not.toHaveBeenCalled();
  });

  it.each(["different order", "manifest subset"])(
    "retains the complete profile dictionary for a %s",
    async (mode) => {
      const store = objectStore();
      const inventory = await fixture(true);
      const manifest = inventory.manifest;
      const original = inventory.profiles[0];
      if (!manifest || !original) throw new Error("Missing profile dictionary.");
      const extraProfile = { ...profile, viewport: { width: 1280, height: 801 } };
      const extra = { digest: await digestJson(extraProfile), profile: extraProfile };
      inventory.profiles = [extra, original];
      manifest.profiles = mode === "different order" ? [original, extra] : [original];
      const pointer = await writeCaptureInventory(store, inventory);
      expect(storedInventory(store, pointer).profiles).toStrictEqual(inventory.profiles);
      expect(await readCaptureInventory(store, pointer)).toStrictEqual(inventory);
    },
  );

  it.each([
    "extra field",
    "missing source",
    "missing name",
    "missing variant",
    "missing comparison",
  ])("retains full metadata with an %s", async (mode) => {
    const store = objectStore();
    const inventory = await fixture(true);
    const capture = inventory.captures[0];
    if (!capture) throw new Error("Missing capture.");
    if (mode === "extra field") {
      capture.metadata.extension = { owner: "caller", sequence: [1, 2, 3] };
    } else {
      delete capture.metadata[mode.replace("missing ", "")];
    }
    const pointer = await writeCaptureInventory(store, inventory);
    const stored = storedInventory(store, pointer);
    expect(stored.schemaVersion).toBe("baseline-delta-v2");
    expect(stored.captures[0]).toStrictEqual(capture);
    expect(await readCaptureInventory(store, pointer)).toStrictEqual(inventory);
  });

  it("preserves absent legacy comparison fields while compacting the remaining metadata", async () => {
    const store = objectStore();
    const inventory = await fixture(true);
    const capture = inventory.captures[0];
    const observation = inventory.manifest?.captures[0];
    if (!capture || !observation) throw new Error("Missing observation.");
    delete capture.metadata.comparison;
    delete capture.metadata.comparisonDigest;
    delete observation.comparison;
    const pointer = await writeCaptureInventory(store, inventory);
    expect(storedInventory(store, pointer).captures[0]?.metadata).toStrictEqual({
      profile: capture.metadata.profile,
    });
    expect(storedInventory(store, pointer).captures[0]?.metadataEncoding).toBe("manifest-v1");
    expect(await readCaptureInventory(store, pointer)).toStrictEqual(inventory);
  });

  it.each(["caller-extension", "manifest-v1", null])(
    "stores the entire original v1 inventory when a capture owns metadataEncoding %j",
    async (marker) => {
      const store = objectStore();
      const inventory = await scaleFixture(2);
      const capture = inventory.captures[1];
      if (!capture) throw new Error("Missing capture.");
      Reflect.set(capture, "metadataEncoding", marker);
      const pointer = await writeCaptureInventory(store, inventory);
      expect(storedInventory(store, pointer)).toStrictEqual(inventory);
      expect(pointer.digest).toBe(await digestJson(inventory));
      expect(await readCaptureInventory(store, pointer)).toStrictEqual(inventory);
    },
  );

  it("retains the comparison mask image ID in compact metadata", async () => {
    const store = objectStore();
    const inventory = await fixture(true);
    const capture = inventory.captures[0];
    const result = inventory.manifest?.localComparison?.captures[0];
    const observed = inventory.manifest?.captures[0]?.image;
    if (!capture || !result || !observed) throw new Error("Missing receipt.");
    result.outcome = "changed";
    result.changedPixels = 1;
    result.ratio = 0.001;
    result.mask = { ...observed, digest: "2".repeat(64), path: "masks/dialog.png" };
    capture.metadata.candidateStored = true;
    capture.image = { ...capture.image, digest: observed.digest, bytes: observed.bytes };
    capture.metadata.localResult = {
      outcome: "changed",
      changedPixels: 1,
      ratio: 0.001,
      engineVersion: LOCAL_COMPARISON_ENGINE,
      codecVersion: LOCAL_COMPARISON_CODEC,
      maskExpected: true,
      maskImageId: "mask-run-dialog",
    };
    const pointer = await writeCaptureInventory(store, inventory);
    const stored = storedInventory(store, pointer).captures[0];
    expect(stored?.metadataEncoding).toBe("manifest-v1");
    expect(stored?.metadata).toStrictEqual({
      profile: capture.metadata.profile,
      comparisonDigest: capture.metadata.comparisonDigest,
      localResult: capture.metadata.localResult,
    });
    expect(await readCaptureInventory(store, pointer)).toStrictEqual(inventory);
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
    const pointer = await writeCaptureInventory(store, inventory);
    const stored = storedInventory(store, pointer).captures[0];
    expect(stored?.metadataEncoding).toBe("manifest-v1");
    expect(stored?.metadata.localResult).toStrictEqual(capture.metadata.localResult);
    const loaded = await readCaptureInventory(store, pointer);
    expect(loaded).toStrictEqual(inventory);
    expect(loaded.manifest?.localComparison?.captures[0]?.outcome).toBe("changed");
    expect(loaded.captures[0]?.metadata.localResult).toMatchObject({ outcome: "unchanged" });
    expect(loaded.captures[0]?.metadata.candidateStored).toBe(true);
    expect(loaded.captures[0]?.image.digest).toBe(observed.digest);
  });

  it.each([
    ["unsupported marker", "encoding is unsupported"],
    ["null marker", "encoding is unsupported"],
    ["missing saved profile", "missing profile"],
    ["extra saved field", "compact metadata is invalid"],
    ["nonobject metadata", "requires plain objects"],
    ["missing manifest", "missing manifest"],
    ["missing receipt", "no matching local receipt"],
  ])("rejects compact evidence with %s", async (mode, message) => {
    const store = objectStore();
    const pointer = await writeCaptureInventory(store, await fixture(true));
    const stored = storedInventory(store, pointer);
    const capture = stored.captures[0];
    if (!capture) throw new Error("Missing compact capture.");
    if (mode === "unsupported marker") {
      capture.metadataEncoding = "manifest-v2";
    }
    if (mode === "null marker") {
      capture.metadataEncoding = null;
    }
    if (mode === "missing saved profile") {
      delete capture.metadata.profile;
    }
    if (mode === "extra saved field") {
      capture.metadata.observedImage = { digest: "2".repeat(64) };
    }
    if (mode === "nonobject metadata") {
      Reflect.set(capture, "metadata", []);
    }
    if (mode === "missing manifest") {
      delete stored.manifest;
    }
    if (mode === "missing receipt") {
      const manifest = stored.manifest;
      if (!manifest) throw new Error("Missing manifest.");
      delete manifest.localComparison;
    }
    const malformed = await rawInventory(store, stored);
    await expect(readCaptureInventory(store, malformed)).rejects.toThrow(message);
  });

  it.each([
    ["profile reference", "profile reference differs"],
    ["comparison result", "comparison evidence differs"],
    ["receipt observation", "observation differs"],
    ["representative identity", "representative identity differs"],
    ["profile dictionary", "profile digest differs"],
  ])("validates expanded %s before returning public facts", async (mode, message) => {
    const store = objectStore();
    const pointer = await writeCaptureInventory(store, await fixture(true));
    const stored = storedInventory(store, pointer);
    const capture = stored.captures[0];
    if (!capture) throw new Error("Missing compact capture.");
    if (mode === "profile reference") {
      capture.metadata.profile = { $visonautProfileDigest: "2".repeat(64) };
    }
    if (mode === "comparison result") {
      capture.metadata.localResult = {
        outcome: "unchanged",
        changedPixels: 1,
        ratio: 0,
        engineVersion: LOCAL_COMPARISON_ENGINE,
        codecVersion: LOCAL_COMPARISON_CODEC,
        maskExpected: false,
      };
    }
    if (mode === "receipt observation") {
      const observation = stored.manifest?.captures[0];
      if (!observation) throw new Error("Missing observation.");
      observation.image.digest = "2".repeat(64);
    }
    if (mode === "representative identity") {
      capture.image.id = "other-image";
    }
    if (mode === "profile dictionary") {
      const profiles = stored.manifest?.profiles;
      if (!profiles) throw new Error("Missing profiles.");
      stored.profiles = structuredClone(profiles);
      const original = stored.profiles[0];
      if (!original) throw new Error("Missing profile.");
      original.profile.viewport.width += 1;
    }
    const corrupted = await rawInventory(store, stored);
    await expect(readCaptureInventory(store, corrupted)).rejects.toThrow(message);
  });

  it.each(["checksum", "noncanonical"])(
    "checks compact wire %s before expanding metadata",
    async (mode) => {
      const store = objectStore();
      const pointer = await writeCaptureInventory(store, await fixture(true));
      const stored = storedInventory(store, pointer);
      const capture = stored.captures[0];
      if (!capture) throw new Error("Missing compact capture.");
      capture.metadataEncoding = "manifest-v2";
      if (mode === "checksum") {
        store.objects.set(pointer.objectKey, new TextEncoder().encode(canonicalJson(stored)));
        await expect(readCaptureInventory(store, pointer)).rejects.toThrow("checksum differs");
        return;
      }
      const noncanonical = await rawInventory(store, stored, JSON.stringify(stored, null, 2));
      await expect(readCaptureInventory(store, noncanonical)).rejects.toThrow("not canonical JSON");
    },
  );

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
