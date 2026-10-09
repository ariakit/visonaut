import {
  canonicalJson,
  digestEnvironmentProfile,
  digestJson,
  identityKey,
  isJson,
} from "./hash.js";
import type {
  CaptureComparison,
  CapturePage,
  CapturePageEntry,
  CapturePageIndex,
  CapturePageIndexLimits,
  CapturePageTest,
  CaptureProfile,
  CaptureReference,
  CaptureReferenceIdentity,
  CaptureRow,
  CaptureRowClip,
  CaptureRowImage,
  CaptureRowResult,
  CaptureRowView,
  CaptureSource,
  Json,
  Variant,
  ComparisonPolicy,
  Manifest,
  TrustedCollection,
  TrustedPlan,
  VerifiedDiscoveryEvidence,
  LocalComparisonReceipt,
  LocalReferenceBinding,
} from "./types.js";
import {
  CAPTURE_PAGE_MAX_BYTES,
  CAPTURE_PAGE_ROWS,
  LOCAL_COMPARISON_MODE,
  LOCAL_COMPARISON_ENGINE,
  LOCAL_COMPARISON_CODEC,
} from "./types.js";

export class ProtocolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}

function fail(message: string): never {
  throw new ProtocolError("INVALID_MANIFEST", message);
}

function object(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    fail(`${label} must be a plain object`);
  }
}

export function validateCaptureComparison(value: unknown): asserts value is CaptureComparison {
  object(value, "capture comparison");
  const threshold = field(value, "threshold");
  if (
    typeof threshold !== "number" ||
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 1
  ) {
    fail("Capture comparison threshold must be between 0 and 1");
  }
  if (Object.hasOwn(value, "maxDiffPixels")) {
    integer(value.maxDiffPixels, "maxDiffPixels");
  }
  if (Object.hasOwn(value, "maxDiffPixelRatio")) {
    const ratio = value.maxDiffPixelRatio;
    if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      fail("Capture comparison maxDiffPixelRatio must be between 0 and 1");
    }
  }
}

function field(value: Record<string, unknown>, key: string): unknown {
  if (!Object.hasOwn(value, key)) {
    fail(`Missing ${key}`);
  }
  return value[key];
}

function required<K extends string, T>(
  value: Record<string, unknown>,
  key: K,
  validate: (entry: unknown, label: string) => asserts entry is T,
): asserts value is Record<string, unknown> & Record<K, T> {
  validate(field(value, key), key);
}

function string(value: unknown, label: string, maximum = 1024): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > maximum ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    fail(`${label} must be a nonempty string of at most ${maximum} characters without controls`);
  }
}

function integer(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
}

function list(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = 100_000,
): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    fail(`${label} must be an array with ${minimum}–${maximum} entries`);
  }
}

function member<const T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): asserts value is T {
  if (!values.some((entry) => entry === value)) {
    fail(`${label} must be one of ${values.join(", ")}`);
  }
}

export function validateKey(value: unknown, label = "key"): asserts value is string {
  string(value, label, 256);
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    fail(`${label} must be an explicit stable key without empty or traversal segments`);
  }
}

export function validateDigest(value: unknown, label = "digest"): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    fail(`${label} must be a lowercase SHA-256 digest`);
  }
}

export function validateVersion(value: unknown): asserts value is string {
  string(value, "schemaVersion", 32);
  if (!/^1\.(0|[1-9][0-9]*)$/.test(value)) {
    throw new ProtocolError(
      "UNSUPPORTED_SCHEMA",
      `Unsupported schemaVersion ${value}; expected 1.x`,
    );
  }
}

function unique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) {
    fail(`Duplicate ${label}`);
  }
}

function validateViewport(value: unknown) {
  object(value, "viewport");
  integer(field(value, "width"), "viewport.width", 1, 100_000);
  integer(field(value, "height"), "viewport.height", 1, 100_000);
}

export function validateProfile(value: unknown): asserts value is CaptureProfile {
  object(value, "profile");
  member(field(value, "browser"), ["chromium", "firefox", "webkit"], "browser");
  for (const key of ["browserVersion", "locale", "timezone"]) {
    string(field(value, key), key);
  }
  for (const key of ["osImageDigest", "fontsDigest"]) {
    validateDigest(field(value, key), key);
  }
  if (Object.hasOwn(value, "comparisonPolicyDigest")) {
    validateDigest(value.comparisonPolicyDigest, "comparisonPolicyDigest");
  }
  if (Object.hasOwn(value, "comparisonEngineVersion")) {
    string(value.comparisonEngineVersion, "comparisonEngineVersion");
  }
  validateViewport(field(value, "viewport"));
  const scale = field(value, "deviceScaleFactor");
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0 || scale > 10) {
    fail("deviceScaleFactor must be greater than zero and at most 10");
  }
  member(field(value, "reducedMotion"), ["reduce", "no-preference"], "reducedMotion");
  member(field(value, "colorScheme"), ["light", "dark", "no-preference"], "colorScheme");
  member(field(value, "contrast"), ["more", "no-preference"], "contrast");
  member(field(value, "forcedColors"), ["active", "none"], "forcedColors");
  member(field(value, "animationPolicy"), ["disabled"], "animationPolicy");
  const options = field(value, "captureOptions");
  object(options, "captureOptions");
  if (!isJson(options)) {
    fail("captureOptions must contain bounded JSON values");
  }
}

