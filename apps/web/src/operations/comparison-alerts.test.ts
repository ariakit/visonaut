import { describe, expect, it } from "vitest";
import { claimWork, completeWork, enqueueWork, reconcileWork } from "@visonaut/service";
import { context, TestDatabase } from "./test-fixtures.ts";
import { reportComparisonRecovery } from "./comparison-alerts.ts";
const noFinalization = { completed: [], errors: [] };
const receiptLifetime = (14 * 24 + 1) * 60 * 60 * 1000;
function comparison(database: TestDatabase, id: string) {
  database.connection
    .prepare(
      "INSERT OR IGNORE INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','123','policy')",
    )
    .run();
  database.connection
    .prepare(
      "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,comparison_id,created_at) VALUES(?,'project',?,1,'pull_request','sha',?,'plan','{}',?,0)",
    )
    .run(id, id, id, id);
  database.connection
    .prepare(
      "INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,created_at) VALUES(?,?,0,'policy',1,0)",
    )
    .run(id, id);
  database.connection
    .prepare(
      "INSERT INTO visonaut_comparison_rows(id,comparison_id,item_key,variant_key,ordinal,tuple_json) VALUES(?,?,'item','variant',0,'{}')",
    )
    .run(`${id}:row`, id);
}
function unresolved(database: TestDatabase) {
  return database.connection
    .prepare(
      "SELECT kind,subject_id AS subject FROM operations_events WHERE resolved_at IS NULL ORDER BY kind,subject",
    )
    .all();
}
describe("comparison recovery alerts", () => {
  it("retains historical failures on inactive runs until an exact later recomparison succeeds", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    comparison(database, "historical");
    database.connection.exec(
      "UPDATE visonaut_runs SET active=0,comparison_id=NULL WHERE id='historical'; UPDATE visonaut_comparisons SET purpose='historical' WHERE id='historical'",
    );
    await enqueueWork(database, {
      id: "historical:row",
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now: fixture.state.time,
    });
    database.connection.exec(
      "UPDATE work_tasks SET state='dead',attempts=3 WHERE id='historical:row'",
    );
    await reportComparisonRecovery(fixture.context, {
      completed: [],
      errors: [{ comparisonId: "historical" }],
    });
    await reportComparisonRecovery(fixture.context, noFinalization);
    expect(unresolved(database)).toEqual([
      { kind: "comparison-finalization", subject: "historical" },
      { kind: "comparison-task", subject: "historical" },
    ]);
    database.connection.exec(
      "UPDATE visonaut_comparisons SET state='invalidated' WHERE id='historical'",
    );
    database.connection.exec(
      "INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,created_at,purpose,state) VALUES('different','historical',0,'different-policy',2,1,'historical','ready')",
    );
    await reportComparisonRecovery(fixture.context, noFinalization);
    expect(unresolved(database)).toHaveLength(2);
    database.connection.exec(
      "INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,created_at,purpose,state) VALUES('recovered','historical',0,'policy',3,2,'historical','ready')",
    );
    await reportComparisonRecovery(fixture.context, noFinalization);
    await reportComparisonRecovery(fixture.context, noFinalization);
    expect(unresolved(database)).toEqual([]);
    expect(
      database.connection
        .prepare("SELECT state FROM visonaut_comparisons WHERE id='historical'")
        .get()?.state,
    ).toBe("invalidated");
  });
  it("resolves finalized subjects between pages without clearing other finalization errors", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    comparison(database, "ready");
    comparison(database, "still-failing");
    await reportComparisonRecovery(fixture.context, {
      completed: [],
      errors: [{ comparisonId: "ready" }, { comparisonId: "still-failing" }],
    });
    database.connection
      .prepare("UPDATE visonaut_comparisons SET state='ready' WHERE id='ready'")
      .run();
    fixture.context.budget.tasksPerStep = 1;
    await reportComparisonRecovery(fixture.context, noFinalization);
    expect(unresolved(database)).toEqual([
      { kind: "comparison-finalization", subject: "still-failing" },
    ]);
  });
  it("keeps exhausted task failures until the comparison is explicitly superseded", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    comparison(database, "dead");
    await enqueueWork(database, {
      id: "dead:row",
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now: fixture.state.time,
    });
    database.connection
      .prepare(
        "UPDATE work_tasks SET state='dead',attempts=3,last_error='injected-failure' WHERE id='dead:row'",
      )
      .run();
    await reportComparisonRecovery(fixture.context, noFinalization);
    await reportComparisonRecovery(fixture.context, noFinalization);
    expect(unresolved(database)).toEqual([{ kind: "comparison-task", subject: "dead" }]);
    expect(
      database.connection
        .prepare("SELECT occurrences FROM operations_events WHERE kind='comparison-task'")
        .get()?.occurrences,
    ).toBe(1);
    database.connection
      .prepare("UPDATE visonaut_runs SET comparison_id='new-comparison' WHERE id='dead'")
      .run();
    await reportComparisonRecovery(fixture.context, noFinalization);
    expect(unresolved(database)).toEqual([]);
    expect(
      database.connection
        .prepare("SELECT state,attempts FROM work_tasks WHERE id='dead:row'")
        .get(),
    ).toEqual({ state: "dead", attempts: 3 });
  });
  it("does not report a final lease that expires after review invalidation", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    comparison(database, "expired-review");
    await enqueueWork(database, {
      id: "expired-review:row",
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now: fixture.state.time,
    });
    database.connection
      .prepare(
        "UPDATE work_tasks SET state='leased', attempts=3, lease_token='worker', lease_until=? WHERE id='expired-review:row'",
      )
      .run(fixture.state.time);
    database.connection
      .prepare("UPDATE visonaut_comparisons SET state='invalidated' WHERE id='expired-review'")
      .run();
    await reconcileWork(database, {
      now: fixture.state.time,
      limit: 1,
      kind: "compare",
      publish: async () => {},
    });
    await reportComparisonRecovery(fixture.context, noFinalization);
    expect(unresolved(database)).toEqual([]);
  });
  it("resolves an exhausted review alert after invalidation", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    comparison(database, "failed-review");
    await enqueueWork(database, {
      id: "failed-review:row",
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now: fixture.state.time,
    });
    database.connection
      .prepare("UPDATE work_tasks SET state='dead', attempts=3 WHERE id='failed-review:row'")
      .run();
    await reportComparisonRecovery(fixture.context, noFinalization);
    expect(unresolved(database)).toEqual([{ kind: "comparison-task", subject: "failed-review" }]);
    database.connection
      .prepare("UPDATE visonaut_comparisons SET state='invalidated' WHERE id='failed-review'")
      .run();
    await reportComparisonRecovery(fixture.context, noFinalization);
    expect(unresolved(database)).toEqual([]);
  });
});

