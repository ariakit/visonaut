import {
  canonicalJson,
  CAPTURE_PAGE_MAX_BYTES,
  CAPTURE_PAGE_ROWS,
  captureRowView,
  compareCaptureIdentity,
  digestEnvironmentProfile,
  digestJson,
  LOCAL_COMPARISON_MODE,
  parseCapturePage,
  parseCapturePageIndex,
  sha256,
  validateDigest,
  validateKey,
  type CaptureComparison,
  type CapturePage,
  type CapturePageIndex,
  type CaptureProfile,
  type CaptureRow,
  type CaptureRowView,
  type ProfileRecord,
} from "@visonaut/protocol";
import {
  IncompleteError,
  type CaptureInventoryPointer,
  type ValidatedImage,
} from "@visonaut/service";
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

/** One page of a run for the writer: the page of the client, and the kept image of each row. */
export interface CapturePageInput {
  page: CapturePage;
  images: CapturePageImages[];
}

export interface CapturePagesInput extends Omit<CapturePagesIndex, "schemaVersion" | "pages"> {
  pages: CapturePageInput[];
}

/** The input of the writer, where the pages can come one at a time. */
export interface CapturePagesStream extends Omit<CapturePagesInput, "pages"> {
  pages: Iterable<CapturePageInput> | AsyncIterable<CapturePageInput>;
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
/** The bounds of the page index that a Submit job sends. A stored index has the same bounds. */
export const capturePageIndexLimits = { maximumPages, maximumSources };

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

function storedFacts(page: CapturePage, images: CapturePageImages[]): StoredPageFacts {
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
    // Only the image of the row is necessary here. `parseStoredPage` checks the
    // complete row after this function.
    const [, , , , , , , digest, bytes, width, height] = row;
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
      image.digest === digest
        ? null
        : [image.digest, image.bytes, image.width, image.height, image.contentType];
    if (
      !representative &&
      (image.bytes !== bytes ||
        image.width !== width ||
        image.height !== height ||
        image.contentType !== "image/png")
    ) {
      fail("the kept image of a row differs from the row.");
    }
    rows.push([image.id, owner, image.objectKey.slice(split), representative, maskImageId ?? null]);
  }
  return { owners, images: rows };
}

/** The digests that depend only on a shared value of the page, computed one time. */
interface SharedDigests {
  /** The environment digest, by the shared profile of the page. */
  environments: Map<CaptureProfile, string>;
  comparisons: Map<CaptureComparison, string>;
}

interface RowFactsParams {
  runId: string;
  digests: SharedDigests;
  view: CaptureRowView;
  /** The shared profile of the row in the page, with no clip rectangle of the row. */
  sharedProfile: CaptureProfile;
  stored: StoredPageFacts;
  storedImage: StoredRowImage;
  ordinal: number;
  /** The CLI version that the Submit job reported, when it reported one. */
  cliVersion: string | undefined;
}

/** Build the capture of the list form from one row and its service facts. */
async function rowCapture({
  runId,
  digests,
  view,
  sharedProfile,
  stored,
  storedImage,
  ordinal,
  cliVersion,
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
  // The environment digest does not read the clip rectangle, so each row of
  // one shared profile has the same environment digest.
  let environmentDigest = digests.environments.get(sharedProfile);
  if (!environmentDigest) {
    environmentDigest = await digestEnvironmentProfile(sharedProfile);
    digests.environments.set(sharedProfile, environmentDigest);
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
    // A page profile holds no comparison settings, so the rendering profile of
    // a row is its complete profile.
    renderingProfileDigest: view.profileDigest,
    environmentProfileDigest: environmentDigest,
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
        // Provenance only: no tuple and no decision reads it.
        ...(cliVersion === undefined ? {} : { cliVersion }),
        maskExpected: !!mask,
        ...(maskImageId === null ? {} : { maskImageId }),
      },
    },
  };
}

interface PageCapturesParams {
  runId: string;
  /** The row count of the page in the index. */
  rows: number;
  /** False for each page but the last one, which needs `CAPTURE_PAGE_ROWS` rows. */
  last: boolean;
  /** The entry of the page in the index of the Submit job, when a job sent the run. */
  sent: CapturePageIndex["pages"][number] | undefined;
  /** The CLI version that the Submit job reported, when it reported one. */
  cliVersion: string | undefined;
  stored: StoredCapturePage;
  check: InventoryCheck;
  digests: SharedDigests;
  /** The profiles of the rows, by digest. The function adds to it. */
  profiles: Map<string, ProfileRecord>;
  /** The ordinal of the first row of the page. */
  firstOrdinal: number;
  /** The identity of the last row of the page before, for a reader of all pages. */
  previous?: [string, string];
}

/**
 * Build the captures of one stored page, and check the rules that one page
 * permits. The result has the identity of the last row.
 */
