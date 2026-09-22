import { DatabaseSync } from "node:sqlite";
import { sanitizeRestoredDatabase } from "./recovery.ts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  captureProfilesDigest,
  claimExpiredRun,
  closedRunRetentionMs,
  retentionPinStatement,
} from "@ariviso/service";
import { TestDatabase, MemoryStore, context, reserve, captured, digest } from "./test-fixtures.ts";
import { backupDaily, restoreBackup, expireBackups } from "./backups-v2.ts";
import { createRunExport, streamRunExport, expireExports } from "./exports.ts";
import { promoteBaselines } from "./promotions.ts";
import { expireRunImages } from "./retention.ts";
import { deliverGitHubStatuses } from "./checks.ts";
import { copyVerifiedObject } from "./common.ts";
import { createCloudflareDatabaseExporter } from "./cloudflare-export.ts";
import { archiveClosedRuns } from "./history.ts";
import { runOperations } from "./index.ts";
import * as promotions from "./promotions.ts";

beforeAll(() => {
  vi.stubGlobal(
    "FixedLengthStream",
    class extends TransformStream<Uint8Array, Uint8Array> {
      constructor(expected: number) {
        let bytes = 0;
        super({
          transform(chunk, controller) {
            bytes += chunk.byteLength;
            if (bytes > expected) throw new Error("Fixed stream exceeds its length.");
            controller.enqueue(chunk);
          },
          flush() {
            if (bytes !== expected) throw new Error("Fixed stream does not match its length.");
          },
        });
      }
    },
  );
});
afterAll(() => vi.unstubAllGlobals());

function databaseExport(sql: string) {
  const bytes = new TextEncoder().encode(sql);
  return { body: new Blob([bytes]).stream(), bytes: bytes.byteLength };
}

async function completeBackup(fixture: ReturnType<typeof context>) {
  const exporter = {
    async export() {
      return databaseExport(
        "CREATE TABLE restored(id TEXT); INSERT INTO restored VALUES('snapshot');",
      );
    },
  };
  for (let step = 0; step < 30; step++) {
    const report = await backupDaily(fixture.context, exporter);
    if (report.attention.length) throw new Error("Backup failed");
    if (report.completed.length) return;
  }
  throw new Error("Backup did not converge.");
}

describe("protected object operations", () => {
  it("does not commit a baseline until bounded protected copies and verification finish", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "seed", "main");
    fixture.context.budget.objectsPerStep = 1;
    const first = await promoteBaselines(fixture.context);
    expect(first.hasMore).toBe(true);
    expect((await service.project("project")).snapshot_id).toBeNull();
    const second = await promoteBaselines(fixture.context);
    expect(second.completed).toEqual(["seed"]);
    expect((await service.project("project")).snapshot_id).not.toBeNull();
    expect(
      [...fixture.images.objects.keys()].filter((key) => key.startsWith("baselines/")),
    ).toHaveLength(1);
  });
  it("does not point a baseline at a corrupt protected destination", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "seed", "main");
    fixture.context.budget.objectsPerStep = 1;
    await promoteBaselines(fixture.context);
    const key = [...fixture.images.objects.keys()].find((key) => key.startsWith("baselines/"));
    if (!key) throw new Error("No protected image");
    await fixture.images.put(key, "corrupt");
    expect((await promoteBaselines(fixture.context)).attention).toEqual(["seed"]);
    expect((await service.project("project")).snapshot_id).toBeNull();
  });
  it("verifies existing immutable destinations instead of trusting their keys", async () => {
    const source = new MemoryStore();
    const destination = new MemoryStore();
    await source.put("a", "original");
    await destination.put("b", "modified");
    await expect(
      copyVerifiedObject({
        source,
        destination,
        sourceKey: "a",
        destinationKey: "b",
        maximum: 100,
      }),
    ).rejects.toThrow("integrity");
  });
  it("skips pins during discovery and deletes only exact run and derived prefixes", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await reserve(fixture.context, "a");
    await reserve(fixture.context, "ab");
    await service.retireRun({ runId: "a", now: 1 });
    await service.retireRun({ runId: "ab", now: 2 });
    await retentionPinStatement(database, { runId: "a", owner: "manual", reason: "manual" }).run();
    await fixture.images.put("runs/a/keep", "a");
    await fixture.images.put("runs/ab/delete", "ab");
    await fixture.images.put("derived/ab/delete", "mask");
    await fixture.images.put("baselines/ab/keep", "protected");
    fixture.context.budget.tasksPerStep = 1;
    for (let step = 0; step < 20; step++) {
      const report = await archiveClosedRuns(fixture.context);
      if (report.completed.includes("ab")) break;
    }
    expect(
      await database.prepare("SELECT state FROM operations_run_archives WHERE run_id='ab'").first(),
    ).toEqual({ state: "ready" });
    fixture.state.time += closedRunRetentionMs;
    await expireRunImages(fixture.context);
    await expireRunImages(fixture.context);
    expect(
      [...fixture.images.objects.keys()].filter((key) => !key.startsWith("history/")).sort(),
    ).toEqual(["baselines/ab/keep", "runs/a/keep"]);
    expect(
      await database.prepare("SELECT byte_state FROM work_retained_runs WHERE id='ab'").first(),
    ).toEqual({ byte_state: "deleted" });
  });
});

