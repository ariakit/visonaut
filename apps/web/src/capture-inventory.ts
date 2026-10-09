import {
  canonicalJson,
  digestEnvironmentProfile,
  digestJson,
  digestRenderingProfile,
  identityKey,
  parseManifest,
  sha256,
  validateDigest,
  validateKey,
  validateProfile,
  type CaptureProfile,
  type Manifest,
  type ProfileRecord,
} from "@visonaut/protocol";
import type { CaptureInput, CaptureInventoryPointer, ValidatedImage } from "@visonaut/service";
import {
  encodeCapturePages,
  isCapturePagesKey,
  readCapturePages,
  type CapturePagesInput,
} from "./capture-pages.ts";
export type { CaptureInventoryPointer } from "@visonaut/service";

export interface InventoryCapture extends CaptureInput {
  renderingProfileDigest: string;
  /** The retained representative can differ from metadata.observedImage. */
  image: ValidatedImage;
}

export interface CaptureInventory {
  schemaVersion: "baseline-delta-v1";
  projectId: string;
  runId: string;
  testedSha: string;
  referenceSnapshotId: string | null;
  captures: InventoryCapture[];
  profiles: ProfileRecord[];
  /** Imported baselines have facts but no new signed capture receipt. */
  manifest?: Manifest;
}

export interface InventoryStore {
  get(key: string): Promise<{
    size: number;
    body: ReadableStream<Uint8Array>;
  } | null>;
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType: string }; sha256?: string },
  ): Promise<unknown>;
}

interface WriteInventoryOptions {
  maximumBytes?: number;
  /** Bootstrap uses baselines/import/<id> to avoid the old run cleanup. */
  prefix?: string;
}

// Leave room for the decoded JSON and capture graph in a 128 MiB Worker.
export const maximumCaptureInventoryBytes = 16 * 1024 * 1024;

function record(value: unknown): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error("Capture inventory requires plain objects.");
  }
}

function field(value: Record<string, unknown>, key: string) {
  if (!Object.hasOwn(value, key)) {
    throw new Error(`Capture inventory is missing ${key}.`);
  }
  return value[key];
}

function identifier(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)
  ) {
    throw new Error("Capture inventory identity is invalid.");
  }
}

// Test IDs follow the manifest string contract, including CLI shard prefixes.
function assertTestId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 1024 ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    throw new Error("Capture inventory test ID is invalid.");
  }
}

function integer(
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER,
  minimum = 0,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error("Capture inventory integer is invalid.");
  }
}

function array(value: unknown, maximum: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error("Capture inventory collection is invalid.");
  }
}

function assertImage(value: unknown): asserts value is ValidatedImage {
  record(value);
  identifier(field(value, "id"));
  identifier(field(value, "runId"));
  validateDigest(field(value, "digest"));
  const objectKey = field(value, "objectKey");
  validateKey(objectKey);
  if (
    !objectKey.startsWith(`runs/${value.runId}/`) &&
    !/^baselines\/import\/[a-zA-Z0-9][a-zA-Z0-9._-]*\//.test(objectKey)
  ) {
    throw new Error("Capture inventory image owner differs from its key.");
  }
  if (value.contentType !== "image/png" && value.contentType !== "image/webp") {
    throw new Error("Capture inventory image type is invalid.");
  }
  integer(field(value, "bytes"), 100_000_000, 1);
  integer(field(value, "width"), 100_000, 1);
  integer(field(value, "height"), 100_000, 1);
  if (Object.hasOwn(value, "role") && value.role !== "original") {
    throw new Error("Capture inventory requires original representatives.");
  }
}

function assertCapture(value: unknown): asserts value is InventoryCapture {
  record(value);
  identifier(field(value, "id"));
  validateKey(field(value, "itemKey"));
  validateKey(field(value, "variantKey"));
  integer(field(value, "ordinal"));
  identifier(field(value, "imageId"));
  for (const key of ["profileDigest", "environmentProfileDigest", "renderingProfileDigest"]) {
    validateDigest(field(value, key));
  }
  assertTestId(field(value, "testId"));
  integer(field(value, "testRetry"));
  record(field(value, "metadata"));
  const image = field(value, "image");
  assertImage(image);
  if (value.imageId !== image.id) {
    throw new Error("Capture inventory representative identity differs.");
  }
}

