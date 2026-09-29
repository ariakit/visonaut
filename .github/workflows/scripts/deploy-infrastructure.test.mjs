import assert from "node:assert/strict";
import { test } from "node:test";
import { assertContainerRetirement } from "./deploy-infrastructure.mjs";

const now = 2_000_000_000_000;
const settings = {
  bindings: [
    { name: "CODEC_CONTAINER", class_name: "ComparisonContainer", namespace_id: "namespace-1" },
    { name: "VISONAUT_CODEC_BACKEND", text: "worker" },
  ],
};
const receipt = { namespaceId: "namespace-1", activeRequests: 0, observedAt: now - 10_000 };

test("the class deletion gate requires current exact-namespace drain evidence", () => {
  assert.doesNotThrow(() => assertContainerRetirement(settings, receipt, now));
  assert.doesNotThrow(() => assertContainerRetirement({ bindings: [] }, null, now));
  for (const invalid of [
    null,
    { ...receipt, namespaceId: "other" },
    { ...receipt, activeRequests: 1 },
    { ...receipt, observedAt: now - 60 * 60_000 },
    { ...receipt, observedAt: now + 1 },
  ]) {
    assert.throws(() => assertContainerRetirement(settings, invalid, now));
  }
  assert.throws(() =>
    assertContainerRetirement(
      { bindings: [settings.bindings[0], { name: "VISONAUT_CODEC_BACKEND", text: "container" }] },
      receipt,
      now,
    ),
  );
});
