import {
  canonicalJson,
  CAPTURE_PAGE_MAX_BYTES,
  CAPTURE_PAGE_ROWS,
  captureRowView,
  compareCaptureIdentity,
  digestEnvironmentProfile,
  digestJson,
  digestRenderingProfile,
  LOCAL_COMPARISON_CODEC,
  LOCAL_COMPARISON_ENGINE,
  LOCAL_COMPARISON_MODE,
  parseCapturePage,
  parseCapturePageIndex,
  sha256,
  validateDigest,
  validateKey,
  type CaptureComparison,
  type CapturePage,
  type CapturePageIndex,
  type CaptureRowView,
  type ProfileRecord,
} from "@visonaut/protocol";
import type { CaptureInventoryPointer, ValidatedImage } from "@visonaut/service";
import type { CaptureInventory, InventoryCapture, InventoryStore } from "./capture-inventory.ts";

/** The kept image of a row, when it is the reference image with other bytes. */
export type StoredRepresentative = [
  digest: string,
  bytes: number,
  width: number,
  height: number,
  contentType: ValidatedImage["contentType"],
];

/**
 * The service facts of one row. A row of the protocol has no image ID and no
 * owner run, and an unchanged capture keeps the image of an older run.
 */
export type StoredRowImage = [
  imageId: string,
  /** Position in `owners` of the page. */
  owner: number,
  /** The object key is the key prefix of the owner and this text. */
  keySuffix: string,
  representative: StoredRepresentative | null,
  maskImageId: string | null,
];

export interface StoredPageFacts {
  /** In the order of first use by `images`. */
  owners: [runId: string, keyPrefix: string][];
  /** One entry for each row of the page. */
  images: StoredRowImage[];
}

/** A page of the protocol with one more top-level field of the service. */
export interface StoredCapturePage extends CapturePage {
  stored: StoredPageFacts;
}

export interface StoredPageEntry {
  /** SHA-256 of the stored bytes. It is not the page digest of the client. */
  digest: string;
  bytes: number;
  rows: number;
}

/** The one index object of a run. The inventory columns of D1 point to it. */
export interface CapturePagesIndex {
  schemaVersion: typeof capturePagesVersion;
  projectId: string;
  runId: string;
  testedSha: string;
  referenceSnapshotId: string | null;
  /** The page index that the Submit job sent, or `null` when no job sent one. */
  receipt: CapturePageIndex | null;
  pages: StoredPageEntry[];
}

export interface CapturePageImages {
  /** The kept image of the row: its own image, or the image of the reference. */
  image: ValidatedImage;
  maskImageId?: string;
}

export interface CapturePagesInput extends Omit<CapturePagesIndex, "schemaVersion" | "pages"> {
  pages: { page: CapturePage; images: CapturePageImages[] }[];
}

interface StoredObject {
  key: string;
  text: string;
  digest: string;
}

export const capturePagesVersion = "capture-pages-v1";

// A run ID, an image ID, and an object key have at most this many characters.
const maximumIdentifierLength = 256;
const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const runIdPattern = "[a-zA-Z0-9][a-zA-Z0-9._-]*";
const indexKeyPattern = new RegExp(
  `^runs/(${runIdPattern})/inventory/index/([a-f0-9]{64})\\.json$`,
);

// The longest JSON text of one entry of `images` and of `owners`, with its
// comma. Each text of an entry is ASCII, so a character is one byte.
const maximumStoredImageBytes =
  `["",9999,"",["",100000000,100000,100000,"image/webp"],""],`.length +
  3 * maximumIdentifierLength +
  64;
const maximumStoredOwnerBytes = `["",""],`.length + 2 * maximumIdentifierLength;

/**
 * The bound of one stored page: a page of the largest size that a client can
 * send, and the largest `stored` field of 2,000 rows. So each page that the
 * protocol accepts has a stored form.
 */
export const maximumStoredPageBytes =
  CAPTURE_PAGE_MAX_BYTES +
  `,"stored":{"images":[],"owners":[]}`.length +
  CAPTURE_PAGE_ROWS * (maximumStoredImageBytes + maximumStoredOwnerBytes);

// The capture list of today has at most 100,000 entries.
const maximumPages = 100_000 / CAPTURE_PAGE_ROWS;
// The lists of GitHub bound the capture jobs of one run at about 2,000.
const maximumSources = 2000;

function fail(message: string): never {
  throw new Error(`Capture pages: ${message}`);
}

function plainObject(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("a stored value is not an object.");
  }
  const actual = Object.keys(value).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    fail("a stored object has other fields.");
  }
}

