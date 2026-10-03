import { appendFileSync } from "node:fs";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { expect, it, vi } from "vitest";
import {
  LOCAL_COMPARISON_CODEC,
  LOCAL_COMPARISON_ENGINE,
  type LocalComparisonReceipt,
} from "@visonaut/protocol";
import { closedRunRetentionMs, type ComparisonResult } from "@visonaut/service";
import { applyTestMigrations } from "../../../../tooling/test-migrations.ts";
import { reviewModel } from "../api/review.ts";
import { parseReviewModel } from "../review/client.ts";
import type { PrivateContext } from "../api/context.ts";
import { readClosedSummary, summarizeClosedRuns } from "./closed-summary.ts";
import {
  archiveClosedRuns,
  readRunHistory,
  writeHistoryStep,
  type HistoryProgress,
} from "./history.ts";
import { historySections } from "./history-format.ts";
import { captured, context, TestDatabase } from "./test-fixtures.ts";
import type { OperationsContext } from "./types.ts";

const changedResult = {
  outcome: "changed",
  changedPixels: 1,
  ratio: 1,
  engineVersion: LOCAL_COMPARISON_ENGINE,
  codecVersion: LOCAL_COMPARISON_CODEC,
  maskExpected: true,
  maskImageId: "mask-run",
  thumbnailImageId: "thumbnail-run",
} satisfies ComparisonResult;
const marker = '{"$visonautLocalResult":1}';

async function localFixture(
  operations: OperationsContext,
  original: ComparisonResult = changedResult,
) {
  const service = await captured(operations, "seed", "main");
  for (const copy of await service.preparePromotion({
    snapshotId: "snapshot-seed",
    comparisonId: "comparison-seed",
    prefix: "baselines/seed",
    now: operations.now(),
  })) {
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
    now: operations.now(),
  });
  const reserve = {
    id: "run",
    projectId: "project",
    externalRunId: "local",
    attempt: 1,
    kind: "pull_request" as const,
    testedSha: "a".repeat(40),
    lineageKey: "local",
    plan: {
      digest: "plan",
      shards: [
        {
          key: "chromium",
          profileDigest: "profile",
          tests: ["test"],
          captures: [{ itemKey: "dialog", variantKey: "light", testId: "test" }],
        },
      ],
    },
    verifiedRelatedRunIds: [],
    verifiedAncestorShas: ["a".repeat(40)],
    verificationDigest: "verified",
    rerunShardKeys: ["chromium"],
    now: operations.now(),
  };
  await service.reserveRun(reserve);
  const borrowed = original.outcome === "unchanged";
  if (!borrowed) {
    await service.registerImage({
      id: "image-run",
      runId: "run",
      digest: "b".repeat(64),
      objectKey: "runs/run/original",
      contentType: "image/png",
      bytes: 23,
      width: 1,
      height: 1,
    });
  }
  for (const id of [original.maskImageId, original.thumbnailImageId]) {
    if (!id) continue;
    await service.registerImage({
      id,
      runId: "run",
      digest: id,
      objectKey: `derived/run/${id}`,
      contentType: "image/png",
      bytes: 23,
      width: 1,
      height: 1,
    });
  }
  const metadata = {
    name: "Dialog",
    variant: { key: "light" },
    localMode: "local-v1",
    localResult: original,
    observedImage: {
      digest: "b".repeat(64),
      bytes: 23,
      width: 1,
      height: 1,
      mediaType: "image/png",
    },
    candidateStored: !borrowed,
  };
  await service.commitShard({
    runId: "run",
    key: "chromium",
    manifestDigest: "local-manifest",
    localReferenceSnapshotId: "snapshot-seed",
    captures: [
      {
        id: "capture-run",
        itemKey: "dialog",
        variantKey: "light",
        ordinal: 0,
        imageId: borrowed ? "image-seed" : "image-run",
        profileDigest: "profile",
        environmentProfileDigest: "profile",
        testId: "test",
        testRetry: 0,
        metadata,
      },
    ],
    finalTestOutcomes: [{ testId: "test", retry: 0, status: "passed" }],
    now: operations.now(),
  });
  const shard = await operations.database
    .prepare(
      "SELECT manifest_digest,full_profile_digest FROM visonaut_shards WHERE run_id='run' AND key='chromium'",
    )
    .first<{ manifest_digest: string; full_profile_digest: string }>();
  if (!shard) throw new Error("Missing local shard.");
  await service.sealRun({ runId: "run", now: operations.now() });
  const receipt: LocalComparisonReceipt = {
    mode: "local-v1",
    engineVersion: LOCAL_COMPARISON_ENGINE,
    codecVersion: LOCAL_COMPARISON_CODEC,
    reference: {
      manifestDigest: "manifest",
      snapshotId: "snapshot-seed",
      baselineRevision: 1,
      inventoryDigest: "inventory",
      captureCount: 1,
    },
    captures: [
      {
        itemKey: "dialog",
        variantKey: "light",
        candidateDigest: metadata.observedImage.digest,
        referenceDigest: "reference",
        outcome: original.outcome,
        changedPixels: original.changedPixels,
        ratio: original.ratio,
        sizeChanged: false,
      },
    ],
    removals: [],
  };
  const compare = async (id = "comparison-run", runId = "run") => {
    await service.createComparison({
      id,
      runId,
      referenceSnapshotId: "snapshot-seed",
      expectedBaselineRevision: 1,
      localComparison: receipt,
      now: operations.now(),
    });
    await service.finalizeComparison({ comparisonId: id, now: operations.now() });
  };
  // Review does not use authentication or transport in these private-route tests.
  const api = {} as PrivateContext;
  Object.assign(api, {
    service,
    database: operations.database,
    configuration: {
      projectId: "project",
      github: { repository: "ariakit/visonaut", repositoryId: "123" },
    },
  });
  return {
    service,
    metadata,
    compare,
    reserve,
    shard,
    model: async () => parseReviewModel(await reviewModel(api, "run")),
  };
}

