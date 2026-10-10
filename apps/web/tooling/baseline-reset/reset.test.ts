import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import {
  digestJson,
  sha256,
  captureRowView,
  parseCapturePage,
  TRANSPORT,
  LOCAL_COMPARISON_ENGINE,
  LOCAL_COMPARISON_CODEC,
  type LocalComparisonReceipt,
} from "@visonaut/protocol";
import { Service, type ReferenceCaptureInput, type ValidatedImage } from "@visonaut/service";
import { applyTestMigrations, readTestMigrations } from "../../../../tooling/test-migrations.ts";
import { MemoryStore, TestDatabase, profile } from "../../src/operations/test-fixtures.ts";
import {
  readCaptureInventory,
  writeCaptureInventory,
  type CaptureInventory,
  type InventoryCapture,
} from "../../src/capture-inventory.ts";
import { issueIngestCapability } from "@visonaut/security";
import {
  apiContext,
  type ApiBindings,
  type ObjectStorage,
  type PrivateContext,
} from "../../src/api/context.ts";
import { publicImage } from "../../src/api/images.ts";
import { handleApi } from "../../src/api/index.ts";
import { uuid } from "../../src/api/input.ts";
import { reviewModel } from "../../src/api/review.ts";
import { parseReviewModel } from "../../src/review/client.ts";
import { referencePage } from "../../src/api/local-comparison.ts";
import {
  activateReset,
  copyResetPage,
  identityPages,
  listResetObjects,
  prepareReset,
  type ResetContext,
} from "./reset.ts";

async function fixture(count = 2) {
  const sourceConnection = new DatabaseSync(":memory:");
  for (const migration of readTestMigrations({ through: "0033_d1_upload_evidence" })) {
    sourceConnection.exec(migration.sql);
  }
  const source = new TestDatabase(sourceConnection);
  const target = new TestDatabase();
  const images = new MemoryStore();
  const policy = { id: "fixture", channelThreshold: 0, maxChangedRatio: 0 };
  const policyDigest = await digestJson(policy);
  const profileDigest = await digestJson(profile);
  source.connection
    .prepare("INSERT INTO visonaut_policies VALUES(?,?)")
    .run(policyDigest, JSON.stringify(policy));
  source.connection
    .prepare(
      "INSERT INTO visonaut_projects(id,repository_id,policy_digest,baseline_revision,fresh_setup) VALUES('project','123',?,7,0)",
    )
    .run(policyDigest);
  source.connection
    .exec(`INSERT INTO visonaut_runs(id,project_id,external_run_id,attempt,kind,tested_sha,lineage_key,plan_digest,plan_json,state,active,sealed_at,closed_at,created_at)
    VALUES('old-run','project','111',1,'main','${"a".repeat(40)}','main','plan','{}','accepted',0,1,1,1);
    INSERT INTO visonaut_shards(run_id,key,profile_digest,expected_json,state) VALUES('old-run','chromium','profile','{}','complete');
    INSERT INTO visonaut_comparisons(id,run_id,baseline_revision,policy_digest,ordinal,state,created_at)
    VALUES('old-comparison','old-run',6,'${policyDigest}',0,'ready',1);
    INSERT INTO visonaut_snapshots(id,project_id,run_id,comparison_id,tested_sha,state,reference_eligible,prefix,created_at,storage_mode)
    VALUES('old-snapshot','project','old-run','old-comparison','${"a".repeat(40)}','accepted',1,'baselines/old/',1,'source');
    INSERT INTO visonaut_promotions(id,project_id,snapshot_id,comparison_id,baseline_revision,created_at)
    VALUES('old-promotion','project','old-snapshot','old-comparison',7,1);
    UPDATE visonaut_projects SET snapshot_id='old-snapshot',promotion_id='old-promotion' WHERE id='project';`);
  source.connection
    .prepare("INSERT INTO visonaut_capture_profiles(digest,profile_json) VALUES(?,?)")
    .run(profileDigest, JSON.stringify(profile));
  for (let index = 0; index < count; index++) {
    const bytes = new TextEncoder().encode(`baseline image ${index}`);
    const digest = await sha256(bytes);
    const objectKey = `runs/old-run/originals/${index}.png`;
    await images.put(objectKey, bytes, { httpMetadata: { contentType: "image/png" } });
    source.connection
      .prepare(
        "INSERT INTO visonaut_images(id,run_id,digest,object_key,content_type,bytes,width,height) VALUES(?,'old-run',?,?,'image/png',?,1,1)",
      )
      .run(`old-image-${index}`, digest, objectKey, bytes.length);
    source.connection
      .prepare(
        "INSERT INTO visonaut_captures(id,run_id,shard_key,item_key,variant_key,ordinal,image_id,profile_digest,test_id,test_retry,metadata_json) VALUES(?,'old-run','chromium',?,'light',?,?,?,'test',0,?)",
      )
      .run(
        `old-capture-${index}`,
        `item-${index}`,
        index,
        `old-image-${index}`,
        profileDigest,
        JSON.stringify({
          name: `item ${index}`,
          profile: { $visonautProfileDigest: profileDigest },
          variant: { key: "light", browser: "chromium" },
        }),
      );
    source.connection
      .prepare(
        "INSERT INTO visonaut_snapshot_images(snapshot_id,capture_id,image_id,object_key,digest,copied) VALUES('old-snapshot',?,?,?,?,1)",
      )
      .run(`old-capture-${index}`, `old-image-${index}`, objectKey, digest);
  }
  const context: ResetContext = {
    source,
    target,
    sourceImages: images,
    targetImages: images,
    sourceDatabaseId: "00000000-0000-0000-0000-000000000001",
    targetDatabaseId: "00000000-0000-0000-0000-000000000002",
    projectId: "project",
    now: () => 100,
  };
  return {
    context,
    source,
    target,
    images,
    expected: { snapshotId: "old-snapshot", baselineRevision: 7, testedSha: "a".repeat(40) },
    [Symbol.dispose]() {
      source[Symbol.dispose]();
      target[Symbol.dispose]();
    },
  };
}

