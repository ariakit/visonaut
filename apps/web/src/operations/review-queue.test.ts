import { afterEach, expect, it, vi } from "vitest";
import { getWork, Service } from "@visonaut/service";
import { captured, context, TestDatabase } from "./test-fixtures.ts";
import { operationsStatus } from "../api/operations.ts";
import { enqueueReview, processReviewQueue, reviewTaskId } from "./review-queue.ts";

afterEach(() => vi.restoreAllMocks());

it("replays a decision after a worker failure without applying it twice", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  fixture.state.time = Date.now();
  const service = await captured(fixture.context);
  const row = (await service.comparisonRows("comparison-run"))[0];
  if (!row) throw new Error("Missing comparison");
  const input = {
    commandId: "review-retry",
    actorId: "actor",
    sessionId: "session",
    comparisonId: "comparison-run",
    verdict: "rejected" as const,
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: "dialog", variantKey: "light" },
  };
  await enqueueReview(database, input);
  fixture.state.time = Date.now();
  const review = Service.prototype.review;
  vi.spyOn(Service.prototype, "review").mockImplementationOnce(async function (
    this: Service,
    input,
  ) {
    await review.call(this, input);
    throw new Error("Worker interrupted after committing the decision");
  });
  const interrupted = await processReviewQueue(fixture.context);
  expect(interrupted).toMatchObject({ deferred: [reviewTaskId(input.commandId)], hasMore: true });
  expect((await service.comparisonRows("comparison-run"))[0]?.decision_revision).toBe(
    row.decision_revision + 1,
  );
  await processReviewQueue(fixture.context);
  const task = await getWork(database, reviewTaskId(input.commandId));
  expect(task).toMatchObject({ state: "complete", attempts: 2 });
  expect(JSON.parse(task?.result ?? "{}")).toMatchObject({ commandId: input.commandId });
  expect((await service.comparisonRows("comparison-run"))[0]?.decision_revision).toBe(
    row.decision_revision + 1,
  );
});

it("accepts a predecessor from another review session of the same reviewer only", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await captured(fixture.context);
  const row = (await service.comparisonRows("comparison-run"))[0];
  if (!row) throw new Error("Missing comparison");
  const input = {
    commandId: "first",
    actorId: "actor",
    sessionId: "session",
    comparisonId: "comparison-run",
    verdict: "rejected" as const,
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: "dialog", variantKey: "light" },
  };
  await enqueueReview(database, input);
  await expect(
    enqueueReview(database, {
      ...input,
      commandId: "other-reviewer",
      previousCommandId: "first",
      actorId: "another",
    }),
  ).rejects.toThrow("another reviewer or comparison");
  expect(await getWork(database, reviewTaskId("other-reviewer"))).toBeNull();
  // The review session of the page ended, and the same reviewer got a new one.
  expect(
    await enqueueReview(database, {
      ...input,
      commandId: "second",
      previousCommandId: "first",
      sessionId: "renewed",
    }),
  ).toBe("queued");
  expect(await getWork(database, reviewTaskId("second"))).toMatchObject({ state: "queued" });
});

it("keeps a stored decision as it is when it comes again with another review session", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await captured(fixture.context);
  const row = (await service.comparisonRows("comparison-run"))[0];
  if (!row) throw new Error("Missing comparison");
  const input = {
    commandId: "first",
    actorId: "actor",
    sessionId: "session",
    comparisonId: "comparison-run",
    verdict: "rejected" as const,
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: "dialog", variantKey: "light" },
  };
  await enqueueReview(database, input);
  const stored = await getWork(database, reviewTaskId("first"));
  expect(await enqueueReview(database, { ...input, sessionId: "renewed" })).toBe("queued");
  expect(await getWork(database, reviewTaskId("first"))).toEqual(stored);
  expect(JSON.parse(stored?.payload ?? "{}")).toMatchObject({ sessionId: "session" });
  // The same command ID with another decision or another reviewer is refused.
  for (const change of [{ verdict: "approved" as const }, { actorId: "another" }]) {
    await expect(
      enqueueReview(database, { ...input, sessionId: "renewed", ...change }),
    ).rejects.toThrow("This command ID already belongs to another decision.");
  }
  expect(await getWork(database, reviewTaskId("first"))).toEqual(stored);
});

