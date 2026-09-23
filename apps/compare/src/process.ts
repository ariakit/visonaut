import {
  codecVersion,
  compareImages,
  createThumbnail,
  decodeImage,
  engineVersion,
  imageLimits,
  ImageValidationError,
  readBounded,
  sha256,
  validateImage,
  type ImageCodecs,
  type Pixels,
} from "@visonaut/compare";
import type { ComparisonTask, ValidatedImage } from "@visonaut/service";

export interface ArtifactStorage {
  get(key: string): Promise<{ size: number; body: ReadableStream<Uint8Array> } | null>;
  put(key: string, bytes: Uint8Array<ArrayBuffer>, options: R2PutOptions): Promise<unknown>;
}

interface ProcessTaskParams {
  task: ComparisonTask;
  images: ArtifactStorage;
  codecs: ImageCodecs;
}

interface WriteArtifactParams extends ProcessTaskParams {
  role: "mask" | "thumbnail";
  bytes: Uint8Array<ArrayBuffer>;
  id?: string;
}

export async function readOriginalValidated(
  image: NonNullable<ComparisonTask["candidate"]>,
  images: ArtifactStorage,
) {
  if (image.bytes > imageLimits.maxEncodedBytes) {
    throw new ImageValidationError("encoded-size", "Stored image exceeds the decode byte limit.");
  }
  const object = await images.get(image.objectKey);
  if (!object || object.size !== image.bytes) {
    throw new ImageValidationError(
      "missing-original",
      "Required original bytes are absent or have the wrong size.",
    );
  }
  const validated = await validateImage(
    await readBounded(object.body, imageLimits.maxEncodedBytes),
  );
  if (
    validated.digest !== image.digest ||
    validated.width !== image.width ||
    validated.height !== image.height ||
    `image/${validated.format}` !== image.contentType
  ) {
    throw new ImageValidationError(
      "original-integrity",
      "Stored original differs from its validated record.",
    );
  }
  return validated;
}

async function readOriginal(
  image: NonNullable<ComparisonTask["candidate"]>,
  images: ArtifactStorage,
  codecs: ImageCodecs,
) {
  return decodeImage(await readOriginalValidated(image, images), codecs);
}

async function writeArtifact({
  task,
  images,
  codecs,
  role,
  bytes,
  id: existingId,
}: WriteArtifactParams): Promise<ValidatedImage & { role: "mask" | "thumbnail" }> {
  const validated = await validateImage(bytes);
  await decodeImage(validated, codecs);
  const id =
    existingId ??
    (await sha256(new TextEncoder().encode(`${task.id}\0${role}\0${validated.digest}`)));
  const objectKey = `derived/${task.runId}/${id}`;
  await images.put(objectKey, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "image/png" },
    customMetadata: { digest: validated.digest },
    sha256: validated.digest,
  });
  return {
    id,
    runId: task.runId,
    objectKey,
    role,
    digest: validated.digest,
    width: validated.width,
    height: validated.height,
    contentType: "image/png",
    bytes: bytes.length,
  };
}

interface ThumbnailParams extends ProcessTaskParams {
  preview: Pixels;
  original: NonNullable<ComparisonTask["candidate"]>;
}

async function ensureThumbnail({
  task,
  images,
  codecs,
  preview,
  original,
}: ThumbnailParams): Promise<ValidatedImage & { role: "thumbnail" }> {
  const id = await sha256(
    new TextEncoder().encode(
      `${task.runId}\0${original.imageId}\0${original.digest}\0thumbnail-nearest-256-v1\0${codecVersion}`,
    ),
  );
  const objectKey = `derived/${task.runId}/${id}`;
  const existing = await images.get(objectKey);
  if (existing) {
    const validated = await validateImage(
      await readBounded(existing.body, imageLimits.maxEncodedBytes),
    );
    const decoded = await decodeImage(validated, codecs);
    const expected = createThumbnail(preview);
    if (
      validated.format !== "png" ||
      validated.width !== expected.width ||
      validated.height !== expected.height ||
      !decoded.data.every((value, index) => value === expected.data[index])
    ) {
      throw new ImageValidationError(
        "thumbnail-integrity",
        "Stored thumbnail differs from the original image.",
      );
    }
    return {
      id,
      runId: task.runId,
      objectKey,
      role: "thumbnail",
      digest: validated.digest,
      width: validated.width,
      height: validated.height,
      contentType: "image/png",
      bytes: validated.original.length,
    };
  }
  const artifact = await writeArtifact({
    task,
    images,
    codecs,
    id,
    role: "thumbnail",
    bytes: new Uint8Array(await codecs.encodePng(createThumbnail(preview))),
  });
  return { ...artifact, role: "thumbnail" };
}

/** R2 writes precede the lease-guarded D1 commit; retries use the same keys. */
export async function processComparisonTask({ task, images, codecs }: ProcessTaskParams) {
  const reference = task.reference ? await readOriginal(task.reference, images, codecs) : null;
  const candidate = task.candidate ? await readOriginal(task.candidate, images, codecs) : null;
  const preview = candidate ?? reference;
  if (!preview) {
    throw new ImageValidationError("missing-original", "Comparison has no image evidence.");
  }
  const original = task.candidate ?? task.reference;
  if (!original) {
    throw new ImageValidationError(
      "missing-original",
      "Comparison has no validated original record.",
    );
  }
  const thumbnail = await ensureThumbnail({ task, images, codecs, preview, original });
  const artifacts: Array<ValidatedImage & { role: "thumbnail" | "mask" }> = [thumbnail];
  if (!candidate || !reference) {
    return {
      result: {
        outcome: "changed" as const,
        maskExpected: false,
        changedPixels: preview.width * preview.height,
        ratio: 1,
        engineVersion,
        codecVersion,
        thumbnailImageId: thumbnail.id,
      },
      artifacts,
    };
  }
  const comparison = compareImages(reference, candidate, task.policy);
  if (comparison.outcome === "unchanged") {
    return {
      result: {
        outcome: comparison.outcome,
        maskExpected: false,
        changedPixels: comparison.changedPixels,
        ratio: comparison.ratio,
        engineVersion,
        codecVersion,
        thumbnailImageId: thumbnail.id,
      },
      artifacts,
    };
  }
  const mask = await writeArtifact({
    task,
    images,
    codecs,
    role: "mask",
    bytes: new Uint8Array(await codecs.encodePng(comparison.mask)),
  });
  artifacts.push(mask);
  return {
    result: {
      outcome: comparison.outcome,
      maskExpected: true,
      changedPixels: comparison.changedPixels,
      ratio: comparison.ratio,
      engineVersion,
      codecVersion,
      maskImageId: mask.id,
      thumbnailImageId: thumbnail.id,
    },
    artifacts,
  };
}
