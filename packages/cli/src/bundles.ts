import { copyFile, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { digestJson, parseManifest, type Manifest } from "@visonaut/protocol";
import { CliError } from "./errors.js";
import { loadCapture, validateImages } from "./files.js";

interface BundleDirectory {
  shard: string;
  directory: string;
}

interface CombineBundlesParams {
  bundles: BundleDirectory[];
  directory: string;
  packageDigest: string;
  workflowAttempt: number;
}

/** Combine isolated capture artifacts without changing their screenshot identities. */
export async function combineBundles({
  bundles,
  directory,
  packageDigest,
  workflowAttempt,
}: CombineBundlesParams): Promise<Manifest> {
  if (!bundles.length || bundles.length > 16) {
    throw new CliError("Submit requires 1–16 capture bundles.", 2);
  }
  if (!Number.isSafeInteger(workflowAttempt) || workflowAttempt < 1) {
    throw new CliError("Submit needs the current GitHub workflow attempt.", 2);
  }
  const profiles = new Map<string, Manifest["profiles"][number]>();
  const tests: Manifest["tests"] = [];
  const captures: Manifest["captures"] = [];
  const images = new Map<string, { bytes: number; mediaType: string }>();
  const configurations: { shard: string; digest: string }[] = [];
  let first: Manifest | undefined;
  let sourceAttempt = 0;
  await mkdir(join(directory, "images"), { recursive: true, mode: 0o700 });
  for (const bundle of bundles) {
    const local = await loadCapture(bundle.directory);
    await validateImages(local);
    const { manifest } = local;
    if (manifest.run.workflowAttempt > workflowAttempt) {
      throw new CliError("A capture bundle comes from a later workflow attempt.", 4);
    }
    if (
      manifest.shard.key !== bundle.shard ||
      manifest.run.planDigest !== packageDigest ||
      manifest.discovery?.executorDigest !== packageDigest
    ) {
      throw new CliError("A capture bundle has the wrong shard or package identity.", 4);
    }
    if (first) {
      if (
        manifest.run.repository !== first.run.repository ||
        manifest.run.repositoryId !== first.run.repositoryId ||
        manifest.run.workflowRunId !== first.run.workflowRunId ||
        manifest.run.testedSha !== first.run.testedSha ||
        JSON.stringify(manifest.producer) !== JSON.stringify(first.producer)
      ) {
        throw new CliError("Capture bundles belong to different workflow runs.", 4);
      }
    } else {
      first = manifest;
    }
    sourceAttempt = Math.max(sourceAttempt, manifest.run.workflowAttempt);
    configurations.push({ shard: bundle.shard, digest: manifest.discovery.configurationDigest });
    for (const profile of manifest.profiles) {
      profiles.set(profile.digest, profile);
    }
    for (const test of manifest.tests) {
      tests.push({ ...test, id: `${bundle.shard}/${test.id}` });
    }
    for (const capture of manifest.captures) {
      const image = capture.image;
      const previous = images.get(image.digest);
      if (previous && (previous.bytes !== image.bytes || previous.mediaType !== image.mediaType)) {
        throw new CliError("Capture bundles disagree about a shared image.", 4);
      }
      const extension = image.mediaType === "image/webp" ? "webp" : "png";
      const imagePath = `images/${image.digest}.${extension}`;
      captures.push({
        ...capture,
        ordinal: captures.length,
        testId: `${bundle.shard}/${capture.testId}`,
        image: { ...capture.image, path: imagePath },
      });
      if (previous) continue;
      images.set(image.digest, { bytes: image.bytes, mediaType: image.mediaType });
      await copyFile(join(local.directory, image.path), join(directory, imagePath));
    }
  }
  if (!first) throw new CliError("Submit requires capture bundles.", 2);
  const manifest = parseManifest({
    schemaVersion: first.schemaVersion,
    producer: first.producer,
    run: { ...first.run, workflowAttempt: sourceAttempt },
    shard: { key: "combined", jobId: "pending", sourceAttempt },
    profiles: [...profiles.values()],
    tests,
    captures,
    discovery: {
      executorDigest: packageDigest,
      configurationDigest: await digestJson(configurations),
      inventoryDigest: await digestJson(
        tests.map(({ id, file, titlePath }) => ({ id, file, titlePath })),
      ),
    },
  });
  await writeFile(join(directory, "manifest.json"), `${JSON.stringify(manifest)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await validateImages({ directory: await realpath(directory), manifest });
  return manifest;
}
