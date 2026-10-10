import { closedRunRetentionMs, Service } from "@visonaut/service";
import { afterEach, expect, it, vi } from "vitest";
import { deliverGitHubStatuses } from "./checks.ts";
import { summarizeClosedRuns } from "./closed-summary.ts";
import * as retention from "./retention.ts";
import { enqueueReview } from "./review-queue.ts";
import {
  atStepStart,
  HostileConflict,
  hostileConflictCause,
  hostileCause,
  HostileError,
  passStep,
  stepWithCause,
} from "./test-causes.ts";
import { captured, context, reserve, TestDatabase } from "./test-fixtures.ts";

// Each test gives one catch place of a step an error whose name, code, and
// message are not on a list, and reads the complete entry of the step on the
// line `operations_pass`.

afterEach(() => vi.restoreAllMocks());

const checkPath = "/repos/owner/repo/check-runs/1";

it("logs the cause when GitHub does not answer the search for a check with a lost answer", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  fixture.state.losePost = true;
  await deliverGitHubStatuses(fixture.context);
  fixture.context.github.request = async () => {
    throw new HostileError();
  };
  const { entry } = await passStep({
    context: fixture.context,
    message: { kind: "status" },
    step: "checks",
  });
  expect(entry).toEqual(stepWithCause({ completed: 0, deferred: 0, attention: 1 }, hostileCause));
});

it("logs the cause of a failed check creation", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  fixture.context.github.request = async () => {
    throw new HostileError();
  };
  const { entry } = await passStep({
    context: fixture.context,
    message: { kind: "status" },
    step: "checks",
  });
  expect(entry).toEqual(stepWithCause({ completed: 0, deferred: 0, attention: 1 }, hostileCause));
});

it("logs the cause when the second attempt to prepare a status update has a conflict", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  const prepare = vi
    .spyOn(Service.prototype, "prepareStatusIntent")
    .mockRejectedValue(new HostileConflict());
  const { entry } = await passStep({
    context: fixture.context,
    message: { kind: "status" },
    step: "checks",
  });
  expect(prepare).toHaveBeenCalledTimes(2);
  // The two conflicts of one run are one cause: the run waits one time.
  expect(entry).toEqual(
    stepWithCause({ completed: 0, deferred: 1, attention: 0 }, hostileConflictCause),
  );
});

it("logs the cause of a failed read of the check sender", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    if (path === checkPath && !init?.method) {
      throw new HostileError();
    }
    return request(path, init);
  };
  const { entry } = await passStep({
    context: fixture.context,
    message: { kind: "status" },
    step: "checks",
  });
  expect(entry).toEqual(stepWithCause({ completed: 0, deferred: 1, attention: 0 }, hostileCause));
});

it("logs the cause of a failed write of the check sender", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await reserve(fixture.context);
  const request = fixture.context.github.request.bind(fixture.context.github);
  fixture.context.github.request = async (path, init) => {
    if (init?.method === "PATCH") {
      throw new HostileError();
    }
    return request(path, init);
  };
  const { entry } = await passStep({
    context: fixture.context,
    message: { kind: "status" },
    step: "checks",
  });
  expect(entry).toEqual(stepWithCause({ completed: 0, deferred: 0, attention: 1 }, hostileCause));
});

it("logs the cause of a comparison that the service cannot finalize", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context);
  // The comparison waits for its finalization again.
  database.connection.exec(
    "UPDATE visonaut_comparisons SET state='comparing' WHERE id='comparison-run'",
  );
  vi.spyOn(Service.prototype, "finalizeComparison").mockRejectedValue(new HostileError());
  const { entry } = await passStep({
    context: fixture.context,
    message: { kind: "ingest" },
    step: "finalization",
  });
  expect(entry).toEqual(stepWithCause({ completed: 0, deferred: 0, attention: 1 }, hostileCause));
});

interface QueuedDecisionParams {
  database: TestDatabase;
  fixture: ReturnType<typeof context>;
}

async function queueDecision({ database, fixture }: QueuedDecisionParams) {
  const service = await captured(fixture.context);
  const row = (await service.comparisonRows("comparison-run"))[0];
  if (!row) {
    throw new Error("Missing comparison");
  }
  await enqueueReview(database, {
    commandId: "command",
    actorId: "actor",
    sessionId: "session",
    comparisonId: "comparison-run",
    verdict: "rejected",
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: "dialog", variantKey: "light" },
  });
  // The task is due at the real time of its send.
  fixture.state.time = Date.now();
}

it("logs the cause of a queued decision that the service refuses", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await queueDecision({ database, fixture });
  vi.spyOn(Service.prototype, "review").mockRejectedValue(new HostileConflict());
  const { entry } = await passStep({
    context: fixture.context,
    message: { kind: "status" },
    step: "review-decisions",
  });
  expect(entry).toEqual(
    stepWithCause({ completed: 0, deferred: 0, attention: 1 }, hostileConflictCause),
  );
});

it("logs the cause of a queued decision that the pass tries again", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await queueDecision({ database, fixture });
  vi.spyOn(Service.prototype, "review").mockRejectedValue(new HostileError());
  const { entry } = await passStep({
    context: fixture.context,
    message: { kind: "status" },
    step: "review-decisions",
  });
  expect(entry).toEqual(stepWithCause({ completed: 0, deferred: 1, attention: 0 }, hostileCause));
});

it("logs the cause of a failed promotion on the pass line and on the line of the run", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  await captured(fixture.context, "seed", "main");
  vi.spyOn(fixture.images, "get").mockRejectedValue(new HostileError());
  const { entry, lines } = await passStep({
    context: fixture.context,
    message: { kind: "status" },
    step: "promotion",
  });
  expect(entry).toEqual(stepWithCause({ completed: 0, deferred: 0, attention: 1 }, hostileCause));
  expect(lines.filter((line) => line.event === "baseline_promotion_step")).toEqual([
    {
      event: "baseline_promotion_step",
      runId: "seed",
      verifyRows: expect.any(Number),
      verifyBytes: expect.any(Number),
      elapsedMs: expect.any(Number),
      leaseRemainingMs: expect.any(Number),
      outcome: "attention",
      cause: hostileCause,
    },
  ]);
});

it("logs the cause of a failed summary of a closed run", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await captured(fixture.context, "closed");
  await service.retireRun({ runId: "closed", now: fixture.state.time });
  fixture.state.time += closedRunRetentionMs + 1;
  vi.spyOn(database, "batch").mockRejectedValue(new HostileError());
  const { entry } = await passStep({
    context: fixture.context,
    message: { kind: "maintenance", family: "history" },
    step: "history",
  });
  expect(entry).toEqual(stepWithCause({ completed: 0, deferred: 0, attention: 1 }, hostileCause));
});

it("logs the cause of a failed image deletion of a closed run", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await reserve(fixture.context, "closed");
  await service.retireRun({ runId: "closed", now: fixture.state.time });
  fixture.state.time += closedRunRetentionMs + 1;
  expect((await summarizeClosedRuns(fixture.context)).completed).toEqual(["closed"]);
  // The steps before this one also list objects.
  atStepStart(retention, "expireRunImages", () => {
    vi.spyOn(fixture.images, "list").mockRejectedValue(new HostileError());
  });
  const { entry } = await passStep({
    context: fixture.context,
    message: { kind: "maintenance", family: "retention" },
    step: "retention",
  });
  expect(entry).toEqual(stepWithCause({ completed: 0, deferred: 0, attention: 1 }, hostileCause));
});
