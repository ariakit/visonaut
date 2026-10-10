import {
  digestJson,
  FIXED_DIGEST,
  sha256,
  type CapturePageTest,
  type CaptureRowImage,
} from "@visonaut/protocol";
import { createGitHubClient, SecurityError } from "@visonaut/security";
import {
  ConflictError,
  IncompleteError,
  maximumImageRegistrationBatchSize,
  type RunRow,
  type ValidatedImage,
} from "@visonaut/service";
import { storeCaptureProfiles } from "../profiles.ts";
import { recordEvent, resolveEvents } from "../operations/common.ts";
import { assertConfiguredProject, type ApiContext } from "./context.js";
import { verifyAncestry, finalizeSubmittedComparison } from "./ingest.js";
import {
  comparisonReceipt,
  comparisonSettingsCounts,
  currentReference,
  referenceCaptureInputs,
  validateAdmittedMainReference,
  validateRunPages,
} from "./local-comparison.ts";
import { readCaptureInventory, writeCapturePages } from "../capture-inventory.ts";
import { encodeCapturePages, type CapturePagesInput } from "../capture-pages.ts";
import { inventoryPointer, readInventoryIndex, readRunInventory } from "../inventory-records.ts";
import { workflowAttempt } from "./jobs.js";
import { relatedRunEvidence } from "./lineage.js";
import { findPreRunCheck, requireVisualPlan } from "./pre-run.js";
import { reconcileWorkflowJobSet, type ReconciledBundle } from "./workflow-reconcile.js";
import { stagedAttemptRetentionMs, stagedMaterializationLeaseMs } from "./workflow-retention.js";
import { evidenceImages, readStagedPages, runPageImages } from "./workflow-evidence.ts";
import { afterRestoreSql } from "../operations/recovery.ts";

interface StagedImage {
  digest: string;
  media_type: "image/png" | "image/webp";
  bytes: number;
  width: number;
  height: number;
  image_id: string;
  object_key: string;
  complete: number;
}

interface StagedObjectMetadata {
  size: number;
  sha256?: ArrayBuffer;
}

interface MaterializationMeasurements {
  imageCount: number;
  imageBytes: number;
  registrationBatches: number;
  verificationMs: number;
  registrationMs: number;
  shardCommitMs: number;
}

interface MaterializeImagesParams {
  context: ApiContext;
  runId: string;
  bundle: ReconciledBundle;
  /** The images that the job uploaded: each new or changed capture, and each mask. */
  uploads: ReadonlyMap<string, CaptureRowImage>;
  /** The digest of the image of each row. Each other upload is a mask. */
  originals: ReadonlyMap<string, number>;
  currentRunImages: ReadonlyMap<string, StagedObjectMetadata>;
  measurements: MaterializationMeasurements;
}

interface MaterializeBundleParams {
  context: ApiContext;
  run: RunRow;
  bundle: ReconciledBundle;
  proof: string;
  currentRunImages: ReadonlyMap<string, StagedObjectMetadata>;
  measurements: MaterializationMeasurements;
}

/** Distinguish lost validated bytes from retryable GitHub or D1 failures. */
class StagedOriginalUnavailableError extends IncompleteError {}

// Six R2 operations match the Worker connection limit; batches stay byte-bounded.
const maximumMaterializationReads = 6;
const maximumMaterializationReadBytes = 8 * 1024 * 1024;
// R2 accepts at most 1,000 objects per list request.
const maximumR2ListPageSize = 1000;

