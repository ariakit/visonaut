import assert from "node:assert/strict";
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdtempDisposable } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { compileFunction } from "node:vm";
import { experimental_patchConfig, unstable_readConfig } from "wrangler";

const workflow = readFileSync(new URL("../deploy.yml", import.meta.url), "utf8");
const match = workflow.match(
  /- name: Check the exact web target before loading secrets[\s\S]*?<<'JS'\n([\s\S]*?)\n          JS/,
);
assert.ok(match);
const guard = compileFunction(
  match[1].replace(/^          /gm, "").replace(/^import .*;\n/gm, ""),
  [
    "assert",
    "constants",
    "copyFileSync",
    "existsSync",
    "readFileSync",
    "experimental_patchConfig",
    "unstable_readConfig",
    "process",
  ],
);
const source = readFileSync(new URL("../../../apps/web/wrangler.jsonc", import.meta.url));

function fixture(directory, preview, mutate) {
  const path = (file) => resolve(directory.path, file);
  mkdirSync(path("apps/web/dist/server"), { recursive: true });
  const config = path("apps/web/wrangler.jsonc");
  writeFileSync(config, source);
  const configuration = unstable_readConfig({
    config,
    ...(preview ? {} : { env: "production" }),
  });
  const original = preview ? path("apps/web/dist/server/wrangler.json") : config;
  if (preview) {
    writeFileSync(original, JSON.stringify(configuration));
  }
  if (mutate) {
    const patch = mutate(configuration);
    experimental_patchConfig(original, preview ? patch : { env: { production: patch } }, false);
  }
  let copies = 0;
  return {
    copies: () => copies,
    run: () =>
      guard(
        assert,
        constants,
        (original, temporary, flags) => {
          copies += 1;
          copyFileSync(path(original), path(temporary), flags);
        },
        (file) => existsSync(path(file)),
        (file, encoding) => readFileSync(path(file), encoding),
        (file, patch, insertion) => experimental_patchConfig(path(file), patch, insertion),
        (args) => unstable_readConfig({ ...args, config: path(args.config) }),
        { env: { VISONAUT_WEB_ACTION: preview ? "preview-web" : "production-fence" } },
      ),
  };
}

for (const action of ["preview-web", "production-fence"]) {
  const preview = action === "preview-web";

  test(`${action} accepts the default configuration`, async () => {
    await using directory = await mkdtempDisposable(resolve(tmpdir(), "visonaut-web-target-"));
    const configured = fixture(directory, preview);
    assert.doesNotThrow(configured.run);
    assert.equal(configured.copies(), 1);
  });

  if (!preview) {
    test(`${action} rejects changed concurrency before copying the configuration`, async () => {
      await using directory = await mkdtempDisposable(resolve(tmpdir(), "visonaut-web-target-"));
      const configured = fixture(directory, preview, (configuration) => ({
        queues: {
          consumers: configuration.queues.consumers.map((consumer) => ({
            ...consumer,
            max_concurrency: 2,
          })),
        },
      }));
      assert.throws(configured.run, { code: "ERR_ASSERTION" });
      assert.equal(configured.copies(), 0);
    });
  }

  for (const field of ["enabled", "traces"]) {
    test(`${action} rejects disabled observability ${field}`, async () => {
      await using directory = await mkdtempDisposable(resolve(tmpdir(), "visonaut-web-target-"));
      const configured = fixture(directory, preview, (configuration) => ({
        observability: {
          ...configuration.observability,
          ...(field === "enabled"
            ? { enabled: false }
            : { traces: { ...configuration.observability.traces, enabled: false } }),
        },
      }));
      assert.throws(configured.run, { code: "ERR_ASSERTION" });
    });
  }
}

for (const [name, patch] of [
  ["database", { d1_databases: [{ binding: "DB", database_id: "preview-database" }] }],
  ["images bucket", { r2_buckets: [{ binding: "IMAGES", bucket_name: "preview-images" }] }],
  ["comparator service", { services: [{ binding: "COMPARATOR", service: "preview-compare" }] }],
  [
    "queue producer",
    { queues: { producers: [{ binding: "OPERATIONS", queue: "preview-operations" }] } },
  ],
  ["queue consumer", { queues: { consumers: [{ queue: "preview-operations" }] } }],
  ["live environment", { vars: { VISONAUT_ENVIRONMENT: "production" } }],
  ["live origin", { vars: { VISONAUT_ORIGIN: "https://visonaut.com" } }],
  ["enabled launch", { vars: { VISONAUT_LAUNCH_ENABLED: "true" } }],
]) {
  test(`preview-web rejects ${name}`, async () => {
    await using directory = await mkdtempDisposable(resolve(tmpdir(), "visonaut-web-target-"));
    const configured = fixture(directory, true, () => patch);
    assert.throws(configured.run, { code: "ERR_ASSERTION" });
  });
}