it("resolves stored metrics and masks through review, approval, and Undo", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const test = await localFixture(fixture.context);
  const puts = vi.spyOn(fixture.images, "put");
  await test.compare();
  expect(puts).not.toHaveBeenCalled();
  expect(
    database.connection
      .prepare(
        "SELECT result_json FROM visonaut_comparison_rows WHERE comparison_id='comparison-run'",
      )
      .get(),
  ).toEqual({ result_json: marker });
  const row = (await test.service.comparisonRows("comparison-run"))[0];
  if (!row) throw new Error("Missing local row.");
  expect(JSON.parse(row.result_json ?? "null")).toEqual(changedResult);
  const model = await test.model();
  expect(model.items[0]?.variants[0]).toMatchObject({
    changedPixels: 1,
    ratio: 1,
    maskExpected: true,
    diff: { id: "mask-run" },
  });
  await test.service.review({
    commandId: "approve",
    actorId: "reviewer",
    sessionId: "session",
    comparisonId: "comparison-run",
    verdict: "approved",
    targets: [{ id: row.id, expectedRevision: row.decision_revision }],
    selection: { itemKey: "dialog", variantKey: "light" },
    now: fixture.context.now(),
  });
  expect((await test.model()).items[0]?.variants[0]?.verdict).toBe("approved");
  await test.service.undo({
    commandId: "approve",
    undoCommandId: "undo",
    actorId: "reviewer",
    sessionId: "session",
    expectedBaselineRevision: 1,
    now: fixture.context.now(),
  });
  expect((await test.model()).items[0]?.variants[0]).toMatchObject({
    verdict: null,
    changedPixels: 1,
  });
  expect(
    database.connection
      .prepare("SELECT metadata_json FROM visonaut_captures WHERE id='capture-run'")
      .get(),
  ).toEqual({ metadata_json: JSON.stringify(test.metadata) });
});

it.each(["changed", "unchanged"] as const)(
  "keeps the original %s receipt for sealed recovery and inherited baseline borrowing",
  async (outcome) => {
    using database = new TestDatabase();
    const fixture = context(database);
    const original = {
      ...changedResult,
      outcome,
      changedPixels: 0,
      ratio: 0,
      maskExpected: false,
      maskImageId: undefined,
      thumbnailImageId: undefined,
    };
    const test = await localFixture(fixture.context, original);
    expect((await test.service.run("run")).sealed_at).not.toBeNull();
    expect((await test.service.run("run")).comparison_id).toBeNull();
    await test.compare();
    const resolved = (await test.service.comparisonRows("comparison-run"))[0];
    expect(resolved?.outcome).toBe("unchanged");
    expect(JSON.parse(resolved?.result_json ?? "null")).toEqual({
      ...JSON.parse(JSON.stringify(original)),
      outcome: "unchanged",
    });
    await test.service.reserveRun({
      ...test.reserve,
      id: "retry",
      attempt: 2,
      inheritFromRunId: "run",
      verifiedRelatedRunIds: ["run"],
      rerunShardKeys: [],
      verifiedInheritedShards: [
        {
          key: "chromium",
          manifestDigest: test.shard.manifest_digest,
          captureProfileDigest: test.shard.full_profile_digest,
        },
      ],
    });
    await test.service.sealRun({ runId: "retry", now: fixture.context.now() });
    await test.compare("comparison-retry", "retry");
    const inherited = (await test.service.comparisonRows("comparison-retry"))[0];
    expect(inherited?.outcome).toBe("unchanged");
    expect(JSON.parse(inherited?.result_json ?? "null")).toEqual(
      JSON.parse(resolved?.result_json ?? "null"),
    );
    expect(
      database.connection
        .prepare("SELECT metadata_json,image_id FROM visonaut_captures WHERE run_id='retry'")
        .get(),
    ).toMatchObject({
      metadata_json: JSON.stringify(test.metadata),
      image_id: outcome === "unchanged" ? "image-seed" : "image-run",
    });
    expect(() =>
      database.connection.prepare("DELETE FROM visonaut_captures WHERE id='capture-run'").run(),
    ).toThrow("FOREIGN KEY");
  },
);

