import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type {
  Database,
  Result,
  SqlValue,
  Statement,
} from "../../../../packages/service/src/database.ts";
import { repairLegacyCheckLeases, targets } from "./repair.ts";

const fixedVersion = "11111111-1111-4111-8111-111111111111";
const observedAt = Date.parse("2026-09-23T05:08:11.000Z");
const error = "SecurityError: The check does not belong to this application and tested commit.";

class SqliteStatement implements Statement {
  constructor(
    readonly connection: DatabaseSync,
    readonly sql: string,
    readonly values: SqlValue[] = [],
  ) {}

  bind(...values: SqlValue[]) {
    return new SqliteStatement(this.connection, this.sql, values);
  }

  execute<T>(): Result<T> {
    const values = this.values.map((value) =>
      value instanceof ArrayBuffer ? new Uint8Array(value) : value,
    );
    return { results: this.connection.prepare(this.sql).all(...values) as T[] };
  }

  async first<T>() {
    return this.execute<T>().results?.[0] ?? null;
  }

  async all<T>() {
    return this.execute<T>();
  }

  async run() {
    return this.execute<Record<string, unknown>>();
  }
}

class TestDatabase implements Database {
  readonly connection = new DatabaseSync(":memory:");

  constructor() {
    this.connection.exec("PRAGMA foreign_keys = ON");
    this.connection.exec(
      readFileSync(
        new URL("../../../../packages/service/work-schema.sql", import.meta.url),
        "utf8",
      ),
    );
    this.connection.exec(`
      CREATE TABLE visonaut_runs (
        id TEXT PRIMARY KEY, project_id TEXT, external_run_id TEXT,
        tested_sha TEXT, active INTEGER
      );
      CREATE TABLE visonaut_checks (
        id TEXT PRIMARY KEY, project_id TEXT, external_run_id TEXT
      );
    `);
    for (const [index, target] of targets.entries()) {
      const runId = `run-${index}`;
      const externalRunId = `external-${index}`;
      const testedSha = `${index + 1}`.repeat(40);
      this.connection
        .prepare("INSERT INTO visonaut_runs VALUES (?, 'diagnostics', ?, ?, ?)")
        .run(runId, externalRunId, testedSha, Number(target.active));
      this.connection
        .prepare("INSERT INTO visonaut_checks VALUES (?, 'diagnostics', ?)")
        .run(target.id, externalRunId);
      this.connection
        .prepare("INSERT INTO work_checks VALUES (?, ?, 46, ?, ?, 47, 1, 1)")
        .run(target.id, target.desiredRevision, `lease-${index}`, target.leaseUntil);
      this.connection
        .prepare(`
          INSERT INTO work_status_outbox
            (check_id, revision, run_id, attempt, comparison_revision,
             source_revision, conclusion, details_url, state, attempts,
             max_attempts, available_at, last_error)
          VALUES (?, 47, ?, 1, 1, 1, 'success', ?, 'sending', 1, 5, 0, ?)
        `)
        .run(target.id, runId, `https://diagnostics.visonaut.com/runs/${runId}`, error);
      if (target.active) {
        this.connection
          .prepare(`
            INSERT INTO work_status_outbox
              (check_id, revision, run_id, attempt, comparison_revision,
               source_revision, conclusion, details_url, state, attempts,
               max_attempts, available_at)
            VALUES (?, 243, ?, 1, 2, 2, ?, ?, 'pending', 0, 5, 0)
          `)
          .run(
            target.id,
            runId,
            target.conclusion,
            `https://diagnostics.visonaut.com/runs/${runId}`,
          );
      }
    }
  }

  prepare(sql: string) {
    return new SqliteStatement(this.connection, sql);
  }

