import { CAPTURE_PAGE_ROWS, compareCaptureIdentity, identityKey } from "@visonaut/protocol";
import { IncompleteError, type ReviewRow, type RunRow } from "@visonaut/service";
import { readStoredCaptureInventory, type InventoryCapture } from "../capture-inventory.ts";
import { readCapturePage, type CapturePagesIndex } from "../capture-pages.ts";
import {
  inventoryPointer,
  readInventoryIndex,
  readRunInventory,
  readSnapshotInventory,
  readSnapshotInventoryBody,
  readSnapshotInventoryHeader,
  type SnapshotInventoryHeader,
} from "../inventory-records.ts";
import type { PrivateContext } from "./context.ts";

interface InventoryReviewCapture {
  id: string;
  item_key: string;
  variant_key: string;
  image_id: string;
  rendering_digest: string;
  metadata_json: string;
}
interface InventoryReviewImage {
  id: string;
  digest: string;
  width: number;
  height: number;
  bytes_present: number;
}

function reviewCaptures(captures: InventoryCapture[]): InventoryReviewCapture[] {
  return captures.map((capture) => ({
    id: capture.id,
    item_key: capture.itemKey,
    variant_key: capture.variantKey,
    image_id: capture.imageId,
    rendering_digest: capture.renderingProfileDigest,
    metadata_json: JSON.stringify(capture.metadata),
  }));
}
function reviewImages(captures: InventoryCapture[]): InventoryReviewImage[] {
  return captures.map((capture) => ({
    id: capture.image.id,
    digest: capture.image.digest,
    width: capture.image.width,
    height: capture.image.height,
    bytes_present: 1,
  }));
}
function byIdentity(captures: InventoryReviewCapture[]) {
  return new Map(
    captures.map((capture) => [
      identityKey({ itemKey: capture.item_key, variantKey: capture.variant_key }),
      capture,
    ]),
  );
}

/**
 * The capture list of a run and the list of its baseline, from the run row
 * that the caller has. A review read checks the key, the size, and the digest
 * of each list, and it does not validate the content a second time.
 */
export async function readReviewInventory(context: PrivateContext, run: RunRow) {
  const inventory = await readRunInventory(context, run, readStoredCaptureInventory);
  if (!inventory) return null;
  const referenceInventory = inventory.referenceSnapshotId
    ? await readSnapshotInventory(
        context,
        inventory.referenceSnapshotId,
        readStoredCaptureInventory,
      )
    : null;
  if (referenceInventory && referenceInventory.projectId !== inventory.projectId) {
    throw new IncompleteError("The review reference belongs to a different project.");
  }
  const candidates = reviewCaptures(inventory.captures);
  const references = referenceInventory
    ? reviewCaptures(referenceInventory.captures)
    : inventory.referenceSnapshotId
      ? (
          await context.database
            .prepare(`SELECT c.id,c.item_key,c.variant_key,c.image_id,c.metadata_json,
              COALESCE(p.rendering_digest,c.profile_digest) AS rendering_digest
              FROM visonaut_snapshot_images member JOIN visonaut_captures c ON c.id=member.capture_id
              LEFT JOIN visonaut_capture_profiles p ON p.digest=c.profile_digest
              WHERE member.snapshot_id=?`)
            .bind(inventory.referenceSnapshotId)
            .all<InventoryReviewCapture>()
        ).results
      : [];
  const images = [
    ...reviewImages(inventory.captures),
    ...(referenceInventory ? reviewImages(referenceInventory.captures) : []),
  ];
  if (inventory.referenceSnapshotId && !referenceInventory) {
    const referenceImages = await context.database
      .prepare(`SELECT i.id,i.digest,i.width,i.height,i.bytes_present
        FROM visonaut_snapshot_images member JOIN visonaut_images i ON i.id=member.image_id
        WHERE member.snapshot_id=?`)
      .bind(inventory.referenceSnapshotId)
      .all<InventoryReviewImage>();
    images.push(...referenceImages.results);
  }
  const referenceByIdentity = byIdentity(references);
  const candidateByIdentity = byIdentity(candidates);
  return { inventory, candidates, references, images, referenceByIdentity, candidateByIdentity };
}

/** A page by its number, or the page that holds one capture. */
export type CapturePagePlace = { page: number } | { itemKey: string; variantKey: string };

/** What the reader of one capture page needs of the capture lists. */
export interface ReviewPageEvidence {
  projectId: string;
  images: InventoryReviewImage[];
  referenceByIdentity: Map<string, InventoryReviewCapture>;
  candidateByIdentity: Map<string, InventoryReviewCapture>;
}

