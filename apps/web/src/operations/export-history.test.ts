import { expect, it, vi } from "vitest";
import { validateKey } from "@visonaut/protocol";
import { createRunExport, streamRunExport } from "./exports.ts";
import { seedExport, sha256 } from "./export-scale-fixture.ts";
import { record, verifyExport } from "./export-scale-reader.ts";

it("exports the complete project identity history with fewer bounded page reads and writes", async () => {
  using fixture = await seedExport({ captureCount: 1, imageCount: 1 });
  fixture.database.connection.exec("DELETE FROM visonaut_identity_history");
  const insert = fixture.database.connection.prepare(
    "INSERT INTO visonaut_identity_history(project_id,lineage_key,item_key,variant_key) VALUES('project',?,?,?)",
  );
  fixture.database.connection.exec("BEGIN");
  for (let index = 0; index < 82_556; index++) {
    insert.run(
      `pr:${index % 41}`,
      `ariakit-ui-button/page/rows-${String(index).padStart(6, "0")}`,
      "react-chrome-desktop-dark-dark-no-preference-none",
    );
  }
  fixture.database.connection.exec("COMMIT");
  const expected = fixture.database.connection
    .prepare(
      "SELECT * FROM visonaut_identity_history WHERE project_id='project' ORDER BY lineage_key,item_key,variant_key",
    )
    .all();
  using prepared = vi.spyOn(fixture.database, "prepare");
  using stored = vi.spyOn(fixture.images, "put");
  const started = performance.now();
  const exported = await createRunExport(fixture.context, {
    runId: fixture.runId,
    actorId: "maintainer",
  });
  const preparationMilliseconds = performance.now() - started;
  const preparationReads = prepared.mock.calls.length;
  const preparationWrites = stored.mock.calls.length;
  const historyReads = prepared.mock.calls.filter(([sql]) =>
    sql.includes("SELECT history.* FROM visonaut_identity_history"),
  ).length;
  const actual: unknown[] = [];
  const pages: { rows: number; bytes: number }[] = [];
  await verifyExport({
    ...fixture,
    response: await streamRunExport(fixture.context, exported.exportId),
    onJson(entry, value) {
      const page = record(value);
      if (page.section !== "identityHistory" || !Array.isArray(page.rows)) return;
      actual.push(...page.rows);
      pages.push({ rows: page.rows.length, bytes: entry.bytes });
    },
  });
  expect(actual).toEqual(expected);
  expect(pages.every((page) => page.bytes <= 1024 * 1024)).toBe(true);
  console.info(
    JSON.stringify({
      study: "Project identity export; SQLite and memory stores only",
      historyRows: actual.length,
      historyDigest: sha256(JSON.stringify(actual)),
      historyReads,
      historyPages: pages.length,
      maximumPageRows: Math.max(...pages.map((page) => page.rows)),
      maximumPageBytes: Math.max(...pages.map((page) => page.bytes)),
      preparationReads,
      preparationWrites,
      preparationMilliseconds,
    }),
  );
  expect(pages).toHaveLength(83);
  expect(historyReads).toBe(84);
}, 30_000);

it("keeps identity pages within the encoded byte bound and preserves one oversized row", async () => {
  using fixture = await seedExport({ captureCount: 1, imageCount: 1 });
  fixture.database.connection.exec("DELETE FROM visonaut_identity_history");
  fixture.context.budget.maximumObjectBytes = 16 * 1024 * 1024;
  const insert = fixture.database.connection.prepare(
    "INSERT INTO visonaut_identity_history(project_id,lineage_key,item_key,variant_key) VALUES('project','main',?,'chromium')",
  );
  const expected: string[] = [];
  for (let index = 0; index < 240; index++) {
    // UTF-8 byte length must bound a page even when fewer than 1,000 rows fit.
    const item = `${String(index).padStart(3, "0")}-${"界".repeat(3000)}`;
    insert.run(item);
    expected.push(item);
  }
  const oversized = `large-${"界".repeat(360_000)}`;
  insert.run(oversized);
  expected.push(oversized);
  const exported = await createRunExport(fixture.context, {
    runId: fixture.runId,
    actorId: "maintainer",
  });
  const actual: string[] = [];
  const pageRows: number[] = [];
  let oversizedPages = 0;
  await verifyExport({
    ...fixture,
    response: await streamRunExport(fixture.context, exported.exportId),
    onJson(entry, value) {
      const page = record(value);
      if (page.section !== "identityHistory" || !Array.isArray(page.rows)) return;
      if (entry.bytes > 1024 * 1024) {
        expect(page.rows).toHaveLength(1);
        oversizedPages++;
      }
      pageRows.push(page.rows.length);
      actual.push(...page.rows.map((row) => String(record(row).item_key)));
    },
  });
  expect(actual).toEqual(expected);
  expect(oversizedPages).toBe(1);
  expect(Math.max(...pageRows)).toBeGreaterThan(100);
  expect(Math.max(...pageRows)).toBeLessThan(1000);
});

it("includes the wrapper and commas when packing metadata at the object limit", async () => {
  using fixture = await seedExport({ captureCount: 1, imageCount: 1 });
  fixture.database.connection.exec("DELETE FROM visonaut_identity_history");
  fixture.context.budget.maximumObjectBytes = 256 * 1024;
  const insert = fixture.database.connection.prepare(
    "INSERT INTO visonaut_identity_history(project_id,lineage_key,item_key,variant_key) VALUES('project','main',?,?)",
  );
  const expected = [];
  for (let index = 0; index < 512; index++) {
    const row = {
      project_id: "project",
      lineage_key: "main",
      item_key: `${String(index).padStart(3, "0")}${"x".repeat(253)}`,
      variant_key: "v".repeat(180),
    };
    validateKey(row.item_key);
    validateKey(row.variant_key);
    expect(Buffer.byteLength(JSON.stringify(row))).toBe(512);
    insert.run(row.item_key, row.variant_key);
    expected.push(row);
  }
  const exported = await createRunExport(fixture.context, {
    runId: fixture.runId,
    actorId: "maintainer",
  });
  const actual: unknown[] = [];
  const pages: number[] = [];
  await verifyExport({
    ...fixture,
    response: await streamRunExport(fixture.context, exported.exportId),
    onJson(entry, value) {
      const page = record(value);
      if (page.section !== "identityHistory" || !Array.isArray(page.rows)) return;
      expect(entry.bytes).toBeLessThanOrEqual(fixture.context.budget.maximumObjectBytes);
      actual.push(...page.rows);
      pages.push(page.rows.length);
    },
  });
  expect(actual).toEqual(expected);
  expect(pages).toHaveLength(2);
  expect(Math.max(...pages)).toBeGreaterThan(100);
});