async function compareSparseRun(
  state: Awaited<ReturnType<typeof fixture>>,
  baseline: CaptureInventory,
  input: { runId: string; testedSha: string; identities: string[]; changed?: string },
) {
  const service = new Service(state.target);
  const project = await service.project("project");
  const referenceCaptures: ReferenceCaptureInput[] = baseline.captures;
  const profileRecord = baseline.profiles[0];
  const profileCapture = baseline.captures[0];
  if (!profileRecord || !profileCapture) throw new Error("Missing fixture profile.");
  const profileDigest = profileRecord.digest;
  const planDigest = await digestJson(input);
  await service.reserveRun({
    id: input.runId,
    projectId: "project",
    externalRunId: input.runId,
    attempt: 1,
    kind: "main",
    testedSha: input.testedSha,
    lineageKey: "main",
    plan: {
      digest: planDigest,
      shards: [
        {
          key: "combined",
          profileDigest,
          tests: ["test"],
          captures: input.identities.map((itemKey) => ({
            itemKey,
            variantKey: "light",
            testId: "test",
          })),
        },
      ],
    },
    verifiedRelatedRunIds: [],
    verifiedAncestorShas: [baseline.testedSha],
    verificationDigest: "verified",
    rerunShardKeys: ["combined"],
    now: 200,
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
      captureCount: baseline.captures.length,
    },
    captures: [],
    removals: baseline.captures
      .filter((capture) => !input.identities.includes(capture.itemKey))
      .map(({ itemKey, variantKey }) => ({ itemKey, variantKey })),
  };
  const captures: InventoryCapture[] = [];
  for (const [ordinal, itemKey] of input.identities.entries()) {
    const reference = baseline.captures.find((capture) => capture.itemKey === itemKey);
    const changed = itemKey === input.changed || !reference;
    let image: ValidatedImage;
    if (changed) {
      const body = new TextEncoder().encode(`new original ${input.runId} ${itemKey}`);
      image = {
        id: await digestJson([input.runId, itemKey]),
        runId: input.runId,
        objectKey: `runs/${input.runId}/images/${ordinal}.png`,
        digest: await sha256(body),
        bytes: body.length,
        contentType: "image/png",
        width: 1,
        height: 1,
      };
      await state.images.put(image.objectKey, body);
      await service.registerImage(image);
    } else {
      if (!reference) throw new Error("Missing fixture reference.");
      image = reference.image;
    }
    const outcome = changed ? "changed" : "unchanged";
    captures.push({
      ...profileCapture,
      id: `capture-${input.runId}-${ordinal}`,
      itemKey,
      ordinal,
      imageId: image.id,
      image,
      metadata: {
        ...profileCapture.metadata,
        profile: profileRecord.profile,
        localMode: "local-v1",
        candidateStored: changed,
        observedImage: {
          path: `images/${ordinal}.png`,
          mediaType: image.contentType,
          digest: image.digest,
          bytes: image.bytes,
          width: image.width,
          height: image.height,
        },
        localResult: {
          outcome,
          changedPixels: changed ? 1 : 0,
          ratio: changed ? 1 : 0,
          maskExpected: false,
          engineVersion: LOCAL_COMPARISON_ENGINE,
          codecVersion: LOCAL_COMPARISON_CODEC,
        },
      },
    });
    receipt.captures.push({
      itemKey,
      variantKey: "light",
      candidateDigest: image.digest,
      referenceDigest: reference?.image.digest ?? null,
      outcome,
      changedPixels: changed ? 1 : 0,
      ratio: changed ? 1 : 0,
      sizeChanged: false,
    });
  }
  const inventory: CaptureInventory = {
    schemaVersion: "baseline-delta-v1",
    projectId: "project",
    runId: input.runId,
    testedSha: input.testedSha,
    referenceSnapshotId: project.snapshot_id,
    captures,
    profiles: [profileRecord],
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
        testedSha: input.testedSha,
        planDigest,
      },
      shard: { key: "combined", jobId: "789", sourceAttempt: 1 },
      profiles: [profileRecord],
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
  const pointer = await writeCaptureInventory(state.images, inventory);
  await service.commitShard({
    runId: input.runId,
    key: "combined",
    manifestDigest: "c".repeat(64),
    captures,
    inventory: pointer,
    imageRunIds: [...new Set(captures.map((capture) => capture.image.runId))],
    localReferenceSnapshotId: project.snapshot_id,
    finalTestOutcomes: [{ testId: "test", retry: 0, status: "passed" }],
    now: 201,
  });
  await service.sealRun({ runId: input.runId, now: 202 });
  const comparisonId = `comparison-${input.runId}`;
  await service.createComparison({
    id: comparisonId,
    runId: input.runId,
    referenceSnapshotId: project.snapshot_id,
    expectedBaselineRevision: project.baseline_revision,
    localComparison: receipt,
    referenceCaptures,
    now: 203,
  });
  await service.finalizeComparison({ comparisonId, now: 204 });
  return { service, comparisonId, inventory, pointer, project };
}

