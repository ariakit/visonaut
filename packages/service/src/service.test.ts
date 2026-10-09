import {
  readLegacyComparisonTask,
  seedLegacyComparison,
  seedLegacyResult,
} from "../../../tooling/legacy-comparison-fixture.ts";
import { readTestMigrations } from "../../../tooling/test-migrations.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  canonicalJson,
  digestJson,
  digestRenderingProfile,
  type CaptureProfile,
} from "@visonaut/protocol";
import { describe, expect, it, vi } from "vitest";
import { compareImages, selectedComparisonPolicy } from "../../compare/src/compare.ts";
import type { Database, Result, SqlValue, Statement } from "./database.ts";
import { ConflictError, IncompleteError } from "./database.ts";
import { captureProfilesDigest, Service, type ComparisonTask } from "./service.ts";
import {
  claimRetiredSnapshotDeletion,
  completeRetiredRunDeletion,
  completeRetiredSnapshotDeletion,
  releaseExpiredComparisonReferences,
  retireSnapshot,
} from "./retention.ts";
import { claimExpiredRun, claimStatus, closedRunRetentionMs } from "./work.ts";
import {
  archiveEligibilitySql,
  compactRunHistory,
  prepareArchivedCommandReplay,
} from "./history.ts";
import type {
  ComparisonResult,
  ReviewParams,
  ValidatedImage,
  CaptureInventoryPointer,
  ReferenceCaptureInput,
  CommitShardParams,
} from "./types.ts";
import {
  LOCAL_COMPARISON_ENGINE,
  LOCAL_COMPARISON_CODEC,
  type LocalComparisonReceipt,
} from "@visonaut/protocol";

class SqliteStatement implements Statement {
  constructor(
    readonly connection: DatabaseSync,
    readonly sql: string,
    readonly values: SqlValue[] = [],
    readonly maximumBindings = Number.POSITIVE_INFINITY,
  ) {}
  bind(...values: SqlValue[]) {
    if (values.length > this.maximumBindings) throw new Error("Too many bound parameters.");
    return new SqliteStatement(this.connection, this.sql, values, this.maximumBindings);
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

class TestDatabase implements Database {
  readonly connection = new DatabaseSync(":memory:");
  beforeBatch: (() => void) | null = null;
  preparedQueries = 0;
  batchCalls = 0;
  maximumBindings = Number.POSITIVE_INFINITY;
  constructor(through?: string) {
    for (const migration of readTestMigrations({ through })) {
      this.connection.exec(migration.sql);
    }
  }
  prepare(sql: string) {
    this.preparedQueries += 1;
    return new SqliteStatement(this.connection, sql, [], this.maximumBindings);
  }
  async batch(statements: Statement[]) {
    this.batchCalls += 1;
    // Inject races after read batches, at the atomic write boundary.
    if (
      statements.some(
        (entry) => entry instanceof SqliteStatement && !entry.sql.startsWith("SELECT"),
      )
    ) {
      const before = this.beforeBatch;
      this.beforeBatch = null;
      before?.();
    }
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

interface FixtureInput {
  id: string;
  items?: string[];
  color?: string;
  kind?: "main" | "pull_request" | "merge_group";
  lineage?: string;
  related?: string[];
  attempt?: number;
  external?: string;
  ancestorShas?: string[];
  compare?: (task: ComparisonTask) => ComparisonResult;
  captureProfileDigest?: string;
  measuredEnvironmentProfile?: boolean;
  realDigest?: boolean;
  finalize?: boolean;
}

async function fixture(service: Service, input: FixtureInput) {
  const project = await service.project("project");
  const items = input.items ?? ["dialog"];
  const snapshot = project.snapshot_id
    ? await service.database
        .prepare("SELECT tested_sha FROM visonaut_snapshots WHERE id = ?")
        .bind(project.snapshot_id)
        .first<{ tested_sha: string }>()
    : null;
  await service.reserveRun({
    id: input.id,
    projectId: "project",
    externalRunId: input.external ?? input.id,
    attempt: input.attempt ?? 1,
    kind: input.kind ?? "main",
    testedSha: `sha-${input.id}`,
    lineageKey: input.lineage ?? (input.kind === "pull_request" ? input.id : "main"),
    plan: {
      digest: "plan",
      shards: [
        {
          key: "chromium",
          profileDigest: "profile",
          ...(input.measuredEnvironmentProfile
            ? { environmentProfilePolicy: "measured" as const }
            : {}),
          tests: ["test"],
          captures: items.map((itemKey) => ({ itemKey, variantKey: "light", testId: "test" })),
        },
      ],
    },
    verifiedRelatedRunIds: input.related ?? [],
    verifiedAncestorShas: [
      ...(snapshot ? [snapshot.tested_sha] : []),
      ...(input.ancestorShas ?? []),
    ],
    verificationDigest: "verified-github-proof",
    rerunShardKeys: ["chromium"],
    now: 1,
  });
  for (const item of items) {
    const digestInput = `${item}-${input.color ?? "blue"}`;
    await service.registerImage({
      id: `image-${input.id}-${item}`,
      runId: input.id,
      digest: input.realDigest
        ? createHash("sha256").update(digestInput).digest("hex")
        : digestInput,
      objectKey: `runs/${input.id}/${item}`,
      contentType: "image/png",
      bytes: 80,
      width: 10,
      height: 10,
    });
  }
  await service.commitShard({
    runId: input.id,
    key: "chromium",
    manifestDigest: `manifest-${input.id}`,
    finalTestOutcomes: [{ testId: "test", retry: 1, status: "passed" }],
    captures: items.map((itemKey, ordinal) => ({
      id: `capture-${input.id}-${itemKey}`,
      itemKey,
      variantKey: "light",
      ordinal,
      imageId: `image-${input.id}-${itemKey}`,
      profileDigest: input.captureProfileDigest ?? "profile",
      environmentProfileDigest: "profile",
      testId: "test",
      testRetry: 1,
      metadata: { name: itemKey },
    })),
    now: 2,
  });
  await service.sealRun({ runId: input.id, now: 3 });
  await seedComparison(service, {
    id: `comparison-${input.id}`,
    runId: input.id,
    referenceSnapshotId: project.snapshot_id,
    compare: input.compare,
  });
  if (input.finalize !== false) {
    await service.finalizeComparison({ comparisonId: `comparison-${input.id}`, now: 6 });
  }
  return `comparison-${input.id}`;
}

interface SeedComparisonParams {
  id: string;
  runId: string;
  referenceSnapshotId: string | null;
  compare?: FixtureInput["compare"];
}

async function seedComparison(service: Service, input: SeedComparisonParams) {
  await seedLegacyComparison(service, {
    id: input.id,
    runId: input.runId,
    referenceSnapshotId: input.referenceSnapshotId,
    now: 4,
    maxAttempts: 3,
  });
  for (const row of await service.comparisonRows(input.id)) {
    if (row.outcome === "pending") {
      await seedLegacyResult(service, {
        taskId: row.id,
        result: input.compare
          ? input.compare(await readLegacyComparisonTask(service, row.id))
          : {
              outcome: "changed",
              changedPixels: 1,
              ratio: 0.01,
              engineVersion: "engine",
              codecVersion: "codec",
            },
      });
    }
  }
}

async function setup(service: Service) {
  await service.createPolicy({
    digest: "policy",
    policy: { id: "study-fixture", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 },
  });
  await service.createProject({ id: "project", repositoryId: "123", policyDigest: "policy" });
}

async function promote(service: Service, runId: string) {
  const project = await service.project("project");
  let copies = await service.preparePromotion({
    snapshotId: `snapshot-${runId}`,
    comparisonId: `comparison-${runId}`,
    prefix: `baselines/${runId}`,
    now: 10,
  });
  while (copies.length) {
    for (const copy of copies) {
      await service.recordSnapshotCopy({
        snapshotId: `snapshot-${runId}`,
        captureId: copy.capture_id,
        objectKey: copy.object_key,
        digest: copy.digest,
      });
    }
    copies = await service.pendingSnapshotCopies(`snapshot-${runId}`, 50);
  }
  return service.promote({
    snapshotId: `snapshot-${runId}`,
    promotionId: `promotion-${runId}`,
    expectedBaselineRevision: project.baseline_revision,
    now: 11,
  });
}

async function review(service: Service, comparisonId: string, options: Partial<ReviewParams> = {}) {
  const rows = (await service.comparisonRows(comparisonId)).filter(
    (row) => row.outcome === "changed",
  );
  return service.review({
    commandId: crypto.randomUUID(),
    actorId: "maintainer-1",
    sessionId: "session",
    comparisonId,
    verdict: "approved",
    targets: rows.map((row) => ({ id: row.id, expectedRevision: row.decision_revision })),
    selection: { itemKey: rows[0]?.item_key ?? "dialog", variantKey: "light" },
    now: 7,
    ...options,
  });
}

async function seed(service: Service, items = ["dialog"]) {
  await setup(service);
  await fixture(service, { id: "seed", items });
  await promote(service, "seed");
}

function count(database: TestDatabase, table: string) {
  return database.connection.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count;
}

interface TimedRunParams extends Omit<FixtureInput, "finalize"> {
  finalizedAt: number;
}

/**
 * Finalizes one pull request run of the red change at a chosen time. The shared
 * fixture finalizes each run at the same time, which hides the order between a
 * copy, an approval, and a Reject.
 */
async function timedRun(service: Service, { finalizedAt, ...input }: TimedRunParams) {
  const comparisonId = await fixture(service, {
    kind: "pull_request",
    lineage: "pr-1",
    color: "red",
    ...input,
    finalize: false,
  });
  await service.finalizeComparison({ comparisonId, now: finalizedAt });
}

async function currentDecision(service: Service, runId: string) {
  const row = (await service.comparisonRows(`comparison-${runId}`))[0];
  if (!row) {
    throw new Error("Missing comparison row");
  }
  return row.decision_id;
}

/** Returns the approval that the current decision of the run was copied from. */
async function copiedSource(service: Service, runId: string) {
  const decisionId = await currentDecision(service, runId);
  if (!decisionId) return null;
  const decision = await service.database
    .prepare("SELECT source_decision_id FROM visonaut_decisions WHERE id = ?")
    .bind(decisionId)
    .first<{ source_decision_id: string | null }>();
  return decision?.source_decision_id ?? null;
}

interface SparseFixtureParams {
  id: string;
  items: string[];
  changed?: string[];
  kind?: "main" | "pull_request";
  related?: string[];
}

async function sparseFixture(service: Service, input: SparseFixtureParams) {
  const project = await service.project("project");
  const source = await service.run("seed");
  const references: ReferenceCaptureInput[] = input.items.length
    ? ((
        await service.database
          .prepare(`SELECT capture.id,capture.item_key,capture.variant_key,capture.profile_digest,
      image.id AS image_id,image.run_id,image.digest,image.object_key,image.bytes,image.width,image.height
      FROM visonaut_captures capture JOIN visonaut_images image ON image.id=capture.image_id WHERE capture.run_id='seed'`)
          .all<{
            id: string;
            item_key: string;
            variant_key: string;
            profile_digest: string;
            image_id: string;
            run_id: string;
            digest: string;
            object_key: string;
            bytes: number;
            width: number;
            height: number;
          }>()
      ).results?.map((capture) => ({
        id: capture.id,
        itemKey: capture.item_key,
        variantKey: capture.variant_key,
        profileDigest: capture.profile_digest,
        renderingProfileDigest: capture.profile_digest,
        image: {
          id: capture.image_id,
          runId: capture.run_id,
          digest: capture.digest,
          objectKey: capture.object_key,
          bytes: capture.bytes,
          width: capture.width,
          height: capture.height,
          contentType: "image/png" as const,
        },
      })) ?? [])
    : [];
  await service.reserveRun({
    id: input.id,
    projectId: project.id,
    externalRunId: input.id,
    attempt: 1,
    kind: input.kind ?? "main",
    testedSha: `sha-${input.id}`,
    lineageKey: input.kind === "pull_request" ? input.id : "main",
    plan: {
      digest: "plan",
      shards: [
        {
          key: "chromium",
          profileDigest: "profile",
          tests: ["test"],
          captures: input.items.map((itemKey) => ({
            itemKey,
            variantKey: "light",
            testId: "test",
          })),
        },
      ],
    },
    verifiedRelatedRunIds: input.related ?? [],
    verifiedAncestorShas: [source.tested_sha],
    verificationDigest: "verified-proof",
    rerunShardKeys: ["chromium"],
    now: 20,
  });
  const captures: CommitShardParams["captures"] = [];
  const localComparison: LocalComparisonReceipt = {
    mode: "local-v1",
    engineVersion: LOCAL_COMPARISON_ENGINE,
    codecVersion: LOCAL_COMPARISON_CODEC,
    reference: {
      manifestDigest: "manifest",
      snapshotId: project.snapshot_id,
      baselineRevision: project.baseline_revision,
      inventoryDigest: "reference",
      captureCount: references.length,
    },
    captures: [],
    removals: references
      .filter((reference) => !input.items.includes(reference.itemKey))
      .map(({ itemKey, variantKey }) => ({ itemKey, variantKey })),
  };
  const owners = new Set<string>();
  for (const [ordinal, itemKey] of input.items.entries()) {
    const reference = references.find((entry) => entry.itemKey === itemKey);
    const changed = !reference || Boolean(input.changed?.includes(itemKey));
    const image: ValidatedImage = changed
      ? {
          id: `image-${input.id}-${itemKey}`,
          runId: input.id,
          digest: `${itemKey}-red`,
          objectKey: `runs/${input.id}/images/${itemKey}`,
          contentType: "image/png",
          bytes: 80,
          width: 10,
          height: 10,
        }
      : reference.image;
    if (changed) await service.registerImage(image);
    owners.add(image.runId);
    const outcome = changed ? ("changed" as const) : ("unchanged" as const);
    captures.push({
      id: `capture-${input.id}-${itemKey}`,
      itemKey,
      variantKey: "light",
      ordinal,
      imageId: image.id,
      profileDigest: "profile",
      environmentProfileDigest: "profile",
      testId: "test",
      testRetry: 1,
      metadata: {
        name: itemKey,
        localMode: "local-v1",
        candidateStored: changed,
        observedImage: image,
        localResult: {
          outcome,
          changedPixels: changed ? 1 : 0,
          ratio: changed ? 0.01 : 0,
          maskExpected: false,
          engineVersion: LOCAL_COMPARISON_ENGINE,
          codecVersion: LOCAL_COMPARISON_CODEC,
        },
      },
    });
    localComparison.captures.push({
      itemKey,
      variantKey: "light",
      candidateDigest: image.digest,
      referenceDigest: reference?.image.digest ?? null,
      outcome,
      changedPixels: changed ? 1 : 0,
      ratio: changed ? 0.01 : 0,
      sizeChanged: false,
    });
  }
  const inventory: CaptureInventoryPointer = {
    objectKey: `runs/${input.id}/inventory/${"c".repeat(64)}.json`,
    digest: "c".repeat(64),
    bytes: 1024,
    captureCount: captures.length,
  };
  const commit: CommitShardParams = {
    runId: input.id,
    key: "chromium",
    manifestDigest: `manifest-${input.id}`,
    captures,
    inventory,
    imageRunIds: [...owners],
    localReferenceSnapshotId: project.snapshot_id,
    finalTestOutcomes: [{ testId: "test", retry: 1, status: "passed" }],
    now: 21,
  };
  const comparisonInput = {
    id: `comparison-${input.id}`,
    runId: input.id,
    referenceSnapshotId: project.snapshot_id,
    expectedBaselineRevision: project.baseline_revision,
    localComparison,
    referenceCaptures: references,
    now: 23,
  };
  const complete = async () => {
    await service.commitShard(commit);
    await service.sealRun({ runId: input.id, now: 22 });
    await service.createComparison(comparisonInput);
    await service.finalizeComparison({ comparisonId: comparisonInput.id, now: 24 });
  };
  return { commit, comparisonInput, inventory, owners: [...owners], complete };
}

describe("complete R2 inventory with changed D1 rows", () => {
  it("resumes bounded private comparison pages before exposing the complete review", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    const items = Array.from({ length: 201 }, (_, index) => `item-${index}-${"é".repeat(1000)}`);
    await seed(service, items);
    const sparse = await sparseFixture(service, { id: "paged", items, changed: items });
    await service.commitShard(sparse.commit);
    await service.sealRun({ runId: "paged", now: 22 });
    const originalBatch = database.batch.bind(database);
    const pageSizes: number[] = [];
    let pages = 0;
    const interrupted = vi.spyOn(database, "batch").mockImplementation(async (statements) => {
      for (const entry of statements) {
        if (
          !(entry instanceof SqliteStatement) ||
          !entry.sql.startsWith("INSERT INTO visonaut_comparison_rows")
        )
          continue;
        const page = entry.values[1];
        if (typeof page !== "string") throw new Error("Missing comparison page");
        pageSizes.push(new TextEncoder().encode(page).byteLength);
        expect(JSON.parse(page).length).toBeLessThanOrEqual(100);
        pages += 1;
        if (pages === 2) throw new Error("Interrupted comparison write");
      }
      return originalBatch(statements);
    });
    await expect(service.createComparison(sparse.comparisonInput)).rejects.toThrow(
      "Interrupted comparison write",
    );
    expect((await service.run("paged")).comparison_id).toBeNull();
    await expect(
      service.finalizeComparison({ comparisonId: "comparison-paged", now: 24 }),
    ).rejects.toBeInstanceOf(ConflictError);
    interrupted.mockRestore();
    const resumed = await service.createComparison({
      ...sparse.comparisonInput,
      id: "comparison-retry",
    });
    expect(resumed.id).toBe("comparison-paged");
    expect((await service.run("paged")).comparison_id).toBe("comparison-paged");
    expect(
      database.connection
        .prepare("SELECT count(*) AS count FROM visonaut_comparison_rows WHERE comparison_id=?")
        .get(resumed.id)?.count,
    ).toBe(201);
    expect(Math.max(...pageSizes)).toBeLessThanOrEqual(512 * 1024);
    expect(
      database.connection
        .prepare("SELECT owner FROM work_retention_pins WHERE owner='comparison:comparison-retry'")
        .get(),
    ).toBeUndefined();
  });

  it("pins every reference image owner, including an original removed from the new inventory", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service, ["changed", "removed", "same"]);
    await fixture(service, {
      id: "borrowed",
      kind: "pull_request",
      items: ["removed"],
      color: "red",
    });
    database.connection
      .prepare(
        "UPDATE visonaut_captures SET image_id=(SELECT image_id FROM visonaut_captures WHERE run_id='borrowed') WHERE run_id='seed' AND item_key='removed'",
      )
      .run();
    database.connection
      .prepare(
        "UPDATE visonaut_snapshots SET inventory_key='runs/seed/inventory/reference.json',inventory_digest=?,inventory_bytes=1024,capture_count=3,inventory_verified=1 WHERE id='snapshot-seed'",
      )
      .run("b".repeat(64));
    database.connection
      .prepare("DELETE FROM visonaut_snapshot_images WHERE snapshot_id='snapshot-seed'")
      .run();
    const sparse = await sparseFixture(service, {
      id: "all-reference-owners",
      items: ["changed", "same"],
      changed: ["changed"],
    });
    await sparse.complete();
    expect(
      database.connection
        .prepare("SELECT run_id FROM work_retention_pins WHERE owner=? ORDER BY run_id")
        .all("comparison:comparison-all-reference-owners")
        .map((pin) => pin.run_id),
    ).toEqual(["borrowed", "seed"]);
    expect(
      database.connection
        .prepare("SELECT run_id FROM work_retention_pins WHERE owner=? AND run_id='borrowed'")
        .get("inherited-by:all-reference-owners"),
    ).toBeUndefined();
  });

  it("retires verified inventory bytes without a dense archive and keeps inventory headers", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service, ["dialog"]);
    const inventoryKey = "runs/seed/inventory/reference.json";
    database.connection
      .prepare(
        "UPDATE visonaut_runs SET inventory_key=?,inventory_digest=?,inventory_bytes=1024,capture_count=1 WHERE id='seed'",
      )
      .run(inventoryKey, "b".repeat(64));
    database.connection
      .prepare(
        "UPDATE visonaut_snapshots SET inventory_key=?,inventory_digest=?,inventory_bytes=1024,capture_count=1,inventory_verified=1 WHERE id='snapshot-seed'",
      )
      .run(inventoryKey, "b".repeat(64));
    database.connection
      .prepare("DELETE FROM visonaut_snapshot_images WHERE snapshot_id='snapshot-seed'")
      .run();
    database.connection
      .prepare("UPDATE visonaut_projects SET snapshot_id=NULL,promotion_id=NULL WHERE id='project'")
      .run();
    await retireSnapshot(database, { snapshotId: "snapshot-seed", now: 100, graceMs: 0 });
    expect(
      database.connection
        .prepare(
          `SELECT run.id FROM visonaut_runs run WHERE run.id='seed' AND ${archiveEligibilitySql("run")}`,
        )
        .get(),
    ).toBeUndefined();
    database.connection
      .prepare(
        "INSERT INTO work_retention_pins(run_id,owner,reason) VALUES('seed','comparison:descendant','comparison')",
      )
      .run();
    expect(
      await claimRetiredSnapshotDeletion(database, {
        snapshotId: "snapshot-seed",
        token: "pinned",
        now: 100,
        leaseMs: 100,
      }),
    ).toBeNull();
    database.connection
      .prepare("DELETE FROM work_retention_pins WHERE owner='comparison:descendant'")
      .run();
    expect(
      await claimRetiredSnapshotDeletion(database, {
        snapshotId: "snapshot-seed",
        token: "delete",
        now: 100,
        leaseMs: 100,
      }),
    ).not.toBeNull();
    await completeRetiredSnapshotDeletion(database, {
      snapshotId: "snapshot-seed",
      token: "delete",
      now: 101,
    });
    expect((await service.run("seed")).inventory_key).toBe(inventoryKey);
    expect(
      database.connection
        .prepare("SELECT inventory_key FROM visonaut_snapshots WHERE id='snapshot-seed'")
        .get()?.inventory_key,
    ).toBe(inventoryKey);
  });

