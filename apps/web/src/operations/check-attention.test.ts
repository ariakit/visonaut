import { expect, it } from "vitest";
import { operationsStatus } from "../api/operations.ts";
import { deliverGitHubStatuses } from "./checks.ts";
import { recordEvent } from "./common.ts";
import { captured, context, reserve, TestDatabase } from "./test-fixtures.ts";

function preRunCheck(database: TestDatabase, plan: number | null, state = "active") {
  database.connection
    .prepare(`INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,
      kind,ref,pull_request_number,external_id,check_id,state,docs_only,plan_visual_required,
      workflow_run_id,workflow_attempt,created_at,updated_at)
      VALUES(?,0,'123',?,?,'pull_request','refs/pull/1/merge',1,'visonaut:run','1',?,0,?,'run',1,1,1)`)
    .run("a".repeat(40), "b".repeat(40), "c".repeat(40), state, plan);
}

async function readAttention(database: TestDatabase) {
  return operationsStatus({ database, projectId: "project", repositoryId: "123" });
}

it.each(["superseded-run", "missing-desired-revision", "new-generation", "delivered"])(
  "retains %s delivery history without renewing its exhausted alert",
  async (condition) => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    await deliverGitHubStatuses(fixture.context);
    database.connection.exec("UPDATE work_status_outbox SET state='dead',attempts=max_attempts");
    if (condition === "superseded-run" || condition === "missing-desired-revision") {
      database.connection.exec(
        "UPDATE visonaut_runs SET active=0,state='superseded',closed_at=1 WHERE id='run'",
      );
      if (condition === "missing-desired-revision") {
        database.connection.exec("UPDATE work_checks SET desired_revision=desired_revision+1");
        database.connection.exec("DELETE FROM operations_check_creations");
      }
    } else if (condition === "new-generation") {
      preRunCheck(database, 1);
      database.connection.exec(`INSERT INTO pre_run_checks(tested_sha,generation,repository_id,
        source_sha,base_sha,kind,ref,pull_request_number,external_id,state,docs_only,
        plan_visual_required,created_at,updated_at)
        SELECT tested_sha,1,repository_id,source_sha,base_sha,kind,ref,pull_request_number,
          'replacement','active',0,1,2,2 FROM pre_run_checks`);
    } else {
      database.connection.exec("UPDATE work_status_outbox SET state='complete'");
    }
    await recordEvent(database, {
      kind: "check-delivery",
      subject: "1",
      code: "exhausted",
      now: fixture.state.time - 1,
    });
    const history = database.connection.prepare("SELECT * FROM work_status_outbox").all();
    const sends = fixture.state.patches;

    expect((await readAttention(database)).events).toEqual([]);
    expect(database.connection.prepare("SELECT resolved_at FROM operations_events").get()).toEqual({
      resolved_at: null,
    });
    expect((await deliverGitHubStatuses(fixture.context)).attention).toEqual([]);
    expect(database.connection.prepare("SELECT * FROM work_status_outbox").all()).toEqual(history);
    expect(fixture.state.patches).toBe(sends);
    const resolved = database.connection.prepare("SELECT * FROM operations_events").get();
    expect(resolved).toMatchObject({
      occurrences: 1,
      first_seen_at: fixture.state.time - 1,
      last_seen_at: fixture.state.time - 1,
      resolved_at: fixture.state.time,
    });
    fixture.state.time += 1;
    await deliverGitHubStatuses(fixture.context);
    expect(database.connection.prepare("SELECT * FROM operations_events").get()).toEqual(resolved);
  },
);

it.each(["planned", "unplanned", "failed-owner"])(
  "keeps a current exhausted %s delivery visible even when the event is old",
  async (condition) => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    await deliverGitHubStatuses(fixture.context);
    preRunCheck(
      database,
      condition === "unplanned" ? null : 1,
      condition === "failed-owner" ? "failed" : "active",
    );
    database.connection.exec("UPDATE work_status_outbox SET state='dead',attempts=max_attempts");
    await recordEvent(database, {
      kind: "check-delivery",
      subject: "1",
      code: "exhausted",
      now: 1,
    });
    expect((await readAttention(database)).events).toMatchObject([
      { subject: "1", code: "exhausted" },
    ]);
    expect((await deliverGitHubStatuses(fixture.context)).attention).toEqual(["1"]);
    expect(database.connection.prepare("SELECT resolved_at FROM operations_events").get()).toEqual({
      resolved_at: null,
    });
  },
);

