import { createHash } from "node:crypto";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { imageLimits } from "@visonaut/compare";
import {
  captureManifestDigest,
  digestJson,
  identityKey,
  LOCAL_COMPARISON_CODEC,
  LOCAL_COMPARISON_ENGINE,
  LOCAL_COMPARISON_MODE,
  SCHEMA_VERSION,
  validateCaptureComparison,
  validateDigest,
  validateKey,
  validateLocalReference,
} from "@visonaut/protocol";
import type {
  LocalComparisonReceipt,
  LocalReferenceCapture,
  LocalReferencePage,
  Manifest,
  ReserveRunResponse,
} from "@visonaut/protocol";
import { CliError, protocolVersion, record, text } from "./errors.js";
import { readImage, validateImages } from "./files.js";
import type { LocalManifest } from "./files.js";
import { request } from "./http.js";
import { comparePixels, decodePng } from "./png-comparison.js";

/** Reject malformed local bytes and candidate-provided verdicts before reservation. */
export async function validateLocalImages(local: LocalManifest) {
  if (local.manifest.localComparison) {
    throw new CliError("Capture artifacts cannot supply a local comparison result.");
  }
  await validateImages(local);
  for (const capture of local.manifest.captures) {
    if (!capture.comparison) {
      throw new CliError(
        "Local Submit requires recorded consumer screenshot settings. Capture again with the current adapter.",
      );
    }
    validateCaptureComparison(capture.comparison);
    await decodePng(await readImage(local.directory, capture), capture.image);
  }
}

function referenceCapture(value: unknown): LocalReferenceCapture {
  if (!record(value) || !record(value.image)) {
    throw new CliError("The service returned invalid reference image metadata.");
  }
  for (const key of ["itemKey", "variantKey", "imageId"]) {
    validateKey(value[key], key);
  }
  validateDigest(value.profileDigest);
  validateDigest(value.image.digest);
  const { itemKey, variantKey, captureId, imageId, path, profileDigest } = value;
  const { digest, mediaType, bytes, width, height } = value.image;
  // Stored capture IDs are opaque and include colon-separated source IDs.
  if (
    typeof itemKey !== "string" ||
    typeof variantKey !== "string" ||
    !text(captureId) ||
    typeof imageId !== "string" ||
    typeof path !== "string" ||
    typeof profileDigest !== "string" ||
    typeof digest !== "string" ||
    (mediaType !== "image/png" && mediaType !== "image/webp") ||
    typeof bytes !== "number" ||
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    bytes > imageLimits.maxEncodedBytes ||
    typeof width !== "number" ||
    !Number.isSafeInteger(width) ||
    width < 1 ||
    width > imageLimits.maxDimension ||
    typeof height !== "number" ||
    !Number.isSafeInteger(height) ||
    height < 1 ||
    height > imageLimits.maxDimension ||
    width * height > imageLimits.maxPixels
  ) {
    throw new CliError("A reference image exceeds the supported metadata bounds.");
  }
  return {
    itemKey,
    variantKey,
    captureId,
    imageId,
    path,
    profileDigest,
    image: { digest, mediaType, bytes, width, height },
  };
}

function referencePage(value: unknown): LocalReferencePage {
  protocolVersion(value);
  if (!record(value)) {
    throw new CliError("The service returned an invalid reference page.");
  }
  validateLocalReference(value.reference);
  if (
    value.comparisonMode !== LOCAL_COMPARISON_MODE ||
    !Array.isArray(value.captures) ||
    value.captures.length > 200 ||
    (value.nextCursor !== null && (!text(value.nextCursor) || value.nextCursor.length > 512)) ||
    !text(value.capability) ||
    value.capability.length > 64 * 1024 ||
    !text(value.expiresAt) ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    Date.parse(value.expiresAt) <= Date.now()
  ) {
    throw new CliError("The service returned an invalid local comparison capability.");
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    comparisonMode: LOCAL_COMPARISON_MODE,
    reference: value.reference,
    captures: value.captures.map(referenceCapture),
    nextCursor: value.nextCursor,
    capability: value.capability,
    expiresAt: value.expiresAt,
  };
}

