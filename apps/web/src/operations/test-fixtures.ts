import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  Service,
  type Database,
  type Result,
  type SqlValue,
  type Statement,
} from "@visonaut/service";
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
  readonly connection = new DatabaseSync(":memory:");
  beforeBatch: (() => void) | null = null;
  preparedQueries = 0;
  constructor() {
    this.connection.exec(
      readFileSync(new URL("../../migrations/0001_service.sql", import.meta.url), "utf8"),
    );
    this.connection.exec(
      readFileSync(new URL("../../migrations/0002_work.sql", import.meta.url), "utf8"),
    );
    this.connection.exec(
      readFileSync(new URL("../../migrations/0003_auth.sql", import.meta.url), "utf8"),
    );
    this.connection.exec(
      readFileSync(new URL("../../migrations/0004_ingest.sql", import.meta.url), "utf8"),
    );
    this.connection.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
    this.connection.exec(
      readFileSync(new URL("../../migrations/0006_acceptance.sql", import.meta.url), "utf8"),
    );
    this.connection.exec(
      readFileSync(new URL("../../migrations/0007_backup_inventory.sql", import.meta.url), "utf8"),
    );
    for (const migration of [
      "0008_capture_profiles",
      "0009_retention_history",
      "0010_run_history",
      "0011_backup_groups",
      "0012_historical_comparisons",
      "0013_promotion_scans",
      "0014_visonaut_brand",
      "0016_comparison_publication",
    ]) {
      this.connection.exec(
        readFileSync(new URL(`../../migrations/${migration}.sql`, import.meta.url), "utf8"),
      );
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
  const backups = new MemoryStore();
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
    backups,
    quarantine,
    comparisons: { async send() {} },
    origin: "https://visonaut.example",
    budget: {
      tasksPerStep: 10,
      objectsPerStep: 2,
      leaseMilliseconds: 60_000,
      maxAttempts: 2,
      maximumObjectBytes: 1024 * 1024,
      maximumDatabaseBytes: 8 * 1024 * 1024,
      maximumExportEntries: 100,
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
  return { context: value, images, backups, quarantine, state };
}
export async function reserve(
  context: OperationsContext,
  id = "run",
  kind: "main" | "pull_request" = "pull_request",
) {
  const service = new Service(context.database);
  if (!(await context.database.prepare("SELECT id FROM visonaut_projects").first())) {
    await service.createPolicy({
      digest: "policy",
      policy: { id: "fixture", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 },
    });
    await service.createProject({ id: "project", repositoryId: "123", policyDigest: "policy" });
  }
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
  await service.createComparison({
    id: `comparison-${id}`,
    runId: id,
    referenceSnapshotId: null,
    now: context.now(),
    maxAttempts: 2,
  });
  await service.finalizeComparison({ comparisonId: `comparison-${id}`, now: context.now() });
  return service;
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
