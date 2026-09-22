import { sha256, textAt } from "./binary.ts";
import { inspectPng } from "./png.ts";
import { inspectWebp } from "./webp.ts";
import {
  imageLimits,
  invalid,
  type ImageLimits,
  type ImageCodecs,
  type ValidatedImage,
} from "./types.ts";

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

export async function validateImage(
  input: Uint8Array,
  limits: ImageLimits = imageLimits,
): Promise<ValidatedImage> {
  if (input.length > limits.maxEncodedBytes) {
    invalid("encoded-size", "Image bytes exceed the configured upload limit.");
  }
  if (input.length < 12) {
    invalid("image-format", "Image is truncated or has an unsupported format.");
  }
  const original = Uint8Array.from(input);
  let format: ValidatedImage["format"];
  if (pngSignature.every((byte, index) => original[index] === byte)) {
    format = "png";
  } else if (textAt(original, 0, 4) === "RIFF" && textAt(original, 8, 4) === "WEBP") {
    format = "webp";
  } else {
    invalid("image-format", "Only PNG and lossless WebP are supported.");
  }
  const metadata =
    format === "png" ? await inspectPng(original, limits) : await inspectWebp(original, limits);
  return { ...metadata, format, original, digest: await sha256(original) };
}

export async function decodeImage(image: ValidatedImage, codecs: ImageCodecs) {
  let pixels;
  try {
    pixels = await (image.format === "png" ? codecs.decodePng : codecs.decodeWebp)(
      image.decodeBytes.buffer,
    );
  } catch {
    invalid("decode-failed", "Image decoder rejected the validated input.");
  }
  if (
    pixels.width !== image.width ||
    pixels.height !== image.height ||
    pixels.data.length !== image.width * image.height * 4
  ) {
    invalid("decode-dimensions", "Decoded pixels do not match the validated dimensions.");
  }
  return pixels;
}

export async function readBounded(stream: ReadableStream<Uint8Array>, maximum: number) {
  const reader = stream.getReader();
  const buffer = new Uint8Array(maximum);
  let offset = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (offset + next.value.length > maximum) {
        await reader.cancel();
        invalid("encoded-size", "Image bytes exceed the configured upload limit.");
      }
      buffer.set(next.value, offset);
      offset += next.value.length;
    }
  } finally {
    reader.releaseLock();
  }
  return buffer.slice(0, offset);
}
