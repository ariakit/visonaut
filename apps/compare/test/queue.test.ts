import { Service } from "@visonaut/service";
import { afterEach, expect, it, vi } from "vitest";
import { withCodecCapacity } from "../src/capacity.ts";

const recoverDeadLetteredComparison = vi.hoisted(() => vi.fn());
const processComparisonTask = vi.hoisted(() => vi.fn());
vi.mock("@visonaut/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@visonaut/service")>()),
  recoverDeadLetteredComparison,
}));
vi.mock("../src/codecs.ts", () => ({ codecsReady: Promise.resolve({}) }));
vi.mock("../src/process.ts", () => ({ processComparisonTask }));

const { default: worker } = await import("../src/index.ts");
const env = { VISONAUT_COMPARISON_DEAD_LETTER_QUEUE: "comparison-dlq" } as Env;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  processComparisonTask.mockReset();
});

function claimedTask() {
  vi.spyOn(Service.prototype, "claimComparisonTask")
    .mockResolvedValueOnce({ comparisonId: "comparison" } as never)
    .mockResolvedValueOnce(null);
  vi.spyOn(Service.prototype, "getComparisonTaskState").mockResolvedValue({
    state: "complete",
  } as never);
  vi.spyOn(Service.prototype, "getComparisonTask").mockResolvedValue({
    comparisonId: "comparison",
  } as never);
  vi.spyOn(Service.prototype, "commitComparisonResult").mockResolvedValue(undefined as never);
  processComparisonTask.mockResolvedValue({ result: { outcome: "unchanged" }, artifacts: [] });
}

function comparisonMessage() {
  return { body: { taskId: "comparison:row" }, ack: vi.fn(), retry: vi.fn() };
}

it("wakes status delivery only for the first review-ready transition", async () => {
  claimedTask();
  vi.spyOn(Service.prototype, "finalizeComparison")
    .mockResolvedValueOnce({ reviewReadyTransitioned: true } as never)
    .mockResolvedValueOnce({ reviewReadyTransitioned: false } as never);
  const send = vi.fn(async () => {});
  const first = comparisonMessage();
  const duplicate = comparisonMessage();

  await worker.queue(
    { queue: "comparisons", messages: [first, duplicate] } as MessageBatch<unknown>,
    { ...env, OPERATIONS: { send } } as Env,
  );

  expect(send).toHaveBeenCalledExactlyOnceWith({ kind: "status", comparisonId: "comparison" });
  expect(first.ack).toHaveBeenCalledOnce();
  expect(duplicate.ack).toHaveBeenCalledOnce();
  expect(first.retry).not.toHaveBeenCalled();
  expect(duplicate.retry).not.toHaveBeenCalled();
  expect(processComparisonTask).toHaveBeenCalledOnce();
});

it("acknowledges committed work when the status wake fails", async () => {
  claimedTask();
  vi.spyOn(Service.prototype, "finalizeComparison").mockResolvedValue({
    reviewReadyTransitioned: true,
  } as never);
  const fail = vi.spyOn(Service.prototype, "failComparisonTask");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const send = vi.fn(async () => {
    throw new Error("Queue unavailable");
  });
  const message = comparisonMessage();

  await worker.queue(
    { queue: "comparisons", messages: [message] } as MessageBatch<unknown>,
    { ...env, OPERATIONS: { send } } as Env,
  );

  expect(message.ack).toHaveBeenCalledOnce();
  expect(message.retry).not.toHaveBeenCalled();
  expect(fail).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(
    JSON.stringify({ event: "comparison-status-wakeup-failed", comparisonId: "comparison" }),
  );
});

it.each(["dead", "superseded"] as const)(
  "acknowledges repeated terminal legacy delivery (%s) without image processing",
  async (state) => {
    vi.spyOn(Service.prototype, "claimComparisonTask").mockResolvedValue(null);
    vi.spyOn(Service.prototype, "getComparisonTaskState").mockResolvedValue({ state });
    const finalize = vi.spyOn(Service.prototype, "finalizeComparison");
    const first = {
      ...comparisonMessage(),
      id: "first",
      timestamp: new Date(),
      attempts: 1,
    };
    const duplicate = { ...first, ...comparisonMessage(), id: "duplicate", attempts: 2 };

    await worker.queue(
      {
        queue: "comparisons",
        messages: [first, duplicate],
        ackAll() {},
        retryAll() {},
      },
      env,
    );

    expect(first.ack).toHaveBeenCalledOnce();
    expect(duplicate.ack).toHaveBeenCalledOnce();
    expect(first.retry).not.toHaveBeenCalled();
    expect(duplicate.retry).not.toHaveBeenCalled();
    expect(processComparisonTask).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  },
);

