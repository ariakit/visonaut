import { genericCheckOutput, GitHubUnavailableError } from "@visonaut/security";
import { Service } from "@visonaut/service";
import { expect, it, vi } from "vitest";
import { dashboard } from "../api/dashboard.ts";
import { deliverGitHubStatuses } from "./checks.ts";
import { addUndecidedChange, captured, context, reserve, TestDatabase } from "./test-fixtures.ts";

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

interface DecisionParams {
  runId?: string;
  /** The position of the changed capture in the comparison. */
  index?: number;
  verdict: "approved" | "rejected";
  actorId?: string;
}

/** One decision of a reviewer on one changed capture of a run: the first one by default. */
async function saveDecision(
  fixture: Fixture,
  { runId = "run", index = 0, verdict, actorId = "maintainer" }: DecisionParams,
) {
  const service = new Service(fixture.context.database);
  const comparisonId = `comparison-${runId}`;
  const row = (await service.comparisonRows(comparisonId))[index];
  if (!row) {
    throw new Error("Missing comparison row.");
  }
  await service.review({
    commandId: `${verdict}-${runId}-${index}-${row.decision_revision}`,
    actorId,
    sessionId: "session",
    comparisonId,
    verdict,
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: row.item_key, variantKey: row.variant_key },
    now: fixture.context.now(),
  });
}

/** A reviewer rejects one changed capture of a run: the first one by default. */
function reject(fixture: Fixture, runId: string, index = 0) {
  return saveDecision(fixture, { runId, index, verdict: "rejected" });
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

interface ShownPatch {
  status: string;
  conclusion?: string;
  output: { title: string; summary: string };
}

/**
 * The PATCH bodies of the pass, in their order. GitHub shows the result of
 * each PATCH in the next read of the check.
 */
function shownPatches(fixture: Fixture) {
  const patches: ShownPatch[] = [];
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    const result = await request(path, init);
    if (init?.method === "PATCH") {
      const body: ShownPatch = JSON.parse(String(init.body));
      patches.push(body);
      Object.assign(fixture.state.checks.get(path.split("/").at(-1) ?? "") ?? {}, body);
    }
    return result;
  };
  return patches;
}

function desiredRevision(database: TestDatabase) {
  return database.connection
    .prepare("SELECT desired_revision FROM work_checks WHERE id = '1'")
    .get()?.desired_revision;
}

it("sends one update with a new revision for a decision that changes only a count", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  await addUndecidedChange(database, "comparison-run");
  const patches = shownPatches(fixture);

  await deliverGitHubStatuses(fixture.context);
  await reject(fixture, "run", 0);
  await deliverGitHubStatuses(fixture.context);
  const revision = desiredRevision(database);
  // The second Reject changes no state and no conclusion: only two counts.
  await reject(fixture, "run", 1);
  await deliverGitHubStatuses(fixture.context);

  expect(desiredRevision(database)).toBeGreaterThan(Number(revision));
  expect(patches.map((patch) => [patch.conclusion, patch.output.title])).toEqual([
    ["failure", "1 change needs review"],
    ["failure", "1 change rejected"],
    ["failure", "2 changes rejected"],
  ]);
  expect(patches.map((patch) => patch.output.summary.split("\n\n")[1])).toEqual([
    "Changes: 1 need review, 0 rejected, 1 approved.",
    "Changes: 1 need review, 1 rejected, 0 approved.",
    "Changes: 0 need review, 2 rejected, 0 approved.",
  ]);

  // A later event of another run changes no count of this run: no PATCH.
  fixture.state.time += 60_000;
  await reserve(fixture.context, "another");
  await deliverGitHubStatuses(fixture.context);
  expect(patches.map((patch) => patch.output.title).slice(3)).toEqual(["Capturing screenshots"]);
});

it("sends no text of an update when a decision commits after the claim", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  const patches = shownPatches(fixture);
  const request = fixture.context.github.request.bind(fixture.context.github);
  let decided = false;
  // The sender reads the check after the claim. The decision commits at that read.
  fixture.context.github.request = async (path, init) => {
    if (path === checkPath && !init?.method && !decided) {
      decided = true;
      await reject(fixture, "run");
    }
    return request(path, init);
  };

  const first = await deliverGitHubStatuses(fixture.context);

  // The claimed update has the counts from before the decision, so it is not sent.
  expect(first).toMatchObject({ completed: [], deferred: ["1"], attention: [] });
  expect(patches).toEqual([]);

  const next = await deliverGitHubStatuses(fixture.context);

  expect(next).toMatchObject({ completed: ["1"], attention: [] });
  expect(patches.map((patch) => patch.output.title)).toEqual(["1 change rejected"]);
});

