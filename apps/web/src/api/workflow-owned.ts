import {
  digestJson,
  captureJobNames,
  parseManifest,
  SCHEMA_VERSION,
  sha256,
  validateDigest,
  validateKey,
  validateManifestProfiles,
  validateVersion,
  workflowSourceDigest,
  LOCAL_COMPARISON_MODE,
  uploadImages,
  type Manifest,
  type ReserveRunRequest,
} from "@visonaut/protocol";
import { validateLocalSubmission, referencePage, referenceImage } from "./local-comparison.ts";
import {
  bearerToken,
  createGitHubClient,
  issueIngestCapability,
  issueReuseChallenge,
  issueUploadTicket,
  readBoundedBody,
  SecurityError,
  verifyGitHubOidc,
  verifyIngestCapability,
  verifyReuseChallenge,
  verifyUploadTicket,
  type GitHubClient,
  type IngestCapability,
  type VerifiedRun,
} from "@visonaut/security";
import { assertion, atomic, ConflictError, IncompleteError, statement } from "@visonaut/service";
import {
  isTrustedWorkflowExecutor,
  loadVerifiedMergeGroup,
  type ApiConfiguration,
  type ApiContext,
} from "./context.js";
import { integer, jsonBody, object, string } from "./input.js";
import {
  ensureSignedAttemptCheck,
  recordRequiredVisualPlan,
  requireVisualPlan,
} from "./pre-run.js";
import {
  encodeManifestEvidence,
  evidenceFence,
  evidenceImageAssertions,
  exactEvidenceImages,
  imageDescriptorPages,
  readManifestEvidence,
  stagedManifestEvidence,
  writeEvidencePages,
  writeManifestEvidence,
  type StagedManifestEvidence,
} from "./workflow-evidence.ts";
import { afterRestoreSql, readRestoreCutoff } from "../operations/recovery.ts";

interface StagedRun {
  id: string;
  repository_id: string;
  workflow_run_id: string;
  workflow_attempt: number;
  tested_sha: string;
  workflow_source_digest: string;
  caller_workflow_path: string;
  reusable_workflow_ref: string;
  // The historic column stores the complete capture job name template.
  capture_job_prefix: string;
  submit_job_name: string;
  verified_json: string;
  submit_job_id: string | null;
  submit_check_run_id: string | null;
  submit_verified_json: string | null;
  submitted_at: number | null;
  retention_state: "live" | "deleting" | "deleted";
}

interface StagedJob {
  run_id: string;
  job_id: string;
  check_run_id: string;
  shard_key: string;
  job_name: string;
  verified_json: string;
}

interface StagedImage {
  run_id: string;
  job_id: string;
  digest: string;
  media_type: "image/png" | "image/webp";
  bytes: number;
  width: number;
  height: number;
  image_id: string;
  object_key: string;
  quarantine_key: string;
  complete: number;
}

const maximumReusePage = 32;
const maximumReusePageBytes = 8 * 1024 * 1024;

function hexBytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}

export function workflowConfiguration(context: ApiContext) {
  const configuration = context.configuration.workflowOwned;
  const maximumStagedBytes = context.configuration.limits.maximumStagedBytes;
  if (
    !configuration ||
    !Number.isSafeInteger(maximumStagedBytes) ||
    !maximumStagedBytes ||
    maximumStagedBytes < 1 ||
    !/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/.test(configuration.callerWorkflowPath) ||
    (configuration.callerWorkflowBlobSha !== undefined &&
      !/^[a-f0-9]{40}$/.test(configuration.callerWorkflowBlobSha)) ||
    (configuration.trustedWorkflowPath !== undefined &&
      !/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/.test(configuration.trustedWorkflowPath)) ||
    !configuration.submitJobName ||
    configuration.submitJobName.length > 256 ||
    !/^[a-f0-9]{40}$/.test(configuration.reusableWorkflowSha) ||
    (configuration.trustedWorkflowPath !== undefined &&
      configuration.reusableWorkflowRef !==
        `${context.configuration.github.repository}/${configuration.trustedWorkflowPath}@${configuration.reusableWorkflowSha}`) ||
    !configuration.reusableWorkflowRef.startsWith(
      `${context.configuration.github.repository}/.github/workflows/`,
    ) ||
    !configuration.reusableWorkflowRef.endsWith(`@${configuration.reusableWorkflowSha}`)
  ) {
    throw new SecurityError(
      "workflow_configuration",
      503,
      "The trusted workflow is not configured.",
    );
  }
  try {
    captureJobNames(configuration.captureJobName);
  } catch {
    throw new SecurityError(
      "workflow_configuration",
      503,
      "The trusted workflow is not configured.",
    );
  }
  return configuration;
}

export function workflowStagingJobName(
  configuration: NonNullable<ApiConfiguration["workflowOwned"]>,
  shardKey: string,
) {
  if (shardKey !== "combined") {
    throw new SecurityError(
      "unsupported_capture_path",
      403,
      "Only signed combined Submit is supported.",
    );
  }
  return configuration.submitJobName;
}

function reserveRequest(body: Record<string, unknown>): ReserveRunRequest {
  validateVersion(body.schemaVersion);
  validateDigest(body.planDigest);
  validateKey(body.shardKey, "shardKey");
  const testedSha = string(body.testedSha, 40);
  if (!/^[a-f0-9]{40}$/.test(testedSha)) {
    throw new SecurityError("invalid_sha", 400, "A full tested SHA is required.");
  }
  if (body.comparisonMode !== undefined && body.comparisonMode !== LOCAL_COMPARISON_MODE)
    throw new SecurityError(
      "comparison_mode",
      400,
      "The requested comparison mode is unsupported.",
    );
  // Close new admissions without blocking previously issued upload capabilities.
  if (body.comparisonMode !== LOCAL_COMPARISON_MODE)
    throw new SecurityError(
      "local_comparison_required",
      409,
      "Server comparison no longer accepts new submissions. Upgrade the Visonaut CLI and capture a new complete run with trusted local Submit.",
    );
  return {
    schemaVersion: body.schemaVersion,
    repository: string(body.repository),
    repositoryId: string(body.repositoryId),
    workflowRunId: string(body.workflowRunId),
    workflowAttempt: integer(body.workflowAttempt, 1),
    testedSha,
    planDigest: body.planDigest,
    shardKey: body.shardKey,
    comparisonMode: LOCAL_COMPARISON_MODE,
  };
}

