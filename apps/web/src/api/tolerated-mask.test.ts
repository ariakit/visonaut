import {
  readLegacyComparisonTask,
  seedLegacyComparison,
  seedLegacyResult,
} from "../../../../tooling/legacy-comparison-fixture.ts";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeAll, expect, it } from "vitest";
import { Service, closedRunRetentionMs } from "@visonaut/service";
import { validateImage, type ImageCodecs } from "@visonaut/compare";
import { processComparisonTask } from "../../../compare/src/process.ts";
import { nodeCodecs } from "../../../../packages/compare/test/codecs.ts";
import { context, TestDatabase } from "../operations/test-fixtures.ts";
import { parseReviewModel } from "../review/client.ts";
import { useEvidence } from "../review/use-evidence.ts";
import type { ReviewVariant } from "../review/model.ts";
import type { PrivateContext } from "./context.ts";
import { reviewModel } from "./review.ts";
import { readClosedSummary, summarizeClosedRuns } from "../operations/closed-summary.ts";

let codecs: ImageCodecs;
beforeAll(async () => {
  codecs = await nodeCodecs();
});

function evidence(variant: ReviewVariant) {
  const Probe = () => {
    const state = useEvidence({ comparisonId: "comparison-run", variant, mode: "diff", retry: 0 });
    return state.error ?? state.status;
  };
  return renderToString(createElement(Probe));
}