it("keeps codec ownership with the next task when an earlier commit finishes", async () => {
  vi.spyOn(Service.prototype, "claimComparisonTask").mockResolvedValue({
    comparisonId: "comparison",
  } as never);
  vi.spyOn(Service.prototype, "finalizeComparison").mockResolvedValue({
    reviewReadyTransitioned: false,
  } as never);
  const committed = Promise.withResolvers<void>();
  const commit = vi
    .spyOn(Service.prototype, "commitComparisonResult")
    .mockImplementationOnce(() => committed.promise)
    .mockResolvedValue(undefined as never);
  const processed = { result: { outcome: "unchanged" }, artifacts: [] };
  const processing = Promise.withResolvers<typeof processed>();
  processComparisonTask
    .mockResolvedValueOnce(processed)
    .mockImplementationOnce(() => processing.promise);
  const first = comparisonMessage();
  const second = comparisonMessage();
  const deliver = (message: ReturnType<typeof comparisonMessage>) =>
    worker.queue({ queue: "comparisons", messages: [message] } as MessageBatch<unknown>, env);
  const firstDelivery = deliver(first);
  let secondDelivery: Promise<void> | undefined;
  try {
    await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
    secondDelivery = deliver(second);
    await vi.waitFor(() => expect(processComparisonTask).toHaveBeenCalledTimes(2));
    committed.resolve();
    await firstDelivery;
    expect(first.ack).toHaveBeenCalledOnce();
    const response = await worker.fetch(
      new Request("https://compare/validate", { method: "POST", body: new Uint8Array([1]) }),
    );
    expect(response.status).toBe(503);
    expect(second.ack).not.toHaveBeenCalled();
  } finally {
    committed.resolve();
    processing.resolve(processed);
    await Promise.all([firstDelivery, secondDelivery]);
  }
  expect(second.ack).toHaveBeenCalledOnce();
  expect(first.retry).not.toHaveBeenCalled();
  expect(second.retry).not.toHaveBeenCalled();
});

it("does not hold codec capacity while a completed task finalizes", async () => {
  vi.spyOn(Service.prototype, "claimComparisonTask").mockResolvedValue(null);
  vi.spyOn(Service.prototype, "getComparisonTaskState").mockResolvedValue({
    state: "complete",
  } as never);
  vi.spyOn(Service.prototype, "getComparisonTask").mockResolvedValue({
    comparisonId: "comparison",
  } as never);
  const finalized = Promise.withResolvers<{ reviewReadyTransitioned: boolean }>();
  const finalize = vi
    .spyOn(Service.prototype, "finalizeComparison")
    .mockImplementation(() => finalized.promise);
  const message = comparisonMessage();
  const delivery = worker.queue(
    { queue: "comparisons", messages: [message] } as MessageBatch<unknown>,
    env,
  );
  try {
    await vi.waitFor(() => expect(finalize).toHaveBeenCalledOnce());
    const response = await worker.fetch(
      new Request("https://compare/validate", { method: "POST", body: new Uint8Array([1]) }),
    );
    expect(response.status).toBe(422);
    expect(message.ack).not.toHaveBeenCalled();
  } finally {
    finalized.resolve({ reviewReadyTransitioned: false });
    await delivery;
  }
  expect(message.ack).toHaveBeenCalledOnce();
  expect(message.retry).not.toHaveBeenCalled();
});

