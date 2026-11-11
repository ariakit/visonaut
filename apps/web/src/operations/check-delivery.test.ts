import { checkText, GitHubUnavailableError } from "@visonaut/security";
import { reviewCountsOrZero, Service } from "@visonaut/service";
import { expect, it, vi } from "vitest";
import { deliverGitHubStatuses, deliverRunStatus } from "./checks.ts";
import {
  addUndecidedChange,
  captured,
  context,
  reserve,
  shownStatus,
  TestDatabase,
} from "./test-fixtures.ts";

type Fixture = ReturnType<typeof context>;

/** The tested commit of each fixture run. */
const testedCommit = "a".repeat(40);

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

/** The descriptions of the statuses that reached GitHub, oldest first. */
function postedTitles(fixture: Fixture, sha = testedCommit) {
  return fixture.state.statuses
    .filter((status) => status.sha === sha)
    .map((status) => status.description)
    .reverse();
}

function isStatusRead(path: string, init?: RequestInit) {
  return !init?.method && /\/commits\/[a-f0-9]{40}\/statuses\?/.test(path);
}

/** The next status POST fails before it reaches GitHub. */
function dropNextPost(fixture: Fixture) {
  const request = fixture.context.github.request.bind(fixture.context.github);
  let dropped = false;
  fixture.context.github.request = async (path, init) => {
    if (init?.method === "POST" && !dropped) {
      dropped = true;
      throw new Error("Lost POST request.");
    }
    return request(path, init);
  };
}

/**
 * Move a fixture run to its own tested commit. Each fixture run tests the same
 * commit, and the runs of one commit share its status.
 */
function moveToCommit(database: TestDatabase, runId: string, sha: string) {
  database.connection
    .prepare("UPDATE visonaut_runs SET tested_sha = ? WHERE id = ?")
    .run(sha, runId);
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

  await deliverGitHubStatuses(fixture.context);
  await reject(fixture, "run", 0);
  await deliverGitHubStatuses(fixture.context);
  const revision = desiredRevision(database);
  // The second Reject changes no state and no conclusion: only two counts.
  await reject(fixture, "run", 1);
  await deliverGitHubStatuses(fixture.context);

  expect(desiredRevision(database)).toBeGreaterThan(Number(revision));
  expect(fixture.state.statuses.map((status) => [status.state, status.description])).toEqual([
    ["failure", "2 changes rejected"],
    ["failure", "1 change rejected"],
    ["failure", "1 change needs review"],
  ]);

  // A later event of another run changes no count of this run: no POST.
  const anotherCommit = "b".repeat(40);
  fixture.state.time += 60_000;
  await reserve(fixture.context, "another");
  moveToCommit(database, "another", anotherCommit);
  await deliverGitHubStatuses(fixture.context);
  expect(fixture.state.posts).toBe(4);
  expect(postedTitles(fixture).at(-1)).toBe("2 changes rejected");
  expect(postedTitles(fixture, anotherCommit)).toEqual(["Capturing screenshots"]);
});

it("sends no status of an update when a decision commits after the claim", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  const request = fixture.context.github.request.bind(fixture.context.github);
  let decided = false;
  // The sender reads the status after the claim. The decision commits at that read.
  fixture.context.github.request = async (path, init) => {
    if (isStatusRead(path, init) && !decided) {
      decided = true;
      await reject(fixture, "run");
    }
    return request(path, init);
  };

  const first = await deliverGitHubStatuses(fixture.context);

  // The claimed update has the counts from before the decision, so it is not sent.
  expect(first).toMatchObject({ completed: [], deferred: ["1"], attention: [] });
  expect(fixture.state.posts).toBe(0);

  const next = await deliverGitHubStatuses(fixture.context);

  expect(next).toMatchObject({ completed: ["1"], attention: [] });
  expect(postedTitles(fixture)).toEqual(["1 change rejected"]);
});

