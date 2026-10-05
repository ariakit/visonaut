import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const comparisonQueues = Object.freeze({
  production: [
    { id: "56f8f86170914a0492c0bbe93a42c553", name: "visonaut-production-comparisons" },
    { id: "54e58a2877004b2d8664509916e05a0d", name: "visonaut-production-comparison-dead-letter" },
  ],
});

/** Config removal does not detach an existing live Queue consumer. */
export async function requireDetachedComparisonConsumers({
  target,
  account,
  token,
  request = fetch,
}) {
  assert.equal(account, "b04f3af3f0f10a6b9481bc23ba974eca", "Unexpected Cloudflare account");
  assert(Object.hasOwn(comparisonQueues, target), "Unexpected comparison retirement target");
  assert(typeof token === "string" && token.length > 0, "Deployment credential is unavailable");
  for (const queue of comparisonQueues[target]) {
    const response = await request(
      `https://api.cloudflare.com/client/v4/accounts/${account}/queues/${queue.id}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    assert(response.ok, "Cannot read the comparison queue");
    const metadata = await response.json();
    assert(metadata.success && metadata.result, "Comparison queue metadata is unavailable");
    assert.equal(metadata.result.queue_id, queue.id, "Unexpected comparison queue ID");
    assert.equal(metadata.result.queue_name, queue.name, "Unexpected comparison queue name");
    assert(Array.isArray(metadata.result.consumers), "Comparison consumers are unavailable");
    assert.equal(
      metadata.result.consumers.length,
      0,
      "Detach comparison consumers before deploying the fetch-only Worker",
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await requireDetachedComparisonConsumers({
    target: process.env.VISONAUT_COMPARISON_RETIREMENT_TARGET,
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
  });
}
