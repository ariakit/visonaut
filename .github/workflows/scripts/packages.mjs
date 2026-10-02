import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, mkdtempDisposable, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const publicPackages = [
  { name: "@visonaut/playwright", directory: "packages/playwright" },
  { name: "visonaut", directory: "packages/cli" },
];

export function assertRelease(environment) {
  assert.equal(environment.GITHUB_REPOSITORY_ID, "1380751023", "Release repository mismatch");
  assert.equal(environment.GITHUB_REF, "refs/heads/main", "Release requires main");
  assert(
    ["push", "workflow_dispatch"].includes(environment.GITHUB_EVENT_NAME),
    "Release requires a main push or manual dispatch",
  );
  assert(/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA ?? ""), "Invalid release commit");
  assert.equal(
    environment.VISONAUT_RELEASE_COMMIT,
    environment.GITHUB_SHA,
    "Source commit has not passed release readiness",
  );
  assert(["latest", "next"].includes(environment.VISONAUT_RELEASE_TAG), "Invalid npm tag");
  if (environment.GITHUB_EVENT_NAME === "push") {
    assert.equal(environment.VISONAUT_RELEASE_TAG, "latest", "Automatic release requires latest");
  }
}

/** Pending private-only Changesets do not require a version PR. */
export function versioningNeeded(plan) {
  assert(Array.isArray(plan.releases), "Invalid Changesets version plan");
  return plan.releases.length > 0;
}

export function publicationNeeded(record, registry, tag) {
  const existing = registry?.versions?.[record.version];
  if (!existing) return true;
  assert.equal(
    registry["dist-tags"]?.[tag],
    record.version,
    "An existing version has a different requested npm tag",
  );
  assert.equal(
    existing.dist?.attestations?.provenance?.predicateType,
    "https://slsa.dev/provenance/v1",
    "Published version has no provenance attestation",
  );
  return false;
}

export async function releaseRecords() {
  const records = [];
  for (const expected of publicPackages) {
    const manifest = JSON.parse(
      await readFile(resolve(expected.directory, "package.json"), "utf8"),
    );
    assert.equal(manifest.name, expected.name);
    assert.notEqual(manifest.private, true);
    assert(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version));
    records.push({ ...expected, version: manifest.version });
  }
  return records;
}

async function registryPackage(name) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return null;
  assert(response.ok, "Cannot read npm metadata");
  return response.json();
}

export async function checkRegistry({ records, tag, published, read = registryPackage }) {
  let pending = 0;
  for (const record of records) {
    const needed = publicationNeeded(record, await read(record.name), tag);
    if (needed) pending += 1;
    if (published)
      assert(!needed, `Expected version was not published: ${record.name}@${record.version}`);
  }
  return pending;
}

export async function publishedMetadata({ records, tag, read = registryPackage, wait = delay }) {
  // npm metadata can omit a version just after publication. Allow five fresh
  // reads after a pause.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const metadata = await Promise.all(records.map((record) => read(record.name)));
    const missing = records.filter((record, index) =>
      publicationNeeded(record, metadata[index], tag),
    );
    const [record] = missing;
    if (!record) {
      return metadata;
    }
    assert(attempt < 5, `Expected version was not published: ${record.name}@${record.version}`);
    await wait(5000);
  }
}

async function verifiedPackages(records, callback) {
  const { withVerifiedPackages } = await import("./package-attestations.mjs");
  return withVerifiedPackages(records, callback);
}

export async function packageContents(directory) {
  const contents = Object.create(null);
  async function visit(path, prefix = "") {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      // Installed dependencies are not part of the published package payload.
      if (entry.name === "node_modules") continue;
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await visit(resolve(path, entry.name), `${name}/`);
      else {
        assert(entry.isFile(), "Published package contains a nonregular file");
        contents[name] = createHash("sha256")
          .update(await readFile(resolve(path, entry.name)))
          .digest("hex");
      }
    }
  }
  await visit(directory);
  return contents;
}

async function unchangedPackage(record, publishedDirectory) {
  await using temporary = await mkdtempDisposable(resolve(tmpdir(), "visonaut-unchanged-"));
  const archive = resolve(temporary.path, "checked-source.tgz");
  execFileSync("pnpm", ["--dir", record.directory, "pack", "--out", archive], { stdio: "inherit" });
  const files = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
  const checked = Object.create(null);
  for (const file of files) {
    assert(file.startsWith("package/") && !file.includes(".."), "Invalid checked package path");
    checked[file.slice("package/".length)] = createHash("sha256")
      .update(execFileSync("tar", ["-xOzf", archive, file]))
      .digest("hex");
  }
  assert.deepEqual(
    await packageContents(publishedDirectory),
    checked,
    `${record.name} changed without a version change`,
  );
}