// D-OPS-02: a review that waits for a maintainer must block the merge.
it("keeps the check completed with the conclusion failure while a review waits", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await captured(fixture.context);
  await addUndecidedChange(database, "comparison-run");
  const patches = shownPatches(fixture);

  await deliverGitHubStatuses(fixture.context);

  expect((await service.status("run")).status).toBe("needs-review");
  expect(patches).toEqual([
    expect.objectContaining({
      status: "completed",
      conclusion: "failure",
      output: expect.objectContaining({ title: "1 change needs review" }),
    }),
  ]);
});

it("gives the same status, check title, and conclusion from the rows of a caller, for each state", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await reserve(fixture.context);
  const update = (sql: string) => database.connection.exec(sql);
  // Each step puts a run into the next state. The rules read only the fields
  // that these steps set.
  const steps: [id: string, step: () => Promise<unknown> | void][] = [
    ["run", () => {}],
    [
      "second",
      async () => {
        await captured(fixture.context, "second");
        await addUndecidedChange(database, "comparison-second");
      },
    ],
    ["second", () => reject(fixture, "second")],
    [
      "second",
      async () => {
        await saveDecision(fixture, { runId: "second", index: 0, verdict: "approved" });
        await saveDecision(fixture, { runId: "second", index: 1, verdict: "approved" });
      },
    ],
    [
      "second",
      () => update("UPDATE visonaut_comparisons SET state = 'comparing' WHERE run_id = 'second'"),
    ],
    [
      "second",
      () => update("UPDATE visonaut_comparisons SET state = 'invalidated' WHERE run_id = 'second'"),
    ],
    ["second", () => update("UPDATE visonaut_runs SET state = 'failed' WHERE id = 'second'")],
    [
      "second",
      () => update("UPDATE visonaut_runs SET state = 'superseded', active = 0 WHERE id = 'second'"),
    ],
    ["second", () => update("UPDATE visonaut_runs SET state = 'accepted' WHERE id = 'second'")],
    // A run of main with no pending change and an older baseline revision.
    [
      "main",
      async () => {
        await captured(fixture.context, "main", "main");
        update("UPDATE visonaut_projects SET baseline_revision = baseline_revision + 1");
      },
    ],
  ];
  // The reads of one status call.
  const reads = async (read: () => Promise<unknown>) => {
    const before = database.preparedQueries;
    await read();
    return database.preparedQueries - before;
  };
  const shown: string[] = [];

  for (const [id, step] of steps) {
    await step();
    const run = await service.run(id);
    const project = await service.project(run.project_id);
    const comparison = run.comparison_id ? await service.comparison(run.comparison_id) : null;
    const status = await service.status(id);
    const loaded = await service.status(id, { run, project, comparison });
    expect(loaded).toEqual(status);
    // The conclusion of the check of a pull request or of main, with the rule
    // of `prepareStatusIntent`.
    const conclusion =
      loaded.status === "passed"
        ? "success"
        : loaded.status === "rejected" ||
            loaded.status === "failed" ||
            loaded.status === "needs-review"
          ? "failure"
          : "pending";
    const { title } = genericCheckOutput(
      { ...loaded, state: loaded.status },
      "https://run.example",
    );
    const saved =
      (await reads(() => service.status(id))) -
      (await reads(() => service.status(id, { run, project, comparison })));
    shown.push(`${loaded.status}, ${conclusion}, ${title}, ${saved} reads less`);
  }

  expect(shown).toEqual([
    "incomplete, pending, Capturing screenshots, 1 reads less",
    "needs-review, failure, 1 change needs review, 3 reads less",
    "rejected, failure, 1 change rejected, 3 reads less",
    "passed, success, 2 changes approved, 3 reads less",
    "comparing, pending, Comparing screenshots, 2 reads less",
    "needs-recompare, pending, Rerun needed, 2 reads less",
    "failed, failure, Capture or comparison failed, 1 reads less",
    "superseded, pending, No longer active, 1 reads less",
    "passed, success, Passed, 2 reads less",
    "needs-recompare, pending, Rerun needed, 3 reads less",
  ]);
  // A caller can have another comparison of the run. The reader does not use
  // it: the status is the same, with the reads of a call that has no rows.
  const other = await service.comparison("comparison-main");
  const status = await service.status("second");
  expect(await service.status("second", { comparison: other })).toEqual(status);
  expect(await reads(() => service.status("second", { comparison: other }))).toBe(
    await reads(() => service.status("second")),
  );
});