it("sends an update two minutes after the invocation that claimed it stopped", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  // The production budget, so the check lease does not come from a short test budget.
  fixture.context.budget.leaseMilliseconds = 12 * 60 * 1000;
  await captured(fixture.context);
  const request = fixture.context.github.request.bind(fixture.context.github);
  let claim = () => {};
  const claimed = new Promise<void>((resolve) => {
    claim = resolve;
  });
  // The platform cancels the invocation while it reads the status after the
  // claim, so the pass never settles its lease.
  fixture.context.github.request = async (path, init) => {
    if (isStatusRead(path, init)) {
      claim();
      return new Promise(() => {});
    }
    return request(path, init);
  };
  void deliverGitHubStatuses(fixture.context);
  await claimed;
  fixture.context.github.request = request;

  fixture.state.time += 2 * 60 * 1000 - 1;
  const early = await deliverGitHubStatuses(fixture.context);

  expect(early).toMatchObject({ completed: [], deferred: [], attention: [] });
  expect(fixture.state.posts).toBe(0);

  fixture.state.time += 1;
  const late = await deliverGitHubStatuses(fixture.context);

  expect(late).toMatchObject({ completed: ["1"], attention: [] });
  expect(fixture.state.posts).toBe(1);
  expect(readDelivery(database)).toMatchObject({ ambiguous: 0, state: "complete" });
});

function openCheckAlerts(database: TestDatabase) {
  return database.connection
    .prepare(
      "SELECT code FROM operations_events WHERE kind='check-delivery' AND resolved_at IS NULL",
    )
    .all();
}

/** A shown first result, then a Reject whose POST does not reach GitHub, so the check is locked. */
async function lockAfterReject(database: TestDatabase, fixture: Fixture) {
  await captured(fixture.context);
  await addUndecidedChange(database, "comparison-run");
  await deliverGitHubStatuses(fixture.context);
  const request = fixture.context.github.request;
  dropNextPost(fixture);
  await reject(fixture, "run", 0);
  expect((await deliverGitHubStatuses(fixture.context)).attention).toEqual(["1"]);
  fixture.context.github.request = request;
}

// The lease of the test budget (1 minute), and then one more lease of 2 minutes.
const lockReleaseTime = 3 * 60 * 1000;

it("releases the lock of a POST that did not reach GitHub, and sends the newest update", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await lockAfterReject(database, fixture);
  await reject(fixture, "run", 1);

  fixture.state.time += lockReleaseTime - 1;
  const early = await deliverGitHubStatuses(fixture.context);

  expect(early).toMatchObject({ completed: [], attention: ["1"] });

  fixture.state.time += 1;
  const late = await deliverGitHubStatuses(fixture.context);

  expect(late).toMatchObject({ completed: ["1"], attention: [] });
  expect(postedTitles(fixture)).toEqual(["1 change needs review", "2 changes rejected"]);
  expect(readDelivery(database)).toMatchObject({
    ambiguous: 0,
    lease_token: null,
    state: "complete",
  });
  expect(openCheckAlerts(database)).toEqual([]);
});

it("settles a locked update that GitHub shows, and sends no POST again", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  await addUndecidedChange(database, "comparison-run");
  await deliverGitHubStatuses(fixture.context);
  fixture.state.losePost = true;
  await reject(fixture, "run", 0);
  expect((await deliverGitHubStatuses(fixture.context)).attention).toEqual(["1"]);
  const posts = fixture.state.posts;

  fixture.state.time += lockReleaseTime;
  const report = await deliverGitHubStatuses(fixture.context);

  expect(report).toMatchObject({ completed: [], attention: [] });
  expect(fixture.state.posts).toBe(posts);
  expect(shownStatus(fixture.state)).toMatchObject({ description: "1 change rejected" });
  expect(readDelivery(database)).toMatchObject({ ambiguous: 0, state: "complete" });
  expect(
    database.connection
      .prepare("SELECT desired_revision - delivered_revision AS behind FROM work_checks")
      .get(),
  ).toEqual({ behind: 0 });
  expect(openCheckAlerts(database)).toEqual([]);
});