async function verifyWorkflowJob(
  request: Request,
  context: ApiContext,
  github: GitHubClient,
  identity: ReserveRunRequest,
  jobName: string,
  audience: string,
): Promise<VerifiedRun> {
  const configuration = workflowConfiguration(context);
  return verifyGitHubOidc({
    token: bearerToken(request),
    request: identity,
    github,
    configuration: {
      audience,
      issuedAfter: await readRestoreCutoff(context.database),
      allowMainDispatch:
        context.configuration.auth.environment === "preview" &&
        context.configuration.allowMainDispatch === true,
      repositoryOwnerId: context.configuration.repositoryOwnerId,
      workflowPath: configuration.callerWorkflowPath,
      callerWorkflowBlobSha: configuration.callerWorkflowBlobSha,
      reusableWorkflowRef: configuration.reusableWorkflowRef,
      reusableWorkflowSha: configuration.reusableWorkflowSha,
      trustedWorkflowPath: configuration.trustedWorkflowPath,
      planDigest: identity.planDigest,
      shards: [{ key: identity.shardKey, jobName }],
      loadMergeGroup: (testedSha) => loadVerifiedMergeGroup(context, testedSha),
    },
  });
}

async function stagedRun(context: ApiContext, runId: string): Promise<StagedRun> {
  const run = await context.database
    .prepare(
      `SELECT * FROM ingest_staged_runs WHERE id = ? AND ${afterRestoreSql("ingest_staged_runs.created_at")}`,
    )
    .bind(runId)
    .first<StagedRun>();
  if (
    !run ||
    run.repository_id !== context.configuration.github.repositoryId ||
    run.retention_state !== "live"
  ) {
    throw new SecurityError("not_found", 404, "The staged run was not found.");
  }
  return run;
}

export async function stagedCapability(request: Request, context: ApiContext, runId?: string) {
  const capability = await verifyIngestCapability(
    context.configuration.capability,
    bearerToken(request),
  );
  if (runId && capability.runId !== runId) {
    throw new SecurityError("wrong_run", 403, "The credential belongs to another run.");
  }
  const run = await stagedRun(context, capability.runId);
  const job = await context.database
    .prepare("SELECT * FROM ingest_staged_bundles WHERE run_id = ? AND job_id = ?")
    .bind(run.id, capability.jobId)
    .first<StagedJob>();
  if (
    !job ||
    job.shard_key !== capability.shardKey ||
    run.repository_id !== capability.repositoryId ||
    run.workflow_run_id !== capability.workflowRunId ||
    run.workflow_attempt !== capability.workflowAttempt ||
    run.tested_sha !== capability.testedSha ||
    run.workflow_source_digest !== capability.planDigest
  ) {
    throw new SecurityError("invalid_capability", 403, "The ingest credential is not current.");
  }
  return { capability, run, job };
}

export async function stagedReference(request: Request, context: ApiContext, runId: string) {
  const { capability, run } = await stagedCapability(request, context, runId);
  return referencePage(request, context, capability, run);
}

export async function stagedReferenceImage(
  request: Request,
  context: ApiContext,
  runId: string,
  imageId: string,
) {
  const { capability } = await stagedCapability(request, context, runId);
  return referenceImage(request, context, capability, runId, imageId);
}

/** Begin the App check before artifact downloads or image staging. */
export async function beginStaged(request: Request, context: ApiContext, externalRunId: string) {
  const body = await jsonBody(request, 32_768);
  validateVersion(body.schemaVersion);
  const configuration = workflowConfiguration(context);
  const sourceDigest = await workflowSourceDigest(configuration.reusableWorkflowSha);
  const identity: ReserveRunRequest = {
    schemaVersion: SCHEMA_VERSION,
    repository: context.configuration.github.repository,
    repositoryId: context.configuration.github.repositoryId,
    workflowRunId: externalRunId,
    workflowAttempt: integer(body.workflowAttempt, 1),
    testedSha: string(body.testedSha, 40),
    planDigest: sourceDigest,
    shardKey: "combined",
  };
  const github = await createGitHubClient(context.configuration.github);
  const verified = await verifyWorkflowJob(
    request,
    context,
    github,
    identity,
    configuration.submitJobName,
    new URL("/submit", context.configuration.origin).href,
  );
  await ensureSignedAttemptCheck(context, github, verified);
  await recordRequiredVisualPlan(context, github, verified);
  await requireVisualPlan(context, {
    testedSha: verified.testedSha,
    workflowRunId: verified.workflowRunId,
    workflowAttempt: verified.workflowAttempt,
  });
  return Response.json({ schemaVersion: SCHEMA_VERSION, state: "pending" });
}