  it("seals and promotes a full unchanged run without per-item rows or baseline membership copies", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    const items = Array.from({ length: 24 }, (_, index) => `item-${index}`);
    await seed(service, items);
    const beforeCaptures = count(database, "visonaut_captures");
    const beforeRows = count(database, "visonaut_comparison_rows");
    const beforeMembers = count(database, "visonaut_snapshot_images");
    const sparse = await sparseFixture(service, { id: "unchanged", items });
    await sparse.complete();
    expect(count(database, "visonaut_captures")).toBe(beforeCaptures);
    expect(count(database, "visonaut_comparison_rows")).toBe(beforeRows);
    expect((await service.status("unchanged")).status).toBe("passed");
    const run = await service.run("unchanged");
    expect(run.capture_count).toBe(24);
    expect(
      database.connection
        .prepare(
          "SELECT json_extract(plan_json,'$.shards[0].captures') AS captures FROM visonaut_runs WHERE id='unchanged'",
        )
        .get()?.captures,
    ).toBe("[]");
    const promotion = {
      snapshotId: "snapshot-unchanged",
      comparisonId: "comparison-unchanged",
      prefix: "baselines/unchanged",
      inventory: sparse.inventory,
      imageRunIds: sparse.owners,
      now: 25,
    };
    expect(await service.preparePromotion(promotion)).toEqual([]);
    expect(count(database, "visonaut_snapshot_images")).toBe(beforeMembers);
    await expect(
      service.promote({
        snapshotId: promotion.snapshotId,
        promotionId: "promotion-unchanged",
        expectedBaselineRevision: 1,
        now: 27,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      service.recordInventoryVerification({
        snapshotId: promotion.snapshotId,
        objectKey: sparse.inventory.objectKey,
        digest: "d".repeat(64),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await service.recordInventoryVerification({
      snapshotId: promotion.snapshotId,
      objectKey: sparse.inventory.objectKey,
      digest: sparse.inventory.digest,
    });
    await service.promote({
      snapshotId: promotion.snapshotId,
      promotionId: "promotion-unchanged",
      expectedBaselineRevision: 1,
      now: 27,
    });
    expect((await service.referenceCandidates("project"))[0]?.capture_count).toBe(24);
    expect(
      database.connection
        .prepare(
          "SELECT count(*) AS count FROM work_retention_pins WHERE run_id='seed' AND owner='promotion:snapshot-unchanged'",
        )
        .get()?.count,
    ).toBe(1);
  });

  it("keeps changes unapproved while introductions and explicit removals use tuple image presence", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service, ["same", "changed", "removed"]);
    const sparse = await sparseFixture(service, {
      id: "mixed",
      items: ["same", "changed", "new"],
      changed: ["changed"],
    });
    await sparse.complete();
    const rows = await service.comparisonRows("comparison-mixed");
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.reference_capture_id === null)).toBe(true);
    const changed = rows.find((row) => row.item_key === "changed");
    expect(changed?.decision_id).toBeNull();
    expect(rows.find((row) => row.item_key === "new")?.decision_id).toMatch(/^automatic:/u);
    expect(rows.find((row) => row.item_key === "removed")?.decision_id).toMatch(/^automatic:/u);
    expect((await service.status("mixed")).pending).toBe(1);
    expect(
      database.connection
        .prepare("SELECT count(*) AS count FROM visonaut_captures WHERE run_id='mixed'")
        .get()?.count,
    ).toBe(2);
    await review(service, "comparison-mixed");
    expect((await service.status("mixed")).status).toBe("passed");
  });

  it("rejects incomplete unchanged coverage and lost removals before sealing or comparison visibility", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service, ["one", "two"]);
    const sparse = await sparseFixture(service, { id: "partial", items: ["one", "two"] });
    await expect(
      service.commitShard({
        ...sparse.commit,
        captures: sparse.commit.captures.slice(0, 1),
        inventory: { ...sparse.inventory, captureCount: 1 },
      }),
    ).rejects.toBeInstanceOf(IncompleteError);
    await expect(service.sealRun({ runId: "partial", now: 22 })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await service.run("partial")).inventory_key).toBeNull();
    const removed = await sparseFixture(service, { id: "lost-removal", items: ["one"] });
    await service.commitShard(removed.commit);
    await service.sealRun({ runId: "lost-removal", now: 22 });
    await expect(
      service.createComparison({
        ...removed.comparisonInput,
        localComparison: { ...removed.comparisonInput.localComparison, removals: [] },
      }),
    ).rejects.toBeInstanceOf(IncompleteError);
    expect((await service.run("lost-removal")).comparison_id).toBeNull();
    const hiddenChange = await sparseFixture(service, {
      id: "hidden-change",
      items: ["one", "two"],
      changed: ["one"],
    });
    await service.commitShard(hiddenChange.commit);
    await service.sealRun({ runId: "hidden-change", now: 22 });
    await expect(
      service.createComparison({
        ...hiddenChange.comparisonInput,
        localComparison: {
          ...hiddenChange.comparisonInput.localComparison,
          captures: hiddenChange.comparisonInput.localComparison.captures.map((result) => ({
            ...result,
            outcome: "unchanged",
            changedPixels: 0,
            ratio: 0,
          })),
        },
      }),
    ).rejects.toBeInstanceOf(IncompleteError);
    expect((await service.run("hidden-change")).comparison_id).toBeNull();
  });

  it("rejects an expired image owner even when there are no changed captures to check", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    const sparse = await sparseFixture(service, { id: "expired-owner", items: ["dialog"] });
    database.connection.prepare("DELETE FROM work_retention_pins WHERE run_id='seed'").run();
    database.connection
      .prepare("UPDATE work_retained_runs SET byte_state='deleting' WHERE id='seed'")
      .run();
    await expect(service.commitShard(sparse.commit)).rejects.toBeInstanceOf(ConflictError);
    expect((await service.run("expired-owner")).inventory_key).toBeNull();
  });

  it("rolls back stale sparse promotion headers and keeps copied approvals target-owned", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    const first = await sparseFixture(service, {
      id: "first",
      items: ["dialog"],
      changed: ["dialog"],
      kind: "pull_request",
    });
    await first.complete();
    await review(service, "comparison-first");
    const second = await sparseFixture(service, {
      id: "second",
      items: ["dialog"],
      changed: ["dialog"],
      kind: "pull_request",
      related: ["first"],
    });
    await second.complete();
    expect((await service.status("second")).status).toBe("passed");
    const target = (await service.comparisonRows("comparison-second"))[0];
    expect(target?.decision_id).toMatch(/^copied:/u);
    await review(service, "comparison-first", { verdict: "rejected" });
    expect((await service.status("second")).status).toBe("passed");
    const main = await sparseFixture(service, { id: "stale", items: ["dialog"] });
    await main.complete();
    database.beforeBatch = () => {
      database.connection
        .prepare("UPDATE visonaut_projects SET revision=revision+1 WHERE id='project'")
        .run();
    };
    await expect(
      service.preparePromotion({
        snapshotId: "snapshot-stale",
        comparisonId: "comparison-stale",
        prefix: "baselines/stale",
        inventory: main.inventory,
        imageRunIds: main.owners,
        now: 30,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      database.connection
        .prepare("SELECT id FROM visonaut_snapshots WHERE id='snapshot-stale'")
        .get(),
    ).toBeUndefined();
  });
});

describe("pre-created App check adoption", () => {
  it("adopts the exact check atomically and preserves the old run when its successor is stale", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    const testedSha = "a".repeat(40);
    const baseSha = "b".repeat(40);
    const insertStage = (id: string, attempt: number) => {
      database.connection
        .prepare(
          "INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,workflow_attempt,tested_sha,workflow_source_digest,caller_workflow_path,reusable_workflow_ref,capture_job_prefix,submit_job_name,verified_json,submitted_at,created_at) VALUES (?,'123','77',?,?,'source','.github/workflows/visual.yml','ariakit/ariakit/.github/workflows/capture.yml@pinned','capture / ','submit','{}',1,0)",
        )
        .run(id, attempt, testedSha);
    };
    const insertCheck = (generation: number, attempt: number, checkId: string) => {
      const externalId = `visonaut:pre:${testedSha}${generation ? `:${generation}` : ""}`;
      database.connection
        .prepare(
          "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,docs_only,external_id,check_id,state,workflow_run_id,workflow_attempt,created_at,updated_at) VALUES (?,?,?,?,?,'main','refs/heads/main',0,?,?,'active','77',?,0,0)",
        )
        .run(testedSha, generation, "123", testedSha, baseSha, externalId, checkId, attempt);
      return {
        repositoryId: "123",
        testedSha,
        workflowRunId: "77",
        workflowAttempt: attempt,
        externalId,
        checkId,
      };
    };
    const plan = {
      digest: "plan",
      shards: [
        {
          key: "chromium",
          profileDigest: "profile",
          tests: ["test"],
          captures: [{ itemKey: "dialog", variantKey: "light", testId: "test" }],
        },
      ],
    };
    const input = {
      id: "first",
      projectId: "project",
      externalRunId: "77",
      attempt: 1,
      kind: "main" as const,
      testedSha,
      lineageKey: "main",
      plan,
      verifiedRelatedRunIds: [],
      verifiedAncestorShas: [],
      verificationDigest: "verified-github-proof",
      rerunShardKeys: ["chromium"],
      precreatedCheck: insertCheck(0, 1, "999"),
      now: 1,
    };
    insertStage("first", 1);
    const first = await service.reserveRun(input);
    expect(await service.reserveRun({ ...input, id: "replayed" })).toEqual(first);
    expect(
      database.connection
        .prepare(
          "SELECT external_id,check_id,state FROM operations_check_creations WHERE run_id='first'",
        )
        .get(),
    ).toEqual({
      external_id: input.precreatedCheck.externalId,
      check_id: "999",
      state: "complete",
    });
    insertStage("second", 2);
    const successor = insertCheck(1, 2, "1000");
    database.beforeBatch = () => {
      database.connection
        .prepare("UPDATE pre_run_checks SET state='failed' WHERE external_id=?")
        .run(successor.externalId);
    };
    await expect(
      service.reserveRun({ ...input, id: "second", attempt: 2, precreatedCheck: successor }),
    ).rejects.toThrow();
    expect(count(database, "visonaut_runs")).toBe(1);
    expect(count(database, "operations_check_creations")).toBe(1);
    expect((await service.run("first")).active).toBe(1);
    database.connection
      .prepare("UPDATE pre_run_checks SET state='active' WHERE external_id=?")
      .run(successor.externalId);
    database.beforeBatch = () => {
      database.connection
        .prepare("UPDATE ingest_staged_runs SET retention_state='deleting' WHERE id='second'")
        .run();
    };
    await expect(
      service.reserveRun({ ...input, id: "second", attempt: 2, precreatedCheck: successor }),
    ).rejects.toThrow();
    expect(count(database, "visonaut_runs")).toBe(1);
    expect((await service.run("first")).active).toBe(1);
  });
});

