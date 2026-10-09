import { GitHubUnavailableError } from "@visonaut/security";
import { Service } from "@visonaut/service";
import { expect, it, vi } from "vitest";
import { deliverGitHubStatuses } from "./checks.ts";
import { captured, context, reserve, TestDatabase } from "./test-fixtures.ts";

type Fixture = ReturnType<typeof context>;

const checkPath = "/repos/owner/repo/check-runs/1";

function readDelivery(database: TestDatabase) {
  return database.connection
    .prepare(`SELECT checks.ambiguous, checks.lease_token, outbox.state, outbox.available_at,
      outbox.last_error
    FROM work_checks checks JOIN work_status_outbox outbox
      ON outbox.check_id = checks.id AND outbox.revision = checks.desired_revision
    WHERE checks.id = '1'`)
    .get();
}

/**
 * Commit one decision immediately before each of the next database batches of
 * the pass. Each batch has the statements that its writer built before the
 * decision, so it is the guarded write of a status update that lost the race.
 */
function commitBeforeBatches(database: TestDatabase, decisions: (() => Promise<unknown>)[]) {
  const batch = database.batch.bind(database);
  let committing = false;
  database.batch = async (statements) => {
    const decide = committing ? undefined : decisions.shift();
    if (decide) {
      // The decision commits with a batch of its own.
      committing = true;
      try {
        await decide();
      } finally {
        committing = false;
      }
    }
    return batch(statements);
  };
}

/** A reviewer rejects the one changed capture of a run. */
async function reject(fixture: Fixture, runId: string) {
  const service = new Service(fixture.context.database);
  const comparisonId = `comparison-${runId}`;
  const [row] = await service.comparisonRows(comparisonId);
  if (!row) {
    throw new Error("Missing comparison row.");
  }
  await service.review({
    commandId: `reject-${runId}`,
    actorId: "maintainer",
    sessionId: "session",
    comparisonId,
    verdict: "rejected",
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: row.item_key, variantKey: row.variant_key },
    now: fixture.context.now(),
  });
}

/** The checks whose delivered update has the current revision of the project. */
function currentChecks(database: TestDatabase) {
  return database.connection
    .prepare(`SELECT checks.id FROM work_checks checks JOIN visonaut_checks owner ON owner.id = checks.id
      JOIN visonaut_projects project ON project.id = owner.project_id
      WHERE checks.delivered_revision = project.revision ORDER BY checks.id`)
    .all()
    .map((row) => row.id);
}

function rejectedRuns(database: TestDatabase) {
  return database.connection
    .prepare(`SELECT comparison.run_id FROM visonaut_decisions decision
      JOIN visonaut_comparison_rows row ON row.decision_id = decision.id
      JOIN visonaut_comparisons comparison ON comparison.id = row.comparison_id
      WHERE decision.verdict = 'rejected' AND decision.revoked = 0 ORDER BY comparison.run_id`)
    .all()
    .map((row) => row.run_id);
}

it("delivers an update in a later pass after one failed read of its check", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  const request = fixture.context.github.request.bind(fixture.context.github);
  let failedReads = 0;
  fixture.context.github.request = async (path, init) => {
    if (path === checkPath && !init?.method && failedReads === 0) {
      failedReads += 1;
      throw new GitHubUnavailableError(502);
    }
    return request(path, init);
  };

  const failed = await deliverGitHubStatuses(fixture.context);

  // The update waits, so one more pass at once has no update that is due.
  expect(failed).toEqual({ completed: [], deferred: ["1"], attention: [], hasMore: false });
  expect(failedReads).toBe(1);
  expect(fixture.state.patches).toBe(0);
  expect(readDelivery(database)).toEqual({
    ambiguous: 0,
    lease_token: null,
    state: "pending",
    available_at: fixture.state.time + 30_000,
    last_error:
      "SecurityError: GitHub verification is temporarily unavailable. GitHub status: 502.",
  });
  expect(database.connection.prepare("SELECT * FROM operations_events").all()).toEqual([]);

  fixture.state.time += 29_999;
  const early = await deliverGitHubStatuses(fixture.context);
  expect(early).toMatchObject({ completed: [], deferred: [], attention: [], hasMore: false });
  expect(fixture.state.patches).toBe(0);

  fixture.state.time += 1;
  const later = await deliverGitHubStatuses(fixture.context);
  expect(later).toMatchObject({ completed: ["1"], deferred: [], attention: [] });
  expect(fixture.state.patches).toBe(1);
  expect(readDelivery(database)).toMatchObject({ ambiguous: 0, state: "complete" });
});

it("asks for no more pass when the one update belongs to a locked check", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  fixture.state.losePatch = true;
  expect((await deliverGitHubStatuses(fixture.context)).attention).toEqual(["1"]);
  fixture.state.losePatch = false;

  // A later event of another run gives the locked check a newer update.
  await reserve(fixture.context, "another");
  expect((await deliverGitHubStatuses(fixture.context)).completed).toEqual(["2"]);
  expect(readDelivery(database)).toMatchObject({ ambiguous: 1, state: "pending" });

  for (let pass = 0; pass < 2; pass += 1) {
    const report = await deliverGitHubStatuses(fixture.context);
    expect(report).toEqual({ completed: [], deferred: [], attention: ["1"], hasMore: false });
  }
  expect(fixture.state.patches).toBe(2);
});

