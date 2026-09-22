import { expect, it } from "vitest";
import { sanitizeRestoredDatabase } from "./recovery.ts";
import { TestDatabase, captured, context } from "./test-fixtures.ts";
import { archiveClosedRuns } from "./history.ts";
import { expireRunImages } from "./retention.ts";
import { expireSnapshotImages } from "./snapshot-retention.ts";

it.each(["building", "ready", "failed", "expired"])(
  "releases %s export ownership so restored snapshot bytes can expire",
  async (exportState) => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context, "exported", "main");
    database.connection.exec(`
      INSERT INTO ariviso_snapshots(id,project_id,run_id,comparison_id,tested_sha,state,reference_eligible,prefix,created_at)
        VALUES('exported','project','exported','comparison-exported','sha','accepted',1,'baselines/exported',0);
      INSERT INTO ariviso_pins(snapshot_id,reason,owner_id) VALUES('exported','export','export:old');
      INSERT INTO work_retention_pins(run_id,owner,reason) VALUES('exported','export:old','recovery');
    `);
    database.connection
      .prepare(
        "INSERT INTO operations_exports(id,run_id,actor_id,state,expires_at,created_at) VALUES('old','exported','maintainer',?,1,0)",
      )
      .run(exportState);
    await fixture.images.put("baselines/exported/original", "protected-image");
    await sanitizeRestoredDatabase(database, fixture.state.time);
    await sanitizeRestoredDatabase(database, fixture.state.time);
    expect(database.connection.prepare("SELECT * FROM operations_exports").all()).toEqual([]);
    expect(database.connection.prepare("SELECT * FROM ariviso_pins").all()).toEqual([]);
    expect(database.connection.prepare("SELECT * FROM work_retention_pins").all()).toEqual([]);
    fixture.state.time += 31 * 86400000;
    const retirement = await expireSnapshotImages(fixture.context);
    expect(retirement.attention).toEqual([]);
    expect(
      database.connection
        .prepare("SELECT byte_state FROM ariviso_snapshot_retention WHERE snapshot_id='exported'")
        .get(),
    ).toEqual({ byte_state: "retiring" });
    let archived = false;
    for (let step = 0; step < 50 && !archived; step++) {
      const result = await archiveClosedRuns(fixture.context);
      expect(result.attention).toEqual([]);
      archived = result.completed.includes("exported");
    }
    expect(archived).toBe(true);
    expect((await expireRunImages(fixture.context)).completed).toEqual(["exported"]);
    fixture.state.time += 86400001;
    for (
      let step = 0;
      step < 5 && fixture.images.objects.has("baselines/exported/original");
      step++
    ) {
      const result = await expireSnapshotImages(fixture.context);
      expect(result.attention).toEqual([]);
    }
    expect(fixture.images.objects.has("runs/exported/original")).toBe(false);
    expect(fixture.images.objects.has("baselines/exported/original")).toBe(false);
    expect(
      database.connection
        .prepare("SELECT byte_state FROM ariviso_snapshot_retention WHERE snapshot_id='exported'")
        .get(),
    ).toEqual({ byte_state: "deleted" });
  },
);

it("archives and expires restored unfinished work without restarting existing retention clocks", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await captured(fixture.context, "restored");
  await captured(fixture.context, "closed");
  const closedAt = fixture.state.time - 2 * 86400000;
  await service.retireRun({ runId: "closed", now: closedAt });
  const restoredAt = fixture.state.time;
  await sanitizeRestoredDatabase(database, restoredAt);
  await sanitizeRestoredDatabase(database, restoredAt + 86400000);
  expect(
    database.connection.prepare("SELECT id,closed_at FROM ariviso_runs ORDER BY id").all(),
  ).toEqual([
    { id: "closed", closed_at: closedAt },
    { id: "restored", closed_at: restoredAt },
  ]);
  expect(
    database.connection.prepare("SELECT id,closed_at FROM work_retained_runs ORDER BY id").all(),
  ).toEqual([
    { id: "closed", closed_at: closedAt },
    { id: "restored", closed_at: restoredAt },
  ]);
  expect(database.connection.prepare("SELECT * FROM work_retention_pins").all()).toEqual([]);
  const archived = new Set<string>();
  for (let step = 0; step < 50 && archived.size < 2; step++) {
    const result = await archiveClosedRuns(fixture.context);
    expect(result.attention).toEqual([]);
    for (const id of result.completed) {
      archived.add(id);
    }
  }
  expect([...archived].sort()).toEqual(["closed", "restored"]);
  expect((await expireRunImages(fixture.context)).completed).toEqual([]);
  fixture.state.time += 31 * 86400000;
  const expired = new Set<string>();
  for (let step = 0; step < 10 && expired.size < 2; step++) {
    const result = await expireRunImages(fixture.context);
    expect(result.attention).toEqual([]);
    for (const id of result.completed) {
      expired.add(id);
    }
  }
  expect([...expired].sort()).toEqual(["closed", "restored"]);
  expect(fixture.images.objects.has("runs/restored/original")).toBe(false);
  expect(fixture.images.objects.has("runs/closed/original")).toBe(false);
});