it("starts an exact command ahead of unrelated review work and waits for its predecessor", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await captured(fixture.context);
  const row = (await service.comparisonRows("comparison-run"))[0];
  if (!row) throw new Error("Missing comparison");
  const input = {
    commandId: "older-unrelated",
    actorId: "actor",
    sessionId: "session",
    comparisonId: "comparison-run",
    verdict: "rejected" as const,
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: "dialog", variantKey: "light" },
  };
  await enqueueReview(database, input);
  await enqueueReview(database, { ...input, commandId: "target" });
  await enqueueReview(database, {
    ...input,
    commandId: "next",
    previousCommandId: "target",
    targets: [{ id: row.id, expectedRevision: row.decision_revision + 1 }],
    verdict: "approved",
  });
  const plans: string[][] = [];
  const prepare = database.prepare.bind(database);
  vi.spyOn(database, "prepare").mockImplementation((sql) => {
    const statement = prepare(sql);
    if (sql.startsWith("SELECT task.id FROM work_tasks task")) {
      const bind = statement.bind.bind(statement);
      vi.spyOn(statement, "bind").mockImplementation((...values) => {
        const bindings = values.map((value) =>
          value instanceof ArrayBuffer ? new Uint8Array(value) : value,
        );
        const plan = database.connection.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings);
        plans.push(plan.map((row) => String(row.detail)));
        return bind(...values);
      });
    }
    return statement;
  });
  fixture.state.time = Date.now();
  expect((await processReviewQueue(fixture.context, "next")).completed).toEqual([]);
  expect(await getWork(database, reviewTaskId("next"))).toMatchObject({
    state: "queued",
    attempts: 0,
  });
  expect((await processReviewQueue(fixture.context, "target")).completed).toEqual([
    reviewTaskId("target"),
  ]);
  expect(await getWork(database, reviewTaskId("older-unrelated"))).toMatchObject({
    state: "queued",
    attempts: 0,
  });
  expect((await processReviewQueue(fixture.context, "next")).completed).toEqual([
    reviewTaskId("next"),
  ]);
  expect((await service.comparisonRows("comparison-run"))[0]?.decision_revision).toBe(
    row.decision_revision + 2,
  );
  expect(plans.length).toBeGreaterThan(0);
  expect(
    plans.every((plan) =>
      plan.some((detail) => detail.startsWith("SEARCH task ") && detail.includes("(id=?)")),
    ),
  ).toBe(true);
});