function identifier(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    fail("an identity is not text.");
  }
  if (value.length > maximumIdentifierLength || !identifierPattern.test(value)) {
    fail("an identity is invalid.");
  }
}

function integer(value: unknown, minimum: number, maximum: number): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail("a number is invalid.");
  }
  if (value < minimum || value > maximum) {
    fail("a number is out of its bound.");
  }
}

function tuple(value: unknown, length: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length !== length) {
    fail("a stored entry is invalid.");
  }
}

/** True for the key of a page index. Each other inventory key has the earlier form. */
export function isCapturePagesKey(key: string) {
  return indexKeyPattern.test(key);
}

function pageKey(runId: string, digest: string) {
  return `runs/${runId}/inventory/pages/${digest}.json`;
}

function assertStoredFacts(value: unknown, rowCount: number): asserts value is StoredPageFacts {
  plainObject(value, ["images", "owners"]);
  const { owners, images } = value;
  if (!Array.isArray(owners) || owners.length < 1 || owners.length > rowCount) {
    fail("the owner list is invalid.");
  }
  for (const owner of owners) {
    tuple(owner, 2);
    const [runId, keyPrefix] = owner;
    identifier(runId);
    if (typeof keyPrefix !== "string" || !keyPrefix.endsWith("/")) {
      fail("an owner has no key prefix.");
    }
    validateKey(keyPrefix.slice(0, -1));
  }
  if (new Set(owners.map((owner) => canonicalJson(owner))).size !== owners.length) {
    fail("an owner is in the list two times.");
  }
  if (!Array.isArray(images) || images.length !== rowCount) {
    fail("each row needs one stored image.");
  }
  let used = 0;
  for (const image of images) {
    tuple(image, 5);
    const [imageId, owner, keySuffix, representative, maskImageId] = image;
    identifier(imageId);
    // The list has the order of first use, so a new owner is always the next one.
    integer(owner, 0, Math.min(used, owners.length - 1));
    if (owner === used) {
      used++;
    }
    validateKey(keySuffix);
    if (representative !== null) {
      tuple(representative, 5);
      const [digest, bytes, width, height, contentType] = representative;
      validateDigest(digest);
      integer(bytes, 1, 100_000_000);
      integer(width, 1, 100_000);
      integer(height, 1, 100_000);
      if (contentType !== "image/png" && contentType !== "image/webp") {
        fail("an image type is invalid.");
      }
    }
    if (maskImageId !== null) {
      identifier(maskImageId);
    }
  }
  if (used !== owners.length) {
    fail("each owner must be used by a row.");
  }
}

/** Validate a stored page: the page of the protocol, and the facts of the service. */
function parseStoredPage(value: unknown): StoredCapturePage {
  const page = parseCapturePage(value);
  if (!Object.hasOwn(page, "stored")) {
    fail("a stored page has no service facts.");
  }
  const stored: unknown = Reflect.get(page, "stored");
  assertStoredFacts(stored, page.rows.length);
  return { ...page, stored };
}

function parseIndex(value: unknown): CapturePagesIndex {
  plainObject(value, [
    "pages",
    "projectId",
    "receipt",
    "referenceSnapshotId",
    "runId",
    "schemaVersion",
    "testedSha",
  ]);
  const { schemaVersion, projectId, runId, testedSha, referenceSnapshotId, pages } = value;
  if (schemaVersion !== capturePagesVersion) {
    fail("the index version is unsupported.");
  }
  identifier(projectId);
  identifier(runId);
  if (typeof testedSha !== "string" || !/^[a-f0-9]{40}$/.test(testedSha)) {
    fail("the tested commit is invalid.");
  }
  if (referenceSnapshotId !== null) {
    identifier(referenceSnapshotId);
  }
  const receipt =
    value.receipt === null
      ? null
      : parseCapturePageIndex(value.receipt, { maximumPages, maximumSources });
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > maximumPages) {
    fail("the page list is invalid.");
  }
  const entries: StoredPageEntry[] = [];
  for (const entry of pages) {
    plainObject(entry, ["bytes", "digest", "rows"]);
    const { digest, bytes, rows } = entry;
    validateDigest(digest);
    integer(bytes, 1, maximumStoredPageBytes);
    integer(rows, 1, CAPTURE_PAGE_ROWS);
    entries.push({ digest, bytes, rows });
  }
  return {
    schemaVersion,
    projectId,
    runId,
    testedSha,
    referenceSnapshotId,
    receipt,
    pages: entries,
  };
}