it("preserves current, rollback, manual, command, and other independently owned evidence roots", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  for (const id of ["current", "rollback"]) {
    await captured(fixture.context, id, "main");
    database.connection.prepare("UPDATE ariviso_runs SET state='accepted' WHERE id=?").run(id);
    database.connection
      .prepare(
        "INSERT INTO ariviso_snapshots(id,project_id,run_id,comparison_id,tested_sha,state,reference_eligible,prefix,created_at) VALUES(?,'project',?,?,'sha','accepted',1,?,0)",
      )
      .run(id, id, `comparison-${id}`, `baselines/${id}`);
    database.connection
      .prepare("INSERT INTO work_retention_pins(run_id,owner,reason) VALUES(?,?,'baseline')")
      .run(id, `promotion:${id}`);
    await fixture.images.put(`baselines/${id}/original`, "protected-image");
  }
  for (const reason of ["manual", "command", "comparison", "review", "rollback"]) {
    const id = `pinned-${reason}`;
    const service = await captured(fixture.context, id);
    if (reason === "command") {
      const row = (await service.comparisonRows(`comparison-${id}`))[0];
      if (!row) {
        throw new Error("Missing review fixture.");
      }
      await service.review({
        commandId: "available-command",
        actorId: "maintainer",
        sessionId: "session",
        comparisonId: `comparison-${id}`,
        verdict: "approved",
        targets: [{ id: row.id, expectedRevision: row.decision_revision }],
        selection: { itemKey: "dialog", variantKey: "light" },
        now: fixture.state.time,
      });
    }
    database.connection
      .prepare("INSERT INTO work_retention_pins(run_id,owner,reason) VALUES(?,?,?)")
      .run(id, `retained-${reason}`, reason);
  }
  database.connection.exec(`
    INSERT INTO ariviso_promotions(id,project_id,snapshot_id,previous_snapshot_id,comparison_id,baseline_revision,created_at)
      VALUES('promotion','project','current','rollback','comparison-current',1,0);
    UPDATE ariviso_projects SET snapshot_id='current',promotion_id='promotion';
    INSERT INTO ariviso_pins(snapshot_id,reason,owner_id) VALUES('rollback','rollback','promotion');
  `);
  const roots = database.connection
    .prepare(
      "SELECT run_id,owner,reason FROM work_retention_pins WHERE owner NOT LIKE 'review:%' ORDER BY run_id,owner",
    )
    .all();
  const command = database.connection.prepare("SELECT * FROM ariviso_commands").all();
  const restoredAt = fixture.state.time;
  await sanitizeRestoredDatabase(database, restoredAt);
  expect(
    database.connection
      .prepare("SELECT active,state,closed_at FROM ariviso_runs WHERE id='current'")
      .get(),
  ).toEqual({ active: 0, state: "accepted", closed_at: restoredAt });
  expect(
    database.connection
      .prepare(
        "SELECT run_id,owner,reason FROM work_retention_pins WHERE owner NOT LIKE 'review:%' ORDER BY run_id,owner",
      )
      .all(),
  ).toEqual(roots);
  expect(database.connection.prepare("SELECT * FROM ariviso_commands").all()).toEqual(command);
  fixture.state.time += 31 * 86400000;
  expect((await archiveClosedRuns(fixture.context)).completed).toEqual([]);
  expect((await expireRunImages(fixture.context)).completed).toEqual([]);
  await expireSnapshotImages(fixture.context);
  expect(
    database.connection
      .prepare("SELECT snapshot_id,byte_state FROM ariviso_snapshot_retention ORDER BY snapshot_id")
      .all(),
  ).toEqual([
    { snapshot_id: "current", byte_state: "live" },
    { snapshot_id: "rollback", byte_state: "live" },
  ]);
  expect([...fixture.images.objects.keys()].filter((key) => key.startsWith("runs/"))).toHaveLength(
    7,
  );
  expect(fixture.images.objects.has("baselines/current/original")).toBe(true);
  expect(fixture.images.objects.has("baselines/rollback/original")).toBe(true);

  // A later baseline transition leaves the restored snapshot outside both roots.
  database.connection.exec(
    "UPDATE ariviso_projects SET snapshot_id='rollback',promotion_id=NULL,revision=revision+1",
  );
  await expireSnapshotImages(fixture.context);
  expect(
    database.connection
      .prepare("SELECT byte_state FROM ariviso_snapshot_retention WHERE snapshot_id='current'")
      .get(),
  ).toEqual({ byte_state: "retiring" });
  let archived = false;
  for (let step = 0; step < 50 && !archived; step++) {
    const result = await archiveClosedRuns(fixture.context);
    expect(result.attention).toEqual([]);
    archived = result.completed.includes("current");
  }
  expect(archived).toBe(true);
  expect((await expireRunImages(fixture.context)).completed).toEqual(["current"]);
  fixture.state.time += 86400001;
  for (let step = 0; step < 5 && fixture.images.objects.has("baselines/current/original"); step++) {
    await expireSnapshotImages(fixture.context);
  }
  expect(fixture.images.objects.has("runs/current/original")).toBe(false);
  expect(fixture.images.objects.has("baselines/current/original")).toBe(false);
  expect(fixture.images.objects.has("baselines/rollback/original")).toBe(true);
  expect(
    database.connection.prepare("SELECT closed_at FROM ariviso_runs WHERE id='current'").get(),
  ).toEqual({ closed_at: restoredAt });
});

