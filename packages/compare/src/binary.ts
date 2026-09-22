import { invalid } from "./types.ts";

export function read32(bytes: Uint8Array, offset: number, littleEndian = false) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    littleEndian,
  );
}

export function textAt(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

export function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function joinBytes(parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function inflateBounded(bytes: Uint8Array<ArrayBuffer>, maximum: number) {
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"))
    .getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > maximum) {
        await reader.cancel();
        invalid("decoded-size", "Compressed data exceeds the declared image or profile size.");
      }
      parts.push(next.value);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ImageValidationError") {
      throw error;
    }
    invalid("compressed-data", "Image contains an invalid compressed stream.");
  } finally {
    reader.releaseLock();
  }
  return joinBytes(parts);
}
