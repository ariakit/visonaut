import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { digestJson } from "../../ci/identity.mjs";
import { rebindManifest } from "../../ci/rebind.mjs";

const repository = "ariakit/example";
const repositoryId = "104133653";
const testedSha = "a".repeat(40);
const context = { workflowRunId: "123", workflowAttempt: 2, testedSha, jobId: "456" };
const manifest = {
  run: { repository, repositoryId, workflowRunId: "123", workflowAttempt: 1, testedSha },
  shard: { key: "firefox", jobId: "1", sourceAttempt: 1 },
  discovery: {
    executorDigest: "b".repeat(64),
    configurationDigest: "c".repeat(64),
    inventoryDigest: "d".repeat(64),
  },
  captures: [{ key: "one" }],
};

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "visonaut-rebind-test-"));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  return directory;
}

async function rebind(directory, overrides = {}) {
  return rebindManifest({
    directory,
    browser: "firefox",
    repository,
    repositoryId,
    context,
    ...overrides,
  });
}

test("trusted submission rebinds a successful render to its signed job", async () => {
  const directory = await fixture();
  try {
    const receipt = await rebind(directory);
    const rebound = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
    assert.equal(rebound.run.workflowAttempt, 2);
    assert.deepEqual(rebound.shard, { key: "firefox", jobId: "456", sourceAttempt: 2 });
    assert.equal(receipt.manifestDigest, digestJson(rebound));
    assert.equal(
      receipt.artifactName,
      `visonaut-discovery-2-456-firefox-${receipt.manifestDigest}`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rebind rejects another repository, tested SHA, or future render attempt", async () => {
  for (const change of [
    { run: { ...manifest.run, repository: "ariakit/other" } },
    { run: { ...manifest.run, testedSha: "e".repeat(40) } },
    { run: { ...manifest.run, workflowAttempt: 3 } },
  ]) {
    const directory = await fixture();
    try {
      await writeFile(
        path.join(directory, "manifest.json"),
        JSON.stringify({ ...manifest, ...change }),
      );
      await assert.rejects(rebind(directory), /does not match/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