it("requires review when a removed imported identity returns with a different image", async () => {
  using state = await fixture();
  const prepared = await prepareReset(state.context, state.expected);
  await copyResetPage(state.context, { importId: prepared.importId, page: 0 });
  await activateReset(state.context, prepared.importId);
  const baseline = await readCaptureInventory(state.images, prepared.inventory);
  const removal = await compareSparseRun(state, baseline, {
    runId: "00000000-0000-0000-0000-000000000003",
    testedSha: "b".repeat(40),
    identities: ["item-1"],
  });
  expect(await removal.service.status(removal.inventory.runId)).toMatchObject({
    status: "passed",
    pending: 0,
  });
  const snapshotId = "removal-snapshot";
  await removal.service.preparePromotion({
    snapshotId,
    comparisonId: removal.comparisonId,
    prefix: "baselines/removal/",
    inventory: removal.pointer,
    imageRunIds: [...new Set(removal.inventory.captures.map((capture) => capture.image.runId))],
    now: 205,
  });
  await removal.service.recordInventoryVerification({
    snapshotId,
    objectKey: removal.pointer.objectKey,
    digest: removal.pointer.digest,
  });
  await removal.service.promote({
    snapshotId,
    promotionId: "removal-promotion",
    expectedBaselineRevision: removal.project.baseline_revision,
    now: 206,
  });
  const restored = await compareSparseRun(state, removal.inventory, {
    runId: "00000000-0000-0000-0000-000000000004",
    testedSha: "c".repeat(40),
    identities: ["item-0", "item-1"],
    changed: "item-0",
  });
  expect(await restored.service.status(restored.inventory.runId)).toMatchObject({
    status: "needs-review",
    pending: 1,
  });
  expect(await restored.service.comparisonRows(restored.comparisonId)).toEqual([
    expect.objectContaining({ item_key: "item-0", decision_id: null }),
  ]);
});

it("preserves CLI shard-prefixed source test IDs through baseline import and readback", async () => {
  using state = await fixture();
  const testIds = [
    "linux/08636fa1c499c43994f3-ac12060dba0c4211590c",
    "linux/08636fa1c499c43994f3-4305d4b5792be7897f14",
  ];
  for (const [index, testId] of testIds.entries()) {
    state.source.connection
      .prepare("UPDATE visonaut_captures SET test_id=? WHERE id=?")
      .run(testId, `old-capture-${index}`);
  }
  const prepared = await prepareReset(state.context, state.expected);
  await copyResetPage(state.context, { importId: prepared.importId, page: 0 });
  await activateReset(state.context, prepared.importId);
  const inventory = await readCaptureInventory(state.images, prepared.inventory);
  expect(inventory.captures.map((capture) => capture.testId)).toEqual(testIds);
  expect(
    state.source.connection.prepare("SELECT test_id FROM visonaut_captures ORDER BY ordinal").all(),
  ).toEqual(testIds.map((testId) => ({ test_id: testId })));
});

