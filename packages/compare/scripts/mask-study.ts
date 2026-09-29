import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  compareImages,
  imageLimits,
  selectedComparisonPolicy,
  type ComparisonPolicy,
  type ComparisonResult,
  type Pixels,
} from "../src/index.ts";

interface StudyCase {
  name: string;
  reference: Pixels;
  candidate: Pixels;
  policy: ComparisonPolicy;
}

const baselinePath = process.argv[2];
const outputPath = process.argv[3];
if (!baselinePath || !outputPath) {
  throw new Error("Provide a prior comparator module and an output JSON path.");
}
const baseline = await import(pathToFileURL(baselinePath).href);
if (typeof baseline.compareImages !== "function") {
  throw new Error("The baseline module must export compareImages.");
}
const reference = {
  width: 1000,
  height: imageLimits.maxPixels / 1000,
  data: new Uint8ClampedArray(imageLimits.maxPixels * 4),
};
reference.data.fill(255);
const changed = (pixels: number) => {
  const data = reference.data.slice();
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    data[pixel * 4] = 0;
  }
  return { ...reference, data };
};
const cases: StudyCase[] = [
  { name: "equal", reference, candidate: changed(0), policy: selectedComparisonPolicy },
  { name: "tolerated", reference, candidate: changed(100), policy: selectedComparisonPolicy },
  { name: "sparse-change", reference, candidate: changed(1051), policy: selectedComparisonPolicy },
  {
    name: "dense-change",
    reference,
    candidate: changed(imageLimits.maxPixels),
    policy: selectedComparisonPolicy,
  },
  {
    name: "dimension-change",
    reference,
    candidate: { ...changed(0), width: 1050, height: 2000 },
    policy: selectedComparisonPolicy,
  },
];

function measure(compare: typeof compareImages, sample: StudyCase) {
  for (let iteration = 0; iteration < 5; iteration += 1) {
    compare(sample.reference, sample.candidate, sample.policy);
  }
  const cpuMilliseconds: number[] = [];
  const wallMilliseconds: number[] = [];
  let maskBytes = 0;
  for (let iteration = 0; iteration < 21; iteration += 1) {
    globalThis.gc?.();
    const cpu = process.cpuUsage();
    const start = performance.now();
    const result = compare(sample.reference, sample.candidate, sample.policy);
    const elapsed = process.cpuUsage(cpu);
    wallMilliseconds.push(performance.now() - start);
    cpuMilliseconds.push((elapsed.user + elapsed.system) / 1000);
    maskBytes = result.mask?.data.byteLength ?? 0;
  }
  const median = (values: number[]) => values.toSorted((left, right) => left - right)[10];
  return {
    medianCpuMilliseconds: median(cpuMilliseconds),
    medianWallMilliseconds: median(wallMilliseconds),
    returnedMaskBytes: maskBytes,
  };
}

function maskDigest(result: ComparisonResult) {
  if (!result.mask) return null;
  return createHash("sha256").update(result.mask.data).digest("hex");
}

const results = cases.map((sample) => {
  const before = baseline.compareImages(sample.reference, sample.candidate, sample.policy);
  const after = compareImages(sample.reference, sample.candidate, sample.policy);
  const { mask: beforeMask, ...beforeSummary } = before;
  const { mask: afterMask, ...afterSummary } = after;
  assert.deepEqual(afterSummary, beforeSummary);
  if (after.outcome === "changed") {
    assert.deepEqual(afterMask?.data, beforeMask?.data);
  } else {
    assert.equal(afterMask, null);
  }
  return {
    name: sample.name,
    pixels: sample.candidate.width * sample.candidate.height,
    outcome: after.outcome,
    changedPixels: after.changedPixels,
    changedMaskSha256: after.outcome === "changed" ? maskDigest(after) : null,
    before: measure(baseline.compareImages, sample),
    after: measure(compareImages, sample),
  };
});
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      date: new Date().toISOString(),
      baselineCommit: "7e23173d11b1081f55021ef498e4c5c6d6a08131",
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      samples: 21,
      warmupIterations: 5,
      results,
      scope:
        "Local pure RGBA comparison, excluding decode, PNG encode, R2 and D1. Returned mask bytes measure this explicit allocation, not peak process or Worker memory. Local CPU is not hosted CPU or throughput evidence.",
    },
    null,
    2,
  )}\n`,
);