it("settles a locked pending update that GitHub shows as a pending status", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  fixture.state.losePost = true;
  expect((await deliverGitHubStatuses(fixture.context)).attention).toEqual(["1"]);
  expect(shownStatus(fixture.state)).toMatchObject({
    state: "pending",
    description: "Capturing screenshots",
  });

  fixture.state.time += lockReleaseTime;
  const report = await deliverGitHubStatuses(fixture.context);

  expect(report).toMatchObject({ completed: [], attention: [] });
  expect(fixture.state.posts).toBe(1);
  expect(readDelivery(database)).toMatchObject({ ambiguous: 0, state: "complete" });
});

it("releases the lock of the first update when the commit has no status", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  dropNextPost(fixture);
  expect((await deliverGitHubStatuses(fixture.context)).attention).toEqual(["1"]);
  expect(fixture.state.statuses).toEqual([]);

  fixture.state.time += lockReleaseTime;
  const report = await deliverGitHubStatuses(fixture.context);

  expect(report).toMatchObject({ completed: ["1"], attention: [] });
  expect(postedTitles(fixture)).toEqual(["Capturing screenshots"]);
  expect(readDelivery(database)).toMatchObject({ ambiguous: 0, state: "complete" });
  expect(openCheckAlerts(database)).toEqual([]);
});

it("keeps the lock when the read of the status fails, and releases it after a later read", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await lockAfterReject(database, fixture);
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    if (isStatusRead(path, init)) {
      throw new GitHubUnavailableError(502);
    }
    return request(path, init);
  };

  fixture.state.time += lockReleaseTime;
  const failedRead = await deliverGitHubStatuses(fixture.context);

  expect(failedRead).toMatchObject({
    completed: [],
    attention: ["1"],
    causes: [expect.objectContaining({ code: "github_unavailable", upstreamStatus: 502 })],
  });
  expect(fixture.state.posts).toBe(1);
  expect(readDelivery(database)).toMatchObject({ ambiguous: 1, state: "sending" });
  expect(openCheckAlerts(database)).toEqual([{ code: "ambiguous" }]);

  fixture.context.github.request = request;
  const read = await deliverGitHubStatuses(fixture.context);

  expect(read).toMatchObject({ completed: ["1"], attention: [] });
  expect(postedTitles(fixture)).toEqual(["1 change needs review", "1 change rejected"]);
  expect(openCheckAlerts(database)).toEqual([]);
});

// The required check of a ruleset accepts only the status of the App.
it("sends the locked update again when the newest status has another creator", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await lockAfterReject(database, fixture);
  // Another user writes the text of the locked update.
  fixture.state.statuses.unshift({
    state: "failure",
    description: "1 change rejected",
    target_url: "https://visonaut.example/runs/run",
    context: "Visonaut",
    sha: testedCommit,
    creator: { id: 7 },
  });

  fixture.state.time += lockReleaseTime;
  const report = await deliverGitHubStatuses(fixture.context);

  expect(report).toMatchObject({ completed: ["1"], attention: [] });
  expect(fixture.state.posts).toBe(2);
  expect(shownStatus(fixture.state)).toMatchObject({
    description: "1 change rejected",
    creator: { id: 99 },
  });
  expect(readDelivery(database)).toMatchObject({ ambiguous: 0, state: "complete" });
  expect(openCheckAlerts(database)).toEqual([]);
});

