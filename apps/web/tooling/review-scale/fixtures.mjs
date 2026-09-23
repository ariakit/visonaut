import { deflateSync } from "node:zlib";

export const captureCounts = [3582, 10580, 35820];

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function pngChunk(kind, data) {
  const bytes = Buffer.concat([Buffer.from(kind), data]);
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum = crcTable[(checksum ^ byte) & 255] ^ (checksum >>> 8);
  }
  const length = Buffer.alloc(4);
  const trailer = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  trailer.writeUInt32BE((checksum ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, bytes, trailer]);
}

// Generate the same simple UI-like pixels used in the recorded run.
function screenshotPng(width, height, role) {
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let color = [248, 249, 251];
      if (x < width * 0.18) {
        color = [230, 234, 241];
      }
      if (y < height * 0.1) {
        color = [37, 47, 65];
      }
      if (x > width * 0.26 && x < width * 0.86 && y > height * 0.25 && y < height * 0.78) {
        color = [255, 255, 255];
      }
      if (
        x > width * 0.31 &&
        x < width * 0.77 &&
        y > height * 0.34 &&
        y < height * 0.56 &&
        y % 37 < 5
      ) {
        color = [176, 185, 201];
      }
      if (x > width * 0.64 && x < width * 0.79 && y > height * 0.65 && y < height * 0.72) {
        color = [role === "reference" ? 75 : 90, 92, 220];
      }
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function createImages() {
  return new Map([
    ["candidate", screenshotPng(1280, 720, "candidate")],
    ["reference", screenshotPng(1280, 720, "reference")],
    ["diff", screenshotPng(1280, 720, "diff")],
    ["thumbnail", screenshotPng(160, 90, "candidate")],
  ]);
}

function image(id, role) {
  return {
    id: `${id}-${role}`,
    digest: `${id}-${role}-synthetic-digest`,
    url: `/media/${id}/${role}.png`,
    width: 1280,
    height: 720,
  };
}

export function createModel(count) {
  const groups = [
    "dialog/open",
    "menu/expanded",
    "popover/anchor",
    "combobox/filter",
    "select/option",
    "tooltip/hover",
  ];
  const browsers = ["Chromium", "Firefox", "WebKit"];
  const items = [];
  for (let offset = 0; offset < count; offset += 6) {
    const groupIndex = Math.floor(offset / 6);
    const group = groups[groupIndex % groups.length];
    if (!group) continue;
    const item = {
      key: `${group}-${groupIndex}`,
      name: `${group.replace("/", " / ")} ${groupIndex + 1}`,
      variants: [],
    };
    for (let slot = 0; slot < 6 && offset + slot < count; slot++) {
      const id = `capture-${offset + slot}`;
      const browser = browsers[Math.floor(slot / 2)];
      if (!browser) continue;
      const theme = slot % 2 ? "Dark" : "Light";
      item.variants.push({
        id,
        key: `${browser}-${theme}`,
        label: `React · ${browser} · ${theme} · 1280 × 720`,
        kind: "changed",
        revision: 0,
        verdict: null,
        source: null,
        reference: image(id, "reference"),
        candidate: image(id, "candidate"),
        diff: image(id, "diff"),
        thumbnail: `/media/${id}/thumbnail.png`,
        changedPixels: 120,
        ratio: 0.00013,
        engine: "rgba-v1",
        codec: "png-v1",
        policy: "synthetic-scale-policy",
        threshold: "0.0005",
        referenceProfile: "desktop-1280x720",
        candidateProfile: "desktop-1280x720",
      });
    }
    items.push(item);
  }
  return {
    run: {
      id: `synthetic-scale-${count}`,
      kind: "pull_request",
      testedSha: "0000000000000000000000000000000000000000",
      attempt: 1,
      title: `Synthetic ${count.toLocaleString("en-US")} capture review`,
      status: "needs-review",
    },
    comparisonId: `synthetic-comparison-${count}`,
    comparisonRevision: 1,
    reviewReady: true,
    baselineRevision: 1,
    promotionId: null,
    items,
  };
}
