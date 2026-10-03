import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(new URL("../deploy.yml", import.meta.url), "utf8");
const migration = workflow.slice(
  workflow.indexOf("  schema-migration:"),
  workflow.indexOf("  web-cutover:"),
);

test("keeps normal and selected schema migrations after retiring one-time conversion", () => {
  assert.match(workflow, /options: \[migrate, preview-web, preview-comparator, production-fence\]/);
  assert.doesNotMatch(
    workflow,
    /simplification-cutover\/run\.mjs|VISONAUT_CUTOVER|inputs\.action == '(inspect|convert)'/,
  );
  assert.match(workflow, /pnpm exec wrangler d1 migrations apply DB --remote --env production/);
  assert.match(migration, /inputs\.action == 'migrate'/);
  assert.match(migration, /secret-name: CLOUDFLARE_MIGRATIONS_API_TOKEN/);
  assert.match(migration, /run: node \.github\/workflows\/scripts\/deploy-credentials\.mjs/);
  assert.match(migration, /CLOUDFLARE_API_TOKEN: \$\{\{ env\.CLOUDFLARE_MIGRATIONS_API_TOKEN \}\}/);
  assert.match(
    migration,
    /migration_command=\(pnpm exec wrangler d1 migrations apply DB --remote\s+--config apps\/web\/wrangler\.jsonc\)/,
  );
  assert.match(migration, /migration_command\+=\(--env production\)/);
  assert.match(migration, /timeout --signal=TERM --kill-after=15s 300s/);
  assert.match(migration, /No automatic retry/);
});

test("requires the exact migration target and both fence acknowledgments before loading credentials", () => {
  const checkStart = migration.indexOf(
    "      - name: Check the exact target and fence acknowledgments",
  );
  const checkEnd = migration.indexOf("      - name: Check the exact migration target", checkStart);
  const source = migration.slice(checkStart, checkEnd).match(/<<'JS'\n([\s\S]*?)\n          JS/);
  assert.ok(source);
  assert.ok(checkEnd < migration.indexOf("      - name: Load only"));
  const check = new Function("process", source[1]);
  const approved = {
    CLOUDFLARE_ACCOUNT_ID: "b04f3af3f0f10a6b9481bc23ba974eca",
    VISONAUT_MIGRATION_WRITE_FENCE: "true",
    VISONAUT_MIGRATION_CONSUMERS_FENCED: "true",
  };
  for (const target of ["production", "preview"]) {
    const env = { ...approved, VISONAUT_MIGRATION_TARGET: target };
    assert.doesNotThrow(() => check({ env }));
    for (const field of ["VISONAUT_MIGRATION_WRITE_FENCE", "VISONAUT_MIGRATION_CONSUMERS_FENCED"]) {
      assert.throws(() => check({ env: { ...env, [field]: "false" } }), /fence acknowledgments/);
    }
    assert.throws(
      () => check({ env: { ...env, CLOUDFLARE_ACCOUNT_ID: "another-account" } }),
      /Invalid migration target/,
    );
  }
  assert.throws(
    () => check({ env: { ...approved, VISONAUT_MIGRATION_TARGET: "unknown" } }),
    /Invalid migration target/,
  );
});
