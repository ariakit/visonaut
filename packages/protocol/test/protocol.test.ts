import { describe, expect, it } from "vitest";
import {
  FIXED_DIGEST,
  canonicalJson,
  LOCAL_COMPARISON_MODE,
  LOCAL_COMPARISON_ENGINE,
  LOCAL_COMPARISON_CODEC,
  digestJson,
  digestEnvironmentProfile,
  identityKey,
  parseManifest,
  reviewStateWords,
  runClosedReasons,
  runClosedReasonWords,
  runClosedWords,
  sha256,
  validateManifestProfiles,
  workflowSourceDigest,
} from "../src/index.js";
import type { CaptureProfile, Manifest, TrustedPlan } from "../src/index.js";

it("commits workflow-owned manifests to the immutable reusable source", async () => {
  const sha = "a".repeat(40);
  expect(await workflowSourceDigest(sha)).toBe(
    await digestJson({ schemaVersion: "1.0", source: "workflow", reusableWorkflowSha: sha }),
  );
  expect(() => workflowSourceDigest("main")).toThrow("full reusable workflow SHA");
});

it("exports the fixed digest of the CLI and the adapter, which parseManifest accepts in both fields", async () => {
  // The SHA-256 of the empty text. No pinned value gives it.
  expect(FIXED_DIGEST).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  expect(FIXED_DIGEST).toBe(await sha256(new Uint8Array()));
  const { manifest } = await fixture();
  manifest.run.planDigest = FIXED_DIGEST;
  manifest.discovery = {
    executorDigest: FIXED_DIGEST,
    configurationDigest: "a".repeat(64),
    inventoryDigest: "b".repeat(64),
  };
  const parsed = parseManifest(manifest);
  expect(parsed.run.planDigest).toBe(FIXED_DIGEST);
  expect(parsed.discovery?.executorDigest).toBe(FIXED_DIGEST);
});

async function fixture() {
  const profile: CaptureProfile = {
    browser: "chromium",
    browserVersion: "149.0",
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
    captureOptions: { fullPage: false, animations: "disabled" },
    comparisonPolicyDigest: "c".repeat(64),
    comparisonEngineVersion: "1",
  };
  const profileDigest = await digestJson(profile);
  const plan: TrustedPlan = {
    schemaVersion: "1.0",
    repositoryId: "123",
    workflow: ".github/workflows/visual.yml",
    invocation: ["pnpm", "test:visual"],
    shards: [
      {
        key: "chrome-1",
        jobName: "chrome",
        environmentProfileDigests: [profileDigest],
        tests: [
          { id: "test-1", captures: [{ itemKey: "dialog/open", variantKey: "react-light" }] },
        ],
      },
    ],
  };
  const manifest: Manifest = {
    schemaVersion: "1.0",
    producer: {
      name: "@visonaut/playwright",
      version: "0.1.0",
      nodeVersion: "24.18.0",
      playwrightVersion: "1.63.0",
    },
    run: {
      repository: "ariakit/ariakit",
      repositoryId: "123",
      workflowRunId: "456",
      workflowAttempt: 1,
      testedSha: "d".repeat(40),
      planDigest: await digestJson(plan),
    },
    shard: { key: "chrome-1", jobId: "789", sourceAttempt: 1 },
    profiles: [{ digest: profileDigest, profile }],
    tests: [
      {
        id: "test-1",
        file: "dialog.test.ts",
        titlePath: ["dialog", "open"],
        retry: 1,
        status: "passed",
      },
    ],
    captures: [
      {
        itemKey: "dialog/open",
        name: "Open dialog",
        variant: {
          key: "react-light",
          browser: "chromium",
          framework: "react",
          colorScheme: "light",
        },
        ordinal: 0,
        testId: "test-1",
        testRetry: 1,
        profileDigest,
        image: {
          digest: "e".repeat(64),
          mediaType: "image/png",
          width: 2,
          height: 3,
          bytes: 80,
          path: "images/test.png",
        },
      },
    ],
  };
  return { manifest, plan };
}

function first<T>(values: T[]): T {
  const value = values[0];
  if (value === undefined) {
    throw new Error("Fixture entry is missing");
  }
  return value;
}

