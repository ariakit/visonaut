import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, test } from "node:test";
import {
  assertRelease,
  auditTarball,
  publicationNeeded,
  selectedReleaseRecords,
  verifyPackages,
} from "./packages.mjs";

const temporary = mkdtempSync(resolve(tmpdir(), "visonaut-release-test-"));
after(() => rmSync(temporary, { recursive: true, force: true }));
let fixtureId = 0;
const ciFiles = JSON.parse(readFileSync("packages/playwright/package.json", "utf8")).files.filter(
  (file) => file.startsWith("ci/"),
);

function packFixture(
  name = "visonaut",
  extraFiles = {},
  dependencies = name === "@visonaut/playwright" ? { visonaut: "1.2.3" } : {},
  version = "1.2.3",
) {
  const directory = resolve(temporary, `fixture-${fixtureId++}`);
  mkdirSync(resolve(directory, "dist"), { recursive: true });
  if (name === "@visonaut/playwright") {
    mkdirSync(resolve(directory, "ci"));
  }
  const packageDirectory = name === "visonaut" ? "packages/cli" : "packages/playwright";
  const manifest = {
    name,
    version,
    repository: { url: "https://github.com/ariakit/visonaut", directory: packageDirectory },
    dependencies,
    ...(name === "@visonaut/playwright" ? { bin: { "visonaut-capture": "./ci/bin.mjs" } } : {}),
  };
  const files = {
    "package.json": JSON.stringify(manifest),
    "README.md": "Public API",
    LICENSE: "MIT",
    "dist/index.js": "export const ready = true;",
    "dist/index.d.ts": "export declare const ready: true;",
    "dist/bin.js": "#!/usr/bin/env node\nconsole.log('visonaut');",
    "dist/reporter.js": "export default class Reporter {}",
    ...(name === "@visonaut/playwright"
      ? Object.fromEntries(
          ciFiles.map((file) => [file, readFileSync(resolve("packages/playwright", file))]),
        )
      : {}),
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
    expected: { name, version, directory: packageDirectory },
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
  const extraCi = packFixture("@visonaut/playwright", {
    "ci/private-review.mjs": "export const privateReview = true;",
  });
  assert.throws(
    () => auditTarball(extraCi.bytes, extraCi.expected),
    /Unexpected public package file/,
  );
  const rangedCli = packFixture("@visonaut/playwright", {}, { visonaut: "^1.2.3" });
  assert.throws(() => auditTarball(rangedCli.bytes, rangedCli.expected), /exact CLI version/);
  const runtimeLock = JSON.parse(readFileSync("packages/playwright/ci/runtime-lock.json"));
  runtimeLock.packages["node_modules/visonaut"].integrity = "";
  const unlocked = packFixture("@visonaut/playwright", {
    "ci/runtime-lock.json": JSON.stringify(runtimeLock),
  });
  assert.throws(() => auditTarball(unlocked.bytes, unlocked.expected));
});

test("artifact verification binds both tarballs and their hashes to one source commit", async () => {
  const directory = resolve(temporary, "artifact");
  mkdirSync(directory);
  const packages = [
    packFixture(),
    packFixture("@visonaut/playwright", {}, { visonaut: "1.2.3" }, "1.2.4"),
  ].map((fixture) => {
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
  const mismatchedCli = packFixture("@visonaut/playwright", {}, { visonaut: "1.2.2" }, "1.2.4");
  writeFileSync(resolve(directory, packages[1].filename), mismatchedCli.bytes);
  packages[1].bytes = mismatchedCli.bytes.length;
  packages[1].sha256 = createHash("sha256").update(mismatchedCli.bytes).digest("hex");
  packages[1].integrity = `sha512-${createHash("sha512").update(mismatchedCli.bytes).digest("base64")}`;
  writeFileSync(
    resolve(directory, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, sourceCommit, packages }),
  );
  await assert.rejects(verifyPackages(directory, sourceCommit), /does not match the packed CLI/);
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
    VISONAUT_RELEASE_PACKAGE: "both",
  };
  assert.doesNotThrow(() => assertRelease(environment));
  for (const field of [
    "GITHUB_REPOSITORY_ID",
    "GITHUB_REF",
    "GITHUB_EVENT_NAME",
    "VISONAUT_RELEASE_COMMIT",
    "VISONAUT_RELEASE_TAG",
    "VISONAUT_RELEASE_PACKAGE",
  ]) {
    assert.throws(() => assertRelease({ ...environment, [field]: "untrusted" }));
  }
});

test("a staged release publishes only the selected verified package", () => {
  const records = [{ name: "visonaut" }, { name: "@visonaut/playwright" }];
  assert.deepEqual(selectedReleaseRecords(records, "visonaut"), [records[0]]);
  assert.deepEqual(selectedReleaseRecords(records, "@visonaut/playwright"), [records[1]]);
  assert.deepEqual(selectedReleaseRecords(records, "both"), records);
  assert.throws(() => selectedReleaseRecords(records, "untrusted"), /Invalid npm release package/);
  assert.throws(
    () => selectedReleaseRecords([records[0]], "@visonaut/playwright"),
    /Selected npm package is missing/,
  );
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