async function storedFacts(
  page: CapturePage,
  images: CapturePageImages[],
): Promise<StoredPageFacts> {
  if (images.length !== page.rows.length) {
    fail("each row needs one stored image.");
  }
  const owners: StoredPageFacts["owners"] = [];
  const positions = new Map<string, number>();
  const rows: StoredRowImage[] = [];
  for (const [index, row] of page.rows.entries()) {
    const entry = images[index];
    if (!entry) {
      fail("each row needs one stored image.");
    }
    const { image, maskImageId } = entry;
    const view = await captureRowView(page, row);
    const split = image.objectKey.lastIndexOf("/") + 1;
    const keyPrefix = image.objectKey.slice(0, split);
    const identity = canonicalJson([image.runId, keyPrefix]);
    let owner = positions.get(identity);
    if (owner === undefined) {
      owner = owners.push([image.runId, keyPrefix]) - 1;
      positions.set(identity, owner);
    }
    // The facts of an image with the bytes of the row are in the row.
    const representative: StoredRepresentative | null =
      image.digest === view.image.digest
        ? null
        : [image.digest, image.bytes, image.width, image.height, image.contentType];
    if (
      !representative &&
      (image.bytes !== view.image.bytes ||
        image.width !== view.image.width ||
        image.height !== view.image.height ||
        image.contentType !== "image/png")
    ) {
      fail("the kept image of a row differs from the row.");
    }
    rows.push([image.id, owner, image.objectKey.slice(split), representative, maskImageId ?? null]);
  }
  return { owners, images: rows };
}

/** The digests that depend only on a shared value of the run, computed one time. */
interface SharedDigests {
  profiles: Map<string, { rendering: string; environment: string }>;
  comparisons: Map<CaptureComparison, string>;
}

interface RowFactsParams {
  runId: string;
  digests: SharedDigests;
  view: CaptureRowView;
  stored: StoredPageFacts;
  storedImage: StoredRowImage;
  ordinal: number;
}

/** Build the capture of the list form from one row and its service facts. */
async function rowCapture({
  runId,
  digests,
  view,
  stored,
  storedImage,
  ordinal,
}: RowFactsParams): Promise<InventoryCapture> {
  const [imageId, ownerAt, keySuffix, representative, maskImageId] = storedImage;
  const owner = stored.owners[ownerAt];
  if (!owner) {
    fail("a row refers to a missing owner.");
  }
  const { result } = view;
  const compared = typeof result === "object";
  const unchanged = result === 0 || (compared && result.outcome === "unchanged");
  // A compared capture with no pixel difference keeps the reference image.
  const keepsReference = compared && result.outcome === "unchanged";
  if (keepsReference !== (representative !== null)) {
    fail("the kept image of a row differs from its result.");
  }
  if (representative && compared && representative[0] !== result.reference) {
    fail("the kept image of a row is not its reference.");
  }
  if (!unchanged && owner[0] !== runId) {
    fail("a new or changed capture needs an image of its run.");
  }
  const mask = compared ? result.mask : undefined;
  if (!!mask !== (maskImageId !== null)) {
    fail("the mask of a row differs from its result.");
  }
  const [digest, bytes, width, height, contentType] = representative ?? [
    view.image.digest,
    view.image.bytes,
    view.image.width,
    view.image.height,
    "image/png" as const,
  ];
  // A changed capture with equal pixels keeps its upload and needs no review.
  const zeroPixelChange =
    compared &&
    result.outcome === "changed" &&
    !result.sizeChanged &&
    result.changedPixels === 0 &&
    result.ratio === 0 &&
    !mask;
  const pixels = view.image.width * view.image.height;
  let profile = digests.profiles.get(view.profileDigest);
  if (!profile) {
    profile = {
      rendering: await digestRenderingProfile(view.profile),
      environment: await digestEnvironmentProfile(view.profile),
    };
    digests.profiles.set(view.profileDigest, profile);
  }
  // Each row of a page that uses one comparison entry has the same object.
  let comparisonDigest = digests.comparisons.get(view.comparison);
  if (!comparisonDigest) {
    comparisonDigest = await digestJson(view.comparison);
    digests.comparisons.set(view.comparison, comparisonDigest);
  }
  return {
    id: `${runId}:${await digestJson([view.itemKey, view.variantKey])}`,
    itemKey: view.itemKey,
    variantKey: view.variantKey,
    ordinal,
    imageId,
    image: {
      id: imageId,
      runId: owner[0],
      digest,
      objectKey: `${owner[1]}${keySuffix}`,
      contentType,
      bytes,
      width,
      height,
    },
    profileDigest: view.profileDigest,
    renderingProfileDigest: profile.rendering,
    environmentProfileDigest: profile.environment,
    testId: view.test.id,
    testRetry: view.test.retry,
    metadata: {
      name: view.name,
      variant: view.variant,
      profile: { $visonautProfileDigest: view.profileDigest },
      source: view.test,
      localMode: LOCAL_COMPARISON_MODE,
      observedImage: { mediaType: "image/png", ...view.image },
      candidateStored: !unchanged,
      comparison: view.comparison,
      comparisonDigest,
      localResult: {
        outcome: unchanged || zeroPixelChange ? "unchanged" : "changed",
        // A new capture has no reference, so each pixel of it is new.
        changedPixels: compared ? result.changedPixels : result === 1 ? pixels : 0,
        ratio: compared ? result.ratio : result === 1 ? 1 : 0,
        engineVersion: LOCAL_COMPARISON_ENGINE,
        codecVersion: LOCAL_COMPARISON_CODEC,
        maskExpected: !!mask,
        ...(maskImageId === null ? {} : { maskImageId }),
      },
    },
  };
}

