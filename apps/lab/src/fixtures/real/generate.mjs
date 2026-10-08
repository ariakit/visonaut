#!/usr/bin/env node
// Builds the production-shaped fixture data of the lab.
//
// Usage, from the repository root:
//   node apps/lab/src/fixtures/real/generate.mjs --source <directory>
//   pnpm exec oxfmt apps/lab/src/fixtures/real
//
// The source is the data directory of the audit lane "gap-real-data". It has
// the census of the Ariakit consumer (`census/inventory.json`), six run
// answers in the compact wire format of `GET /api/runs/:id` with their image
// files (`data/api`, `data/images`, `data/pairs`).
//
// Outputs:
//   apps/lab/public/fixtures/**           the PNG files that the lab serves
//   apps/lab/src/fixtures/real/census.ts  the 626 screenshots and their images
//   apps/lab/src/fixtures/real/changes.ts the changed part of each run
//
// The wire answers have 5 MB each, and 99% of each one is the same unchanged
// inventory. The lab keeps the inventory one time and each run as a short list
// of changes. `apps/lab/src/fixtures/data/review-base.ts` builds the runs.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng, readPngSize, shrink } from "./png.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const labDirectory = join(here, "..", "..", "..");
const publicDirectory = join(labDirectory, "public", "fixtures");

const sourceFlag = process.argv.indexOf("--source");
const sourceDirectory = sourceFlag < 0 ? undefined : process.argv[sourceFlag + 1];
if (!sourceDirectory || !existsSync(join(sourceDirectory, "census", "inventory.json"))) {
  console.error("Pass --source <directory> with the gap-real-data audit directory.");
  process.exit(2);
}
const dataDirectory = join(sourceDirectory, "data");

// The longest side of a thumbnail in pixels.
const thumbnailLimit = 160;
// Changed areas that lie at most this many pixels apart become one region.
// With 8, the changed letters of one word are one region.
const regionGap = 8;
// The opacity of the current image under the mask in a diff preview.
const fadedOpacity = 0.18;

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// ---------------------------------------------------------------------------
// Image files
// ---------------------------------------------------------------------------

/** Each row is: path under `/fixtures/`, width, height. */
const images = [];
const imageIndexesByDigest = new Map();
/** Image index to its source file, for the images that a diff preview reads. */
const sourcesByIndex = new Map();
const sizes = new Map();

function writePublic(path, bytes) {
  const file = join(publicDirectory, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  const folder = path.split("/")[0];
  const size = sizes.get(folder) ?? { files: 0, bytes: 0 };
  size.files += 1;
  size.bytes += bytes.length;
  sizes.set(folder, size);
}

/** The path of a source file in the public folder of the lab. */
function publicPath(source, digest) {
  const parts = source.split("/");
  if (parts[0] === "images" && parts[1] === "masks") return `masks/${digest.slice(0, 16)}.png`;
  if (parts[0] === "pairs") {
    const [, sizeClass, file] = parts;
    if (file.startsWith("mask-")) return `masks/${digest.slice(0, 16)}.png`;
    if (file === "reference.png") return `baseline/probes/${sizeClass}.png`;
    return `current/probes/${sizeClass}.${file.replace("candidate-", "")}`;
  }
  const [, , set, folder, file] = parts;
  const root = set === "baseline" ? "baseline" : set === "changed" ? "current" : `current/${set}`;
  return `${root}/${folder === "_classes" ? "classes" : folder}/${file}`;
}

function decodeSource(source) {
  return decodePng(readFileSync(join(dataDirectory, source)));
}

/**
 * Copies one source image to the public folder and returns its index in
 * `images`. Files with equal bytes become one file, so the reference of a
 * pixel probe is the baseline file that it was copied from.
 */
function addImage(source) {
  let bytes = readFileSync(join(dataDirectory, source));
  // The audit made the one-pixel and four-pixel probes with an encoder that
  // writes files about two times larger than the screenshots that they copy.
  // The pixels stay the same here. Only the encoding changes.
  if (/^pairs\/[^/]+\/candidate-\dpx\.png$/.test(source)) {
    bytes = encodePng({ ...decodePng(bytes), alpha: false });
  }
  const digest = sha256(bytes);
  const known = imageIndexesByDigest.get(digest);
  if (known !== undefined) return known;
  const path = publicPath(source, digest);
  const { width, height } = readPngSize(bytes);
  writePublic(path, bytes);
  if (!path.startsWith("masks/")) {
    const thumbnail = shrink(decodeSource(source), thumbnailLimit);
    writePublic(`thumbnails/${path}`, encodePng({ ...thumbnail, alpha: false }));
  }
  const index = images.length;
  images.push([path, width, height]);
  imageIndexesByDigest.set(digest, index);
  sourcesByIndex.set(index, source);
  return index;
}

/**
 * Makes the current image of a size change and returns its index in `images`.
 * The audit data shows a size change with the capture of the other color
 * scheme, because that capture is 2 pixels taller. A real size change shows
 * the same picture at another size. So the image is the baseline with its
 * middle row repeated until it has the new height.
 */
function addTallerCopy(source, height) {
  const picture = decodeSource(source);
  const extra = height - picture.height;
  if (extra <= 0) throw new Error(`The size change of ${source} does not add rows.`);
  const rowBytes = picture.width * 4;
  const middle = Math.floor(picture.height / 2);
  const data = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = y <= middle ? y : Math.max(middle, y - extra);
    const row = picture.data.subarray(sourceRow * rowBytes, (sourceRow + 1) * rowBytes);
    data.set(row, y * rowBytes);
  }
  const taller = { width: picture.width, height, data };
  const bytes = encodePng({ ...taller, alpha: false });
  const digest = sha256(bytes);
  const known = imageIndexesByDigest.get(digest);
  if (known !== undefined) return known;
  const [, , , folder, file] = source.split("/");
  const path = `current/resized/${folder}/${file}`;
  writePublic(path, bytes);
  const thumbnail = shrink(taller, thumbnailLimit);
  writePublic(`thumbnails/${path}`, encodePng({ ...thumbnail, alpha: false }));
  const index = images.length;
  images.push([path, picture.width, height]);
  imageIndexesByDigest.set(digest, index);
  return index;
}

