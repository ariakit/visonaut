import {
  digestJson,
  parseManifest,
  SCHEMA_VERSION,
  sha256,
  validateDigest,
  validateKey,
  validateManifestProfiles,
  validateVersion,
  workflowSourceDigest,
  type Manifest,
  type ReserveRunRequest,
} from "@visonaut/protocol";
import {
  bearerToken,
  createGitHubClient,
  issueIngestCapability,
  issueUploadTicket,
  readBoundedBody,
  SecurityError,
  verifyGitHubOidc,
  verifyIngestCapability,
  verifyUploadTicket,
  type GitHubClient,
  type IngestCapability,
  type VerifiedRun,
} from "@visonaut/security";
import { assertion, atomic, ConflictError, IncompleteError, statement } from "@visonaut/service";
import { loadVerifiedMergeGroup, type ApiContext } from "./context.js";
import { integer, jsonBody, object, string } from "./input.js";

interface StagedRun {
  id: string;
  repository_id: string;
  workflow_run_id: string;
  workflow_attempt: number;
  tested_sha: string;
  workflow_source_digest: string;
  caller_workflow_path: string;
  reusable_workflow_ref: string;
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

interface StagedManifest {
  manifest_digest: string;
  manifest_object_key: string;
  declared_bytes: number;
  capture_count: number;
  complete: number;
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

export function workflowConfiguration(context: ApiContext) {
  const configuration = context.configuration.workflowOwned;
  const maximumStagedBytes = context.configuration.limits.maximumStagedBytes;
  if (
    !configuration ||
    !Number.isSafeInteger(maximumStagedBytes) ||
    !maximumStagedBytes ||
    maximumStagedBytes < 1 ||
    !/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/.test(configuration.callerWorkflowPath) ||
    configuration.captureJobPrefix.length < 12 ||
    configuration.captureJobPrefix.length > 200 ||
    !configuration.captureJobPrefix.endsWith(" / ") ||
    !configuration.submitJobName ||
    configuration.submitJobName.length > 256 ||
    !/^[a-f0-9]{40}$/.test(configuration.reusableWorkflowSha) ||
    // Only Ariakit may call the public diagnostics workflow as its pinned source.
    !(
      configuration.reusableWorkflowRef.startsWith(
        `${context.configuration.github.repository}/.github/workflows/`,
      ) ||
      (context.configuration.github.repository === "ariakit/ariakit" &&
        configuration.reusableWorkflowRef ===
          `ariakit/visonaut-diagnostics/.github/workflows/visonaut-capture.yml@${configuration.reusableWorkflowSha}`)
    ) ||
    !configuration.reusableWorkflowRef.endsWith(`@${configuration.reusableWorkflowSha}`)
  ) {
    throw new SecurityError(
      "workflow_configuration",
      503,
      "The trusted workflow is not configured.",
    );
  }
  return configuration;
}

function reserveRequest(body: Record<string, unknown>): ReserveRunRequest {
  validateVersion(body.schemaVersion);
  validateDigest(body.planDigest);
  validateKey(body.shardKey, "shardKey");
  const testedSha = string(body.testedSha, 40);
  if (!/^[a-f0-9]{40}$/.test(testedSha)) {
    throw new SecurityError("invalid_sha", 400, "A full tested SHA is required.");
  }
  return {
    schemaVersion: body.schemaVersion,
    repository: string(body.repository),
    repositoryId: string(body.repositoryId),
    workflowRunId: string(body.workflowRunId),
    workflowAttempt: integer(body.workflowAttempt, 1),
    testedSha,
    planDigest: body.planDigest,
    shardKey: body.shardKey,
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
      allowMainDispatch:
        context.configuration.auth.environment === "preview" &&
        context.configuration.allowMainDispatch === true,
      repositoryOwnerId: context.configuration.repositoryOwnerId,
      workflowPath: configuration.callerWorkflowPath,
      reusableWorkflowRef: configuration.reusableWorkflowRef,
      reusableWorkflowSha: configuration.reusableWorkflowSha,
      planDigest: identity.planDigest,
      shards: [{ key: identity.shardKey, jobName }],
      loadMergeGroup: (testedSha) => loadVerifiedMergeGroup(context, testedSha),
    },
  });
}

