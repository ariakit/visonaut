import {
  canonicalJson,
  captureManifestDigest,
  digestJson,
  parseManifest,
  sha256,
  uploadImages,
  type Manifest,
} from "@visonaut/protocol";
import {
  assertion,
  atomic,
  IncompleteError,
  type Database,
  type Statement,
} from "@visonaut/service";
import { SecurityError } from "@visonaut/security";
import type { ApiContext } from "./context.js";

export interface StagedManifestEvidence {
  run_id: string;
  job_id: string;
  manifest_digest: string;
  manifest_object_key: string;
  declared_bytes: number;
  capture_count: number;
  complete: number;
  evidence_version: number;
  evidence_bytes: number | null;
  evidence_page_count: number | null;
  evidence_page_bytes: number | null;
  capture_manifest_digest: string | null;
  declaration_complete: number;
  local_receipt_validated: number;
}

interface EncodedEvidence {
  bytes: Uint8Array<ArrayBuffer>;
  digest: string;
  captureDigest: string;
  pageBytes: number;
  pages: ArrayBuffer[];
}

// Four 256 KiB records bound reads to 1 MiB and bound write parameters to
// 2 MiB (insert plus equality proof). Decode UTF-8 only after reassembly.
// https://developers.cloudflare.com/d1/platform/limits/
const maximumPageBytes = 256 * 1024;
const pagesPerBatch = 4;
const maximumPageCount = 256;
const maximumDescriptorPageBytes = 512 * 1024;

interface ImageDescriptorPagesParams {
  images: Iterable<Manifest["captures"][number]["image"]>;
  runId: string;
  jobId: string;
  maximumBytes?: number;
}

export function* imageDescriptorPages({
  images,
  runId,
  jobId,
  maximumBytes = maximumDescriptorPageBytes,
}: ImageDescriptorPagesParams) {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 2 ||
    maximumBytes > maximumDescriptorPageBytes
  ) {
    throw new TypeError("Invalid descriptor page size.");
  }
  const encoder = new TextEncoder();
  let entries: string[] = [];
  let bytes = 2;
  for (const image of images) {
    const imageId = crypto.randomUUID();
    // Keep paths and extensions in canonical evidence, outside the SQL parameter.
    const descriptor = JSON.stringify({
      digest: image.digest,
      mediaType: image.mediaType,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
      imageId,
      objectKey: `runs/${runId}/images/${imageId}`,
      quarantineKey: `quarantine/staged/${runId}/${jobId}/${image.digest}`,
    });
    const length = encoder.encode(descriptor).length;
    if (length + 2 > maximumBytes) {
      throw new SecurityError("upload_limit", 413, "The image descriptor exceeds its byte limit.");
    }
    if (entries.length && (entries.length === 1024 || bytes + 1 + length > maximumBytes)) {
      yield `[${entries.join(",")}]`;
      entries = [];
      bytes = 2;
    }
    bytes += length + (entries.length ? 1 : 0);
    entries.push(descriptor);
  }
  if (entries.length) {
    yield `[${entries.join(",")}]`;
  }
}

export async function encodeManifestEvidence(
  manifest: Manifest,
  maximumBytes: number,
  pageBytes = maximumPageBytes,
): Promise<EncodedEvidence> {
  const bytes = new TextEncoder().encode(canonicalJson(manifest));
  if (bytes.byteLength > maximumBytes) {
    throw new SecurityError("upload_limit", 413, "The canonical manifest exceeds its byte limit.");
  }
  if (!Number.isSafeInteger(pageBytes) || pageBytes < 1 || pageBytes > maximumPageBytes) {
    throw new TypeError("Invalid evidence page size.");
  }
  const pages: ArrayBuffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += pageBytes) {
    pages.push(bytes.slice(offset, offset + pageBytes).buffer);
  }
  if (pages.length > maximumPageCount) {
    throw new SecurityError("upload_limit", 413, "The evidence page count exceeds its limit.");
  }
  return {
    bytes,
    digest: await sha256(bytes),
    captureDigest: await captureManifestDigest(manifest),
    pageBytes,
    pages,
  };
}