function validateVariant(value: unknown): asserts value is Variant {
  object(value, "variant");
  validateKey(field(value, "key"), "variant.key");
  member(field(value, "browser"), ["chromium", "firefox", "webkit"], "variant.browser");
  if (Object.hasOwn(value, "framework")) {
    validateKey(value.framework, "variant.framework");
  }
  if (Object.hasOwn(value, "colorScheme")) {
    member(value.colorScheme, ["light", "dark", "no-preference"], "variant.colorScheme");
  }
  if (Object.hasOwn(value, "contrast")) {
    member(value.contrast, ["more", "no-preference"], "variant.contrast");
  }
  if (Object.hasOwn(value, "forcedColors")) {
    member(value.forcedColors, ["active", "none"], "variant.forcedColors");
  }
  if (Object.hasOwn(value, "dimensions")) {
    object(value.dimensions, "variant.dimensions");
    if (Object.keys(value.dimensions).length > 32) {
      fail("Too many variant dimensions");
    }
    for (const [key, entry] of Object.entries(value.dimensions)) {
      validateKey(key, "dimension key");
      if (typeof entry === "string") {
        string(entry, "dimension value");
      } else if (
        typeof entry !== "boolean" &&
        !(typeof entry === "number" && Number.isFinite(entry))
      ) {
        fail("Variant dimensions must be strings, booleans, or finite numbers");
      }
    }
  }
}

function assertManifest(value: unknown): asserts value is Manifest {
  object(value, "manifest");
  validateVersion(field(value, "schemaVersion"));
  const producer = field(value, "producer");
  object(producer, "producer");
  for (const key of ["name", "version", "nodeVersion", "playwrightVersion"]) {
    string(field(producer, key), `producer.${key}`);
  }
  const run = field(value, "run");
  object(run, "run");
  const repository = field(run, "repository");
  string(repository, "repository");
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) {
    fail("repository must be owner/name");
  }
  for (const key of ["repositoryId", "workflowRunId"]) {
    const identifier = field(run, key);
    string(identifier, key, 32);
    if (!/^[1-9][0-9]*$/.test(identifier)) {
      fail(`${key} must be a positive decimal ID`);
    }
  }
  integer(field(run, "workflowAttempt"), "workflowAttempt", 1);
  validateDigest(field(run, "planDigest"), "planDigest");
  const testedSha = field(run, "testedSha");
  if (typeof testedSha !== "string" || !/^[a-f0-9]{40}$/.test(testedSha)) {
    fail("testedSha must be a full lowercase Git commit SHA");
  }
  const shard = field(value, "shard");
  object(shard, "shard");
  required(shard, "key", validateKey);
  string(field(shard, "jobId"), "shard.jobId", 64);
  integer(field(shard, "sourceAttempt"), "sourceAttempt", 1);
  if (typeof run.workflowAttempt !== "number" || shard.sourceAttempt !== run.workflowAttempt) {
    fail("A submitted shard must belong to this workflow attempt; inheritance is server-owned");
  }
  const profiles = field(value, "profiles");
  list(profiles, "profiles", 1, 10_000);
  const profileDigests: string[] = [];
  const profilesByDigest = new Map<string, CaptureProfile>();
  for (const profile of profiles) {
    object(profile, "profile record");
    required(profile, "digest", validateDigest);
    required(profile, "profile", validateProfile);
    profileDigests.push(profile.digest);
    profilesByDigest.set(profile.digest, profile.profile);
  }
  unique(profileDigests, "profile digest");
  const tests = field(value, "tests");
  list(tests, "tests", 1);
  const testRetries = new Map<string, number>();
  for (const test of tests) {
    object(test, "test");
    required(test, "id", string);
    string(field(test, "file"), "test.file");
    required(test, "retry", integer);
    member(field(test, "status"), ["passed"], "test.status");
    const titlePath = field(test, "titlePath");
    list(titlePath, "titlePath", 1, 100);
    for (const title of titlePath) {
      string(title, "title");
    }
    if (testRetries.has(test.id)) {
      fail(`Duplicate test identity ${test.id}`);
    }
    testRetries.set(test.id, test.retry);
  }
  const captures = field(value, "captures");
  list(captures, "captures", 1);
  const identities: string[] = [];
  let previousOrdinal = -1;
  for (const capture of captures) {
    object(capture, "capture");
    required(capture, "itemKey", validateKey);
    if (Object.hasOwn(capture, "name")) {
      string(capture.name, "name");
    }
    const variant = field(capture, "variant");
    validateVariant(variant);
    object(variant, "variant");
    validateKey(variant.key, "variant.key");
    identities.push(identityKey({ itemKey: capture.itemKey, variantKey: variant.key }));
    required(capture, "ordinal", integer);
    if (capture.ordinal <= previousOrdinal) {
      fail("Capture ordinals must be unique and strictly increasing in declared order");
    }
    previousOrdinal = capture.ordinal;
    required(capture, "testId", string);
    required(capture, "testRetry", integer);
    if (testRetries.get(capture.testId) !== capture.testRetry) {
      fail("Capture must use the selected successful test attempt");
    }
    required(capture, "profileDigest", validateDigest);
    if (Object.hasOwn(capture, "comparison")) {
      validateCaptureComparison(capture.comparison);
    }
    if (!profilesByDigest.has(capture.profileDigest)) {
      fail("Capture refers to a missing profile");
    }
    const profile = profilesByDigest.get(capture.profileDigest);
    if (!profile || variant.browser !== profile.browser) {
      fail("Variant browser differs from the capture profile");
    }
    for (const key of ["colorScheme", "contrast", "forcedColors"] as const) {
      if (Object.hasOwn(variant, key) && variant[key] !== profile[key]) {
        fail(`Variant ${key} differs from the capture profile`);
      }
    }
    const image = field(capture, "image");
    object(image, "image");
    validateDigest(field(image, "digest"), "image.digest");
    member(field(image, "mediaType"), ["image/png", "image/webp"], "image.mediaType");
    integer(field(image, "bytes"), "image.bytes", 1, 100_000_000);
    integer(field(image, "width"), "image.width", 1, 100_000);
    integer(field(image, "height"), "image.height", 1, 100_000);
    validateKey(field(image, "path"), "image.path");
  }
  unique(identities, "item/variant identity");
  if (Object.hasOwn(value, "localComparison")) validateLocalComparison(value.localComparison);
  if (Object.hasOwn(value, "captureSources")) {
    const sources = field(value, "captureSources");
    list(sources, "captureSources", 1, 16);
    const keys: string[] = [];
    for (const source of sources) {
      validateCaptureSource(source);
      keys.push(source.shardKey);
    }
    unique(keys, "capture source shard");
  }
  if (Object.hasOwn(value, "discovery")) {
    const discovery = field(value, "discovery");
    object(discovery, "discovery");
    for (const key of ["executorDigest", "configurationDigest", "inventoryDigest"]) {
      validateDigest(field(discovery, key), key);
    }
  }
}

