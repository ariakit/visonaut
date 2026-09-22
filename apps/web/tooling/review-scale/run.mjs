import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureCounts } from "./fixtures.mjs";

export function summarize(values) {
  const sorted = [...values].sort((first, second) => first - second);
  if (!sorted.length) return null;
  return {
    n: sorted.length,
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
}

function sourceHash(file) {
  return createHash("sha256")
    .update(readFileSync(new URL(`../../src/${file}`, import.meta.url)))
    .digest("hex");
}

async function navigate(page, key, timeout) {
  let timer;
  try {
    return await Promise.race([
      page.evaluate((key) => window.scaleFixture.navigate(key), key),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Variant navigation timed out.")), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Inject the root workspace's declared Playwright browser type from its CLI.
export async function run(chromium) {
  const samples = Number(process.env.SAMPLES || 20);
  const warmups = Number(process.env.WARMUPS || 2);
  const timeout = Number(process.env.TIMEOUT || 120000);
  const counts = process.env.COUNTS ? process.env.COUNTS.split(",").map(Number) : captureCounts;
  if (!Number.isInteger(samples) || samples < 1 || !Number.isInteger(warmups) || warmups < 0) {
    throw new Error("SAMPLES must be positive and WARMUPS must be nonnegative integers.");
  }
  if (!counts.length || counts.some((count) => !captureCounts.includes(count))) {
    throw new Error(`COUNTS must select from ${captureCounts.join(",")}.`);
  }
  const origin = `http://127.0.0.1:${process.env.REVIEW_SCALE_PORT || 4181}`;
  const defaultOutput = fileURLToPath(
    new URL("../../../../artifacts/review-scale/", import.meta.url),
  );
  const output = resolve(process.env.REVIEW_SCALE_OUTPUT || defaultOutput);
  mkdirSync(output, { recursive: true });
  await using browser = await chromium.launch({ channel: "chrome", headless: true });
  const sourceFiles = [
    "review/review-workspace.tsx",
    "review/item-list.tsx",
    "review/use-evidence.ts",
    "components/screenshot-viewer.tsx",
    "review.css",
  ];
  const result = {
    measuredAt: new Date().toISOString(),
    environment: {
      os: platform(),
      osRelease: release(),
      architecture: arch(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
      node: process.version,
      chrome: browser.version(),
      headless: true,
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
      cpuThrottling: "none",
      networkThrottling: "none; localhost",
      reactBuild: "production",
      source: "apps/web/src/review/review-workspace.tsx",
      sourceSha256: sourceHash("review/review-workspace.tsx"),
      sourceFiles: Object.fromEntries(sourceFiles.map((file) => [file, sourceHash(file)])),
    },
    samplesPerSize: samples,
    excludedWarmupsPerSize: warmups,
    cases: [],
  };
  const write = () =>
    writeFileSync(resolve(output, "measurements.json"), `${JSON.stringify(result, null, 2)}\n`);

  for (const count of counts) {
    const record = { count, warmups: [], samples: [], navigation: [], errors: [] };
    result.cases.push(record);
    write();
    for (let index = -warmups; index < samples; index++) {
      await using context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => record.errors.push({ sample: index, error: String(error) }));
      try {
        await page.goto(`${origin}/?count=${count}`, { waitUntil: "domcontentloaded", timeout });
        await page.waitForFunction(() => window.scaleMetrics?.complete, {}, { timeout });
        const raw = await page.evaluate(() => structuredClone(window.scaleMetrics));
        const metric = {
          sample: index,
          captures: count,
          items: raw.items,
          domNodes: raw.domNodes,
          jsonBytes: raw.jsonBytes,
          documentToListMs: raw.listPaintOpportunity,
          documentToImageMs: raw.imagePaintOpportunity,
          fixtureStartToModelMs: raw.modelReady - raw.start,
          responseBodyAndParseMs: raw.modelReady - raw.headers,
          modelReadyToListMs: raw.listPaintOpportunity - raw.modelReady,
          renderToListCommitMs: raw.listCommit - raw.renderStart,
          renderToListPaintOpportunityMs: raw.listPaintOpportunity - raw.renderStart,
          renderToImageReadyCommitMs: raw.imageReadyCommit - raw.renderStart,
          renderToImagePaintOpportunityMs: raw.imagePaintOpportunity - raw.renderStart,
          longTasks: raw.longTasks,
        };
        if (index < 0) {
          record.warmups.push(metric);
        } else {
          record.samples.push(metric);
          await navigate(page, "ArrowRight", timeout);
          await navigate(page, "ArrowLeft", timeout);
          for (const key of ["ArrowRight", "ArrowLeft", "ArrowRight", "ArrowLeft"]) {
            record.navigation.push({ sample: index, ...(await navigate(page, key, timeout)) });
          }
        }
        if (index === samples - 1) {
          if (process.env.REVIEW_SCALE_SCREENSHOTS === "1") {
            await page.screenshot({ path: resolve(output, `${count}.png`) });
          }
          record.browserEnvironment = await page.evaluate(() => ({
            userAgent: navigator.userAgent,
            hardwareConcurrency: navigator.hardwareConcurrency,
            deviceMemory: navigator.deviceMemory,
            viewport: { width: innerWidth, height: innerHeight },
            dpr: devicePixelRatio,
            colorScheme: matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light",
          }));
        }
        console.log(
          JSON.stringify({
            count,
            sample: index,
            listMs: metric.renderToListPaintOpportunityMs,
            imageMs: metric.renderToImagePaintOpportunityMs,
          }),
        );
      } catch (error) {
        record.errors.push({ sample: index, timeoutMs: timeout, error: String(error) });
        console.error(JSON.stringify(record.errors.at(-1)));
      }
      write();
    }
    record.summary = {};
    for (const key of [
      "documentToListMs",
      "documentToImageMs",
      "fixtureStartToModelMs",
      "renderToListCommitMs",
      "renderToListPaintOpportunityMs",
      "renderToImageReadyCommitMs",
      "renderToImagePaintOpportunityMs",
    ]) {
      record.summary[key] = summarize(record.samples.map((sample) => sample[key]));
    }
    const next = record.navigation.filter((entry) => entry.key === "ArrowRight");
    record.summary.navigationReadyCommitMs = summarize(
      record.navigation.map((entry) => entry.readyCommitMs),
    );
    record.summary.navigationPaintOpportunityMs = summarize(
      record.navigation.map((entry) => entry.paintOpportunityMs),
    );
    record.summary.nextVariantReadyCommitMs = summarize(next.map((entry) => entry.readyCommitMs));
    record.summary.nextVariantPaintOpportunityMs = summarize(
      next.map((entry) => entry.paintOpportunityMs),
    );
    write();
  }
  if (result.cases.some((record) => record.errors.length)) {
    process.exitCode = 1;
  }
  console.log(`Saved ${resolve(output, "measurements.json")}`);
}
