// A small PNG codec for the fixture generator. It needs no dependency. It reads
// non-interlaced images with 8 bits for each channel, which covers the Chrome
// screenshots and the pixelmatch masks of the audit data.

import { crc32, deflateSync, inflateSync } from "node:zlib";

const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// PNG color type to the number of channels in one pixel.
const channelCounts = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceAbove = Math.abs(estimate - above);
  const distanceUpperLeft = Math.abs(estimate - upperLeft);
  if (distanceLeft <= distanceAbove && distanceLeft <= distanceUpperLeft) return left;
  if (distanceAbove <= distanceUpperLeft) return above;
  return upperLeft;
}

/** Reads the width and the height from the header of a PNG file. */
export function readPngSize(bytes) {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Decodes a PNG file to RGBA pixels. */
export function decodePng(bytes) {
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error("Not a PNG file.");
  let offset = 8;
  let header;
  let palette;
  let transparency;
  const chunks = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    } else if (type === "PLTE") {
      palette = body;
    } else if (type === "tRNS") {
      transparency = body;
    } else if (type === "IDAT") {
      chunks.push(body);
    }
    offset += length + 12;
  }
  if (!header) throw new Error("The PNG file has no header.");
  const { width, height, depth, colorType, interlace } = header;
  const channels = channelCounts[colorType];
  if (depth !== 8 || interlace !== 0 || !channels) {
    throw new Error(`Unsupported PNG format: depth ${depth}, color type ${colorType}.`);
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const target = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[target + x - channels] : 0;
      const above = y > 0 ? pixels[target + x - stride] : 0;
      const upperLeft = x >= channels && y > 0 ? pixels[target + x - stride - channels] : 0;
      let value = raw[source + x];
      if (filter === 1) {
        value += left;
      } else if (filter === 2) {
        value += above;
      } else if (filter === 3) {
        value += (left + above) >> 1;
      } else if (filter === 4) {
        value += paeth(left, above, upperLeft);
      }
      pixels[target + x] = value & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const source = i * channels;
    const target = i * 4;
    if (colorType === 3) {
      const index = pixels[source];
      data[target] = palette[index * 3];
      data[target + 1] = palette[index * 3 + 1];
      data[target + 2] = palette[index * 3 + 2];
      data[target + 3] = transparency?.[index] ?? 255;
      continue;
    }
    const gray = colorType === 0 || colorType === 4;
    data[target] = pixels[source];
    data[target + 1] = gray ? pixels[source] : pixels[source + 1];
    data[target + 2] = gray ? pixels[source] : pixels[source + 2];
    data[target + 3] =
      colorType === 6 ? pixels[source + 3] : colorType === 4 ? pixels[source + 1] : 255;
  }
  return { width, height, data };
}

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

/**
 * Encodes RGBA pixels as a PNG file. With `alpha: false` the file has no alpha
 * channel. Each row takes the filter with the smallest sum of absolute values,
 * which is the usual way to help the compression.
 */
export function encodePng({ width, height, data, alpha = true }) {
  const channels = alpha ? 4 : 3;
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let i = 0; i < width * height; i += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      pixels[i * channels + channel] = data[i * 4 + channel];
    }
  }
  const raw = Buffer.alloc((stride + 1) * height);
  const candidates = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    const sums = [0, 0, 0, 0, 0];
    for (let x = 0; x < stride; x += 1) {
      const value = pixels[row + x];
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const above = y > 0 ? pixels[row + x - stride] : 0;
      const upperLeft = x >= channels && y > 0 ? pixels[row + x - stride - channels] : 0;
      const filtered = [
        value,
        value - left,
        value - above,
        value - ((left + above) >> 1),
        value - paeth(left, above, upperLeft),
      ];
      for (let filter = 0; filter < 5; filter += 1) {
        const byte = filtered[filter] & 0xff;
        candidates[filter][x] = byte;
        sums[filter] += byte < 128 ? byte : 256 - byte;
      }
    }
    const best = sums.indexOf(Math.min(...sums));
    raw[y * (stride + 1)] = best;
    raw.set(candidates[best], y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = alpha ? 6 : 2;
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Scales an image down with a box filter so that no side exceeds `limit`. */
export function shrink({ width, height, data }, limit) {
  const scale = Math.min(1, limit / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const result = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const top = Math.floor((y * height) / targetHeight);
    const bottom = Math.max(top + 1, Math.floor(((y + 1) * height) / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const left = Math.floor((x * width) / targetWidth);
      const right = Math.max(left + 1, Math.floor(((x + 1) * width) / targetWidth));
      const sums = [0, 0, 0, 0];
      for (let sourceY = top; sourceY < bottom; sourceY += 1) {
        for (let sourceX = left; sourceX < right; sourceX += 1) {
          const offset = (sourceY * width + sourceX) * 4;
          for (let channel = 0; channel < 4; channel += 1) {
            sums[channel] += data[offset + channel];
          }
        }
      }
      const count = (bottom - top) * (right - left);
      for (let channel = 0; channel < 4; channel += 1) {
        result[(y * targetWidth + x) * 4 + channel] = Math.round(sums[channel] / count);
      }
    }
  }
  return { width: targetWidth, height: targetHeight, data: result };
}
