import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempDisposable } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  experimental_patchConfig,
  unstable_defaultWranglerConfig,
  unstable_readConfig,
} from "wrangler";

const root = new URL("../../../", import.meta.url);
const config = fileURLToPath(new URL("apps/web/wrangler.jsonc", root));
const source = readFileSync(config);
const localDatabase = {
  binding: "DB",
  database_name: "visonaut-local",
  // The nil UUID is not a database. Wrangler creates no database for a binding with an ID.
  database_id: "00000000-0000-0000-0000-000000000000",
  migrations_dir: "migrations",
};
// Each rule below reads one of these keys, or the key cannot reach or create a
// resource. `build` and `main` are the two stops that the last tests run.
const knownKeys = [
  "configPath",
  "userConfigPath",
  "topLevelName",
  "definedEnvironments",
  "targetEnvironment",
  "compatibility_date",
  "compatibility_flags",
  "limits",
  "observability",
  "build",
  "main",
  "name",
  "routes",
  "workers_dev",
  "preview_urls",
  "triggers",
  "d1_databases",
  "vars",
  "secrets",
];

/** Read one environment from a copy of the configuration, with an optional change. */
async function readEnvironment(env, patch) {
  await using directory = await mkdtempDisposable(resolve(tmpdir(), "visonaut-local-environment-"));
  const copy = resolve(directory.path, "wrangler.jsonc");
  writeFileSync(copy, source);
  if (patch) {
    experimental_patchConfig(copy, patch, false);
  }
  return unstable_readConfig({ config: copy, env });
}

/**
 * List what a deploy of the local environment can reach or create. Wrangler
 * creates a missing R2 bucket, queue, or KV namespace at deploy, so the
 * environment declares none. The local runner adds them.
 */
function remoteResources(configuration) {
  const rules = {
    "Worker name": configuration.name === "visonaut-local",
    route: isDeepStrictEqual(configuration.routes, []),
    "workers.dev address": configuration.workers_dev === false,
    "preview URL": configuration.preview_urls === false,
    "cron trigger": isDeepStrictEqual(configuration.triggers, { crons: [] }),
    database: isDeepStrictEqual(configuration.d1_databases, [localDatabase]),
    environment: configuration.vars.VISONAUT_ENVIRONMENT === "local",
    origin: /^http:\/\/127\.0\.0\.1:\d+$/.test(configuration.vars.VISONAUT_ORIGIN),
    // Wrangler refuses the first deploy of a Worker when a required secret has no value.
    "required secrets": configuration.secrets.required.length > 0,
  };
  // Each other key must have the default value of Wrangler. The resolved
  // configuration also has the keys that the environment inherits from the
  // top level, so a new key there needs a decision for this environment first.
  for (const [key, value] of Object.entries(configuration)) {
    if (knownKeys.includes(key)) continue;
    rules[`key ${key}`] = isDeepStrictEqual(value, unstable_defaultWranglerConfig[key]);
  }
  return Object.entries(rules)
    .filter(([, satisfied]) => !satisfied)
    .map(([rule]) => rule);
}

test("the local environment has no remote resource", async () => {
  assert.deepEqual(remoteResources(await readEnvironment("local")), []);
});

const production = await readEnvironment("production");
const service = { service: "visonaut-compare" };

for (const [change, rule, local] of [
  ["another Worker name", "Worker name", { name: "visonaut" }],
  ["a route", "route", { routes: [{ pattern: "local.visonaut.com", custom_domain: true }] }],
  ["a workers.dev address", "workers.dev address", { workers_dev: true }],
  ["a preview URL", "preview URL", { preview_urls: true }],
  ["a cron trigger", "cron trigger", { triggers: { crons: ["*/5 * * * *"] } }],
  [
    "an R2 bucket",
    "key r2_buckets",
    { r2_buckets: [{ binding: "IMAGES", bucket_name: "visonaut-local-images" }] },
  ],
  ["a KV namespace", "key kv_namespaces", { kv_namespaces: [{ binding: "CACHE" }] }],
  [
    "a queue producer",
    "key queues",
    { queues: { producers: [{ binding: "OPERATIONS", queue: "visonaut-local-operations" }] } },
  ],
  [
    "a queue consumer",
    "key queues",
    { queues: { consumers: [{ queue: "visonaut-local-operations" }] } },
  ],
  ["a service", "key services", { services: [{ binding: "COMPARATOR", ...service }] }],
  ["a tail consumer", "key tail_consumers", { tail_consumers: [service] }],
  [
    "a streaming tail consumer",
    "key streaming_tail_consumers",
    { streaming_tail_consumers: [service] },
  ],
  ["an account", "key account_id", { account_id: "00000000000000000000000000000000" }],
  ["the production database", "database", { d1_databases: production.d1_databases }],
  [
    "a database that Wrangler can create",
    "database",
    // The patch removes a key that it sets to undefined.
    { d1_databases: [{ database_id: undefined }] },
  ],
  ["a remote database binding", "database", { d1_databases: [{ ...localDatabase, remote: true }] }],
  [
    "a second database",
    "database",
    { d1_databases: [localDatabase, { ...localDatabase, binding: "OTHER" }] },
  ],
  ["no required secret", "required secrets", { secrets: { required: [] } }],
  ["a public origin", "origin", { vars: { VISONAUT_ORIGIN: "https://visonaut.com" } }],
  ["the production mode", "environment", { vars: { VISONAUT_ENVIRONMENT: "production" } }],
]) {
  test(`the local environment guard reports ${change}`, async () => {
    const configuration = await readEnvironment("local", { env: { local } });
    assert.deepEqual(remoteResources(configuration), [rule]);
  });
}

// The local environment inherits these keys from the top level. Wrangler
// creates a KV namespace for a Workers Sites folder at deploy.
for (const [change, rule, patch] of [
  ["a Workers Sites folder", "key site", { site: { bucket: "./public" } }],
  ["a previews block", "key previews", { previews: {} }],
  ["an account", "key account_id", { account_id: "00000000000000000000000000000000" }],
]) {
  test(`the local environment guard reports ${change} at the top level`, async () => {
    assert.deepEqual(remoteResources(await readEnvironment("local", patch)), [rule]);
  });
}

test("the entry file of the local environment does not exist", () => {
  // The Vite build of the environment stops for this reason.
  assert.equal(existsSync(unstable_readConfig({ config, env: "local" }).main), false);
});

const wrangler = resolve(
  createRequire(import.meta.url).resolve("wrangler/package.json"),
  "../bin/wrangler.js",
);
// The deploy workflow passes a script in this form for the fence Worker.
// Wrangler does not read the entry file of the environment then.
const script = fileURLToPath(new URL("apps/web/src/cutover-fence.ts", root));

for (const [name, command] of [
  ["deploy", ["deploy"]],
  ["deploy <script>", ["deploy", script]],
  ["versions upload", ["versions", "upload"]],
  ["versions upload <script>", ["versions", "upload", script]],
]) {
  test(`wrangler ${name} stops for the local environment`, async () => {
    assert.ok(existsSync(script));
    await using logs = await mkdtempDisposable(resolve(tmpdir(), "visonaut-local-environment-"));
    // A dry run sends no request. The custom build of the environment runs in
    // the same place in a real run, which is before the sign-in.
    const result = spawnSync(
      process.execPath,
      [wrangler, ...command, "--env", "local", "--config", config, "--dry-run"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: "not-a-token",
          WRANGLER_HIDE_BANNER: "true",
          WRANGLER_LOG_PATH: logs.path,
          WRANGLER_SEND_METRICS: "false",
        },
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /Running custom build `[^`]+` failed/);
  });
}
