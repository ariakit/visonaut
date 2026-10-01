import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getPlatformProxy } from "wrangler";
import { expect, it, vi } from "vitest";
import { applyTestMigrations, readTestMigrations } from "../../../../tooling/test-migrations.ts";
import { captured, context, digest, TestDatabase } from "../../src/operations/test-fixtures.ts";
import type { HistoryPageReference } from "../../src/operations/history-format.ts";
import {
  boundedImages,
  inspect,
  runCutover,
  parseOptions,
  type CutoverBindings,
} from "./runner.ts";
import { executeCutover } from "./operations.ts";

const remoteSelection = [
  "--remote",
  "--environment",
  "production",
  "--database-id",
  "15fcd402-dccb-4359-a1ce-280ff67ca596",
  "--images-bucket",
  "visonaut-production-images",
];

it.each([
  remoteSelection,
  ["inspect", "--remote"],
  ["inspect", ...remoteSelection, "--local"],
  ["inspect", ...remoteSelection, "--environment", "preview"],
  ["inspect", "--environment", "other"],
  ["inspect", "--database-id", "395b539c-c423-4ce4-887c-a5792792a63b;DROP TABLE x"],
  ["inspect", "--images-bucket", "visonaut-production-images"],
  ["inspect", "--persist-path", "relative"],
  ["inspect", ...remoteSelection, "--persist-path", "/tmp"],
  ["inspect", "--max-turns", "1"],
  ["convert", ...remoteSelection],
  ["convert", "--acknowledge-write-fence"],
  ["convert", ...remoteSelection, "--acknowledge-write-fence", "--max-turns", "11"],
  ["convert", ...remoteSelection, "--acknowledge-write-fence", "--max-turns", "NaN"],
  ["inspect", "--config", "apps/web/wrangler.jsonc"],
  ["recovery"],
])("rejects unsafe options before creating any proxy: %j", async (...argumentsList) => {
  const createPlatform = vi.fn();
  await expect(runCutover(argumentsList, createPlatform)).rejects.toMatchObject({
    name: "CutoverOptionsError",
  });
  expect(createPlatform).not.toHaveBeenCalled();
});

it.each(["2", "10"])(
  "rejects remote conversions with %s turns before Worker setup",
  async (maxTurns) => {
    const createPlatform = vi.fn();
    const start = vi.fn(async () => {
      throw new Error("Unexpected remote Worker setup.");
    });
    await expect(
      runCutover(
        ["convert", ...remoteSelection, "--acknowledge-write-fence", "--max-turns", maxTurns],
        createPlatform,
        { entrypoint: new URL("./operations.ts", import.meta.url).pathname, start },
      ),
    ).rejects.toMatchObject({
      name: "CutoverOptionsError",
      message: "--max-turns must be 1 for remote conversion.",
    });
    expect(createPlatform).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  },
);

it("allows one remote conversion turn", () => {
  expect(
    parseOptions(["convert", ...remoteSelection, "--acknowledge-write-fence", "--max-turns", "1"]),
  ).toMatchObject({ remote: true, maxTurns: 1 });
});

it("preserves local conversion turns from 1 to 10", () => {
  for (let maxTurns = 1; maxTurns <= 10; maxTurns++) {
    expect(
      parseOptions([
        "convert",
        "--persist-path",
        tmpdir(),
        "--acknowledge-write-fence",
        "--max-turns",
        String(maxTurns),
      ]),
    ).toMatchObject({ remote: false, maxTurns });
  }
});