function assertInventory(value: unknown): asserts value is CaptureInventory {
  record(value);
  if (value.schemaVersion !== "baseline-delta-v1") {
    throw new Error("Capture inventory version is unsupported.");
  }
  identifier(field(value, "projectId"));
  identifier(field(value, "runId"));
  const testedSha = field(value, "testedSha");
  if (typeof testedSha !== "string" || !/^[a-f0-9]{40}$/.test(testedSha)) {
    throw new Error("Capture inventory tested commit is invalid.");
  }
  const reference = field(value, "referenceSnapshotId");
  if (reference !== null) {
    identifier(reference);
  }
  const captures = field(value, "captures");
  array(captures, 100_000);
  for (const capture of captures) {
    assertCapture(capture);
  }
  const profiles = field(value, "profiles");
  // Almost each capture has its own clip rectangle, and so its own profile.
  array(profiles, 100_000);
  for (const profile of profiles) {
    record(profile);
    validateDigest(field(profile, "digest"));
    validateProfile(field(profile, "profile"));
  }
  if (Object.hasOwn(value, "manifest")) {
    parseManifest(value.manifest);
  }
}

function metadataProfile(capture: InventoryCapture, profile: CaptureProfile) {
  const stored = field(capture.metadata, "profile");
  record(stored);
  if (Object.hasOwn(stored, "$visonautProfileDigest")) {
    if (
      Object.keys(stored).length !== 1 ||
      stored.$visonautProfileDigest !== capture.profileDigest
    ) {
      throw new Error("Capture inventory profile reference differs.");
    }
    return;
  }
  validateProfile(stored);
  if (canonicalJson(stored) !== canonicalJson(profile)) {
    throw new Error("Capture inventory inline profile differs.");
  }
}

function validateReceipt(inventory: CaptureInventory) {
  const manifest = inventory.manifest;
  if (!manifest) return;
  if (
    manifest.run.testedSha !== inventory.testedSha ||
    manifest.captures.length !== inventory.captures.length
  ) {
    throw new Error("Capture inventory differs from its complete manifest.");
  }
  const receipt = manifest.localComparison;
  if (!receipt || receipt.reference.snapshotId !== inventory.referenceSnapshotId) {
    throw new Error("Capture inventory has no matching local receipt.");
  }
  const results = new Map(receipt.captures.map((result) => [identityKey(result), result]));
  for (const [index, capture] of inventory.captures.entries()) {
    const observed = manifest.captures[index];
    const result = results.get(identityKey(capture));
    if (
      !observed ||
      !result ||
      observed.itemKey !== capture.itemKey ||
      observed.variant.key !== capture.variantKey ||
      observed.ordinal !== capture.ordinal ||
      observed.testId !== capture.testId ||
      observed.testRetry !== capture.testRetry ||
      observed.profileDigest !== capture.profileDigest ||
      result.candidateDigest !== observed.image.digest ||
      canonicalJson(capture.metadata.observedImage) !== canonicalJson(observed.image)
    ) {
      throw new Error("Capture inventory observation differs from its receipt.");
    }
    if (
      capture.metadata.localMode !== receipt.mode ||
      capture.metadata.candidateStored !== (result.outcome !== "unchanged")
    ) {
      throw new Error("Capture inventory candidate storage evidence differs.");
    }
    const local = capture.metadata.localResult;
    record(local);
    // A zero-pixel profile change keeps the signed receipt but needs no review.
    const normalized =
      result.outcome === "changed" &&
      result.referenceDigest !== null &&
      result.changedPixels === 0 &&
      result.ratio === 0 &&
      !result.sizeChanged &&
      !result.mask;
    if (
      (local.outcome !== result.outcome && !(normalized && local.outcome === "unchanged")) ||
      local.changedPixels !== result.changedPixels ||
      local.ratio !== result.ratio ||
      local.engineVersion !== receipt.engineVersion ||
      local.codecVersion !== receipt.codecVersion ||
      local.maskExpected !== !!result.mask
    ) {
      throw new Error("Capture inventory comparison evidence differs.");
    }
    if (
      capture.image.width !== observed.image.width ||
      capture.image.height !== observed.image.height ||
      (result.outcome !== "unchanged" &&
        (capture.image.digest !== observed.image.digest ||
          capture.image.bytes !== observed.image.bytes ||
          capture.image.contentType !== observed.image.mediaType))
    ) {
      throw new Error("Capture inventory representative differs from its observation.");
    }
  }
}