it("releases codec capacity before recording an image processing failure", async () => {
  vi.spyOn(Service.prototype, "claimComparisonTask").mockResolvedValue({
    comparisonId: "comparison",
  } as never);
  processComparisonTask.mockRejectedValue(new Error("Image read failed"));
  const failed = Promise.withResolvers<boolean>();
  const failure = vi
    .spyOn(Service.prototype, "failComparisonTask")
    .mockImplementation(() => failed.promise);
  vi.spyOn(Service.prototype, "getComparisonTaskState").mockResolvedValue({
    state: "queued",
  } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const message = comparisonMessage();
  const delivery = worker.queue(
    { queue: "comparisons", messages: [message] } as MessageBatch<unknown>,
    env,
  );
  try {
    await vi.waitFor(() => expect(failure).toHaveBeenCalledOnce());
    const response = await worker.fetch(
      new Request("https://compare/validate", { method: "POST", body: new Uint8Array([1]) }),
    );
    expect(response.status).toBe(422);
    expect(message.retry).not.toHaveBeenCalled();
  } finally {
    failed.resolve(true);
    await delivery;
  }
  expect(message.ack).not.toHaveBeenCalled();
  expect(message.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 });
});

it("waits for a busy codec without retrying the queued message", async () => {
  claimedTask();
  vi.spyOn(Service.prototype, "finalizeComparison").mockResolvedValue({
    reviewReadyTransitioned: false,
  } as never);
  const release = Promise.withResolvers<void>();
  const holder = withCodecCapacity(() => release.promise);
  const queued = comparisonMessage();
  const delivery = worker.queue(
    { queue: "comparisons", messages: [queued] } as MessageBatch<unknown>,
    { ...env } as Env,
  );

  await Promise.resolve();
  expect(queued.ack).not.toHaveBeenCalled();
  expect(queued.retry).not.toHaveBeenCalled();
  release.resolve();
  await Promise.all([holder, delivery]);

  expect(queued.ack).toHaveBeenCalledOnce();
  expect(queued.retry).not.toHaveBeenCalled();
  expect(recoverDeadLetteredComparison).not.toHaveBeenCalled();

  // The dedicated DLQ releases its durable receipt without codec capacity.
  recoverDeadLetteredComparison.mockResolvedValueOnce("requeued");
  const message = {
    body: { taskId: "comparison:row", publicationAttempt: 1 },
    ack: vi.fn(),
    retry: vi.fn(),
  };
  await worker.queue(
    { queue: "comparison-dlq", messages: [message] } as MessageBatch<unknown>,
    env,
  );
  expect(recoverDeadLetteredComparison).toHaveBeenCalledWith(
    env.DB,
    expect.objectContaining({ taskId: "comparison:row", publicationAttempt: 1 }),
  );
  expect(message.ack).toHaveBeenCalledOnce();
  expect(message.retry).not.toHaveBeenCalled();
});

it("retries when codec capacity stays occupied past the wait limit", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const release = Promise.withResolvers<void>();
  const holder = withCodecCapacity(() => release.promise);
  const retry = vi.fn();
  const delivery = worker.queue(
    { queue: "comparisons", messages: [{ retry }] } as MessageBatch<unknown>,
    env,
  );

  try {
    await vi.advanceTimersByTimeAsync(119_999);
    expect(retry).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 });
  } finally {
    release.resolve();
    await Promise.all([holder, delivery]);
  }
});

it("keeps a dead letter while its task lease is active", async () => {
  recoverDeadLetteredComparison.mockResolvedValueOnce("deferred");
  const message = {
    body: { taskId: "comparison:row", publicationAttempt: 1 },
    ack: vi.fn(),
    retry: vi.fn(),
  };
  await worker.queue(
    { queue: "comparison-dlq", messages: [message] } as MessageBatch<unknown>,
    env,
  );
  expect(message.ack).not.toHaveBeenCalled();
  expect(message.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 });
});

it("logs and acknowledges an unrelated envelope in the isolated comparison DLQ", async () => {
  const message = { body: { kind: "continue" }, ack: vi.fn(), retry: vi.fn() };
  const calls = recoverDeadLetteredComparison.mock.calls.length;
  await worker.queue(
    { queue: "comparison-dlq", messages: [message] } as MessageBatch<unknown>,
    env,
  );
  expect(recoverDeadLetteredComparison).toHaveBeenCalledTimes(calls);
  expect(message.ack).toHaveBeenCalledOnce();
  expect(message.retry).not.toHaveBeenCalled();
});
