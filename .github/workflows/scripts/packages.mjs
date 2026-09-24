import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const packages = [
  { name: "visonaut", directory: "packages/cli" },
  { name: "@visonaut/playwright", directory: "packages/playwright" },
];
const sourcePattern = /^[a-f0-9]{40}$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const releasePackages = ["both", ...packages.map((entry) => entry.name)];
const playwrightCiFiles = new Set([
  "package/ci/bin.mjs",
  "package/ci/bootstrap-cli.mjs",
  "package/ci/config.mjs",
  "package/ci/context.mjs",
  "package/ci/environment.mjs",
  "package/ci/identity.mjs",
  "package/ci/index.d.mts",
  "package/ci/index.mjs",
  "package/ci/package.json",
  "package/ci/playwright.config.mjs",
  "package/ci/rebind.mjs",
  "package/ci/render-context.mjs",
  "package/ci/runner.mjs",
  "package/ci/runtime-lock.json",
  "package/ci/settings.mjs",
  "package/ci/transfer.mjs",
  "package/ci/tsconfig.json",
]);
const ciRuntimeDependencies = {
  "@playwright/test": "1.63.0",
  pngjs: "7.0.0",
  visonaut: "0.1.0",
};
const ciRuntimeVersions = {
  "node_modules/@playwright/test": "1.63.0",
  "node_modules/playwright": "1.63.0",
  "node_modules/playwright-core": "1.63.0",
  "node_modules/pngjs": "7.0.0",
  "node_modules/visonaut": "0.1.0",
};