function decimalId(value: unknown, label: string): asserts value is string {
  string(value, label, 32);
  if (!/^[1-9][0-9]*$/.test(value)) {
    fail(`${label} must be a positive decimal ID`);
  }
}

function validateCaptureSource(value: unknown): asserts value is CaptureSource {
  object(value, "capture source");
  required(value, "shardKey", validateKey);
  integer(field(value, "workflowAttempt"), "source workflowAttempt", 1);
  for (const key of ["jobId", "artifactId"]) {
    decimalId(field(value, key), key);
  }
  string(field(value, "jobName"), "jobName", 256);
  string(field(value, "artifactName"), "artifactName", 256);
  validateDigest(field(value, "manifestDigest"), "manifestDigest");
}

/** Unknown optional fields survive parsing and contribute to the payload digest. */
export function parseManifest(value: unknown): Manifest {
  assertManifest(value);
  return value;
}

export function validateLocalReference(value: unknown): asserts value is LocalReferenceBinding {
  object(value, "local reference");
  for (const key of ["manifestDigest", "inventoryDigest"]) validateDigest(field(value, key), key);
  const snapshotId = field(value, "snapshotId");
  if (snapshotId !== null) string(snapshotId, "snapshotId", 256);
  integer(field(value, "baselineRevision"), "baselineRevision");
  integer(field(value, "captureCount"), "captureCount", 0, 100_000);
}

export function validateLocalComparison(value: unknown): asserts value is LocalComparisonReceipt {
  object(value, "local comparison");
  member(field(value, "mode"), [LOCAL_COMPARISON_MODE], "local comparison mode");
  member(field(value, "engineVersion"), [LOCAL_COMPARISON_ENGINE], "local engine");
  member(field(value, "codecVersion"), [LOCAL_COMPARISON_CODEC], "local codec");
  validateLocalReference(field(value, "reference"));
  const captures = field(value, "captures");
  list(captures, "local results", 1);
  const identities: string[] = [];
  for (const result of captures) {
    object(result, "local result");
    required(result, "itemKey", validateKey);
    required(result, "variantKey", validateKey);
    identities.push(identityKey({ itemKey: result.itemKey, variantKey: result.variantKey }));
    required(result, "candidateDigest", validateDigest);
    if (field(result, "referenceDigest") !== null) validateDigest(result.referenceDigest);
    member(field(result, "outcome"), ["unchanged", "changed"], "local outcome");
    integer(field(result, "changedPixels"), "changedPixels");
    const ratio = field(result, "ratio");
    if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1)
      fail("Local ratio is invalid");
    if (typeof field(result, "sizeChanged") !== "boolean")
      fail("Local sizeChanged must be boolean");
    if (Object.hasOwn(result, "mask")) {
      const mask = field(result, "mask");
      object(mask, "local mask");
      validateDigest(field(mask, "digest"));
      member(field(mask, "mediaType"), ["image/png"], "mask media type");
      integer(field(mask, "bytes"), "mask bytes", 1, 20 * 1024 * 1024);
      integer(field(mask, "width"), "mask width", 1, 100_000);
      integer(field(mask, "height"), "mask height", 1, 100_000);
      validateKey(field(mask, "path"), "mask path");
      if (result.outcome !== "changed" || result.referenceDigest === null)
        fail("Only changed matched captures can have a mask");
    }
  }
  unique(identities, "local result identity");
  const identitySet = new Set(identities);
  const removals = field(value, "removals");
  list(removals, "local removals", 0);
  const removed: string[] = [];
  for (const removal of removals) {
    object(removal, "local removal");
    required(removal, "itemKey", validateKey);
    required(removal, "variantKey", validateKey);
    const key = identityKey({ itemKey: removal.itemKey, variantKey: removal.variantKey });
    if (identitySet.has(key)) fail("A capture cannot also be removed");
    removed.push(key);
  }
  unique(removed, "local removal identity");
}

