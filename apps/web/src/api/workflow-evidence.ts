import {
  CAPTURE_PAGE_MAX_BYTES,
  CAPTURE_PAGE_ROWS,
  capturePageUploads,
  compareCaptureIdentity,
  parseCapturePage,
  parseCapturePageIndex,
  ProtocolError,
  sha256,
  type CapturePage,
  type CapturePageIndex,
  type CaptureRow,
  type CaptureRowImage,
} from "@visonaut/protocol";
import { IncompleteError } from "@visonaut/service";
import { SecurityError } from "@visonaut/security";
import { capturePageIndexLimits } from "../capture-pages.ts";
import type { ApiContext } from "./context.js";

/** The one D1 row of the staged page index of a job. The index step writes it. */
export interface StagedManifestEvidence {
  run_id: string;
  job_id: string;
  /** The digest of the page index, which is the manifest digest of the run. */
  manifest_digest: string;
  /** The key of the page index in the quarantine bucket. */
  manifest_object_key: string;
  declared_bytes: number;
  capture_count: number;
  complete: number;
  evidence_version: number;
  evidence_bytes: number | null;
}

// One SQL parameter holds the descriptors of at most 512 KiB.
// https://developers.cloudflare.com/d1/platform/limits/
const maximumDescriptorPageBytes = 512 * 1024;
// R2 accepts at most 1,000 objects per list request.
const maximumR2ListPageSize = 1000;
const stagedPagePattern = /\/([a-f0-9]{64})\.([1-9][0-9]*)\.json$/;

/**
 * The refusal of a run above the capture limit. It has its own code, so that a
 * client does not handle it as a limit that a wait or a smaller image clears.
 */
export function captureLimitExceeded(limit: number) {
  return new SecurityError(
    "capture_limit_exceeded",
    413,
    `The run has more captures than the capture limit of ${limit}.`,
  );
}