export async function reserveStaged(request: Request, context: ApiContext) {
  const body = reserveRequest(await jsonBody(request, 32_768));
  const configuration = workflowConfiguration(context);
  const sourceDigest = await workflowSourceDigest(configuration.reusableWorkflowSha);
  if (body.planDigest !== sourceDigest) {
    throw new SecurityError("wrong_workflow_source", 403, "The workflow source changed.");
  }
  const github = await createGitHubClient(context.configuration.github);
  const jobName = workflowStagingJobName(configuration, body.shardKey);
  const verified = await verifyWorkflowJob(
    request,
    context,
    github,
    body,
    jobName,
    new URL("/submit", context.configuration.origin).href,
  );
  const run = await reserveVerifiedStagedRun(context, verified, sourceDigest);
  await context.database
    .prepare(
      "INSERT INTO ingest_staged_bundles (run_id, job_id, check_run_id, shard_key, job_name, verified_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ? FROM ingest_staged_runs WHERE id = ? AND submitted_at IS NULL AND retention_state = 'live' ON CONFLICT DO NOTHING",
    )
    .bind(
      run.id,
      verified.jobId,
      verified.checkRunId,
      body.shardKey,
      jobName,
      JSON.stringify(verified),
      Date.now(),
      run.id,
    )
    .run();
  const job = await context.database
    .prepare("SELECT * FROM ingest_staged_bundles WHERE run_id = ? AND shard_key = ?")
    .bind(run.id, body.shardKey)
    .first<StagedJob>();
  if (
    !job ||
    job.job_id !== verified.jobId ||
    job.check_run_id !== verified.checkRunId ||
    job.job_name !== jobName
  ) {
    throw new SecurityError("staged_job_conflict", 409, "Another job owns this shard.");
  }
  const capability: IngestCapability = {
    runId: run.id,
    repositoryId: verified.repositoryId,
    workflowRunId: verified.workflowRunId,
    workflowAttempt: verified.workflowAttempt,
    testedSha: verified.testedSha,
    planDigest: sourceDigest,
    shardKey: body.shardKey,
    jobId: verified.jobId,
    maximumBytes: context.configuration.limits.maximumShardBytes,
    maximumImages: context.configuration.limits.maximumCaptures,
    comparisonMode: LOCAL_COMPARISON_MODE,
  };
  return Response.json(
    {
      schemaVersion: SCHEMA_VERSION,
      runId: run.id,
      capability: await issueIngestCapability(context.configuration.capability, capability),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      comparisonMode: LOCAL_COMPARISON_MODE,
    },
    { status: 201 },
  );
}

/** Allocate only after the first signed reservation passes D1 admission. */
export async function reserveVerifiedStagedRun(
  context: ApiContext,
  verified: VerifiedRun,
  sourceDigest: string,
) {
  const configuration = workflowConfiguration(context);
  await requireVisualPlan(context, {
    testedSha: verified.testedSha,
    workflowRunId: verified.workflowRunId,
    workflowAttempt: verified.workflowAttempt,
  });
  const existing = await context.database
    .prepare(
      "SELECT * FROM ingest_staged_runs WHERE repository_id = ? AND workflow_run_id = ? AND workflow_attempt = ?",
    )
    .bind(verified.repositoryId, verified.workflowRunId, verified.workflowAttempt)
    .first<StagedRun>();
  if (!existing) {
    try {
      await context.admission?.({
        projectId: context.configuration.projectId,
        externalRunId: verified.workflowRunId,
        attempt: verified.workflowAttempt,
      });
    } catch (error) {
      const raced = await context.database
        .prepare(
          "SELECT 1 AS found FROM ingest_staged_runs WHERE repository_id = ? AND workflow_run_id = ? AND workflow_attempt = ?",
        )
        .bind(verified.repositoryId, verified.workflowRunId, verified.workflowAttempt)
        .first<{ found: number }>();
      if (!raced) throw error;
    }
  }
  const newRunId = crypto.randomUUID();
  if (!existing) {
    await context.database
      .prepare(
        "INSERT INTO ingest_staged_runs (id, repository_id, workflow_run_id, workflow_attempt, tested_sha, workflow_source_digest, caller_workflow_path, reusable_workflow_ref, capture_job_prefix, submit_job_name, verified_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(repository_id, workflow_run_id, workflow_attempt) DO NOTHING",
      )
      .bind(
        newRunId,
        verified.repositoryId,
        verified.workflowRunId,
        verified.workflowAttempt,
        verified.testedSha,
        sourceDigest,
        configuration.callerWorkflowPath,
        configuration.reusableWorkflowRef,
        configuration.captureJobName,
        configuration.submitJobName,
        JSON.stringify(verified),
        Date.now(),
      )
      .run();
  }
  const run = await context.database
    .prepare(
      `SELECT * FROM ingest_staged_runs WHERE repository_id = ? AND workflow_run_id = ? AND workflow_attempt = ? AND ${afterRestoreSql("ingest_staged_runs.created_at")}`,
    )
    .bind(verified.repositoryId, verified.workflowRunId, verified.workflowAttempt)
    .first<StagedRun>();
  if (
    !run ||
    run.tested_sha !== verified.testedSha ||
    run.workflow_source_digest !== sourceDigest ||
    run.caller_workflow_path !== configuration.callerWorkflowPath ||
    run.reusable_workflow_ref !== configuration.reusableWorkflowRef ||
    run.capture_job_prefix !== configuration.captureJobName ||
    run.submit_job_name !== configuration.submitJobName ||
    run.submitted_at !== null ||
    run.retention_state !== "live"
  ) {
    throw new SecurityError("staged_run_conflict", 409, "The workflow attempt is already fixed.");
  }
  return run;
}