/**
 * Build the capture list of a run from all its stored pages, and check the
 * rules that only a reader of all pages can check. The caller validates the
 * list.
 */
async function capturePagesFacts(
  index: CapturePagesIndex,
  pages: StoredCapturePage[],
  check: InventoryCheck = "complete",
): Promise<CaptureInventory> {
  const { receipt } = index;
  if (pages.length !== index.pages.length) {
    fail("the index and the pages differ.");
  }
  if (receipt && receipt.pages.length !== pages.length) {
    fail("the index of the Submit job has another page count.");
  }
  if (receipt && receipt.reference.snapshotId !== index.referenceSnapshotId) {
    fail("the index of the Submit job has another reference.");
  }
  const captures: InventoryCapture[] = [];
  const profiles = new Map<string, ProfileRecord>();
  const digests: SharedDigests = { profiles: new Map(), comparisons: new Map() };
  let previous: [string, string] | undefined;
  for (const [pageAt, stored] of pages.entries()) {
    const entry = index.pages[pageAt];
    if (entry?.rows !== stored.rows.length) {
      fail("a page has another row count.");
    }
    if (pageAt < pages.length - 1 && stored.rows.length !== CAPTURE_PAGE_ROWS) {
      fail(`each page but the last one needs ${CAPTURE_PAGE_ROWS} rows.`);
    }
    for (const [rowAt, row] of stored.rows.entries()) {
      const storedImage = stored.stored.images[rowAt];
      if (!storedImage) {
        fail("a row has no stored image.");
      }
      const view = await captureRowView(stored, row);
      const identity: [string, string] = [view.itemKey, view.variantKey];
      if (previous && compareCaptureIdentity(previous, identity) >= 0) {
        fail("the rows of a run must increase from one page to the next.");
      }
      previous = identity;
      profiles.set(view.profileDigest, { digest: view.profileDigest, profile: view.profile });
      captures.push(
        await rowCapture({
          runId: index.runId,
          digests,
          view,
          stored: stored.stored,
          storedImage,
          ordinal: captures.length,
        }),
      );
    }
    const sent = receipt?.pages[pageAt];
    if (!sent) continue;
    // The digest of a page of the client is a second hash of the content.
    if (check === "bytes") continue;
    // The page of the client is the stored page with no field of the service.
    const { stored: _stored, ...page } = stored;
    if (
      !previous ||
      (await digestJson(page)) !== sent.digest ||
      compareCaptureIdentity(previous, sent.last) !== 0
    ) {
      fail("a page differs from the index of the Submit job.");
    }
  }
  return {
    schemaVersion: "baseline-delta-v1",
    projectId: index.projectId,
    runId: index.runId,
    testedSha: index.testedSha,
    referenceSnapshotId: index.referenceSnapshotId,
    captures,
    profiles: [...profiles.values()],
  };
}

/**
 * Encode the pages and the index of one run, with no write. The result has the
 * objects to put, the pointer for D1, and the capture list for the validation.
 */
