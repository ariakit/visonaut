import { assertDimensions, imageLimits } from "@visonaut/compare";
import {
  canonicalJson,
  CAPTURE_PAGE_ROWS,
  captureRowProfile,
  captureRowView,
  compareCaptureIdentity,
  FIXED_DIGEST,
  identityKey,
  LOCAL_COMPARISON_CODEC,
  LOCAL_COMPARISON_ENGINE,
  LOCAL_COMPARISON_MODE,
  parseCapturePage,
  ProtocolError,
  renderingProfile,
  SCHEMA_VERSION,
  validateCaptureComparison,
  validateCaptureReference,
  type CapturePage,
  type CaptureReference,
  type CaptureReferenceIdentity,
  type CaptureRowView,
  type LocalCaptureResult,
  type LocalComparisonReceipt,
} from "@visonaut/protocol";
import { createGitHubClient, SecurityError } from "@visonaut/security";
import {
  assertion,
  atomic,
  IncompleteError,
  statement,
  type ComparisonSettingsCounts,
  type ReferenceCaptureInput,
} from "@visonaut/service";
import type { ApiContext } from "./context.js";
import { firstAncestorSnapshot } from "./ingest.ts";
import { integer, object } from "./input.js";
import { publicImage } from "./images.ts";
import type { CaptureInventory, InventoryCapture } from "../capture-inventory.ts";
import { readReferencePage } from "../capture-pages.ts";
import {
  inventoryPointer,
  readInventoryIndex,
  readSnapshotInventoryBody,
  readSnapshotInventoryHeader,
  type SnapshotInventoryHeader,
} from "../inventory-records.ts";

interface StagedReferenceRun {
  id: string;
  tested_sha: string;
  verified_json: string;
}

/**
 * The reference of a run, as the signed JSON of the staged run row stores it.
 * The service selects it. Capture code does not supply it.
 */
export interface RunReference extends CaptureReference {
  captureCount: number;
}

const owner = (runId: string) => `submit:${runId}`;

interface ReferenceImages {
  database: ApiContext["database"];
  key: string;
  /** The image ID of each kept image of the reference, by the image digest. */
  imageIds: ReadonlyMap<string, string>;
}

// Retain one verified image map per bucket, bounded by the inventory's limits.
// Pages, decoded profiles and pending I/O stay within their request.
// https://github.com/ariakit/visonaut/pull/247#discussion_r4178894713
const referenceImages = new WeakMap<ApiContext["images"], ReferenceImages>();

function assertProjectReference(context: ApiContext, header: SnapshotInventoryHeader) {
  if (
    header.projectId !== context.configuration.projectId ||
    header.captureCount > context.configuration.limits.maximumCaptures
  ) {
    throw new IncompleteError("The accepted reference inventory differs from this project.");
  }
}

async function referenceImageIds(context: ApiContext, reference: CaptureReferenceIdentity) {
  if (reference.snapshotId === null) return null;
  const header = await readSnapshotInventoryHeader(context, reference.snapshotId);
  // The run compares with the capture list that its reserve call selected.
  if (!header || header.digest !== reference.digest) {
    throw new IncompleteError("The accepted reference inventory is unavailable.");
  }
  assertProjectReference(context, header);
  const key = JSON.stringify(header);
  const cached = referenceImages.get(context.images);
  if (cached?.database === context.database && cached.key === key) {
    return cached.imageIds;
  }
  const inventory = await readSnapshotInventoryBody(context, header);
  const imageIds = new Map(
    inventory.captures.map((capture) => [capture.image.digest, capture.image.id]),
  );
  referenceImages.set(context.images, { database: context.database, key, imageIds });
  return imageIds;
}

/** The header of the capture list of an accepted reference, or `null` when it has no list. */
async function referenceHeader(context: ApiContext, snapshotId: string) {
  const snapshot = await context.database
    .prepare("SELECT reference_eligible FROM visonaut_snapshots WHERE id=? AND project_id=?")
    .bind(snapshotId, context.configuration.projectId)
    .first<{
      reference_eligible: number;
    }>();
  if (!snapshot || snapshot.reference_eligible !== 1) {
    throw new IncompleteError("The accepted reference inventory is unavailable.");
  }
  return readSnapshotInventoryHeader(context, snapshotId);
}

async function referenceBody(context: ApiContext, header: SnapshotInventoryHeader) {
  const inventory = await readSnapshotInventoryBody(context, header);
  if (
    inventory.projectId !== context.configuration.projectId ||
    inventory.captures.length > context.configuration.limits.maximumCaptures
  ) {
    throw new IncompleteError("The accepted reference inventory differs from this project.");
  }
  return inventory;
}

