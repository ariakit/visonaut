import { describe, expect, it } from "vitest";
import { context, TestDatabase } from "./test-fixtures.ts";
import { reportComparisonRecovery } from "./comparison-alerts.ts";
const noFinalization = { completed: [], errors: [] };
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
    await reportComparisonRecovery(fixture.context, {
      completed: [],
      errors: [{ comparisonId: "historical" }],
    });
    await reportComparisonRecovery(fixture.context, noFinalization);
    expect(unresolved(database)).toEqual([
      { kind: "comparison-finalization", subject: "historical" },
    ]);
    database.connection.exec(
      "UPDATE visonaut_comparisons SET state='invalidated' WHERE id='historical'",
    );
    database.connection.exec(
      "INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,created_at,purpose,state) VALUES('different','historical',0,'different-policy',2,1,'historical','ready')",
    );
    await reportComparisonRecovery(fixture.context, noFinalization);
    expect(unresolved(database)).toHaveLength(1);
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
  it("keeps a review finalization alert until the comparison is explicitly superseded", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    comparison(database, "superseded");
    await reportComparisonRecovery(fixture.context, {
      completed: [],
      errors: [{ comparisonId: "superseded" }],
    });
    await reportComparisonRecovery(fixture.context, noFinalization);
    expect(unresolved(database)).toEqual([
      { kind: "comparison-finalization", subject: "superseded" },
    ]);
    database.connection
      .prepare("UPDATE visonaut_runs SET comparison_id='new-comparison' WHERE id='superseded'")
      .run();
    await reportComparisonRecovery(fixture.context, noFinalization);
    expect(unresolved(database)).toEqual([]);
  });
  it("resolves a review finalization alert after invalidation", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    comparison(database, "failed-review");
    await reportComparisonRecovery(fixture.context, {
      completed: [],
      errors: [{ comparisonId: "failed-review" }],
    });
    expect(unresolved(database)).toEqual([
      { kind: "comparison-finalization", subject: "failed-review" },
    ]);
    database.connection
      .prepare("UPDATE visonaut_comparisons SET state='invalidated' WHERE id='failed-review'")
      .run();
    await reportComparisonRecovery(fixture.context, noFinalization);
    expect(unresolved(database)).toEqual([]);
  });
});
