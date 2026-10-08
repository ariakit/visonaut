import { describe, expect, it } from "vitest";
import { canonicalJson, digestJson } from "@visonaut/protocol";
import {
  closedRunRetentionMs,
  releaseRetentionPinStatement,
  retentionPinStatement,
} from "@visonaut/service";
import { readCaptureInventory } from "../capture-inventory.ts";
import {
  activateReset,
  copyResetPage,
  prepareReset,
  type ResetContext,
} from "../../tooling/baseline-reset/reset.ts";
import { operationsBudgetDefaults } from "../runtime-defaults.ts";
import { runOperations } from "./index.ts";
import { promoteBaselines } from "./promotions.ts";
import { captured, context, inventoryRun, profile, TestDatabase } from "./test-fixtures.ts";

type Fixture = ReturnType<typeof context>;

const day = 86_400_000;
// One day more than the window that keeps the images of a closed run.
const afterRetention = closedRunRetentionMs + day;

function productionFixture(database: TestDatabase) {
  const fixture = context(database);
  // The page of 25 tasks and the other limits are the production defaults.
  fixture.context.budget = { ...operationsBudgetDefaults };
  return fixture;
}

/**
 * Run the complete pass, as cron does, until one pass completes nothing and
 * asks for no continuation. A pass can report no continuation and leave work
 * for the next pass: the image collector reads its candidates before a
 * deletion in the same pass releases the pins that the deleted run owned.
 */
async function runUntilIdle(fixture: Fixture) {
  const deleted: string[] = [];
  const attention = new Set<string>();
  for (let pass = 0; pass < 20; pass++) {
    const { reports, hasMore } = await runOperations(fixture.context);
    let completed = false;
    for (const report of Object.values(reports)) {
      completed ||= report.completed.length > 0;
      for (const subject of report.attention) {
        attention.add(subject);
      }
    }
    deleted.push(...(reports.retention?.completed ?? []));
    if (!hasMore && !completed) {
      return { deleted: deleted.sort(), attention: [...attention].sort() };
    }
  }
  throw new Error("The operations pass did not become idle.");
}

function objectKeys(fixture: Fixture) {
  return [...fixture.images.objects.keys()].sort();
}

function imageKeys(fixture: Fixture) {
  return objectKeys(fixture).filter((key) => key.includes("/images/"));
}

async function inheritedPins(database: TestDatabase) {
  const rows = await database
    .prepare(
      "SELECT run_id || ' <- ' || owner AS pin FROM work_retention_pins WHERE owner LIKE 'inherited-by:%' ORDER BY pin",
    )
    .all<{ pin: string }>();
  return (rows.results ?? []).map((row) => row.pin);
}

async function byteStates(database: TestDatabase) {
  const rows = await database
    .prepare("SELECT id,byte_state FROM work_retained_runs ORDER BY id")
    .all<{ id: string; byte_state: string }>();
  return Object.fromEntries((rows.results ?? []).map((row) => [row.id, row.byte_state]));
}

async function openEvents(database: TestDatabase) {
  const rows = await database
    .prepare("SELECT id FROM operations_events WHERE resolved_at IS NULL ORDER BY id")
    .all<{ id: string }>();
  return (rows.results ?? []).map((row) => row.id);
}

/**
 * Import a baseline of one capture with the real reset tool. The tool reads
 * a baseline of the old form, so the source database has one. The imported
 * run is the inventory baseline of the fixture database.
 */
async function importBaseline(fixture: Fixture) {
  using source = new TestDatabase();
  const sourceFixture = context(source);
  const service = await captured(sourceFixture.context, "seed", "main");
  const profileDigest = await digestJson(profile);
  // The reset tool verifies the profile digest. The old fixture stores a placeholder.
  await source
    .prepare("UPDATE visonaut_captures SET profile_digest=?,metadata_json=? WHERE run_id='seed'")
    .bind(profileDigest, canonicalJson({ profile, name: "Dialog" }))
    .run();
  await promoteBaselines(sourceFixture.context);
  const project = await service.project("project");
  if (!project.snapshot_id) {
    throw new Error("Missing source baseline.");
  }
  const reset: ResetContext = {
    source,
    target: fixture.context.database,
    sourceImages: sourceFixture.images,
    targetImages: fixture.images,
    sourceDatabaseId: "00000000-0000-0000-0000-000000000001",
    targetDatabaseId: "00000000-0000-0000-0000-000000000002",
    projectId: "project",
    now: fixture.context.now,
  };
  const prepared = await prepareReset(reset, {
    snapshotId: project.snapshot_id,
    baselineRevision: project.baseline_revision,
    testedSha: "a".repeat(40),
  });
  await copyResetPage(reset, { importId: prepared.importId, page: 0 });
  await activateReset(reset, prepared.importId);
  const inventory = await readCaptureInventory(fixture.images, prepared.inventory);
  const image = inventory.captures[0]?.image;
  if (!image) {
    throw new Error("Missing imported image.");
  }
  return {
    runId: inventory.runId,
    imageKey: image.objectKey,
    prefix: `baselines/import/${prepared.importId}/`,
    inventoryKey: prepared.inventory.objectKey,
  };
}