function hexChecksum(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function listCurrentRunImages(context: ApiContext, runId: string) {
  const images = new Map<string, StagedObjectMetadata>();
  let cursor: string | undefined;
  while (true) {
    const page = await context.images.list({
      prefix: `runs/${runId}/images/`,
      limit: maximumR2ListPageSize,
      cursor,
    });
    for (const image of page.objects) {
      images.set(image.key, { size: image.size, sha256: image.checksums.sha256 });
    }
    if (!page.truncated) {
      return images;
    }
    if (!page.cursor || page.cursor === cursor) {
      throw new IncompleteError("The staged image inventory is incomplete.");
    }
    cursor = page.cursor;
  }
}

export function materializationBatchEnd(images: readonly { bytes: number }[], offset: number) {
  let end = offset;
  let batchBytes = 0;
  while (end < images.length && end - offset < maximumMaterializationReads) {
    const image = images[end];
    if (!image) throw new IncompleteError("The validated staged image set changed.");
    // A single image remains a batch when its declared size exceeds the cap.
    if (end > offset && batchBytes + image.bytes > maximumMaterializationReadBytes) break;
    batchBytes += image.bytes;
    end += 1;
  }
  return end;
}

async function leaseStagedSources(context: ApiContext, stagedRunId: string) {
  const target = await context.database
    .prepare(
      `SELECT repository_id, workflow_run_id, workflow_attempt, tested_sha, workflow_source_digest, created_at FROM ingest_staged_runs WHERE id = ? AND retention_state = 'live' AND submitted_at IS NOT NULL AND ${afterRestoreSql("ingest_staged_runs.created_at")}`,
    )
    .bind(stagedRunId)
    .first<{
      repository_id: string;
      workflow_run_id: string;
      workflow_attempt: number;
      tested_sha: string;
      workflow_source_digest: string;
      created_at: number;
    }>();
  if (!target || target.repository_id !== context.configuration.github.repositoryId) {
    throw new IncompleteError("The submitted workflow stage is unavailable.");
  }
  const now = Date.now();
  if (target.created_at <= now - stagedAttemptRetentionMs) {
    throw new IncompleteError("The submitted workflow stage expired before conversion.");
  }
  await context.database
    .prepare(
      "UPDATE ingest_staged_runs SET materialization_lease_until = MAX(COALESCE(materialization_lease_until, 0), ?) WHERE id = ? AND retention_state = 'live' AND submitted_at IS NOT NULL",
    )
    .bind(now + stagedMaterializationLeaseMs, stagedRunId)
    .run();
}

async function materializeImages({
  context,
  runId,
  bundle,
  uploads,
  originals,
  currentRunImages,
  measurements,
}: MaterializeImagesParams) {
  if (bundle.sourceRunId !== runId) {
    throw new IncompleteError("Submit must upload a fresh combined bundle for this attempt.");
  }
  const images = await evidenceImages(context, bundle.sourceRunId, bundle.jobId);
  if (images.length !== uploads.size) {
    throw new IncompleteError("The validated staged image set changed.");
  }
  const imageRecords = new Map<string, ValidatedImage>();
  const pending: ValidatedImage[] = [];
  const registerPending = async () => {
    if (!pending.length) return;
    const batch = pending.slice();
    const started = performance.now();
    await context.service.registerImages(batch);
    measurements.registrationMs += performance.now() - started;
    measurements.registrationBatches += 1;
    for (const image of batch) {
      imageRecords.set(image.digest, image);
    }
    pending.length = 0;
  };
  const verifyImage = async (image: StagedImage) => {
    const declared = uploads.get(image.digest);
    if (
      !declared ||
      image.complete !== 1 ||
      image.media_type !== "image/png" ||
      image.bytes !== declared.bytes ||
      image.width !== declared.width ||
      image.height !== declared.height
    ) {
      throw new IncompleteError("A staged image differs from its validated page.");
    }
    // R2 checksums come from a validated PUT; older objects still need a body check.
    const metadata = currentRunImages.get(image.object_key);
    const checksum = metadata?.sha256;
    if (metadata?.size === image.bytes && checksum && hexChecksum(checksum) === image.digest) {
      return image;
    }
    const stored = await context.images.get(image.object_key);
    if (!stored || stored.size !== image.bytes) {
      throw new StagedOriginalUnavailableError("A validated original image is unavailable.");
    }
    const bytes = new Uint8Array(await stored.arrayBuffer());
    if ((await sha256(bytes)) !== image.digest) {
      throw new StagedOriginalUnavailableError("A validated original image changed after upload.");
    }
    return image;
  };
  for (let offset = 0; offset < images.length;) {
    const end = materializationBatchEnd(images, offset);
    const verificationStarted = performance.now();
    const results = await Promise.allSettled(images.slice(offset, end).map(verifyImage));
    measurements.verificationMs += performance.now() - verificationStarted;
    const verified: StagedImage[] = [];
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
      verified.push(result.value);
    }
    // Register only after every image in the bounded batch passes verification.
    for (const image of verified) {
      pending.push({
        id: image.image_id,
        runId,
        digest: image.digest,
        objectKey: image.object_key,
        contentType: image.media_type,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        ...(originals.has(image.digest) ? {} : { role: "mask" as const }),
      });
      measurements.imageCount += 1;
      measurements.imageBytes += image.bytes;
      if (pending.length === maximumImageRegistrationBatchSize) {
        await registerPending();
      }
    }
    offset = end;
  }
  await registerPending();
  return imageRecords;
}