for (const changedProfile of [false, true]) {
  it(`preserves intentional mask absence from worker through ${changedProfile ? "changed" : "same"} profiles to review and history`, async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const service = new Service(database);
    await service.createPolicy({
      digest: "policy",
      policy: { id: "tolerated", channelThreshold: 0, maxChangedRatio: 1 },
    });
    await service.createProject({ id: "project", repositoryId: "123", policyDigest: "policy" });
    const capture = async (id: string, red: number, profileDigest: string) => {
      await service.reserveRun({
        id,
        projectId: "project",
        externalRunId: id,
        attempt: 1,
        kind: id === "seed" ? "main" : "pull_request",
        testedSha: `sha-${id}`,
        lineageKey: id,
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
        verifiedAncestorShas: id === "seed" ? [] : ["sha-seed"],
        verificationDigest: "verified",
        rerunShardKeys: ["chromium"],
        now: fixture.state.time,
      });
      const bytes = new Uint8Array(
        await codecs.encodePng({
          width: 1,
          height: 1,
          data: new Uint8ClampedArray([red, 0, 0, 255]),
        }),
      );
      const validated = await validateImage(bytes);
      const objectKey = `runs/${id}/original`;
      await fixture.images.put(objectKey, bytes);
      await service.registerImage({
        id: `image-${id}`,
        runId: id,
        digest: validated.digest,
        objectKey,
        contentType: "image/png",
        bytes: bytes.length,
        width: 1,
        height: 1,
      });
      await service.commitShard({
        runId: id,
        key: "chromium",
        manifestDigest: `manifest-${id}`,
        finalTestOutcomes: [{ testId: "test", retry: 0, status: "passed" }],
        captures: [
          {
            id: `capture-${id}`,
            itemKey: "dialog",
            variantKey: "light",
            ordinal: 0,
            imageId: `image-${id}`,
            profileDigest,
            environmentProfileDigest: "profile",
            testId: "test",
            testRetry: 0,
            metadata: { name: "Dialog" },
          },
        ],
        now: fixture.state.time,
      });
      await service.sealRun({ runId: id, now: fixture.state.time });
      await seedLegacyComparison(service, {
        id: `comparison-${id}`,
        runId: id,
        referenceSnapshotId: id === "seed" ? null : "snapshot-seed",
        now: fixture.state.time,
        maxAttempts: 2,
      });
    };
    await capture("seed", 0, "profile");
    await service.finalizeComparison({ comparisonId: "comparison-seed", now: fixture.state.time });
    const copies = await service.preparePromotion({
      snapshotId: "snapshot-seed",
      comparisonId: "comparison-seed",
      prefix: "baselines/seed",
      now: fixture.state.time,
    });
    for (const copy of copies) {
      const original = await fixture.images.get("runs/seed/original");
      if (!original) throw new Error("Missing seed image.");
      await fixture.images.put(copy.object_key, original.body);
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
      now: fixture.state.time,
    });
    await capture("run", 1, changedProfile ? "profile-after" : "profile");
    const row = (await service.comparisonRows("comparison-run"))[0];
    if (!row) throw new Error("Missing comparison row.");
    // reviewModel uses only these context members; D1 and SQLite share the SQL interface.
    const privateContext = {} as PrivateContext;
    Object.assign(privateContext, {
      service,
      database,
      configuration: {
        projectId: "project",
        github: { repository: "ariakit/visonaut-diagnostics", repositoryId: "123" },
      },
    });
    const comparing = parseReviewModel(await reviewModel(privateContext, "run"));
    expect(comparing.run.status).toBe("comparing");
    expect(comparing.items[0]?.variants[0]).toMatchObject({ kind: "pending" });
    expect(comparing.items[0]?.variants[0]?.error).toBeUndefined();
    database.connection.prepare("UPDATE work_tasks SET state = 'dead' WHERE id = ?").run(row.id);
    const failed = parseReviewModel(await reviewModel(privateContext, "run"));
    expect(failed.run.status).toBe("failed");
    expect(failed.items[0]?.variants[0]).toMatchObject({
      kind: "error",
      error: "Comparison stopped before evidence was available.",
    });
    database.connection.prepare("UPDATE work_tasks SET state = 'queued' WHERE id = ?").run(row.id);
    const task = await readLegacyComparisonTask(service, row.id);
    const processed = await processComparisonTask({
      task,
      images: {
        get: (key) => fixture.images.get(key),
        put: (key, bytes) => fixture.images.put(key, bytes),
      },
      codecs,
    });
    expect(processed.result).toMatchObject({ outcome: "unchanged", changedPixels: 1 });
    expect(processed.result).not.toHaveProperty("maskImageId");
    await seedLegacyResult(service, {
      taskId: row.id,
      ...processed,
      result: { ...processed.result, outcome: changedProfile ? "changed" : "unchanged" },
    });
    await service.finalizeComparison({ comparisonId: "comparison-run", now: fixture.state.time });
    const model = parseReviewModel(await reviewModel(privateContext, "run"));
    const variant = model.items[0]?.variants[0];
    if (!variant) throw new Error("Missing review variant.");
    expect(variant.kind).toBe(changedProfile ? "changed" : "unchanged");
    expect(variant.threshold).toBe("Channel threshold 0; ratio 1.");
    expect(variant.diff).toBeNull();
    expect(evidence(variant)).toBe("loading");
    expect(variant).toMatchObject({ maskExpected: false, changedPixels: 1 });
    const committed = (await service.comparisonRows("comparison-run"))[0];
    expect(JSON.parse(committed?.result_json ?? "null")).toMatchObject({ maskExpected: false });
    expect(evidence({ ...variant, candidate: null })).toContain("Required candidate evidence");
    expect(evidence({ ...variant, maskExpected: true })).toContain("Required diff evidence");
    if (changedProfile) {
      await service.review({
        commandId: "approve",
        actorId: "maintainer",
        sessionId: "session",
        comparisonId: "comparison-run",
        verdict: "approved",
        targets: [{ id: row.id, expectedRevision: 0 }],
        selection: { itemKey: "dialog", variantKey: "light" },
        now: fixture.state.time,
      });
    }
    const committedResult = JSON.parse(committed?.result_json ?? "null");
    if (!changedProfile) {
      database.connection
        .prepare("UPDATE visonaut_comparison_rows SET result_json=? WHERE id=?")
        .run(JSON.stringify({ ...committedResult, maskExpected: undefined }), row.id);
      const legacy = parseReviewModel(await reviewModel(privateContext, "run"));
      expect(legacy.items[0]?.variants[0]?.maskExpected).toBe(false);
    }
    database.connection
      .prepare("UPDATE visonaut_comparison_rows SET result_json=? WHERE id=?")
      .run(JSON.stringify({ ...committedResult, maskImageId: "missing-mask" }), row.id);
    const missingMask = parseReviewModel(await reviewModel(privateContext, "run"));
    const missingVariant = missingMask.items[0]?.variants[0];
    if (!missingVariant) throw new Error("Missing review variant.");
    expect(missingVariant).toMatchObject({ maskExpected: true, diff: null });
    expect(evidence(missingVariant)).toContain("Required diff evidence");
    database.connection
      .prepare("UPDATE visonaut_comparison_rows SET result_json=? WHERE id=?")
      .run(JSON.stringify(committedResult), row.id);
    await service.retireRun({ runId: "run", now: fixture.state.time });
    const retained = parseReviewModel(await reviewModel(privateContext, "run"));
    expect(retained).toMatchObject({ archived: true, reviewReady: false });
    expect(retained.evidenceState).toBeUndefined();
    expect(retained.items[0]?.variants[0]).toMatchObject({
      maskExpected: false,
      changedPixels: 1,
      diff: null,
    });
    fixture.state.time += closedRunRetentionMs + 1;
    const report = await summarizeClosedRuns(fixture.context);
    expect(report.attention).toEqual([]);
    expect(report.completed).toContain("run");
    const summary = await readClosedSummary(database, "run");
    expect(summary?.sections.comparisonRows?.[0]?.result_json).toBe(
      JSON.stringify(committedResult),
    );
    const archived = parseReviewModel(await reviewModel(privateContext, "run"));
    expect(archived).toMatchObject({
      archived: true,
      reviewReady: false,
      evidenceState: "summary",
    });
    expect(archived.items[0]?.variants[0]).toMatchObject({
      maskExpected: false,
      changedPixels: 1,
      reference: null,
      candidate: null,
      diff: null,
    });
  });
}
