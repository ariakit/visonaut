import { backup, DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { sanitizeRestoredDatabase, inspectRecoveryImages, readRestoreCutoff } from "./recovery.ts";
import { TestDatabase, captured, context } from "./test-fixtures.ts";
import { archiveClosedRuns, readRunHistory } from "./history.ts";
import { summarizeClosedRuns } from "./closed-summary.ts";
import { expireRunImages } from "./retention.ts";
import { expireSnapshotImages } from "./snapshot-retention.ts";
import { publishReviewLinks } from "./review-links.ts";

it("keeps an accepted restored PR read-only without preventing a fresh capture", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context, "restored-pr");
  database.connection.exec(`
    UPDATE visonaut_runs SET state='accepted',lineage_key='pr:7' WHERE id='restored-pr';
    INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,state,workflow_run_id,workflow_attempt,created_at,updated_at)
      VALUES('${"a".repeat(40)}',0,'123','${"b".repeat(40)}','${"c".repeat(40)}','pull_request','refs/pull/7/merge',7,0,'old-check','active','restored-pr',1,1,1);
  `);
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    if (path === "/repos/owner/repo/pulls/7") {
      return {
        state: "open",
        head: { sha: "b".repeat(40), repo: { id: 123 } },
        base: { ref: "main", repo: { id: 123 } },
      };
    }
    return request(path, init);
  };
  await publishReviewLinks(fixture.context);
  const originalPosts = fixture.state.posts;
  const originalPatches = fixture.state.patches;
  expect(originalPosts).toBe(1);
  await sanitizeRestoredDatabase(database, fixture.state.time);
  await publishReviewLinks(fixture.context);
  expect(fixture.state.posts).toBe(originalPosts);
  expect(fixture.state.patches).toBe(originalPatches);
  expect(await database.prepare("SELECT state,active FROM visonaut_runs").first()).toEqual({
    state: "accepted",
    active: 0,
  });
  fixture.state.time += 1;
  await captured(fixture.context, "fresh-pr");
  await database.prepare("UPDATE visonaut_runs SET lineage_key='pr:7' WHERE id='fresh-pr'").run();
  await database
    .prepare(
      "INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,state,workflow_run_id,workflow_attempt,created_at,updated_at) VALUES(?,1,'123',?,?,'pull_request','refs/pull/7/merge',7,0,'new-check','active','fresh-pr',1,?,?)",
    )
    .bind("a".repeat(40), "b".repeat(40), "c".repeat(40), fixture.state.time, fixture.state.time)
    .run();
  await publishReviewLinks(fixture.context);
  expect(fixture.state.posts).toBe(originalPosts + 1);
  expect(
    await database.prepare("SELECT target_external_id FROM operations_review_links").first(),
  ).toEqual({
    target_external_id: "new-check",
  });
});

it("retains the latest cutoff and permits a fresh capture with readable history and verified images", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context, "old");
  const oldBytes = fixture.images.objects.get("runs/old/original");
  await sanitizeRestoredDatabase(database, fixture.state.time);
  await database
    .prepare(
      "UPDATE operations_events SET resolved_at=? WHERE id='restore:activation:secrets-required'",
    )
    .bind(fixture.state.time)
    .run();
  expect(await readRestoreCutoff(database)).toBe(fixture.state.time);
  fixture.state.time += 1;
  await sanitizeRestoredDatabase(database, fixture.state.time);
  expect(await readRestoreCutoff(database)).toBe(fixture.state.time);
  await sanitizeRestoredDatabase(database, fixture.state.time - 1);
  expect(await readRestoreCutoff(database)).toBe(fixture.state.time);
  fixture.state.time += 1;
  const fresh = await captured(fixture.context, "fresh");
  await fresh.retireRun({ runId: "fresh", now: fixture.state.time });
  for (let step = 0; step < 50; step++) {
    const report = await archiveClosedRuns(fixture.context);
    expect(report.attention).toEqual([]);
    if (report.completed.includes("fresh")) break;
  }
  expect(await readRunHistory(fixture.context, "fresh")).toMatchObject({
    sections: {
      run: [expect.objectContaining({ id: "fresh" })],
      captures: [expect.objectContaining({ id: "capture-fresh" })],
      comparisonRows: [expect.objectContaining({ comparison_id: "comparison-fresh" })],
    },
  });
  expect(await inspectRecoveryImages(fixture.context)).toMatchObject({
    checked: 2,
    missing: [],
    corrupt: [],
  });
  expect(fixture.images.objects.get("runs/old/original")).toEqual(oldBytes);
  expect(database.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});

