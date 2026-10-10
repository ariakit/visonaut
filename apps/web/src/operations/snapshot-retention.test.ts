import { expect, it, vi } from "vitest";
import { closedRunRetentionMs } from "@visonaut/service";
import { captured, context, digest, reserve, TestDatabase } from "./test-fixtures.ts";
import {
  expireComparisonReferences,
  expireSnapshotImages,
  retireSourceBaselines,
} from "./snapshot-retention.ts";
import * as snapshotRetention from "./snapshot-retention.ts";
import { atStepStart, hostileCause, HostileError, passStep, stepWithCause } from "./test-causes.ts";

async function snapshot(database: TestDatabase, fixture: ReturnType<typeof context>, id: string) {
  await captured(fixture.context, id, "main");
  database.connection
    .prepare(
      "INSERT INTO visonaut_snapshots(id,project_id,run_id,comparison_id,tested_sha,state,reference_eligible,prefix,created_at) VALUES(?,'project',?,?,'sha','accepted',1,?,0)",
    )
    .run(id, id, `comparison-${id}`, `baselines/${id}`);
  database.connection
    .prepare(
      "INSERT INTO visonaut_snapshot_images(snapshot_id,capture_id,image_id,object_key,digest,copied) SELECT ?,capture.id,image.id,?,image.digest,1 FROM visonaut_captures capture JOIN visonaut_images image ON image.id=capture.image_id WHERE capture.run_id=?",
    )
    .run(id, `baselines/${id}/original`, id);
  database.connection
    .prepare("UPDATE visonaut_runs SET active=0,state='accepted',closed_at=? WHERE id=?")
    .run(fixture.state.time - closedRunRetentionMs - 1, id);
  database.connection.prepare("DELETE FROM work_retention_pins WHERE run_id=?").run(id);
  await fixture.images.put(`baselines/${id}/original`, "original-image-bytes");
}
function readyArchive(database: TestDatabase, id: string) {
  database.connection
    .prepare(
      "INSERT INTO operations_run_archives(run_id,generation,state,source_revision,project_revision,object_key,digest,bytes,page_count,progress_json,created_at,verified_at) VALUES(?,'generation','ready',0,0,?, ?,1,0,'{}',0,0)",
    )
    .run(id, `history/${id}/generation/manifest.json`, "a".repeat(64));
}

it("retains imported inventory metadata and inherited image owners after protected byte expiry", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await snapshot(database, fixture, "imported");
  const inventoryKey = `baselines/import/imported/inventory/${digest("inventory-metadata")}.json`;
  const originalKey = "baselines/import/imported/images/original";
  await fixture.images.put(inventoryKey, "inventory-metadata");
  await fixture.images.put(originalKey, "original-image-bytes");
  await fixture.images.delete("baselines/imported/original");
  database.connection
    .prepare(
      "UPDATE visonaut_snapshots SET prefix='baselines/import/imported',inventory_key=?,inventory_digest=?,inventory_bytes=18,capture_count=1,inventory_verified=1 WHERE id='imported'",
    )
    .run(inventoryKey, digest("inventory-metadata"));
  database.connection.exec(
    "INSERT INTO work_retention_pins(run_id,owner,reason) VALUES('imported','promotion:descendant','baseline')",
  );
  await expireSnapshotImages(fixture.context);
  fixture.state.time += 86400001;
  await expireSnapshotImages(fixture.context);
  expect(fixture.images.objects.has(originalKey)).toBe(true);
  database.connection.exec("DELETE FROM work_retention_pins WHERE owner='promotion:descendant'");
  expect((await expireSnapshotImages(fixture.context)).completed).toEqual(["imported"]);
  expect(fixture.images.objects.has(originalKey)).toBe(false);
  expect(fixture.images.objects.has(inventoryKey)).toBe(true);
  expect(
    await database
      .prepare(
        "SELECT inventory_key,inventory_verified FROM visonaut_snapshots WHERE id='imported'",
      )
      .first(),
  ).toEqual({ inventory_key: inventoryKey, inventory_verified: 1 });
});