it("keeps an exhausted delivery for the current accepted baseline visible", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context, "run", "main");
  await deliverGitHubStatuses(fixture.context);
  database.connection.exec(`UPDATE visonaut_runs SET active=0,state='accepted',closed_at=1;
    INSERT INTO visonaut_snapshots(id,project_id,run_id,comparison_id,tested_sha,state,
      reference_eligible,prefix,created_at,storage_mode)
      SELECT 'baseline',project_id,id,comparison_id,tested_sha,'accepted',1,'runs/run',1,'source'
        FROM visonaut_runs;
    UPDATE visonaut_projects SET snapshot_id='baseline';
    UPDATE work_status_outbox SET state='dead',attempts=max_attempts`);
  await recordEvent(database, { kind: "check-delivery", subject: "1", code: "exhausted", now: 1 });
  expect((await readAttention(database)).events).toMatchObject([
    { subject: "1", code: "exhausted" },
  ]);
  expect((await deliverGitHubStatuses(fixture.context)).attention).toEqual(["1"]);
});

it("keeps obsolete check alerts and writer fences while a send is ambiguous", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  await deliverGitHubStatuses(fixture.context);
  preRunCheck(database, null);
  database.connection.exec(`UPDATE visonaut_runs SET active=0,state='superseded',closed_at=1;
    UPDATE work_status_outbox SET state='dead',attempts=max_attempts;
    UPDATE work_checks SET ambiguous=1,request_started=1,lease_token='unsettled',
      lease_revision=desired_revision,lease_until=${fixture.state.time + 60_000}`);
  await recordEvent(database, { kind: "check-delivery", subject: "1", code: "exhausted", now: 1 });
  const sender = database.connection.prepare("SELECT * FROM work_checks").get();
  expect((await readAttention(database)).events).toMatchObject([
    { subject: "1", code: "exhausted" },
  ]);
  expect((await deliverGitHubStatuses(fixture.context)).attention).toEqual(["1"]);
  expect(database.connection.prepare("SELECT * FROM work_checks").get()).toEqual(sender);
  expect((await readAttention(database)).events.map((event) => event.code)).toContain("ambiguous");
});

it("does not spend delivery attempts or request continuation for an unplanned check", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  await deliverGitHubStatuses(fixture.context);
  preRunCheck(database, null);
  database.connection.exec("UPDATE work_status_outbox SET state='pending',attempts=0");
  const history = database.connection.prepare("SELECT * FROM work_status_outbox").all();
  const sends = fixture.state.patches;
  const report = await deliverGitHubStatuses(fixture.context);
  expect(report).toMatchObject({ completed: [], deferred: [], attention: [], hasMore: false });
  expect(database.connection.prepare("SELECT * FROM work_status_outbox").all()).toEqual(history);
  expect(fixture.state.patches).toBe(sends);
});

it("selects current delivery before the page limit when an older check is unplanned", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  await reserve(fixture.context, "current");
  await deliverGitHubStatuses(fixture.context);
  preRunCheck(database, null);
  database.connection.exec(`UPDATE work_status_outbox SET state='pending',attempts=0;
    UPDATE work_status_outbox SET available_at=0 WHERE check_id='1'`);
  fixture.context.budget.tasksPerStep = 1;
  expect((await deliverGitHubStatuses(fixture.context)).completed).toEqual(["2"]);
  expect(
    database.connection.prepare("SELECT attempts FROM work_status_outbox WHERE check_id='1'").get(),
  ).toEqual({
    attempts: 0,
  });
});

it("keeps exhausted alerts without backing records and the current scheduler failure visible", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  await recordEvent(database, {
    kind: "check-delivery",
    subject: "unknown",
    code: "exhausted",
    now: 1,
  });
  await recordEvent(database, {
    kind: "webhooks",
    subject: "scheduler",
    code: "reconciliation-failed",
    now: 2,
  });
  expect((await readAttention(database)).events.map((event) => event.subject)).toEqual([
    "scheduler",
    "unknown",
  ]);
});
