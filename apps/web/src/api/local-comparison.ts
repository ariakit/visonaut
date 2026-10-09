import { assertDimensions, imageLimits } from "@visonaut/compare";
import { Buffer } from "node:buffer";
import {
  captureManifestDigest,
  digestJson,
  digestRenderingProfile,
  identityKey,
  LOCAL_COMPARISON_MODE,
  validateDigest,
  validateLocalReference,
  type LocalReferenceBinding,
  type LocalReferenceCapture,
  type Manifest,
} from "@visonaut/protocol";
import {
  bearerToken,
  bindIngestReference,
  createGitHubClient,
  SecurityError,
  type IngestCapability,
} from "@visonaut/security";
import {
  assertion,
  atomic,
  IncompleteError,
  statement,
  type ReferenceCaptureInput,
} from "@visonaut/service";
import type { ApiContext } from "./context.js";
import { firstAncestorSnapshot } from "./ingest.ts";
import { jsonBody, object, string } from "./input.js";
import { publicImage } from "./images.ts";
import type { CaptureInventory } from "../capture-inventory.ts";
import {
  readSnapshotInventory,
  readSnapshotInventoryBody,
  readSnapshotInventoryHeader,
} from "../inventory-records.ts";

interface StagedReferenceRun {
  id: string;
  tested_sha: string;
  verified_json: string;
}

const pageSize = 200;
const owner = (runId: string) => `submit:${runId}`;

interface ReferenceImageMembership {
  database: ApiContext["database"];
  key: string;
  imageIds: ReadonlySet<string>;
}

// Retain one verified ID set per bucket, bounded by the inventory's limits.
// Receipts, decoded profiles and pending I/O stay within their request.
// https://github.com/ariakit/visonaut/pull/247#discussion_r4178894713
const referenceImageMemberships = new WeakMap<ApiContext["images"], ReferenceImageMembership>();

async function referenceImageIds(context: ApiContext, snapshotId: string) {
  const header = await readSnapshotInventoryHeader(context, snapshotId);
  if (!header) return null;
  if (
    header.projectId !== context.configuration.projectId ||
    header.captureCount > context.configuration.limits.maximumCaptures
  ) {
    throw new IncompleteError("The accepted reference inventory differs from this project.");
  }
  const key = JSON.stringify(header);
  const cached = referenceImageMemberships.get(context.images);
  if (cached?.database === context.database && cached.key === key) {
    return cached.imageIds;
  }
  const inventory = await readSnapshotInventoryBody(context, header);
  const imageIds = new Set(inventory.captures.map((capture) => capture.image.id));
  referenceImageMemberships.set(context.images, { database: context.database, key, imageIds });
  return imageIds;
}

/** Accepted inventories are complete; their images never require a parent read. */
export async function referenceInventory(
  context: ApiContext,
  snapshotId: string | null,
): Promise<CaptureInventory | null> {
  if (snapshotId === null) return null;
  const snapshot = await context.database
    .prepare("SELECT reference_eligible FROM visonaut_snapshots WHERE id=? AND project_id=?")
    .bind(snapshotId, context.configuration.projectId)
    .first<{
      reference_eligible: number;
    }>();
  if (!snapshot || snapshot.reference_eligible !== 1) {
    throw new IncompleteError("The accepted reference inventory is unavailable.");
  }
  const inventory = await readSnapshotInventory(context, snapshotId);
  if (!inventory) return null;
  if (
    inventory.projectId !== context.configuration.projectId ||
    inventory.captures.length > context.configuration.limits.maximumCaptures
  ) {
    throw new IncompleteError("The accepted reference inventory differs from this project.");
  }
  return inventory;
}