describe("rejection of inherited acceptance", () => {
  it("keeps a copied main approval independent of a later source rejection", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "original", kind: "pull_request", lineage: "pr-1", color: "red" });
    await review(service, "comparison-original");
    await fixture(service, {
      id: "retry",
      kind: "pull_request",
      lineage: "pr-1",
      color: "red",
      related: ["original"],
    });
    await fixture(service, { id: "merged", color: "red", related: ["original", "retry"] });
    expect((await service.status("merged")).status).toBe("passed");
    const rejection = await review(service, "comparison-retry", { verdict: "rejected" });
    expect((await service.status("merged")).status).toBe("passed");
    expect((await service.project("project")).snapshot_id).toBe("snapshot-seed");
    await service.undo({
      commandId: rejection.commandId,
      undoCommandId: "undo-retry-rejection",
      actorId: "maintainer-1",
      sessionId: "session",
      expectedBaselineRevision: 1,
      now: 9,
    });
    expect((await service.status("merged")).status).toBe("passed");
    await promote(service, "merged");
    expect((await service.project("project")).snapshot_id).toBe("snapshot-merged");
  });

  it.each([
    ["another reviewer", "maintainer-2"],
    ["the reviewer who approved", "maintainer-1"],
  ])("makes no new copy after %s rejects the copied approval", async (_name, actorId) => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await timedRun(service, { id: "first", finalizedAt: 10 });
    await review(service, "comparison-first", { now: 11 });
    await timedRun(service, { id: "second", related: ["first"], finalizedAt: 20 });
    expect(await copiedSource(service, "second")).toBe(await currentDecision(service, "first"));
    await review(service, "comparison-second", { verdict: "rejected", actorId, now: 21 });
    const decisions = count(database, "visonaut_decisions");
    await timedRun(service, { id: "third", related: ["first", "second"], finalizedAt: 30 });
    expect((await service.status("third")).status).toBe("needs-review");
    expect(await currentDecision(service, "third")).toBeNull();
    // The rule only stops a new copy. It writes no decision and changes no run.
    expect(count(database, "visonaut_decisions")).toBe(decisions);
    expect((await service.status("first")).status).toBe("passed");
    expect((await service.status("second")).status).toBe("rejected");
    await timedRun(service, {
      id: "merged",
      kind: "main",
      lineage: "main",
      related: ["first", "second", "third"],
      finalizedAt: 40,
    });
    expect((await service.status("merged")).status).toBe("needs-review");
  });

  it("makes no new copy in a later comparison of the run that has the Reject", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await timedRun(service, { id: "first", finalizedAt: 10 });
    await review(service, "comparison-first", { now: 11 });
    await timedRun(service, { id: "second", related: ["first"], finalizedAt: 20 });
    await review(service, "comparison-second", { verdict: "rejected", now: 21 });
    // No service path compares a reviewed run again. This seeded comparison
    // covers a Reject in the target run, which needs no lineage row.
    const project = await service.project("project");
    await seedComparison(service, {
      id: "comparison-second-again",
      runId: "second",
      referenceSnapshotId: project.snapshot_id,
    });
    await service.finalizeComparison({ comparisonId: "comparison-second-again", now: 30 });
    const rows = await service.comparisonRows("comparison-second-again");
    expect(rows.map((row) => row.decision_id)).toEqual([null]);
    expect((await service.status("second")).status).toBe("needs-review");
  });

  it("copies again from a first-hand approval that is newer than the Reject", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await timedRun(service, { id: "first", finalizedAt: 10 });
    await review(service, "comparison-first", { now: 11 });
    await timedRun(service, { id: "second", related: ["first"], finalizedAt: 20 });
    await review(service, "comparison-second", { verdict: "rejected", now: 21 });
    await timedRun(service, { id: "third", related: ["first", "second"], finalizedAt: 30 });
    expect((await service.status("third")).status).toBe("needs-review");
    await review(service, "comparison-third", { actorId: "maintainer-2", now: 31 });
    await timedRun(service, {
      id: "fourth",
      related: ["first", "second", "third"],
      finalizedAt: 40,
    });
    expect((await service.status("fourth")).status).toBe("passed");
    expect(await copiedSource(service, "fourth")).toBe(await currentDecision(service, "third"));
  });

  it("copies again after Undo of the Reject", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await timedRun(service, { id: "first", finalizedAt: 10 });
    await review(service, "comparison-first", { now: 11 });
    await timedRun(service, { id: "second", related: ["first"], finalizedAt: 20 });
    const rejection = await review(service, "comparison-second", { verdict: "rejected", now: 21 });
    await service.undo({
      commandId: rejection.commandId,
      undoCommandId: "undo-second-rejection",
      actorId: "maintainer-1",
      sessionId: "session",
      expectedBaselineRevision: 1,
      now: 22,
    });
    await timedRun(service, { id: "third", related: ["first", "second"], finalizedAt: 30 });
    expect((await service.status("third")).status).toBe("passed");
    expect(await copiedSource(service, "third")).toBe(await currentDecision(service, "first"));
  });

  it.each([
    ["after", 25],
    ["at the same time as", 20],
  ])("makes no new copy when Undo restores the Reject %s the approval", async (_name, undoneAt) => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await timedRun(service, { id: "first", finalizedAt: 10 });
    await review(service, "comparison-first", { verdict: "rejected", now: 11 });
    await timedRun(service, { id: "second", related: ["first"], finalizedAt: 12 });
    const approval = await review(service, "comparison-first", { now: 15 });
    await review(service, "comparison-second", { actorId: "maintainer-2", now: 20 });
    // The restored Reject keeps its first time, which is older than the approval.
    await service.undo({
      commandId: approval.commandId,
      undoCommandId: "undo-first-approval",
      actorId: "maintainer-1",
      sessionId: "session",
      expectedBaselineRevision: 1,
      now: undoneAt,
    });
    expect((await service.status("first")).status).toBe("rejected");
    await timedRun(service, { id: "third", related: ["first", "second"], finalizedAt: 30 });
    expect((await service.status("third")).status).toBe("needs-review");
    await review(service, "comparison-third", { now: 31 });
    await timedRun(service, {
      id: "fourth",
      related: ["first", "second", "third"],
      finalizedAt: 40,
    });
    expect(await copiedSource(service, "fourth")).toBe(await currentDecision(service, "third"));
  });

  it("copies an approval that is newer than the Reject after Undo in another row", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await timedRun(service, { id: "first", finalizedAt: 10 });
    await review(service, "comparison-first", { verdict: "rejected", now: 11 });
    await timedRun(service, { id: "second", related: ["first"], finalizedAt: 20 });
    await review(service, "comparison-second", { now: 21 });
    await timedRun(service, { id: "other", color: "green", finalizedAt: 22 });
    const otherApproval = await review(service, "comparison-other", { now: 23 });
    await service.undo({
      commandId: otherApproval.commandId,
      undoCommandId: "undo-other-approval",
      actorId: "maintainer-1",
      sessionId: "session",
      expectedBaselineRevision: 1,
      now: 25,
    });
    await timedRun(service, { id: "third", related: ["first", "second"], finalizedAt: 30 });
    expect(await copiedSource(service, "third")).toBe(await currentDecision(service, "second"));
  });

  it.each([
    ["other pixels of the same item", { color: "green" }],
    ["the same pixels with another rendering profile", { captureProfileDigest: "other-profile" }],
  ])("copies after a Reject of %s", async (_name, otherTuple) => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await timedRun(service, { id: "first", finalizedAt: 10 });
    await review(service, "comparison-first", { now: 11 });
    await timedRun(service, { id: "second", related: ["first"], finalizedAt: 20, ...otherTuple });
    expect((await service.status("second")).status).toBe("needs-review");
    await review(service, "comparison-second", { verdict: "rejected", now: 21 });
    await timedRun(service, { id: "third", related: ["first", "second"], finalizedAt: 30 });
    expect((await service.status("third")).status).toBe("passed");
    expect(await copiedSource(service, "third")).toBe(await currentDecision(service, "first"));
  });

  it("copies an approval that is newer than the Reject", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await timedRun(service, { id: "first", finalizedAt: 10 });
    await review(service, "comparison-first", { verdict: "rejected", now: 11 });
    await timedRun(service, { id: "second", related: ["first"], finalizedAt: 20 });
    expect((await service.status("second")).status).toBe("needs-review");
    await review(service, "comparison-second", { now: 21 });
    await timedRun(service, { id: "third", related: ["first", "second"], finalizedAt: 30 });
    expect((await service.status("third")).status).toBe("passed");
    expect(await copiedSource(service, "third")).toBe(await currentDecision(service, "second"));
  });

  it("makes no copy when the Reject and the approval have the same time", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await timedRun(service, { id: "first", finalizedAt: 10 });
    await timedRun(service, { id: "second", related: ["first"], finalizedAt: 20 });
    await review(service, "comparison-first", { verdict: "rejected", now: 21 });
    await review(service, "comparison-second", { now: 21 });
    await timedRun(service, { id: "third", related: ["first", "second"], finalizedAt: 30 });
    expect((await service.status("third")).status).toBe("needs-review");
  });

  it("does not count a copy that is newer than the Reject as a first-hand approval", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await timedRun(service, { id: "first", finalizedAt: 10 });
    await review(service, "comparison-first", { now: 11 });
    await timedRun(service, { id: "left", related: ["first"], finalizedAt: 20 });
    await review(service, "comparison-left", { verdict: "rejected", now: 21 });
    // The Reject is outside this lineage, so this run gets a copy after it.
    await timedRun(service, { id: "right", related: ["first"], finalizedAt: 30 });
    expect(await copiedSource(service, "right")).toBe(await currentDecision(service, "first"));
    await timedRun(service, { id: "joined", related: ["first", "left", "right"], finalizedAt: 40 });
    expect((await service.status("joined")).status).toBe("needs-review");
  });

  it("does not count a newer automatic acceptance as a first-hand approval", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    // No baseline exists, so each independent lineage accepts the new item.
    await setup(service);
    await timedRun(service, { id: "first", finalizedAt: 10 });
    await review(service, "comparison-first", { verdict: "rejected", now: 11 });
    await timedRun(service, { id: "other", lineage: "pr-2", finalizedAt: 20 });
    expect(await currentDecision(service, "other")).toMatch(/^automatic:/u);
    await timedRun(service, {
      id: "joined",
      lineage: "pr-3",
      related: ["first", "other"],
      finalizedAt: 30,
    });
    expect((await service.status("joined")).status).toBe("needs-review");
  });
});

