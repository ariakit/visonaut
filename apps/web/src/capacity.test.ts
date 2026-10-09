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
function newRun(overrides: Partial<ReserveRunParams>): ReserveRunParams {
  return {
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
    ...overrides,
  };
}
afterEach(() => vi.restoreAllMocks());

/** The rows that only the scheduled pass can write. */
async function stored(database: TestDatabase) {
  const snapshot = await database
    .prepare("SELECT value FROM operations_cursors WHERE id='database-capacity'")
    .first<{ value: string }>();
  const events = await database
    .prepare("SELECT code FROM operations_events WHERE resolved_at IS NULL")
    .all<{ code: string }>();
  return {
    snapshot: snapshot ? JSON.parse(snapshot.value) : null,
    alerts: events.results?.map((event) => event.code),
  };
}

describe("database capacity admission", () => {
  it("uses a fresh physical sample to admit a new run and stores nothing", async () => {
    using database = new TestDatabase();
    measure(database, 500);
    await expect(checkRunAdmission(database, policy, identity)).resolves.toEqual({
      maximumActiveRuns: 1,
    });
    expect(await stored(database)).toEqual({ snapshot: null, alerts: [] });
    expect(await monitorDatabaseCapacity(database, policy, 2)).toMatchObject({
      databaseBytes: 500,
      activeRuns: 0,
    });
    expect(await stored(database)).toMatchObject({
      snapshot: { observedAt: 2, databaseAdmissionBytes: 2000 },
      alerts: [],
    });
  });
  it("warns before admission pauses and resolves the warning after measured recovery", async () => {
    using database = new TestDatabase();
    const sample = measure(database, 1500);
    await checkRunAdmission(database, policy, identity);
    expect(await stored(database)).toEqual({ snapshot: null, alerts: [] });
    await monitorDatabaseCapacity(database, policy, 1);
    expect((await stored(database)).alerts).toEqual(["headroom-warning"]);
    sample.mockRestore();
    measure(database, 500);
    await checkRunAdmission(database, policy, identity);
    expect((await stored(database)).alerts).toEqual(["headroom-warning"]);
    await monitorDatabaseCapacity(database, policy, 2);
    expect((await stored(database)).alerts).toEqual([]);
  });
  it("refuses new runs at the size limit with its own code and leaves the alert to the scheduled pass", async () => {
    using database = new TestDatabase();
    measure(database, 2000);
    await expect(checkRunAdmission(database, policy, identity)).rejects.toMatchObject({
      status: 503,
      code: "database_size_exceeded",
    });
    expect(await stored(database)).toEqual({ snapshot: null, alerts: [] });
    await monitorDatabaseCapacity(database, policy, 4);
    expect(await stored(database)).toMatchObject({
      snapshot: { observedAt: 4, databaseBytes: 2000 },
      alerts: ["admission-blocked"],
    });
  });
  it("does not block on the size of an old SQL backup", async () => {
    using database = new TestDatabase();
    measure(database, 500);
    database.connection.exec(
      "INSERT INTO operations_backups(id,state,database_bytes,created_at,completed_at) VALUES('2026-09-22','complete',2000,1,2)",
    );
    const stalePolicy = { ...policy, sqlWarningBytes: 1000, sqlAdmissionBytes: 2000 };
    await expect(checkRunAdmission(database, stalePolicy, identity)).resolves.toEqual({
      maximumActiveRuns: 1,
    });
    await monitorDatabaseCapacity(database, stalePolicy, 4);
    expect((await stored(database)).alerts).toEqual([]);
  });
  it("refuses an unknown physical sample while preserving an existing run's retry", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context, "existing");
    measure(database, undefined);
    await expect(checkRunAdmission(database, policy, identity)).rejects.toMatchObject({
      status: 503,
      code: "capacity_unavailable",
    });
    expect(await stored(database)).toEqual({ snapshot: null, alerts: [] });
    await expect(monitorDatabaseCapacity(database, policy, 4)).rejects.toMatchObject({
      code: "capacity_unavailable",
    });
    expect((await stored(database)).alerts).toEqual(["measurement-unavailable"]);
    await expect(
      checkRunAdmission(database, policy, { ...identity, externalRunId: "existing" }),
    ).resolves.toEqual({ maximumActiveRuns: 1 });
  });
  it("does not count ready reviews, but does count upload and comparison work", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    measure(database, 500);
    await expect(checkRunAdmission(database, policy, identity)).rejects.toMatchObject({
      status: 503,
      code: "capacity_exceeded",
    });
    expect(await stored(database)).toEqual({ snapshot: null, alerts: [] });
    await monitorDatabaseCapacity(database, policy, 1);
    expect(await stored(database)).toMatchObject({
      snapshot: { activeRuns: 1 },
      alerts: ["admission-blocked"],
    });
    database.connection.exec("UPDATE visonaut_runs SET state='reviewing',sealed_at=1");
    await expect(checkRunAdmission(database, policy, identity)).resolves.toEqual({
      maximumActiveRuns: 1,
    });
    database.connection.exec("UPDATE visonaut_runs SET state='comparing'");
    await expect(checkRunAdmission(database, policy, identity)).rejects.toMatchObject({
      code: "capacity_exceeded",
    });
  });
  it("names the size limit when the limit of active runs applies too", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    measure(database, 2000);
    await expect(checkRunAdmission(database, policy, identity)).rejects.toMatchObject({
      status: 503,
      code: "database_size_exceeded",
    });
  });
  it("keeps the new-run slot guard in the reservation transaction and exempts identity replays", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await reserve(fixture.context, "existing");
    database.connection.exec("UPDATE visonaut_runs SET state='reviewing',sealed_at=1");
    const params = newRun({ maximumActiveRuns: 1 });
    await service.reserveRun(params);
    await expect(
      service.reserveRun({ ...params, id: "second", externalRunId: "second" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await database.prepare("SELECT id FROM visonaut_runs WHERE id='second'").first(),
    ).toBeNull();
    await expect(new Service(database).reserveRun(params)).resolves.toMatchObject({ id: "new" });
  });
  it("passes two checks for the last free slot, and the reservation transaction admits one run", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = await reserve(fixture.context, "existing");
    measure(database, 500);
    const twoSlots = { ...policy, maximumActiveRuns: 2 };
    const second = { ...identity, externalRunId: "second" };
    // A check stores nothing, so it cannot see another check for the same slot.
    await expect(
      Promise.all([
        checkRunAdmission(database, twoSlots, identity),
        checkRunAdmission(database, twoSlots, second),
      ]),
    ).resolves.toEqual([{ maximumActiveRuns: 2 }, { maximumActiveRuns: 2 }]);
    const params = newRun({ maximumActiveRuns: 2 });
    await service.reserveRun(params);
    await expect(service.reserveRun({ ...params, ...second, id: "second" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      await database
        .prepare(
          "SELECT COUNT(*) AS count FROM visonaut_runs WHERE active=1 AND state IN ('uploading','comparing')",
        )
        .first(),
    ).toEqual({ count: 2 });
    await expect(checkRunAdmission(database, twoSlots, second)).rejects.toMatchObject({
      code: "capacity_exceeded",
    });
  });
});
