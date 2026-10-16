import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, describe, expect, it, vi } from "vitest";
import { canonicalJson, digestJson } from "@visonaut/protocol";
import {
  closedRunRetentionMs,
  type Database,
  releaseRetentionPinStatement,
  retentionPinStatement,
  type ReviewCounts,
  reviewCountsSql,
  Service,
} from "@visonaut/service";
import { applyTestMigrations, readTestMigrations } from "../../../../tooling/test-migrations.ts";
import { measureD1 } from "../api/test-d1-costs.ts";
import { readCaptureInventory } from "../capture-inventory.ts";
import {
  activateReset,
  copyResetPage,
  prepareReset,
  type ResetContext,
} from "../../tooling/baseline-reset/reset.ts";
import { operationsBudgetDefaults } from "../runtime-defaults.ts";
import { runOperations } from "./index.ts";
import * as mainRetirement from "./main-retirement.ts";
import { promoteBaselines } from "./promotions.ts";
import { expireComparisonReferences } from "./snapshot-retention.ts";
import { expireRunImages, imagePrefix, type RetainedImageOwner } from "./retention.ts";
import { captured, context, digest, inventoryRun, profile, TestDatabase } from "./test-fixtures.ts";

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

async function inheritedPins(database: Database) {
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

/**
 * The number of rows in each table that the release must not change: the
 * runs, their comparisons, their comparison rows, and their decisions. The
 * deletion of the rows of closed runs comes with #276. The summary step and
 * the image collector change the capture and image rows of a closed run, with
 * or without the release, so this list does not have them.
 */
async function keptRows(database: Database) {
  const tables = [
    "visonaut_runs",
    "work_retained_runs",
    "visonaut_comparisons",
    "visonaut_comparison_rows",
    "visonaut_decisions",
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const row = await database
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .first<{ count: number }>();
    counts[table] = row?.count ?? 0;
  }
  return counts;
}

async function closedAt(database: Database, runId: string) {
  const row = await database
    .prepare("SELECT closed_at FROM visonaut_runs WHERE id=?")
    .bind(runId)
    .first<{ closed_at: number | null }>();
  if (row?.closed_at == null) {
    throw new Error(`The run ${runId} is not closed.`);
  }
  return row.closed_at;
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

/**
 * Make three main runs. The run "mid" keeps the image "x" of "old", and the
 * current baseline "new" names no image of "old". So only the inherited-by pin
 * of "mid" keeps "old".
 */
async function replacedBaseline(fixture: Fixture, database: Database) {
  const old = await inventoryRun(fixture.context, {
    id: "old",
    kind: "main",
    items: { x: "old", y: "old" },
  });
  await runUntilIdle(fixture);
  fixture.state.time += day;
  await inventoryRun(fixture.context, { id: "mid", kind: "main", items: { x: "old", y: "mid" } });
  await runUntilIdle(fixture);
  fixture.state.time += day;
  await inventoryRun(fixture.context, { id: "new", kind: "main", items: { x: "new", y: "mid" } });
  await runUntilIdle(fixture);
  expect(await inheritedPins(database)).toEqual([
    "mid <- inherited-by:new",
    "old <- inherited-by:mid",
  ]);
  return old;
}

describe("retention of inventory runs in the complete operations pass", () => {
  it("deletes the images of three replaced baselines and keeps the current baseline and an open pull request", async () => {
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
      inventories.push(...run.inventoryKeys);
      await runUntilIdle(fixture);
      fixture.state.time += day;
    }
    const open = await inventoryRun(fixture.context, {
      id: "open",
      kind: "pull_request",
      items: { x: "c", y: "d", z: "open" },
    });
    inventories.push(...open.inventoryKeys);
    expect(await inheritedPins(database)).toEqual([
      "a <- inherited-by:b",
      "b <- inherited-by:c",
      "c <- inherited-by:d",
      "c <- inherited-by:open",
      "d <- inherited-by:open",
    ]);
    const rows = await keptRows(database);
    fixture.state.time += afterRetention;

    // No baseline names an image of "a" or "b" now. The main runs "b", "c",
    // and "d" closed more than 30 days ago, so the pass releases the pins that
    // they own (STORE-03, D-DATA-04). The baseline pins of "d" keep "c" and "d".
    expect(await runUntilIdle(fixture)).toEqual({ deleted: ["a", "b"], attention: [] });
    // The open pull request is active, so its pins stay.
    expect(await inheritedPins(database)).toEqual([
      "c <- inherited-by:open",
      "d <- inherited-by:open",
    ]);
    expect(imageKeys(fixture)).toEqual([
      // The current baseline "d" and the open pull request name these images.
      "runs/c/images/x.png",
      "runs/d/images/y.png",
      "runs/open/images/z.png",
    ]);
    expect(await byteStates(database)).toEqual({
      a: "deleted",
      b: "deleted",
      c: "live",
      d: "live",
      open: "live",
    });
    // The inventories and the bookkeeping rows stay.
    expect(objectKeys(fixture)).toEqual(expect.arrayContaining(inventories));
    expect(await keptRows(database)).toEqual(rows);
    const summaries = await database
      .prepare("SELECT run_id FROM visonaut_closed_summaries WHERE state='ready' ORDER BY run_id")
      .all<{ run_id: string }>();
    expect(summaries.results?.map((row) => row.run_id)).toEqual(["a", "b", "c", "d"]);
    expect(await openEvents(database)).toEqual([]);
  });

  it("keeps a replaced baseline until 30 days after each newer run that needs it closes", async () => {
    using database = new TestDatabase();
    const fixture = productionFixture(database);
    const old = await replacedBaseline(fixture, database);
    // The step compares `visonaut_runs.closed_at` of the newer run with the
    // 30-day window, as the image collector compares the close of a run.
    const midRelease = (await closedAt(database, "mid")) + closedRunRetentionMs;
    const newRelease = (await closedAt(database, "new")) + closedRunRetentionMs;

    fixture.state.time = midRelease - 1;
    expect(await runUntilIdle(fixture)).toEqual({ deleted: [], attention: [] });
    expect(await inheritedPins(database)).toEqual([
      "mid <- inherited-by:new",
      "old <- inherited-by:mid",
    ]);

    fixture.state.time = midRelease;
    expect(await runUntilIdle(fixture)).toEqual({ deleted: [], attention: [] });
    expect(await inheritedPins(database)).toEqual(["mid <- inherited-by:new"]);
    // The comparison of "new" read the image "x" of "old" as its reference.
    // The same step releases that comparison pin 30 days after "new" closes.
    fixture.state.time = newRelease - 1;
    expect(await runUntilIdle(fixture)).toEqual({ deleted: [], attention: [] });
    expect(imageKeys(fixture)).toContain("runs/old/images/x.png");

    fixture.state.time = newRelease;
    expect(await runUntilIdle(fixture)).toEqual({ deleted: ["old"], attention: [] });
    // The baseline pins of "new" keep "mid".
    expect(await inheritedPins(database)).toEqual([]);
    expect(imageKeys(fixture)).toEqual(["runs/mid/images/y.png", "runs/new/images/x.png"]);
    expect(objectKeys(fixture)).toEqual(expect.arrayContaining(old.inventoryKeys));
    expect(await openEvents(database)).toEqual([]);
  });

  it("keeps a replaced baseline while a manual pin keeps the newer run", async () => {
    using database = new TestDatabase();
    const fixture = productionFixture(database);
    await replacedBaseline(fixture, database);
    // The page of a pinned run shows the images that it inherited.
    const pin = { runId: "mid", owner: "manual", reason: "manual" } as const;
    await retentionPinStatement(database, pin).run();
    fixture.state.time += afterRetention;

    expect(await runUntilIdle(fixture)).toEqual({ deleted: [], attention: [] });
    expect(await inheritedPins(database)).toEqual(["old <- inherited-by:mid"]);
    expect(imageKeys(fixture)).toContain("runs/old/images/x.png");

    await releaseRetentionPinStatement(database, pin).run();
    expect(await runUntilIdle(fixture)).toEqual({ deleted: ["old"], attention: [] });
    expect(await inheritedPins(database)).toEqual([]);
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
        ...older.inventoryKeys,
        ...open.inventoryKeys,
        ...current.inventoryKeys,
      ]),
    );
    expect(await openEvents(database)).toEqual([]);
  });

  it("keeps the images of the imported baseline while the current baseline names them", async () => {
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

    // The current baseline "keeps" closed more than 30 days ago, so the pass
    // releases its inherited-by pin. Its baseline pin keeps the imported image.
    expect(await runUntilIdle(fixture)).toEqual({ deleted: [], attention: [] });
    expect(await inheritedPins(database)).toEqual([]);
    expect(imageKeys(fixture)).toEqual([imported.imageKey, "runs/keeps/images/added.png"]);

    await inventoryRun(fixture.context, {
      id: "replaces",
      kind: "main",
      items: { dialog: "replaces", added: "keeps" },
    });
    await runUntilIdle(fixture);
    fixture.state.time += afterRetention;

    // No baseline names the imported image now, and no pin keeps it.
    expect(await runUntilIdle(fixture)).toEqual({ deleted: [imported.runId], attention: [] });
    expect(await inheritedPins(database)).toEqual([]);
    expect(imageKeys(fixture)).toEqual([
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

  it("deletes the images of a later run in the pass that has 25 blocked rows", async () => {
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
    // The history step makes 25 runs ready in one pass. Make each of the 26
    // runs ready first, so that all of them expire in the same pass.
    for (let pass = 0; pass < 20; pass++) {
      const history = await runOperations(fixture.context, {
        kind: "maintenance",
        family: "history",
      });
      if (!history.hasMore) break;
    }
    const ready = await database
      .prepare("SELECT run_id FROM visonaut_closed_summaries WHERE state='ready' ORDER BY run_id")
      .all<{ run_id: string }>();
    expect(ready.results?.map((row) => row.run_id)).toEqual(["baseline", ...blocked, "later"]);

    // The candidate query applies the prefix rule, so a blocked row is not a
    // candidate and cannot fill the candidate page (STORE-08).
    const pass = await runOperations(fixture.context);
    expect(pass.reports.retention).toEqual({
      completed: ["later"],
      deferred: [],
      attention: [],
      hasMore: false,
    });
    expect(await runUntilIdle(fixture)).toEqual({ deleted: [], attention: [] });
    expect(imageKeys(fixture)).toEqual(images.filter((key) => key !== "runs/later/images/y.png"));
    expect(await byteStates(database)).toEqual({
      baseline: "live",
      ...Object.fromEntries(blocked.map((id) => [id, "live"])),
      later: "deleted",
    });
    // A blocked row writes no event now. The pass does not report it.
    expect(await openEvents(database)).toEqual([]);
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
    expect(objectKeys(fixture)).toEqual(expect.arrayContaining(pinned.inventoryKeys));
    expect(await openEvents(database)).toEqual([]);
  });

  // A failed step before the ten steps does not stop the retention steps of
  // the same pass.
  it.each([
    [
      "main-retirement",
      () =>
        vi
          .spyOn(mainRetirement, "retireReplacedMainRuns")
          .mockRejectedValue(new Error("Database unavailable.")),
    ],
    [
      "finalization",
      () =>
        vi
          .spyOn(Service.prototype, "reconcileComparisons")
          .mockRejectedValue(new Error("Database unavailable.")),
    ],
  ] as const)(
    "deletes only the expired images in the passes whose step %s fails",
    async (step, fail) => {
      using database = new TestDatabase();
      const fixture = productionFixture(database);
      await inventoryRun(fixture.context, {
        id: "baseline",
        kind: "main",
        items: { x: "baseline" },
      });
      await runUntilIdle(fixture);
      const open = await inventoryRun(fixture.context, {
        id: "open",
        kind: "pull_request",
        items: { x: "baseline", y: "open" },
      });
      const closed = await inventoryRun(fixture.context, {
        id: "closed",
        kind: "pull_request",
        items: { x: "baseline", y: "closed" },
      });
      await closed.service.retireRun({ runId: "closed", now: fixture.state.time });
      fixture.state.time += afterRetention;

      const failure = fail();
      try {
        expect(await runUntilIdle(fixture)).toEqual({
          deleted: ["closed"],
          attention: ["scheduler"],
        });
        expect(failure).toHaveBeenCalled();
      } finally {
        failure.mockRestore();
      }
      // The baseline and the open pull request keep their images.
      expect(imageKeys(fixture)).toEqual(["runs/baseline/images/x.png", "runs/open/images/y.png"]);
      expect(await byteStates(database)).toEqual({
        baseline: "live",
        closed: "deleted",
        open: "live",
      });
      expect(objectKeys(fixture)).toEqual(
        expect.arrayContaining([...open.inventoryKeys, ...closed.inventoryKeys]),
      );
      expect(await openEvents(database)).toEqual([`${step}:scheduler:step-failed`]);
    },
  );
});

/**
 * Delete the changed rows and the decisions of a released run, in the order
 * that step 4 of #276 names: the reservations and the replacements that point
 * at its decisions, then its decisions, then its comparison rows. Step 4 does
 * not exist yet, so the test deletes the rows with these plain statements.
 */
async function deleteReleasedRows(database: Database, runId: string) {
  const rows = `SELECT row.id FROM visonaut_comparison_rows row
    JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id
    WHERE comparison.run_id=?`;
  const decisions = `SELECT id FROM visonaut_decisions WHERE row_id IN (${rows})`;
  await database.batch([
    database
      .prepare(`DELETE FROM visonaut_reservations WHERE decision_id IN (${decisions})`)
      .bind(runId),
    database
      .prepare(
        `DELETE FROM visonaut_decision_replacements WHERE source_decision_id IN (${decisions}) OR replacement_decision_id IN (${decisions})`,
      )
      .bind(runId, runId),
    database.prepare(`DELETE FROM visonaut_decisions WHERE row_id IN (${rows})`).bind(runId),
    database
      .prepare(
        "DELETE FROM visonaut_comparison_rows WHERE comparison_id IN (SELECT id FROM visonaut_comparisons WHERE run_id=?)",
      )
      .bind(runId),
  ]);
}

/** The number of comparison rows and decisions of a run. */
async function rowsOf(database: Database, runId: string) {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS rows,
        (SELECT COUNT(*) FROM visonaut_decisions decision WHERE decision.row_id IN (
          SELECT row.id FROM visonaut_comparison_rows row
          JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id
          WHERE comparison.run_id=?)) AS decisions
      FROM visonaut_comparison_rows row
      JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id
      WHERE comparison.run_id=?`,
    )
    .bind(runId, runId)
    .first<{ rows: number; decisions: number }>();
  return row;
}

/**
 * The current decision of each row of a run, by item: "unchanged", "none"
 * for a change with no decision, or the kind and the verdict of the decision.
 * A copy is a carried approval.
 */
async function decisionsOf(database: Database, runId: string) {
  const rows = await database
    .prepare(
      `SELECT row.item_key,row.outcome,decision.verdict,decision.kind,
        decision.id LIKE 'copied:%' AS copied
      FROM visonaut_comparison_rows row
      JOIN visonaut_comparisons comparison ON comparison.id=row.comparison_id
      LEFT JOIN visonaut_decisions decision ON decision.id=row.decision_id
      WHERE comparison.run_id=? ORDER BY row.item_key`,
    )
    .bind(runId)
    .all<{
      item_key: string;
      outcome: string;
      verdict: string | null;
      kind: string | null;
      copied: number | null;
    }>();
  return Object.fromEntries(
    (rows.results ?? []).map((row) => [
      row.item_key,
      row.outcome === "unchanged"
        ? "unchanged"
        : `${row.copied ? "copied " : ""}${row.kind ?? ""} ${row.verdict ?? "none"}`.trim(),
    ]),
  );
}

/** The three check counts of the current comparison of a run. */
async function countsOf(database: Database, runId: string) {
  return database
    .prepare(
      `SELECT ${reviewCountsSql} FROM visonaut_comparison_rows row
      LEFT JOIN visonaut_decisions decision ON decision.id=row.decision_id
      WHERE row.comparison_id=(SELECT comparison_id FROM visonaut_runs WHERE id=?)`,
    )
    .bind(runId)
    .first<ReviewCounts>();
}

/** The acceptance of each row in the closed summary of a run, by item. */
async function summaryOf(database: Database, runId: string) {
  const rows = await database
    .prepare(
      "SELECT item_key,accepted,verdict,kind FROM visonaut_closed_summary_rows WHERE run_id=? ORDER BY item_key",
    )
    .bind(runId)
    .all<{ item_key: string; accepted: number; verdict: string | null; kind: string | null }>();
  return Object.fromEntries(
    (rows.results ?? []).map((row) => [
      row.item_key,
      `${row.accepted ? "accepted" : "not accepted"} ${row.kind ?? ""} ${row.verdict ?? ""}`.trim(),
    ]),
  );
}

interface DecideParams {
  service: Service;
  runId: string;
  itemKey: string;
  verdict: "approved" | "rejected";
  now: number;
}

/** Record the verdict of a reviewer on the row of one item. */
async function decide({ service, runId, itemKey, verdict, now }: DecideParams) {
  const comparisonId = `comparison-${runId}`;
  const rows = await service.comparisonRows(comparisonId);
  const row = rows.find((entry) => entry.item_key === itemKey);
  if (!row) {
    throw new Error(`The run ${runId} has no row for ${itemKey}.`);
  }
  await service.review({
    commandId: `${verdict}-${row.id}`,
    actorId: "maintainer",
    sessionId: "session",
    comparisonId,
    verdict,
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: row.item_key, variantKey: row.variant_key },
    now,
  });
}

/** Make the inventory baseline "base" with the given images. */
async function baseline(fixture: Fixture, items: Record<string, string>) {
  const { service } = await inventoryRun(fixture.context, { id: "base", kind: "main", items });
  expect(await runUntilIdle(fixture)).toEqual({ deleted: [], attention: [] });
  fixture.state.time += day;
  return service;
}

/** Close a pull request run, and run the operations after the window. */
async function release(fixture: Fixture, service: Service, runId: string) {
  fixture.state.time += day;
  await service.retireRun({ runId, now: fixture.state.time });
  fixture.state.time += afterRetention;
  return runUntilIdle(fixture);
}

const pullRequest = { kind: "pull_request", lineageKey: "pr" } as const;

// The five readers of step 1 of #276: the carried approval and the automatic
// approval (local-comparison.ts), the promotion guard (baseline-promotion.ts),
// the check counts (review-status.ts), and the acceptance of a closed summary
// (closed-summary.ts). Each case runs one time with the rows of the released
// run and one time without them.
describe("the readers of a released run", () => {
  /**
   * The pull request "gone" changes "x" and introduces "z", and it closes.
   * After its release, a later pull request with the same images, a main run,
   * and the closed summaries do not read its rows. No later run is in the
   * lineage of "gone", so each reader excludes it by its lineage, its own row,
   * or a NULL source_decision_id. The cases below share a lineage.
   */
  const releasedPullRequest = async (deleteReleased: boolean) => {
    using database = new TestDatabase();
    const fixture = productionFixture(database);
    const service = await baseline(fixture, { x: "base", y: "base" });
    const changed = { x: "changed", y: "base", z: "new" };
    const gone = await inventoryRun(fixture.context, {
      id: "gone",
      kind: "pull_request",
      items: changed,
    });
    expect(await release(fixture, service, "gone")).toEqual({ deleted: ["gone"], attention: [] });
    if (deleteReleased) {
      await deleteReleasedRows(database, "gone");
    }
    const released = await rowsOf(database, "gone");
    const now = fixture.state.time;
    // Another pull request has the same images in its own lineage. Its first
    // run gets the automatic approval of "z", and its second run carries both
    // approvals of the first run.
    await inventoryRun(fixture.context, {
      ...pullRequest,
      id: "first",
      items: changed,
      approve: false,
    });
    await decide({ service, runId: "first", itemKey: "x", verdict: "approved", now });
    fixture.state.time += day;
    await service.retireRun({ runId: "first", now: fixture.state.time });
    await inventoryRun(fixture.context, {
      ...pullRequest,
      id: "second",
      items: changed,
      relatedRunIds: ["first"],
      approve: false,
    });
    const active = {
      status: (await service.status("second")).status,
      counts: await countsOf(database, "second"),
    };
    fixture.state.time += day;
    // The promotion guard reads the rows of "next" only.
    await inventoryRun(fixture.context, {
      id: "next",
      kind: "main",
      items: { x: "next", y: "base" },
    });
    expect(await runUntilIdle(fixture)).toEqual({ deleted: [], attention: [] });
    const snapshot = await database
      .prepare(
        "SELECT snapshot.run_id FROM visonaut_projects project JOIN visonaut_snapshots snapshot ON snapshot.id=project.snapshot_id",
      )
      .first<{ run_id: string }>();
    const baselineCounts = await countsOf(database, "next");
    await service.retireRun({ runId: "second", now: fixture.state.time });
    fixture.state.time += afterRetention;
    expect(await runUntilIdle(fixture)).toEqual({
      deleted: ["first", "second"],
      attention: [],
    });
    return {
      released,
      inventoryKept: objectKeys(fixture).includes(gone.inventory.objectKey),
      decisions: {
        first: await decisionsOf(database, "first"),
        second: await decisionsOf(database, "second"),
        next: await decisionsOf(database, "next"),
      },
      active,
      baseline: { runId: snapshot?.run_id, counts: baselineCounts },
      summaries: {
        first: await summaryOf(database, "first"),
        second: await summaryOf(database, "second"),
        next: await summaryOf(database, "next"),
      },
    };
  };

  it("gives the five readers the same results when the rows of a released pull request are deleted", async () => {
    const kept = await releasedPullRequest(false);
    const deleted = await releasedPullRequest(true);
    expect(deleted.released).toEqual({ rows: 0, decisions: 0 });
    expect({ ...deleted, released: kept.released }).toEqual(kept);
    expect(kept).toEqual({
      // The page form stores a row only for a changed capture.
      released: { rows: 2, decisions: 3 },
      inventoryKept: true,
      decisions: {
        first: { x: "human approved", z: "automatic approved" },
        second: { x: "copied human approved", z: "copied automatic approved" },
        next: { x: "human approved" },
      },
      active: { status: "passed", counts: { pending: 0, rejected: 0, approved: 2 } },
      baseline: { runId: "next", counts: { pending: 0, rejected: 0, approved: 1 } },
      summaries: {
        first: {
          x: "accepted human approved",
          z: "accepted automatic approved",
        },
        second: {
          x: "accepted human approved",
          z: "accepted automatic approved",
        },
        next: { x: "accepted human approved" },
      },
    });
  });

  /**
   * The first run "a" of a pull request removes "y" and introduces "s". Each
   * gets the automatic approval, with the reservation of the lineage. Then a
   * main run changes "y", and the next push "b" removes "y" and changes "s".
   */
  const reservedDecisions = async (deleteReleased: boolean) => {
    using database = new TestDatabase();
    const fixture = productionFixture(database);
    const service = await baseline(fixture, { x: "base", y: "base" });
    await inventoryRun(fixture.context, {
      ...pullRequest,
      id: "a",
      items: { x: "base", s: "new" },
      approve: false,
    });
    const first = await decisionsOf(database, "a");
    fixture.state.time += day;
    // The new baseline gives the removal of "y" a new tuple, so "b" copies no
    // decision of "a".
    await inventoryRun(fixture.context, {
      id: "next",
      kind: "main",
      items: { x: "base", y: "next" },
    });
    expect(await release(fixture, service, "a")).toEqual({ deleted: ["a"], attention: [] });
    if (deleteReleased) {
      await deleteReleasedRows(database, "a");
    }
    await inventoryRun(fixture.context, {
      ...pullRequest,
      id: "b",
      items: { x: "base", s: "newer" },
      relatedRunIds: ["a"],
      approve: false,
    });
    return { a: first, b: await decisionsOf(database, "b") };
  };

  it("needs the run whose removal decision the reservation of an open lineage names", async () => {
    const first = { s: "automatic approved", y: "automatic approved" };
    // Today the lineage gets one automatic approval of each identity.
    expect(await reservedDecisions(false)).toEqual({ a: first, b: { s: "none", y: "none" } });
    // Without the rows of "a", the removal gets a second automatic approval.
    // So step 4 keeps "a" while the lineage "pr" can get a new run. The
    // introduction does not: the identity history of the lineage blocks it.
    expect(await reservedDecisions(true)).toEqual({
      a: first,
      b: { s: "none", y: "automatic approved" },
    });
  });

  it("needs the run with a rejection in force while a kept run approved the same tuple", async () => {
    using database = new TestDatabase();
    const fixture = productionFixture(database);
    const service = await baseline(fixture, { x: "base" });
    const items = { x: "changed", s: "new" };
    const pull = { ...pullRequest, items, approve: false };
    // The run "a" keeps its rows: the reservation of "s" names its decision.
    await inventoryRun(fixture.context, { ...pull, id: "a" });
    const now = fixture.state.time;
    await decide({ service, runId: "a", itemKey: "x", verdict: "approved", now });
    fixture.state.time += day;
    await service.retireRun({ runId: "a", now: fixture.state.time });
    await inventoryRun(fixture.context, { ...pull, id: "r", relatedRunIds: ["a"] });
    expect(await decisionsOf(database, "r")).toEqual({
      s: "copied automatic approved",
      x: "copied human approved",
    });
    fixture.state.time += day;
    await decide({
      service,
      runId: "r",
      itemKey: "x",
      verdict: "rejected",
      now: fixture.state.time,
    });
    fixture.state.time += day;
    await service.retireRun({ runId: "r", now: fixture.state.time });
    await inventoryRun(fixture.context, { ...pull, id: "l", relatedRunIds: ["r"] });
    // The rejection in "r" stops the copy of the approval of "a" (D-OPS-06).
    expect(await decisionsOf(database, "l")).toEqual({ s: "copied automatic approved", x: "none" });
    fixture.state.time += afterRetention;
    expect(await runUntilIdle(fixture)).toEqual({ deleted: ["a", "r"], attention: [] });
    // No reservation and no copy points at a decision of "r". Only the
    // rejection keeps it: with its rows deleted, "m" copies the approval of
    // "a". Step 4 adds this condition and runs its deletion here, and the
    // assertions below must still pass.
    // https://github.com/ariakit/visonaut/issues/276#issuecomment-6209963921
    const pointers = await database
      .prepare(
        `SELECT COUNT(*) AS count FROM visonaut_decisions decision
        JOIN visonaut_comparison_rows row ON row.id=decision.row_id
        WHERE row.comparison_id='comparison-r' AND (
          EXISTS (SELECT 1 FROM visonaut_reservations WHERE decision_id=decision.id)
          OR EXISTS (SELECT 1 FROM visonaut_decisions copy WHERE copy.source_decision_id=decision.id))`,
      )
      .first<{ count: number }>();
    expect(pointers?.count).toBe(0);
    fixture.state.time += day;
    await service.retireRun({ runId: "l", now: fixture.state.time });
    await inventoryRun(fixture.context, { ...pull, id: "m", relatedRunIds: ["l"] });
    expect(await decisionsOf(database, "m")).toEqual({ s: "copied automatic approved", x: "none" });
    expect(await rowsOf(database, "r")).toEqual({ rows: 2, decisions: 3 });
  });

  /** The run "a" approves "x". The next push "b" comes after its release. */
  const laterPush = async (deleteReleased: boolean) => {
    using database = new TestDatabase();
    const fixture = productionFixture(database);
    const service = await baseline(fixture, { x: "base" });
    await inventoryRun(fixture.context, { ...pullRequest, id: "a", items: { x: "changed" } });
    expect(await release(fixture, service, "a")).toEqual({ deleted: ["a"], attention: [] });
    if (deleteReleased) {
      await deleteReleasedRows(database, "a");
    }
    await inventoryRun(fixture.context, {
      ...pullRequest,
      id: "b",
      items: { x: "changed" },
      relatedRunIds: ["a"],
      approve: false,
    });
    return decisionsOf(database, "b");
  };

  it("copies no approval of a released run to a later push of its pull request", async () => {
    expect(await laterPush(false)).toEqual({ x: "copied human approved" });
    // D-SCALE-03 gives this up: an approval older than the window is not
    // copied to a later run.
    expect(await laterPush(true)).toEqual({ x: "none" });
  });

  it("refuses the deletion while a copy in a run that is not released points at a decision", async () => {
    using database = new TestDatabase();
    const fixture = productionFixture(database);
    const service = await baseline(fixture, { x: "base" });
    await inventoryRun(fixture.context, { ...pullRequest, id: "a", items: { x: "changed" } });
    fixture.state.time += day;
    await service.retireRun({ runId: "a", now: fixture.state.time });
    await inventoryRun(fixture.context, {
      ...pullRequest,
      id: "b",
      items: { x: "changed" },
      relatedRunIds: ["a"],
      approve: false,
    });
    // "b" closes 20 days after "a", so the pass releases "a" alone.
    const gap = 20 * day;
    fixture.state.time += gap;
    await service.retireRun({ runId: "b", now: fixture.state.time });
    fixture.state.time += afterRetention - gap;
    expect(await runUntilIdle(fixture)).toEqual({ deleted: ["a"], attention: [] });
    // The copy in "b" names the decision of "a" in source_decision_id, which
    // is a foreign key. So the deletion of "a" waits for the release of "b".
    await expect(deleteReleasedRows(database, "a")).rejects.toThrow(/FOREIGN KEY/);
    expect(await rowsOf(database, "a")).toEqual({ rows: 1, decisions: 1 });
    fixture.state.time += gap;
    expect(await runUntilIdle(fixture)).toEqual({ deleted: ["b"], attention: [] });
    await deleteReleasedRows(database, "b");
    await deleteReleasedRows(database, "a");
    expect(await rowsOf(database, "a")).toEqual({ rows: 0, decisions: 0 });
  });
});

describe("the D1 writes of a release", () => {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('release writes'); } }",
      compatibilityDate: "2026-09-22",
      d1Databases: ["DB"],
    }),
  );
  afterAll(async () => runtime.dispose());

  // The native D1 of Miniflare needs more time than the default.
  it("writes the rows of a release one time, and no row in a later pass", async () => {
    using local = new TestDatabase();
    const native = await runtime.getD1Database("DB");
    await applyTestMigrations(native);
    const measured = measureD1(native);
    const fixture = productionFixture(local);
    fixture.context.database = measured.database;
    await replacedBaseline(fixture, native);
    const midRelease = (await closedAt(native, "mid")) + closedRunRetentionMs;
    const newRelease = (await closedAt(native, "new")) + closedRunRetentionMs;
    // Each statement that writes, with the text before its WHERE clause.
    const writes = () =>
      measured.costs
        .filter((cost) => cost.rows_written > 0)
        .map((cost) => [cost.sql.split(" WHERE ")[0], cost.rows_written] as const);
    const idlePass = async () => {
      await runUntilIdle(fixture);
      measured.reset();
      await runOperations(fixture.context);
      return writes();
    };
    const releaseWrites = (pins: number) => [
      ["DELETE FROM work_retention_pins", pins],
      ["DELETE FROM visonaut_pins", 1],
      ["UPDATE work_retained_runs SET references_released_at=?", 1],
    ];

    fixture.state.time = midRelease - 1;
    await runUntilIdle(fixture);
    fixture.state.time = midRelease;
    measured.reset();
    const release = await expireComparisonReferences(fixture.context);
    expect(release.completed).toEqual(["mid"]);
    // The pins of "mid" on "old": its inherited-by pin and its comparison pin.
    expect(writes()).toEqual(releaseWrites(2));
    measured.reset();
    expect((await expireComparisonReferences(fixture.context)).completed).toEqual([]);
    expect(writes()).toEqual([]);
    expect(await idlePass()).toEqual([]);

    fixture.state.time = newRelease;
    measured.reset();
    expect((await expireComparisonReferences(fixture.context)).completed).toEqual(["new"]);
    // The inherited-by pin of "new" on "mid", and its comparison pins on
    // "mid" and "old".
    expect(writes()).toEqual(releaseWrites(3));
    // The image collector then deletes the 2 images of "old": 4 rows for the
    // run and 3 rows for each image, one time.
    measured.reset();
    expect((await expireRunImages(fixture.context)).completed).toEqual(["old"]);
    expect(writes().reduce((sum, [, rows]) => sum + rows, 0)).toBe(10);
    expect(await idlePass()).toEqual([]);
  }, 120_000);
});

// Step 4 of #276 deletes the rows of a released run, so the run row keeps the
// three review counts of its closed page.
describe("the review counts in the run row", () => {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('review counts'); } }",
      compatibilityDate: "2026-09-22",
      d1Databases: ["DB", "BEFORE"],
    }),
  );
  afterAll(async () => runtime.dispose());

  const storedCounts = (database: Database, runId: string) =>
    database
      .prepare(
        "SELECT review_pending AS pending,review_rejected AS rejected,review_approved AS approved FROM visonaut_runs WHERE id=?",
      )
      .bind(runId)
      .first();

  it("stores the counts in the closed summary write of the run row, one time", async () => {
    using local = new TestDatabase();
    const native = await runtime.getD1Database("DB");
    await applyTestMigrations(native);
    const measured = measureD1(native);
    const fixture = productionFixture(local);
    fixture.context.database = measured.database;
    await baseline(fixture, { a: "a", b: "b", c: "c", d: "d" });
    const { service } = await inventoryRun(fixture.context, {
      ...pullRequest,
      id: "counted",
      items: { a: "a2", b: "b2", c: "c2", d: "d" },
      approve: false,
    });
    const now = fixture.state.time;
    await decide({ service, runId: "counted", itemKey: "a", verdict: "approved", now });
    measured.reset();
    await decide({ service, runId: "counted", itemKey: "b", verdict: "rejected", now });
    // The rows of a decision on `main` before this step. A decision does not
    // write the counts.
    expect(measured.totals().rows_written).toBe(13);
    const counts = { pending: 2, rejected: 1, approved: 1 };
    expect(await countsOf(native, "counted")).toEqual(counts);
    expect(await storedCounts(native, "counted")).toEqual({
      pending: null,
      rejected: null,
      approved: null,
    });

    fixture.state.time += day;
    await service.retireRun({ runId: "counted", now: fixture.state.time });
    fixture.state.time += afterRetention;
    measured.reset();
    expect(await runUntilIdle(fixture)).toMatchObject({ attention: [] });
    // The counts go into the run row that the closed summary already writes.
    const runWrites = () =>
      measured.costs
        .filter((cost) => cost.rows_written > 0 && /^UPDATE visonaut_runs\b/u.test(cost.sql))
        .map((cost) => [cost.sql.split(",")[0], cost.rows_written]);
    // One write for each closed run: "counted", and the accepted run of the
    // baseline, which closed when it became the baseline.
    const summaryWrite = ["UPDATE visonaut_runs SET plan_json='{}'", 1];
    expect(runWrites()).toEqual([summaryWrite, summaryWrite]);
    expect(await storedCounts(native, "counted")).toEqual(counts);
    expect(await storedCounts(native, "base")).toEqual({ pending: 0, rejected: 0, approved: 4 });
    measured.reset();
    await runOperations(fixture.context);
    expect(runWrites()).toEqual([]);
  }, 120_000);

  it("adds the three columns without a write to a run row", async () => {
    const before = await runtime.getD1Database("BEFORE");
    const reviewCounts = readTestMigrations().find(
      (migration) => migration.name === "0040_run_review_counts.sql",
    );
    if (!reviewCounts) {
      throw new Error("Expected the review counts migration.");
    }
    await applyTestMigrations(before, { through: "0039_run_comparison_settings" });
    await before.batch([
      before.prepare("INSERT INTO visonaut_policies(digest,policy_json) VALUES('policy','{}')"),
      before.prepare(
        "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','100','policy')",
      ),
      before.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<50)
        INSERT INTO visonaut_runs
        (id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,created_at,active,closed_at)
        SELECT 'run-'||i,'project','external-'||i,1,'main','sha','main','plan','{}',i,0,i FROM n`),
    ]);
    const migration = measureD1(before);
    const statements = reviewCounts.sql
      .replace(/^--.*$/gmu, "")
      .split(";")
      .filter((sql) => sql.trim());
    await migration.database.batch(statements.map((sql) => migration.database.prepare(sql)));
    // Each row is a change of the table definition. The 50 closed runs keep NULL.
    expect(migration.totals().rows_written).toBe(statements.length);
    expect(
      await before
        .prepare(
          "SELECT count(*) AS runs,count(review_pending)+count(review_rejected)+count(review_approved) AS counts FROM visonaut_runs",
        )
        .first(),
    ).toEqual({ runs: 50, counts: 0 });
  });
});

