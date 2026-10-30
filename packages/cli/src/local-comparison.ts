import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { imageLimits } from "@visonaut/compare";
import {
  CAPTURE_PAGE_MAX_BYTES,
  canonicalJson,
  captureRowView,
  compareCaptureIdentity,
  parseReferencePage,
  TRANSPORT,
} from "@visonaut/protocol";
import type {
  CaptureRowComparison,
  CaptureRowResult,
  CaptureRowView,
  ReferencePage,
} from "@visonaut/protocol";
import { captureLabel, CliError, protocolVersion } from "./errors.js";
import { readImageFile } from "./files.js";
import { request } from "./http.js";
import { ImagePool } from "./image-pool.js";
import type { Session } from "./session.js";
import { imagePath } from "./submission.js";
import type { CaptureRecord } from "./submission.js";

export const MASK_DIRECTORY = "local-masks";
// Keep at most 32 reference requests and 16 MiB of encoded references beside
// one decoded image pair for each image worker.
const REFERENCE_DOWNLOAD_CONCURRENCY = 32;
const REFERENCE_DOWNLOAD_BYTES = 16 * 1024 * 1024;
// Bound the captures that wait in the window when most need no download.
const COMPARISON_LOOKAHEAD = 256;

export function maskPath(digest: string): string {
  return `${MASK_DIRECTORY}/${digest}.png`;
}

type Identity = [itemKey: string, variantKey: string];

/** The time that the comparison of the captures spends in each phase. */
export interface ComparisonTimings {
  /** The time that the comparison waits for reference image downloads. */
  referenceImagesMs: number;
  /**
   * The time that the comparison waits for the image workers to decode and
   * compare the images, and to write the masks.
   */
  comparisonMs: number;
  /** The time that the comparison waits for reference pages. */
  referencePagesMs: number;
  /** The time that the reference reads wait before they retry, summed over the parallel reads. */
  referenceRetryWaitMs: number;
  /** The count of image workers that can decode and compare at the same time. */
  workers: number;
}

export function comparisonTimings(): ComparisonTimings {
  return {
    referenceImagesMs: 0,
    comparisonMs: 0,
    referencePagesMs: 0,
    referenceRetryWaitMs: 0,
    workers: 0,
  };
}

/** A reference row, with the capture digest of a stored result that this CLI can reuse. */
interface ReferenceRow extends CaptureRowView {
  reusableDigest: string | null;
}

function identityOf(view: CaptureRowView): Identity {
  return [view.itemKey, view.variantKey];
}

interface ReferencePageParams {
  session: Session;
  /** The page number. It starts at 1. */
  number: number;
  cliVersion: string;
  timings: ComparisonTimings;
}

async function referencePage({
  session,
  number,
  cliVersion,
  timings,
}: ReferencePageParams): Promise<ReferenceRow[]> {
  const { digest } = session.reference;
  if (digest === null) {
    throw new CliError("The run has no reference page.");
  }
  const response = await request({
    url: new URL(TRANSPORT.referencePage(session.runId, digest, number), session.origin),
    token: await session.capability(),
    // The service can send the page with other spacing than the canonical bytes.
    maximumResponseBytes: 2 * CAPTURE_PAGE_MAX_BYTES,
    retryUnavailable: true,
    retryTransient: true,
    onRetryWait: (elapsedMs) => {
      timings.referenceRetryWaitMs += elapsedMs;
    },
  });
  protocolVersion(response);
  let page: ReferencePage;
  try {
    page = parseReferencePage(response);
  } catch {
    throw new CliError("The service returned an invalid reference page.");
  }
  // Another version can have another comparator, so its results do not hold here.
  const reusable = page.reusableResults;
  const digests = reusable?.cliVersion === cliVersion ? reusable.digests : [];
  // A reference row is read only by its keys, its profile, its image, and its settings.
  return Promise.all(
    page.rows.map(async (row, rowAt) => ({
      ...(await captureRowView(page, row)),
      reusableDigest: digests[rowAt] ?? null,
    })),
  );
}

/**
 * Walk the reference of a run one page at a time. The reference and the
 * captures of the run have the same order, so each capture asks one time, in
 * that order. A reference capture that no capture of the run asks for is a
 * removal, which the service finds itself.
 */
