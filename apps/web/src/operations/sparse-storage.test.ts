import { describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  digestEnvironmentProfile,
  digestJson,
  digestRenderingProfile,
  LOCAL_COMPARISON_CODEC,
  LOCAL_COMPARISON_ENGINE,
  type LocalComparisonReceipt,
} from "@visonaut/protocol";
import type { ReferenceCaptureInput, ValidatedImage } from "@visonaut/service";
import {
  readCaptureInventory,
  writeCaptureInventory,
  type CaptureInventory,
  type InventoryCapture,
} from "../capture-inventory.ts";
import { promoteBaselines } from "./promotions.ts";
import { expireRunImages } from "./retention.ts";
import { summarizeClosedRuns } from "./closed-summary.ts";
import { inspectRecoveryInventories, type RecoveryInventoryCursor } from "./recovery.ts";
import { archiveClosedRuns, writeHistoryStep, type HistoryProgress } from "./history.ts";
import { historySections, type HistoryRow } from "./history-format.ts";
import { retireSourceBaselines } from "./snapshot-retention.ts";
import {
  activateReset,
  copyResetPage,
  prepareReset,
  type ResetContext,
} from "../../tooling/baseline-reset/reset.ts";
import { captured, context, digest, profile, TestDatabase } from "./test-fixtures.ts";
import { reviewModel } from "../api/review.ts";
import type { PrivateContext } from "../api/context.ts";
import { parseReviewModel } from "../review/client.ts";
import type { ReviewItem } from "../review/model.ts";

interface SparseFixtureParams {
  database: TestDatabase;
  fixture: ReturnType<typeof context>;
  changed: number;
  inherited: number;
  added?: number;
  removed?: number;
  referenceInventory?: boolean;
  profileOnly?: boolean;
}

