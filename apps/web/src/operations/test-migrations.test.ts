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