export async function declareStaged(
  request: Request,
  context: ApiContext,
  runId: string,
  shardKey: string,
) {
  workflowConfiguration(context);
  const { capability, run, job } = await stagedCapability(request, context, runId);
  if (run.submitted_at !== null || capability.shardKey !== shardKey) {
    throw new SecurityError("closed_shard", 409, "The staged shard is closed.");
  }
  const manifest = parseManifest(
    await jsonBody(request, context.configuration.limits.maximumManifestBytes),
  );
  await validateManifestProfiles(manifest);
  const discovery = manifest.discovery;
  if (
    !discovery ||
    !manifest.captureSources?.length ||
    manifest.profiles.some(
      ({ profile }) =>
        Object.hasOwn(profile, "comparisonPolicyDigest") ||
        Object.hasOwn(profile, "comparisonEngineVersion"),
    ) ||
    !context.configuration.trustedExecutorDigest ||
    !isTrustedWorkflowExecutor(context.configuration, discovery.executorDigest) ||
    discovery.inventoryDigest !==
      (await digestJson(
        manifest.tests.map(({ id, file, titlePath }) => ({ id, file, titlePath })),
      )) ||
    manifest.run.repository !== context.configuration.github.repository ||
    manifest.run.repositoryId !== run.repository_id ||
    manifest.run.workflowRunId !== run.workflow_run_id ||
    manifest.run.workflowAttempt !== run.workflow_attempt ||
    manifest.run.testedSha !== run.tested_sha ||
    manifest.run.planDigest !== run.workflow_source_digest ||
    manifest.shard.key !== shardKey ||
    manifest.shard.jobId !== job.job_id ||
    manifest.shard.sourceAttempt !== run.workflow_attempt
  ) {
    throw new SecurityError(
      "manifest_provenance",
      403,
      "The manifest does not belong to this trusted upload job.",
    );
  }
  const images = new Map<string, Manifest["captures"][number]["image"]>();
  for (const capture of manifest.captures) {
    const image = capture.image;
    const previous = images.get(image.digest);
    if (
      previous &&
      (previous.bytes !== image.bytes ||
        previous.width !== image.width ||
        previous.height !== image.height ||
        previous.mediaType !== image.mediaType)
    ) {
      throw new SecurityError("image_conflict", 400, "Image metadata conflicts within the shard.");
    }
    images.set(image.digest, image);
  }
  const observedImages = [...images.values()];
  const declaredBytes = observedImages.reduce((sum, image) => sum + image.bytes, 0);
  if (capability.comparisonMode === LOCAL_COMPARISON_MODE) {
    if (!manifest.localComparison || !capability.reference)
      throw new SecurityError(
        "local_comparison_required",
        409,
        "Local Submit requires its bound reference and complete comparison receipt.",
      );
    await validateLocalSubmission(context, run.id, manifest, capability.reference);
    images.clear();
    for (const [digest, image] of uploadImages(manifest)) images.set(digest, image);
  } else if (manifest.localComparison)
    throw new SecurityError(
      "comparison_mode",
      403,
      "A local receipt requires the negotiated signed Submit mode.",
    );
  const uploadBytes = [...images.values()].reduce((sum, image) => sum + image.bytes, 0);
  // Local comparison can add one mask for each original image.
  const maximumUploads =
    capability.maximumImages * (capability.comparisonMode === LOCAL_COMPARISON_MODE ? 2 : 1);
  if (
    manifest.captures.length > context.configuration.limits.maximumCaptures ||
    observedImages.length > capability.maximumImages ||
    images.size > maximumUploads ||
    declaredBytes > capability.maximumBytes ||
    uploadBytes > capability.maximumBytes ||
    [...observedImages, ...images.values()].some(
      (image) => image.bytes > context.configuration.limits.maximumImageBytes,
    )
  ) {
    throw new SecurityError("upload_limit", 413, "The shard exceeds its capture or byte limit.");
  }
  const existingManifest = await context.database
    .prepare("SELECT * FROM ingest_staged_manifests WHERE run_id = ? AND job_id = ?")
    .bind(run.id, job.job_id)
    .first<StagedManifestEvidence>();
  const encoded = await encodeManifestEvidence(
    manifest,
    context.configuration.limits.maximumManifestBytes,
    existingManifest?.evidence_page_bytes ?? undefined,
  );
  const manifestDigest = encoded.digest;
  const manifestObjectKey =
    existingManifest?.manifest_object_key ??
    `quarantine/staged/${run.id}/${job.job_id}/manifests/${manifestDigest}.json`;
  if (!existingManifest) {
    try {
      await atomic(context.database, [
        statement(
          context.database,
          "INSERT INTO ingest_staged_manifests (run_id, job_id, manifest_digest, manifest_object_key, declared_bytes, capture_count, created_at, evidence_version, evidence_bytes, capture_manifest_digest) SELECT ?, ?, ?, ?, ?, ?, ?, 1, ?, ? FROM ingest_staged_runs WHERE id = ? AND submitted_at IS NULL AND retention_state = 'live' ON CONFLICT(run_id, job_id) DO NOTHING",
          [
            run.id,
            job.job_id,
            manifestDigest,
            manifestObjectKey,
            declaredBytes,
            manifest.captures.length,
            Date.now(),
            encoded.bytes.byteLength,
            encoded.captureDigest,
            run.id,
          ],
        ),
        assertion(
          context.database,
          "(SELECT COALESCE(SUM(declared_bytes), 0) FROM ingest_staged_manifests WHERE run_id = ?) <= ?",
          [run.id, context.configuration.limits.maximumRunBytes ?? 2 * 1024 * 1024 * 1024],
        ),
        assertion(
          context.database,
          "(SELECT COALESCE(SUM(capture_count), 0) FROM ingest_staged_manifests WHERE run_id = ?) <= ?",
          [run.id, context.configuration.limits.maximumCaptures],
        ),
        assertion(
          context.database,
          `(
            SELECT COALESCE(SUM(manifest.declared_bytes), 0)
            FROM ingest_staged_manifests manifest
            JOIN ingest_staged_runs staged ON staged.id = manifest.run_id
            WHERE staged.retention_state IN ('live', 'deleting')
              AND NOT EXISTS (SELECT 1 FROM visonaut_runs run
                WHERE run.id = staged.id AND run.sealed_at IS NOT NULL)
          ) <= ?`,
          [context.configuration.limits.maximumStagedBytes!],
        ),
      ]);
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      const raced = await context.database
        .prepare("SELECT * FROM ingest_staged_manifests WHERE run_id = ? AND job_id = ?")
        .bind(run.id, job.job_id)
        .first<StagedManifestEvidence>();
      if (!raced) {
        throw new SecurityError(
          "upload_limit",
          413,
          "The staged workflow exceeds its original-byte or capture limit.",
        );
      }
    }
  }
  const storedManifest = await context.database
    .prepare("SELECT * FROM ingest_staged_manifests WHERE run_id = ? AND job_id = ?")
    .bind(run.id, job.job_id)
    .first<StagedManifestEvidence>();
  if (
    !storedManifest ||
    storedManifest.manifest_digest !== manifestDigest ||
    storedManifest.manifest_object_key !== manifestObjectKey ||
    storedManifest.declared_bytes !== declaredBytes ||
    storedManifest.capture_count !== manifest.captures.length ||
    (storedManifest.evidence_bytes !== null &&
      (storedManifest.evidence_bytes !== encoded.bytes.byteLength ||
        storedManifest.capture_manifest_digest !== encoded.captureDigest)) ||
    (storedManifest.evidence_version === 2 &&
      (storedManifest.evidence_page_count !== encoded.pages.length ||
        storedManifest.evidence_page_bytes !== encoded.pageBytes))
  ) {
    throw new SecurityError("manifest_conflict", 409, "The staged manifest is immutable.");
  }
  if (storedManifest.evidence_version === 1) {
    await writeManifestEvidence({
      context,
      database: context.database,
      stored: storedManifest,
      encoded,
    });
  } else if (!storedManifest.declaration_complete) {
    await writeEvidencePages({ database: context.database, stored: storedManifest, encoded });
  }
  await readManifestEvidence(context, storedManifest, true);
  // One bounded JSON parameter carries descriptors; SQL and parameter counts
  // stay constant even for the configured complete capture inventory.
  const descriptorPages = storedManifest.declaration_complete
    ? []
    : imageDescriptorPages({ images: images.values(), runId: run.id, jobId: job.job_id });
  for (const descriptors of descriptorPages) {
    await atomic(context.database, [
      evidenceFence(context.database, storedManifest),
      context.database
        .prepare(`INSERT INTO ingest_staged_images
        (run_id, job_id, digest, media_type, bytes, width, height, image_id, object_key, quarantine_key)
        SELECT manifest.run_id, manifest.job_id, json_extract(image.value, '$.digest'),
          json_extract(image.value, '$.mediaType'), json_extract(image.value, '$.bytes'),
          json_extract(image.value, '$.width'), json_extract(image.value, '$.height'),
          json_extract(image.value, '$.imageId'), json_extract(image.value, '$.objectKey'),
          json_extract(image.value, '$.quarantineKey')
        FROM ingest_staged_manifests manifest, json_each(?) image
        WHERE manifest.run_id = ? AND manifest.job_id = ? AND manifest.declaration_complete = 0
        ON CONFLICT(run_id, job_id, digest) DO NOTHING`)
        .bind(descriptors, run.id, job.job_id),
      assertion(
        context.database,
        `NOT EXISTS (SELECT 1 FROM json_each(?) expected
        LEFT JOIN ingest_staged_images image ON image.run_id = ? AND image.job_id = ?
          AND image.digest = json_extract(expected.value, '$.digest')
        WHERE image.digest IS NULL OR image.media_type != json_extract(expected.value, '$.mediaType')
          OR image.bytes != json_extract(expected.value, '$.bytes')
          OR image.width != json_extract(expected.value, '$.width')
          OR image.height != json_extract(expected.value, '$.height'))`,
        [descriptors, run.id, job.job_id],
      ),
    ]);
  }
  const stagedImages = await exactEvidenceImages(context, storedManifest, manifest);
  await atomic(context.database, [
    evidenceFence(context.database, storedManifest),
    ...evidenceImageAssertions(context.database, storedManifest, manifest),
    context.database
      .prepare(`UPDATE ingest_staged_manifests
      SET declaration_complete = 1, local_receipt_validated = ?
      WHERE run_id = ? AND job_id = ? AND declaration_complete = 0`)
      .bind(manifest.localComparison ? 1 : 0, run.id, job.job_id),
    assertion(
      context.database,
      `EXISTS (SELECT 1 FROM ingest_staged_manifests
      WHERE run_id = ? AND job_id = ? AND declaration_complete = 1
        AND local_receipt_validated = ?)`,
      [run.id, job.job_id, manifest.localComparison ? 1 : 0],
    ),
  ]);
  const runBytes = await context.database
    .prepare(
      "SELECT COALESCE(SUM(declared_bytes), 0) AS bytes FROM ingest_staged_manifests WHERE run_id = ?",
    )
    .bind(run.id)
    .first<{ bytes: number }>();
  if (
    !runBytes ||
    runBytes.bytes > (context.configuration.limits.maximumRunBytes ?? 2 * 1024 * 1024 * 1024)
  ) {
    throw new SecurityError("upload_limit", 413, "The run exceeds its original-byte limit.");
  }
  return Response.json({
    schemaVersion: SCHEMA_VERSION,
    manifestDigest,
    reuse: await issueReuseChallenge(context.configuration.capability, {
      runId: run.id,
      jobId: job.job_id,
      shardKey,
      manifestDigest,
    }),
    uploads: await Promise.all(
      stagedImages
        .filter((image) => !image.complete)
        .map(async (image) => ({
          imageDigest: image.digest,
          maxBytes: image.bytes,
          ticket: await issueUploadTicket(context.configuration.capability, {
            runId: run.id,
            shardKey,
            objectKey: image.quarantine_key,
            imageDigest: image.digest,
            mediaType: image.media_type,
            maximumBytes: image.bytes,
          }),
        })),
    ),
  });
}