describe("full run and immutable comparison state", () => {
  it("rejects server comparison creation without changing retained results or creating work", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, { id: "legacy" });
    const rows = await service.comparisonRows("comparison-legacy");
    const tasks = database.connection.prepare("SELECT * FROM work_tasks ORDER BY id").all();
    const legacyRequest = {
      id: "retired-server",
      runId: "legacy",
      referenceSnapshotId: null,
      now: 10,
      localComparison: undefined,
      maxAttempts: 5,
    };
    await expect(
      // @ts-expect-error The retired server call has no local receipt.
      service.createComparison(legacyRequest),
    ).rejects.toThrow("A verified local Submit receipt is required");
    expect(await service.comparisonRows("comparison-legacy")).toEqual(rows);
    expect(database.connection.prepare("SELECT * FROM work_tasks ORDER BY id").all()).toEqual(
      tasks,
    );
    expect(
      database.connection
        .prepare("SELECT id FROM visonaut_comparisons WHERE id='retired-server'")
        .get(),
    ).toBeUndefined();
  });
  it("logs the first comparison's seal-to-ready timing only once", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const now = vi.spyOn(Date, "now").mockReturnValue(6);
    try {
      const comparisonId = await fixture(service, { id: "timed", finalize: false });
      expect(
        (await service.finalizeComparison({ comparisonId, now: 7 })).reviewReadyTransitioned,
      ).toBe(true);
      expect(
        (await service.finalizeComparison({ comparisonId, now: 8 })).reviewReadyTransitioned,
      ).toBe(false);
      expect(info).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
        event: "comparison_ready_timing",
        runId: "timed",
        comparisonId,
        runKind: "main",
        sealToComparisonMs: 1,
        comparisonToReadyMs: 2,
        sealToReadyMs: 3,
      });
    } finally {
      now.mockRestore();
      info.mockRestore();
    }
  });

  it("registers a page with bounded D1 work and rolls back conflicting originals", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await service.reserveRun({
      id: "batch",
      projectId: "project",
      externalRunId: "batch",
      attempt: 1,
      kind: "main",
      testedSha: "batch-sha",
      lineageKey: "main",
      plan: {
        digest: "batch-plan",
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
      verificationDigest: "verified-github-proof",
      rerunShardKeys: ["chromium"],
      now: 1,
    });
    const originals: ValidatedImage[] = Array.from({ length: 50 }, (_, index) => ({
      id: `image-${index}`,
      runId: "batch",
      digest: `digest-${index}`,
      objectKey: `runs/batch/images/image-${index}`,
      contentType: "image/png",
      bytes: 80,
      width: 10,
      height: 10,
    }));
    const before = database.preparedQueries;
    const batchesBefore = database.batchCalls;
    await service.registerImages(originals);
    expect(database.preparedQueries - before).toBeLessThanOrEqual(7);
    expect(database.batchCalls - batchesBefore).toBe(1);
    expect(count(database, "visonaut_images")).toBe(50);

    await service.registerImages(originals);
    expect(count(database, "visonaut_images")).toBe(50);
    const first = originals[0];
    if (!first) {
      throw new Error("Expected an original image.");
    }
    await expect(
      service.registerImages([
        { ...first, id: "new", objectKey: "runs/batch/images/new" },
        { ...first, digest: "conflicting-digest" },
      ]),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(count(database, "visonaut_images")).toBe(50);
    await expect(service.registerImages([...originals, first])).rejects.toBeInstanceOf(
      IncompleteError,
    );

    database.beforeBatch = () => {
      database.connection.prepare("UPDATE visonaut_runs SET active = 0 WHERE id = 'batch'").run();
    };
    await expect(
      service.registerImages([{ ...first, id: "late", objectKey: "runs/batch/images/late" }]),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(count(database, "visonaut_images")).toBe(50);
  });

  it.each([true, false])(
    "migrates zero-pixel changes (finalized: %s) and preserves review history",
    async (finalized) => {
      using database = new TestDatabase("0028_pr_title_index");
      const service = new Service(database);
      await seed(service);
      for (const id of ["pending", "rejected", "closed", "pixels"]) {
        await fixture(service, {
          id,
          kind: "pull_request",
          finalize: id === "pending" ? finalized : true,
          captureProfileDigest: "new-profile",
          compare: () => ({
            outcome: "changed",
            changedPixels: id === "pixels" ? 1 : 0,
            ratio: id === "pixels" ? 0.01 : 0,
            engineVersion: "engine",
            codecVersion: "codec",
            maskExpected: false,
          }),
        });
      }
      await review(service, "comparison-rejected", { verdict: "rejected" });
      await service.retireRun({ runId: "closed", now: 20 });
      const before = await service.run("pending");
      const rowsBefore = await service.comparisonRows("comparison-pending");
      const projectBefore = await service.project("project");
      database.connection.exec(
        readFileSync(
          new URL("../../../apps/web/migrations/0029_zero_pixel_reviews.sql", import.meta.url),
          "utf8",
        ),
      );
      const rows = await service.comparisonRows("comparison-pending");
      expect(rows[0]).toMatchObject({
        outcome: "unchanged",
        decision_revision: (rowsBefore[0]?.decision_revision ?? 0) + 1,
      });
      expect(JSON.parse(rows[0]?.result_json ?? "{}")).toMatchObject({
        outcome: "unchanged",
        changedPixels: 0,
      });
      expect((await service.run("pending")).revision).toBe(before.revision + 1);
      expect((await service.project("project")).revision).toBe(projectBefore.revision + 1);
      expect(
        database.connection
          .prepare("SELECT run_revision FROM visonaut_status_outbox WHERE id LIKE 'zero-pixels:%'")
          .all(),
      ).toEqual([{ run_revision: before.revision + 1 }]);
      if (!finalized) {
        await service.finalizeComparison({ comparisonId: "comparison-pending", now: 21 });
      }
      expect((await service.status("pending")).status).toBe("passed");
      for (const id of ["rejected", "closed", "pixels"]) {
        expect((await service.comparisonRows(`comparison-${id}`))[0]?.outcome).toBe("changed");
      }
      expect((await service.status("rejected")).status).toBe("rejected");
      expect((await service.status("pixels")).status).toBe("needs-review");
      expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    },
  );

  it.each([true, false])(
    "migrates only unreviewed local zero-pixel rows (finalized: %s)",
    async (finalized) => {
      using database = new TestDatabase("0029_zero_pixel_reviews");
      const service = new Service(database);
      await seed(service);
      const excluded = [
        "approved",
        "rejected",
        "revoked",
        "inherited",
        "promoted",
        "closed",
        "pixels",
        "dimensions",
        "mask",
        "mask-image",
        "ratio",
        "server",
        "added",
        "removed",
      ];
      for (const id of ["pending", ...excluded]) {
        await fixture(service, {
          id,
          kind: "pull_request",
          finalize: id === "pending" ? finalized : !["added", "removed"].includes(id),
          items: id === "added" ? ["new-dialog"] : id === "removed" ? ["other"] : ["dialog"],
          compare: () => ({
            outcome: "changed",
            changedPixels: id === "pixels" ? 1 : 0,
            ratio: id === "pixels" || id === "ratio" ? 0.01 : 0,
            engineVersion: "playwright-pixelmatch-1.63.0",
            codecVersion: "pngjs-7.0.0",
            maskExpected: id === "mask",
          }),
        });
        if (id !== "server") {
          database.connection
            .prepare(
              "UPDATE visonaut_captures SET metadata_json=json_set(metadata_json,'$.localMode','local-v1') WHERE run_id=?",
            )
            .run(id);
        }
      }
      // The legacy profile was normalized before the local outcome was imported.
      database.connection
        .prepare(
          "UPDATE visonaut_comparison_rows SET tuple_json=json_set(tuple_json,'$.referenceProfileDigest',?,'$.candidateProfileDigest',?) WHERE comparison_id='comparison-pending'",
        )
        .run("c".repeat(64), "c".repeat(64));
      for (const id of ["approved", "rejected", "revoked"]) {
        await review(service, `comparison-${id}`, {
          verdict: id === "rejected" ? "rejected" : "approved",
        });
      }
      database.connection.exec(`
        UPDATE visonaut_decisions SET revoked=1 WHERE row_id IN(SELECT id FROM visonaut_comparison_rows WHERE comparison_id='comparison-revoked');
        UPDATE visonaut_comparison_rows SET decision_id=NULL WHERE comparison_id='comparison-revoked';
        UPDATE visonaut_comparison_rows SET source_decision_id=(SELECT decision_id FROM visonaut_comparison_rows WHERE comparison_id='comparison-approved') WHERE comparison_id='comparison-inherited';
        UPDATE visonaut_images SET width=11 WHERE run_id='dimensions';
        UPDATE visonaut_comparison_rows SET result_json=json_set(result_json,'$.maskImageId','stored-mask') WHERE comparison_id='comparison-mask-image';
        INSERT INTO visonaut_promotions(id,project_id,snapshot_id,comparison_id,baseline_revision,created_at)
          VALUES('guard-promotion','project','snapshot-seed','comparison-promoted',1,20);
      `);
      await service.retireRun({ runId: "closed", now: 20 });
      await service.prepareStatusIntent({
        runId: "pending",
        checkId: "local-zero-check",
        detailsUrl: "https://visonaut.example/runs/pending",
        maxAttempts: 3,
        now: 20,
      });
      const before = await service.run("pending");
      const projectBefore = await service.project("project");
      const rowBefore = (await service.comparisonRows("comparison-pending"))[0];
      const savedRows = await Promise.all(
        excluded.map((id) => service.comparisonRows(`comparison-${id}`)),
      );
      const decisions = database.connection
        .prepare("SELECT * FROM visonaut_decisions ORDER BY id")
        .all();
      const promotions = database.connection
        .prepare("SELECT * FROM visonaut_promotions ORDER BY id")
        .all();
      const migration = readFileSync(
        new URL("../../../apps/web/migrations/0030_local_zero_pixel_reviews.sql", import.meta.url),
        "utf8",
      );
      database.connection.exec(migration);
      const rows = await service.comparisonRows("comparison-pending");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        outcome: "unchanged",
        decision_revision: (rowBefore?.decision_revision ?? 0) + 1,
      });
      expect(JSON.parse(rows[0]?.result_json ?? "{}")).toMatchObject({
        outcome: "unchanged",
        changedPixels: 0,
      });
      expect((await service.run("pending")).revision).toBe(before.revision + 1);
      expect((await service.project("project")).revision).toBe(projectBefore.revision + 1);
      expect(
        database.connection
          .prepare("SELECT desired_revision FROM work_checks WHERE id='local-zero-check'")
          .get(),
      ).toEqual({ desired_revision: projectBefore.revision + 1 });
      expect(
        database.connection
          .prepare(
            "SELECT run_id,run_revision FROM visonaut_status_outbox WHERE id LIKE 'local-zero-pixels:%'",
          )
          .all(),
      ).toEqual([{ run_id: "pending", run_revision: before.revision + 1 }]);
      expect(
        await Promise.all(excluded.map((id) => service.comparisonRows(`comparison-${id}`))),
      ).toEqual(savedRows);
      expect(
        database.connection.prepare("SELECT * FROM visonaut_decisions ORDER BY id").all(),
      ).toEqual(decisions);
      expect(
        database.connection.prepare("SELECT * FROM visonaut_promotions ORDER BY id").all(),
      ).toEqual(promotions);
      database.connection.exec(migration);
      expect(await service.comparisonRows("comparison-pending")).toEqual(rows);
      expect((await service.run("pending")).revision).toBe(before.revision + 1);
      expect((await service.project("project")).revision).toBe(projectBefore.revision + 1);
      expect(
        database.connection
          .prepare(
            "SELECT count(*) AS count FROM visonaut_status_outbox WHERE id LIKE 'local-zero-pixels:%'",
          )
          .get(),
      ).toEqual({ count: 1 });
      if (!finalized) {
        await service.finalizeComparison({ comparisonId: "comparison-pending", now: 21 });
      }
      expect((await service.status("pending")).status).toBe("passed");
      expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    },
  );

  it("keeps saved policy and rendering identities in retained comparison results", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    const oldPolicy = {
      id: "visible-exact-v1",
      channelThreshold: 0,
      maxChangedPixels: 0,
      maxChangedRatio: 0,
    };
    const oldPolicyDigest = await digestJson(oldPolicy);
    const newPolicyDigest = await digestJson(selectedComparisonPolicy);
    expect(newPolicyDigest).toBe(
      "6a97812c0ad3a5e8e006904995e75f8f15671260fb2ee53d31a1527c7d990fd1",
    );
    await service.createPolicy({ digest: oldPolicyDigest, policy: oldPolicy });
    await service.createPolicy({ digest: newPolicyDigest, policy: selectedComparisonPolicy });
    await service.createProject({
      id: "project",
      repositoryId: "123",
      policyDigest: oldPolicyDigest,
    });
    const profile: CaptureProfile = {
      browser: "chromium",
      browserVersion: "1",
      osImageDigest: "a".repeat(64),
      fontsDigest: "b".repeat(64),
      viewport: { width: 498, height: 360 },
      deviceScaleFactor: 1,
      locale: "en-US",
      timezone: "UTC",
      reducedMotion: "no-preference",
      colorScheme: "light",
      contrast: "no-preference",
      forcedColors: "none",
      animationPolicy: "disabled",
      captureOptions: { type: "png", fullPage: false },
      comparisonPolicyDigest: oldPolicyDigest,
      comparisonEngineVersion: "rgba-visible-1",
    };
    const storeProfile = async (record: CaptureProfile) => {
      const digest = await digestJson(record);
      database.connection
        .prepare("INSERT INTO visonaut_capture_profiles(digest,profile_json) VALUES(?,?)")
        .run(digest, canonicalJson(record));
      return digest;
    };
    const oldProfileDigest = await storeProfile(profile);
    const newProfileDigest = await storeProfile({
      ...profile,
      comparisonPolicyDigest: newPolicyDigest,
    });
    const changedProfileDigest = await storeProfile({
      ...profile,
      fontsDigest: "c".repeat(64),
      comparisonPolicyDigest: newPolicyDigest,
    });
    const stalePolicyProfileDigest = await storeProfile({
      ...profile,
      comparisonPolicyDigest: "d".repeat(64),
    });
    await fixture(service, {
      id: "seed",
      items: ["dialog", "menu"],
      realDigest: true,
      captureProfileDigest: oldProfileDigest,
    });
    await promote(service, "seed");

    database.connection
      .prepare(
        "UPDATE visonaut_projects SET policy_digest = ?, revision = revision + 1 WHERE id = 'project'",
      )
      .run(newPolicyDigest);
    const unchanged = () => ({
      outcome: "unchanged" as const,
      changedPixels: 0,
      ratio: 0,
      engineVersion: "rgba-visible-1",
      codecVersion: "codec",
    });
    await fixture(service, {
      id: "policy-only",
      kind: "pull_request",
      items: ["dialog", "menu"],
      realDigest: true,
      captureProfileDigest: newProfileDigest,
      compare: unchanged,
    });
    const policyOnlyRows = await service.comparisonRows("comparison-policy-only");
    expect(policyOnlyRows.map((row) => row.outcome)).toEqual(["unchanged", "unchanged"]);
    expect((await service.status("policy-only")).status).toBe("passed");
    expect((await service.comparison("comparison-seed")).policy_digest).toBe(oldPolicyDigest);
    expect((await service.comparison("comparison-policy-only")).policy_digest).toBe(
      newPolicyDigest,
    );

    await fixture(service, {
      id: "policy-and-content-change",
      kind: "pull_request",
      items: ["dialog", "menu"],
      realDigest: true,
      color: "red",
      captureProfileDigest: newProfileDigest,
    });
    expect(
      (await service.comparisonRows("comparison-policy-and-content-change")).map(
        (row) => row.outcome,
      ),
    ).toEqual(["changed", "changed"]);

    for (const [id, profileDigest] of [
      ["rendering-change", changedProfileDigest],
      ["stale-policy", stalePolicyProfileDigest],
      ["stale-policy-same-profile", oldProfileDigest],
    ] as const) {
      await fixture(service, {
        id,
        kind: "pull_request",
        items: ["dialog", "menu"],
        realDigest: true,
        captureProfileDigest: profileDigest,
        compare: unchanged,
      });
      expect((await service.comparisonRows(`comparison-${id}`)).map((row) => row.outcome)).toEqual([
        "unchanged",
        "unchanged",
      ]);
      expect((await service.status(id)).status).toBe("passed");
    }
  });

  it("seeds a fresh full main baseline automatically and keeps candidate bytes", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    expect((await service.project("project")).snapshot_id).toBe("snapshot-seed");
    expect((await service.status("seed")).status).toBe("passed");
    expect(
      database.connection.prepare("SELECT kind, actor_id FROM visonaut_decisions").get(),
    ).toMatchObject({ kind: "automatic", actor_id: null });
  });

  it("keeps separate PR reviews on their pinned baseline after main advances", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    const first = await fixture(service, { id: "first-pr", kind: "pull_request" });
    const second = await fixture(service, {
      id: "second-pr",
      kind: "pull_request",
      finalize: false,
    });
    const approval = await review(service, first);
    const intent = {
      runId: "first-pr",
      checkId: "pr-check",
      detailsUrl: "https://visonaut.example/runs/first-pr",
      maxAttempts: 3,
      now: 8,
    };
    expect((await service.prepareStatusIntent(intent)).conclusion).toBe("success");
    const delivery = await claimStatus(database, {
      id: "pr-check",
      token: "lease",
      now: 9,
      leaseMs: 100,
    });
    if (!delivery) throw new Error("Missing queued success");
    expect(await service.isStatusIntentCurrent(delivery)).toBe(true);
    await fixture(service, {
      id: "next-main",
      compare: () => ({
        outcome: "unchanged",
        changedPixels: 0,
        ratio: 0,
        engineVersion: "engine",
        codecVersion: "codec",
      }),
    });
    await promote(service, "next-main");

    expect(await service.comparison(first)).toMatchObject({
      state: "ready",
      reference_snapshot_id: "snapshot-seed",
      baseline_revision: 1,
    });
    expect((await service.status("first-pr")).status).toBe("passed");
    expect(await service.isStatusIntentCurrent(delivery)).toBe(false);
    expect((await service.prepareStatusIntent({ ...intent, now: 12 })).conclusion).toBe("success");
    expect((await service.run("first-pr")).tested_sha).toBe("sha-first-pr");
    await service.finalizeComparison({ comparisonId: second, now: 12 });
    expect((await service.status("second-pr")).status).toBe("needs-review");
    await review(service, second);
    expect((await service.status("second-pr")).status).toBe("passed");
    await service.undo({
      commandId: approval.commandId,
      undoCommandId: "undo-frozen-pr",
      actorId: "maintainer-1",
      sessionId: "session",
      expectedBaselineRevision: approval.baselineRevision,
      now: 12,
    });
    expect((await service.status("first-pr")).status).toBe("needs-review");
    expect((await review(service, first)).baselineRevision).toBe(2);
    await expect(
      service.preparePromotion({
        snapshotId: "cannot-promote-pr",
        comparisonId: first,
        prefix: "baselines/pr",
        now: 12,
      }),
    ).rejects.toThrow("Only a complete main run");
  });

  it("promotes tolerated candidate bytes as the next comparison baseline", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    const policy = {
      id: "one-channel-unit",
      channelThreshold: 1,
      maxChangedPixels: 0,
      maxChangedRatio: 0,
    };
    await service.createPolicy({ digest: "policy", policy });
    await service.createProject({ id: "project", repositoryId: "123", policyDigest: "policy" });
    const pixels = (red: number) => ({
      width: 10,
      height: 10,
      data: new Uint8ClampedArray(Array.from({ length: 100 }, () => [red, 0, 0, 255]).flat()),
    });
    const original = pixels(0);
    const middle = pixels(1);
    const latest = pixels(2);
    const images = new Map([
      ["image-A-dialog", original],
      ["image-B-dialog", middle],
      ["image-C-dialog", latest],
    ]);
    expect(compareImages(original, latest, policy).outcome).toBe("changed");

    for (const [id, previous] of [
      ["A", null],
      ["B", "A"],
      ["C", "B"],
    ] as const) {
      await fixture(service, {
        id,
        color: id,
        compare(task) {
          expect(task.reference).toMatchObject({
            imageId: `image-${previous}-dialog`,
            objectKey: `runs/${previous}/dialog`,
            digest: `dialog-${previous}`,
          });
          expect(task.candidate?.imageId).toBe(`image-${id}-dialog`);
          const reference = images.get(task.reference?.imageId ?? "");
          const candidate = images.get(task.candidate?.imageId ?? "");
          if (!reference || !candidate) throw new Error("Missing comparison pixels.");
          const result = compareImages(reference, candidate, task.policy);
          expect(result.outcome).toBe("unchanged");
          return result;
        },
      });
      if (previous) {
        expect(await service.comparisonRows(`comparison-${id}`)).toMatchObject([
          { outcome: "unchanged" },
        ]);
      }
      expect((await service.status(id)).status).toBe("passed");
      await promote(service, id);
      expect((await service.project("project")).snapshot_id).toBe(`snapshot-${id}`);
      expect(await service.snapshotCopies(`snapshot-${id}`)).toMatchObject([
        {
          capture_id: `capture-${id}-dialog`,
          image_id: `image-${id}-dialog`,
          digest: `dialog-${id}`,
          source_object_key: `runs/${id}/dialog`,
          copied: 1,
        },
      ]);
    }
    expect((await service.project("project")).baseline_revision).toBe(3);
    expect(count(database, "visonaut_commands")).toBe(0);
  });

  it("refuses missing captures, exhausted test retries, and failed-attempt bytes", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await service.reserveRun({
      id: "run",
      projectId: "project",
      externalRunId: "run",
      attempt: 1,
      kind: "main",
      testedSha: "sha",
      lineageKey: "main",
      plan: {
        digest: "plan",
        shards: [
          {
            key: "shard",
            profileDigest: "profile",
            tests: ["test"],
            captures: [{ itemKey: "dialog", variantKey: "light", testId: "test" }],
          },
        ],
      },
      verifiedRelatedRunIds: [],
      verifiedAncestorShas: [],
      verificationDigest: "proof",
      rerunShardKeys: ["shard"],
      now: 1,
    });
    await expect(service.sealRun({ runId: "run", now: 2 })).rejects.toBeInstanceOf(ConflictError);
    await expect(
      service.commitShard({
        runId: "run",
        key: "shard",
        manifestDigest: "manifest",
        captures: [],
        finalTestOutcomes: [{ testId: "test", retry: 1, status: "failed" }],
        now: 2,
      }),
    ).rejects.toBeInstanceOf(IncompleteError);
    await service.registerImage({
      id: "image",
      runId: "run",
      digest: "digest",
      objectKey: "runs/run/image",
      contentType: "image/png",
      bytes: 80,
      width: 10,
      height: 10,
    });
    await expect(
      service.commitShard({
        runId: "run",
        key: "shard",
        manifestDigest: "manifest",
        captures: [
          {
            id: "capture",
            itemKey: "dialog",
            variantKey: "light",
            ordinal: 0,
            imageId: "image",
            profileDigest: "profile",
            environmentProfileDigest: "profile",
            testId: "test",
            testRetry: 0,
            metadata: {},
          },
        ],
        finalTestOutcomes: [{ testId: "test", retry: 1, status: "passed" }],
        now: 2,
      }),
    ).rejects.toThrow("final successful");
    expect(count(database, "visonaut_captures")).toBe(0);
  });

  it("rejects late uploads from a superseded attempt without revoking its acceptance", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, {
      id: "first",
      external: "workflow",
      kind: "pull_request",
      lineage: "pr-1",
    });
    await fixture(service, {
      id: "second",
      external: "workflow",
      attempt: 2,
      kind: "pull_request",
      lineage: "pr-1",
      related: ["first"],
    });
    await expect(
      service.registerImage({
        id: "late",
        runId: "first",
        digest: "late",
        objectKey: "late",
        contentType: "image/png",
        bytes: 1,
        width: 1,
        height: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await service.status("second")).status).toBe("passed");
  });

  it("requires all protected copies before promotion and rejects baseline drift", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, { id: "seed" });
    await service.preparePromotion({
      snapshotId: "snapshot",
      comparisonId: "comparison-seed",
      prefix: "baselines/seed",
      now: 10,
    });
    await expect(
      service.promote({
        snapshotId: "snapshot",
        promotionId: "promotion",
        expectedBaselineRevision: 0,
        now: 11,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await service.project("project")).snapshot_id).toBeNull();
    expect(count(database, "visonaut_promotions")).toBe(0);
  });
});

describe("exact acceptance and automatic reservations", () => {
  it("does not automatically reaccept changed addition bytes in the same lineage", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, { id: "blue", kind: "pull_request", lineage: "pr-1" });
    await fixture(service, {
      id: "green",
      kind: "pull_request",
      lineage: "pr-1",
      color: "green",
      related: ["blue"],
    });
    expect((await service.status("green")).status).toBe("needs-review");
    await fixture(service, {
      id: "independent",
      kind: "pull_request",
      lineage: "pr-2",
      color: "green",
    });
    expect((await service.status("independent")).status).toBe("passed");
  });

  it("reuses only exact acceptance from verified related runs", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    const queries = vi.spyOn(database, "prepare");
    await fixture(service, { id: "pr", kind: "pull_request", color: "red" });
    await review(service, "comparison-pr");
    await fixture(service, { id: "unrelated", kind: "pull_request", color: "red" });
    expect((await service.status("unrelated")).status).toBe("needs-review");
    await fixture(service, {
      id: "different-profile",
      kind: "pull_request",
      color: "red",
      captureProfileDigest: "different-profile",
      related: ["pr"],
    });
    expect((await service.status("different-profile")).status).toBe("needs-review");
    await fixture(service, { id: "merged", color: "red", related: ["pr"] });
    expect((await service.status("merged")).status).toBe("passed");
    const reused = await service.comparisonRows("comparison-merged");
    expect(reused[0]?.source_decision_id).toBeNull();
    expect(reused[0]?.decision_id).toBe(`copied:${reused[0]?.id}`);
    const copyQuery = queries.mock.calls.find(([sql]) => sql.includes("SELECT 'copied:'"))?.[0];
    if (!copyQuery) {
      throw new Error("Missing approval copy query");
    }
    const plan = database.connection
      .prepare(`EXPLAIN QUERY PLAN ${copyQuery}`)
      .all(0, "comparison-merged");
    // The approval and the Reject lookups both run for each changed row, so
    // each one must use all four columns of the index.
    for (const alias of ["decision", "rejection"]) {
      expect(plan.map((entry) => entry.detail)).toContain(
        `SEARCH ${alias} USING INDEX visonaut_decisions_pixels (<expr>=? AND <expr>=? AND revoked=? AND verdict=?)`,
      );
    }
  });

  it.each(["introduction", "removal"])(
    "reuses exact %s approval with a null image digest",
    async (kind) => {
      using database = new TestDatabase();
      const service = new Service(database);
      await seed(service, ["dialog", "menu"]);
      const items = kind === "introduction" ? ["dialog", "menu", "new"] : ["dialog"];
      await fixture(service, { id: "first", kind: "pull_request", lineage: "pr-1", items });
      await fixture(service, {
        id: "retry",
        kind: "pull_request",
        lineage: "pr-1",
        items,
        related: ["first"],
      });
      const rows = await service.comparisonRows("comparison-retry");
      const reused = rows.find(
        (row) => row.item_key === (kind === "introduction" ? "new" : "menu"),
      );
      if (!reused) {
        throw new Error("Missing copied approval row");
      }
      expect(reused.decision_id).toBe(`copied:${reused.id}`);
    },
  );

  it("keeps copied approval after source rejection and makes no new copy for descendants", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, { id: "first", kind: "pull_request", lineage: "pr-1" });
    await fixture(service, {
      id: "retry",
      kind: "pull_request",
      lineage: "pr-1",
      related: ["first"],
    });
    await review(service, "comparison-first", { verdict: "rejected" });
    expect((await service.status("retry")).status).toBe("passed");
    await fixture(service, {
      id: "retry-again",
      kind: "pull_request",
      lineage: "pr-1",
      related: ["first", "retry"],
    });
    expect((await service.status("retry")).status).toBe("passed");
    expect((await service.status("retry-again")).status).toBe("needs-review");
  });

  it("automatically accepts confirmed removal, keeps the Removed row, and protects promoted history", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service, ["dialog", "menu"]);
    await fixture(service, { id: "remove", items: ["dialog"] });
    const rows = await service.comparisonRows("comparison-remove");
    const kept = rows.find((row) => row.item_key === "dialog");
    const removed = rows.find((row) => row.item_key === "menu");
    expect(removed?.candidate_capture_id).toBeNull();
    expect(removed?.decision_id).toBeTruthy();
    if (!kept || !removed) throw new Error("Missing test rows");
    await review(service, "comparison-remove", {
      targets: [{ id: kept.id, expectedRevision: kept.decision_revision }],
    });
    await promote(service, "remove");
    await expect(
      review(service, "comparison-remove", {
        verdict: "rejected",
        targets: [{ id: removed.id, expectedRevision: removed.decision_revision }],
        expectedPromotionId: "promotion-remove",
        expectedBaselineRevision: 2,
      }),
    ).rejects.toThrow("read-only");
    expect((await service.project("project")).snapshot_id).toBe("snapshot-remove");
  });
});