it("shows the counts of the run list in the check text after each decision", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  await addUndecidedChange(database, "comparison-run");
  // The run list needs the pull request number of the run.
  database.connection.exec("UPDATE visonaut_runs SET lineage_key = 'pr:7' WHERE id = 'run'");
  const patches = shownPatches(fixture);
  const steps = [
    async () => {},
    () => saveDecision(fixture, { index: 0, verdict: "rejected" }),
    () => saveDecision(fixture, { index: 1, verdict: "approved" }),
    () => saveDecision(fixture, { index: 0, verdict: "approved" }),
  ];
  const listed: string[] = [];

  for (const step of steps) {
    await step();
    await deliverGitHubStatuses(fixture.context);
    const { runs } = await dashboard({
      database,
      configuration: {
        projectId: "project",
        github: { repositoryId: "123", repository: "owner/repo" },
      },
    });
    const run = runs.find((candidate) => candidate.id === "run");
    if (!run) {
      throw new Error("Missing run.");
    }
    listed.push(
      `Changes: ${run.pending - run.rejected} need review, ${run.rejected} rejected, ${run.approved} approved.`,
    );
  }

  expect(listed).toEqual([
    "Changes: 1 need review, 0 rejected, 1 approved.",
    "Changes: 1 need review, 1 rejected, 0 approved.",
    "Changes: 0 need review, 1 rejected, 1 approved.",
    "Changes: 0 need review, 0 rejected, 2 approved.",
  ]);
  expect(patches.map((patch) => patch.output.summary.split("\n\n")[1])).toEqual(listed);
});

it("puts no item key, no variant key, and no login into the check text", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  await addUndecidedChange(database, "comparison-run");
  const patches = shownPatches(fixture);
  // A reviewer name that no sentence of the check text has.
  const actorId = "octo-reviewer-login";

  // Needs review, Rejected, and Passed for the run, then Capturing for a new run.
  await deliverGitHubStatuses(fixture.context);
  await saveDecision(fixture, { index: 0, verdict: "rejected", actorId });
  await deliverGitHubStatuses(fixture.context);
  await saveDecision(fixture, { index: 0, verdict: "approved", actorId });
  await saveDecision(fixture, { index: 1, verdict: "approved", actorId });
  await deliverGitHubStatuses(fixture.context);
  await reserve(fixture.context, "another");
  await deliverGitHubStatuses(fixture.context);

  expect(patches.map((patch) => patch.output.title)).toEqual([
    "1 change needs review",
    "1 change rejected",
    "2 changes approved",
    "Capturing screenshots",
  ]);
  const rows = await new Service(database).comparisonRows("comparison-run");
  const names = [
    ...rows.flatMap((row) => [row.item_key, row.variant_key]),
    actorId,
    // The test file of the capture and the browser of its profile.
    "private.test.ts",
    "chromium",
  ];
  expect(names).toEqual(expect.arrayContaining(["dialog", "menu", "light"]));
  const shown = JSON.stringify([
    ...patches.map((patch) => patch.output),
    ...[...fixture.state.checks.values()].map((check) => check.output),
  ]);
  for (const name of names) {
    expect(shown).not.toContain(name);
  }
});

// The case exists only for an update from before the deploy of the review
// columns that the service did not send yet.
it("sends the text of the run status for a stored update that has no review state", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  const patches = shownPatches(fixture);
  const request = fixture.context.github.request.bind(fixture.context.github);
  let failedReads = 0;
  // One failed read keeps the update in the queue.
  fixture.context.github.request = async (path, init) => {
    if (path === checkPath && !init?.method && failedReads === 0) {
      failedReads += 1;
      throw new GitHubUnavailableError(502);
    }
    return request(path, init);
  };
  await deliverGitHubStatuses(fixture.context);
  expect(readDelivery(database)).toMatchObject({ state: "pending" });
  database.connection.exec(`UPDATE work_status_outbox SET review_state = NULL,
    review_pending = NULL, review_rejected = NULL, review_approved = NULL`);

  fixture.state.time += 30_000;
  const later = await deliverGitHubStatuses(fixture.context);

  expect(later).toMatchObject({ completed: ["1"], deferred: [], attention: [] });
  expect(patches).toEqual([
    expect.objectContaining({
      status: "completed",
      conclusion: "success",
      output: expect.objectContaining({ title: "1 change approved" }),
    }),
  ]);
  expect(readDelivery(database)).toMatchObject({ state: "complete" });
});

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
