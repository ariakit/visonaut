import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  assertRelease,
  checkRegistry,
  packageContents,
  publicationNeeded,
  publishedMetadata,
  releasePlan,
  validateReleasePlan,
  versioningNeeded,
} from "./packages.mjs";
import { mkdtempDisposable, mkdir, readFile, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const valid = {
  GITHUB_REPOSITORY_ID: "1380751023",
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_SHA: "a".repeat(40),
  VISONAUT_RELEASE_COMMIT: "a".repeat(40),
  VISONAUT_RELEASE_TAG: "next",
};

test("publication requires manual main and the approved source commit", () => {
  for (const tag of ["latest", "next"]) {
    assert.doesNotThrow(() => assertRelease({ ...valid, VISONAUT_RELEASE_TAG: tag }));
  }
  for (const key of Object.keys(valid)) {
    assert.throws(() => assertRelease({ ...valid, [key]: "untrusted" }));
  }
});

test("automatic publication requires main, checked source and latest", () => {
  const automatic = { ...valid, GITHUB_EVENT_NAME: "push", VISONAUT_RELEASE_TAG: "latest" };
  assert.doesNotThrow(() => assertRelease(automatic));
  for (const [key, value] of Object.entries({
    GITHUB_REPOSITORY_ID: "1",
    GITHUB_REF: "refs/heads/release",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_SHA: "short",
    VISONAUT_RELEASE_COMMIT: "b".repeat(40),
    VISONAUT_RELEASE_TAG: "next",
  })) {
    assert.throws(() => assertRelease({ ...automatic, [key]: value }));
  }
});

function published(version, tag = "next") {
  return {
    versions: {
      [version]: {
        dist: {
          integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
          attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" } },
        },
      },
    },
    "dist-tags": { [tag]: version },
  };
}

test("source publication permits different archives but requires the selected tag and provenance", () => {
  const record = { version: "1.2.3" };
  assert.equal(publicationNeeded(record, null, "next"), true);
  assert.equal(publicationNeeded(record, published(record.version), "next"), false);
  assert.throws(
    () => publicationNeeded(record, published(record.version, "latest"), "next"),
    /different requested npm tag/,
  );
  assert.throws(
    () =>
      publicationNeeded(
        record,
        { versions: { "1.2.3": {} }, "dist-tags": { next: "1.2.3" } },
        "next",
      ),
    /provenance/,
  );
});

test("all ready packages and partial reruns share one release plan", async () => {
  const records = [
    { name: "@visonaut/playwright", version: "1.2.3" },
    { name: "visonaut", version: "2.0.0" },
  ];
  for (const count of [0, 1, 2]) {
    const read = async (name) =>
      records.slice(0, count).some((record) => record.name === name)
        ? published(records.find((record) => record.name === name).version)
        : null;
    assert.equal(await checkRegistry({ records, tag: "next", published: false, read }), 2 - count);
    if (count < 2)
      await assert.rejects(
        checkRegistry({ records, tag: "next", published: true, read }),
        /not published/,
      );
    else assert.equal(await checkRegistry({ records, tag: "next", published: true, read }), 0);
  }
});

test("final verification reads fresh metadata after publication becomes visible", async () => {
  const record = { name: "visonaut", version: "2.0.0" };
  const visible = published(record.version);
  let reads = 0;
  const waits = [];
  const metadata = await publishedMetadata({
    records: [record],
    tag: "next",
    read: async (name) => {
      assert.equal(name, record.name);
      reads += 1;
      if (reads === 1) return null;
      if (reads === 2) return published("1.0.0");
      return visible;
    },
    wait: async (milliseconds) => waits.push(milliseconds),
  });
  assert.equal(reads, 3);
  assert.deepEqual(waits, [60_000, 60_000]);
  assert.deepEqual(metadata, [visible]);
  assert.equal(
    metadata[0].versions[record.version].dist.integrity,
    visible.versions[record.version].dist.integrity,
  );
});

test("final verification waits beyond the registry metadata cache lifetime", async () => {
  const record = { name: "visonaut", version: "2.0.0" };
  const visible = published(record.version);
  let elapsed = 0;
  let reads = 0;
  const metadata = await publishedMetadata({
    records: [record],
    tag: "next",
    read: async () => {
      reads += 1;
      return elapsed <= 300_000 ? null : visible;
    },
    wait: async (milliseconds) => {
      elapsed += milliseconds;
    },
  });
  assert.deepEqual(metadata, [visible]);
  assert.equal(reads, 7);
  assert.equal(elapsed, 360_000);
});

test("final verification fails within its bound when the expected version stays absent", async () => {
  let reads = 0;
  const waits = [];
  await assert.rejects(
    publishedMetadata({
      records: [{ name: "visonaut", version: "2.0.0" }],
      tag: "next",
      read: async () => {
        reads += 1;
        return null;
      },
      wait: async (milliseconds) => waits.push(milliseconds),
    }),
    /Expected version was not published: visonaut@2.0.0/,
  );
  assert.equal(reads, 7);
  assert.deepEqual(waits, [60_000, 60_000, 60_000, 60_000, 60_000, 60_000]);
});

test("final verification uses visible metadata without a pause", async () => {
  const record = { name: "visonaut", version: "2.0.0" };
  const visible = published(record.version);
  let reads = 0;
  const metadata = await publishedMetadata({
    records: [record],
    tag: "next",
    read: async () => {
      reads += 1;
      return visible;
    },
    wait: async () => assert.fail("Visible metadata must not wait"),
  });
  assert.equal(reads, 1);
  assert.deepEqual(metadata, [visible]);
});

test("final verification rejects tag and provenance failures even when another version is absent", async () => {
  const records = [
    { name: "@visonaut/playwright", version: "1.2.3" },
    { name: "visonaut", version: "2.0.0" },
  ];
  const failures = [
    [published("2.0.0", "latest"), /different requested npm tag/],
    [{ versions: { "2.0.0": {} }, "dist-tags": { next: "2.0.0" } }, /provenance/],
  ];
  for (const [registry, error] of failures) {
    let reads = 0;
    await assert.rejects(
      publishedMetadata({
        records,
        tag: "next",
        read: async (name) => {
          reads += 1;
          return name === "visonaut" ? registry : null;
        },
        wait: async () => assert.fail("Invalid published metadata must not wait"),
      }),
      error,
    );
    assert.equal(reads, 2);
  }
});

test("final verification rejects invalid metadata that appears after a missing version", async () => {
  let reads = 0;
  const waits = [];
  await assert.rejects(
    publishedMetadata({
      records: [{ name: "visonaut", version: "2.0.0" }],
      tag: "next",
      read: async () => {
        reads += 1;
        return reads === 1 ? null : published("2.0.0", "latest");
      },
      wait: async (milliseconds) => waits.push(milliseconds),
    }),
    /different requested npm tag/,
  );
  assert.equal(reads, 2);
  assert.deepEqual(waits, [60_000]);
});

test("final verification does not retry registry read failures", async () => {
  const failure = new Error("Cannot read npm metadata");
  let reads = 0;
  await assert.rejects(
    publishedMetadata({
      records: [{ name: "visonaut", version: "2.0.0" }],
      tag: "next",
      read: async () => {
        reads += 1;
        throw failure;
      },
      wait: async () => assert.fail("Registry read failures must not wait"),
    }),
    failure,
  );
  assert.equal(reads, 1);
});

const records = [
  { name: "@visonaut/playwright", version: "1.2.3" },
  { name: "visonaut", version: "2.0.0" },
];

test("eligible versions include new publications and verified partial reruns from this source", async () => {
  for (const count of [0, 1, 2]) {
    const read = async (name) =>
      records.slice(0, count).some((record) => record.name === name)
        ? published(records.find((record) => record.name === name).version)
        : null;
    const verify = async (selected, callback) => {
      for (const record of selected)
        assert.equal(
          record.integrity,
          published(record.version).versions[record.version].dist.integrity,
        );
      return callback(selected.map((record) => ({ ...record, sourceSha: valid.GITHUB_SHA })));
    };
    const plan = await releasePlan({
      records,
      sourceSha: valid.GITHUB_SHA,
      tag: "next",
      read,
      verify,
    });
    assert.deepEqual(plan.packages, records);
  }
});

test("unchanged old packages stay outside the source claim while stale versions fail", async () => {
  const read = async (name) =>
    name === records[0].name ? published(records[0].version, "latest") : null;
  const verify = async (selected, callback) =>
    callback(
      selected.map((record) => ({ ...record, sourceSha: "b".repeat(40), directory: "/unused" })),
    );
  const unchanged = async () => {};
  const plan = await releasePlan({
    records,
    sourceSha: valid.GITHUB_SHA,
    tag: "next",
    read,
    verify,
    unchanged,
  });
  assert.deepEqual(plan.packages, [records[1]]);
  await assert.rejects(
    releasePlan({
      records,
      sourceSha: valid.GITHUB_SHA,
      tag: "next",
      read,
      verify,
      unchanged: async () => {
        throw new Error("changed without a version change");
      },
    }),
    /version change/,
  );
  await assert.rejects(
    releasePlan({
      records: [records[0]],
      sourceSha: valid.GITHUB_SHA,
      tag: "next",
      read,
      verify,
      unchanged,
    }),
    /No package version/,
  );
});

test("receipts cannot change source, tag, selected version, or duplicate a package", () => {
  const plan = { schemaVersion: 1, sourceSha: valid.GITHUB_SHA, tag: "next", packages: records };
  validateReleasePlan(plan, records, valid.GITHUB_SHA, "next");
  for (const changed of [
    { ...plan, sourceSha: "b".repeat(40) },
    { ...plan, tag: "latest" },
    { ...plan, packages: [{ ...records[0], version: "9.9.9" }] },
    { ...plan, packages: [records[0], records[0]] },
    { ...plan, packages: [] },
  ]) {
    assert.throws(() => validateReleasePlan(changed, records, valid.GITHUB_SHA, "next"));
  }
});

test("an ordinary main push skips unchanged verified packages without an empty publication receipt", async () => {
  const options = {
    records,
    sourceSha: valid.GITHUB_SHA,
    tag: "latest",
    read: async (name) =>
      published(records.find((record) => record.name === name).version, "latest"),
    verify: async (selected, callback) =>
      callback(
        selected.map((record) => ({ ...record, sourceSha: "b".repeat(40), directory: "/unused" })),
      ),
    unchanged: async () => {},
  };
  const plan = await releasePlan({ ...options, allowEmpty: true });
  assert.deepEqual(plan.packages, []);
  await assert.rejects(releasePlan(options), /No package version/);
  assert.throws(
    () => validateReleasePlan(plan, records, valid.GITHUB_SHA, "latest"),
    /no packages/,
  );
  await assert.rejects(
    releasePlan({
      ...options,
      allowEmpty: true,
      unchanged: async () => {
        throw new Error("changed without a version change");
      },
    }),
    /version change/,
  );
  await assert.rejects(
    releasePlan({
      ...options,
      allowEmpty: true,
      verify: async () => {
        throw new Error("missing verified provenance");
      },
    }),
    /missing verified provenance/,
  );
});

test("unchanged eligibility compares public contents and ignores filesystem timestamps", async () => {
  await using directory = await mkdtempDisposable(resolve(tmpdir(), "visonaut-content-proof-"));
  const first = resolve(directory.path, "first");
  const second = resolve(directory.path, "second");
  for (const target of [first, second]) {
    await mkdir(target);
    await writeFile(resolve(target, "package.json"), '{"name":"visonaut"}\n');
    await writeFile(resolve(target, "index.js"), "export const value = 1;\n");
  }
  await utimes(resolve(second, "index.js"), new Date(0), new Date(0));
  assert.deepEqual(await packageContents(first), await packageContents(second));
  await writeFile(resolve(second, "index.js"), "export const value = 2;\n");
  assert.notDeepEqual(await packageContents(first), await packageContents(second));
});

test("private-only pending Changesets allow eligible source publication; mixed plans require a version PR", async () => {
  await using temporary = await mkdtempDisposable(resolve(tmpdir(), "visonaut-version-plan-"));
  const directory = temporary.path;
  const changesetsDirectory = resolve(directory, ".changeset");
  await mkdir(changesetsDirectory);
  await writeFile(
    resolve(directory, "package.json"),
    JSON.stringify({ name: "version-plan-test", private: true, packageManager: "pnpm@12.5.1" }),
  );
  await writeFile(
    resolve(directory, "pnpm-workspace.yaml"),
    'packages: ["apps/*", "packages/*"]\n',
  );
  await writeFile(
    resolve(changesetsDirectory, "config.json"),
    await readFile(new URL("../../../.changeset/config.json", import.meta.url)),
  );
  for (const [path, name, isPrivate] of [
    ["apps/web", "@visonaut/web", true],
    ["packages/cli", "visonaut", false],
  ]) {
    await mkdir(resolve(directory, path), { recursive: true });
    await writeFile(
      resolve(directory, path, "package.json"),
      JSON.stringify({ name, version: "1.2.3", private: isPrivate }),
    );
  }
  // The current source retains 49 private-only Changesets under this policy.
  const privateChangesets = [];
  for (let index = 0; index < 49; index += 1) {
    const path = resolve(changesetsDirectory, `private-${index}.md`);
    const contents = '---\n"@visonaut/web": patch\n---\n\nPrivate app change.\n';
    privateChangesets.push({ path, contents });
    await writeFile(path, contents);
  }
  execFileSync("git", ["init", "--initial-branch=main", "--quiet"], { cwd: directory });
  execFileSync("git", ["add", "."], { cwd: directory });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Release test",
      "-c",
      "user.email=release@example.test",
      "commit",
      "--quiet",
      "-m",
      "Initial fixture",
    ],
    { cwd: directory },
  );
  const changesetCli = createRequire(import.meta.url).resolve("@changesets/cli/bin.js");
  const planFile = resolve(directory, "plan.json");
  const output = resolve(directory, "output.txt");
  const readPlan = async () => {
    execFileSync(process.execPath, [changesetCli, "status", "--output", planFile], {
      cwd: directory,
      env: { ...process.env, CI: "true" },
      stdio: "pipe",
    });
    await writeFile(output, "");
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./packages.mjs", import.meta.url)), "version-needed", planFile],
      { cwd: directory, env: { ...process.env, GITHUB_OUTPUT: output }, stdio: "pipe" },
    );
    return JSON.parse(await readFile(planFile, "utf8"));
  };
  const privatePlan = await readPlan();
  assert.equal(privatePlan.changesets.length, 49);
  assert.deepEqual(privatePlan.releases, []);
  assert.equal(versioningNeeded(privatePlan), false);
  assert.equal(await readFile(output, "utf8"), "needed=false\n");
  const publication = await releasePlan({
    records: [{ name: "visonaut", version: "1.2.3" }],
    sourceSha: valid.GITHUB_SHA,
    tag: "latest",
    read: async () => null,
    allowEmpty: true,
  });
  assert.deepEqual(publication.packages, [{ name: "visonaut", version: "1.2.3" }]);

  await writeFile(
    resolve(changesetsDirectory, "public.md"),
    '---\n"visonaut": minor\n---\n\nPublic package change.\n',
  );
  const mixedPlan = await readPlan();
  assert.equal(mixedPlan.changesets.length, 50);
  assert.deepEqual(
    mixedPlan.releases.map(({ name, newVersion }) => ({ name, newVersion })),
    [{ name: "visonaut", newVersion: "1.3.0" }],
  );
  assert.equal(versioningNeeded(mixedPlan), true);
  assert.equal(await readFile(output, "utf8"), "needed=true\n");
  for (const { path, contents } of privateChangesets) {
    assert.equal(await readFile(path, "utf8"), contents);
  }
  assert.throws(() => versioningNeeded({ changesets: [] }), /Invalid Changesets version plan/);
});