describe("serialized GitHub checks", () => {
  it("reconciles a lost creation response without a second POST", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    fixture.state.losePost = true;
    expect((await deliverGitHubStatuses(fixture.context)).attention).toContain("run");
    fixture.state.losePost = false;
    await deliverGitHubStatuses(fixture.context);
    expect(fixture.state.posts).toBe(1);
    expect(fixture.state.patches).toBe(1);
  });
  it("holds ambiguous PATCH delivery across scheduler retries and newer source revisions", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    fixture.state.losePatch = true;
    await deliverGitHubStatuses(fixture.context);
    await reserve(fixture.context, "another");
    await deliverGitHubStatuses(fixture.context);
    expect(fixture.state.patches).toBe(2); // One per distinct check, never a second write to the blocked first check.
    expect(
      await database.prepare("SELECT ambiguous FROM work_checks WHERE id='1'").first(),
    ).toEqual({ ambiguous: 1 });
  });
  it("refreshes old intents after another run changes the project revision", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    await deliverGitHubStatuses(fixture.context);
    const before = fixture.state.patches;
    await reserve(fixture.context, "another");
    await deliverGitHubStatuses(fixture.context);
    expect(fixture.state.patches).toBe(before + 2);
    expect(
      await database
        .prepare(
          "SELECT source_revision FROM work_status_outbox WHERE check_id='1' ORDER BY revision DESC LIMIT 1",
        )
        .first(),
    ).toEqual(
      await database.prepare("SELECT revision AS source_revision FROM ariviso_projects").first(),
    );
  });
  it("terminalizes an exhausted unstarted check creation lease", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    await database
      .prepare(
        "INSERT INTO operations_check_creations(run_id,external_id,state,attempts,lease_token,lease_until,created_at,updated_at) VALUES('run','ariviso:run','creating',2,'old',0,0,0)",
      )
      .run();
    await deliverGitHubStatuses(fixture.context);
    expect(await database.prepare("SELECT state FROM operations_check_creations").first()).toEqual({
      state: "dead",
    });
    expect(fixture.state.posts).toBe(0);
  });
});

