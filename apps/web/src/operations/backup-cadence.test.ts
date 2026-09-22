import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { backupDaily, expireBackups, restoreBackup } from "./backups.ts";
import { backupDaily as backupDailyV2 } from "./backups-v2.ts";
import { BACKUP_RETENTION } from "./backup-objects.ts";
import { runOperations } from "./index.ts";
import { captured, context, digest, MemoryStore, TestDatabase } from "./test-fixtures.ts";

beforeAll(() => {
  vi.stubGlobal(
    "FixedLengthStream",
    class extends TransformStream<Uint8Array, Uint8Array> {
      constructor(expected: number) {
        let bytes = 0;
        super({
          transform(chunk, controller) {
            bytes += chunk.byteLength;
            if (bytes > expected) {
              throw new Error("Length exceeded.");
            }
            controller.enqueue(chunk);
          },
          flush() {
            if (bytes !== expected) {
              throw new Error("Length differs.");
            }
          },
        });
      }
    },
  );
});
afterAll(() => vi.unstubAllGlobals());
const hour = 60 * 60 * 1000;
const minute = 60 * 1000;
const start = Date.UTC(2026, 8, 22);

function exporter(value: string) {
  const bytes = new TextEncoder().encode(value);
  return {
    export: vi.fn(async () => ({ body: new Blob([bytes]).stream(), bytes: bytes.length })),
  };
}
async function complete(fixture: ReturnType<typeof context>, source = exporter("snapshot")) {
  for (let step = 0; step < 150; step++) {
    const report = await backupDaily(fixture.context, source);
    expect(report.attention).toEqual([]);
    const id = report.completed[0];
    if (id) {
      return id;
    }
  }
  throw new Error("Backup did not complete.");
}
async function restore(fixture: ReturnType<typeof context>, id: string) {
  const images = new MemoryStore();
  const quarantine = new MemoryStore();
  const calls: string[] = [];
  const result = await restoreBackup(
    fixture.backups,
    id,
    {
      images,
      quarantine,
      async assertEmpty() {
        calls.push("empty");
      },
      async importDatabase(body) {
        calls.push(await new Response(body).text());
      },
      async reapplyCurrentRules() {
        calls.push("rules");
      },
      async verifyDatabaseAndReferences() {
        calls.push("verified");
      },
    },
    fixture.context.budget,
  );
  return { result, calls, images };
}
function recoveryPoint(database: TestDatabase) {
  return database.connection
    .prepare("SELECT MAX(created_at) AS time FROM operations_backups WHERE state='complete'")
    .get()?.time;
}

it("publishes two immutable same-day snapshots with room for copy and scheduler time", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  const morning = exporter("morning SQL");
  await backupDaily(fixture.context, morning);
  fixture.state.time += 45 * minute;
  const morningId = await complete(fixture, morning);
  const morningRoot = fixture.backups.objects.get(`backups/${morningId}/complete.json`)?.bytes;
  expect(morningRoot).toBeDefined();
  const afternoon = exporter("afternoon SQL");
  fixture.state.time = start + 12 * hour + minute;
  await backupDaily(fixture.context, afternoon);
  fixture.state.time += 45 * minute;
  expect(fixture.state.time - Number(recoveryPoint(database))).toBe(12 * hour + 46 * minute);
  expect(fixture.state.time - Number(recoveryPoint(database))).toBeLessThan(24 * hour);
  expect(await complete(fixture, afternoon)).toBe("2026-09-22T12Z");
  expect(morningId).toBe("2026-09-22T00Z");
  expect((await restore(fixture, "2026-09-22T00Z")).calls).toEqual([
    "empty",
    "morning SQL",
    "rules",
    "verified",
  ]);
  expect((await restore(fixture, "2026-09-22T12Z")).calls).toEqual([
    "empty",
    "afternoon SQL",
    "rules",
    "verified",
  ]);
  expect(fixture.backups.objects.get("backups/2026-09-22T00Z/complete.json")?.bytes).toEqual(
    morningRoot,
  );
  for (let step = 0; step < 3; step++) {
    expect((await backupDaily(fixture.context, afternoon)).completed).toEqual([]);
  }
  expect(morning.export).toHaveBeenCalledTimes(1);
  expect(afternoon.export).toHaveBeenCalledTimes(1);
  // Daily starts leave no time for the next complete set's copy or scheduling.
  expect(24 * hour + minute + 45 * minute).toBeGreaterThan(24 * hour);
});

it("resumes the exact unfinished slot across noon and starts a new slot at midnight", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  fixture.state.time = start + 12 * hour - 1;
  await backupDaily(fixture.context, exporter("before noon"));
  fixture.state.time = start + 12 * hour;
  expect(await complete(fixture)).toBe("2026-09-22T00Z");
  expect(await complete(fixture)).toBe("2026-09-22T12Z");
  fixture.state.time = start + 24 * hour - 1;
  expect((await backupDaily(fixture.context, exporter("unused"))).completed).toEqual([]);
  fixture.state.time++;
  expect(await complete(fixture)).toBe("2026-09-23T00Z");
  expect(
    database.connection.prepare("SELECT id FROM operations_backups ORDER BY id").all(),
  ).toEqual([{ id: "2026-09-22T00Z" }, { id: "2026-09-22T12Z" }, { id: "2026-09-23T00Z" }]);
});