export interface ReviewCapturePage {
  evidence: ReviewPageEvidence;
  /** The captures of the page, in the order of the capture pages. */
  captures: InventoryCapture[];
  page: number;
  pages: number;
}

function captureOrder(first: InventoryCapture, second: InventoryCapture) {
  return compareCaptureIdentity(
    [first.itemKey, first.variantKey],
    [second.itemKey, second.variantKey],
  );
}

/** One page of a run from its complete capture list and the list of its baseline. */
async function listedPage(
  context: PrivateContext,
  run: RunRow,
  place: CapturePagePlace,
): Promise<ReviewCapturePage | null> {
  const evidence = await readReviewInventory(context, run);
  if (!evidence) return null;
  const captures = [...evidence.inventory.captures].sort(captureOrder);
  const position =
    "page" in place
      ? place.page * CAPTURE_PAGE_ROWS
      : captures.findIndex(
          (capture) => capture.itemKey === place.itemKey && capture.variantKey === place.variantKey,
        );
  if (position < 0 || position >= captures.length) return null;
  const page = Math.floor(position / CAPTURE_PAGE_ROWS);
  return {
    evidence: {
      projectId: evidence.inventory.projectId,
      images: evidence.images,
      referenceByIdentity: evidence.referenceByIdentity,
      candidateByIdentity: evidence.candidateByIdentity,
    },
    captures: captures.slice(page * CAPTURE_PAGE_ROWS, (page + 1) * CAPTURE_PAGE_ROWS),
    page,
    pages: Math.ceil(captures.length / CAPTURE_PAGE_ROWS),
  };
}

/**
 * The number of the stored page at a place. `null`: the run has no such page.
 * `undefined`: only a reader of all pages can find the page, because the run
 * has no index of a Submit job with the last identity of each page.
 */
function storedPageAt(index: CapturePagesIndex, place: CapturePagePlace) {
  if ("page" in place) {
    return index.pages[place.page] ? place.page : null;
  }
  if (!index.receipt) return;
  const pageAt = index.receipt.pages.findIndex(
    (page) => compareCaptureIdentity(page.last, [place.itemKey, place.variantKey]) >= 0,
  );
  return pageAt < 0 ? null : pageAt;
}

interface BaselineCapturesParams {
  context: PrivateContext;
  /** The header of the capture list of the baseline. */
  header: SnapshotInventoryHeader;
  /** The captures of one page of the run. */
  captures: InventoryCapture[];
  /** The number of that page. */
  pageAt: number;
}

/**
 * The captures of the baseline that one page of the run can need: each
 * baseline capture from the first identity of the page to its last identity.
 * A baseline in pages gives them from its stored pages in that range, and the
 * function reads the page with the number of the run page first. A run and a
 * baseline with the same captures read one page. The bound is the page count
 * of the baseline. A baseline in the list form gives its complete list.
 */
async function baselineCaptures({ context, header, captures, pageAt }: BaselineCapturesParams) {
  const index = await readInventoryIndex(context, header, "bytes");
  if (!index) {
    const inventory = await readSnapshotInventoryBody(context, header, readStoredCaptureInventory);
    return inventory.captures;
  }
  const first = captures[0];
  const last = captures.at(-1);
  if (!first || !last) return [];
  const read = (at: number) =>
    readCapturePage({ store: context.images, index, pageAt: at, check: "bytes" });
  let lowest = Math.min(pageAt, index.pages.length - 1);
  let highest = lowest;
  const found = await read(lowest);
  while (lowest > 0) {
    const start = found[0];
    if (!start || captureOrder(first, start) >= 0) break;
    lowest -= 1;
    found.unshift(...(await read(lowest)));
  }
  while (highest < index.pages.length - 1) {
    const end = found.at(-1);
    if (!end || captureOrder(last, end) <= 0) break;
    highest += 1;
    found.push(...(await read(highest)));
  }
  return found;
}

interface StoredPageParams {
  context: PrivateContext;
  index: CapturePagesIndex;
  /** The header of the capture list of the baseline, or `null` for a run with no baseline. */
  baseline: SnapshotInventoryHeader | null;
  pageAt: number;
  place: CapturePagePlace;
}