function hash(bytes, algorithm = "sha256", encoding = "hex") {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function textField(header, start, length) {
  return header
    .subarray(start, start + length)
    .toString("utf8")
    .replace(/\0.*$/s, "");
}

export function auditTarball(bytes, expected) {
  assert(bytes.length <= 16 * 1024 * 1024, "Package exceeds the compressed byte limit");
  const tar = gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 });
  const files = new Map();
  let offset = 0;
  for (; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const prefix = textField(header, 345, 155);
    const name = `${prefix ? `${prefix}/` : ""}${textField(header, 0, 100)}`;
    const checksum = Number.parseInt(textField(header, 148, 8).trim(), 8);
    const actualChecksum = header.reduce(
      (sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
      0,
    );
    assert.equal(checksum, actualChecksum, "Invalid archive header checksum");
    assert(header[156] === 0 || header[156] === 48, "Only regular package files are allowed");
    const commonFile =
      /^package\/(?:package\.json|README\.md|LICENSE|dist\/[A-Za-z0-9_.-]+\.(?:js|d\.ts))$/.test(
        name,
      );
    const ciFile = expected.name === "@visonaut/playwright" && playwrightCiFiles.has(name);
    assert(commonFile || ciFile, `Unexpected public package file: ${name}`);
    assert(!files.has(name), "Duplicate package file");
    const sizeField = textField(header, 124, 12).trim();
    assert(/^[0-7]+$/.test(sizeField), "Invalid archive size");
    const size = Number.parseInt(sizeField, 8);
    assert(offset + 512 + size <= tar.length, "Truncated package file");
    files.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert(tar.length >= offset + 1024, "Archive has no complete end marker");
  assert(
    tar.subarray(offset).every((byte) => byte === 0),
    "Unexpected archive trailer",
  );
  const manifest = JSON.parse(files.get("package/package.json")?.toString() ?? "null");
  assert.equal(manifest?.name, expected.name, "Unexpected package name");
  assert.equal(manifest.version, expected.version, "Unexpected package version");
  assert(versionPattern.test(manifest.version), "Invalid package version");
  assert.notEqual(manifest.private, true, "Cannot publish a private package");
  assert.equal(manifest.repository?.url, "https://github.com/ariakit/visonaut");
  assert.equal(manifest.repository?.directory, expected.directory);
  for (const dependencies of [
    manifest.dependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ]) {
    for (const [name, range] of Object.entries(dependencies ?? {})) {
      assert(!name.startsWith("@visonaut/"), "Internal runtime dependency escaped bundling");
      assert(!/^(?:workspace|file|link):/.test(range), "Local runtime dependency escaped packing");
    }
  }
  for (const [name, content] of files) {
    if (!name.startsWith("package/dist/") && !name.startsWith("package/ci/")) {
      continue;
    }
    assert(
      !/(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)["']@visonaut\//.test(content.toString()),
      "Internal runtime or declaration import escaped bundling",
    );
    assert(
      !/(?:^|\n)-----BEGIN PRIVATE KEY-----\n/.test(content.toString()),
      "Private key in public package",
    );
  }
  for (const required of [
    "package/README.md",
    "package/LICENSE",
    "package/dist/index.js",
    "package/dist/index.d.ts",
  ]) {
    assert(files.has(required), `Missing public package file: ${required}`);
  }
  if (expected.name === "visonaut") {
    assert(files.has("package/dist/bin.js"), "CLI binary is missing");
  } else {
    assert(files.has("package/dist/reporter.js"), "Playwright reporter is missing");
    assert.equal(manifest.bin?.["visonaut-capture"], "./ci/bin.mjs");
    assert(
      versionPattern.test(manifest.dependencies?.visonaut ?? ""),
      "Adapter needs an exact CLI version",
    );
    for (const file of playwrightCiFiles) {
      assert(files.has(file), `Trusted CI helper is missing: ${file}`);
    }
    const runtime = JSON.parse(files.get("package/ci/package.json").toString());
    const lock = JSON.parse(files.get("package/ci/runtime-lock.json").toString());
    assert.deepEqual(
      runtime.dependencies,
      ciRuntimeDependencies,
      "Unexpected CI runtime dependency",
    );
    assert.equal(lock.lockfileVersion, 3, "Unexpected CI runtime lock version");
    assert.deepEqual(lock.packages?.[""].dependencies, ciRuntimeDependencies);
    assert.deepEqual(
      Object.keys(lock.packages).sort(),
      ["", ...Object.keys(ciRuntimeVersions)].sort(),
      "Unexpected CI runtime lock entry",
    );
    for (const [name, entry] of Object.entries(lock.packages)) {
      if (!name) continue;
      assert(/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity));
      assert.equal(entry.version, ciRuntimeVersions[name]);
      assert(entry.resolved.startsWith("https://registry.npmjs.org/"));
    }
  }
  return manifest;
}

export function assertRelease(environment) {
  assert.equal(environment.GITHUB_REPOSITORY_ID, "1380751023", "Release repository mismatch");
  assert.equal(environment.GITHUB_REF, "refs/heads/main", "Release requires main");
  assert.equal(
    environment.GITHUB_EVENT_NAME,
    "workflow_dispatch",
    "Release requires manual dispatch",
  );
  assert(sourcePattern.test(environment.GITHUB_SHA ?? ""), "Invalid release source commit");
  assert.equal(
    environment.VISONAUT_RELEASE_COMMIT,
    environment.GITHUB_SHA,
    "Source commit has not passed launch readiness",
  );
  assert(["latest", "next"].includes(environment.VISONAUT_RELEASE_TAG), "Invalid npm tag");
  assert(
    releasePackages.includes(environment.VISONAUT_RELEASE_PACKAGE),
    "Invalid npm release package",
  );
}

export function selectedReleaseRecords(records, selection) {
  assert(releasePackages.includes(selection), "Invalid npm release package");
  if (selection === "both") {
    return records;
  }
  const selected = records.filter((record) => record.name === selection);
  assert.equal(selected.length, 1, "Selected npm package is missing");
  return selected;
}

export function publicationNeeded(record, registry, tag) {
  const existing = registry?.versions?.[record.version];
  if (!existing) {
    return true;
  }
  assert.equal(existing.dist?.integrity, record.integrity, "Published version has different bytes");
  assert.equal(
    registry["dist-tags"]?.[tag],
    record.version,
    "Published bytes match, but the requested npm tag must be set separately",
  );
  return false;
}

export async function verifyPackages(directory, sourceCommit) {
  assert(sourcePattern.test(sourceCommit ?? ""), "Invalid source commit");
  const manifest = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.sourceCommit, sourceCommit, "Package source commit mismatch");
  assert.equal(manifest.packages?.length, packages.length);
  const records = [];
  const manifests = new Map();
  for (const expected of packages) {
    const record = manifest.packages.find((entry) => entry.name === expected.name);
    assert(record && versionPattern.test(record.version), "Missing or invalid package version");
    const filename = `${expected.name.replace(/^@/, "").replaceAll("/", "-")}-${record.version}.tgz`;
    assert.equal(record.filename, filename, "Package filename mismatch");
    const bytes = await readFile(resolve(directory, filename));
    assert.equal(record.bytes, bytes.length, "Package byte count mismatch");
    assert.equal(record.sha256, hash(bytes), "Package SHA-256 mismatch");
    assert.equal(
      record.integrity,
      `sha512-${hash(bytes, "sha512", "base64")}`,
      "Package integrity mismatch",
    );
    manifests.set(expected.name, auditTarball(bytes, { ...expected, version: record.version }));
    records.push(record);
  }
  assert.equal(
    manifests.get("@visonaut/playwright")?.dependencies.visonaut,
    manifests.get("visonaut")?.version,
    "The adapter dependency does not match the packed CLI",
  );
  assert.deepEqual(
    (await readdir(directory)).sort(),
    ["manifest.json", ...records.map((record) => record.filename)].sort(),
    "Package artifact contains unexpected files",
  );
  return records;
}