it.each([
  {
    environment: "production",
    workerName: "visonaut-compare",
    databaseName: "visonaut-production",
    databaseId: "15fcd402-dccb-4359-a1ce-280ff67ca596",
    imagesBucket: "visonaut-production-images",
  },
  {
    environment: "preview",
    workerName: "visonaut-preview-compare",
    databaseName: "visonaut-preview",
    databaseId: "395b539c-c423-4ce4-887c-a5792792a63b",
    imagesBucket: "visonaut-preview-images",
  },
])(
  "uses the existing $workerName with only the exact DB and IMAGES remote bindings",
  async (target) => {
    using database = new TestDatabase();
    const imageCalls = { get: vi.fn(), put: vi.fn() };
    const dispose = vi.fn(async () => {});
    let configPath = "";
    const report = await runCutover(
      [
        "inspect",
        "--remote",
        "--environment",
        target.environment,
        "--database-id",
        target.databaseId,
        "--images-bucket",
        target.imagesBucket,
      ],
      vi.fn(async () => {
        throw new Error("Remote mode cannot create a binding proxy.");
      }),
      {
        entrypoint: new URL("./operations.ts", import.meta.url).pathname,
        async start(options) {
          configPath = options.config;
          const config = JSON.parse(await readFile(configPath, "utf8"));
          const main = config.main;
          expect(config).toEqual({
            name: target.workerName,
            account_id: "b04f3af3f0f10a6b9481bc23ba974eca",
            main,
            compatibility_date: "2026-09-22",
            compatibility_flags: ["nodejs_compat"],
            d1_databases: [
              {
                binding: "DB",
                database_name: target.databaseName,
                database_id: target.databaseId,
                remote: true,
              },
            ],
            r2_buckets: [{ binding: "IMAGES", bucket_name: target.imagesBucket, remote: true }],
          });
          expect((await stat(configPath)).mode & 0o777).toBe(0o600);
          expect((await stat(main)).mode & 0o777).toBe(0o600);
          expect(await readFile(main, "utf8")).toContain("const options = ");
          expect(await readFile(main, "utf8")).not.toContain("request.json");
          expect(options).toEqual({
            config: configPath,
            envFiles: [],
            dev: { remote: true, watch: false, persist: false, logLevel: "none" },
          });
          const selection = parseOptions([
            "inspect",
            "--remote",
            "--environment",
            target.environment,
            "--database-id",
            target.databaseId,
            "--images-bucket",
            target.imagesBucket,
          ]);
          return {
            fetch: async (_url, init) => {
              expect(init.body).toBeUndefined();
              return Response.json(
                await executeCutover(selection, { DB: database, IMAGES: imageCalls }),
              );
            },
            failure: new Promise<never>(() => {}),
            dispose,
          };
        },
      },
    );
    expect(report.readback.schemaReady).toBe(false);
    expect(imageCalls.get).not.toHaveBeenCalled();
    expect(imageCalls.put).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    await expect(stat(configPath)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("keeps repeated local sessions random and isolated from existing comparator names", async () => {
  using database = new TestDatabase();
  const names: string[] = [];
  const dispose = vi.fn(async () => {});
  for (let index = 0; index < 2; index++) {
    await runCutover([], async (options) => {
      const config = JSON.parse(await readFile(options.configPath ?? "", "utf8"));
      expect(config.name).toMatch(/^visonaut-cutover-[a-f0-9-]{36}$/);
      names.push(config.name);
      expect(config.d1_databases).toEqual([
        {
          binding: "DB",
          database_name: "visonaut-preview",
          database_id: "395b539c-c423-4ce4-887c-a5792792a63b",
          remote: false,
        },
      ]);
      expect(config.r2_buckets).toEqual([
        { binding: "IMAGES", bucket_name: "visonaut-preview-images", remote: false },
      ]);
      expect(options).toMatchObject({ envFiles: [], persist: false, remoteBindings: false });
      return { env: { DB: database, IMAGES: { get: vi.fn(), put: vi.fn() } }, dispose };
    });
  }
  expect(names[0]).not.toBe(names[1]);
  expect(dispose).toHaveBeenCalledTimes(2);
});

it("disposes a selected remote session and removes its config after inspection fails", async () => {
  using database = new TestDatabase();
  vi.spyOn(database, "prepare").mockImplementation(() => {
    throw new Error("inspection failed");
  });
  const dispose = vi.fn(async () => {});
  let configPath = "";
  await expect(
    runCutover(["inspect", ...remoteSelection], vi.fn(), {
      entrypoint: new URL("./operations.ts", import.meta.url).pathname,
      async start(options) {
        configPath = options.config;
        expect(JSON.parse(await readFile(configPath, "utf8")).name).toBe("visonaut-compare");
        const selection = parseOptions(["inspect", ...remoteSelection]);
        return {
          async fetch() {
            try {
              return Response.json(
                await executeCutover(selection, {
                  DB: database,
                  IMAGES: { get: vi.fn(), put: vi.fn() },
                }),
              );
            } catch {
              return Response.json({ code: "cutover-worker-failed" }, { status: 500 });
            }
          },
          failure: new Promise<never>(() => {}),
          dispose,
        };
      },
    }),
  ).rejects.toMatchObject({ name: "CutoverExecutionError" });
  expect(dispose).toHaveBeenCalledOnce();
  await expect(stat(configPath)).rejects.toMatchObject({ code: "ENOENT" });
});

it("reports old schema and missing columns as unknown counts before running readiness SQL", async () => {
  const connection = new DatabaseSync(":memory:");
  for (const migration of readTestMigrations({ through: "0023_pending_webhook_index" })) {
    connection.exec(migration.sql);
  }
  using database = new TestDatabase(connection);
  const queries: string[] = [];
  const prepare = database.prepare.bind(database);
  vi.spyOn(database, "prepare").mockImplementation((sql) => {
    queries.push(sql);
    return prepare(sql);
  });
  const old = await inspect(database, Date.now());
  expect(old).toMatchObject({
    schemaReady: false,
    requiredProtectedSnapshots: null,
    unconvertedClosedRecords: null,
    unresolvedEvents: null,
    foreignKeyViolations: null,
    gatesReady: false,
  });
  expect(old.missingSchema).toContain("visonaut_snapshots.storage_mode");
  expect(old.missingSchema).toContain("visonaut_closed_summaries");
  expect(
    queries.every((sql) => sql.startsWith("SELECT name") || sql.startsWith("PRAGMA table_info")),
  ).toBe(true);
});

it("preserves upload conditions, metadata and checksums while enforcing the one-object bound", async () => {
  const put = vi.fn(async () => ({}));
  const images = boundedImages({ get: vi.fn(), put }, 3);
  const options = {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "image/png" },
    customMetadata: { owner: "fixture" },
    sha256: "a".repeat(64),
  };
  await images.put("image", new Response("abc").body!, options);
  expect(put).toHaveBeenCalledExactlyOnceWith("image", new Uint8Array([97, 98, 99]), options);
  await expect(images.put("oversize", new Response("abcd").body!)).rejects.toThrow("bound");
  expect(put).toHaveBeenCalledOnce();
  await expect(images.delete("image")).rejects.toThrow("outside");
  await expect(images.list({})).rejects.toThrow("outside");
  await expect(images.createMultipartUpload("image")).rejects.toThrow("outside");
});

it("refuses readiness SQL when a migrated target lacks a required column", async () => {
  using database = new TestDatabase();
  database.connection.exec(
    "CREATE TABLE d1_migrations(name TEXT); INSERT INTO d1_migrations VALUES('0024_core_simplification.sql'); ALTER TABLE operations_events RENAME COLUMN resolved_at TO unsupported_resolution",
  );
  const result = await inspect(database, Date.now());
  expect(result.appliedMigrations).toEqual(["0024_core_simplification.sql"]);
  expect(result).toMatchObject({
    schemaReady: false,
    requiredProtectedSnapshots: null,
    unconvertedClosedRecords: null,
    unresolvedEvents: null,
  });
  expect(result.missingSchema).toEqual(["operations_events.resolved_at"]);
});

it.each(["attention", "no-progress"] as const)(
  "stops a capped conversion on %s without calling unrelated capabilities",
  async (stop) => {
    using database = new TestDatabase();
    const fixture = context(database);
    fixture.state.time = Date.now() - 2_592_000_001;
    database.connection.exec(
      "CREATE TABLE d1_migrations(name TEXT); INSERT INTO d1_migrations VALUES('0024_core_simplification.sql')",
    );
    const service = await captured(
      fixture.context,
      "stopped",
      stop === "attention" ? "main" : "pull_request",
    );
    if (stop === "attention") {
      await service.preparePromotion({
        snapshotId: "legacy",
        comparisonId: "comparison-stopped",
        prefix: "baselines/legacy",
        now: 1,
      });
      database.connection.exec(
        "UPDATE visonaut_snapshots SET storage_mode='protected',state='accepted',reference_eligible=1; UPDATE visonaut_snapshot_images SET object_key='baselines/legacy/image-stopped',copied=1",
      );
      await fixture.images.put("runs/stopped/original", "corrupt-original");
    } else {
      await service.retireRun({ runId: "stopped", now: fixture.state.time });
      database.connection.exec(
        "UPDATE visonaut_comparisons SET purpose='historical',state='comparing'",
      );
    }
    const put = vi.spyOn(fixture.images, "put");
    const deleteObjects = vi.spyOn(fixture.images, "delete");
    const quarantine = vi.spyOn(fixture.quarantine, "get");
    const dispose = vi.fn(async () => {});
    const report = await runCutover(
      ["convert", "--persist-path", tmpdir(), "--acknowledge-write-fence", "--max-turns", "10"],
      async () => ({ env: { DB: database, IMAGES: fixture.images }, dispose }),
    );
    expect(report.stop).toBe(stop);
    expect(report.turns).toHaveLength(1);
    expect(report.readback.gatesReady).toBe(false);
    expect(put).not.toHaveBeenCalled();
    expect(deleteObjects).not.toHaveBeenCalled();
    expect(quarantine).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  },
);

it("uses real local Wrangler bindings for default inspection without changing application data", async () => {
  const calls: string[] = [];
  const report = await runCutover([], async (options) => {
    expect(options.remoteBindings).toBe(false);
    expect(options.persist).toBe(false);
    const platform = await getPlatformProxy<CutoverBindings>(options);
    const prepare = platform.env.DB.prepare.bind(platform.env.DB);
    return {
      env: {
        DB: {
          prepare(sql) {
            calls.push(sql);
            return prepare(sql);
          },
          batch: vi.fn(),
        },
        IMAGES: { get: vi.fn(), put: vi.fn() },
      },
      dispose: () => platform.dispose(),
    };
  });
  expect(report).toMatchObject({
    action: "inspect",
    mode: "local",
    persistence: "empty ephemeral local state",
    turns: [],
    readback: {
      schemaReady: false,
      requiredProtectedSnapshots: null,
      unconvertedClosedRecords: null,
    },
  });
  expect(calls).toEqual(["SELECT name FROM sqlite_master WHERE type='table'"]);
});

async function migrated(platform: { env: CutoverBindings }) {
  await applyTestMigrations(platform.env.DB);
  await platform.env.DB.prepare("CREATE TABLE d1_migrations(name TEXT PRIMARY KEY)").run();
  for (const migration of readTestMigrations()) {
    await platform.env.DB.prepare("INSERT INTO d1_migrations(name) VALUES(?)")
      .bind(migration.name)
      .run();
  }
}

it("resumes a large protected baseline without releasing its source objects", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  database.connection.exec(
    "CREATE TABLE d1_migrations(name TEXT); INSERT INTO d1_migrations VALUES('0024_core_simplification.sql')",
  );
  const service = await captured(fixture.context, "main", "main");
  await service.preparePromotion({
    snapshotId: "legacy",
    comparisonId: "comparison-main",
    prefix: "baselines/legacy",
    now: 1,
  });
  await fixture.images.put("baselines/legacy/image-main", "original-image-bytes");
  database.connection.exec(
    "UPDATE visonaut_snapshots SET storage_mode='protected',state='accepted',reference_eligible=1; UPDATE visonaut_snapshot_images SET object_key='baselines/legacy/image-main',copied=1",
  );
  // Extend the one-capture service fixture beyond one production conversion turn.
  const insertImage = database.connection
    .prepare(`INSERT INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height,bytes_present,role,validated)
    SELECT ?,run_id,digest,?,content_type,bytes,width,height,bytes_present,role,validated FROM visonaut_images WHERE id='image-main'`);
  const insertCapture = database.connection
    .prepare(`INSERT INTO visonaut_captures(id,run_id,shard_key,item_key,variant_key,ordinal,image_id,profile_digest,test_id,test_retry,metadata_json)
    SELECT ?,run_id,shard_key,item_key,?,ordinal,?,profile_digest,test_id,test_retry,metadata_json FROM visonaut_captures WHERE id='capture-main'`);
  const insertPointer = database.connection
    .prepare(`INSERT INTO visonaut_snapshot_images(snapshot_id,capture_id,image_id,object_key,digest,copied)
    SELECT 'legacy',?,?,?,digest,1 FROM visonaut_images WHERE id=?`);
  for (let index = 1; index <= 1000; index++) {
    const suffix = String(index).padStart(5, "0");
    const imageId = `image-${suffix}`;
    const sourceKey = `runs/main/original-${suffix}`;
    const protectedKey = `baselines/legacy/${suffix}`;
    insertImage.run(imageId, sourceKey);
    insertCapture.run(`capture-${suffix}`, `variant-${suffix}`, imageId);
    insertPointer.run(`capture-${suffix}`, imageId, protectedKey, imageId);
    await fixture.images.put(sourceKey, "original-image-bytes");
    await fixture.images.put(protectedKey, "original-image-bytes");
  }
  const get = vi.spyOn(fixture.images, "get");
  const put = vi.spyOn(fixture.images, "put");
  const deleteObjects = vi.spyOn(fixture.images, "delete");
  const createPlatform = async () => ({
    env: { DB: database, IMAGES: fixture.images },
    async dispose() {},
  });
  const argumentsList = ["convert", "--persist-path", tmpdir(), "--acknowledge-write-fence"];
  const first = await runCutover(argumentsList, createPlatform);
  expect(first).toMatchObject({
    stop: "turn-limit",
    turns: [{ report: { completed: [], deferred: ["legacy"], attention: [] } }],
    readback: { requiredProtectedSnapshots: 1, gatesReady: false },
  });
  expect(get).toHaveBeenCalledTimes(1000);
  expect(
    await database
      .prepare(`SELECT COUNT(*) AS count FROM visonaut_snapshot_images copy
      JOIN visonaut_images image ON image.id=copy.image_id WHERE copy.object_key!=image.object_key`)
      .first(),
  ).toEqual({ count: 1 });
  expect((await runCutover(argumentsList, createPlatform)).stop).toBe("no-progress");
  const last = await runCutover(argumentsList, createPlatform);
  expect(last).toMatchObject({ stop: "ready", readback: { gatesReady: true } });
  expect(get).toHaveBeenCalledTimes(1001);
  expect(fixture.images.objects.size).toBe(2002);
  expect(put).not.toHaveBeenCalled();
  expect(deleteObjects).not.toHaveBeenCalled();
});

it("repairs a protected original with native D1/R2, preserves bytes and restores the stream global", async () => {
  const directory = await mkdtemp(join(tmpdir(), "visonaut-cutover-test-"));
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "FixedLengthStream");
  using template = new TestDatabase();
  const fixture = context(template);
  const forbidden = vi.fn();
  let original = "";
  let protectedBytes = "";
  let writes = 0;
  try {
    const report = await runCutover(
      ["convert", "--persist-path", directory, "--acknowledge-write-fence"],
      async (options) => {
        const platform = await getPlatformProxy<CutoverBindings>(options);
        try {
          await migrated(platform);
          const images = boundedImages(platform.env.IMAGES, 16_777_216);
          const operations = { ...fixture.context, database: platform.env.DB, images };
          const service = await captured(operations, "main", "main");
          await service.preparePromotion({
            snapshotId: "legacy",
            comparisonId: "comparison-main",
            prefix: "baselines/legacy",
            now: 1,
          });
          await images.put("baselines/legacy/image-main", "original-image-bytes", {
            httpMetadata: { contentType: "image/png" },
          });
          await platform.env.DB.prepare(
            "UPDATE visonaut_snapshots SET storage_mode='protected',state='accepted',reference_eligible=1 WHERE id='legacy'",
          ).run();
          await platform.env.DB.prepare(
            "UPDATE visonaut_snapshot_images SET object_key='baselines/legacy/image-main',copied=1 WHERE snapshot_id='legacy'",
          ).run();
          await platform.env.DB.prepare(
            "UPDATE visonaut_images SET object_key='runs/main/repaired',bytes_present=0 WHERE id='image-main'",
          ).run();
          return {
            env: {
              DB: platform.env.DB,
              IMAGES: {
                get: (key: string) => images.get(key),
                put: (...parameters: Parameters<typeof images.put>) => {
                  writes++;
                  return images.put(...parameters);
                },
                delete: forbidden,
                list: forbidden,
                createMultipartUpload: forbidden,
              },
            },
            async dispose() {
              const source = await images.get("runs/main/repaired");
              const protectedObject = await images.get("baselines/legacy/image-main");
              original = await new Response(source?.body).text();
              protectedBytes = await new Response(protectedObject?.body).text();
              expect(source?.httpMetadata?.contentType).toBe("image/png");
              expect(
                await platform.env.DB.prepare(
                  "SELECT object_key FROM visonaut_snapshot_images WHERE snapshot_id='legacy'",
                ).first(),
              ).toEqual({ object_key: "runs/main/repaired" });
              expect(
                await platform.env.DB.prepare(
                  "SELECT run_id FROM work_retention_pins WHERE owner='promotion:legacy'",
                ).first(),
              ).toEqual({ run_id: "main" });
              await platform.dispose();
            },
          };
        } catch (error) {
          await platform.dispose();
          throw error;
        }
      },
    );
    expect(report).toMatchObject({
      stop: "ready",
      turns: [{ family: "baseline-conversion", report: { completed: ["legacy"], attention: [] } }],
      readback: { gatesReady: true },
    });
    expect(original).toBe("original-image-bytes");
    expect(protectedBytes).toBe(original);
    expect(writes).toBe(1);
    expect(forbidden).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(globalThis, "FixedLengthStream")).toEqual(
      previousDescriptor,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("resumes a large archive after the bounded page turn without expiring its source", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  fixture.state.time = Date.now() - 2_592_000_001;
  database.connection.exec(
    "CREATE TABLE d1_migrations(name TEXT); INSERT INTO d1_migrations VALUES('0024_core_simplification.sql')",
  );
  const service = await captured(fixture.context, "closed");
  await service.retireRun({ runId: "closed", now: fixture.state.time });
  const rows =
    (await database.prepare("SELECT * FROM visonaut_comparison_rows").all()).results ?? [];
  const decisions =
    (await database.prepare("SELECT * FROM visonaut_decisions").all()).results ?? [];
  const pages: HistoryPageReference[] = [];
  for (const [section, records] of [
    ["comparisonRows", rows],
    ["decisions", decisions],
    // One root and 999 pages fit; the remaining pages require another call.
    ...Array.from(
      { length: 999 },
      (_, index) => ["audit", [{ id: `proof-${index}`, action: "proof" }]] as const,
    ),
  ] as const) {
    const key = `history/closed/fixture/${String(pages.length).padStart(6, "0")}.json`;
    const data = JSON.stringify({
      version: 1,
      runId: "closed",
      generation: "fixture",
      section,
      rows: records,
    });
    await fixture.images.put(key, data);
    pages.push({
      key,
      digest: digest(data),
      bytes: Buffer.byteLength(data),
      section,
      rows: records.length,
      firstCursor: "first",
      lastCursor: "last",
    });
  }
  const rootKey = "history/closed/fixture/manifest.json";
  const root = JSON.stringify({
    version: 1,
    runId: "closed",
    generation: "fixture",
    pages,
    counts: { comparisonRows: rows.length, decisions: decisions.length, audit: 999 },
  });
  await fixture.images.put(rootKey, root);
  await database
    .prepare(
      "INSERT INTO operations_run_archives(run_id,generation,state,source_revision,project_revision,object_key,digest,bytes,page_count,progress_json,created_at,verified_at) VALUES('closed','fixture','ready',0,0,?,?,?,?, '{}',0,0)",
    )
    .bind(rootKey, digest(root), Buffer.byteLength(root), pages.length)
    .run();
  database.connection.exec("UPDATE visonaut_runs SET detail_archived=1 WHERE id='closed'");
  const get = vi.spyOn(fixture.images, "get");
  const put = vi.spyOn(fixture.images, "put");
  const deleteObjects = vi.spyOn(fixture.images, "delete");
  const createPlatform = async () => ({
    env: { DB: database, IMAGES: fixture.images },
    async dispose() {},
  });
  const argumentsList = ["convert", "--persist-path", tmpdir(), "--acknowledge-write-fence"];
  const first = await runCutover(argumentsList, createPlatform);
  expect(first).toMatchObject({
    stop: "turn-limit",
    turns: [{ family: "history", report: { deferred: ["closed"], attention: [] } }],
    readback: { unconvertedClosedRecords: 1, gatesReady: false },
  });
  expect(get).toHaveBeenCalledTimes(1000);
  expect(await database.prepare("SELECT COUNT(*) AS count FROM visonaut_captures").first()).toEqual(
    {
      count: 1,
    },
  );
  const last = await runCutover(argumentsList, createPlatform);
  expect(last).toMatchObject({ stop: "ready", readback: { gatesReady: true } });
  expect(get).toHaveBeenCalledTimes(1003);
  expect(
    await database
      .prepare("SELECT audit_json FROM visonaut_closed_summaries WHERE run_id='closed'")
      .first(),
  ).toEqual({ audit_json: '[{"action":"proof","count":999}]' });
  expect(fixture.images.objects.size).toBe(1003);
  expect(put).not.toHaveBeenCalled();
  expect(deleteObjects).not.toHaveBeenCalled();
});

it("converts a native archive in one turn and keeps exact decisions, tuples and original R2 bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "visonaut-cutover-test-"));
  using template = new TestDatabase();
  const fixture = context(template);
  fixture.state.time = Date.now() - 2_592_000_001;
  let seeded = false;
  let tuple: string | undefined;
  let finalDecision: Record<string, unknown> | null = null;
  let original = "";
  const puts = vi.fn();
  const forbidden = vi.fn();
  const createPlatform = async (options: Parameters<typeof getPlatformProxy>[0]) => {
    const platform = await getPlatformProxy<CutoverBindings>(options);
    const images = boundedImages(platform.env.IMAGES, 16_777_216);
    try {
      if (!seeded) {
        await migrated(platform);
        const operations = { ...fixture.context, database: platform.env.DB, images };
        const service = await captured(operations, "closed");
        const row = (await service.comparisonRows("comparison-closed"))[0];
        if (!row) {
          throw new Error("Missing native fixture row.");
        }
        tuple = row.tuple_json;
        await service.review({
          commandId: "approval",
          actorId: "reviewer",
          sessionId: "fixture",
          comparisonId: "comparison-closed",
          verdict: "approved",
          targets: [{ id: row.id, expectedRevision: row.decision_revision }],
          selection: { itemKey: "dialog", variantKey: "light" },
          now: fixture.state.time,
        });
        await service.retireRun({ runId: "closed", now: fixture.state.time });
        const rows =
          (await platform.env.DB.prepare("SELECT * FROM visonaut_comparison_rows").all()).results ??
          [];
        const decisions =
          (await platform.env.DB.prepare("SELECT * FROM visonaut_decisions").all()).results ?? [];
        const pages: HistoryPageReference[] = [];
        for (const [section, records] of [
          ["comparisonRows", rows],
          ["decisions", decisions],
        ] as const) {
          const key = `history/closed/fixture/${String(pages.length).padStart(6, "0")}.json`;
          const data = JSON.stringify({
            version: 1,
            runId: "closed",
            generation: "fixture",
            section,
            rows: records,
          });
          await images.put(key, data);
          pages.push({
            key,
            digest: digest(data),
            bytes: Buffer.byteLength(data),
            section,
            rows: records.length,
            firstCursor: "first",
            lastCursor: "last",
          });
        }
        const rootKey = "history/closed/fixture/manifest.json";
        const root = JSON.stringify({
          version: 1,
          runId: "closed",
          generation: "fixture",
          pages,
          counts: { comparisonRows: rows.length, decisions: decisions.length },
        });
        await images.put(rootKey, root);
        await platform.env.DB.prepare(
          "INSERT INTO operations_run_archives(run_id,generation,state,source_revision,project_revision,object_key,digest,bytes,page_count,progress_json,created_at,verified_at) VALUES('closed','fixture','ready',0,0,?,?,?,2,'{}',0,0)",
        )
          .bind(rootKey, digest(root), Buffer.byteLength(root))
          .run();
        await platform.env.DB.prepare(
          "UPDATE visonaut_runs SET detail_archived=1 WHERE id='closed'",
        ).run();
        seeded = true;
      }
      return {
        env: {
          DB: platform.env.DB,
          IMAGES: {
            get: (key: string) => images.get(key),
            put: (...parameters: Parameters<typeof images.put>) => {
              puts(...parameters);
              return images.put(...parameters);
            },
            delete: forbidden,
            list: forbidden,
            createMultipartUpload: forbidden,
          },
        },
        async dispose() {
          finalDecision = await platform.env.DB.prepare(
            "SELECT actor_id,verdict,tuple_json FROM visonaut_closed_summary_decisions WHERE run_id='closed' AND actor_id='reviewer'",
          ).first();
          original = await new Response((await images.get("runs/closed/original"))?.body).text();
          await platform.dispose();
        },
      };
    } catch (error) {
      await platform.dispose();
      throw error;
    }
  };
  try {
    const argumentsList = ["convert", "--persist-path", directory, "--acknowledge-write-fence"];
    const first = await runCutover(argumentsList, createPlatform);
    expect(first).toMatchObject({
      stop: "ready",
      turns: [{ family: "history", report: { completed: ["closed"], attention: [] } }],
      readback: { gatesReady: true },
    });
    expect(finalDecision).toEqual({ actor_id: "reviewer", verdict: "approved", tuple_json: tuple });
    expect(original).toBe("original-image-bytes");
    expect(puts).not.toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("disposes the public Worker and removes its config on a controller failure during body readback", async () => {
  const event = { source: "RemoteRuntimeController", cause: new Error("private-fixture-details") };
  let rejectFailure: (reason: unknown) => void = () => {};
  let configPath = "";
  const dispose = vi.fn(async () => {});
  await expect(
    runCutover(["inspect", ...remoteSelection], vi.fn(), {
      entrypoint: new URL("./operations.ts", import.meta.url).pathname,
      async start(options) {
        configPath = options.config;
        const failure = new Promise<never>((_, reject) => {
          rejectFailure = reject;
        });
        return {
          async fetch() {
            return new Response(
              new ReadableStream<Uint8Array>({
                start() {
                  rejectFailure(event);
                },
              }),
            );
          },
          failure,
          dispose,
        };
      },
    }),
  ).rejects.toBe(event);
  expect(dispose).toHaveBeenCalledOnce();
  await expect(stat(configPath)).rejects.toMatchObject({ code: "ENOENT" });
});

it("removes the private config when the public Worker start promise rejects", async () => {
  let configPath = "";
  await expect(
    runCutover(["inspect", ...remoteSelection], vi.fn(), {
      entrypoint: new URL("./operations.ts", import.meta.url).pathname,
      async start(options) {
        configPath = options.config;
        throw new Error("private-start-fixture");
      },
    }),
  ).rejects.toThrow("private-start-fixture");
  await expect(stat(configPath)).rejects.toMatchObject({ code: "ENOENT" });
});
