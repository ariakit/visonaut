import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function assertContainerRetirement(settings, receipt, now = Date.now()) {
  assert(Array.isArray(settings.bindings), "Comparator bindings are unavailable");
  const container = settings.bindings.find((binding) => binding.name === "CODEC_CONTAINER");
  if (!container) return;
  assert.equal(container.class_name, "ComparisonContainer", "Unexpected Container class");
  assert.equal(
    settings.bindings.find((binding) => binding.name === "VISONAUT_CODEC_BACKEND")?.text,
    "worker",
    "Container backend is still selected",
  );
  assert.equal(
    receipt?.namespaceId,
    container.namespace_id,
    "Container retirement proof targets another namespace",
  );
  assert.equal(receipt?.activeRequests, 0, "Container requests have not drained");
  assert(
    Number.isSafeInteger(receipt?.observedAt) &&
      receipt.observedAt <= now &&
      receipt.observedAt > now - 60 * 60_000,
    "Container drain evidence is missing or older than one hour",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  assert(/^[a-f0-9]{32}$/.test(account ?? ""), "Cloudflare account is missing");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/visonaut-compare/settings`,
    {
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  assert(response.ok, "Cannot read the production comparator bindings");
  const metadata = await response.json();
  assert(metadata.success && metadata.result, "Comparator settings are unavailable");
  const receipt = process.env.VISONAUT_CONTAINER_RETIREMENT_VERIFIED
    ? JSON.parse(process.env.VISONAUT_CONTAINER_RETIREMENT_VERIFIED)
    : null;
  assertContainerRetirement(metadata.result, receipt);
}
