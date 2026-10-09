import { expect, it, vi } from "vitest";
import { Service } from "@visonaut/service";
import { TestDatabase } from "../operations/test-fixtures.ts";
import { dashboard } from "./dashboard.ts";
import { operationsStatus } from "./operations.ts";

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
    approved: 1,
  });
  expect(result.actionable.map((run) => run.id)).not.toContain("approved");
  expect(result.runs.find((run) => run.id === "valid-copy")).toMatchObject({
    state: "passed",
    pending: 0,
    rejected: 0,
    approved: 1,
  });
  expect(result.actionable.map((run) => run.id)).not.toContain("valid-copy");
  expect(result.actionable.find((run) => run.id === "rejected")).toMatchObject({
    state: "rejected",
    pending: 1,
    rejected: 1,
    approved: 0,
  });
  for (const id of ["invalid-copy", "wrong-tuple"]) {
    expect(result.actionable.find((run) => run.id === id)).toMatchObject({
      state: "needs-review",
      pending: 1,
      rejected: 0,
      approved: 0,
    });
  }
  const service = new Service(database);
  for (const run of result.runs) {
    const state = await service.status(run.id);
    expect(run).toMatchObject({
      state: state.status,
      pending: state.pending,
      rejected: state.rejected,
      approved: state.approved,
    });
  }
});

it("gives the dashboard, the run status, and the status update the same three counts", async () => {
  using database = new TestDatabase();
  database.connection.exec("PRAGMA foreign_keys=OFF");
  database.connection
    .prepare(
      // A status update needs a project revision of 1 or more.
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest,revision) VALUES('project','100','policy',1)",
    )
    .run();
  database.connection
    .prepare(
      "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,state,comparison_id,sealed_at,created_at) VALUES('run','project','1',1,'pull_request','sha','pr:1','plan','{}','reviewing','comparison',1,0)",
    )
    .run();
  database.connection
    .prepare(
      "INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,state,created_at) VALUES('comparison','run',0,'policy',0,'ready',0)",
    )
    .run();
  // Two approved, one rejected, one undecided, one unchanged, and one that has no result yet.
  const rows = [
    ["approved-1", "changed", "approved"],
    ["approved-2", "changed", "approved"],
    ["rejected", "changed", "rejected"],
    ["undecided", "changed", null],
    ["unchanged", "unchanged", null],
    ["unfinished", "pending", null],
  ] as const;
  for (const [index, [id, outcome, verdict]] of rows.entries()) {
    database.connection
      .prepare(
        "INSERT INTO visonaut_comparison_rows(id,comparison_id,item_key,variant_key,ordinal,tuple_json,outcome,decision_id) VALUES(?,'comparison',?,'light',?,'{}',?,?)",
      )
      .run(id, id, index, outcome, verdict ? `decision-${id}` : null);
    if (!verdict) continue;
    database.connection
      .prepare(
        "INSERT INTO visonaut_decisions(id,row_id,revision,verdict,kind,actor_id,tuple_json,created_at) VALUES(?,?,1,?,'human','42','{}',0)",
      )
      .run(`decision-${id}`, id, verdict);
  }
  const counts = { pending: 3, rejected: 1, approved: 2 };
  const result = await dashboard({
    database,
    configuration: {
      projectId: "project",
      github: { repositoryId: "100", repository: "ariakit/ariakit" },
    },
  });
  expect(result.runs[0]).toMatchObject({ state: "rejected", ...counts });
  const service = new Service(database);
  expect(await service.status("run")).toMatchObject({
    status: "rejected",
    ...counts,
  });
  // The status update of the check stores the same state and the same counts.
  await service.prepareStatusIntent({
    runId: "run",
    checkId: "check",
    detailsUrl: "https://visonaut.example/runs/run",
    maxAttempts: 3,
    now: 1,
  });
  expect(
    database.connection
      .prepare(`SELECT review_state AS state, review_pending AS pending,
        review_rejected AS rejected, review_approved AS approved FROM work_status_outbox`)
      .all(),
  ).toEqual([{ state: result.runs[0]?.state, ...counts }]);
});

it("reports a closed run that failed as failed and not as replaced", async () => {
  using database = new TestDatabase();
  database.connection.exec("PRAGMA foreign_keys=OFF");
  database.connection
    .prepare(
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','100','policy')",
    )
    .run();
  const closedRuns = [
    ["expired", "failed"],
    ["replaced", "superseded"],
  ] as const;
  for (const [id, state] of closedRuns) {
    database.connection
      .prepare(
        "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,state,active,closed_at,created_at) VALUES(?,'project',?,1,'pull_request','sha','pr:1','plan','{}',?,0,1,0)",
      )
      .run(id, id, state);
  }
  const result = await dashboard({
    database,
    configuration: {
      projectId: "project",
      github: { repositoryId: "100", repository: "ariakit/ariakit" },
    },
  });
  const service = new Service(database);
  for (const [id, state] of closedRuns) {
    expect(result.runs.find((run) => run.id === id)?.state).toBe(state);
    expect((await service.status(id)).status).toBe(state);
  }
});