/** Full capture inventory stays intact; only this byte set needs upload tickets. */
export function uploadImages(
  manifest: Manifest,
): Map<string, Manifest["captures"][number]["image"]> {
  const results = new Map(
    manifest.localComparison?.captures.map((result) => [identityKey(result), result]),
  );
  const images = new Map<string, Manifest["captures"][number]["image"]>();
  const add = (image: Manifest["captures"][number]["image"]) => {
    const existing = images.get(image.digest);
    if (
      existing &&
      (existing.bytes !== image.bytes ||
        existing.width !== image.width ||
        existing.height !== image.height ||
        existing.mediaType !== image.mediaType)
    )
      fail("Shared image metadata differs");
    images.set(image.digest, image);
  };
  for (const capture of manifest.captures) {
    const result = results.get(
      identityKey({ itemKey: capture.itemKey, variantKey: capture.variant.key }),
    );
    if (!manifest.localComparison || result?.outcome !== "unchanged") add(capture.image);
    if (result?.mask) add(result.mask);
  }
  return images;
}

export function validateCollection(value: unknown): asserts value is TrustedCollection {
  object(value, "collection");
  const projectName = field(value, "projectName");
  if (typeof projectName !== "string" || projectName.length > 256) {
    fail("Invalid collection project name");
  }
  const testDir = field(value, "testDir");
  if (testDir !== ".") {
    validateKey(testDir, "collection.testDir");
  }
  for (const key of ["testMatch", "testIgnore"]) {
    const patterns = field(value, key);
    list(patterns, key, key === "testMatch" ? 1 : 0, 100);
    for (const pattern of patterns) {
      string(pattern, key);
    }
  }
  for (const key of ["grep", "grepInvert"]) {
    const patterns = field(value, key);
    list(patterns, key, key === "grep" ? 1 : 0, 100);
    for (const pattern of patterns) {
      object(pattern, "regular expression");
      string(field(pattern, "source"), "regular expression source");
      const flags = field(pattern, "flags");
      if (typeof flags !== "string" || !/^[dgimsuvy]*$/.test(flags)) {
        fail("Invalid regular expression flags");
      }
    }
  }
  const shard = field(value, "shard");
  if (shard !== null) {
    object(shard, "collection.shard");
    required(shard, "current", integer);
    required(shard, "total", integer);
    if (shard.current < 1 || shard.total < shard.current || shard.total > 1000) {
      fail("Invalid collection shard allocation");
    }
  }
  if (field(value, "repeatEach") !== 1) {
    fail("Trusted collection requires repeatEach: 1");
  }
}

function assertTrustedPlan(value: unknown): asserts value is TrustedPlan {
  object(value, "trusted plan");
  validateVersion(field(value, "schemaVersion"));
  string(field(value, "repositoryId"), "repositoryId", 32);
  string(field(value, "workflow"), "workflow");
  const invocation = field(value, "invocation");
  list(invocation, "invocation", 1, 100);
  for (const argument of invocation) {
    string(argument, "invocation argument");
  }
  const discovery = Object.hasOwn(value, "discovery") ? field(value, "discovery") : undefined;
  if (discovery !== undefined) {
    object(discovery, "trusted discovery");
    validateDigest(field(discovery, "executorDigest"), "executorDigest");
  }
  const shards = field(value, "shards");
  list(shards, "shards", 1, 1000);
  const shardKeys: string[] = [];
  const jobNames: string[] = [];
  const captureKeys: string[] = [];
  const collectionGroups = new Map<string, { total: number; indices: Set<number> }>();
  for (const shard of shards) {
    object(shard, "planned shard");
    required(shard, "key", validateKey);
    shardKeys.push(shard.key);
    required(shard, "jobName", string);
    jobNames.push(shard.jobName);
    const profilePolicy = Object.hasOwn(shard, "environmentProfilePolicy")
      ? field(shard, "environmentProfilePolicy")
      : undefined;
    if (profilePolicy === "measured") {
      if (Object.hasOwn(shard, "environmentProfileDigests")) {
        fail("Measured profiles cannot include an environment allow-list");
      }
    } else {
      if (profilePolicy !== undefined) {
        fail("Unknown environment profile policy");
      }
      const digests = field(shard, "environmentProfileDigests");
      list(digests, "environmentProfileDigests", 1, 10_000);
      for (const digest of digests) {
        validateDigest(digest);
      }
    }
    if (discovery !== undefined) {
      required(shard, "collection", validateCollection);
      const collection = shard.collection;
      const groupKey = canonicalJson({ ...collection, shard: null });
      const total = collection.shard?.total ?? 1;
      const index = collection.shard?.current ?? 1;
      const group = collectionGroups.get(groupKey) ?? { total, indices: new Set<number>() };
      if (group.total !== total || group.indices.has(index)) {
        fail("Trusted collection has conflicting or duplicated shard allocation");
      }
      group.indices.add(index);
      collectionGroups.set(groupKey, group);
      if (Object.hasOwn(shard, "tests")) {
        fail("Discovered plans must not freeze candidate test identities");
      }
      continue;
    }
    const tests = field(shard, "tests");
    list(tests, "planned tests", 1);
    const testIds: string[] = [];
    for (const test of tests) {
      object(test, "planned test");
      required(test, "id", string);
      testIds.push(test.id);
      const captures = field(test, "captures");
      list(captures, "planned captures");
      for (const capture of captures) {
        object(capture, "planned capture");
        required(capture, "itemKey", validateKey);
        required(capture, "variantKey", validateKey);
        captureKeys.push(identityKey({ itemKey: capture.itemKey, variantKey: capture.variantKey }));
      }
    }
    unique(testIds, "planned test id within shard");
  }
  unique(shardKeys, "planned shard key");
  unique(jobNames, "planned job name");
  for (const group of collectionGroups.values()) {
    if (group.indices.size !== group.total) {
      fail("Trusted collection must include every configured shard");
    }
  }
  unique(captureKeys, "planned capture identity");
  if (discovery === undefined && !captureKeys.length) {
    fail("A trusted plan must require captures");
  }
}

