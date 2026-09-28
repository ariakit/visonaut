import { Service } from "@visonaut/service";
import { afterEach, expect, it, vi } from "vitest";
import { withCodecCapacity } from "../src/capacity.ts";

const recoverDeadLetteredComparison = vi.hoisted(() => vi.fn());
const processComparisonTask = vi.hoisted(() => vi.fn());
vi.mock("@visonaut/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@visonaut/service")>()),
  recoverDeadLetteredComparison,
}));
vi.mock("@cloudflare/containers", () => ({ Container: class {} }));
vi.mock("../src/codecs.ts", () => ({ codecsReady: Promise.resolve({}) }));
vi.mock("../src/process.ts", () => ({ processComparisonTask }));

const { default: worker } = await import("../src/index.ts");
const env = { VISONAUT_COMPARISON_DEAD_LETTER_QUEUE: "comparison-dlq" } as Env;

afterEach(() => {
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
    { ...env, VISONAUT_CODEC_BACKEND: "worker", OPERATIONS: { send } } as Env,
  );

  expect(send).toHaveBeenCalledExactlyOnceWith({ kind: "continue" });
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
    { ...env, VISONAUT_CODEC_BACKEND: "worker", OPERATIONS: { send } } as Env,
  );

  expect(message.ack).toHaveBeenCalledOnce();
  expect(message.retry).not.toHaveBeenCalled();
  expect(fail).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(
    JSON.stringify({ event: "comparison-status-wakeup-failed", comparisonId: "comparison" }),
  );
});

it("delays a busy codec delivery, then recovers its exhausted receipt", async () => {
  const retry = vi.fn();
  // Capacity is held before the handler can inspect the platform message.
  const batch = { queue: "comparisons", messages: [{ retry }] } as MessageBatch<unknown>;

  await withCodecCapacity(async () => {
    await worker.queue(batch, env);
  });

  expect(retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 });
  expect(recoverDeadLetteredComparison).not.toHaveBeenCalled();

  // The primary consumer can exhaust its bounded retries if uploads remain busy.
  // The dedicated DLQ must release its matching durable receipt without a codec.
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