interface StoredOwner extends RetainedImageOwner {
  /** The column that the test stores as a BLOB with the bytes of its text. */
  blob?: keyof RetainedImageOwner;
  /** The answer of `imagePrefix` alone, if it is not the answer of the query. */
  collectorAlone?: boolean;
}

interface PrefixCase extends StoredOwner {
  name: string;
  /** The answer that the candidate query and the collector must both give. */
  deletable: boolean;
}

function characterRange(first: string, last: string) {
  const start = first.charCodeAt(0);
  return Array.from({ length: last.charCodeAt(0) - start + 1 }, (_, index) =>
    String.fromCharCode(start + index),
  ).join("");
}

// The test has its own lists of the characters that the two forms accept.
const runIdCharacters = `${characterRange("A", "Z")}${characterRange("a", "z")}${characterRange("0", "9")}_-`;
const digestCharacters = "0123456789abcdef";

function runOwner(id: string, objectPrefix = `runs/${id}/`): RetainedImageOwner {
  return { id, object_prefix: objectPrefix, inventory_key: null, inventory_digest: null };
}

/** The row values that the reset tool derives from the two digests of an import. */
function importedOwner(importDigest: string, inventoryDigest: string): RetainedImageOwner {
  const root = `baselines/import/${importDigest}/`;
  return {
    id: [
      importDigest.slice(0, 8),
      importDigest.slice(8, 12),
      importDigest.slice(12, 16),
      importDigest.slice(16, 20),
      importDigest.slice(20, 32),
    ].join("-"),
    object_prefix: `${root}images/`,
    inventory_key: `${root}inventory/${inventoryDigest}.json`,
    inventory_digest: inventoryDigest,
  };
}

