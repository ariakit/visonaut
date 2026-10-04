import assert from "node:assert/strict";
import { test } from "node:test";
import {
  comparisonQueues,
  requireDetachedComparisonConsumers,
} from "./deploy-comparison-retirement.mjs";

function fixture(target, change = (value) => value) {
  const requests = [];
  return {
    requests,
    input: {
      target,
      account: "b04f3af3f0f10a6b9481bc23ba974eca",
      token: "fixture-token",
      async request(url, options) {
        requests.push({ url, options });
        const queue = comparisonQueues[target].find((queue) => url.endsWith(`/${queue.id}`));
        assert(queue);
        return {
          ok: true,
          json: async () => ({
            success: true,
            result: change({ queue_id: queue.id, queue_name: queue.name, consumers: [] }),
          }),
        };
      },
    },
  };
}

for (const target of ["production"]) {
  test(`reads only the exact ${target} comparison queues and accepts detached consumers`, async () => {
    const selected = fixture(target);
    await requireDetachedComparisonConsumers(selected.input);
    assert.equal(selected.requests.length, 2);
    for (const { url, options } of selected.requests) {
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(url.includes("operations"), false);
      assert.equal(url.endsWith("/consumers"), false);
    }
  });
  for (const [name, change] of [
    [
      "attached worker",
      (value) => ({ ...value, consumers: [{ type: "worker", script: "visonaut-compare" }] }),
    ],
    ["attached pull consumer", (value) => ({ ...value, consumers: [{ type: "http_pull" }] })],
    ["missing consumer metadata", (value) => ({ ...value, consumers: undefined })],
    ["wrong queue ID", (value) => ({ ...value, queue_id: "other" })],
    ["wrong queue name", (value) => ({ ...value, queue_name: "other" })],
  ]) {
    test(`rejects ${target} ${name} before deployment`, async () => {
      await assert.rejects(requireDetachedComparisonConsumers(fixture(target, change).input), {
        code: "ERR_ASSERTION",
      });
    });
  }
}

test("rejects an unknown target or account before any provider request", async () => {
  const selected = fixture("production");
  await assert.rejects(requireDetachedComparisonConsumers({ ...selected.input, target: "other" }));
  await assert.rejects(
    requireDetachedComparisonConsumers({ ...selected.input, target: "preview" }),
  );
  await assert.rejects(requireDetachedComparisonConsumers({ ...selected.input, account: "other" }));
  assert.equal(selected.requests.length, 0);
});
