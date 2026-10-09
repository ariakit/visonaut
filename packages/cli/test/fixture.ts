import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestJson } from "@visonaut/protocol";
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
    comparisonPolicyDigest: "c".repeat(64),
    comparisonEngineVersion: "1",
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
      planDigest: "e".repeat(64),
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
    // The signed Submit job adds the digests of the trusted candidate discovery.
    discovery: {
      executorDigest: "e".repeat(64),
      configurationDigest: "f".repeat(64),
      inventoryDigest: "a".repeat(64),
    },
  };
  const manifestPath = join(directory, "manifest.json");
  await writeFile(join(directory, "capture.png"), imageBytes);
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { directory, manifest, manifestPath, capture };
}
