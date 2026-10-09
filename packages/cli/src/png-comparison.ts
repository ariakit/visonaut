import { imageLimits, validateImage } from "@visonaut/compare";
import type { Capture, CaptureComparison } from "@visonaut/protocol";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { CliError, cliError, nameFile } from "./errors.js";

export type ImageMetadata = Omit<Capture["image"], "path">;

function count(value: number) {
  return value.toLocaleString("en-US");
}

/** The declared size is known before the decode, so the message can show the numbers. */
function assertSizeLimits({ width, height, bytes }: ImageMetadata) {
  const pixels = width * height;
  if (pixels > imageLimits.maxPixels) {
    throw new CliError(
      `${width}x${height} is ${count(pixels)} pixels. The limit is ${count(imageLimits.maxPixels)}.`,
    );
  }
  if (width > imageLimits.maxDimension || height > imageLimits.maxDimension) {
    throw new CliError(
      `${width}x${height} has a side above ${count(imageLimits.maxDimension)} pixels.`,
    );
  }
  if (bytes > imageLimits.maxEncodedBytes) {
    throw new CliError(
      `${count(bytes)} bytes is above the limit of ${count(imageLimits.maxEncodedBytes)} bytes.`,
    );
  }
}

/**
 * Apply the same encoded, decoded, and color-profile bounds as image admission.
 * A failure starts with `label`, the name of the screenshot.
 */
export async function decodePng(bytes: Buffer, metadata: ImageMetadata, label: string) {
  try {
    if (metadata.mediaType !== "image/png") {
      throw new CliError("Local comparison supports PNG only. Capture PNG images before Submit.");
    }
    assertSizeLimits(metadata);
    const validated = await validateImage(bytes);
    if (
      validated.format !== "png" ||
      validated.digest !== metadata.digest ||
      bytes.length !== metadata.bytes ||
      validated.width !== metadata.width ||
      validated.height !== metadata.height
    ) {
      throw new CliError("An image does not match its declared PNG metadata.");
    }
    const decoded = PNG.sync.read(Buffer.from(validated.decodeBytes));
    if (
      decoded.width !== metadata.width ||
      decoded.height !== metadata.height ||
      decoded.data.length !== metadata.width * metadata.height * 4
    ) {
      throw new CliError("Decoded image dimensions do not match the manifest.");
    }
    return decoded;
  } catch (error) {
    throw nameFile(
      label,
      cliError(error, "An image is not a supported, bounded PNG. Capture the image again."),
    );
  }
}

interface ComparePixelsParams {
  candidate: PNG;
  reference: PNG;
  comparison: CaptureComparison;
  profileChanged: boolean;
}

interface PixelComparison {
  outcome: "unchanged" | "changed";
  changedPixels: number;
  ratio: number;
  sizeChanged: boolean;
  mask?: Buffer;
}

export function comparePixels({
  candidate,
  reference,
  comparison,
  profileChanged,
}: ComparePixelsParams): PixelComparison {
  const pixels = candidate.width * candidate.height;
  if (candidate.width !== reference.width || candidate.height !== reference.height) {
    return { outcome: "changed" as const, changedPixels: pixels, ratio: 1, sizeChanged: true };
  }
  const mask = Buffer.alloc(pixels * 4);
  const changedPixels = pixelmatch(
    reference.data,
    candidate.data,
    mask,
    candidate.width,
    candidate.height,
    { threshold: comparison.threshold, includeAA: false, diffMask: true },
  );
  // Apply both Playwright caps without rounding a fractional pixel allowance up.
  const allowed = Math.min(
    comparison.maxDiffPixels ?? Infinity,
    comparison.maxDiffPixelRatio === undefined ? Infinity : pixels * comparison.maxDiffPixelRatio,
  );
  const changed =
    (profileChanged && changedPixels !== 0) ||
    changedPixels > (Number.isFinite(allowed) ? allowed : 0);
  const result = {
    outcome: changed ? ("changed" as const) : ("unchanged" as const),
    changedPixels,
    ratio: changedPixels / pixels,
    sizeChanged: false,
  };
  if (!changed || !changedPixels) {
    return result;
  }
  const maskImage = new PNG();
  maskImage.width = candidate.width;
  maskImage.height = candidate.height;
  maskImage.data = mask;
  const bytes = PNG.sync.write(maskImage);
  if (bytes.length > imageLimits.maxEncodedBytes) {
    throw new CliError("The comparison mask exceeds the image upload limit.");
  }
  return { ...result, mask: bytes };
}