it.each(["live", "archive"])(
  "keeps resolved results in the %s closed summary after capture cleanup",
  async (source) => {
    using database = new TestDatabase();
    const fixture = context(database);
    const test = await localFixture(fixture.context);
    await test.compare();
    await test.service.retireRun({ runId: "run", now: fixture.context.now() });
    if (source === "archive") {
      for (let step = 0; step < 60; step++) {
        const report = await archiveClosedRuns(fixture.context);
        expect(report.attention).toEqual([]);
        if (report.completed.includes("run")) break;
      }
      const history = await readRunHistory(fixture.context, "run");
      expect(JSON.parse(String(history?.sections.comparisonRows?.[0]?.result_json))).toEqual(
        changedResult,
      );
    }
    fixture.state.time += closedRunRetentionMs + 1;
    for (let step = 0; step < 60; step++) {
      const report = await summarizeClosedRuns(fixture.context);
      expect(report.attention).toEqual([]);
      if (report.completed.includes("run")) break;
    }
    const summary = await readClosedSummary(database, "run");
    expect(JSON.parse(String(summary?.sections.comparisonRows?.[0]?.result_json))).toEqual(
      changedResult,
    );
    expect((await test.model()).items[0]?.variants[0]).toMatchObject({
      changedPixels: 1,
      ratio: 1,
    });
    expect(
      database.connection.prepare("SELECT id FROM visonaut_captures WHERE id='capture-run'").get(),
    ).toBeUndefined();
    expect(
      database.connection
        .prepare(
          "SELECT capture_id FROM visonaut_snapshot_images WHERE snapshot_id='snapshot-seed'",
        )
        .get(),
    ).toEqual({ capture_id: "capture-seed" });
  },
);

it("preserves inline legacy results and refuses malformed or broken local references", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const test = await localFixture(fixture.context);
  await test.compare();
  const write = database.connection.prepare(
    "UPDATE visonaut_comparison_rows SET result_json=? WHERE comparison_id='comparison-run'",
  );
  const inline = JSON.stringify({ ...changedResult, outcome: "unchanged" });
  write.run(inline);
  expect((await test.service.comparisonRows("comparison-run"))[0]?.result_json).toBe(inline);
  write.run(null);
  expect((await test.service.comparisonRows("comparison-run"))[0]?.result_json).toBeNull();
  for (const malformed of [
    { $visonautLocalResult: 2 },
    { $visonautLocalResult: "1" },
    { $visonautLocalResult: null },
    { $visonautLocalResult: 1, extra: true },
  ]) {
    write.run(JSON.stringify(malformed));
    await expect(test.service.comparisonRows("comparison-run")).rejects.toThrow("malformed JSON");
  }
  write.run(marker);
  database.connection
    .prepare(
      "UPDATE visonaut_comparison_rows SET candidate_capture_id=NULL WHERE comparison_id='comparison-run'",
    )
    .run();
  await expect(test.service.comparisonRows("comparison-run")).rejects.toThrow("malformed JSON");
  database.connection
    .prepare(
      "UPDATE visonaut_comparison_rows SET candidate_capture_id='capture-run' WHERE comparison_id='comparison-run'",
    )
    .run();
  database.connection
    .prepare(
      "UPDATE visonaut_captures SET metadata_json=json_remove(metadata_json,'$.localResult') WHERE id='capture-run'",
    )
    .run();
  await expect(test.model()).rejects.toThrow("malformed JSON");
  await test.service.retireRun({ runId: "run", now: fixture.context.now() });
  fixture.state.time += closedRunRetentionMs + 1;
  expect((await summarizeClosedRuns(fixture.context)).attention).toContain("run");
  expect(await readClosedSummary(database, "run")).toBeNull();
  expect(
    database.connection
      .prepare(
        "SELECT candidate_capture_id FROM visonaut_comparison_rows WHERE comparison_id='comparison-run'",
      )
      .get(),
  ).toEqual({ candidate_capture_id: "capture-run" });
});