async function pageCaptures({
  runId,
  rows,
  last,
  sent,
  cliVersion,
  stored,
  check,
  digests,
  profiles,
  firstOrdinal,
  previous,
}: PageCapturesParams) {
  if (rows !== stored.rows.length) {
    fail("a page has another row count.");
  }
  if (!last && stored.rows.length !== CAPTURE_PAGE_ROWS) {
    fail(`each page but the last one needs ${CAPTURE_PAGE_ROWS} rows.`);
  }
  const captures: InventoryCapture[] = [];
  for (const [rowAt, row] of stored.rows.entries()) {
    const storedImage = stored.stored.images[rowAt];
    if (!storedImage) {
      fail("a row has no stored image.");
    }
    const view = await captureRowView(stored, row);
    const sharedProfile = stored.profiles[row[4]];
    if (!sharedProfile) {
      fail("a row refers to a missing profile.");
    }
    const identity: [string, string] = [view.itemKey, view.variantKey];
    if (previous && compareCaptureIdentity(previous, identity) >= 0) {
      fail("the rows of a run must increase from one page to the next.");
    }
    previous = identity;
    profiles.set(view.profileDigest, { digest: view.profileDigest, profile: view.profile });
    captures.push(
      await rowCapture({
        runId,
        digests,
        view,
        sharedProfile,
        stored: stored.stored,
        storedImage,
        ordinal: firstOrdinal + rowAt,
        cliVersion,
      }),
    );
  }
  // The digest of a page of the client is a second hash of the content.
  if (!sent || check === "bytes") {
    return { captures, last: previous };
  }
  // The page of the client is the stored page with no field of the service.
  const { stored: _stored, ...page } = stored;
  if (
    !previous ||
    (await digestJson(page)) !== sent.digest ||
    compareCaptureIdentity(previous, sent.last) !== 0
  ) {
    fail("a page differs from the index of the Submit job.");
  }
  return { captures, last: previous };
}

/** The captures of one page of a run, and the profiles that its rows use. */
export interface CapturesPage {
  captures: InventoryCapture[];
  profiles: ProfileRecord[];
}

type PagesHeader = Pick<CapturePagesIndex, "runId" | "referenceSnapshotId" | "receipt">;

/**
 * The builder of the captures of a run from its stored pages, one page after
 * the other. It checks the rules across the pages: the order of the rows, the
 * ordinals, and the index of the Submit job. It keeps only the identity of the
 * last row and the count of the rows, so a reader holds one page at a time.
 */
function pagesBuilder(header: PagesHeader, check: InventoryCheck) {
  const { receipt } = header;
  if (receipt && receipt.reference.snapshotId !== header.referenceSnapshotId) {
    fail("the index of the Submit job has another reference.");
  }
  let pageAt = 0;
  let ordinal = 0;
  let previous: [string, string] | undefined;
  // `rows` is the row count of the page in the index. A reader gives the
  // count of the index, and the writer gives the count of the page it encodes.
  return async (stored: StoredCapturePage, rows: number, last: boolean): Promise<CapturesPage> => {
    if (pageAt >= maximumPages) {
      fail("the page list is invalid.");
    }
    if (
      receipt &&
      (pageAt >= receipt.pages.length || (last && pageAt !== receipt.pages.length - 1))
    ) {
      fail("the index of the Submit job has another page count.");
    }
    // The digests of the profiles stay with the page: almost each capture has
    // its own clip rectangle, and so its own profile.
    const profiles = new Map<string, ProfileRecord>();
    const page = await pageCaptures({
      runId: header.runId,
      rows,
      last,
      sent: receipt?.pages[pageAt],
      cliVersion: receipt?.cliVersion,
      stored,
      check,
      digests: { environments: new Map(), comparisons: new Map() },
      profiles,
      firstOrdinal: ordinal,
      previous,
    });
    previous = page.last;
    ordinal += page.captures.length;
    pageAt++;
    return { captures: page.captures, profiles: [...profiles.values()] };
  };
}

/** One object of a run in pages, ready to put. */
export interface StoredObject {
  key: string;
  text: string;
  digest: string;
}

interface EncodeCapturePagesOptions {
  /** Validate the captures of each page before its object goes to `put`. */
  check?: (page: CapturesPage) => unknown;
  /** Store one object. The index is the last one, so a pointer never names a missing page. */
  put?: (object: StoredObject) => Promise<unknown>;
}

/**
 * Encode the pages and the index of one run, one page at a time. Each page is
 * checked, then given to `put`, and then released, so the function holds one
 * page. With no `put`, the function stores nothing: the pointer then proves
 * the content of an earlier write. The result is the pointer for D1.
 */