interface CompactCapture extends InventoryCapture {
  metadataEncoding?: "manifest-v1";
}

interface CompactInventory extends Omit<CaptureInventory, "schemaVersion" | "profiles"> {
  schemaVersion: "baseline-delta-v2";
  profiles?: ProfileRecord[];
  captures: CompactCapture[];
  manifest: Manifest;
}

function receiptMetadata(manifest: Manifest) {
  const receipt = manifest.localComparison;
  if (!receipt) throw new Error("Capture inventory has no matching local receipt.");
  const results = new Map(receipt.captures.map((result) => [identityKey(result), result]));
  const tests = new Map(manifest.tests.map((test) => [test.id, test]));
  return (index: number, saved: Record<string, unknown>) => {
    const capture = manifest.captures[index];
    if (!capture) throw new Error("Capture inventory observation differs from its receipt.");
    const result = results.get(
      identityKey({ itemKey: capture.itemKey, variantKey: capture.variant.key }),
    );
    if (!result) throw new Error("Capture inventory observation differs from its receipt.");
    return {
      name: capture.name ?? capture.itemKey,
      variant: capture.variant,
      ...(tests.has(capture.testId) ? { source: tests.get(capture.testId) } : {}),
      localMode: receipt.mode,
      observedImage: capture.image,
      candidateStored: result.outcome !== "unchanged",
      ...(Object.hasOwn(capture, "comparison") ? { comparison: capture.comparison } : {}),
      localResult: {
        outcome: result.outcome,
        changedPixels: result.changedPixels,
        ratio: result.ratio,
        engineVersion: receipt.engineVersion,
        codecVersion: receipt.codecVersion,
        maskExpected: !!result.mask,
      },
      ...saved,
    };
  };
}

/** Elide only facts that the retained receipt restores without any change. */
function compactInventory(inventory: CaptureInventory): CaptureInventory | CompactInventory {
  const manifest = inventory.manifest;
  if (
    !manifest ||
    inventory.captures.some((capture) => Object.hasOwn(capture, "metadataEncoding"))
  ) {
    return inventory;
  }
  const restoreMetadata = receiptMetadata(manifest);
  const { profiles, ...rest } = inventory;
  return {
    ...rest,
    schemaVersion: "baseline-delta-v2",
    manifest,
    ...(canonicalJson(profiles) === canonicalJson(manifest.profiles) ? {} : { profiles }),
    captures: inventory.captures.map((capture, index) => {
      const metadata = capture.metadata;
      const saved: Record<string, unknown> = { profile: metadata.profile };
      if (Object.hasOwn(metadata, "comparisonDigest")) {
        saved.comparisonDigest = metadata.comparisonDigest;
      }
      const restored = restoreMetadata(index, saved);
      if (canonicalJson(restored.localResult) !== canonicalJson(metadata.localResult)) {
        saved.localResult = metadata.localResult;
      }
      if (canonicalJson(restoreMetadata(index, saved)) !== canonicalJson(metadata)) {
        return capture;
      }
      return { ...capture, metadata: saved, metadataEncoding: "manifest-v1" };
    }),
  };
}

function expandInventory(value: unknown): unknown {
  record(value);
  if (value.schemaVersion !== "baseline-delta-v2") return value;
  const captures = field(value, "captures");
  array(captures, 100_000);
  if (Object.hasOwn(value, "profiles")) array(value.profiles, 10_000);
  const manifest = parseManifest(field(value, "manifest"));
  const restoreMetadata = receiptMetadata(manifest);
  return {
    ...value,
    schemaVersion: "baseline-delta-v1",
    profiles: Object.hasOwn(value, "profiles") ? value.profiles : manifest.profiles,
    captures: captures.map((capture, index) => {
      record(capture);
      if (!Object.hasOwn(capture, "metadataEncoding")) return capture;
      if (capture.metadataEncoding !== "manifest-v1") {
        throw new Error("Capture inventory metadata encoding is unsupported.");
      }
      const metadata = field(capture, "metadata");
      record(metadata);
      if (
        Object.keys(metadata).some(
          (key) => !["profile", "comparisonDigest", "localResult"].includes(key),
        )
      ) {
        throw new Error("Capture inventory compact metadata is invalid.");
      }
      const { metadataEncoding: _metadataEncoding, ...rest } = capture;
      return { ...rest, metadata: restoreMetadata(index, metadata) };
    }),
  };
}