it("pages past a protected current snapshot, then deletes only an unreferenced old prefix after its grace and archive", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await snapshot(database, fixture, "a-current");
  await snapshot(database, fixture, "z-old");
  database.connection.exec("UPDATE visonaut_projects SET snapshot_id='a-current'");
  database.connection.exec(
    "INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at) VALUES('snapshot-retention:a-current:delete-failed','snapshot-retention','a-current','delete-failed',0,0)",
  );
  fixture.context.budget.tasksPerStep = 1;
  await expireSnapshotImages(fixture.context);
  expect(
    database.connection
      .prepare(
        "SELECT resolved_at FROM operations_events WHERE id='snapshot-retention:a-current:delete-failed'",
      )
      .get(),
  ).toEqual({ resolved_at: fixture.state.time });
  expect(
    database.connection
      .prepare("SELECT byte_state FROM visonaut_snapshot_retention WHERE snapshot_id='a-current'")
      .get(),
  ).toEqual({ byte_state: "live" });
  await expireSnapshotImages(fixture.context);
  expect(
    database.connection
      .prepare("SELECT byte_state FROM visonaut_snapshot_retention WHERE snapshot_id='z-old'")
      .get(),
  ).toEqual({ byte_state: "retiring" });
  expect(fixture.images.objects.has("baselines/z-old/original")).toBe(true);
  fixture.state.time += 86400001;
  for (let step = 0; step < 5; step++) await expireSnapshotImages(fixture.context);
  expect(fixture.images.objects.has("baselines/z-old/original")).toBe(true);
  readyArchive(database, "z-old");
  await fixture.images.put("baselines/z-old-other/original", "unrelated");
  for (let step = 0; step < 5; step++) await expireSnapshotImages(fixture.context);
  expect(
    database.connection
      .prepare("SELECT byte_state FROM visonaut_snapshot_retention WHERE snapshot_id='z-old'")
      .get(),
  ).toEqual({ byte_state: "deleted" });
  expect(fixture.images.objects.has("baselines/a-current/original")).toBe(true);
  expect(fixture.images.objects.has("baselines/z-old-other/original")).toBe(true);
  expect(fixture.images.objects.has("baselines/z-old/original")).toBe(false);
});

it("resolves a failed retirement alert when the next attempt retires the snapshot", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await snapshot(database, fixture, "old");
  database.beforeBatch = () => {
    throw new Error("Transient retirement failure.");
  };

  expect((await expireSnapshotImages(fixture.context)).attention).toEqual(["old"]);
  expect(
    database.connection
      .prepare(
        "SELECT resolved_at FROM operations_events WHERE id='snapshot-retention:old:delete-failed'",
      )
      .get(),
  ).toEqual({ resolved_at: null });

  await expireSnapshotImages(fixture.context);
  expect(
    database.connection
      .prepare("SELECT byte_state FROM visonaut_snapshot_retention WHERE snapshot_id='old'")
      .get(),
  ).toEqual({ byte_state: "retiring" });
  expect(
    database.connection
      .prepare(
        "SELECT resolved_at FROM operations_events WHERE id='snapshot-retention:old:delete-failed'",
      )
      .get(),
  ).toEqual({ resolved_at: fixture.state.time });
});

it("recovers a failed bounded protected-copy deletion", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await snapshot(database, fixture, "old");
  readyArchive(database, "old");
  await expireSnapshotImages(fixture.context);
  fixture.state.time += 86400001;
  await fixture.images.put("baselines/old/other", "another-object");
  fixture.context.budget.objectsPerStep = 1;
  vi.spyOn(fixture.images, "delete").mockRejectedValueOnce(new Error("Transient storage failure."));
  expect((await expireSnapshotImages(fixture.context)).attention).toEqual(["old"]);
  fixture.state.time += fixture.context.budget.leaseMilliseconds + 1;
  for (let step = 0; step < 5; step++) await expireSnapshotImages(fixture.context);
  expect(
    database.connection
      .prepare("SELECT byte_state FROM visonaut_snapshot_retention WHERE snapshot_id='old'")
      .get(),
  ).toEqual({ byte_state: "deleted" });
  expect(
    database.connection
      .prepare(
        "SELECT resolved_at FROM operations_events WHERE kind='snapshot-retention' AND subject_id='old'",
      )
      .get()?.resolved_at,
  ).toBe(fixture.state.time);
});

it("closes the alert of a failed reference release in the pass that releases the references", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await reserve(fixture.context, "closed");
  await service.retireRun({ runId: "closed", now: fixture.state.time });
  fixture.state.time += closedRunRetentionMs + 1;
  const openAlerts = () =>
    database.connection
      .prepare("SELECT id FROM operations_events WHERE resolved_at IS NULL")
      .all()
      .map((row) => row.id);
  const batch = vi.spyOn(database, "batch").mockRejectedValueOnce(new Error("Unavailable."));
  expect((await expireComparisonReferences(fixture.context)).attention).toEqual(["closed"]);
  expect(openAlerts()).toEqual(["reference-retention:closed:release-failed"]);
  batch.mockRestore();
  fixture.state.time++;
  expect((await expireComparisonReferences(fixture.context)).completed).toEqual(["closed"]);
  expect(openAlerts()).toEqual([]);
});

