import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "packages/**/*.test.mjs", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.browser.test.ts"],
    environment: "node",
    testTimeout: 15000,
  },
});
