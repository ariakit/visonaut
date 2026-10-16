import { seedLegacyComparison } from "../../../../tooling/legacy-comparison-fixture.ts";
import {
  CAPTURE_PAGE_ROWS,
  digestJson,
  type CaptureProfile,
  type CaptureRowImage,
  type CaptureRowResult,
  type Variant,
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
  openCaptureInventory,
  readCaptureInventory,
  writeCapturePages,
} from "../capture-inventory.ts";
import { checkedComparison, listReference } from "../api/local-comparison.ts";
import type { CapturePagesInput } from "../capture-pages.ts";
import { readSnapshotInventory } from "../inventory-records.ts";
import { storeCaptureProfiles } from "../profiles.ts";
import type { ArchivedRunHistory } from "./history-format.ts";
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
/**
 * The current decision of a row in the page of a closed run, from the
 * decisions that `readClosedSummary` reads with the rows.
 */
export function summaryDecision(summary: ArchivedRunHistory | null, rowIndex = 0) {
  const row = summary?.sections.comparisonRows?.[rowIndex];
  const id = row?.source_decision_id ?? row?.decision_id;
  return summary?.sections.decisions?.find((decision) => decision.id === id);
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

/** The profile of a capture page: a page holds the comparison settings in its own list. */
const {
  comparisonEngineVersion: _comparisonEngineVersion,
  comparisonPolicyDigest: _comparisonPolicyDigest,
  ...profileOfPage
} = profile;
export const pageProfile: CaptureProfile = profileOfPage;

export const pageVariant = { key: "light", browser: "chromium" } satisfies Variant;

export interface PageCapture {
  itemKey: string;
  /** The image that the run keeps: its own image, or the image of the reference. */
  image: ValidatedImage;
  /** The image of the row, when the run keeps a reference image with other bytes. */
  observed?: CaptureRowImage;
  result: CaptureRowResult;
  maskImageId?: string;
}

/**
 * Build the capture pages of a run, 2,000 rows in each page, from captures in
 * the order of the item key. Each capture has the same variant, profile, test,
 * and comparison settings.
 */
export function capturePages(captures: PageCapture[]): CapturePagesInput["pages"] {
  const pages: CapturePagesInput["pages"] = [];
  for (let offset = 0; offset < captures.length; offset += CAPTURE_PAGE_ROWS) {
    const part = captures.slice(offset, offset + CAPTURE_PAGE_ROWS);
    pages.push({
      page: {
        schemaVersion: "1.0",
        variants: [pageVariant],
        profiles: [pageProfile],
        tests: [{ id: "test", file: "fixture.test.ts", titlePath: ["Fixture"], retry: 0 }],
        comparisons: [{ threshold: 0 }],
        rows: part.map(({ itemKey, image, observed = image, result }) => [
          itemKey,
          null,
          0,
          0,
          0,
          null,
          0,
          observed.digest,
          observed.bytes,
          observed.width,
          observed.height,
          result,
        ]),
      },
      images: part.map(({ image, maskImageId }) => ({
        image,
        ...(maskImageId === undefined ? {} : { maskImageId }),
      })),
    });
  }
  return pages;
}

export interface InventoryRunParams {
  id: string;
  kind: "main" | "pull_request";
  /** The image bytes of each item. Bytes equal to the baseline keep its image. */
  items: Record<string, string>;
  /** The lineage of the run. A pull request run uses its own id by default. */
  lineageKey?: string;
  /** The earlier runs of the same lineage that the run verified. */
  relatedRunIds?: string[];
  /** Approve each row as a reviewer after the automatic decisions. */
  approve?: boolean;
}

/**
 * Build a sealed and approved run of the inventory form: capture pages and
 * their index, the comparison of the pages, and images only for the captures
 * that differ from the project baseline. The baseline must have an inventory.
 * The first main run of a project has no baseline.
 */
export async function inventoryRun(
  context: OperationsContext,
  { id, kind, items, lineageKey, relatedRunIds = [], approve = true }: InventoryRunParams,
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
  const profileDigest = await digestJson(pageProfile);
  const profiles = [{ digest: profileDigest, profile: pageProfile }];
  const testedSha = digest(id).slice(0, 40);
  const pageCaptures: PageCapture[] = [];
  const uploads: { image: ValidatedImage; body: string }[] = [];
  // The rows of a page have the order of the item key.
  for (const itemKey of Object.keys(items).sort()) {
    const body = items[itemKey];
    if (body === undefined) continue;
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
    const changedPixels = isChanged ? 1 : 0;
    const changed = {
      outcome: "changed" as const,
      changedPixels,
      ratio: changedPixels,
      sizeChanged: false,
    };
    pageCaptures.push({
      itemKey,
      image,
      result: !isChanged
        ? 0
        : referenceImage
          ? { reference: referenceImage.digest, ...changed }
          : 1,
    });
  }
  const pointer = await writeCapturePages(context.images, {
    projectId: project.id,
    runId: id,
    testedSha,
    referenceSnapshotId: snapshotId,
    receipt: null,
    pages: capturePages(pageCaptures),
  });
  // The index and each page: a retention test checks that all of them stay.
  const stored = await context.images.list({ prefix: `runs/${id}/inventory/` });
  const inventoryKeys = stored.objects.map((object) => object.key);
  // The run commits the capture list that each reader builds from the pages.
  const { captures } = await readCaptureInventory(context.images, pointer);
  const planDigest = digest(`plan-${id}`);
  await service.reserveRun({
    id,
    projectId: project.id,
    externalRunId: id,
    attempt: 1,
    kind,
    testedSha,
    lineageKey: lineageKey ?? (kind === "main" ? "main" : id),
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
    verifiedRelatedRunIds: relatedRunIds,
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
  // The comparison input of a Submit, one page of the committed list at a time.
  const comparison = await checkedComparison({
    pages: (await openCaptureInventory(context.images, pointer)).pages(),
    reference: { snapshotId, baselineRevision: project.baseline_revision, digest: null },
    references: listReference(reference?.captures ?? []),
  });
  await service.createComparison({
    id: comparisonId,
    runId: id,
    referenceSnapshotId: snapshotId,
    expectedBaselineRevision: project.baseline_revision,
    ...comparison,
    now: context.now(),
  });
  await service.finalizeComparison({ comparisonId, now: context.now() });
  if (approve) {
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
  }
  return { service, inventory: pointer, inventoryKeys };
}