describe("atomic review, rollback, and session Undo", () => {
  it.each(["approved", "rejected"] as const)(
    "persists a fresh %s command in three database round trips",
    async (verdict) => {
      using database = new TestDatabase();
      const service = new Service(database);
      await seed(service);
      await fixture(service, { id: "latency", kind: "pull_request", color: "red" });
      const row = (await service.comparisonRows("comparison-latency"))[0];
      if (!row) throw new Error("Missing review target");
      const input = {
        commandId: "latency-command",
        comparisonId: "comparison-latency",
        actorId: "maintainer",
        sessionId: "session",
        verdict,
        targets: [{ id: row.id, expectedRevision: row.decision_revision }],
        selection: { itemKey: row.item_key, variantKey: row.variant_key },
        now: 10,
      };
      const previousRunRevision = (await service.run("latency")).revision;
      using first = vi.spyOn(SqliteStatement.prototype, "first");
      using all = vi.spyOn(SqliteStatement.prototype, "all");
      using run = vi.spyOn(SqliteStatement.prototype, "run");
      using batch = vi.spyOn(database, "batch");
      const result = await service.review(input);
      const roundTrips =
        first.mock.calls.length +
        all.mock.calls.length +
        run.mock.calls.length +
        batch.mock.calls.length;
      expect(roundTrips).toBe(3);
      expect(result).toMatchObject({
        revisions: [{ id: row.id, expectedRevision: row.decision_revision + 1 }],
        previousRunRevision,
        runRevision: previousRunRevision + 1,
      });
      expect((await service.status("latency")).status).toBe(
        verdict === "approved" ? "passed" : "rejected",
      );
      expect(await service.review(input)).toEqual(result);
      expect(count(database, "visonaut_commands")).toBe(1);
      expect((await service.run("latency")).revision).toBe(result.runRevision);
    },
  );

  it("reviews 100 targets across items within D1's bound-parameter limit", async () => {
    using database = new TestDatabase();
    database.maximumBindings = 100;
    const service = new Service(database);
    await setup(service);
    const items = Array.from({ length: 100 }, (_, index) => `item-${index}`);
    await fixture(service, { id: "batch-review", items });
    const previousRunRevision = (await service.run("batch-review")).revision;
    const result = await review(service, "comparison-batch-review");
    expect(result.revisions).toHaveLength(items.length);
    expect(result).toMatchObject({
      previousRunRevision,
      runRevision: previousRunRevision + 1,
    });
    expect(result.runRevision).toBe((await service.run("batch-review")).revision);
    const revisions = new Map(
      result.revisions.map((target) => [target.id, target.expectedRevision]),
    );
    expect(
      (await service.comparisonRows("comparison-batch-review")).every(
        (row) => row.decision_revision === revisions.get(row.id),
      ),
    ).toBe(true);
  });

  it("aborts every write when a whole-item target changes during the SQL batch", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service, ["dialog", "menu"]);
    await fixture(service, { id: "changed", items: ["dialog", "menu"], color: "red" });
    const rows = await service.comparisonRows("comparison-changed");
    const second = rows[1];
    if (!second) throw new Error("Missing second target");
    const before = {
      audit: count(database, "visonaut_audit"),
      outbox: count(database, "visonaut_status_outbox"),
      decisions: count(database, "visonaut_decisions"),
    };
    database.beforeBatch = () => {
      database.connection
        .prepare(
          "UPDATE visonaut_comparison_rows SET decision_revision = decision_revision + 1 WHERE id = ?",
        )
        .run(second.id);
    };
    await expect(review(service, "comparison-changed")).rejects.toBeInstanceOf(ConflictError);
    expect(count(database, "visonaut_commands")).toBe(0);
    expect(count(database, "visonaut_audit")).toBe(before.audit);
    expect(count(database, "visonaut_status_outbox")).toBe(before.outbox);
    expect(count(database, "visonaut_decisions")).toBe(before.decisions);
    expect((await service.comparisonRows("comparison-changed"))[0]?.decision_id).toBeNull();
  });

  it("makes command replay idempotent and Undo restores automatic acceptance", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, { id: "pr", kind: "pull_request" });
    const row = (await service.comparisonRows("comparison-pr"))[0];
    if (!row) throw new Error("Missing row");
    const options = {
      commandId: "reject",
      verdict: "rejected" as const,
      targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    };
    const first = await review(service, "comparison-pr", options);
    const savedRevision = (await service.run("pr")).revision;
    expect(first.runRevision).toBe(savedRevision);
    const replay = await review(service, "comparison-pr", options);
    expect(replay).toEqual(first);
    expect((await service.run("pr")).revision).toBe(savedRevision);
    expect(count(database, "visonaut_commands")).toBe(1);
    await service.undo({
      commandId: "reject",
      undoCommandId: "undo",
      actorId: "maintainer-1",
      sessionId: "session",
      expectedBaselineRevision: 0,
      now: 20,
    });
    expect((await service.status("pr")).status).toBe("passed");
    await expect(
      service.undo({
        commandId: "reject",
        undoCommandId: "different",
        actorId: "maintainer-1",
        sessionId: "new-session",
        expectedBaselineRevision: 0,
        now: 21,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses stale D22 after a later baseline without partial audit work", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "red", color: "red" });
    const approval = await review(service, "comparison-red");
    await promote(service, "red");
    await fixture(service, { id: "green", color: "green" });
    await review(service, "comparison-green");
    await promote(service, "green");
    const before = count(database, "visonaut_audit");
    await expect(
      service.undo({
        commandId: approval.commandId,
        undoCommandId: "stale",
        actorId: "maintainer-1",
        sessionId: "session",
        expectedBaselineRevision: 3,
        now: 40,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await service.project("project")).snapshot_id).toBe("snapshot-green");
    expect(count(database, "visonaut_audit")).toBe(before);
  });
});

describe("restoration and workflow attempt inheritance", () => {
  it("restores a removed key only with exact eligible earlier acceptance", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service, ["dialog", "menu"]);
    await fixture(service, { id: "remove", items: ["dialog"] });
    const kept = (await service.comparisonRows("comparison-remove")).find(
      (row) => row.item_key === "dialog",
    );
    if (!kept) throw new Error("Missing kept variant");
    await review(service, "comparison-remove", {
      targets: [{ id: kept.id, expectedRevision: kept.decision_revision }],
    });
    await promote(service, "remove");
    await fixture(service, { id: "restored", items: ["dialog", "menu"], related: ["seed"] });
    const exact = (await service.comparisonRows("comparison-restored")).find(
      (row) => row.item_key === "menu",
    );
    expect(exact?.decision_id).toBe(`copied:${exact?.id}`);
    await fixture(service, {
      id: "changed-restoration",
      items: ["dialog", "menu"],
      color: "red",
      related: ["seed"],
    });
    const changed = (await service.comparisonRows("comparison-changed-restoration")).find(
      (row) => row.item_key === "menu",
    );
    expect(changed?.source_decision_id).toBeNull();
    expect(changed?.decision_id).toBeNull();
  });

  it("inherits only verified non-rerun shards at the same tested SHA", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, {
      id: "first",
      external: "workflow",
      kind: "pull_request",
      lineage: "pr-1",
    });
    const plan = {
      digest: "plan",
      shards: [
        {
          key: "chromium",
          profileDigest: "profile",
          tests: ["test"],
          captures: [{ itemKey: "dialog", variantKey: "light", testId: "test" }],
        },
      ],
    };
    const reserve = {
      projectId: "project",
      externalRunId: "workflow",
      kind: "pull_request" as const,
      testedSha: "sha-first",
      lineageKey: "pr-1",
      plan,
      verifiedRelatedRunIds: ["first"],
      verifiedAncestorShas: [],
      verificationDigest: "proof",
      inheritFromRunId: "first",
      verifiedInheritedShards: [
        {
          key: "chromium",
          manifestDigest: "manifest-first",
          captureProfileDigest: await captureProfilesDigest([
            { itemKey: "dialog", variantKey: "light", profileDigest: "profile" },
          ]),
        },
      ],
      now: 10,
    };
    await service.reserveRun({ ...reserve, id: "inherited", attempt: 2, rerunShardKeys: [] });
    await service.sealRun({ runId: "inherited", now: 11 });
    expect(
      database.connection
        .prepare(
          "SELECT source_run_id, source_attempt FROM visonaut_shards WHERE run_id = 'inherited'",
        )
        .get(),
    ).toMatchObject({ source_run_id: "first", source_attempt: 1 });
    expect(
      database.connection
        .prepare("SELECT run_id FROM work_retention_pins WHERE owner = 'inherited-by:inherited'")
        .get()?.run_id,
    ).toBe("first");
    await service.retireRun({ runId: "inherited", now: 11 });
    expect(
      database.connection
        .prepare("SELECT run_id FROM work_retention_pins WHERE owner = 'inherited-by:inherited'")
        .get()?.run_id,
    ).toBe("first");
    await service.reserveRun({
      ...reserve,
      id: "inherited-again",
      inheritFromRunId: "inherited",
      verifiedRelatedRunIds: ["first", "inherited"],
      attempt: 3,
      rerunShardKeys: [],
    });
    await service.sealRun({ runId: "inherited-again", now: 12 });
    expect(
      database.connection
        .prepare("SELECT source_attempt FROM visonaut_shards WHERE run_id = 'inherited-again'")
        .get()?.source_attempt,
    ).toBe(1);
    await service.reserveRun({ ...reserve, id: "rerun", attempt: 4, rerunShardKeys: ["chromium"] });
    await expect(service.sealRun({ runId: "rerun", now: 12 })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(
      database.connection
        .prepare("SELECT count(*) AS count FROM visonaut_captures WHERE run_id = 'rerun'")
        .get()?.count,
    ).toBe(0);
    await expect(
      service.reserveRun({
        ...reserve,
        id: "wrong-sha",
        testedSha: "different",
        attempt: 5,
        rerunShardKeys: [],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await service.run("rerun")).active).toBe(1);
  });

  it.each(["production", "legacy long"])(
    "keeps inherited capture IDs bounded through 50 reruns with %s source IDs",
    async (sourceIdentity) => {
      using database = new TestDatabase();
      const service = new Service(database);
      await setup(service);
      const plan = {
        digest: "plan",
        shards: ["webkit", "chromium", "firefox"].map((key) => ({
          key,
          profileDigest: `environment-${key}`,
          tests: [`test-${key}`],
          captures: ["light", "dark"].map((variantKey) => ({
            itemKey: key,
            variantKey,
            testId: `test-${key}`,
          })),
        })),
      };
      const firstRunId = crypto.randomUUID();
      const reserve = {
        projectId: "project",
        externalRunId: "workflow",
        kind: "pull_request" as const,
        testedSha: "a".repeat(40),
        lineageKey: "pr-1",
        plan,
        verifiedRelatedRunIds: [],
        verifiedAncestorShas: [],
        verificationDigest: "proof",
        now: 1,
      };
      const commit = async (runId: string, shard: (typeof plan.shards)[number]) => {
        const captures = [];
        for (const [index, capture] of shard.captures.entries()) {
          const imageId = crypto.randomUUID();
          await service.registerImage({
            id: imageId,
            runId,
            digest: `image-${capture.itemKey}-${capture.variantKey}`,
            objectKey: `runs/${runId}/${imageId}`,
            contentType: "image/png",
            bytes: 80,
            width: 10,
            height: 10,
          });
          const digest = createHash("sha256")
            .update(JSON.stringify([capture.itemKey, capture.variantKey]))
            .digest("hex");
          const captureId = `${runId}:${digest}`;
          captures.push({
            ...capture,
            id:
              sourceIdentity === "legacy long" && runId === firstRunId
                ? `${`${crypto.randomUUID()}:`.repeat(20)}${captureId}`
                : captureId,
            // Both inherited shards start with the same manifest-local ordinals.
            ordinal: index === 0 ? 0 : Number.MAX_SAFE_INTEGER,
            imageId,
            profileDigest: `full-profile-${capture.itemKey}-${capture.variantKey}`,
            environmentProfileDigest: shard.profileDigest,
            testRetry: 1,
            metadata: { name: capture.itemKey, variant: capture.variantKey },
          });
        }
        await service.commitShard({
          runId,
          key: shard.key,
          manifestDigest: `manifest-${shard.key}`,
          finalTestOutcomes: [{ testId: `test-${shard.key}`, retry: 1, status: "passed" }],
          captures,
          now: 2,
        });
        return {
          key: shard.key,
          manifestDigest: `manifest-${shard.key}`,
          captureProfileDigest: await captureProfilesDigest(captures),
        };
      };
      const captureRows = (runId: string) =>
        database.connection
          .prepare("SELECT * FROM visonaut_captures WHERE run_id = ? ORDER BY shard_key, ordinal")
          .all(runId);
      const originalCaptures = (runId: string) =>
        database.connection
          .prepare(
            "SELECT capture.shard_key, capture.item_key, capture.variant_key, capture.image_id, capture.profile_digest, capture.test_id, capture.test_retry, capture.metadata_json, image.run_id AS image_run_id FROM visonaut_captures capture JOIN visonaut_images image ON image.id = capture.image_id WHERE capture.run_id = ? AND capture.shard_key != 'firefox' ORDER BY capture.shard_key, capture.ordinal",
          )
          .all(runId);
      await service.reserveRun({
        ...reserve,
        id: firstRunId,
        attempt: 1,
        rerunShardKeys: plan.shards.map((shard) => shard.key),
      });
      const inheritedShards = [];
      for (const shard of plan.shards) {
        if (shard.key === "firefox") continue;
        inheritedShards.push(await commit(firstRunId, shard));
      }
      const originals = originalCaptures(firstRunId);
      let previousRunId = firstRunId;
      // GitHub permits 50 reruns, so the last run has attempt number 51.
      for (let attempt = 2; attempt <= 51; attempt++) {
        const runId = crypto.randomUUID();
        const input = {
          ...reserve,
          id: runId,
          attempt,
          inheritFromRunId: previousRunId,
          verifiedInheritedShards: inheritedShards,
          rerunShardKeys: ["firefox"],
          now: attempt,
        };
        const reserved = await service.reserveRun(input);
        const inheritedCaptures = captureRows(runId);
        expect(inheritedCaptures).toHaveLength(4);
        expect(new Set(inheritedCaptures.map((capture) => capture.id)).size).toBe(4);
        for (const capture of inheritedCaptures) {
          // Queue task IDs add a comparison UUID and separator to each capture ID.
          expect(`${crypto.randomUUID()}:${capture.id}`.length).toBeLessThan(512);
        }
        expect(originalCaptures(runId)).toEqual(originals);
        expect(
          database.connection
            .prepare(
              "SELECT key, source_run_id, source_attempt, manifest_digest, full_profile_digest FROM visonaut_shards WHERE run_id = ? AND key != 'firefox' ORDER BY key",
            )
            .all(runId),
        ).toEqual(
          inheritedShards
            .map((shard) => ({
              key: shard.key,
              source_run_id: previousRunId,
              source_attempt: 1,
              manifest_digest: shard.manifestDigest,
              full_profile_digest: shard.captureProfileDigest,
            }))
            .sort((left, right) => left.key.localeCompare(right.key)),
        );
        expect(
          database.connection
            .prepare(
              "SELECT run_id, reason FROM work_retention_pins WHERE owner = ? ORDER BY run_id",
            )
            .all(`inherited-by:${runId}`),
        ).toEqual([{ run_id: firstRunId, reason: "comparison" }]);
        const project = await service.project("project");
        expect(await service.reserveRun({ ...input, id: crypto.randomUUID() })).toEqual(reserved);
        expect(await service.project("project")).toEqual(project);
        expect(captureRows(runId)).toEqual(inheritedCaptures);
        const freshShard = plan.shards.find((shard) => shard.key === "firefox");
        if (!freshShard) throw new Error("Missing fresh shard");
        await commit(runId, freshShard);
        await service.sealRun({ runId, now: attempt });
        const sealedCaptures = captureRows(runId);
        expect(sealedCaptures).toHaveLength(6);
        expect(new Set(sealedCaptures.map((capture) => capture.id)).size).toBe(6);
        expect(originalCaptures(runId)).toEqual(originals);
        expect(
          database.connection
            .prepare(
              "SELECT capture.item_key, capture.variant_key, capture.ordinal, image.run_id AS image_run_id FROM visonaut_captures capture JOIN visonaut_images image ON image.id = capture.image_id WHERE capture.run_id = ? ORDER BY capture.ordinal",
            )
            .all(runId),
        ).toEqual(
          plan.shards.flatMap((shard, shardIndex) =>
            shard.captures.map((capture, captureIndex) => ({
              item_key: capture.itemKey,
              variant_key: capture.variantKey,
              ordinal: shardIndex * 2 + captureIndex,
              image_run_id: shard.key === "firefox" ? runId : firstRunId,
            })),
          ),
        );
        await service.reserveRun(input);
        expect(captureRows(runId)).toEqual(sealedCaptures);
        previousRunId = runId;
      }
      const comparisonId = crypto.randomUUID();
      await seedLegacyComparison(service, {
        id: comparisonId,
        runId: previousRunId,
        referenceSnapshotId: null,
        now: 52,
        maxAttempts: 3,
      });
      const rows = await service.comparisonRows(comparisonId);
      expect(rows).toHaveLength(6);
      for (const row of rows) {
        expect(row.id.length).toBeLessThan(512);
      }
    },
  );

  it("keeps copied main approval when the source PR approval is undone", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "pr", kind: "pull_request", lineage: "pr-1", color: "red" });
    const approval = await review(service, "comparison-pr");
    await fixture(service, { id: "main", color: "red", related: ["pr"] });
    await promote(service, "main");
    await expect(
      service.undo({
        commandId: approval.commandId,
        undoCommandId: "undo-source",
        actorId: "maintainer-1",
        sessionId: "session",
        expectedBaselineRevision: 2,
        now: 30,
      }),
    ).resolves.toMatchObject({ commandId: "undo-source" });
    expect((await service.status("main")).status).toBe("passed");
    expect((await service.project("project")).snapshot_id).toBe("snapshot-main");
  });

  it("invalidates queued success in the same rejection transaction", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, { id: "pr", kind: "pull_request" });
    const prepared = await service.prepareStatusIntent({
      runId: "pr",
      checkId: "external-check",
      detailsUrl: "https://visonaut.example/runs/pr",
      maxAttempts: 3,
      now: 10,
    });
    expect(prepared.conclusion).toBe("success");
    await review(service, "comparison-pr", { verdict: "rejected" });
    const desired = database.connection
      .prepare("SELECT desired_revision FROM work_checks WHERE id = 'external-check'")
      .get()?.desired_revision;
    expect(desired).not.toBe(prepared.revision);
    const fresh = await service.prepareStatusIntent({
      runId: "pr",
      checkId: "external-check",
      detailsUrl: "https://visonaut.example/runs/pr",
      maxAttempts: 3,
      now: 11,
    });
    expect(fresh.conclusion).toBe("failure");
    expect(fresh.revision).toBe(desired);
  });

  it("keeps merge-group review pending until approval or rejection", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "queue", kind: "merge_group", color: "red" });
    const input = {
      runId: "queue",
      checkId: "queue-check",
      detailsUrl: "https://visonaut.example/runs/queue",
      maxAttempts: 3,
      now: 10,
    };
    expect((await service.status("queue")).status).toBe("needs-review");
    expect((await service.prepareStatusIntent(input)).conclusion).toBe("pending");
    await review(service, "comparison-queue");
    expect((await service.prepareStatusIntent({ ...input, now: 11 })).conclusion).toBe("success");
    await review(service, "comparison-queue", { verdict: "rejected" });
    expect((await service.prepareStatusIntent({ ...input, now: 12 })).conclusion).toBe("failure");
  });

  it("does not revive an invalidated main comparison in place", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "pr", kind: "main", color: "red" });
    await review(service, "comparison-pr");
    await fixture(service, { id: "main", color: "red", related: ["pr"] });
    await promote(service, "main");
    await expect(
      service.finalizeComparison({ comparisonId: "comparison-pr", now: 20 }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await service.comparison("comparison-pr")).state).toBe("invalidated");
  });

  it("keeps in-flight PR comparisons on their reference after promotion", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "pr", kind: "pull_request", color: "red" });
    await seedLegacyComparison(service, {
      id: "pending-pr",
      runId: "pr",
      referenceSnapshotId: "snapshot-seed",
      now: 20,
      maxAttempts: 3,
    });
    expect((await service.run("pr")).state).toBe("comparing");

    await fixture(service, { id: "main" });
    await review(service, "comparison-main");
    await promote(service, "main");

    expect((await service.comparison("pending-pr")).state).toBe("comparing");
    expect((await service.run("pr")).state).toBe("comparing");
    expect((await service.status("pr")).status).toBe("comparing");
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM visonaut_runs WHERE active=1 AND state='comparing'")
        .get()?.count,
    ).toBe(1);
  });

  it("retires queued review work when a newer attempt supersedes its run", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, {
      id: "old",
      kind: "pull_request",
      external: "workflow",
      lineage: "pr",
      color: "red",
    });
    const row = (await service.comparisonRows("comparison-old"))[0];
    if (!row) throw new Error("Missing review row");
    database.connection
      .prepare("UPDATE work_tasks SET state='queued', result=NULL WHERE id=?")
      .run(row.id);

    await fixture(service, {
      id: "new",
      kind: "pull_request",
      external: "workflow",
      lineage: "pr",
      attempt: 2,
      color: "red",
    });

    expect((await service.run("old")).active).toBe(0);
    expect(
      database.connection.prepare("SELECT state, result FROM work_tasks WHERE id=?").get(row.id),
    ).toEqual({ state: "complete", result: "superseded" });
    expect((await service.comparisonRows("comparison-old"))[0]?.id).toBe(row.id);
  });

  it("retires a closed run's review work without retiring historical work", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "closed-review", kind: "pull_request", color: "red" });
    const row = (await service.comparisonRows("comparison-closed-review"))[0];
    if (!row) throw new Error("Missing review row");
    database.connection
      .prepare(
        "UPDATE work_tasks SET state='leased', result=NULL, lease_token='worker', lease_until=100 WHERE id=?",
      )
      .run(row.id);

    await service.retireRun({ runId: "closed-review", now: 20 });

    expect(
      database.connection
        .prepare("SELECT state, result, lease_token, lease_until FROM work_tasks WHERE id=?")
        .get(row.id),
    ).toEqual({ state: "complete", result: "superseded", lease_token: null, lease_until: null });
    const comparison = await seedLegacyComparison(service, {
      id: "historical-closed-review",
      runId: "closed-review",
      referenceSnapshotId: "snapshot-seed",
      purpose: "historical",
      now: 21,
      maxAttempts: 2,
    });
    const historicalRow = (await service.comparisonRows(comparison.id))[0];
    if (!historicalRow) throw new Error("Missing historical row");
    await service.retireRun({ runId: "closed-review", now: 22 });
    expect(
      database.connection.prepare("SELECT state FROM work_tasks WHERE id=?").get(historicalRow.id),
    ).toEqual({ state: "queued" });
  });
});

