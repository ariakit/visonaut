import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import { testPort } from "./test-port.ts";

const origin = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: fileURLToPath(new URL(".", import.meta.url)),
  testMatch: "**/*.browser.test.ts",
  fullyParallel: true,
  workers: 3,
  timeout: 20000,
  use: {
    baseURL: origin,
    browserName: "chromium",
    channel: "chrome",
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
  },
  reporter: "list",
  webServer: {
    command: "pnpm exec vite --config src/review/__tests__/vite.config.ts",
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    url: `${origin}/src/review/__tests__/index.html`,
    reuseExistingServer: false,
  },
});
