import { engineVersion, imageLimits, readBounded, sha256, validateImage } from "@visonaut/compare";
import type { ComparisonTask, ValidatedImage } from "@visonaut/service";
import { readOriginalValidated, type ArtifactStorage } from "./process.ts";

const maxContainerResponseBytes = 8 * 1024 * 1024;
const containerCodecVersion = "sharp-0.35.4-vips-8.18.6";

export interface ContainerTransport {
  fetch(request: Request): Promise<Response>;
}

interface ContainerArtifact {
  base64: string;
  digest: string;
}

interface ContainerResult {
  outcome: "changed" | "unchanged";
  changedPixels: number;
  ratio: number;
  engineVersion: string;
  codecVersion: string;
  thumbnail: ContainerArtifact;
  mask: ContainerArtifact | null;
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function artifactBytes(artifact: ContainerArtifact) {
  if (!artifact || typeof artifact.base64 !== "string" || typeof artifact.digest !== "string") {
    throw new Error("Container artifact is incomplete.");
  }
  const binary = atob(artifact.base64);
  if (binary.length > imageLimits.maxEncodedBytes) {
    throw new Error("Container artifact exceeds the encoded-image limit.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function prepareOriginal(
  image: NonNullable<ComparisonTask["candidate"]> | null,
  images: ArtifactStorage,
) {
  if (!image) return null;
  const validated = await readOriginalValidated(image, images);
  return {
    base64: base64(validated.original),
    digest: image.digest,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    contentType: image.contentType,
  };
}

function expectedThumbnailSize(width: number, height: number) {
  const scale = Math.min(1, 256 / Math.max(width, height));
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

async function storeArtifact(
  task: ComparisonTask,
  images: ArtifactStorage,
  role: "mask" | "thumbnail",
  source: ContainerArtifact,
  expected: { width: number; height: number },
): Promise<ValidatedImage & { role: "mask" | "thumbnail" }> {
  const bytes = artifactBytes(source);
  const validated = await validateImage(bytes);
  if (
    validated.format !== "png" ||
    validated.digest !== source.digest ||
    validated.width !== expected.width ||
    validated.height !== expected.height
  ) {
    throw new Error("Container artifact failed validation.");
  }
  const id = await sha256(new TextEncoder().encode(`${task.id}\0${role}\0${validated.digest}`));
  const objectKey = `derived/${task.runId}/${id}`;
  const saved = await images.put(objectKey, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "image/png" },
    customMetadata: { digest: validated.digest },
    sha256: validated.digest,
  });
  if (!saved) {
    const existing = await images.get(objectKey);
    if (!existing || existing.size !== bytes.length) {
      throw new Error("Existing Container artifact differs.");
    }
    const original = await readBounded(existing.body, imageLimits.maxEncodedBytes);
    if (
      original.length !== bytes.length ||
      !original.every((value, index) => value === bytes[index])
    ) {
      throw new Error("Existing Container artifact differs.");
    }
  }
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

function parseResult(value: unknown, paired: boolean, pixels: number): ContainerResult {
  if (!value || typeof value !== "object") {
    throw new Error("Container result is missing.");
  }
  const result = value as ContainerResult;
  if (
    (result.outcome !== "changed" && result.outcome !== "unchanged") ||
    !Number.isSafeInteger(result.changedPixels) ||
    result.changedPixels < 0 ||
    result.changedPixels > pixels ||
    !Number.isFinite(result.ratio) ||
    result.ratio !== result.changedPixels / pixels ||
    result.engineVersion !== engineVersion ||
    result.codecVersion !== containerCodecVersion ||
    (paired && result.outcome === "changed") !== Boolean(result.mask) ||
    (!paired && (result.outcome !== "changed" || result.changedPixels !== pixels))
  ) {
    throw new Error("Container result failed validation.");
  }
  return result;
}

export async function processComparisonTaskInContainer({
  task,
  images,
  container,
}: {
  task: ComparisonTask;
  images: ArtifactStorage;
  container: ContainerTransport;
}) {
  const reference = await prepareOriginal(task.reference, images);
  const candidate = await prepareOriginal(task.candidate, images);
  const preview = candidate ?? reference;
  if (!preview) {
    throw new Error("Comparison has no image evidence.");
  }
  const response = await container.fetch(
    new Request("http://localhost/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference, candidate, policy: task.policy }),
    }),
  );
  if (!response.ok || !response.body) {
    throw new Error(`Container comparison returned HTTP ${response.status}.`);
  }
  const raw = await readBounded(response.body, maxContainerResponseBytes);
  const result = parseResult(
    JSON.parse(new TextDecoder().decode(raw)),
    Boolean(reference && candidate),
    preview.width * preview.height,
  );
  const thumbnail = await storeArtifact(
    task,
    images,
    "thumbnail",
    result.thumbnail,
    expectedThumbnailSize(preview.width, preview.height),
  );
  const artifacts: Array<ValidatedImage & { role: "thumbnail" | "mask" }> = [thumbnail];
  let maskId: string | undefined;
  if (result.mask) {
    const mask = await storeArtifact(task, images, "mask", result.mask, {
      width: preview.width,
      height: preview.height,
    });
    artifacts.push(mask);
    maskId = mask.id;
  }
  return {
    result: {
      outcome: result.outcome,
      maskExpected: Boolean(result.mask),
      changedPixels: result.changedPixels,
      ratio: result.ratio,
      engineVersion,
      codecVersion: containerCodecVersion,
      thumbnailImageId: thumbnail.id,
      ...(maskId ? { maskImageId: maskId } : {}),
    },
    artifacts,
  };
}