describe("expanded SQL workload", () => {
  it("accounts for 10,580 captures within one D1 invocation query budget", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    const captures = Array.from({ length: 10_580 }, (_, ordinal) => ({
      id: `capture-${ordinal}`,
      itemKey: `item-${ordinal}`,
      variantKey: "light",
      ordinal,
      imageId: `image-${ordinal}`,
      profileDigest: "profile",
      environmentProfileDigest: "profile",
      testId: "test",
      testRetry: 0,
      metadata: { name: `Item ${ordinal}` },
    }));
    await service.reserveRun({
      id: "expanded",
      projectId: "project",
      externalRunId: "expanded",
      attempt: 1,
      kind: "main",
      testedSha: "sha-expanded",
      lineageKey: "main",
      plan: {
        digest: "plan",
        shards: [
          {
            key: "shard",
            profileDigest: "profile",
            tests: ["test"],
            captures: captures.map(({ itemKey, variantKey, testId }) => ({
              itemKey,
              variantKey,
              testId,
            })),
          },
        ],
      },
      verifiedRelatedRunIds: [],
      verifiedAncestorShas: [],
      verificationDigest: "proof",
      rerunShardKeys: ["shard"],
      now: 1,
    });
    // Each image registration represents a separate bounded upload request.
    for (const capture of captures) {
      await service.registerImage({
        id: capture.imageId,
        runId: "expanded",
        digest: `digest-${capture.ordinal}`,
        objectKey: `runs/expanded/${capture.ordinal}`,
        contentType: "image/png",
        bytes: 80,
        width: 10,
        height: 10,
      });
    }
    const before = database.preparedQueries;
    await service.commitShard({
      runId: "expanded",
      key: "shard",
      manifestDigest: "manifest",
      captures,
      finalTestOutcomes: [{ testId: "test", retry: 0, status: "passed" }],
      now: 2,
    });
    expect(database.preparedQueries - before).toBeLessThan(1_000);
    await service.sealRun({ runId: "expanded", now: 3 });
    await seedLegacyComparison(service, {
      id: "comparison-expanded",
      runId: "expanded",
      referenceSnapshotId: null,
      now: 4,
      maxAttempts: 3,
    });
    await service.finalizeComparison({ comparisonId: "comparison-expanded", now: 5 });
    expect((await service.status("expanded")).status).toBe("passed");
    expect(count(database, "visonaut_comparison_rows")).toBe(10_580);
    expect(count(database, "visonaut_decisions")).toBe(10_580);
  }, 30_000);
});

describe("trusted candidate discovery", () => {
  it("requires verified job evidence before adopting a new full inventory", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service, ["dialog", "menu"]);
    await service.reserveRun({
      id: "discovered",
      projectId: "project",
      externalRunId: "workflow",
      attempt: 1,
      kind: "main",
      testedSha: "sha-discovered",
      lineageKey: "main",
      plan: {
        digest: "discovery-plan",
        shards: [
          {
            key: "shard",
            profileDigest: "profile",
            tests: [],
            captures: [],
            discovery: {
              executorDigest: "trusted-executor",
              configurationDigest: "trusted-config",
            },
          },
        ],
      },
      verifiedRelatedRunIds: [],
      verifiedAncestorShas: ["sha-seed"],
      verificationDigest: "proof",
      rerunShardKeys: ["shard"],
      now: 20,
    });
    const captures = ["dialog", "new"].map((itemKey, ordinal) => ({
      id: `capture-discovered-${itemKey}`,
      itemKey,
      variantKey: "light",
      ordinal,
      imageId: `image-discovered-${itemKey}`,
      profileDigest: "profile",
      environmentProfileDigest: "profile",
      testId: "candidate-test",
      testRetry: 0,
      metadata: {},
    }));
    for (const capture of captures) {
      await service.registerImage({
        id: capture.imageId,
        runId: "discovered",
        digest: `${capture.itemKey}-blue`,
        objectKey: `runs/discovered/${capture.itemKey}`,
        contentType: "image/png",
        bytes: 80,
        width: 10,
        height: 10,
      });
    }
    const shard = {
      runId: "discovered",
      key: "shard",
      manifestDigest: "manifest",
      captures,
      finalTestOutcomes: [{ testId: "candidate-test", retry: 0, status: "passed" as const }],
      now: 21,
    };
    await expect(service.commitShard(shard)).rejects.toThrow("verified successful-job evidence");
    await expect(service.sealRun({ runId: "discovered", now: 22 })).rejects.toBeInstanceOf(
      ConflictError,
    );
    const proof = {
      executorDigest: "trusted-executor",
      configurationDigest: "trusted-config",
      inventoryDigest: "frozen-inventory",
      verificationDigest: "github-job-success",
      jobId: "job",
      externalRunId: "workflow",
      attempt: 1,
      testedSha: "sha-discovered",
      tests: ["candidate-test"],
      captures: captures.map(({ itemKey, variantKey, testId }) => ({
        itemKey,
        variantKey,
        testId,
      })),
    };
    await expect(
      service.commitShard({
        ...shard,
        verifiedDiscovery: { ...proof, configurationDigest: "PR-config" },
      }),
    ).rejects.toThrow("trusted executor");
    await expect(
      service.commitShard({
        ...shard,
        verifiedDiscovery: proof,
        finalTestOutcomes: [{ testId: "candidate-test", retry: 0, status: "failed" }],
      }),
    ).rejects.toThrow("did not pass");
    await service.commitShard({ ...shard, verifiedDiscovery: proof });
    await service.sealRun({ runId: "discovered", now: 23 });
    await seedLegacyComparison(service, {
      id: "comparison-discovered",
      runId: "discovered",
      referenceSnapshotId: "snapshot-seed",
      now: 24,
      maxAttempts: 3,
    });
    const kept = (await service.comparisonRows("comparison-discovered")).find(
      (row) => row.item_key === "dialog",
    );
    if (!kept) throw new Error("Missing discovered comparison");
    await seedLegacyResult(service, {
      taskId: kept.id,
      result: {
        outcome: "unchanged",
        changedPixels: 0,
        ratio: 0,
        engineVersion: "engine",
        codecVersion: "codec",
      },
    });
    await service.finalizeComparison({ comparisonId: "comparison-discovered", now: 27 });
    expect((await service.status("discovered")).status).toBe("passed");
    const rows = await service.comparisonRows("comparison-discovered");
    expect(rows.find((row) => row.item_key === "new")?.reference_capture_id).toBeNull();
    expect(rows.find((row) => row.item_key === "menu")?.candidate_capture_id).toBeNull();
    expect(
      database.connection
        .prepare("SELECT discovery_json FROM visonaut_shards WHERE run_id = 'discovered'")
        .get()?.discovery_json,
    ).toContain("github-job-success");
  });
});

describe("review evidence at the write boundary", () => {
  it("rejects a comparison invalidated after the initial read", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "changed-evidence", color: "red" });
    const before = count(database, "visonaut_audit");
    database.beforeBatch = () => {
      database.connection
        .prepare(
          "UPDATE visonaut_comparisons SET state = 'invalidated' WHERE id = 'comparison-changed-evidence'",
        )
        .run();
    };
    await expect(review(service, "comparison-changed-evidence")).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(count(database, "visonaut_commands")).toBe(0);
    expect(count(database, "visonaut_audit")).toBe(before);
  });
});

describe("interrupted protected snapshot copy", () => {
  it("releases all foreign image-owner preparation pins while keeping other roots", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, { id: "source", kind: "pull_request" });
    await fixture(service, { id: "copy" });
    // This is the persisted shape of a verified inherited capture.
    database.connection.exec(
      "UPDATE visonaut_captures SET image_id='image-source-dialog' WHERE run_id='copy'",
    );
    database.connection.exec(
      "INSERT INTO work_retention_pins(run_id,owner,reason) VALUES('source','manual','manual')",
    );
    await service.preparePromotion({
      snapshotId: "pending-copy",
      comparisonId: "comparison-copy",
      prefix: "baselines/pending-copy",
      now: 10,
    });
    expect(
      database.connection
        .prepare(
          "SELECT run_id FROM work_retention_pins WHERE owner='promotion:pending-copy' ORDER BY run_id",
        )
        .all(),
    ).toEqual([{ run_id: "copy" }, { run_id: "source" }]);
    await service.cancelPreparedPromotion({ snapshotId: "pending-copy", now: 11 });
    expect(
      database.connection
        .prepare("SELECT run_id FROM work_retention_pins WHERE owner='promotion:pending-copy'")
        .all(),
    ).toEqual([]);
    expect(
      database.connection
        .prepare("SELECT run_id FROM work_retention_pins WHERE owner='manual'")
        .get(),
    ).toEqual({ run_id: "source" });
    expect(
      database.connection
        .prepare("SELECT run_id FROM work_retention_pins WHERE owner='review:copy'")
        .get(),
    ).toEqual({ run_id: "copy" });
  });

  it("replays preparation and cancels only an unpromoted copy", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, { id: "copy" });
    const input = {
      snapshotId: "pending-copy",
      comparisonId: "comparison-copy",
      prefix: "baselines/pending-copy",
      now: 10,
      copyLimit: 1,
    };
    const copies = await service.preparePromotion(input);
    expect(await service.preparePromotion(input)).toEqual(copies);
    expect(copies[0]).toMatchObject({ bytes: 80, content_type: "image/png" });
    await service.cancelPreparedPromotion({ snapshotId: "pending-copy", now: 11 });
    await service.cancelPreparedPromotion({ snapshotId: "pending-copy", now: 12 });
    expect(
      database.connection
        .prepare("SELECT 1 FROM work_retention_pins WHERE owner = 'promotion:pending-copy'")
        .get(),
    ).toBeUndefined();
    expect(
      database.connection
        .prepare("SELECT 1 FROM work_retention_pins WHERE owner = 'review:copy'")
        .get(),
    ).toBeDefined();
    await expect(service.preparePromotion(input)).rejects.toBeInstanceOf(ConflictError);
    await promote(service, "copy");
    await expect(
      service.cancelPreparedPromotion({ snapshotId: "snapshot-copy", now: 13 }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await service.project("project")).snapshot_id).toBe("snapshot-copy");
  });
});