async function stagedRun(context: ApiContext, runId: string): Promise<StagedRun> {
  const run = await context.database
    .prepare("SELECT * FROM ingest_staged_runs WHERE id = ?")
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

async function stagedCapability(request: Request, context: ApiContext, runId?: string) {
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

export async function reserveStaged(request: Request, context: ApiContext) {
  const body = reserveRequest(await jsonBody(request, 32_768));
  const configuration = workflowConfiguration(context);
  const sourceDigest = await workflowSourceDigest(configuration.reusableWorkflowSha);
  if (body.planDigest !== sourceDigest) {
    throw new SecurityError("wrong_workflow_source", 403, "The workflow source changed.");
  }
  const github = await createGitHubClient(context.configuration.github);
  const verified = await verifyWorkflowJob(
    request,
    context,
    github,
    body,
    `${configuration.captureJobPrefix}${body.shardKey}`,
    context.configuration.oidcAudience,
  );
  const run = await reserveVerifiedStagedRun(context, verified, sourceDigest);
  const jobName = `${configuration.captureJobPrefix}${body.shardKey}`;
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
  };
  return Response.json(
    {
      schemaVersion: SCHEMA_VERSION,
      runId: run.id,
      capability: await issueIngestCapability(context.configuration.capability, capability),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
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
        configuration.captureJobPrefix,
        configuration.submitJobName,
        JSON.stringify(verified),
        Date.now(),
      )
      .run();
  }
  const run = await context.database
    .prepare(
      "SELECT * FROM ingest_staged_runs WHERE repository_id = ? AND workflow_run_id = ? AND workflow_attempt = ?",
    )
    .bind(verified.repositoryId, verified.workflowRunId, verified.workflowAttempt)
    .first<StagedRun>();
  if (
    !run ||
    run.tested_sha !== verified.testedSha ||
    run.workflow_source_digest !== sourceDigest ||
    run.caller_workflow_path !== configuration.callerWorkflowPath ||
    run.reusable_workflow_ref !== configuration.reusableWorkflowRef ||
    run.capture_job_prefix !== configuration.captureJobPrefix ||
    run.submit_job_name !== configuration.submitJobName ||
    run.submitted_at !== null ||
    run.retention_state !== "live"
  ) {
    throw new SecurityError("staged_run_conflict", 409, "The workflow attempt is already fixed.");
  }
  return run;
}

async function privateManifest(context: ApiContext, key: string): Promise<Manifest> {
  const stored = await context.quarantine.get(key);
  if (!stored || stored.size > context.configuration.limits.maximumManifestBytes) {
    throw new IncompleteError("The staged manifest is unavailable.");
  }
  return parseManifest(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await stored.arrayBuffer())),
  );
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
    !context.configuration.trustedExecutorDigest ||
    discovery.executorDigest !== context.configuration.trustedExecutorDigest ||
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
  const declaredBytes = [...images.values()].reduce((sum, image) => sum + image.bytes, 0);
  if (
    manifest.captures.length > context.configuration.limits.maximumCaptures ||
    images.size > capability.maximumImages ||
    declaredBytes > capability.maximumBytes ||
    [...images.values()].some(
      (image) => image.bytes > context.configuration.limits.maximumImageBytes,
    )
  ) {
    throw new SecurityError("upload_limit", 413, "The shard exceeds its capture or byte limit.");
  }
  const manifestDigest = await digestJson(manifest);
  const manifestObjectKey = `manifests/${run.id}/${manifestDigest}.json`;
  const existingManifest = await context.database
    .prepare("SELECT * FROM ingest_staged_manifests WHERE run_id = ? AND job_id = ?")
    .bind(run.id, job.job_id)
    .first<StagedManifest>();
  if (!existingManifest) {
    try {
      await atomic(context.database, [
        statement(
          context.database,
          "INSERT INTO ingest_staged_manifests (run_id, job_id, manifest_digest, manifest_object_key, declared_bytes, capture_count, created_at) SELECT ?, ?, ?, ?, ?, ?, ? FROM ingest_staged_runs WHERE id = ? AND submitted_at IS NULL AND retention_state = 'live' ON CONFLICT(run_id, job_id) DO NOTHING",
          [
            run.id,
            job.job_id,
            manifestDigest,
            manifestObjectKey,
            declaredBytes,
            manifest.captures.length,
            Date.now(),
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
        .first<StagedManifest>();
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
    .first<StagedManifest>();
  if (
    !storedManifest ||
    storedManifest.manifest_digest !== manifestDigest ||
    storedManifest.manifest_object_key !== manifestObjectKey ||
    storedManifest.declared_bytes !== declaredBytes ||
    storedManifest.capture_count !== manifest.captures.length
  ) {
    throw new SecurityError("manifest_conflict", 409, "The staged manifest is immutable.");
  }
  await context.quarantine.put(manifestObjectKey, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json" },
  });
  const entries = [...images.values()];
  for (let offset = 0; offset < entries.length; offset += 50) {
    const batch = entries.slice(offset, offset + 50);
    await atomic(context.database, [
      assertion(
        context.database,
        "EXISTS (SELECT 1 FROM ingest_staged_runs WHERE id = ? AND submitted_at IS NULL AND retention_state = 'live')",
        [run.id],
      ),
      ...batch.map((image) => {
        const imageId = crypto.randomUUID();
        const quarantineKey = `quarantine/staged/${run.id}/${job.job_id}/${image.digest}`;
        return statement(
          context.database,
          "INSERT INTO ingest_staged_images (run_id, job_id, digest, media_type, bytes, width, height, image_id, object_key, quarantine_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id, job_id, digest) DO NOTHING",
          [
            run.id,
            job.job_id,
            image.digest,
            image.mediaType,
            image.bytes,
            image.width,
            image.height,
            imageId,
            `runs/${run.id}/images/${imageId}`,
            quarantineKey,
          ],
        );
      }),
    ]);
  }
  const stagedImages = await context.database
    .prepare("SELECT * FROM ingest_staged_images WHERE run_id = ? AND job_id = ?")
    .bind(run.id, job.job_id)
    .all<StagedImage>();
  if (stagedImages.results.length !== images.size) {
    throw new SecurityError("image_conflict", 409, "The staged image set changed.");
  }
  for (const staged of stagedImages.results) {
    const image = images.get(staged.digest);
    if (
      !image ||
      staged.media_type !== image.mediaType ||
      staged.bytes !== image.bytes ||
      staged.width !== image.width ||
      staged.height !== image.height
    ) {
      throw new SecurityError("image_conflict", 409, "The staged image metadata changed.");
    }
  }
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
    uploads: await Promise.all(
      stagedImages.results
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
  if (image.complete) return new Response(null, { status: 204 });
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
  await context.images.put(image.object_key, bytes, {
    httpMetadata: { contentType: image.media_type },
  });
  await context.database
    .prepare(
      "UPDATE ingest_staged_images SET complete = 1 WHERE run_id = ? AND job_id = ? AND digest = ?",
    )
    .bind(run.id, job.job_id, image.digest)
    .run();
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
    .first<StagedManifest>();
  if (!stored || stored.manifest_digest !== body.manifestDigest) {
    throw new SecurityError("manifest_conflict", 409, "The staged manifest differs.");
  }
  const manifest = await privateManifest(context, stored.manifest_object_key);
  if ((await digestJson(manifest)) !== stored.manifest_digest) {
    throw new SecurityError("manifest_conflict", 409, "The stored manifest digest differs.");
  }
  await validateManifestProfiles(manifest);
  const expectedImages = new Set(manifest.captures.map((capture) => capture.image.digest));
  const images = await context.database
    .prepare("SELECT * FROM ingest_staged_images WHERE run_id = ? AND job_id = ?")
    .bind(run.id, job.job_id)
    .all<StagedImage>();
  if (
    images.results.length !== expectedImages.size ||
    images.results.some((image) => !image.complete || !expectedImages.has(image.digest))
  ) {
    throw new IncompleteError("Every declared image must pass validation before staging.");
  }
  await context.database
    .prepare(
      "UPDATE ingest_staged_manifests SET complete = 1 WHERE run_id = ? AND job_id = ? AND manifest_digest = ?",
    )
    .bind(run.id, job.job_id, stored.manifest_digest)
    .run();
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
      "SELECT * FROM ingest_staged_runs WHERE repository_id = ? AND workflow_run_id = ? AND workflow_attempt = ?",
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
        "SELECT * FROM ingest_staged_runs WHERE repository_id = ? AND workflow_run_id = ? AND workflow_attempt < ? ORDER BY workflow_attempt DESC LIMIT 1",
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
    seed.capture_job_prefix !== configuration.captureJobPrefix ||
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
  if (!run) {
    run = await reserveVerifiedStagedRun(context, verified, seed.workflow_source_digest);
  }
  if (
    !run ||
    run.tested_sha !== verified.testedSha ||
    run.workflow_source_digest !== seed.workflow_source_digest ||
    run.caller_workflow_path !== configuration.callerWorkflowPath ||
    run.reusable_workflow_ref !== configuration.reusableWorkflowRef ||
    run.capture_job_prefix !== configuration.captureJobPrefix ||
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
  await context.operations.send({ kind: "continue" });
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
