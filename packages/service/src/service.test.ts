import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { compareImages } from "../../compare/src/compare.ts";
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
import { claimExpiredRun, closedRunRetentionMs } from "./work.ts";
import {
  archiveEligibilitySql,
  compactRunHistory,
  prepareArchivedCommandReplay,
} from "./history.ts";
import type { ComparisonResult, ReviewParams } from "./types.ts";

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

class TestDatabase implements Database {
  readonly connection = new DatabaseSync(":memory:");
  beforeBatch: (() => void) | null = null;
  preparedQueries = 0;
  constructor() {
    this.connection.exec(
      readFileSync(
        new URL("../../../apps/web/migrations/0001_service.sql", import.meta.url),
        "utf8",
      ),
    );
    this.connection.exec(
      readFileSync(new URL("../../../apps/web/migrations/0002_work.sql", import.meta.url), "utf8"),
    );
    this.connection.exec(
      readFileSync(
        new URL("../../../apps/web/migrations/0006_acceptance.sql", import.meta.url),
        "utf8",
      ),
    );
    for (const name of [
      "0005_operations.sql",
      "0009_retention_history.sql",
      "0010_run_history.sql",
      "0012_historical_comparisons.sql",
    ]) {
      this.connection.exec(
        readFileSync(new URL(`../../../apps/web/migrations/${name}`, import.meta.url), "utf8"),
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
}

async function fixture(service: Service, input: FixtureInput) {
  const project = await service.project("project");
  const items = input.items ?? ["dialog"];
  const snapshot = project.snapshot_id
    ? await service.database
        .prepare("SELECT tested_sha FROM ariviso_snapshots WHERE id = ?")
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
    await service.registerImage({
      id: `image-${input.id}-${item}`,
      runId: input.id,
      digest: `${item}-${input.color ?? "blue"}`,
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
      profileDigest: "profile",
      environmentProfileDigest: "profile",
      testId: "test",
      testRetry: 1,
      metadata: { name: itemKey },
    })),
    now: 2,
  });
  await service.sealRun({ runId: input.id, now: 3 });
  await service.createComparison({
    id: `comparison-${input.id}`,
    runId: input.id,
    referenceSnapshotId: project.snapshot_id,
    now: 4,
    maxAttempts: 3,
  });
  for (const row of await service.comparisonRows(`comparison-${input.id}`)) {
    if (row.outcome === "pending") {
      await service.claimComparisonTask({
        taskId: row.id,
        owner: "worker",
        now: 5,
        leaseMilliseconds: 100,
      });
      await service.commitComparisonResult({
        taskId: row.id,
        leaseOwner: "worker",
        result: input.compare
          ? input.compare(await service.getComparisonTask(row.id))
          : {
              outcome: "changed",
              changedPixels: 1,
              ratio: 0.01,
              engineVersion: "engine",
              codecVersion: "codec",
            },
        now: 5,
      });
    }
  }
  await service.finalizeComparison({ comparisonId: `comparison-${input.id}`, now: 6 });
  return `comparison-${input.id}`;
}

