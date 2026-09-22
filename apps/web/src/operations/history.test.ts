import { readFile } from "node:fs/promises";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { retentionPinStatement } from "@ariviso/service";
import { captured, context, digest, MemoryStore, TestDatabase } from "./test-fixtures.ts";
import {
  archiveClosedRuns,
  readHistoryManifest,
  readRunHistory,
  type HistoryProgress,
} from "./history.ts";
import { historyPrefix, historySections } from "./history-format.ts";
import { createRunExport, streamRunExport } from "./exports.ts";
import { expireRunImages } from "./retention.ts";
import {
  archiveHistoricalComparisons,
  readArchivedComparison,
  readComparisonHistoryManifest,
} from "./history-supplement.ts";
import { publicImage } from "../api/images.ts";
import type { ApiContext } from "../api/context.ts";
import type { ObjectStore, OperationsContext } from "./types.ts";

let runtime: Miniflare;
let operations: OperationsContext;
let fixture: ReturnType<typeof context>;
let fixtureDatabase: TestDatabase;
beforeEach(async () => {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      compatibilityDate: "2026-09-22",
      d1Databases: ["DB"],
      r2Buckets: ["IMAGES", "QUARANTINE", "BACKUPS"],
    }),
  );
  const database = await runtime.getD1Database("DB");
  for (const name of [
    "0001_service",
    "0002_work",
    "0003_auth",
    "0004_ingest",
    "0005_operations",
    "0006_acceptance",
    "0007_backup_inventory",
    "0008_capture_profiles",
    "0009_retention_history",
    "0010_run_history",
    "0012_historical_comparisons",
  ]) {
    const source = (
      await readFile(new URL(`../../migrations/${name}.sql`, import.meta.url), "utf8")
    ).replace(/^--.*$/gm, "");
    let query = "";
    for (const line of source.split("\n")) {
      query += `${line}\n`;
      if (!line.trimEnd().endsWith(";")) continue;
      await database.prepare(query).run();
      query = "";
    }
  }
  fixtureDatabase = new TestDatabase();
  fixture = context(fixtureDatabase);
  operations = {
    ...fixture.context,
    database,
    // Miniflare returns the native binding through an RPC proxy type.
    images: (await runtime.getR2Bucket("IMAGES")) as ObjectStore,
    quarantine: (await runtime.getR2Bucket("QUARANTINE")) as ObjectStore,
    backups: (await runtime.getR2Bucket("BACKUPS")) as ObjectStore,
  };
  operations.budget.objectsPerStep = 2;
});
afterEach(async () => {
  fixtureDatabase?.[Symbol.dispose]();
  await runtime?.dispose();
});

async function closed(runId = "run") {
  const service = await captured(operations, runId);
  await service.retireRun({ runId, now: operations.now() });
  return service;
}
async function finish(runId = "run") {
  for (let step = 0; step < 50; step++) {
    const report = await archiveClosedRuns(operations);
    if (report.attention.length) throw new Error(`Archive failed: ${report.attention.join()}`);
    if (report.completed.includes(runId)) return;
  }
  throw new Error("Archive did not complete.");
}
async function detailCount(runId = "run") {
  return operations.database
    .prepare("SELECT COUNT(*) AS count FROM ariviso_captures WHERE run_id=?")
    .bind(runId)
    .first<{ count: number }>();
}

