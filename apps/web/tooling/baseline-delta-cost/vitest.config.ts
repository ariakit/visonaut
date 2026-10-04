import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("../../../../", import.meta.url)),
  test: {
    include: ["apps/web/tooling/baseline-delta-cost/probe.cost.ts"],
    environment: "node",
    testTimeout: 120000,
  },
});