it.each(["building", "ready", "failed", "expired"])(
  "releases %s export ownership so restored snapshot bytes can expire",
  async (exportState) => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context, "exported", "main");
    database.connection.exec(`
      INSERT INTO visonaut_snapshots(id,project_id,run_id,comparison_id,tested_sha,state,reference_eligible,prefix,created_at)
        VALUES('exported','project','exported','comparison-exported','sha','accepted',1,'baselines/exported',0);
      INSERT INTO visonaut_pins(snapshot_id,reason,owner_id) VALUES('exported','export','export:old');
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
    expect(database.connection.prepare("SELECT * FROM visonaut_pins").all()).toEqual([]);
    expect(database.connection.prepare("SELECT * FROM work_retention_pins").all()).toEqual([]);
    fixture.state.time += 31 * 86400000;
    const retirement = await expireSnapshotImages(fixture.context);
    expect(retirement.attention).toEqual([]);
    expect(
      database.connection
        .prepare("SELECT byte_state FROM visonaut_snapshot_retention WHERE snapshot_id='exported'")
        .get(),
    ).toEqual({ byte_state: "retiring" });
    let archived = false;
    for (let step = 0; step < 50 && !archived; step++) {
      const result = await archiveClosedRuns(fixture.context);
      expect(result.attention).toEqual([]);
      archived = result.completed.includes("exported");
    }
    expect(archived).toBe(true);
    for (let pass = 0; pass < 100; pass++) {
      const result = await summarizeClosedRuns(fixture.context);
      if (result.completed.includes("exported")) break;
    }
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
        .prepare("SELECT byte_state FROM visonaut_snapshot_retention WHERE snapshot_id='exported'")
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
    database.connection.prepare("SELECT id,closed_at FROM visonaut_runs ORDER BY id").all(),
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
  // The shared two-object budget verifies one root and one page per turn.
  for (let step = 0; step < 100 && expired.size < 2; step++) {
    const summary = await summarizeClosedRuns(fixture.context);
    expect(summary.attention).toEqual([]);
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

it("preserves current and explicit evidence roots while retiring the former rollback baseline", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  for (const id of ["current", "rollback"]) {
    await captured(fixture.context, id, "main");
    database.connection.prepare("UPDATE visonaut_runs SET state='accepted' WHERE id=?").run(id);
    database.connection
      .prepare(
        "INSERT INTO visonaut_snapshots(id,project_id,run_id,comparison_id,tested_sha,state,reference_eligible,prefix,created_at) VALUES(?,'project',?,?,'sha','accepted',1,?,0)",
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
    INSERT INTO visonaut_promotions(id,project_id,snapshot_id,previous_snapshot_id,comparison_id,baseline_revision,created_at)
      VALUES('promotion','project','current','rollback','comparison-current',1,0);
    UPDATE visonaut_projects SET snapshot_id='current',promotion_id='promotion';
    INSERT INTO visonaut_pins(snapshot_id,reason,owner_id) VALUES('rollback','rollback','promotion');
  `);
  const roots = database.connection
    .prepare(
      "SELECT run_id,owner,reason FROM work_retention_pins WHERE owner NOT LIKE 'review:%' ORDER BY run_id,owner",
    )
    .all();
  const command = database.connection.prepare("SELECT * FROM visonaut_commands").all();
  const restoredAt = fixture.state.time;
  await sanitizeRestoredDatabase(database, restoredAt);
  expect(
    database.connection
      .prepare("SELECT active,state,closed_at FROM visonaut_runs WHERE id='current'")
      .get(),
  ).toEqual({ active: 0, state: "accepted", closed_at: restoredAt });
  expect(
    database.connection
      .prepare(
        "SELECT run_id,owner,reason FROM work_retention_pins WHERE owner NOT LIKE 'review:%' ORDER BY run_id,owner",
      )
      .all(),
  ).toEqual(roots);
  expect(database.connection.prepare("SELECT * FROM visonaut_commands").all()).toEqual(command);
  fixture.state.time += 31 * 86400000;
  expect((await archiveClosedRuns(fixture.context)).completed).toEqual([]);
  expect((await expireRunImages(fixture.context)).completed).toEqual([]);
  await expireSnapshotImages(fixture.context);
  expect(
    database.connection
      .prepare(
        "SELECT snapshot_id,byte_state FROM visonaut_snapshot_retention ORDER BY snapshot_id",
      )
      .all(),
  ).toEqual([
    { snapshot_id: "current", byte_state: "live" },
    { snapshot_id: "rollback", byte_state: "retiring" },
  ]);
  expect([...fixture.images.objects.keys()].filter((key) => key.startsWith("runs/"))).toHaveLength(
    7,
  );
  expect(fixture.images.objects.has("baselines/current/original")).toBe(true);
  expect(fixture.images.objects.has("baselines/rollback/original")).toBe(true);

  // A later baseline transition leaves the restored snapshot outside both roots.
  database.connection.exec(
    "UPDATE visonaut_projects SET snapshot_id='rollback',promotion_id=NULL,revision=revision+1",
  );
  await expireSnapshotImages(fixture.context);
  expect(
    database.connection
      .prepare("SELECT byte_state FROM visonaut_snapshot_retention WHERE snapshot_id='current'")
      .get(),
  ).toEqual({ byte_state: "retiring" });
  let archived = false;
  for (let step = 0; step < 50 && !archived; step++) {
    const result = await archiveClosedRuns(fixture.context);
    expect(result.attention).toEqual([]);
    archived = result.completed.includes("current");
  }
  expect(archived).toBe(true);
  for (let pass = 0; pass < 100; pass++) {
    const result = await summarizeClosedRuns(fixture.context);
    if (result.completed.includes("current")) break;
  }
  expect((await expireRunImages(fixture.context)).completed).toEqual(["current"]);
  fixture.state.time += 86400001;
  for (let step = 0; step < 5 && fixture.images.objects.has("baselines/current/original"); step++) {
    await expireSnapshotImages(fixture.context);
  }
  expect(fixture.images.objects.has("runs/current/original")).toBe(false);
  expect(fixture.images.objects.has("baselines/current/original")).toBe(false);
  expect(fixture.images.objects.has("baselines/rollback/original")).toBe(true);
  expect(
    database.connection.prepare("SELECT closed_at FROM visonaut_runs WHERE id='current'").get(),
  ).toEqual({ closed_at: restoredAt });
});