// D-OPS-02: a review that waits for a maintainer must block the merge.
it("keeps the status in the state failure while a review waits", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await captured(fixture.context);
  await addUndecidedChange(database, "comparison-run");

  await deliverGitHubStatuses(fixture.context);

  expect((await service.status("run")).status).toBe("needs-review");
  expect(fixture.state.statuses).toEqual([
    expect.objectContaining({
      sha: testedCommit,
      context: "Visonaut",
      state: "failure",
      description: "1 change needs review",
      target_url: "https://visonaut.example/runs/run",
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
    const { title } = checkText({ state: loaded.status, ...reviewCountsOrZero(loaded) });
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

it("puts no item key, no variant key, and no login into the status", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  await addUndecidedChange(database, "comparison-run");
  // A reviewer name that no sentence of the status has.
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

  expect(postedTitles(fixture)).toEqual([
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
  const shown = JSON.stringify(fixture.state.statuses);
  for (const name of names) {
    expect(shown).not.toContain(name);
  }
});

// An update that the service stored before the review columns has no review
// state, and no text to send. The sender must not read the status of its run
// and send a text that the update does not own.
it("sends no request for a stored update that has no review state", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  const requests: string[] = [];
  const request = fixture.context.github.request.bind(fixture.context.github);
  let failedReads = 0;
  // One failed read keeps the update in the queue.
  fixture.context.github.request = async (path, init) => {
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (isStatusRead(path, init) && failedReads === 0) {
      failedReads += 1;
      throw new GitHubUnavailableError(502);
    }
    return request(path, init);
  };
  await deliverGitHubStatuses(fixture.context);
  expect(readDelivery(database)).toMatchObject({ state: "pending" });
  database.connection.exec(`UPDATE work_status_outbox SET review_state = NULL,
    review_pending = NULL, review_rejected = NULL, review_approved = NULL`);
  requests.length = 0;
  const statusRead = vi.spyOn(Service.prototype, "status");

  fixture.state.time += 30_000;
  const first = await deliverGitHubStatuses(fixture.context);

  // The pass uses the last attempt of the update. A dead update asks for attention.
  expect(first).toMatchObject({ completed: [], deferred: ["1"], attention: [] });
  expect(readDelivery(database)).toMatchObject({ state: "dead" });
  expect(await deliverGitHubStatuses(fixture.context)).toMatchObject({
    completed: [],
    attention: ["1"],
  });
  expect(requests).toEqual([]);
  expect(fixture.state.posts).toBe(0);
  expect(statusRead).not.toHaveBeenCalled();
  statusRead.mockRestore();
});

it("delivers an update in a later pass after one failed read of its status", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  const request = fixture.context.github.request.bind(fixture.context.github);
  let failedReads = 0;
  fixture.context.github.request = async (path, init) => {
    if (isStatusRead(path, init) && failedReads === 0) {
      failedReads += 1;
      throw new GitHubUnavailableError(502);
    }
    return request(path, init);
  };

  const failed = await deliverGitHubStatuses(fixture.context);

  // The update waits, so one more pass at once has no update that is due.
  expect(failed).toEqual({
    completed: [],
    deferred: ["1"],
    attention: [],
    hasMore: false,
    causes: [
      { errorName: "SecurityError", code: "github_unavailable", upstreamStatus: 502, count: 1 },
    ],
  });
  expect(failedReads).toBe(1);
  expect(fixture.state.posts).toBe(0);
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
  expect(fixture.state.posts).toBe(0);

  fixture.state.time += 1;
  const later = await deliverGitHubStatuses(fixture.context);
  expect(later).toMatchObject({ completed: ["1"], deferred: [], attention: [] });
  expect(fixture.state.posts).toBe(1);
  expect(readDelivery(database)).toMatchObject({ ambiguous: 0, state: "complete" });
});

it("asks for no more pass when the one update belongs to a locked check", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  fixture.state.losePost = true;
  expect((await deliverGitHubStatuses(fixture.context)).attention).toEqual(["1"]);

  // A later event of another run gives the locked check a newer update.
  await reserve(fixture.context, "another");
  moveToCommit(database, "another", "b".repeat(40));
  expect((await deliverGitHubStatuses(fixture.context)).completed).toEqual(["2"]);
  expect(readDelivery(database)).toMatchObject({ ambiguous: 1, state: "pending" });

  for (let pass = 0; pass < 2; pass += 1) {
    const report = await deliverGitHubStatuses(fixture.context);
    expect(report).toEqual({ completed: [], deferred: [], attention: ["1"], hasMore: false });
  }
  expect(fixture.state.posts).toBe(2);
});

it("sends no POST for an unchanged result that GitHub shows after a later event", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);

  expect((await deliverGitHubStatuses(fixture.context)).completed).toEqual(["1"]);
  expect(shownStatus(fixture.state)).toMatchObject({ state: "success" });

  fixture.state.time += 60_000;
  await reserve(fixture.context, "another");
  moveToCommit(database, "another", "b".repeat(40));
  expect((await deliverGitHubStatuses(fixture.context)).completed).toEqual(["1", "2"]);

  expect(fixture.state.statuses.map((status) => status.target_url)).toEqual([
    "https://visonaut.example/runs/another",
    "https://visonaut.example/runs/run",
  ]);
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
  expect(fixture.state.posts).toBe(3);
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
  expect(fixture.state.posts).toBe(2);
  expect(currentChecks(database)).toEqual(["2", "3"]);
  expect(database.connection.prepare("SELECT * FROM operations_events").all()).toEqual([]);

  const next = await deliverGitHubStatuses(fixture.context);

  expect(next).toMatchObject({ completed: ["1"], deferred: [], attention: [] });
  expect(fixture.state.posts).toBe(3);
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
    expect(fixture.state.posts).toBe(1);
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

// A pre-run fence writes the pre-run state and then reads the request mark. So
// one of the fence and the sender must see the write of the other.
it("sends no POST when a pre-run fence closes the check directly before the request mark", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  database.connection
    .prepare(`INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,
      kind,ref,pull_request_number,external_id,check_id,state,docs_only,plan_visual_required,
      workflow_run_id,workflow_attempt,created_at,updated_at)
      VALUES(?,0,'123',?,?,'pull_request','refs/pull/1/merge',1,'visonaut:run','1','active',0,1,
        'run',1,1,1)`)
    .run(testedCommit, "b".repeat(40), "c".repeat(40));
  let fenceSawSend: unknown = null;
  const prepare = database.prepare.bind(database);
  database.prepare = (sql) => {
    if (fenceSawSend === null && sql.includes("SET request_started = 1")) {
      database.connection.exec("UPDATE pre_run_checks SET state='failed' WHERE check_id='1'");
      fenceSawSend =
        database.connection
          .prepare("SELECT 1 FROM work_checks WHERE id='1' AND (request_started=1 OR ambiguous=1)")
          .get() ?? false;
    }
    return prepare(sql);
  };
  await deliverGitHubStatuses(fixture.context);
  expect(fenceSawSend).toBe(false);
  expect(fixture.state.posts).toBe(0);
  expect(readDelivery(database)).toMatchObject({ ambiguous: 0, lease_token: null });
});

it("sends the status of the reviewed run only, without the other runs of the project", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  for (const id of ["first", "second"]) {
    await captured(fixture.context, id);
  }
  moveToCommit(database, "second", "b".repeat(40));
  await deliverGitHubStatuses(fixture.context);
  const otherRevision = () =>
    database.connection.prepare("SELECT desired_revision FROM work_checks WHERE id = '2'").get();
  const other = otherRevision();
  // The decision changes the revision of the project of the two runs.
  await reject(fixture, "first");

  const report = await deliverRunStatus(fixture.context, "first");

  expect(report).toMatchObject({ completed: ["1"], deferred: [], attention: [] });
  expect(postedTitles(fixture)).toEqual(["1 change approved", "1 change rejected"]);
  expect(fixture.state.posts).toBe(3);
  expect(currentChecks(database)).toEqual(["1"]);
  // The other run gets no new update before the next pass.
  expect(otherRevision()).toEqual(other);
});

it("sends the newest update of the run when a decision commits during its send", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  await deliverGitHubStatuses(fixture.context);
  await addUndecidedChange(database, "comparison-run");
  await reject(fixture, "run", 0);
  const request = fixture.context.github.request.bind(fixture.context.github);
  let decided = false;
  // The sender reads the status after the claim. A second decision commits at
  // that read, so the claimed update is obsolete.
  fixture.context.github.request = async (path, init) => {
    if (isStatusRead(path, init) && !decided) {
      decided = true;
      await reject(fixture, "run", 1);
    }
    return request(path, init);
  };

  const report = await deliverRunStatus(fixture.context, "run");

  expect(report).toMatchObject({ completed: ["1"], attention: [] });
  expect(postedTitles(fixture)).toEqual(["1 change approved", "2 changes rejected"]);
  expect(currentChecks(database)).toEqual(["1"]);
});

