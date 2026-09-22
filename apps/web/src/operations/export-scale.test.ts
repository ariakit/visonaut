import { expect, it } from "vitest";
import { Service } from "@ariviso/service";
import { createRunExport, expireExports, streamRunExport } from "./exports.ts";
import { archiveClosedRuns } from "./history.ts";
import { profile, seedExport, sha256 } from "./export-scale-fixture.ts";
import { readTar, record, verifyExport } from "./export-scale-reader.ts";

it("exports 35,820 hydrated captures and 10,580 distinct image payloads as a complete verified TAR", async () => {
  using fixture = await seedExport({ captureCount: 35_820, imageCount: 10_580 });
  expect(Buffer.byteLength(JSON.stringify(profile))).toBe(646);
  expect(new Set([...fixture.expectedObjects.values()].map((value) => value.digest)).size).toBe(
    10_580,
  );
  expect(
    fixture.database.connection
      .prepare("SELECT COUNT(*) AS count FROM ariviso_capture_profiles")
      .get(),
  ).toEqual({ count: 1 });
  const started = performance.now();
  const exported = await createRunExport(fixture.context, {
    runId: fixture.runId,
    actorId: "maintainer",
  });
  const preparationMilliseconds = performance.now() - started;
  const result = await verifyExport({
    response: await streamRunExport(fixture.context, exported.exportId),
    ...fixture,
  });
  expect(result.captures).toBe(35_820);
  expect(result.images).toBe(10_580);
  expect(result.capturePages).toBeGreaterThan(1);
  expect(result.indexPages).toBeGreaterThan(1);
  expect(result.checksumPages).toBeGreaterThan(1);
  console.info(
    JSON.stringify({
      study: "SQLite and memory stores; no hosted latency or CLI admission claim",
      subject: process.env.ARIVISO_EXPORT_SUBJECT ?? "working",
      preparationMilliseconds,
      totalMilliseconds: performance.now() - started,
      profileBytes: Buffer.byteLength(JSON.stringify(profile)),
      ...result,
    }),
  );
}, 120_000);

for (const kind of ["metadata", "entries"]) {
  for (const failure of ["missing", "corrupt"]) {
    it(`does not complete a download with a ${failure} ${kind} page`, async () => {
      using fixture = await seedExport({ captureCount: 220, imageCount: 220 });
      const exported = await createRunExport(fixture.context, {
        runId: fixture.runId,
        actorId: "maintainer",
      });
      const stored = fixture.backups.objects.get(`exports/${exported.exportId}.json`);
      expect(stored).toBeDefined();
      if (!stored) throw new Error("Export root is missing.");
      const root = record(JSON.parse(new TextDecoder().decode(stored.bytes)));
      expect(root.version).toBe(2);
      if (!Array.isArray(root.pages)) throw new Error("Export page references are missing.");
      const reference = root.pages.map(record).find((page) => page.kind === kind);
      if (!reference || typeof reference.key !== "string")
        throw new Error("Expected an export page.");
      if (failure === "missing") {
        fixture.backups.objects.delete(reference.key);
      } else {
        const page = fixture.backups.objects.get(reference.key);
        if (!page) throw new Error("Expected stored page bytes.");
        const bytes = page.bytes.slice();
        bytes[bytes.length - 1] = 32;
        fixture.backups.objects.set(reference.key, { ...page, bytes });
      }
      let complete = false;
      const response = await streamRunExport(fixture.context, exported.exportId);
      await expect(
        readTar({
          response,
          onJson(entry) {
            if (entry.name === "complete.json") complete = true;
          },
        }),
      ).rejects.toThrow(/Export page/u);
      expect(complete).toBe(false);
    });
  }
}

it("cancels every open payload stream when a paged download disconnects", async () => {
  using fixture = await seedExport({ captureCount: 220, imageCount: 220 });
  const exported = await createRunExport(fixture.context, {
    runId: fixture.runId,
    actorId: "maintainer",
  });
  const original = fixture.images.get.bind(fixture.images);
  let opened = 0;
  let cancelled = 0;
  fixture.images.get = async (key) => {
    const object = await original(key);
    if (!object) return null;
    await object.body.cancel();
    opened++;
    return {
      ...object,
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(object.size));
        },
        cancel() {
          cancelled++;
        },
      }),
    };
  };
  const response = await streamRunExport(fixture.context, exported.exportId);
  if (!response.body) throw new Error("Expected a download stream.");
  const reader = response.body.getReader();
  for (let chunks = 0; chunks < 10_000 && !opened; chunks++) {
    const result = await reader.read();
    expect(result.done).toBe(false);
  }
  expect(opened).toBeGreaterThan(0);
  await reader.cancel();
  reader.releaseLock();
  expect(cancelled).toBe(opened);
});

