import { afterEach, describe, expect, it, vi } from "vitest";
import { Service, type ReserveRunParams } from "@visonaut/service";
import { TestDatabase, context, reserve } from "./operations/test-fixtures.ts";
import { checkRunAdmission, monitorDatabaseCapacity, type CapacityPolicy } from "./capacity.ts";

const policy: CapacityPolicy = {
  databaseWarningBytes: 1000,
  databaseAdmissionBytes: 2000,
  maximumActiveRuns: 1,
};
const identity = { projectId: "project", externalRunId: "new", attempt: 1 };
function measure(database: TestDatabase, bytes: number | undefined) {
  const prepare = database.prepare.bind(database);
  return vi.spyOn(database, "prepare").mockImplementation((sql) => {
    const statement = prepare(sql);
    if (sql.includes("AS active_runs")) {
      const all = statement.all.bind(statement);
      statement.all = async <T>() => ({ ...(await all<T>()), meta: { size_after: bytes } });
    }
    return statement;
  });
}
afterEach(() => vi.restoreAllMocks());

describe("database capacity admission", () => {
  it("uses a fresh physical sample to admit a new run", async () => {
    using database = new TestDatabase();
    measure(database, 500);
    await expect(checkRunAdmission(database, policy, identity, 1)).resolves.toEqual({
      maximumActiveRuns: 1,
    });
    expect(await monitorDatabaseCapacity(database, policy, 2)).toMatchObject({
      databaseBytes: 500,
      activeRuns: 0,
    });
    const saved = await database
      .prepare("SELECT value FROM operations_cursors WHERE id='database-capacity'")
      .first<{ value: string }>();
    expect(saved && JSON.parse(saved.value)).toMatchObject({
      observedAt: 2,
      databaseAdmissionBytes: 2000,
    });
  });
  it("warns before admission pauses and resolves the warning after measured recovery", async () => {
    using database = new TestDatabase();
    const sample = measure(database, 1500);
    await checkRunAdmission(database, policy, identity, 1);
    expect(
      await database
        .prepare("SELECT code FROM operations_events WHERE resolved_at IS NULL")
        .first(),
    ).toEqual({ code: "headroom-warning" });
    sample.mockRestore();
    measure(database, 500);
    await monitorDatabaseCapacity(database, policy, 2);
    expect(
      await database
        .prepare("SELECT code FROM operations_events WHERE resolved_at IS NULL")
        .first(),
    ).toBeNull();
  });
  it("refuses new runs at the physical threshold and records the private alert", async () => {
    using database = new TestDatabase();
    measure(database, 2000);
    await expect(checkRunAdmission(database, policy, identity, 3)).rejects.toMatchObject({
      status: 503,
      code: "capacity_exceeded",
    });
    expect(
      await database
        .prepare("SELECT code FROM operations_events WHERE resolved_at IS NULL")
        .first(),
    ).toEqual({ code: "admission-blocked" });
  });
  it("does not block on the size of an old SQL backup", async () => {
    using database = new TestDatabase();
    measure(database, 500);
    database.connection.exec(
      "INSERT INTO operations_backups(id,state,database_bytes,created_at,completed_at) VALUES('2026-09-22','complete',2000,1,2)",
    );
    const stalePolicy = { ...policy, sqlWarningBytes: 1000, sqlAdmissionBytes: 2000 };
    await expect(checkRunAdmission(database, stalePolicy, identity, 3)).resolves.toEqual({
      maximumActiveRuns: 1,
    });
    expect(
      await database
        .prepare("SELECT code FROM operations_events WHERE resolved_at IS NULL")
        .first(),
    ).toBeNull();
  });
  it("refuses an unknown physical sample while preserving an existing run's retry", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context, "existing");
    measure(database, undefined);
    await expect(checkRunAdmission(database, policy, identity, 3)).rejects.toMatchObject({
      status: 503,
      code: "capacity_unavailable",
    });
    await expect(
      checkRunAdmission(database, policy, { ...identity, externalRunId: "existing" }, 4),
    ).resolves.toEqual({ maximumActiveRuns: 1 });
  });
  it("does not count ready reviews, but does count upload and comparison work", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    measure(database, 500);
    await expect(checkRunAdmission(database, policy, identity, 1)).rejects.toMatchObject({
      code: "capacity_exceeded",
    });
    database.connection.exec("UPDATE visonaut_runs SET state='reviewing',sealed_at=1");
    await expect(checkRunAdmission(database, policy, identity, 2)).resolves.toEqual({
      maximumActiveRuns: 1,
    });
    database.connection.exec("UPDATE visonaut_runs SET state='comparing'");
    await expect(checkRunAdmission(database, policy, identity, 3)).rejects.toMatchObject({
      code: "capacity_exceeded",
    });
  });
  it("keeps the new-run slot guard in the reservation transaction and exempts identity replays", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await reserve(fixture.context, "existing");
    database.connection.exec("UPDATE visonaut_runs SET state='reviewing',sealed_at=1");
    const params: ReserveRunParams = {
      ...identity,
      id: "new",
      kind: "main",
      testedSha: "b".repeat(40),
      lineageKey: "main",
      plan: {
        digest: "new-plan",
        shards: [
          {
            key: "one",
            profileDigest: "profile",
            tests: ["test"],
            captures: [{ testId: "test", itemKey: "item", variantKey: "variant" }],
          },
        ],
      },
      verifiedRelatedRunIds: [],
      verifiedAncestorShas: [],
      verificationDigest: "proof",
      rerunShardKeys: ["one"],
      now: 1,
      maximumActiveRuns: 1,
    };
    await service.reserveRun(params);
    await expect(
      service.reserveRun({ ...params, id: "second", externalRunId: "second" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await database.prepare("SELECT id FROM visonaut_runs WHERE id='second'").first(),
    ).toBeNull();
    await expect(new Service(database).reserveRun(params)).resolves.toMatchObject({ id: "new" });
  });
});