export async function referenceCaptureInputs(
  context: ApiContext,
  snapshotId: string | null,
): Promise<ReferenceCaptureInput[]> {
  if (snapshotId === null) return [];
  const inventory = await referenceInventory(context, snapshotId);
  if (inventory) {
    return inventory.captures.map((capture) => ({
      id: capture.id,
      itemKey: capture.itemKey,
      variantKey: capture.variantKey,
      profileDigest: capture.profileDigest,
      renderingProfileDigest: capture.renderingProfileDigest,
      image: capture.image,
      metadata: capture.metadata,
    }));
  }
  const rows = await context.database
    .prepare(`SELECT capture.id AS capture_id,capture.item_key,capture.variant_key,
      capture.profile_digest,COALESCE(profile.rendering_digest,capture.profile_digest) AS rendering_digest,
      json_object('name',json_extract(capture.metadata_json,'$.name'),'variant',json_extract(capture.metadata_json,'$.variant')) AS label_json,
      image.* FROM visonaut_snapshot_images member JOIN visonaut_captures capture ON capture.id=member.capture_id
      JOIN visonaut_images image ON image.id=member.image_id
      LEFT JOIN visonaut_capture_profiles profile ON profile.digest=capture.profile_digest
      WHERE member.snapshot_id=? AND member.copied=1 AND image.bytes_present=1 AND image.validated=1 AND image.role='original'`)
    .bind(snapshotId)
    .all<{
      capture_id: string;
      item_key: string;
      variant_key: string;
      profile_digest: string;
      rendering_digest: string;
      label_json: string;
      id: string;
      run_id: string;
      digest: string;
      object_key: string;
      content_type: "image/png" | "image/webp";
      bytes: number;
      width: number;
      height: number;
    }>();
  return rows.results.map((row) => ({
    id: row.capture_id,
    itemKey: row.item_key,
    variantKey: row.variant_key,
    profileDigest: row.profile_digest,
    renderingProfileDigest: row.rendering_digest,
    image: {
      id: row.id,
      runId: row.run_id,
      digest: row.digest,
      objectKey: row.object_key,
      contentType: row.content_type,
      bytes: row.bytes,
      width: row.width,
      height: row.height,
    },
    // Only the name and the variant leave D1: the review row of a removal stores them.
    metadata: JSON.parse(row.label_json),
  }));
}

/** Stored in the existing signed run JSON; it is not supplied by capture code. */
async function storedReference(context: ApiContext, runId: string) {
  const row = await context.database
    .prepare(
      "SELECT json_extract(verified_json,'$.localReference') AS reference,json_extract(verified_json,'$.event') AS event FROM ingest_staged_runs WHERE id=? AND retention_state='live'",
    )
    .bind(runId)
    .first<{ reference: string | null; event: string }>();
  if (!row?.reference) return null;
  const reference: unknown = JSON.parse(row.reference);
  validateLocalReference(reference);
  return { reference, pullRequest: row.event === "pull_request" };
}