function prefixCases({ eachCharacter }: { eachCharacter: boolean }) {
  const cases: PrefixCase[] = [];
  const add = (name: string, deletable: boolean, owner: StoredOwner) => {
    cases.push({ name, deletable, ...owner });
  };
  // Each imported case starts from a valid import with its own two digests.
  const addImported = (
    name: string,
    deletable: boolean,
    change: (
      valid: RetainedImageOwner,
      importDigest: string,
      inventoryDigest: string,
    ) => StoredOwner,
  ) => {
    const importDigest = digest(`import of ${name}`);
    const inventoryDigest = digest(`inventory of ${name}`);
    const valid = importedOwner(importDigest, inventoryDigest);
    add(name, deletable, change(valid, importDigest, inventoryDigest));
  };

  add("the run form", true, runOwner("run"));
  add("the run form with an inventory", true, {
    ...runOwner("with-inventory"),
    inventory_key: "runs/with-inventory/inventory/a.json",
  });
  add("each character that a run identifier can have", true, runOwner(runIdCharacters));
  add("a run identifier in upper case", true, runOwner("UPPER"));
  add("an underscore in the run identifier", true, runOwner("under_score"));
  add("the prefix of another run", false, runOwner("thief", "runs/victim/"));
  add("a prefix below another run", false, runOwner("nested", "runs/victim/nested/"));
  add("a prefix with no final slash", false, runOwner("no-slash", "runs/no-slash"));
  add("an empty prefix", false, runOwner("empty-prefix", ""));
  add("an empty run identifier", false, runOwner(""));
  add("a percent sign in the run identifier", false, runOwner("percent%"));
  add("a percent sign as a pattern", false, runOwner("percent-pattern", "runs/%/"));
  add("an underscore as a pattern", false, runOwner("a_c", "runs/abc/"));
  add("a prefix in another case", false, runOwner("Case", "runs/case/"));
  add("a root in upper case", false, runOwner("upper-root", "RUNS/upper-root/"));
  add("another root", false, runOwner("derived-root", "derived/derived-root/"));
  add("a longer path", false, runOwner("longer", "runs/longer/images/"));
  add("a slash in the run identifier", false, runOwner("a/b"));
  add("a parent segment as the run identifier", false, runOwner(".."));
  add("a space in the run identifier", false, runOwner("a b"));
  add("a character outside ASCII", false, runOwner("é"));
  add("a line break at the end of the run identifier", false, runOwner("line\n"));
  add("a line break at the end of the prefix", false, runOwner("break", "runs/break/\n"));
  add("a NUL character in the run identifier", false, runOwner("nul\0x"));
  add("a run identifier that is a BLOB", false, { ...runOwner("blob-id"), blob: "id" });
  add("a run prefix that is a BLOB", false, {
    ...runOwner("blob-prefix"),
    blob: "object_prefix",
  });
  // The one known difference. `imagePrefix` reads the bytes of a BLOB as text,
  // and one byte gives its decimal value: the BLOB of "5" gives "53". The
  // query refuses each BLOB identifier, so the collector does not get this row.
  add("a run identifier that is a BLOB of one byte", false, {
    ...runOwner("5", "runs/53/"),
    blob: "id",
    collectorAlone: true,
  });

  addImported("the imported form", true, (valid) => valid);
  addImported("an imported prefix with another run identifier", false, (valid) => ({
    ...valid,
    id: "other-run",
  }));
  addImported("an imported prefix with no images part", false, (valid, importDigest) => ({
    ...valid,
    object_prefix: `baselines/import/${importDigest}/`,
  }));
  addImported("an imported prefix with no final slash", false, (valid) => ({
    ...valid,
    object_prefix: valid.object_prefix.slice(0, -1),
  }));
  addImported("a longer imported path", false, (valid) => ({
    ...valid,
    object_prefix: `${valid.object_prefix}more/`,
  }));
  addImported("an import digest in upper case", false, (_valid, importDigest, inventoryDigest) =>
    importedOwner(importDigest.toUpperCase(), inventoryDigest),
  );
  addImported("a short import digest", false, (_valid, importDigest, inventoryDigest) =>
    importedOwner(importDigest.slice(1), inventoryDigest),
  );
  addImported("a long import digest", false, (_valid, importDigest, inventoryDigest) =>
    importedOwner(`${importDigest}0`, inventoryDigest),
  );
  addImported(
    "an import digest with another character",
    false,
    (_valid, importDigest, inventoryDigest) =>
      importedOwner(`${importDigest.slice(0, -1)}g`, inventoryDigest),
  );
  addImported("an import with no inventory", false, (valid) => ({
    ...valid,
    inventory_key: null,
    inventory_digest: null,
  }));
  addImported("the inventory key of another import", false, (valid, _digest, inventoryDigest) => ({
    ...valid,
    inventory_key: importedOwner(digest("another import"), inventoryDigest).inventory_key,
  }));
  addImported("an inventory key with another digest", false, (valid, importDigest) => ({
    ...valid,
    inventory_key: importedOwner(importDigest, digest("another inventory")).inventory_key,
  }));
  addImported("a longer inventory key", false, (valid) => ({
    ...valid,
    inventory_key: `${valid.inventory_key}x`,
  }));
  addImported("an inventory digest in upper case", false, (_valid, importDigest, inventoryDigest) =>
    importedOwner(importDigest, inventoryDigest.toUpperCase()),
  );
  addImported("a short inventory digest", false, (_valid, importDigest, inventoryDigest) =>
    importedOwner(importDigest, inventoryDigest.slice(1)),
  );
  addImported("an empty inventory digest", false, (_valid, importDigest) =>
    importedOwner(importDigest, ""),
  );
  for (const blob of ["id", "object_prefix", "inventory_key", "inventory_digest"] as const) {
    addImported(`an import with ${blob} as a BLOB`, false, (valid) => ({ ...valid, blob }));
  }
  if (!eachCharacter) {
    return cases;
  }

  // One row for each ASCII character, in each text that the rule limits to a
  // set of characters. The answer comes from the lists of the test, so a
  // character that only one form accepts gives a different answer.
  for (let code = 0; code < 128; code++) {
    const character = String.fromCharCode(code);
    const isDigestCharacter = digestCharacters.includes(character);
    add(
      `the ASCII code ${code} in the run identifier`,
      runIdCharacters.includes(character),
      runOwner(`code${character}`),
    );
    addImported(
      `the ASCII code ${code} in the import digest`,
      isDigestCharacter,
      (_valid, importDigest, inventoryDigest) =>
        importedOwner(`${character}${importDigest.slice(1)}`, inventoryDigest),
    );
    addImported(
      `the ASCII code ${code} in the inventory digest`,
      isDigestCharacter,
      (_valid, importDigest, inventoryDigest) =>
        importedOwner(importDigest, `${inventoryDigest.slice(0, -1)}${character}`),
    );
  }
  return cases;
}

