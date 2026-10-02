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