it("bounds archive reads by resolved JSON bytes and resumes each row", async () => {
  using database = new TestDatabase();
  const fixture = context(database);
  const original = { ...changedResult, detail: "é".repeat(200_000) };
  const test = await localFixture(fixture.context, original);
  await test.compare();
  const insert = database.connection.prepare(
    "INSERT INTO visonaut_comparison_rows(id,comparison_id,item_key,variant_key,ordinal,candidate_capture_id,tuple_json,outcome,result_json) VALUES(?,'comparison-run',?,'light',?,'capture-run','{}','changed',?)",
  );
  for (let index = 0; index < 4; index++) {
    insert.run(`row-${index}`, `item-${index}`, index + 1, marker);
  }
  fixture.context.budget.maximumObjectBytes = 2 * 1024 * 1024;
  const progress: HistoryProgress = {
    section: historySections.indexOf("comparisonRows"),
    cursor: "",
    pages: [],
  };
  const ids: string[] = [];
  for (let step = 0; step < 5 && ids.length < 5; step++) {
    await writeHistoryStep(fixture.context, {
      runId: "run",
      generation: "resolved",
      progress,
      limit: 1,
      async onPage(section, rows) {
        if (section === "comparisonRows") ids.push(...rows.map((row) => String(row.id)));
      },
    });
  }
  expect(ids).toEqual(["comparison-run:capture-run", "row-0", "row-1", "row-2", "row-3"]);
  expect(progress.pages.map((page) => page.rows)).toEqual([2, 2, 1]);
});

it("uses the same native D1 insert writes for an inline result and its capture reference", async () => {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      compatibilityDate: "2026-09-22",
      d1Databases: ["DB"],
    }),
  );
  try {
    const database = await runtime.getD1Database("DB");
    await applyTestMigrations(database);
    using fixtureDatabase = new TestDatabase();
    const fixture = context(fixtureDatabase);
    const test = await localFixture({ ...fixture.context, database });
    await test.compare();
    expect(
      JSON.parse((await test.service.comparisonRows("comparison-run"))[0]?.result_json ?? "null"),
    ).toEqual(changedResult);
    const progress: HistoryProgress = {
      section: historySections.indexOf("images"),
      cursor: "",
      pages: [],
    };
    const imageIds: unknown[] = [];
    await writeHistoryStep(
      { ...fixture.context, database },
      {
        runId: "run",
        comparisonId: "comparison-run",
        generation: "native",
        progress,
        limit: 1,
        async onPage(section, rows) {
          if (section === "images") imageIds.push(...rows.map((row) => row.id));
        },
      },
    );
    expect(imageIds).toEqual(["image-run", "mask-run", "thumbnail-run"]);
    const sql =
      "INSERT INTO visonaut_comparison_rows(id,comparison_id,item_key,variant_key,ordinal,reference_capture_id,candidate_capture_id,tuple_json,outcome,result_json) SELECT ?,comparison_id,?,variant_key,ordinal,reference_capture_id,candidate_capture_id,tuple_json,outcome,? FROM visonaut_comparison_rows WHERE id='comparison-run:capture-run'";
    const inline = await database
      .prepare(sql)
      .bind("inline", "inline", JSON.stringify(changedResult))
      .run();
    const referenced = await database.prepare(sql).bind("referenced", "referenced", marker).run();
    expect(referenced.meta.rows_written).toBe(inline.meta.rows_written);
    expect(referenced.meta.rows_written).toBeGreaterThan(0);
    await database
      .prepare("UPDATE visonaut_comparison_rows SET result_json=? WHERE id='referenced'")
      .bind('{"$visonautLocalResult":2}')
      .run();
    await expect(test.service.comparisonRows("comparison-run")).rejects.toThrow("malformed JSON");
    const path = process.env.VISONAUT_D1_COST_REPORT;
    if (path)
      appendFileSync(
        path,
        `${JSON.stringify({ label: "local-result-insert", inline: inline.meta, referenced: referenced.meta })}\n`,
      );
  } finally {
    await runtime.dispose();
  }
});