it("keeps concurrent schedulers on one unfinished set and one export lease", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  fixture.state.time = start + 12 * hour - 1;
  let release = () => {};
  let signal = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const source = exporter("leased snapshot");
  source.export.mockImplementationOnce(async () => {
    signal();
    await gate;
    const bytes = new TextEncoder().encode("leased snapshot");
    return { body: new Blob([bytes]).stream(), bytes: bytes.length };
  });
  const first = backupDaily(fixture.context, source);
  const race = backupDaily(fixture.context, source);
  await entered;
  await expect(race).rejects.toThrow("State changed");
  // A later slot must not create a second set while the first export owns its lease.
  fixture.state.time++;
  expect((await backupDaily(fixture.context, source)).deferred).toEqual(["2026-09-22T00Z"]);
  expect(
    database.connection.prepare("SELECT COUNT(*) AS count FROM operations_backups").get(),
  ).toEqual({ count: 1 });
  release();
  await first;
  expect(await complete(fixture, source)).toBe("2026-09-22T00Z");
  expect(source.export).toHaveBeenCalledTimes(1);
});

it("finishes legacy v2 and v3 date-only sets before starting a new slot", async () => {
  for (const version of [2, 3]) {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    if (version === 2) {
      await backupDailyV2(fixture.context, exporter("legacy snapshot"));
    } else {
      database.connection
        .prepare(
          "INSERT INTO operations_backups(id,state,format_version,created_at) VALUES('2026-09-22','exporting',3,?)",
        )
        .run(start);
    }
    fixture.state.time += 13 * hour;
    expect(await complete(fixture, exporter("legacy snapshot"))).toBe("2026-09-22");
    const restored = await restore(fixture, "2026-09-22");
    expect(restored.calls).toEqual(["empty", "legacy snapshot", "rules", "verified"]);
    expect(restored.images.objects.has("runs/run/original")).toBe(true);
    expect(await complete(fixture)).toBe("2026-09-22T12Z");
  }
});

it("restores a legacy v1 date-only set through the current entry point", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const id = "2026-09-21";
  const prefix = `backups/${id}/`;
  const sql = "legacy v1 SQL";
  const original = "legacy original";
  const key = "runs/legacy/original";
  const backupKey = `${prefix}objects/images/${key}`;
  const page = JSON.stringify([
    {
      source: "images",
      key,
      backupKey,
      digest: digest(original),
      bytes: original.length,
      contentType: "image/png",
    },
  ]);
  await fixture.backups.put(`${prefix}database.sql`, sql);
  await fixture.backups.put(backupKey, original);
  await fixture.backups.put(`${prefix}pages/000000.json`, page);
  await fixture.backups.put(
    `${prefix}complete.json`,
    JSON.stringify({
      version: 1,
      id,
      createdAt: start - 24 * hour,
      completedAt: start - 23 * hour,
      database: { key: `${prefix}database.sql`, digest: digest(sql), bytes: sql.length },
      pages: [{ key: `${prefix}pages/000000.json`, digest: digest(page), objects: 1 }],
      required: [],
      objects: 1,
      bytes: original.length,
    }),
  );
  const restored = await restore(fixture, id);
  expect(restored.calls).toEqual(["empty", sql, "rules", "verified"]);
  expect(restored.images.objects.get(key)?.bytes).toEqual(new TextEncoder().encode(original));
});

it("expires half-day sets by completion age while retaining newer sets and live originals", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  expect(await complete(fixture)).toBe("2026-09-22T00Z");
  fixture.state.time += 12 * hour;
  expect(await complete(fixture)).toBe("2026-09-22T12Z");
  fixture.state.time = start + BACKUP_RETENTION + 1;
  for (let step = 0; step < 20; step++) {
    await expireBackups(fixture.context);
  }
  expect(fixture.backups.objects.has("backups/2026-09-22T00Z/complete.json")).toBe(false);
  expect((await restore(fixture, "2026-09-22T12Z")).images.objects.has("runs/run/original")).toBe(
    true,
  );
  expect(fixture.images.objects.has("runs/run/original")).toBe(true);
});

it("alerts on the completed snapshot's age even when its completion is recent", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await complete(fixture);
  fixture.state.time = start + 24 * hour + 1;
  database.connection
    .prepare("UPDATE operations_backups SET completed_at=?")
    .run(fixture.state.time);
  await runOperations(fixture.context, exporter("new snapshot"));
  expect(
    database.connection
      .prepare("SELECT resolved_at FROM operations_events WHERE id='backup:freshness:rpo-exceeded'")
      .get(),
  ).toEqual({ resolved_at: null });
  await complete(fixture);
  await runOperations(fixture.context, exporter("unused"));
  expect(
    database.connection
      .prepare("SELECT resolved_at FROM operations_events WHERE id='backup:freshness:rpo-exceeded'")
      .get(),
  ).toEqual({ resolved_at: fixture.state.time });
});

it.each(["2026-09-22T01Z", "2026-09-22T24Z", "2026-09-22T12Z/extra", "../2026-09-22"])(
  "rejects invalid backup namespace %s before reading storage",
  async (id) => {
    using database = new TestDatabase();
    const fixture = context(database);
    const reads = vi.spyOn(fixture.backups, "get");
    await expect(restore(fixture, id)).rejects.toThrow("Invalid backup identifier");
    expect(reads).not.toHaveBeenCalled();
  },
);