function probeKey(owner: RetainedImageOwner) {
  return `${owner.object_prefix}images/probe.png`;
}

/**
 * Give the candidate query and the collector the same rows, and compare their
 * answers. The collector reports each candidate that it reads, so a row that
 * it does not report is a row that the query refused.
 */
async function expectSamePrefixRule(fixture: Fixture, cases: PrefixCase[]) {
  const { database, images } = fixture.context;
  // One page holds all rows, so one call reads each candidate.
  fixture.context.budget = { ...operationsBudgetDefaults, tasksPerStep: cases.length };
  const service = new Service(database);
  await service.createPolicy({
    digest: "policy",
    policy: { id: "fixture", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 },
  });
  await service.createProject({ id: "project", repositoryId: "123", policyDigest: "policy" });
  // No service call stores a prefix that the collector refuses, so the test
  // writes the rows of a closed run with a ready summary and no pin.
  const rows = cases.flatMap((owner, ordinal) => {
    const value = (column: keyof RetainedImageOwner) =>
      owner.blob === column ? "CAST(? AS BLOB)" : "?";
    return [
      database
        .prepare(`INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,
          plan_digest,plan_json,state,active,created_at,closed_at,inventory_key,inventory_digest)
          VALUES(${value("id")},'project',?,1,'pull_request','sha',?,'plan','{}','superseded',0,0,?,
          ${value("inventory_key")},${value("inventory_digest")})`)
        .bind(
          owner.id,
          `case-${ordinal}`,
          `case-${ordinal}`,
          ordinal,
          owner.inventory_key,
          owner.inventory_digest,
        ),
      database
        .prepare(`INSERT INTO work_retained_runs(id,object_prefix,closed_at)
          VALUES(${value("id")},${value("object_prefix")},?)`)
        .bind(owner.id, owner.object_prefix, ordinal),
      database
        .prepare(`INSERT INTO visonaut_closed_summaries(run_id,source_revision,state,converted_at,
          decision_count,row_count,audit_json) VALUES(${value("id")},0,'ready',0,0,0,'{}')`)
        .bind(owner.id),
    ];
  });
  // One request for each 50 cases keeps the native D1 test short.
  for (let start = 0; start < rows.length; start += 150) {
    await database.batch(rows.slice(start, start + 150));
  }
  for (const owner of cases) {
    // An object under each stored prefix shows which prefixes the collector deletes.
    await images.put(probeKey(owner), owner.id);
  }
  // The collector gets the values as the engine returns them. The close time
  // is the position in the table.
  const stored = await database
    .prepare(`SELECT retained.id,retained.object_prefix,run.inventory_key,run.inventory_digest
      FROM work_retained_runs retained JOIN visonaut_runs run ON run.id=retained.id
      ORDER BY retained.closed_at`)
    .all<RetainedImageOwner>();

  const report = await expireRunImages(fixture.context);
  // An engine returns a BLOB as bytes. `String` gives the bytes of a row and
  // the bytes of a report the same key.
  const candidates = new Set(
    [...report.completed, ...report.deferred, ...report.attention].map(String),
  );
  expect(
    (stored.results ?? []).map((owner, ordinal) => ({
      name: cases[ordinal]?.name,
      query: candidates.has(String(owner.id)),
      collector: imagePrefix(owner) !== null,
    })),
  ).toEqual(
    cases.map(({ name, deletable, collectorAlone }) => ({
      name,
      query: deletable,
      collector: collectorAlone ?? deletable,
    })),
  );
  // The query sorts by the close time, which is the position in the table.
  expect(report).toEqual({
    completed: cases.filter((owner) => owner.deletable).map((owner) => owner.id),
    deferred: [],
    attention: [],
    hasMore: false,
  });
  expect(objectKeys(fixture)).toEqual(
    cases
      .filter((owner) => !owner.deletable)
      .map(probeKey)
      .sort(),
  );
  const events = await database.prepare("SELECT id FROM operations_events").all<{ id: string }>();
  expect(events.results).toEqual([]);
}