export async function referenceCaptures(
  context: ApiContext,
  runId: string,
  reference: LocalReferenceBinding,
  page?: { offset: number; limit: number },
): Promise<LocalReferenceCapture[]> {
  if (reference.snapshotId === null) return [];
  const inventory = await referenceInventory(context, reference.snapshotId);
  if (inventory) {
    const captures = [...inventory.captures].sort((first, second) => {
      const itemOrder = Buffer.compare(Buffer.from(first.itemKey), Buffer.from(second.itemKey));
      return (
        itemOrder || Buffer.compare(Buffer.from(first.variantKey), Buffer.from(second.variantKey))
      );
    });
    return captures
      .slice(page?.offset ?? 0, page ? page.offset + page.limit : undefined)
      .map((capture) => ({
        captureId: capture.id,
        itemKey: capture.itemKey,
        variantKey: capture.variantKey,
        profileDigest: capture.renderingProfileDigest,
        imageId: capture.image.id,
        image: {
          digest: capture.image.digest,
          mediaType: capture.image.contentType,
          bytes: capture.image.bytes,
          width: capture.image.width,
          height: capture.image.height,
        },
        path: `/v1/runs/${runId}/reference/images/${capture.image.id}`,
      }));
  }
  const rows = await context.database
    .prepare(`SELECT capture.id AS captureId,capture.item_key AS itemKey,capture.variant_key AS variantKey,
    COALESCE(profile.rendering_digest,capture.profile_digest) AS profileDigest,
    image.id AS imageId,image.digest,image.content_type AS mediaType,image.bytes,image.width,image.height
    FROM visonaut_snapshot_images member JOIN visonaut_captures capture ON capture.id=member.capture_id
    JOIN visonaut_images image ON image.id=member.image_id
    LEFT JOIN visonaut_capture_profiles profile ON profile.digest=capture.profile_digest
    WHERE member.snapshot_id=? AND member.copied=1 AND image.bytes_present=1 AND image.validated=1 AND image.role='original'
    ORDER BY capture.item_key,capture.variant_key LIMIT ? OFFSET ?`)
    .bind(
      reference.snapshotId,
      page?.limit ?? context.configuration.limits.maximumCaptures + 1,
      page?.offset ?? 0,
    )
    .all<{
      captureId: string;
      itemKey: string;
      variantKey: string;
      profileDigest: string;
      imageId: string;
      digest: string;
      mediaType: "image/png" | "image/webp";
      bytes: number;
      width: number;
      height: number;
    }>();
  return rows.results.map(({ digest, mediaType, bytes, width, height, ...capture }) => ({
    ...capture,
    image: { digest, mediaType, bytes, width, height },
    path: `/v1/runs/${runId}/reference/images/${capture.imageId}`,
  }));
}

export async function currentReference(
  context: ApiContext,
  reference: LocalReferenceBinding,
  pullRequest: boolean,
) {
  const project = await context.service.project(context.configuration.projectId);
  // A signed PR reference stays fixed while unrelated main runs promote.
  if (!pullRequest && project.baseline_revision !== reference.baselineRevision) {
    throw new SecurityError(
      "stale_reference",
      409,
      "The baseline changed. Run trusted Submit again to compare the complete capture bundle.",
    );
  }
  if (reference.snapshotId === null) {
    if (
      reference.captureCount !== 0 ||
      (!pullRequest && (!project.fresh_setup || project.snapshot_id !== null))
    ) {
      throw new SecurityError(
        "stale_reference",
        409,
        "An empty reference is only valid for fresh setup.",
      );
    }
  } else {
    const snapshot = await context.database
      .prepare(
        "SELECT 1 AS found FROM visonaut_snapshots snapshot JOIN visonaut_snapshot_retention retention ON retention.snapshot_id=snapshot.id WHERE snapshot.id=? AND snapshot.project_id=? AND snapshot.reference_eligible=1 AND snapshot.storage_mode='source' AND retention.byte_state='live' AND ((snapshot.inventory_key IS NOT NULL AND snapshot.inventory_verified=1) OR (snapshot.inventory_key IS NULL AND NOT EXISTS(SELECT 1 FROM visonaut_snapshot_images WHERE snapshot_id=snapshot.id AND copied!=1)))",
      )
      .bind(reference.snapshotId, project.id)
      .first();
    if (!snapshot) throw new IncompleteError("The accepted reference is no longer available.");
  }
  return project;
}

/** Reject a stored main reference after its baseline advanced. */
export async function validateAdmittedMainReference(context: ApiContext, runId: string) {
  const stored = await storedReference(context, runId);
  if (!stored) return;
  if (stored.pullRequest) return;
  const project = await context.service.project(context.configuration.projectId);
  if (project.baseline_revision > stored.reference.baselineRevision) {
    await currentReference(context, stored.reference, false);
  }
}