describe("HTTP state integration", () => {
  it("keeps a failed attempt terminal while retaining verified successful shards", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await service.reserveRun({
      id: "failed",
      projectId: "project",
      externalRunId: "workflow",
      attempt: 1,
      kind: "main",
      testedSha: "sha",
      lineageKey: "main",
      plan: {
        digest: "plan",
        shards: [
          {
            key: "shard",
            profileDigest: "profile",
            tests: ["test"],
            captures: [{ itemKey: "dialog", variantKey: "light", testId: "test" }],
          },
        ],
      },
      verifiedRelatedRunIds: [],
      verifiedAncestorShas: [],
      verificationDigest: "proof",
      rerunShardKeys: ["shard"],
      now: 1,
    });
    await service.registerImage({
      id: "image",
      runId: "failed",
      digest: "digest",
      objectKey: "runs/failed/image",
      contentType: "image/png",
      bytes: 80,
      width: 10,
      height: 10,
    });
    const failure = await service.failRun({
      runId: "failed",
      reason: "Required workflow job failed",
      now: 2,
    });
    expect(failure.status).toBe("failed");
    expect("failures" in failure && failure.failures?.[0]?.last_error).toBe(
      "Required workflow job failed",
    );
    const auditCount = count(database, "visonaut_audit");
    await service.failRun({ runId: "failed", reason: "Repeated notification", now: 3 });
    expect(count(database, "visonaut_audit")).toBe(auditCount);
    await service.commitShard({
      runId: "failed",
      key: "shard",
      manifestDigest: "verified-successful-shard",
      captures: [
        {
          id: "capture",
          itemKey: "dialog",
          variantKey: "light",
          ordinal: 0,
          imageId: "image",
          profileDigest: "profile",
          environmentProfileDigest: "profile",
          testId: "test",
          testRetry: 0,
          metadata: {},
        },
      ],
      finalTestOutcomes: [{ testId: "test", retry: 0, status: "passed" }],
      now: 4,
    });
    expect(
      database.connection.prepare("SELECT state FROM visonaut_shards WHERE run_id = 'failed'").get()
        ?.state,
    ).toBe("complete");
    await expect(service.sealRun({ runId: "failed", now: 5 })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      service.registerImage({
        id: "late",
        runId: "failed",
        digest: "late",
        objectKey: "runs/failed/late",
        contentType: "image/png",
        bytes: 80,
        width: 10,
        height: 10,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await service.status("failed")).status).toBe("failed");
  });

  it("projects each run-owned copied approval independently", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "source", kind: "pull_request", lineage: "pr-1", color: "red" });
    await review(service, "comparison-source");
    await fixture(service, {
      id: "retry-source",
      kind: "pull_request",
      lineage: "pr-1",
      color: "red",
      related: ["source"],
    });
    await fixture(service, {
      id: "candidate-main",
      color: "red",
      related: ["source", "retry-source"],
    });
    expect(await service.eligibleApprovalRowIds("comparison-candidate-main")).toHaveLength(1);
    await review(service, "comparison-retry-source", { verdict: "rejected" });
    expect(await service.eligibleApprovalRowIds("comparison-candidate-main")).toHaveLength(1);
  });
});

describe("closed dependent evidence retention", () => {
  it("retains comparison bytes through the dependent thirty-day window and releases only its valid deletion lease", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "dependent", kind: "pull_request", color: "red" });
    await service.retireRun({ runId: "dependent", now: 100 });
    expect(
      database.connection
        .prepare(
          "SELECT run_id FROM work_retention_pins WHERE owner='comparison:comparison-dependent'",
        )
        .get()?.run_id,
    ).toBe("seed");
    await service.retireRun({ runId: "dependent", now: 200 });
    expect((await service.run("dependent")).closed_at).toBe(100);
    expect(
      database.connection
        .prepare("SELECT closed_at FROM work_retained_runs WHERE id='dependent'")
        .get()?.closed_at,
    ).toBe(100);
    expect(
      database.connection
        .prepare(
          "SELECT run_id FROM work_retention_pins WHERE owner='comparison:comparison-dependent'",
        )
        .get()?.run_id,
    ).toBe("seed");
    expect(
      await claimExpiredRun(database, {
        id: "dependent",
        token: "early",
        now: closedRunRetentionMs + 99,
        leaseMs: 100,
      }),
    ).toBeNull();
    const now = closedRunRetentionMs + 100;
    expect(
      await claimExpiredRun(database, { id: "dependent", token: "delete", now, leaseMs: 100 }),
    ).not.toBeNull();
    expect(
      await completeRetiredRunDeletion(database, { id: "dependent", token: "stale", now: now + 1 }),
    ).toBe(false);
    expect(
      database.connection
        .prepare(
          "SELECT run_id FROM work_retention_pins WHERE owner='comparison:comparison-dependent'",
        )
        .get()?.run_id,
    ).toBe("seed");
    expect(
      await completeRetiredRunDeletion(database, {
        id: "dependent",
        token: "delete",
        now: now + 1,
      }),
    ).toBe(true);
    expect(
      database.connection
        .prepare(
          "SELECT run_id FROM work_retention_pins WHERE owner='comparison:comparison-dependent'",
        )
        .get(),
    ).toBeUndefined();
    expect(
      database.connection
        .prepare("SELECT snapshot_id FROM visonaut_pins WHERE owner_id='comparison-dependent'")
        .get(),
    ).toBeUndefined();
  });

  it("closes a superseded attempt without extending its window on another retry", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, { id: "first", external: "workflow", kind: "pull_request" });
    await fixture(service, {
      id: "second",
      external: "workflow",
      attempt: 2,
      kind: "pull_request",
    });
    expect((await service.run("first")).closed_at).toBe(1);
    expect(
      database.connection.prepare("SELECT closed_at FROM work_retained_runs WHERE id='first'").get()
        ?.closed_at,
    ).toBe(1);
    expect(
      database.connection
        .prepare("SELECT run_id FROM work_retention_pins WHERE owner='review:first'")
        .get(),
    ).toBeUndefined();
    await fixture(service, { id: "third", external: "workflow", attempt: 3, kind: "pull_request" });
    expect((await service.run("first")).closed_at).toBe(1);
  });
});

async function prepareArchive(service: Service, runId: string) {
  const run = await service.run(runId);
  const project = await service.project(run.project_id);
  const input = {
    runId,
    generation: "generation",
    token: "archive-worker",
    sourceRevision: run.revision,
    projectRevision: project.revision,
    objectKey: `history/${runId}/generation/manifest.json`,
    digest: "a".repeat(64),
    bytes: 1000,
    pageCount: 1,
    now: 500,
  };
  await service.database
    .prepare(
      "INSERT INTO operations_run_archives(run_id,generation,state,source_revision,project_revision,object_key,progress_json,lease_token,lease_until,created_at) VALUES(?,?,'building',?,?,?,'{}',?,1000,400)",
    )
    .bind(
      runId,
      input.generation,
      input.sourceRevision,
      input.projectRevision,
      input.objectKey,
      input.token,
    )
    .run();
  const commands = await service.database
    .prepare(
      "SELECT command.id,command.request_json FROM visonaut_commands command JOIN visonaut_comparisons comparison ON comparison.id=command.comparison_id WHERE comparison.run_id=?",
    )
    .bind(runId)
    .all<{ id: string; request_json: string }>();
  for (const command of commands.results ?? [])
    await prepareArchivedCommandReplay(service.database, {
      ...input,
      commandId: command.id,
      requestJson: command.request_json,
    });
  return input;
}

describe("verified closed history compaction", () => {
  it("keeps exact approval reuse and command replay while removing capture detail", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, { id: "source", kind: "pull_request", lineage: "pr" });
    const saved = await review(service, "comparison-source");
    const command = database.connection
      .prepare("SELECT request_json FROM visonaut_commands WHERE id=?")
      .get(saved.commandId);
    const request = JSON.parse(String(command?.request_json));
    const decisions = database.connection
      .prepare("SELECT * FROM visonaut_decisions ORDER BY id")
      .all();
    await service.retireRun({ runId: "source", now: 100 });
    await compactRunHistory(database, await prepareArchive(service, "source"));
    expect(
      database.connection.prepare("SELECT * FROM visonaut_decisions ORDER BY id").all(),
    ).toEqual(decisions);
    expect(
      database.connection
        .prepare("SELECT count(*) AS n FROM visonaut_captures WHERE run_id='source'")
        .get()?.n,
    ).toBe(0);
    expect(
      database.connection
        .prepare("SELECT count(*) AS n FROM visonaut_images WHERE run_id='source'")
        .get()?.n,
    ).toBe(1);
    await expect(service.review({ ...request, now: 600 })).rejects.toMatchObject({
      name: "ArchivedCommandResultError",
      runId: "source",
      commandId: saved.commandId,
    });
    await expect(
      service.review({ ...request, verdict: "rejected", now: 600 }),
    ).rejects.toBeInstanceOf(ConflictError);
    await fixture(service, {
      id: "related",
      kind: "pull_request",
      lineage: "pr",
      related: ["source"],
    });
    expect((await service.status("related")).status).toBe("passed");
    const copied = (await service.comparisonRows("comparison-related"))[0];
    expect(copied?.source_decision_id).toBeNull();
    expect(
      database.connection
        .prepare("SELECT source_decision_id FROM visonaut_decisions WHERE id=?")
        .get(copied?.decision_id ?? "")?.source_decision_id,
    ).toBe((decisions.find((decision) => decision.kind === "human") as { id: string }).id);
    expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("rolls back every prune when a recovery reference appears before commit", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, { id: "source", kind: "pull_request" });
    await service.retireRun({ runId: "source", now: 100 });
    const input = await prepareArchive(service, "source");
    const captures = database.connection.prepare("SELECT * FROM visonaut_captures").all();
    database.beforeBatch = () => {
      database.connection
        .prepare(
          "INSERT INTO work_retention_pins(run_id,owner,reason) VALUES('source','new-backup','recovery')",
        )
        .run();
    };
    await expect(compactRunHistory(database, input)).rejects.toBeInstanceOf(ConflictError);
    expect(database.connection.prepare("SELECT * FROM visonaut_captures").all()).toEqual(captures);
    expect(
      database.connection
        .prepare("SELECT state FROM operations_run_archives WHERE run_id='source'")
        .get()?.state,
    ).toBe("building");
    expect((await service.run("source")).detail_archived).toBe(0);
  });

  it("rejects current and rollback baselines as archive candidates", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "next", related: ["seed"] });
    await review(service, "comparison-next");
    await promote(service, "next");
    database.connection.exec("UPDATE visonaut_runs SET active=0,closed_at=100");
    const candidates = database.connection
      .prepare(`SELECT run.id FROM visonaut_runs run WHERE ${archiveEligibilitySql("run")}`)
      .all();
    expect(candidates).toEqual([]);
  });
});

