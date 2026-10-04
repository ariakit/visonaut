import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { seedLegacyComparison } from "../../../../tooling/legacy-comparison-fixture.ts";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import {
  LOCAL_COMPARISON_CODEC,
  LOCAL_COMPARISON_ENGINE,
  type LocalComparisonReceipt,
} from "../../../../packages/protocol/src/index.ts";
import {
  maximumImageRegistrationBatchSize,
  Service,
} from "../../../../packages/service/src/service.ts";
import type {
  CaptureInventoryPointer,
  CommitShardParams,
  ReferenceCaptureInput,
  ValidatedImage,
} from "../../../../packages/service/src/types.ts";
import { measureD1, type D1Cost } from "../../src/api/test-d1-costs.ts";

interface Scenario {
  mode: "dense" | "sparse";
  captureCount: number;
  changedCount: number;
}

interface Phase {
  name: string;
  rows_read: number;
  rows_written: number;
  statements: D1Cost[];
}

interface Measurement extends Scenario {
  imageOwnerCount: number;
  phases: Phase[];
  total: { rows_read: number; rows_written: number };
}

const repository = fileURLToPath(new URL("../../../../", import.meta.url));
const compatibilityDate = "2026-09-22";
const scenarios: Scenario[] = [
  { mode: "dense", captureCount: 1, changedCount: 0 },
  { mode: "dense", captureCount: 100, changedCount: 0 },
  { mode: "sparse", captureCount: 1, changedCount: 0 },
  { mode: "sparse", captureCount: 100, changedCount: 0 },
  { mode: "sparse", captureCount: 2, changedCount: 1 },
  { mode: "sparse", captureCount: 100, changedCount: 1 },
];

function sourceHashes() {
  const files = [
    "package.json",
    "pnpm-lock.yaml",
    "apps/web/package.json",
    "apps/web/src/api/test-d1-costs.ts",
    "apps/web/tooling/baseline-delta-cost/probe.cost.ts",
    "apps/web/tooling/baseline-delta-cost/vitest.config.ts",
    "tooling/legacy-comparison-fixture.ts",
    "tooling/test-migrations.ts",
  ];
  for (const directory of [
    "packages/service/src",
    "packages/protocol/src",
    "apps/web/migrations",
  ]) {
    for (const name of readdirSync(join(repository, directory))) {
      if (!/\.(ts|sql)$/u.test(name) || name.endsWith(".test.ts")) continue;
      files.push(`${directory}/${name}`);
    }
  }
  return Object.fromEntries(
    files.sort().map((file) => [
      file,
      createHash("sha256")
        .update(readFileSync(join(repository, file)))
        .digest("hex"),
    ]),
  );
}

function dependencyVersions() {
  const require = createRequire(import.meta.url);
  const miniflarePath = require.resolve("miniflare/package.json");
  const readVersion = (path: string) => {
    const manifest: { version?: unknown } = JSON.parse(readFileSync(path, "utf8"));
    if (typeof manifest.version !== "string") {
      throw new Error(`Missing dependency version: ${path}`);
    }
    return manifest.version;
  };
  return {
    node: process.version,
    miniflare: readVersion(miniflarePath),
    workerd: readVersion(createRequire(miniflarePath).resolve("workerd/package.json")),
    vitest: readVersion(require.resolve("vitest/package.json")),
    compatibilityDate,
    sqliteVersion: "Unavailable: native D1 rejects sqlite_version().",
  };
}

function plan(items: string[]) {
  return {
    digest: "plan",
    shards: [
      {
        key: "chromium",
        profileDigest: "profile",
        tests: ["test"],
        captures: items.map((itemKey) => ({ itemKey, variantKey: "light", testId: "test" })),
      },
    ],
  };
}

async function reserve(service: Service, runId: string, items: string[]) {
  return service.reserveRun({
    id: runId,
    projectId: "project",
    externalRunId: runId,
    attempt: 1,
    kind: "main",
    testedSha: `sha-${runId}`,
    lineageKey: "main",
    plan: plan(items),
    verifiedRelatedRunIds: [],
    verifiedAncestorShas: runId === "seed" ? [] : ["sha-seed"],
    verificationDigest: "verified-proof",
    rerunShardKeys: ["chromium"],
    now: runId === "seed" ? 1 : 20,
  });
}

function image(runId: string, itemKey: string): ValidatedImage {
  return {
    id: `image-${runId}-${itemKey}`,
    runId,
    digest: `${itemKey}-${runId === "seed" ? "blue" : "red"}`,
    objectKey: `runs/${runId}/images/${itemKey}`,
    contentType: "image/png",
    bytes: 80,
    width: 10,
    height: 10,
  };
}