export async function referencePage(
  request: Request,
  context: ApiContext,
  capability: IngestCapability,
  run: StagedReferenceRun,
) {
  if (capability.comparisonMode !== LOCAL_COMPARISON_MODE || capability.shardKey !== "combined")
    throw new SecurityError(
      "comparison_mode",
      403,
      "Reference reads require the negotiated signed Submit mode.",
    );
  const body = await jsonBody(request, 32_768);
  validateDigest(body.manifestDigest);
  const manifestDigest = body.manifestDigest;
  let reference = (await storedReference(context, run.id))?.reference;
  const pullRequest = object(JSON.parse(run.verified_json)).event === "pull_request";
  if (!reference) {
    const project = await context.service.project(context.configuration.projectId);
    const verified = object(JSON.parse(run.verified_json));
    const main = verified.event === "push" || verified.event === "workflow_dispatch";
    const github = await createGitHubClient(context.configuration.github);
    const candidates = await context.service.referenceCandidates(project.id);
    const current = candidates.filter((snapshot) => snapshot.id === project.snapshot_id);
    // A main run can use only the project snapshot. Each other run prefers it,
    // then takes the newest accepted ancestor.
    const preferred = main
      ? current
      : [...current, ...candidates.filter((snapshot) => snapshot.id !== project.snapshot_id)];
    const selected = await firstAncestorSnapshot({
      context,
      github,
      testedSha: run.tested_sha,
      snapshots: preferred,
    });
    const snapshotId = selected?.id ?? null;
    if (snapshotId === null && !(project.fresh_setup && project.snapshot_id === null))
      throw new IncompleteError(
        "No retained accepted ancestor is eligible. Verify ancestry or capture current main.",
      );
    const provisional = {
      manifestDigest,
      snapshotId,
      baselineRevision: project.baseline_revision,
      inventoryDigest: "0".repeat(64),
      captureCount: 0,
    };
    const captures = await referenceCaptures(context, run.id, provisional);
    const inventory = await referenceInventory(context, snapshotId);
    if (captures.length > context.configuration.limits.maximumCaptures)
      throw new IncompleteError("The reference inventory exceeds the configured capture limit.");
    reference = {
      ...provisional,
      captureCount: captures.length,
      inventoryDigest: await digestJson(captures),
    };
    try {
      await atomic(context.database, [
        assertion(
          context.database,
          "EXISTS(SELECT 1 FROM visonaut_projects WHERE id=? AND baseline_revision=? AND snapshot_id IS ?)",
          [project.id, project.baseline_revision, project.snapshot_id],
        ),
        assertion(
          context.database,
          "EXISTS(SELECT 1 FROM ingest_staged_runs WHERE id=? AND retention_state='live' AND submitted_at IS NULL AND json_extract(verified_json,'$.localReference') IS NULL)",
          [run.id],
        ),
        ...(snapshotId
          ? [
              assertion(
                context.database,
                inventory
                  ? "EXISTS(SELECT 1 FROM visonaut_snapshots WHERE id=? AND inventory_verified=1 AND capture_count=?)"
                  : "(SELECT count(*) FROM visonaut_snapshot_images WHERE snapshot_id=?)=?",
                [snapshotId, captures.length],
              ),
              ...(inventory
                ? [
                    assertion(
                      context.database,
                      "NOT EXISTS(SELECT 1 FROM json_each(?) source WHERE NOT EXISTS(SELECT 1 FROM work_retained_runs WHERE id=source.value AND byte_state='live'))",
                      [
                        JSON.stringify([
                          ...new Set(inventory.captures.map((capture) => capture.image.runId)),
                        ]),
                      ],
                    ),
                  ]
                : []),
              statement(
                context.database,
                "INSERT INTO visonaut_pins(snapshot_id,reason,owner_id) VALUES(?,'local-submit',?)",
                [snapshotId, owner(run.id)],
              ),
              inventory
                ? statement(
                    context.database,
                    "INSERT OR IGNORE INTO work_retention_pins(run_id,owner,reason) SELECT value,?,'comparison' FROM json_each(?)",
                    [
                      owner(run.id),
                      JSON.stringify([
                        ...new Set(inventory.captures.map((capture) => capture.image.runId)),
                      ]),
                    ],
                  )
                : statement(
                    context.database,
                    "INSERT OR IGNORE INTO work_retention_pins(run_id,owner,reason) SELECT image.run_id,?,'comparison' FROM visonaut_snapshot_images member JOIN visonaut_images image ON image.id=member.image_id WHERE member.snapshot_id=?",
                    [owner(run.id), snapshotId],
                  ),
            ]
          : []),
        statement(
          context.database,
          "UPDATE ingest_staged_runs SET verified_json=json_set(verified_json,'$.localReference',json(?)) WHERE id=?",
          [JSON.stringify(reference), run.id],
        ),
      ]);
    } catch (error) {
      const raced = await storedReference(context, run.id);
      if (!raced) throw error;
      reference = raced.reference;
    }
  }
  if (
    reference.manifestDigest !== manifestDigest ||
    (capability.reference &&
      (await digestJson(capability.reference)) !== (await digestJson(reference)))
  )
    throw new SecurityError(
      "reference_conflict",
      409,
      "The selected reference belongs to another immutable capture manifest.",
    );
  await currentReference(context, reference, pullRequest);
  const cursor = body.cursor === undefined ? 0 : Number(string(body.cursor, 16));
  if (
    !Number.isSafeInteger(cursor) ||
    cursor < 0 ||
    cursor > reference.captureCount ||
    cursor % pageSize !== 0
  )
    throw new SecurityError("reference_cursor", 400, "The reference page cursor is invalid.");
  const end = Math.min(cursor + pageSize, reference.captureCount);
  const captures = await referenceCaptures(context, run.id, reference, {
    offset: cursor,
    limit: pageSize,
  });
  if (captures.length !== end - cursor)
    throw new IncompleteError("The pinned reference page is incomplete.");
  // The new credential binds the reference and keeps the end of the one that
  // came in. Only a reserve call, with its identity check, starts a new life.
  const bound = await bindIngestReference(
    context.configuration.capability,
    bearerToken(request),
    reference,
  );
  return Response.json({
    schemaVersion: "1.0",
    comparisonMode: LOCAL_COMPARISON_MODE,
    reference,
    captures,
    nextCursor: end < reference.captureCount ? String(end) : null,
    capability: bound.token,
    expiresAt: bound.expiresAt,
  });
}