async function historical(archiveSource = true) {
  await closed();
  const captured = await operations.database
    .prepare("SELECT * FROM ariviso_captures WHERE run_id='run'")
    .first<{ metadata_json: string }>();
  if (!captured) throw new Error("Missing fixture capture.");
  if (archiveSource) {
    await finish();
    await operations.database
      .prepare(
        "INSERT INTO ariviso_shards(run_id,key,profile_digest,expected_json,state) VALUES('run','chromium','profile','{}','complete')",
      )
      .run();
    await operations.database
      .prepare(
        "INSERT INTO ariviso_captures(id,run_id,shard_key,item_key,variant_key,ordinal,image_id,profile_digest,test_id,test_retry,metadata_json) VALUES('capture-run','run','chromium','dialog','light',0,'image-run','profile','test',0,?)",
      )
      .bind(captured.metadata_json)
      .run();
  }
  await operations.database
    .prepare(
      "INSERT INTO ariviso_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,state,created_at,purpose) VALUES('historical','run',0,'policy',2,'ready',?,'historical')",
    )
    .bind(operations.now())
    .run();
  await operations.database
    .prepare(
      "INSERT INTO ariviso_comparison_rows(id,comparison_id,item_key,variant_key,ordinal,candidate_capture_id,tuple_json,outcome,result_json) VALUES('historical-row','historical','dialog','light',0,'capture-run','{}','changed',?)",
    )
    .bind(JSON.stringify({ changedPixels: 2 }))
    .run();
  await retentionPinStatement(operations.database, {
    runId: "run",
    owner: "historical:historical",
    reason: "manual",
  }).run();
}
async function finishHistorical() {
  for (let step = 0; step < 30; step++) {
    const report = await archiveHistoricalComparisons(operations);
    if (report.attention.length) throw new Error("Historical archive failed.");
    if (report.completed.includes("historical")) return;
  }
  throw new Error("Historical archive did not finish.");
}

async function largeCheckpoint(targetBytes?: number, verifiedPages = 3498) {
  const generation = "8ca765d1-be57-4ec3-a712-3e0f1bda4fe0";
  const prefix = historyPrefix("run", generation);
  const captureId = (index: number) =>
    `e0800000-0000-4000-8000-000000000002:${String(index).padStart(64, "0")}`;
  // The drill has 101-character capture IDs and thousands of page references.
  const progress: HistoryProgress = {
    section: historySections.length,
    cursor: "",
    pages: Array.from({ length: 3500 }, (_, index) => ({
      key: `${prefix}${String(index).padStart(6, "0")}.json`,
      digest: "a".repeat(64),
      bytes: 614004,
      section: "captures",
      rows: 100,
      firstCursor: captureId(index * 100),
      lastCursor: captureId(index * 100 + 99),
    })),
    verifiedPages,
  };
  // Resume one real verification page after an already verified prefix.
  const reference = progress.pages[verifiedPages];
  if (!reference) throw new Error("Missing checkpoint page.");
  const value = JSON.stringify({
    version: 1,
    runId: "run",
    generation,
    section: "captures",
    rows: Array.from({ length: 100 }, (_, index) => ({
      id: captureId(verifiedPages * 100 + index),
    })),
  });
  reference.digest = digest(value);
  reference.bytes = Buffer.byteLength(value, "utf8");
  await operations.images.put(reference.key, value);
  if (targetBytes !== undefined) {
    let remaining = targetBytes - Buffer.byteLength(JSON.stringify(progress), "utf8");
    if (remaining < 0) throw new Error("Checkpoint already exceeds target.");
    for (const page of progress.pages) {
      if (!remaining) break;
      const bytes = Math.min(remaining, 8000);
      page.firstCursor += "é".repeat(Math.floor(bytes / 2)) + (bytes % 2 ? "x" : "");
      remaining -= bytes;
    }
    if (remaining) throw new Error("Checkpoint cursors cannot hold target.");
  }
  return { generation, progress, encoded: JSON.stringify(progress) };
}

