import { crc32, deflateSync } from "node:zlib";

export type Color = readonly [red: number, green: number, blue: number];

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
  color: Color;
}

export interface Picture {
  width: number;
  height: number;
  /** RGBA, 4 bytes for each pixel, row after row. */
  pixels: Uint8Array;
}

export interface PaintParams {
  width: number;
  height: number;
  background: Color;
  /** A later rectangle covers an earlier one. */
  rectangles: readonly Rectangle[];
}

/** Paint opaque rectangles over an opaque background. */
export function paint({ width, height, background, rectangles }: PaintParams): Picture {
  const pixels = new Uint8Array(width * height * 4);
  const fill = (rectangle: Rectangle) => {
    for (let y = rectangle.y; y < rectangle.y + rectangle.height; y++) {
      for (let x = rectangle.x; x < rectangle.x + rectangle.width; x++) {
        pixels.set([...rectangle.color, 255], (y * width + x) * 4);
      }
    }
  };
  fill({ x: 0, y: 0, width, height, color: background });
  for (const rectangle of rectangles) {
    fill(rectangle);
  }
  return { width, height, pixels };
}

/**
 * Mark each pixel that differs, in the form of the Submit mask: an opaque red
 * pixel for a difference and a transparent pixel for no difference.
 */
export function differenceMask(reference: Picture, candidate: Picture) {
  const mask = new Uint8Array(candidate.pixels.length);
  let changedPixels = 0;
  for (let offset = 0; offset < mask.length; offset += 4) {
    const same = [0, 1, 2, 3].every(
      (channel) => reference.pixels[offset + channel] === candidate.pixels[offset + channel],
    );
    if (same) continue;
    mask.set([255, 0, 0, 255], offset);
    changedPixels += 1;
  }
  return { changedPixels, mask: { ...candidate, pixels: mask } };
}

function chunk(type: string, data: Uint8Array) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const result = Buffer.alloc(body.length + 8);
  result.writeUInt32BE(data.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE(crc32(body), body.length + 4);
  return result;
}

/** Encode a picture as an 8-bit RGBA PNG. */
export function encodePng({ width, height, pixels }: Picture) {
  const rowBytes = width * 4;
  // Each PNG row starts with its filter type. Type 0 keeps the bytes as they are.
  const rows = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    rows.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // Bit depth 8, color type 6 (RGBA), then the default compression, filter, and interlace.
  header.set([8, 6, 0, 0, 0], 8);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(rows)),
      chunk("IEND", new Uint8Array()),
    ]),
  );
}
