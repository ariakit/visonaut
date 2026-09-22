export interface ImageLimits {
  maxEncodedBytes: number;
  maxPixels: number;
  maxDimension: number;
  maxProfileBytes: number;
}

/** Provisional resource bounds; the deployed probe must pass before launch. */
export const imageLimits: Readonly<ImageLimits> = Object.freeze({
  maxEncodedBytes: 2 * 1024 * 1024,
  maxPixels: 2_100_000,
  maxDimension: 8192,
  maxProfileBytes: 65_536,
});

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface ImageCodecs {
  decodePng(bytes: ArrayBuffer): Promise<Pixels>;
  decodeWebp(bytes: ArrayBuffer): Promise<Pixels>;
  encodePng(image: Pixels): Promise<ArrayBuffer>;
  wasmMemoryBytes?(): number;
}

export interface ValidatedImage {
  format: "png" | "webp";
  width: number;
  height: number;
  digest: string;
  profile: "srgb-unprofiled-v1" | "srgb-explicit-v1" | "srgb-chromium-icc-v1";
  original: Uint8Array<ArrayBuffer>;
  decodeBytes: Uint8Array<ArrayBuffer>;
}

export class ImageValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ImageValidationError";
  }
}

export function invalid(code: string, message: string): never {
  throw new ImageValidationError(code, message);
}

export function assertDimensions(width: number, height: number, limits: ImageLimits) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    invalid("dimensions", "Image dimensions must be positive integers.");
  }
  if (
    width > limits.maxDimension ||
    height > limits.maxDimension ||
    width * height > limits.maxPixels
  ) {
    invalid("image-too-large", "Image dimensions exceed the configured decode limit.");
  }
}
