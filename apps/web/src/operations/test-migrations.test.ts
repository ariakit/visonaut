import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, expect, it } from "vitest";
import { applyTestMigrations, readTestMigrations } from "../../../../tooling/test-migrations.ts";
import { TestDatabase } from "./test-fixtures.ts";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('migration parity'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB"],
  }),
);
afterAll(async () => runtime.dispose());

const schemaQuery = `SELECT type,name,tbl_name,sql FROM sqlite_schema
  WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
  ORDER BY type,name`;

it("uses every committed numbered migration in SQLite and native D1 fixtures", async () => {
  using expected = new DatabaseSync(":memory:");
  const directory = new URL("../../migrations/", import.meta.url);
  const names = readdirSync(directory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const name of names) {
    expected.exec(readFileSync(new URL(name, directory), "utf8"));
  }
  using fixture = new TestDatabase();
  const database = await runtime.getD1Database("DB");
  await applyTestMigrations(database);

  const expectedSchema = expected.prepare(schemaQuery).all();
  expect(fixture.connection.prepare(schemaQuery).all()).toEqual(expectedSchema);
  expect((await database.prepare(schemaQuery).all()).results).toEqual(expectedSchema);
  expect(fixture.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  expect((await database.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  expect(readTestMigrations().map((migration) => migration.name)).toEqual(names);
});

it("drops the unread staged manifest columns and keeps their rows", () => {
  using database = new DatabaseSync(":memory:");
  for (const migration of readTestMigrations({ through: "0041_drop_task_publication" })) {
    database.exec(migration.sql);
  }
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec(`INSERT INTO ingest_staged_manifests
    (run_id, job_id, manifest_digest, manifest_object_key, declared_bytes, capture_count,
      created_at, evidence_page_count, evidence_page_bytes, capture_manifest_digest)
    VALUES ('run', 'job', 'digest', 'key', 1, 1, 1, 2, 3, 'capture')`);
  const columns = () =>
    database
      .prepare("SELECT name FROM pragma_table_info('ingest_staged_manifests')")
      .all()
      .map((column) => column.name);
  expect(columns()).toEqual(
    expect.arrayContaining([
      "evidence_page_count",
      "evidence_page_bytes",
      "capture_manifest_digest",
    ]),
  );

  const migration = readTestMigrations().find(
    ({ name }) => name === "0043_drop_staged_manifest_columns.sql",
  );
  database.exec(migration?.sql ?? "");

  expect(columns()).not.toContain("evidence_page_count");
  expect(columns()).not.toContain("evidence_page_bytes");
  expect(columns()).not.toContain("capture_manifest_digest");
  expect(
    database
      .prepare("SELECT run_id, manifest_digest, declared_bytes FROM ingest_staged_manifests")
      .all(),
  ).toEqual([{ run_id: "run", manifest_digest: "digest", declared_bytes: 1 }]);
});

it("drops the staged evidence pages and keeps the evidence version and the image guards", () => {
  using database = new DatabaseSync(":memory:");
  for (const migration of readTestMigrations({ through: "0043_drop_staged_manifest_columns" })) {
    database.exec(migration.sql);
  }
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec(`INSERT INTO ingest_staged_manifests
    (run_id, job_id, manifest_digest, manifest_object_key, declared_bytes, capture_count,
      created_at, evidence_version, declaration_complete)
    VALUES ('run', 'job', 'digest', 'key', 1, 1, 1, 1, 1)`);
  const schemaNames = (type: string, prefix: string) =>
    database
      .prepare("SELECT name FROM sqlite_schema WHERE type = ? AND name LIKE ? ORDER BY name")
      .all(type, `${prefix}%`)
      .map((row) => row.name);
  const columns = () =>
    database
      .prepare("SELECT name FROM pragma_table_info('ingest_staged_manifests')")
      .all()
      .map((column) => column.name);
  expect(schemaNames("table", "ingest_staged_evidence")).toEqual(["ingest_staged_evidence_pages"]);
  expect(schemaNames("trigger", "ingest_staged_evidence")).toEqual([
    "ingest_staged_evidence_admitted_delete",
    "ingest_staged_evidence_update",
  ]);
  expect(columns()).toContain("evidence_version");

  const migration = readTestMigrations().find(
    ({ name }) => name === "0044_drop_staged_evidence_pages.sql",
  );
  database.exec(migration?.sql ?? "");

  expect(schemaNames("table", "ingest_staged_evidence")).toEqual([]);
  expect(schemaNames("trigger", "ingest_staged_evidence")).toEqual([]);
  // The Worker of the previous release still writes the column until the deploy ends.
  expect(columns()).toContain("evidence_version");
  // The Worker of this release does not write it, so the default applies.
  database.exec(`INSERT INTO ingest_staged_manifests
    (run_id, job_id, manifest_digest, manifest_object_key, declared_bytes, capture_count, created_at)
    VALUES ('run2', 'job', 'digest2', 'key2', 1, 1, 1)`);
  expect(
    database
      .prepare("SELECT run_id, evidence_version FROM ingest_staged_manifests ORDER BY run_id")
      .all(),
  ).toEqual([
    { run_id: "run", evidence_version: 1 },
    { run_id: "run2", evidence_version: 1 },
  ]);
  expect(schemaNames("trigger", "ingest_staged_images")).toEqual([
    "ingest_staged_images_admitted_delete",
    "ingest_staged_images_admitted_insert",
    "ingest_staged_images_admitted_update",
  ]);
  // The image guard of an admitted job still refuses a new image row.
  expect(() =>
    database.exec(`INSERT INTO ingest_staged_images
      (run_id, job_id, digest, media_type, bytes, width, height, image_id, object_key, quarantine_key)
      VALUES ('run', 'job', 'd', 'image/png', 1, 1, 1, 'i', 'o', 'q')`),
  ).toThrow("The admitted image set is immutable.");
});

it("drops the evidence version of the staged manifests and keeps their rows", () => {
  using database = new DatabaseSync(":memory:");
  for (const migration of readTestMigrations({ through: "0044_drop_staged_evidence_pages" })) {
    database.exec(migration.sql);
  }
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec(`INSERT INTO ingest_staged_manifests
    (run_id, job_id, manifest_digest, manifest_object_key, declared_bytes, capture_count,
      created_at, evidence_version, declaration_complete)
    VALUES ('run', 'job', 'digest', 'key', 1, 1, 1, 1, 1)`);
  const columns = () =>
    database
      .prepare("SELECT name FROM pragma_table_info('ingest_staged_manifests')")
      .all()
      .map((column) => column.name);
  expect(columns()).toContain("evidence_version");

  const migration = readTestMigrations().find(
    ({ name }) => name === "0045_drop_staged_evidence_version.sql",
  );
  database.exec(migration?.sql ?? "");

  expect(columns()).not.toContain("evidence_version");
  expect(
    database
      .prepare("SELECT run_id, manifest_digest, declared_bytes FROM ingest_staged_manifests")
      .all(),
  ).toEqual([{ run_id: "run", manifest_digest: "digest", declared_bytes: 1 }]);
  // The image guard of an admitted job still refuses a new image row.
  expect(() =>
    database.exec(`INSERT INTO ingest_staged_images
      (run_id, job_id, digest, media_type, bytes, width, height, image_id, object_key, quarantine_key)
      VALUES ('run', 'job', 'd', 'image/png', 1, 1, 1, 'i', 'o', 'q')`),
  ).toThrow("The admitted image set is immutable.");
});

it("drops the archive tables, the summary copy tables, and their view", () => {
  using database = new DatabaseSync(":memory:");
  for (const migration of readTestMigrations({ through: "0045_drop_staged_evidence_version" })) {
    database.exec(migration.sql);
  }
  const tables = [
    "operations_run_archives",
    "operations_comparison_archives",
    "visonaut_summary_conversion_pages",
    "visonaut_closed_summary_rows",
    "visonaut_closed_summary_decisions",
  ];
  const objects = () =>
    database
      .prepare(
        `SELECT name FROM sqlite_schema WHERE ${tables.map(() => "sql LIKE ?").join(" OR ")} ORDER BY name`,
      )
      .all(...tables.map((table) => `%${table}%`))
      .map((object) => object.name);
  expect(objects()).toEqual([
    "operations_comparison_archives",
    "operations_ready_history_archives",
    "operations_run_archives",
    "operations_run_archives_work",
    "visonaut_closed_summary_decision_order",
    "visonaut_closed_summary_decisions",
    "visonaut_closed_summary_order",
    "visonaut_closed_summary_rows",
    "visonaut_summary_conversion_pages",
  ]);
  // A copy row that an old summary left does not stop the drop.
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec(`INSERT INTO visonaut_closed_summary_rows
    (id, run_id, comparison_id, ordinal, item_key, variant_key, tuple_json, outcome,
      decision_revision, metadata_json)
    VALUES ('row', 'run', 'comparison', 0, 'item', 'variant', '{}', 'unchanged', 0, '{}')`);
  database.exec("PRAGMA foreign_keys = ON");

  const migration = readTestMigrations().find(
    ({ name }) => name === "0046_drop_archive_tables.sql",
  );
  database.exec(migration?.sql ?? "");

  expect(objects()).toEqual([]);
});

it("keeps an explicit old schema before a migration regression", () => {
  using database = new DatabaseSync(":memory:");
  for (const migration of readTestMigrations({ through: "0013_promotion_scans" })) {
    database.exec(migration.sql);
  }
  expect(
    database.prepare("SELECT name FROM sqlite_schema WHERE name='ariviso_projects'").get(),
  ).toMatchObject({ name: "ariviso_projects" });
  expect(
    database.prepare("SELECT name FROM sqlite_schema WHERE name='visonaut_projects'").get(),
  ).toBeUndefined();
  expect(() => readTestMigrations({ through: "0017_missing" })).toThrow("Unknown test migration");
});

it("closes the started check-run creations and gives the closed check rows their result", () => {
  using database = new DatabaseSync(":memory:");
  for (const migration of readTestMigrations({ through: "0048_pre_run_status_surface" })) {
    database.exec(migration.sql);
  }
  const insert = database.prepare(`INSERT INTO pre_run_checks
    (tested_sha, generation, repository_id, source_sha, base_sha, kind, ref, docs_only,
      external_id, check_id, state, request_started, lease_until, created_at, updated_at)
    VALUES (?, 0, 'repository', 'source', 'base', 'main', 'refs/heads/main', 0, ?, ?, ?, ?, ?, 1, 1)`);
  const rows = [
    // A creation request started, so a check run can exist with no known ID.
    ["ambiguous", null, "ambiguous", 1, null],
    ["started", null, "creating", 1, 5],
    // A claim with no request starts again as a commit status.
    ["claimed", null, "creating", 0, 5],
    // Closed rows whose direct PATCH kept the result only on GitHub.
    ["docs", "1", "docs_complete", 1, null],
    ["failed", "2", "failed", 1, null],
    // A failed row with a delivered update keeps reading that update.
    ["delivered", "3", "failed", 1, null],
    ["active", "4", "active", 1, null],
    // A pending row never started a check run.
    ["pending", null, "pending", 0, null],
  ] as const;
  for (const [name, checkId, state, requestStarted, leaseUntil] of rows) {
    insert.run(name, `external-${name}`, checkId, state, requestStarted, leaseUntil);
  }
  database.exec(
    "INSERT INTO work_checks(id, desired_revision, delivered_revision) VALUES ('3', 1, 1)",
  );

  const migration = readTestMigrations().find(
    ({ name }) => name === "0049_pre_run_status_only.sql",
  );
  database.exec(migration?.sql ?? "");

  expect(
    database
      .prepare(
        "SELECT tested_sha, state, lease_until, status_state, surface FROM pre_run_checks ORDER BY rowid",
      )
      .all(),
  ).toEqual([
    {
      tested_sha: "ambiguous",
      state: "failed",
      lease_until: null,
      status_state: "failure",
      surface: "check",
    },
    {
      tested_sha: "started",
      state: "failed",
      lease_until: null,
      status_state: "failure",
      surface: "check",
    },
    {
      tested_sha: "claimed",
      state: "pending",
      lease_until: null,
      status_state: null,
      surface: "status",
    },
    {
      tested_sha: "docs",
      state: "docs_complete",
      lease_until: null,
      status_state: "success",
      surface: "check",
    },
    {
      tested_sha: "failed",
      state: "failed",
      lease_until: null,
      status_state: "failure",
      surface: "check",
    },
    {
      tested_sha: "delivered",
      state: "failed",
      lease_until: null,
      status_state: null,
      surface: "check",
    },
    {
      tested_sha: "active",
      state: "active",
      lease_until: null,
      status_state: null,
      surface: "check",
    },
    {
      tested_sha: "pending",
      state: "pending",
      lease_until: null,
      status_state: null,
      surface: "status",
    },
  ]);
  // The guard of the surface still refuses a change.
  expect(() =>
    database.exec("UPDATE pre_run_checks SET surface='check' WHERE tested_sha='pending'"),
  ).toThrow("Check surface conflicts with stored identity");
});

it("drops the surface of the pre-run checks and keeps their rows", () => {
  using database = new DatabaseSync(":memory:");
  for (const migration of readTestMigrations({ through: "0049_pre_run_status_only" })) {
    database.exec(migration.sql);
  }
  database.exec(`INSERT INTO pre_run_checks
    (tested_sha, generation, repository_id, source_sha, base_sha, kind, ref, docs_only,
      external_id, check_id, state, status_state, created_at, updated_at)
    VALUES ('tested', 0, 'repository', 'source', 'base', 'main', 'refs/heads/main', 0,
      'external', '1', 'failed', 'failure', 1, 1)`);
  const columns = () =>
    database
      .prepare("SELECT name FROM pragma_table_info('pre_run_checks')")
      .all()
      .map((column) => column.name);
  const schemaNames = (type: string) =>
    database
      .prepare("SELECT name FROM sqlite_schema WHERE type=? AND tbl_name='pre_run_checks'")
      .all(type)
      .map((row) => row.name);
  expect(columns()).toContain("surface");
  expect(schemaNames("trigger")).toContain("pre_run_check_surface_identity");

  const migration = readTestMigrations().find(
    ({ name }) => name === "0050_drop_pre_run_check_surface.sql",
  );
  database.exec(migration?.sql ?? "");

  expect(columns()).not.toContain("surface");
  expect(schemaNames("trigger")).not.toContain("pre_run_check_surface_identity");
  // The index that finds the row that owns the commit status stays.
  expect(schemaNames("index")).toContain("pre_run_checks_status_commit");
  expect(
    database.prepare("SELECT external_id, check_id, state, status_state FROM pre_run_checks").all(),
  ).toEqual([{ external_id: "external", check_id: "1", state: "failed", status_state: "failure" }]);
});

it("ends the pending status updates that a newer revision replaced", () => {
  using database = new DatabaseSync(":memory:");
  for (const migration of readTestMigrations({ through: "0050_drop_pre_run_check_surface" })) {
    database.exec(migration.sql);
  }
  database.exec(`INSERT INTO work_checks (id, desired_revision, delivered_revision)
    VALUES ('replaced', 3, 2), ('current', 4, NULL)`);
  const insert = database.prepare(`INSERT INTO work_status_outbox
    (check_id, revision, run_id, attempt, comparison_revision, source_revision, conclusion,
      details_url, max_attempts, available_at, state)
    VALUES (?, ?, 'run', 1, 1, 1, 'success', 'https://visonaut.example/runs/run', 5, 1, ?)`);
  const rows = [
    // An older pending update that no claim reads.
    ["replaced", 1, "pending"],
    ["replaced", 2, "complete"],
    ["replaced", 3, "dead"],
    // The newest revision stays due.
    ["current", 4, "pending"],
  ] as const;
  for (const [checkId, revision, state] of rows) {
    insert.run(checkId, revision, state);
  }

  const migration = readTestMigrations().find(
    ({ name }) => name === "0051_obsolete_superseded_status_updates.sql",
  );
  database.exec(migration?.sql ?? "");

  const states = () =>
    database
      .prepare(
        "SELECT check_id, revision, state FROM work_status_outbox ORDER BY check_id, revision",
      )
      .all();
  expect(states()).toEqual([
    { check_id: "current", revision: 4, state: "pending" },
    { check_id: "replaced", revision: 1, state: "obsolete" },
    { check_id: "replaced", revision: 2, state: "complete" },
    { check_id: "replaced", revision: 3, state: "dead" },
  ]);
  // A later raise of the newest revision ends the replaced pending update.
  database.exec("UPDATE work_checks SET desired_revision = 5 WHERE id = 'current'");
  expect(states()[0]).toEqual({ check_id: "current", revision: 4, state: "obsolete" });
});
