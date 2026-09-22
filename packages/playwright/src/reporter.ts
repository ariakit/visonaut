import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import {
  createDiscoveryReceipt,
  parseManifest,
  sha256,
  validateManifestProfiles,
  validateShardDeclaration,
} from "@ariviso/protocol";
import type { CandidateDiscovery, Manifest, RunProvenance, TrustedPlan } from "@ariviso/protocol";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestError,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { CAPTURE_CONTENT_TYPE, CAPTURE_STARTED_CONTENT_TYPE } from "./visual.js";
import { discoverInventory, inventoryEntry } from "./discovery.js";

export interface ReporterOptions {
  outputFile?: string;
  run: RunProvenance;
  shard: Manifest["shard"];
  /** Optional local early check; the service independently loads its trusted plan. */
  plan?: TrustedPlan;
  /** Required in discovery mode; fixed by the trusted executor. */
  repositoryRoot?: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid capture attachment ${label}`);
  }
  return { ...value };
}

async function attachmentBytes(attachment: TestResult["attachments"][number]): Promise<Buffer> {
  if (attachment.body) {
    return attachment.body;
  }
  if (attachment.path) {
    return readFile(attachment.path);
  }
  throw new Error("Capture attachment has no data");
}

function selectResult(test: TestCase): TestResult {
  const result = test.results.at(-1);
  // An earlier passing result must never conceal a later failed attempt.
  if (
    !result ||
    result.status !== "passed" ||
    test.expectedStatus !== "passed" ||
    result.errors.length
  ) {
    throw new Error(`Test ${test.id} has no final successful attempt`);
  }
  return result;
}

async function playwrightVersion(): Promise<string> {
  const require = createRequire(import.meta.url);
  const packageFile = require.resolve("@playwright/test/package.json");
  const value: unknown = JSON.parse(await readFile(packageFile, "utf8"));
  const packageInfo = record(value, "Playwright package");
  if (typeof packageInfo.version !== "string") {
    throw new Error("Cannot determine Playwright version");
  }
  return packageInfo.version;
}

/** Writes only final successful attempts. A failed run produces no manifest. */
export default class ArivisoReporter implements Reporter {
  private collectedTests: { test: TestCase; identity: ReturnType<typeof inventoryEntry> }[] = [];
  private discovery?: CandidateDiscovery;
  private outputFile = "";
  private receiptFile = "";
  private errors: TestError[] = [];

  constructor(private readonly options: ReporterOptions) {}

  async onBegin(config: FullConfig, suite: Suite): Promise<void> {
    this.collectedTests = suite.allTests().map((test) => ({
      test,
      identity: inventoryEntry(
        test,
        this.options.plan?.discovery ? this.options.repositoryRoot : undefined,
      ),
    }));
    this.outputFile = path.resolve(
      config.rootDir,
      this.options.outputFile ?? "ariviso/manifest.json",
    );
    // Failed reruns must not leave an older manifest that a later job can upload.
    this.receiptFile = path.join(path.dirname(this.outputFile), "receipt.json");
    await rm(this.outputFile, { force: true });
    await rm(this.receiptFile, { force: true });
    if (this.options.plan?.discovery) {
      if (!this.options.repositoryRoot || !path.isAbsolute(this.options.repositoryRoot)) {
        throw new Error("Trusted discovery requires an absolute repositoryRoot");
      }
      this.discovery = await discoverInventory({
        config,
        suite,
        plan: this.options.plan,
        shardKey: this.options.shard.key,
        repositoryRoot: this.options.repositoryRoot,
      });
    }
  }

  onError(error: TestError): void {
    this.errors.push(error);
  }

  async onEnd(result: FullResult): Promise<{ status: "failed" } | undefined> {
    try {
      if (result.status !== "passed" || this.errors.length) {
        throw new Error("Ariviso refuses a failed or incomplete Playwright run");
      }
      if (!this.collectedTests.length || !this.outputFile) {
        throw new Error("Ariviso reporter did not receive a test suite");
      }
      const tests: Manifest["tests"] = [];
      const captures: unknown[] = [];
      const profiles = new Map<string, unknown>();
      const images = new Set<string>();
      const directory = path.dirname(this.outputFile);
      await mkdir(path.join(directory, "images"), { recursive: true });
      for (const { test, identity } of this.collectedTests) {
        const finalResult = selectResult(test);
        tests.push({
          ...identity,
          retry: finalResult.retry,
          status: "passed",
        });
        const metadata = finalResult.attachments.filter(
          (attachment) => attachment.contentType === CAPTURE_CONTENT_TYPE,
        );
        const starts = finalResult.attachments.filter(
          (attachment) => attachment.contentType === CAPTURE_STARTED_CONTENT_TYPE,
        );
        const startedTokens = new Set<string>();
        for (const start of starts) {
          const marker = record(
            JSON.parse((await attachmentBytes(start)).toString("utf8")),
            "capture start",
          );
          if (typeof marker.attemptToken !== "string" || startedTokens.has(marker.attemptToken)) {
            throw new Error("Capture start marker is invalid or duplicated");
          }
          startedTokens.add(marker.attemptToken);
        }
        if (metadata.length !== startedTokens.size) {
          throw new Error("A required capture started but did not complete successfully");
        }
        let expectedOrdinal = 0;
        for (const attachment of metadata) {
          const payload = record(
            JSON.parse((await attachmentBytes(attachment)).toString("utf8")),
            "metadata",
          );
          if (
            typeof payload.attemptToken !== "string" ||
            !startedTokens.delete(payload.attemptToken)
          ) {
            throw new Error("Capture completion does not match its start marker");
          }
          if (payload.ordinal !== expectedOrdinal++) {
            throw new Error("Capture attachments have missing or duplicate ordinals");
          }
          if (typeof payload.imageAttachment !== "string") {
            throw new Error("Capture attachment does not identify image bytes");
          }
          const matches = finalResult.attachments.filter(
            (entry) => entry.name === payload.imageAttachment && entry.contentType === "image/png",
          );
          const imageAttachment = matches[0];
          if (matches.length !== 1 || !imageAttachment) {
            throw new Error("Capture image attachment is missing or ambiguous");
          }
          const bytes = await attachmentBytes(imageAttachment);
          const image = record(payload.image, "image");
          const imageDigest = await sha256(bytes);
          if (image.digest !== imageDigest || image.bytes !== bytes.byteLength) {
            throw new Error("Capture image bytes do not match the attachment");
          }
          const capture = record(payload.capture, "capture");
          if (capture.testId !== test.id || capture.testRetry !== finalResult.retry) {
            throw new Error("Capture belongs to another test attempt");
          }
          const profile = record(payload.profile, "profile");
          if (typeof profile.digest !== "string") {
            throw new Error("Capture has no profile digest");
          }
          const previous = profiles.get(profile.digest);
          if (previous && JSON.stringify(previous) !== JSON.stringify(profile)) {
            throw new Error("Conflicting capture profile records");
          }
          profiles.set(profile.digest, profile);
          // Keep one image in memory at a time for large capture shards.
          if (!images.has(imageDigest)) {
            await writeFile(path.join(directory, "images", `${imageDigest}.png`), bytes);
            images.add(imageDigest);
          }
          captures.push({
            ...capture,
            ordinal: captures.length,
            image: { ...image, path: `images/${imageDigest}.png` },
          });
        }
      }
      const manifest = parseManifest({
        schemaVersion: "1.0",
        producer: {
          name: "@ariviso/playwright",
          version: "0.1.0",
          nodeVersion: process.versions.node,
          playwrightVersion: await playwrightVersion(),
        },
        run: this.options.run,
        shard: this.options.shard,
        profiles: [...profiles.values()],
        tests,
        captures,
        ...(this.discovery ? { discovery: this.discovery } : {}),
      });
      await validateManifestProfiles(manifest);
      if (this.options.plan) {
        await validateShardDeclaration(manifest, this.options.plan);
      }
      const temporary = `${this.outputFile}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
      await rename(temporary, this.outputFile);
      if (manifest.discovery) {
        const receipt = await createDiscoveryReceipt(manifest);
        const temporaryReceipt = `${this.receiptFile}.${process.pid}.tmp`;
        await writeFile(temporaryReceipt, `${JSON.stringify(receipt, null, 2)}\n`);
        await rename(temporaryReceipt, this.receiptFile);
      }
      return undefined;
    } catch (error) {
      await rm(this.outputFile, { force: true });
      if (this.receiptFile) {
        await rm(this.receiptFile, { force: true });
      }
      process.stderr.write(`Ariviso: ${error instanceof Error ? error.message : String(error)}\n`);
      return { status: "failed" };
    }
  }
}

export type { RunProvenance, TrustedCollection, TrustedPlan } from "@ariviso/protocol";
