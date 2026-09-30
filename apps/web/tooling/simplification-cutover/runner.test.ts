import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getPlatformProxy } from "wrangler";
import { expect, it, vi } from "vitest";
import { applyTestMigrations, readTestMigrations } from "../../../../tooling/test-migrations.ts";
import { captured, context, digest, TestDatabase } from "../../src/operations/test-fixtures.ts";
import type { HistoryPageReference } from "../../src/operations/history-format.ts";
import { boundedImages, inspect, runCutover, type CutoverBindings } from "./runner.ts";

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

it("creates only the exact DB and IMAGES config for an explicitly selected remote inspect", async () => {
  using database = new TestDatabase();
  const imageCalls = { get: vi.fn(), put: vi.fn() };
  const dispose = vi.fn(async () => {});
  let configPath = "";
  const report = await runCutover(["inspect", ...remoteSelection], async (options) => {
    configPath = options.configPath ?? "";
    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(Object.keys(config).sort()).toEqual([
      "account_id",
      "compatibility_date",
      "compatibility_flags",
      "d1_databases",
      "name",
      "r2_buckets",
    ]);
    expect(config).toMatchObject({
      account_id: "b04f3af3f0f10a6b9481bc23ba974eca",
      d1_databases: [
        {
          binding: "DB",
          database_name: "visonaut-production",
          database_id: "15fcd402-dccb-4359-a1ce-280ff67ca596",
          remote: true,
        },
      ],
      r2_buckets: [{ binding: "IMAGES", bucket_name: "visonaut-production-images", remote: true }],
    });
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect(options).toMatchObject({ envFiles: [], persist: false, remoteBindings: true });
    return { env: { DB: database, IMAGES: imageCalls }, dispose };
  });
  expect(report.readback.schemaReady).toBe(false);
  expect(imageCalls.get).not.toHaveBeenCalled();
  expect(imageCalls.put).not.toHaveBeenCalled();
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

it("resumes bounded native archive conversion and keeps exact decisions, tuples and original R2 bytes", async () => {
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
      stop: "turn-limit",
      turns: [{ family: "history", report: { deferred: ["closed"], attention: [] } }],
      readback: { unconvertedClosedRecords: 1 },
    });
    const skipped = await runCutover([...argumentsList, "--max-turns", "3"], createPlatform);
    expect(skipped).toMatchObject({
      stop: "no-progress",
      turns: [{ report: { completed: [], deferred: [] } }],
      readback: { unconvertedClosedRecords: 1 },
    });
    const last = await runCutover([...argumentsList, "--max-turns", "3"], createPlatform);
    expect(last).toMatchObject({ stop: "ready", readback: { gatesReady: true } });
    expect(finalDecision).toEqual({ actor_id: "reviewer", verdict: "approved", tuple_json: tuple });
    expect(original).toBe("original-image-bytes");
    expect(puts).not.toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