export async function encodeCapturePages(
  input: CapturePagesStream,
  { check, put }: EncodeCapturePagesOptions = {},
): Promise<CaptureInventoryPointer> {
  const { pages: inputs, ...header } = input;
  const build = pagesBuilder(header, "complete");
  const entries: StoredPageEntry[] = [];
  let captureCount = 0;
  // A page is encoded when the next one arrives, so that the builder knows
  // which page is the last one.
  let pending: StoredCapturePage | undefined;
  const flush = async (last: boolean) => {
    if (!pending) return;
    const stored = pending;
    pending = undefined;
    const text = canonicalJson(stored);
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > maximumStoredPageBytes) {
      fail("a stored page exceeds its size bound.");
    }
    const digest = await sha256(bytes);
    const key = pageKey(header.runId, digest);
    validateKey(key);
    const page = await build(stored, stored.rows.length, last);
    await check?.(page);
    captureCount += page.captures.length;
    await put?.({ key, text, digest });
    entries.push({ digest, bytes: bytes.byteLength, rows: stored.rows.length });
  };
  for await (const { page, images } of inputs) {
    if (Object.hasOwn(page, "stored")) {
      fail("a page of a client cannot have the stored field.");
    }
    const stored = parseStoredPage({ ...page, stored: storedFacts(page, images) });
    await flush(false);
    pending = stored;
  }
  await flush(true);
  const index = parseIndex({ schemaVersion: capturePagesVersion, ...header, pages: entries });
  const text = canonicalJson(index);
  const bytes = new TextEncoder().encode(text);
  const digest = await sha256(bytes);
  const key = `runs/${index.runId}/inventory/index/${digest}.json`;
  if (!isCapturePagesKey(key)) {
    fail("the run identity cannot be in an object key.");
  }
  validateKey(key);
  await put?.({ key, text, digest });
  return { objectKey: key, digest, bytes: bytes.byteLength, captureCount };
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

// A text with the check of the bytes has the digest that its writer stored
// after the validation, so it has the form that the two parsers assert.
function decodeIndex(text: string, check: InventoryCheck): CapturePagesIndex {
  return check === "complete" ? parseIndex(canonicalValue(text)) : JSON.parse(text);
}

function decodePage(text: string, check: InventoryCheck): StoredCapturePage {
  return check === "complete" ? parseStoredPage(canonicalValue(text)) : JSON.parse(text);
}

/**
 * Read the page index of one run, and no page. With the complete check, it
 * validates the stored form of the index. With the check of the bytes, it
 * does not parse the content with the parser and does not compare the
 * canonical text.
 */
export async function readCapturePagesIndex(
  store: Pick<InventoryStore, "get">,
  pointer: CaptureInventoryPointer,
  check: InventoryCheck = "complete",
): Promise<CapturePagesIndex> {
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
    check,
  );
  if (index.schemaVersion !== capturePagesVersion) {
    fail("the index version is unsupported.");
  }
  if (index.runId !== runId) {
    fail("the index belongs to another run.");
  }
  return index;
}

interface ReadCapturePageParams {
  store: Pick<InventoryStore, "get">;
  /** The result of `readCapturePagesIndex`. */
  index: CapturePagesIndex;
  /** The position of the page in the index. It starts at 0. */
  pageAt: number;
  check: InventoryCheck;
}

async function readStoredPage({ store, index, pageAt, check }: ReadCapturePageParams) {
  const entry = index.pages[pageAt];
  if (!entry) {
    fail("the index has no such page.");
  }
  const text = await readStoredText(store, {
    key: pageKey(index.runId, entry.digest),
    bytes: entry.bytes,
    digest: entry.digest,
  });
  return decodePage(text, check);
}

/** The facts of the index that the builder of one page needs. */
function pageOfIndex(index: CapturePagesIndex, pageAt: number) {
  const entry = index.pages[pageAt];
  if (!entry) {
    fail("the index has no such page.");
  }
  return {
    runId: index.runId,
    rows: entry.rows,
    last: pageAt === index.pages.length - 1,
    sent: index.receipt?.pages[pageAt],
    cliVersion: index.receipt?.cliVersion,
  };
}

/**
 * Read one stored page of a run, and build its captures. The function reads
 * one object, and it checks the rules that one page permits. It cannot check
 * the order from one page to the next, and the caller does not get the
 * complete validation of the capture list.
 */
export async function readCapturePage({
  store,
  index,
  pageAt,
  check,
}: ReadCapturePageParams): Promise<InventoryCapture[]> {
  // Each page before this one is complete, so the ordinal of a row is its
  // position in the run.
  for (const before of index.pages.slice(0, pageAt)) {
    if (before.rows !== CAPTURE_PAGE_ROWS) {
      fail(`each page but the last one needs ${CAPTURE_PAGE_ROWS} rows.`);
    }
  }
  const { captures } = await pageCaptures({
    ...pageOfIndex(index, pageAt),
    stored: await readStoredPage({ store, index, pageAt, check }),
    check,
    digests: { environments: new Map(), comparisons: new Map() },
    profiles: new Map(),
    firstOrdinal: pageAt * CAPTURE_PAGE_ROWS,
  });
  return captures;
}