export function parseTrustedPlan(value: unknown): TrustedPlan {
  assertTrustedPlan(value);
  return value;
}

export async function validateManifestProfiles(manifest: Manifest): Promise<void> {
  for (const { digest, profile } of manifest.profiles) {
    if ((await digestJson(profile)) !== digest) {
      fail("Capture profile digest does not match its content");
    }
  }
}

/** Validate quarantined data; this does not authorize sealing or removals. */
export async function validateShardDeclaration(
  manifest: Manifest,
  plan: TrustedPlan,
): Promise<void> {
  parseManifest(manifest);
  parseTrustedPlan(plan);
  if (
    manifest.run.repositoryId !== plan.repositoryId ||
    manifest.run.planDigest !== (await digestJson(plan))
  ) {
    fail("Manifest does not match the trusted capture plan");
  }
  const shard = plan.shards.find((entry) => entry.key === manifest.shard.key);
  if (!shard) {
    fail("Shard is not in the trusted capture plan");
  }
  if (plan.discovery) {
    const discovery = manifest.discovery;
    if (!discovery || !shard.collection) {
      fail("Trusted candidate discovery is missing");
    }
    if (
      discovery.executorDigest !== plan.discovery.executorDigest ||
      discovery.configurationDigest !== (await digestJson(shard.collection))
    ) {
      fail("Candidate discovery used a different trusted executor or collection configuration");
    }
    const inventory = manifest.tests.map(({ id, file, titlePath }) => ({ id, file, titlePath }));
    if (discovery.inventoryDigest !== (await digestJson(inventory))) {
      fail("Candidate discovery does not cover the successful test inventory");
    }
  } else {
    const plannedTests = shard.tests;
    if (!plannedTests || plannedTests.length !== manifest.tests.length) {
      fail("Manifest does not cover all planned tests");
    }
    const expectedCaptures = plannedTests.flatMap((test) =>
      test.captures.map((capture) => ({ ...capture, testId: test.id })),
    );
    if (manifest.captures.length !== expectedCaptures.length) {
      fail("Manifest does not cover all planned captures");
    }
    for (const [index, test] of plannedTests.entries()) {
      if (manifest.tests[index]?.id !== test.id) {
        fail("Manifest test order differs from the trusted plan");
      }
    }
    for (const [index, expected] of expectedCaptures.entries()) {
      const actual = manifest.captures[index];
      if (
        !actual ||
        actual.itemKey !== expected.itemKey ||
        actual.variant.key !== expected.variantKey ||
        actual.testId !== expected.testId
      ) {
        fail("Manifest capture identity or order differs from the trusted plan");
      }
    }
  }
  if (shard.environmentProfilePolicy !== "measured") {
    const allowedEnvironments = new Set(shard.environmentProfileDigests);
    const allowedProfiles = new Set<string>();
    for (const profile of manifest.profiles) {
      if (allowedEnvironments.has(await digestEnvironmentProfile(profile.profile))) {
        allowedProfiles.add(profile.digest);
      }
    }
    for (const capture of manifest.captures) {
      if (!allowedProfiles.has(capture.profileDigest)) {
        fail("Capture environment profile is not allowed by the trusted plan");
      }
    }
  }
  await validateManifestProfiles(manifest);
}

/** The evidence must come from the server's GitHub verifier, never from JSON. */
export async function validateShardAgainstPlan(
  manifest: Manifest,
  plan: TrustedPlan,
  evidence?: VerifiedDiscoveryEvidence,
): Promise<void> {
  await validateShardDeclaration(manifest, plan);
  if (!plan.discovery) return;
  if (
    !evidence ||
    evidence.conclusion !== "success" ||
    evidence.workflowRunId !== manifest.run.workflowRunId ||
    evidence.workflowAttempt !== manifest.run.workflowAttempt ||
    evidence.testedSha !== manifest.run.testedSha ||
    evidence.jobId !== manifest.shard.jobId ||
    evidence.executorDigest !== plan.discovery.executorDigest ||
    evidence.manifestDigest !== (await digestJson(manifest))
  ) {
    fail("Candidate discovery requires server-verified successful trusted-job evidence");
  }
}

