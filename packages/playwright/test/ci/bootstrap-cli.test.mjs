import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const bootstrap = fileURLToPath(new URL("../../ci/bootstrap-cli.mjs", import.meta.url));

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "visonaut-cli-bootstrap-test-"));
  const runtime = path.join(root, "runtime");
  const modules = path.join(runtime, "node_modules");
  const installed = path.join(modules, "visonaut");
  const source = path.join(root, "source", "package");
  const archive = path.join(root, "visonaut-preview.tgz");
  await mkdir(installed, { recursive: true });
  await mkdir(path.join(source, "dist"), { recursive: true });
  await writeFile(
    path.join(installed, "package.json"),
    JSON.stringify({ name: "visonaut", version: "0.1.0" }),
  );
  await writeFile(path.join(installed, "old.txt"), "public CLI");
  await writeFile(
    path.join(source, "package.json"),
    JSON.stringify({ name: "visonaut", version: "0.2.0-preview.0", type: "module" }),
  );
  await writeFile(
    path.join(source, "dist/index.js"),
    'export function runCli() { return "preview"; }\n',
  );
  execFileSync("tar", ["-czf", archive, "-C", path.dirname(source), "package"]);
  const sha256 = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  return { root, runtime, modules, installed, archive, sha256 };
}

test("checksum mismatch preserves the installed public CLI", async () => {
  const current = await fixture();
  try {
    const result = spawnSync(
      process.execPath,
      [bootstrap, current.runtime, current.archive, "0".repeat(64), "0.2.0-preview.0"],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CLI archive SHA-256 mismatch/);
    assert.equal(await readFile(path.join(current.installed, "old.txt"), "utf8"), "public CLI");
    assert.deepEqual(await readdir(current.modules), ["visonaut"]);
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("package version mismatch preserves the installed public CLI", async () => {
  const current = await fixture();
  try {
    const result = spawnSync(
      process.execPath,
      [bootstrap, current.runtime, current.archive, current.sha256, "0.2.0"],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Wrong CLI package version/);
    assert.equal(await readFile(path.join(current.installed, "old.txt"), "utf8"), "public CLI");
    assert.deepEqual(await readdir(current.modules), ["visonaut"]);
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

test("verified archive replaces the public CLI in the isolated runtime", async () => {
  const current = await fixture();
  try {
    const result = spawnSync(
      process.execPath,
      [bootstrap, current.runtime, current.archive, current.sha256, "0.2.0-preview.0"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Installed checksum-verified visonaut 0\.2\.0-preview\.0/);
    const manifest = JSON.parse(
      await readFile(path.join(current.installed, "package.json"), "utf8"),
    );
    assert.equal(manifest.version, "0.2.0-preview.0");
    const cli = await import(path.join(current.installed, "dist/index.js"));
    assert.equal(cli.runCli(), "preview");
    await assert.rejects(readFile(path.join(current.installed, "old.txt")), { code: "ENOENT" });
    assert.deepEqual(await readdir(current.modules), ["visonaut"]);
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});