export async function encodeCapturePages(input: CapturePagesInput) {
  const { pages: inputs, ...header } = input;
  const objects: StoredObject[] = [];
  const entries: StoredPageEntry[] = [];
  const pages: StoredCapturePage[] = [];
  for (const { page, images } of inputs) {
    if (Object.hasOwn(page, "stored")) {
      fail("a page of a client cannot have the stored field.");
    }
    const stored = parseStoredPage({ ...page, stored: await storedFacts(page, images) });
    const text = canonicalJson(stored);
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > maximumStoredPageBytes) {
      fail("a stored page exceeds its size bound.");
    }
    const digest = await sha256(bytes);
    const key = pageKey(header.runId, digest);
    validateKey(key);
    objects.push({ key, text, digest });
    entries.push({ digest, bytes: bytes.byteLength, rows: stored.rows.length });
    pages.push(stored);
  }
  const index = parseIndex({ schemaVersion: capturePagesVersion, ...header, pages: entries });
  const inventory = await capturePagesFacts(index, pages);
  const text = canonicalJson(index);
  const bytes = new TextEncoder().encode(text);
  const digest = await sha256(bytes);
  const key = `runs/${index.runId}/inventory/index/${digest}.json`;
  if (!isCapturePagesKey(key)) {
    fail("the run identity cannot be in an object key.");
  }
  validateKey(key);
  objects.push({ key, text, digest });
  const pointer: CaptureInventoryPointer = {
    objectKey: key,
    digest,
    bytes: bytes.byteLength,
    captureCount: inventory.captures.length,
  };
  return { objects, pointer, inventory };
}

interface StoredObjectPointer {
  key: string;
  bytes: number;
  digest: string;
}

/**
 * How much a reader checks of a stored capture list.
 *
 * - `"complete"`: the key, the size, and the digest of the stored bytes, and
 *   then the complete validation of the content. Submit, promotion, and
 *   recovery use it.
 * - `"bytes"`: the key, the size, and the digest of the stored bytes, and the
 *   format version. A review read uses it: the digest is the digest that
 *   Submit stored after its complete validation, so the content cannot differ
 *   from the validated one.
 */
export type InventoryCheck = "complete" | "bytes";

/**
 * Read one stored object and check its key, its size, and the digest of its
 * bytes. This is the complete check of a review read: it does not validate
 * the content.
 */
async function readStoredText(
  store: Pick<InventoryStore, "get">,
  { key, bytes, digest }: StoredObjectPointer,
) {
  const object = await store.get(key);
  if (!object) {
    fail("a stored object is unavailable.");
  }
  if (object.size !== bytes) {
    await object.body.cancel();
    fail("a stored object has another size.");
  }
  const content = new Uint8Array(await new Response(object.body).arrayBuffer());
  if (content.byteLength !== bytes || (await sha256(content)) !== digest) {
    fail("a stored object has another checksum.");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(content);
}

/** Parse a stored text, and refuse a text that is not canonical JSON. */
function canonicalValue(text: string): unknown {
  const value: unknown = JSON.parse(text);
  if (canonicalJson(value) !== text) {
    fail("a stored object is not canonical JSON.");
  }
  return value;
}

/**
 * Read the index and all pages of one run. With the complete check, it
 * validates the stored form, and the caller validates the capture list that
 * this returns. With the check of the bytes, it does not parse the content
 * with the two parsers and does not compare the canonical text. The builder of
 * the list still checks the order and the counts of the rows that it reads.
 */
export async function readCapturePages(
  store: Pick<InventoryStore, "get">,
  pointer: CaptureInventoryPointer,
  check: InventoryCheck = "complete",
) {
  // A text with the check of the bytes has the digest that its writer stored
  // after the validation, so it has the form that the two parsers assert.
  const decodeIndex = (text: string): CapturePagesIndex =>
    check === "complete" ? parseIndex(canonicalValue(text)) : JSON.parse(text);
  const decodePage = (text: string): StoredCapturePage =>
    check === "complete" ? parseStoredPage(canonicalValue(text)) : JSON.parse(text);
  const runId = indexKeyPattern.exec(pointer.objectKey)?.[1];
  if (!runId || !pointer.objectKey.endsWith(`/${pointer.digest}.json`)) {
    fail("the pointer identity differs.");
  }
  const index = decodeIndex(
    await readStoredText(store, {
      key: pointer.objectKey,
      bytes: pointer.bytes,
      digest: pointer.digest,
    }),
  );
  if (index.schemaVersion !== capturePagesVersion) {
    fail("the index version is unsupported.");
  }
  if (index.runId !== runId) {
    fail("the index belongs to another run.");
  }
  const pages: StoredCapturePage[] = [];
  for (const entry of index.pages) {
    const text = await readStoredText(store, {
      key: pageKey(runId, entry.digest),
      bytes: entry.bytes,
      digest: entry.digest,
    });
    pages.push(decodePage(text));
  }
  return { inventory: await capturePagesFacts(index, pages, check), document: index };
}
