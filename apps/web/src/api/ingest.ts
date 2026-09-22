import {
  digestEnvironmentProfile,
  digestJson,
  parseManifest,
  parseTrustedPlan,
  SCHEMA_VERSION,
  sha256,
  validateDigest,
  validateKey,
  validateShardAgainstPlan,
  validateShardDeclaration,
  validateVersion,
  type Manifest,
  type ReserveRunRequest,
  type RunStatus,
  type TrustedPlan,
} from "@visonaut/protocol";
import {
  bearerToken,
  createGitHubClient,
  issueIngestCapability,
  issueUploadTicket,
  loadTrustedMainFile,
  readBoundedBody,
  SecurityError,
  verifyGitHubOidc,
  verifyIngestCapability,
  verifyUploadTicket,
  type GitHubClient,
  type IngestCapability,
} from "@visonaut/security";
import {
  assertion,
  atomic,
  ConflictError,
  IncompleteError,
  statement,
  type RunRow,
} from "@visonaut/service";
import { assertConfiguredProject, type ApiContext } from "./context.js";
import { integer, jsonBody, object, string } from "./input.js";
import { discoveryEvidence } from "./receipts.js";
import { inheritedShards, verifiedInheritedShard, workflowAttempt, workflowJobs } from "./jobs.js";
import { relatedRunEvidence, refreshRunLineage } from "./lineage.js";
import { ingestCaptureProfile, storeCaptureProfiles } from "../profiles.ts";

interface StoredProvenance {
  verified_json: string;
  plan_object_key: string;
}
interface StoredManifest {
  digest: string;
  object_key: string;
  job_id: string;
  finalized: number;
}
interface UploadRow {
  id: string;
  run_id: string;
  shard_key: string;
  manifest_digest: string;
  digest: string;
  media_type: "image/png" | "image/webp";
  expected_bytes: number;
  width: number;
  height: number;
  quarantine_key: string;
  image_id: string;
  image_key: string;
  complete: number;
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

async function privateJson(
  context: ApiContext,
  key: string,
  maximumBytes: number,
): Promise<unknown> {
  const stored = await context.quarantine.get(key);
  if (!stored || stored.size > maximumBytes) {
    throw new IncompleteError("Required private capture metadata is unavailable.");
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await stored.arrayBuffer()));
}

async function runProvenance(context: ApiContext, runId: string) {
  const provenance = await context.database
    .prepare("SELECT verified_json, plan_object_key FROM ingest_run_provenance WHERE run_id = ?")
    .bind(runId)
    .first<StoredProvenance>();
  if (!provenance) {
    throw new IncompleteError("Trusted run provenance is unavailable.");
  }
  return {
    planObjectKey: provenance.plan_object_key,
    verified: object(JSON.parse(provenance.verified_json)),
  };
}

async function storedPlan(context: ApiContext, objectKey: string) {
  return parseTrustedPlan(
    await privateJson(context, objectKey, context.configuration.limits.maximumPlanBytes),
  );
}

async function runPlan(context: ApiContext, runId: string) {
  const { planObjectKey, verified } = await runProvenance(context, runId);
  return { plan: await storedPlan(context, planObjectKey), verified };
}

async function verifyAncestry(context: ApiContext, github: GitHubClient, testedSha: string) {
  const snapshots = await context.database
    .prepare(
      "SELECT DISTINCT tested_sha FROM visonaut_snapshots WHERE project_id = ? AND reference_eligible = 1 ORDER BY created_at DESC LIMIT 100",
    )
    .bind(context.configuration.projectId)
    .all<{ tested_sha: string }>();
  const ancestorShas: string[] = [];
  for (const snapshot of snapshots.results) {
    const comparison = object(
      await github.request(
        `/repos/${github.repository}/compare/${snapshot.tested_sha}...${testedSha}`,
      ),
    );
    if (comparison.status === "ahead" || comparison.status === "identical") {
      ancestorShas.push(snapshot.tested_sha);
    }
  }
  return ancestorShas;
}

