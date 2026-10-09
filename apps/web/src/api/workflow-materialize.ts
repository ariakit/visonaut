import {
  canonicalJson,
  digestEnvironmentProfile,
  digestJson,
  digestRenderingProfile,
  identityKey,
  sha256,
  uploadImages,
} from "@visonaut/protocol";
import { createGitHubClient, SecurityError } from "@visonaut/security";
import {
  ConflictError,
  IncompleteError,
  maximumImageRegistrationBatchSize,
  type RunRow,
  type ValidatedImage,
} from "@visonaut/service";
import { ingestCaptureProfile, storeCaptureProfiles } from "../profiles.ts";
import { recordEvent, resolveEvents } from "../operations/common.ts";
import { assertConfiguredProject, type ApiContext } from "./context.js";
import { verifyAncestry, finalizeSubmittedComparison } from "./ingest.js";
import {
  validateAdmittedMainReference,
  validateLocalSubmission,
  referenceCaptureInputs,
  currentReference,
} from "./local-comparison.ts";
import {
  writeCaptureInventory,
  type CaptureInventory,
  type InventoryCapture,
} from "../capture-inventory.ts";
import { inventoryPointer, readRunInventory } from "../inventory-records.ts";
import { workflowAttempt } from "./jobs.js";
import { relatedRunEvidence } from "./lineage.js";
import { findPreRunCheck, requireVisualPlan } from "./pre-run.js";
import { reconcileWorkflowJobSet, type ReconciledBundle } from "./workflow-reconcile.js";
import { stagedAttemptRetentionMs, stagedMaterializationLeaseMs } from "./workflow-retention.js";
import {
  evidenceImages,
  readManifestEvidence,
  stagedManifestEvidence,
} from "./workflow-evidence.ts";
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
  currentRunImages,
  measurements,
}: MaterializeImagesParams) {
  if (bundle.sourceRunId !== runId) {
    throw new IncompleteError("Submit must upload a fresh combined bundle for this attempt.");
  }
  const images = await evidenceImages(
    context,
    await stagedManifestEvidence(context, bundle.sourceRunId, bundle.jobId),
  );
  const expected = uploadImages(bundle.manifest);
  const originalDigests = new Set(bundle.manifest.captures.map((capture) => capture.image.digest));
  if (images.length !== expected.size) {
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
    const declared = expected.get(image.digest);
    if (
      !declared ||
      image.complete !== 1 ||
      image.media_type !== declared.mediaType ||
      image.bytes !== declared.bytes ||
      image.width !== declared.width ||
      image.height !== declared.height
    ) {
      throw new IncompleteError("A staged image differs from its validated manifest.");
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
        ...(originalDigests.has(image.digest) ? {} : { role: "mask" as const }),
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

async function materializeBundle({
  context,
  run,
  bundle,
  proof,
  currentRunImages,
  measurements,
}: MaterializeBundleParams) {
  const manifest = bundle.manifest;
  if (manifest.localComparison) {
    await validateLocalSubmission(context, run.id, manifest);
  }
  const referenceInputs = await referenceCaptureInputs(
    context,
    manifest.localComparison?.reference.snapshotId ?? null,
  );
  const references = new Map(referenceInputs.map((capture) => [identityKey(capture), capture]));
  const results = new Map(
    manifest.localComparison?.captures.map((result) => [identityKey(result), result]),
  );
  const imageRecords = await materializeImages({
    context,
    runId: run.id,
    bundle,
    currentRunImages,
    measurements,
  });
  const shardCommitStarted = performance.now();
  const previous = await context.database
    .prepare(
      "SELECT id, json_extract(metadata_json, '$.profile') AS profile_json FROM visonaut_captures WHERE run_id = ? AND shard_key = ?",
    )
    .bind(run.id, bundle.key)
    .all<{ id: string; profile_json: string }>();
  const previousProfiles = new Map(previous.results.map((row) => [row.id, row.profile_json]));
  const captures: InventoryCapture[] = await Promise.all(
    manifest.captures.map(async (capture) => {
      const key = identityKey({ itemKey: capture.itemKey, variantKey: capture.variant.key });
      const result = results.get(key);
      const candidateStored = result?.outcome !== "unchanged";
      const representative =
        result?.outcome === "unchanged"
          ? references.get(key)?.image
          : imageRecords.get(capture.image.digest);
      const profile = manifest.profiles.find((entry) => entry.digest === capture.profileDigest);
      if (!representative || !profile) {
        throw new IncompleteError("A capture lost its measured profile or validated image.");
      }
      const id = `${run.id}:${await digestJson([capture.itemKey, capture.variant.key])}`;
      const reference = references.get(key);
      const zeroPixelChange =
        !!reference &&
        result?.outcome === "changed" &&
        reference.image.width === capture.image.width &&
        reference.image.height === capture.image.height &&
        result.changedPixels === 0 &&
        result.ratio === 0 &&
        !result.mask;
      return {
        id,
        itemKey: capture.itemKey,
        variantKey: capture.variant.key,
        ordinal: capture.ordinal,
        imageId: representative.id,
        image: representative,
        profileDigest: capture.profileDigest,
        renderingProfileDigest: await digestRenderingProfile(profile.profile),
        environmentProfileDigest: await digestEnvironmentProfile(profile.profile),
        testId: capture.testId,
        testRetry: capture.testRetry,
        metadata: {
          name: capture.name ?? capture.itemKey,
          variant: capture.variant,
          profile: await ingestCaptureProfile(capture.profileDigest, previousProfiles.get(id)),
          source: manifest.tests.find((test) => test.id === capture.testId),
          ...(result && manifest.localComparison
            ? {
                localMode: manifest.localComparison.mode,
                observedImage: capture.image,
                candidateStored,
                comparison: capture.comparison,
                comparisonDigest: await digestJson(capture.comparison),
                localResult: {
                  outcome: zeroPixelChange ? "unchanged" : result.outcome,
                  changedPixels: result.changedPixels,
                  ratio: result.ratio,
                  engineVersion: manifest.localComparison.engineVersion,
                  codecVersion: manifest.localComparison.codecVersion,
                  maskExpected: !!result.mask,
                  ...(result.mask ? { maskImageId: imageRecords.get(result.mask.digest)?.id } : {}),
                },
              }
            : {}),
        },
      };
    }),
  );
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
    manifest.profiles.filter((profile) => changedProfiles.has(profile.digest)),
  );
  const facts: CaptureInventory = {
    schemaVersion: "baseline-delta-v1",
    projectId: run.project_id,
    runId: run.id,
    testedSha: run.tested_sha,
    referenceSnapshotId: manifest.localComparison?.reference.snapshotId ?? null,
    captures,
    profiles: manifest.profiles,
    manifest,
  };
  let inventory = inventoryPointer(run);
  if (inventory) {
    const previous = await readRunInventory(context, run.id);
    if (
      !previous?.manifest ||
      previous.referenceSnapshotId !== facts.referenceSnapshotId ||
      canonicalJson(previous.manifest) !== canonicalJson(manifest) ||
      canonicalJson(previous.profiles) !== canonicalJson(facts.profiles) ||
      previous.captures.length !== captures.length ||
      previous.captures.some(
        (capture, index) => canonicalJson(capture) !== canonicalJson(captures[index]),
      )
    ) {
      throw new IncompleteError("The committed inventory differs from the verified submission.");
    }
  } else {
    inventory = await writeCaptureInventory(context.images, facts);
  }
  const discovery = manifest.discovery;
  if (!discovery) {
    throw new IncompleteError("The trusted upload has no discovery evidence.");
  }
  await context.service.commitShard({
    runId: run.id,
    key: bundle.key,
    manifestDigest: bundle.manifestDigest,
    captures,
    inventory,
    imageRunIds: [...new Set(captures.map((capture) => capture.image.runId))],
    ...(manifest.localComparison
      ? { localReferenceSnapshotId: manifest.localComparison.reference.snapshotId }
      : {}),
    verifiedDiscovery: {
      ...discovery,
      verificationDigest: await digestJson({ proof, receipt: bundle.evidence }),
      jobId: bundle.jobId,
      externalRunId: run.external_run_id,
      attempt: bundle.sourceAttempt,
      testedSha: run.tested_sha,
      tests: manifest.tests.map((test) => test.id),
      captures: manifest.captures.map((capture) => ({
        itemKey: capture.itemKey,
        variantKey: capture.variant.key,
        testId: capture.testId,
      })),
    },
    finalTestOutcomes: manifest.tests.map((test) => ({
      testId: test.id,
      retry: test.retry,
      status: test.status,
    })),
    now: Date.now(),
  });
  const declaredBytes = [
    ...new Map(
      manifest.captures.map((capture) => [capture.image.digest, capture.image.bytes]),
    ).values(),
  ].reduce((sum, bytes) => sum + bytes, 0);
  const manifestObjectKey =
    bundle.evidenceVersion === 1
      ? bundle.manifestObjectKey
      : `d1:manifest/${run.id}/${bundle.key}/${bundle.manifestDigest}`;
  await context.database
    .prepare(
      "INSERT INTO ingest_manifests (run_id, shard_key, digest, object_key, job_id, capture_count, declared_bytes, finalized, created_at, storage_version) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(run_id, shard_key) DO NOTHING",
    )
    .bind(
      run.id,
      bundle.key,
      bundle.manifestDigest,
      manifestObjectKey,
      bundle.jobId,
      manifest.captures.length,
      declaredBytes,
      Date.now(),
      bundle.evidenceVersion,
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
    stored.object_key !== manifestObjectKey ||
    stored.storage_version !== bundle.evidenceVersion ||
    stored.capture_count !== manifest.captures.length ||
    stored.job_id !== bundle.jobId ||
    stored.declared_bytes !== declaredBytes ||
    stored.finalized !== 1
  ) {
    throw new IncompleteError("The committed shard manifest changed.");
  }
  measurements.shardCommitMs += performance.now() - shardCommitStarted;
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
        if (previous.inventory_key) {
          const inventory = await readRunInventory(context, previous.id);
          const receipt = inventory?.manifest?.localComparison;
          if (
            !inventory ||
            !receipt ||
            inventory.runId !== previous.id ||
            inventory.projectId !== previous.project_id
          ) {
            throw new IncompleteError("The durable local Submit receipt is unavailable.");
          }
          await currentReference(context, receipt.reference, previous.kind === "pull_request");
          const comparison = await context.service.createComparison({
            id: crypto.randomUUID(),
            runId: previous.id,
            referenceSnapshotId: receipt.reference.snapshotId,
            expectedBaselineRevision: receipt.reference.baselineRevision,
            localComparison: receipt,
            referenceCaptures: await referenceCaptureInputs(context, receipt.reference.snapshotId),
            now: Date.now(),
          });
          await finalizeSubmittedComparison(context, comparison.id);
        } else {
          const local = await context.database
            .prepare(
              "SELECT 1 FROM visonaut_captures WHERE run_id=? AND json_extract(metadata_json,'$.localMode')='local-v1' LIMIT 1",
            )
            .bind(previous.id)
            .first();
          if (local) {
            const staged = await context.database
              .prepare(
                "SELECT job_id FROM ingest_staged_manifests WHERE run_id = ? AND complete = 1",
              )
              .bind(previous.id)
              .first<{ job_id: string }>();
            if (!staged) {
              throw new IncompleteError("The local Submit receipt is unavailable.");
            }
            const manifest = await readManifestEvidence(
              context,
              await stagedManifestEvidence(context, previous.id, staged.job_id),
            );
            await validateLocalSubmission(context, previous.id, manifest);
            const receipt = manifest.localComparison;
            if (!receipt) throw new IncompleteError("The local Submit receipt is unavailable.");
            const comparison = await context.service.createComparison({
              id: crypto.randomUUID(),
              runId: previous.id,
              referenceSnapshotId: receipt.reference.snapshotId,
              expectedBaselineRevision: receipt.reference.baselineRevision,
              localComparison: receipt,
              now: Date.now(),
            });
            await finalizeSubmittedComparison(context, comparison.id);
          } else
            throw new IncompleteError(
              "A verified local Submit receipt is required. Capture and submit a new complete run.",
            );
        }
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
  const executorDigest = bundles[0]?.manifest.discovery?.executorDigest;
  if (
    !executorDigest ||
    bundles.some((bundle) => bundle.manifest.discovery?.executorDigest !== executorDigest)
  ) {
    throw new IncompleteError("The capture jobs must declare one executor.");
  }
  const local = bundles[0]?.manifest.localComparison;
  if (!local)
    throw new IncompleteError(
      "A verified local Submit receipt is required. Capture and submit a new complete run.",
    );
  if (bundles.length !== 1 || bundles[0]?.key !== "combined")
    throw new IncompleteError("Local comparison must admit one complete combined Submit bundle.");
  const plan = {
    digest: jobSetDigest,
    shards: await Promise.all(
      bundles.map(async (bundle) => {
        const discovery = bundle.manifest.discovery;
        if (!discovery) {
          throw new IncompleteError("The trusted upload has no discovery evidence.");
        }
        return {
          key: bundle.key,
          profileDigest: await digestJson({ environmentProfilePolicy: "measured" }),
          environmentProfilePolicy: "measured" as const,
          sourceAttempt: bundle.sourceAttempt,
          discovery: {
            executorDigest,
            configurationDigest: discovery.configurationDigest,
          },
          tests: [],
          captures: [],
        };
      }),
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
  for (const bundle of bundles) {
    await materializeBundle({ context, run, bundle, proof, currentRunImages, measurements });
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
      captures: bundles.reduce((count, bundle) => count + bundle.manifest.captures.length, 0),
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
    : await context.service.createComparison({
        id: crypto.randomUUID(),
        runId: run.id,
        referenceSnapshotId: local.reference.snapshotId,
        expectedBaselineRevision: local.reference.baselineRevision,
        localComparison: local,
        referenceCaptures: await referenceCaptureInputs(context, local.reference.snapshotId),
        now: Date.now(),
      });
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