it("sends the newest update of the run when a decision commits during its POST", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  await deliverGitHubStatuses(fixture.context);
  await addUndecidedChange(database, "comparison-run");
  await reject(fixture, "run", 0);
  const request = fixture.context.github.request.bind(fixture.context.github);
  let decided = false;
  let concurrent: Awaited<ReturnType<typeof deliverRunStatus>> | undefined;
  // A second decision commits after the request mark. The request of that
  // decision finds the check leased.
  fixture.context.github.request = async (path, init) => {
    if (init?.method === "POST" && !decided) {
      decided = true;
      await reject(fixture, "run", 1);
      concurrent = await deliverRunStatus(fixture.context, "run");
    }
    return request(path, init);
  };

  const report = await deliverRunStatus(fixture.context, "run");

  expect(concurrent).toMatchObject({ completed: [] });
  expect(report).toMatchObject({ completed: ["1", "1"], attention: [] });
  expect(postedTitles(fixture)).toEqual([
    "1 change approved",
    "1 change rejected",
    "2 changes rejected",
  ]);
  expect(currentChecks(database)).toEqual(["1"]);
});

it("sends no request for a run that has no check", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  // Workflow materialization adopts no pre-run check for this run.
  database.connection.exec("DELETE FROM operations_check_creations");
  const request = vi.spyOn(fixture.context.github, "request");

  const report = await deliverRunStatus(fixture.context, "run");

  expect(report).toMatchObject({ completed: [], deferred: [], attention: [] });
  expect(request).not.toHaveBeenCalled();
});