async function seedLargeCheckpoint(
  kind: "run" | "comparison",
  targetBytes?: number,
  verifiedPages = 3498,
) {
  if (kind === "run") await closed();
  else await historical(false);
  const checkpoint = await largeCheckpoint(targetBytes, verifiedPages);
  const { generation, progress, encoded } = checkpoint;
  const key = `${historyPrefix("run", generation)}manifest.json`;
  if (kind === "run") {
    await operations.database
      .prepare(
        `INSERT INTO operations_run_archives(run_id,generation,state,source_revision,project_revision,object_key,page_count,progress_json,created_at)
        SELECT run.id,?,'building',run.revision,project.revision,?,?,?,0 FROM ariviso_runs run JOIN ariviso_projects project ON project.id=run.project_id WHERE run.id='run'`,
      )
      .bind(generation, key, progress.pages.length, encoded)
      .run();
  } else {
    await operations.database
      .prepare(
        "INSERT INTO operations_comparison_archives(comparison_id,run_id,generation,state,object_key,page_count,progress_json,created_at) VALUES('historical','run',?,'building',?,?,?,0)",
      )
      .bind(generation, key, progress.pages.length, encoded)
      .run();
  }
  operations.budget.objectsPerStep = 1;
  operations.budget.maximumObjectBytes = 2 * 1024 * 1024;
  return checkpoint;
}

async function savedCheckpoint(kind: "run" | "comparison") {
  const table = kind === "run" ? "operations_run_archives" : "operations_comparison_archives";
  const row = await operations.database
    .prepare(
      `SELECT state,progress_json,length(CAST(progress_json AS BLOB)) AS bytes FROM ${table}`,
    )
    .first<{ state: string; progress_json: string; bytes: number }>();
  if (!row) throw new Error("Checkpoint was not saved.");
  return row;
}

describe.each(["run", "comparison"] as const)("native D1 %s archive progress bounds", (kind) => {
  const archive = () =>
    kind === "run" ? archiveClosedRuns(operations) : archiveHistoricalComparisons(operations);
  const subject = kind === "run" ? "run" : "historical";

  it("resumes actual-shaped many-page progress larger than one MiB", async () => {
    const checkpoint = await seedLargeCheckpoint(kind);
    expect(Buffer.byteLength(checkpoint.encoded, "utf8")).toBeGreaterThan(1024 * 1024);
    const report = await archive();
    expect(report.attention).toEqual([]);
    expect(report.deferred).toEqual([subject]);
    const saved = await savedCheckpoint(kind);
    expect(JSON.parse(saved.progress_json)).toEqual({
      ...checkpoint.progress,
      verifiedPages: 3499,
    });
    expect(saved.state).toBe("building");
    expect((await detailCount())?.count).toBe(1);
  });

  it("persists exactly 1,900,000 UTF-8 bytes with D1 row headroom", async () => {
    const checkpoint = await seedLargeCheckpoint(kind, 1_900_000);
    expect(checkpoint.encoded.length).toBeLessThan(1_900_000);
    const report = await archive();
    expect(report.attention).toEqual([]);
    const saved = await savedCheckpoint(kind);
    expect(saved.bytes).toBe(1_900_000);
    expect(JSON.parse(saved.progress_json).verifiedPages).toBe(3499);
    expect(saved.state).toBe("building");
  });

  it("rejects one byte over the bound without advancing saved progress or pruning detail", async () => {
    const checkpoint = await seedLargeCheckpoint(kind, 1_900_000, 999);
    expect(checkpoint.encoded.length).toBeLessThan(1_900_000);
    const report = await archive();
    expect(report.attention).toEqual([subject]);
    const saved = await savedCheckpoint(kind);
    expect(saved.progress_json).toBe(checkpoint.encoded);
    expect(saved.state).toBe("building");
    expect((await detailCount())?.count).toBe(1);
  });
});

