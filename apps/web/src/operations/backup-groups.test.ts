import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { backupDaily, expireBackups, restoreBackup } from "./backups.ts";
import { backupDaily as backupDailyV2 } from "./backups-v2.ts";
import { backupDeletionGrace, expireBackupGroups } from "./backup-groups.ts";
import { BACKUP_RETENTION } from "./backup-objects.ts";
import { promoteBaselines } from "./promotions.ts";
import { TestDatabase, MemoryStore, captured, context, reserve } from "./test-fixtures.ts";

beforeAll(() =>
  vi.stubGlobal(
    "FixedLengthStream",
    class extends TransformStream<Uint8Array, Uint8Array> {
      constructor(expected: number) {
        let bytes = 0;
        super({
          transform(chunk, controller) {
            bytes += chunk.byteLength;
            if (bytes > expected) throw new Error("Length exceeded.");
            controller.enqueue(chunk);
          },
          flush() {
            if (bytes !== expected) throw new Error("Length differs.");
          },
        });
      }
    },
  ),
);
afterAll(() => vi.unstubAllGlobals());
const day = 24 * 60 * 60 * 1000;
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function exporter() {
  const sql = new TextEncoder().encode(
    "CREATE TABLE restored(id TEXT); INSERT INTO restored VALUES('snapshot');",
  );
  return {
    async export() {
      return { body: new Blob([sql]).stream(), bytes: sql.length };
    },
  };
}
async function complete(fixture: ReturnType<typeof context>, legacy = false) {
  const run = legacy ? backupDailyV2 : backupDaily;
  for (let step = 0; step < 150; step++) {
    const result = await run(fixture.context, exporter());
    expect(result.attention).toEqual([]);
    if (result.completed.length) return result.completed[0];
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
  return { images, quarantine, calls, result };
}
async function privateMetadata(fixture: ReturnType<typeof context>, database: TestDatabase) {
  await fixture.quarantine.put("plans/plan.json", '{"private":"plan"}');
  await fixture.quarantine.put("manifests/run/manifest.json", '{"private":"manifest"}');
  database.connection.exec(
    "INSERT INTO ingest_run_provenance(run_id,verified_json,plan_object_key,created_at) VALUES('run','{}','plans/plan.json',0); INSERT INTO ingest_manifests(run_id,shard_key,digest,object_key,job_id,capture_count,created_at) VALUES('run','chromium','digest','manifests/run/manifest.json','1',1,0)",
  );
}

async function saveArchive(
  fixture: ReturnType<typeof context>,
  database: TestDatabase,
  generation: string,
  imageId: string,
  comparisonId?: string,
) {
  const prefix = `history/run/${generation}/`;
  const body = JSON.stringify({
    version: 1,
    runId: "run",
    generation,
    section: "images",
    rows: database.connection.prepare("SELECT * FROM visonaut_images WHERE id=?").all(imageId),
  });
  const root = JSON.stringify({
    version: 1,
    runId: "run",
    generation,
    pages: [
      {
        key: `${prefix}000000.json`,
        digest: digest(body),
        bytes: body.length,
        section: "images",
        rows: 1,
        firstCursor: imageId,
        lastCursor: imageId,
      },
    ],
    counts: { images: 1 },
  });
  await fixture.images.put(`${prefix}000000.json`, body);
  await fixture.images.put(`${prefix}manifest.json`, root);
  if (comparisonId) {
    database.connection
      .prepare(
        "INSERT INTO operations_comparison_archives(comparison_id,run_id,generation,state,object_key,digest,bytes,page_count,created_at,verified_at) VALUES(?,'run',?,'ready',?,?,?,1,0,0)",
      )
      .run(comparisonId, generation, `${prefix}manifest.json`, digest(root), root.length);
  } else {
    database.connection
      .prepare(
        "INSERT INTO operations_run_archives(run_id,generation,state,source_revision,project_revision,object_key,digest,bytes,page_count,progress_json,created_at,verified_at) VALUES('run',?,'ready',0,0,?,?,?,1,'{}',0,0)",
      )
      .run(generation, `${prefix}manifest.json`, digest(root), root.length);
  }
  return { root, body, rootKey: `${prefix}manifest.json`, pageKey: `${prefix}000000.json` };
}

describe("grouped backups", () => {
  it("restores originals, protected snapshots, result artifacts and private metadata without a D1 object registry", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context, "run", "main");
    await promoteBaselines(fixture.context);
    await privateMetadata(fixture, database);
    await fixture.images.put("derived/run/mask", "mask", {
      httpMetadata: { contentType: "image/png" },
    });
    database.connection
      .prepare(
        "INSERT INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height,role) VALUES('mask','run',?,'derived/run/mask','image/png',4,1,1,'mask')",
      )
      .run(digest("mask"));
    database.connection.exec(
      "UPDATE visonaut_comparison_rows SET result_json=json_set(COALESCE(result_json,'{}'),'$.maskImageId','mask')",
    );
    await complete(fixture);
    expect(
      database.connection.prepare("SELECT COUNT(*) AS count FROM operations_backup_objects").get(),
    ).toEqual({ count: 0 });
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM operations_backup_inventory")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM operations_backup_group_pages")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database.connection
        .prepare("SELECT kind,state FROM operations_backup_groups ORDER BY kind")
        .all(),
    ).toEqual([
      { kind: "comparison", state: "ready" },
      { kind: "run", state: "ready" },
      { kind: "snapshot", state: "ready" },
    ]);
    const result = await restore(fixture, "2026-09-22T00Z");
    expect(result.result.objects).toBe(5);
    expect([...result.images.objects.keys()].sort()).toEqual(
      [...fixture.images.objects.keys()].sort(),
    );
    expect([...result.quarantine.objects.keys()].sort()).toEqual(
      [...fixture.quarantine.objects.keys()].sort(),
    );
    expect(result.calls.at(-1)).toBe("verified");
  });

  it("reuses sealed groups without reading source objects or adding per-object rows", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    await complete(fixture);
    const groups = database.connection
      .prepare("SELECT id FROM operations_backup_groups ORDER BY id")
      .all();
    const copies = [...fixture.backups.objects.keys()].filter((key) =>
      key.startsWith("backup-groups/"),
    );
    const images = vi.spyOn(fixture.images, "get");
    const metadata = vi.spyOn(fixture.quarantine, "get");
    fixture.state.time += day;
    await complete(fixture);
    expect(images).not.toHaveBeenCalled();
    expect(metadata).not.toHaveBeenCalled();
    expect(
      database.connection.prepare("SELECT id FROM operations_backup_groups ORDER BY id").all(),
    ).toEqual(groups);
    expect(
      [...fixture.backups.objects.keys()].filter((key) => key.startsWith("backup-groups/")),
    ).toEqual(copies);
    expect(
      database.connection.prepare("SELECT COUNT(*) AS count FROM operations_backup_members").get(),
    ).toEqual({ count: 0 });
  });

  it("includes every durable archive page and derived bytes after comparison detail compaction", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    await fixture.images.put("derived/run/closed-mask", "mask", {
      httpMetadata: { contentType: "image/png" },
    });
    database.connection
      .prepare(
        "INSERT INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height,role) VALUES('closed-mask','run',?,'derived/run/closed-mask','image/png',4,1,1,'mask')",
      )
      .run(digest("mask"));
    const base = await saveArchive(fixture, database, "generation", "closed-mask");
    database.connection.exec("UPDATE visonaut_comparison_rows SET result_json=NULL");
    await complete(fixture);
    fixture.state.time += day;
    await fixture.images.put("derived/run/historical-mask", "new-mask", {
      httpMetadata: { contentType: "image/png" },
    });
    database.connection
      .prepare(
        "INSERT INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height,role) VALUES('historical-mask','run',?,'derived/run/historical-mask','image/png',8,1,1,'mask')",
      )
      .run(digest("new-mask"));
    database.connection.exec(
      "INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,state,created_at,purpose) VALUES('historical','run',0,'policy',2,'ready',0,'historical')",
    );
    const supplement = await saveArchive(
      fixture,
      database,
      "supplement",
      "historical-mask",
      "historical",
    );
    await complete(fixture);
    fixture.images.objects.clear();
    const result = await restore(fixture, "2026-09-23T00Z");
    expect(result.images.objects.has("derived/run/closed-mask")).toBe(true);
    expect(result.images.objects.has("derived/run/historical-mask")).toBe(true);
    for (const archive of [base, supplement]) {
      expect(result.images.objects.get(archive.rootKey)?.bytes).toEqual(
        new TextEncoder().encode(archive.root),
      );
      expect(result.images.objects.get(archive.pageKey)?.bytes).toEqual(
        new TextEncoder().encode(archive.body),
      );
    }
    expect(result.result.objects).toBe(7);
    expect(
      database.connection
        .prepare(
          "SELECT source_id FROM operations_backup_groups WHERE kind='archive' ORDER BY source_id",
        )
        .all(),
    ).toEqual([{ source_id: "comparison:historical" }, { source_id: "run:run" }]);
  });

  it("pages a large warm membership through its compound index without sorting remaining groups", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    database.connection.exec(`
      INSERT INTO operations_backups(id,state,format_version,source_kind,created_at) VALUES('2026-09-22T00Z','copying',3,1,0);
      WITH RECURSIVE sequence(n) AS(SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n<10000)
      INSERT INTO operations_backup_groups(id,kind,source_id,source_revision,source_json,state,prefix,retire_after,created_at,manifest_key,manifest_digest,manifest_bytes)
      SELECT printf('%032x',n),'run',cast(n AS TEXT),'sealed','{}','ready','backup-groups/'||printf('%032x',n)||'/',0,0,'backup-groups/'||printf('%032x',n)||'/manifest-'||printf('%064x',n)||'.json',printf('%064x',n),3 FROM sequence;
      INSERT INTO operations_backup_members(backup_id,group_id) SELECT '2026-09-22T00Z',id FROM operations_backup_groups;
    `);
    const prepared = vi.spyOn(database, "prepare");
    expect((await backupDaily(fixture.context, exporter())).attention).toEqual([]);
    const query = prepared.mock.calls
      .map(([sql]) => sql)
      .find(
        (sql) =>
          sql.includes("SELECT groups.* FROM operations_backup_members member") &&
          !sql.includes("groups.state='copying'"),
      );
    expect(query).toBeDefined();
    const plan = database.connection
      .prepare(`EXPLAIN QUERY PLAN ${query}`)
      .all("2026-09-22T00Z", "", 2);
    expect(plan.map((row) => row.detail).join("\n")).not.toContain("TEMP B-TREE");
    expect(
      database.connection.prepare("SELECT cursor,required_count FROM operations_backups").get(),
    ).toEqual({ cursor: "00000000000000000000000000000002", required_count: 2 });
  });

  it("never advances completed ownership for a failed newer backup", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    await complete(fixture);
    const completed = database.connection
      .prepare("SELECT id,last_completed_at,retire_after FROM operations_backup_groups ORDER BY id")
      .all();
    fixture.state.time += day;
    await captured(fixture.context, "missing");
    await fixture.images.delete("runs/missing/original");
    for (let step = 0; step < 30; step++) {
      await backupDaily(fixture.context, exporter());
      if (
        database.connection
          .prepare("SELECT state FROM operations_backups WHERE id='2026-09-23T00Z'")
          .get()?.state === "failed"
      )
        break;
    }
    expect(
      database.connection
        .prepare("SELECT state FROM operations_backups WHERE id='2026-09-23T00Z'")
        .get(),
    ).toEqual({ state: "failed" });
    for (const previous of completed) {
      if (typeof previous.id !== "string") throw new Error("Invalid group fixture.");
      expect(
        database.connection
          .prepare(
            "SELECT id,last_completed_at,retire_after FROM operations_backup_groups WHERE id=?",
          )
          .get(previous.id),
      ).toEqual(previous);
    }
    expect(
      database.connection.prepare("SELECT COUNT(*) AS count FROM operations_backup_members").get(),
    ).toEqual({ count: 0 });
    await fixture.images.delete("runs/run/original");
    expect((await restore(fixture, "2026-09-22T00Z")).images.objects.has("runs/run/original")).toBe(
      true,
    );
  });

  it("resumes an interrupted copy and refuses to commit after its lease expires", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    await backupDaily(fixture.context, exporter());
    const original = fixture.backups.put.bind(fixture.backups);
    let expired = false;
    vi.spyOn(fixture.backups, "put").mockImplementation(async (key, value, options) => {
      const result = await original(key, value, options);
      if (!expired && key.includes("/objects/")) {
        expired = true;
        fixture.state.time += fixture.context.budget.leaseMilliseconds + 1;
      }
      return result;
    });
    for (let step = 0; step < 15 && !expired; step++)
      await backupDaily(fixture.context, exporter());
    expect(expired).toBe(true);
    expect(
      database.connection
        .prepare("SELECT SUM(object_count) AS count FROM operations_backup_groups")
        .get(),
    ).toEqual({ count: 0 });
    await complete(fixture);
    expect((await restore(fixture, "2026-09-22T00Z")).result.objects).toBe(1);
  });

  it("keeps completion publication fenced across an ambiguous marker write", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    fixture.context.budget.maxAttempts = 1;
    await captured(fixture.context);
    const original = fixture.backups.put.bind(fixture.backups);
    let lost = false;
    vi.spyOn(fixture.backups, "put").mockImplementation(async (key, value, options) => {
      const result = await original(key, value, options);
      if (!lost && key.endsWith("/complete.json")) {
        lost = true;
        throw new Error("Lost marker response.");
      }
      return result;
    });
    for (let step = 0; step < 30 && !lost; step++) await backupDaily(fixture.context, exporter());
    expect(lost).toBe(true);
    expect(database.connection.prepare("SELECT state FROM operations_backups").get()).toEqual({
      state: "copying",
    });
    expect(
      database.connection.prepare("SELECT COUNT(*) AS count FROM operations_backup_members").get()
        ?.count,
    ).toBeGreaterThan(0);
    expect(
      database.connection
        .prepare("SELECT last_completed_at FROM operations_backup_groups LIMIT 1")
        .get(),
    ).toEqual({ last_completed_at: null });
    await complete(fixture);
    expect((await restore(fixture, "2026-09-22T00Z")).result.objects).toBe(1);
  });

  it("cannot overwrite a later completed inventory when a stale publisher resumes", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    const add = async (name: string) => {
      await fixture.images.put(`runs/run/${name}`, name);
      database.connection
        .prepare(
          "INSERT INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height) VALUES(?,'run',?,?,'image/png',1,1,1)",
        )
        .run(name, digest(name), `runs/run/${name}`);
    };
    await add("a");
    await backupDaily(fixture.context, exporter());
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = fixture.backups.put.bind(fixture.backups);
    let paused = false;
    vi.spyOn(fixture.backups, "put").mockImplementation(async (key, value, options) => {
      if (!paused && key.includes("/pages/000000")) {
        paused = true;
        entered?.();
        await blocked;
      }
      return original(key, value, options);
    });
    const stale = backupDaily(fixture.context, exporter());
    await waiting;
    fixture.state.time += fixture.context.budget.leaseMilliseconds + 1;
    await add("b");
    await complete(fixture);
    release?.();
    await stale;
    const restored = await restore(fixture, "2026-09-22T00Z");
    expect([...restored.images.objects.keys()].sort()).toEqual(["runs/run/a", "runs/run/b"]);
    expect(restored.result.objects).toBe(2);
  });

  it("keeps terminal failure and recovery-root release in one transaction", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    fixture.context.budget.maxAttempts = 1;
    await captured(fixture.context);
    const original = fixture.backups.put.bind(fixture.backups);
    let crashed = false;
    const mutation = vi
      .spyOn(fixture.backups, "put")
      .mockImplementation(async (key, value, options) => {
        if (key.includes("/objects/")) {
          crashed = true;
          database.beforeBatch = () => {
            throw new Error("Simulated transaction crash.");
          };
          throw new Error("Storage failure.");
        }
        return original(key, value, options);
      });
    for (let step = 0; step < 20 && !crashed; step++) {
      try {
        await backupDaily(fixture.context, exporter());
      } catch (error) {
        expect(String(error)).toContain("Simulated transaction crash");
      }
    }
    expect(crashed).toBe(true);
    expect(
      database.connection.prepare("SELECT state,failures FROM operations_backups").get(),
    ).toEqual({ state: "copying", failures: 0 });
    mutation.mockRestore();
    fixture.backups.failPut = "/objects/";
    expect((await backupDaily(fixture.context, exporter())).attention).toEqual(["2026-09-22T00Z"]);
    expect(database.connection.prepare("SELECT state FROM operations_backups").get()).toEqual({
      state: "failed",
    });
    expect(
      database.connection.prepare("SELECT COUNT(*) AS count FROM operations_backup_members").get(),
    ).toEqual({ count: 0 });
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM work_retention_pins WHERE reason='recovery'")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("finds a cold group once while its bounded copy pages advance", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    for (let index = 0; index < 7; index++) {
      const name = String(index);
      await fixture.images.put(`runs/run/${name}`, name);
      database.connection
        .prepare(
          "INSERT INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height) VALUES(?,'run',?,?,'image/png',1,1,1)",
        )
        .run(name, digest(name), `runs/run/${name}`);
    }
    const queries = vi.spyOn(database, "prepare");
    await complete(fixture);
    const selectors = queries.mock.calls.filter(([sql]) =>
      sql.includes("groups.state='copying' ORDER BY member.group_id"),
    );
    expect(selectors).toHaveLength(2);
    expect(
      database.connection.prepare("SELECT COUNT(*) AS count FROM operations_backup_pages").get(),
    ).toEqual({ count: 0 });
  });

  it("does not replace a completed root after a stale reader sees cleaned membership rows", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    for (let step = 0; step < 25; step++) {
      if (
        database.connection.prepare("SELECT source_kind FROM operations_backups").get()
          ?.source_kind === 2
      )
        break;
      await backupDaily(fixture.context, exporter());
    }
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let paused = false;
    const original = database.prepare.bind(database);
    const wrapped = (statement: ReturnType<TestDatabase["prepare"]>) => {
      const bind = statement.bind.bind(statement);
      const all = statement.all.bind(statement);
      vi.spyOn(statement, "bind").mockImplementation((...values) => wrapped(bind(...values)));
      vi.spyOn(statement, "all").mockImplementation(async () => {
        if (!paused) {
          paused = true;
          entered?.();
          await blocked;
        }
        return all();
      });
      return statement;
    };
    vi.spyOn(database, "prepare").mockImplementation((sql) => {
      const statement = original(sql);
      return sql.includes(
        "SELECT object_key AS key,digest,bytes,objects FROM operations_backup_pages",
      )
        ? wrapped(statement)
        : statement;
    });
    const stale = backupDaily(fixture.context, exporter());
    await waiting;
    fixture.state.time += fixture.context.budget.leaseMilliseconds + 1;
    await complete(fixture);
    const saved = fixture.backups.objects
      .get("backups/2026-09-22T00Z/complete.json")
      ?.bytes.slice();
    release?.();
    await stale;
    expect(fixture.backups.objects.get("backups/2026-09-22T00Z/complete.json")?.bytes).toEqual(
      saved,
    );
    expect((await restore(fixture, "2026-09-22T00Z")).result.objects).toBe(1);
    expect(
      database.connection
        .prepare("SELECT id FROM operations_events WHERE kind='backup' AND resolved_at IS NULL")
        .all(),
    ).toEqual([]);
  });

  it("separates a mutable run snapshot from its later sealed group", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    await complete(fixture);
    fixture.state.time += day;
    await captured(fixture.context);
    await complete(fixture);
    expect(
      database.connection
        .prepare(
          "SELECT source_revision FROM operations_backup_groups WHERE kind='run' ORDER BY source_revision",
        )
        .all(),
    ).toEqual([{ source_revision: "backup:2026-09-22T00Z" }, { source_revision: "sealed" }]);
    expect((await restore(fixture, "2026-09-22T00Z")).result.objects).toBe(0);
    expect((await restore(fixture, "2026-09-23T00Z")).result.objects).toBe(1);
  });

  it("keeps version2 restores independent while their object registry expires", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    await complete(fixture, true);
    expect((await restore(fixture, "2026-09-22")).result.objects).toBe(1);
    fixture.state.time += 2 * day;
    await complete(fixture);
    await fixture.images.delete("runs/run/original");
    fixture.state.time += BACKUP_RETENTION - day;
    for (let step = 0; step < 20; step++) await expireBackups(fixture.context);
    expect(fixture.backups.objects.has("backups/2026-09-22/complete.json")).toBe(false);
    expect((await restore(fixture, "2026-09-24T00Z")).result.objects).toBe(1);
  });

  it("backs up a retained snapshot even after its run originals have expired", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context, "run", "main");
    await promoteBaselines(fixture.context);
    database.connection.exec(
      "DELETE FROM work_retention_pins; UPDATE work_retained_runs SET byte_state='deleted'; UPDATE visonaut_images SET bytes_present=0",
    );
    await fixture.images.delete("runs/run/original");
    await backupDaily(fixture.context, exporter());
    expect(
      database.connection
        .prepare(
          "SELECT run_id,reason FROM work_retention_pins WHERE owner='backup:2026-09-22T00Z'",
        )
        .all(),
    ).toEqual([]);
    await complete(fixture);
    const restored = await restore(fixture, "2026-09-22T00Z");
    expect(restored.result.objects).toBe(1);
    expect([...restored.images.objects.keys()]).toEqual([...fixture.images.objects.keys()]);
  });

  it("refuses to snapshot protected metadata while its deletion lease is active", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context, "run", "main");
    await promoteBaselines(fixture.context);
    database.connection.exec("UPDATE visonaut_snapshot_retention SET byte_state='deleting'");
    await expect(backupDaily(fixture.context, exporter())).rejects.toThrow("State changed");
    expect(fixture.backups.objects.size).toBe(0);
  });

  it("blocks new backup membership during claimed GC and isolates delayed old deletion", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    await complete(fixture);
    const old = database.connection
      .prepare("SELECT id,prefix FROM operations_backup_groups ORDER BY id")
      .all();
    fixture.state.time += BACKUP_RETENTION + backupDeletionGrace + 1;
    vi.spyOn(fixture.backups, "delete").mockRejectedValueOnce(new Error("Interrupted delete."));
    await expect(expireBackupGroups(fixture.context)).rejects.toThrow("Interrupted delete");
    await expect(backupDaily(fixture.context, exporter())).rejects.toThrow("State changed");
    fixture.state.time += fixture.context.budget.leaseMilliseconds + 1;
    for (let step = 0; step < 30; step++) if (!(await expireBackupGroups(fixture.context))) break;
    expect(
      database.connection.prepare("SELECT COUNT(*) AS count FROM operations_backup_groups").get(),
    ).toEqual({ count: 0 });
    await complete(fixture);
    const current = database.connection
      .prepare("SELECT id,prefix FROM operations_backup_groups ORDER BY id")
      .all();
    expect(current).not.toEqual(old);
    for (const row of old)
      await fixture.backups.delete(
        [...fixture.backups.objects.keys()].filter((key) => key.startsWith(String(row.prefix))),
      );
    const id = `${new Date(fixture.state.time).toISOString().slice(0, 10)}T00Z`;
    expect((await restore(fixture, id)).result.objects).toBe(1);
  });
});
