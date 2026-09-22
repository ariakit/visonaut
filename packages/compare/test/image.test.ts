import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";
import {
  compareImages,
  createThumbnail,
  decodeImage,
  imageLimits,
  validateImage,
  type ImageCodecs,
} from "../src/index.ts";
import { crc32, joinBytes } from "../src/binary.ts";
import { nodeCodecs } from "./codecs.ts";

const expected = [
  255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 123, 45, 67, 0, 10, 20, 30, 128, 255, 255, 255,
  255,
];
const strict = { id: "test-strict", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 };
let codecs: ImageCodecs;
let png: Uint8Array<ArrayBuffer>;
let webp: Uint8Array<ArrayBuffer>;
let profile: Uint8Array<ArrayBuffer>;

function pngChunk(name: string, data: Uint8Array) {
  const chunk = new Uint8Array(data.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(name), 4);
  chunk.set(data, 8);
  view.setUint32(chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4)));
  return chunk;
}

function withPngChunk(name: string, data: Uint8Array) {
  return joinBytes([png.subarray(0, 33), pngChunk(name, data), png.subarray(33)]);
}

function webpChunk(name: string, data: Uint8Array) {
  const chunk = new Uint8Array(data.length + 8 + (data.length % 2));
  new DataView(chunk.buffer).setUint32(4, data.length, true);
  chunk.set(new TextEncoder().encode(name));
  chunk.set(data, 8);
  return chunk;
}

function withWebpProfile(icc: Uint8Array) {
  const extended = new Uint8Array([0x30, 0, 0, 0, 2, 0, 0, 1, 0, 0]);
  const bytes = joinBytes([
    webp.subarray(0, 12),
    webpChunk("VP8X", extended),
    webpChunk("ICCP", icc),
    webp.subarray(12),
  ]);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  return bytes;
}

beforeAll(async () => {
  codecs = await nodeCodecs();
  png = Uint8Array.from(await readFile(new URL("fixtures/rgba.png", import.meta.url)));
  webp = Uint8Array.from(await readFile(new URL("fixtures/rgba.webp", import.meta.url)));
  profile = Uint8Array.from(await readFile(new URL("fixtures/chromium-srgb.icc", import.meta.url)));
});