export function validateComparisonPolicy(value: unknown): asserts value is ComparisonPolicy {
  object(value, "comparison policy");
  string(field(value, "id"), "comparison policy id", 256);
  const threshold = field(value, "channelThreshold");
  const ratio = field(value, "maxChangedRatio");
  if (
    typeof threshold !== "number" ||
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 255 ||
    typeof ratio !== "number" ||
    !Number.isFinite(ratio) ||
    ratio < 0 ||
    ratio > 1
  ) {
    fail("Comparison policy threshold or ratio is invalid");
  }
  if (Object.hasOwn(value, "maxChangedPixels")) {
    integer(value.maxChangedPixels, "maxChangedPixels");
  }
}

// One image of a row or one mask. The Submit bounds of the CLI are smaller.
const CAPTURE_ROW_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const CAPTURE_ROW_IMAGE_MAX_SIDE = 100_000;

/** Order by the item key, then by the variant key. Keys are ASCII, so this is also byte order. */
export function compareCaptureIdentity(
  first: readonly [itemKey: string, variantKey: string],
  second: readonly [itemKey: string, variantKey: string],
): number {
  if (first[0] !== second[0]) {
    return first[0] < second[0] ? -1 : 1;
  }
  if (first[1] !== second[1]) {
    return first[1] < second[1] ? -1 : 1;
  }
  return 0;
}

function validateRowClip(value: unknown): asserts value is CaptureRowClip | null {
  if (value === null) return;
  if (!Array.isArray(value) || value.length !== 4) {
    fail("A row clip must be null or have x, y, width, and height");
  }
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      fail("A row clip must hold finite numbers");
    }
  }
}

function validateRowImage(value: Record<keyof CaptureRowImage, unknown>, label: string) {
  validateDigest(value.digest, `${label} digest`);
  integer(value.bytes, `${label} bytes`, 1, CAPTURE_ROW_IMAGE_MAX_BYTES);
  integer(value.width, `${label} width`, 1, CAPTURE_ROW_IMAGE_MAX_SIDE);
  integer(value.height, `${label} height`, 1, CAPTURE_ROW_IMAGE_MAX_SIDE);
}

function validateRowResult(
  value: unknown,
  image: CaptureRowImage,
): asserts value is CaptureRowResult {
  if (value === 0) return;
  if (value === 1) return;
  object(value, "row result");
  required(value, "reference", validateDigest);
  // Equal bytes have the result 0, so that one capture has one row form.
  if (value.reference === image.digest) {
    fail("A compared capture cannot have the bytes of its reference");
  }
  member(field(value, "outcome"), ["unchanged", "changed"], "row outcome");
  integer(field(value, "changedPixels"), "changedPixels", 0, image.width * image.height);
  const ratio = field(value, "ratio");
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    fail("Row ratio must be between 0 and 1");
  }
  if (typeof field(value, "sizeChanged") !== "boolean") {
    fail("Row sizeChanged must be boolean");
  }
  if (!Object.hasOwn(value, "mask")) return;
  const mask = value.mask;
  object(mask, "row mask");
  validateRowImage(
    {
      digest: field(mask, "digest"),
      bytes: field(mask, "bytes"),
      width: field(mask, "width"),
      height: field(mask, "height"),
    },
    "mask",
  );
  if (value.outcome !== "changed") {
    fail("Only a changed capture can have a mask");
  }
}

function validatePageTest(value: unknown): asserts value is CapturePageTest {
  object(value, "page test");
  required(value, "id", string);
  string(field(value, "file"), "test.file");
  required(value, "retry", integer);
  const titlePath = field(value, "titlePath");
  list(titlePath, "titlePath", 1, 100);
  for (const title of titlePath) {
    string(title, "title");
  }
}

function validatePageProfile(value: unknown): asserts value is CaptureProfile {
  validateProfile(value);
  if (Object.hasOwn(value, "comparisonPolicyDigest")) {
    fail("A page profile cannot hold comparison settings");
  }
  if (Object.hasOwn(value, "comparisonEngineVersion")) {
    fail("A page profile cannot hold comparison settings");
  }
}

interface SharedListParams<T> {
  page: Record<string, unknown>;
  key: string;
  rowCount: number;
  parse: (entry: unknown) => T;
  identity: (entry: T) => string;
}

/** A shared list of a page has at most one entry for each row, and no entry two times. */
function sharedList<T>({ page, key, rowCount, parse, identity }: SharedListParams<T>): T[] {
  const entries = field(page, key);
  list(entries, key, 1, rowCount);
  const result: T[] = [];
  const identities: string[] = [];
  for (const value of entries) {
    const entry = parse(value);
    result.push(entry);
    identities.push(identity(entry));
  }
  unique(identities, `page ${key} entry`);
  return result;
}

/**
 * Validate one capture page: the bounds of each field, the order of the rows,
 * and the order of each shared list. The caller bounds the bytes of the body
 * with `CAPTURE_PAGE_MAX_BYTES` before it parses the JSON text. Only the last
 * page of a run can have fewer than `CAPTURE_PAGE_ROWS` rows, and only a
 * reader of all pages can check that.
 */
export function parseCapturePage(value: unknown): CapturePage {
  assertCapturePage(value);
  return value;
}