export async function referenceImage(
  request: Request,
  context: ApiContext,
  capability: IngestCapability,
  runId: string,
  imageId: string,
) {
  const reference = capability.reference;
  if (
    capability.comparisonMode !== LOCAL_COMPARISON_MODE ||
    !reference ||
    reference.snapshotId === null
  )
    throw new SecurityError("reference_scope", 403, "The image is not in this Submit reference.");
  const stored = await storedReference(context, runId);
  if (!stored || (await digestJson(stored.reference)) !== (await digestJson(reference)))
    throw new SecurityError("reference_scope", 403, "The reference binding differs.");
  await currentReference(context, reference, stored.pullRequest);
  const imageIds = await referenceImageIds(context, reference.snapshotId);
  if (imageIds) {
    if (!imageIds.has(imageId)) {
      throw new SecurityError("reference_scope", 404, "The image is not in this Submit reference.");
    }
    return publicImage(request, context, imageId);
  }
  const found = await context.database
    .prepare(
      "SELECT 1 AS found FROM visonaut_snapshot_images WHERE snapshot_id=? AND image_id=? AND copied=1",
    )
    .bind(reference.snapshotId, imageId)
    .first();
  if (!found)
    throw new SecurityError("reference_scope", 404, "The image is not in this Submit reference.");
  return publicImage(request, context, imageId);
}