const statusCommit = "b".repeat(40);

/**
 * A run whose check is the pre-run row of its pull request head, as workflow
 * materialization adopts it. Its status goes to the head of the pull request.
 */
async function statusRun(database: TestDatabase, fixture: Fixture) {
  await captured(fixture.context);
  const now = fixture.context.now();
  database.connection
    .prepare(
      `INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,
        pull_request_number,docs_only,external_id,check_id,check_head_sha,state,
        plan_visual_required,workflow_run_id,workflow_attempt,created_at,updated_at)
      VALUES(?,0,'123',?,?,'pull_request','refs/pull/7/merge',7,0,'visonaut:run','1',?,'active',
        1,'run',1,?,?)`,
    )
    .run(testedCommit, statusCommit, "c".repeat(40), statusCommit, now, now);
}

/** A newer merge of the same pull request head starts the commit status. */
function startNewerRow(database: TestDatabase, fixture: Fixture) {
  const now = fixture.context.now() + 1;
  database.connection
    .prepare(
      `INSERT INTO pre_run_checks(tested_sha,generation,repository_id,source_sha,base_sha,kind,ref,
        pull_request_number,docs_only,external_id,check_id,check_head_sha,state,created_at,updated_at)
      VALUES(?,0,'123',?,?,'pull_request','refs/pull/7/merge',7,0,'newer','newer',?,'active',?,?)`,
    )
    .run("d".repeat(40), statusCommit, "c".repeat(40), statusCommit, now, now);
}

it("sends the update of a pre-run row as the commit status of its pull request head", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await statusRun(database, fixture);

  const report = await deliverGitHubStatuses(fixture.context);

  expect(report).toMatchObject({ completed: ["1"], attention: [] });
  expect(fixture.state.statuses).toEqual([
    expect.objectContaining({
      sha: statusCommit,
      context: "Visonaut",
      target_url: "https://visonaut.example/runs/run",
    }),
  ]);

  // GitHub shows the same status of the App, so a repeated pass posts nothing.
  await database.prepare("UPDATE work_checks SET delivered_revision=NULL").run();
  await database.prepare("UPDATE work_status_outbox SET state='pending'").run();
  await deliverGitHubStatuses(fixture.context);
  expect(fixture.state.posts).toBe(1);
});