async function validatedInventory(value: unknown): Promise<CaptureInventory> {
  assertInventory(value);
  const profiles = new Map<
    string,
    { profile: CaptureProfile; rendering: string; environment: string }
  >();
  for (const { digest, profile } of value.profiles) {
    if (profiles.has(digest) || (await digestJson(profile)) !== digest) {
      throw new Error("Capture inventory profile digest differs or is duplicated.");
    }
    profiles.set(digest, {
      profile,
      rendering: await digestRenderingProfile(profile),
      environment: await digestEnvironmentProfile(profile),
    });
  }
  const identities = new Set<string>();
  const captureIds = new Set<string>();
  const images = new Map<string, string>();
  let ordinal = -1;
  for (const capture of value.captures) {
    const identity = identityKey(capture);
    const profile = profiles.get(capture.profileDigest);
    if (identities.has(identity) || captureIds.has(capture.id) || capture.ordinal <= ordinal) {
      throw new Error("Capture inventory identity or order is duplicated.");
    }
    if (
      !profile ||
      profile.rendering !== capture.renderingProfileDigest ||
      profile.environment !== capture.environmentProfileDigest
    ) {
      throw new Error("Capture inventory profile identity differs.");
    }
    metadataProfile(capture, profile.profile);
    const image = canonicalJson(capture.image);
    const previous = images.get(capture.image.id);
    if (previous !== undefined && previous !== image) {
      throw new Error("Capture inventory shared representative differs.");
    }
    identities.add(identity);
    captureIds.add(capture.id);
    images.set(capture.image.id, image);
    ordinal = capture.ordinal;
  }
  if (value.manifest) {
    for (const { digest, profile } of value.manifest.profiles) {
      const stored = profiles.get(digest);
      if (!stored || canonicalJson(stored.profile) !== canonicalJson(profile)) {
        throw new Error("Capture inventory manifest profile differs.");
      }
    }
  }
  validateReceipt(value);
  return value;
}

function maximumSize(maximumBytes: number) {
  integer(maximumBytes, maximumCaptureInventoryBytes, 1);
  return maximumBytes;
}

/** Store the full inventory once; D1 retains only this immutable pointer. */
export async function writeCaptureInventory(
  store: Pick<InventoryStore, "put">,
  inventory: CaptureInventory,
  maximum: number | WriteInventoryOptions = maximumCaptureInventoryBytes,
): Promise<CaptureInventoryPointer> {
  const options = typeof maximum === "number" ? { maximumBytes: maximum } : maximum;
  const maximumBytes = maximumSize(options.maximumBytes ?? maximumCaptureInventoryBytes);
  await validatedInventory(inventory);
  const encoded = canonicalJson(compactInventory(inventory));
  const bytes = new TextEncoder().encode(encoded);
  if (bytes.byteLength > maximumBytes) {
    throw new Error("Capture inventory exceeds its size limit.");
  }
  const digest = await sha256(bytes);
  const prefix = options.prefix ?? `runs/${inventory.runId}`;
  if (
    prefix !== `runs/${inventory.runId}` &&
    !/^baselines\/import\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(prefix)
  ) {
    throw new Error("Capture inventory storage prefix is invalid.");
  }
  const objectKey = `${prefix}/inventory/${digest}.json`;
  validateKey(objectKey);
  await store.put(objectKey, encoded, {
    httpMetadata: { contentType: "application/json" },
    sha256: digest,
  });
  return { objectKey, digest, bytes: bytes.byteLength, captureCount: inventory.captures.length };
}

/**
 * Store the capture list of a run as pages of rows and one index. The pointer
 * names the index, and it has the same four values as a pointer of the earlier
 * form, so D1 holds the same columns.
 */
export async function writeCapturePages(
  store: Pick<InventoryStore, "put">,
  input: CapturePagesInput,
): Promise<CaptureInventoryPointer> {
  const { objects, pointer, inventory } = await encodeCapturePages(input);
  await validatedInventory(inventory);
  // The index is the last object, so a pointer never names a missing page.
  for (const { key, text, digest } of objects) {
    await store.put(key, text, {
      httpMetadata: { contentType: "application/json" },
      sha256: digest,
    });
  }
  return pointer;
}