export async function reserve(request: Request, context: ApiContext): Promise<Response> {
  const body = reserveRequest(await jsonBody(request, 32_768));
  const github = await createGitHubClient(context.configuration.github);
  const source = await loadTrustedMainFile(github, context.configuration.trustedPlanPath);
  if (
    new TextEncoder().encode(source.content).byteLength >
    context.configuration.limits.maximumPlanBytes
  ) {
    throw new SecurityError(
      "plan_too_large",
      503,
      "The trusted plan exceeds the configured limit.",
    );
  }
  const plan = parseTrustedPlan(JSON.parse(source.content));
  const planDigest = await digestJson(plan);
  if (
    plan.discovery &&
    plan.discovery.executorDigest !== context.configuration.trustedExecutorDigest
  ) {
    throw new SecurityError(
      "untrusted_executor",
      403,
      "The capture executor is not configured on this server.",
    );
  }
  if (
    plan.shards.reduce(
      (count, shard) =>
        count + (shard.tests ?? []).reduce((sum, test) => sum + test.captures.length, 0),
      0,
    ) > context.configuration.limits.maximumCaptures
  ) {
    throw new SecurityError("plan_too_large", 503, "The trusted plan exceeds the capture limit.");
  }
  const verified = await verifyGitHubOidc({
    token: bearerToken(request),
    request: body,
    github,
    configuration: {
      audience: context.configuration.oidcAudience,
      allowMainDispatch:
        context.configuration.auth.environment === "preview" &&
        context.configuration.allowMainDispatch === true,
      repositoryOwnerId: context.configuration.repositoryOwnerId,
      workflowPath: plan.workflow,
      reusableWorkflowRef: context.configuration.reusableWorkflowRef,
      reusableWorkflowSha: context.configuration.reusableWorkflowSha,
      planDigest,
      shards: plan.shards,
      loadMergeGroup: async (testedSha) => {
        const row = await context.database
          .prepare(
            "SELECT metadata_json FROM ingest_merge_groups WHERE head_sha = ? AND active = 1",
          )
          .bind(testedSha)
          .first<{ metadata_json: string }>();
        if (!row) return null;
        const group = object(JSON.parse(row.metadata_json));
        return {
          repositoryId: string(group.repositoryId),
          headSha: string(group.headSha),
          headRef: string(group.headRef),
          baseSha: string(group.baseSha),
          baseRef: string(group.baseRef),
        };
      },
    },
  });
  const lineageKey =
    verified.event === "push" || verified.event === "workflow_dispatch"
      ? "main"
      : verified.event === "pull_request"
        ? `pr:${verified.pullRequestNumber}`
        : `merge:${verified.testedSha}`;
  const verifiedAncestorShas = await verifyAncestry(context, github, verified.testedSha);
  const lineage = await relatedRunEvidence(context, github, verified);
  const serviceShards = await Promise.all(
    plan.shards.map(async (shard) => ({
      key: shard.key,
      profileDigest: await digestJson(shard.environmentProfileDigests),
      environmentProfileDigests: shard.environmentProfileDigests,
      ...(plan.discovery
        ? {
            discovery: {
              executorDigest: plan.discovery.executorDigest,
              configurationDigest: await digestJson(shard.collection),
            },
          }
        : {}),
      tests: (shard.tests ?? []).map((test) => test.id),
      captures: (shard.tests ?? []).flatMap((test) =>
        test.captures.map((capture) => ({ ...capture, testId: test.id })),
      ),
    })),
  );
  const planObjectKey = `plans/${planDigest}.json`;
  await context.quarantine.put(planObjectKey, JSON.stringify(plan), {
    httpMetadata: { contentType: "application/json" },
  });
  if (verified.workflowAttempt > 1) {
    const previous = await context.database
      .prepare(
        "SELECT id FROM visonaut_runs WHERE project_id = ? AND external_run_id = ? AND attempt < ? AND active = 1 AND sealed_at IS NULL ORDER BY attempt DESC LIMIT 1",
      )
      .bind(context.configuration.projectId, verified.workflowRunId, verified.workflowAttempt)
      .first<{ id: string }>();
    if (previous) await trySealRun(context, previous.id, true);
  }
  const inheritance = await inheritedShards(context, github, verified, plan);
  const reservation = {
    id: crypto.randomUUID(),
    projectId: context.configuration.projectId,
    externalRunId: verified.workflowRunId,
    attempt: verified.workflowAttempt,
    kind:
      verified.event === "push" || verified.event === "workflow_dispatch" ? "main" : verified.event,
    testedSha: verified.testedSha,
    lineageKey,
    plan: { digest: planDigest, shards: serviceShards },
    verifiedRelatedRunIds: lineage.runIds,
    verifiedAncestorShas,
    verificationDigest: await digestJson({
      ...verified,
      trustedMainSha: source.mainSha,
      lineageProof: lineage.proof,
    }),
    ...inheritance,
    now: Date.now(),
  } satisfies Parameters<typeof context.service.reserveRun>[0];
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
      .first();
    if (!concurrent) {
      // A simultaneous new run may have consumed the final admission slot.
      await context.admission?.(reservation);
      throw error;
    }
    run = await context.service.reserveRun(reservation);
  }
  if (!run.active) throw new ConflictError("This workflow attempt was superseded.");
  await context.database
    .prepare(
      "INSERT INTO ingest_run_provenance (run_id, verified_json, plan_object_key, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(run_id) DO NOTHING",
    )
    .bind(
      run.id,
      JSON.stringify({
        ...verified,
        lineageProof: lineage.proof,
        reusableWorkflowRef: context.configuration.reusableWorkflowRef,
        reusableWorkflowSha: context.configuration.reusableWorkflowSha,
        executorDigest: context.configuration.trustedExecutorDigest,
      }),
      planObjectKey,
      Date.now(),
    )
    .run();
  const shard = plan.shards.find((entry) => entry.key === verified.shardKey);
  if (!shard) {
    throw new IncompleteError("The verified shard is unavailable.");
  }
  const capability: IngestCapability = {
    runId: run.id,
    repositoryId: verified.repositoryId,
    workflowRunId: verified.workflowRunId,
    workflowAttempt: verified.workflowAttempt,
    testedSha: verified.testedSha,
    planDigest,
    shardKey: verified.shardKey,
    jobId: verified.jobId,
    maximumBytes: context.configuration.limits.maximumShardBytes,
    maximumImages: plan.discovery
      ? context.configuration.limits.maximumCaptures
      : (shard.tests ?? []).reduce((sum, test) => sum + test.captures.length, 0),
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

async function activeCapability(request: Request, context: ApiContext, runId?: string) {
  const capability = await verifyIngestCapability(
    context.configuration.capability,
    bearerToken(request),
  );
  const run = await context.service.run(capability.runId);
  if (runId && run.id !== runId) {
    throw new SecurityError("wrong_run", 403, "The credential does not belong to this run.");
  }
  if (
    run.project_id !== context.configuration.projectId ||
    !run.active ||
    run.attempt !== capability.workflowAttempt ||
    run.external_run_id !== capability.workflowRunId ||
    run.tested_sha !== capability.testedSha ||
    run.plan_digest !== capability.planDigest
  ) {
    throw new SecurityError("stale_capability", 409, "The workflow attempt is no longer active.");
  }
  return { capability, run };
}

export async function declareShard(
  request: Request,
  context: ApiContext,
  runId: string,
  shardKey: string,
) {
  const { capability, run } = await activeCapability(request, context, runId);
  if (capability.shardKey !== shardKey || run.sealed_at !== null) {
    throw new SecurityError("closed_shard", 409, "The shard cannot accept this declaration.");
  }
  const manifest = parseManifest(
    await jsonBody(request, context.configuration.limits.maximumManifestBytes),
  );
  const { plan } = await runPlan(context, run.id);
  await validateShardDeclaration(manifest, plan);
  if (
    manifest.shard.key !== shardKey ||
    manifest.shard.jobId !== capability.jobId ||
    manifest.shard.sourceAttempt !== run.attempt ||
    manifest.run.workflowRunId !== run.external_run_id ||
    manifest.run.workflowAttempt !== run.attempt ||
    manifest.run.testedSha !== run.tested_sha ||
    manifest.run.repository !== context.configuration.github.repository
  ) {
    throw new SecurityError(
      "manifest_provenance",
      403,
      "The manifest does not belong to this capture job.",
    );
  }
  const images = new Map<string, Manifest["captures"][number]["image"]>();
  for (const capture of manifest.captures) {
    const previous = images.get(capture.image.digest);
    if (
      previous &&
      (previous.bytes !== capture.image.bytes ||
        previous.width !== capture.image.width ||
        previous.height !== capture.image.height ||
        previous.mediaType !== capture.image.mediaType)
    ) {
      throw new SecurityError(
        "image_conflict",
        400,
        "The same image digest has conflicting metadata.",
      );
    }
    images.set(capture.image.digest, capture.image);
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
    throw new SecurityError("upload_limit", 413, "The shard exceeds its image or byte limit.");
  }
  const manifestDigest = await digestJson(manifest);
  const manifestKey = `manifests/${run.id}/${manifestDigest}.json`;
  await atomic(context.database, [
    assertion(
      context.database,
      "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND active = 1 AND sealed_at IS NULL)",
      [run.id],
    ),
    statement(
      context.database,
      "INSERT INTO ingest_manifests (run_id, shard_key, digest, object_key, job_id, capture_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id, shard_key) DO NOTHING",
      [
        run.id,
        shardKey,
        manifestDigest,
        manifestKey,
        capability.jobId,
        manifest.captures.length,
        Date.now(),
      ],
    ),
    assertion(
      context.database,
      "EXISTS (SELECT 1 FROM ingest_manifests WHERE run_id = ? AND shard_key = ? AND digest = ? AND job_id = ?)",
      [run.id, shardKey, manifestDigest, capability.jobId],
    ),
    assertion(
      context.database,
      "(SELECT COALESCE(sum(capture_count), 0) FROM ingest_manifests WHERE run_id = ?) + (SELECT count(*) FROM visonaut_captures c WHERE c.run_id = ? AND NOT EXISTS (SELECT 1 FROM ingest_manifests m WHERE m.run_id = c.run_id AND m.shard_key = c.shard_key)) <= ?",
      [run.id, run.id, context.configuration.limits.maximumCaptures],
    ),
  ]);
  await context.quarantine.put(manifestKey, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json" },
  });
  const entries = [...images.values()];
  for (let offset = 0; offset < entries.length; offset += 50) {
    const rows = entries.slice(offset, offset + 50).map((image) => {
      const id = crypto.randomUUID();
      const imageId = crypto.randomUUID();
      return {
        id,
        imageId,
        image,
        quarantineKey: `quarantine/${run.id}/${id}`,
        imageKey: `runs/${run.id}/images/${imageId}`,
      };
    });
    await atomic(context.database, [
      assertion(
        context.database,
        "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND active = 1 AND sealed_at IS NULL)",
        [run.id],
      ),
      ...rows.map((row) =>
        statement(
          context.database,
          "INSERT INTO ingest_uploads (id, run_id, shard_key, manifest_digest, digest, media_type, expected_bytes, width, height, quarantine_key, image_id, image_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id, shard_key, digest) DO NOTHING",
          [
            row.id,
            run.id,
            shardKey,
            manifestDigest,
            row.image.digest,
            row.image.mediaType,
            row.image.bytes,
            row.image.width,
            row.image.height,
            row.quarantineKey,
            row.imageId,
            row.imageKey,
          ],
        ),
      ),
    ]);
  }
  const uploads = await context.database
    .prepare(
      "SELECT * FROM ingest_uploads WHERE run_id = ? AND shard_key = ? AND manifest_digest = ? AND complete = 0 ORDER BY id",
    )
    .bind(run.id, shardKey, manifestDigest)
    .all<UploadRow>();
  return Response.json({
    schemaVersion: SCHEMA_VERSION,
    manifestDigest,
    uploads: await Promise.all(
      uploads.results.map(async (upload) => ({
        imageDigest: upload.digest,
        maxBytes: upload.expected_bytes,
        ticket: await issueUploadTicket(context.configuration.capability, {
          runId: run.id,
          shardKey,
          objectKey: upload.quarantine_key,
          imageDigest: upload.digest,
          mediaType: upload.media_type,
          maximumBytes: upload.expected_bytes,
        }),
      })),
    ),
  });
}