it("imports only project policy, baseline headers, and verified protected originals", async () => {
  using state = await fixture();
  state.source.connection.exec(
    "INSERT INTO visonaut_identity_history VALUES('project','main','old-removed','dark')",
  );
  const prepared = await prepareReset(state.context, state.expected);
  expect(prepared.captureCount).toBe(2);
  expect(
    state.target.connection.prepare("SELECT snapshot_id,fresh_setup FROM visonaut_projects").get(),
  ).toEqual({ snapshot_id: null, fresh_setup: 0 });
  expect(
    state.target.connection
      .prepare("SELECT reference_eligible,inventory_verified FROM visonaut_snapshots")
      .get(),
  ).toEqual({ reference_eligible: 0, inventory_verified: 0 });
  await copyResetPage(state.context, { importId: prepared.importId, page: 0 });
  await activateReset(state.context, prepared.importId);
  expect(
    state.target.connection
      .prepare("SELECT baseline_revision,fresh_setup FROM visonaut_projects")
      .get(),
  ).toEqual({ baseline_revision: 7, fresh_setup: 0 });
  expect(
    state.target.connection
      .prepare(
        "SELECT state,reference_eligible,inventory_verified,capture_count FROM visonaut_snapshots",
      )
      .get(),
  ).toEqual({ state: "accepted", reference_eligible: 1, inventory_verified: 1, capture_count: 2 });
  for (const table of [
    "visonaut_captures",
    "visonaut_snapshot_images",
    "visonaut_capture_profiles",
    "visonaut_comparison_rows",
    "visonaut_decisions",
    "user",
  ]) {
    expect(state.target.connection.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual(
      { count: 0 },
    );
  }
  const inventory = await readCaptureInventory(state.images, prepared.inventory);
  expect(inventory.captures.map((capture) => capture.itemKey)).toEqual(["item-0", "item-1"]);
  expect(inventory.profiles).toHaveLength(1);
  expect(inventory.manifest).toBeUndefined();
  expect(
    inventory.captures.every((capture) =>
      capture.image.objectKey.startsWith(`baselines/import/${prepared.importId}/`),
    ),
  ).toBe(true);
  expect(
    state.target.connection
      .prepare(
        "SELECT lineage_key,item_key,variant_key FROM visonaut_identity_history ORDER BY item_key",
      )
      .all(),
  ).toEqual([
    { lineage_key: "main", item_key: "item-0", variant_key: "light" },
    { lineage_key: "main", item_key: "item-1", variant_key: "light" },
  ]);
  expect(state.target.connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});

it("bounds each copy step and resumes prepare, copy, and activation without duplicate images", async () => {
  using state = await fixture(26);
  const prepared = await prepareReset(state.context, state.expected);
  expect(prepared.pages).toBe(2);
  expect(await prepareReset(state.context, state.expected)).toEqual(prepared);
  await copyResetPage(state.context, { importId: prepared.importId, page: 0 });
  expect(
    state.target.connection.prepare("SELECT count(*) AS count FROM visonaut_images").get(),
  ).toEqual({ count: 25 });
  await expect(activateReset(state.context, prepared.importId)).rejects.toThrow("Object missing");
  expect(
    state.target.connection
      .prepare("SELECT count(*) AS count FROM visonaut_identity_history")
      .get(),
  ).toEqual({ count: 0 });
  await copyResetPage(state.context, { importId: prepared.importId, page: 0 });
  await copyResetPage(state.context, { importId: prepared.importId, page: 1 });
  await activateReset(state.context, prepared.importId);
  expect(await activateReset(state.context, prepared.importId)).toEqual(prepared);
  expect(
    state.target.connection.prepare("SELECT count(*) AS count FROM visonaut_images").get(),
  ).toEqual({ count: 26 });
  expect(
    state.target.connection.prepare("SELECT count(*) AS count FROM visonaut_promotions").get(),
  ).toEqual({ count: 1 });
  await expect(
    copyResetPage(state.context, { importId: prepared.importId, page: 2 }),
  ).rejects.toThrow("outside");
});

it("resumes interrupted identity batches before exposing the imported baseline", async () => {
  using state = await fixture(26);
  const prepared = await prepareReset(state.context, state.expected);
  await copyResetPage(state.context, { importId: prepared.importId, page: 0 });
  await copyResetPage(state.context, { importId: prepared.importId, page: 1 });
  const batch = state.target.batch.bind(state.target);
  let identityBatches = 0;
  state.target.batch = async (statements) => {
    if (JSON.stringify(statements).includes("INSERT OR IGNORE INTO visonaut_identity_history")) {
      identityBatches++;
      if (identityBatches === 2) throw new Error("Interrupted identity import");
      expect(new TextEncoder().encode(JSON.stringify(statements)).byteLength).toBeLessThan(
        1024 * 1024,
      );
    }
    return batch(statements);
  };
  await expect(activateReset(state.context, prepared.importId)).rejects.toThrow(
    "Interrupted identity import",
  );
  expect(
    state.target.connection
      .prepare("SELECT count(*) AS count FROM visonaut_identity_history")
      .get(),
  ).toEqual({ count: 25 });
  expect(
    state.target.connection.prepare("SELECT snapshot_id,fresh_setup FROM visonaut_projects").get(),
  ).toEqual({ snapshot_id: null, fresh_setup: 0 });
  expect(
    state.target.connection.prepare("SELECT reference_eligible FROM visonaut_snapshots").get(),
  ).toEqual({ reference_eligible: 0 });
  await activateReset(state.context, prepared.importId);
  await activateReset(state.context, prepared.importId);
  expect(
    state.target.connection
      .prepare("SELECT count(*) AS count FROM visonaut_identity_history")
      .get(),
  ).toEqual({ count: 26 });
});

it("rejects extra identity facts instead of activating an incomplete baseline identity set", async () => {
  using state = await fixture();
  const prepared = await prepareReset(state.context, state.expected);
  await copyResetPage(state.context, { importId: prepared.importId, page: 0 });
  state.target.connection.exec(
    "INSERT INTO visonaut_identity_history VALUES('project','main','other','light')",
  );
  await expect(activateReset(state.context, prepared.importId)).rejects.toThrow();
  expect(
    state.target.connection.prepare("SELECT snapshot_id FROM visonaut_projects").get(),
  ).toEqual({ snapshot_id: null });
  expect(
    state.target.connection
      .prepare("SELECT inventory_verified,reference_eligible FROM visonaut_snapshots")
      .get(),
  ).toEqual({ inventory_verified: 0, reference_eligible: 0 });
});

it("bounds full-size and Unicode identity pages by UTF-8 bytes and row count", () => {
  for (const character of ["a", "😀"]) {
    const identities = Array.from({ length: 10_000 }, (_, index) => ({
      itemKey: `${index}${character.repeat(250)}`,
      variantKey: character.repeat(256),
    }));
    const pages = identityPages(identities);
    expect(pages.flatMap((page) => JSON.parse(page))).toEqual(identities);
    for (const page of pages) {
      expect(JSON.parse(page).length).toBeLessThanOrEqual(25);
      expect(new TextEncoder().encode(page).byteLength).toBeLessThanOrEqual(32 * 1024);
      // Each seed batch sends the bounded JSON twice, plus fixed guards and SQL.
      expect(new TextEncoder().encode(page).byteLength * 2 + 10 * 1024).toBeLessThan(1024 * 1024);
    }
  }
});

it("keeps inherited images available after old run cleanup and pins the imported owner", async () => {
  using state = await fixture();
  const prepared = await prepareReset(state.context, state.expected);
  await copyResetPage(state.context, { importId: prepared.importId, page: 0 });
  await state.images.delete(
    [...state.images.objects.keys()].filter((key) => key.startsWith("runs/old-run/")),
  );
  await activateReset(state.context, prepared.importId);
  const inventory = await readCaptureInventory(state.images, prepared.inventory);
  for (const capture of inventory.captures) {
    const image = await state.images.get(capture.image.objectKey);
    expect(image?.size).toBe(capture.image.bytes);
  }
  expect(() =>
    state.target.connection.prepare("UPDATE work_retained_runs SET byte_state='deleting'").run(),
  ).toThrow("Pinned run bytes");
});

it("rejects conflicting bindings and a target with existing project data", async () => {
  using state = await fixture();
  await expect(
    prepareReset(
      { ...state.context, targetDatabaseId: state.context.sourceDatabaseId },
      state.expected,
    ),
  ).rejects.toThrow("must differ");
  state.target.connection.exec(
    "INSERT INTO visonaut_projects(id,repository_id,policy_digest) VALUES('other','999','other-policy')",
  );
  await expect(prepareReset(state.context, state.expected)).rejects.toThrow("State changed");
  expect(state.target.connection.prepare("SELECT id FROM visonaut_projects").all()).toEqual([
    { id: "other" },
  ]);
});

it("rejects missing membership and a source baseline change before activation", async () => {
  using state = await fixture();
  state.source.connection.exec(
    "DELETE FROM visonaut_snapshot_images WHERE capture_id='old-capture-1'",
  );
  await expect(prepareReset(state.context, state.expected)).rejects.toThrow(
    "membership is incomplete",
  );
  state.source.connection.exec(
    "UPDATE visonaut_projects SET baseline_revision=8; UPDATE visonaut_promotions SET baseline_revision=8",
  );
  await expect(prepareReset(state.context, state.expected)).rejects.toThrow(
    "source baseline changed",
  );
});

it("does not activate a verified copy of a baseline that is no longer current", async () => {
  using state = await fixture();
  const prepared = await prepareReset(state.context, state.expected);
  await copyResetPage(state.context, { importId: prepared.importId, page: 0 });
  state.source.connection.exec(
    "UPDATE visonaut_projects SET baseline_revision=8; UPDATE visonaut_promotions SET baseline_revision=8",
  );
  await expect(activateReset(state.context, prepared.importId)).rejects.toThrow(
    "source baseline changed",
  );
  expect(
    state.target.connection.prepare("SELECT snapshot_id FROM visonaut_projects").get(),
  ).toEqual({ snapshot_id: null });
});

it("rejects corrupt source or destination bytes before recording a copy page", async () => {
  using state = await fixture();
  const prepared = await prepareReset(state.context, state.expected);
  await state.images.put("runs/old-run/originals/0.png", "corrupt");
  await expect(
    copyResetPage(state.context, { importId: prepared.importId, page: 0 }),
  ).rejects.toThrow("source original does not match");
  expect(
    state.target.connection.prepare("SELECT count(*) AS count FROM visonaut_images").get(),
  ).toEqual({ count: 0 });
  expect(state.images.objects.has(`baselines/import/${prepared.importId}/copies/0.json`)).toBe(
    false,
  );
});

it("rejects a conflicting existing image row without accepting its copy page", async () => {
  using state = await fixture();
  const prepared = await prepareReset(state.context, state.expected);
  await copyResetPage(state.context, { importId: prepared.importId, page: 0 });
  state.images.objects.delete(`baselines/import/${prepared.importId}/copies/0.json`);
  state.target.connection.exec("UPDATE visonaut_images SET bytes=bytes+1");
  await expect(
    copyResetPage(state.context, { importId: prepared.importId, page: 0 }),
  ).rejects.toThrow("State changed");
  expect(state.images.objects.has(`baselines/import/${prepared.importId}/copies/0.json`)).toBe(
    false,
  );
});

it("imports and activates through native local D1 bindings", async () => {
  using state = await fixture(26);
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('baseline reset'); } }",
      compatibilityDate: "2026-09-22",
      d1Databases: ["SOURCE_DB", "TARGET_DB"],
    }),
  );
  try {
    const source = await runtime.getD1Database("SOURCE_DB");
    const target = await runtime.getD1Database("TARGET_DB");
    await applyTestMigrations(source, { through: "0033_d1_upload_evidence" });
    await applyTestMigrations(target);
    for (const table of [
      "visonaut_policies",
      "visonaut_projects",
      "visonaut_runs",
      "visonaut_shards",
      "visonaut_capture_profiles",
      "visonaut_images",
      "visonaut_captures",
      "visonaut_snapshots",
      "visonaut_snapshot_images",
      "visonaut_comparisons",
      "visonaut_promotions",
    ]) {
      for (const row of state.source.connection.prepare(`SELECT * FROM ${table}`).all()) {
        const columns = Object.keys(row);
        await source
          .prepare(
            `INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
          )
          .bind(...Object.values(row))
          .run();
      }
    }
    const context = { ...state.context, source, target };
    const prepared = await prepareReset(context, state.expected);
    await state.images.put("runs/old-run/originals/0.png", "corrupt");
    await expect(copyResetPage(context, { importId: prepared.importId, page: 0 })).rejects.toThrow(
      "source original does not match",
    );
    expect(
      await target.prepare("SELECT count(*) AS count FROM visonaut_identity_history").first(),
    ).toEqual({ count: 0 });
    expect(
      await target.prepare("SELECT snapshot_id,fresh_setup FROM visonaut_projects").first(),
    ).toEqual({ snapshot_id: null, fresh_setup: 0 });
    await state.images.put("runs/old-run/originals/0.png", "baseline image 0");
    await copyResetPage(context, { importId: prepared.importId, page: 0 });
    await copyResetPage(context, { importId: prepared.importId, page: 1 });
    await activateReset(context, prepared.importId);
    expect(await activateReset(context, prepared.importId)).toEqual(prepared);
    expect(
      (
        await target
          .prepare("SELECT capture_count,inventory_verified FROM visonaut_snapshots")
          .all()
      ).results,
    ).toEqual([{ capture_count: 26, inventory_verified: 1 }]);
    expect(
      await target
        .prepare("SELECT count(*) AS count FROM visonaut_identity_history WHERE lineage_key='main'")
        .first(),
    ).toEqual({ count: 26 });
    expect((await target.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
    const inventory = await readCaptureInventory(state.images, prepared.inventory);
    expect(uuid(inventory.runId)).toBe(inventory.runId);
    const images: ObjectStorage = {
      async get(key) {
        const stored = await state.images.get(key);
        const bytes = state.images.objects.get(key)?.bytes;
        if (!stored || !bytes) return null;
        return {
          size: stored.size,
          body: stored.body,
          async arrayBuffer() {
            return Uint8Array.from(bytes).buffer;
          },
        };
      },
      async head(key) {
        const bytes = state.images.objects.get(key)?.bytes;
        return bytes ? { size: bytes.length, checksums: {} } : null;
      },
      async list(options) {
        const page = await state.images.list(options);
        return { ...page, objects: page.objects.map((object) => ({ ...object, checksums: {} })) };
      },
      put: (key, value, options) => state.images.put(key, value, options),
      delete: (key) => state.images.delete(key),
    };
    const origin = "https://visonaut.test";
    const bindings: ApiBindings = {
      database: target,
      images,
      quarantine: images,
      comparator: { fetch },
      operations: { async send() {} },
      configuration: {
        origin,
        projectId: "project",
        repositoryOwnerId: "1",
        webhookSecret: "unused",
        auth: {
          origin,
          environment: "preview",
          secret: "a".repeat(32),
          githubClientId: "unused",
          githubClientSecret: "unused",
        },
        capability: { issuer: origin, environment: "preview", secret: "b".repeat(32) },
        github: {
          appId: "1",
          privateKey: "unused",
          installationId: "1",
          repositoryId: "123",
          repository: "owner/repo",
        },
        limits: {
          maximumImageBytes: 1024,
          maximumShardBytes: 1024,
          maximumManifestBytes: 1024 * 1024,
          maximumPlanBytes: 1024 * 1024,
          maximumCaptures: 100,
        },
      },
    };
    const api = apiContext(bindings);
    const privateContext: PrivateContext = {
      ...api,
      identity: {
        githubUserId: "1",
        login: "operator",
        role: "admin",
        userId: "user",
        sessionId: "session",
        sessionHeaders: new Headers(),
      },
      lifetime: { waitUntil() {} },
    };
    const review = parseReviewModel(await reviewModel(privateContext, inventory.runId));
    expect(review.items).toEqual([]);
    expect(review.archived).toBe(true);
    expect(review.readOnlyReason).toContain("imported");

    const capture = inventory.captures[0];
    if (!capture) throw new Error("Missing imported API capture fixture.");
    expect(capture.image.id).toMatch(/^[a-f0-9]{64}$/u);
    const publicResponse = await publicImage(
      new Request(`${origin}/images/${capture.image.id}`),
      api,
      capture.image.id,
    );
    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.text()).toBe("baseline image 0");
    const publicRoute = await handleApi(
      new Request(`${origin}/images/${capture.image.id}`),
      bindings,
      { waitUntil() {} },
    );
    expect(publicRoute?.status).toBe(200);
    expect(await publicRoute?.text()).toBe("baseline image 0");
    const callerId = crypto.randomUUID();
    const snapshotId = `baseline-import:${prepared.importId}:snapshot`;
    const snapshot = await target
      .prepare("SELECT inventory_digest FROM visonaut_snapshots WHERE id=?")
      .bind(snapshotId)
      .first<{ inventory_digest: string }>();
    if (!snapshot) throw new Error("Missing imported snapshot fixture.");
    // The reference that a reserve call stores for a run with this baseline.
    const reference = {
      snapshotId,
      baselineRevision: state.expected.baselineRevision,
      digest: snapshot.inventory_digest,
      pages: 1,
      captureCount: inventory.captures.length,
    };
    const verified = JSON.stringify({ event: "push", localReference: reference });
    const planDigest = "e".repeat(64);
    await target
      .prepare(`INSERT INTO ingest_staged_runs(id,repository_id,workflow_run_id,workflow_attempt,
      tested_sha,workflow_source_digest,caller_workflow_path,reusable_workflow_ref,capture_job_prefix,
      submit_job_name,verified_json,created_at) VALUES(?,'123','222',1,?,?,'ci.yml','main','Capture','Submit',?,?)`)
      .bind(callerId, state.expected.testedSha, planDigest, verified, Date.now())
      .run();
    await target
      .prepare(
        "INSERT INTO ingest_staged_bundles(run_id,job_id,check_run_id,shard_key,job_name,verified_json,created_at) VALUES(?,'333','333','combined','Capture','{}',?)",
      )
      .bind(callerId, Date.now())
      .run();
    const page = parseCapturePage(
      await (
        await referencePage({
          context: api,
          run: { id: callerId, tested_sha: state.expected.testedSha, verified_json: verified },
          digest: reference.digest,
          page: 1,
        })
      ).json(),
    );
    expect(page.rows).toHaveLength(inventory.captures.length);
    const row = page.rows[0];
    if (!row) throw new Error("Missing imported reference API fixture.");
    const entry = await captureRowView(page, row);
    const token = await issueIngestCapability(bindings.configuration.capability, {
      runId: callerId,
      repositoryId: "123",
      workflowRunId: "222",
      workflowAttempt: 1,
      testedSha: state.expected.testedSha,
      planDigest,
      shardKey: "combined",
      jobId: "333",
      maximumBytes: 1024,
      maximumImages: 100,
    });
    const referenceResponse = await handleApi(
      new Request(`${origin}${TRANSPORT.referenceImage(callerId, entry.image.digest)}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      bindings,
      { waitUntil() {} },
    );
    expect(referenceResponse?.status).toBe(200);
    expect(await referenceResponse?.text()).toBe("baseline image 0");
  } finally {
    await runtime.dispose();
  }
});

