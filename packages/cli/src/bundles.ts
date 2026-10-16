import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FIXED_DIGEST,
  digestJson,
  validateCaptureComparison,
  type CaptureSource,
  type Manifest,
} from "@visonaut/protocol";
import { captureLabel, CliError, nameFile, record } from "./errors.js";
import { loadCapture, readImage } from "./files.js";
import { ImagePool } from "./image-pool.js";
import type { ImageInput } from "./png-comparison.js";
import { imagePath, writeCaptureRecords } from "./submission.js";
import type { CaptureRecord, Submission } from "./submission.js";

interface BundleDirectory {
  shard: string;
  directory: string;
  source?: CaptureSource;
}

/** A failure is a value, so a running check never rejects. */
type ImageCheck = Promise<{ failure: unknown } | undefined>;

/**
 * Image checks on the image workers, at most one for each worker. The checks
 * end in the order of the captures, so the first bad image fails first.
 */
class ImageChecks {
  #pool: ImagePool;
  #running: ImageCheck[] = [];
  /** The failure of a check that `add` or `drain` threw. */
  #thrown: unknown;

  constructor(pool: ImagePool) {
    this.#pool = pool;
  }

  /** Check the image, then store it. This waits while each worker has a check. */
  async add(image: ImageInput, store: () => Promise<void>) {
    if (this.#running.length >= this.#pool.size) {
      await this.#settle();
    }
    this.#running.push(
      this.#pool
        .check(image)
        .then(store)
        .then(
          () => undefined,
          (failure: unknown) => ({ failure }),
        ),
    );
  }

  /** Wait for each check, and throw the first failure. */
  async drain() {
    while (this.#running.length) {
      await this.#settle();
    }
  }

  /**
   * The failure to report in place of `error`. The running checks belong to
   * captures before the one that threw `error`, so their first failure comes
   * first. A failure of a check is already the first, because the checks after
   * it belong to later captures.
   */
  async failure(error: unknown) {
    const checks = await Promise.all(this.#running.splice(0));
    if (error === this.#thrown) return error;
    return checks.find((check) => check !== undefined)?.failure ?? error;
  }

  async [Symbol.asyncDispose]() {
    await Promise.all(this.#running.splice(0));
  }

  async #settle() {
    const check = await this.#running.shift();
    if (!check) return;
    this.#thrown = check.failure;
    throw check.failure;
  }
}

interface CombineBundlesParams {
  bundles: BundleDirectory[];
  directory: string;
  workflowAttempt: number;
}

/**
 * Prepare the capture artifacts for one Submit without changing their
 * screenshot identities. Each capture job gets one file of sorted records, and
 * each image is stored one time below its digest. Only one manifest of a
 * capture job is in memory at a time. The image workers check up to one image
 * each while the next files are read.
 */
export async function combineBundles(
  params: CombineBundlesParams,
): Promise<Omit<Submission, "job">> {
  await using pool = new ImagePool();
  await using checks = new ImageChecks(pool);
  try {
    return await combine(params, checks);
  } catch (error) {
    throw await checks.failure(error);
  }
}

async function combine(
  { bundles, directory, workflowAttempt }: CombineBundlesParams,
  checks: ImageChecks,
): Promise<Omit<Submission, "job">> {
  if (!bundles.length) {
    throw new CliError("Submit requires capture bundles.", 2);
  }
  if (!Number.isSafeInteger(workflowAttempt) || workflowAttempt < 1) {
    throw new CliError("Submit needs the current GitHub workflow attempt.", 2);
  }
  let first: Manifest | undefined;
  let sourceAttempt = 0;
  const sources: CaptureSource[] = [];
  const files: string[] = [];
  await mkdir(join(directory, "images"), { recursive: true, mode: 0o700 });
  await mkdir(join(directory, "records"), { recursive: true, mode: 0o700 });
  for (const bundle of bundles) {
    const local = await loadCapture(bundle.directory);
    const { manifest } = local;
    if (manifest.localComparison) {
      throw new CliError("Capture artifacts cannot supply a local comparison result.");
    }
    if (manifest.run.workflowAttempt > workflowAttempt) {
      throw new CliError("A capture bundle comes from a later workflow attempt.", 4);
    }
    if (manifest.shard.key !== bundle.shard) {
      throw new CliError("A capture bundle has the wrong shard.", 4);
    }
    if (!manifest.discovery) {
      throw new CliError(
        "A capture bundle has no discovery record. Set the discovery option of the reporter.",
        4,
      );
    }
    // An adapter of an older release sends a digest of its own.
    if (
      manifest.run.planDigest !== FIXED_DIGEST ||
      manifest.discovery.executorDigest !== FIXED_DIGEST
    ) {
      throw new CliError(
        "A capture bundle does not have the digest that this CLI expects. Use the same release of visonaut and @visonaut/playwright.",
        4,
      );
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
    if (bundle.source) {
      if (bundle.source.manifestDigest !== (await digestJson(manifest))) {
        throw new CliError("A source manifest changed after artifact verification.", 4);
      }
      sources.push(bundle.source);
    }
    const profiles = new Map(manifest.profiles.map((entry) => [entry.digest, entry.profile]));
    const tests = new Map(manifest.tests.map((test) => [test.id, test]));
    const records: CaptureRecord[] = [];
    for (const capture of manifest.captures) {
      const label = captureLabel(capture.itemKey, capture.variant.key);
      const profile = profiles.get(capture.profileDigest);
      const test = tests.get(capture.testId);
      if (!profile || !test) {
        throw new CliError("A capture bundle has a capture with no profile or no test.");
      }
      if (
        Object.hasOwn(profile, "comparisonPolicyDigest") ||
        Object.hasOwn(profile, "comparisonEngineVersion")
      ) {
        throw new CliError(
          "A capture profile holds comparison settings of an older adapter. Capture again with the current adapter.",
        );
      }
      if (!capture.comparison) {
        throw new CliError(
          "Local Submit requires recorded consumer screenshot settings. Capture again with the current adapter.",
        );
      }
      validateCaptureComparison(capture.comparison);
      const { digest, bytes, width, height } = capture.image;
      // One read checks the file, and one decode checks the PNG and the Submit bounds.
      const content = await readImage(local.directory, capture);
      await checks.add({ bytes: content, metadata: capture.image, label }, async () => {
        try {
          // Equal bytes have an equal digest, so a file that exists is this image.
          await writeFile(join(directory, imagePath(digest)), content, { flag: "wx", mode: 0o600 });
        } catch (error) {
          if (!record(error) || error.code !== "EEXIST") {
            throw nameFile(label, new CliError("A capture image cannot be stored for Submit."));
          }
        }
      });
      records.push({
        itemKey: capture.itemKey,
        name: capture.name === undefined || capture.name === capture.itemKey ? null : capture.name,
        variant: capture.variant,
        test: {
          id: `${bundle.shard}/${test.id}`,
          file: test.file,
          titlePath: test.titlePath,
          retry: test.retry,
        },
        profile,
        profileDigest: capture.profileDigest,
        comparison: capture.comparison,
        image: { digest, bytes, width, height },
      });
    }
    await checks.drain();
    const file = `records/${files.length}.ndjson`;
    await writeCaptureRecords(join(directory, file), records);
    files.push(file);
  }
  if (!first) {
    throw new CliError("Submit requires capture bundles.", 2);
  }
  return {
    producer: first.producer,
    run: { ...first.run, workflowAttempt: sourceAttempt },
    sources,
    files,
  };
}
