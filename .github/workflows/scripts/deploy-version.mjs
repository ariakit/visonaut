import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempDisposable, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const resourceTypes = new Set(["queue", "d1", "r2_bucket", "service"]);

export function resourceInventory(configuration) {
  return [
    ...(configuration.queues?.producers ?? []).map((binding) => ({
      name: binding.binding,
      type: "queue",
      target: binding.queue,
    })),
    ...(configuration.d1_databases ?? []).map((binding) => ({
      name: binding.binding,
      type: "d1",
      target: binding.database_id,
    })),
    ...(configuration.r2_buckets ?? []).map((binding) => ({
      name: binding.binding,
      type: "r2_bucket",
      target: binding.bucket_name,
    })),
    ...(configuration.services ?? []).map((binding) => ({
      name: binding.binding,
      type: "service",
      target: binding.service,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

function remoteInventory(settings) {
  assert(Array.isArray(settings.bindings), "Worker bindings are unavailable");
  return settings.bindings
    .filter((binding) => resourceTypes.has(binding.type))
    .map((binding) => ({
      name: binding.name,
      type: binding.type,
      target: binding.queue_name ?? binding.id ?? binding.bucket_name ?? binding.service,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function assertInfrastructure(configuration, settings, schedules) {
  const expected = resourceInventory(configuration);
  assert(
    expected.every((binding) => typeof binding.target === "string" && binding.target.length > 0),
  );
  assert.deepEqual(
    remoteInventory(settings),
    expected,
    "Resource bindings differ; provision infrastructure separately",
  );
  assert(Array.isArray(schedules.schedules), "Worker cron schedules are unavailable");
  assert.deepEqual(
    schedules.schedules.map((schedule) => schedule.cron).sort(),
    [...(configuration.triggers?.crons ?? [])].sort(),
    "Cron schedules differ; provision infrastructure separately",
  );
  for (const producer of configuration.queues?.producers ?? []) {
    assert.equal(
      producer.delivery_delay,
      undefined,
      "Queue delivery delay needs separate infrastructure handling",
    );
  }
}

export function versionConfiguration(configuration, propertyNames) {
  assert(isAbsolute(configuration.main), "Wrangler must resolve the Worker entry point");
  assert.equal(
    configuration.tsconfig,
    undefined,
    "Custom tsconfig requires a reviewed deployment path",
  );
  assert.deepEqual(configuration.unsafe ?? {}, {}, "Existing unsafe configuration requires review");
  const output = Object.fromEntries(
    Object.entries(configuration).filter(([name]) => propertyNames.includes(name)),
  );
  const base = dirname(configuration.configPath);
  output.main = configuration.main;
  output.base_dir = configuration.base_dir
    ? resolve(base, configuration.base_dir)
    : dirname(configuration.main);
  if (configuration.assets?.directory) {
    output.assets = {
      ...configuration.assets,
      directory: resolve(base, configuration.assets.directory),
    };
  }
  output.unsafe = {
    bindings: (configuration.queues?.producers ?? []).map((binding) => ({
      name: binding.binding,
      type: "inherit",
    })),
  };
  for (const name of [
    "env",
    "queues",
    "triggers",
    "routes",
    "route",
    "workers_dev",
    "preview_urls",
    "observability",
    "logpush",
  ]) {
    delete output[name];
  }
  return output;
}

export async function deployVersion(configPath, expectedName, environment) {
  assert(
    /^ariviso(?:-(?:preview|diagnostics))?(?:-compare)?$/.test(expectedName),
    "Unexpected Worker name",
  );
  const { unstable_readConfig } = await import("wrangler");
  const configuration = unstable_readConfig({ config: resolve(configPath), env: environment });
  assert.equal(configuration.name, expectedName, "Configuration targets the wrong Worker");
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  assert(/^[a-f0-9]{32}$/.test(account ?? ""), "Cloudflare account ID is required");
  assert(process.env.CLOUDFLARE_API_TOKEN, "Cloudflare Worker Editor token is required");
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${expectedName}`;
  async function inspect(path) {
    const response = await fetch(`${endpoint}${path}`, {
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    assert(response.ok, `Worker inspection failed (${response.status})`);
    const result = await response.json();
    assert.equal(result.success, true, "Worker inspection failed");
    return result.result;
  }
  const beforeSettings = await inspect("/settings");
  const beforeSchedules = await inspect("/schedules");
  assertInfrastructure(configuration, beforeSettings, beforeSchedules);
  const wranglerDirectory = dirname(require.resolve("wrangler/package.json"));
  const schema = JSON.parse(
    await readFile(resolve(wranglerDirectory, "config-schema.json"), "utf8"),
  );
  const output = versionConfiguration(
    configuration,
    Object.keys(schema.definitions.RawConfig.properties),
  );
  await using temporary = await mkdtempDisposable(resolve(tmpdir(), "ariviso-version-"));
  const temporaryConfig = resolve(temporary.path, "wrangler.json");
  const recordsPath = resolve(temporary.path, "output.jsonl");
  await writeFile(temporaryConfig, JSON.stringify(output));
  await writeFile(recordsPath, "");
  function wrangler(arguments_) {
    execFileSync(process.execPath, [resolve(wranglerDirectory, "bin/wrangler.js"), ...arguments_], {
      cwd: temporary.path,
      env: {
        ...process.env,
        WRANGLER_OUTPUT_FILE_PATH: recordsPath,
        WRANGLER_SEND_METRICS: "false",
      },
      stdio: "inherit",
      timeout: 180000,
    });
  }
  wrangler([
    "versions",
    "upload",
    "--config",
    temporaryConfig,
    "--outdir",
    resolve(temporary.path, "dist"),
  ]);
  const records = (await readFile(recordsPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const versions = records.filter(
    (record) => record.type === "version-upload" && record.worker_name === expectedName,
  );
  assert.equal(versions.length, 1, "Expected exactly one uploaded Worker version");
  const version = versions[0].version_id;
  assert(
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(version),
    "Invalid uploaded Worker version ID",
  );
  wrangler(["versions", "deploy", `${version}@100`, "--yes", "--config", temporaryConfig]);
  const afterSettings = await inspect("/settings");
  const afterSchedules = await inspect("/schedules");
  assertInfrastructure(configuration, afterSettings, afterSchedules);
  assert.deepEqual(afterSchedules, beforeSchedules, "Version deployment changed cron settings");
  console.log(
    JSON.stringify({
      worker: expectedName,
      version,
      bindingsPreserved: true,
      cronsPreserved: true,
    }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [configPath, expectedName, environment] = process.argv.slice(2);
  assert(configPath && expectedName, "Expected config path, Worker name, and optional environment");
  await deployVersion(configPath, expectedName, environment);
}