it("waits between the attempts of a failed decision and stops after the fifth", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await captured(fixture.context);
  const row = (await service.comparisonRows("comparison-run"))[0];
  if (!row) throw new Error("Missing comparison");
  const input = {
    commandId: "storage-fault",
    actorId: "actor",
    sessionId: "session",
    comparisonId: "comparison-run",
    verdict: "rejected" as const,
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: "dialog", variantKey: "light" },
  };
  const id = reviewTaskId(input.commandId);
  expect(await enqueueReview(database, input)).toBe("queued");
  fixture.state.time = Date.now();
  const review = vi
    .spyOn(Service.prototype, "review")
    .mockRejectedValue(new Error("D1 is not available"));
  // The second attempt has no wait. Each later attempt has a longer one.
  const waits = [0, 5_000, 30_000, 180_000];
  for (const [index, wait] of waits.entries()) {
    const failedAt = fixture.state.time;
    expect((await processReviewQueue(fixture.context)).deferred).toEqual([id]);
    expect(await getWork(database, id)).toMatchObject({
      state: "queued",
      attempts: index + 1,
      available_at: failedAt + wait,
    });
    if (wait > 0) {
      // One millisecond before the end of the wait, a pass does not claim the task.
      fixture.state.time = failedAt + wait - 1;
      expect(await processReviewQueue(fixture.context)).toMatchObject({
        deferred: [],
        hasMore: false,
      });
      expect(await getWork(database, id)).toMatchObject({ state: "queued", attempts: index + 1 });
    }
    fixture.state.time = failedAt + wait;
  }
  expect((await processReviewQueue(fixture.context)).deferred).toEqual([id]);
  expect(await getWork(database, id)).toMatchObject({ state: "dead", attempts: 5 });
  expect(review).toHaveBeenCalledTimes(5);
  // The Service status reads the dead decision. The route /api/operations sends this answer.
  const status = await operationsStatus({
    database,
    projectId: "project",
    repositoryId: "123",
    captureLimit: 40_000,
  });
  expect(status.deadReviewTasks).toEqual({ count: 1, newestAt: expect.any(Number) });
  // The same command cannot run again, and the send learns it with no write.
  fixture.state.time += 24 * 60 * 60 * 1000;
  expect(await enqueueReview(database, input)).toBe("dead");
  expect(await processReviewQueue(fixture.context, input.commandId)).toMatchObject({
    completed: [],
    deferred: [],
  });
  expect(review).toHaveBeenCalledTimes(5);
  expect((await service.comparisonRows("comparison-run"))[0]?.decision_revision).toBe(
    row.decision_revision,
  );
});

it("returns the decision of a stopped consumer after 30 seconds and applies it one time", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const service = await captured(fixture.context);
  const row = (await service.comparisonRows("comparison-run"))[0];
  if (!row) throw new Error("Missing comparison");
  const input = {
    commandId: "stopped-consumer",
    actorId: "actor",
    sessionId: "session",
    comparisonId: "comparison-run",
    verdict: "rejected" as const,
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: "dialog", variantKey: "light" },
  };
  const id = reviewTaskId(input.commandId);
  await enqueueReview(database, input);
  const started = Date.now();
  fixture.state.time = started;
  // The first consumer saves the decision. Its receipt then comes at the end
  // of its lease, as for a consumer that stopped or that was slow.
  const review = Service.prototype.review;
  vi.spyOn(Service.prototype, "review").mockImplementationOnce(async function (
    this: Service,
    command,
  ) {
    const result = await review.call(this, command);
    fixture.state.time = started + 30_000;
    return result;
  });
  // One task for each pass, so that the second claim is a pass of its own.
  const pass = { ...fixture.context, budget: { tasksPerStep: 1 } };
  expect((await processReviewQueue(pass)).deferred).toEqual([id]);
  expect(await getWork(database, id)).toMatchObject({
    state: "leased",
    attempts: 1,
    lease_until: started + 30_000,
  });
  expect((await processReviewQueue(pass)).completed).toEqual([id]);
  expect(await getWork(database, id)).toMatchObject({ state: "complete", attempts: 2 });
  expect((await service.comparisonRows("comparison-run"))[0]?.decision_revision).toBe(
    row.decision_revision + 1,
  );
});

it("reads the open review tasks through an index that has the state", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const polls: string[] = [];
  const prepare = database.prepare.bind(database);
  vi.spyOn(database, "prepare").mockImplementation((sql) => {
    if (sql.startsWith("SELECT task.id FROM work_tasks task")) polls.push(sql);
    return prepare(sql);
  });
  await processReviewQueue(fixture.context);
  const [poll] = polls;
  if (!poll) throw new Error("Missing poll");
  const plan = database.connection.prepare(`EXPLAIN QUERY PLAN ${poll}`).all(1, 1);
  expect(plan.map((row) => String(row.detail))).toContain(
    "SEARCH task USING INDEX work_tasks_publication (kind=? AND state=?)",
  );
});
