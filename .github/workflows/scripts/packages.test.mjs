import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertRelease,
  checkRegistry,
  packageContents,
  publicationNeeded,
  releasePlan,
  validateReleasePlan,
} from "./packages.mjs";
import { mkdtempDisposable, mkdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const valid = {
  GITHUB_REPOSITORY_ID: "1380751023",
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_SHA: "a".repeat(40),
  VISONAUT_RELEASE_COMMIT: "a".repeat(40),
  VISONAUT_RELEASE_TAG: "next",
};

test("publication requires manual main and the approved source commit", () => {
  assert.doesNotThrow(() => assertRelease(valid));
  for (const key of Object.keys(valid)) {
    assert.throws(() => assertRelease({ ...valid, [key]: "untrusted" }));
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
  ])
    assert.throws(() => validateReleasePlan(changed, records, valid.GITHUB_SHA, "next"));
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
