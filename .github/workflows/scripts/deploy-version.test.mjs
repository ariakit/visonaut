import assert from "node:assert/strict";
import { test } from "node:test";
import { assertInfrastructure, versionConfiguration } from "./deploy-version.mjs";

const configuration = {
  name: "ariviso",
  configPath: "/workspace/apps/web/dist/server/wrangler.json",
  main: "/workspace/apps/web/dist/server/index.js",
  assets: { directory: "../client", binding: "ASSETS" },
  queues: {
    producers: [{ binding: "OPERATIONS", queue: "ariviso-production-operations" }],
    consumers: [{ queue: "ariviso-production-operations", max_retries: 5 }],
  },
  d1_databases: [{ binding: "DB", database_id: "database-id" }],
  r2_buckets: [{ binding: "IMAGES", bucket_name: "ariviso-production-images" }],
  triggers: { crons: ["*/5 * * * *"] },
  vars: { ARIVISO_ENVIRONMENT: "production" },
  secrets: { required: ["BETTER_AUTH_SECRET"] },
  unsafe: {},
};
const settings = {
  bindings: [
    { type: "queue", name: "OPERATIONS", queue_name: "ariviso-production-operations" },
    { type: "d1", name: "DB", id: "database-id" },
    { type: "r2_bucket", name: "IMAGES", bucket_name: "ariviso-production-images" },
    { type: "secret_text", name: "BETTER_AUTH_SECRET" },
  ],
};
const schedules = { schedules: [{ cron: "*/5 * * * *" }] };

test("version upload preserves absolute asset paths and inherits verified queue bindings", () => {
  const result = versionConfiguration(configuration, Object.keys(configuration));
  assert.equal(result.main, "/workspace/apps/web/dist/server/index.js");
  assert.equal(result.base_dir, "/workspace/apps/web/dist/server");
  assert.deepEqual(result.assets, {
    directory: "/workspace/apps/web/dist/client",
    binding: "ASSETS",
  });
  assert.deepEqual(result.unsafe.bindings, [{ name: "OPERATIONS", type: "inherit" }]);
  assert.equal(result.queues, undefined);
  assert.equal(result.triggers, undefined);
  assert.deepEqual(result.d1_databases, configuration.d1_databases);
  assert.deepEqual(result.r2_buckets, configuration.r2_buckets);
  assert.deepEqual(result.vars, configuration.vars);
  assert.deepEqual(result.secrets, configuration.secrets);
});

test("preflight refuses changed resource targets and cron expressions", () => {
  assert.doesNotThrow(() => assertInfrastructure(configuration, settings, schedules));
  const changedQueue = structuredClone(settings);
  changedQueue.bindings[0].queue_name = "other-environment-operations";
  assert.throws(
    () => assertInfrastructure(configuration, changedQueue, schedules),
    /Resource bindings differ/,
  );
  const changedDatabase = structuredClone(settings);
  changedDatabase.bindings[1].id = "other-environment-database";
  assert.throws(
    () => assertInfrastructure(configuration, changedDatabase, schedules),
    /Resource bindings differ/,
  );
  assert.throws(
    () => assertInfrastructure(configuration, settings, { schedules: [] }),
    /Cron schedules differ/,
  );
});