async function recompareFromSeed(service: Service, runId: string) {
  const comparisonId = `recomparison-${runId}-${crypto.randomUUID()}`;
  await service.createComparison({
    id: comparisonId,
    runId,
    referenceSnapshotId: "snapshot-seed",
    now: 12,
    maxAttempts: 3,
  });
  for (const row of await service.comparisonRows(comparisonId)) {
    if (row.outcome !== "pending") continue;
    await service.claimComparisonTask({
      taskId: row.id,
      owner: "worker",
      now: 13,
      leaseMilliseconds: 100,
    });
    await service.commitComparisonResult({
      taskId: row.id,
      leaseOwner: "worker",
      result: {
        outcome: "changed",
        changedPixels: 1,
        ratio: 0.01,
        engineVersion: "engine",
        codecVersion: "codec",
      },
      now: 13,
    });
  }
  await service.finalizeComparison({ comparisonId, now: 14 });
  return comparisonId;
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
  const copies = await service.preparePromotion({
    snapshotId: `snapshot-${runId}`,
    comparisonId: `comparison-${runId}`,
    prefix: `baselines/${runId}`,
    now: 10,
  });
  for (const copy of copies) {
    await service.recordSnapshotCopy({
      snapshotId: `snapshot-${runId}`,
      captureId: copy.capture_id,
      objectKey: copy.object_key,
      digest: copy.digest,
    });
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

describe("rejection of inherited acceptance", () => {
  it("blocks an existing related main candidate and Undo restores eligibility", async () => {
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
    expect((await service.status("merged")).status).toBe("needs-review");
    await expect(
      service.preparePromotion({
        snapshotId: "blocked",
        comparisonId: "comparison-merged",
        prefix: "baselines/blocked",
        now: 8,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
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
});

describe("full run and immutable comparison state", () => {
  it("seeds a fresh full main baseline automatically and keeps candidate bytes", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    expect((await service.project("project")).snapshot_id).toBe("snapshot-seed");
    expect((await service.status("seed")).status).toBe("passed");
    expect(
      database.connection.prepare("SELECT kind, actor_id FROM ariviso_decisions").get(),
    ).toMatchObject({ kind: "automatic", actor_id: null });
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
            objectKey: `baselines/${previous}/image-${previous}-dialog`,
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
    expect(count(database, "ariviso_commands")).toBe(0);
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
    expect(count(database, "ariviso_captures")).toBe(0);
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
    expect(count(database, "ariviso_promotions")).toBe(0);
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
    await fixture(service, { id: "pr", kind: "pull_request", color: "red" });
    await review(service, "comparison-pr");
    await fixture(service, { id: "unrelated", kind: "pull_request", color: "red" });
    expect((await service.status("unrelated")).status).toBe("needs-review");
    await fixture(service, { id: "merged", color: "red", related: ["pr"] });
    expect((await service.status("merged")).status).toBe("passed");
    const reused = await service.comparisonRows("comparison-merged");
    expect(reused[0]?.source_decision_id).toBeTruthy();
    expect(reused[0]?.decision_id).toBeNull();
  });

  it("invalidates reused acceptance after source rejection and refuses retry recreation", async () => {
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
    expect((await service.status("retry")).status).toBe("needs-review");
    await fixture(service, {
      id: "retry-again",
      kind: "pull_request",
      lineage: "pr-1",
      related: ["first", "retry"],
    });
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
    ).rejects.toThrow("protected");
    expect((await service.project("project")).snapshot_id).toBe("snapshot-remove");
  });
});

describe("atomic review, rollback, and session Undo", () => {
  it("aborts every write when a whole-item target changes during the SQL batch", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service, ["dialog", "menu"]);
    await fixture(service, { id: "changed", items: ["dialog", "menu"], color: "red" });
    const rows = await service.comparisonRows("comparison-changed");
    const second = rows[1];
    if (!second) throw new Error("Missing second target");
    const before = {
      audit: count(database, "ariviso_audit"),
      outbox: count(database, "ariviso_status_outbox"),
      decisions: count(database, "ariviso_decisions"),
    };
    database.beforeBatch = () => {
      database.connection
        .prepare(
          "UPDATE ariviso_comparison_rows SET decision_revision = decision_revision + 1 WHERE id = ?",
        )
        .run(second.id);
    };
    await expect(review(service, "comparison-changed")).rejects.toBeInstanceOf(ConflictError);
    expect(count(database, "ariviso_commands")).toBe(0);
    expect(count(database, "ariviso_audit")).toBe(before.audit);
    expect(count(database, "ariviso_status_outbox")).toBe(before.outbox);
    expect(count(database, "ariviso_decisions")).toBe(before.decisions);
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
    const replay = await review(service, "comparison-pr", options);
    expect(replay).toEqual(first);
    expect(count(database, "ariviso_commands")).toBe(1);
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

  it("D22 rolls back the current human promotion and revokes acceptance", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "red", color: "red" });
    const approval = await review(service, "comparison-red");
    await promote(service, "red");
    await service.undo({
      commandId: approval.commandId,
      undoCommandId: "undo",
      actorId: "maintainer-1",
      sessionId: "session",
      expectedBaselineRevision: 2,
      now: 20,
    });
    expect((await service.project("project")).snapshot_id).toBe("snapshot-seed");
    expect((await service.status("red")).status).toBe("needs-review");
    expect(
      database.connection
        .prepare("SELECT reference_eligible FROM ariviso_snapshots WHERE id = 'snapshot-red'")
        .get()?.reference_eligible,
    ).toBe(0);
  });

  it("D26 reject after reload and its Undo restore verdict and a new promotion atomically", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "red", color: "red" });
    await review(service, "comparison-red");
    await promote(service, "red");
    const rejected = await review(service, "comparison-red", {
      verdict: "rejected",
      actorId: "maintainer-2",
      sessionId: "after-reload",
      expectedPromotionId: "promotion-red",
      expectedBaselineRevision: 2,
    });
    expect((await service.project("project")).baseline_revision).toBe(3);
    const restored = await service.undo({
      commandId: rejected.commandId,
      undoCommandId: "restore",
      actorId: "maintainer-2",
      sessionId: "after-reload",
      expectedBaselineRevision: 3,
      now: 30,
    });
    expect((await service.project("project")).snapshot_id).toBe("snapshot-red");
    expect(restored.promotionId).not.toBe("promotion-red");
    expect(restored.baselineRevision).toBe(4);
    expect((await service.status("red")).status).toBe("passed");
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
    const before = count(database, "ariviso_audit");
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
    expect(count(database, "ariviso_audit")).toBe(before);
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
    expect(exact?.source_decision_id).toBeTruthy();
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
          "SELECT source_run_id, source_attempt FROM ariviso_shards WHERE run_id = 'inherited'",
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
        .prepare("SELECT source_attempt FROM ariviso_shards WHERE run_id = 'inherited-again'")
        .get()?.source_attempt,
    ).toBe(1);
    await service.reserveRun({ ...reserve, id: "rerun", attempt: 4, rerunShardKeys: ["chromium"] });
    await expect(service.sealRun({ runId: "rerun", now: 12 })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(
      database.connection
        .prepare("SELECT count(*) AS count FROM ariviso_captures WHERE run_id = 'rerun'")
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
          .prepare("SELECT * FROM ariviso_captures WHERE run_id = ? ORDER BY shard_key, ordinal")
          .all(runId);
      const originalCaptures = (runId: string) =>
        database.connection
          .prepare(
            "SELECT capture.shard_key, capture.item_key, capture.variant_key, capture.image_id, capture.profile_digest, capture.test_id, capture.test_retry, capture.metadata_json, image.run_id AS image_run_id FROM ariviso_captures capture JOIN ariviso_images image ON image.id = capture.image_id WHERE capture.run_id = ? AND capture.shard_key != 'firefox' ORDER BY capture.shard_key, capture.ordinal",
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
              "SELECT key, source_run_id, source_attempt, manifest_digest, full_profile_digest FROM ariviso_shards WHERE run_id = ? AND key != 'firefox' ORDER BY key",
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
              "SELECT capture.item_key, capture.variant_key, capture.ordinal, image.run_id AS image_run_id FROM ariviso_captures capture JOIN ariviso_images image ON image.id = capture.image_id WHERE capture.run_id = ? ORDER BY capture.ordinal",
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
      await service.createComparison({
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

  it("blocks source Undo after related main promotion", async () => {
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
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await service.status("main")).status).toBe("passed");
    expect((await service.project("project")).snapshot_id).toBe("snapshot-main");
  });

  it("rolls back a mixed snapshot without revoking its automatic additions", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "mixed", items: ["dialog", "menu"], color: "red" });
    const rows = await service.comparisonRows("comparison-mixed");
    const changed = rows.find((row) => row.item_key === "dialog");
    const added = rows.find((row) => row.item_key === "menu");
    if (!changed || !added) throw new Error("Missing mixed variants");
    await review(service, "comparison-mixed", {
      targets: [{ id: changed.id, expectedRevision: 0 }],
    });
    await promote(service, "mixed");
    await review(service, "comparison-mixed", {
      verdict: "rejected",
      targets: [{ id: changed.id, expectedRevision: 1 }],
      expectedPromotionId: "promotion-mixed",
      expectedBaselineRevision: 2,
    });
    expect((await service.project("project")).snapshot_id).toBe("snapshot-seed");
    expect(
      database.connection
        .prepare("SELECT revoked FROM ariviso_decisions WHERE id = ?")
        .get(added.decision_id)?.revoked,
    ).toBe(0);
  });

  it("invalidates queued success in the same rejection transaction", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, { id: "pr", kind: "pull_request" });
    const prepared = await service.prepareStatusIntent({
      runId: "pr",
      checkId: "external-check",
      detailsUrl: "https://ariviso.example/runs/pr",
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
      detailsUrl: "https://ariviso.example/runs/pr",
      maxAttempts: 3,
      now: 11,
    });
    expect(fresh.conclusion).toBe("failure");
    expect(fresh.revision).toBe(desired);
  });

  it("does not revive an invalidated comparison in place", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "pr", kind: "pull_request", color: "red" });
    await review(service, "comparison-pr");
    await fixture(service, { id: "main", color: "red", related: ["pr"] });
    await promote(service, "main");
    await expect(
      service.finalizeComparison({ comparisonId: "comparison-pr", now: 20 }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await service.comparison("comparison-pr")).state).toBe("invalidated");
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
    await service.createComparison({
      id: "comparison-expanded",
      runId: "expanded",
      referenceSnapshotId: null,
      now: 4,
      maxAttempts: 3,
    });
    await service.finalizeComparison({ comparisonId: "comparison-expanded", now: 5 });
    expect((await service.status("expanded")).status).toBe("passed");
    expect(count(database, "ariviso_comparison_rows")).toBe(10_580);
    expect(count(database, "ariviso_decisions")).toBe(10_580);
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
    await service.createComparison({
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
    await service.claimComparisonTask({
      taskId: kept.id,
      owner: "worker",
      now: 25,
      leaseMilliseconds: 100,
    });
    await service.commitComparisonResult({
      taskId: kept.id,
      leaseOwner: "worker",
      result: {
        outcome: "unchanged",
        changedPixels: 0,
        ratio: 0,
        engineVersion: "engine",
        codecVersion: "codec",
      },
      now: 26,
    });
    await service.finalizeComparison({ comparisonId: "comparison-discovered", now: 27 });
    expect((await service.status("discovered")).status).toBe("passed");
    const rows = await service.comparisonRows("comparison-discovered");
    expect(rows.find((row) => row.item_key === "new")?.reference_capture_id).toBeNull();
    expect(rows.find((row) => row.item_key === "menu")?.candidate_capture_id).toBeNull();
    expect(
      database.connection
        .prepare("SELECT discovery_json FROM ariviso_shards WHERE run_id = 'discovered'")
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
    const before = count(database, "ariviso_audit");
    database.beforeBatch = () => {
      database.connection
        .prepare(
          "UPDATE ariviso_comparisons SET state = 'invalidated' WHERE id = 'comparison-changed-evidence'",
        )
        .run();
    };
    await expect(review(service, "comparison-changed-evidence")).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(count(database, "ariviso_commands")).toBe(0);
    expect(count(database, "ariviso_audit")).toBe(before);
  });
});

