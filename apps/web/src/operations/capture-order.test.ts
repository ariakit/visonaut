import { readFile } from "node:fs/promises";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureProfilesDigest,
  Service,
  type CaptureInput,
  type TrustedPlan,
} from "@visonaut/service";
import { context, TestDatabase } from "./test-fixtures.ts";
import { archiveClosedRuns, readRunHistory } from "./history.ts";
import { prepareHistoricalCaptures } from "./historical-captures.ts";
import type { OperationsContext } from "./types.ts";

let runtime: Miniflare;
let service: Service;
let operations: OperationsContext;
let local: TestDatabase;
beforeEach(async () => {
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      compatibilityDate: "2026-09-22",
      d1Databases: ["DB"],
    }),
  );
  const database = await runtime.getD1Database("DB");
  for (const name of [
    "0001_service",
    "0002_work",
    "0003_auth",
    "0004_ingest",
    "0005_operations",
    "0006_acceptance",
    "0007_backup_inventory",
    "0008_capture_profiles",
    "0009_retention_history",
    "0010_run_history",
    "0011_backup_groups",
    "0012_historical_comparisons",
    "0013_promotion_scans",
    "0014_visonaut_brand",
  ]) {
    const source = (
      await readFile(new URL(`../../migrations/${name}.sql`, import.meta.url), "utf8")
    ).replace(/^--.*$/gm, "");
    let query = "";
    for (const line of source.split("\n")) {
      query += `${line}\n`;
      if (!line.trimEnd().endsWith(";")) continue;
      await database.prepare(query).run();
      query = "";
    }
  }
  local = new TestDatabase();
  operations = { ...context(local).context, database };
  service = new Service(database);
  await service.createPolicy({
    digest: "policy",
    policy: { id: "exact", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 },
  });
  await service.createProject({ id: "project", repositoryId: "123", policyDigest: "policy" });
});
afterEach(async () => {
  local?.[Symbol.dispose]();
  await runtime?.dispose();
});

function plan(discovery = false): TrustedPlan {
  return {
    digest: discovery ? "discovery-plan" : "plan",
    shards: ["z-first", "a-second"].map((key) => ({
      key,
      profileDigest: "profile",
      tests: discovery ? [] : [key],
      captures: discovery
        ? []
        : [0, 1].map((index) => ({ itemKey: "item", variantKey: `${key}-${index}`, testId: key })),
      ...(discovery
        ? { discovery: { executorDigest: "executor", configurationDigest: "configuration" } }
        : {}),
    })),
  };
}
async function reserve(runId: string, trusted = plan(), attempt = 1, inheritFromRunId?: string) {
  await service.reserveRun({
    id: runId,
    projectId: "project",
    externalRunId: "workflow",
    attempt,
    kind: "pull_request",
    testedSha: "a".repeat(40),
    lineageKey: "pr:1",
    plan: trusted,
    verifiedRelatedRunIds: [],
    verifiedAncestorShas: [],
    verificationDigest: "proof",
    rerunShardKeys: inheritFromRunId ? ["z-first"] : trusted.shards.map((shard) => shard.key),
    ...(inheritFromRunId
      ? {
          inheritFromRunId,
          verifiedInheritedShards: [
            {
              key: "a-second",
              manifestDigest: `manifest-${inheritFromRunId}-a-second`,
              captureProfileDigest: await captureProfilesDigest(
                [0, 1].map((index) => ({
                  itemKey: "item",
                  variantKey: `a-second-${index}`,
                  profileDigest: "profile",
                })),
              ),
            },
          ],
        }
      : {}),
    now: operations.now(),
  });
}
async function captures(runId: string, key: string, count = 2) {
  const values: CaptureInput[] = [];
  for (let index = 0; index < count; index++) {
    const id = `${key === "z-first" ? "z" : "a"}-${runId}-${count - index}`;
    await service.registerImage({
      id: `image-${id}`,
      runId,
      digest: `digest-${id}`,
      objectKey: `runs/${runId}/${id}`,
      contentType: "image/png",
      bytes: 1,
      width: 1,
      height: 1,
    });
    values.push({
      id,
      itemKey: "item",
      variantKey: `${key}-${index}`,
      ordinal: 10 + index * 10,
      imageId: `image-${id}`,
      profileDigest: "profile",
      environmentProfileDigest: "profile",
      testId: key,
      testRetry: 0,
      metadata: { name: "Item", variant: { key: `${key}-${index}` } },
    });
  }
  return values;
}
async function commit(
  runId: string,
  key: string,
  values: CaptureInput[],
  discovery = false,
  attempt = 1,
) {
  await service.commitShard({
    runId,
    key,
    manifestDigest: `manifest-${runId}-${key}`,
    captures: values,
    finalTestOutcomes: [{ testId: key, retry: 0, status: "passed" }],
    ...(discovery
      ? {
          verifiedDiscovery: {
            executorDigest: "executor",
            configurationDigest: "configuration",
            inventoryDigest: "inventory",
            verificationDigest: "verified",
            jobId: "job",
            externalRunId: "workflow",
            attempt,
            testedSha: "a".repeat(40),
            tests: [key],
            captures: values.map(({ itemKey, variantKey, testId }) => ({
              itemKey,
              variantKey,
              testId,
            })),
          },
        }
      : {}),
    now: operations.now(),
  });
}
async function captureOrder(runId: string) {
  return (
    await operations.database
      .prepare(
        "SELECT variant_key,ordinal FROM visonaut_captures WHERE run_id=? ORDER BY ordinal,id",
      )
      .bind(runId)
      .all<{ variant_key: string; ordinal: number }>()
  ).results;
}
async function compare(runId: string, id = `comparison-${runId}`) {
  await service.createComparison({
    id,
    runId,
    referenceSnapshotId: null,
    now: operations.now(),
    maxAttempts: 2,
  });
  return service.comparisonRows(id);
}
const expected = ["z-first-0", "z-first-1", "a-second-0", "a-second-1"];

