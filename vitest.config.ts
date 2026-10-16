import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      ".changeset/*.test.ts",
      "packages/**/*.test.ts",
      "packages/**/*.test.mjs",
      "apps/**/*.test.ts",
      "tooling/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.browser.test.ts"],
    environment: "node",
    testTimeout: 15000,
    // The service logs structured lines on purpose. Print them for failing
    // tests only, so that a failure does not hide in a long log.
    silent: "passed-only",
  },
});