describe("interrupted protected snapshot copy", () => {
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
    const auditCount = count(database, "ariviso_audit");
    await service.failRun({ runId: "failed", reason: "Repeated notification", now: 3 });
    expect(count(database, "ariviso_audit")).toBe(auditCount);
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
      database.connection.prepare("SELECT state FROM ariviso_shards WHERE run_id = 'failed'").get()
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

  it("rejects a baseline revision observed before asynchronous ancestry verification", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "pr-ancestry", kind: "pull_request", color: "red" });
    const before = count(database, "ariviso_comparisons");
    await expect(
      service.createComparison({
        id: "stale-ancestry",
        runId: "pr-ancestry",
        referenceSnapshotId: "snapshot-seed",
        expectedBaselineRevision: 0,
        maxAttempts: 3,
        now: 20,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(count(database, "ariviso_comparisons")).toBe(before);
    expect((await service.run("pr-ancestry")).comparison_id).toBe("comparison-pr-ancestry");
  });

  it("projects inherited approval eligibility using related rejection vetoes", async () => {
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
    expect(await service.eligibleApprovalRowIds("comparison-candidate-main")).toEqual([]);
  });
});

describe("acceptance replacement boundaries", () => {
  it("keeps an ancestor acceptance blocked when an intermediate human approval is undone", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, { id: "ancestor", kind: "pull_request", lineage: "pr" });
    await fixture(service, {
      id: "human",
      kind: "pull_request",
      lineage: "pr",
      related: ["ancestor"],
    });
    const approval = await review(service, "comparison-human");
    await fixture(service, {
      id: "rejection",
      kind: "pull_request",
      lineage: "pr",
      related: ["ancestor", "human"],
    });
    await review(service, "comparison-rejection", { verdict: "rejected" });
    const replacements = database.connection
      .prepare(
        "SELECT * FROM ariviso_decision_replacements ORDER BY source_decision_id, replacement_decision_id, scope_run_id",
      )
      .all();
    database.connection.exec("DROP TABLE ariviso_decision_replacements");
    database.connection.exec(
      readFileSync(
        new URL("../../../apps/web/migrations/0006_acceptance.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(
      database.connection
        .prepare(
          "SELECT * FROM ariviso_decision_replacements ORDER BY source_decision_id, replacement_decision_id, scope_run_id",
        )
        .all(),
    ).toEqual(replacements);
    await service.undo({
      commandId: approval.commandId,
      undoCommandId: "undo-intermediate",
      actorId: "maintainer-1",
      sessionId: "session",
      expectedBaselineRevision: 0,
      now: 8,
    });
    expect((await service.status("human")).status).toBe("needs-review");
    await fixture(service, {
      id: "retry",
      kind: "pull_request",
      lineage: "pr",
      related: ["ancestor", "human", "rejection"],
    });
    expect((await service.status("retry")).status).toBe("needs-review");
  });

  it("protects a restored baseline even when its current promotion pointer is null", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "introduced", items: ["dialog", "menu"] });
    const [initialDialog] = (await service.comparisonRows("comparison-introduced")).filter(
      (row) => row.item_key === "dialog",
    );
    if (!initialDialog) throw new Error("Missing initial dialog comparison");
    await review(service, "comparison-introduced", {
      targets: [{ id: initialDialog.id, expectedRevision: initialDialog.decision_revision }],
    });
    await promote(service, "introduced");
    await fixture(service, { id: "removed", color: "red" });
    const [dialog] = (await service.comparisonRows("comparison-removed")).filter(
      (row) => row.item_key === "dialog",
    );
    if (!dialog) throw new Error("Missing dialog comparison");
    await review(service, "comparison-removed", {
      targets: [{ id: dialog.id, expectedRevision: dialog.decision_revision }],
    });
    await promote(service, "removed");
    await fixture(service, {
      id: "pending",
      kind: "pull_request",
      lineage: "pr",
      items: ["dialog", "menu"],
      related: ["introduced"],
      ancestorShas: ["sha-seed"],
    });
    const pendingComparison = await recompareFromSeed(service, "pending");
    await review(service, "comparison-removed", {
      verdict: "rejected",
      targets: [{ id: dialog.id, expectedRevision: dialog.decision_revision + 1 }],
      expectedPromotionId: "promotion-removed",
      expectedBaselineRevision: 3,
    });
    const project = await service.project("project");
    expect(project.snapshot_id).toBe("snapshot-introduced");
    expect(project.promotion_id).toBeNull();
    const [menu] = (await service.comparisonRows(pendingComparison)).filter(
      (row) => row.item_key === "menu",
    );
    if (!menu) throw new Error("Missing menu comparison");
    await expect(
      review(service, pendingComparison, {
        verdict: "rejected",
        targets: [{ id: menu.id, expectedRevision: menu.decision_revision }],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await service.project("project")).toEqual(project);
  });

  it("accepts fresh human approval after an exact inherited rejection and reuses its revision", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "source", kind: "pull_request", lineage: "pr", color: "red" });
    await review(service, "comparison-source");
    await fixture(service, {
      id: "rejected",
      kind: "pull_request",
      lineage: "pr",
      color: "red",
      related: ["source"],
    });
    await review(service, "comparison-rejected", { verdict: "rejected" });
    await fixture(service, {
      id: "fresh",
      kind: "pull_request",
      lineage: "pr",
      color: "red",
      related: ["source", "rejected"],
    });
    expect((await service.status("fresh")).status).toBe("needs-review");
    await review(service, "comparison-fresh");
    const [approved] = await service.comparisonRows("comparison-fresh");
    expect((await service.status("fresh")).status).toBe("passed");
    expect(await service.eligibleApprovalRowIds("comparison-fresh")).toEqual([approved?.id]);
    await fixture(service, { id: "main", color: "red", related: ["source", "rejected", "fresh"] });
    expect((await service.comparisonRows("comparison-main"))[0]?.source_decision_id).toBe(
      approved?.decision_id,
    );
    await promote(service, "main");
    expect((await service.status("main")).status).toBe("passed");
  });

  it("refuses inherited rejection that would invalidate a current promoted dependent atomically", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "source", kind: "pull_request", lineage: "pr", color: "red" });
    await review(service, "comparison-source");
    await fixture(service, {
      id: "retry",
      kind: "pull_request",
      lineage: "pr",
      color: "red",
      related: ["source"],
    });
    await fixture(service, { id: "main", color: "red", related: ["source", "retry"] });
    await promote(service, "main");
    const retryComparison = await recompareFromSeed(service, "retry");
    const project = await service.project("project");
    const rows = await service.comparisonRows(retryComparison);
    const audits = count(database, "ariviso_audit");
    const commands = count(database, "ariviso_commands");
    await expect(review(service, retryComparison, { verdict: "rejected" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await service.project("project")).toEqual(project);
    expect(await service.comparisonRows(retryComparison)).toEqual(rows);
    expect(count(database, "ariviso_audit")).toBe(audits);
    expect(count(database, "ariviso_commands")).toBe(commands);
    expect((await service.status("main")).status).toBe("passed");
  });

  it("keeps D26 inherited rejection local to the promoted comparison", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await seed(service);
    await fixture(service, { id: "source", kind: "pull_request", lineage: "pr", color: "red" });
    await review(service, "comparison-source");
    await fixture(service, { id: "main", color: "red", related: ["source"] });
    await fixture(service, {
      id: "other",
      kind: "pull_request",
      lineage: "other-pr",
      color: "red",
      related: ["source"],
    });
    await promote(service, "main");
    await recompareFromSeed(service, "other");
    await review(service, "comparison-main", {
      verdict: "rejected",
      expectedPromotionId: "promotion-main",
      expectedBaselineRevision: 2,
    });
    expect((await service.status("main")).status).toBe("rejected");
    await recompareFromSeed(service, "other");
    expect((await service.status("other")).status).toBe("passed");
    expect((await service.project("project")).snapshot_id).toBe("snapshot-seed");
    await fixture(service, { id: "related-main-retry", color: "red", related: ["source", "main"] });
    expect((await service.status("related-main-retry")).status).toBe("needs-review");
    await review(service, "comparison-related-main-retry");
    expect((await service.status("related-main-retry")).status).toBe("passed");
  });

  it("does not recover an older automatic source after a promoted human replacement is rejected", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, { id: "automatic", kind: "pull_request", lineage: "pr" });
    await fixture(service, { id: "main", related: ["automatic"] });
    await review(service, "comparison-main");
    await promote(service, "main");
    await review(service, "comparison-main", {
      verdict: "rejected",
      expectedPromotionId: "promotion-main",
      expectedBaselineRevision: 1,
    });
    await fixture(service, { id: "retry", related: ["automatic", "main"] });
    expect((await service.status("retry")).status).toBe("needs-review");
    await fixture(service, {
      id: "unrelated",
      kind: "pull_request",
      lineage: "other",
      related: ["automatic"],
    });
    expect((await service.status("unrelated")).status).toBe("passed");
  });

  it("preserves a rejected automatic reservation until fresh human approval, including Undo", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, { id: "automatic", kind: "pull_request", lineage: "pr" });
    await fixture(service, {
      id: "rejected",
      kind: "pull_request",
      lineage: "pr",
      related: ["automatic"],
    });
    await review(service, "comparison-rejected", { verdict: "rejected" });
    await fixture(service, {
      id: "retry",
      kind: "pull_request",
      lineage: "pr",
      related: ["automatic", "rejected"],
    });
    expect((await service.status("retry")).status).toBe("needs-review");
    const approval = await review(service, "comparison-rejected");
    expect((await service.status("rejected")).status).toBe("passed");
    expect((await service.status("automatic")).status).toBe("needs-review");
    const replacements = database.connection
      .prepare(
        "SELECT * FROM ariviso_decision_replacements ORDER BY source_decision_id, replacement_decision_id, scope_run_id",
      )
      .all();
    database.connection.exec("DROP TABLE ariviso_decision_replacements");
    database.connection.exec(
      readFileSync(
        new URL("../../../apps/web/migrations/0006_acceptance.sql", import.meta.url),
        "utf8",
      ),
    );
    expect(
      database.connection
        .prepare(
          "SELECT * FROM ariviso_decision_replacements ORDER BY source_decision_id, replacement_decision_id, scope_run_id",
        )
        .all(),
    ).toEqual(replacements);
    await service.undo({
      commandId: approval.commandId,
      undoCommandId: "undo-fresh",
      actorId: "maintainer-1",
      sessionId: "session",
      expectedBaselineRevision: 0,
      now: 8,
    });
    expect((await service.status("rejected")).status).toBe("rejected");
    expect((await service.status("automatic")).status).toBe("needs-review");
    await fixture(service, {
      id: "last",
      kind: "pull_request",
      lineage: "pr",
      related: ["automatic", "rejected", "retry"],
    });
    expect((await service.status("last")).status).toBe("needs-review");
    expect(count(database, "ariviso_reservations")).toBe(1);
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
        .prepare("SELECT snapshot_id FROM ariviso_pins WHERE owner_id='comparison-dependent'")
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
      "SELECT command.id,command.request_json FROM ariviso_commands command JOIN ariviso_comparisons comparison ON comparison.id=command.comparison_id WHERE comparison.run_id=?",
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
      .prepare("SELECT request_json FROM ariviso_commands WHERE id=?")
      .get(saved.commandId);
    const request = JSON.parse(String(command?.request_json));
    const decisions = database.connection
      .prepare("SELECT * FROM ariviso_decisions ORDER BY id")
      .all();
    await service.retireRun({ runId: "source", now: 100 });
    await compactRunHistory(database, await prepareArchive(service, "source"));
    expect(
      database.connection.prepare("SELECT * FROM ariviso_decisions ORDER BY id").all(),
    ).toEqual(decisions);
    expect(
      database.connection
        .prepare("SELECT count(*) AS n FROM ariviso_captures WHERE run_id='source'")
        .get()?.n,
    ).toBe(0);
    expect(
      database.connection
        .prepare("SELECT count(*) AS n FROM ariviso_images WHERE run_id='source'")
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
    expect((await service.comparisonRows("comparison-related"))[0]?.source_decision_id).toBe(
      (decisions.find((decision) => decision.kind === "human") as { id: string }).id,
    );
    expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("rolls back every prune when a recovery reference appears before commit", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await setup(service);
    await fixture(service, { id: "source", kind: "pull_request" });
    await service.retireRun({ runId: "source", now: 100 });
    const input = await prepareArchive(service, "source");
    const captures = database.connection.prepare("SELECT * FROM ariviso_captures").all();
    database.beforeBatch = () => {
      database.connection
        .prepare(
          "INSERT INTO work_retention_pins(run_id,owner,reason) VALUES('source','new-backup','recovery')",
        )
        .run();
    };
    await expect(compactRunHistory(database, input)).rejects.toBeInstanceOf(ConflictError);
    expect(database.connection.prepare("SELECT * FROM ariviso_captures").all()).toEqual(captures);
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
    database.connection.exec("UPDATE ariviso_runs SET active=0,closed_at=100");
    const candidates = database.connection
      .prepare(`SELECT run.id FROM ariviso_runs run WHERE ${archiveEligibilitySql("run")}`)
      .all();
    expect(candidates).toEqual([]);
  });
});

