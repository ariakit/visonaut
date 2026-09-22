import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.browser.test.ts"],
    environment: "node",
    testTimeout: 15000,
  },
});