it("sends no update of a pre-run row whose commit status a newer row started", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await statusRun(database, fixture);
  startNewerRow(database, fixture);

  await deliverGitHubStatuses(fixture.context);

  expect(fixture.state.posts).toBe(0);
});

it("sends the update of a pre-run row again after a POST that did not reach GitHub", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await statusRun(database, fixture);
  dropNextPost(fixture);

  const first = await deliverGitHubStatuses(fixture.context);
  expect(first).toMatchObject({ completed: [], attention: ["1"] });
  expect(fixture.state.statuses).toEqual([]);

  // After the lease and the delay of the lock, the head of the pull request
  // does not show the update, so the pass releases the lock and posts again.
  fixture.state.time += lockReleaseTime;
  const next = await deliverGitHubStatuses(fixture.context);

  expect(next).toMatchObject({ completed: ["1"], attention: [] });
  expect(postedTitles(fixture, statusCommit)).toEqual(["1 change approved"]);
  expect(readDelivery(database)).toMatchObject({ ambiguous: 0, state: "complete" });
});

it("settles the update of a pre-run row that its pull request head shows after a POST with no answer", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await statusRun(database, fixture);
  fixture.state.losePost = true;

  const first = await deliverGitHubStatuses(fixture.context);
  expect(first).toMatchObject({ completed: [], attention: ["1"] });
  expect(fixture.state.posts).toBe(1);

  // GitHub shows the locked update, so the pass settles it and posts nothing.
  fixture.state.time += lockReleaseTime;
  await deliverGitHubStatuses(fixture.context);
  await deliverGitHubStatuses(fixture.context);

  expect(fixture.state.posts).toBe(1);
  expect(readDelivery(database)).toMatchObject({ ambiguous: 0, state: "complete" });
});

it("settles an update that GitHub shows after its last attempt lost its answer", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  // The fixture budget has 2 attempts. The first POST does not reach GitHub,
  // and the second one reaches GitHub and loses its answer.
  dropNextPost(fixture);
  fixture.state.losePost = true;
  const lockAndRelease = async () => {
    await deliverGitHubStatuses(fixture.context);
    fixture.state.time += lockReleaseTime;
    await deliverGitHubStatuses(fixture.context);
  };

  await lockAndRelease();
  await lockAndRelease();

  expect(fixture.state.posts).toBe(1);
  expect(readDelivery(database)).toMatchObject({ ambiguous: 0, state: "complete" });
  expect(
    database.connection
      .prepare("SELECT code FROM operations_events WHERE resolved_at IS NULL")
      .all(),
  ).toEqual([]);
});

it("closes the alert of a dead update of a pre-run row whose commit status a newer row started", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await statusRun(database, fixture);
  await deliverGitHubStatuses(fixture.context);
  // A decision gives a new update, and the update ends dead.
  await reject(fixture, "run");
  await deliverGitHubStatuses(fixture.context);
  await database
    .prepare(
      "UPDATE work_status_outbox SET state='dead' WHERE revision=(SELECT desired_revision FROM work_checks)",
    )
    .run();
  const dead = await deliverGitHubStatuses(fixture.context);
  expect(dead.attention).toEqual(["1"]);
  startNewerRow(database, fixture);

  const closed = await deliverGitHubStatuses(fixture.context);

  expect(closed.attention).toEqual([]);
  expect(
    database.connection
      .prepare(
        "SELECT code, resolved_at IS NOT NULL AS resolved FROM operations_events WHERE kind='check-delivery'",
      )
      .all(),
  ).toEqual([{ code: "exhausted", resolved: 1 }]);
});
