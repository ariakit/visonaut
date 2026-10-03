import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempDisposable, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const publicPackages = [
  { name: "@visonaut/playwright", directory: "packages/playwright" },
  { name: "visonaut", directory: "packages/cli" },
];

/** These temporary archives test package contents, not publication byte identity. */
async function smokePackages() {
  await using temporary = await mkdtempDisposable(resolve(tmpdir(), "visonaut-package-smoke-"));
  const archives = [];
  for (const record of publicPackages) {
    const archive = resolve(
      temporary.path,
      `${record.name.replace(/^@/, "").replaceAll("/", "-")}.tgz`,
    );
    execFileSync("pnpm", ["--dir", record.directory, "pack", "--out", archive], {
      stdio: "inherit",
    });
    const files = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
    const manifest = JSON.parse(await readFile(resolve(record.directory, "package.json"), "utf8"));
    assert.equal(manifest.name, record.name);
    assert.notEqual(manifest.private, true);
    const ciFiles = new Set(
      (manifest.files ?? [])
        .filter((path) => path.startsWith("ci/"))
        .map((path) => `package/${path}`),
    );
    for (const file of files) {
      assert(
        /^package\/(?:package\.json|README\.md|LICENSE|dist\/[A-Za-z0-9_.-]+\.(?:js|d\.ts))$/.test(
          file,
        ) || ciFiles.has(file),
        `Unexpected public package file: ${file}`,
      );
    }
    archives.push(archive);
  }
  const destination = resolve(temporary.path, "consumer");
  const cliArchive = archives[publicPackages.findIndex((record) => record.name === "visonaut")];
  const adapterArchive =
    archives[publicPackages.findIndex((record) => record.name === "@visonaut/playwright")];
  assert(cliArchive && adapterArchive, "Both public package archives are required");
  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      destination,
      "--cache",
      resolve(temporary.path, "npm-cache"),
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      cliArchive,
    ],
    { stdio: "inherit" },
  );
  const installed = resolve(destination, "node_modules");
  const cli = JSON.parse(await readFile(resolve(installed, "visonaut/package.json"), "utf8"));
  assert.equal(cli.dependencies?.["@visonaut/playwright"], undefined, "CLI depends on the adapter");
  await assert.rejects(readFile(resolve(installed, "@visonaut/playwright/package.json")), {
    code: "ENOENT",
  });
  assert.deepEqual(Object.keys(cli.bin), ["visonaut"], "Unexpected CLI command");
  assert.match(
    execFileSync(resolve(installed, ".bin/visonaut"), ["--help"], { encoding: "utf8" }),
    /visonaut submit/,
  );
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'import assert from "node:assert/strict"; import { runCli } from "visonaut"; assert.equal(typeof runCli, "function");',
    ],
    { cwd: destination, stdio: "inherit" },
  );
  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      destination,
      "--cache",
      resolve(temporary.path, "npm-cache"),
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      adapterArchive,
    ],
    { stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'import assert from "node:assert/strict"; import { visual, visualBatch } from "@visonaut/playwright"; import Reporter from "@visonaut/playwright/reporter"; import { measureEnvironment } from "@visonaut/playwright/environment"; for (const entry of [visual, visualBatch, Reporter, measureEnvironment]) assert.equal(typeof entry, "function");',
    ],
    { cwd: destination, stdio: "inherit" },
  );
  for (const record of publicPackages) {
    const directory = resolve(installed, record.name);
    for (const file of await readdir(resolve(directory, "dist"))) {
      const source = await readFile(resolve(directory, "dist", file), "utf8");
      assert(
        !/(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)["']@visonaut\/(?!playwright)/.test(
          source,
        ),
        "Internal dependency escaped bundling",
      );
      assert(
        !/(?:^|\n)-----BEGIN PRIVATE KEY-----\n/.test(source),
        "Private key in public package",
      );
    }
  }
}

await smokePackages();