async function seed(service: Service, items: string[]) {
  await service.createPolicy({
    digest: "policy",
    policy: { id: "cost-fixture", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 },
  });
  await service.createProject({ id: "project", repositoryId: "123", policyDigest: "policy" });
  await reserve(service, "seed", items);
  for (let offset = 0; offset < items.length; offset += maximumImageRegistrationBatchSize) {
    await service.registerImages(
      items
        .slice(offset, offset + maximumImageRegistrationBatchSize)
        .map((itemKey) => image("seed", itemKey)),
    );
  }
  await service.commitShard({
    runId: "seed",
    key: "chromium",
    manifestDigest: "manifest-seed",
    finalTestOutcomes: [{ testId: "test", retry: 1, status: "passed" }],
    captures: items.map((itemKey, ordinal) => ({
      id: `capture-seed-${itemKey}`,
      itemKey,
      variantKey: "light",
      ordinal,
      imageId: image("seed", itemKey).id,
      profileDigest: "profile",
      environmentProfileDigest: "profile",
      testId: "test",
      testRetry: 1,
      metadata: { name: itemKey },
    })),
    now: 2,
  });
  await service.sealRun({ runId: "seed", now: 3 });
  // A dense accepted source gives both measured paths the same baseline data.
  await seedLegacyComparison(service, {
    id: "comparison-seed",
    runId: "seed",
    referenceSnapshotId: null,
    now: 4,
    maxAttempts: 3,
  });
  await service.finalizeComparison({ comparisonId: "comparison-seed", now: 6 });
  const copies = await service.preparePromotion({
    snapshotId: "snapshot-seed",
    comparisonId: "comparison-seed",
    prefix: "baselines/seed",
    now: 10,
  });
  for (const copy of copies) {
    await service.recordSnapshotCopy({
      snapshotId: "snapshot-seed",
      captureId: copy.capture_id,
      objectKey: copy.object_key,
      digest: copy.digest,
    });
  }
  await service.promote({
    snapshotId: "snapshot-seed",
    promotionId: "promotion-seed",
    expectedBaselineRevision: 0,
    now: 11,
  });
}

async function candidate(service: Service, scenario: Scenario, items: string[]) {
  const project = await service.project("project");
  const references: ReferenceCaptureInput[] = items.map((itemKey) => ({
    id: `capture-seed-${itemKey}`,
    itemKey,
    variantKey: "light",
    profileDigest: "profile",
    renderingProfileDigest: "profile",
    image: image("seed", itemKey),
  }));
  await reserve(service, "candidate", items);
  if (scenario.changedCount) {
    await service.registerImages(
      items.slice(0, scenario.changedCount).map((itemKey) => image("candidate", itemKey)),
    );
  }
  const localComparison: LocalComparisonReceipt = {
    mode: "local-v1",
    engineVersion: LOCAL_COMPARISON_ENGINE,
    codecVersion: LOCAL_COMPARISON_CODEC,
    reference: {
      manifestDigest: "manifest",
      snapshotId: project.snapshot_id,
      baselineRevision: project.baseline_revision,
      inventoryDigest: "reference",
      captureCount: references.length,
    },
    captures: [],
    removals: [],
  };
  const captures: CommitShardParams["captures"] = [];
  const owners = new Set<string>();
  for (const [ordinal, itemKey] of items.entries()) {
    const changed = ordinal < scenario.changedCount;
    const effectiveImage = image(changed ? "candidate" : "seed", itemKey);
    const outcome = changed ? "changed" : "unchanged";
    owners.add(effectiveImage.runId);
    captures.push({
      id: `capture-candidate-${itemKey}`,
      itemKey,
      variantKey: "light",
      ordinal,
      imageId: effectiveImage.id,
      profileDigest: "profile",
      environmentProfileDigest: "profile",
      testId: "test",
      testRetry: 1,
      metadata: {
        name: itemKey,
        localMode: "local-v1",
        candidateStored: changed,
        observedImage: effectiveImage,
        localResult: {
          outcome,
          changedPixels: changed ? 1 : 0,
          ratio: changed ? 0.01 : 0,
          maskExpected: false,
          engineVersion: LOCAL_COMPARISON_ENGINE,
          codecVersion: LOCAL_COMPARISON_CODEC,
        },
      },
    });
    localComparison.captures.push({
      itemKey,
      variantKey: "light",
      candidateDigest: effectiveImage.digest,
      referenceDigest: image("seed", itemKey).digest,
      outcome,
      changedPixels: changed ? 1 : 0,
      ratio: changed ? 0.01 : 0,
      sizeChanged: false,
    });
  }
  // R2 I/O is outside this service probe; the pointer represents verified input.
  const inventory: CaptureInventoryPointer = {
    objectKey: `runs/candidate/inventory/${"c".repeat(64)}.json`,
    digest: "c".repeat(64),
    bytes: 1024,
    captureCount: captures.length,
  };
  const commit: CommitShardParams = {
    runId: "candidate",
    key: "chromium",
    manifestDigest: "manifest-candidate",
    captures,
    ...(scenario.mode === "sparse" ? { inventory, imageRunIds: [...owners] } : {}),
    localReferenceSnapshotId: project.snapshot_id,
    finalTestOutcomes: [{ testId: "test", retry: 1, status: "passed" }],
    now: 21,
  };
  return { project, references, localComparison, inventory, commit, owners: [...owners] };
}