export async function uploadImage(request: Request, context: ApiContext, ticketToken: string) {
  const { capability, run } = await activeCapability(request, context);
  const ticket = await verifyUploadTicket(
    context.configuration.capability,
    ticketToken,
    capability,
  );
  if (run.sealed_at !== null) {
    throw new SecurityError("sealed_run", 409, "The run is already sealed.");
  }
  const upload = await context.database
    .prepare(
      "SELECT * FROM ingest_uploads WHERE run_id = ? AND shard_key = ? AND quarantine_key = ?",
    )
    .bind(run.id, capability.shardKey, ticket.objectKey)
    .first<UploadRow>();
  if (
    !upload ||
    upload.digest !== ticket.imageDigest ||
    upload.media_type !== ticket.mediaType ||
    upload.expected_bytes !== ticket.maximumBytes
  ) {
    throw new SecurityError(
      "unknown_ticket",
      403,
      "The upload ticket does not match a declared image.",
    );
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== upload.media_type) {
    throw new SecurityError(
      "invalid_content_type",
      415,
      "The image content type does not match its ticket.",
    );
  }
  const bytes = await readBoundedBody(
    request,
    Math.min(upload.expected_bytes, context.configuration.limits.maximumImageBytes),
  );
  if (bytes.byteLength !== upload.expected_bytes || (await sha256(bytes)) !== upload.digest) {
    throw new SecurityError(
      "image_mismatch",
      422,
      "Image bytes do not match the declared digest and size.",
    );
  }
  if (upload.complete) {
    return new Response(null, { status: 204 });
  }
  await context.quarantine.put(upload.quarantine_key, bytes, {
    httpMetadata: { contentType: upload.media_type },
  });
  const validation = await context.comparator.fetch("https://compare.internal/validate", {
    method: "POST",
    body: bytes,
    headers: { "content-type": upload.media_type },
  });
  if (validation.status === 503) {
    throw new SecurityError(
      "validation_busy",
      503,
      "Image validation is temporarily busy. Retry this upload.",
    );
  }
  if (!validation.ok) {
    throw new SecurityError(
      "invalid_image",
      422,
      "The image failed trusted decoding or color validation.",
    );
  }
  const result = object(
    JSON.parse(new TextDecoder().decode(await readBoundedBody(validation, 16_384))),
  );
  if (
    result.digest !== upload.digest ||
    result.bytes !== bytes.byteLength ||
    result.width !== upload.width ||
    result.height !== upload.height ||
    result.contentType !== upload.media_type
  ) {
    throw new SecurityError(
      "image_mismatch",
      422,
      "The decoded image does not match the declared capture.",
    );
  }
  await context.images.put(upload.image_key, bytes, {
    httpMetadata: { contentType: upload.media_type },
  });
  await context.service.registerImage({
    id: upload.image_id,
    runId: run.id,
    digest: upload.digest,
    objectKey: upload.image_key,
    contentType: upload.media_type,
    bytes: bytes.byteLength,
    width: upload.width,
    height: upload.height,
  });
  await context.database
    .prepare("UPDATE ingest_uploads SET complete = 1 WHERE id = ?")
    .bind(upload.id)
    .run();
  await context.quarantine.delete(upload.quarantine_key);
  return new Response(null, { status: 204 });
}