async function requireAdmittedManifest(
  stored: StagedManifestEvidence,
  capability: IngestCapability,
  run: StagedRun,
) {
  if (stored.evidence_version === 1 && stored.evidence_bytes === null) return;
  if (stored.declaration_complete !== 1) {
    throw new IncompleteError("The staged declaration is incomplete.");
  }
  const local = capability.comparisonMode === LOCAL_COMPARISON_MODE;
  if (stored.local_receipt_validated !== (local ? 1 : 0)) {
    throw new SecurityError(
      "comparison_mode",
      403,
      "The upload mode differs from its admitted receipt.",
    );
  }
  if (!local) return;
  const reference = object(JSON.parse(run.verified_json)).localReference;
  if (
    !reference ||
    !capability.reference ||
    stored.capture_manifest_digest !== capability.reference.manifestDigest ||
    (await digestJson(reference)) !== (await digestJson(capability.reference))
  ) {
    throw new SecurityError(
      "reference_conflict",
      409,
      "The upload reference differs from its admitted receipt.",
    );
  }
}

interface ReuseSource {
  digest: string;
  source_object_key: string;
  source_bytes: number;
  source_width: number;
  source_height: number;
  source_media_type: string;
}

// Bound concurrent R2 operations within one byte-limited reuse page.
const reuseConcurrency = 6;