describe("versioned manifests", () => {
  it.each([
    { threshold: 0.2, maxDiffPixels: 0 },
    { threshold: 0, maxDiffPixelRatio: 0.1 },
    { threshold: 1, maxDiffPixels: 5, maxDiffPixelRatio: 0.5 },
  ])("preserves exact consumer screenshot settings %j", async (comparison) => {
    const { manifest } = await fixture();
    first(manifest.captures).comparison = comparison;
    const parsed = parseManifest(JSON.parse(JSON.stringify(manifest)));
    expect(first(parsed.captures).comparison).toEqual(comparison);
    expect(parsed.profiles).toEqual(manifest.profiles);
  });

  it.each([
    {},
    { threshold: -0.1 },
    { threshold: 1.1 },
    { threshold: NaN },
    { threshold: Infinity },
    { threshold: "0.2" },
    { threshold: 0.2, maxDiffPixels: -1 },
    { threshold: 0.2, maxDiffPixels: 0.5 },
    { threshold: 0.2, maxDiffPixels: NaN },
    { threshold: 0.2, maxDiffPixelRatio: -0.1 },
    { threshold: 0.2, maxDiffPixelRatio: 1.1 },
    { threshold: 0.2, maxDiffPixelRatio: NaN },
  ])("rejects invalid consumer screenshot settings %j", async (comparison) => {
    const { manifest } = await fixture();
    const capture = first(manifest.captures);
    expect(() => parseManifest({ ...manifest, captures: [{ ...capture, comparison }] })).toThrow();
  });

  it("accepts old clients and preserves optional additions from compatible clients", async () => {
    const { manifest } = await fixture();
    expect(parseManifest(manifest)).toEqual(manifest);
    const newer = { ...manifest, schemaVersion: "1.7", optionalFeature: { enabled: true } };
    expect(parseManifest(newer)).toEqual(newer);
    expect(() => parseManifest({ ...manifest, schemaVersion: "2.0" })).toThrow(
      "Unsupported schemaVersion 2.0",
    );
  });
  it("rejects duplicate identity even when display names differ", async () => {
    const { manifest } = await fixture();
    const capture = first(manifest.captures);
    manifest.captures.push({ ...capture, name: "Renamed", ordinal: 1 });
    expect(() => parseManifest(manifest)).toThrow("Duplicate item/variant");
  });
  it("keeps titles outside stable keys and profile digests", async () => {
    const { manifest } = await fixture();
    const capture = first(manifest.captures);
    const original = identityKey({ itemKey: capture.itemKey, variantKey: capture.variant.key });
    capture.name = "New title";
    expect(identityKey({ itemKey: capture.itemKey, variantKey: capture.variant.key })).toBe(
      original,
    );
    capture.itemKey = "dialog/renamed";
    expect(identityKey({ itemKey: capture.itemKey, variantKey: capture.variant.key })).not.toBe(
      original,
    );
    await expect(validateManifestProfiles(manifest)).resolves.toBeUndefined();
  });
  it("requires increasing ordinals, valid profiles, successful retries and safe paths", async () => {
    const { manifest } = await fixture();
    const missingProfile = structuredClone(manifest);
    first(missingProfile.captures).profileDigest = "0".repeat(64);
    expect(() => parseManifest(missingProfile)).toThrow("missing profile");
    const failedRetry = structuredClone(manifest);
    first(failedRetry.captures).testRetry = 0;
    expect(() => parseManifest(failedRetry)).toThrow("successful test attempt");
    const unsafe = structuredClone(manifest);
    first(unsafe.captures).image.path = "images/../../secret";
    expect(() => parseManifest(unsafe)).toThrow("traversal");
    const changedProfile = structuredClone(manifest);
    first(changedProfile.profiles).profile.browserVersion = "150.0";
    await expect(validateManifestProfiles(changedProfile)).rejects.toThrow("does not match");
    expect(() => parseManifest({ ...manifest, captures: [] })).toThrow("captures");
  });
  it("does not accept inherited or prototype-based fields", async () => {
    const { manifest } = await fixture();
    expect(() => parseManifest(Object.create(manifest))).toThrow("plain object");
    expect(() => parseManifest({ ...manifest, run: Object.create(manifest.run) })).toThrow(
      "plain object",
    );
    expect(() => parseManifest({ ...manifest, schemaVersion: undefined })).toThrow("schemaVersion");
  });
});