interface ImageDescriptorPagesParams {
  /** The PNG images of the rows and the masks that a job uploads. */
  images: Iterable<CaptureRowImage>;
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
    const descriptor = JSON.stringify({
      digest: image.digest,
      mediaType: "image/png",
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

function stagedPagePrefix(runId: string, jobId: string) {
  return `quarantine/staged/${runId}/${jobId}/pages/`;
}

interface StagedPageKeyParams {
  runId: string;
  jobId: string;
  digest: string;
  /** The row count is in the key, so that a list of the keys counts the rows of a run. */
  rows: number;
}

/** A staged page is one object of the quarantine bucket. D1 has no row for it. */
export function stagedPageKey({ runId, jobId, digest, rows }: StagedPageKeyParams) {
  return `${stagedPagePrefix(runId, jobId)}${digest}.${rows}.json`;
}

export function stagedIndexKey(runId: string, jobId: string, digest: string) {
  return `quarantine/staged/${runId}/${jobId}/manifests/${digest}.json`;
}

/** The row count of each staged page of a job, by the page digest. It reads no page. */
export async function listStagedPages(context: ApiContext, runId: string, jobId: string) {
  const pages = new Map<string, number>();
  let cursor: string | undefined;
  while (true) {
    const list = await context.quarantine.list({
      prefix: stagedPagePrefix(runId, jobId),
      limit: maximumR2ListPageSize,
      cursor,
    });
    for (const { key } of list.objects) {
      const match = stagedPagePattern.exec(key);
      if (!match?.[1] || !match[2]) {
        throw new IncompleteError("A staged page has an invalid key.");
      }
      pages.set(match[1], Number(match[2]));
    }
    if (!list.truncated) {
      return pages;
    }
    if (!list.cursor || list.cursor === cursor) {
      throw new IncompleteError("The staged page list is incomplete.");
    }
    cursor = list.cursor;
  }
}

function rowIdentity(page: CapturePage, row: CaptureRow | undefined): [string, string] {
  const variant = row ? page.variants[row[2]] : undefined;
  if (!row || !variant) {
    throw new IncompleteError("A staged page has no rows.");
  }
  return [row[0], variant.key];
}

interface ReadStagedPagesParams {
  context: ApiContext;
  runId: string;
  jobId: string;
  index: CapturePageIndex;
}

/**
 * Read each page that the index names, in the order of the index, and check
 * the rules that only a reader of all pages can check: the capture limit, the
 * row count of each page but the last one, and the order from one page to the
 * next.
 */
export async function readStagedPages({ context, runId, jobId, index }: ReadStagedPagesParams) {
  const staged = await listStagedPages(context, runId, jobId);
  const limit = context.configuration.limits.maximumCaptures;
  const pages: CapturePage[] = [];
  let total = 0;
  let previous: [string, string] | undefined;
  for (const [pageAt, entry] of index.pages.entries()) {
    const rows = staged.get(entry.digest);
    if (rows === undefined) {
      throw new IncompleteError("A page of the index was not sent.");
    }
    total += rows;
    if (total > limit) {
      throw captureLimitExceeded(limit);
    }
    if (pageAt < index.pages.length - 1 && rows !== CAPTURE_PAGE_ROWS) {
      throw new IncompleteError(`Each page but the last one needs ${CAPTURE_PAGE_ROWS} rows.`);
    }
    const stored = await context.quarantine.get(
      stagedPageKey({ runId, jobId, digest: entry.digest, rows }),
    );
    if (!stored || stored.size > CAPTURE_PAGE_MAX_BYTES) {
      throw new IncompleteError("A staged page is unavailable.");
    }
    const bytes = new Uint8Array(await stored.arrayBuffer());
    // The stored text is the canonical JSON of the page, so its hash is the page digest.
    if ((await sha256(bytes)) !== entry.digest) {
      throw new IncompleteError("A staged page differs from its digest.");
    }
    const page = parseCapturePage(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    const first = rowIdentity(page, page.rows[0]);
    const last = rowIdentity(page, page.rows.at(-1));
    if (
      page.rows.length !== rows ||
      (previous && compareCaptureIdentity(previous, first) >= 0) ||
      compareCaptureIdentity(last, entry.last) !== 0
    ) {
      throw new IncompleteError("The pages of the run differ from the order of the index.");
    }
    previous = last;
    pages.push(page);
  }
  return pages;
}

/** The images that the pages of a run need, and the two counts of its D1 row. */
export function runPageImages(pages: readonly CapturePage[]) {
  const uploads = new Map<string, CaptureRowImage>();
  // The bytes of the image of each row, by its digest.
  const originals = new Map<string, number>();
  let captureCount = 0;
  for (const page of pages) {
    captureCount += page.rows.length;
    for (const row of page.rows) {
      const [, , , , , , , digest, bytes] = row;
      originals.set(digest, bytes);
    }
    for (const [digest, image] of capturePageUploads(page)) {
      const first = uploads.get(digest);
      // One digest names one image, also across the pages of a run.
      if (
        first &&
        (first.bytes !== image.bytes ||
          first.width !== image.width ||
          first.height !== image.height)
      ) {
        throw new IncompleteError("One image digest of the run has two sizes.");
      }
      uploads.set(digest, image);
    }
  }
  let declaredBytes = 0;
  for (const bytes of originals.values()) {
    declaredBytes += bytes;
  }
  return { uploads, originals, declaredBytes, captureCount };
}

/** Parse the page index of a Submit job with the bounds of the service. */
export function parseStagedIndex(value: unknown) {
  return parseCapturePageIndex(value, capturePageIndexLimits);
}

export async function stagedManifestEvidence(context: ApiContext, runId: string, jobId: string) {
  const stored = await context.database
    .prepare("SELECT * FROM ingest_staged_manifests WHERE run_id = ? AND job_id = ?")
    .bind(runId, jobId)
    .first<StagedManifestEvidence>();
  if (!stored) {
    throw new IncompleteError("The staged page index is unavailable.");
  }
  return stored;
}

/** Read the page index of a job from the quarantine bucket, and check it against its D1 row. */
export async function readStagedIndex(
  context: ApiContext,
  stored: StagedManifestEvidence,
): Promise<CapturePageIndex> {
  if (stored.complete !== 1) {
    throw new IncompleteError("The staged page index is incomplete.");
  }
  const object = await context.quarantine.get(stored.manifest_object_key);
  if (!object || object.size !== stored.evidence_bytes) {
    throw new IncompleteError("The staged page index is unavailable.");
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  if ((await sha256(bytes)) !== stored.manifest_digest) {
    throw new IncompleteError("The staged page index differs from its immutable digest.");
  }
  try {
    return parseStagedIndex(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch (error) {
    if (!(error instanceof ProtocolError)) throw error;
    // A run that a job staged with an earlier request form has a manifest here.
    throw new IncompleteError("The staged run has no page index. Run Submit again.");
  }
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

/** Each staged image of a job, in the order of the digest. */
export async function evidenceImages(context: ApiContext, runId: string, jobId: string) {
  const images: EvidenceImage[] = [];
  let cursor = "";
  while (true) {
    const page = await context.database
      .prepare(`SELECT * FROM ingest_staged_images
      WHERE run_id = ? AND job_id = ? AND digest > ? ORDER BY digest LIMIT 512`)
      .bind(runId, jobId, cursor)
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

/**
 * The staged images of a job, when they are exactly the images that the pages
 * of the run need, and each one has its bytes.
 */
export async function exactEvidenceImages(
  context: ApiContext,
  { runId, jobId }: { runId: string; jobId: string },
  expected: ReadonlyMap<string, CaptureRowImage>,
) {
  const images = await evidenceImages(context, runId, jobId);
  if (images.length !== expected.size) {
    throw new IncompleteError("The staged image set differs.");
  }
  for (const image of images) {
    const descriptor = expected.get(image.digest);
    if (
      !descriptor ||
      image.media_type !== "image/png" ||
      image.bytes !== descriptor.bytes ||
      image.width !== descriptor.width ||
      image.height !== descriptor.height ||
      image.complete !== 1
    ) {
      throw new IncompleteError("The staged image set differs.");
    }
  }
  return images;
}
