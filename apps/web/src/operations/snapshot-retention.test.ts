import { expect, it, vi } from "vitest";
import { closedRunRetentionMs } from "@visonaut/service";
import { captured, context, reserve, TestDatabase } from "./test-fixtures.ts";
import { expireComparisonReferences, expireSnapshotImages } from "./snapshot-retention.ts";

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

it("pages past a protected current snapshot, then deletes only an unreferenced old prefix after its grace and archive", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await snapshot(database, fixture, "a-current");
  await snapshot(database, fixture, "z-old");
  database.connection.exec("UPDATE visonaut_projects SET snapshot_id='a-current'");
  fixture.context.budget.tasksPerStep = 1;
  await expireSnapshotImages(fixture.context);
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

it("keeps protected copies during a combined backup and recovers a failed bounded deletion", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await snapshot(database, fixture, "old");
  readyArchive(database, "old");
  await expireSnapshotImages(fixture.context);
  fixture.state.time += 86400001;
  database.connection.exec(
    "INSERT INTO operations_backups(id,state,created_at) VALUES('backup','exporting',0)",
  );
  expect((await expireSnapshotImages(fixture.context)).completed).toEqual([]);
  expect(fixture.images.objects.has("baselines/old/original")).toBe(true);
  database.connection.exec("UPDATE operations_backups SET state='failed'");
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
