import { expect, it, vi } from "vitest";
import { withCodecCapacity } from "../src/capacity.ts";

const recoverDeadLetteredComparison = vi.hoisted(() => vi.fn());
vi.mock("@visonaut/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@visonaut/service")>()),
  recoverDeadLetteredComparison,
}));
vi.mock("@cloudflare/containers", () => ({ Container: class {} }));
vi.mock("../src/codecs.ts", () => ({ codecsReady: Promise.resolve({}) }));

const { default: worker } = await import("../src/index.ts");
const env = { VISONAUT_COMPARISON_DEAD_LETTER_QUEUE: "comparison-dlq" } as Env;

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