it("rolls back run closure and pin removal together when restore cleanup fails", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  database.connection.exec(`
    INSERT INTO visonaut_snapshots(id,project_id,run_id,comparison_id,tested_sha,state,reference_eligible,prefix,created_at)
      VALUES('exported','project','run','comparison-run','sha','accepted',1,'baselines/exported',0);
    INSERT INTO visonaut_pins(snapshot_id,reason,owner_id) VALUES('exported','export','export:old');
    INSERT INTO operations_exports(id,run_id,actor_id,state,expires_at,created_at)
      VALUES('old','run','maintainer','ready',1,0);
  `);
  const exports = database.connection.prepare("SELECT * FROM operations_exports").all();
  const snapshotPins = database.connection.prepare("SELECT * FROM visonaut_pins").all();
  const before = database.connection
    .prepare("SELECT active,state,closed_at FROM visonaut_runs")
    .all();
  database.connection.exec(`CREATE TRIGGER interrupt_restore BEFORE INSERT ON operations_events
    WHEN NEW.id='restore:activation:secrets-required' BEGIN SELECT RAISE(ABORT,'injected restore failure'); END`);
  await expect(sanitizeRestoredDatabase(database, fixture.state.time)).rejects.toThrow(
    "injected restore failure",
  );
  expect(
    database.connection.prepare("SELECT active,state,closed_at FROM visonaut_runs").all(),
  ).toEqual(before);
  expect(database.connection.prepare("SELECT closed_at FROM work_retained_runs").get()).toEqual({
    closed_at: null,
  });
  expect(database.connection.prepare("SELECT owner FROM work_retention_pins").all()).toEqual([
    { owner: "review:run" },
  ]);
  expect(database.connection.prepare("SELECT * FROM operations_exports").all()).toEqual(exports);
  expect(database.connection.prepare("SELECT * FROM visonaut_pins").all()).toEqual(snapshotPins);
  expect(await readRestoreCutoff(database)).toBe(0);
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
    database.connection.prepare("SELECT id,active,state FROM visonaut_runs ORDER BY id").all(),
  ).toEqual([
    { id: "building", active: 0, state: "failed" },
    { id: "ready", active: 0, state: "failed" },
  ]);
});

