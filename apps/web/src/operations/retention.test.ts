import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, describe, expect, it, vi } from "vitest";
import { canonicalJson, digestJson } from "@visonaut/protocol";
import {
  closedRunRetentionMs,
  releaseRetentionPinStatement,
  retentionPinStatement,
  Service,
} from "@visonaut/service";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
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
    expect(fixture.images.objects.has(pinned.inventory.objectKey)).toBe(true);
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
        expect.arrayContaining([open.inventory.objectKey, closed.inventory.objectKey]),
      );
      expect(await openEvents(database)).toEqual([`${step}:scheduler:step-failed`]);
    },
  );
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
