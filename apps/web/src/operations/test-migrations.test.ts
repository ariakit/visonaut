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

it("drops the staged evidence pages and the evidence version and keeps the image guards", () => {
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
  expect(columns()).not.toContain("evidence_version");
  expect(
    database
      .prepare("SELECT run_id, manifest_digest, declared_bytes FROM ingest_staged_manifests")
      .all(),
  ).toEqual([{ run_id: "run", manifest_digest: "digest", declared_bytes: 1 }]);
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
