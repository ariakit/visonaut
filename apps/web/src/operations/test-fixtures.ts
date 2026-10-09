import { seedLegacyComparison } from "../../../../tooling/legacy-comparison-fixture.ts";
import {
  digestEnvironmentProfile,
  digestJson,
  digestRenderingProfile,
  LOCAL_COMPARISON_CODEC,
  LOCAL_COMPARISON_ENGINE,
  type CaptureProfile,
  type LocalComparisonReceipt,
} from "@visonaut/protocol";
import { readTestMigrations } from "../../../../tooling/test-migrations.ts";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  Service,
  type Database,
  type Result,
  type SqlValue,
  type Statement,
  type ValidatedImage,
} from "@visonaut/service";
import {
  writeCaptureInventory,
  type CaptureInventory,
  type InventoryCapture,
} from "../capture-inventory.ts";
import { readSnapshotInventory } from "../inventory-records.ts";
import { captureProfileReference, storeCaptureProfiles } from "../profiles.ts";
import type { ObjectStore, OperationsContext } from "./types.ts";
class SqliteStatement implements Statement {
  constructor(
    readonly connection: DatabaseSync,
    readonly sql: string,
    readonly values: SqlValue[] = [],
  ) {}
  bind(...values: SqlValue[]) {
    return new SqliteStatement(this.connection, this.sql, values);
  }
  execute<T>(): Result<T> {
    const values = this.values.map((value) =>
      value instanceof ArrayBuffer ? new Uint8Array(value) : value,
    );
    // SQL result columns define the generic shape, as in the D1 API.
    return { results: this.connection.prepare(this.sql).all(...values) as T[] };
  }
  async first<T>() {
    return this.execute<T>().results?.[0] ?? null;
  }
  async all<T>() {
    return this.execute<T>();
  }
  async run() {
    return this.execute<Record<string, unknown>>();
  }
}

