import { Service } from "@visonaut/service";
import { expect, it, vi } from "vitest";
import { context, reserve, TestDatabase } from "../operations/test-fixtures.ts";
import { expireStagedAttempts, stagedAttemptRetentionMs } from "./workflow-retention.ts";

it("closes the alert of a failed expiration in the pass that deletes the staged attempt", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  // Staged retention deletes only an attempt whose ID is a safe prefix.
  const id = "12345678-1234-4234-8234-123456789abc";
  await reserve(fixture.context, id);
  database.connection
    .prepare(`INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,workflow_attempt,
      tested_sha,workflow_source_digest,caller_workflow_path,reusable_workflow_ref,
      capture_job_prefix,submit_job_name,verified_json,submitted_at,created_at)
      SELECT id,'123',external_run_id,attempt,tested_sha,'digest','path','ref','capture','submit',
        '{}',1,1 FROM visonaut_runs WHERE id=?`)
    .run(id);
  fixture.state.time += stagedAttemptRetentionMs;
  const alerts = () =>
    database.connection
      .prepare(
        "SELECT id,resolved_at FROM operations_events WHERE kind='staged-retention' ORDER BY id",
      )
      .all();
  const expire = vi
    .spyOn(Service.prototype, "expireIncompleteWorkflowRun")
    .mockRejectedValueOnce(new Error("Unavailable."));

  expect((await expireStagedAttempts(fixture.context)).attention).toEqual([id]);
  expect(alerts()).toEqual([
    { id: `staged-retention:${id}:terminalize-failed`, resolved_at: null },
  ]);

  fixture.state.time += 1;
  expect(await expireStagedAttempts(fixture.context)).toMatchObject({
    completed: [id],
    attention: [id],
  });
  expect(expire).toHaveBeenCalledTimes(2);
  expect(alerts()).toEqual([
    { id: `staged-retention:${id}:terminalize-failed`, resolved_at: fixture.state.time },
  ]);
  expect(
    database.connection.prepare("SELECT retention_state FROM ingest_staged_runs").get(),
  ).toEqual({ retention_state: "deleted" });
});
