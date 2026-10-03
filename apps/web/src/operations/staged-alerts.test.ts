import { expect, it } from "vitest";
import { operationsStatus } from "../api/operations.ts";
import { reportComparisonRecovery } from "./comparison-alerts.ts";
import { recordEvent } from "./common.ts";
import { captured, context, reserve, TestDatabase } from "./test-fixtures.ts";

it.each(["superseded", "failed", "ambiguous", "unknown"])(
  "preserves staged %s evidence and clears attention only for explicit supersession",
  async (condition) => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context);
    if (condition !== "unknown") {
      database.connection.exec(`INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,
        workflow_attempt,tested_sha,workflow_source_digest,caller_workflow_path,reusable_workflow_ref,
        capture_job_prefix,submit_job_name,verified_json,submitted_at,created_at,reconcile_failures)
        VALUES('run','123','workflow',1,'sha','digest','path','ref','capture','submit','{}',1,1,5)`);
      database.connection.exec(
        condition === "failed"
          ? "UPDATE visonaut_runs SET active=1,state='failed'"
          : "UPDATE visonaut_runs SET active=0,state='superseded',closed_at=1",
      );
    }
    if (condition === "ambiguous") {
      database.connection.exec(`INSERT INTO pre_run_checks(tested_sha,generation,repository_id,
        source_sha,base_sha,kind,ref,pull_request_number,docs_only,external_id,check_id,state,
        workflow_run_id,workflow_attempt,created_at,updated_at)
        VALUES('sha',0,'123','source','base','pull_request','refs/pull/1/merge',1,0,'legacy','1',
          'ambiguous','workflow',1,1,1)`);
    }
    await recordEvent(database, {
      kind: "staged-reconciliation",
      subject: "workflow:1",
      code: "retry-delayed",
      now: 1,
    });
    const evidence = database.connection.prepare("SELECT * FROM ingest_staged_runs").all();
    const read = () => operationsStatus({ database, projectId: "project", repositoryId: "123" });
    expect((await read()).events).toHaveLength(condition === "superseded" ? 0 : 1);
    expect(database.connection.prepare("SELECT resolved_at FROM operations_events").get()).toEqual({
      resolved_at: null,
    });
    await reportComparisonRecovery(
      fixture.context,
      { published: [], failed: [] },
      { completed: [], errors: [] },
    );
    expect(database.connection.prepare("SELECT * FROM ingest_staged_runs").all()).toEqual(evidence);
    expect(database.connection.prepare("SELECT * FROM operations_events").get()).toMatchObject({
      occurrences: 1,
      first_seen_at: 1,
      last_seen_at: 1,
      resolved_at: condition === "superseded" ? fixture.state.time : null,
    });
    expect((await read()).events).toHaveLength(condition === "superseded" ? 0 : 1);
  },
);

