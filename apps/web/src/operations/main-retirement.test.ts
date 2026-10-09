import { expect, it } from "vitest";
import { dashboard } from "../api/dashboard.ts";
import { retireReplacedMainRuns } from "./main-retirement.ts";
import { runOperations } from "./index.ts";
import { captured, context, TestDatabase } from "./test-fixtures.ts";

async function replacedMainFixture(database: TestDatabase, kind: "main" | "pull_request" = "main") {
  const fixture = context(database);
  await captured(fixture.context, "old", kind);
  if (kind === "pull_request") {
    database.connection.exec("UPDATE visonaut_runs SET lineage_key='pr:7' WHERE id='old'");
  }
  await captured(fixture.context, "baseline", "main");
  database.connection
    .exec(`UPDATE visonaut_runs SET active=0,state='accepted',closed_at=1 WHERE id='baseline';
    INSERT INTO visonaut_snapshots(id,project_id,run_id,comparison_id,tested_sha,state,
      reference_eligible,prefix,created_at,storage_mode)
      SELECT 'snapshot',project_id,id,comparison_id,tested_sha,'accepted',1,'runs/baseline',1,'source'
        FROM visonaut_runs WHERE id='baseline';
    UPDATE visonaut_projects SET snapshot_id='snapshot',baseline_revision=2;
    UPDATE visonaut_comparisons SET state='invalidated' WHERE run_id='old'`);
  return fixture;
}

it.each([
  "lineage",
  "ancestry",
  "unrelated",
  "pull-request",
  "incomplete",
  "failed",
  "newer-review",
  "unaccepted",
  "current-comparison",
])("retires a replaced main review only with current accepted proof: %s", async (condition) => {
  using database = new TestDatabase();
  const fixture = await replacedMainFixture(
    database,
    condition === "pull-request" ? "pull_request" : "main",
  );
  if (condition === "ancestry") {
    database.connection.exec(`INSERT INTO visonaut_ancestry(run_id,ancestor_sha,proof_digest)
        SELECT 'baseline',tested_sha,'verified' FROM visonaut_runs WHERE id='old'`);
  } else if (condition !== "unrelated") {
    database.connection.exec("INSERT INTO visonaut_lineage VALUES('old','baseline','verified')");
  }
  if (condition === "incomplete") {
    database.connection.exec(
      "UPDATE visonaut_runs SET sealed_at=NULL,state='uploading' WHERE id='old'",
    );
  } else if (condition === "failed") {
    database.connection.exec("UPDATE visonaut_runs SET state='failed' WHERE id='old'");
  } else if (condition === "newer-review") {
    database.connection.exec("UPDATE visonaut_runs SET created_at=created_at+1 WHERE id='old'");
  } else if (condition === "unaccepted") {
    database.connection.exec(
      "UPDATE visonaut_runs SET active=1,state='reviewing' WHERE id='baseline'",
    );
  } else if (condition === "current-comparison") {
    database.connection.exec(
      "UPDATE visonaut_comparisons SET state='ready',baseline_revision=2 WHERE run_id='old'",
    );
  }
  const shouldRetire = condition === "lineage" || condition === "ancestry";
  const read = () =>
    dashboard({
      database,
      configuration: {
        projectId: "project",
        github: { repositoryId: "123", repository: "ariakit/ariakit" },
      },
    });
  const before = await read();
  if (condition !== "failed" && condition !== "current-comparison") {
    expect(before.actionable.some((run) => run.id === "old")).toBe(!shouldRetire);
  }
  const history = database.connection.prepare("SELECT * FROM visonaut_comparison_rows").all();
  const proof = database.connection.prepare("SELECT * FROM visonaut_lineage").all();
  const report = await retireReplacedMainRuns(fixture.context);
  expect(report.completed).toEqual(shouldRetire ? ["old"] : []);
  expect(database.connection.prepare("SELECT * FROM visonaut_comparison_rows").all()).toEqual(
    history,
  );
  expect(database.connection.prepare("SELECT * FROM visonaut_lineage").all()).toEqual(proof);
  expect(
    database.connection.prepare("SELECT active,state FROM visonaut_runs WHERE id='old'").get(),
  ).toEqual({
    active: shouldRetire ? 0 : 1,
    state: shouldRetire
      ? "superseded"
      : condition === "failed"
        ? "failed"
        : condition === "incomplete"
          ? "uploading"
          : "reviewing",
  });
  expect((await read()).runs.some((run) => run.id === "old")).toBe(true);
  expect(
    database.connection
      .prepare("SELECT detail_json FROM visonaut_audit WHERE run_id='old' AND action='retire'")
      .get(),
  ).toEqual(
    shouldRetire
      ? { detail_json: JSON.stringify({ replacementSnapshotId: "snapshot" }) }
      : undefined,
  );
});

it.each(["baseline", "failure"])(
  "keeps the main review active if %s changes before retirement commits",
  async (condition) => {
    using database = new TestDatabase();
    const fixture = await replacedMainFixture(database);
    database.connection.exec("INSERT INTO visonaut_lineage VALUES('old','baseline','verified')");
    database.beforeBatch = () =>
      database.connection.exec(
        condition === "baseline"
          ? "UPDATE visonaut_projects SET snapshot_id=NULL"
          : "UPDATE visonaut_runs SET state='failed' WHERE id='old'",
      );
    expect(await retireReplacedMainRuns(fixture.context)).toMatchObject({
      completed: [],
      deferred: ["old"],
    });
    expect(
      database.connection.prepare("SELECT active,state FROM visonaut_runs WHERE id='old'").get(),
    ).toEqual({ active: 1, state: condition === "failure" ? "failed" : "reviewing" });
    expect(
      database.connection.prepare("SELECT 1 FROM visonaut_audit WHERE action='retire'").get(),
    ).toBeUndefined();
  },
);

it("retires proven old main work during the ordinary recovery pass", async () => {
  using database = new TestDatabase();
  const fixture = await replacedMainFixture(database);
  database.connection.exec("INSERT INTO visonaut_lineage VALUES('old','baseline','verified')");
  const report = await runOperations(fixture.context, { kind: "recovery" });
  expect(report.reports["main-retirement"]?.completed).toEqual(["old"]);
  expect(
    database.connection
      .prepare("SELECT active,state,closed_reason FROM visonaut_runs WHERE id='old'")
      .get(),
  ).toEqual({ active: 0, state: "superseded", closed_reason: "replaced" });
});