describe("verified closed history with native D1 and R2", () => {
  it("rechecks a previously saved page before it removes database detail", async () => {
    await closed();
    await archiveClosedRuns(operations);
    const pointer = await operations.database
      .prepare("SELECT progress_json FROM operations_run_archives WHERE run_id='run'")
      .first<{ progress_json: string }>();
    if (!pointer) throw new Error("Missing fixture progress.");
    const progress = JSON.parse(pointer.progress_json) as { pages: { key: string }[] };
    const page = progress.pages[0];
    if (!page) throw new Error("Missing fixture page.");
    await operations.images.put(page.key, "corrupt");
    let attention = false;
    for (let step = 0; step < 50; step++) {
      const report = await archiveClosedRuns(operations);
      if (report.attention.includes("run")) {
        attention = true;
        break;
      }
    }
    expect(attention).toBe(true);
    expect(await detailCount()).toEqual({ count: 1 });
    expect(await readHistoryManifest(operations, "run")).toBeNull();
  });

  it("includes a saved historical supplement when original run detail remains live", async () => {
    await historical(false);
    await finishHistorical();
    expect(await readHistoryManifest(operations, "run")).toBeNull();
    expect(await detailCount()).toEqual({ count: 1 });
    const exported = await createRunExport(operations, { runId: "run", actorId: "maintainer" });
    const body = await (await streamRunExport(operations, exported.exportId)).text();
    expect(body).toContain("history-comparisons/");
    expect(body).toContain("historical-row");
    expect(body).toContain("original-image-bytes");
  });

  it("adds a verified comparison supplement without changing the original archive", async () => {
    await historical();
    const original = await readHistoryManifest(operations, "run");
    await expect(
      createRunExport(operations, { runId: "run", actorId: "maintainer" }),
    ).rejects.toThrow("finish saving");
    await finishHistorical();
    const after = await readHistoryManifest(operations, "run");
    expect(after?.pointer.digest).toBe(original?.pointer.digest);
    expect(
      await operations.database
        .prepare(
          "SELECT COUNT(*) AS count FROM ariviso_comparison_rows WHERE comparison_id='historical'",
        )
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await operations.database
        .prepare("SELECT owner FROM work_retention_pins WHERE owner='historical:historical'")
        .first(),
    ).toBeNull();
    const history = await readArchivedComparison(operations, {
      runId: "run",
      comparisonId: "historical",
    });
    expect(history?.sections.comparisonRows?.[0]).toMatchObject({
      id: "historical-row",
      result_json: '{"changedPixels":2}',
    });
    expect(history?.sections.run?.[0]).toMatchObject({ id: "run" });
    const exported = await createRunExport(operations, { runId: "run", actorId: "maintainer" });
    const body = await (await streamRunExport(operations, exported.exportId)).text();
    expect(body).toContain("history-comparisons/");
    expect(body).toContain("historical-row");
  });
  it("keeps historical detail and byte pins when a supplement object is corrupt", async () => {
    await historical();
    const store = new MemoryStore();
    const put = store.put.bind(store);
    store.put = async (key, value, options) => {
      const saved = await put(key, value, options);
      await put(key, "corrupt");
      return saved;
    };
    operations.images = store;
    expect((await archiveHistoricalComparisons(operations)).attention).toEqual(["historical"]);
    expect(
      await operations.database
        .prepare(
          "SELECT COUNT(*) AS count FROM ariviso_comparison_rows WHERE comparison_id='historical'",
        )
        .first(),
    ).toEqual({ count: 1 });
    expect(
      await operations.database
        .prepare("SELECT owner FROM work_retention_pins WHERE owner='historical:historical'")
        .first(),
    ).not.toBeNull();
    expect(
      await readComparisonHistoryManifest(operations, { runId: "run", comparisonId: "historical" }),
    ).toBeNull();
  });

  it("keeps archive JSON outside the validated public image lookup", async () => {
    await closed();
    await finish();
    const root = await readHistoryManifest(operations, "run");
    if (!root) throw new Error("Missing fixture archive.");
    // The route stops at the database lookup before using other API bindings.
    const api = { database: operations.database } as ApiContext;
    const response = await publicImage(
      new Request(`https://ariviso.example/images/${root.pointer.generation}`),
      api,
      root.pointer.generation,
    );
    expect(response.status).toBe(404);
    await expect(
      publicImage(
        new Request(`https://ariviso.example/images/${root.pointer.object_key}`),
        api,
        root.pointer.object_key,
      ),
    ).rejects.toThrow();
  });
  it("exports a still-protected snapshot original after its run original expires", async () => {
    await closed();
    await operations.database
      .prepare(
        "INSERT INTO ariviso_snapshots(id,project_id,run_id,comparison_id,tested_sha,state,reference_eligible,prefix,created_at) VALUES('snapshot','project','run','comparison-run',?,'accepted',0,'baselines/snapshot/',?)",
      )
      .bind("a".repeat(40), operations.now())
      .run();
    await operations.database
      .prepare(
        "INSERT INTO ariviso_snapshot_images(snapshot_id,capture_id,image_id,object_key,digest,copied) SELECT 'snapshot','capture-run',id,'baselines/snapshot/original',digest,1 FROM ariviso_images WHERE id='image-run'",
      )
      .run();
    await operations.images.put("baselines/snapshot/original", "original-image-bytes");
    await operations.database
      .prepare("UPDATE ariviso_images SET bytes_present=0 WHERE id='image-run'")
      .run();
    await operations.images.delete("runs/run/original");
    await finish();
    const exported = await createRunExport(operations, { runId: "run", actorId: "maintainer" });
    const body = await (await streamRunExport(operations, exported.exportId)).text();
    expect(body).toContain("references/");
    expect(body).toContain("original-image-bytes");
    expect(
      await operations.database
        .prepare("SELECT reason FROM ariviso_pins WHERE snapshot_id='snapshot'")
        .first(),
    ).toEqual({ reason: "export" });
  });
  it("continues newer archives while an older corrupt candidate waits for retry", async () => {
    await closed("bad");
    await closed("good");
    operations.budget.tasksPerStep = 1;
    const store = new MemoryStore();
    const put = store.put.bind(store);
    store.put = async (key, value, options) => {
      const result = await put(key, value, options);
      if (key.startsWith("history/bad/")) await put(key, "corrupt");
      return result;
    };
    operations.images = store;
    expect((await archiveClosedRuns(operations)).attention).toEqual(["bad"]);
    await finish("good");
    expect(await readHistoryManifest(operations, "good")).not.toBeNull();
    expect(await detailCount("bad")).toEqual({ count: 1 });
  });
  it("hydrates a compacted reference capture and inherited raw documents from its verified source archive", async () => {
    await closed("source");
    await closed("target");
    await operations.database
      .prepare(
        "UPDATE ariviso_comparison_rows SET reference_capture_id='capture-source' WHERE comparison_id='comparison-target'",
      )
      .run();
    await operations.database
      .prepare("UPDATE ariviso_captures SET image_id='image-source' WHERE id='capture-target'")
      .run();
    await operations.database
      .prepare(
        "INSERT INTO ingest_run_provenance(run_id,verified_json,plan_object_key,created_at) VALUES('source','{}','plans/source.json',?)",
      )
      .bind(operations.now())
      .run();
    await operations.quarantine.put("plans/source.json", '{"unknownOptional":"preserved"}');
    await finish("source");
    expect(
      await operations.database
        .prepare("SELECT metadata_json FROM ariviso_captures WHERE id='capture-source'")
        .first(),
    ).toEqual({ metadata_json: "{}" });
    await operations.quarantine.delete("plans/source.json");
    await finish("target");
    const history = await readRunHistory(operations, "target");
    expect(history?.sections.referenceCaptures?.[0]).toMatchObject({
      id: "capture-source",
      metadata_json: expect.stringContaining("private.test.ts"),
    });
    const root = await readHistoryManifest(operations, "target");
    expect(root?.manifest.counts.documents).toBe(1);
  });

  it("archives in bounded steps and keeps exact capture/result history plus available original bytes", async () => {
    await closed();
    const first = await archiveClosedRuns(operations);
    expect(first.hasMore).toBe(true);
    expect(await detailCount()).toEqual({ count: 1 });
    await finish();
    expect(await detailCount()).toEqual({ count: 0 });
    const history = await readRunHistory(operations, "run");
    expect(history?.sections.captures?.[0]).toMatchObject({
      id: "capture-run",
      metadata_json: expect.stringContaining("private.test.ts"),
    });
    expect(history?.sections.comparisonRows).toHaveLength(1);
    expect(history?.sections.decisions).toHaveLength(1);
    expect((await operations.images.get("runs/run/original"))?.size).toBeGreaterThan(0);
    const exported = await createRunExport(operations, { runId: "run", actorId: "maintainer" });
    const response = await streamRunExport(operations, exported.exportId);
    const body = await response.text();
    expect(body).toContain("history/manifest.json");
    expect(body).toContain("original-image-bytes");
    expect(body).toContain("complete.json");
  });
  it("does not prune when saved page bytes are corrupt", async () => {
    await closed();
    const store = new MemoryStore();
    const put = store.put.bind(store);
    store.put = async (key, value, options) => {
      const saved = await put(key, value, options);
      if (key.startsWith("history/")) await put(key, "corrupt");
      return saved;
    };
    operations.images = store;
    expect((await archiveClosedRuns(operations)).attention).toEqual(["run"]);
    expect(await detailCount()).toEqual({ count: 1 });
    expect(await readHistoryManifest(operations, "run")).toBeNull();
  });
  it("rechecks a new recovery pin after object verification and leaves every detail row intact", async () => {
    await closed();
    const store = new MemoryStore();
    const put = store.put.bind(store);
    store.put = async (key, value, options) => {
      const saved = await put(key, value, options);
      if (key.endsWith("/manifest.json"))
        await retentionPinStatement(operations.database, {
          runId: "run",
          owner: "new-recovery",
          reason: "recovery",
        }).run();
      return saved;
    };
    operations.images = store;
    let final;
    for (let step = 0; step < 30; step++) {
      final = await archiveClosedRuns(operations);
      if (
        await operations.database
          .prepare("SELECT owner FROM work_retention_pins WHERE owner='new-recovery'")
          .first()
      )
        break;
    }
    expect(final?.completed).toEqual([]);
    expect(await detailCount()).toEqual({ count: 1 });
    expect(await readHistoryManifest(operations, "run")).toBeNull();
  });
  it("does not expire raw source documents before the last archive page is committed", async () => {
    await closed();
    await operations.database
      .prepare(
        "INSERT INTO ingest_run_provenance(run_id,verified_json,plan_object_key,created_at) VALUES('run','{}','plans/run.json',?)",
      )
      .bind(operations.now())
      .run();
    await operations.quarantine.put("plans/run.json", '{"unknownOptional":"preserved"}');
    fixture.state.time += 31 * 24 * 60 * 60 * 1000;
    await archiveClosedRuns(operations);
    expect((await expireRunImages(operations)).completed).toEqual([]);
    expect((await operations.images.get("runs/run/original"))?.size).toBeGreaterThan(0);
    await finish();
    expect((await expireRunImages(operations)).completed).toEqual(["run"]);
    expect(
      await operations.database
        .prepare("SELECT detail_archived FROM ariviso_runs WHERE id='run'")
        .first(),
    ).toEqual({ detail_archived: 1 });
    expect(await operations.images.get("runs/run/original")).toBeNull();
    const history = await readHistoryManifest(operations, "run");
    expect(history?.manifest.counts.documents).toBe(1);
    const exported = await createRunExport(operations, { runId: "run", actorId: "maintainer" });
    const body = await (await streamRunExport(operations, exported.exportId)).text();
    expect(body).toContain("history/manifest.json");
    expect(body).not.toContain("original-image-bytes");
  });
  it("fails closed on missing or corrupt archived pages", async () => {
    await closed();
    await finish();
    const root = await readHistoryManifest(operations, "run");
    const capturePage = root?.manifest.pages.find((page) => page.section === "captures");
    if (!capturePage) throw new Error("Missing fixture page.");
    await operations.images.put(capturePage.key, "corrupt");
    await expect(readRunHistory(operations, "run")).rejects.toThrow("invalid size");
    await operations.images.delete(capturePage.key);
    await expect(readRunHistory(operations, "run")).rejects.toThrow("missing");
  });
});