/** Accepted inventories are complete; their images never require a parent read. */
export async function referenceInventory(
  context: ApiContext,
  snapshotId: string | null,
): Promise<CaptureInventory | null> {
  if (snapshotId === null) return null;
  const header = await referenceHeader(context, snapshotId);
  if (!header) return null;
  return referenceBody(context, header);
}

/**
 * The captures of a reference, from its complete capture list. A reference
 * with no capture list is from before the capture lists, and a run cannot use
 * it: a main run must make a new baseline first.
 */
export async function referenceCaptureInputs(
  context: ApiContext,
  snapshotId: string | null,
): Promise<ReferenceCaptureInput[]> {
  if (snapshotId === null) return [];
  const inventory = await referenceInventory(context, snapshotId);
  if (!inventory) {
    throw new IncompleteError("The accepted reference has no capture list.");
  }
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

/**
 * The counts of the comparison settings of a Submit. Capture code selects the
 * settings of each capture, and loose settings make a change unchanged, so the
 * run header shows these counts. They change no result.
 *
 * - `changed`: the captures whose settings differ from the settings that the
 *   baseline capture of the same identity had. A capture with no baseline, or
 *   with a baseline that has no settings digest, is not in the count.
 * - `loose`: the captures whose settings permit more than the built-in policy
 *   of the adapter, which is threshold 0.2 and 0 pixels.
 */
export function comparisonSettingsCounts(
  captures: readonly InventoryCapture[],
  references: readonly ReferenceCaptureInput[],
): ComparisonSettingsCounts {
  const baselineDigests = new Map(
    references.map((capture) => [identityKey(capture), capture.metadata?.comparisonDigest]),
  );
  const counts = { changed: 0, loose: 0 };
  for (const capture of captures) {
    const settings = capture.metadata.comparison;
    if (settings == null) continue;
    validateCaptureComparison(settings);
    if (
      settings.threshold > 0.2 ||
      (settings.maxDiffPixels ?? 0) > 0 ||
      (settings.maxDiffPixelRatio ?? 0) > 0
    ) {
      counts.loose += 1;
    }
    const baselineDigest = baselineDigests.get(identityKey(capture));
    if (typeof baselineDigest !== "string") continue;
    if (capture.metadata.comparisonDigest !== baselineDigest) {
      counts.changed += 1;
    }
  }
  return counts;
}

function parseRunReference(value: unknown): RunReference {
  try {
    validateCaptureReference(value);
  } catch (error) {
    if (!(error instanceof ProtocolError)) throw error;
    // The reference of a run that started with an earlier request form.
    throw new IncompleteError("The run has no reference of this request form. Run Submit again.");
  }
  const { snapshotId, baselineRevision, digest, pages } = value;
  const captureCount = integer(object(value).captureCount);
  return { snapshotId, baselineRevision, digest, pages, captureCount };
}

/** The reference of a staged run, from the run row that the caller has. */
export function runReference(run: Pick<StagedReferenceRun, "verified_json">) {
  const verified = object(JSON.parse(run.verified_json));
  const pullRequest = verified.event === "pull_request";
  if (verified.localReference == null) {
    return { reference: null, pullRequest };
  }
  return { reference: parseRunReference(verified.localReference), pullRequest };
}

async function storedReference(context: ApiContext, runId: string) {
  const row = await context.database
    .prepare("SELECT verified_json FROM ingest_staged_runs WHERE id=? AND retention_state='live'")
    .bind(runId)
    .first<{ verified_json: string }>();
  if (!row) return null;
  const { reference, pullRequest } = runReference(row);
  if (!reference) return null;
  return { reference, pullRequest };
}

export async function currentReference(
  context: ApiContext,
  reference: CaptureReferenceIdentity,
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
    if (!pullRequest && (!project.fresh_setup || project.snapshot_id !== null)) {
      throw new SecurityError(
        "stale_reference",
        409,
        "An empty reference is only valid for fresh setup.",
      );
    }
  } else {
    const snapshot = await context.database
      .prepare(
        "SELECT 1 AS found FROM visonaut_snapshots snapshot JOIN visonaut_snapshot_retention retention ON retention.snapshot_id=snapshot.id WHERE snapshot.id=? AND snapshot.project_id=? AND snapshot.reference_eligible=1 AND snapshot.storage_mode='source' AND retention.byte_state='live' AND snapshot.inventory_key IS NOT NULL AND snapshot.inventory_verified=1",
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

/**
 * Select the reference of a run, pin it, and store it in the staged run row.
 * Only the first reserve call of a run comes here. It reads the complete
 * reference one time, because the pins need the owner run of each image.
 */
export async function selectReference(
  context: ApiContext,
  run: StagedReferenceRun,
): Promise<RunReference> {
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
  if (!selected && !(project.fresh_setup && project.snapshot_id === null)) {
    throw new IncompleteError(
      "No retained accepted ancestor is eligible. Verify ancestry or capture current main.",
    );
  }
  let reference: RunReference = {
    snapshotId: null,
    baselineRevision: project.baseline_revision,
    digest: null,
    pages: 0,
    captureCount: 0,
  };
  let imageRunIds: string[] = [];
  if (selected) {
    const pointer = inventoryPointer(selected);
    if (!pointer || pointer.captureCount < 1) {
      throw new IncompleteError(
        "The accepted reference has no capture list. Update the branch, or capture current main to make a new baseline.",
      );
    }
    const inventory = await referenceBody(context, {
      ...pointer,
      runId: selected.run_id,
      projectId: selected.project_id,
      testedSha: selected.tested_sha,
    });
    // The digest of the capture list is the identity of the reference.
    reference = {
      snapshotId: selected.id,
      baselineRevision: project.baseline_revision,
      digest: pointer.digest,
      pages: Math.ceil(pointer.captureCount / CAPTURE_PAGE_ROWS),
      captureCount: pointer.captureCount,
    };
    imageRunIds = [...new Set(inventory.captures.map((capture) => capture.image.runId))];
  }
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
      ...(reference.snapshotId
        ? [
            assertion(
              context.database,
              "EXISTS(SELECT 1 FROM visonaut_snapshots WHERE id=? AND inventory_verified=1 AND inventory_digest=? AND capture_count=?)",
              [reference.snapshotId, reference.digest, reference.captureCount],
            ),
            assertion(
              context.database,
              "NOT EXISTS(SELECT 1 FROM json_each(?) source WHERE NOT EXISTS(SELECT 1 FROM work_retained_runs WHERE id=source.value AND byte_state='live'))",
              [JSON.stringify(imageRunIds)],
            ),
            statement(
              context.database,
              "INSERT INTO visonaut_pins(snapshot_id,reason,owner_id) VALUES(?,'local-submit',?)",
              [reference.snapshotId, owner(run.id)],
            ),
            statement(
              context.database,
              "INSERT OR IGNORE INTO work_retention_pins(run_id,owner,reason) SELECT value,?,'comparison' FROM json_each(?)",
              [owner(run.id), JSON.stringify(imageRunIds)],
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
    // Another reserve call of the same run stored its reference first.
    const raced = await storedReference(context, run.id);
    if (!raced) throw error;
    return raced.reference;
  }
  return reference;
}

/**
 * One page of a reference in the list form. The accepted baseline has this
 * form until the next main run stores its baseline as pages, so each page
 * reads the complete list. The client does not use the test and the
 * comparison settings of a reference row, so the page has one placeholder of
 * each.
 */
function listReferencePage(inventory: CaptureInventory, pageAt: number): CapturePage {
  const captures = [...inventory.captures]
    .sort((first, second) =>
      compareCaptureIdentity(
        [first.itemKey, first.variantKey],
        [second.itemKey, second.variantKey],
      ),
    )
    .slice(pageAt * CAPTURE_PAGE_ROWS, (pageAt + 1) * CAPTURE_PAGE_ROWS);
  const stored = new Map(inventory.profiles.map(({ digest, profile }) => [digest, profile]));
  const variants: unknown[] = [];
  const profiles: unknown[] = [];
  const positions = new Map<string, number>();
  // A shared list has the order of first use, and no entry two times.
  const position = (list: unknown[], entry: unknown) => {
    const key = canonicalJson([list === variants, entry]);
    let at = positions.get(key);
    if (at === undefined) {
      at = list.push(entry) - 1;
      positions.set(key, at);
    }
    return at;
  };
  const rows = captures.map((capture) => {
    const complete = stored.get(capture.profileDigest);
    if (!complete) {
      throw new IncompleteError("A capture of the accepted reference has no profile.");
    }
    // A row of the protocol is a PNG image, and a client decodes a reference
    // image as PNG. So a reference that keeps another image type is refused.
    if (capture.image.contentType !== "image/png") {
      throw new IncompleteError("The accepted reference keeps an image that is not a PNG image.");
    }
    // A page profile holds no comparison settings. Its digest is then the
    // rendering digest, which is the value that the service compares.
    const { profile, clip } = captureRowProfile(renderingProfile(complete));
    const name = capture.metadata.name;
    const { digest, bytes, width, height } = capture.image;
    return [
      capture.itemKey,
      typeof name === "string" && name !== capture.itemKey ? name : null,
      position(variants, capture.metadata.variant),
      0,
      position(profiles, profile),
      clip,
      0,
      digest,
      bytes,
      width,
      height,
      0,
    ];
  });
  try {
    return parseCapturePage({
      schemaVersion: SCHEMA_VERSION,
      variants,
      profiles,
      tests: [{ id: "reference", file: "reference", titlePath: ["reference"], retry: 0 }],
      comparisons: [{ threshold: 0.2 }],
      rows,
    });
  } catch (error) {
    if (!(error instanceof ProtocolError)) throw error;
    throw new IncompleteError("The accepted reference cannot be a reference page.");
  }
}

interface ReferencePageParams {
  context: ApiContext;
  run: StagedReferenceRun;
  /** The identity of the reference, from the reserve answer. */
  digest: string;
  /** The page number. It starts at 1. */
  page: number;
}

/**
 * One reference page for the Submit job: at most `CAPTURE_PAGE_ROWS` rows in
 * the order of the format, each with its kept image and the result `0`. A
 * reference in pages reads its index and one stored page.
 */
export async function referencePage({ context, run, digest, page }: ReferencePageParams) {
  const { reference, pullRequest } = runReference(run);
  if (
    !reference ||
    reference.snapshotId === null ||
    reference.digest !== digest ||
    page < 1 ||
    page > reference.pages
  ) {
    throw new SecurityError("reference_scope", 404, "The page is not in this Submit reference.");
  }
  await currentReference(context, reference, pullRequest);
  const header = await referenceHeader(context, reference.snapshotId);
  if (!header || header.digest !== reference.digest) {
    throw new IncompleteError("The accepted reference inventory is unavailable.");
  }
  assertProjectReference(context, header);
  const index = await readInventoryIndex(context, header, "complete");
  const rows = index
    ? await readReferencePage({ store: context.images, index, pageAt: page - 1 })
    : listReferencePage(await referenceBody(context, header), page - 1);
  return Response.json(rows);
}

interface ReferenceImageParams {
  request: Request;
  context: ApiContext;
  run: StagedReferenceRun;
  /** The digest of a kept image of a reference row. */
  digest: string;
}

export async function referenceImage({ request, context, run, digest }: ReferenceImageParams) {
  const { reference, pullRequest } = runReference(run);
  if (!reference || reference.snapshotId === null) {
    throw new SecurityError("reference_scope", 403, "The image is not in this Submit reference.");
  }
  await currentReference(context, reference, pullRequest);
  const imageIds = await referenceImageIds(context, reference);
  const imageId = imageIds?.get(digest);
  if (!imageId) {
    throw new SecurityError("reference_scope", 404, "The image is not in this Submit reference.");
  }
  return publicImage(request, context, imageId);
}

function refuseRow(message: string): never {
  throw new IncompleteError(message);
}

/**
 * Check the result of one row against its reference capture. The result is
 * `true` when the capture keeps the image of the reference.
 */
function keepsReference(view: CaptureRowView, original: ReferenceCaptureInput | undefined) {
  const { image, result } = view;
  assertDimensions(image.width, image.height, imageLimits);
  if (result === 1) {
    if (original) {
      refuseRow("A capture with a reference cannot be a new capture.");
    }
    return false;
  }
  if (!original) {
    refuseRow("A capture with no reference must be a new capture.");
  }
  const reference = original.image;
  const sizeChanged = reference.width !== image.width || reference.height !== image.height;
  if (result === 0) {
    if (reference.digest !== image.digest || reference.bytes !== image.bytes || sizeChanged) {
      refuseRow("A capture does not have the bytes of its reference.");
    }
    return true;
  }
  if (result.reference !== reference.digest) {
    refuseRow("A capture was compared with another image than its reference.");
  }
  const area = image.width * image.height;
  const policy = view.comparison;
  const allowance = Math.min(
    policy.maxDiffPixels ?? Infinity,
    policy.maxDiffPixelRatio === undefined ? Infinity : area * policy.maxDiffPixelRatio,
  );
  // The rendering digest of a page profile is its digest, because a page
  // profile holds no comparison settings.
  const profileChanged = original.renderingProfileDigest !== view.profileDigest;
  const changed =
    sizeChanged ||
    (profileChanged && result.changedPixels !== 0) ||
    result.changedPixels > (Number.isFinite(allowance) ? allowance : 0);
  if (
    result.sizeChanged !== sizeChanged ||
    (result.outcome === "changed") !== changed ||
    result.ratio !== (sizeChanged ? 1 : result.changedPixels / area)
  ) {
    refuseRow("Local comparison metrics or outcome differ from the consumer settings.");
  }
  if (!sizeChanged && changed && result.changedPixels > 0 && !result.mask) {
    refuseRow("A changed local capture requires its review mask.");
  }
  if (
    result.mask &&
    (result.mask.width !== image.width ||
      result.mask.height !== image.height ||
      sizeChanged ||
      result.changedPixels === 0)
  ) {
    refuseRow("The local review mask differs from its changed capture.");
  }
  return !changed;
}

/**
 * Check each row of the pages of a run against the complete reference. The
 * caller has checked the order of the rows across the pages, so each identity
 * occurs one time. The result has, for each row of each page, the reference
 * capture whose image the row keeps, or `undefined` when the row keeps its
 * own image.
 */
export async function validateRunPages(
  pages: readonly CapturePage[],
  references: readonly ReferenceCaptureInput[],
) {
  const originals = new Map(references.map((capture) => [identityKey(capture), capture]));
  if (originals.size !== references.length) {
    throw new IncompleteError("The accepted reference has one identity two times.");
  }
  const kept: (ReferenceCaptureInput | undefined)[][] = [];
  for (const page of pages) {
    const keptOfPage: (ReferenceCaptureInput | undefined)[] = [];
    for (const row of page.rows) {
      const view = await captureRowView(page, row);
      const original = originals.get(identityKey(view));
      keptOfPage.push(keepsReference(view, original) ? original : undefined);
    }
    kept.push(keptOfPage);
  }
  return kept;
}

interface ComparisonReceiptParams {
  /** The committed capture list of the run. */
  captures: readonly InventoryCapture[];
  reference: CaptureReferenceIdentity;
  references: readonly ReferenceCaptureInput[];
}

function isOutcome(value: unknown): value is LocalCaptureResult["outcome"] {
  return value === "unchanged" || value === "changed";
}

function localFacts(capture: InventoryCapture) {
  const observed = object(capture.metadata.observedImage);
  const result = object(capture.metadata.localResult);
  const { outcome } = result;
  if (
    typeof observed.digest !== "string" ||
    typeof observed.width !== "number" ||
    typeof observed.height !== "number" ||
    !isOutcome(outcome) ||
    typeof result.changedPixels !== "number" ||
    typeof result.ratio !== "number"
  ) {
    throw new IncompleteError("A capture of the committed list has no local result.");
  }
  return {
    digest: observed.digest,
    width: observed.width,
    height: observed.height,
    outcome,
    changedPixels: result.changedPixels,
    ratio: result.ratio,
  };
}

/**
 * The comparison input of the service for a run in pages, from the committed
 * capture list and the reference. A page index holds no result list, so this
 * builds one: each capture with the result that the list stores, and each
 * reference capture that the run does not have as a removal. A result has no
 * mask here: the service reads the mask of a changed capture from the stored
 * capture.
 */
export function comparisonReceipt({
  captures,
  reference,
  references,
}: ComparisonReceiptParams): LocalComparisonReceipt {
  const originals = new Map(references.map((capture) => [identityKey(capture), capture]));
  const results = captures.map((capture): LocalCaptureResult => {
    const key = identityKey(capture);
    const original = originals.get(key);
    originals.delete(key);
    const { digest, width, height, outcome, changedPixels, ratio } = localFacts(capture);
    return {
      itemKey: capture.itemKey,
      variantKey: capture.variantKey,
      candidateDigest: digest,
      referenceDigest: original?.image.digest ?? null,
      outcome,
      changedPixels,
      ratio,
      sizeChanged:
        !!original && (original.image.width !== width || original.image.height !== height),
    };
  });
  return {
    mode: LOCAL_COMPARISON_MODE,
    reference: {
      manifestDigest: FIXED_DIGEST,
      snapshotId: reference.snapshotId,
      baselineRevision: reference.baselineRevision,
      inventoryDigest: reference.digest ?? FIXED_DIGEST,
      captureCount: references.length,
    },
    engineVersion: LOCAL_COMPARISON_ENGINE,
    codecVersion: LOCAL_COMPARISON_CODEC,
    captures: results,
    removals: [...originals.values()].map(({ itemKey, variantKey }) => ({ itemKey, variantKey })),
  };
}
