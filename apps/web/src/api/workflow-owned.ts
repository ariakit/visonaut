import {
  canonicalJson,
  captureJobNames,
  CAPTURE_PAGE_MAX_BYTES,
  CAPTURE_PAGES_MODE,
  capturePageUploads,
  parseCapturePage,
  SCHEMA_VERSION,
  sha256,
  validateDigest,
  validateKey,
  validateVersion,
  type CaptureReference,
  type CaptureRowImage,
  type ReservePagesRequest,
} from "@visonaut/protocol";
import {
  currentReference,
  referenceCaptureInputs,
  referenceImage,
  referencePage,
  runReference,
  selectReference,
  validateRunPages,
} from "./local-comparison.ts";
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
  type RunReservation,
  type VerifiedRun,
} from "@visonaut/security";
import { assertion, atomic, ConflictError, IncompleteError, statement } from "@visonaut/service";
import { loadVerifiedMergeGroup, type ApiConfiguration, type ApiContext } from "./context.js";
import { integer, jsonBody, object, string } from "./input.js";
import {
  ensureSignedAttemptCheck,
  recordRequiredVisualPlan,
  requireVisualPlan,
} from "./pre-run.js";
import {
  captureLimitExceeded,
  exactEvidenceImages,
  imageDescriptorPages,
  listStagedPages,
  parseStagedIndex,
  readStagedPages,
  runPageImages,
  stagedIndexKey,
  stagedPageKey,
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
const workflowPathPattern = /^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/;

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
    !workflowPathPattern.test(configuration.callerWorkflowPath) ||
    !workflowPathPattern.test(configuration.reusableWorkflowPath) ||
    !configuration.submitJobName ||
    configuration.submitJobName.length > 256
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

function reserveRequest(body: Record<string, unknown>): ReservePagesRequest {
  validateVersion(body.schemaVersion);
  validateDigest(body.planDigest);
  validateKey(body.shardKey, "shardKey");
  const testedSha = string(body.testedSha, 40);
  if (!/^[a-f0-9]{40}$/.test(testedSha)) {
    throw new SecurityError("invalid_sha", 400, "A full tested SHA is required.");
  }
  // The service accepts one request form: the captures as pages of rows.
  if (body.comparisonMode !== CAPTURE_PAGES_MODE) {
    throw new SecurityError(
      "capture_pages_required",
      409,
      "The service accepts only capture pages. Upgrade the Visonaut CLI and run Submit again.",
    );
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
    comparisonMode: CAPTURE_PAGES_MODE,
  };
}

/** The stored identity of a signed job keeps the schema version of its request. */
interface WorkflowJobIdentity extends RunReservation {
  schemaVersion: string;
}

async function verifyWorkflowJob(
  request: Request,
  context: ApiContext,
  github: GitHubClient,
  identity: WorkflowJobIdentity,
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

interface StagedReferencePageParams {
  runId: string;
  /** The identity of the reference, from the reserve answer. */
  digest: string;
  /** The page number. It starts at 1. */
  page: number;
}

export async function stagedReferencePage(
  request: Request,
  context: ApiContext,
  { runId, digest, page }: StagedReferencePageParams,
) {
  const { run } = await stagedCapability(request, context, runId);
  return referencePage({ context, run, digest, page });
}

export async function stagedReferenceImage(
  request: Request,
  context: ApiContext,
  { runId, digest }: Omit<StagedReferencePageParams, "page">,
) {
  const { run } = await stagedCapability(request, context, runId);
  return referenceImage({ request, context, run, digest });
}

/** Begin the App check before artifact downloads or image staging. */
export async function beginStaged(request: Request, context: ApiContext, externalRunId: string) {
  const body = await jsonBody(request, 32_768);
  validateVersion(body.schemaVersion);
  const configuration = workflowConfiguration(context);
  const identity: WorkflowJobIdentity = {
    schemaVersion: SCHEMA_VERSION,
    repository: context.configuration.github.repository,
    repositoryId: context.configuration.github.repositoryId,
    workflowRunId: externalRunId,
    workflowAttempt: integer(body.workflowAttempt, 1),
    testedSha: string(body.testedSha, 40),
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
  // The attempt keeps the digest of its first reserve call. No setting fixes it.
  const run = await reserveVerifiedStagedRun(context, verified, body.planDigest);
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
  const stored = runReference(run);
  // Only the first reserve call of a run selects its reference. A renewal
  // reads no object of the reference.
  const reference = stored.reference ?? (await selectReference(context, run));
  await currentReference(context, reference, stored.pullRequest);
  const capability: IngestCapability = {
    runId: run.id,
    repositoryId: verified.repositoryId,
    workflowRunId: verified.workflowRunId,
    workflowAttempt: verified.workflowAttempt,
    testedSha: verified.testedSha,
    planDigest: body.planDigest,
    shardKey: body.shardKey,
    jobId: verified.jobId,
    maximumBytes: context.configuration.limits.maximumShardBytes,
    maximumImages: context.configuration.limits.maximumCaptures,
  };
  const { snapshotId, baselineRevision, digest, pages } = reference;
  return Response.json(
    {
      schemaVersion: SCHEMA_VERSION,
      runId: run.id,
      capability: await issueIngestCapability(context.configuration.capability, capability),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      comparisonMode: CAPTURE_PAGES_MODE,
      reference: { snapshotId, baselineRevision, digest, pages } satisfies CaptureReference,
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
        `${context.configuration.github.repository}/${configuration.reusableWorkflowPath}`,
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
    run.capture_job_prefix !== configuration.captureJobName ||
    run.submit_job_name !== configuration.submitJobName ||
    run.submitted_at !== null ||
    run.retention_state !== "live"
  ) {
    throw new SecurityError("staged_run_conflict", 409, "The workflow attempt is already fixed.");
  }
  return run;
}

/** A write to the staged data of a run needs a live run that no job submitted. */
function runFence(database: ApiContext["database"], runId: string) {
  return assertion(
    database,
    `EXISTS (SELECT 1 FROM ingest_staged_runs
      WHERE id = ? AND retention_state = 'live' AND submitted_at IS NULL)`,
    [runId],
  );
}

interface DeclarePageImagesParams {
  context: ApiContext;
  capability: IngestCapability;
  run: StagedRun;
  job: StagedJob;
  uploads: ReadonlyMap<string, CaptureRowImage>;
}

/**
 * Write one D1 row for each image of a page that the job uploads. A page with
 * no upload writes no row. The limits of the run hold before the first ticket.
 */
async function declarePageImages({
  context,
  capability,
  run,
  job,
  uploads,
}: DeclarePageImagesParams) {
  const pages = imageDescriptorPages({
    images: uploads.values(),
    runId: run.id,
    jobId: job.job_id,
  });
  // One bounded JSON parameter carries the descriptors, so the SQL and the
  // parameter counts stay constant for a page of any size.
  for (const descriptors of pages) {
    try {
      await atomic(context.database, [
        runFence(context.database, run.id),
        context.database
          .prepare(`INSERT INTO ingest_staged_images
          (run_id, job_id, digest, media_type, bytes, width, height, image_id, object_key, quarantine_key)
          SELECT ?, ?, json_extract(image.value, '$.digest'),
            json_extract(image.value, '$.mediaType'), json_extract(image.value, '$.bytes'),
            json_extract(image.value, '$.width'), json_extract(image.value, '$.height'),
            json_extract(image.value, '$.imageId'), json_extract(image.value, '$.objectKey'),
            json_extract(image.value, '$.quarantineKey')
          FROM json_each(?) image WHERE true
          ON CONFLICT(run_id, job_id, digest) DO NOTHING`)
          .bind(run.id, job.job_id, descriptors),
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
        // A capture can have one image and one mask.
        assertion(
          context.database,
          `(SELECT COUNT(*) FROM ingest_staged_images WHERE run_id = ? AND job_id = ?) <= ?
            AND (SELECT COALESCE(SUM(bytes), 0) FROM ingest_staged_images
              WHERE run_id = ? AND job_id = ?) <= ?`,
          [
            run.id,
            job.job_id,
            capability.maximumImages * 2,
            run.id,
            job.job_id,
            capability.maximumBytes,
          ],
        ),
        // The index step writes the bytes of a run into its D1 row. Before that
        // row, the staged images of a run count against the limit of all runs,
        // so a run above that limit gets its refusal before its uploads. The
        // sum starts at the staged jobs, which the retention pass deletes, and
        // reads only the images of a job with no index: CROSS JOIN keeps that
        // order, so the statement does not read each staged image.
        assertion(
          context.database,
          `(
            SELECT COALESCE(SUM((
              SELECT COALESCE(SUM(image.bytes), 0) FROM ingest_staged_images image
              WHERE image.run_id = job.run_id AND image.job_id = job.job_id
            )), 0)
            FROM ingest_staged_bundles job
            CROSS JOIN ingest_staged_runs staged ON staged.id = job.run_id
            WHERE staged.retention_state IN ('live', 'deleting')
              AND NOT EXISTS (SELECT 1 FROM ingest_staged_manifests manifest
                WHERE manifest.run_id = job.run_id AND manifest.job_id = job.job_id)
              AND NOT EXISTS (SELECT 1 FROM visonaut_runs run
                WHERE run.id = staged.id AND run.sealed_at IS NOT NULL)
          ) + (
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
      // The batch has one failure for each of its conditions. A closed run has its own answer.
      const current = await stagedRun(context, run.id);
      if (current.submitted_at !== null) {
        throw new SecurityError("closed_shard", 409, "The staged shard is closed.");
      }
      throw new SecurityError(
        "upload_limit",
        413,
        "The page exceeds the image or byte limit of the run, or an image differs from a staged image.",
      );
    }
  }
}

/**
 * Accept one capture page of a run: at most `CAPTURE_PAGE_ROWS` rows. The
 * page is one object of the quarantine bucket, and D1 gets rows only for the
 * images that the job uploads. The index step checks the complete run.
 */
export async function declareStagedPage(request: Request, context: ApiContext, runId: string) {
  workflowConfiguration(context);
  const { capability, run, job } = await stagedCapability(request, context, runId);
  if (run.submitted_at !== null) {
    throw new SecurityError("closed_shard", 409, "The staged shard is closed.");
  }
  const { reference, pullRequest } = runReference(run);
  if (!reference) {
    throw new IncompleteError("The run has no reference. Run Submit again.");
  }
  // A run whose baseline changed gets its refusal before the uploads of the page.
  await currentReference(context, reference, pullRequest);
  const body = await jsonBody(request, CAPTURE_PAGE_MAX_BYTES);
  // The field is of the service. Only a stored page has it.
  if (Object.hasOwn(body, "stored")) {
    throw new SecurityError(
      "invalid_manifest",
      400,
      "A capture page of a client cannot have the field stored.",
    );
  }
  const page = parseCapturePage(body);
  const text = canonicalJson(page);
  const pageBytes = new TextEncoder().encode(text);
  const imageLimit = context.configuration.limits.maximumImageBytes;
  const uploads = capturePageUploads(page);
  if (
    pageBytes.byteLength > CAPTURE_PAGE_MAX_BYTES ||
    page.rows.some(([, , , , , , , , bytes]) => bytes > imageLimit) ||
    [...uploads.values()].some((image) => image.bytes > imageLimit)
  ) {
    throw new SecurityError("upload_limit", 413, "The page exceeds its image or byte limit.");
  }
  const pageDigest = await sha256(pageBytes);
  const captureLimit = context.configuration.limits.maximumCaptures;
  const staged = await listStagedPages(context, run.id, job.job_id);
  const known = staged.has(pageDigest);
  let captures = known ? 0 : page.rows.length;
  for (const rows of staged.values()) {
    captures += rows;
  }
  // Refuse a run above the capture limit before the first upload ticket of
  // the page. A page does not say its position, so the count is of all pages.
  if (captures > captureLimit) {
    throw captureLimitExceeded(captureLimit);
  }
  const admitted = await context.database
    .prepare("SELECT 1 AS found FROM ingest_staged_manifests WHERE run_id = ? AND job_id = ?")
    .bind(run.id, job.job_id)
    .first<{ found: number }>();
  if (admitted) {
    // The index fixed the pages and the images. A page of it gets its answer again.
    if (!known) {
      throw new SecurityError("manifest_conflict", 409, "The staged page index is immutable.");
    }
  } else {
    if (!known) {
      await context.quarantine.put(
        stagedPageKey({
          runId: run.id,
          jobId: job.job_id,
          digest: pageDigest,
          rows: page.rows.length,
        }),
        text,
        { httpMetadata: { contentType: "application/json" }, sha256: pageDigest },
      );
    }
    await declarePageImages({ context, capability, run, job, uploads });
  }
  const stagedImages = uploads.size
    ? await context.database
        .prepare(
          `SELECT * FROM ingest_staged_images WHERE run_id = ? AND job_id = ?
            AND digest IN (SELECT value FROM json_each(?))`,
        )
        .bind(run.id, job.job_id, JSON.stringify([...uploads.keys()]))
        .all<StagedImage>()
    : { results: [] };
  if (stagedImages.results.length !== uploads.size) {
    throw new IncompleteError("The staged image set differs.");
  }
  return Response.json({
    schemaVersion: SCHEMA_VERSION,
    pageDigest,
    reuse: await issueReuseChallenge(context.configuration.capability, {
      runId: run.id,
      jobId: job.job_id,
      shardKey: capability.shardKey,
      // The claim has the name of the earlier request form. It binds the page.
      manifestDigest: pageDigest,
    }),
    uploads: await Promise.all(
      stagedImages.results
        .filter((image) => !image.complete)
        .map(async (image) => ({
          imageDigest: image.digest,
          maxBytes: image.bytes,
          ticket: await issueUploadTicket(context.configuration.capability, {
            runId: run.id,
            shardKey: capability.shardKey,
            objectKey: image.quarantine_key,
            imageDigest: image.digest,
            mediaType: image.media_type,
            maximumBytes: image.bytes,
          }),
        })),
    ),
  });
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
  validateDigest(body.pageDigest);
  // The service signed the challenge for one declared page of this job.
  const challenge = await verifyReuseChallenge(
    context.configuration.capability,
    string(body.challenge, 4096),
    capability,
    body.pageDigest,
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
      runFence(context.database, run.id),
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
      runFence(context.database, run.id),
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
  const completeImage = () =>
    assertion(
      context.database,
      `EXISTS (SELECT 1 FROM ingest_staged_images
      WHERE run_id = ? AND job_id = ? AND digest = ? AND complete = 1
        AND media_type = ? AND bytes = ? AND width = ? AND height = ?)`,
      [run.id, job.job_id, image.digest, image.media_type, image.bytes, image.width, image.height],
    );
  if (image.complete) {
    await atomic(context.database, [runFence(context.database, run.id), completeImage()]);
    return new Response(null, { status: 204 });
  }
  await context.images.put(image.object_key, bytes, {
    httpMetadata: { contentType: image.media_type },
    sha256: image.digest,
  });
  await atomic(context.database, [
    runFence(context.database, run.id),
    context.database
      .prepare(`UPDATE ingest_staged_images SET complete = 1
      WHERE run_id = ? AND job_id = ? AND digest = ? AND complete = 0`)
      .bind(run.id, job.job_id, image.digest),
    completeImage(),
  ]);
  return new Response(null, { status: 204 });
}

/**
 * Accept the page index of a run. This is the one step that sees the complete
 * run, so it checks the pages against each other and against the reference,
 * and it writes the one D1 row of the staged capture data.
 */
export async function stageIndex(request: Request, context: ApiContext, runId: string) {
  workflowConfiguration(context);
  const { run, job } = await stagedCapability(request, context, runId);
  if (run.submitted_at !== null) {
    throw new SecurityError("closed_shard", 409, "The staged shard is closed.");
  }
  const index = parseStagedIndex(
    await jsonBody(request, context.configuration.limits.maximumManifestBytes),
  );
  const text = canonicalJson(index);
  const bytes = new TextEncoder().encode(text);
  // The digest of the index is the manifest digest of the run.
  const manifestDigest = await sha256(bytes);
  const staged = () =>
    Response.json(
      { schemaVersion: SCHEMA_VERSION, runId: run.id, manifestDigest, state: "staged" },
      { status: 202 },
    );
  const readStored = () =>
    context.database
      .prepare("SELECT * FROM ingest_staged_manifests WHERE run_id = ? AND job_id = ?")
      .bind(run.id, job.job_id)
      .first<StagedManifestEvidence>();
  const existing = await readStored();
  if (existing) {
    if (existing.manifest_digest !== manifestDigest || existing.complete !== 1) {
      throw new SecurityError("manifest_conflict", 409, "The staged page index is immutable.");
    }
    // A second request with the same index is safe.
    return staged();
  }
  if (index.job.id !== job.job_id || index.job.attempt !== run.workflow_attempt) {
    throw new SecurityError(
      "manifest_provenance",
      403,
      "The page index does not belong to this trusted upload job.",
    );
  }
  const { reference, pullRequest } = runReference(run);
  if (
    !reference ||
    reference.snapshotId !== index.reference.snapshotId ||
    reference.baselineRevision !== index.reference.baselineRevision ||
    reference.digest !== index.reference.digest
  ) {
    throw new SecurityError(
      "reference_conflict",
      409,
      "The page index is not bound to the reference of this run.",
    );
  }
  await currentReference(context, reference, pullRequest);
  const pages = await readStagedPages({ context, runId: run.id, jobId: job.job_id, index });
  await validateRunPages(pages, await referenceCaptureInputs(context, reference.snapshotId));
  const { uploads, declaredBytes, captureCount } = runPageImages(pages);
  await exactEvidenceImages(context, { runId: run.id, jobId: job.job_id }, uploads);
  const objectKey = stagedIndexKey(run.id, job.job_id, manifestDigest);
  await context.quarantine.put(objectKey, text, {
    httpMetadata: { contentType: "application/json" },
    sha256: manifestDigest,
  });
  try {
    await atomic(context.database, [
      runFence(context.database, run.id),
      // The index fixes the image set: a trigger refuses each later image row.
      assertion(
        context.database,
        `(SELECT COUNT(*) FROM ingest_staged_images WHERE run_id = ? AND job_id = ?) = ?
          AND NOT EXISTS (SELECT 1 FROM ingest_staged_images
            WHERE run_id = ? AND job_id = ? AND complete != 1)`,
        [run.id, job.job_id, uploads.size, run.id, job.job_id],
      ),
      statement(
        context.database,
        `INSERT INTO ingest_staged_manifests (run_id, job_id, manifest_digest, manifest_object_key,
          declared_bytes, capture_count, created_at, evidence_version, evidence_bytes,
          complete, declaration_complete, local_receipt_validated)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1, 1, 1) ON CONFLICT(run_id, job_id) DO NOTHING`,
        [
          run.id,
          job.job_id,
          manifestDigest,
          objectKey,
          declaredBytes,
          captureCount,
          Date.now(),
          bytes.byteLength,
        ],
      ),
      assertion(
        context.database,
        `EXISTS (SELECT 1 FROM ingest_staged_manifests
          WHERE run_id = ? AND job_id = ? AND manifest_digest = ? AND complete = 1)`,
        [run.id, job.job_id, manifestDigest],
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
    const raced = await readStored();
    if (raced) {
      throw new SecurityError("manifest_conflict", 409, "The staged page index is immutable.");
    }
    await stagedRun(context, run.id);
    throw new SecurityError(
      "upload_limit",
      413,
      "The staged workflow exceeds its original-byte limit, or its images changed.",
    );
  }
  return staged();
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
    seed.caller_workflow_path !== configuration.callerWorkflowPath ||
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