it("sends no PATCH for an unchanged completed result after a later event", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  const request = fixture.context.github.request.bind(fixture.context.github);
  const patched: string[] = [];
  // GitHub shows the result of each PATCH in the next read of the check.
  fixture.context.github.request = async (path, init) => {
    const result = await request(path, init);
    if (init?.method === "PATCH") {
      const id = path.split("/").at(-1) ?? "";
      patched.push(id);
      Object.assign(fixture.state.checks.get(id) ?? {}, JSON.parse(String(init.body)));
    }
    return result;
  };

  expect((await deliverGitHubStatuses(fixture.context)).completed).toEqual(["1"]);
  expect(fixture.state.checks.get("1")).toMatchObject({ status: "completed" });
  const completedAt = fixture.state.checks.get("1")?.completed_at;

  fixture.state.time += 60_000;
  await reserve(fixture.context, "another");
  expect((await deliverGitHubStatuses(fixture.context)).completed).toEqual(["1", "2"]);

  expect(patched).toEqual(["1", "2"]);
  expect(fixture.state.checks.get("1")?.completed_at).toBe(completedAt);
  expect(
    database.connection
      .prepare("SELECT desired_revision - delivered_revision AS behind FROM work_checks")
      .all(),
  ).toEqual([{ behind: 0 }, { behind: 0 }]);
});

it("gives each run its update when a decision commits during the status step", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  for (const id of ["first", "second", "third"]) {
    await captured(fixture.context, id);
  }
  // The decision commits after the pass read the run "first" and before the
  // pass writes the update of that run.
  commitBeforeBatches(database, [() => reject(fixture, "first")]);

  const report = await deliverGitHubStatuses(fixture.context);

  expect(rejectedRuns(database)).toEqual(["first"]);
  expect(report).toMatchObject({ completed: ["1", "2", "3"], deferred: [], attention: [] });
  expect(fixture.state.patches).toBe(3);
  // The second attempt of the run "first" read the state after the decision.
  expect(currentChecks(database)).toEqual(["1", "2", "3"]);
  expect(database.connection.prepare("SELECT * FROM operations_events").all()).toEqual([]);
});

it("goes to the next run when a second decision commits during the second attempt", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  for (const id of ["first", "second", "third"]) {
    await captured(fixture.context, id);
  }
  // Each decision changes the revision of the project of the three runs.
  commitBeforeBatches(database, [() => reject(fixture, "first"), () => reject(fixture, "second")]);

  const report = await deliverGitHubStatuses(fixture.context);

  expect(rejectedRuns(database)).toEqual(["first", "second"]);
  // The run "first" waits for the next pass. The other runs get their update.
  expect(report).toMatchObject({ completed: ["2", "3"], deferred: ["first"], attention: [] });
  expect(fixture.state.patches).toBe(2);
  expect(currentChecks(database)).toEqual(["2", "3"]);
  expect(database.connection.prepare("SELECT * FROM operations_events").all()).toEqual([]);

  const next = await deliverGitHubStatuses(fixture.context);

  expect(next).toMatchObject({ completed: ["1"], deferred: [], attention: [] });
  expect(fixture.state.patches).toBe(3);
  expect(currentChecks(database)).toEqual(["1", "2", "3"]);
});

it("goes to the next run when a newer attempt replaces a run that the step listed", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await captured(fixture.context, "first");
  await captured(fixture.context, "second");
  const prepareStatusIntent = Service.prototype.prepareStatusIntent;
  let replaced = false;
  // The run "first" closes after the step listed it and before the step reads it.
  const prepare = vi
    .spyOn(Service.prototype, "prepareStatusIntent")
    .mockImplementation(async function (this: Service, input) {
      if (!replaced) {
        replaced = true;
        await service.retireRun({ runId: "first", reason: "replaced", now: fixture.context.now() });
      }
      return prepareStatusIntent.call(this, input);
    });
  try {
    const report = await deliverGitHubStatuses(fixture.context);

    expect(report).toMatchObject({ completed: ["2"], deferred: ["first"], attention: [] });
    expect(prepare.mock.calls.map(([input]) => input.runId)).toEqual(["first", "first", "second"]);

    // The closed run is not a candidate of the next pass.
    prepare.mockClear();
    const next = await deliverGitHubStatuses(fixture.context);

    expect(next).toMatchObject({ completed: [], deferred: [], attention: [] });
    expect(prepare).not.toHaveBeenCalled();
    expect(fixture.state.patches).toBe(1);
    expect(database.connection.prepare("SELECT * FROM operations_events").all()).toEqual([]);
  } finally {
    prepare.mockRestore();
  }
});

it("fails the status step when the update of a run fails for another cause", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  const prepare = vi
    .spyOn(Service.prototype, "prepareStatusIntent")
    .mockRejectedValue(new Error("Database unavailable."));
  try {
    await expect(deliverGitHubStatuses(fixture.context)).rejects.toThrow("Database unavailable.");
    expect(prepare).toHaveBeenCalledTimes(1);
  } finally {
    prepare.mockRestore();
  }
});