async function measure(scenario: Scenario): Promise<Measurement> {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } }",
      compatibilityDate,
      d1Databases: ["DB"],
    }),
  );
  try {
    const database = await runtime.getD1Database("DB");
    await applyTestMigrations(database);
    const measured = measureD1(database);
    const service = new Service(measured.database);
    const items = Array.from({ length: scenario.captureCount }, (_, index) => `item-${index}`);
    await seed(service, items);
    const input = await candidate(service, scenario, items);
    const phases: Phase[] = [];
    const phase = async (name: string, operation: () => Promise<unknown>) => {
      measured.reset();
      await operation();
      phases.push({ name, ...measured.totals(), statements: [...measured.costs] });
    };
    await phase("commitShard", () => service.commitShard(input.commit));
    await phase("sealRun", () => service.sealRun({ runId: "candidate", now: 22 }));
    await phase("createComparison", () =>
      service.createComparison({
        id: "comparison-candidate",
        runId: "candidate",
        referenceSnapshotId: input.project.snapshot_id,
        expectedBaselineRevision: input.project.baseline_revision,
        localComparison: input.localComparison,
        ...(scenario.mode === "sparse" ? { referenceCaptures: input.references } : {}),
        now: 23,
      }),
    );
    await phase("finalizeComparison", () =>
      service.finalizeComparison({ comparisonId: "comparison-candidate", now: 24 }),
    );
    if (scenario.changedCount) {
      const rows = await service.comparisonRows("comparison-candidate");
      await phase("review", () =>
        service.review({
          commandId: "approve-candidate",
          actorId: "maintainer",
          sessionId: "session",
          comparisonId: "comparison-candidate",
          verdict: "approved",
          targets: rows.map((row) => ({ id: row.id, expectedRevision: row.decision_revision })),
          selection: { itemKey: "item-0", variantKey: "light" },
          now: 25,
        }),
      );
    }
    let copies: Awaited<ReturnType<Service["preparePromotion"]>> = [];
    await phase("preparePromotion", async () => {
      copies = await service.preparePromotion({
        snapshotId: "snapshot-candidate",
        comparisonId: "comparison-candidate",
        prefix: "baselines/candidate",
        ...(scenario.mode === "sparse"
          ? { inventory: input.inventory, imageRunIds: input.owners }
          : {}),
        now: 26,
      });
    });
    if (scenario.mode === "sparse") {
      await phase("recordInventoryVerification", () =>
        service.recordInventoryVerification({
          snapshotId: "snapshot-candidate",
          objectKey: input.inventory.objectKey,
          digest: input.inventory.digest,
        }),
      );
    } else {
      await phase("recordSnapshotCopies", async () => {
        for (const copy of copies) {
          await service.recordSnapshotCopy({
            snapshotId: "snapshot-candidate",
            captureId: copy.capture_id,
            objectKey: copy.object_key,
            digest: copy.digest,
          });
        }
      });
    }
    await phase("promote", () =>
      service.promote({
        snapshotId: "snapshot-candidate",
        promotionId: "promotion-candidate",
        expectedBaselineRevision: 1,
        now: 27,
      }),
    );
    const total = phases.reduce(
      (sum, value) => ({
        rows_read: sum.rows_read + value.rows_read,
        rows_written: sum.rows_written + value.rows_written,
      }),
      { rows_read: 0, rows_written: 0 },
    );
    return { ...scenario, imageOwnerCount: input.owners.length, phases, total };
  } finally {
    await runtime.dispose();
  }
}

it("records native indexed D1 costs for dense and sparse main lifecycles", async () => {
  const hashes = sourceHashes();
  const environment = dependencyVersions();
  const results: Measurement[] = [];
  for (const scenario of scenarios) {
    results.push(await measure(scenario));
  }
  expect(sourceHashes()).toEqual(hashes);
  const totalWrites = (mode: Scenario["mode"], captureCount: number, changedCount: number) => {
    const result = results.find(
      (entry) =>
        entry.mode === mode &&
        entry.captureCount === captureCount &&
        entry.changedCount === changedCount,
    );
    if (!result) {
      throw new Error("Missing cost scenario.");
    }
    return result.total.rows_written;
  };
  expect(totalWrites("dense", 100, 0)).toBe(1866);
  expect(totalWrites("sparse", 100, 0)).toBe(66);
  expect(totalWrites("sparse", 1, 0)).toBe(totalWrites("sparse", 100, 0));
  expect(totalWrites("sparse", 2, 1)).toBe(totalWrites("sparse", 100, 1));
  const output = resolve(
    repository,
    process.env.BASELINE_DELTA_COST_OUTPUT ?? "artifacts/baseline-delta-cost",
  );
  mkdirSync(output, { recursive: true });
  const excluded = [
    "migration and baseline setup",
    "run reservation",
    "image registration",
    "R2 reads and writes",
    "review target lookup",
  ];
  writeFileSync(
    join(output, "statements.json.gz"),
    gzipSync(JSON.stringify({ environment, hashes, excluded, results })),
  );
  const summary = {
    environment,
    hashes,
    excluded,
    results: results.map((result) => ({
      ...result,
      phases: result.phases.map(({ statements, ...phase }) => ({
        ...phase,
        statementCount: statements.length,
      })),
    })),
  };
  writeFileSync(join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.info(`Native D1 cost evidence: ${relative(repository, output)}`);
});