describe("bounded snapshot evidence roots", () => {
  it("reclaims an inherited source image after the final protected retry copy expires", async () => {
    using database = new TestDatabase();
    database.connection.exec(`
      INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('p','repo','policy');
      INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,active,closed_at,detail_archived,created_at) VALUES
        ('source','p','w',1,'main','sha','main','plan','{}',0,1,1,0),
        ('retry','p','w',2,'main','sha','main','plan','{}',0,1,1,0);
      INSERT INTO work_retained_runs(id,object_prefix,closed_at) VALUES('source','runs/source/',1),('retry','runs/retry/',1);
      INSERT INTO visonaut_shards(run_id,key,profile_digest,expected_json) VALUES('retry','shard','profile','{}');
      INSERT INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height) VALUES('source-image','source','digest','runs/source/image','image/png',80,10,10);
      INSERT INTO visonaut_captures(id,run_id,shard_key,item_key,variant_key,ordinal,image_id,profile_digest,test_id,test_retry,metadata_json) VALUES('retry-capture','retry','shard','item','variant',0,'source-image','profile','test',0,'{}');
      INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,created_at) VALUES('comparison','retry',0,'policy',1,0);
      INSERT INTO visonaut_snapshots(id,project_id,run_id,comparison_id,tested_sha,prefix,state,created_at) VALUES('snapshot','p','retry','comparison','sha','baselines/retry','accepted',0);
      INSERT INTO visonaut_snapshot_images(snapshot_id,capture_id,image_id,object_key,digest,copied) VALUES('snapshot','retry-capture','source-image','baselines/retry/image','digest',1);
      INSERT INTO work_retention_pins(run_id,owner,reason) VALUES('source','inherited-by:retry','comparison');
    `);
    const now = 4_000_000_000;
    for (const id of ["retry", "source"]) {
      expect(
        await claimExpiredRun(database, { id, token: "delete", now, leaseMs: 100 }),
      ).not.toBeNull();
      expect(
        await completeRetiredRunDeletion(database, { id, token: "delete", now: now + 1 }),
      ).toBe(true);
    }
    expect(count(database, "visonaut_images")).toBe(1);
    database.connection
      .prepare(
        "UPDATE visonaut_snapshot_retention SET byte_state='deleting',lease_token='snapshot-delete',lease_until=? WHERE snapshot_id='snapshot'",
      )
      .run(now + 100);
    await completeRetiredSnapshotDeletion(database, {
      snapshotId: "snapshot",
      token: "snapshot-delete",
      now: now + 2,
    });
    expect(count(database, "visonaut_captures")).toBe(0);
    expect(count(database, "visonaut_images")).toBe(0);
    expect(database.connection.prepare("SELECT byte_state FROM work_retained_runs").all()).toEqual([
      { byte_state: "deleted" },
      { byte_state: "deleted" },
    ]);
    expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("keeps the current baseline while retiring predecessor snapshots without rollback roots", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "second", color: "red" });
    await review(service, "comparison-second");
    await promote(service, "second");
    await fixture(service, { id: "third", color: "green" });
    await review(service, "comparison-third");
    await promote(service, "third");
    await expect(
      retireSnapshot(database, { snapshotId: "snapshot-third", now: 100, graceMs: 10 }),
    ).rejects.toBeInstanceOf(ConflictError);
    await retireSnapshot(database, { snapshotId: "snapshot-second", now: 100, graceMs: 10 });
    await retireSnapshot(database, { snapshotId: "snapshot-seed", now: 100, graceMs: 10 });
    expect(
      database.connection
        .prepare("SELECT reference_eligible FROM visonaut_snapshots WHERE id='snapshot-seed'")
        .get()?.reference_eligible,
    ).toBe(0);
    expect(() =>
      database.connection
        .prepare(
          "INSERT INTO visonaut_pins(snapshot_id,reason,owner_id) VALUES('snapshot-seed','comparison','late')",
        )
        .run(),
    ).toThrow();
    await compactRunHistory(database, await prepareArchive(service, "seed"));
    expect(
      await claimRetiredSnapshotDeletion(database, {
        snapshotId: "snapshot-seed",
        token: "early",
        now: 110,
        leaseMs: 100,
      }),
    ).toBeNull();
    const second = await service.run("second");
    const expires = Number(second.closed_at) + closedRunRetentionMs;
    await expect(
      releaseExpiredComparisonReferences(database, { runId: "second", now: expires - 1 }),
    ).rejects.toBeInstanceOf(ConflictError);
    await releaseExpiredComparisonReferences(database, { runId: "second", now: expires });
    expect(
      database.connection
        .prepare("SELECT byte_state FROM work_retained_runs WHERE id='second'")
        .get()?.byte_state,
    ).toBe("live");
    expect(
      database.connection
        .prepare("SELECT run_id FROM work_retention_pins WHERE owner='promotion:snapshot-second'")
        .get()?.run_id,
    ).toBeUndefined();
    expect(
      await claimRetiredSnapshotDeletion(database, {
        snapshotId: "snapshot-seed",
        token: "delete",
        now: expires,
        leaseMs: 100,
      }),
    ).not.toBeNull();
    await expect(
      completeRetiredSnapshotDeletion(database, {
        snapshotId: "snapshot-seed",
        token: "stale",
        now: expires + 1,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      database.connection
        .prepare(
          "SELECT count(*) AS n FROM visonaut_snapshot_images WHERE snapshot_id='snapshot-seed'",
        )
        .get()?.n,
    ).toBe(1);
    await completeRetiredSnapshotDeletion(database, {
      snapshotId: "snapshot-seed",
      token: "delete",
      now: expires + 1,
    });
    expect(
      database.connection
        .prepare(
          "SELECT count(*) AS n FROM visonaut_snapshot_images WHERE snapshot_id='snapshot-seed'",
        )
        .get()?.n,
    ).toBe(0);
    expect(
      database.connection
        .prepare(
          "SELECT count(*) AS n FROM visonaut_snapshot_images WHERE snapshot_id IN ('snapshot-second','snapshot-third')",
        )
        .get()?.n,
    ).toBe(2);
    expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("refuses reference expiry while an export or historical comparison owns a manual pin", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "closed", kind: "pull_request" });
    await service.retireRun({ runId: "closed", now: 100 });
    database.connection
      .prepare(
        "INSERT INTO work_retention_pins(run_id,owner,reason) VALUES('closed','historical:job','manual')",
      )
      .run();
    await expect(
      releaseExpiredComparisonReferences(database, {
        runId: "closed",
        now: 100 + closedRunRetentionMs,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      database.connection
        .prepare(
          "SELECT run_id FROM work_retention_pins WHERE owner='comparison:comparison-closed'",
        )
        .get()?.run_id,
    ).toBe("seed");
  });
});

it("rebuilds eligible historical ancestry from direct proofs after intermediate cache eviction", async () => {
  using database = new TestDatabase();
  const service = new Service(database);
  await setup(service);
  await fixture(service, { id: "ancestor", kind: "pull_request", lineage: "pr" });
  await review(service, "comparison-ancestor");
  const source = (await service.comparisonRows("comparison-ancestor"))[0]?.decision_id;
  await fixture(service, {
    id: "middle",
    kind: "pull_request",
    lineage: "pr",
    related: ["ancestor"],
  });
  await service.retireRun({ runId: "middle", now: 100 });
  await compactRunHistory(database, await prepareArchive(service, "middle"));
  expect(
    database.connection
      .prepare("SELECT count(*) AS n FROM visonaut_lineage WHERE target_run_id='middle'")
      .get()?.n,
  ).toBe(0);
  expect(
    database.connection
      .prepare("SELECT source_run_id FROM visonaut_lineage_edges WHERE target_run_id='middle'")
      .get()?.source_run_id,
  ).toBe("ancestor");
  await fixture(service, {
    id: "target",
    kind: "pull_request",
    lineage: "pr",
    related: ["middle"],
  });
  const target = (await service.comparisonRows("comparison-target"))[0];
  const attributed = database.connection
    .prepare(
      "WITH RECURSIVE sources(id,source) AS(SELECT id,source_decision_id FROM visonaut_decisions WHERE id=? UNION ALL SELECT decision.id,decision.source_decision_id FROM visonaut_decisions decision JOIN sources ON decision.id=sources.source) SELECT 1 FROM sources WHERE source=?",
    )
    .get(target?.decision_id ?? "", source ?? "");
  expect(attributed).toBeTruthy();
  expect((await service.status("target")).status).toBe("passed");
});
it("resumes profile cutover after mapping commit and preserves approval reuse", async () => {
  using database = new TestDatabase();
  const service = new Service(database);
  await seed(service);
  const profile: CaptureProfile = {
    browser: "chromium",
    browserVersion: "1",
    osImageDigest: "a".repeat(64),
    fontsDigest: "b".repeat(64),
    viewport: { width: 498, height: 360 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezone: "UTC",
    reducedMotion: "no-preference",
    colorScheme: "light",
    contrast: "no-preference",
    forcedColors: "none",
    animationPolicy: "disabled",
    captureOptions: { type: "png", fullPage: false },
    comparisonPolicyDigest: "c".repeat(64),
    comparisonEngineVersion: "rgba-visible-1",
  };
  const fullDigest = await digestJson(profile);
  const renderingDigest = await digestRenderingProfile(profile);
  database.connection
    .prepare("INSERT INTO visonaut_capture_profiles(digest,profile_json) VALUES(?,?)")
    .run(fullDigest, canonicalJson(profile));
  await fixture(service, {
    id: "source",
    kind: "pull_request",
    lineage: "pr",
    color: "red",
    captureProfileDigest: fullDigest,
  });
  await review(service, "comparison-source");
  const row = (await service.comparisonRows("comparison-source"))[0];
  if (!row) throw new Error("Missing approval row.");
  const legacyTuple = JSON.parse(row.tuple_json);
  legacyTuple.candidateProfileDigest = fullDigest;
  delete legacyTuple.comparisonEngineVersion;
  delete legacyTuple.imageCodecVersion;
  const encodedLegacy = JSON.stringify(legacyTuple);
  database.connection
    .prepare("UPDATE visonaut_comparison_rows SET tuple_json=?,original_tuple_json=NULL WHERE id=?")
    .run(encodedLegacy, row.id);
  database.connection
    .prepare("UPDATE visonaut_decisions SET tuple_json=?,original_tuple_json=NULL WHERE id=?")
    .run(encodedLegacy, row.decision_id);
  database.connection
    .prepare("UPDATE visonaut_capture_profiles SET rendering_digest=NULL WHERE digest=?")
    .run(fullDigest);
  // Reset the old-state fixture after its initial comparison verified the profile.
  database.connection
    .prepare("DELETE FROM visonaut_policy_cutovers WHERE id=?")
    .run(`rendering-profile:${fullDigest}`);
  const originalBatch = database.batch.bind(database);
  const interrupted = vi
    .spyOn(database, "batch")
    .mockImplementationOnce(originalBatch)
    .mockRejectedValueOnce(new Error("Stopped after mapping commit."));
  await expect(service.convertRenderingProfiles("source", "snapshot-seed")).rejects.toThrow(
    "Stopped after mapping commit",
  );
  interrupted.mockRestore();
  expect(
    database.connection
      .prepare("SELECT rendering_digest FROM visonaut_capture_profiles WHERE digest=?")
      .get(fullDigest),
  ).toEqual({ rendering_digest: renderingDigest });
  expect((await service.comparisonRows("comparison-source"))[0]?.tuple_json).toBe(encodedLegacy);
  expect(
    database.connection
      .prepare("SELECT 1 FROM visonaut_policy_cutovers WHERE id=?")
      .get(`rendering-profile:${fullDigest}`),
  ).toBeUndefined();
  await service.convertRenderingProfiles("source", "snapshot-seed");
  expect(
    JSON.parse((await service.comparisonRows("comparison-source"))[0]?.tuple_json ?? "{}")
      .candidateProfileDigest,
  ).toBe(renderingDigest);
  expect(
    database.connection
      .prepare("SELECT original_tuple_json FROM visonaut_decisions WHERE id=?")
      .get(row.decision_id),
  ).toEqual({ original_tuple_json: encodedLegacy });
  expect(
    database.connection
      .prepare("SELECT 1 FROM visonaut_policy_cutovers WHERE id=?")
      .get(`rendering-profile:${fullDigest}`),
  ).toBeDefined();
  const repeatedConversionBatches = database.batchCalls;
  await service.convertRenderingProfiles("source", "snapshot-seed");
  expect(database.batchCalls - repeatedConversionBatches).toBe(0);
  await fixture(service, {
    id: "target",
    kind: "pull_request",
    lineage: "pr",
    color: "red",
    captureProfileDigest: fullDigest,
    related: ["source"],
  });
  expect((await service.status("target")).status).toBe("passed");
  const modernProfile = { ...profile };
  delete modernProfile.comparisonPolicyDigest;
  delete modernProfile.comparisonEngineVersion;
  const modernDigest = await digestJson(modernProfile);
  database.connection
    .prepare(
      "INSERT INTO visonaut_capture_profiles(digest,profile_json,rendering_digest) VALUES(?,?,?)",
    )
    .run(modernDigest, canonicalJson(modernProfile), modernDigest);
  await fixture(service, {
    id: "modern",
    kind: "pull_request",
    lineage: "pr",
    color: "red",
    captureProfileDigest: modernDigest,
    related: ["source"],
  });
  const batchesBeforeModernComparison = database.batchCalls;
  await service.convertRenderingProfiles("modern", "snapshot-seed");
  expect(database.batchCalls - batchesBeforeModernComparison).toBe(0);
});

it("publishes a closed current baseline check and fences a past promoted run", async () => {
  using database = new TestDatabase();
  const service = new Service(database);
  await seed(service);
  expect(
    (
      await service.prepareStatusIntent({
        runId: "seed",
        checkId: "check-seed",
        detailsUrl: "https://example.test/seed",
        maxAttempts: 2,
        now: 20,
      })
    ).conclusion,
  ).toBe("success");
  await fixture(service, { id: "next" });
  await review(service, "comparison-next");
  await promote(service, "next");
  expect((await service.status("seed")).status).toBe("passed");
  await expect(
    service.prepareStatusIntent({
      runId: "seed",
      checkId: "check-seed",
      detailsUrl: "https://example.test/seed",
      maxAttempts: 2,
      now: 21,
    }),
  ).rejects.toBeInstanceOf(ConflictError);
});

it("publishes no check for a closed run, whether it failed or was replaced", async () => {
  using database = new TestDatabase();
  const service = new Service(database);
  await seed(service);
  await fixture(service, { id: "replaced", kind: "pull_request", color: "red" });
  await fixture(service, { id: "expired", kind: "pull_request", color: "blue" });
  await service.retireRun({ runId: "replaced", now: 20 });
  database.connection
    .prepare("UPDATE visonaut_runs SET active=0,state='failed',closed_at=20 WHERE id='expired'")
    .run();
  expect((await service.status("replaced")).status).toBe("superseded");
  expect((await service.status("expired")).status).toBe("failed");
  // A closed run reports no failures and needs no audit read.
  expect(await service.status("expired")).not.toHaveProperty("failures");
  for (const runId of ["replaced", "expired"]) {
    await expect(
      service.prepareStatusIntent({
        runId,
        checkId: `check-${runId}`,
        detailsUrl: `https://example.test/${runId}`,
        maxAttempts: 2,
        now: 21,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  }
  expect(
    database.connection.prepare("SELECT count(*) AS count FROM visonaut_checks").get()?.count,
  ).toBe(0);
});

describe("closed stored-run recomparison", () => {
  async function closedFixture(service: Service) {
    await seed(service);
    await fixture(service, {
      id: "closed",
      kind: "pull_request",
      color: "red",
      items: ["dialog", "new-item"],
    });
    await service.retireRun({ runId: "closed", now: 20 });
  }

  async function historical(service: Service, id = "historical-closed") {
    return seedLegacyComparison(service, {
      id,
      runId: "closed",
      referenceSnapshotId: "snapshot-seed",
      purpose: "historical",
      now: 21,
      maxAttempts: 2,
    });
  }

  function liveAuthority(database: TestDatabase) {
    return [
      "visonaut_runs",
      "visonaut_projects",
      "visonaut_decisions",
      "visonaut_reservations",
      "visonaut_identity_history",
      "visonaut_promotions",
      "visonaut_status_outbox",
      "work_status_outbox",
      "work_checks",
    ].map((table) => database.connection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  }

  it("finalizes retained historical results without changing captures or live authority", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await closedFixture(service);
    const authority = liveAuthority(database);
    const original = await service.comparisonRows("comparison-closed");
    const comparison = await historical(service);
    expect(comparison.purpose).toBe("historical");
    const rows = await service.comparisonRows(comparison.id);
    expect(rows).toHaveLength(2);
    const taskRow = rows.find((row) => row.outcome === "pending");
    expect(taskRow).toBeDefined();
    if (!taskRow) throw new Error("Missing task");
    await seedLegacyResult(service, {
      taskId: taskRow.id,
      result: {
        outcome: "changed",
        changedPixels: 2,
        ratio: 0.02,
        engineVersion: "new-engine",
        codecVersion: "codec",
      },
    });
    expect(
      (await service.finalizeComparison({ comparisonId: comparison.id, now: 24 }))
        .reviewReadyTransitioned,
    ).toBe(false);
    expect((await service.comparison(comparison.id)).state).toBe("ready");
    expect(await service.comparisonRows("comparison-closed")).toEqual(original);
    expect(liveAuthority(database)).toEqual(authority);
    expect(
      (await service.comparisonRows(comparison.id)).every(
        (row) =>
          row.decision_id === null &&
          row.source_decision_id === null &&
          row.decision_revision === 0,
      ),
    ).toBe(true);
    await expect(review(service, comparison.id)).rejects.toThrow();
    await expect(
      service.preparePromotion({
        snapshotId: "historical-snapshot",
        comparisonId: comparison.id,
        prefix: "protected/history",
        now: 25,
      }),
    ).rejects.toThrow();
  });

  it("does not automatically accept retained historical additions", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await closedFixture(service);
    const comparison = await historical(service);
    const row = (await service.comparisonRows(comparison.id)).find(
      (candidate) => candidate.outcome === "pending",
    );
    if (!row) throw new Error("Missing task");
    const result = {
      outcome: "changed",
      changedPixels: 1,
      ratio: 0.01,
      engineVersion: "engine",
      codecVersion: "codec",
    } as const;
    await seedLegacyResult(service, { taskId: row.id, result });
    await service.finalizeComparison({ comparisonId: comparison.id, now: 27 });
    expect(
      (await service.comparisonRows(comparison.id)).find(
        (candidate) => candidate.item_key === "new-item",
      )?.decision_id,
    ).toBeNull();
  });

  it("reconciles a failed historical task without changing the live check", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await closedFixture(service);
    const authority = liveAuthority(database);
    const comparison = await historical(service);
    const row = (await service.comparisonRows(comparison.id)).find(
      (candidate) => candidate.outcome === "pending",
    );
    if (!row) throw new Error("Missing task");
    database.connection.prepare("UPDATE work_tasks SET state = 'dead' WHERE id = ?").run(row.id);
    const reconciled = await service.reconcileComparisons({ now: 30, limit: 100 });
    expect(reconciled.completed).toContain(comparison.id);
    expect((await service.comparison(comparison.id)).state).toBe("invalidated");
    expect(liveAuthority(database)).toEqual(authority);
  });
  it("invalidates retained historical results after their ancestor is revoked", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await closedFixture(service);
    const comparison = await historical(service);
    const row = (await service.comparisonRows(comparison.id)).find(
      (candidate) => candidate.outcome === "pending",
    );
    if (!row) throw new Error("Missing task");
    database.connection.exec(
      "UPDATE visonaut_snapshots SET reference_eligible=0,state='revoked' WHERE id='snapshot-seed'",
    );
    expect((await service.reconcileComparisons({ now: 24, limit: 100 })).completed).toContain(
      comparison.id,
    );
    expect((await service.comparison(comparison.id)).state).toBe("invalidated");
    expect(
      database.connection.prepare("SELECT state FROM work_tasks WHERE id=?").get(row.id),
    ).toEqual({ state: "dead" });
    expect(
      (await service.comparisonRows(comparison.id)).find((candidate) => candidate.id === row.id)
        ?.outcome,
    ).toBe("error");
  });
});

describe("forward-only cutover and run-owned approval migration", () => {
  it("converts valid live links and clears invalid links without erasing source decisions", async () => {
    using database = new TestDatabase("0023_pending_webhook_index.sql");
    const service = new Service(database);
    await setup(service);
    const tuple = JSON.stringify({
      projectId: "project",
      itemKey: "dialog",
      variantKey: "light",
      referenceDigest: "before",
      candidateDigest: "after",
      referenceProfileDigest: "profile",
      candidateProfileDigest: "profile",
      comparisonPolicyDigest: "policy",
    });
    for (const id of ["source", "valid", "invalid"]) {
      database.connection
        .prepare(
          "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,state,comparison_id,sealed_at,created_at) VALUES(?,'project',?,1,'pull_request',?,'pr','plan','{}','reviewing',?,1,1)",
        )
        .run(id, id, `sha-${id}`, `comparison-${id}`);
      database.connection
        .prepare(
          "INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,state,created_at) VALUES(?,?,0,'policy',1,'ready',1)",
        )
        .run(`comparison-${id}`, id);
      database.connection
        .prepare(
          "INSERT INTO visonaut_comparison_rows(id,comparison_id,item_key,variant_key,ordinal,tuple_json,outcome,decision_revision,decision_id,source_decision_id) VALUES(?,?,'dialog','light',0,?,'changed',1,?,?)",
        )
        .run(
          `row-${id}`,
          `comparison-${id}`,
          tuple,
          id === "source" ? "source-decision" : null,
          id === "source" ? null : "source-decision",
        );
    }
    database.connection
      .prepare(
        "INSERT INTO visonaut_decisions(id,row_id,revision,verdict,kind,actor_id,tuple_json,created_at) VALUES('source-decision','row-source',1,'approved','human','maintainer',?,1)",
      )
      .run(tuple);
    database.connection.exec("INSERT INTO visonaut_lineage VALUES('source','valid','verified');");
    database.connection.exec(
      readFileSync(
        new URL("../../../apps/web/migrations/0024_core_simplification.sql", import.meta.url),
        "utf8",
      ),
    );
    expect((await service.comparisonRows("comparison-valid"))[0]).toMatchObject({
      decision_id: "cutover:row-valid",
      source_decision_id: null,
      decision_revision: 2,
    });
    expect((await service.comparisonRows("comparison-invalid"))[0]).toMatchObject({
      decision_id: null,
      source_decision_id: null,
    });
    expect(
      database.connection
        .prepare(
          "SELECT actor_id,tuple_json,source_decision_id FROM visonaut_decisions WHERE id='cutover:row-valid'",
        )
        .get(),
    ).toEqual({ actor_id: "maintainer", tuple_json: tuple, source_decision_id: "source-decision" });
    database.connection.exec("UPDATE visonaut_decisions SET revoked=1 WHERE id='source-decision';");
    expect(await service.eligibleApprovalRowIds("comparison-valid")).toEqual(["row-valid"]);
    expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("fences promotion racing with session Undo and makes every promoted review read-only", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "next", color: "red" });
    const approval = await review(service, "comparison-next");
    const references = await service.preparePromotion({
      snapshotId: "snapshot-next",
      comparisonId: "comparison-next",
      prefix: "baselines/next",
      now: 10,
    });
    for (const image of references)
      await service.recordSnapshotCopy({
        snapshotId: "snapshot-next",
        captureId: image.capture_id,
        objectKey: image.object_key,
        digest: image.digest,
      });
    const outcomes = await Promise.allSettled([
      service.promote({
        snapshotId: "snapshot-next",
        promotionId: "promotion-next",
        expectedBaselineRevision: 1,
        now: 11,
      }),
      service.undo({
        commandId: approval.commandId,
        undoCommandId: "undo-race",
        actorId: "maintainer-1",
        sessionId: "session",
        expectedBaselineRevision: 1,
        now: 11,
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    if ((await service.run("next")).state === "accepted") {
      await expect(review(service, "comparison-next", { verdict: "rejected" })).rejects.toThrow(
        "read-only",
      );
      await expect(
        service.undo({
          commandId: approval.commandId,
          undoCommandId: "undo-after",
          actorId: "maintainer-1",
          sessionId: "session",
          expectedBaselineRevision: 2,
          now: 12,
        }),
      ).rejects.toThrow("read-only");
    } else {
      expect((await service.project("project")).snapshot_id).toBe("snapshot-seed");
      expect((await service.status("next")).status).toBe("needs-review");
    }
    expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
