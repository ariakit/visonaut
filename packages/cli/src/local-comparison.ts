import { createHash } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CAPTURE_PAGE_MAX_BYTES,
  captureRowView,
  compareCaptureIdentity,
  parseCapturePage,
  TRANSPORT,
} from "@visonaut/protocol";
import type { CapturePage, CaptureRowResult, CaptureRowView } from "@visonaut/protocol";
import { captureLabel, CliError, protocolVersion, record } from "./errors.js";
import { readImageFile } from "./files.js";
import { request } from "./http.js";
import { comparePixels, decodePng } from "./png-comparison.js";
import type { Session } from "./session.js";
import { imagePath } from "./submission.js";
import type { CaptureRecord } from "./submission.js";

export const MASK_DIRECTORY = "local-masks";

export function maskPath(digest: string): string {
  return `${MASK_DIRECTORY}/${digest}.png`;
}

type Identity = [itemKey: string, variantKey: string];

function identityOf(view: CaptureRowView): Identity {
  return [view.itemKey, view.variantKey];
}

async function referencePage(session: Session, number: number): Promise<CaptureRowView[]> {
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
  });
  protocolVersion(response);
  let page: CapturePage;
  try {
    page = parseCapturePage(response);
  } catch {
    throw new CliError("The service returned an invalid reference page.");
  }
  // A reference row is read only by its keys, its profile, and its image.
  return Promise.all(page.rows.map((row) => captureRowView(page, row)));
}

/**
 * Walk the reference of a run one page at a time. The reference and the
 * captures of the run have the same order, so each capture asks one time, in
 * that order. A reference capture that no capture of the run asks for is a
 * removal, which the service finds itself.
 */
export function referenceCursor(session: Session) {
  let rows: CaptureRowView[] = [];
  let position = 0;
  let nextPage = 1;
  let last: Identity | undefined;
  const current = async (): Promise<CaptureRowView | undefined> => {
    while (position >= rows.length) {
      if (nextPage > session.reference.pages) return;
      rows = await referencePage(session, nextPage++);
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
    async take(identity: Identity): Promise<CaptureRowView | undefined> {
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
  session: Session;
  /** The prepared directory with the images of the run. */
  directory: string;
  capture: CaptureRecord;
  accepted: CaptureRowView | undefined;
}

/**
 * Compare one capture with its reference. Only one decoded pair and one mask
 * are in memory. `combineBundles` already decoded the capture, so a new
 * capture and a capture with the bytes of its reference are not decoded here.
 */
export async function compareCapture({
  session,
  directory,
  capture,
  accepted,
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
  const candidate = await decodePng(
    await readImageFile(directory, { ...image, path: imagePath(image.digest) }, label),
    { ...image, mediaType: "image/png" },
    label,
  );
  const bytes = await request({
    url: new URL(TRANSPORT.referenceImage(session.runId, accepted.image.digest), session.origin),
    token: await session.capability(),
    responseMediaType: "image/png",
    maximumResponseBytes: accepted.image.bytes,
    retryUnavailable: true,
  });
  if (!Buffer.isBuffer(bytes)) {
    throw new CliError("The service returned invalid reference bytes.");
  }
  // The decode also checks the bytes against the digest and the Submit bounds.
  const reference = await decodePng(
    Buffer.from(bytes),
    { ...accepted.image, mediaType: "image/png" },
    `reference of ${label}`,
  );
  const { mask, ...metrics } = comparePixels({
    candidate,
    reference,
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
  try {
    await writeFile(join(directory, maskPath(digest)), mask, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!record(error) || error.code !== "EEXIST") {
      throw error;
    }
  }
  return {
    ...result,
    mask: { digest, bytes: mask.length, width: candidate.width, height: candidate.height },
  };
}
