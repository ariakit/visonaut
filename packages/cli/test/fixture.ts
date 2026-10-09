import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXED_DIGEST, digestJson } from "@visonaut/protocol";
import type { Capture, CaptureProfile, Manifest } from "@visonaut/protocol";
import { PNG } from "pngjs";

// Submit decodes each candidate, so the bytes must be a PNG that passes image validation.
const png = new PNG({ width: 1, height: 1 });
png.data.set([255, 255, 255, 255]);
export const imageBytes = PNG.sync.write(png);

export async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "visonaut-cli-test-"));
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
  };
  const profileDigest = await digestJson(profile);
  const capture: Capture = {
    itemKey: "dialog/open",
    name: "Open dialog",
    variant: { key: "react-light", browser: "chromium", framework: "react", colorScheme: "light" },
    ordinal: 0,
    testId: "test-1",
    testRetry: 1,
    profileDigest,
    image: {
      digest: createHash("sha256").update(imageBytes).digest("hex"),
      mediaType: "image/png",
      width: 1,
      height: 1,
      bytes: imageBytes.length,
      path: "capture.png",
    },
    // Local comparison needs the settings that the adapter records.
    comparison: { threshold: 0.2 },
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
      planDigest: FIXED_DIGEST,
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
    captures: [capture],
    // The adapter sends the fixed digest in both fields of a bundle.
    discovery: {
      executorDigest: FIXED_DIGEST,
      configurationDigest: "f".repeat(64),
      inventoryDigest: "a".repeat(64),
    },
  };
  const manifestPath = join(directory, "manifest.json");
  await writeFile(join(directory, "capture.png"), imageBytes);
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { directory, manifest, manifestPath, capture };
}

/**
 * The capture bundles of two shards, as the adapter writes them, and an empty
 * directory for the combined bundle. Each directory goes into `directories`.
 */
export async function bundlePair(directories: string[]) {
  const linux = await fixture();
  const safari = await fixture();
  const output = await mkdtemp(join(tmpdir(), "visonaut-combined-test-"));
  directories.push(linux.directory, safari.directory, output);
  linux.manifest.shard.key = "linux";
  safari.manifest.shard.key = "safari";
  safari.manifest.profiles[0]!.profile.browser = "webkit";
  safari.manifest.profiles[0]!.digest = await digestJson(safari.manifest.profiles[0]!.profile);
  safari.manifest.captures[0]!.profileDigest = safari.manifest.profiles[0]!.digest;
  safari.manifest.captures[0]!.variant = {
    ...safari.manifest.captures[0]!.variant,
    key: "react-safari",
    browser: "webkit",
  };
  for (const source of [linux, safari]) {
    source.manifest.discovery = {
      executorDigest: FIXED_DIGEST,
      configurationDigest: await digestJson(source.manifest.shard.key),
      inventoryDigest: await digestJson(source.manifest.tests),
    };
    await writeFile(source.manifestPath, JSON.stringify(source.manifest));
  }
  return { linux, safari, output };
}
