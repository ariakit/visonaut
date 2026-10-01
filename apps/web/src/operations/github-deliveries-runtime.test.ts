import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { readTestMigrations } from "../../../../tooling/test-migrations.ts";

const require = createRequire(import.meta.url);
const directory = await mkdtemp(resolve(tmpdir(), "visonaut-github-deliveries-"));
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
let runtime: Miniflare | undefined;
let redirect = false;
const requests: string[] = [];

beforeAll(async () => {
  const deliveries = fileURLToPath(new URL("./github-deliveries.ts", import.meta.url));
  await writeFile(
    resolve(directory, "worker.mjs"),
    `
    import { recoverGitHubDeliveries } from ${JSON.stringify(deliveries)};
    export default { async fetch(request, env) {
      try {
        return Response.json(await recoverGitHubDeliveries({
          context: {
            database: env.DB,
            origin: 'https://visonaut.test',
            now: Date.now,
            budget: { tasksPerStep: 25, maxAttempts: 5 },
          },
          configuration: {
            appId: '123',
            installationId: '456',
            repositoryId: '789',
            repository: 'ariakit/ariakit',
            privateKey: await request.text(),
          },
        }));
      } catch (error) {
        return Response.json({ error: error.message }, { status: 503 });
      }
    }};
  `,
  );
  await writeFile(
    resolve(directory, "wrangler.json"),
    JSON.stringify({
      name: "visonaut-github-deliveries-test",
      main: "worker.mjs",
      compatibility_date: "2026-09-22",
      compatibility_flags: ["nodejs_compat"],
    }),
  );
  const wrangler = resolve(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
  execFileSync(
    process.execPath,
    [
      wrangler,
      "deploy",
      "--dry-run",
      "--config",
      resolve(directory, "wrangler.json"),
      "--outdir",
      resolve(directory, "dist"),
    ],
    {
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_LOG_PATH: resolve(directory, "wrangler.log"),
      },
      stdio: "pipe",
      timeout: 30000,
    },
  );
  // Intercept outbound I/O after workerd validates the actual fetch options.
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: await readFile(resolve(directory, "dist/worker.js"), "utf8"),
      compatibilityDate: "2026-09-22",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: ["DB"],
      outboundService: async (request) => {
        requests.push(request.url);
        if (redirect) {
          return new Response(null, {
            status: 302,
            headers: { Location: "https://unexpected.example/deliveries" },
          });
        }
        if (new URL(request.url).pathname === "/app/hook/config") {
          return Response.json({ url: "https://visonaut.test/v1/webhooks" });
        }
        return Response.json([]);
      },
    }),
  );
  const database = await runtime.getD1Database("DB");
  const schema = readTestMigrations().find(
    (migration) => migration.name === "0005_operations.sql",
  )?.sql;
  const events = schema?.match(/CREATE TABLE IF NOT EXISTS operations_events \([\s\S]*?\);/u)?.[0];
  const cursors = schema?.match(/CREATE TABLE IF NOT EXISTS operations_cursors \([^;]+;/u)?.[0];
  if (!events || !cursors) {
    throw new Error("Recovery metadata tables are unavailable.");
  }
  await database.batch([database.prepare(events), database.prepare(cursors)]);
}, 40000);

beforeEach(() => {
  redirect = false;
  requests.length = 0;
});

afterAll(async () => {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
});

it("reads GitHub delivery metadata through the real Workers fetch boundary", async () => {
  if (!runtime) {
    throw new Error("Native runtime unavailable.");
  }
  const response = await runtime.dispatchFetch("https://visonaut.test", {
    method: "POST",
    body: privateKey,
  });
  expect(await response.json()).toEqual({ checked: 0, requested: 0 });
  expect(response.status).toBe(200);
  expect(requests).toEqual([
    "https://api.github.com/app/hook/config",
    "https://api.github.com/app/hook/deliveries?per_page=100",
  ]);
});

it("rejects recovery redirects without forwarding App credentials", async () => {
  if (!runtime) {
    throw new Error("Native runtime unavailable.");
  }
  redirect = true;
  const response = await runtime.dispatchFetch("https://visonaut.test", {
    method: "POST",
    body: privateKey,
  });
  expect(await response.json()).toEqual({ error: "GitHub delivery recovery is unavailable." });
  expect(response.status).toBe(503);
  expect(requests).toEqual(["https://api.github.com/app/hook/config"]);
});
