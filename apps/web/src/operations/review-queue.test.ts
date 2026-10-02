import { afterEach, expect, it, vi } from "vitest";
import { getWork, Service } from "@visonaut/service";
import { captured, context, TestDatabase } from "./test-fixtures.ts";
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

it("rejects a predecessor from another review session", async () => {
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
      commandId: "second",
      previousCommandId: "first",
      sessionId: "another",
    }),
  ).rejects.toThrow("another review session");
  expect(await getWork(database, reviewTaskId("second"))).toBeNull();
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