it.each([3582, 35820])("pages a %i-row current comparison under the Queue cap", async (total) => {
  using database = new TestDatabase();
  const fixture = context(database);
  comparison(database, "bulk");
  database.connection.prepare("DELETE FROM visonaut_comparison_rows WHERE id='bulk:row'").run();
  database.connection
    .prepare(`WITH RECURSIVE sequence(number) AS (
      SELECT 0 UNION ALL SELECT number + 1 FROM sequence WHERE number + 1 < ?
    ) INSERT INTO visonaut_comparison_rows
      (id,comparison_id,item_key,variant_key,ordinal,tuple_json)
      SELECT printf('bulk:%05d',number),'bulk',printf('item/%05d',number),
        'variant',number,'{}' FROM sequence`)
    .run(total);
  database.connection
    .prepare(`INSERT INTO work_tasks
      (id,kind,payload,max_attempts,available_at,created_at,updated_at)
      SELECT id,'compare','{}',3,?,?,? FROM visonaut_comparison_rows
      WHERE comparison_id='bulk'`)
    .run(fixture.state.time, fixture.state.time, fixture.state.time);
  const sent: string[] = [];
  const publish = async (id: string) => {
    sent.push(id);
  };
  const input = {
    now: fixture.state.time,
    limit: total,
    maxOutstanding: 64,
    kind: "compare" as const,
    publish,
  };
  const first = await reconcileWork(database, input);
  const second = await reconcileWork(database, input);
  const throttled = await reconcileWork(database, input);
  expect(first.published).toHaveLength(32);
  expect(first.hasMore).toBe(true);
  expect(second.published).toHaveLength(32);
  expect(second.hasMore).toBe(false);
  expect(throttled).toEqual({ published: [], failed: [], hasMore: false });
  expect(new Set(sent).size).toBe(64);
  expect(
    (
      await reconcileWork(database, {
        ...input,
        now: fixture.state.time + 4 * 60 * 60 * 1000,
      })
    ).published,
  ).toEqual([]);
  database.connection
    .prepare(
      "UPDATE work_tasks SET state='complete' WHERE id IN (SELECT id FROM work_tasks WHERE published_at IS NOT NULL ORDER BY id LIMIT 32)",
    )
    .run();
  expect(
    (
      await reconcileWork(database, {
        ...input,
        now: input.now + 4 * 60 * 60 * 1000 + 1,
      })
    ).published,
  ).toHaveLength(32);
  expect(new Set(sent).size).toBe(96);
});

it("republishes a dead-lettered delivery after its bounded receipt expires", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const now = fixture.state.time;
  comparison(database, "dropped");
  await enqueueWork(database, {
    id: "dropped:row",
    kind: "compare",
    payload: "{}",
    maxAttempts: 3,
    now,
  });
  const sent: string[] = [];
  const input = {
    limit: 10,
    maxOutstanding: 1,
    kind: "compare" as const,
    publish: async (id: string) => {
      sent.push(id);
    },
  };
  expect((await reconcileWork(database, { ...input, now })).published).toEqual(["dropped:row"]);
  // Five Queue retries end in the DLQ without a consumer claim; D1 remains queued.
  expect(
    (await reconcileWork(database, { ...input, now: now + 4 * 60 * 60 * 1000 })).published,
  ).toEqual([]);
  expect(
    (await reconcileWork(database, { ...input, now: now + receiptLifetime - 1 })).published,
  ).toEqual([]);
  expect(
    (await reconcileWork(database, { ...input, now: now + receiptLifetime })).published,
  ).toEqual(["dropped:row"]);
  expect(sent).toEqual(["dropped:row", "dropped:row"]);
  expect(
    await database
      .prepare("SELECT publication_due_at AS due FROM work_tasks WHERE id='dropped:row'")
      .first(),
  ).toEqual({ due: now + receiptLifetime * 2 });
  const claim = await claimWork(database, {
    id: "dropped:row",
    token: "delivered",
    now: now + receiptLifetime + 1,
    leaseMs: 100,
  });
  expect(claim?.id).toBe("dropped:row");
  expect(
    await completeWork(database, {
      id: "dropped:row",
      token: "delivered",
      now: now + receiptLifetime + 2,
      result: "changed",
    }),
  ).toBe(true);
  expect(
    (await reconcileWork(database, { ...input, now: now + receiptLifetime * 4 })).published,
  ).toEqual([]);
});