/**
 * Read one stored page of a run as a reference page for a client: the page
 * with no field of the service, where each row has its kept image and the
 * result `0`. A stored row has the digest of its capture, and the kept image
 * of a capture with no pixel difference is the image of an earlier run, so a
 * stored page as it is would name the wrong image. The function validates the
 * stored page with the complete check. The client does not use the result and
 * the test of a reference row.
 */
export async function readReferencePage({
  store,
  index,
  pageAt,
}: Omit<ReadCapturePageParams, "check">): Promise<CapturePage> {
  const check = "complete";
  const { stored: facts, ...page } = await readStoredPage({ store, index, pageAt, check });
  const { captures } = await pageCaptures({
    ...pageOfIndex(index, pageAt),
    stored: { ...page, stored: facts },
    check,
    digests: { environments: new Map(), comparisons: new Map() },
    profiles: new Map(),
    firstOrdinal: pageAt * CAPTURE_PAGE_ROWS,
  });
  const rows = page.rows.map((row, rowAt): CaptureRow => {
    const kept = captures[rowAt]?.image;
    if (!kept) {
      fail("a row has no kept image.");
    }
    // A row of the protocol is a PNG image, and a client decodes a reference
    // image as PNG. So a reference that keeps another image type is refused.
    if (kept.contentType !== "image/png") {
      throw new IncompleteError("The accepted reference keeps an image that is not a PNG image.");
    }
    const [itemKey, name, variant, test, profile, clip, comparison] = row;
    const { digest, bytes, width, height } = kept;
    return [
      itemKey,
      name,
      variant,
      test,
      profile,
      clip,
      comparison,
      digest,
      bytes,
      width,
      height,
      0,
    ];
  });
  return { ...page, rows };
}

/**
 * The kept image ID of each row of a run that is stored as pages, by the
 * digest of the image. The function reads each page with the check of the
 * bytes, and it builds no capture, so that a read of one reference image does
 * not build the complete capture list.
 */
export async function readKeptImageIds({
  store,
  index,
}: Omit<ReadCapturePageParams, "pageAt" | "check">) {
  const imageIds = new Map<string, string>();
  for (const pageAt of index.pages.keys()) {
    const { rows, stored } = await readStoredPage({ store, index, pageAt, check: "bytes" });
    for (const [rowAt, row] of rows.entries()) {
      const storedImage = stored.images[rowAt];
      if (!storedImage) {
        fail("each row needs one stored image.");
      }
      const [imageId, , , representative] = storedImage;
      const [, , , , , , , rowDigest] = row;
      // A row with no pixel difference keeps the reference image, with other bytes.
      imageIds.set(representative?.[0] ?? rowDigest, imageId);
    }
  }
  return imageIds;
}

/**
 * Read each stored page of a run in the order of its index, and build its
 * captures. The reader holds one page: it checks the rules across the pages as
 * it reads them. With the complete check, it validates the stored form, and
 * the caller validates the captures of each page.
 */
export async function* eachCapturePage(
  store: Pick<InventoryStore, "get">,
  index: CapturePagesIndex,
  check: InventoryCheck = "complete",
): AsyncGenerator<CapturesPage> {
  const build = pagesBuilder(index, check);
  for (const pageAt of index.pages.keys()) {
    const stored = await readStoredPage({ store, index, pageAt, check });
    const { rows, last } = pageOfIndex(index, pageAt);
    yield await build(stored, rows, last);
  }
}

/**
 * Read the index and all pages of one run, and build the complete capture
 * list. With the complete check, it validates the stored form, and the caller
 * validates the capture list that this returns. With the check of the bytes,
 * it does not parse the content with the two parsers and does not compare the
 * canonical text. The builder of the list still checks the order and the
 * counts of the rows that it reads.
 */
export async function readCapturePages(
  store: Pick<InventoryStore, "get">,
  pointer: CaptureInventoryPointer,
  check: InventoryCheck = "complete",
) {
  const index = await readCapturePagesIndex(store, pointer, check);
  const captures: InventoryCapture[] = [];
  const profiles = new Map<string, ProfileRecord>();
  for await (const page of eachCapturePage(store, index, check)) {
    for (const capture of page.captures) {
      captures.push(capture);
    }
    for (const profile of page.profiles) {
      profiles.set(profile.digest, profile);
    }
  }
  const inventory: CaptureInventory = {
    schemaVersion: "baseline-delta-v1",
    projectId: index.projectId,
    runId: index.runId,
    testedSha: index.testedSha,
    referenceSnapshotId: index.referenceSnapshotId,
    captures,
    profiles: [...profiles.values()],
  };
  return { inventory, document: index };
}
