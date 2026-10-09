import { identityKey } from "@visonaut/protocol";
import { IncompleteError, type ReviewRow, type RunRow } from "@visonaut/service";
import type { CaptureInventory, InventoryCapture } from "../capture-inventory.ts";
import { readRunInventory, readSnapshotInventory } from "../inventory-records.ts";
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

function reviewCaptures(inventory: CaptureInventory): InventoryReviewCapture[] {
  return inventory.captures.map((capture) => ({
    id: capture.id,
    item_key: capture.itemKey,
    variant_key: capture.variantKey,
    image_id: capture.imageId,
    rendering_digest: capture.renderingProfileDigest,
    metadata_json: JSON.stringify(capture.metadata),
  }));
}
function reviewImages(inventory: CaptureInventory): InventoryReviewImage[] {
  return inventory.captures.map((capture) => ({
    id: capture.image.id,
    digest: capture.image.digest,
    width: capture.image.width,
    height: capture.image.height,
    bytes_present: 1,
  }));
}

/** The capture list of a run and the list of its baseline, from the run row that the caller has. */
export async function readReviewInventory(context: PrivateContext, run: RunRow) {
  const inventory = await readRunInventory(context, run);
  if (!inventory) return null;
  const referenceInventory = inventory.referenceSnapshotId
    ? await readSnapshotInventory(context, inventory.referenceSnapshotId)
    : null;
  if (referenceInventory && referenceInventory.projectId !== inventory.projectId) {
    throw new IncompleteError("The review reference belongs to a different project.");
  }
  const candidates = reviewCaptures(inventory);
  const references = referenceInventory
    ? reviewCaptures(referenceInventory)
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
    ...reviewImages(inventory),
    ...(referenceInventory ? reviewImages(referenceInventory) : []),
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
  const referenceByIdentity = new Map(
    references.map((capture) => [
      identityKey({ itemKey: capture.item_key, variantKey: capture.variant_key }),
      capture,
    ]),
  );
  const candidateByIdentity = new Map(
    candidates.map((capture) => [
      identityKey({ itemKey: capture.item_key, variantKey: capture.variant_key }),
      capture,
    ]),
  );
  return { inventory, candidates, references, images, referenceByIdentity, candidateByIdentity };
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
  evidence: NonNullable<Awaited<ReturnType<typeof readReviewInventory>>>,
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
        projectId: evidence.inventory.projectId,
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
