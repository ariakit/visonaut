import { expect, it, vi } from "vitest";
import { Service } from "@visonaut/service";
import { TestDatabase } from "../operations/test-fixtures.ts";
import { dashboard } from "./dashboard.ts";

it("keeps older live work outside the 100-run history bound and returns current titles/counts", async () => {
  using database = new TestDatabase();
  database.connection.exec("PRAGMA foreign_keys=OFF");
  database.connection
    .prepare(
      "INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,state,created_at) VALUES('comparison-0','run-0',0,'policy',0,'ready',0)",
    )
    .run();
  database.connection
    .prepare(
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','100','policy')",
    )
    .run();
  for (let index = 0; index < 101; index++) {
    database.connection
      .prepare(
        "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,state,comparison_id,created_at) VALUES(?,'project',?,1,'pull_request','sha',?,'plan','{}','reviewing',?,?)",
      )
      .run(`run-${index}`, String(index), `pr:${index + 1}`, `comparison-${index}`, index);
  }
  database.connection.prepare("UPDATE visonaut_runs SET sealed_at=1 WHERE id='run-0'").run();
  database.connection
    .prepare(
      "INSERT INTO visonaut_comparison_rows(id,comparison_id,item_key,variant_key,ordinal,tuple_json,outcome) VALUES('pending','comparison-0','item','light',0,'{}','changed')",
    )
    .run();
  database.connection
    .prepare(
      "INSERT INTO visonaut_comparison_rows(id,comparison_id,item_key,variant_key,ordinal,tuple_json,outcome,decision_id) VALUES('rejected','comparison-0','item','dark',1,'{}','changed','decision')",
    )
    .run();
  database.connection
    .prepare(
      "INSERT INTO visonaut_decisions(id,row_id,revision,verdict,kind,actor_id,tuple_json,created_at) VALUES('decision','rejected',1,'rejected','human','42','{}',0)",
    )
    .run();
  for (const [title, time] of [
    ["Old title", 1],
    ["Current title", 2],
  ] as const) {
    database.connection
      .prepare(
        "INSERT INTO github_webhook_delivery(delivery_id,event,payload_digest,payload_json,received_at,processed_at) VALUES(?,'pull_request','digest',?,?,?)",
      )
      .run(
        `delivery-${time}`,
        JSON.stringify({ repository: { id: 100 }, pull_request: { number: 1, title } }),
        time,
        time,
      );
  }
  const result = await dashboard({
    database,
    configuration: {
      projectId: "project",
      github: { repositoryId: "100", repository: "ariakit/ariakit" },
    },
  });
  expect(result.runs).toHaveLength(100);
  expect(result.runs.some((run) => run.id === "run-0")).toBe(false);
  expect(result.actionable).toHaveLength(101);
  expect(result.actionable.find((run) => run.id === "run-0")).toMatchObject({
    pullRequestNumber: 1,
    title: "Current title",
    pending: 2,
    rejected: 1,
  });
});

it("keeps closed or promoted runs in history and rejects repository configuration drift", async () => {
  using database = new TestDatabase();
  database.connection.exec("PRAGMA foreign_keys=OFF");
  database.connection
    .prepare(
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','100','policy')",
    )
    .run();
  database.connection
    .prepare(
      "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,state,comparison_id,created_at) VALUES('run','project','1',1,'main','sha','main','plan','{}','reviewing','comparison',0)",
    )
    .run();
  database.connection.prepare("UPDATE visonaut_runs SET closed_at=1 WHERE id='run'").run();
  const context = {
    database,
    configuration: {
      projectId: "project",
      github: { repositoryId: "100", repository: "ariakit/ariakit" },
    },
  };
  const closed = await dashboard(context);
  expect(closed.actionable).toEqual([]);
  expect(closed.runs).toHaveLength(1);
  database.connection.prepare("UPDATE visonaut_runs SET closed_at=NULL WHERE id='run'").run();
  database.connection
    .prepare(
      "INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,state,created_at) VALUES('comparison','run',0,'policy',0,'ready',0)",
    )
    .run();
  database.connection
    .prepare(
      "INSERT INTO visonaut_promotions(id,project_id,snapshot_id,comparison_id,baseline_revision,created_at) VALUES('promotion','project','snapshot','comparison',0,1)",
    )
    .run();
  const promoted = await dashboard(context);
  expect(promoted.actionable).toEqual([]);
  expect(promoted.runs).toHaveLength(1);
  database.connection
    .prepare("UPDATE visonaut_runs SET active=0,state='accepted',closed_at=1 WHERE id='run'")
    .run();
  const accepted = await dashboard(context);
  expect(accepted.actionable).toEqual([]);
  expect(accepted.runs[0]).toMatchObject({ state: "passed", pending: 0, rejected: 0 });
  expect(await new Service(database).status("run")).toMatchObject({
    status: "passed",
    pending: 0,
    rejected: 0,
    comparison: { id: "comparison" },
  });
  await expect(
    dashboard({
      ...context,
      configuration: {
        ...context.configuration,
        github: { ...context.configuration.github, repositoryId: "101" },
      },
    }),
  ).rejects.toMatchObject({ code: "repository_configuration" });
});