it("rolls back run closure and pin removal together when restore cleanup fails", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  database.connection.exec(`
    INSERT INTO ariviso_snapshots(id,project_id,run_id,comparison_id,tested_sha,state,reference_eligible,prefix,created_at)
      VALUES('exported','project','run','comparison-run','sha','accepted',1,'baselines/exported',0);
    INSERT INTO ariviso_pins(snapshot_id,reason,owner_id) VALUES('exported','export','export:old');
    INSERT INTO operations_exports(id,run_id,actor_id,state,expires_at,created_at)
      VALUES('old','run','maintainer','ready',1,0);
  `);
  const exports = database.connection.prepare("SELECT * FROM operations_exports").all();
  const snapshotPins = database.connection.prepare("SELECT * FROM ariviso_pins").all();
  const before = database.connection
    .prepare("SELECT active,state,closed_at FROM ariviso_runs")
    .all();
  database.connection.exec(`CREATE TRIGGER interrupt_restore BEFORE DELETE ON work_retention_pins
    WHEN OLD.reason='review' BEGIN SELECT RAISE(ABORT,'injected restore failure'); END`);
  await expect(sanitizeRestoredDatabase(database, fixture.state.time)).rejects.toThrow(
    "injected restore failure",
  );
  expect(
    database.connection.prepare("SELECT active,state,closed_at FROM ariviso_runs").all(),
  ).toEqual(before);
  expect(database.connection.prepare("SELECT closed_at FROM work_retained_runs").get()).toEqual({
    closed_at: null,
  });
  expect(database.connection.prepare("SELECT owner FROM work_retention_pins").all()).toEqual([
    { owner: "review:run" },
  ]);
  expect(database.connection.prepare("SELECT * FROM operations_exports").all()).toEqual(exports);
  expect(database.connection.prepare("SELECT * FROM ariviso_pins").all()).toEqual(snapshotPins);
});

it("keeps verified history and drops unfinished run and comparison archives independently of auth tables", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context, "ready");
  await captured(fixture.context, "building");
  database.connection.exec(`
    INSERT INTO operations_run_archives(run_id,generation,state,source_revision,project_revision,object_key,digest,bytes,page_count,progress_json,created_at,verified_at)
      VALUES('ready','generation','ready',0,0,'history/ready/generation/manifest.json','digest',1,0,'{}',0,0),
      ('building','generation','building',0,0,'history/building/generation/manifest.json',NULL,NULL,0,'{}',0,NULL);
    INSERT INTO operations_comparison_archives(comparison_id,run_id,generation,state,object_key,digest,bytes,page_count,created_at,verified_at)
      VALUES('comparison-ready','ready','supplement','ready','history/ready/supplement/manifest.json','digest',1,0,0,0),
      ('comparison-building','building','supplement','building',NULL,NULL,NULL,0,0,NULL);
    DROP TABLE account;
  `);
  await sanitizeRestoredDatabase(database, fixture.state.time);
  expect(
    database.connection.prepare("SELECT run_id,state FROM operations_run_archives").all(),
  ).toEqual([{ run_id: "ready", state: "ready" }]);
  expect(
    database.connection
      .prepare("SELECT comparison_id,state FROM operations_comparison_archives")
      .all(),
  ).toEqual([{ comparison_id: "comparison-ready", state: "ready" }]);
  expect(
    database.connection.prepare("SELECT id,active,state FROM ariviso_runs ORDER BY id").all(),
  ).toEqual([
    { id: "building", active: 0, state: "failed" },
    { id: "ready", active: 0, state: "failed" },
  ]);
});