describe("daily backup and isolated recovery", () => {
  it("pins bytes before export, resumes failed copies, and restores every original plus private metadata", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    await fixture.quarantine.put("plans/plan.json", '{"private":"plan"}');
    await fixture.quarantine.put("manifests/run/manifest.json", '{"private":"manifest"}');
    await fixture.quarantine.put("uploads/temporary", "quarantine");
    database.connection.exec(
      "INSERT INTO ingest_run_provenance(run_id,verified_json,plan_object_key,created_at) VALUES('run','{}','plans/plan.json',0);INSERT INTO ingest_manifests(run_id,shard_key,digest,object_key,job_id,capture_count,created_at) VALUES('run','shard','digest','manifests/run/manifest.json','1',1,0)",
    );
    await backupDaily(fixture.context, {
      async export() {
        return databaseExport("snapshot sql");
      },
    });
    expect(
      await database
        .prepare("SELECT reason FROM work_retention_pins WHERE owner='backup:2026-09-22'")
        .first(),
    ).toEqual({ reason: "recovery" });
    fixture.backups.failPut = "backup-objects/";
    expect(
      (
        await backupDaily(fixture.context, {
          async export() {
            throw new Error("must not reexport");
          },
        })
      ).attention,
    ).toHaveLength(1);
    expect(fixture.backups.objects.has("backups/2026-09-22/complete.json")).toBe(false);
    fixture.backups.failPut = null;
    await completeBackup(fixture);
    const restoredImages = new MemoryStore();
    const restoredMetadata = new MemoryStore();
    const calls: string[] = [];
    const result = await restoreBackup(
      fixture.backups,
      "2026-09-22",
      {
        images: restoredImages,
        quarantine: restoredMetadata,
        async assertEmpty() {
          calls.push("empty");
        },
        async importDatabase(stream) {
          calls.push(await new Response(stream).text());
        },
        async reapplyCurrentRules() {
          calls.push("current-rules");
        },
        async verifyDatabaseAndReferences() {
          calls.push("verified");
        },
      },
      fixture.context.budget,
    );
    expect(result.objects).toBe(3);
    expect(calls).toEqual(["empty", "snapshot sql", "current-rules", "verified"]);
    expect([...restoredImages.objects.keys()]).toEqual(["runs/run/original"]);
    expect([...restoredMetadata.objects.keys()].sort()).toEqual([
      "manifests/run/manifest.json",
      "plans/plan.json",
    ]);
    expect(
      await database
        .prepare("SELECT * FROM work_retention_pins WHERE owner='backup:2026-09-22'")
        .first(),
    ).toBeNull();
  });
  it("refreshes recovery pins for runs created while the SQL export starts", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context, "before");
    await backupDaily(fixture.context, {
      async export() {
        await reserve(fixture.context, "during");
        await database
          .prepare(
            "INSERT INTO ingest_run_provenance(run_id,verified_json,plan_object_key,created_at) VALUES('during','{}','plans/missing.json',0)",
          )
          .run();
        return databaseExport("sql including during");
      },
    });
    expect(
      await database
        .prepare(
          "SELECT run_id FROM work_retention_pins WHERE owner='backup:2026-09-22' ORDER BY run_id",
        )
        .all(),
    ).toEqual({ results: [{ run_id: "before" }, { run_id: "during" }] });
    let failed = false;
    for (let step = 0; step < 20; step++) {
      const result = await backupDaily(fixture.context, {
        async export() {
          throw new Error("Unexpected re-export");
        },
      });
      if (result.attention.length) {
        failed = true;
        break;
      }
      expect(result.completed).toEqual([]);
    }
    expect(failed).toBe(true);
    expect(fixture.backups.objects.has("backups/2026-09-22/complete.json")).toBe(false);
  });
  it("refuses completion when a database-required protected image is missing from object listing", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context, "seed", "main");
    await promoteBaselines(fixture.context);
    const key = [...fixture.images.objects.keys()].find((key) => key.startsWith("baselines/"));
    if (!key) throw new Error("Missing fixture snapshot");
    await fixture.images.delete(key);
    let failed = false;
    for (let step = 0; step < 20; step++) {
      const report = await backupDaily(fixture.context, {
        async export() {
          return databaseExport("sql");
        },
      });
      if (report.attention.length) {
        failed = true;
        break;
      }
      expect(report.completed).toEqual([]);
    }
    expect(failed).toBe(true);
    expect(fixture.backups.objects.has("backups/2026-09-22/complete.json")).toBe(false);
  });
  it("rejects corrupt backup bytes before activating restored rules", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    await completeBackup(fixture);
    const copied = await database
      .prepare(
        "SELECT backup_key FROM operations_backup_objects WHERE source='images' AND object_key='runs/run/original'",
      )
      .first<{ backup_key: string }>();
    if (!copied) throw new Error("Missing backup fixture copy");
    await fixture.backups.put(copied.backup_key, "corrupt");
    let activated = false;
    await expect(
      restoreBackup(
        fixture.backups,
        "2026-09-22",
        {
          images: new MemoryStore(),
          quarantine: new MemoryStore(),
          async assertEmpty() {},
          async importDatabase(stream) {
            await stream.cancel();
          },
          async reapplyCurrentRules() {
            activated = true;
          },
          async verifyDatabaseAndReferences() {},
        },
        fixture.context.budget,
      ),
    ).rejects.toThrow();
    expect(activated).toBe(false);
  });
  it("refuses a backup while an irreversible run deletion is in progress", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await reserve(fixture.context);
    await service.retireRun({ runId: "run", now: 1 });
    await claimExpiredRun(database, {
      id: "run",
      token: "delete",
      now: fixture.state.time,
      leaseMs: 60_000,
    });
    await expect(
      backupDaily(fixture.context, {
        async export() {
          throw new Error("not reached");
        },
      }),
    ).rejects.toThrow("State changed");
  });
  it("imports a consistent SQL snapshot and verifies restored metadata against original bytes", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context, "seed", "main");
    await promoteBaselines(fixture.context);
    const exporter = {
      async export() {
        const definitions = database.connection
          .prepare(
            "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all();
        const commands = ["PRAGMA foreign_keys=OFF;"];
        for (const table of definitions) {
          if (typeof table.sql === "string") commands.push(`${table.sql};`);
        }
        for (const table of definitions) {
          if (typeof table.name !== "string") throw new Error("Invalid table");
          const name = `"${table.name.replaceAll('"', '""')}"`;
          for (const row of database.connection.prepare(`SELECT * FROM ${name}`).all()) {
            const columns = Object.keys(row)
              .map((column) => `"${column.replaceAll('"', '""')}"`)
              .join(",");
            const values = Object.values(row)
              .map(
                (value) =>
                  database.connection.prepare("SELECT quote(?) AS value").get(value)?.value,
              )
              .join(",");
            commands.push(`INSERT INTO ${name}(${columns}) VALUES(${values});`);
          }
        }
        return databaseExport(commands.join("\n"));
      },
    };
    for (let step = 0; step < 20; step++) {
      const report = await backupDaily(fixture.context, exporter);
      if (report.completed.length) break;
      expect(report.attention).toEqual([]);
    }
    using target = new DatabaseSync(":memory:");
    const images = new MemoryStore();
    const quarantine = new MemoryStore();
    await restoreBackup(
      fixture.backups,
      "2026-09-22",
      {
        images,
        quarantine,
        async assertEmpty() {
          expect(target.prepare("SELECT * FROM sqlite_master").all()).toEqual([]);
        },
        async importDatabase(stream) {
          target.exec(await new Response(stream).text());
          target.exec("PRAGMA foreign_keys=ON");
        },
        async reapplyCurrentRules() {
          target.exec("DELETE FROM work_retention_pins WHERE reason='recovery';");
        },
        async verifyDatabaseAndReferences() {
          expect(target.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
          for (const row of target.prepare("SELECT object_key,bytes FROM ariviso_images").all()) {
            if (typeof row.object_key !== "string") throw new Error("Invalid image");
            expect(images.objects.get(row.object_key)?.bytes.length).toBe(row.bytes);
          }
        },
      },
      fixture.context.budget,
    );
    expect(target.prepare("SELECT id,tested_sha FROM ariviso_runs").all()).toEqual(
      database.connection.prepare("SELECT id,tested_sha FROM ariviso_runs").all(),
    );
    expect(target.prepare("SELECT metadata_json FROM ariviso_captures").all()).toEqual(
      database.connection.prepare("SELECT metadata_json FROM ariviso_captures").all(),
    );
  });
  it("fences restored external work and invalidates old authentication", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    await deliverGitHubStatuses(fixture.context);
    database.connection.exec(
      "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES('u','Fixture','fixture@example.test',1,0,0);INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES('old',1,'old-token',0,0,'u');INSERT INTO verification(id,identifier,value,expiresAt,createdAt,updatedAt) VALUES('old','old','old',1,0,0);INSERT INTO account(id,accountId,providerId,userId,accessToken,refreshToken,idToken,accessTokenExpiresAt,refreshTokenExpiresAt,createdAt,updatedAt) VALUES('account','1','github','u','secret','secret','secret',1,1,0,0)",
    );
    await sanitizeRestoredDatabase(database, fixture.state.time);
    expect(database.connection.prepare("SELECT * FROM session").all()).toEqual([]);
    expect(database.connection.prepare("SELECT accessToken FROM account").get()).toEqual({
      accessToken: null,
    });
    expect(database.connection.prepare("SELECT ambiguous FROM work_checks").get()).toEqual({
      ambiguous: 1,
    });
    expect(database.connection.prepare("SELECT active FROM ariviso_runs").get()).toEqual({
      active: 0,
    });
  });
  it("reuses verified originals without source reads and restores retained sets after live deletion", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context, "seed", "main");
    await promoteBaselines(fixture.context);
    await completeBackup(fixture);
    const protectedKeys = [...fixture.images.objects.keys()];
    const copies = [...fixture.backups.objects.keys()].filter((key) =>
      key.startsWith("backup-objects/"),
    );
    expect(copies).toHaveLength(2);
    fixture.state.time += 24 * 60 * 60 * 1000;
    const sourceRead = vi
      .spyOn(fixture.images, "get")
      .mockRejectedValue(new Error("Source unavailable"));
    await completeBackup(fixture);
    expect(sourceRead).not.toHaveBeenCalled();
    sourceRead.mockRestore();
    expect(
      [...fixture.backups.objects.keys()].filter((key) => key.startsWith("backup-objects/")),
    ).toEqual(copies);
    await fixture.images.delete(protectedKeys);
    // The oldest set expires first; the newer completed set still owns every shared byte.
    fixture.state.time += 30 * 24 * 60 * 60 * 1000;
    for (let step = 0; step < 20; step++) await expireBackups(fixture.context);
    expect(fixture.backups.objects.has("backups/2026-09-22/complete.json")).toBe(false);
    const restored = new MemoryStore();
    await restoreBackup(
      fixture.backups,
      "2026-09-23",
      {
        images: restored,
        quarantine: new MemoryStore(),
        async assertEmpty() {},
        async importDatabase(stream) {
          await stream.cancel();
        },
        async reapplyCurrentRules() {},
        async verifyDatabaseAndReferences() {},
      },
      fixture.context.budget,
    );
    expect([...restored.objects.keys()].sort()).toEqual(protectedKeys.sort());
  });
  it("freezes required keys once and does not extend completed ownership for an unfinished snapshot", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    await completeBackup(fixture);
    const first = await database
      .prepare("SELECT last_completed_at FROM operations_backup_objects")
      .first();
    fixture.state.time += 24 * 60 * 60 * 1000;
    await backupDaily(fixture.context, {
      async export() {
        return databaseExport("second snapshot");
      },
    });
    await captured(fixture.context, "after-export");
    const count = await database
      .prepare("SELECT COUNT(*) AS count FROM operations_backup_inventory")
      .first();
    expect(count).toEqual({ count: 1 });
    await backupDaily(fixture.context, {
      async export() {
        throw new Error("Unexpected export");
      },
    });
    expect(
      await database.prepare("SELECT last_completed_at FROM operations_backup_objects").first(),
    ).toEqual(first);
    // No GC may race an in-flight snapshot, even after the completed set ages out.
    fixture.state.time += 31 * 24 * 60 * 60 * 1000;
    await expireBackups(fixture.context);
    expect(
      [...fixture.backups.objects.keys()].filter((key) => key.startsWith("backup-objects/")),
    ).toHaveLength(1);
  });
  it("recovers a crashed shared-copy deletion before starting a fresh copy generation", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    await completeBackup(fixture);
    const previous = await database
      .prepare("SELECT backup_key FROM operations_backup_objects")
      .first<{ backup_key: string }>();
    if (!previous) throw new Error("Missing first copy");
    fixture.state.time += 31 * 24 * 60 * 60 * 1000;
    const deletion = vi
      .spyOn(fixture.backups, "delete")
      .mockRejectedValueOnce(new Error("Storage outage"));
    await expect(expireBackups(fixture.context)).rejects.toThrow("Storage outage");
    await expect(
      backupDaily(fixture.context, {
        async export() {
          return databaseExport("blocked");
        },
      }),
    ).rejects.toThrow("State changed");
    deletion.mockRestore();
    fixture.state.time += fixture.context.budget.leaseMilliseconds + 1;
    await expireBackups(fixture.context);
    await completeBackup(fixture);
    const current = await database
      .prepare("SELECT backup_key FROM operations_backup_objects")
      .first<{ backup_key: string }>();
    expect(current?.backup_key).not.toBe(previous.backup_key);
    // A delayed deletion from the crashed invocation addresses only the old generation.
    await fixture.backups.delete(previous.backup_key);
    expect(current && fixture.backups.objects.has(current.backup_key)).toBe(true);
  });
  it("expires old backup sets without touching live originals", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    await completeBackup(fixture);
    fixture.state.time += 31 * 24 * 60 * 60 * 1000;
    for (let step = 0; step < 20; step++) await expireBackups(fixture.context);
    expect(fixture.backups.objects.size).toBe(0);
    expect(fixture.images.objects.has("runs/run/original")).toBe(true);
  });
});