async function sparseFixture({
  database,
  fixture,
  changed,
  inherited,
  added = 0,
  removed = 0,
  referenceInventory = false,
  profileOnly,
}: SparseFixtureParams) {
  const service = await captured(fixture.context, "seed", "main");
  const profileDigest = await digestJson(profile);
  const renderingProfileDigest = await digestRenderingProfile(profile);
  const environmentProfileDigest = await digestEnvironmentProfile(profile);
  await database
    .prepare(
      "INSERT INTO visonaut_capture_profiles(digest,profile_json,rendering_digest) VALUES(?,?,?)",
    )
    .bind(profileDigest, canonicalJson(profile), renderingProfileDigest)
    .run();
  const metadata = { profile, name: "Dialog", variant: { key: "light", browser: "chromium" } };
  await database
    .prepare(
      "UPDATE visonaut_captures SET item_key='dialog-0',profile_digest=?,metadata_json=? WHERE run_id='seed'",
    )
    .bind(profileDigest, canonicalJson(metadata))
    .run();
  const referenceCount = changed + inherited + removed;
  for (let ordinal = 1; ordinal < referenceCount; ordinal++) {
    // One retained source image represents several independent baseline items.
    await database
      .prepare(
        "INSERT INTO visonaut_captures(id,run_id,shard_key,item_key,variant_key,ordinal,image_id,profile_digest,test_id,test_retry,metadata_json) VALUES(?,'seed','chromium',?,'light',?,'image-seed',?,'test',0,?)",
      )
      .bind(
        `capture-seed-${ordinal}`,
        `dialog-${ordinal}`,
        ordinal,
        profileDigest,
        canonicalJson(metadata),
      )
      .run();
  }
  const originalBudget = fixture.context.budget.objectsPerStep;
  fixture.context.budget.objectsPerStep = 50;
  let seeded = false;
  for (let step = 0; step < referenceCount; step++) {
    if ((await promoteBaselines(fixture.context)).completed.includes("seed")) {
      seeded = true;
      break;
    }
  }
  expect(seeded).toBe(true);
  fixture.context.budget.objectsPerStep = originalBudget;
  const project = await service.project("project");
  const source: ValidatedImage = {
    id: "image-seed",
    runId: "seed",
    objectKey: "runs/seed/original",
    digest: digest("original-image-bytes"),
    bytes: "original-image-bytes".length,
    contentType: "image/png",
    width: 1,
    height: 1,
  };
  const references: ReferenceCaptureInput[] = Array.from(
    { length: referenceCount },
    (_, ordinal) => ({
      id: ordinal ? `capture-seed-${ordinal}` : "capture-seed",
      itemKey: `dialog-${ordinal}`,
      variantKey: "light",
      profileDigest,
      renderingProfileDigest,
      image: source,
    }),
  );
  if (referenceInventory) {
    const baseline: CaptureInventory = {
      schemaVersion: "baseline-delta-v1",
      projectId: "project",
      runId: "seed",
      testedSha: "a".repeat(40),
      referenceSnapshotId: null,
      profiles: [{ digest: profileDigest, profile }],
      captures: references.map((reference, ordinal) => ({
        ...reference,
        renderingProfileDigest,
        ordinal,
        imageId: source.id,
        environmentProfileDigest,
        testId: "test",
        testRetry: 0,
        metadata,
      })),
    };
    const pointer = await writeCaptureInventory(fixture.images, baseline);
    await database
      .prepare(
        "UPDATE visonaut_runs SET inventory_key=?,inventory_digest=?,inventory_bytes=?,capture_count=? WHERE id='seed'",
      )
      .bind(pointer.objectKey, pointer.digest, pointer.bytes, pointer.captureCount)
      .run();
    await database
      .prepare(
        "UPDATE visonaut_snapshots SET inventory_key=?,inventory_digest=?,inventory_bytes=?,capture_count=?,inventory_verified=1 WHERE id=?",
      )
      .bind(
        pointer.objectKey,
        pointer.digest,
        pointer.bytes,
        pointer.captureCount,
        project.snapshot_id,
      )
      .run();
  }
  const identities = [
    ...references
      .slice(0, changed + inherited)
      .map(({ itemKey, variantKey }) => ({ itemKey, variantKey })),
    ...Array.from({ length: added }, (_, ordinal) => ({
      itemKey: `added-${ordinal}`,
      variantKey: "light",
    })),
  ];
  fixture.state.time += 1;
  const planDigest = "d".repeat(64);
  await service.reserveRun({
    id: "run",
    projectId: "project",
    externalRunId: "run",
    attempt: 1,
    kind: "main",
    testedSha: "b".repeat(40),
    lineageKey: "main",
    plan: {
      digest: planDigest,
      shards: [
        {
          key: "combined",
          profileDigest,
          tests: ["test"],
          captures: identities.map(({ itemKey, variantKey }) => ({
            itemKey,
            variantKey,
            testId: "test",
          })),
        },
      ],
    },
    verifiedRelatedRunIds: [],
    verifiedAncestorShas: ["a".repeat(40)],
    verificationDigest: "verified",
    rerunShardKeys: ["combined"],
    now: fixture.state.time,
  });
  const receipt: LocalComparisonReceipt = {
    mode: "local-v1",
    engineVersion: LOCAL_COMPARISON_ENGINE,
    codecVersion: LOCAL_COMPARISON_CODEC,
    reference: {
      snapshotId: project.snapshot_id,
      baselineRevision: project.baseline_revision,
      manifestDigest: "e".repeat(64),
      inventoryDigest: "f".repeat(64),
      captureCount: referenceCount,
    },
    captures: [],
    removals: references
      .slice(changed + inherited)
      .map(({ itemKey, variantKey }) => ({ itemKey, variantKey })),
  };
  const captures: InventoryCapture[] = [];
  for (const [ordinal, identity] of identities.entries()) {
    const reference = references.find((entry) => entry.itemKey === identity.itemKey);
    const isChanged = ordinal < changed || !reference;
    const body = `candidate-${ordinal}`;
    const image: ValidatedImage = isChanged
      ? {
          id: `image-run-${ordinal}`,
          runId: "run",
          objectKey: `runs/run/images/${ordinal}.png`,
          digest: digest(body),
          bytes: body.length,
          contentType: "image/png",
          width: 1,
          height: 1,
        }
      : source;
    if (isChanged) {
      await fixture.images.put(image.objectKey, body, {
        httpMetadata: { contentType: "image/png" },
      });
      await service.registerImage(image);
    }
    const observed = {
      path: `images/${ordinal}.png`,
      mediaType: image.contentType,
      digest: image.digest,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
    };
    const outcome = isChanged ? ("changed" as const) : ("unchanged" as const);
    const changedPixels = isChanged && !profileOnly ? 1 : 0;
    captures.push({
      id: `capture-run-${ordinal}`,
      itemKey: identity.itemKey,
      variantKey: identity.variantKey,
      ordinal,
      imageId: image.id,
      image,
      profileDigest,
      renderingProfileDigest,
      environmentProfileDigest,
      testId: "test",
      testRetry: 0,
      metadata: {
        ...metadata,
        localMode: "local-v1",
        candidateStored: isChanged,
        observedImage: observed,
        localResult: {
          outcome: profileOnly ? "unchanged" : outcome,
          changedPixels,
          ratio: changedPixels,
          maskExpected: false,
          engineVersion: LOCAL_COMPARISON_ENGINE,
          codecVersion: LOCAL_COMPARISON_CODEC,
        },
      },
    });
    receipt.captures.push({
      itemKey: identity.itemKey,
      variantKey: identity.variantKey,
      candidateDigest: image.digest,
      referenceDigest: reference?.image.digest ?? null,
      outcome,
      changedPixels,
      ratio: changedPixels,
      sizeChanged: false,
    });
  }
  const inventory: CaptureInventory = {
    schemaVersion: "baseline-delta-v1",
    projectId: "project",
    runId: "run",
    testedSha: "b".repeat(40),
    referenceSnapshotId: project.snapshot_id,
    captures,
    profiles: [{ digest: profileDigest, profile }],
    manifest: {
      schemaVersion: "1.0",
      producer: {
        name: "visonaut",
        version: "1.0.0",
        nodeVersion: "24",
        playwrightVersion: "1.63.0",
      },
      run: {
        repository: "owner/repo",
        repositoryId: "123",
        workflowRunId: "456",
        workflowAttempt: 1,
        testedSha: "b".repeat(40),
        planDigest,
      },
      shard: { key: "combined", jobId: "789", sourceAttempt: 1 },
      profiles: [{ digest: profileDigest, profile }],
      tests: [
        { id: "test", file: "dialog.test.ts", titlePath: ["Dialog"], retry: 0, status: "passed" },
      ],
      captures: captures.map((capture) => ({
        itemKey: capture.itemKey,
        variant: { key: "light", browser: "chromium" },
        ordinal: capture.ordinal,
        testId: "test",
        testRetry: 0,
        profileDigest,
        image: {
          path: `images/${capture.ordinal}.png`,
          mediaType: capture.image.contentType,
          digest: capture.image.digest,
          bytes: capture.image.bytes,
          width: capture.image.width,
          height: capture.image.height,
        },
      })),
      localComparison: receipt,
    },
  };
  const pointer = await writeCaptureInventory(fixture.images, inventory);
  await service.commitShard({
    runId: "run",
    key: "combined",
    manifestDigest: "c".repeat(64),
    captures,
    inventory: pointer,
    imageRunIds: [...new Set(captures.map((capture) => capture.image.runId))],
    localReferenceSnapshotId: project.snapshot_id,
    finalTestOutcomes: [{ testId: "test", retry: 0, status: "passed" }],
    now: fixture.state.time,
  });
  await service.sealRun({ runId: "run", now: fixture.state.time });
  await service.createComparison({
    id: "comparison-run",
    runId: "run",
    referenceSnapshotId: project.snapshot_id,
    expectedBaselineRevision: project.baseline_revision,
    localComparison: receipt,
    referenceCaptures: references,
    now: fixture.state.time,
  });
  await service.finalizeComparison({ comparisonId: "comparison-run", now: fixture.state.time });
  for (const row of await service.comparisonRows("comparison-run")) {
    await service.review({
      commandId: `approve-${row.id}`,
      actorId: "maintainer",
      sessionId: "session",
      comparisonId: "comparison-run",
      verdict: "approved",
      targets: [{ id: row.id, expectedRevision: row.decision_revision }],
      selection: { itemKey: row.item_key, variantKey: row.variant_key },
      now: fixture.state.time,
    });
  }
  return { service, inventory, pointer, source };
}

