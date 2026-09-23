import { read32, textAt } from "./binary.ts";
import { validateProfile } from "./profile.ts";
import { assertDimensions, invalid, type ImageLimits, type ValidatedImage } from "./types.ts";

function read24(bytes: Uint8Array, offset: number) {
  return (bytes[offset] ?? 0) + (bytes[offset + 1] ?? 0) * 256 + (bytes[offset + 2] ?? 0) * 65536;
}

export async function inspectWebp(bytes: Uint8Array<ArrayBuffer>, limits: ImageLimits) {
  if (read32(bytes, 4, true) + 8 !== bytes.length) {
    invalid("webp-size", "WebP RIFF length does not match the file.");
  }
  let offset = 12;
  let width = 0;
  let height = 0;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let flags = 0;
  let profile: ValidatedImage["profile"] = "srgb-unprofiled-v1";
  const chunks = new Set<string>();
  while (offset < bytes.length) {
    if (bytes.length - offset < 8) {
      invalid("webp-truncated", "WebP contains a truncated chunk.");
    }
    const name = textAt(bytes, offset, 4);
    const length = read32(bytes, offset + 4, true);
    const end = offset + 8 + length;
    if (end + (length % 2) > bytes.length || (length % 2 && bytes[end] !== 0)) {
      invalid("webp-truncated", "WebP chunk length or padding is invalid.");
    }
    if (chunks.has(name)) {
      invalid("webp-duplicate", "WebP contains a duplicate chunk.");
    }
    const data = bytes.subarray(offset + 8, end);
    if (["ANIM", "ANMF"].includes(name)) {
      invalid("animated-image", "Animated WebP is unsupported.");
    }
    if (name === "VP8 " || name === "ALPH") {
      invalid("lossy-webp", "Only lossless WebP is supported.");
    }
    if (name === "VP8X") {
      flags = data[0] ?? 0;
      if (offset !== 12 || length !== 10 || flags & ~0x30 || data[1] || data[2] || data[3]) {
        invalid("webp-header", "WebP extended header has unsupported flags or layout.");
      }
      canvasWidth = read24(data, 4) + 1;
      canvasHeight = read24(data, 7) + 1;
      assertDimensions(canvasWidth, canvasHeight, limits);
    } else if (name === "ICCP") {
      if (
        !chunks.has("VP8X") ||
        chunks.has("VP8L") ||
        !(flags & 0x20) ||
        length > limits.maxProfileBytes
      ) {
        invalid("unsupported-profile", "WebP ICC profile has invalid flags, position, or size.");
      }
      profile = await validateProfile(data);
    } else if (name === "VP8L") {
      if (length < 5 || data[0] !== 0x2f) {
        invalid("webp-header", "WebP lossless header is invalid.");
      }
      const packed = read32(data, 1, true);
      if (packed >>> 29) {
        invalid("webp-version", "WebP lossless version is unsupported.");
      }
      width = (packed & 0x3fff) + 1;
      height = ((packed >>> 14) & 0x3fff) + 1;
      assertDimensions(width, height, limits);
      if (chunks.has("VP8X") && (width !== canvasWidth || height !== canvasHeight)) {
        invalid("webp-dimensions", "WebP canvas and lossless dimensions differ.");
      }
    } else {
      invalid("webp-chunk", "WebP contains an unsupported chunk.");
    }
    chunks.add(name);
    offset = end + (length % 2);
  }
  if (!chunks.has("VP8L") || Boolean(flags & 0x20) !== chunks.has("ICCP")) {
    invalid("webp-incomplete", "WebP is missing required lossless image or profile data.");
  }
  return { width, height, profile, decodeBytes: bytes };
}