export async function validateLocalSubmission(
  context: ApiContext,
  runId: string,
  manifest: Manifest,
  binding?: LocalReferenceBinding,
) {
  const receipt = manifest.localComparison;
  if (!receipt || manifest.shard.key !== "combined")
    throw new IncompleteError("Local comparison requires the complete combined Submit manifest.");
  const stored = await storedReference(context, runId);
  const reference = binding ?? stored?.reference;
  if (
    !stored ||
    !reference ||
    (await digestJson(stored.reference)) !== (await digestJson(reference)) ||
    (await digestJson(receipt.reference)) !== (await digestJson(reference)) ||
    (await captureManifestDigest(manifest)) !== reference.manifestDigest
  )
    throw new SecurityError(
      "reference_conflict",
      409,
      "The comparison receipt is not bound to this complete capture manifest and reference.",
    );
  await currentReference(context, reference, stored.pullRequest);
  const captures = await referenceCaptures(context, runId, reference);
  if (
    captures.length !== reference.captureCount ||
    (await digestJson(captures)) !== reference.inventoryDigest
  )
    throw new IncompleteError("The complete pinned reference inventory changed.");
  const originals = new Map(captures.map((capture) => [identityKey(capture), capture]));
  const results = new Map(receipt.captures.map((result) => [identityKey(result), result]));
  if (
    results.size !== manifest.captures.length ||
    receipt.captures.length !== manifest.captures.length
  )
    throw new IncompleteError("Local comparison must report every captured identity exactly once.");
  for (const capture of manifest.captures) {
    const key = identityKey({ itemKey: capture.itemKey, variantKey: capture.variant.key });
    const result = results.get(key);
    const original = originals.get(key);
    const policy = capture.comparison;
    if (
      !result ||
      !policy ||
      result.candidateDigest !== capture.image.digest ||
      result.referenceDigest !== (original?.image.digest ?? null) ||
      capture.image.mediaType !== "image/png"
    )
      throw new IncompleteError(
        "A local result lost its capture, consumer settings, or reference identity.",
      );
    const profile = manifest.profiles.find((profile) => profile.digest === capture.profileDigest);
    if (!profile) throw new IncompleteError("The captured rendering profile is unavailable.");
    const profileChanged =
      original && original.profileDigest !== (await digestRenderingProfile(profile.profile));
    const sizeChanged =
      !!original &&
      (original.image.width !== capture.image.width ||
        original.image.height !== capture.image.height);
    assertDimensions(capture.image.width, capture.image.height, imageLimits);
    const area = capture.image.width * capture.image.height;
    const allowance = Math.min(
      policy.maxDiffPixels ?? Infinity,
      policy.maxDiffPixelRatio === undefined || !original
        ? Infinity
        : original.image.width * original.image.height * policy.maxDiffPixelRatio,
    );
    const maximum = allowance === Infinity ? 0 : allowance;
    const expectedChanged =
      !original ||
      sizeChanged ||
      (profileChanged && result.changedPixels !== 0) ||
      result.changedPixels > maximum;
    // Older signed receipts require review for profile-only changes. Their
    // immutable evidence remains valid; comparison import applies the policy.
    const legacyZeroPixelChange =
      !!original && !sizeChanged && result.changedPixels === 0 && result.outcome === "changed";
    if (
      result.sizeChanged !== sizeChanged ||
      result.changedPixels > area ||
      ((result.outcome === "changed") !== !!expectedChanged && !legacyZeroPixelChange) ||
      result.ratio !== (!original || sizeChanged ? 1 : result.changedPixels / area)
    ) {
      throw new IncompleteError(
        "Local comparison metrics or outcome differ from the consumer settings.",
      );
    }
    if (
      original &&
      !sizeChanged &&
      result.outcome === "changed" &&
      result.changedPixels > 0 &&
      !result.mask
    )
      throw new IncompleteError("A changed local capture requires its review mask.");
    if (
      result.mask &&
      (result.mask.width !== capture.image.width ||
        result.mask.height !== capture.image.height ||
        sizeChanged ||
        result.changedPixels === 0)
    )
      throw new IncompleteError("The local review mask differs from its changed capture.");
    originals.delete(key);
  }
  if (
    originals.size !== receipt.removals.length ||
    receipt.removals.some((removal) => !originals.has(identityKey(removal)))
  )
    throw new IncompleteError(
      "Local comparison must report every removed reference identity exactly once.",
    );
  return captures;
}