interface ReferenceParams {
  origin: URL;
  manifest: Manifest;
  reservation: ReserveRunResponse;
  secrets: Set<string>;
}

export async function readReference({ origin, manifest, reservation, secrets }: ReferenceParams) {
  const manifestDigest = await captureManifestDigest(manifest);
  const captures: LocalReferenceCapture[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let binding: LocalReferencePage["reference"] | undefined;
  let previousCapture: LocalReferenceCapture | undefined;
  for (let pageNumber = 0; pageNumber <= 100_000; pageNumber++) {
    const page = referencePage(
      await request({
        url: new URL(`/v1/runs/${encodeURIComponent(reservation.runId)}/reference`, origin),
        token: reservation.capability,
        method: "POST",
        mediaType: "application/json",
        body: JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          manifestDigest,
          ...(cursor ? { cursor } : {}),
        }),
      }),
    );
    if (
      page.reference.manifestDigest !== manifestDigest ||
      (binding && (await digestJson(binding)) !== (await digestJson(page.reference)))
    ) {
      throw new CliError("The accepted reference changed during Submit. Rerun local comparison.");
    }
    binding = page.reference;
    secrets.add(page.capability);
    reservation = { ...reservation, capability: page.capability, expiresAt: page.expiresAt };
    for (const capture of page.captures) {
      // Match SQLite BINARY ordering, including keys outside the ASCII range.
      const itemOrder = previousCapture
        ? Buffer.compare(Buffer.from(capture.itemKey), Buffer.from(previousCapture.itemKey))
        : 1;
      const variantOrder = previousCapture
        ? Buffer.compare(Buffer.from(capture.variantKey), Buffer.from(previousCapture.variantKey))
        : 1;
      if (previousCapture && (itemOrder < 0 || (itemOrder === 0 && variantOrder <= 0))) {
        throw new CliError("The reference inventory has duplicate or unordered captures.");
      }
      const expectedPath = `/v1/runs/${encodeURIComponent(reservation.runId)}/reference/images/${encodeURIComponent(capture.imageId)}`;
      if (capture.path !== expectedPath) {
        throw new CliError("A reference image path is outside the pinned run.");
      }
      previousCapture = capture;
      captures.push(capture);
    }
    if (captures.length > binding.captureCount) {
      throw new CliError("The reference inventory exceeds its declared count.");
    }
    if (page.nextCursor === null) {
      if (
        captures.length !== binding.captureCount ||
        (await digestJson(captures)) !== binding.inventoryDigest
      ) {
        throw new CliError("The reference inventory is incomplete or has an invalid digest.");
      }
      return { captures, reference: binding, reservation };
    }
    if (!page.captures.length || cursors.has(page.nextCursor)) {
      throw new CliError("The reference inventory pagination did not advance.");
    }
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new CliError("The reference inventory exceeds the supported page count.");
}

interface CompareLocalParams extends ReferenceParams {
  local: LocalManifest;
  selected: Awaited<ReturnType<typeof readReference>>;
  renew?: () => Promise<ReserveRunResponse>;
}

/**
 * Only one decoded candidate/reference pair and mask is retained at a time.
 * The caller must run validateLocalImages first: an unchanged or new capture is not decoded here.
 */