it("closes the alert of a failed image deletion in the pass that deletes the images", async () => {
  using database = new TestDatabase();
  const fixture = productionFixture(database);
  await inventoryRun(fixture.context, { id: "baseline", kind: "main", items: { x: "baseline" } });
  await runUntilIdle(fixture);
  const closed = await inventoryRun(fixture.context, {
    id: "closed",
    kind: "pull_request",
    items: { x: "baseline", y: "closed" },
  });
  await closed.service.retireRun({ runId: "closed", now: fixture.state.time });
  fixture.state.time += afterRetention;
  const remove = vi.spyOn(fixture.images, "delete").mockRejectedValue(new Error("Unavailable."));
  expect(await runUntilIdle(fixture)).toEqual({ deleted: [], attention: ["closed"] });
  expect(await openEvents(database)).toEqual(["retention:closed:delete-failed"]);
  expect(imageKeys(fixture)).toContain("runs/closed/images/y.png");
  remove.mockRestore();
  // The failed deletion keeps its lease until the lease time ends.
  fixture.state.time += fixture.context.budget.leaseMilliseconds + 1;
  expect(await runUntilIdle(fixture)).toEqual({ deleted: ["closed"], attention: [] });
  expect(imageKeys(fixture)).toEqual(["runs/baseline/images/x.png"]);
  expect(await openEvents(database)).toEqual([]);
});