it("imports protected legacy baseline copies when old source bytes are already gone", async () => {
  using state = await fixture();
  state.source.connection.exec(
    "UPDATE visonaut_snapshots SET storage_mode='protected'; UPDATE visonaut_images SET bytes_present=0;",
  );
  for (let index = 0; index < 2; index++) {
    const bytes = new TextEncoder().encode(`baseline image ${index}`);
    await state.images.put(`baselines/old/${index}.png`, bytes);
    state.source.connection
      .prepare("UPDATE visonaut_snapshot_images SET object_key=? WHERE capture_id=?")
      .run(`baselines/old/${index}.png`, `old-capture-${index}`);
  }
  await state.images.delete(
    [...state.images.objects.keys()].filter((key) => key.startsWith("runs/old-run/")),
  );
  const prepared = await prepareReset(state.context, state.expected);
  await copyResetPage(state.context, { importId: prepared.importId, page: 0 });
  await activateReset(state.context, prepared.importId);
  expect(
    state.target.connection
      .prepare("SELECT count(*) AS count FROM visonaut_images WHERE bytes_present=1")
      .get(),
  ).toEqual({ count: 2 });
});

it("rejects a corrupt destination original without overwriting it or writing a receipt", async () => {
  using state = await fixture();
  const prepared = await prepareReset(state.context, state.expected);
  const inventory = await readCaptureInventory(state.images, prepared.inventory);
  const capture = inventory.captures[0];
  if (!capture) throw new Error("Missing imported capture fixture.");
  await state.images.put(capture.image.objectKey, "corrupt destination");
  await expect(
    copyResetPage(state.context, { importId: prepared.importId, page: 0 }),
  ).rejects.toThrow("copied original does not match");
  expect(state.images.objects.has(`baselines/import/${prepared.importId}/copies/0.json`)).toBe(
    false,
  );
  expect(
    state.target.connection.prepare("SELECT count(*) AS count FROM visonaut_images").get(),
  ).toEqual({ count: 0 });
});

it("measures one object page by prefix without reading or changing object bytes", async () => {
  const store = new MemoryStore();
  await store.put("runs/old/a", "123");
  await store.put("runs/old/b", "45678");
  await store.put("runs/new/a", "keep");
  const first = await listResetObjects(store, { prefix: "runs/old/", limit: 1 });
  expect(first).toEqual({
    prefix: "runs/old/",
    objects: [{ key: "runs/old/a", bytes: 3 }],
    count: 1,
    bytes: 3,
    truncated: true,
    nextCursor: "runs/old/a",
  });
  const second = await listResetObjects(store, {
    prefix: "runs/old/",
    limit: 1,
    cursor: first.nextCursor ?? undefined,
  });
  expect(second).toMatchObject({ count: 1, bytes: 5, truncated: false, nextCursor: null });
  expect(store.objects.size).toBe(3);
  await expect(listResetObjects(store, { prefix: "", limit: 1001 })).rejects.toThrow(
    "between 1 and 1000",
  );
});