it.each([
  "lineage",
  "unrelated",
  "current-failure",
  "unaccepted",
  "ineligible",
  "newer-failure",
  "pull-request",
  "incomplete",
  "unknown-sender",
  "pending-delivery",
  "undelivered",
  "wrong-run",
  "wrong-attempt",
  "wrong-workflow",
  "ambiguous",
  "started",
  "leased",
  "ambiguous-creation",
] as const)(
  "clears a replaced terminal main alert only after its failure was delivered: %s",
  async (condition) => {
    using database = new TestDatabase();
    const fixture = context(database);
    await reserve(fixture.context, "failed", "main");
    await captured(fixture.context, "baseline", "main");
    database.connection.exec(`UPDATE visonaut_runs SET active=1,state='failed' WHERE id='failed';
    UPDATE visonaut_runs SET active=0,state='accepted',closed_at=1 WHERE id='baseline';
    INSERT INTO visonaut_snapshots(id,project_id,run_id,comparison_id,tested_sha,state,
      reference_eligible,prefix,created_at,storage_mode)
      SELECT 'snapshot',project_id,id,comparison_id,tested_sha,'accepted',1,'runs/baseline',1,'source'
        FROM visonaut_runs WHERE id='baseline';
    UPDATE visonaut_projects SET snapshot_id='snapshot',baseline_revision=2;
    INSERT INTO visonaut_lineage VALUES('failed','baseline','verified');
    INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,workflow_attempt,tested_sha,
      workflow_source_digest,caller_workflow_path,reusable_workflow_ref,capture_job_prefix,
      submit_job_name,verified_json,submitted_at,created_at,reconcile_failures)
      SELECT id,'123',external_run_id,attempt,tested_sha,'digest','path','ref','capture','submit','{}',1,1,5
        FROM visonaut_runs WHERE id='failed';
    INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,
      ref,docs_only,external_id,check_id,state,request_started,workflow_run_id,workflow_attempt,
      created_at,updated_at)
      SELECT tested_sha,0,'123',tested_sha,'base','main','refs/heads/main',0,'legacy','failure-check',
        'active',1,external_run_id,attempt,1,1 FROM visonaut_runs WHERE id='failed';
    INSERT INTO work_checks(id,desired_revision,delivered_revision) VALUES('failure-check',1,1)`);
    database.connection
      .prepare(`INSERT INTO work_status_outbox(check_id,revision,run_id,attempt,source_revision,
      comparison_revision,conclusion,details_url,state,max_attempts,available_at)
      VALUES('failure-check',1,?,?,0,0,'failure','https://preview.example','complete',5,1)`)
      .run(
        condition === "wrong-run" ? "baseline" : "failed",
        condition === "wrong-attempt" ? 2 : 1,
      );
    const changes = {
      unrelated: "DELETE FROM visonaut_lineage",
      "current-failure": "UPDATE visonaut_projects SET snapshot_id=NULL",
      unaccepted: "UPDATE visonaut_runs SET state='reviewing' WHERE id='baseline'",
      ineligible: "UPDATE visonaut_snapshots SET reference_eligible=0",
      "newer-failure": "UPDATE visonaut_runs SET created_at=created_at+1 WHERE id='failed'",
      "pull-request": "UPDATE visonaut_runs SET kind='pull_request' WHERE id='failed'",
      incomplete: "UPDATE visonaut_runs SET state='uploading' WHERE id='failed'",
      "unknown-sender": "DELETE FROM work_status_outbox; DELETE FROM work_checks",
      "pending-delivery": "UPDATE work_status_outbox SET state='pending'",
      undelivered: "UPDATE work_checks SET delivered_revision=0",
      "wrong-workflow": "UPDATE ingest_staged_runs SET workflow_run_id='another'",
      ambiguous: "UPDATE work_checks SET ambiguous=1",
      started: "UPDATE work_checks SET request_started=1",
      leased:
        "UPDATE work_checks SET lease_token='unsettled',lease_revision=1,lease_until=9999999999999",
      "ambiguous-creation": "UPDATE pre_run_checks SET state='ambiguous'",
    };
    if (condition !== "lineage" && condition !== "wrong-run" && condition !== "wrong-attempt") {
      database.connection.exec(changes[condition]);
    }
    const subject = condition === "wrong-workflow" ? "another:1" : "failed:1";
    await recordEvent(database, {
      kind: "staged-reconciliation",
      subject,
      code: "stale-reference",
      now: 1,
    });
    const history = {
      run: database.connection.prepare("SELECT * FROM visonaut_runs WHERE id='failed'").get(),
      stages: database.connection.prepare("SELECT * FROM ingest_staged_runs").all(),
      checks: database.connection.prepare("SELECT * FROM work_checks").all(),
      outbox: database.connection.prepare("SELECT * FROM work_status_outbox").all(),
      lineage: database.connection.prepare("SELECT * FROM visonaut_lineage").all(),
    };
    const read = () => operationsStatus({ database, projectId: "project", repositoryId: "123" });
    const obsolete = condition === "lineage";
    expect((await read()).events).toHaveLength(obsolete ? 0 : 1);
    expect(database.connection.prepare("SELECT resolved_at FROM operations_events").get()).toEqual({
      resolved_at: null,
    });
    await reportComparisonRecovery(
      fixture.context,
      { published: [], failed: [] },
      { completed: [], errors: [] },
    );
    expect(database.connection.prepare("SELECT resolved_at FROM operations_events").get()).toEqual({
      resolved_at: obsolete ? fixture.state.time : null,
    });
    expect(
      database.connection.prepare("SELECT * FROM visonaut_runs WHERE id='failed'").get(),
    ).toEqual(history.run);
    expect(database.connection.prepare("SELECT * FROM ingest_staged_runs").all()).toEqual(
      history.stages,
    );
    expect(database.connection.prepare("SELECT * FROM work_checks").all()).toEqual(history.checks);
    expect(database.connection.prepare("SELECT * FROM work_status_outbox").all()).toEqual(
      history.outbox,
    );
    expect(database.connection.prepare("SELECT * FROM visonaut_lineage").all()).toEqual(
      history.lineage,
    );
    expect(fixture.state.patches).toBe(0);
    expect((await read()).events).toHaveLength(obsolete ? 0 : 1);
  },
);
