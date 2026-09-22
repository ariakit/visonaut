import { globSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  compareImages,
  decodeImage,
  validateImage,
  type ComparisonPolicy,
  type Pixels,
} from "../src/index.ts";
import { nodeCodecs } from "../test/codecs.ts";

const corpus = process.argv[2];
if (!corpus) {
  throw new Error("Usage: node --experimental-strip-types scripts/study.ts /path/to/ariakit");
}
const paths = Array.from(globSync("app/src/**/__screenshots__/*.webp", { cwd: corpus })).sort();
const codecs = await nodeCodecs();
const policies: ComparisonPolicy[] = [
  { id: "visible-exact-v1", channelThreshold: 0, maxChangedPixels: 0, maxChangedRatio: 0 },
  { id: "study-one-level", channelThreshold: 1, maxChangedPixels: 0, maxChangedRatio: 0 },
  {
    id: "study-legacy-ratio",
    channelThreshold: 0,
    maxChangedPixels: Number.MAX_SAFE_INTEGER,
    maxChangedRatio: 0.0005,
  },
];
const outcomes: Record<string, Record<string, { total: number; missed: number }>> = {};
const dimensions: number[] = [];
const sizes: number[] = [];
const durations: number[] = [];
const corpusHash = createHash("sha256");
const start = performance.now();
const initialCpu = process.cpuUsage();
let profiled = 0;
let deterministic = 0;
let samples = 0;

function mutate(image: Pixels, kind: string): Pixels {
  const data = image.data.slice();
  const pixel = data.findIndex((value, index) => index % 4 === 3 && value === 255) - 3;
  if (pixel < 0) {
    throw new Error("Study requires an opaque pixel.");
  }
  if (kind === "one-level-defect") {
    data[pixel] = (data[pixel] ?? 0) === 255 ? 254 : (data[pixel] ?? 0) + 1;
  }
  if (kind === "one-pixel-defect") {
    for (let channel = 0; channel < 3; channel += 1) {
      data[pixel + channel] = (data[pixel + channel] ?? 0) > 127 ? 0 : 255;
    }
  }
  if (kind === "missing-stroke-defect") {
    const row = Math.min(image.height - 1, Math.floor(image.height / 2));
    for (let column = 0; column < Math.min(image.width, 16); column += 1) {
      const offset = (row * image.width + column) * 4;
      data[offset] = (data[offset] ?? 0) > 127 ? 0 : 255;
      data[offset + 3] = 255;
    }
  }
  if (kind === "alpha-defect") {
    data[pixel + 3] = 254;
  }
  if (kind === "synthetic-antialias-noise") {
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset + 3] !== 255) continue;
      const channel = data[offset] ?? 0;
      const next = data[offset + 4] ?? channel;
      if (Math.abs(channel - next) < 16) continue;
      data[offset] = channel === 255 ? 254 : channel + 1;
    }
  }
  return { ...image, data };
}

for (let index = 0; index < paths.length; index += 1) {
  const path = paths[index];
  if (!path) continue;
  const bytes = Uint8Array.from(readFileSync(resolve(corpus, path)));
  const started = performance.now();
  const validated = await validateImage(bytes);
  const image = await decodeImage(validated, codecs);
  durations.push(performance.now() - started);
  sizes.push(bytes.length);
  dimensions.push(image.width * image.height);
  corpusHash.update(validated.digest);
  if (validated.profile === "srgb-chromium-icc-v1") {
    profiled += 1;
  }
  if (index % Math.max(1, Math.floor(paths.length / 24)) !== 0) continue;
  samples += 1;
  const repeated = await decodeImage(validated, codecs);
  const strict = policies[0];
  if (!strict) {
    throw new Error("Missing study policy.");
  }
  if (compareImages(image, repeated, strict).outcome === "unchanged") {
    deterministic += 1;
  }
  for (const kind of [
    "one-level-defect",
    "one-pixel-defect",
    "missing-stroke-defect",
    "alpha-defect",
    "synthetic-antialias-noise",
  ]) {
    const candidate = mutate(image, kind);
    for (const policy of policies) {
      const counts = (outcomes[policy.id] ??= {});
      const count = (counts[kind] ??= { total: 0, missed: 0 });
      count.total += 1;
      if (compareImages(image, candidate, policy).outcome === "unchanged") {
        count.missed += 1;
      }
    }
  }
}

function describe(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    mean: values.reduce((left, right) => left + right, 0) / values.length,
    p95: sorted[Math.floor(sorted.length * 0.95)],
    maximum: sorted.at(-1),
  };
}

const cpu = process.cpuUsage(initialCpu);
const report = {
  date: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  files: paths.length,
  corpusDigest: corpusHash.digest("hex"),
  profiled,
  samples,
  encodedBytes: describe(sizes),
  pixels: describe(dimensions),
  decodeMilliseconds: describe(durations),
  elapsedMilliseconds: performance.now() - start,
  cpuMilliseconds: (cpu.user + cpu.system) / 1000,
  processMaximumResidentKilobytes: process.resourceUsage().maxRSS,
  wasmLinearMemoryBytes: codecs.wasmMemoryBytes?.(),
  deterministicRecomparisons: { passed: deterministic, total: samples },
  policies,
  outcomes,
  limitations: [
    "CPU and resident memory are Node measurements, not Cloudflare Worker measurements.",
    "Synthetic pixel mutations characterize policy sensitivity, not real browser clean-capture noise.",
    "Font/animation preparation and repeated clean browser captures require the Ariakit integration diagnostic.",
    "Existing files contain composite screenshots; 10,580 separate variant captures need separate workload evidence.",
  ],
};
mkdirSync(new URL("../evidence/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../evidence/corpus-study.json", import.meta.url),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
