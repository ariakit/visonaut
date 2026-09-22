import {
  canonicalJson,
  digestEnvironmentProfile,
  digestJson,
  identityKey,
  isJson,
} from "./hash.js";
import type {
  CaptureProfile,
  Manifest,
  TrustedCollection,
  TrustedPlan,
  VerifiedDiscoveryEvidence,
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
  for (const key of ["browserVersion", "locale", "timezone", "comparisonEngineVersion"]) {
    string(field(value, key), key);
  }
  for (const key of ["osImageDigest", "fontsDigest", "comparisonPolicyDigest"]) {
    validateDigest(field(value, key), key);
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

function validateVariant(value: unknown) {
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
  if (Object.hasOwn(value, "discovery")) {
    const discovery = field(value, "discovery");
    object(discovery, "discovery");
    for (const key of ["executorDigest", "configurationDigest", "inventoryDigest"]) {
      validateDigest(field(discovery, key), key);
    }
  }
}

/** Unknown optional fields survive parsing and contribute to the payload digest. */
export function parseManifest(value: unknown): Manifest {
  assertManifest(value);
  return value;
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
    const digests = field(shard, "environmentProfileDigests");
    list(digests, "environmentProfileDigests", 1, 10_000);
    for (const digest of digests) {
      validateDigest(digest);
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