it("pages past pinned closed runs without releasing their comparison evidence", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const first = await reserve(fixture.context, "a-pinned");
  await reserve(fixture.context, "z-ready");
  await first.retireRun({ runId: "a-pinned", now: fixture.state.time });
  await first.retireRun({ runId: "z-ready", now: fixture.state.time });
  database.connection.exec(
    "INSERT INTO work_retention_pins(run_id,owner,reason) VALUES('a-pinned','manual','manual')",
  );
  fixture.state.time += closedRunRetentionMs + 1;
  fixture.context.budget.tasksPerStep = 1;
  expect((await expireComparisonReferences(fixture.context)).completed).toEqual([]);
  expect((await expireComparisonReferences(fixture.context)).completed).toEqual(["z-ready"]);
  expect(
    database.connection
      .prepare("SELECT references_released_at FROM work_retained_runs WHERE id='a-pinned'")
      .get(),
  ).toEqual({ references_released_at: null });
  expect(
    database.connection
      .prepare("SELECT references_released_at FROM work_retained_runs WHERE id='z-ready'")
      .get(),
  ).toEqual({ references_released_at: fixture.state.time });
});

it("pages past rooted source baselines and retires a later unrooted source", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await snapshot(database, fixture, "a-rooted");
  await snapshot(database, fixture, "z-expired");
  database.connection.exec(
    "UPDATE visonaut_snapshots SET storage_mode='source'; INSERT INTO visonaut_pins(snapshot_id,reason,owner_id) VALUES('a-rooted','manual','keep'); INSERT INTO work_retention_pins(run_id,owner,reason) VALUES('z-expired','promotion:z-expired','baseline')",
  );
  fixture.context.budget.tasksPerStep = 1;
  const first = await retireSourceBaselines(fixture.context);
  expect(first.deferred).toEqual(["a-rooted"]);
  expect(first.hasMore).toBe(true);
  expect((await retireSourceBaselines(fixture.context)).completed).toEqual(["z-expired"]);
  expect((await retireSourceBaselines(fixture.context)).hasMore).toBe(false);
  expect(
    database.connection
      .prepare("SELECT run_id FROM work_retention_pins WHERE owner='promotion:z-expired'")
      .get(),
  ).toBeUndefined();
  expect(
    database.connection
      .prepare("SELECT reference_eligible FROM visonaut_snapshots WHERE id='a-rooted'")
      .get(),
  ).toEqual({ reference_eligible: 1 });
  expect(fixture.images.objects.has("runs/z-expired/original")).toBe(true);
});

// Each test below gives one catch place of a retention step an error whose
// name, code, and message are not on a list. The fault starts with the step,
// because the steps before it in the same pass also write to the database.
it("logs the cause of a failed release of comparison references", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await reserve(fixture.context, "closed");
  await service.retireRun({ runId: "closed", now: fixture.state.time });
  fixture.state.time += closedRunRetentionMs + 1;
  atStepStart(snapshotRetention, "expireComparisonReferences", () => {
    database.beforeBatch = () => {
      throw new HostileError();
    };
  });
  try {
    const { entry } = await passStep({
      context: fixture.context,
      message: { kind: "maintenance", family: "retention" },
      step: "reference-retention",
    });
    expect(entry).toEqual(stepWithCause({ completed: 0, deferred: 0, attention: 1 }, hostileCause));
  } finally {
    vi.restoreAllMocks();
  }
});

it.each([
  { step: "source-retention", name: "retireSourceBaselines", storageMode: "source" },
  { step: "snapshot-retention", name: "expireSnapshotImages", storageMode: null },
] as const)("logs the cause of a failed retirement in the step $step", async (place) => {
  using database = new TestDatabase();
  const fixture = context(database);
  await snapshot(database, fixture, "old");
  if (place.storageMode) {
    database.connection
      .prepare("UPDATE visonaut_snapshots SET storage_mode=?")
      .run(place.storageMode);
  }
  atStepStart(snapshotRetention, place.name, () => {
    database.beforeBatch = () => {
      throw new HostileError();
    };
  });
  try {
    const { entry } = await passStep({
      context: fixture.context,
      message: { kind: "maintenance", family: "retention" },
      step: place.step,
    });
    expect(entry).toEqual(stepWithCause({ completed: 0, deferred: 0, attention: 1 }, hostileCause));
  } finally {
    vi.restoreAllMocks();
  }
});