export async function verifyCiRuntimeArchive(archive) {
  const destination = await mkdtemp(resolve(tmpdir(), "visonaut-ci-runtime-"));
  try {
    execFileSync("tar", ["-xzf", archive, "-C", destination]);
    const runtime = resolve(destination, "package/ci");
    const lock = await readFile(resolve(runtime, "runtime-lock.json"));
    await copyFile(resolve(runtime, "runtime-lock.json"), resolve(runtime, "package-lock.json"));
    execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: runtime,
      stdio: "inherit",
    });
    assert.deepEqual(await readFile(resolve(runtime, "package-lock.json")), lock);
    assert.match(
      execFileSync("node", [resolve(runtime, "bin.mjs"), "--help"], { encoding: "utf8" }),
      /visonaut-capture render/,
    );
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
}

async function verifyNormalInstall(directory, records) {
  const destination = await mkdtemp(resolve(tmpdir(), "visonaut-normal-install-"));
  try {
    execFileSync(
      "npm",
      [
        "install",
        "--prefix",
        destination,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        ...records.map((record) => resolve(directory, record.filename)),
      ],
      { stdio: "inherit" },
    );
    assert.match(
      execFileSync(resolve(destination, "node_modules/.bin/visonaut-capture"), ["--help"], {
        encoding: "utf8",
      }),
      /visonaut-capture render/,
    );
    assert.match(
      execFileSync(resolve(destination, "node_modules/.bin/visonaut"), ["--help"], {
        encoding: "utf8",
      }),
      /visonaut submit/,
    );
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
}

async function pack(directory) {
  const sourceCommit = process.env.GITHUB_SHA;
  assert(sourcePattern.test(sourceCommit ?? ""), "GITHUB_SHA is required");
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    sourceCommit,
  );
  await mkdir(directory, { recursive: true });
  assert.equal((await readdir(directory)).length, 0, "Package output directory must be empty");
  const records = [];
  for (const expected of packages) {
    const manifest = JSON.parse(
      await readFile(resolve(expected.directory, "package.json"), "utf8"),
    );
    assert.equal(manifest.name, expected.name);
    assert(versionPattern.test(manifest.version), "Invalid package version");
    const filename = `${expected.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`;
    execFileSync(
      "pnpm",
      ["--dir", expected.directory, "pack", "--out", resolve(directory, filename)],
      {
        stdio: "inherit",
      },
    );
    const bytes = await readFile(resolve(directory, filename));
    auditTarball(bytes, { ...expected, version: manifest.version });
    if (expected.name === "@visonaut/playwright") {
      await verifyCiRuntimeArchive(resolve(directory, filename));
    }
    records.push({
      name: expected.name,
      version: manifest.version,
      filename,
      bytes: bytes.length,
      sha256: hash(bytes),
      integrity: `sha512-${hash(bytes, "sha512", "base64")}`,
    });
  }
  await verifyNormalInstall(directory, records);
  await writeFile(
    resolve(directory, "manifest.json"),
    `${JSON.stringify({ schemaVersion: 1, sourceCommit, packages: records }, null, 2)}\n`,
  );
  await verifyPackages(directory, sourceCommit);
}

async function registryPackage(name) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) {
    return null;
  }
  assert(response.ok, "Cannot read public npm package metadata");
  return response.json();
}

async function publish(directory) {
  assertRelease(process.env);
  const records = await verifyPackages(directory, process.env.GITHUB_SHA);
  const tag = process.env.VISONAUT_RELEASE_TAG;
  const pending = [];
  for (const record of selectedReleaseRecords(records, process.env.VISONAUT_RELEASE_PACKAGE)) {
    if (publicationNeeded(record, await registryPackage(record.name), tag)) {
      pending.push(record);
    }
  }
  for (const record of pending) {
    execFileSync(
      "npm",
      [
        "publish",
        resolve(directory, record.filename),
        "--access",
        "public",
        "--tag",
        tag,
        "--ignore-scripts",
        "--provenance=false",
      ],
      { stdio: "inherit" },
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory] = process.argv.slice(2);
  assert(directory, "Package artifact directory is required");
  if (command === "pack") {
    await pack(resolve(directory));
  } else if (command === "verify") {
    await verifyPackages(resolve(directory), process.env.GITHUB_SHA);
  } else if (command === "publish") {
    await publish(resolve(directory));
  } else {
    throw new Error("Expected pack, verify, or publish");
  }
}