export async function compareLocally({
  origin,
  manifest,
  local,
  selected,
  renew,
}: CompareLocalParams): Promise<LocalComparisonReceipt> {
  const reference = new Map(selected.captures.map((capture) => [identityKey(capture), capture]));
  const captures: LocalComparisonReceipt["captures"] = [];
  let maskDirectory: string | undefined;
  for (const capture of manifest.captures) {
    if (Date.parse(selected.reservation.expiresAt) - Date.now() <= 45_000) {
      if (!renew) {
        throw new CliError("The reference capability expired. Rerun Submit.", 4);
      }
      const renewed = await renew();
      if (renewed.runId !== selected.reservation.runId) {
        throw new CliError("The service changed the run identity during local comparison.");
      }
      selected.reservation = renewed;
      if (Date.parse(selected.reservation.expiresAt) - Date.now() <= 45_000) {
        throw new CliError("The renewed reference capability expires too soon.", 4);
      }
    }
    const identity = { itemKey: capture.itemKey, variantKey: capture.variant.key };
    const accepted = reference.get(identityKey(identity));
    reference.delete(identityKey(identity));
    if (!capture.comparison) {
      throw new CliError("The capture has no consumer comparison settings.");
    }
    const result = {
      ...identity,
      candidateDigest: capture.image.digest,
      referenceDigest: accepted?.image.digest ?? null,
    };
    if (!accepted) {
      captures.push({
        ...result,
        outcome: "changed",
        // The decode of validateLocalImages already matched these dimensions.
        changedPixels: capture.image.width * capture.image.height,
        ratio: 1,
        sizeChanged: false,
      });
      continue;
    }
    if (accepted.image.mediaType !== "image/png") {
      throw new CliError(
        "The accepted reference is WebP. Local comparison requires a PNG reference; legacy uploads remain supported.",
      );
    }
    if (
      accepted.image.digest === capture.image.digest &&
      accepted.image.width === capture.image.width &&
      accepted.image.height === capture.image.height &&
      accepted.image.bytes === capture.image.bytes
    ) {
      captures.push({
        ...result,
        outcome: "unchanged",
        changedPixels: 0,
        ratio: 0,
        sizeChanged: false,
      });
      continue;
    }
    // Equal images were validated in the first pass, so only a real comparison needs pixels again.
    const candidate = await decodePng(await readImage(local.directory, capture), capture.image);
    const bytes = await request({
      url: new URL(accepted.path, origin),
      token: selected.reservation.capability,
      responseMediaType: "image/png",
      maximumResponseBytes: accepted.image.bytes,
      retryUnavailable: true,
    });
    if (!Buffer.isBuffer(bytes)) {
      throw new CliError("The service returned invalid reference bytes.");
    }
    const decoded = await decodePng(Buffer.from(bytes), accepted.image);
    const compared = comparePixels({
      candidate,
      reference: decoded,
      comparison: capture.comparison,
      profileChanged: capture.profileDigest !== accepted.profileDigest,
    });
    const { mask, ...metrics } = compared;
    if (!mask) {
      captures.push({ ...result, ...metrics });
      continue;
    }
    if (!maskDirectory) {
      maskDirectory = join(local.directory, "local-masks");
      await mkdir(maskDirectory, { mode: 0o700, recursive: true });
      const details = await lstat(maskDirectory);
      if (!details.isDirectory() || details.isSymbolicLink()) {
        throw new CliError("The local mask directory is not a regular private directory.");
      }
    }
    const digest = createHash("sha256").update(mask).digest("hex");
    const path = join(maskDirectory, `${digest}.png`);
    try {
      await writeFile(path, mask, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (!record(error) || error.code !== "EEXIST") {
        throw error;
      }
    }
    captures.push({
      ...result,
      ...metrics,
      mask: {
        digest,
        mediaType: "image/png",
        bytes: mask.length,
        width: candidate.width,
        height: candidate.height,
        path: relative(local.directory, path).split("\\").join("/"),
      },
    });
  }
  return {
    mode: LOCAL_COMPARISON_MODE,
    reference: selected.reference,
    engineVersion: LOCAL_COMPARISON_ENGINE,
    codecVersion: LOCAL_COMPARISON_CODEC,
    captures,
    removals: [...reference.values()].map(({ itemKey, variantKey }) => ({ itemKey, variantKey })),
  };
}
