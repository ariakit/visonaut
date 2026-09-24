import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [runtimeDirectory, archiveFile, expectedSha256, expectedVersion] = process.argv.slice(2);
assert(
  runtimeDirectory && archiveFile && expectedSha256 && expectedVersion,
  "Expected runtime directory, CLI archive, SHA-256, and version",
);
assert(/^[a-f0-9]{64}$/.test(expectedSha256), "Invalid pinned CLI SHA-256");
assert(/^0\.2\.0(?:-preview\.0)?$/.test(expectedVersion), "Unexpected CLI bootstrap version");

const archive = await readFile(archiveFile);
assert(archive.length > 0 && archive.length < 16 * 1024 * 1024, "Invalid CLI archive size");
assert.equal(
  createHash("sha256").update(archive).digest("hex"),
  expectedSha256,
  "CLI archive SHA-256 mismatch",
);

const modules = path.resolve(runtimeDirectory, "node_modules");
const installed = path.join(modules, "visonaut");
const temporary = await mkdtemp(path.join(modules, ".visonaut-verified-"));
const backup = `${temporary}-backup`;

try {
  // Extract the bytes just hashed so a changed archive path cannot bypass the pin.
  execFileSync("tar", ["-xzf", "-", "-C", temporary, "--strip-components=1"], {
    input: archive,
    stdio: ["pipe", "inherit", "inherit"],
  });
  const manifest = JSON.parse(await readFile(path.join(temporary, "package.json"), "utf8"));
  assert.equal(manifest.name, "visonaut", "Wrong CLI package name");
  assert.equal(manifest.version, expectedVersion, "Wrong CLI package version");
  assert.deepEqual(manifest.dependencies ?? {}, {}, "CLI archive has runtime dependencies");
  const cli = await import(pathToFileURL(path.join(temporary, "dist/index.js")));
  assert.equal(typeof cli.runCli, "function", "CLI archive lacks runCli");

  await rename(installed, backup);
  try {
    await rename(temporary, installed);
  } catch (error) {
    await rename(backup, installed);
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
  process.stdout.write(
    `Installed checksum-verified visonaut ${expectedVersion} in the isolated runtime\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