describe("the prefix rule of the image collector", () => {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('prefix rule'); } }",
      compatibilityDate: "2026-09-22",
      d1Databases: ["DB"],
    }),
  );
  afterAll(async () => runtime.dispose());

  it("gives the same answer in the candidate query and in the collector", async () => {
    using database = new TestDatabase();
    await expectSamePrefixRule(context(database), prefixCases({ eachCharacter: true }));
  });

  it("gives the same answer in the candidate query of native D1", async () => {
    using local = new TestDatabase();
    const fixture = context(local);
    fixture.context.database = await runtime.getD1Database("DB");
    await applyTestMigrations(fixture.context.database);
    // The rows of each ASCII character need more time than a test has here.
    await expectSamePrefixRule(fixture, prefixCases({ eachCharacter: false }));
  });

  it("deletes nothing for a candidate that only the query accepts", async () => {
    using database = new TestDatabase();
    const fixture = productionFixture(database);
    await database
      .prepare(
        "INSERT INTO work_retained_runs(id,object_prefix,closed_at) VALUES('thief','runs/victim/',0)",
      )
      .run();
    await fixture.context.images.put("runs/victim/images/x.png", "victim");
    const prepare = database.prepare.bind(database);
    // The collector prepares the candidate query first. A query with no prefix
    // rule takes its place, so that `imagePrefix` is the only check.
    vi.spyOn(database, "prepare").mockImplementationOnce(() =>
      prepare(`SELECT id,object_prefix,NULL AS inventory_key,NULL AS inventory_digest
        FROM work_retained_runs WHERE closed_at<=? AND ?>0 LIMIT ?`),
    );

    expect(await expireRunImages(fixture.context)).toEqual({
      completed: [],
      deferred: [],
      attention: ["thief"],
      hasMore: false,
    });
    expect(objectKeys(fixture)).toEqual(["runs/victim/images/x.png"]);
    expect(await byteStates(database)).toEqual({ thief: "live" });
    expect(await openEvents(database)).toEqual(["retention:thief:unsafe-prefix"]);
  });

  it("adds no table scan to the candidate query", async () => {
    using database = new TestDatabase();
    const prepare = vi.spyOn(database, "prepare");
    await expireRunImages(context(database).context);
    // With no candidate, the collector prepares only the candidate query.
    expect(prepare.mock.calls).toHaveLength(1);
    const plan = database.connection
      .prepare(`EXPLAIN QUERY PLAN ${prepare.mock.calls[0]?.[0]}`)
      .all(0, 0, 25)
      .map((row) => String(row.detail));
    const keyLookup =
      /^SEARCH .* USING (COVERING )?INDEX sqlite_autoindex_(work_retention_pins|visonaut_closed_summaries|visonaut_runs)_1 /u;
    // The query before the rule has the same scan: no index has the expiry order.
    expect(
      plan.filter((detail) => /^(SCAN|SEARCH) /u.test(detail) && !keyLookup.test(detail)),
    ).toEqual(["SCAN work_retained_runs"]);
  });
});