// ---------------------------------------------------------------------------
// Masks: changed regions and diff previews
// ---------------------------------------------------------------------------

/** Bounding boxes of the connected mask pixels, merged when they are close. */
function findRegions({ width, height, data }) {
  const seen = new Uint8Array(width * height);
  const boxes = [];
  let pixels = 0;
  for (let start = 0; start < width * height; start += 1) {
    if (seen[start]) continue;
    if (!data[start * 4 + 3]) continue;
    const stack = [start];
    seen[start] = 1;
    const box = { left: width, top: height, right: 0, bottom: 0 };
    while (stack.length) {
      const index = stack.pop();
      pixels += 1;
      const x = index % width;
      const y = (index - x) / width;
      box.left = Math.min(box.left, x);
      box.right = Math.max(box.right, x);
      box.top = Math.min(box.top, y);
      box.bottom = Math.max(box.bottom, y);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (seen[next]) continue;
          if (!data[next * 4 + 3]) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    boxes.push(box);
  }
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const first = boxes[i];
        const second = boxes[j];
        const gapX = Math.max(first.left - second.right, second.left - first.right) - 1;
        const gapY = Math.max(first.top - second.bottom, second.top - first.bottom) - 1;
        if (gapX > regionGap || gapY > regionGap) continue;
        first.left = Math.min(first.left, second.left);
        first.top = Math.min(first.top, second.top);
        first.right = Math.max(first.right, second.right);
        first.bottom = Math.max(first.bottom, second.bottom);
        boxes.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  boxes.sort((first, second) => first.top - second.top || first.left - second.left);
  const regions = boxes.flatMap((box) => [
    box.left,
    box.top,
    box.right - box.left + 1,
    box.bottom - box.top + 1,
  ]);
  return { pixels, regions };
}

/** Mask image index to its regions as a flat list of x, y, width, height. */
const maskRegions = new Map();
const maskPixels = new Map();
const previewIndexes = new Map();

function addMask(source) {
  const index = addImage(source);
  if (!maskRegions.has(index)) {
    const { pixels, regions } = findRegions(decodeSource(source));
    maskRegions.set(index, regions);
    maskPixels.set(index, pixels);
  }
  return index;
}

/** Writes the mask over a faded copy of the current image, as one picture. */
function addPreview(candidateIndex, maskIndex) {
  const key = `${candidateIndex}:${maskIndex}`;
  const known = previewIndexes.get(key);
  if (known !== undefined) return known;
  const candidate = decodeSource(sourcesByIndex.get(candidateIndex));
  const mask = decodeSource(sourcesByIndex.get(maskIndex));
  const data = new Uint8Array(candidate.data.length);
  for (let i = 0; i < candidate.width * candidate.height; i += 1) {
    const offset = i * 4;
    const marked = mask.data[offset + 3] > 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const faded = 255 + (candidate.data[offset + channel] - 255) * fadedOpacity;
      data[offset + channel] = marked ? mask.data[offset + channel] : Math.round(faded);
    }
    data[offset + 3] = 255;
  }
  const { width, height } = candidate;
  const bytes = encodePng({ width, height, data, alpha: false });
  const path = `previews/${sha256(bytes).slice(0, 16)}.png`;
  writePublic(path, bytes);
  const index = images.length;
  images.push([path, width, height]);
  previewIndexes.set(key, index);
  return index;
}

