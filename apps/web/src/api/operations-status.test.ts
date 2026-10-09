import { SecurityError } from "@visonaut/security";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { operationsStatus } from "./operations.ts";
import { measureD1 } from "./test-d1-costs.ts";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB"],
  }),
);
const database = await runtime.getD1Database("DB");
const checkedAt = 1_700_000_000_000;
const status = { projectId: "project", repositoryId: "100" };

/** A database where the statement that starts with `start` reads a table that does not exist. */
function failingRead(start: string) {
  return new Proxy(database, {
    get(target, key) {
      if (key === "prepare") {
        return (sql: string) =>
          target.prepare(sql.startsWith(start) ? "SELECT * FROM missing_table" : sql);
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function addProject(id: string, repositoryId: string) {
  await database
    .prepare("INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES(?,?,'policy')")
    .bind(id, repositoryId)
    .run();
}

async function addEvent(
  id: string,
  kind: string,
  subject: string,
  code: string,
  times: [first: number, last: number, resolved: number | null],
) {
  await database
    .prepare(
      "INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at,resolved_at) VALUES(?,?,?,?,?,?,?)",
    )
    .bind(id, kind, subject, code, ...times)
    .run();
}

/** One project, open and resolved events, and the snapshot that a scheduled pass writes. */
async function seedFixture() {
  await addProject("project", "100");
  await addEvent("event-b", "check-delivery", "check-1", "exhausted", [20, 300, null]);
  await addEvent("event-a", "backup", "day", "backup-failed", [10, 300, null]);
  await addEvent("capacity", "database-capacity", "database", "admission-blocked", [
    400,
    500,
    null,
  ]);
  await addEvent("resolved", "backup", "old-day", "backup-failed", [1, 600, 601]);
  await database
    .prepare("INSERT INTO operations_cursors(id,value) VALUES('database-capacity',?)")
    .bind(
      '{"maximumActiveRuns":2,"activeRuns":1,"databaseBytes":4096,"observedAt":450,"databaseWarningBytes":1000,"databaseAdmissionBytes":2000}',
    )
    .run();
}

/** The body that the route sends. */
async function answer() {
  return Response.json(await operationsStatus({ database, ...status })).text();
}

beforeAll(async () => {
  await applyTestMigrations(database);
  await database
    .prepare("INSERT INTO visonaut_policies(digest,policy_json) VALUES('policy','{}')")
    .run();
});
afterAll(async () => runtime.dispose());
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(checkedAt);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await database.batch([
    database.prepare("DELETE FROM operations_events"),
    database.prepare("DELETE FROM operations_cursors"),
    database.prepare("DELETE FROM visonaut_projects"),
  ]);
});

describe("status read of /api/operations", () => {
  it("sends the same body for a project with open and resolved alerts and a capacity snapshot", async () => {
    await seedFixture();
    expect(await answer()).toBe(
      JSON.stringify({
        events: [
          {
            kind: "database-capacity",
            code: "admission-blocked",
            subject: "database",
            firstSeenAt: 400,
            lastSeenAt: 500,
          },
          {
            kind: "backup",
            code: "backup-failed",
            subject: "day",
            firstSeenAt: 10,
            lastSeenAt: 300,
          },
          {
            kind: "check-delivery",
            code: "exhausted",
            subject: "check-1",
            firstSeenAt: 20,
            lastSeenAt: 300,
          },
        ],
        hasMore: false,
        checkedAt,
        capacity: {
          maximumActiveRuns: 2,
          activeRuns: 1,
          databaseBytes: 4096,
          observedAt: 450,
          databaseWarningBytes: 1000,
          databaseAdmissionBytes: 2000,
        },
      }),
    );
  });

  it("sends the same body for a project with no alert and no capacity snapshot", async () => {
    await addProject("project", "100");
    expect(await answer()).toBe(
      '{"events":[],"hasMore":false,"checkedAt":1700000000000,"capacity":null}',
    );
  });

  it("reads the three tables in one round trip", async () => {
    await seedFixture();
    const measured = measureD1(database);
    await operationsStatus({ database: measured.database, ...status });
    expect(measured.roundTrips()).toBe(1);
  });

  it("reads the same rows as the three separate reads and writes none", async () => {
    await seedFixture();
    const measured = measureD1(database);
    await operationsStatus({ database: measured.database, ...status });
    measured.report("operations-status");
    // Measured on main, where the three reads ran one at a time: 1, 7, and 1 rows.
    expect(measured.totals()).toEqual({ rows_read: 9, rows_written: 0 });
  });

  it("refuses a database with no project, another project, or another repository", async () => {
    const refusal = {
      code: "operations_configuration",
      status: 503,
      message: "Operation alerts require one matching configured project and repository.",
    };
    const read = async (input: typeof status) => {
      const error = await operationsStatus({ database, ...input }).catch((reason) => reason);
      expect(error).toBeInstanceOf(SecurityError);
      expect(error).toMatchObject(refusal);
    };
    await read(status);
    await addProject("project", "100");
    await read({ ...status, repositoryId: "other" });
    await read({ ...status, projectId: "other" });
    await addProject("second", "200");
    await read(status);
  });

  it.each([
    ["projects", "SELECT id,repository_id"],
    ["alerts", "SELECT kind,code"],
    ["capacity snapshot", "SELECT value FROM operations_cursors"],
  ])("fails with the error of D1 when the read of the %s fails", async (_name, start) => {
    await seedFixture();
    await expect(operationsStatus({ database: failingRead(start), ...status })).rejects.toThrow(
      "no such table: missing_table",
    );
  });
});