/** Copy only bytes that this signed job proves it holds. A digest alone is not possession. */
export async function reuseStagedImages(request: Request, context: ApiContext, runId: string) {
  const { capability, run, job } = await stagedCapability(request, context, runId);
  if (run.submitted_at !== null) {
    throw new SecurityError("closed_shard", 409, "The staged shard is closed.");
  }
  const body = await jsonBody(request, 16_384);
  validateVersion(body.schemaVersion);
  validateDigest(body.manifestDigest);
  const shardKey = string(body.shardKey);
  if (shardKey !== capability.shardKey) {
    throw new SecurityError("wrong_shard", 403, "The reuse page belongs to another shard.");
  }
  const stored = await context.database
    .prepare("SELECT * FROM ingest_staged_manifests WHERE run_id = ? AND job_id = ?")
    .bind(run.id, job.job_id)
    .first<StagedManifestEvidence>();
  if (!stored || stored.manifest_digest !== body.manifestDigest) {
    throw new SecurityError("manifest_conflict", 409, "The staged manifest changed.");
  }
  await requireAdmittedManifest(stored, capability, run);
  const challenge = await verifyReuseChallenge(
    context.configuration.capability,
    string(body.challenge, 4096),
    capability,
    stored.manifest_digest,
  );
  if (
    !Array.isArray(body.proofs) ||
    body.proofs.length < 1 ||
    body.proofs.length > maximumReusePage
  ) {
    throw new SecurityError("invalid_body", 400, "The reuse page is invalid.");
  }
  const proofs = new Map<string, string>();
  for (const entry of body.proofs) {
    const item = object(entry);
    const digest = string(item.imageDigest, 64);
    const proof = string(item.proof, 64);
    if (!/^[a-f0-9]{64}$/.test(digest) || !/^[a-f0-9]{64}$/.test(proof) || proofs.has(digest)) {
      throw new SecurityError("invalid_body", 400, "The reuse proof is invalid.");
    }
    proofs.set(digest, proof);
  }
  const digests = [...proofs.keys()];
  const targets = await context.database
    .prepare(
      `SELECT * FROM ingest_staged_images WHERE run_id = ? AND job_id = ?
        AND digest IN (SELECT value FROM json_each(?))`,
    )
    .bind(run.id, job.job_id, JSON.stringify(digests))
    .all<StagedImage>();
  if (targets.results.length !== digests.length) {
    throw new SecurityError("unknown_image", 403, "The reuse page names an undeclared image.");
  }
  const declaredBytes = targets.results.reduce((sum, image) => sum + image.bytes, 0);
  if (targets.results.length > 1 && declaredBytes > maximumReusePageBytes) {
    throw new SecurityError("upload_limit", 413, "The reuse page exceeds its byte limit.");
  }
  const pending = targets.results.filter((image) => !image.complete);
  const reused = targets.results.filter((image) => image.complete).map((image) => image.digest);
  if (!pending.length) {
    await atomic(context.database, [
      evidenceFence(context.database, stored),
      assertion(
        context.database,
        `(SELECT COUNT(*) FROM ingest_staged_images
        WHERE run_id = ? AND job_id = ? AND complete = 1
          AND digest IN (SELECT value FROM json_each(?))) = ?`,
        [run.id, job.job_id, JSON.stringify(reused), reused.length],
      ),
    ]);
    return Response.json({ schemaVersion: SCHEMA_VERSION, reused });
  }
  const sources = await context.database
    .prepare(
      `WITH candidates AS (
        SELECT source.digest, source.object_key AS source_object_key,
          source.bytes AS source_bytes, source.width AS source_width,
          source.height AS source_height, source.media_type AS source_media_type,
          ROW_NUMBER() OVER (
            PARTITION BY source.digest ORDER BY previous.created_at DESC, source.run_id DESC
          ) AS position
        FROM ingest_staged_images source
        JOIN ingest_staged_images target ON target.digest = source.digest
          AND target.run_id = ? AND target.job_id = ? AND target.complete = 0
          AND target.bytes = source.bytes AND target.width = source.width
          AND target.height = source.height AND target.media_type = source.media_type
        JOIN ingest_staged_runs previous ON previous.id = source.run_id
        WHERE source.digest IN (SELECT value FROM json_each(?))
          AND source.complete = 1 AND previous.retention_state = 'live'
          AND previous.submitted_at IS NOT NULL AND previous.repository_id = ?
          AND previous.id != ?
      ) SELECT * FROM candidates WHERE position <= 3 ORDER BY digest, position`,
    )
    .bind(
      run.id,
      job.job_id,
      JSON.stringify(pending.map((image) => image.digest)),
      run.repository_id,
      run.id,
    )
    .all<ReuseSource>();
  const candidates = new Map<string, ReuseSource[]>();
  for (const source of sources.results) {
    const list = candidates.get(source.digest) ?? [];
    list.push(source);
    candidates.set(source.digest, list);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    hexBytes(challenge.nonce),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  // The declared page is byte-bounded, so verification can finish before any
  // target write. A later bad proof cannot leave an uncommitted copied object.
  const verifyTarget = async (target: StagedImage) => {
    for (const source of candidates.get(target.digest) ?? []) {
      if (
        source.source_bytes !== target.bytes ||
        source.source_width !== target.width ||
        source.source_height !== target.height ||
        source.source_media_type !== target.media_type
      )
        continue;
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        const storedSource = await context.images.get(source.source_object_key);
        if (!storedSource || storedSource.size !== target.bytes) continue;
        bytes = new Uint8Array(await storedSource.arrayBuffer());
      } catch {
        continue;
      }
      if (bytes.byteLength !== target.bytes || (await sha256(bytes)) !== target.digest) continue;
      if (!(await crypto.subtle.verify("HMAC", key, hexBytes(proofs.get(target.digest)!), bytes))) {
        throw new SecurityError(
          "invalid_proof",
          422,
          "The image reuse proof does not match its bytes.",
        );
      }
      return { target, bytes };
    }
    return null;
  };

  const verified: { target: StagedImage; bytes: Uint8Array<ArrayBuffer> }[] = [];
  for (let offset = 0; offset < pending.length; offset += reuseConcurrency) {
    const batch = await Promise.all(
      pending.slice(offset, offset + reuseConcurrency).map(verifyTarget),
    );
    for (const result of batch) {
      if (result) {
        verified.push(result);
      }
    }
  }
  for (let offset = 0; offset < verified.length; offset += reuseConcurrency) {
    const batch = await Promise.all(
      verified.slice(offset, offset + reuseConcurrency).map(async ({ target, bytes }) => {
        try {
          await context.images.put(target.object_key, bytes, {
            httpMetadata: { contentType: target.media_type },
            sha256: target.digest,
          });
          return target.digest;
        } catch {
          return null;
        }
      }),
    );
    for (const digest of batch) {
      if (digest) {
        reused.push(digest);
      }
    }
  }
  if (reused.length) {
    await atomic(context.database, [
      evidenceFence(context.database, stored),
      context.database
        .prepare(`UPDATE ingest_staged_images SET complete = 1
        WHERE run_id = ? AND job_id = ? AND complete = 0
          AND digest IN (SELECT value FROM json_each(?))`)
        .bind(run.id, job.job_id, JSON.stringify(reused)),
      assertion(
        context.database,
        `(SELECT COUNT(*) FROM ingest_staged_images
        WHERE run_id = ? AND job_id = ? AND complete = 1
          AND digest IN (SELECT value FROM json_each(?))) = ?`,
        [run.id, job.job_id, JSON.stringify(reused), reused.length],
      ),
    ]);
  }
  return Response.json({ schemaVersion: SCHEMA_VERSION, reused });
}