describe("bounded snapshot evidence roots", () => {
  it("reclaims an inherited source image after the final protected retry copy expires", async () => {
    using database = new TestDatabase();
    database.connection.exec(`
      INSERT INTO ariviso_projects(id,repository_id,policy_digest) VALUES('p','repo','policy');
      INSERT INTO ariviso_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,active,closed_at,detail_archived,created_at) VALUES
        ('source','p','w',1,'main','sha','main','plan','{}',0,1,1,0),
        ('retry','p','w',2,'main','sha','main','plan','{}',0,1,1,0);
      INSERT INTO work_retained_runs(id,object_prefix,closed_at) VALUES('source','runs/source/',1),('retry','runs/retry/',1);
      INSERT INTO ariviso_shards(run_id,key,profile_digest,expected_json) VALUES('retry','shard','profile','{}');
      INSERT INTO ariviso_images(id,run_id,digest,object_key,content_type,bytes,width,height) VALUES('source-image','source','digest','runs/source/image','image/png',80,10,10);
      INSERT INTO ariviso_captures(id,run_id,shard_key,item_key,variant_key,ordinal,image_id,profile_digest,test_id,test_retry,metadata_json) VALUES('retry-capture','retry','shard','item','variant',0,'source-image','profile','test',0,'{}');
      INSERT INTO ariviso_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,created_at) VALUES('comparison','retry',0,'policy',1,0);
      INSERT INTO ariviso_snapshots(id,project_id,run_id,comparison_id,tested_sha,prefix,state,created_at) VALUES('snapshot','p','retry','comparison','sha','baselines/retry','accepted',0);
      INSERT INTO ariviso_snapshot_images(snapshot_id,capture_id,image_id,object_key,digest,copied) VALUES('snapshot','retry-capture','source-image','baselines/retry/image','digest',1);
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
    expect(count(database, "ariviso_images")).toBe(1);
    database.connection
      .prepare(
        "UPDATE ariviso_snapshot_retention SET byte_state='deleting',lease_token='snapshot-delete',lease_until=? WHERE snapshot_id='snapshot'",
      )
      .run(now + 100);
    await completeRetiredSnapshotDeletion(database, {
      snapshotId: "snapshot",
      token: "snapshot-delete",
      now: now + 2,
    });
    expect(count(database, "ariviso_captures")).toBe(0);
    expect(count(database, "ariviso_images")).toBe(0);
    expect(database.connection.prepare("SELECT byte_state FROM work_retained_runs").all()).toEqual([
      { byte_state: "deleted" },
      { byte_state: "deleted" },
    ]);
    expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("keeps current and rollback bytes while expiring an older reference without an infinite predecessor chain", async () => {
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
    await expect(
      retireSnapshot(database, { snapshotId: "snapshot-second", now: 100, graceMs: 10 }),
    ).rejects.toBeInstanceOf(ConflictError);
    await retireSnapshot(database, { snapshotId: "snapshot-seed", now: 100, graceMs: 10 });
    expect(
      database.connection
        .prepare("SELECT reference_eligible FROM ariviso_snapshots WHERE id='snapshot-seed'")
        .get()?.reference_eligible,
    ).toBe(0);
    expect(() =>
      database.connection
        .prepare(
          "INSERT INTO ariviso_pins(snapshot_id,reason,owner_id) VALUES('snapshot-seed','comparison','late')",
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
    ).toBe("second");
    database.connection
      .prepare(
        "INSERT INTO operations_backups(id,state,created_at) VALUES('active-backup','copying',?)",
      )
      .run(expires);
    expect(
      await claimRetiredSnapshotDeletion(database, {
        snapshotId: "snapshot-seed",
        token: "during-backup",
        now: expires,
        leaseMs: 100,
      }),
    ).toBeNull();
    database.connection
      .prepare("UPDATE operations_backups SET state='complete' WHERE id='active-backup'")
      .run();
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
          "SELECT count(*) AS n FROM ariviso_snapshot_images WHERE snapshot_id='snapshot-seed'",
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
          "SELECT count(*) AS n FROM ariviso_snapshot_images WHERE snapshot_id='snapshot-seed'",
        )
        .get()?.n,
    ).toBe(0);
    expect(
      database.connection
        .prepare(
          "SELECT count(*) AS n FROM ariviso_snapshot_images WHERE snapshot_id IN ('snapshot-second','snapshot-third')",
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
      .prepare("SELECT count(*) AS n FROM ariviso_lineage WHERE target_run_id='middle'")
      .get()?.n,
  ).toBe(0);
  expect(
    database.connection
      .prepare("SELECT source_run_id FROM ariviso_lineage_edges WHERE target_run_id='middle'")
      .get()?.source_run_id,
  ).toBe("ancestor");
  await fixture(service, {
    id: "target",
    kind: "pull_request",
    lineage: "pr",
    related: ["middle"],
  });
  expect((await service.comparisonRows("comparison-target"))[0]?.source_decision_id).toBe(source);
  expect((await service.status("target")).status).toBe("passed");
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
    return service.createComparison({
      id,
      runId: "closed",
      referenceSnapshotId: "snapshot-seed",
      purpose: "historical",
      expectedCaptureCount: 2,
      now: 21,
      maxAttempts: 2,
    });
  }

  function liveAuthority(database: TestDatabase) {
    return [
      "ariviso_runs",
      "ariviso_projects",
      "ariviso_decisions",
      "ariviso_reservations",
      "ariviso_identity_history",
      "ariviso_promotions",
      "ariviso_status_outbox",
      "work_status_outbox",
      "work_checks",
    ].map((table) => database.connection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  }

  it("recompares a closed stored run without capture or live authority changes", async () => {
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
    const task = await service.claimComparisonTask({
      taskId: taskRow.id,
      owner: "history-worker",
      now: 22,
      leaseMilliseconds: 100,
    });
    expect(task?.candidate?.objectKey).toBe("runs/closed/dialog");
    expect(task?.reference?.objectKey).toContain("baselines/seed");
    await service.commitComparisonResult({
      taskId: taskRow.id,
      leaseOwner: "history-worker",
      now: 23,
      result: {
        outcome: "changed",
        changedPixels: 2,
        ratio: 0.02,
        engineVersion: "new-engine",
        codecVersion: "codec",
      },
    });
    await service.finalizeComparison({ comparisonId: comparison.id, now: 24 });
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

  it("rejects expired candidates and retirement races before creating any comparison", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await closedFixture(service);
    database.connection.exec("UPDATE ariviso_images SET bytes_present = 0 WHERE run_id = 'closed'");
    await expect(historical(service)).rejects.toThrow();
    expect(
      database.connection
        .prepare("SELECT id FROM ariviso_comparisons WHERE purpose = 'historical'")
        .all(),
    ).toEqual([]);
    database.connection.exec("UPDATE ariviso_images SET bytes_present = 1 WHERE run_id = 'closed'");
    database.beforeBatch = () =>
      database.connection.exec(
        "UPDATE ariviso_snapshots SET reference_eligible = 0 WHERE id = 'snapshot-seed'",
      );
    await expect(historical(service)).rejects.toThrow();
    expect(
      database.connection
        .prepare("SELECT id FROM ariviso_comparisons WHERE purpose = 'historical'")
        .all(),
    ).toEqual([]);
  });

  it("fences stale workers and does not automatically accept historical additions", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await closedFixture(service);
    const comparison = await historical(service);
    await expect(historical(service, "concurrent-history")).rejects.toThrow();
    const row = (await service.comparisonRows(comparison.id)).find(
      (candidate) => candidate.outcome === "pending",
    );
    if (!row) throw new Error("Missing task");
    await service.claimComparisonTask({
      taskId: row.id,
      owner: "old",
      now: 22,
      leaseMilliseconds: 2,
    });
    await service.claimComparisonTask({
      taskId: row.id,
      owner: "new",
      now: 25,
      leaseMilliseconds: 100,
    });
    const result = {
      outcome: "changed",
      changedPixels: 1,
      ratio: 0.01,
      engineVersion: "engine",
      codecVersion: "codec",
    } as const;
    await expect(
      service.commitComparisonResult({ taskId: row.id, leaseOwner: "old", now: 26, result }),
    ).rejects.toThrow();
    await service.commitComparisonResult({ taskId: row.id, leaseOwner: "new", now: 26, result });
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
  it("fails a historical job if its ancestor is revoked while its worker is running", async () => {
    using database = new TestDatabase();
    const service = new Service(database);
    await closedFixture(service);
    const comparison = await historical(service);
    const row = (await service.comparisonRows(comparison.id)).find(
      (candidate) => candidate.outcome === "pending",
    );
    if (!row) throw new Error("Missing task");
    await service.claimComparisonTask({
      taskId: row.id,
      owner: "worker",
      now: 22,
      leaseMilliseconds: 100,
    });
    database.connection.exec(
      "UPDATE ariviso_snapshots SET reference_eligible=0,state='revoked' WHERE id='snapshot-seed'",
    );
    await expect(
      service.commitComparisonResult({
        taskId: row.id,
        leaseOwner: "worker",
        now: 23,
        result: {
          outcome: "unchanged",
          changedPixels: 0,
          ratio: 0,
          engineVersion: "engine",
          codecVersion: "codec",
        },
      }),
    ).rejects.toThrow();
    expect((await service.reconcileComparisons({ now: 24, limit: 100 })).completed).toContain(
      comparison.id,
    );
    expect((await service.comparison(comparison.id)).state).toBe("invalidated");
    expect((await service.getComparisonTaskState(row.id)).state).toBe("dead");
    expect(
      (await service.comparisonRows(comparison.id)).find((candidate) => candidate.id === row.id)
        ?.outcome,
    ).toBe("error");
  });
});
