import { describe, expect, it } from "vitest";
import { cancelHistoricalPreparation } from "@visonaut/service";
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
  it("refuses to create an interactive historical comparison after compaction", async () => {
    const { database, fixture, service } = await archivedFixture();
    using _owned = database;
    await expect(
      service.createComparison({
        id: "history",
        runId: "run",
        referenceSnapshotId: null,
        purpose: "historical",
        expectedCaptureCount: 1,
        now: fixture.context.now(),
        maxAttempts: 2,
      }),
    ).rejects.toThrow("read-only summary");
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
      database.connection.prepare("SELECT id FROM visonaut_captures WHERE run_id='run'").all(),
    ).toEqual([]);
  });

  it("rejects originals that expired after archival rather than treating missing captures as removals", async () => {
    const { database, fixture } = await archivedFixture();
    using _owned = database;
    database.connection.exec("UPDATE visonaut_images SET bytes_present=0 WHERE run_id='run'");
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
      database.connection.prepare("SELECT id FROM visonaut_captures WHERE run_id='run'").all(),
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
      database.connection.prepare("SELECT id FROM visonaut_captures WHERE run_id='run'").all(),
    ).toHaveLength(1);
    await cancelHistoricalPreparation(database, "cancelled", fixture.context.now());
    expect(
      database.connection.prepare("SELECT id FROM visonaut_captures WHERE run_id='run'").all(),
    ).toHaveLength(0);
    expect(
      database.connection.prepare("SELECT key FROM visonaut_shards WHERE run_id='run'").all(),
    ).toHaveLength(0);
  });
});