export function referenceCursor(
  session: Session,
  cliVersion: string,
  timings = comparisonTimings(),
) {
  let rows: ReferenceRow[] = [];
  let position = 0;
  let nextPage = 1;
  let last: Identity | undefined;
  const current = async (): Promise<ReferenceRow | undefined> => {
    while (position >= rows.length) {
      if (nextPage > session.reference.pages) return;
      const started = performance.now();
      rows = await referencePage({ session, number: nextPage++, cliVersion, timings });
      timings.referencePagesMs += performance.now() - started;
      position = 0;
      for (const row of rows) {
        const identity = identityOf(row);
        // One page is in order. This also checks the order from page to page.
        if (last && compareCaptureIdentity(last, identity) >= 0) {
          throw new CliError("The reference inventory has duplicate or unordered captures.");
        }
        last = identity;
      }
    }
    return rows[position];
  };
  return {
    /** The reference capture with this identity, or nothing when the capture is new. */
    async take(identity: Identity): Promise<ReferenceRow | undefined> {
      while (true) {
        const row = await current();
        if (!row) return;
        const order = compareCaptureIdentity(identityOf(row), identity);
        if (order > 0) return;
        position++;
        if (order === 0) return row;
      }
    },
  };
}

interface CompareCaptureParams {
  /** The prepared directory with the images of the run. */
  directory: string;
  pool: ImagePool;
  capture: CaptureRecord;
  accepted: ReferenceRow | undefined;
  referenceBytes: Buffer | undefined;
}

interface CompareCapturesParams {
  session: Session;
  directory: string;
  captures: AsyncIterable<CaptureRecord>;
  /** The version of this CLI, which selects the stored results that it can reuse. */
  cliVersion: string;
  timings?: ComparisonTimings;
}

interface ComparisonInput {
  capture: CaptureRecord;
  accepted: ReferenceRow | undefined;
}

/**
 * The stored result of this capture, when an earlier run of this CLI version
 * compared the same bytes with the same kept image and settings. The comparison
 * would give it again.
 */
function reusableResult({ capture, accepted }: ComparisonInput): CaptureRowComparison | undefined {
  if (!accepted) return;
  if (accepted.reusableDigest !== capture.image.digest) return;
  if (canonicalJson(accepted.comparison) !== canonicalJson(capture.comparison)) return;
  return {
    reference: accepted.image.digest,
    outcome: "unchanged",
    changedPixels: 0,
    ratio: 0,
    sizeChanged: false,
  };
}

/** The encoded bytes that the reference of this capture reserves, or 0 with no download. */
function downloadBytes(input: ComparisonInput) {
  const { capture, accepted } = input;
  if (!accepted) return 0;
  if (accepted.image.digest === capture.image.digest) return 0;
  if (reusableResult(input)) return 0;
  return Math.min(accepted.image.bytes, imageLimits.maxEncodedBytes);
}

interface DownloadReferenceParams {
  session: Session;
  input: ComparisonInput;
  bytes: number;
  timings: ComparisonTimings;
}

async function downloadReference({ session, input, bytes, timings }: DownloadReferenceParams) {
  const { accepted } = input;
  if (!accepted || !bytes) return;
  const response = await request({
    url: new URL(TRANSPORT.referenceImage(session.runId, accepted.image.digest), session.origin),
    token: await session.capability(),
    responseMediaType: "image/png",
    maximumResponseBytes: bytes,
    retryUnavailable: true,
    retryTransient: true,
    onRetryWait: (elapsedMs) => {
      timings.referenceRetryWaitMs += elapsedMs;
    },
  });
  if (!Buffer.isBuffer(response)) {
    throw new CliError("The service returned invalid reference bytes.");
  }
  return response;
}

/** The result of a reference download. A failure is a value, so a waiting download never rejects. */
type Download = { bytes: Buffer | undefined } | { failure: unknown };

interface PendingComparison extends ComparisonInput {
  /** The encoded bytes that the download reserves until the comparison of the capture ends. */
  bytes: number;
  download: Promise<Download>;
}

/** The end of a comparison. A failure is a value, so a running comparison never rejects. */
type Comparison = { downloadedAt: number } & ({ result: CaptureRowResult } | { failure: unknown });

interface RunningComparison {
  capture: CaptureRecord;
  comparison: Promise<Comparison>;
}

/**
 * Compare the captures in order. A window of reference downloads runs ahead of
 * the comparison, so the next downloads continue while the image workers
 * decode and compare. Up to one capture for each worker is compared at a time,
 * and the results come in the order of the captures. Each failure drains the
 * downloads and the comparisons before it is reported.
 */