/**
 * Store the capture list of a run from the staged pages of its Submit job, and
 * commit its one shard. The result is the count of its captures.
 */
async function materializeBundle({
  context,
  run,
  bundle,
  proof,
  currentRunImages,
  measurements,
}: MaterializeBundleParams) {
  const { index } = bundle;
  await currentReference(context, index.reference, run.kind === "pull_request");
  const references = await referenceCaptureInputs(context, index.reference.snapshotId);
  const pages = await readStagedPages({
    context,
    runId: bundle.sourceRunId,
    jobId: bundle.jobId,
    index,
  });
  const kept = await validateRunPages(pages, references);
  const { uploads, originals, declaredBytes, captureCount } = runPageImages(pages);
  const imageRecords = await materializeImages({
    context,
    runId: run.id,
    bundle,
    uploads,
    originals,
    currentRunImages,
    measurements,
  });
  const shardCommitStarted = performance.now();
  const input: CapturePagesInput = {
    projectId: run.project_id,
    runId: run.id,
    testedSha: run.tested_sha,
    referenceSnapshotId: index.reference.snapshotId,
    // The index of the Submit job is the receipt of a run in pages.
    receipt: index,
    pages: pages.map((page, pageAt) => ({
      page,
      images: page.rows.map((row, rowAt) => {
        const [, , , , , , , digest, , , , result] = row;
        // An unchanged capture keeps the image of its reference.
        const image = kept[pageAt]?.[rowAt]?.image ?? imageRecords.get(digest);
        const mask = typeof result === "object" ? result.mask : undefined;
        const maskImageId = mask ? imageRecords.get(mask.digest)?.id : undefined;
        if (!image || (mask && !maskImageId)) {
          throw new IncompleteError("A capture lost its validated image.");
        }
        return maskImageId ? { image, maskImageId } : { image };
      }),
    })),
  };
  let inventory = inventoryPointer(run);
  if (inventory) {
    // An earlier try stored the pages. The same pages and images give the same
    // index, so its digest proves the committed capture list.
    const { pointer } = await encodeCapturePages(input);
    if (
      pointer.objectKey !== inventory.objectKey ||
      pointer.digest !== inventory.digest ||
      pointer.bytes !== inventory.bytes ||
      pointer.captureCount !== inventory.captureCount
    ) {
      throw new IncompleteError("The committed inventory differs from the verified submission.");
    }
  } else {
    inventory = await writeCapturePages(context.images, input);
  }
  // The committed capture list, with the complete validation.
  const { captures, profiles } = await readCaptureInventory(context.images, inventory);
  const changedProfiles = new Set(
    captures
      .filter((capture) => {
        const localResult = capture.metadata.localResult;
        return (
          localResult !== null &&
          typeof localResult === "object" &&
          Object.hasOwn(localResult, "outcome") &&
          Reflect.get(localResult, "outcome") === "changed"
        );
      })
      .map((capture) => capture.profileDigest),
  );
  await storeCaptureProfiles(
    context.database,
    profiles.filter((profile) => changedProfiles.has(profile.digest)),
  );
  // One test can have captures on two pages.
  const tests = new Map<string, CapturePageTest>();
  for (const page of pages) {
    for (const test of page.tests) {
      if (!tests.has(test.id)) {
        tests.set(test.id, test);
      }
    }
  }
  await context.service.commitShard({
    runId: run.id,
    key: bundle.key,
    manifestDigest: bundle.manifestDigest,
    captures,
    inventory,
    imageRunIds: [...new Set(captures.map((capture) => capture.image.runId))],
    localReferenceSnapshotId: index.reference.snapshotId,
    verifiedDiscovery: {
      executorDigest: FIXED_DIGEST,
      configurationDigest: FIXED_DIGEST,
      inventoryDigest: await digestJson(
        [...tests.values()].map(({ id, file, titlePath }) => ({ id, file, titlePath })),
      ),
      verificationDigest: await digestJson({ proof, receipt: bundle.evidence }),
      jobId: bundle.jobId,
      externalRunId: run.external_run_id,
      attempt: bundle.sourceAttempt,
      testedSha: run.tested_sha,
      tests: [...tests.keys()],
      captures: captures.map(({ itemKey, variantKey, testId }) => ({
        itemKey,
        variantKey,
        testId,
      })),
    },
    // A capture job sends a capture only for a test that passed.
    finalTestOutcomes: [...tests.values()].map((test) => ({
      testId: test.id,
      retry: test.retry,
      status: "passed" as const,
    })),
    now: Date.now(),
  });
  await context.database
    .prepare(
      "INSERT INTO ingest_manifests (run_id, shard_key, digest, object_key, job_id, capture_count, declared_bytes, finalized, created_at, storage_version) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1) ON CONFLICT(run_id, shard_key) DO NOTHING",
    )
    .bind(
      run.id,
      bundle.key,
      bundle.manifestDigest,
      bundle.manifestObjectKey,
      bundle.jobId,
      captureCount,
      declaredBytes,
      Date.now(),
    )
    .run();
  const stored = await context.database
    .prepare(
      "SELECT digest, object_key, job_id, capture_count, declared_bytes, finalized, storage_version FROM ingest_manifests WHERE run_id = ? AND shard_key = ?",
    )
    .bind(run.id, bundle.key)
    .first<{
      digest: string;
      object_key: string;
      job_id: string;
      capture_count: number;
      declared_bytes: number;
      finalized: number;
      storage_version: number;
    }>();
  if (
    stored?.digest !== bundle.manifestDigest ||
    stored.object_key !== bundle.manifestObjectKey ||
    stored.storage_version !== 1 ||
    stored.capture_count !== captureCount ||
    stored.job_id !== bundle.jobId ||
    stored.declared_bytes !== declaredBytes ||
    stored.finalized !== 1
  ) {
    throw new IncompleteError("The committed shard manifest changed.");
  }
  measurements.shardCommitMs += performance.now() - shardCommitStarted;
  return captureCount;
}