describe("private streaming exports", () => {
  it("streams exact original bytes with private metadata and a final integrity marker", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    const result = await createRunExport(fixture.context, { runId: "run", actorId: "maintainer" });
    const response = await streamRunExport(fixture.context, result.exportId);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("private.test.ts");
    expect(text).toContain("original-image-bytes");
    expect(text).toContain("complete.json");
    expect(bytes.length % 512).toBe(0);
    fixture.state.time += 24 * 60 * 60 * 1000 + 1;
    for (let step = 0; step < 100; step++) {
      if (!(await expireExports(fixture.context))) break;
    }
    await expect(streamRunExport(fixture.context, result.exportId)).rejects.toThrow("expired");
    expect(
      await database
        .prepare("SELECT * FROM work_retention_pins WHERE owner=?")
        .bind(`export:${result.exportId}`)
        .first(),
    ).toBeNull();
  });
  it("exports inherited originals and pins their owners after the inherited run is retired", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await captured(fixture.context, "first");
    const first = await service.run("first");
    await service.reserveRun({
      id: "inherited",
      projectId: "project",
      externalRunId: "first",
      attempt: 2,
      kind: "pull_request",
      testedSha: first.tested_sha,
      lineageKey: first.lineage_key,
      plan: {
        digest: "plan",
        shards: [
          {
            key: "chromium",
            profileDigest: "profile",
            tests: ["test"],
            captures: [{ itemKey: "dialog", variantKey: "light", testId: "test" }],
          },
        ],
      },
      verifiedRelatedRunIds: ["first"],
      verifiedAncestorShas: [],
      verificationDigest: "proof",
      inheritFromRunId: "first",
      verifiedInheritedShards: [
        {
          key: "chromium",
          manifestDigest: "manifest",
          captureProfileDigest: await captureProfilesDigest([
            { itemKey: "dialog", variantKey: "light", profileDigest: "profile" },
          ]),
        },
      ],
      rerunShardKeys: [],
      now: fixture.state.time,
    });
    await service.sealRun({ runId: "inherited", now: fixture.state.time });
    await service.createComparison({
      id: "comparison-inherited",
      runId: "inherited",
      referenceSnapshotId: null,
      now: fixture.state.time,
      maxAttempts: 2,
    });
    await service.finalizeComparison({
      comparisonId: "comparison-inherited",
      now: fixture.state.time,
    });
    const result = await createRunExport(fixture.context, {
      runId: "inherited",
      actorId: "maintainer",
    });
    await service.retireRun({ runId: "inherited", now: fixture.state.time });
    expect(
      await database
        .prepare("SELECT run_id FROM work_retention_pins WHERE owner=? ORDER BY run_id")
        .bind(`export:${result.exportId}`)
        .all(),
    ).toEqual({ results: [{ run_id: "first" }, { run_id: "inherited" }] });
    expect(await (await streamRunExport(fixture.context, result.exportId)).text()).toContain(
      "original-image-bytes",
    );
    fixture.state.time += 24 * 60 * 60 * 1000 + 1;
    for (let step = 0; step < 100; step++) {
      if (!(await expireExports(fixture.context))) break;
    }
    expect(
      await database
        .prepare("SELECT * FROM work_retention_pins WHERE owner=?")
        .bind(`export:${result.exportId}`)
        .first(),
    ).toBeNull();
  });
  it("enforces the measured entry bound before making an export downloadable", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    fixture.context.budget.maximumExportEntries = 0;
    await expect(
      createRunExport(fixture.context, { runId: "run", actorId: "maintainer" }),
    ).rejects.toThrow("entry limit");
    expect(
      await database
        .prepare("SELECT * FROM work_retention_pins WHERE owner LIKE 'export:%'")
        .first(),
    ).toBeNull();
  });
  it("cancels the current reader and bounded prefetch when the download disconnects", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    for (let index = 0; index < 4; index++) {
      const key = `derived/run/${index}`;
      await fixture.images.put(key, "original-image-bytes");
      await database
        .prepare(
          "INSERT INTO ariviso_images(id,run_id,digest,object_key,content_type,bytes,width,height,role) VALUES(?,'run',?,?,'image/png',20,1,1,'thumbnail')",
        )
        .bind(`derived-${index}`, digest(new TextEncoder().encode("original-image-bytes")), key)
        .run();
    }
    const exported = await createRunExport(fixture.context, {
      runId: "run",
      actorId: "maintainer",
    });
    const original = fixture.images.get.bind(fixture.images);
    let calls = 0;
    let cancellations = 0;
    fixture.images.get = async (key) => {
      calls++;
      const object = await original(key);
      if (!object) return null;
      await object.body.cancel();
      return {
        ...object,
        body: new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(20));
          },
          cancel() {
            cancellations++;
          },
        }),
      };
    };
    const response = await streamRunExport(fixture.context, exported.exportId);
    if (!response.body) throw new Error("No archive");
    const reader = response.body.getReader();
    for (let count = 0; count < 1000 && !calls; count++) {
      await reader.read();
    }
    await reader.cancel();
    reader.releaseLock();
    expect(calls).toBe(4);
    expect(cancellations).toBe(4);
  });
  it("fails a changed source instead of emitting a successful archive", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await captured(fixture.context);
    const result = await createRunExport(fixture.context, { runId: "run", actorId: "maintainer" });
    await fixture.images.put("runs/run/original", "xxxxxxxxxxxxxxxxxxxx");
    const response = await streamRunExport(fixture.context, result.exportId);
    await expect(response.arrayBuffer()).rejects.toThrow();
  });
});