export class TestDatabase implements Database {
  readonly connection: DatabaseSync;
  beforeBatch: (() => void) | null = null;
  preparedQueries = 0;
  constructor(connection?: DatabaseSync) {
    this.connection = connection ?? new DatabaseSync(":memory:");
    if (connection) return;
    for (const migration of readTestMigrations()) {
      this.connection.exec(migration.sql);
    }
  }
  prepare(sql: string) {
    this.preparedQueries += 1;
    return new SqliteStatement(this.connection, sql);
  }
  async batch(statements: Statement[]) {
    const before = this.beforeBatch;
    this.beforeBatch = null;
    before?.();
    this.connection.exec("BEGIN");
    try {
      const result = statements.map((entry) => {
        if (!(entry instanceof SqliteStatement)) throw new Error("Unexpected statement");
        return entry.execute<Record<string, unknown>>();
      });
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }
  [Symbol.dispose]() {
    this.connection.close();
  }
}

export class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  failPut: string | null = null;
  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      key,
      size: object.bytes.length,
      httpMetadata: { contentType: object.contentType },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(object.bytes.slice());
          controller.close();
        },
      }),
    };
  }
  async put(
    key: string,
    value: ReadableStream<Uint8Array> | Uint8Array | string,
    options?: Parameters<ObjectStore["put"]>[2],
  ) {
    if (this.failPut && key.includes(this.failPut)) throw new Error("Injected storage outage.");
    if (options?.onlyIf && this.objects.has(key)) return null;
    const bytes = new Uint8Array(
      await new Response(value instanceof Uint8Array ? value.slice() : value).arrayBuffer(),
    );
    this.objects.set(key, {
      bytes,
      contentType: options?.httpMetadata?.contentType ?? "application/octet-stream",
    });
    return {};
  }
  async list(options: Parameters<ObjectStore["list"]>[0]) {
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(options.prefix ?? "") && key > (options.cursor ?? ""))
      .sort();
    const page = keys.slice(0, options.limit ?? 1000);
    return {
      objects: page.map((key) => ({ key, size: this.objects.get(key)?.bytes.length ?? 0 })),
      truncated: keys.length > page.length,
      cursor: page.at(-1),
    };
  }
  async delete(keys: string | string[]) {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      this.objects.delete(key);
    }
  }
  async createMultipartUpload(key: string, options?: { httpMetadata?: { contentType: string } }) {
    const parts = new Map<number, Uint8Array>();
    return {
      uploadPart: async (partNumber: number, bytes: Uint8Array) => {
        if (this.failPut && key.includes(this.failPut)) throw new Error("Injected storage outage.");
        parts.set(partNumber, bytes.slice());
        return { partNumber, etag: String(partNumber) };
      },
      complete: async (uploaded: { partNumber: number; etag: string }[]) => {
        const values = uploaded.map((part) => parts.get(part.partNumber));
        if (values.some((value) => !value)) throw new Error("Missing uploaded part.");
        const bytes = new Uint8Array(
          values.reduce((sum, value) => sum + (value?.byteLength ?? 0), 0),
        );
        let offset = 0;
        for (const value of values) {
          if (!value) throw new Error("Missing uploaded part.");
          bytes.set(value, offset);
          offset += value.byteLength;
        }
        await this.put(key, bytes, options);
      },
      abort: async () => {
        parts.clear();
      },
    };
  }
}
export function digest(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
export function context(database: TestDatabase) {
  const images = new MemoryStore();
  const quarantine = new MemoryStore();
  const state = {
    time: Date.UTC(2026, 8, 22),
    posts: 0,
    patches: 0,
    losePost: false,
    losePatch: false,
    checks: new Map<string, Record<string, unknown>>(),
  };
  const value: OperationsContext = {
    database,
    images,
    quarantine,
    origin: "https://visonaut.example",
    budget: {
      tasksPerStep: 10,
      objectsPerStep: 2,
      leaseMilliseconds: 60_000,
      maxAttempts: 2,
      maximumObjectBytes: 1024 * 1024,
    },
    now: () => state.time,
    github: {
      appId: "12",
      repository: "owner/repo",
      repositoryId: "123",
      async request(path, init) {
        if (init?.method === "POST") {
          state.posts++;
          const body = JSON.parse(String(init.body));
          const id = String(state.posts);
          state.checks.set(id, { ...body, id, app: { id: 12 } });
          if (state.losePost) throw new Error("Lost POST response.");
          return { id };
        }
        if (init?.method === "PATCH") {
          state.patches++;
          if (state.losePatch) throw new Error("Lost PATCH response.");
          return {};
        }
        if (path.includes("/commits/")) return { check_runs: [...state.checks.values()] };
        return state.checks.get(path.split("/").at(-1) ?? "");
      },
    },
  };
  return { context: value, images, quarantine, state };
}
/** Create the fixture project on first use. */
async function projectService(context: OperationsContext) {
  const service = new Service(context.database);
  if (!(await context.database.prepare("SELECT id FROM visonaut_projects").first())) {
    await service.createPolicy({
      digest: "policy",
      policy: { id: "fixture", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 },
    });
    await service.createProject({ id: "project", repositoryId: "123", policyDigest: "policy" });
  }
  return service;
}
export async function reserve(
  context: OperationsContext,
  id = "run",
  kind: "main" | "pull_request" = "pull_request",
) {
  const service = await projectService(context);
  await service.reserveRun({
    id,
    projectId: "project",
    externalRunId: id,
    attempt: 1,
    kind,
    testedSha: "a".repeat(40),
    lineageKey: kind === "main" ? "main" : id,
    plan: {
      digest: "plan",
      shards: [
        {
          key: "chromium",
          profileDigest: "profile",
          tests: ["test"],
          captures: [{ itemKey: "dialog", variantKey: "light", testId: "test" }],
        },
      ],
    },
    verifiedRelatedRunIds: [],
    verifiedAncestorShas: [],
    verificationDigest: "verified",
    rerunShardKeys: ["chromium"],
    now: context.now(),
  });
  return service;
}
export async function captured(
  context: OperationsContext,
  id = "run",
  kind: "main" | "pull_request" = "pull_request",
) {
  const service = await reserve(context, id, kind);
  const data = "original-image-bytes";
  await context.images.put(`runs/${id}/original`, data, {
    httpMetadata: { contentType: "image/png" },
  });
  await service.registerImage({
    id: `image-${id}`,
    runId: id,
    digest: digest(data),
    objectKey: `runs/${id}/original`,
    contentType: "image/png",
    bytes: data.length,
    width: 1,
    height: 1,
  });
  await service.commitShard({
    runId: id,
    key: "chromium",
    manifestDigest: "manifest",
    finalTestOutcomes: [{ testId: "test", retry: 0, status: "passed" }],
    captures: [
      {
        id: `capture-${id}`,
        itemKey: "dialog",
        variantKey: "light",
        ordinal: 0,
        imageId: `image-${id}`,
        profileDigest: "profile",
        environmentProfileDigest: "profile",
        testId: "test",
        testRetry: 0,
        metadata: { testFile: "private.test.ts", profile: { browser: "chromium" } },
      },
    ],
    now: context.now(),
  });
  await service.sealRun({ runId: id, now: context.now() });
  await seedLegacyComparison(service, {
    id: `comparison-${id}`,
    runId: id,
    referenceSnapshotId: null,
    now: context.now(),
    maxAttempts: 2,
  });
  await service.finalizeComparison({ comparisonId: `comparison-${id}`, now: context.now() });
  return service;
}

/**
 * Add one changed screenshot with no decision to a comparison. Call it before
 * the first status update of the run: it changes a count with no new revision.
 */
export async function addUndecidedChange(database: Database, comparisonId: string) {
  await database
    .prepare(`INSERT INTO visonaut_comparison_rows
      (id, comparison_id, item_key, variant_key, ordinal, tuple_json, outcome, result_json)
      SELECT comparison_id || ':menu', comparison_id, 'menu', variant_key, ordinal + 1,
        tuple_json, 'changed', result_json
      FROM visonaut_comparison_rows WHERE comparison_id = ? ORDER BY ordinal LIMIT 1`)
    .bind(comparisonId)
    .run();
}

export async function ingestRecords(context: OperationsContext, runId: string) {
  const image = await context.database
    .prepare("SELECT * FROM visonaut_images WHERE run_id=? AND role='original' LIMIT 1")
    .bind(runId)
    .first<{
      id: string;
      digest: string;
      object_key: string;
      bytes: number;
      width: number;
      height: number;
    }>();
  if (!image) throw new Error("Missing original image for the ingest fixture.");
  const manifest = JSON.stringify({ runId, captures: [{ imageDigest: image.digest }] });
  const manifestDigest = digest(manifest);
  const planKey = `plans/${runId}.json`;
  const manifestKey = `manifests/${runId}.json`;
  await context.quarantine.put(planKey, JSON.stringify({ runId, shards: ["chromium"] }));
  await context.quarantine.put(manifestKey, manifest);
  await context.database
    .prepare(
      "INSERT INTO ingest_run_provenance(run_id,verified_json,plan_object_key,created_at) VALUES(?,?,?,?)",
    )
    .bind(
      runId,
      JSON.stringify({ workflowRunId: "456", workflowAttempt: 1 }),
      planKey,
      context.now(),
    )
    .run();
  await context.database
    .prepare(
      "INSERT INTO ingest_manifests(run_id,shard_key,digest,object_key,job_id,capture_count,finalized,created_at) VALUES(?,'chromium',?,?,'789',1,1,?)",
    )
    .bind(runId, manifestDigest, manifestKey, context.now())
    .run();
  const id = crypto.randomUUID();
  await context.database
    .prepare(
      "INSERT INTO ingest_uploads(id,run_id,shard_key,manifest_digest,digest,media_type,expected_bytes,width,height,quarantine_key,image_id,image_key,complete) VALUES(?,?,'chromium',?,?,'image/png',?,?,?,?,?,?,1)",
    )
    .bind(
      id,
      runId,
      manifestDigest,
      image.digest,
      image.bytes,
      image.width,
      image.height,
      `quarantine/${runId}/${id}`,
      image.id,
      image.object_key,
    )
    .run();
  return {
    upload: await context.database
      .prepare("SELECT * FROM ingest_uploads WHERE id=?")
      .bind(id)
      .first(),
    provenance: await context.database
      .prepare("SELECT * FROM ingest_run_provenance WHERE run_id=?")
      .bind(runId)
      .first(),
    manifest: await context.database
      .prepare("SELECT * FROM ingest_manifests WHERE run_id=?")
      .bind(runId)
      .first(),
  };
}

export const profile = {
  browser: "chromium",
  browserVersion: "154.0.8037.44",
  locale: "en-US",
  timezone: "UTC",
  comparisonEngineVersion: "rgba-visible-1",
  osImageDigest: "a".repeat(64),
  fontsDigest: "b".repeat(64),
  comparisonPolicyDigest: "c".repeat(64),
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
  colorScheme: "light",
  contrast: "no-preference",
  forcedColors: "none",
  animationPolicy: "disabled",
  captureOptions: { animations: "disabled", caret: "hide", scale: "css" },
} satisfies CaptureProfile;

export interface InventoryRunParams {
  id: string;
  kind: "main" | "pull_request";
  /** The image bytes of each item. Bytes equal to the baseline keep its image. */
  items: Record<string, string>;
}

/**
 * Build a sealed and approved run of the inventory form: a capture inventory,
 * a local comparison receipt, and images only for the captures that differ
 * from the project baseline. The baseline must have an inventory. The first
 * main run of a project has no baseline.
 */
export async function inventoryRun(
  context: OperationsContext,
  { id, kind, items }: InventoryRunParams,
) {
  const service = await projectService(context);
  const project = await service.project("project");
  const snapshotId = project.snapshot_id;
  const reference = snapshotId ? await readSnapshotInventory(context, snapshotId) : null;
  if (snapshotId && !reference) {
    throw new Error("The baseline of an inventory run needs an inventory.");
  }
  const references = new Map(
    (reference?.captures ?? []).map((capture) => [capture.itemKey, capture]),
  );
  const profileDigest = await digestJson(profile);
  const renderingProfileDigest = await digestRenderingProfile(profile);
  const environmentProfileDigest = await digestEnvironmentProfile(profile);
  const profiles = [{ digest: profileDigest, profile }];
  const testedSha = digest(id).slice(0, 40);
  const variant = { key: "light", browser: "chromium" } as const;
  const receipt: LocalComparisonReceipt = {
    mode: "local-v1",
    engineVersion: LOCAL_COMPARISON_ENGINE,
    codecVersion: LOCAL_COMPARISON_CODEC,
    reference: {
      snapshotId,
      baselineRevision: project.baseline_revision,
      // Only the Submit route verifies these two digests.
      manifestDigest: "e".repeat(64),
      inventoryDigest: "f".repeat(64),
      captureCount: references.size,
    },
    captures: [],
    removals: [...references.values()]
      .filter((capture) => !Object.hasOwn(items, capture.itemKey))
      .map(({ itemKey, variantKey }) => ({ itemKey, variantKey })),
  };
  const captures: InventoryCapture[] = [];
  const uploads: { image: ValidatedImage; body: string }[] = [];
  for (const [ordinal, [itemKey, body]] of Object.entries(items).entries()) {
    const referenceImage = references.get(itemKey)?.image;
    const image: ValidatedImage =
      referenceImage?.digest === digest(body)
        ? referenceImage
        : {
            id: `image-${id}-${itemKey}`,
            runId: id,
            objectKey: `runs/${id}/images/${itemKey}.png`,
            digest: digest(body),
            bytes: new TextEncoder().encode(body).byteLength,
            contentType: "image/png",
            width: 1,
            height: 1,
          };
    const isChanged = image !== referenceImage;
    if (isChanged) {
      uploads.push({ image, body });
    }
    const observedImage = {
      path: `images/${itemKey}.png`,
      mediaType: image.contentType,
      digest: image.digest,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
    };
    const outcome = isChanged ? ("changed" as const) : ("unchanged" as const);
    const changedPixels = isChanged ? 1 : 0;
    captures.push({
      id: `capture-${id}-${itemKey}`,
      itemKey,
      variantKey: variant.key,
      ordinal,
      imageId: image.id,
      image,
      profileDigest,
      renderingProfileDigest,
      environmentProfileDigest,
      testId: "test",
      testRetry: 0,
      metadata: {
        name: itemKey,
        variant,
        profile: captureProfileReference(profileDigest),
        localMode: receipt.mode,
        observedImage,
        candidateStored: isChanged,
        localResult: {
          outcome,
          changedPixels,
          ratio: changedPixels,
          maskExpected: false,
          engineVersion: LOCAL_COMPARISON_ENGINE,
          codecVersion: LOCAL_COMPARISON_CODEC,
        },
      },
    });
    receipt.captures.push({
      itemKey,
      variantKey: variant.key,
      candidateDigest: image.digest,
      referenceDigest: referenceImage?.digest ?? null,
      outcome,
      changedPixels,
      ratio: changedPixels,
      sizeChanged: false,
    });
  }
  const planDigest = digest(`plan-${id}`);
  await service.reserveRun({
    id,
    projectId: project.id,
    externalRunId: id,
    attempt: 1,
    kind,
    testedSha,
    lineageKey: kind === "main" ? "main" : id,
    plan: {
      digest: planDigest,
      shards: [
        {
          key: "combined",
          profileDigest,
          tests: ["test"],
          captures: captures.map(({ itemKey, variantKey }) => ({
            itemKey,
            variantKey,
            testId: "test",
          })),
        },
      ],
    },
    verifiedRelatedRunIds: [],
    verifiedAncestorShas: reference ? [reference.testedSha] : [],
    verificationDigest: "verified",
    rerunShardKeys: ["combined"],
    now: context.now(),
  });
  for (const { image, body } of uploads) {
    await context.images.put(image.objectKey, body, {
      httpMetadata: { contentType: image.contentType },
    });
    await service.registerImage(image);
  }
  // Production stores a profile row only for a run with a changed capture.
  if (uploads.length) {
    await storeCaptureProfiles(context.database, profiles);
  }
  const inventory: CaptureInventory = {
    schemaVersion: "baseline-delta-v1",
    projectId: project.id,
    runId: id,
    testedSha,
    referenceSnapshotId: snapshotId,
    captures,
    profiles,
    manifest: {
      schemaVersion: "1.0",
      producer: {
        name: "visonaut",
        version: "1.0.0",
        nodeVersion: "24",
        playwrightVersion: "1.63.0",
      },
      run: {
        repository: "owner/repo",
        repositoryId: "123",
        workflowRunId: "456",
        workflowAttempt: 1,
        testedSha,
        planDigest,
      },
      shard: { key: "combined", jobId: "789", sourceAttempt: 1 },
      profiles,
      tests: [
        { id: "test", file: "fixture.test.ts", titlePath: ["Fixture"], retry: 0, status: "passed" },
      ],
      captures: captures.map((capture) => ({
        itemKey: capture.itemKey,
        variant,
        ordinal: capture.ordinal,
        testId: capture.testId,
        testRetry: capture.testRetry,
        profileDigest,
        image: {
          path: `images/${capture.itemKey}.png`,
          mediaType: capture.image.contentType,
          digest: capture.image.digest,
          bytes: capture.image.bytes,
          width: capture.image.width,
          height: capture.image.height,
        },
      })),
      localComparison: receipt,
    },
  };
  const pointer = await writeCaptureInventory(context.images, inventory);
  await service.commitShard({
    runId: id,
    key: "combined",
    manifestDigest: digest(`manifest-${id}`),
    captures,
    inventory: pointer,
    imageRunIds: [...new Set(captures.map((capture) => capture.image.runId))],
    ...(snapshotId ? { localReferenceSnapshotId: snapshotId } : {}),
    finalTestOutcomes: [{ testId: "test", retry: 0, status: "passed" }],
    now: context.now(),
  });
  await service.sealRun({ runId: id, now: context.now() });
  const comparisonId = `comparison-${id}`;
  await service.createComparison({
    id: comparisonId,
    runId: id,
    referenceSnapshotId: snapshotId,
    expectedBaselineRevision: project.baseline_revision,
    localComparison: receipt,
    referenceCaptures: [...references.values()].map((capture) => ({
      id: capture.id,
      itemKey: capture.itemKey,
      variantKey: capture.variantKey,
      profileDigest: capture.profileDigest,
      renderingProfileDigest: capture.renderingProfileDigest,
      image: capture.image,
    })),
    now: context.now(),
  });
  await service.finalizeComparison({ comparisonId, now: context.now() });
  for (const row of await service.comparisonRows(comparisonId)) {
    await service.review({
      commandId: `approve-${row.id}`,
      actorId: "maintainer",
      sessionId: "session",
      comparisonId,
      verdict: "approved",
      targets: [{ id: row.id, expectedRevision: row.decision_revision }],
      selection: { itemKey: row.item_key, variantKey: row.variant_key },
      now: context.now(),
    });
  }
  return { service, inventory: pointer };
}
