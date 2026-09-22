import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { assertRelease, auditTarball, publicationNeeded, verifyPackages } from "./packages.mjs";

const temporary = mkdtempSync(resolve(tmpdir(), "visonaut-release-test-"));
after(() => rmSync(temporary, { recursive: true, force: true }));
let fixtureId = 0;

function packFixture(name = "visonaut", extraFiles = {}, dependencies = {}) {
  const directory = resolve(temporary, `fixture-${fixtureId++}`);
  mkdirSync(resolve(directory, "dist"), { recursive: true });
  const packageDirectory = name === "visonaut" ? "packages/cli" : "packages/playwright";
  const manifest = {
    name,
    version: "1.2.3",
    repository: { url: "https://github.com/ariakit/visonaut", directory: packageDirectory },
    dependencies,
  };
  const files = {
    "package.json": JSON.stringify(manifest),
    "README.md": "Public API",
    LICENSE: "MIT",
    "dist/index.js": "export const ready = true;",
    "dist/index.d.ts": "export declare const ready: true;",
    "dist/bin.js": "#!/usr/bin/env node\nconsole.log('visonaut');",
    "dist/reporter.js": "export default class Reporter {}",
    ...extraFiles,
  };
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(resolve(directory, name), contents);
  }
  const results = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--ignore-scripts"], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: resolve(temporary, "cache") },
    }),
  );
  const [result] = Object.values(results);
  return {
    bytes: readFileSync(resolve(directory, result.filename)),
    filename: result.filename,
    expected: { name, version: "1.2.3", directory: packageDirectory },
  };
}

test("the public package audit accepts actual npm archives and rejects private files and imports", () => {
  const good = packFixture();
  assert.equal(auditTarball(good.bytes, good.expected).name, "visonaut");
  const config = packFixture("visonaut", { "dist/wrangler.json": "{}" });
  assert.throws(
    () => auditTarball(config.bytes, config.expected),
    /Unexpected public package file/,
  );
  const internal = packFixture("visonaut", {
    "dist/index.d.ts": 'export { Secret } from "@visonaut/security";',
  });
  assert.throws(() => auditTarball(internal.bytes, internal.expected), /escaped bundling/);
  const workspace = packFixture("visonaut", {}, { internal: "file:../server" });
  assert.throws(
    () => auditTarball(workspace.bytes, workspace.expected),
    /Local runtime dependency/,
  );
});

test("artifact verification binds both tarballs and their hashes to one source commit", async () => {
  const directory = resolve(temporary, "artifact");
  mkdirSync(directory);
  const packages = [packFixture(), packFixture("@visonaut/playwright")].map((fixture) => {
    writeFileSync(resolve(directory, fixture.filename), fixture.bytes);
    return {
      name: fixture.expected.name,
      version: fixture.expected.version,
      filename: fixture.filename,
      bytes: fixture.bytes.length,
      sha256: createHash("sha256").update(fixture.bytes).digest("hex"),
      integrity: `sha512-${createHash("sha512").update(fixture.bytes).digest("base64")}`,
    };
  });
  const sourceCommit = "a".repeat(40);
  writeFileSync(
    resolve(directory, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, sourceCommit, packages }),
  );
  assert.equal((await verifyPackages(directory, sourceCommit)).length, 2);
  await assert.rejects(verifyPackages(directory, "b".repeat(40)), /source commit mismatch/);
  writeFileSync(resolve(directory, packages[0].filename), "changed after CI");
  await assert.rejects(verifyPackages(directory, sourceCommit), /byte count mismatch/);
});

test("publication requires the exact main commit with completed launch readiness", () => {
  const environment = {
    GITHUB_REPOSITORY_ID: "1380751023",
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_SHA: "a".repeat(40),
    VISONAUT_RELEASE_COMMIT: "a".repeat(40),
    VISONAUT_RELEASE_TAG: "latest",
  };
  assert.doesNotThrow(() => assertRelease(environment));
  for (const field of [
    "GITHUB_REPOSITORY_ID",
    "GITHUB_REF",
    "GITHUB_EVENT_NAME",
    "VISONAUT_RELEASE_COMMIT",
    "VISONAUT_RELEASE_TAG",
  ]) {
    assert.throws(() => assertRelease({ ...environment, [field]: "untrusted" }));
  }
});

test("a partial publication can resume only when existing bytes and tags match", () => {
  const record = { version: "1.2.3", integrity: "sha512-expected" };
  assert.equal(publicationNeeded(record, null, "latest"), true);
  const registry = {
    versions: { "1.2.3": { dist: { integrity: record.integrity } } },
    "dist-tags": { latest: "1.2.3" },
  };
  assert.equal(publicationNeeded(record, registry, "latest"), false);
  assert.throws(
    () => publicationNeeded({ ...record, integrity: "sha512-other" }, registry, "latest"),
    /different bytes/,
  );
  assert.throws(() => publicationNeeded(record, registry, "next"), /tag must be set separately/);
});