it("returns why each closed run closed and the state it had before", async () => {
  using database = new TestDatabase();
  database.connection.exec("PRAGMA foreign_keys=OFF");
  database.connection
    .prepare(
      // The baseline moved on after each comparison below, which has the revision 0.
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest,baseline_revision) VALUES('project','100','policy',3)",
    )
    .run();
  // One run for each cause, and the rows that decide the state before closing.
  const pull = { kind: "pull_request", state: "superseded" } as const;
  const closedRuns = [
    { ...pull, id: "replaced", reason: "replaced", rows: ["undecided"] },
    { ...pull, id: "pull", reason: "pull-request-closed", rows: ["rejected"] },
    { ...pull, id: "group", kind: "merge_group", reason: "merge-group-destroyed", rows: [] },
    { ...pull, id: "baseline", kind: "main", reason: "baseline-retired", rows: ["approved"] },
    { ...pull, id: "expired", state: "failed", reason: "expired", rows: [] },
    { ...pull, id: "legacy", reason: null, rows: ["approved"] },
    { ...pull, id: "unsealed", reason: "replaced", rows: [] },
    { ...pull, id: "compacted", reason: "replaced", rows: ["approved"] },
  ] as const;
  for (const [index, entry] of closedRuns.entries()) {
    database.connection
      .prepare(
        "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,state,active,closed_at,closed_reason,comparison_id,sealed_at,created_at) VALUES(?,'project',?,1,?,'sha',?,'plan','{}',?,0,1,?,?,1,?)",
      )
      .run(
        entry.id,
        entry.id,
        entry.kind,
        entry.kind === "pull_request" ? "pr:1" : entry.kind,
        entry.state,
        entry.reason,
        entry.id,
        index,
      );
    database.connection
      .prepare(
        "INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,state,created_at) VALUES(?,?,0,'policy',0,'ready',0)",
      )
      .run(entry.id, entry.id);
    for (const [ordinal, verdict] of entry.rows.entries()) {
      const decided = verdict === "undecided" ? null : `decision-${entry.id}`;
      database.connection
        .prepare(
          "INSERT INTO visonaut_comparison_rows(id,comparison_id,item_key,variant_key,ordinal,tuple_json,outcome,decision_id) VALUES(?,?,'item','light',?,'{}','changed',?)",
        )
        .run(`row-${entry.id}`, entry.id, ordinal, decided);
      if (!decided) continue;
      database.connection
        .prepare(
          "INSERT INTO visonaut_decisions(id,row_id,revision,verdict,kind,actor_id,tuple_json,created_at) VALUES(?,?,1,?,'human','42','{}',0)",
        )
        .run(decided, `row-${entry.id}`, verdict);
    }
  }
  // The stored rows of these two runs cannot give the state before the close.
  database.connection.exec(
    "UPDATE visonaut_runs SET sealed_at=NULL,comparison_id=NULL WHERE id='unsealed'",
  );
  database.connection.exec("UPDATE visonaut_runs SET detail_archived=1 WHERE id='compacted'");
  const result = await dashboard({
    database,
    configuration: {
      projectId: "project",
      github: { repositoryId: "100", repository: "ariakit/ariakit" },
    },
  });
  const byId = (id: string) => result.runs.find((run) => run.id === id);
  expect(
    closedRuns.map((entry) => {
      const run = byId(entry.id);
      return [entry.id, run?.state, run?.closedReason, run?.closedState];
    }),
  ).toEqual([
    ["replaced", "superseded", "replaced", "needs-review"],
    ["pull", "superseded", "pull-request-closed", "rejected"],
    ["group", "superseded", "merge-group-destroyed", "passed"],
    ["baseline", "superseded", "baseline-retired", "passed"],
    // A run that expired is failed, so it has no other state before the close.
    ["expired", "failed", "expired", undefined],
    ["legacy", "superseded", undefined, "passed"],
    // It was capturing or had failed: the close replaced that state.
    ["unsealed", "superseded", "replaced", undefined],
    ["compacted", "superseded", "replaced", undefined],
  ]);
});

it("returns no closed reason or closed state for an open run", async () => {
  using database = new TestDatabase();
  database.connection.exec("PRAGMA foreign_keys=OFF");
  database.connection
    .prepare(
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','100','policy')",
    )
    .run();
  database.connection
    .prepare(
      "INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,state,created_at) VALUES('open','project','open',1,'main','sha','main','plan','{}','uploading',0)",
    )
    .run();
  const result = await dashboard({
    database,
    configuration: {
      projectId: "project",
      github: { repositoryId: "100", repository: "ariakit/ariakit" },
    },
  });
  expect(result.runs[0]).toMatchObject({ id: "open", state: "incomplete" });
  expect(result.runs[0]).toHaveProperty("closedReason", undefined);
  expect(result.runs[0]).toHaveProperty("closedState", undefined);
});

it("counts the alerts that a person can still act on", async () => {
  using database = new TestDatabase();
  database.connection
    .prepare(
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('project','100','policy')",
    )
    .run();
  const context = {
    database,
    configuration: {
      projectId: "project",
      github: { repositoryId: "100", repository: "ariakit/ariakit" },
    },
  };
  expect((await dashboard(context)).alertCount).toBe(0);
  for (const [id, resolved] of [
    ["open-1", null],
    ["open-2", null],
    ["resolved", 5],
  ] as const) {
    database.connection
      .prepare(
        "INSERT INTO operations_events(id,kind,subject_id,code,first_seen_at,last_seen_at,resolved_at) VALUES(?,'backup',?,'backup-failed',1,1,?)",
      )
      .run(id, id, resolved);
  }
  expect((await dashboard(context)).alertCount).toBe(2);
  // The count reads the same alerts as `/api/operations`.
  const events = await operationsStatus({
    database,
    projectId: "project",
    repositoryId: "100",
  });
  expect(events.events).toHaveLength(2);
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
