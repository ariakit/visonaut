import { SecurityError } from "@visonaut/security";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { deadReviewTaskAgeMilliseconds, operationsStatus } from "./operations.ts";
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
const status = { projectId: "project", repositoryId: "100", captureLimit: 40_000 };

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

async function addTask(
  id: string,
  kind: string,
  state: string,
  updatedAt: number,
  lastError: string | null = null,
) {
  await database
    .prepare(
      "INSERT INTO work_tasks(id,kind,payload,state,attempts,max_attempts,available_at,created_at,updated_at,last_error) VALUES(?,?,'{}',?,5,5,0,0,?,?)",
    )
    .bind(id, kind, state, updatedAt, lastError)
    .run();
}

async function addRun(id: string, active: number, captureCount: number | null) {
  await database
    .prepare(
      "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,created_at,active,state,capture_count) VALUES(?,'project',?,1,'main','sha','main','plan','{}',1,?,'uploading',?)",
    )
    .bind(id, id, active, captureCount)
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
    database.prepare("DELETE FROM work_tasks"),
    database.prepare("DELETE FROM visonaut_runs"),
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
        deadReviewTasks: { count: 0, newestAt: null },
        captures: null,
      }),
    );
  });

  it("sends the same body for a project with no alert and no capacity snapshot", async () => {
    await addProject("project", "100");
    expect(await answer()).toBe(
      '{"events":[],"hasMore":false,"checkedAt":1700000000000,"capacity":null,"deadReviewTasks":{"count":0,"newestAt":null},"captures":null}',
    );
  });

  it("reads the five tables in one round trip", async () => {
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
    // The two new reads find no task and no run, and they read 0 and 2 rows.
    expect(measured.totals()).toEqual({ rows_read: 11, rows_written: 0 });
  });

  it("lists the review tasks in the state dead that are younger than the age limit", async () => {
    await addProject("project", "100");
    const cutoff = checkedAt - deadReviewTaskAgeMilliseconds;
    await addTask("old", "review", "dead", cutoff - 1);
    await addTask("edge", "review", "dead", cutoff);
    await addTask("new", "review", "dead", checkedAt - 5);
    await addTask("queued", "review", "queued", checkedAt - 5);
    await addTask("compare", "compare", "dead", checkedAt - 5);
    // A restore ends each unfinished task. That is not a decision that failed.
    await addTask("restored", "review", "dead", checkedAt - 5, "restored-environment");
    expect(await operationsStatus({ database, ...status })).toMatchObject({
      deadReviewTasks: { count: 2, newestAt: checkedAt - 5 },
    });
  });

  it("gives the largest capture count of the newest runs with the capture limit", async () => {
    await addProject("project", "100");
    await addRun("unknown", 1, null);
    await addRun("closed", 0, 3_832);
    await addRun("small", 1, 12);
    expect((await operationsStatus({ database, ...status })).captures).toEqual({
      runId: "closed",
      count: 3_832,
      limit: 40_000,
    });
  });

  it("reads the newest 20 runs that have a count and no older run", async () => {
    await addProject("project", "100");
    for (let index = 0; index < 100; index++) {
      await addRun(`old-${index}`, 1, 39_000);
    }
    // 25 newer runs: every fifth has no count yet, and every third is not active.
    for (let index = 0; index < 25; index++) {
      const count = index % 5 === 4 ? null : 100 + index;
      await addRun(`run-${String(index).padStart(2, "0")}`, index % 3 === 0 ? 0 : 1, count);
    }
    const measured = measureD1(database);
    const read = await operationsStatus({ database: measured.database, ...status });
    expect(read.captures).toEqual({ runId: "run-23", count: 123, limit: 40_000 });
    // The read takes the 25 newest rows and sorts 20. It does not scan the 125 runs.
    const cost = measured.costs.find((entry) => entry.sql.includes("FROM visonaut_runs"));
    expect(cost?.rows_read).toBeLessThanOrEqual(50);
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
    ["dead review tasks", "SELECT COUNT(*)"],
    ["capture count", "SELECT id AS runId"],
  ])("fails with the error of D1 when the read of the %s fails", async (_name, start) => {
    await seedFixture();
    await expect(operationsStatus({ database: failingRead(start), ...status })).rejects.toThrow(
      "no such table: missing_table",
    );
  });
});
