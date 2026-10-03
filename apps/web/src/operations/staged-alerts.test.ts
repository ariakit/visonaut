import { expect, it } from "vitest";
import { operationsStatus } from "../api/operations.ts";
import { reportComparisonRecovery } from "./comparison-alerts.ts";
import { recordEvent } from "./common.ts";
import { context, reserve, TestDatabase } from "./test-fixtures.ts";

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