export async function uploadStagedImage(
  request: Request,
  context: ApiContext,
  ticketToken: string,
) {
  const { capability, run, job } = await stagedCapability(request, context);
  const ticket = await verifyUploadTicket(
    context.configuration.capability,
    ticketToken,
    capability,
  );
  if (run.submitted_at !== null) {
    throw new SecurityError("closed_shard", 409, "The staged shard is closed.");
  }
  const image = await context.database
    .prepare(
      "SELECT * FROM ingest_staged_images WHERE run_id = ? AND job_id = ? AND quarantine_key = ?",
    )
    .bind(run.id, job.job_id, ticket.objectKey)
    .first<StagedImage>();
  if (
    !image ||
    image.digest !== ticket.imageDigest ||
    image.media_type !== ticket.mediaType ||
    image.bytes !== ticket.maximumBytes
  ) {
    throw new SecurityError("unknown_ticket", 403, "The image ticket is not declared.");
  }
  const stored = await stagedManifestEvidence(context, run.id, job.job_id);
  await requireAdmittedManifest(stored, capability, run);
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== image.media_type) {
    throw new SecurityError("invalid_content_type", 415, "The image content type differs.");
  }
  const bytes = await readBoundedBody(
    request,
    Math.min(image.bytes, context.configuration.limits.maximumImageBytes),
  );
  if (bytes.byteLength !== image.bytes || (await sha256(bytes)) !== image.digest) {
    throw new SecurityError("image_mismatch", 422, "The image digest or size differs.");
  }
  if (image.complete) {
    await atomic(context.database, [
      evidenceFence(context.database, stored),
      assertion(
        context.database,
        `EXISTS (SELECT 1 FROM ingest_staged_images
        WHERE run_id = ? AND job_id = ? AND digest = ? AND complete = 1
          AND media_type = ? AND bytes = ? AND width = ? AND height = ?)`,
        [
          run.id,
          job.job_id,
          image.digest,
          image.media_type,
          image.bytes,
          image.width,
          image.height,
        ],
      ),
    ]);
    return new Response(null, { status: 204 });
  }
  if (capability.comparisonMode !== LOCAL_COMPARISON_MODE) {
    const validation = await context.comparator.fetch("https://compare.internal/validate", {
      method: "POST",
      body: bytes,
      headers: { "content-type": image.media_type },
    });
    if (validation.status === 503) {
      throw new SecurityError("validation_busy", 503, "Image validation is busy. Retry.");
    }
    if (!validation.ok) {
      throw new SecurityError("invalid_image", 422, "The image failed trusted decoding.");
    }
    const decoded = object(
      JSON.parse(new TextDecoder().decode(await readBoundedBody(validation, 16_384))),
    );
    if (
      decoded.digest !== image.digest ||
      decoded.bytes !== bytes.byteLength ||
      decoded.width !== image.width ||
      decoded.height !== image.height ||
      decoded.contentType !== image.media_type
    ) {
      throw new SecurityError("image_mismatch", 422, "The decoded image metadata differs.");
    }
  } else {
    if (
      stored.evidence_version === 1 &&
      stored.evidence_bytes === null &&
      !(await readManifestEvidence(context, stored)).localComparison
    ) {
      throw new SecurityError(
        "local_comparison_required",
        403,
        "Local image upload requires an admitted signed Submit receipt.",
      );
    }
  }
  await context.images.put(image.object_key, bytes, {
    httpMetadata: { contentType: image.media_type },
    sha256: image.digest,
  });
  await atomic(context.database, [
    evidenceFence(context.database, stored),
    context.database
      .prepare(`UPDATE ingest_staged_images SET complete = 1
      WHERE run_id = ? AND job_id = ? AND digest = ? AND complete = 0`)
      .bind(run.id, job.job_id, image.digest),
    assertion(
      context.database,
      `EXISTS (SELECT 1 FROM ingest_staged_images
      WHERE run_id = ? AND job_id = ? AND digest = ? AND complete = 1
        AND media_type = ? AND bytes = ? AND width = ? AND height = ?)`,
      [run.id, job.job_id, image.digest, image.media_type, image.bytes, image.width, image.height],
    ),
  ]);
  return new Response(null, { status: 204 });
}

