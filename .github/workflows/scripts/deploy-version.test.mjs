import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertInfrastructure,
  assertStableDurableObjectNamespaces,
  versionConfiguration,
} from "./deploy-version.mjs";

const configuration = {
  name: "visonaut",
  configPath: "/workspace/apps/web/dist/server/wrangler.json",
  main: "/workspace/apps/web/dist/server/index.js",
  assets: { directory: "../client", binding: "ASSETS" },
  queues: {
    producers: [{ binding: "OPERATIONS", queue: "visonaut-production-operations" }],
    consumers: [{ queue: "visonaut-production-operations", max_retries: 5 }],
  },
  d1_databases: [{ binding: "DB", database_id: "database-id" }],
  r2_buckets: [{ binding: "IMAGES", bucket_name: "visonaut-production-images" }],
  durable_objects: {
    bindings: [{ name: "CODEC_CONTAINER", class_name: "ComparisonContainer" }],
  },
  migrations: [{ tag: "container-v1", new_sqlite_classes: ["ComparisonContainer"] }],
  triggers: { crons: ["*/5 * * * *"] },
  vars: { VISONAUT_ENVIRONMENT: "production" },
  secrets: { required: ["BETTER_AUTH_SECRET"] },
  unsafe: {},
};
const settings = {
  bindings: [
    { type: "queue", name: "OPERATIONS", queue_name: "visonaut-production-operations" },
    { type: "d1", name: "DB", id: "database-id" },
    { type: "r2_bucket", name: "IMAGES", bucket_name: "visonaut-production-images" },
    {
      type: "durable_object_namespace",
      name: "CODEC_CONTAINER",
      class_name: "ComparisonContainer",
      namespace_id: "98373c1bd2da4606995dcd539f170626",
    },
    { type: "secret_text", name: "BETTER_AUTH_SECRET" },
  ],
};
const schedules = { schedules: [{ cron: "*/5 * * * *" }] };

function containerBinding(workerSettings) {
  const binding = workerSettings.bindings.find((entry) => entry.name === "CODEC_CONTAINER");
  assert(binding);
  return binding;
}

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
  assert.deepEqual(result.durable_objects, configuration.durable_objects);
  assert.deepEqual(result.migrations, configuration.migrations);
  assert.deepEqual(result.vars, configuration.vars);
  assert.deepEqual(result.secrets, configuration.secrets);
});

test("preflight refuses changed resource targets and cron expressions", () => {
  assert.deepEqual(assertInfrastructure(configuration, settings, schedules), [
    { name: "CODEC_CONTAINER", namespaceId: "98373c1bd2da4606995dcd539f170626" },
  ]);
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

test("preflight requires the configured self Durable Object namespace", () => {
  const missingBinding = structuredClone(settings);
  missingBinding.bindings = missingBinding.bindings.filter(
    (binding) => binding.name !== "CODEC_CONTAINER",
  );
  assert.throws(
    () => assertInfrastructure(configuration, missingBinding, schedules),
    /Resource bindings differ/,
  );

  const wrongClass = structuredClone(settings);
  containerBinding(wrongClass).class_name = "OtherContainer";
  assert.throws(
    () => assertInfrastructure(configuration, wrongClass, schedules),
    /Resource bindings differ/,
  );

  const externalBinding = structuredClone(settings);
  containerBinding(externalBinding).script_name = "another-worker";
  assert.throws(
    () => assertInfrastructure(configuration, externalBinding, schedules),
    /Resource bindings differ/,
  );

  const wrongEnvironment = structuredClone(settings);
  containerBinding(wrongEnvironment).environment = "preview";
  assert.throws(
    () => assertInfrastructure(configuration, wrongEnvironment, schedules),
    /Resource bindings differ/,
  );

  const missingNamespace = structuredClone(settings);
  delete containerBinding(missingNamespace).namespace_id;
  assert.throws(
    () => assertInfrastructure(configuration, missingNamespace, schedules),
    /Durable Object namespace ID is unavailable/,
  );

  const replacementNamespace = structuredClone(settings);
  containerBinding(replacementNamespace).namespace_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.throws(
    () =>
      assertStableDurableObjectNamespaces(
        assertInfrastructure(configuration, settings, schedules),
        assertInfrastructure(configuration, replacementNamespace, schedules),
      ),
    /Durable Object namespace IDs changed/,
  );
});
