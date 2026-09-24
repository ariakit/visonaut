import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { digestJson } from "../../ci/identity.mjs";
import { rebindManifest, verifyMeasuredProfiles } from "../../ci/rebind.mjs";

const repository = "ariakit/example";
const repositoryId = "104133653";
const testedSha = "a".repeat(40);
const bundleSha256 = "b".repeat(64);
const workflowSha = "f".repeat(40);
const context = {
  workflowRunId: "123",
  workflowAttempt: 2,
  testedSha,
  jobId: "456",
  workflowSha,
  jobName: "Visonaut / upload / shard-42",
};
const manifest = {
  run: {
    repository,
    repositoryId,
    workflowRunId: "123",
    workflowAttempt: 1,
    testedSha,
    planDigest: bundleSha256,
  },
  shard: { key: "shard-42", jobId: "1", sourceAttempt: 1 },
  discovery: {
    executorDigest: bundleSha256,
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
    shard: "shard-42",
    repository,
    repositoryId,
    bundleSha256,
    context,
    ...overrides,
  });
}

function measuredProfileFixture(fontPackage = null) {
  const osImage = { os: "linux", imageVersion: "20260924.1", architecture: "x64" };
  const systemFont = { root: 0, file: "system.ttf", digest: "1".repeat(64) };
  const applicationFont = { root: 1, file: "web/inter.woff2", digest: "2".repeat(64) };
  const fonts = fontPackage ? [systemFont, applicationFont] : [systemFont];
  const signedEnvironment = {
    osImage,
    fonts: [systemFont],
    systemFontRootCount: 1,
    fontPackage: null,
    profile: {
      osImageDigest: digestJson(osImage),
      fontsDigest: digestJson([systemFont]),
      comparisonPolicyDigest: "3".repeat(64),
      comparisonEngineVersion: "rgba-visible-1",
    },
  };
  const rendered = {
    ...signedEnvironment,
    osImage: { ...osImage },
    fonts: fonts.map((entry) => ({ ...entry })),
    fontPackage,
    profile: { ...signedEnvironment.profile, fontsDigest: digestJson(fonts) },
  };
  return { signedEnvironment, rendered };
}

async function writeProfileFixture(directory, rendered, profiles = [rendered.profile]) {
  await writeFile(path.join(directory, "environment.json"), JSON.stringify(rendered));
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify({ profiles: profiles.map((profile) => ({ profile })) }),
  );
}

test("trusted submission rebinds a successful render to its signed job", async () => {
  const directory = await fixture();
  try {
    const receipt = await rebind(directory);
    const rebound = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
    assert.equal(rebound.run.workflowAttempt, 2);
    assert.deepEqual(rebound.shard, { key: "shard-42", jobId: "456", sourceAttempt: 2 });
    assert.equal(
      rebound.run.planDigest,
      digestJson({ schemaVersion: "1.0", source: "workflow", reusableWorkflowSha: workflowSha }),
    );
    assert.equal(receipt.manifestDigest, digestJson(rebound));
    assert.equal(
      receipt.artifactName,
      `visonaut-discovery-2-456-shard-42-${receipt.manifestDigest}`,
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

test("signed upload accepts a measured profile with a declared application font package", async () => {
  const directory = await fixture();
  try {
    const { signedEnvironment, rendered } = measuredProfileFixture("fixture-fonts");
    await writeProfileFixture(directory, rendered);
    await verifyMeasuredProfiles({ directory, signedEnvironment, fontPackage: "fixture-fonts" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("signed upload rejects a stale profile override in any captured item", async () => {
  const directory = await fixture();
  try {
    const { signedEnvironment, rendered } = measuredProfileFixture();
    const staleProfile = { ...rendered.profile, fontsDigest: "4".repeat(64) };
    await writeProfileFixture(directory, rendered, [rendered.profile, staleProfile]);
    await assert.rejects(
      verifyMeasuredProfiles({ directory, signedEnvironment }),
      /differs from the signed job's measured environment/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("signed upload rejects a changed OS, system font, or comparison policy", async () => {
  for (const change of [
    (rendered) => {
      rendered.osImage.imageVersion = "20260924.2";
    },
    (rendered) => {
      rendered.fonts[0].digest = "5".repeat(64);
      rendered.profile.fontsDigest = digestJson(rendered.fonts);
    },
    (rendered) => {
      rendered.profile.comparisonPolicyDigest = "6".repeat(64);
    },
  ]) {
    const directory = await fixture();
    try {
      const { signedEnvironment, rendered } = measuredProfileFixture();
      change(rendered);
      await writeProfileFixture(directory, rendered);
      await assert.rejects(
        verifyMeasuredProfiles({ directory, signedEnvironment }),
        /differs from the signed job's measured environment/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("signed upload rejects a different application font package", async () => {
  const directory = await fixture();
  try {
    const { signedEnvironment, rendered } = measuredProfileFixture("fixture-fonts");
    await writeProfileFixture(directory, rendered);
    await assert.rejects(
      verifyMeasuredProfiles({ directory, signedEnvironment, fontPackage: "other-fonts" }),
      /differs from the signed job's measured environment/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
