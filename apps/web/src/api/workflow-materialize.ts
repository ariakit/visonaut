import { digestEnvironmentProfile, digestJson, SCHEMA_VERSION, sha256 } from "@visonaut/protocol";
import { createGitHubClient, SecurityError } from "@visonaut/security";
import { ConflictError, IncompleteError, type RunRow } from "@visonaut/service";
import { ingestCaptureProfile, storeCaptureProfiles } from "../profiles.ts";
import { recordEvent, resolveEvents } from "../operations/common.ts";
import { assertConfiguredProject, type ApiContext } from "./context.js";
import { scheduleComparison, verifyAncestry } from "./ingest.js";
import { workflowAttempt } from "./jobs.js";
import { relatedRunEvidence } from "./lineage.js";
import { findPreRunCheck } from "./pre-run.js";
import { reconcileWorkflowJobSet, type ReconciledBundle } from "./workflow-reconcile.js";
import { stagedAttemptRetentionMs, stagedMaterializationLeaseMs } from "./workflow-retention.js";

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

/** Distinguish lost validated bytes from retryable GitHub or D1 failures. */
class StagedOriginalUnavailableError extends IncompleteError {}

async function leaseStagedSources(context: ApiContext, stagedRunId: string) {
  const target = await context.database
    .prepare(
      "SELECT repository_id, workflow_run_id, workflow_attempt, tested_sha, workflow_source_digest, created_at FROM ingest_staged_runs WHERE id = ? AND retention_state = 'live' AND submitted_at IS NOT NULL",
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
  // One D1 update wins before a retention claim or leaves a claimed source
  // unchanged. Reconciliation rejects any source that is no longer live.
  await context.database
    .prepare(
      "UPDATE ingest_staged_runs SET materialization_lease_until = MAX(COALESCE(materialization_lease_until, 0), ?) WHERE repository_id = ? AND workflow_run_id = ? AND workflow_attempt <= ? AND tested_sha = ? AND workflow_source_digest = ? AND retention_state = 'live' AND EXISTS (SELECT 1 FROM ingest_staged_runs submitted WHERE submitted.id = ? AND submitted.retention_state = 'live' AND submitted.submitted_at IS NOT NULL AND submitted.created_at > ?)",
    )
    .bind(
      now + stagedMaterializationLeaseMs,
      target.repository_id,
      target.workflow_run_id,
      target.workflow_attempt,
      target.tested_sha,
      target.workflow_source_digest,
      stagedRunId,
      now - stagedAttemptRetentionMs,
    )
    .run();
}

async function materializeImages(context: ApiContext, runId: string, bundle: ReconciledBundle) {
  const images = await context.database
    .prepare("SELECT * FROM ingest_staged_images WHERE run_id = ? AND job_id = ?")
    .bind(bundle.sourceRunId, bundle.jobId)
    .all<StagedImage>();
  const expected = new Map(
    bundle.manifest.captures.map((capture) => [capture.image.digest, capture.image]),
  );
  if (images.results.length !== expected.size) {
    throw new IncompleteError("The validated staged image set changed.");
  }
  const ids = new Map<string, string>();
  for (const image of images.results) {
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
    const stored = await context.images.get(image.object_key);
    if (!stored || stored.size !== image.bytes) {
      throw new StagedOriginalUnavailableError("A validated original image is unavailable.");
    }
    const bytes = new Uint8Array(await stored.arrayBuffer());
    if ((await sha256(bytes)) !== image.digest) {
      throw new StagedOriginalUnavailableError("A validated original image changed after upload.");
    }
    const imageId = bundle.sourceRunId === runId ? image.image_id : `${runId}:${image.image_id}`;
    const objectKey =
      bundle.sourceRunId === runId ? image.object_key : `runs/${runId}/images/${imageId}`;
    if (bundle.sourceRunId !== runId) {
      await context.images.put(objectKey, bytes, {
        httpMetadata: { contentType: image.media_type },
      });
    }
    await context.service.registerImage({
      id: imageId,
      runId,
      digest: image.digest,
      objectKey,
      contentType: image.media_type,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
    });
    ids.set(image.digest, imageId);
  }
  return ids;
}

async function materializeBundle(
  context: ApiContext,
  run: RunRow,
  bundle: ReconciledBundle,
  proof: string,
) {
  const manifest = bundle.manifest;
  const imageIds = await materializeImages(context, run.id, bundle);
  const capturedProfiles = new Set(manifest.captures.map((capture) => capture.profileDigest));
  await storeCaptureProfiles(
    context.database,
    manifest.profiles.filter((profile) => capturedProfiles.has(profile.digest)),
  );
  const previous = await context.database
    .prepare(
      "SELECT id, json_extract(metadata_json, '$.profile') AS profile_json FROM visonaut_captures WHERE run_id = ? AND shard_key = ?",
    )
    .bind(run.id, bundle.key)
    .all<{ id: string; profile_json: string }>();
  const previousProfiles = new Map(previous.results.map((row) => [row.id, row.profile_json]));
  const captures = await Promise.all(
    manifest.captures.map(async (capture) => {
      const imageId = imageIds.get(capture.image.digest);
      const profile = manifest.profiles.find((entry) => entry.digest === capture.profileDigest);
      if (!imageId || !profile) {
        throw new IncompleteError("A capture lost its measured profile or validated image.");
      }
      const id = `${run.id}:${await digestJson([capture.itemKey, capture.variant.key])}`;
      return {
        id,
        itemKey: capture.itemKey,
        variantKey: capture.variant.key,
        ordinal: capture.ordinal,
        imageId,
        profileDigest: capture.profileDigest,
        environmentProfileDigest: await digestEnvironmentProfile(profile.profile),
        testId: capture.testId,
        testRetry: capture.testRetry,
        metadata: {
          name: capture.name ?? capture.itemKey,
          variant: capture.variant,
          profile: await ingestCaptureProfile(capture.profileDigest, previousProfiles.get(id)),
          source: manifest.tests.find((test) => test.id === capture.testId),
        },
      };
    }),
  );
  const discovery = manifest.discovery;
  if (!discovery) {
    throw new IncompleteError("The trusted upload has no discovery evidence.");
  }
  await context.service.commitShard({
    runId: run.id,
    key: bundle.key,
    manifestDigest: bundle.manifestDigest,
    captures,
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
  const manifestObjectKey = `manifests/${run.id}/${bundle.manifestDigest}.json`;
  if (bundle.sourceRunId !== run.id) {
    // The source attempt expires independently. Keep the inherited run's
    // recovery evidence under its own retention boundary.
    await context.quarantine.put(manifestObjectKey, JSON.stringify(manifest), {
      httpMetadata: { contentType: "application/json" },
    });
  }
  await context.database
    .prepare(
      "INSERT INTO ingest_manifests (run_id, shard_key, digest, object_key, job_id, capture_count, declared_bytes, finalized, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(run_id, shard_key) DO NOTHING",
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
    )
    .run();
  const stored = await context.database
    .prepare(
      "SELECT digest, job_id, declared_bytes, finalized FROM ingest_manifests WHERE run_id = ? AND shard_key = ?",
    )
    .bind(run.id, bundle.key)
    .first<{ digest: string; job_id: string; declared_bytes: number; finalized: number }>();
  if (
    stored?.digest !== bundle.manifestDigest ||
    stored.job_id !== bundle.jobId ||
    stored.declared_bytes !== declaredBytes ||
    stored.finalized !== 1
  ) {
    throw new IncompleteError("The committed shard manifest changed.");
  }
}

/** Build a service run only from the final complete GitHub matrix and staged evidence. */
export async function materializeWorkflowRun(context: ApiContext, stagedRunId: string) {
  await assertConfiguredProject(context);
  const alreadyStored = await context.database
    .prepare("SELECT id FROM visonaut_runs WHERE id = ?")
    .bind(stagedRunId)
    .first<{ id: string }>();
  if (alreadyStored) {
    const previous = await context.service.run(stagedRunId);
    if (previous.sealed_at !== null) {
      if (previous.active) await scheduleComparison(context, previous.id);
      await resolveEvents(
        context.database,
        "staged-reconciliation",
        `${previous.external_run_id}:${previous.attempt}`,
        Date.now(),
      );
      return previous;
    }
    if (!previous.active || previous.state === "failed") {
      throw new IncompleteError("The incomplete workflow run can no longer be converted.");
    }
  }
  await leaseStagedSources(context, stagedRunId);
  const {
    run: staged,
    submit,
    bundles,
    jobSetDigest,
  } = await reconcileWorkflowJobSet(context, stagedRunId);
  const github = await createGitHubClient(context.configuration.github);
  const lineage = await relatedRunEvidence(context, github, submit);
  const ancestors = await verifyAncestry(context, github, submit.testedSha);
  const precreatedCheck = await findPreRunCheck(context, github, {
    testedSha: submit.testedSha,
    workflowRunId: staged.workflow_run_id,
    workflowAttempt: staged.workflow_attempt,
  });
  const proof = await digestJson({ submit, jobSetDigest, lineage: lineage.proof });
  const executorDigest = context.configuration.trustedExecutorDigest;
  if (!executorDigest) {
    throw new SecurityError("workflow_configuration", 503, "The trusted executor is unavailable.");
  }
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
  const planObjectKey = `plans/workflow/${jobSetDigest}.json`;
  await context.quarantine.put(
    planObjectKey,
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      source: "workflow-owned",
      workflowSourceDigest: staged.workflow_source_digest,
      jobSetDigest,
      callerWorkflowPath: staged.caller_workflow_path,
      reusableWorkflowRef: staged.reusable_workflow_ref,
      bundles: bundles.map(({ key, sourceAttempt, jobId, manifestDigest }) => ({
        key,
        sourceAttempt,
        jobId,
        manifestDigest,
      })),
    }),
    { httpMetadata: { contentType: "application/json" } },
  );
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
      "INSERT INTO ingest_run_provenance (run_id, verified_json, plan_object_key, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(run_id) DO NOTHING",
    )
    .bind(
      run.id,
      JSON.stringify({
        ...submit,
        lineageProof: lineage.proof,
        reusableWorkflowRef: staged.reusable_workflow_ref,
        reusableWorkflowSha: context.configuration.workflowOwned?.reusableWorkflowSha,
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
  for (const bundle of bundles) {
    await materializeBundle(context, run, bundle, proof);
  }
  const current = await workflowAttempt(github, submit);
  if (current.path !== staged.caller_workflow_path) {
    throw new IncompleteError("The pinned workflow changed before sealing.");
  }
  await context.service.sealRun({ runId: run.id, now: Date.now() });
  await scheduleComparison(context, run.id);
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
  // A webhook may finish conversion outside this sweep. Clear stale alerts
  // after the same or a newer workflow attempt has a sealed service run.
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
      ORDER BY event.last_seen_at LIMIT ?)`)
    .bind(
      Date.now(),
      context.configuration.github.repositoryId,
      context.configuration.projectId,
      Math.min(limit, 100),
    )
    .run();
  const runs = await context.database
    .prepare(
      "SELECT staged.id, staged.workflow_run_id, staged.workflow_attempt, staged.reconcile_failures, staged.missing_original_failures FROM ingest_staged_runs staged LEFT JOIN visonaut_runs run ON run.id = staged.id WHERE staged.repository_id = ? AND staged.retention_state = 'live' AND staged.submitted_at IS NOT NULL AND staged.created_at > ? AND (run.id IS NULL OR (run.active = 1 AND run.sealed_at IS NULL AND run.state = 'uploading')) AND NOT EXISTS (SELECT 1 FROM visonaut_runs newer WHERE newer.project_id = ? AND newer.external_run_id = staged.workflow_run_id AND newer.attempt > staged.workflow_attempt AND newer.sealed_at IS NOT NULL) AND (staged.reconcile_failures < ? OR staged.last_checked_at <= ?) ORDER BY COALESCE(staged.last_checked_at, 0), staged.created_at LIMIT ?",
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
      if (failures === retryBurst) {
        const run =
          missingOriginalFailures === retryBurst
            ? await context.database
                .prepare(
                  "SELECT state FROM visonaut_runs WHERE id = ? AND active = 1 AND sealed_at IS NULL",
                )
                .bind(row.id)
                .first<{ state: string }>()
            : null;
        const originalUnavailable = run?.state === "uploading";
        if (originalUnavailable) {
          await resolveEvents(context.database, "staged-reconciliation", subject, Date.now());
        }
        await recordEvent(context.database, {
          kind: "staged-reconciliation",
          subject,
          code: originalUnavailable ? "original-unavailable" : "retry-delayed",
          now: Date.now(),
        });
        if (originalUnavailable) {
          try {
            // Keep the pre-run record active so the status sender can publish failure.
            await context.service.failRun({
              runId: row.id,
              reason: "The validated original is unavailable after repeated reconciliation.",
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