async function readInventoryValue(
  body: ReadableStream<Uint8Array>,
  pointer: CaptureInventoryPointer,
): Promise<unknown> {
  const bytes = new Uint8Array(pointer.bytes);
  const reader = body.getReader();
  let offset = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (next.value.byteLength > bytes.byteLength - offset) {
        await reader.cancel();
        throw new Error("Capture inventory exceeds its size limit.");
      }
      bytes.set(next.value, offset);
      offset += next.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== pointer.bytes || (await sha256(bytes)) !== pointer.digest) {
    throw new Error("Capture inventory checksum differs.");
  }
  const encoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed: unknown = JSON.parse(encoded);
  if (canonicalJson(parsed) !== encoded) {
    throw new Error("Capture inventory is not canonical JSON.");
  }
  return parsed;
}

/**
 * Verify the original wire document as well as its complete capture facts. The
 * document of a run that is stored as pages is its page index.
 */
export async function readCaptureInventoryDocument(
  store: Pick<InventoryStore, "get">,
  pointer: CaptureInventoryPointer,
  maximumBytes = maximumCaptureInventoryBytes,
): Promise<{ inventory: CaptureInventory; document: unknown }> {
  maximumSize(maximumBytes);
  record(pointer);
  validateDigest(field(pointer, "digest"));
  validateKey(field(pointer, "objectKey"));
  integer(field(pointer, "bytes"), maximumBytes, 1);
  integer(field(pointer, "captureCount"), 100_000);
  // The key says which form the run has: a page index, or one complete object.
  if (isCapturePagesKey(pointer.objectKey)) {
    const pages = await readCapturePages(store, pointer);
    const inventory = await validatedInventory(pages.inventory);
    if (inventory.captures.length !== pointer.captureCount) {
      throw new Error("Capture inventory pointer content differs.");
    }
    return { inventory, document: pages.document };
  }
  if (!pointer.objectKey.endsWith(`/inventory/${pointer.digest}.json`)) {
    throw new Error("Capture inventory pointer identity differs.");
  }
  if (
    !/^runs\/[a-zA-Z0-9][a-zA-Z0-9._-]*\/inventory\/[a-f0-9]{64}\.json$/.test(pointer.objectKey) &&
    !/^baselines\/import\/[a-zA-Z0-9][a-zA-Z0-9._-]*\/inventory\/[a-f0-9]{64}\.json$/.test(
      pointer.objectKey,
    )
  ) {
    throw new Error("Capture inventory pointer prefix is invalid.");
  }
  const object = await store.get(pointer.objectKey);
  if (!object) {
    throw new Error("Capture inventory is unavailable.");
  }
  if (object.size !== pointer.bytes) {
    await object.body.cancel();
    throw new Error("Capture inventory stored size differs.");
  }
  // Release the encoded buffers before asynchronous profile validation.
  const document = await readInventoryValue(object.body, pointer);
  const inventory = await validatedInventory(expandInventory(document));
  const runKey = `runs/${inventory.runId}/inventory/${pointer.digest}.json`;
  const importedKey =
    /^baselines\/import\/[a-zA-Z0-9][a-zA-Z0-9._-]*\/inventory\/[a-f0-9]{64}\.json$/.test(
      pointer.objectKey,
    );
  if (
    (pointer.objectKey !== runKey && !importedKey) ||
    inventory.captures.length !== pointer.captureCount
  ) {
    throw new Error("Capture inventory pointer content differs.");
  }
  return { inventory, document };
}

/**
 * Resolve the complete capture list of one run, with no reads of predecessor
 * inventories. A run has one complete object, or pages of rows and one index.
 */
export async function readCaptureInventory(
  store: Pick<InventoryStore, "get">,
  pointer: CaptureInventoryPointer,
  maximumBytes = maximumCaptureInventoryBytes,
): Promise<CaptureInventory> {
  const { inventory } = await readCaptureInventoryDocument(store, pointer, maximumBytes);
  return inventory;
}

/** Review reads use the inventory's verified dictionary, without D1 profiles. */
export function inventoryMetadata(inventory: CaptureInventory): InventoryCapture[] {
  const profiles = new Map(inventory.profiles.map(({ digest, profile }) => [digest, profile]));
  return inventory.captures.map((capture) => {
    const profile = profiles.get(capture.profileDigest);
    if (!profile) {
      throw new Error("Capture inventory profile is unavailable.");
    }
    return { ...capture, metadata: { ...capture.metadata, profile } };
  });
}