function assertCapturePage(value: unknown): asserts value is CapturePage {
  object(value, "capture page");
  validateVersion(field(value, "schemaVersion"));
  const rows = field(value, "rows");
  list(rows, "rows", 1, CAPTURE_PAGE_ROWS);
  const rowCount = rows.length;
  const variants = sharedList({
    page: value,
    key: "variants",
    rowCount,
    parse: (entry) => {
      validateVariant(entry);
      return entry;
    },
    // Two captures can use one variant key with two contents, as in a manifest of today.
    identity: canonicalJson,
  });
  const profiles = sharedList({
    page: value,
    key: "profiles",
    rowCount,
    parse: (entry) => {
      validatePageProfile(entry);
      return entry;
    },
    identity: canonicalJson,
  });
  const tests = sharedList({
    page: value,
    key: "tests",
    rowCount,
    parse: (entry) => {
      validatePageTest(entry);
      return entry;
    },
    identity: (test) => test.id,
  });
  const comparisons = sharedList({
    page: value,
    key: "comparisons",
    rowCount,
    parse: (entry) => {
      validateCaptureComparison(entry);
      return entry;
    },
    identity: canonicalJson,
  });
  // The count of entries of each shared list that the rows before this one use.
  const used = { variant: 0, test: 0, profile: 0, comparison: 0 };
  const position = (entry: unknown, key: keyof typeof used) => {
    integer(entry, `row ${key}`, 0, used[key]);
    // A list has the order of first use, so a new entry is always the next one.
    if (entry === used[key]) {
      used[key]++;
    }
    return entry;
  };
  // One digest names one image, so each use of it in a page has the same size.
  const images = new Map<string, CaptureRowImage>();
  const sameImage = (image: CaptureRowImage) => {
    const first = images.get(image.digest);
    if (!first) {
      images.set(image.digest, image);
      return;
    }
    if (
      first.bytes !== image.bytes ||
      first.width !== image.width ||
      first.height !== image.height
    ) {
      fail("One image digest of a page has two sizes");
    }
  };
  let previous: [string, string] | undefined;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 12) {
      fail("A capture row must have 12 positions");
    }
    const [itemKey, name, variantAt, testAt, profileAt, clip, comparisonAt] = row;
    const [, , , , , , , digest, bytes, width, height, result] = row;
    validateKey(itemKey, "itemKey");
    if (name !== null) {
      string(name, "name");
      if (name === itemKey) {
        fail("A row name that is the item key must be null");
      }
    }
    const variant = variants[position(variantAt, "variant")];
    const test = tests[position(testAt, "test")];
    const profile = profiles[position(profileAt, "profile")];
    const comparison = comparisons[position(comparisonAt, "comparison")];
    if (!variant || !test || !profile || !comparison) {
      fail("A row refers to a missing shared entry");
    }
    validateRowClip(clip);
    if (clip && Object.hasOwn(profile.captureOptions, "clip")) {
      fail("A row with a clip needs a profile without captureOptions.clip");
    }
    // One capture has one row form: a rectangle that a row can hold is in the row.
    if (!clip && captureRowProfile(profile).clip) {
      fail("A clip rectangle of a profile must be in the row");
    }
    if (variant.browser !== profile.browser) {
      fail("Variant browser differs from the capture profile");
    }
    for (const key of ["colorScheme", "contrast", "forcedColors"] as const) {
      if (Object.hasOwn(variant, key) && variant[key] !== profile[key]) {
        fail(`Variant ${key} differs from the capture profile`);
      }
    }
    const image = { digest, bytes, width, height };
    validateRowImage(image, "image");
    validateRowResult(result, image);
    sameImage(image);
    if (typeof result === "object" && result.mask) {
      sameImage(result.mask);
    }
    const identity: [string, string] = [itemKey, variant.key];
    if (previous && compareCaptureIdentity(previous, identity) >= 0) {
      fail("Capture rows must increase by the item key and then the variant key");
    }
    previous = identity;
  }
  if (
    used.variant !== variants.length ||
    used.test !== tests.length ||
    used.profile !== profiles.length ||
    used.comparison !== comparisons.length
  ) {
    fail("Each shared entry of a page must be used by a row");
  }
}

/** The canonical JSON bytes of a page: the request body, and the input of its digest. */
export function capturePageBytes(page: CapturePage): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(canonicalJson(page));
  if (bytes.byteLength > CAPTURE_PAGE_MAX_BYTES) {
    fail(`A capture page must have at most ${CAPTURE_PAGE_MAX_BYTES} bytes`);
  }
  return bytes;
}

/** The row form of `captureOptions.clip`, when the value has exactly the four numbers. */
function clipRectangle(clip: Json | undefined): CaptureRowClip | null {
  if (!clip) return null;
  if (typeof clip !== "object") return null;
  if (Array.isArray(clip)) return null;
  if (Object.keys(clip).length !== 4) return null;
  const { x, y, width, height } = clip;
  if (typeof x !== "number") return null;
  if (typeof y !== "number") return null;
  if (typeof width !== "number") return null;
  if (typeof height !== "number") return null;
  return [x, y, width, height];
}

/**
 * Move the clip rectangle of a profile into a row, so that captures that
 * differ only in the rectangle share one profile of the page. A clip with
 * another form stays in the profile.
 */
export function captureRowProfile(profile: CaptureProfile): {
  profile: CaptureProfile;
  clip: CaptureRowClip | null;
} {
  const { clip, ...captureOptions } = profile.captureOptions;
  const rectangle = clipRectangle(clip);
  if (!rectangle) {
    return { profile, clip: null };
  }
  return { profile: { ...profile, captureOptions }, clip: rectangle };
}