/**
 * Make the comparison of a sealed run from its stored page index and its
 * committed capture list. Materialization released its lists before this, and
 * a retry after the seal takes the same path.
 */
async function committedComparison(context: ApiContext, run: RunRow) {
  const pointer = inventoryPointer(run);
  const index = pointer
    ? await readInventoryIndex(
        context,
        { ...pointer, runId: run.id, projectId: run.project_id, testedSha: run.tested_sha },
        "complete",
      )
    : null;
  const inventory = await readRunInventory(context, run);
  const reference = index?.receipt?.reference;
  if (!inventory || !reference) {
    throw new IncompleteError(
      "The durable Submit receipt is unavailable. Capture and submit a new complete run.",
    );
  }
  await currentReference(context, reference, run.kind === "pull_request");
  const references = await referenceCaptureInputs(context, reference.snapshotId);
  return context.service.createComparison({
    id: crypto.randomUUID(),
    runId: run.id,
    referenceSnapshotId: reference.snapshotId,
    expectedBaselineRevision: reference.baselineRevision,
    localComparison: comparisonReceipt({ captures: inventory.captures, reference, references }),
    referenceCaptures: references,
    settings: comparisonSettingsCounts(inventory.captures, references),
    now: Date.now(),
  });
}

/** Build a service run only from the final complete GitHub matrix and staged evidence. */
export async function materializeWorkflowRun(context: ApiContext, stagedRunId: string) {
  await assertConfiguredProject(context);
  const identity = await context.database
    .prepare(
      `SELECT tested_sha,workflow_run_id,workflow_attempt FROM ingest_staged_runs WHERE id=? AND ${afterRestoreSql("ingest_staged_runs.created_at")}`,
    )
    .bind(stagedRunId)
    .first<{ tested_sha: string; workflow_run_id: string; workflow_attempt: number }>();
  if (!identity) throw new IncompleteError("The staged workflow identity is unavailable.");
  await requireVisualPlan(context, {
    testedSha: identity.tested_sha,
    workflowRunId: identity.workflow_run_id,
    workflowAttempt: identity.workflow_attempt,
  });
  const alreadyStored = await context.database
    .prepare("SELECT id FROM visonaut_runs WHERE id = ?")
    .bind(stagedRunId)
    .first<{ id: string }>();
  const previous = alreadyStored ? await context.service.run(stagedRunId) : null;
  if (previous) {
    if (previous.sealed_at !== null) {
      if (previous.active && !previous.comparison_id) {
        const comparison = await committedComparison(context, previous);
        await finalizeSubmittedComparison(context, comparison.id);
      }
      if (previous.active && previous.comparison_id)
        await finalizeSubmittedComparison(context, previous.comparison_id);
      await resolveEvents(
        context.database,
        "staged-reconciliation",
        `${previous.external_run_id}:${previous.attempt}`,
        Date.now(),
      );
      return context.service.run(previous.id);
    }
    if (!previous.active || previous.state === "failed") {
      throw new IncompleteError("The incomplete workflow run can no longer be converted.");
    }
  }
  const started = performance.now();
  const measurements: MaterializationMeasurements = {
    imageCount: 0,
    imageBytes: 0,
    registrationBatches: 0,
    verificationMs: 0,
    registrationMs: 0,
    shardCommitMs: 0,
  };
  await leaseStagedSources(context, stagedRunId);
  // Stored reference staleness survives a later change of the configuration.
  if (
    previous?.kind === "main" &&
    previous.state === "uploading" &&
    previous.project_id === context.configuration.projectId
  ) {
    await validateAdmittedMainReference(context, previous.id);
  }
  const {
    run: staged,
    submit,
    bundles,
    jobSetDigest,
  } = await reconcileWorkflowJobSet(context, stagedRunId);
  const reconciledAt = performance.now();
  const github = await createGitHubClient(context.configuration.github);
  const lineage = await relatedRunEvidence(context, github, submit);
  const ancestors = await verifyAncestry(context, github, submit.testedSha);
  const precreatedCheck = await findPreRunCheck(context, github, {
    testedSha: submit.testedSha,
    workflowRunId: staged.workflow_run_id,
    workflowAttempt: staged.workflow_attempt,
  });
  const proof = await digestJson({ submit, jobSetDigest, lineage: lineage.proof });
  if (bundles.length !== 1 || bundles[0]?.key !== "combined") {
    throw new IncompleteError("Local comparison must admit one complete combined Submit bundle.");
  }
  // A page index names no executor and no configuration: the signed Submit job
  // is the one producer. So the plan has the fixed digest for the two values.
  const executorDigest = FIXED_DIGEST;
  const plan = {
    digest: jobSetDigest,
    shards: await Promise.all(
      bundles.map(async (bundle) => ({
        key: bundle.key,
        profileDigest: await digestJson({ environmentProfilePolicy: "measured" }),
        environmentProfilePolicy: "measured" as const,
        sourceAttempt: bundle.sourceAttempt,
        discovery: { executorDigest, configurationDigest: FIXED_DIGEST },
        tests: [],
        captures: [],
      })),
    ),
  };
  const lineageKey =
    submit.event === "push" || submit.event === "workflow_dispatch"
      ? "main"
      : submit.event === "pull_request"
        ? `pr:${submit.pullRequestNumber}`
        : `merge:${submit.testedSha}`;
  const reservation = {
    id: staged.id,
    projectId: context.configuration.projectId,
    externalRunId: staged.workflow_run_id,
    attempt: staged.workflow_attempt,
    kind:
      submit.event === "workflow_dispatch" || submit.event === "push"
        ? ("main" as const)
        : submit.event,
    testedSha: staged.tested_sha,
    lineageKey,
    plan,
    verifiedRelatedRunIds: lineage.runIds,
    verifiedAncestorShas: ancestors,
    verificationDigest: proof,
    rerunShardKeys: bundles.map((bundle) => bundle.key),
    precreatedCheck,
    now: Date.now(),
  };
  // The provenance row holds the plan evidence. Its key names that D1 record,
  // and storage version 2 tells each reader that no R2 document has this key.
  const planObjectKey = `d1:provenance/${staged.id}/${jobSetDigest}`;
  const liveStage = await context.database
    .prepare("SELECT id FROM ingest_staged_runs WHERE id = ? AND retention_state = 'live'")
    .bind(staged.id)
    .first<{ id: string }>();
  if (!liveStage) {
    throw new IncompleteError("The staged workflow expired before conversion.");
  }
  let run: RunRow;
  try {
    const admission = await context.admission?.(reservation);
    run = await context.service.reserveRun({ ...reservation, ...admission });
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    const concurrent = await context.database
      .prepare(
        "SELECT id FROM visonaut_runs WHERE project_id = ? AND external_run_id = ? AND attempt = ?",
      )
      .bind(reservation.projectId, reservation.externalRunId, reservation.attempt)
      .first<{ id: string }>();
    if (!concurrent) {
      await context.admission?.(reservation);
      throw error;
    }
    run = await context.service.reserveRun(reservation);
  }
  await context.database
    .prepare(
      "INSERT INTO ingest_run_provenance (run_id, verified_json, plan_object_key, created_at, storage_version) VALUES (?, ?, ?, ?, 2) ON CONFLICT(run_id) DO NOTHING",
    )
    .bind(
      run.id,
      JSON.stringify({
        ...submit,
        workflowSourceDigest: staged.workflow_source_digest,
        callerWorkflowPath: staged.caller_workflow_path,
        bundles: bundles.map(({ key, sourceAttempt, jobId, manifestDigest }) => ({
          key,
          sourceAttempt,
          jobId,
          manifestDigest,
        })),
        lineageProof: lineage.proof,
        reusableWorkflowRef: staged.reusable_workflow_ref,
        executorDigest,
        jobSetDigest,
      }),
      planObjectKey,
      Date.now(),
    )
    .run();
  if (!run.active) {
    throw new IncompleteError("The workflow attempt was superseded before conversion.");
  }
  const reservedAt = performance.now();
  const inventoryStarted = performance.now();
  const currentRunImages = await listCurrentRunImages(context, run.id);
  measurements.verificationMs += performance.now() - inventoryStarted;
  let captureCount = 0;
  for (const bundle of bundles) {
    captureCount += await materializeBundle({
      context,
      run,
      bundle,
      proof,
      currentRunImages,
      measurements,
    });
  }
  const materializedAt = performance.now();
  const current = await workflowAttempt(github, submit);
  if (current.path !== staged.caller_workflow_path) {
    throw new IncompleteError("The workflow attempt changed before sealing.");
  }
  const checkedAt = performance.now();
  const sealTimestamp = Date.now();
  await context.service.sealRun({ runId: run.id, now: sealTimestamp });
  const sealedAt = performance.now();
  console.info(
    JSON.stringify({
      event: "workflow_materialized",
      runId: run.id,
      workflowRunId: staged.workflow_run_id,
      attempt: staged.workflow_attempt,
      bundles: bundles.length,
      captures: captureCount,
      images: measurements.imageCount,
      imageBytes: measurements.imageBytes,
      registrationBatches: measurements.registrationBatches,
      reconcileMs: Math.round(reconciledAt - started),
      reserveMs: Math.round(reservedAt - reconciledAt),
      materializeMs: Math.round(materializedAt - reservedAt),
      verifyImagesMs: Math.round(measurements.verificationMs),
      registerImagesMs: Math.round(measurements.registrationMs),
      commitShardsMs: Math.round(measurements.shardCommitMs),
      finalJobCheckMs: Math.round(checkedAt - materializedAt),
      sealMs: Math.round(sealedAt - checkedAt),
      totalMs: Math.round(sealedAt - started),
      submitToSealMs: staged.submitted_at === null ? null : sealTimestamp - staged.submitted_at,
    }),
  );
  const latest = await context.service.run(run.id);
  const comparison = latest.comparison_id
    ? await context.service.comparison(latest.comparison_id)
    : await committedComparison(context, latest);
  await finalizeSubmittedComparison(context, comparison.id);
  await resolveEvents(
    context.database,
    "staged-reconciliation",
    `${run.external_run_id}:${run.attempt}`,
    Date.now(),
  );
  return context.service.run(run.id);
}

