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
import { assertContainerRetirement } from "./deploy-infrastructure.mjs";

const workflow = readFileSync(new URL("../deploy.yml", import.meta.url), "utf8");
const source = readFileSync(new URL("../../../apps/compare/wrangler.jsonc", import.meta.url));

function inlineGuard(name, parameters, asynchronous = false) {
  const start = workflow.indexOf(`- name: ${name}\n`);
  assert.notEqual(start, -1, `Missing workflow guard: ${name}`);
  const match = workflow.slice(start).match(/<<'JS'\n([\s\S]*?)\n          JS/);
  assert.ok(match);
  const body = match[1].replace(/^          /gm, "").replace(/^import .*;\n/gm, "");
  return compileFunction(asynchronous ? `return (async () => {\n${body}\n})();` : body, parameters);
}

const configurationGuard = inlineGuard(
  "Check the exact preview comparator before loading secrets",
  [
    "assert",
    "constants",
    "copyFileSync",
    "existsSync",
    "experimental_patchConfig",
    "unstable_readConfig",
  ],
);
const retirementGuard = inlineGuard(
  "Require current preview Container drain evidence before class retirement",
  ["assert", "assertContainerRetirement", "process", "fetch", "AbortSignal"],
  true,
);

function configurationFixture(directory, patch) {
  const path = (file) => resolve(directory.path, file);
  mkdirSync(path("apps/compare"), { recursive: true });
  writeFileSync(path("apps/compare/wrangler.jsonc"), source);
  if (patch) {
    experimental_patchConfig(path("apps/compare/wrangler.jsonc"), patch, false);
  }
  return () => {
    configurationGuard(
      assert,
      constants,
      (original, temporary, flags) => copyFileSync(path(original), path(temporary), flags),
      (file) => existsSync(path(file)),
      (file, replacement, insertion) =>
        experimental_patchConfig(path(file), replacement, insertion),
      (options) => unstable_readConfig({ ...options, config: path(options.config) }),
    );
    return unstable_readConfig({ config: path("apps/compare/cutover-wrangler.jsonc") });
  };
}

const namespaceId = "ce5039e5f4664419a341fcef053b4b78";
const settings = {
  bindings: [
    { name: "CODEC_CONTAINER", class_name: "ComparisonContainer", namespace_id: namespaceId },
    { name: "VISONAUT_CODEC_BACKEND", text: "worker" },
  ],
};

function runRetirementGuard({
  metadata = settings,
  receipt,
  account,
  token = "test-token",
  ok = true,
}) {
  return retirementGuard(
    assert,
    assertContainerRetirement,
    {
      env: {
        CLOUDFLARE_ACCOUNT_ID: account ?? "b04f3af3f0f10a6b9481bc23ba974eca",
        CLOUDFLARE_API_TOKEN: token,
        VISONAUT_PREVIEW_CONTAINER_RETIREMENT_VERIFIED: receipt
          ? JSON.stringify(receipt)
          : undefined,
      },
    },
    async (url, options) => {
      assert.equal(
        url,
        "https://api.cloudflare.com/client/v4/accounts/b04f3af3f0f10a6b9481bc23ba974eca/workers/scripts/visonaut-preview-compare/settings",
      );
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer test-token");
      return { ok, json: async () => ({ success: true, result: metadata }) };
    },
    AbortSignal,
  );
}

test("preview comparator preserves the consumer fence and exact class retirement", async () => {
  await using directory = await mkdtempDisposable(
    resolve(tmpdir(), "visonaut-preview-comparator-"),
  );
  const configuration = configurationFixture(directory)();
  assert.deepEqual(configuration.queues.consumers, []);
  assert.equal(configuration.name, "visonaut-preview-compare");
  assert.equal(configuration.migrations[1].tag, "worker-only-v2");
});