/** One page of a run in pages, from one stored page of the run. */
async function storedPage({
  context,
  index,
  baseline,
  pageAt,
  place,
}: StoredPageParams): Promise<ReviewCapturePage | null> {
  if (baseline && baseline.projectId !== index.projectId) {
    throw new IncompleteError("The review reference belongs to a different project.");
  }
  const captures = await readCapturePage({
    store: context.images,
    index,
    pageAt,
    check: "bytes",
  });
  const held =
    "page" in place ||
    captures.some(
      (capture) => capture.itemKey === place.itemKey && capture.variantKey === place.variantKey,
    );
  if (!held) return null;
  const references = baseline
    ? await baselineCaptures({ context, header: baseline, captures, pageAt })
    : [];
  return {
    evidence: {
      projectId: index.projectId,
      images: [...reviewImages(captures), ...reviewImages(references)],
      referenceByIdentity: byIdentity(reviewCaptures(references)),
      candidateByIdentity: byIdentity(reviewCaptures(captures)),
    },
    captures,
    page: pageAt,
    pages: index.pages.length,
  };
}

/**
 * One page of the captures of a run, with the captures of its baseline that
 * the page can need: the second request of a run page. The result is `null`
 * when the run has no capture list, or when the place is on no page.
 *
 * A run in pages reads its page index and one stored page. A review read
 * checks the key, the size, and the digest of each object, and it does not
 * validate the content a second time. A run in the list form reads its
 * complete list. So does a link to one capture of a run with no index of a
 * Submit job, and a run whose baseline has no capture list.
 */
export async function readReviewCapturePage(
  context: PrivateContext,
  run: RunRow,
  place: CapturePagePlace,
): Promise<ReviewCapturePage | null> {
  const pointer = inventoryPointer(run);
  if (!pointer) return null;
  const index = await readInventoryIndex(
    context,
    { ...pointer, runId: run.id, projectId: run.project_id, testedSha: run.tested_sha },
    "bytes",
  );
  if (!index) {
    return listedPage(context, run, place);
  }
  const pageAt = storedPageAt(index, place);
  if (pageAt === null) return null;
  if (pageAt === undefined) {
    return listedPage(context, run, place);
  }
  const baseline = index.referenceSnapshotId
    ? await readSnapshotInventoryHeader(context, index.referenceSnapshotId)
    : null;
  // A baseline from before the capture lists has its captures in D1. The
  // reader of the complete lists has that read, and it reads the header again.
  if (index.referenceSnapshotId && !baseline) {
    return listedPage(context, run, place);
  }
  return storedPage({ context, index, baseline, pageAt, place });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The review rows of the unchanged captures of one page. A capture with a
 * stored row is left out, because the first response of the run has it. Each
 * other capture must be unchanged: a capture with a change and no stored row
 * would be on no page, so the request fails.
 */
export function unchangedReviewRows(
  evidence: ReviewPageEvidence,
  captures: InventoryCapture[],
  comparisonId: string,
  stored: ReadonlySet<string>,
): ReviewRow[] {
  const imageById = new Map(evidence.images.map((image) => [image.id, image]));
  const rows: ReviewRow[] = [];
  for (const capture of captures) {
    const identity = identityKey(capture);
    if (stored.has(identity)) continue;
    const reference = evidence.referenceByIdentity.get(identity);
    const local = capture.metadata.localResult;
    const candidate = capture.metadata.observedImage;
    if (!reference || !isRecord(local) || !isRecord(candidate)) {
      throw new IncompleteError("An omitted review row lacks verified unchanged evidence.");
    }
    const image = imageById.get(reference.image_id);
    // Submit stores no row for a change of zero pixels with an equal size.
    const unchanged =
      local.outcome === "unchanged" ||
      (local.outcome === "changed" &&
        local.changedPixels === 0 &&
        local.ratio === 0 &&
        !local.maskImageId &&
        local.maskExpected !== true &&
        image !== undefined &&
        image.width === candidate.width &&
        image.height === candidate.height);
    if (!unchanged || !image) {
      throw new IncompleteError("A changed capture is missing its persisted review row.");
    }
    rows.push({
      id: `${comparisonId}:${capture.id}`,
      comparison_id: comparisonId,
      item_key: capture.itemKey,
      variant_key: capture.variantKey,
      ordinal: capture.ordinal,
      reference_capture_id: reference.id,
      candidate_capture_id: capture.id,
      tuple_json: JSON.stringify({
        projectId: evidence.projectId,
        itemKey: capture.itemKey,
        variantKey: capture.variantKey,
        referenceDigest: image.digest,
        candidateDigest: candidate.digest,
        referenceProfileDigest: reference.rendering_digest,
        candidateProfileDigest: capture.renderingProfileDigest,
        comparisonPolicyDigest: capture.metadata.comparisonDigest,
        comparisonEngineVersion: local.engineVersion,
        imageCodecVersion: local.codecVersion,
      }),
      outcome: "unchanged",
      result_json: JSON.stringify({ ...local, outcome: "unchanged" }),
      decision_revision: 0,
      decision_id: null,
      source_decision_id: null,
    });
  }
  return rows;
}
