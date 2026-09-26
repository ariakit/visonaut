import { expect, it, vi } from "vitest";
import { withCodecCapacity } from "../src/capacity.ts";

vi.mock("@cloudflare/containers", () => ({ Container: class {} }));
vi.mock("../src/codecs.ts", () => ({ codecsReady: Promise.resolve({}) }));

const { default: worker } = await import("../src/index.ts");

it("delays a busy codec delivery long enough for an upload to finish", async () => {
  const retry = vi.fn();
  // Capacity is held before the handler can inspect the platform message.
  const batch = { messages: [{ retry }] } as MessageBatch<unknown>;

  await withCodecCapacity(async () => {
    await worker.queue(batch, {} as Env);
  });

  expect(retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 });
});