function itemEvidence(items: ReviewItem[]) {
  return items.map((item) => ({
    key: item.key,
    name: item.name,
    variants: item.variants.map((variant) => ({
      id: variant.id,
      key: variant.key,
      label: variant.label,
      labelParts: variant.labelParts,
      kind: variant.kind,
      revision: variant.revision,
      verdict: variant.verdict,
      source: variant.source,
      reviewer: variant.reviewer,
      reference: variant.reference,
      candidate: variant.candidate,
      changedPixels: variant.changedPixels,
      ratio: variant.ratio,
      referenceProfile: variant.referenceProfile,
      candidateProfile: variant.candidateProfile,
    })),
  }));
}

describe("sparse inventory operations", () => {
  it("collects an unpinned imported baseline's images while retaining inventory and reset evidence", async () => {
    using database = new TestDatabase();
    using target = new TestDatabase();
    const fixture = context(database);
    const sparse = await sparseFixture({ database, fixture, changed: 0, inherited: 2 });
    const policy = { id: "fixture", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 };
    const policyDigest = await digestJson(policy);
    await sparse.service.createPolicy({ digest: policyDigest, policy });
    await database
      .prepare("UPDATE visonaut_projects SET policy_digest=? WHERE id='project'")
      .bind(policyDigest)
      .run();
    const sourceProject = await sparse.service.project("project");
    if (!sourceProject.snapshot_id) throw new Error("Missing source baseline.");
    const reset: ResetContext = {
      source: database,
      target,
      sourceImages: fixture.images,
      targetImages: fixture.images,
      sourceDatabaseId: "00000000-0000-0000-0000-000000000001",
      targetDatabaseId: "00000000-0000-0000-0000-000000000002",
      projectId: "project",
      now: () => fixture.state.time,
    };
    const prepared = await prepareReset(reset, {
      snapshotId: sourceProject.snapshot_id,
      baselineRevision: sourceProject.baseline_revision,
      testedSha: "a".repeat(40),
    });
    await copyResetPage(reset, { importId: prepared.importId, page: 0 });
    await activateReset(reset, prepared.importId);
    const inventory = await readCaptureInventory(fixture.images, prepared.inventory);
    const owner = inventory.runId;
    const original = inventory.captures[0]?.image.objectKey;
    if (!original) throw new Error("Missing imported original.");
    const targetFixture = context(target);
    targetFixture.context.images = fixture.images;
    targetFixture.context.now = () => fixture.state.time;
    const unrelated = `baselines/import/${prepared.importId}-other/images/original.png`;
    await fixture.images.put(unrelated, "unrelated");
    fixture.state.time += 31 * 86400000;
    expect((await summarizeClosedRuns(targetFixture.context)).attention).toEqual([]);
    expect((await expireRunImages(targetFixture.context)).completed).toEqual([]);
    expect(fixture.images.objects.has(original)).toBe(true);
    target.connection.exec(
      "UPDATE visonaut_projects SET snapshot_id=NULL,promotion_id=NULL WHERE id='project'",
    );
    expect((await retireSourceBaselines(targetFixture.context)).attention).toEqual([]);
    const report = await expireRunImages(targetFixture.context);
    expect(report.attention).toEqual([]);
    expect(report.completed).toEqual([owner]);
    expect(fixture.images.objects.has(original)).toBe(false);
    expect(fixture.images.objects.has(prepared.inventory.objectKey)).toBe(true);
    expect(fixture.images.objects.has(`baselines/import/${prepared.importId}/plan.json`)).toBe(
      true,
    );
    expect(fixture.images.objects.has(`baselines/import/${prepared.importId}/copies/0.json`)).toBe(
      true,
    );
    expect(fixture.images.objects.has(unrelated)).toBe(true);
    expect(await readCaptureInventory(fixture.images, prepared.inventory)).toEqual(inventory);
    expect(
      await target
        .prepare("SELECT byte_state FROM work_retained_runs WHERE id=?")
        .bind(owner)
        .first(),
    ).toEqual({ byte_state: "deleted" });
  });
  it("promotes a complete unchanged inventory without reading inherited originals or copying memberships", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const sparse = await sparseFixture({ database, fixture, changed: 0, inherited: 120 });
    const get = vi.spyOn(fixture.images, "get");
    const put = vi.spyOn(fixture.images, "put");
    expect((await promoteBaselines(fixture.context)).completed).toEqual(["run"]);
    expect(get.mock.calls.map(([key]) => key)).toEqual([sparse.pointer.objectKey]);
    expect(put).not.toHaveBeenCalled();
    const project = await sparse.service.project("project");
    expect(
      await database
        .prepare(
          "SELECT inventory_key,inventory_verified,capture_count FROM visonaut_snapshots WHERE id=?",
        )
        .bind(project.snapshot_id)
        .first(),
    ).toEqual({
      inventory_key: sparse.pointer.objectKey,
      inventory_verified: 1,
      capture_count: 120,
    });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM visonaut_snapshot_images WHERE snapshot_id=?")
        .bind(project.snapshot_id)
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await database
        .prepare("SELECT run_id FROM work_retention_pins WHERE owner=? ORDER BY run_id")
        .bind(`promotion:${project.snapshot_id}`)
        .all(),
    ).toEqual({ results: [{ run_id: "run" }, { run_id: "seed" }] });
  });

  it("verifies only changed originals in bounded pages and marks the full inventory after the last page", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const sparse = await sparseFixture({ database, fixture, changed: 5, inherited: 120 });
    const get = vi.spyOn(fixture.images, "get");
    expect((await promoteBaselines(fixture.context)).deferred).toEqual(["run"]);
    expect(
      await database
        .prepare("SELECT inventory_verified FROM visonaut_snapshots WHERE run_id='run'")
        .first(),
    ).toEqual({ inventory_verified: 0 });
    expect((await promoteBaselines(fixture.context)).deferred).toEqual(["run"]);
    expect((await promoteBaselines(fixture.context)).completed).toEqual(["run"]);
    expect(
      get.mock.calls.filter(([key]) => key !== sparse.pointer.objectKey).map(([key]) => key),
    ).toEqual(Array.from({ length: 5 }, (_, ordinal) => `runs/run/images/${ordinal}.png`));
    expect(
      await database
        .prepare("SELECT id FROM operations_cursors WHERE id LIKE 'promotion-originals:%'")
        .all(),
    ).toEqual({ results: [] });
  });

  it("verifies uploaded profile-only representatives even when their normalized capture row is omitted", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await sparseFixture({ database, fixture, changed: 1, inherited: 1, profileOnly: true });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM visonaut_captures WHERE run_id='run'")
        .first(),
    ).toEqual({ count: 0 });
    await fixture.images.delete("runs/run/images/0.png");
    expect((await promoteBaselines(fixture.context)).attention).toEqual(["run"]);
    await fixture.images.put("runs/run/images/0.png", "candidate-0");
    const get = vi.spyOn(fixture.images, "get");
    expect((await promoteBaselines(fixture.context)).completed).toEqual(["run"]);
    expect(get.mock.calls.map(([key]) => key)).toContain("runs/run/images/0.png");
  });

  it("releases partial verification progress when the prepared run closes", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const sparse = await sparseFixture({ database, fixture, changed: 3, inherited: 1 });
    expect((await promoteBaselines(fixture.context)).deferred).toEqual(["run"]);
    expect(
      (
        await database
          .prepare("SELECT id FROM operations_cursors WHERE id LIKE 'promotion-originals:%'")
          .all()
      ).results,
    ).toHaveLength(1);
    await sparse.service.retireRun({ runId: "run", now: fixture.state.time });
    await promoteBaselines(fixture.context);
    expect(
      await database
        .prepare("SELECT id FROM operations_cursors WHERE id LIKE 'promotion-originals:%'")
        .all(),
    ).toEqual({ results: [] });
    expect(
      await database.prepare("SELECT state FROM visonaut_snapshots WHERE run_id='run'").first(),
    ).toEqual({ state: "revoked" });
  });

  it.each(["missing", "corrupt", "absent-registry-bytes"])(
    "blocks %s changed candidate originals and retries without advancing the verification cursor",
    async (failure) => {
      using database = new TestDatabase();
      const fixture = context(database);
      const sparse = await sparseFixture({ database, fixture, changed: 1, inherited: 1 });
      const original = fixture.images.objects.get("runs/run/images/0.png");
      if (!original) throw new Error("Missing fixture original.");
      if (failure === "missing") await fixture.images.delete("runs/run/images/0.png");
      if (failure === "corrupt") await fixture.images.put("runs/run/images/0.png", "corrupt");
      if (failure === "absent-registry-bytes")
        await database
          .prepare("UPDATE visonaut_images SET bytes_present=0 WHERE run_id='run'")
          .run();
      expect((await promoteBaselines(fixture.context)).attention).toEqual(["run"]);
      expect((await sparse.service.project("project")).snapshot_id).toBe(
        sparse.inventory.referenceSnapshotId,
      );
      expect(
        await database
          .prepare("SELECT id FROM operations_cursors WHERE id LIKE 'promotion-originals:%'")
          .all(),
      ).toEqual({ results: [] });
      if (failure === "absent-registry-bytes") return;
      await fixture.images.put("runs/run/images/0.png", original.bytes);
      expect((await promoteBaselines(fixture.context)).completed).toEqual(["run"]);
    },
  );

  it("rejects missing and tampered inventory evidence before preparing a snapshot", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const sparse = await sparseFixture({ database, fixture, changed: 0, inherited: 2 });
    await fixture.images.put(sparse.pointer.objectKey, "{}");
    expect((await promoteBaselines(fixture.context)).attention).toEqual(["run"]);
    expect(
      await database.prepare("SELECT id FROM visonaut_snapshots WHERE run_id='run'").all(),
    ).toEqual({ results: [] });
    await fixture.images.delete(sparse.pointer.objectKey);
    expect((await promoteBaselines(fixture.context)).attention).toEqual(["run"]);
    await writeCaptureInventory(fixture.images, sparse.inventory);
    expect((await promoteBaselines(fixture.context)).completed).toEqual(["run"]);
  });

  it("retains full review metadata when a closed sparse run's original images expire", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const sparse = await sparseFixture({ database, fixture, changed: 1, inherited: 2 });
    await sparse.service.retireRun({ runId: "run", now: fixture.state.time });
    fixture.state.time += 31 * 86400000;
    expect((await summarizeClosedRuns(fixture.context)).completed).toContain("run");
    for (let step = 0; step < 10; step++) {
      if ((await expireRunImages(fixture.context)).completed.includes("run")) break;
    }
    expect(fixture.images.objects.has(sparse.pointer.objectKey)).toBe(true);
    expect(fixture.images.objects.has("runs/run/images/0.png")).toBe(false);
    expect(fixture.images.objects.has(sparse.source.objectKey)).toBe(true);
    expect(
      await database.prepare("SELECT byte_state FROM work_retained_runs WHERE id='run'").first(),
    ).toEqual({ byte_state: "deleted" });
    expect(
      await database.prepare("SELECT capture_count FROM visonaut_runs WHERE id='run'").first(),
    ).toEqual({ capture_count: 3 });
  });

  it("preserves changed, added, removed, and unchanged public review items after sparse history and image expiry", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const sparse = await sparseFixture({
      database,
      fixture,
      changed: 1,
      inherited: 2,
      added: 1,
      removed: 1,
      referenceInventory: true,
    });
    // These private-route reads do not use authentication or request transport.
    const api = {} as PrivateContext;
    Object.assign(api, {
      service: sparse.service,
      database,
      images: fixture.images,
      configuration: {
        projectId: "project",
        github: { repository: "owner/repo", repositoryId: "123" },
      },
    });
    const before = parseReviewModel(await reviewModel(api, "run"));
    expect(before.items.map((item) => item.variants[0]?.kind).sort()).toEqual([
      "added",
      "changed",
      "removed",
      "unchanged",
      "unchanged",
    ]);
    for (const item of before.items) {
      expect(item.name).toBe("Dialog");
      expect(item.variants[0]?.labelParts).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: "browser" })]),
      );
      const variant = item.variants[0];
      if (variant?.reference) expect(variant.referenceProfile).toBeTruthy();
      if (variant?.candidate) expect(variant.candidateProfile).toBeTruthy();
    }
    await sparse.service.retireRun({ runId: "run", now: fixture.state.time });
    fixture.state.time += 31 * 86400000;
    for (let step = 0; step < 10; step++) {
      if ((await summarizeClosedRuns(fixture.context)).completed.includes("run")) break;
    }
    for (let step = 0; step < 10; step++) {
      if ((await expireRunImages(fixture.context)).completed.includes("run")) break;
    }
    const after = parseReviewModel(await reviewModel(api, "run"));
    expect(after).toMatchObject({ archived: true, evidenceState: "summary", imagesExpired: true });
    expect(itemEvidence(after.items)).toEqual(itemEvidence(before.items));
    for (const item of after.items) {
      expect(item.variants[0]?.approveDisabledReason).toBeTruthy();
      expect(item.variants[0]?.rejectDisabledReason).toBeTruthy();
    }
    expect(fixture.images.objects.has(sparse.pointer.objectKey)).toBe(true);
    expect(fixture.images.objects.has("runs/run/images/0.png")).toBe(false);
    expect(fixture.images.objects.has("runs/run/images/3.png")).toBe(false);
    expect(fixture.images.objects.has(sparse.source.objectKey)).toBe(true);
    expect(
      await database
        .prepare(
          "SELECT COUNT(*) AS count FROM visonaut_comparison_rows WHERE comparison_id='comparison-run'",
        )
        .first(),
    ).toEqual({ count: 3 });
  });

  it("checks inherited baseline originals during recovery even when their D1 image row is absent", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const sparse = await sparseFixture({ database, fixture, changed: 0, inherited: 3 });
    expect((await promoteBaselines(fixture.context)).completed).toEqual(["run"]);
    // Imported baseline facts can outlive the dense source capture registry.
    database.connection.exec(
      "UPDATE visonaut_comparison_rows SET candidate_capture_id=NULL WHERE comparison_id='comparison-seed'; DELETE FROM visonaut_snapshot_images WHERE image_id='image-seed'; DELETE FROM visonaut_captures WHERE image_id='image-seed'; DELETE FROM visonaut_images WHERE id='image-seed';",
    );
    await fixture.images.delete(sparse.source.objectKey);
    let cursor: RecoveryInventoryCursor = { afterId: "", imageIndex: 0 };
    const missing: string[] = [];
    for (let step = 0; step < 10; step++) {
      const report = await inspectRecoveryInventories(fixture.context, cursor);
      missing.push(...report.missing);
      cursor = report.nextCursor;
      if (!report.hasMore) break;
    }
    expect(missing).toEqual([sparse.source.objectKey]);
  });

  it("checks active run originals from inventory after their D1 registry records are lost", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await sparseFixture({ database, fixture, changed: 1, inherited: 1 });
    database.connection.exec(
      "UPDATE visonaut_comparison_rows SET candidate_capture_id=NULL WHERE comparison_id='comparison-run'; DELETE FROM visonaut_captures WHERE run_id='run'; DELETE FROM visonaut_images WHERE run_id='run';",
    );
    await fixture.images.delete("runs/run/images/0.png");
    const report = await inspectRecoveryInventories(fixture.context);
    expect(report.missing).toEqual(["runs/run/images/0.png"]);
    expect(report.corrupt).toEqual([]);
    expect(report.checkedImages).toBe(2);
    expect(report.hasMore).toBe(false);
  });

  it("pages required inventory originals during recovery and reports missing and corrupt keys", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    await sparseFixture({ database, fixture, changed: 5, inherited: 1 });
    for (let step = 0; step < 3; step++) await promoteBaselines(fixture.context);
    await fixture.images.delete("runs/run/images/0.png");
    await fixture.images.put("runs/run/images/1.png", "corrupt");
    let cursor: RecoveryInventoryCursor = { afterId: "", imageIndex: 0 };
    const missing: string[] = [];
    const corrupt: string[] = [];
    let checkedImages = 0;
    let hasMore = true;
    for (let step = 0; step < 10; step++) {
      const report = await inspectRecoveryInventories(fixture.context, cursor);
      expect(report.checkedImages).toBeLessThanOrEqual(2);
      missing.push(...report.missing);
      corrupt.push(...report.corrupt);
      checkedImages += report.checkedImages;
      cursor = report.nextCursor;
      hasMore = report.hasMore;
      if (!hasMore) break;
    }
    expect(hasMore).toBe(false);
    expect(checkedImages).toBe(6);
    expect(missing).toEqual(["runs/run/images/0.png"]);
    expect(corrupt).toEqual(["runs/run/images/1.png"]);
  });

  it("keeps sparse runs out of dense compaction and includes full inventory in explicit evidence packing", async () => {
    using database = new TestDatabase();
    const fixture = context(database);
    const sparse = await sparseFixture({ database, fixture, changed: 1, inherited: 2 });
    await sparse.service.retireRun({ runId: "run", now: fixture.state.time });
    expect((await archiveClosedRuns(fixture.context)).completed).not.toContain("run");
    expect(
      await database.prepare("SELECT run_id FROM operations_run_archives WHERE run_id='run'").all(),
    ).toEqual({ results: [] });
    const documents: HistoryRow[] = [];
    const progress: HistoryProgress = {
      section: historySections.indexOf("documents"),
      cursor: "",
      pages: [],
    };
    await writeHistoryStep(fixture.context, {
      runId: "run",
      generation: "evidence",
      progress,
      limit: 1,
      async onPage(section, rows) {
        if (section === "documents") documents.push(...rows);
      },
    });
    expect(documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          objectKey: sparse.pointer.objectKey,
          digest: sparse.pointer.digest,
          bytes: sparse.pointer.bytes,
        }),
      ]),
    );
  });
});
