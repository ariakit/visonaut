import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  testMatch: "**/*.browser.test.ts",
  fullyParallel: true,
  workers: 3,
  timeout: 20000,
  use: {
    baseURL: "http://127.0.0.1:4179",
    browserName: "chromium",
    channel: "chrome",
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
  },
  reporter: "list",
  webServer: {
    command: "pnpm exec vite --config src/review/__tests__/vite.config.ts",
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    url: "http://127.0.0.1:4179/src/review/__tests__/index.html",
    reuseExistingServer: true,
  },
});