// ---------------------------------------------------------------------------
// Census
// ---------------------------------------------------------------------------

rmSync(publicDirectory, { recursive: true, force: true });

const inventory = readJson(join(sourceDirectory, "census", "inventory.json")).items;
const inventoryIndexes = new Map(inventory.map((item, index) => [item.key, index]));

function readRun(scenario) {
  const run = readJson(join(dataDirectory, "api", `run.${scenario}.json`));
  const files = readJson(join(dataDirectory, "api", `run.${scenario}.images.json`));
  const fileOf = (index) => {
    if (index == null) return null;
    const image = run.images[index];
    const file = files[image.id];
    if (!file) throw new Error(`No file for image ${image.id} in ${scenario}.`);
    return file;
  };
  return { run, fileOf };
}

/** Each row is: key, framework, browser, viewport, style, scheme, contrast, forced colors. */
const variantKeys = [];
const variantKeyIndexes = new Map();
/** Each row is: variant key indexes, then the image slot of each variant. */
const shapes = [];
const shapeIndexes = new Map();

function variantKeyIndex(variant) {
  let index = variantKeyIndexes.get(variant.key);
  if (index === undefined) {
    index = variantKeys.length;
    const { viewport, style } = variant.dimensions;
    variantKeys.push([
      variant.key,
      variant.framework,
      variant.browser,
      viewport,
      style,
      variant.colorScheme,
      variant.contrast,
      variant.forcedColors,
    ]);
    variantKeyIndexes.set(variant.key, index);
  }
  return index;
}

/**
 * One item row: key, shape, then the image indexes of the item. A shape is
 * the list of variant keys with the image slot of each variant, so the 506
 * items with the common six variants share one shape.
 */
function buildItemRow(censusItem, key, imageOfVariant) {
  const itemImages = [];
  const slots = censusItem.variants.map((_, position) => {
    const image = imageOfVariant(position);
    let slot = itemImages.indexOf(image);
    if (slot < 0) {
      slot = itemImages.length;
      itemImages.push(image);
    }
    return slot;
  });
  const keys = censusItem.variants.map(variantKeyIndex);
  const signature = JSON.stringify([keys, slots]);
  let shape = shapeIndexes.get(signature);
  if (shape === undefined) {
    shape = shapes.length;
    shapes.push([keys, slots]);
    shapeIndexes.set(signature, shape);
  }
  return [key, shape, ...itemImages];
}