describe("retention of inventory runs in the complete operations pass", () => {
  it("keeps the images of a chain of four main runs and of an open pull request", async () => {
    using database = new TestDatabase();
    const fixture = productionFixture(database);
    // Each main run replaces one image and keeps the other image of an earlier run.
    const chain = [
      { id: "a", items: { x: "a", y: "a" } },
      { id: "b", items: { x: "a", y: "b" } },
      { id: "c", items: { x: "c", y: "b" } },
      { id: "d", items: { x: "c", y: "d" } },
    ];
    const inventories: string[] = [];
    for (const { id, items } of chain) {
      const run = await inventoryRun(fixture.context, { id, kind: "main", items });
      inventories.push(run.inventory.objectKey);
      await runUntilIdle(fixture);
      fixture.state.time += day;
    }
    const open = await inventoryRun(fixture.context, {
      id: "open",
      kind: "pull_request",
      items: { x: "c", y: "d", z: "open" },
    });
    inventories.push(open.inventory.objectKey);
    fixture.state.time += afterRetention;

    // No baseline names an image of "a" or "b" now. The inherited-by pin of the
    // next main run keeps each of them (STORE-03). The release of these pins
    // changes the three assertions below: "a" and "b" are then deleted.
    // https://github.com/ariakit/visonaut/issues/258
    expect(await runUntilIdle(fixture)).toEqual({ deleted: [], attention: [] });
    expect(await inheritedPins(database)).toEqual([
      "a <- inherited-by:b",
      "b <- inherited-by:c",
      "c <- inherited-by:d",
      "c <- inherited-by:open",
      "d <- inherited-by:open",
    ]);
    expect(imageKeys(fixture)).toEqual([
      "runs/a/images/x.png",
      "runs/a/images/y.png",
      "runs/b/images/y.png",
      // The current baseline "d" and the open pull request name these images.
      "runs/c/images/x.png",
      "runs/d/images/y.png",
      "runs/open/images/z.png",
    ]);
    expect(objectKeys(fixture)).toEqual(expect.arrayContaining(inventories));
    expect(await openEvents(database)).toEqual([]);
  });

  it("keeps an older baseline while its pull request stays open for 31 days, and deletes both after the close", async () => {
    using database = new TestDatabase();
    const fixture = productionFixture(database);
    const older = await inventoryRun(fixture.context, {
      id: "older",
      kind: "main",
      items: { x: "older", y: "older" },
    });
    await runUntilIdle(fixture);
    const open = await inventoryRun(fixture.context, {
      id: "open",
      kind: "pull_request",
      items: { x: "older", y: "open" },
    });
    fixture.state.time += day;
    // The new baseline replaces each image of the older baseline.
    const current = await inventoryRun(fixture.context, {
      id: "current",
      kind: "main",
      items: { x: "current", y: "current" },
    });
    await runUntilIdle(fixture);
    fixture.state.time += afterRetention;

    expect(await runUntilIdle(fixture)).toEqual({ deleted: [], attention: [] });
    // The open pull request keeps the older baseline with an inherited-by pin.
    expect(await inheritedPins(database)).toEqual(["older <- inherited-by:open"]);
    expect(imageKeys(fixture)).toEqual([
      "runs/current/images/x.png",
      "runs/current/images/y.png",
      "runs/older/images/x.png",
      "runs/older/images/y.png",
      "runs/open/images/y.png",
    ]);

    await open.service.retireRun({ runId: "open", now: fixture.state.time });
    expect(await runUntilIdle(fixture)).toEqual({ deleted: [], attention: [] });
    fixture.state.time += afterRetention;

    expect(await runUntilIdle(fixture)).toEqual({ deleted: ["older", "open"], attention: [] });
    expect(imageKeys(fixture)).toEqual(["runs/current/images/x.png", "runs/current/images/y.png"]);
    expect(await byteStates(database)).toEqual({
      current: "live",
      older: "deleted",
      open: "deleted",
    });
    expect(await inheritedPins(database)).toEqual([]);
    expect(objectKeys(fixture)).toEqual(
      expect.arrayContaining([
        older.inventory.objectKey,
        open.inventory.objectKey,
        current.inventory.objectKey,
      ]),
    );
    expect(await openEvents(database)).toEqual([]);
  });

  it("keeps the images of the imported baseline", async () => {
    using database = new TestDatabase();
    const fixture = productionFixture(database);
    const imported = await importBaseline(fixture);
    await runUntilIdle(fixture);
    fixture.state.time += day;
    // The bytes of the "dialog" item are the bytes of the imported capture.
    await inventoryRun(fixture.context, {
      id: "keeps",
      kind: "main",
      items: { dialog: "original-image-bytes", added: "keeps" },
    });
    await runUntilIdle(fixture);
    fixture.state.time += afterRetention;

    // The current baseline "keeps" names the imported image.
    expect(await runUntilIdle(fixture)).toEqual({ deleted: [], attention: [] });
    expect(imageKeys(fixture)).toEqual([imported.imageKey, "runs/keeps/images/added.png"]);

    await inventoryRun(fixture.context, {
      id: "replaces",
      kind: "main",
      items: { dialog: "replaces", added: "keeps" },
    });
    await runUntilIdle(fixture);
    fixture.state.time += afterRetention;

    // No baseline names the imported image now. The inherited-by pin of the
    // run "keeps" keeps it (STORE-03). The release of that pin changes the
    // three assertions below: the imported image is then deleted.
    // https://github.com/ariakit/visonaut/issues/258
    expect(await runUntilIdle(fixture)).toEqual({ deleted: [], attention: [] });
    expect(await inheritedPins(database)).toEqual([
      `${imported.runId} <- inherited-by:keeps`,
      "keeps <- inherited-by:replaces",
    ]);
    expect(imageKeys(fixture)).toEqual([
      imported.imageKey,
      "runs/keeps/images/added.png",
      "runs/replaces/images/dialog.png",
    ]);
    // The import keeps its inventory and the records of the reset tool.
    expect(objectKeys(fixture)).toEqual(
      expect.arrayContaining([
        imported.inventoryKey,
        `${imported.prefix}plan.json`,
        `${imported.prefix}copies/0.json`,
      ]),
    );
    expect(await openEvents(database)).toEqual([]);
  });

  it("keeps the images of a later run while 25 blocked rows fill the candidate page", async () => {
    using database = new TestDatabase();
    const fixture = productionFixture(database);
    const baseline = await inventoryRun(fixture.context, {
      id: "baseline",
      kind: "main",
      items: { x: "baseline" },
    });
    await runUntilIdle(fixture);
    const blocked = Array.from(
      { length: operationsBudgetDefaults.tasksPerStep },
      (_, index) => `blocked-${String(index).padStart(2, "0")}`,
    );
    // The candidate query sorts by the close time, so "later" is the last row.
    for (const id of [...blocked, "later"]) {
      await inventoryRun(fixture.context, {
        id,
        kind: "pull_request",
        items: { x: "baseline", y: id },
      });
      await baseline.service.retireRun({ runId: id, now: fixture.state.time });
      fixture.state.time += 1;
    }
    // No service call stores a prefix that the collector refuses, so the test
    // changes the rows. Each blocked row names a prefix below the baseline run.
    await database
      .prepare(
        "UPDATE work_retained_runs SET object_prefix='runs/baseline/' || id || '/' WHERE id LIKE 'blocked-%'",
      )
      .run();
    // An object under each refused prefix shows if the collector accepts it.
    for (const id of blocked) {
      await fixture.context.images.put(`runs/baseline/${id}/images/x.png`, id);
    }
    const images = imageKeys(fixture);
    expect(images).toContain("runs/baseline/images/x.png");
    expect(images).toContain("runs/baseline/blocked-00/images/x.png");
    expect(images).toContain("runs/later/images/y.png");
    fixture.state.time += afterRetention;

    // The blocked rows fill the candidate page in each pass, and the pass asks
    // for no continuation (STORE-08). The prefix rule in the candidate query
    // changes the assertions below: the run "later" is then deleted.
    // https://github.com/ariakit/visonaut/issues/258
    expect(await runUntilIdle(fixture)).toEqual({ deleted: [], attention: blocked });
    expect(imageKeys(fixture)).toEqual(images);
    expect(await openEvents(database)).toEqual(
      blocked.map((id) => `retention:${id}:unsafe-prefix`),
    );
  });

  it("deletes the images of a closed run after its retention pin is removed", async () => {
    using database = new TestDatabase();
    const fixture = productionFixture(database);
    await inventoryRun(fixture.context, { id: "baseline", kind: "main", items: { x: "baseline" } });
    await runUntilIdle(fixture);
    const pinned = await inventoryRun(fixture.context, {
      id: "pinned",
      kind: "pull_request",
      items: { x: "baseline", y: "pinned" },
    });
    await pinned.service.retireRun({ runId: "pinned", now: fixture.state.time });
    const pin = { runId: "pinned", owner: "manual", reason: "manual" } as const;
    await retentionPinStatement(database, pin).run();
    fixture.state.time += afterRetention;

    expect(await runUntilIdle(fixture)).toEqual({ deleted: [], attention: [] });
    expect(imageKeys(fixture)).toEqual(["runs/baseline/images/x.png", "runs/pinned/images/y.png"]);

    await releaseRetentionPinStatement(database, pin).run();

    expect(await runUntilIdle(fixture)).toEqual({ deleted: ["pinned"], attention: [] });
    expect(imageKeys(fixture)).toEqual(["runs/baseline/images/x.png"]);
    expect(await byteStates(database)).toEqual({ baseline: "live", pinned: "deleted" });
    expect(fixture.images.objects.has(pinned.inventory.objectKey)).toBe(true);
    expect(await openEvents(database)).toEqual([]);
  });
});