/** Changesets owns publication; this receipt binds its eligible versions to the checked source. */
export async function releasePlan({
  records,
  sourceSha,
  tag,
  read = registryPackage,
  verify = verifiedPackages,
  unchanged = unchangedPackage,
  allowEmpty = false,
}) {
  const metadata = await Promise.all(records.map((record) => read(record.name)));
  const existing = records.flatMap((record, index) => {
    const version = metadata[index]?.versions?.[record.version];
    return version ? [{ ...record, integrity: version.dist?.integrity }] : [];
  });
  const packages = [];
  const select = async (verified) => {
    for (const [index, record] of records.entries()) {
      if (!metadata[index]?.versions?.[record.version]) {
        packages.push({ name: record.name, version: record.version });
        continue;
      }
      const publication = verified.find(
        (entry) => entry.name === record.name && entry.version === record.version,
      );
      assert(publication, "Published package has no verified provenance");
      if (publication.sourceSha === sourceSha) {
        publicationNeeded(record, metadata[index], tag);
        packages.push({ name: record.name, version: record.version });
      } else {
        await unchanged(record, publication.directory);
      }
    }
  };
  if (existing.length) await verify(existing, select);
  else await select([]);
  assert(allowEmpty || packages.length, "No package version is eligible for this release");
  return { schemaVersion: 1, sourceSha, tag, packages };
}

export function validateReleasePlan(plan, records, sourceSha, tag) {
  assert.equal(plan.schemaVersion, 1, "Invalid release receipt");
  assert.equal(plan.sourceSha, sourceSha, "Release receipt belongs to another source");
  assert.equal(plan.tag, tag, "Release receipt belongs to another npm tag");
  assert(Array.isArray(plan.packages) && plan.packages.length, "Release receipt has no packages");
  const seen = new Set();
  for (const entry of plan.packages) {
    assert(!seen.has(entry.name), "Release receipt has duplicate packages");
    seen.add(entry.name);
    assert(
      records.some((record) => record.name === entry.name && record.version === entry.version),
      "Release receipt does not match checked versions",
    );
  }
}

/** These temporary archives test package contents, not publication byte identity. */
export async function smokePackages() {
  await using temporary = await mkdtempDisposable(resolve(tmpdir(), "visonaut-package-smoke-"));
  const records = await releaseRecords();
  const archives = [];
  for (const record of records) {
    const archive = resolve(
      temporary.path,
      `${record.name.replace(/^@/, "").replaceAll("/", "-")}.tgz`,
    );
    execFileSync("pnpm", ["--dir", record.directory, "pack", "--out", archive], {
      stdio: "inherit",
    });
    const files = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
    const manifest = JSON.parse(await readFile(resolve(record.directory, "package.json"), "utf8"));
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
  const cliArchive = archives[records.findIndex((record) => record.name === "visonaut")];
  const adapterArchive =
    archives[records.findIndex((record) => record.name === "@visonaut/playwright")];
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
  for (const record of records) {
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === "version-needed") {
    const plan = JSON.parse(await readFile(process.argv[3], "utf8"));
    const needed = versioningNeeded(plan);
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `needed=${needed}\n`);
    }
    console.log(JSON.stringify({ event: command, needed }));
  } else if (command === "smoke") {
    await smokePackages();
  } else if (command === "preflight" || command === "result") {
    assertRelease(process.env);
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      process.env.GITHUB_SHA,
    );
    const records = await releaseRecords();
    const sourceSha = process.env.GITHUB_SHA;
    const tag = process.env.VISONAUT_RELEASE_TAG;
    const receipt = resolve(process.env.RUNNER_TEMP ?? tmpdir(), "visonaut-release-plan.json");
    if (command === "preflight") {
      const plan = await releasePlan({
        records,
        sourceSha,
        tag,
        allowEmpty: process.env.GITHUB_EVENT_NAME === "push",
      });
      const eligible = plan.packages.length > 0;
      if (eligible) {
        await writeFile(receipt, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
      }
      if (process.env.GITHUB_OUTPUT) {
        await appendFile(process.env.GITHUB_OUTPUT, `eligible=${eligible}\n`);
      }
      console.log(JSON.stringify({ event: command, packages: plan.packages }));
    } else {
      const plan = JSON.parse(await readFile(receipt, "utf8"));
      validateReleasePlan(plan, records, sourceSha, tag);
      const metadata = await publishedMetadata({
        records: plan.packages,
        tag,
      });
      const published = plan.packages.map((record, index) => ({
        ...record,
        integrity: metadata[index]?.versions?.[record.version]?.dist?.integrity,
      }));
      await verifiedPackages(published, (publications) => {
        for (const entry of plan.packages) {
          const publication = publications.find(
            (record) => record.name === entry.name && record.version === entry.version,
          );
          assert.equal(
            publication?.sourceSha,
            sourceSha,
            "Published package belongs to another checked source",
          );
        }
      });
      console.log(JSON.stringify({ event: command, packages: plan.packages, sourceSha }));
    }
  } else {
    throw new Error("Expected version-needed, smoke, preflight, or result");
  }
}
