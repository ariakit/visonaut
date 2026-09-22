import { describe, expect, it } from "vitest";
import { cancelHistoricalPreparation, compactHistoricalComparison } from "@ariviso/service";
import { archiveClosedRuns, readHistoryManifest } from "./history.ts";
import { prepareHistoricalCaptures } from "./historical-captures.ts";
import { captured, context, TestDatabase } from "./test-fixtures.ts";

async function archivedFixture() {
  const database = new TestDatabase();
  const fixture = context(database);
  const service = await captured(fixture.context);
  await service.retireRun({ runId: "run", now: fixture.context.now() });
  for (let step = 0; step < 100; step++) {
    const result = await archiveClosedRuns(fixture.context);
    if (result.attention.length) throw new Error(`Archive failed: ${result.attention.join()}`);
    if (result.completed.includes("run")) break;
  }
  expect((await service.run("run")).detail_archived).toBe(1);
  return { database, fixture, service };
}

describe("historical comparison candidate recovery", () => {
  it("hydrates verified archived candidates and retains byte pins until the result archive is committed", async () => {
    const { database, fixture, service } = await archivedFixture();
    using _owned = database;
    const before = await service.run("run");
    const count = await prepareHistoricalCaptures(fixture.context, {
      runId: "run",
      comparisonId: "history",
      referenceSnapshotId: null,
      maximumCaptures: 10,
    });
    expect(count).toBe(1);
    const comparison = await service.createComparison({
      id: "history",
      runId: "run",
      referenceSnapshotId: null,
      purpose: "historical",
      expectedCaptureCount: count,
      now: fixture.context.now(),
      maxAttempts: 2,
    });
    await service.finalizeComparison({ comparisonId: comparison.id, now: fixture.context.now() });
    expect(await service.run("run")).toEqual(before);
    expect(
      database.connection
        .prepare("SELECT owner FROM work_retention_pins WHERE owner='historical:history'")
        .all(),
    ).toHaveLength(1);
    expect((await service.comparisonRows(comparison.id))[0]?.candidate_capture_id).toBe(
      "capture-run",
    );
    database.connection
      .prepare(
        "INSERT INTO operations_comparison_archives(comparison_id,run_id,generation,lease_token,lease_until,created_at,object_key) VALUES ('history','run','g','token',?,?,'history/run/g/manifest.json')",
      )
      .run(fixture.context.now() + 1000, fixture.context.now());
    await expect(
      compactHistoricalComparison(database, {
        comparisonId: "history",
        generation: "g",
        token: "stale",
        objectKey: "history/run/g/manifest.json",
        digest: "a".repeat(64),
        bytes: 100,
        pageCount: 1,
        now: fixture.context.now(),
      }),
    ).rejects.toThrow();
    expect(await service.comparisonRows(comparison.id)).toHaveLength(1);
    await compactHistoricalComparison(database, {
      comparisonId: "history",
      generation: "g",
      token: "token",
      objectKey: "history/run/g/manifest.json",
      digest: "a".repeat(64),
      bytes: 100,
      pageCount: 1,
      now: fixture.context.now(),
    });
    expect(await service.comparisonRows(comparison.id)).toHaveLength(0);
    expect(await service.getComparisonTaskState("history:capture-run")).toEqual({
      state: "superseded",
    });
    expect(
      database.connection.prepare("SELECT key FROM ariviso_shards WHERE run_id='run'").all(),
    ).toHaveLength(0);
    expect(
      database.connection
        .prepare("SELECT owner FROM work_retention_pins WHERE owner='historical:history'")
        .all(),
    ).toEqual([]);
  });

  it("fails on a corrupt archive without restoring capture rows and releases abandoned preparation pins", async () => {
    const { database, fixture } = await archivedFixture();
    using _owned = database;
    const root = await readHistoryManifest(fixture.context, "run");
    const page = root?.manifest.pages.find((page) => page.section === "captures");
    if (!page) throw new Error("Missing capture page");
    await fixture.images.put(page.key, "corrupt");
    await expect(
      prepareHistoricalCaptures(fixture.context, {
        runId: "run",
        comparisonId: "bad",
        referenceSnapshotId: null,
        maximumCaptures: 10,
      }),
    ).rejects.toThrow();
    await cancelHistoricalPreparation(database, "bad", fixture.context.now());
    expect(
      database.connection
        .prepare("SELECT owner FROM work_retention_pins WHERE owner='historical:bad'")
        .all(),
    ).toEqual([]);
    expect(
      database.connection.prepare("SELECT id FROM ariviso_captures WHERE run_id='run'").all(),
    ).toEqual([]);
  });

  it("rejects originals that expired after archival rather than treating missing captures as removals", async () => {
    const { database, fixture } = await archivedFixture();
    using _owned = database;
    database.connection.exec("UPDATE ariviso_images SET bytes_present=0 WHERE run_id='run'");
    await expect(
      prepareHistoricalCaptures(fixture.context, {
        runId: "run",
        comparisonId: "expired",
        referenceSnapshotId: null,
        maximumCaptures: 10,
      }),
    ).rejects.toThrow();
    await cancelHistoricalPreparation(database, "expired", fixture.context.now());
    expect(
      database.connection.prepare("SELECT id FROM ariviso_captures WHERE run_id='run'").all(),
    ).toEqual([]);
  });
  it("removes partial restored detail when preparation is cancelled before a job exists", async () => {
    const { database, fixture } = await archivedFixture();
    using _owned = database;
    await prepareHistoricalCaptures(fixture.context, {
      runId: "run",
      comparisonId: "cancelled",
      referenceSnapshotId: null,
      maximumCaptures: 10,
    });
    expect(
      database.connection.prepare("SELECT id FROM ariviso_captures WHERE run_id='run'").all(),
    ).toHaveLength(1);
    await cancelHistoricalPreparation(database, "cancelled", fixture.context.now());
    expect(
      database.connection.prepare("SELECT id FROM ariviso_captures WHERE run_id='run'").all(),
    ).toHaveLength(0);
    expect(
      database.connection.prepare("SELECT key FROM ariviso_shards WHERE run_id='run'").all(),
    ).toHaveLength(0);
  });
});