export function evidenceFence(database: Database, stored: StagedManifestEvidence): Statement {
  return assertion(
    database,
    `EXISTS (SELECT 1 FROM ingest_staged_manifests manifest
      JOIN ingest_staged_runs staged ON staged.id = manifest.run_id
      WHERE manifest.run_id = ? AND manifest.job_id = ? AND manifest.manifest_digest = ?
        AND manifest.evidence_version = ? AND manifest.manifest_object_key = ?
        AND manifest.declared_bytes = ? AND manifest.capture_count = ?
        AND manifest.evidence_bytes IS ? AND manifest.evidence_page_count IS ?
        AND manifest.evidence_page_bytes IS ? AND manifest.capture_manifest_digest IS ?
        AND staged.retention_state = 'live' AND staged.submitted_at IS NULL)`,
    [
      stored.run_id,
      stored.job_id,
      stored.manifest_digest,
      stored.evidence_version,
      stored.manifest_object_key,
      stored.declared_bytes,
      stored.capture_count,
      stored.evidence_bytes,
      stored.evidence_page_count,
      stored.evidence_page_bytes,
      stored.capture_manifest_digest,
    ],
  );
}

interface WriteEvidencePagesParams {
  database: Database;
  stored: StagedManifestEvidence;
  encoded: EncodedEvidence;
}

export async function writeEvidencePages({ database, stored, encoded }: WriteEvidencePagesParams) {
  for (let offset = 0; offset < encoded.pages.length; offset += pagesPerBatch) {
    const statements: Statement[] = [evidenceFence(database, stored)];
    for (const [index, content] of encoded.pages.slice(offset, offset + pagesPerBatch).entries()) {
      const page = offset + index;
      statements.push(
        database
          .prepare(`INSERT INTO ingest_staged_evidence_pages
          (run_id, job_id, page_number, content)
          SELECT run_id, job_id, ?, ? FROM ingest_staged_manifests
          WHERE run_id = ? AND job_id = ? AND declaration_complete = 0
            AND ? < evidence_page_count
          ON CONFLICT(run_id, job_id, page_number) DO NOTHING`)
          .bind(page, content, stored.run_id, stored.job_id, page),
        assertion(
          database,
          `EXISTS (SELECT 1 FROM ingest_staged_evidence_pages
          WHERE run_id = ? AND job_id = ? AND page_number = ? AND content = ?)`,
          [stored.run_id, stored.job_id, page, content],
        ),
      );
    }
    await atomic(database, statements);
  }
}

export async function stagedManifestEvidence(context: ApiContext, runId: string, jobId: string) {
  const stored = await context.database
    .prepare("SELECT * FROM ingest_staged_manifests WHERE run_id = ? AND job_id = ?")
    .bind(runId, jobId)
    .first<StagedManifestEvidence>();
  if (!stored) {
    throw new IncompleteError("The staged manifest is unavailable.");
  }
  return stored;
}