describe("full-run declared capture order with native D1", () => {
  it("seals trusted shard order and local order independently of arrival and generated IDs", async () => {
    await reserve("run");
    const first = await captures("run", "z-first");
    await commit("run", "a-second", await captures("run", "a-second"));
    await expect(service.sealRun({ runId: "run", now: operations.now() })).rejects.toThrow();
    await commit("run", "z-first", first);
    await commit("run", "z-first", first);
    await service.sealRun({ runId: "run", now: operations.now() });
    expect(await captureOrder("run")).toEqual(
      expected.map((variant_key, ordinal) => ({ variant_key, ordinal })),
    );
    expect(first.map((capture) => capture.ordinal)).toEqual([10, 20]);
    expect((await compare("run")).map((row) => row.variant_key)).toEqual(expected);
    await commit("run", "z-first", first);
    await service.sealRun({ runId: "run", now: operations.now() });
    expect((await compare("run", "recompare-run")).map((row) => row.variant_key)).toEqual(expected);
  });

  it("recomputes offsets when discovery grows a rerun shard before inherited successful captures", async () => {
    const trusted = plan(true);
    await reserve("source", trusted);
    await commit("source", "a-second", await captures("source", "a-second"), true);
    await commit("source", "z-first", await captures("source", "z-first"), true);
    await service.sealRun({ runId: "source", now: operations.now() });
    await reserve("retry", trusted, 2, "source");
    await commit("retry", "z-first", await captures("retry", "z-first", 3), true, 2);
    await service.sealRun({ runId: "retry", now: operations.now() });
    const ordered = ["z-first-0", "z-first-1", "z-first-2", "a-second-0", "a-second-1"];
    expect(await captureOrder("retry")).toEqual(
      ordered.map((variant_key, ordinal) => ({ variant_key, ordinal })),
    );
    expect((await compare("retry")).map((row) => row.variant_key)).toEqual(ordered);
    expect(await captureOrder("source")).toEqual(
      expected.map((variant_key, ordinal) => ({ variant_key, ordinal })),
    );
  });

  it("preserves the same order in immutable history and restored historical comparisons", async () => {
    await reserve("run");
    for (const key of ["a-second", "z-first"]) await commit("run", key, await captures("run", key));
    await service.sealRun({ runId: "run", now: operations.now() });
    await compare("run");
    await service.finalizeComparison({ comparisonId: "comparison-run", now: operations.now() });
    await service.retireRun({ runId: "run", now: operations.now() });
    for (let step = 0; step < 100; step++) {
      const report = await archiveClosedRuns(operations);
      expect(report.attention).toEqual([]);
      if (report.completed.includes("run")) break;
    }
    const saved = await readRunHistory(operations, "run");
    expect(saved).not.toBeNull();
    expect(
      saved?.sections.comparisonRows
        ?.sort((a, b) => Number(a.ordinal) - Number(b.ordinal))
        .map((row) => row.variant_key),
    ).toEqual(expected);
    const count = await prepareHistoricalCaptures(operations, {
      runId: "run",
      comparisonId: "historical",
      referenceSnapshotId: null,
      maximumCaptures: 10,
    });
    await service.createComparison({
      id: "historical",
      runId: "run",
      referenceSnapshotId: null,
      purpose: "historical",
      expectedCaptureCount: count,
      now: operations.now(),
      maxAttempts: 2,
    });
    expect((await service.comparisonRows("historical")).map((row) => row.variant_key)).toEqual(
      expected,
    );
  });

  it("refuses duplicate local ordinals before staging ambiguous captures", async () => {
    await reserve("run");
    const values = await captures("run", "z-first");
    for (const capture of values) capture.ordinal = 0;
    await expect(commit("run", "z-first", values)).rejects.toThrow("ordinal");
    expect(await captureOrder("run")).toEqual([]);
  });
});