export async function finalizeStaged(request: Request, context: ApiContext, runId: string) {
  const { capability, run, job } = await stagedCapability(request, context, runId);
  const body = await jsonBody(request, 16_384);
  validateVersion(body.schemaVersion);
  validateDigest(body.manifestDigest);
  if (run.submitted_at !== null || body.shardKey !== capability.shardKey) {
    throw new SecurityError("closed_shard", 409, "The staged shard is closed.");
  }
  const stored = await context.database
    .prepare("SELECT * FROM ingest_staged_manifests WHERE run_id = ? AND job_id = ?")
    .bind(run.id, job.job_id)
    .first<StagedManifestEvidence>();
  if (!stored || stored.manifest_digest !== body.manifestDigest) {
    throw new SecurityError("manifest_conflict", 409, "The staged manifest differs.");
  }
  await requireAdmittedManifest(stored, capability, run);
  const manifest = await readManifestEvidence(context, stored);
  await validateManifestProfiles(manifest);
  if (manifest.localComparison) {
    await validateLocalSubmission(context, run.id, manifest, capability.reference);
  }
  await exactEvidenceImages(context, stored, manifest, true);
  await atomic(context.database, [
    evidenceFence(context.database, stored),
    ...evidenceImageAssertions(context.database, stored, manifest, true),
    context.database
      .prepare(`UPDATE ingest_staged_manifests SET complete = 1
      WHERE run_id = ? AND job_id = ? AND complete = 0
        AND (evidence_version = 1 OR declaration_complete = 1)`)
      .bind(run.id, job.job_id),
    assertion(
      context.database,
      `EXISTS (SELECT 1 FROM ingest_staged_manifests
      WHERE run_id = ? AND job_id = ? AND complete = 1)`,
      [run.id, job.job_id],
    ),
  ]);
  return Response.json(
    {
      schemaVersion: SCHEMA_VERSION,
      runId: run.id,
      shardKey: job.shard_key,
      manifestDigest: stored.manifest_digest,
      state: "staged",
    },
    { status: 202 },
  );
}

export async function submitStaged(request: Request, context: ApiContext, externalRunId: string) {
  const body = await jsonBody(request, 4096);
  validateVersion(body.schemaVersion);
  const workflowAttempt = integer(body.workflowAttempt, 1);
  let run = await context.database
    .prepare(
      `SELECT * FROM ingest_staged_runs WHERE repository_id = ? AND workflow_run_id = ? AND workflow_attempt = ? AND ${afterRestoreSql("ingest_staged_runs.created_at")}`,
    )
    .bind(context.configuration.github.repositoryId, externalRunId, workflowAttempt)
    .first<StagedRun>();
  // A rerun of only the submit job can carry every earlier successful upload.
  // Seed its new attempt from prior signed stage identity, then verify the new
  // submit OIDC token before allocating the current attempt's stable run ID.
  const seed =
    run ??
    (await context.database
      .prepare(
        `SELECT * FROM ingest_staged_runs WHERE repository_id = ? AND workflow_run_id = ? AND workflow_attempt < ? AND ${afterRestoreSql("ingest_staged_runs.created_at")} ORDER BY workflow_attempt DESC LIMIT 1`,
      )
      .bind(context.configuration.github.repositoryId, externalRunId, workflowAttempt)
      .first<StagedRun>());
  if (!seed || seed.retention_state !== "live") {
    throw new SecurityError("not_found", 404, "A signed staged workflow was not found.");
  }
  const configuration = workflowConfiguration(context);
  if (
    seed.workflow_source_digest !==
      (await workflowSourceDigest(configuration.reusableWorkflowSha)) ||
    seed.caller_workflow_path !== configuration.callerWorkflowPath ||
    seed.reusable_workflow_ref !== configuration.reusableWorkflowRef ||
    seed.capture_job_prefix !== configuration.captureJobName ||
    seed.submit_job_name !== configuration.submitJobName
  ) {
    throw new SecurityError("wrong_workflow_source", 403, "The workflow source changed.");
  }
  const github = await createGitHubClient(context.configuration.github);
  const verified = await verifyWorkflowJob(
    request,
    context,
    github,
    {
      schemaVersion: SCHEMA_VERSION,
      repository: github.repository,
      repositoryId: seed.repository_id,
      workflowRunId: externalRunId,
      workflowAttempt,
      testedSha: seed.tested_sha,
      planDigest: seed.workflow_source_digest,
      shardKey: "submit",
    },
    configuration.submitJobName,
    new URL("/submit", context.configuration.origin).href,
  );
  await ensureSignedAttemptCheck(context, github, verified);
  await recordRequiredVisualPlan(context, github, verified);
  await requireVisualPlan(context, {
    testedSha: verified.testedSha,
    workflowRunId: verified.workflowRunId,
    workflowAttempt: verified.workflowAttempt,
  });
  if (!run) {
    run = await reserveVerifiedStagedRun(context, verified, seed.workflow_source_digest);
  }
  if (
    !run ||
    run.tested_sha !== verified.testedSha ||
    run.workflow_source_digest !== seed.workflow_source_digest ||
    run.caller_workflow_path !== configuration.callerWorkflowPath ||
    run.reusable_workflow_ref !== configuration.reusableWorkflowRef ||
    run.capture_job_prefix !== configuration.captureJobName ||
    run.submit_job_name !== configuration.submitJobName ||
    run.retention_state !== "live"
  ) {
    throw new SecurityError("submit_conflict", 409, "The workflow attempt identity changed.");
  }
  if (run.submitted_at !== null) {
    if (run.submit_job_id !== verified.jobId || run.submit_check_run_id !== verified.checkRunId) {
      throw new SecurityError("submit_conflict", 409, "Another job submitted this run.");
    }
    return Response.json(
      {
        schemaVersion: SCHEMA_VERSION,
        runId: run.id,
        state: "submitted",
        submittedAt: run.submitted_at,
      },
      { status: 202 },
    );
  }
  // A rerun of only the submit job can carry every earlier successful upload.
  // The terminal GitHub job list, not this attempt's staged rows, proves completeness.
  const submittedAt = Date.now();
  await context.database
    .prepare(
      "UPDATE ingest_staged_runs SET submit_job_id = ?, submit_check_run_id = ?, submit_verified_json = ?, submitted_at = ? WHERE id = ? AND submitted_at IS NULL AND retention_state = 'live'",
    )
    .bind(verified.jobId, verified.checkRunId, JSON.stringify(verified), submittedAt, run.id)
    .run();
  const submitted = await stagedRun(context, run.id);
  if (
    submitted.submit_job_id !== verified.jobId ||
    submitted.submit_check_run_id !== verified.checkRunId ||
    submitted.submitted_at === null
  ) {
    throw new SecurityError("submit_conflict", 409, "Another job submitted this run.");
  }
  await context.operations.send({ kind: "ingest" });
  return Response.json(
    {
      schemaVersion: SCHEMA_VERSION,
      runId: run.id,
      state: "submitted",
      submittedAt: submitted.submitted_at,
    },
    { status: 202 },
  );
}
