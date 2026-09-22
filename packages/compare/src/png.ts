import { crc32, inflateBounded, joinBytes, read32, textAt } from "./binary.ts";
import { validateProfile } from "./profile.ts";
import { validateWebkitExif } from "./exif.ts";
import { assertDimensions, invalid, type ImageLimits, type ValidatedImage } from "./types.ts";

const chromaticities = [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000];
const singletonChunks = new Set([
  "IHDR",
  "PLTE",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "iCCP",
  "eXIf",
  "IEND",
]);

function filteredSize(width: number, height: number, channels: number, interlace: number) {
  if (!interlace) {
    return height * (width * channels + 1);
  }
  const passes = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ];
  let length = 0;
  for (const pass of passes) {
    const [left = 0, top = 0, horizontal = 1, vertical = 1] = pass;
    const columns = Math.max(0, Math.ceil((width - left) / horizontal));
    const rows = Math.max(0, Math.ceil((height - top) / vertical));
    if (columns && rows) {
      length += rows * (columns * channels + 1);
    }
  }
  return length;
}

export async function inspectPng(bytes: Uint8Array<ArrayBuffer>, limits: ImageLimits) {
  const chunks = new Set<string>();
  const decodeChunks = [bytes.subarray(0, 8)];
  const compressed: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let color = -1;
  let channels = 0;
  let interlace = 0;
  let paletteEntries = 0;
  let dataEnded = false;
  let profile: ValidatedImage["profile"] = "srgb-unprofiled-v1";
  let offset = 8;
  let chunkCount = 0;
  while (offset < bytes.length) {
    chunkCount += 1;
    if (chunkCount > 1024) {
      invalid("png-chunk-count", "PNG contains too many chunks.");
    }
    if (bytes.length - offset < 12) {
      invalid("png-truncated", "PNG contains a truncated chunk.");
    }
    const length = read32(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length) {
      invalid("png-truncated", "PNG chunk exceeds the file length.");
    }
    const name = textAt(bytes, offset + 4, 4);
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(name)) {
      invalid("png-chunk", "PNG chunk name is invalid.");
    }
    if (read32(bytes, end - 4) !== crc32(bytes.subarray(offset + 4, end - 4))) {
      invalid("png-crc", "PNG chunk checksum does not match.");
    }
    const data = bytes.subarray(offset + 8, end - 4);
    if (!chunks.size && name !== "IHDR") {
      invalid("png-order", "PNG must start with IHDR.");
    }
    if (singletonChunks.has(name) && chunks.has(name)) {
      invalid("png-duplicate", "PNG contains a duplicate singleton chunk.");
    }
    if (["acTL", "fcTL", "fdAT"].includes(name)) {
      invalid("animated-image", "Animated PNG is unsupported.");
    }
    if (["cICP", "mDCv", "cLLi"].includes(name)) {
      invalid("unsupported-profile", "PNG contains unsupported color or orientation metadata.");
    }
    if (name === "IHDR") {
      if (length !== 13) {
        invalid("png-header", "PNG IHDR length must be 13.");
      }
      width = read32(data, 0);
      height = read32(data, 4);
      assertDimensions(width, height, limits);
      color = data[9] ?? -1;
      channels =
        new Map([
          [0, 1],
          [2, 3],
          [3, 1],
          [4, 2],
          [6, 4],
        ]).get(color) ?? 0;
      interlace = data[12] ?? -1;
      if (data[8] !== 8 || !channels || data[10] !== 0 || data[11] !== 0 || interlace > 1) {
        invalid(
          "png-encoding",
          "Only static 8-bit PNG color types and standard compression are supported.",
        );
      }
    } else if (["PLTE", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP"].includes(name)) {
      if (chunks.has("IDAT")) {
        invalid(
          "png-order",
          "PNG palette, transparency and color metadata must precede image data.",
        );
      }
      if (["gAMA", "cHRM", "sRGB", "iCCP"].includes(name) && chunks.has("PLTE")) {
        invalid("png-order", "PNG color metadata must precede the palette.");
      }
      if (name === "PLTE") {
        if (
          !length ||
          length > 768 ||
          length % 3 ||
          color === 0 ||
          color === 4 ||
          chunks.has("tRNS")
        ) {
          invalid("png-palette", "PNG palette is invalid for this color type.");
        }
        paletteEntries = length / 3;
      }
      if (name === "tRNS") {
        const valid =
          (color === 0 && length === 2 && data[0] === 0) ||
          (color === 2 && length === 6 && data[0] === 0 && data[2] === 0 && data[4] === 0) ||
          (color === 3 && length > 0 && length <= paletteEntries);
        if (!valid) {
          invalid("png-transparency", "PNG transparency data is invalid.");
        }
      }
      if (name === "gAMA" && (length !== 4 || read32(data, 0) !== 45455)) {
        invalid("unsupported-profile", "PNG gamma must describe sRGB.");
      }
      if (
        name === "cHRM" &&
        (length !== 32 || chromaticities.some((value, index) => read32(data, index * 4) !== value))
      ) {
        invalid("unsupported-profile", "PNG chromaticities must describe sRGB.");
      }
      if (name === "sRGB") {
        if (length !== 1 || (data[0] ?? 4) > 3 || chunks.has("iCCP")) {
          invalid("unsupported-profile", "PNG sRGB metadata is invalid or conflicts with ICC.");
        }
        profile = "srgb-explicit-v1";
      }
      if (name === "iCCP") {
        const nameEnd = data.indexOf(0);
        if (nameEnd < 1 || nameEnd > 79 || data[nameEnd + 1] !== 0 || chunks.has("sRGB")) {
          invalid("unsupported-profile", "PNG ICC metadata is invalid or conflicts with sRGB.");
        }
        profile = await validateProfile(
          await inflateBounded(data.slice(nameEnd + 2), limits.maxProfileBytes),
        );
      }
    } else if (name === "eXIf") {
      validateWebkitExif(data, width, height);
      if (profile === "srgb-unprofiled-v1") {
        profile = "srgb-explicit-v1";
      }
    } else if (name === "IDAT") {
      if (dataEnded || (color === 3 && !paletteEntries)) {
        invalid("png-order", "PNG image data must be consecutive and follow its required palette.");
      }
      compressed.push(data);
    } else if (name === "IEND") {
      if (length || !chunks.has("IDAT") || end !== bytes.length) {
        invalid("png-end", "PNG must end after image data with an empty IEND.");
      }
    } else if (/^[A-Z]/.test(name)) {
      invalid("png-chunk", "PNG contains an unknown critical chunk.");
    }
    if (name !== "IDAT" && chunks.has("IDAT")) {
      dataEnded = true;
    }
    if (["IHDR", "PLTE", "tRNS", "IDAT", "IEND"].includes(name)) {
      decodeChunks.push(bytes.subarray(offset, end));
    }
    chunks.add(name);
    offset = end;
  }
  if (!chunks.has("IEND")) {
    invalid("png-end", "PNG is missing IEND.");
  }
  const expected = filteredSize(width, height, channels, interlace);
  const inflated = await inflateBounded(joinBytes(compressed), expected);
  if (inflated.length !== expected) {
    invalid("decoded-size", "PNG decompressed data does not match its dimensions.");
  }
  // Strip metadata only from the decoder input. Original bytes remain immutable.
  return { width, height, profile, decodeBytes: joinBytes(decodeChunks) };
}