function titleCase(leaf) {
  const words = leaf.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const baseline = readRun("archived-all-accepted");
const items = [];
/** Item index to the baseline image index of each variant. */
const baselineImages = [];
/** The real card titles that the key does not give back. */
const titles = {};
for (const [index, censusItem] of inventory.entries()) {
  const wireItem = baseline.run.items[index];
  if (wireItem?.key !== censusItem.key) throw new Error(`Item order differs at ${index}.`);
  const variantImages = wireItem.variants.map((variant, position) => {
    if (variant.key !== censusItem.variants[position]?.key) {
      throw new Error(`Variant order differs in ${censusItem.key}.`);
    }
    if (variant.kind !== "unchanged" || variant.reference !== variant.candidate) {
      throw new Error(`The baseline run has a change in ${censusItem.key}.`);
    }
    return addImage(baseline.fileOf(variant.reference));
  });
  baselineImages.push(variantImages);
  items.push(buildItemRow(censusItem, censusItem.key, (position) => variantImages[position]));
  const leaf = censusItem.key.split("/").at(-1);
  if (censusItem.title && censusItem.title !== titleCase(leaf)) {
    titles[index] = censusItem.title;
  }
}

// ---------------------------------------------------------------------------
// Change sets
// ---------------------------------------------------------------------------

const kindCodes = { changed: 0, added: 1, removed: 2, omitted: 3 };
const verdictCodes = { approved: 1, rejected: 2 };

/**
 * Reads one run answer and keeps only what differs from the baseline run.
 * `templates` names the census item that an extra item of the run copies.
 */
function buildChangeSet(scenario, templates = {}) {
  const { run, fileOf } = readRun(scenario);
  const extraItems = [];
  const changes = [];
  const counts = { changed: 0, added: 0, removed: 0, omitted: 0, sizeChanged: 0 };
  for (const wireItem of run.items) {
    let itemIndex = inventoryIndexes.get(wireItem.key);
    let references = itemIndex === undefined ? undefined : baselineImages[itemIndex];
    if (itemIndex === undefined) {
      const template = inventory[inventoryIndexes.get(templates[wireItem.key])];
      if (!template) throw new Error(`No template for the extra item ${wireItem.key}.`);
      const sameKeys = template.variants.every(
        (entry, position) => entry.key === wireItem.variants[position]?.key,
      );
      if (!sameKeys) throw new Error(`The template of ${wireItem.key} has other variants.`);
      // An extra item has no baseline in the census. Its image slots hold the
      // reference of each variant, or the new image of an added variant.
      references = wireItem.variants.map((variant) =>
        addImage(fileOf(variant.reference ?? variant.candidate)),
      );
      const own = references;
      itemIndex = inventory.length + extraItems.length;
      extraItems.push(buildItemRow(template, wireItem.key, (position) => own[position]));
    }
    for (const [position, variant] of wireItem.variants.entries()) {
      const unchanged = variant.kind === "unchanged";
      if (unchanged && !variant.candidateOmitted) {
        if (addImage(fileOf(variant.reference)) !== references[position]) {
          throw new Error(`The baseline of ${wireItem.key} differs in ${scenario}.`);
        }
        continue;
      }
      const kind = unchanged ? "omitted" : variant.kind;
      const reference = variant.reference == null ? null : addImage(fileOf(variant.reference));
      if (reference !== null && reference !== references[position]) {
        throw new Error(`The reference of ${wireItem.key} differs in ${scenario}.`);
      }
      // A changed variant without a mask is a size change.
      const sizeChange = kind === "changed" && variant.diff == null && variant.reference != null;
      let candidate = -1;
      if (sizeChange) {
        const from = run.images[variant.reference];
        const to = run.images[variant.candidate];
        if (from.width !== to.width) {
          throw new Error(`The size change of ${wireItem.key} also changes the width.`);
        }
        candidate = addTallerCopy(fileOf(variant.reference), to.height);
      } else if (variant.candidate != null) {
        candidate = addImage(fileOf(variant.candidate));
      }
      const mask = variant.diff == null ? -1 : addMask(fileOf(variant.diff));
      if (mask >= 0 && maskPixels.get(mask) !== variant.changedPixels) {
        throw new Error(`The mask of ${wireItem.key} does not match its pixel count.`);
      }
      const preview = mask < 0 ? -1 : addPreview(candidate, mask);
      const human = variant.source === "human" ? verdictCodes[variant.verdict] : 0;
      counts[kind] += 1;
      if (kind === "changed" && mask < 0) {
        counts.sizeChanged += 1;
      }
      changes.push([
        itemIndex,
        position,
        kindCodes[kind],
        candidate,
        mask,
        preview,
        variant.changedPixels ?? 0,
        human,
      ]);
    }
  }
  return {
    source: scenario,
    run: {
      id: run.run.id,
      comparisonId: run.comparisonId,
      testedSha: run.run.testedSha,
    },
    counts,
    extraItems,
    changes,
  };
}

const changeSets = {
  typical: buildChangeSet("typical-pr"),
  token: buildChangeSet("token-change"),
  browser: buildChangeSet("safari-regression"),
  mixed: buildChangeSet("mixed-kinds", {
    "ariakit-ui-button/page/loading": "ariakit-ui-button/page/danger",
  }),
  probes: buildChangeSet("pixel-probes", {
    "lab-only/page-narrow-560x900": "ariakit-ui-shell/docs-site",
    "lab-only/mobile-390x844": "ariakit-ui-shell/docs-site",
    "lab-only/full-page-1280x1640": "ariakit-ui-shell/docs-site",
  }),
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const banner = `// GENERATED by apps/lab/src/fixtures/real/generate.mjs. Do not edit.\n`;

function rows(list) {
  return `[\n${list.map((row) => `  ${JSON.stringify(row)},`).join("\n")}\n]`;
}

const census = `${banner}
import type { CensusImage, CensusItem, CensusShape, CensusVariantKey } from "./types.ts";

/** Each row is: path under \`/fixtures/\`, width, height. */
export const images: CensusImage[] = ${rows(images)};

/** Each row is: key, framework, browser, viewport, style, scheme, contrast, forced colors. */
export const variantKeys: CensusVariantKey[] = ${rows(variantKeys)};

/** Each row is: variant key indexes, then the image slot of each variant. */
export const shapes: CensusShape[] = ${rows(shapes)};

/** Each row is: key, shape index, then the image indexes of the item. */
export const items: CensusItem[] = ${rows(items)};

/** Item index to the card title, where the key does not give the title back. */
export const titles: Record<number, string> = {
${Object.entries(titles)
  .map(([index, title]) => `  ${index}: ${JSON.stringify(title)},`)
  .join("\n")}
};

/** The \`run.<id>\` identifiers of the baseline run of the audit data. */
export const baselineRun = ${JSON.stringify(
  {
    id: baseline.run.run.id,
    comparisonId: baseline.run.comparisonId,
    testedSha: baseline.run.run.testedSha,
    promotionId: baseline.run.promotionId,
    baselineRevision: baseline.run.baselineRevision,
  },
  null,
  2,
)};
`;

const sets = Object.entries(changeSets).map(([name, set]) => {
  return `  ${name}: {
    source: ${JSON.stringify(set.source)},
    run: ${JSON.stringify(set.run)},
    extraItems: ${rows(set.extraItems).replaceAll("\n", "\n    ")},
    changes: ${rows(set.changes).replaceAll("\n", "\n    ")},
  },`;
});

const regionEntries = [...maskRegions]
  .sort(([first], [second]) => first - second)
  .map(([index, regions]) => `  ${index}: ${JSON.stringify(regions)},`);

const changesModule = `${banner}
import type { ChangeSet, ChangeSetName } from "./types.ts";

/**
 * The changed part of each run. Each change row is: item index, variant
 * position, kind (0 changed, 1 added, 2 removed, 3 unchanged without an
 * uploaded image), current image, mask image, diff preview image, changed
 * pixels, human verdict (0 none, 1 approved, 2 rejected). An image is an index
 * of \`images\`, or -1. An item index past the census is an extra item.
 */
export const changeSets: Record<ChangeSetName, ChangeSet> = {
${sets.join("\n")}
};

/**
 * Mask image index to its changed regions, as a flat list of x, y, width, and
 * height. A region is the bounding box of connected mask pixels. Boxes that
 * lie at most ${regionGap} pixels apart are one region.
 */
export const maskRegions: Record<number, number[]> = {
${regionEntries.join("\n")}
};
`;

writeFileSync(join(here, "census.ts"), census);
writeFileSync(join(here, "changes.ts"), changesModule);

let totalBytes = 0;
let totalFiles = 0;
for (const [folder, size] of [...sizes].sort()) {
  totalBytes += size.bytes;
  totalFiles += size.files;
  console.log(`${folder}: ${size.files} files, ${(size.bytes / 1024 / 1024).toFixed(2)} MB`);
}
console.log(`public/fixtures: ${totalFiles} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(
  `census: ${items.length} items, ${variantKeys.length} variant keys, ${shapes.length} shapes, ${images.length} images, ${Object.keys(titles).length} titles`,
);
for (const [name, set] of Object.entries(changeSets)) {
  console.log(
    `${name}: ${set.changes.length} changes ${JSON.stringify(set.counts)}, ${set.extraItems.length} extra items`,
  );
}
const regionCounts = [...maskRegions.values()].map((regions) => regions.length / 4);
console.log(
  `masks: ${maskRegions.size}, regions for each mask: minimum ${Math.min(...regionCounts)}, maximum ${Math.max(...regionCounts)}`,
);