/** Retry incomplete conversion after transient GitHub, D1, or R2 failures. */
export async function reconcileStagedWorkflows(context: ApiContext, limit = 25) {
  if (!context.configuration.workflowOwned) return { checked: 0, progressed: 0, errors: [] };
  const retryBurst = 5;
  const delayedRetryMs = 60 * 60 * 1000;
  const failedUnmaterializedStage = `NOT EXISTS
    (SELECT 1 FROM visonaut_runs materialized WHERE materialized.id = staged.id)
    AND EXISTS (SELECT 1 FROM pre_run_checks candidate
      WHERE candidate.repository_id = staged.repository_id
        AND candidate.workflow_run_id = staged.workflow_run_id
        AND candidate.workflow_attempt = staged.workflow_attempt
        AND candidate.tested_sha = staged.tested_sha
        AND candidate.state = 'failed')`;
  // A webhook may finish conversion outside this sweep. Clear stale alerts
  // after the same or a newer workflow attempt has a sealed run and comparison.
  await context.database
    .prepare(`UPDATE operations_events SET resolved_at = ? WHERE id IN (
      SELECT event.id FROM operations_events event
      JOIN ingest_staged_runs staged
        ON event.subject_id = staged.workflow_run_id || ':' || staged.workflow_attempt
      JOIN visonaut_runs run
        ON run.external_run_id = staged.workflow_run_id
          AND run.attempt >= staged.workflow_attempt
      WHERE event.kind = 'staged-reconciliation' AND event.resolved_at IS NULL
        AND staged.repository_id = ? AND run.project_id = ? AND run.sealed_at IS NOT NULL
        AND run.comparison_id IS NOT NULL
      ORDER BY event.last_seen_at LIMIT ?)`)
    .bind(
      Date.now(),
      context.configuration.github.repositoryId,
      context.configuration.projectId,
      Math.min(limit, 100),
    )
    .run();
  // A failed App check is terminal. Keep its staged bytes for retention, but
  // do not retry a conversion that can no longer publish a passing check.
  await context.database
    .prepare(`UPDATE operations_events SET resolved_at = ? WHERE id IN (
      SELECT event.id FROM operations_events event
      JOIN ingest_staged_runs staged
        ON event.subject_id = staged.workflow_run_id || ':' || staged.workflow_attempt
      WHERE event.kind = 'staged-reconciliation' AND event.resolved_at IS NULL
        AND staged.repository_id = ? AND ${failedUnmaterializedStage}
      ORDER BY event.last_seen_at LIMIT ?)`)
    .bind(Date.now(), context.configuration.github.repositoryId, Math.min(limit, 100))
    .run();
  // Sealing and comparison creation commit separately. Resume either boundary.
  const runs = await context.database
    .prepare(
      `SELECT staged.id, staged.workflow_run_id, staged.workflow_attempt, staged.reconcile_failures, staged.missing_original_failures FROM ingest_staged_runs staged LEFT JOIN visonaut_runs run ON run.id = staged.id WHERE staged.repository_id = ? AND staged.retention_state = 'live' AND staged.submitted_at IS NOT NULL AND staged.created_at > ? AND ${afterRestoreSql("staged.created_at")} AND (run.id IS NULL OR (run.active = 1 AND ((run.sealed_at IS NULL AND run.state = 'uploading') OR (run.sealed_at IS NOT NULL AND run.state = 'comparing' AND run.comparison_id IS NULL)))) AND NOT (${failedUnmaterializedStage}) AND NOT EXISTS (SELECT 1 FROM visonaut_runs newer WHERE newer.project_id = ? AND newer.external_run_id = staged.workflow_run_id AND newer.attempt > staged.workflow_attempt AND newer.sealed_at IS NOT NULL) AND (staged.reconcile_failures < ? OR staged.last_checked_at <= ?) ORDER BY COALESCE(staged.last_checked_at, 0), staged.created_at LIMIT ?`,
    )
    .bind(
      context.configuration.github.repositoryId,
      Date.now() - stagedAttemptRetentionMs,
      context.configuration.projectId,
      retryBurst,
      Date.now() - delayedRetryMs,
      Math.min(limit, 100),
    )
    .all<{
      id: string;
      workflow_run_id: string;
      workflow_attempt: number;
      reconcile_failures: number;
      missing_original_failures: number;
    }>();
  const errors: Array<{ runId: string; code: string }> = [];
  let progressed = 0;
  for (const row of runs.results) {
    const subject = `${row.workflow_run_id}:${row.workflow_attempt}`;
    let failures = row.reconcile_failures;
    let missingOriginalFailures = row.missing_original_failures;
    try {
      await materializeWorkflowRun(context, row.id);
      progressed += 1;
      failures = 0;
      missingOriginalFailures = 0;
      await resolveEvents(context.database, "staged-reconciliation", subject, Date.now());
    } catch (error) {
      errors.push({
        runId: row.id,
        code: error instanceof SecurityError ? error.code : "incomplete",
      });
      failures = Math.min(row.reconcile_failures + 1, retryBurst);
      missingOriginalFailures =
        error instanceof StagedOriginalUnavailableError
          ? Math.min(row.missing_original_failures + 1, retryBurst)
          : 0;
      // A main receipt stays bound to its old baseline across every retry.
      const staleReference = error instanceof SecurityError && error.code === "stale_reference";
      if (staleReference || failures === retryBurst) {
        const run =
          staleReference || missingOriginalFailures === retryBurst
            ? await context.database
                .prepare(
                  "SELECT state FROM visonaut_runs WHERE id = ? AND active = 1 AND sealed_at IS NULL",
                )
                .bind(row.id)
                .first<{ state: string }>()
            : null;
        const terminalFailure = run?.state === "uploading";
        const failureCode = staleReference ? "stale-reference" : "original-unavailable";
        if (terminalFailure) {
          await resolveEvents(context.database, "staged-reconciliation", subject, Date.now());
        }
        if (terminalFailure || failures === retryBurst) {
          await recordEvent(context.database, {
            kind: "staged-reconciliation",
            subject,
            code: terminalFailure ? failureCode : "retry-delayed",
            now: Date.now(),
          });
        }
        if (terminalFailure) {
          try {
            // Keep the pre-run record active so the status sender can publish failure.
            await context.service.failRun({
              runId: row.id,
              reason: staleReference
                ? "The baseline changed after trusted Submit. Run trusted Submit again with the current reference."
                : "The validated original is unavailable after repeated reconciliation.",
              now: Date.now(),
            });
          } catch (failure) {
            if (!(failure instanceof ConflictError)) throw failure;
          }
        }
      }
    } finally {
      await context.database
        .prepare(
          "UPDATE ingest_staged_runs SET last_checked_at = ?, reconcile_failures = ?, missing_original_failures = ? WHERE id = ?",
        )
        .bind(Date.now(), failures, missingOriginalFailures, row.id)
        .run();
    }
  }
  return { checked: runs.results.length, progressed, errors };
}