it("rehearses an isolated SQL rewind, fences old access and work, and reports unavailable retained originals", async () => {
  using source = new TestDatabase();
  const fixture = context(source);
  await captured(fixture.context, "saved");
  source.connection
    .exec(`INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('user','Maintainer','maintainer@example.test',1,1,1);
 INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES('old-session',9,'old-token',1,1,'user');
 INSERT INTO account(id,accountId,providerId,userId,accessToken,refreshToken,idToken,createdAt,updatedAt) VALUES('account','user','github','user','old-access','old-refresh','old-id',1,1);
 INSERT INTO work_tasks(id,kind,payload,max_attempts,available_at,created_at,updated_at) VALUES('old-task','compare','{}',2,1,1,1);
 INSERT INTO work_checks(id,desired_revision) VALUES('old-check',1);`);
  const directory = await mkdtemp(join(tmpdir(), "visonaut-isolated-rewind-"));
  try {
    const path = join(directory, "restored.sqlite");
    await backup(source.connection, path);
    using restored = new TestDatabase(new DatabaseSync(path));
    const isolated = { ...fixture.context, database: restored };
    await fixture.images.delete("runs/saved/original");
    await sanitizeRestoredDatabase(restored, fixture.context.now());
    await sanitizeRestoredDatabase(restored, fixture.context.now() + 1);
    expect(restored.connection.prepare("SELECT id,active,state FROM visonaut_runs").get()).toEqual({
      id: "saved",
      active: 0,
      state: "failed",
    });
    expect(restored.connection.prepare("SELECT * FROM session").all()).toEqual([]);
    expect(
      restored.connection.prepare("SELECT accessToken,refreshToken,idToken FROM account").get(),
    ).toEqual({ accessToken: null, refreshToken: null, idToken: null });
    expect(
      restored.connection
        .prepare("SELECT state,last_error FROM work_tasks WHERE id='old-task'")
        .get(),
    ).toEqual({ state: "dead", last_error: "restored-environment" });
    expect(
      restored.connection.prepare("SELECT ambiguous FROM work_checks WHERE id='old-check'").get(),
    ).toEqual({ ambiguous: 1 });
    expect(await inspectRecoveryImages(isolated)).toMatchObject({
      checked: 1,
      missing: ["image-saved"],
      corrupt: [],
    });
    await fixture.images.put("runs/saved/original", "corrupt");
    expect(await inspectRecoveryImages(isolated)).toMatchObject({
      missing: [],
      corrupt: ["image-saved"],
    });
    await fixture.images.put("runs/saved/original", "original-image-bytes");
    expect(await inspectRecoveryImages(isolated)).toMatchObject({ missing: [], corrupt: [] });
    expect(source.connection.prepare("SELECT id FROM session").get()).toEqual({
      id: "old-session",
    });
    expect(restored.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
