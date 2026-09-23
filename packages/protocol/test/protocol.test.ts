import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  digestJson,
  digestEnvironmentProfile,
  identityKey,
  parseManifest,
  parseTrustedPlan,
  validateManifestProfiles,
  validateShardAgainstPlan,
} from "../src/index.js";
import type { CaptureProfile, Manifest, TrustedPlan } from "../src/index.js";

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
  it("accepts exact event-specific caller paths and rejects incomplete mappings", async () => {
    const { plan } = await fixture();
    const workflow = {
      push: ".github/workflows/app.yml",
      pull_request: ".github/workflows/ci.yml",
      merge_group: ".github/workflows/app.yml",
    };
    expect(parseTrustedPlan({ ...plan, workflow })).toMatchObject({ workflow });
    expect(() => parseTrustedPlan({ ...plan, workflow: { push: workflow.push } })).toThrow();
    expect(() => parseTrustedPlan({ ...plan, workflow: { ...workflow, unknown: "x" } })).toThrow();
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

describe("trusted plan accounting", () => {
  it("accepts the exact trusted test/capture plan", async () => {
    const { manifest, plan } = await fixture();
    expect(parseTrustedPlan(plan)).toEqual(plan);
    await expect(validateShardAgainstPlan(manifest, plan)).resolves.toBeUndefined();
  });
  it("refuses subsets even if the client claims full coverage", async () => {
    const { manifest, plan } = await fixture();
    first(plan.shards).tests.push({
      id: "test-2",
      captures: [{ itemKey: "dialog/closed", variantKey: "react-light" }],
    });
    manifest.run.planDigest = await digestJson(plan);
    await expect(
      validateShardAgainstPlan(Object.assign(manifest, { coverage: "full" }), plan),
    ).rejects.toThrow("all planned tests");
  });
  it("allows changed content clipping but refuses an untrusted browser environment", async () => {
    const { manifest, plan } = await fixture();
    const profileRecord = first(manifest.profiles);
    const originalEnvironment = await digestEnvironmentProfile(profileRecord.profile);
    profileRecord.profile.captureOptions.clip = { x: 0, y: 0, width: 80, height: 40 };
    profileRecord.digest = await digestJson(profileRecord.profile);
    first(manifest.captures).profileDigest = profileRecord.digest;
    expect(await digestEnvironmentProfile(profileRecord.profile)).toBe(originalEnvironment);
    await expect(validateShardAgainstPlan(manifest, plan)).resolves.toBeUndefined();
    profileRecord.profile.browserVersion = "new-browser";
    profileRecord.digest = await digestJson(profileRecord.profile);
    first(manifest.captures).profileDigest = profileRecord.digest;
    await expect(validateShardAgainstPlan(manifest, plan)).rejects.toThrow(
      "environment profile is not allowed",
    );
  });

  it("refuses a new profile or key supplied by the client", async () => {
    const { manifest, plan } = await fixture();
    first(manifest.captures).variant.key = "other";
    await expect(validateShardAgainstPlan(manifest, plan)).rejects.toThrow("identity or order");
    first(manifest.captures).variant.key = "react-light";
    first(plan.shards).environmentProfileDigests = ["0".repeat(64)];
    manifest.run.planDigest = await digestJson(plan);
    await expect(validateShardAgainstPlan(manifest, plan)).rejects.toThrow("not allowed");
  });
});

it("hashes objects canonically without changing declared array order", async () => {
  expect(canonicalJson({ b: 2, a: ["two", "one"] })).toBe('{"a":["two","one"],"b":2}');
  expect(await digestJson({ b: 2, a: 1 })).toBe(await digestJson({ a: 1, b: 2 }));
  expect(await digestJson([1, 2])).not.toBe(await digestJson([2, 1]));
  expect(() => canonicalJson({ no: undefined })).toThrow();
  expect(() => canonicalJson([Number.NaN])).toThrow();
  expect(() => canonicalJson(new Date())).toThrow();
});

describe("trusted candidate discovery", () => {
  async function discoveredFixture() {
    const { manifest, plan } = await fixture();
    plan.discovery = { executorDigest: "f".repeat(64) };
    const shard = first(plan.shards);
    delete shard.tests;
    shard.collection = {
      projectName: "chrome",
      testDir: "app/src",
      testMatch: ["**/*.test.ts"],
      testIgnore: [],
      grep: [{ source: "@visual", flags: "" }],
      grepInvert: [],
      shard: null,
      repeatEach: 1,
    };
    manifest.run.planDigest = await digestJson(plan);
    manifest.discovery = {
      executorDigest: plan.discovery.executorDigest,
      configurationDigest: await digestJson(shard.collection),
      inventoryDigest: await digestJson(
        manifest.tests.map(({ id, file, titlePath }) => ({ id, file, titlePath })),
      ),
    };
    const evidence = {
      manifestDigest: await digestJson(manifest),
      workflowRunId: manifest.run.workflowRunId,
      workflowAttempt: manifest.run.workflowAttempt,
      testedSha: manifest.run.testedSha,
      jobId: manifest.shard.jobId,
      executorDigest: plan.discovery.executorDigest,
      conclusion: "success" as const,
    };
    return { manifest, plan, evidence };
  }

  it("accepts new and renamed capture identities without a trusted-plan rollout", async () => {
    const { manifest, plan, evidence } = await discoveredFixture();
    const originalPlanDigest = manifest.run.planDigest;
    const capture = first(manifest.captures);
    capture.itemKey = "new-dialog/introduced";
    capture.variant.key = "new-solid-light";
    evidence.manifestDigest = await digestJson(manifest);
    await expect(validateShardAgainstPlan(manifest, plan, evidence)).resolves.toBeUndefined();
    expect(manifest.run.planDigest).toBe(originalPlanDigest);
  });

  it("requires separate successful-job proof and refuses proof from another attempt", async () => {
    const { manifest, plan, evidence } = await discoveredFixture();
    await expect(validateShardAgainstPlan(manifest, plan)).rejects.toThrow(
      "server-verified successful",
    );
    await expect(
      validateShardAgainstPlan(manifest, plan, { ...evidence, workflowAttempt: 2 }),
    ).rejects.toThrow("server-verified successful");
    await expect(
      validateShardAgainstPlan(manifest, plan, { ...evidence, manifestDigest: "0".repeat(64) }),
    ).rejects.toThrow("server-verified successful");
    await expect(
      validateShardAgainstPlan(manifest, plan, { ...evidence, jobId: "other" }),
    ).rejects.toThrow("server-verified successful");
  });

  it("refuses a partial inventory and a changed collection configuration", async () => {
    const { manifest, plan, evidence } = await discoveredFixture();
    manifest.tests.push({ ...first(manifest.tests), id: "missing-from-frozen-inventory" });
    await expect(validateShardAgainstPlan(manifest, plan, evidence)).rejects.toThrow(
      "successful test inventory",
    );
    manifest.tests.pop();
    if (!manifest.discovery) {
      throw new Error("Fixture discovery is missing");
    }
    const incompletePlan = structuredClone(plan);
    const collection = first(incompletePlan.shards).collection;
    if (!collection) {
      throw new Error("Fixture collection is missing");
    }
    collection.shard = { current: 1, total: 2 };
    expect(() => parseTrustedPlan(incompletePlan)).toThrow("every configured shard");
    manifest.discovery.configurationDigest = "0".repeat(64);
    await expect(validateShardAgainstPlan(manifest, plan, evidence)).rejects.toThrow(
      "collection configuration",
    );
  });
});

it("binds discovered captures to the manifest digest published by the trusted job", async () => {
  const { manifest, plan } = await fixture();
  plan.discovery = { executorDigest: "f".repeat(64) };
  const shard = first(plan.shards);
  delete shard.tests;
  shard.collection = {
    projectName: "chrome",
    testDir: "app/src",
    testMatch: ["**/*.test.ts"],
    testIgnore: [],
    grep: [{ source: ".*", flags: "" }],
    grepInvert: [],
    shard: null,
    repeatEach: 1,
  };
  manifest.run.planDigest = await digestJson(plan);
  manifest.discovery = {
    executorDigest: plan.discovery.executorDigest,
    configurationDigest: await digestJson(shard.collection),
    inventoryDigest: await digestJson(
      manifest.tests.map(({ id, file, titlePath }) => ({ id, file, titlePath })),
    ),
  };
  manifest.captures.push({
    ...first(manifest.captures),
    variant: { key: "second", browser: "chromium" },
    ordinal: 1,
  });
  const evidence = {
    manifestDigest: await digestJson(manifest),
    workflowRunId: manifest.run.workflowRunId,
    workflowAttempt: manifest.run.workflowAttempt,
    testedSha: manifest.run.testedSha,
    jobId: manifest.shard.jobId,
    executorDigest: plan.discovery.executorDigest,
    conclusion: "success" as const,
  };
  await expect(validateShardAgainstPlan(manifest, plan, evidence)).resolves.toBeUndefined();
  manifest.captures.pop();
  await expect(validateShardAgainstPlan(manifest, plan, evidence)).rejects.toThrow(
    "server-verified successful",
  );
});