export async function runStatus(context: ApiContext, runId: string): Promise<RunStatus> {
  const state = await context.service.status(runId);
  if (state.run.project_id !== context.configuration.projectId) {
    throw new SecurityError("not_found", 404, "The run was not found.");
  }
  const counts = await context.database
    .prepare(
      "SELECT count(*) AS expected, COALESCE(sum(CASE WHEN state = 'complete' THEN 1 ELSE 0 END), 0) AS complete FROM visonaut_shards WHERE run_id = ?",
    )
    .bind(runId)
    .first<{ expected: number; complete: number }>();
  const status =
    state.run.state === "failed"
      ? "failed"
      : state.status === "needs-recompare"
        ? "needs-review"
        : state.status;
  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    state: status,
    reviewUrl: `${context.configuration.origin}/runs/${runId}`,
    completedShards: counts?.complete ?? 0,
    expectedShards: counts?.expected ?? 0,
    errors:
      state.status === "needs-recompare"
        ? ["The baseline changed. Recompare this stored run."]
        : [],
  };
}

export async function finalize(request: Request, context: ApiContext, runId: string) {
  const { capability, run } = await activeCapability(request, context, runId);
  const body = await jsonBody(request, 16_384);
  validateVersion(body.schemaVersion);
  validateDigest(body.manifestDigest);
  if (body.shardKey !== capability.shardKey) {
    throw new SecurityError("wrong_shard", 403, "The credential does not belong to this shard.");
  }
  const stored = await context.database
    .prepare(
      "SELECT digest, object_key, job_id, finalized FROM ingest_manifests WHERE run_id = ? AND shard_key = ?",
    )
    .bind(run.id, capability.shardKey)
    .first<StoredManifest>();
  if (!stored || stored.digest !== body.manifestDigest || stored.job_id !== capability.jobId) {
    throw new SecurityError(
      "manifest_conflict",
      409,
      "The declared shard manifest is unavailable or different.",
    );
  }
  await context.database
    .prepare(
      "UPDATE ingest_manifests SET finalized = 1 WHERE run_id = ? AND shard_key = ? AND digest = ?",
    )
    .bind(run.id, capability.shardKey, stored.digest)
    .run();
  await trySealRun(context, run.id);
  return Response.json(await runStatus(context, run.id), { status: 202 });
}

