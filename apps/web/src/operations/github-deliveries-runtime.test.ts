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
let deliveryBody = "[]";
const requests: string[] = [];
const posts: string[] = [];

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
        if (request.method === "POST") {
          posts.push(request.url);
          return new Response(null, { status: 202 });
        }
        return new Response(deliveryBody);
      },
    }),
  );
  const database = await runtime.getD1Database("DB");
  const schema = readTestMigrations().find(
    (migration) => migration.name === "0005_operations.sql",
  )?.sql;
  const events = schema?.match(/CREATE TABLE IF NOT EXISTS operations_events \([\s\S]*?\);/u)?.[0];
  const cursors = schema?.match(/CREATE TABLE IF NOT EXISTS operations_cursors \([^;]+;/u)?.[0];
  const deliveriesSchema = readTestMigrations().find(
    (migration) => migration.name === "0003_auth.sql",
  )?.sql;
  const deliveriesTable = deliveriesSchema?.match(
    /CREATE TABLE github_webhook_delivery \([^;]+;/u,
  )?.[0];
  const recoveryTable = readTestMigrations().find(
    (migration) => migration.name === "0027_webhook_recovery.sql",
  )?.sql;
  if (!events || !cursors || !deliveriesTable || !recoveryTable) {
    throw new Error("Recovery metadata tables are unavailable.");
  }
  await database.batch(
    [events, cursors, deliveriesTable, recoveryTable].map((sql) => database.prepare(sql)),
  );
}, 40000);

beforeEach(async () => {
  redirect = false;
  deliveryBody = "[]";
  requests.length = 0;
  posts.length = 0;
  if (!runtime) {
    throw new Error("Native runtime unavailable.");
  }
  const database = await runtime.getD1Database("DB");
  await database.batch([
    database.prepare("DELETE FROM github_webhook_recovery"),
    database.prepare("DELETE FROM operations_cursors"),
  ]);
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

it.each(["1", "9007199254740993", "9223372036854775807"])(
  "preserves numeric delivery ID %s in native D1 and the POST URL",
  async (id) => {
    if (!runtime) {
      throw new Error("Native runtime unavailable.");
    }
    deliveryBody = `[{"id":${id},"guid":"12345678-1234-1234-1234-123456789abc","delivered_at":"2026-09-29T12:00:00Z","status_code":503,"event":"workflow_run","repository_id":789,"installation_id":456}]`;
    const response = await runtime.dispatchFetch("https://visonaut.test", {
      method: "POST",
      body: privateKey,
    });
    expect(await response.json()).toEqual({ checked: 1, requested: 1 });
    expect(response.status).toBe(200);
    expect(posts).toEqual([`https://api.github.com/app/hook/deliveries/${id}/attempts`]);
    const database = await runtime.getD1Database("DB");
    expect(
      await database
        .prepare(
          "SELECT delivery_id,typeof(delivery_id) AS storage_type FROM github_webhook_recovery",
        )
        .first(),
    ).toEqual({ delivery_id: id, storage_type: "text" });
  },
);

it.each(["1.0000000000000001", "9007199254740991.1"])(
  "rejects fractional delivery ID %s before native storage or POST",
  async (id) => {
    if (!runtime) {
      throw new Error("Native runtime unavailable.");
    }
    deliveryBody = `[{"id":${id},"guid":"12345678-1234-1234-1234-123456789abc","delivered_at":"2026-09-29T12:00:00Z","status_code":503,"event":"workflow_run","repository_id":789,"installation_id":456}]`;
    const response = await runtime.dispatchFetch("https://visonaut.test", {
      method: "POST",
      body: privateKey,
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Delivery metadata is invalid." });
    expect(posts).toEqual([]);
    const database = await runtime.getD1Database("DB");
    expect(await database.prepare("SELECT count(*) AS n FROM operations_cursors").first()).toEqual({
      n: 0,
    });
    expect(
      await database.prepare("SELECT count(*) AS n FROM github_webhook_recovery").first(),
    ).toEqual({ n: 0 });
  },
);