for (const [name, patch] of [
  ["another Worker", { name: "visonaut-compare" }],
  [
    "another database",
    { d1_databases: [{ binding: "DB", database_id: "15fcd402-dccb-4359-a1ce-280ff67ca596" }] },
  ],
  [
    "another bucket",
    { r2_buckets: [{ binding: "IMAGES", bucket_name: "visonaut-production-images" }] },
  ],
  ["another migration", { migrations: [{ tag: "other", deleted_classes: ["Other"] }] }],
  [
    "another producer",
    {
      queues: { producers: [{ binding: "COMPARISONS", queue: "visonaut-production-comparisons" }] },
    },
  ],
  ["another consumer", { queues: { consumers: [] } }],
  [
    "a Durable Object binding",
    { durable_objects: { bindings: [{ name: "OTHER", class_name: "Other" }] } },
  ],
]) {
  test(`preview comparator rejects ${name}`, async () => {
    await using directory = await mkdtempDisposable(
      resolve(tmpdir(), "visonaut-preview-comparator-"),
    );
    assert.throws(configurationFixture(directory, patch), { code: "ERR_ASSERTION" });
  });
}

test("preview retirement reads only the exact existing Worker and accepts a fresh matching receipt", async () => {
  await assert.doesNotReject(() =>
    runRetirementGuard({
      receipt: { namespaceId, activeRequests: 0, observedAt: Date.now() - 1_000 },
    }),
  );
});

for (const [name, parameters] of [
  ["absent namespace", { metadata: { bindings: [] } }],
  [
    "another live namespace",
    {
      metadata: {
        bindings: [{ ...settings.bindings[0], namespace_id: "other" }, settings.bindings[1]],
      },
    },
  ],
  [
    "Container backend",
    {
      metadata: {
        bindings: [settings.bindings[0], { name: "VISONAUT_CODEC_BACKEND", text: "container" }],
      },
    },
  ],
  ["missing receipt", {}],
  [
    "another receipt namespace",
    { receipt: { namespaceId: "other", activeRequests: 0, observedAt: Date.now() } },
  ],
  ["active requests", { receipt: { namespaceId, activeRequests: 1, observedAt: Date.now() } }],
  [
    "one-hour-old evidence",
    { receipt: { namespaceId, activeRequests: 0, observedAt: Date.now() - 60 * 60_000 } },
  ],
  [
    "future evidence",
    { receipt: { namespaceId, activeRequests: 0, observedAt: Date.now() + 60 * 60_000 } },
  ],
  ["another account", { account: "other" }],
  ["missing credential", { token: "" }],
  ["unavailable metadata", { ok: false }],
]) {
  test(`preview retirement rejects ${name}`, async () => {
    await assert.rejects(() => runRetirementGuard(parameters));
  });
}

test("preview comparator uses full CI and explicit main, preview and fence selection", () => {
  const verify = workflow.slice(workflow.indexOf("  verify:"), workflow.indexOf("  deploy:"));
  assert.match(verify, /uses: \.\/\.github\/workflows\/checks\.yml/);
  assert.doesNotMatch(verify, /preview-comparator/);
  const job = workflow.slice(workflow.indexOf("  web-cutover:"));
  assert.match(job, /github\.repository_id == '1380751023'/);
  assert.match(job, /github\.ref == 'refs\/heads\/main'/);
  assert.match(job, /github\.event_name == 'workflow_dispatch'/);
  assert.match(job, /inputs\.consumers_fenced == true/);
  assert.match(
    job,
    /inputs\.action == 'preview-comparator' && inputs\.target == 'preview' && inputs\.write_fence == true/,
  );
  assert.match(job, /Require current main immediately before preview comparator deployment/);
  assert.match(
    job,
    /pnpm exec wrangler deploy --config apps\/compare\/cutover-wrangler\.jsonc --env ""\n/,
  );
  assert.doesNotMatch(job, /secret-name: CLOUDFLARE_MIGRATIONS_API_TOKEN/);
});