it("removes expired paged export objects and releases retention ownership", async () => {
  using fixture = await seedExport({ captureCount: 220, imageCount: 220 });
  const exported = await createRunExport(fixture.context, {
    runId: fixture.runId,
    actorId: "maintainer",
  });
  const owner = `export:${exported.exportId}`;
  const prefix = `exports/${exported.exportId}`;
  expect(
    [...fixture.backups.objects.keys()].filter((key) => key.startsWith(prefix)).length,
  ).toBeGreaterThan(3);
  expect(
    fixture.database.connection
      .prepare("SELECT COUNT(*) AS count FROM work_retention_pins WHERE owner=?")
      .get(owner),
  ).toEqual({ count: 1 });
  fixture.context.budget.objectsPerStep = 2;
  fixture.state.time += 2 * 24 * 60 * 60 * 1000;
  let expired = false;
  for (let step = 0; step < 100; step++) {
    await expireExports(fixture.context);
    const row = fixture.database.connection
      .prepare("SELECT state FROM operations_exports WHERE id=?")
      .get(exported.exportId);
    if (row?.state === "expired") {
      expired = true;
      break;
    }
  }
  expect(expired).toBe(true);
  expect([...fixture.backups.objects.keys()].filter((key) => key.startsWith(prefix))).toEqual([]);
  expect(
    fixture.database.connection
      .prepare("SELECT COUNT(*) AS count FROM work_retention_pins WHERE owner=?")
      .get(owner),
  ).toEqual({ count: 0 });
  await expect(streamRunExport(fixture.context, exported.exportId)).rejects.toThrow(/expired/u);
});

it("exports the archived 35,820-capture fixture with all retained payloads and exact profile contents", async () => {
  using fixture = await seedExport({ captureCount: 35_820, imageCount: 10_580 });
  const service = new Service(fixture.database);
  await service.retireRun({ runId: fixture.runId, now: fixture.context.now() });
  fixture.context.budget.objectsPerStep = 20;
  let archived = false;
  for (let step = 0; step < 1000; step++) {
    const result = await archiveClosedRuns(fixture.context);
    expect(result.attention).toEqual([]);
    if (result.completed.includes(fixture.runId)) {
      archived = true;
      break;
    }
  }
  expect(archived).toBe(true);
  expect(
    fixture.database.connection
      .prepare("SELECT COUNT(*) AS count FROM ariviso_captures WHERE run_id=?")
      .get(fixture.runId),
  ).toEqual({ count: 0 });
  const expectedObjects = new Map(fixture.expectedObjects);
  for (const [key, object] of fixture.images.objects) {
    if (!key.startsWith("history/")) continue;
    expectedObjects.set(key, { bytes: object.bytes.length, digest: sha256(object.bytes) });
  }
  const captures = new Set<string>();
  const profiles = new Set<string>();
  const started = performance.now();
  const exported = await createRunExport(fixture.context, {
    runId: fixture.runId,
    actorId: "maintainer",
  });
  const result = await verifyExport({
    response: await streamRunExport(fixture.context, exported.exportId),
    runId: fixture.runId,
    expectedObjects,
    onJson(entry, value) {
      if (!entry.name.startsWith("history/")) return;
      const page = record(value);
      if (!Array.isArray(page.rows)) return;
      for (const value of page.rows) {
        const row = record(value);
        if (page.section === "captures") {
          const id = String(row.id);
          expect(captures.has(id)).toBe(false);
          expect(fixture.expectedCaptures.has(id)).toBe(true);
          expect(row.item_key).toBe(fixture.expectedCaptures.get(id));
          expect(row.profile_digest).toBe(fixture.profileDigest);
          expect(JSON.parse(String(row.metadata_json))).toEqual(fixture.expectedMetadata);
          captures.add(id);
        }
        if (page.section === "profiles") {
          expect(row.digest).toBe(fixture.profileDigest);
          expect(JSON.parse(String(row.profile_json))).toEqual(profile);
          profiles.add(String(row.digest));
        }
      }
    },
  });
  expect(captures.size).toBe(35_820);
  expect(profiles.size).toBe(1);
  console.info(
    JSON.stringify({
      study: "archived SQLite and memory-store export; no hosted capacity claim",
      totalMilliseconds: performance.now() - started,
      archivedCaptures: captures.size,
      sharedProfiles: profiles.size,
      ...result,
    }),
  );
}, 120_000);