async function commitVerifiedShard(
  context: ApiContext,
  run: RunRow,
  shardKey: string,
  stored: StoredManifest,
  plan: TrustedPlan,
  verificationDigest: string,
  evidence?: import("@visonaut/protocol").VerifiedDiscoveryEvidence,
) {
  const manifest = parseManifest(
    await privateJson(
      context,
      stored.object_key,
      context.configuration.limits.maximumManifestBytes,
    ),
  );
  await validateShardAgainstPlan(manifest, plan, evidence);
  const verifiedDiscovery =
    plan.discovery && manifest.discovery && evidence
      ? {
          ...manifest.discovery,
          verificationDigest,
          jobId: evidence.jobId,
          externalRunId: evidence.workflowRunId,
          attempt: evidence.workflowAttempt,
          testedSha: evidence.testedSha,
          tests: manifest.tests.map((test) => test.id),
          captures: manifest.captures.map((capture) => ({
            itemKey: capture.itemKey,
            variantKey: capture.variant.key,
            testId: capture.testId,
          })),
        }
      : undefined;
  const uploads = await context.database
    .prepare(
      "SELECT * FROM ingest_uploads WHERE run_id = ? AND shard_key = ? AND manifest_digest = ?",
    )
    .bind(run.id, shardKey, stored.digest)
    .all<UploadRow>();
  if (uploads.results.some((image) => !image.complete)) {
    throw new IncompleteError("Every declared image must pass validation before finalizing.");
  }
  const capturedProfiles = new Set(manifest.captures.map((capture) => capture.profileDigest));
  await storeCaptureProfiles(
    context.database,
    manifest.profiles.filter((profile) => capturedProfiles.has(profile.digest)),
  );
  const previous = await context.database
    .prepare(
      "SELECT id, json_extract(metadata_json, '$.profile') AS profile_json FROM visonaut_captures WHERE run_id=? AND shard_key=?",
    )
    .bind(run.id, shardKey)
    .all<{ id: string; profile_json: string }>();
  const previousProfiles = new Map(previous.results.map((row) => [row.id, row.profile_json]));
  const captures = await Promise.all(
    manifest.captures.map(async (capture) => {
      const image = uploads.results.find((entry) => entry.digest === capture.image.digest);
      const profile = manifest.profiles.find((entry) => entry.digest === capture.profileDigest);
      if (!image || !profile) {
        throw new IncompleteError("Required image or profile evidence is unavailable.");
      }
      const id = `${run.id}:${await digestJson([capture.itemKey, capture.variant.key])}`;
      return {
        id,
        itemKey: capture.itemKey,
        variantKey: capture.variant.key,
        ordinal: capture.ordinal,
        imageId: image.image_id,
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
  await context.service.commitShard({
    runId: run.id,
    key: shardKey,
    manifestDigest: stored.digest,
    captures,
    verifiedDiscovery,
    finalTestOutcomes: manifest.tests.map((test) => ({
      testId: test.id,
      retry: test.retry,
      status: test.status,
    })),
    now: Date.now(),
  });
}

export async function comparisonReference(context: ApiContext, run: RunRow, historical = false) {
  const project = await context.service.project(run.project_id);
  const github = await createGitHubClient(context.configuration.github);
  if (!historical) {
    await refreshRunLineage(context, github, run);
  }
  const ancestors = await verifyAncestry(context, github, run.tested_sha);
  const proof = await digestJson({
    testedSha: run.tested_sha,
    ancestors,
    baselineRevision: project.baseline_revision,
  });
  for (let offset = 0; offset < ancestors.length; offset += 50) {
    await atomic(context.database, [
      assertion(
        context.database,
        "EXISTS (SELECT 1 FROM visonaut_runs WHERE id = ? AND active = ? AND revision = ?)",
        [run.id, historical ? 0 : 1, run.revision],
      ),
      ...ancestors
        .slice(offset, offset + 50)
        .map((sha) =>
          statement(
            context.database,
            "INSERT INTO visonaut_ancestry (run_id, ancestor_sha, proof_digest) VALUES (?, ?, ?) ON CONFLICT(run_id, ancestor_sha) DO NOTHING",
            [run.id, sha, proof],
          ),
        ),
    ]);
  }
  return {
    referenceSnapshotId: await context.service.selectReferenceSnapshot(run.id, historical),
    expectedBaselineRevision: project.baseline_revision,
  };
}

export async function scheduleComparison(context: ApiContext, runId: string) {
  const run = await context.service.run(runId);
  if (run.comparison_id) return;
  const reference = await comparisonReference(context, run);
  const comparison = await context.service.createComparison({
    id: crypto.randomUUID(),
    runId,
    ...reference,
    now: Date.now(),
    maxAttempts: context.configuration.comparisonMaxAttempts,
  });
  const rows = await context.service.comparisonRows(comparison.id);
  for (const row of rows) {
    if (row.outcome === "pending") {
      await context.comparisons.send({ taskId: row.id });
    }
  }
  if (rows.every((row) => row.outcome !== "pending" && row.outcome !== "error")) {
    await context.service.finalizeComparison({ comparisonId: comparison.id, now: Date.now() });
  }
}

export async function trySealRun(context: ApiContext, runId: string, verifyHistorical = false) {
  const run = await context.service.run(runId);
  if (!run.active) return;
  if (run.sealed_at !== null) {
    await scheduleComparison(context, run.id);
    return;
  }
  const { planObjectKey, verified } = await runProvenance(context, run.id);
  if (
    verified.reusableWorkflowRef !== context.configuration.reusableWorkflowRef ||
    verified.reusableWorkflowSha !== context.configuration.reusableWorkflowSha
  ) {
    // A deployment can change the trusted executor while an old run is still uploading.
    // That run cannot seal under the new pin, so preserve its evidence and fail it once.
    // A later full capture attempt may continue; inherited shards must check the pin too.
    await context.service.failRun({
      runId: run.id,
      reason: "The trusted capture executor changed. Start a new capture attempt.",
      now: Date.now(),
    });
    return;
  }
  const plan = await storedPlan(context, planObjectKey);
  const github = await createGitHubClient(context.configuration.github);
  const identity = {
    workflowRunId: run.external_run_id,
    workflowAttempt: run.attempt,
    testedSha: run.tested_sha,
    planDigest: run.plan_digest,
    sourceHead: string(verified.sourceHead, 40),
  };
  const current = await workflowAttempt(github, identity, verifyHistorical);
  const metadata =
    run.attempt > 1 && !verifyHistorical ? await workflowAttempt(github, identity, true) : current;
  const jobs = await workflowJobs(github, run.external_run_id, run.attempt);
  const latestJobs =
    run.attempt > 1 && !verifyHistorical ? await workflowJobs(github, run.external_run_id) : jobs;
  let incomplete = false;
  for (const shard of plan.shards) {
    const completed = await context.database
      .prepare(
        "SELECT state, source_attempt, manifest_digest FROM visonaut_shards WHERE run_id = ? AND key = ?",
      )
      .bind(run.id, shard.key)
      .first<{ state: string; source_attempt: number; manifest_digest: string }>();
    if (completed?.state === "complete" && completed.source_attempt < run.attempt) {
      const matching = latestJobs.filter((job) => job.name === shard.jobName);
      const job = matching[0];
      if (matching.length !== 1 || !job) {
        throw new IncompleteError("The current inherited job is unavailable or ambiguous.");
      }
      await verifiedInheritedShard(context, github, {
        runId: run.id,
        identity,
        shard,
        plan,
        job,
        attemptStartedAt: metadata.run_started_at,
      });
      continue;
    }
    const manifest = await context.database
      .prepare(
        "SELECT digest, object_key, job_id, finalized FROM ingest_manifests WHERE run_id = ? AND shard_key = ? AND finalized = 1",
      )
      .bind(run.id, shard.key)
      .first<StoredManifest>();
    if (!manifest) {
      incomplete = true;
      continue;
    }
    const matching = jobs.filter((entry) => entry.name === shard.jobName);
    const job = matching[0];
    if (
      matching.length !== 1 ||
      !job ||
      String(job.id) !== manifest.job_id ||
      job.conclusion !== "success" ||
      job.run_attempt !== run.attempt
    ) {
      incomplete = true;
      continue;
    }
    const manifestBody = parseManifest(
      await privateJson(
        context,
        manifest.object_key,
        context.configuration.limits.maximumManifestBytes,
      ),
    );
    const evidence = await discoveryEvidence(
      github,
      manifestBody,
      plan,
      string(metadata.head_sha, 40),
    );
    await commitVerifiedShard(
      context,
      run,
      shard.key,
      manifest,
      plan,
      await digestJson({ job, verified }),
      evidence,
    );
  }
  if (!verifyHistorical) {
    const latest = await workflowAttempt(github, identity);
    if (
      metadata.status === "completed" &&
      (latest.status !== "completed" || latest.conclusion !== metadata.conclusion)
    ) {
      throw new IncompleteError("The workflow conclusion changed during shard verification.");
    }
  }
  if (verifyHistorical || metadata.status !== "completed") return;
  if (metadata.conclusion !== "success") {
    await context.service.failRun({
      runId: run.id,
      reason: "The GitHub workflow attempt did not succeed.",
      now: Date.now(),
    });
    return;
  }
  if (incomplete) return;
  await context.service.sealRun({ runId: run.id, now: Date.now() });
  await scheduleComparison(context, run.id);
}

export async function reconcileIngest(context: ApiContext, limit = 25) {
  await assertConfiguredProject(context);
  const runs = await context.database
    .prepare(
      "SELECT r.id FROM visonaut_runs r JOIN ingest_run_provenance p ON p.run_id = r.id WHERE r.project_id = ? AND r.active = 1 AND r.state IN ('uploading', 'comparing') ORDER BY p.last_checked_at, r.created_at LIMIT ?",
    )
    .bind(context.configuration.projectId, Math.min(limit, 100))
    .all<{ id: string }>();
  const errors: Array<{ runId: string; code: string }> = [];
  let progressed = 0;
  for (const run of runs.results) {
    try {
      const before = await context.service.run(run.id);
      await trySealRun(context, run.id);
      const after = await context.service.run(run.id);
      if (
        before.state !== after.state ||
        before.sealed_at !== after.sealed_at ||
        before.comparison_id !== after.comparison_id
      )
        progressed += 1;
    } catch (error) {
      errors.push({
        runId: run.id,
        code:
          error instanceof SecurityError
            ? error.code
            : error instanceof ConflictError
              ? "conflict"
              : "incomplete",
      });
    } finally {
      await context.database
        .prepare("UPDATE ingest_run_provenance SET last_checked_at = ? WHERE run_id = ?")
        .bind(Date.now(), run.id)
        .run();
    }
  }
  return { checked: runs.results.length, errors, progressed };
}