  async batch(statements: Statement[]) {
    this.connection.exec("BEGIN");
    try {
      const results = statements.map((statement) => {
        if (!(statement instanceof SqliteStatement)) {
          throw new Error("Unexpected test statement");
        }
        return statement.execute<Record<string, unknown>>();
      });
      this.connection.exec("COMMIT");
      return results;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  [Symbol.dispose]() {
    this.connection.close();
  }
}

function remoteCheck(database: TestDatabase, id: string) {
  const row = database.connection
    .prepare(`
      SELECT old.run_id, run.tested_sha FROM work_status_outbox AS old
      JOIN visonaut_runs AS run ON run.id = old.run_id
      WHERE old.check_id = ? AND old.revision = 47
    `)
    .get(id);
  if (!row) {
    throw new Error("Missing test run");
  }
  return {
    id: Number(id),
    app: { id: 5028451 },
    head_sha: row.tested_sha,
    external_id: `ariviso:${row.run_id}`,
    name: "Ariviso",
  };
}

function params(database: TestDatabase) {
  return {
    database,
    expectedWorkerVersion: fixedVersion,
    activeWorkerVersion: async () => fixedVersion,
    readGitHubCheck: async (id: string) => remoteCheck(database, id),
    now: () => observedAt,
    mode: "settle" as const,
  };
}

function sendingCount(database: TestDatabase) {
  const row = database.connection
    .prepare(
      "SELECT COUNT(*) AS count FROM work_status_outbox WHERE revision = 47 AND state = 'sending'",
    )
    .get();
  return row?.count;
}

describe("one-time diagnostic check lease repair", () => {
  it("inspects without writes, then settles only the six proven leases", async () => {
    using database = new TestDatabase();
    const dependencies = params(database);
    expect(await repairLegacyCheckLeases({ ...dependencies, mode: "inspect" })).toEqual({
      mode: "inspect",
      checked: 6,
      active: 5,
      inactive: 1,
    });
    expect(sendingCount(database)).toBe(6);

    expect(await repairLegacyCheckLeases(dependencies)).toEqual({
      mode: "settle",
      checked: 6,
      active: 5,
      inactive: 1,
      settled: 6,
    });
    expect(sendingCount(database)).toBe(0);
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM work_status_outbox WHERE revision = 47 AND state = 'obsolete'",
        )
        .get()?.count,
    ).toBe(6);
    expect(
      database.connection
        .prepare(`
          SELECT COUNT(*) AS count FROM work_checks
          WHERE lease_token IS NULL AND lease_revision IS NULL AND lease_until IS NULL
            AND ambiguous = 0 AND request_started = 0 AND delivered_revision = 46
        `)
        .get()?.count,
    ).toBe(6);
    expect(
      database.connection
        .prepare(
          "SELECT COUNT(*) AS count FROM work_status_outbox WHERE revision = 243 AND state = 'pending'",
        )
        .get()?.count,
    ).toBe(5);
    await expect(repairLegacyCheckLeases(dependencies)).rejects.toMatchObject({
      code: "lease_precondition_changed",
    });
  });

  it.each([
    [
      "uncertain PATCH error",
      "UPDATE work_status_outbox SET last_error = 'HTTP 503 after PATCH' WHERE revision = 47",
    ],
    ["changed revision", "UPDATE work_checks SET desired_revision = 244"],
    ["changed lease", `UPDATE work_checks SET lease_until = ${observedAt + 1000}`],
    ["missing token", "UPDATE work_checks SET lease_token = NULL"],
    ["unrelated project", "UPDATE visonaut_checks SET project_id = 'other'"],
  ])("refuses %s before any write", async (_name, mutation) => {
    using database = new TestDatabase();
    database.connection.exec(mutation);
    await expect(repairLegacyCheckLeases(params(database))).rejects.toMatchObject({
      code: "lease_precondition_changed",
    });
    expect(sendingCount(database)).toBe(6);
  });

  it.each([
    ["check ID", { id: 1 }],
    ["App", { app: { id: 1 } }],
    ["tested SHA", { head_sha: "f".repeat(40) }],
    ["external ID", { external_id: "ariviso:other" }],
    ["legacy name", { name: "Visonaut" }],
  ])("refuses a mismatched GitHub %s before any write", async (_name, mismatch) => {
    using database = new TestDatabase();
    const dependencies = params(database);
    await expect(
      repairLegacyCheckLeases({
        ...dependencies,
        readGitHubCheck: async (id) => ({ ...remoteCheck(database, id), ...mismatch }),
      }),
    ).rejects.toMatchObject({ code: "remote_check_mismatch" });
    expect(sendingCount(database)).toBe(6);
  });

  it("refuses a changed token after remote reads and before settlement", async () => {
    using database = new TestDatabase();
    const dependencies = params(database);
    let changed = false;
    await expect(
      repairLegacyCheckLeases({
        ...dependencies,
        readGitHubCheck: async (id) => {
          const check = remoteCheck(database, id);
          if (!changed) {
            database.connection
              .prepare("UPDATE work_checks SET lease_token = 'another-owner' WHERE id = ?")
              .run(id);
            changed = true;
          }
          return check;
        },
      }),
    ).rejects.toMatchObject({ code: "lease_changed_during_preflight" });
    expect(sendingCount(database)).toBe(6);
  });

  it("rechecks the active Worker version after all remote reads", async () => {
    using database = new TestDatabase();
    const dependencies = params(database);
    let deploymentReads = 0;
    await expect(
      repairLegacyCheckLeases({
        ...dependencies,
        activeWorkerVersion: async () => {
          deploymentReads += 1;
          return deploymentReads === 1 ? fixedVersion : "22222222-2222-4222-8222-222222222222";
        },
      }),
    ).rejects.toMatchObject({ code: "fixed_worker_version_changed_during_preflight" });
    expect(deploymentReads).toBe(2);
    expect(sendingCount(database)).toBe(6);
  });

  it("requires an exact newer Worker version at full traffic", async () => {
    using database = new TestDatabase();
    const dependencies = params(database);
    await expect(
      repairLegacyCheckLeases({ ...dependencies, activeWorkerVersion: async () => "other" }),
    ).rejects.toMatchObject({ code: "fixed_worker_version_mismatch" });
    await expect(
      repairLegacyCheckLeases({
        ...dependencies,
        expectedWorkerVersion: "484bc367-4e66-4b05-bf21-3625256e883f",
      }),
    ).rejects.toMatchObject({ code: "old_worker_still_active" });
    expect(sendingCount(database)).toBe(6);
  });
});
