import { expect, it } from "vitest";
import { createRunExport, streamRunExport } from "./exports.ts";
import { measureExportResponse } from "./export-study.ts";
import { captured, context, TestDatabase, digest } from "./test-fixtures.ts";

it("consumes a10,580-image local export with TAR checksum validation and bounded streaming", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  fixture.context.budget.maximumExportEntries = 20_000;
  fixture.context.budget.maximumDatabaseBytes = 20 * 1024 * 1024;
  const value = new Uint8Array(1024);
  value.fill(37);
  const hash = digest(value);
  const insert = database.connection.prepare(
    "INSERT INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height,role) VALUES(?,'run',?,?,'image/png',1024,1,1,'thumbnail')",
  );
  database.connection.exec("BEGIN");
  for (let index = 1; index < 10_580; index++) {
    const key = `derived/run/${index}`;
    fixture.images.objects.set(key, { bytes: value, contentType: "image/png" });
    insert.run(`image-${index}`, hash, key);
  }
  database.connection.exec("COMMIT");
  const started = performance.now();
  const exported = await createRunExport(fixture.context, { runId: "run", actorId: "maintainer" });
  const preparationMilliseconds = performance.now() - started;
  const result = await measureExportResponse(
    await streamRunExport(fixture.context, exported.exportId),
  );
  expect(result.imageEntries).toBe(10_580);
  expect(result.entries).toBeGreaterThan(result.imageEntries + 2);
  expect(result.bytes).toBeGreaterThan(10_580 * 1024);
  expect(result.bytes % 512).toBe(0);
  console.info(
    JSON.stringify({
      study: "local-memory-storage-only",
      images: 10_580,
      fixtureImageBytes: 1024,
      preparationMilliseconds,
      ...result,
    }),
  );
}, 30_000);