it("returns one dashboard snapshot when a newer baseline and run arrive during the read", async () => {
  using database = new TestDatabase();
  database.connection
    .prepare(
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','100','policy')",
    )
    .run();
  const insertRun = (id: string) => {
    database.connection
      .prepare(
        "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,state,created_at) VALUES(?,'project',?,1,'main','sha','main','plan','{}','uploading',0)",
      )
      .run(id, id);
  };
  insertRun("old");
  const context = {
    database,
    configuration: {
      projectId: "project",
      github: { repositoryId: "100", repository: "ariakit/ariakit" },
    },
  };
  const batch = database.batch.bind(database);
  const read = vi.spyOn(database, "batch").mockImplementationOnce(async (statements) => {
    const results = await batch(statements);
    insertRun("new");
    database.connection
      .prepare("UPDATE visonaut_projects SET baseline_revision=7 WHERE id='project'")
      .run();
    return results;
  });
  const previous = await dashboard(context);
  expect(previous.project.baselineRevision).toBe(0);
  expect(previous.runs.map((run) => run.id)).toEqual(["old"]);
  expect(read).toHaveBeenCalledTimes(1);
  const current = await dashboard(context);
  expect(current.project.baselineRevision).toBe(7);
  expect(current.runs.map((run) => run.id)).toContain("new");
});

it("uses authoritative approval eligibility and labels passed, rejected and invalid copied decisions", async () => {
  using database = new TestDatabase();
  database.connection.exec("PRAGMA foreign_keys=OFF");
  database.connection
    .prepare(
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','100','policy')",
    )
    .run();
  const cases = [
    { id: "approved", verdict: "approved", owner: "approved", tuple: "{}" },
    { id: "valid-copy", verdict: "approved", owner: "valid-copy", tuple: "{}" },
    { id: "rejected", verdict: "rejected", owner: "rejected", tuple: "{}" },
    { id: "invalid-copy", verdict: "approved", owner: "source", tuple: "{}" },
    { id: "wrong-tuple", verdict: "approved", owner: "wrong-tuple", tuple: '{"different":true}' },
  ];
  for (const entry of cases) {
    database.connection
      .prepare(
        "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,state,comparison_id,sealed_at,created_at) VALUES(?,'project',?,1,'pull_request','sha','pr:1','plan','{}','reviewing',?,1,0)",
      )
      .run(entry.id, entry.id, entry.id);
    database.connection
      .prepare(
        "INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,state,created_at) VALUES(?,?,0,'policy',0,'ready',0)",
      )
      .run(entry.id, entry.id);
    database.connection
      .prepare(
        "INSERT INTO visonaut_comparison_rows(id,comparison_id,item_key,variant_key,ordinal,tuple_json,outcome,decision_id) VALUES(?,?,'item','light',0,'{}','changed',?)",
      )
      .run(entry.id, entry.id, `decision-${entry.id}`);
    database.connection
      .prepare(
        "INSERT INTO visonaut_decisions(id,row_id,revision,verdict,kind,actor_id,tuple_json,created_at) VALUES(?,?,1,?,'human','42',?,0)",
      )
      .run(`decision-${entry.id}`, entry.owner, entry.verdict, entry.tuple);
  }
  database.connection
    .prepare(
      "INSERT INTO visonaut_decisions(id,row_id,revision,verdict,kind,tuple_json,revoked,created_at) VALUES('revoked-source','source',2,'approved','automatic','{}',1,0)",
    )
    .run();
  database.connection
    .prepare(
      "UPDATE visonaut_decisions SET source_decision_id='revoked-source' WHERE id='decision-valid-copy'",
    )
    .run();
  const result = await dashboard({
    database,
    configuration: {
      projectId: "project",
      github: { repositoryId: "100", repository: "ariakit/ariakit" },
    },
  });
  expect(result.runs.find((run) => run.id === "approved")).toMatchObject({
    state: "passed",
    pending: 0,
    rejected: 0,
  });
  expect(result.actionable.map((run) => run.id)).not.toContain("approved");
  expect(result.runs.find((run) => run.id === "valid-copy")).toMatchObject({
    state: "passed",
    pending: 0,
    rejected: 0,
  });
  expect(result.actionable.map((run) => run.id)).not.toContain("valid-copy");
  expect(result.actionable.find((run) => run.id === "rejected")).toMatchObject({
    state: "rejected",
    pending: 1,
    rejected: 1,
  });
  for (const id of ["invalid-copy", "wrong-tuple"]) {
    expect(result.actionable.find((run) => run.id === id)).toMatchObject({
      state: "needs-review",
      pending: 1,
      rejected: 0,
    });
  }
  const service = new Service(database);
  for (const run of result.runs) {
    const state = await service.status(run.id);
    expect(run).toMatchObject({
      state: state.status,
      pending: state.pending,
      rejected: state.rejected,
    });
  }
});

it("looks up the returned PR title through the narrow receipt index", () => {
  using database = new TestDatabase();
  const plan = database.connection
    .prepare(`EXPLAIN QUERY PLAN
    SELECT json_extract(payload_json,'$.pull_request.title') FROM github_webhook_delivery
    WHERE event='pull_request'
      AND CAST(json_extract(payload_json,'$.repository.id') AS TEXT)=?
      AND json_extract(payload_json,'$.pull_request.number')=?
    ORDER BY received_at DESC LIMIT 1`)
    .all("100", 1);
  expect(JSON.stringify(plan)).toContain("github_webhook_delivery_pr_title");
});