describe("validated originals and visible pixels", () => {
  it("preserves original PNG and WebP bytes and exact RGBA including alpha", async () => {
    for (const original of [png, webp]) {
      const image = await validateImage(original);
      expect(image.original).toEqual(original);
      expect(image.original).not.toBe(original);
      expect(Array.from((await decodeImage(image, codecs)).data)).toEqual(expected);
      expect(image).toMatchObject({ width: 3, height: 2, profile: "srgb-unprofiled-v1" });
    }
    const reference = await decodeImage(await validateImage(png), codecs);
    const candidate = await decodeImage(await validateImage(webp), codecs);
    expect(compareImages(reference, candidate, strict).outcome).toBe("unchanged");
  });

  it("accepts only the exact tested ICC in PNG and WebP", async () => {
    const pngProfile = withPngChunk(
      "iCCP",
      joinBytes([new TextEncoder().encode("sRGB\0\0"), deflateSync(profile)]),
    );
    for (const original of [pngProfile, withWebpProfile(profile)]) {
      const image = await validateImage(original);
      expect(image.profile).toBe("srgb-chromium-icc-v1");
      expect(image.original).toEqual(original);
      expect(Array.from((await decodeImage(image, codecs)).data)).toEqual(expected);
    }
    const unknown = profile.slice();
    unknown[20] = 17;
    await expect(validateImage(withWebpProfile(unknown))).rejects.toMatchObject({
      code: "unsupported-profile",
    });
    await expect(
      validateImage(
        withPngChunk(
          "iCCP",
          joinBytes([new TextEncoder().encode("sRGB\0\0"), deflateSync(unknown)]),
        ),
      ),
    ).rejects.toMatchObject({ code: "unsupported-profile" });
  });

  it("checks sRGB gamma/chromaticity and refuses unknown color metadata", async () => {
    expect((await validateImage(withPngChunk("sRGB", new Uint8Array([0])))).profile).toBe(
      "srgb-explicit-v1",
    );
    const gamma = new Uint8Array(4);
    new DataView(gamma.buffer).setUint32(0, 45455);
    await expect(validateImage(withPngChunk("gAMA", gamma))).resolves.toMatchObject({ width: 3 });
    new DataView(gamma.buffer).setUint32(0, 100000);
    await expect(validateImage(withPngChunk("gAMA", gamma))).rejects.toMatchObject({
      code: "unsupported-profile",
    });
    await expect(validateImage(withPngChunk("cICP", new Uint8Array(4)))).rejects.toMatchObject({
      code: "unsupported-profile",
    });
  });

  it("supports WebKit's exact sRGB EXIF layout and rejects altered color/dimensions", async () => {
    const metadata = Uint8Array.from(
      Buffer.from(
        "4d4d002a00000008000187690004000000010000001a000000000003a00100030000000100010000a00200040000000100000003a0030004000000010000000200000000",
        "hex",
      ),
    );
    const image = await validateImage(withPngChunk("eXIf", metadata));
    expect(image.profile).toBe("srgb-explicit-v1");
    expect(Array.from((await decodeImage(image, codecs)).data)).toEqual(expected);
    metadata[36] = 1;
    await expect(validateImage(withPngChunk("eXIf", metadata))).rejects.toMatchObject({
      code: "unsupported-profile",
    });
    metadata[36] = 0;
    metadata[63] = 3;
    await expect(validateImage(withPngChunk("eXIf", metadata))).rejects.toMatchObject({
      code: "unsupported-profile",
    });
  });

  it("rejects checksums, truncation, animation, unsupported depth and critical chunks", async () => {
    const badCrc = png.slice();
    badCrc[29] = (badCrc[29] ?? 0) ^ 1;
    await expect(validateImage(badCrc)).rejects.toMatchObject({ code: "png-crc" });
    await expect(validateImage(png.subarray(0, png.length - 1))).rejects.toMatchObject({
      code: "png-truncated",
    });
    await expect(validateImage(withPngChunk("acTL", new Uint8Array(8)))).rejects.toMatchObject({
      code: "animated-image",
    });
    await expect(validateImage(withPngChunk("FAKE", new Uint8Array()))).rejects.toMatchObject({
      code: "png-chunk",
    });
    const header = png.slice(16, 29);
    header[8] = 16;
    await expect(
      validateImage(joinBytes([png.subarray(0, 8), pngChunk("IHDR", header), png.subarray(33)])),
    ).rejects.toMatchObject({ code: "png-encoding" });
    const badStream = png.slice();
    badStream[badStream.length - 17] = (badStream[badStream.length - 17] ?? 0) ^ 1;
    const imageDataLength = new DataView(badStream.buffer).getUint32(33);
    new DataView(badStream.buffer).setUint32(
      41 + imageDataLength,
      crc32(badStream.subarray(37, 41 + imageDataLength)),
    );
    await expect(validateImage(badStream)).rejects.toMatchObject({ code: "compressed-data" });
  });

  it("bounds encoded, decoded and compressed profile sizes before codec allocation", async () => {
    await expect(validateImage(png, { ...imageLimits, maxEncodedBytes: 10 })).rejects.toMatchObject(
      { code: "encoded-size" },
    );
    await expect(validateImage(png, { ...imageLimits, maxPixels: 5 })).rejects.toMatchObject({
      code: "image-too-large",
    });
    await expect(validateImage(webp, { ...imageLimits, maxPixels: 5 })).rejects.toMatchObject({
      code: "image-too-large",
    });
    const bomb = withPngChunk(
      "iCCP",
      joinBytes([new TextEncoder().encode("sRGB\0\0"), deflateSync(new Uint8Array(100000))]),
    );
    await expect(validateImage(bomb)).rejects.toMatchObject({ code: "decoded-size" });
  });

  it("rejects lossy, malformed, mismatched-size and corrupt lossless WebP", async () => {
    const lossy = await readFile(new URL("fixtures/lossy.webp", import.meta.url));
    await expect(validateImage(lossy)).rejects.toMatchObject({ code: "lossy-webp" });
    await expect(validateImage(webp.subarray(0, webp.length - 2))).rejects.toMatchObject({
      code: "webp-size",
    });
    const mismatch = withWebpProfile(profile);
    mismatch[24] = 20;
    await expect(validateImage(mismatch)).rejects.toMatchObject({ code: "webp-dimensions" });
    const corrupt = webp.slice(0, 26);
    new DataView(corrupt.buffer).setUint32(4, corrupt.length - 8, true);
    new DataView(corrupt.buffer).setUint32(16, 6, true);
    await expect(decodeImage(await validateImage(corrupt), codecs)).rejects.toMatchObject({
      code: "decode-failed",
    });
  });

  it("ignores hidden RGB, detects alpha/color changes, and makes red-only masks", () => {
    const image = { width: 3, height: 2, data: new Uint8ClampedArray(expected) };
    const hidden = { ...image, data: image.data.slice() };
    hidden.data[12] = 200;
    expect(compareImages(image, hidden, strict).changedPixels).toBe(0);
    hidden.data[19] = 129;
    const result = compareImages(image, hidden, strict);
    expect(result).toMatchObject({ outcome: "changed", changedPixels: 1, ratio: 1 / 6 });
    expect(Array.from(result.mask.data.subarray(16, 20))).toEqual([255, 0, 0, 255]);
    expect(Array.from(result.mask.data.subarray(0, 16))).toEqual(new Array(16).fill(0));
    expect(compareImages(image, hidden, strict)).toEqual(result);
  });

  it("always reports dimensions as changed and never substitutes a thumbnail baseline", () => {
    const image = { width: 3, height: 2, data: new Uint8ClampedArray(expected) };
    expect(
      compareImages(
        image,
        { ...image, width: 2, height: 3 },
        { ...strict, maxChangedPixels: 1000, maxChangedRatio: 1 },
      ),
    ).toMatchObject({ outcome: "changed", sizeChanged: true, ratio: 1 });
    const thumbnail = createThumbnail(image, 2);
    expect(thumbnail).toMatchObject({ width: 2, height: 1 });
    expect(Array.from(thumbnail.data)).toEqual(expected.slice(0, 8));
    expect(image.data).toEqual(new Uint8ClampedArray(expected));
  });

  it("makes repeated tolerated drift explicit and strict policy detects each step", () => {
    const permissive = { ...strict, id: "study-one-level", channelThreshold: 1 };
    let image = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) };
    const original = image;
    for (let level = 1; level <= 20; level += 1) {
      const next = { ...image, data: new Uint8ClampedArray([level, 0, 0, 255]) };
      expect(compareImages(image, next, permissive).outcome).toBe("unchanged");
      expect(compareImages(image, next, strict).outcome).toBe("changed");
      image = next;
    }
    expect(compareImages(original, image, permissive).outcome).toBe("changed");
  });
});