it("ignores the content clip, and no other field, in the environment digest", async () => {
  const { manifest } = await fixture();
  const { profile } = first(manifest.profiles);
  const environment = await digestEnvironmentProfile(profile);
  const clipped = structuredClone(profile);
  clipped.captureOptions.clip = { x: 0, y: 0, width: 80, height: 40 };
  expect(await digestEnvironmentProfile(clipped)).toBe(environment);
  expect(await digestJson(clipped)).not.toBe(await digestJson(profile));
  const otherBrowser = { ...profile, browserVersion: "new-browser" };
  expect(await digestEnvironmentProfile(otherBrowser)).not.toBe(environment);
});

it("hashes only the bytes of a view, and not the other bytes of its buffer", async () => {
  const bytes = new TextEncoder().encode("xabcx");
  // The digest of "abc", from FIPS 180-2.
  expect(await sha256(bytes.subarray(1, 4))).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

it("hashes objects canonically without changing declared array order", async () => {
  expect(canonicalJson({ b: 2, a: ["two", "one"] })).toBe('{"a":["two","one"],"b":2}');
  expect(await digestJson({ b: 2, a: 1 })).toBe(await digestJson({ a: 1, b: 2 }));
  expect(await digestJson([1, 2])).not.toBe(await digestJson([2, 1]));
  expect(() => canonicalJson({ no: undefined })).toThrow();
  expect(() => canonicalJson([Number.NaN])).toThrow();
  expect(() => canonicalJson(new Date())).toThrow();
});

it("separates rendering identity from comparison policy and engine evidence", async () => {
  const { digestRenderingProfile } = await import("../src/index.js");
  const profile: CaptureProfile = {
    browser: "chromium",
    browserVersion: "149",
    osImageDigest: "a".repeat(64),
    fontsDigest: "b".repeat(64),
    viewport: { width: 100, height: 100 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezone: "UTC",
    reducedMotion: "reduce",
    colorScheme: "light",
    contrast: "no-preference",
    forcedColors: "none",
    animationPolicy: "disabled",
    captureOptions: { clip: { x: 0, y: 0, width: 100, height: 100 } },
    comparisonPolicyDigest: "c".repeat(64),
    comparisonEngineVersion: "1",
  };
  const digest = await digestRenderingProfile(profile);
  expect(
    await digestRenderingProfile({
      ...profile,
      comparisonPolicyDigest: "d".repeat(64),
      comparisonEngineVersion: "2",
    }),
  ).toBe(digest);
  for (const changed of [
    { fontsDigest: "e".repeat(64) },
    { browserVersion: "150" },
    { locale: "pt-BR" },
    { deviceScaleFactor: 2 },
    { viewport: { width: 200, height: 100 } },
    { captureOptions: { clip: { x: 1, y: 0, width: 100, height: 100 } } },
  ]) {
    expect(await digestRenderingProfile({ ...profile, ...changed })).not.toBe(digest);
  }
});

it("accepts local results for matched, changed, and new captures", async () => {
  const { manifest } = await fixture();
  const matched = manifest.captures[0]!;
  const changed = structuredClone(matched);
  changed.itemKey = "changed-dialog";
  changed.ordinal = 1;
  const introduced = structuredClone(changed);
  introduced.itemKey = "new-dialog";
  introduced.ordinal = 2;
  manifest.captures.push(changed, introduced);
  const manifestDigest = await digestJson(manifest);
  manifest.localComparison = {
    mode: LOCAL_COMPARISON_MODE,
    engineVersion: LOCAL_COMPARISON_ENGINE,
    codecVersion: LOCAL_COMPARISON_CODEC,
    reference: {
      manifestDigest,
      snapshotId: "snapshot",
      baselineRevision: 1,
      inventoryDigest: "a".repeat(64),
      captureCount: 2,
    },
    captures: [
      {
        itemKey: matched.itemKey,
        variantKey: matched.variant.key,
        candidateDigest: matched.image.digest,
        referenceDigest: "b".repeat(64),
        outcome: "unchanged",
        changedPixels: 1,
        ratio: 1 / 6,
        sizeChanged: false,
      },
      {
        itemKey: changed.itemKey,
        variantKey: changed.variant.key,
        candidateDigest: changed.image.digest,
        referenceDigest: "c".repeat(64),
        outcome: "changed",
        changedPixels: 2,
        ratio: 2 / 6,
        sizeChanged: false,
        mask: { ...changed.image, digest: "f".repeat(64), path: "images/mask.png" },
      },
      {
        itemKey: introduced.itemKey,
        variantKey: introduced.variant.key,
        candidateDigest: introduced.image.digest,
        referenceDigest: null,
        outcome: "changed",
        changedPixels: 6,
        ratio: 1,
        sizeChanged: false,
      },
    ],
    removals: [],
  };
  expect(parseManifest(manifest).captures).toHaveLength(3);
});

it("rejects duplicate local identities, overlapping removals, and masks on omitted captures", async () => {
  const { manifest } = await fixture();
  const capture = manifest.captures[0]!;
  const result = {
    itemKey: capture.itemKey,
    variantKey: capture.variant.key,
    candidateDigest: capture.image.digest,
    referenceDigest: "b".repeat(64),
    outcome: "unchanged" as const,
    changedPixels: 0,
    ratio: 0,
    sizeChanged: false,
  };
  manifest.localComparison = {
    mode: LOCAL_COMPARISON_MODE,
    engineVersion: LOCAL_COMPARISON_ENGINE,
    codecVersion: LOCAL_COMPARISON_CODEC,
    reference: {
      manifestDigest: await digestJson(manifest),
      snapshotId: "snapshot",
      baselineRevision: 0,
      inventoryDigest: "a".repeat(64),
      captureCount: 1,
    },
    captures: [result],
    removals: [],
  };
  const duplicate = structuredClone(manifest);
  duplicate.localComparison!.captures.push(result);
  expect(() => parseManifest(duplicate)).toThrow("local result identity");
  const removed = structuredClone(manifest);
  removed.localComparison!.removals.push({
    itemKey: capture.itemKey,
    variantKey: capture.variant.key,
  });
  expect(() => parseManifest(removed)).toThrow("cannot also be removed");
  const masked = structuredClone(manifest);
  masked.localComparison!.captures[0]!.mask = capture.image;
  expect(() => parseManifest(masked)).toThrow("Only changed matched captures");
});

it("has one word for each of the eight review states", () => {
  expect(reviewStateWords).toEqual({
    "needs-review": "Needs review",
    rejected: "Rejected",
    passed: "Passed",
    incomplete: "Capturing",
    comparing: "Comparing",
    "needs-recompare": "Rerun needed",
    superseded: "Replaced",
    failed: "Failed",
  });
});

it("has words for each closed reason, and words with no cause for a run without one", () => {
  expect(Object.keys(runClosedReasonWords)).toEqual([...runClosedReasons]);
  expect(runClosedReasonWords).toEqual({
    replaced: "Replaced",
    "pull-request-closed": "Closed",
    "merge-group-destroyed": "Removed from queue",
    "baseline-retired": "Retired",
    expired: "Expired",
  });
  expect(Object.values(runClosedReasonWords)).not.toContain(runClosedWords);
});

it("validates the capture sources of a combined manifest", async () => {
  const { manifest } = await fixture();
  const source = {
    shardKey: "linux",
    workflowAttempt: 1,
    jobId: "12",
    jobName: "capture (linux)",
    manifestDigest: "a".repeat(64),
    artifactId: "34",
    artifactName: "visonaut-capture-456-1-linux",
  };
  expect(parseManifest({ ...manifest, captureSources: [source] }).captureSources).toEqual([source]);
  const refused = (overrides: object) => () =>
    parseManifest({ ...manifest, captureSources: [{ ...source, ...overrides }] });
  expect(refused({ jobId: "pending" })).toThrow("jobId must be a positive decimal ID");
  expect(refused({ artifactId: "0" })).toThrow("artifactId must be a positive decimal ID");
  expect(refused({ artifactId: "1".repeat(33) })).toThrow("artifactId must be a nonempty string");
  expect(refused({ workflowAttempt: 0 })).toThrow("source workflowAttempt");
  expect(refused({ jobName: "j".repeat(257) })).toThrow("jobName");
  expect(refused({ artifactName: "" })).toThrow("artifactName");
  expect(refused({ manifestDigest: "a" })).toThrow("manifestDigest");
  expect(refused({ shardKey: "../linux" })).toThrow("shardKey");
  expect(() => parseManifest({ ...manifest, captureSources: [source, source] })).toThrow(
    "Duplicate capture source shard",
  );
  const sources = Array.from({ length: 17 }, (_, index) => ({ ...source, shardKey: `s-${index}` }));
  expect(() => parseManifest({ ...manifest, captureSources: sources })).toThrow("captureSources");
});