export async function readManifestEvidence(
  context: ApiContext,
  stored: StagedManifestEvidence,
  allowIncomplete = false,
): Promise<Manifest> {
  const maximumBytes = context.configuration.limits.maximumManifestBytes;
  if (stored.evidence_version === 1) {
    const object = await context.quarantine.get(stored.manifest_object_key);
    if (!object || object.size > maximumBytes) {
      throw new IncompleteError("The staged manifest is unavailable.");
    }
    const manifest = parseManifest(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await object.arrayBuffer())),
    );
    if ((await digestJson(manifest)) !== stored.manifest_digest) {
      throw new IncompleteError("The staged manifest digest differs.");
    }
    return manifest;
  }
  const length = stored.evidence_bytes;
  const count = stored.evidence_page_count;
  const pageBytes = stored.evidence_page_bytes;
  if (
    stored.evidence_version !== 2 ||
    (!allowIncomplete && stored.declaration_complete !== 1) ||
    length === null ||
    count === null ||
    pageBytes === null ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > maximumBytes ||
    !Number.isSafeInteger(pageBytes) ||
    pageBytes < 1 ||
    pageBytes > maximumPageBytes ||
    count > maximumPageCount ||
    count !== Math.ceil(length / pageBytes)
  ) {
    throw new IncompleteError("The staged evidence header is incomplete.");
  }
  const inventory = await context.database
    .prepare(`SELECT COUNT(*) AS count,
    COALESCE(SUM(length(content)), 0) AS bytes FROM ingest_staged_evidence_pages
    WHERE run_id = ? AND job_id = ?`)
    .bind(stored.run_id, stored.job_id)
    .first<{ count: number; bytes: number }>();
  if (inventory?.count !== count || inventory.bytes !== length) {
    throw new IncompleteError("The staged evidence pages are incomplete.");
  }
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < count; offset += pagesPerBatch) {
    const pages = await context.database
      .prepare(`SELECT page_number, content
      FROM ingest_staged_evidence_pages WHERE run_id = ? AND job_id = ?
        AND page_number >= ? ORDER BY page_number LIMIT ?`)
      .bind(stored.run_id, stored.job_id, offset, Math.min(pagesPerBatch, count - offset))
      .all<{ page_number: number; content: number[] }>();
    if (pages.results?.length !== Math.min(pagesPerBatch, count - offset)) {
      throw new IncompleteError("The staged evidence pages are incomplete.");
    }
    for (const [index, page] of pages.results.entries()) {
      const pageNumber = offset + index;
      const expectedBytes = Math.min(pageBytes, length - pageNumber * pageBytes);
      if (
        page.page_number !== pageNumber ||
        !Array.isArray(page.content) ||
        page.content.length !== expectedBytes ||
        page.content.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
      ) {
        throw new IncompleteError("The staged evidence page differs.");
      }
      bytes.set(page.content, pageNumber * pageBytes);
    }
  }
  if ((await sha256(bytes)) !== stored.manifest_digest) {
    throw new IncompleteError("The staged evidence digest differs.");
  }
  const manifest = parseManifest(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  if (
    (await digestJson(manifest)) !== stored.manifest_digest ||
    (await captureManifestDigest(manifest)) !== stored.capture_manifest_digest
  ) {
    throw new IncompleteError("The staged evidence is not the canonical manifest.");
  }
  return manifest;
}

export interface EvidenceImage {
  run_id: string;
  job_id: string;
  image_id: string;
  object_key: string;
  quarantine_key: string;
  digest: string;
  media_type: "image/png" | "image/webp";
  bytes: number;
  width: number;
  height: number;
  complete: number;
}

export async function evidenceImages(context: ApiContext, stored: StagedManifestEvidence) {
  const images: EvidenceImage[] = [];
  let cursor = "";
  while (true) {
    const page = await context.database
      .prepare(`SELECT * FROM ingest_staged_images
      WHERE run_id = ? AND job_id = ? AND digest > ? ORDER BY digest LIMIT 512`)
      .bind(stored.run_id, stored.job_id, cursor)
      .all<EvidenceImage>();
    if (!page.results?.length) break;
    images.push(...page.results);
    const last = page.results.at(-1);
    if (!last) break;
    cursor = last.digest;
    if (images.length > context.configuration.limits.maximumCaptures * 2) {
      throw new IncompleteError("The staged image inventory exceeds its limit.");
    }
    if (page.results.length < 512) break;
  }
  return images;
}

export async function exactEvidenceImages(
  context: ApiContext,
  stored: StagedManifestEvidence,
  manifest: Manifest,
  requireComplete = false,
) {
  const expected = uploadImages(manifest);
  const images = await evidenceImages(context, stored);
  if (images.length !== expected.size) {
    throw new IncompleteError("The staged image set differs.");
  }
  for (const image of images) {
    const descriptor = expected.get(image.digest);
    if (
      !descriptor ||
      image.media_type !== descriptor.mediaType ||
      image.bytes !== descriptor.bytes ||
      image.width !== descriptor.width ||
      image.height !== descriptor.height ||
      (requireComplete && image.complete !== 1)
    ) {
      throw new IncompleteError("The staged image descriptor differs.");
    }
  }
  return images;
}

/** Admission fixes the descriptor set; later API writes only mark bytes complete. */
export function evidenceImageAssertions(
  database: Database,
  stored: StagedManifestEvidence,
  manifest: Manifest,
  requireComplete = false,
): Statement[] {
  return [
    assertion(
      database,
      `(SELECT COUNT(*) FROM ingest_staged_images
    WHERE run_id = ? AND job_id = ?) = ? AND (? = 0 OR NOT EXISTS (
      SELECT 1 FROM ingest_staged_images WHERE run_id = ? AND job_id = ? AND complete != 1))`,
      [
        stored.run_id,
        stored.job_id,
        uploadImages(manifest).size,
        requireComplete ? 1 : 0,
        stored.run_id,
        stored.job_id,
      ],
    ),
  ];
}