export async function* compareCaptures({
  session,
  directory,
  captures,
  cliVersion,
  timings = comparisonTimings(),
}: CompareCapturesParams) {
  await using pool = new ImagePool();
  timings.workers = pool.size;
  const reference = referenceCursor(session, cliVersion, timings);
  const iterator = captures[Symbol.asyncIterator]();
  const window: PendingComparison[] = [];
  const running: RunningComparison[] = [];
  let next: ComparisonInput | undefined;
  let done = false;
  let failed = false;
  let requests = 0;
  let reservedBytes = 0;
  // Read captures and start their downloads until the window is full. A capture
  // that does not fit waits in `next`, so the order of the captures stays.
  const fill = async () => {
    while (!done && !failed && window.length < COMPARISON_LOOKAHEAD) {
      if (!next) {
        const step = await iterator.next();
        if (step.done) {
          done = true;
          return;
        }
        const capture = step.value;
        const accepted = await reference.take([capture.itemKey, capture.variant.key]);
        next = { capture, accepted };
      }
      const bytes = downloadBytes(next);
      if (bytes) {
        if (requests === REFERENCE_DOWNLOAD_CONCURRENCY) return;
        if (reservedBytes + bytes > REFERENCE_DOWNLOAD_BYTES) return;
        requests++;
        reservedBytes += bytes;
      }
      const download = downloadReference({ session, input: next, bytes, timings }).then(
        (value): Download => ({ bytes: value }),
        (failure: unknown): Download => {
          failed = true;
          return { failure };
        },
      );
      window.push({ ...next, bytes, download });
      next = undefined;
    }
  };
  const compare = async (pending: PendingComparison): Promise<Comparison> => {
    const download = await pending.download;
    const downloadedAt = performance.now();
    if ("failure" in download) return { downloadedAt, failure: download.failure };
    try {
      const result = await compareCapture({
        directory,
        pool,
        capture: pending.capture,
        accepted: pending.accepted,
        referenceBytes: download.bytes,
      });
      return { downloadedAt, result };
    } catch (failure) {
      failed = true;
      return { downloadedAt, failure };
    } finally {
      if (pending.bytes) {
        requests--;
        reservedBytes -= pending.bytes;
      }
    }
  };
  try {
    while (true) {
      await fill();
      while (running.length < pool.size) {
        const pending = window.shift();
        if (!pending) break;
        running.push({ capture: pending.capture, comparison: compare(pending) });
      }
      const head = running.shift();
      if (!head) return;
      const waitStarted = performance.now();
      const comparison = await head.comparison;
      const waitEnded = performance.now();
      // Split the wait at the end of the download, so that the two phases add
      // up to the time that the results wait.
      const downloaded = Math.min(Math.max(comparison.downloadedAt, waitStarted), waitEnded);
      timings.referenceImagesMs += downloaded - waitStarted;
      timings.comparisonMs += waitEnded - downloaded;
      if ("failure" in comparison) {
        throw comparison.failure;
      }
      yield { capture: head.capture, result: comparison.result };
    }
  } finally {
    // Drain every request and comparison before a failure is reported or the
    // command ends.
    await Promise.all([
      ...window.map((pending) => pending.download),
      ...running.map((entry) => entry.comparison),
    ]);
    await iterator.return?.();
  }
}

/**
 * Compare one capture with its reference on an image worker. `combineBundles`
 * already decoded the capture, so a new capture, a capture with the bytes of
 * its reference, and a capture with a reusable result are not decoded here.
 */
export async function compareCapture({
  directory,
  pool,
  capture,
  accepted,
  referenceBytes,
}: CompareCaptureParams): Promise<CaptureRowResult> {
  if (!accepted) return 1;
  const label = captureLabel(capture.itemKey, capture.variant.key);
  const { image } = capture;
  if (accepted.image.digest === image.digest) {
    if (
      accepted.image.bytes !== image.bytes ||
      accepted.image.width !== image.width ||
      accepted.image.height !== image.height
    ) {
      throw new CliError("The service returned invalid reference image metadata.");
    }
    return 0;
  }
  const reused = reusableResult({ capture, accepted });
  if (reused) {
    return reused;
  }
  const candidateBytes = await readImageFile(
    directory,
    { ...image, path: imagePath(image.digest) },
    label,
  );
  if (!referenceBytes) {
    throw new CliError("The service returned invalid reference bytes.");
  }
  // The decode also checks the bytes against the digest and the Submit bounds.
  const { mask, ...metrics } = await pool.compare({
    candidate: { bytes: candidateBytes, metadata: { ...image, mediaType: "image/png" }, label },
    reference: {
      bytes: referenceBytes,
      metadata: { ...accepted.image, mediaType: "image/png" },
      label: `reference of ${label}`,
    },
    comparison: capture.comparison,
    profileChanged: capture.profileDigest !== accepted.profileDigest,
  });
  const result = { reference: accepted.image.digest, ...metrics };
  if (!mask) return result;
  const maskDirectory = join(directory, MASK_DIRECTORY);
  await mkdir(maskDirectory, { mode: 0o700, recursive: true });
  const details = await lstat(maskDirectory);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new CliError("The local mask directory is not a regular private directory.");
  }
  const digest = createHash("sha256").update(mask).digest("hex");
  // Two comparisons at the same time can make the same mask. A rename puts the
  // complete file in place, so a page never reads a mask that is half written.
  const temporary = join(maskDirectory, `${digest}.${randomUUID()}.tmp`);
  await writeFile(temporary, mask, { flag: "wx", mode: 0o600 });
  await rename(temporary, join(directory, maskPath(digest)));
  return {
    ...result,
    mask: { digest, bytes: mask.length, width: image.width, height: image.height },
  };
}
