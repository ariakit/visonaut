import { assertDimensions, imageLimits, invalid, type Pixels } from "./types.ts";

export const engineVersion = "rgba-visible-1";
export const codecVersion = "jsquash-png-3.1.1-webp-1.5.0";

export interface ComparisonPolicy {
  id: string;
  /** Maximum per-channel visible difference, in 8-bit channel units. */
  channelThreshold: number;
  maxChangedPixels: number;
  maxChangedRatio: number;
}

export interface ComparisonResult {
  outcome: "unchanged" | "changed";
  changedPixels: number;
  ratio: number;
  sizeChanged: boolean;
  width: number;
  height: number;
  engineVersion: string;
  codecVersion: string;
  policy: ComparisonPolicy;
  mask: Pixels;
}

export function validatePolicy(policy: ComparisonPolicy) {
  if (
    !policy.id ||
    !Number.isFinite(policy.channelThreshold) ||
    policy.channelThreshold < 0 ||
    policy.channelThreshold > 255 ||
    !Number.isSafeInteger(policy.maxChangedPixels) ||
    policy.maxChangedPixels < 0 ||
    !Number.isFinite(policy.maxChangedRatio) ||
    policy.maxChangedRatio < 0 ||
    policy.maxChangedRatio > 1
  ) {
    invalid("comparison-policy", "Comparison policy is invalid.");
  }
}

function validatePixels(image: Pixels) {
  assertDimensions(image.width, image.height, imageLimits);
  if (image.data.length !== image.width * image.height * 4) {
    invalid("pixel-buffer", "RGBA buffer length does not match image dimensions.");
  }
}

function visibleDelta(reference: Uint8ClampedArray, candidate: Uint8ClampedArray, offset: number) {
  const referenceAlpha = reference[offset + 3] ?? 0;
  const candidateAlpha = candidate[offset + 3] ?? 0;
  let maximum = 0;
  for (let channel = 0; channel < 3; channel += 1) {
    // Black and white composites detect alpha differences without counting
    // invisible RGB in fully transparent pixels. Integer math is reproducible.
    const black =
      (reference[offset + channel] ?? 0) * referenceAlpha -
      (candidate[offset + channel] ?? 0) * candidateAlpha;
    const white = black + 255 * (candidateAlpha - referenceAlpha);
    maximum = Math.max(maximum, Math.abs(black), Math.abs(white));
  }
  return maximum;
}

export function compareImages(
  reference: Pixels,
  candidate: Pixels,
  policy: ComparisonPolicy,
): ComparisonResult {
  validatePolicy(policy);
  validatePixels(reference);
  validatePixels(candidate);
  const sizeChanged = reference.width !== candidate.width || reference.height !== candidate.height;
  const data = new Uint8ClampedArray(candidate.data.length);
  let changedPixels = 0;
  for (let offset = 0; offset < candidate.data.length; offset += 4) {
    if (
      !sizeChanged &&
      visibleDelta(reference.data, candidate.data, offset) <= policy.channelThreshold * 255
    )
      continue;
    data[offset] = 255;
    data[offset + 3] = 255;
    changedPixels += 1;
  }
  const ratio = changedPixels / (candidate.width * candidate.height);
  const outcome =
    sizeChanged || changedPixels > policy.maxChangedPixels || ratio > policy.maxChangedRatio
      ? "changed"
      : "unchanged";
  return {
    outcome,
    changedPixels,
    ratio,
    sizeChanged,
    width: candidate.width,
    height: candidate.height,
    engineVersion,
    codecVersion,
    policy: { ...policy },
    mask: { width: candidate.width, height: candidate.height, data },
  };
}

/** Nearest-neighbor preview only; this output is never used as a baseline. */
export function createThumbnail(image: Pixels, maximum = 256): Pixels {
  validatePixels(image);
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1024) {
    invalid("thumbnail-size", "Thumbnail limit must be an integer from 1 through 1024.");
  }
  const scale = Math.min(1, maximum / Math.max(image.width, image.height));
  const width = Math.max(1, Math.floor(image.width * scale));
  const height = Math.max(1, Math.floor(image.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const source =
        (Math.floor((row * image.height) / height) * image.width +
          Math.floor((column * image.width) / width)) *
        4;
      data.set(image.data.subarray(source, source + 4), (row * width + column) * 4);
    }
  }
  return { width, height, data };
}
