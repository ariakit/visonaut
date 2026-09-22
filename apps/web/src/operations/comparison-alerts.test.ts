import { describe, expect, it } from "vitest";
import { enqueueWork } from "@ariviso/service";
import { context, TestDatabase } from "./test-fixtures.ts";
import { reportComparisonRecovery } from "./comparison-alerts.ts";
const noPublication = { published: [], failed: [] };
const noFinalization = { completed: [], errors: [] };
function comparison(database: TestDatabase, id: string) {
  database.connection
    .prepare(
      "INSERT OR IGNORE INTO ariviso_projects(id,repository_id,policy_digest) VALUES('project','123','policy')",
    )
    .run();
  database.connection
    .prepare(
      "INSERT INTO ariviso_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,comparison_id,created_at) VALUES(?,'project',?,1,'pull_request','sha',?,'plan','{}',?,0)",
    )
    .run(id, id, id, id);
  database.connection
    .prepare(
      "INSERT INTO ariviso_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,created_at) VALUES(?,?,0,'policy',1,0)",
    )
    .run(id, id);
  database.connection
    .prepare(
      "INSERT INTO ariviso_comparison_rows(id,comparison_id,item_key,variant_key,ordinal,tuple_json) VALUES(?,?,'item','variant',0,'{}')",
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
  it.each(["review", "historical"])(
    "uses only a ready %s archive receipt after completed task pruning",
    async (purpose) => {
      using database = new TestDatabase();
      const fixture = context(database);
      const id = `receipt-${purpose}`;
      comparison(database, id);
      database.connection
        .prepare("UPDATE ariviso_comparisons SET purpose=? WHERE id=?")
        .run(purpose, id);
      await enqueueWork(database, {
        id: `${id}:row`,
        kind: "compare",
        payload: "{}",
        maxAttempts: 3,
        now: fixture.state.time,
      });
      await reportComparisonRecovery(
        fixture.context,
        { published: [], failed: [`${id}:row`, `${id}-lookalike:row`] },
        noFinalization,
      );
      // A consumer completes after the scheduler read; the archive then prunes its task.
      database.connection
        .prepare("UPDATE work_tasks SET state='complete',attempts=1,updated_at=? WHERE id=?")
        .run(fixture.state.time + 1, `${id}:row`);
      database.connection
        .prepare("UPDATE ariviso_comparisons SET state='ready' WHERE id=?")
        .run(id);
      database.connection.prepare("DELETE FROM work_tasks WHERE id=?").run(`${id}:row`);
      database.connection
        .prepare("DELETE FROM ariviso_comparison_rows WHERE comparison_id=?")
        .run(id);
      database.connection
        .prepare(
          "INSERT INTO operations_run_archives(run_id,generation,state,source_revision,project_revision,object_key,progress_json,created_at,digest,bytes,verified_at) VALUES(?,'fixture','ready',0,0,?,'{}',0,'digest',1,1)",
        )
        .run(id, `history/${id}`);
      if (purpose === "historical") {
        await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
        expect(unresolved(database)).toHaveLength(2);
        database.connection
          .prepare(
            "INSERT INTO operations_comparison_archives(comparison_id,run_id,generation,state,created_at) VALUES(?,?,'fixture','building',0)",
          )
          .run(id, id);
        await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
        expect(unresolved(database)).toHaveLength(2);
        database.connection
          .prepare(
            "UPDATE operations_comparison_archives SET state='ready',object_key=?,digest='digest',bytes=1,page_count=1,verified_at=1 WHERE comparison_id=?",
          )
          .run(`history/comparison/${id}`, id);
      }
      await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
      expect(unresolved(database)).toEqual([
        { kind: "comparison-publication", subject: `${id}-lookalike:row` },
      ]);
    },
  );

  it("retains historical failures on inactive runs until an exact later recomparison succeeds", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    comparison(database, "historical");
    database.connection.exec(
      "UPDATE ariviso_runs SET active=0,comparison_id=NULL WHERE id='historical'; UPDATE ariviso_comparisons SET purpose='historical' WHERE id='historical'",
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
    await reportComparisonRecovery(fixture.context, noPublication, {
      completed: [],
      errors: [{ comparisonId: "historical" }],
    });
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([
      { kind: "comparison-finalization", subject: "historical" },
      { kind: "comparison-task", subject: "historical" },
    ]);
    database.connection.exec(
      "UPDATE ariviso_comparisons SET state='invalidated' WHERE id='historical'",
    );
    database.connection.exec(
      "INSERT INTO ariviso_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,created_at,purpose,state) VALUES('different','historical',0,'different-policy',2,1,'historical','ready')",
    );
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toHaveLength(2);
    database.connection.exec(
      "INSERT INTO ariviso_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,created_at,purpose,state) VALUES('recovered','historical',0,'policy',3,2,'historical','ready')",
    );
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([]);
    expect(
      database.connection
        .prepare("SELECT state FROM ariviso_comparisons WHERE id='historical'")
        .get()?.state,
    ).toBe("invalidated");
  });

  it("keeps publication failures across unrelated pages and resolves actual queue acceptance", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await enqueueWork(database, {
      id: "lost",
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now: fixture.state.time,
    });
    await reportComparisonRecovery(
      fixture.context,
      { published: [], failed: ["lost"] },
      noFinalization,
    );
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([{ kind: "comparison-publication", subject: "lost" }]);
    await reportComparisonRecovery(
      fixture.context,
      { published: ["other"], failed: [] },
      noFinalization,
    );
    expect(unresolved(database)).toHaveLength(1);
    await reportComparisonRecovery(
      fixture.context,
      { published: ["lost"], failed: [] },
      noFinalization,
    );
    expect(unresolved(database)).toEqual([]);
  });
  it("resolves finalized subjects between pages without clearing other finalization errors", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    comparison(database, "ready");
    comparison(database, "still-failing");
    await reportComparisonRecovery(fixture.context, noPublication, {
      completed: [],
      errors: [{ comparisonId: "ready" }, { comparisonId: "still-failing" }],
    });
    database.connection
      .prepare("UPDATE ariviso_comparisons SET state='ready' WHERE id='ready'")
      .run();
    fixture.context.budget.tasksPerStep = 1;
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
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
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([{ kind: "comparison-task", subject: "dead" }]);
    expect(
      database.connection
        .prepare("SELECT occurrences FROM operations_events WHERE kind='comparison-task'")
        .get()?.occurrences,
    ).toBe(1);
    database.connection
      .prepare("UPDATE ariviso_runs SET comparison_id='new-comparison' WHERE id='dead'")
      .run();
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([]);
    expect(
      database.connection
        .prepare("SELECT state,attempts FROM work_tasks WHERE id='dead:row'")
        .get(),
    ).toEqual({ state: "dead", attempts: 3 });
  });
  it("resolves ambiguous publication only after a newer durable consumer claim", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await enqueueWork(database, {
      id: "ambiguous",
      kind: "compare",
      payload: "{}",
      maxAttempts: 3,
      now: fixture.state.time,
    });
    await reportComparisonRecovery(
      fixture.context,
      { published: [], failed: ["ambiguous"] },
      noFinalization,
    );
    database.connection
      .prepare(
        "UPDATE work_tasks SET state='complete',attempts=1,updated_at=? WHERE id='ambiguous'",
      )
      .run(fixture.state.time - 1);
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toHaveLength(1);
    database.connection
      .prepare("UPDATE work_tasks SET updated_at=? WHERE id='ambiguous'")
      .run(fixture.state.time + 1);
    await reportComparisonRecovery(fixture.context, noPublication, noFinalization);
    expect(unresolved(database)).toEqual([]);
  });
});