/**
 * Read one row of a validated page as an object with names. The profile is the
 * complete profile of the capture, and its digest is the digest that the
 * capture job computed.
 */
export async function captureRowView(page: CapturePage, row: CaptureRow): Promise<CaptureRowView> {
  const [itemKey, name, variantAt, testAt, profileAt, clip, comparisonAt] = row;
  const [, , , , , , , digest, bytes, width, height, result] = row;
  const variant = page.variants[variantAt];
  const test = page.tests[testAt];
  const shared = page.profiles[profileAt];
  const comparison = page.comparisons[comparisonAt];
  if (!variant || !test || !shared || !comparison) {
    fail("A row refers to a missing shared entry");
  }
  const profile = clip
    ? {
        ...shared,
        captureOptions: {
          ...shared.captureOptions,
          clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3] },
        },
      }
    : shared;
  return {
    itemKey,
    variantKey: variant.key,
    name: name ?? itemKey,
    variant,
    test,
    profile,
    profileDigest: await digestJson(profile),
    comparison,
    image: { digest, bytes, width, height },
    result,
  };
}

/**
 * The images of a validated page that the service does not have from the
 * reference: each new or changed capture, and each mask. All images are PNG.
 */
export function capturePageUploads(page: CapturePage): Map<string, CaptureRowImage> {
  const images = new Map<string, CaptureRowImage>();
  for (const row of page.rows) {
    const [, , , , , , , digest, bytes, width, height, result] = row;
    if (result === 0) continue;
    if (result === 1 || result.outcome === "changed") {
      images.set(digest, { digest, bytes, width, height });
    }
    if (result !== 1 && result.mask) {
      images.set(result.mask.digest, result.mask);
    }
  }
  return images;
}

export function validateCaptureReferenceIdentity(
  value: unknown,
): asserts value is CaptureReferenceIdentity {
  object(value, "capture reference");
  const snapshotId = field(value, "snapshotId");
  if (snapshotId !== null) {
    string(snapshotId, "snapshotId", 256);
  }
  integer(field(value, "baselineRevision"), "baselineRevision");
  const digest = field(value, "digest");
  if (digest !== null) {
    validateDigest(digest, "reference digest");
  }
}

/** The reference of a reserve answer. A run with no reference has no reference page. */
export function validateCaptureReference(value: unknown): asserts value is CaptureReference {
  object(value, "capture reference");
  const pages = field(value, "pages");
  integer(pages, "reference pages");
  validateCaptureReferenceIdentity(value);
  if ((value.digest === null) !== (pages === 0)) {
    fail("Only a run with no reference has no reference page");
  }
}

function validatePageEntry(value: unknown): asserts value is CapturePageEntry {
  object(value, "page entry");
  required(value, "digest", validateDigest);
  const last = field(value, "last");
  if (!Array.isArray(last) || last.length !== 2) {
    fail("A page entry must name its last item key and variant key");
  }
  validateKey(last[0], "last itemKey");
  validateKey(last[1], "last variantKey");
}

/**
 * Validate the page index of a run. The two lists grow with the run, so the
 * caller gives their bounds: the protocol has no limit for a complete run.
 */
export function parseCapturePageIndex(
  value: unknown,
  limits: CapturePageIndexLimits,
): CapturePageIndex {
  assertCapturePageIndex(value, limits);
  return value;
}

function assertCapturePageIndex(
  value: unknown,
  { maximumPages, maximumSources }: CapturePageIndexLimits,
): asserts value is CapturePageIndex {
  for (const limit of [maximumPages, maximumSources]) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new TypeError("The limits of a page index must be positive integers");
    }
  }
  object(value, "page index");
  validateVersion(field(value, "schemaVersion"));
  const producer = field(value, "producer");
  object(producer, "producer");
  for (const key of ["name", "version", "nodeVersion", "playwrightVersion"]) {
    string(field(producer, key), `producer.${key}`);
  }
  const job = field(value, "job");
  object(job, "job");
  decimalId(field(job, "id"), "job.id");
  const attempt = field(job, "attempt");
  integer(attempt, "job.attempt", 1);
  const comparison = field(value, "comparison");
  object(comparison, "comparison");
  member(field(comparison, "engineVersion"), [LOCAL_COMPARISON_ENGINE], "local engine");
  member(field(comparison, "codecVersion"), [LOCAL_COMPARISON_CODEC], "local codec");
  validateCaptureReferenceIdentity(field(value, "reference"));
  const sources = field(value, "sources");
  list(sources, "sources", 1, maximumSources);
  const shardKeys: string[] = [];
  for (const source of sources) {
    validateCaptureSource(source);
    if (source.workflowAttempt > attempt) {
      fail("A capture source comes from a later workflow attempt");
    }
    shardKeys.push(source.shardKey);
  }
  unique(shardKeys, "capture source shard");
  const pages = field(value, "pages");
  list(pages, "pages", 1, maximumPages);
  const digests: string[] = [];
  let previous: CapturePageEntry | undefined;
  for (const page of pages) {
    validatePageEntry(page);
    if (previous && compareCaptureIdentity(previous.last, page.last) >= 0) {
      fail("Page entries must increase by the item key and then the variant key");
    }
    previous = page;
    digests.push(page.digest);
  }
  unique(digests, "page digest");
}