describe("Cloudflare export transport", () => {
  it("uses a consistent SQL export and never forwards API credentials to its download URL", async () => {
    const calls: RequestInit[] = [];
    const exporter = createCloudflareDatabaseExporter({
      accountId: "a".repeat(32),
      databaseId:
        "a".repeat(8) +
        "-" +
        "a".repeat(4) +
        "-" +
        "a".repeat(4) +
        "-" +
        "a".repeat(4) +
        "-" +
        "a".repeat(12),
      apiToken: "private-token",
      maximumMilliseconds: 5000,
      request: async (_url, init) => {
        calls.push(init ?? {});
        return calls.length === 1
          ? Response.json({
              success: true,
              result: { status: "complete", result: { signed_url: "https://backup.example/sql" } },
            })
          : new Response("sql");
      },
    });
    expect(await new Response((await exporter.export()).body).text()).toBe("sql");
    expect(calls[0]?.headers).toHaveProperty("authorization", "Bearer private-token");
    expect(calls[1]?.headers).toBeUndefined();
    expect(calls[1]?.redirect).toBe("manual");
  });
});

it("keeps scheduler failures active while failing and resolves them after recovery", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const promotion = vi
    .spyOn(promotions, "promoteBaselines")
    .mockRejectedValue(new Error("Unavailable"));
  const exporter = {
    async export() {
      return databaseExport("snapshot sql");
    },
  };
  try {
    await runOperations(fixture.context, exporter);
    fixture.state.time++;
    await runOperations(fixture.context, exporter);
    const failure = await database
      .prepare(
        "SELECT occurrences,resolved_at FROM operations_events WHERE id='promotion:scheduler:step-failed'",
      )
      .first();
    expect(failure).toEqual({ occurrences: 2, resolved_at: null });
    promotion.mockResolvedValue({ completed: [], deferred: [], attention: [], hasMore: false });
    fixture.state.time++;
    await runOperations(fixture.context, exporter);
    expect(
      await database
        .prepare(
          "SELECT resolved_at FROM operations_events WHERE id='promotion:scheduler:step-failed'",
        )
        .first(),
    ).toEqual({ resolved_at: fixture.state.time });
  } finally {
    promotion.mockRestore();
  }
});
