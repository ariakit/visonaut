import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "@playwright/test";
import { compareImages, decodeImage, validateImage } from "./packages/compare/src/index.ts";
import { nodeCodecs } from "./packages/compare/test/codecs.ts";
import { parseManifest } from "./packages/protocol/dist/index.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const cli = require.resolve("@playwright/test/cli");
const codecs = await nodeCodecs();
const strict = {
  id: "visible-exact-v1",
  channelThreshold: 0,
  maxChangedPixels: 0,
  maxChangedRatio: 0,
};
const results = {
  createdAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    playwright: require("@playwright/test/package.json").version,
  },
  policy: strict,
  fontSha256: hash(await readFile("/System/Library/Fonts/Supplemental/Arial.ttf")),
  browsers: [],
  limitations: [
    "Local synthetic macOS browser captures, not Ariakit's full matrix or hosted GitHub runner images.",
    "Clean fixtures exercise animation disabling, antialias text, and transparency; the delayed-font fixture uses the local Arial font and an intercepted request.",
    "Negative stability fixture changes real rendered pixels before each native screenshot; it is a controlled test, not evidence of naturally occurring noise.",
    "No Cloudflare, GitHub, npm, or other external writes. No peak Worker memory or Container measurements.",
  ],
};

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function runFixture(browser, scenario, repetition = 0) {
  const name = `${browser}-${scenario}-${repetition}`;
  const output = path.join(directory, "results", name);
  await mkdir(output, { recursive: true });
  const config = {
    forbidOnly: true,
    testDir: path.join(directory, "fixtures"),
    testMatch: "capture.spec.ts",
    retries: ["recovered", "exhausted"].includes(scenario) ? 1 : 0,
    workers: 1,
    timeout: 15000,
    outputDir: path.join(output, "attachments"),
    metadata: {
      ariviso: {
        profile: {
          osImageDigest: hash(Buffer.from(`${os.release()}:${process.arch}`)),
          fontsDigest: results.fontSha256,
          comparisonPolicyDigest: hash(Buffer.from(JSON.stringify(strict))),
          comparisonEngineVersion: "rgba-visible-1",
        },
      },
    },
    use: {
      browserName: browser,
      viewport: { width: 640, height: 360 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      colorScheme: "light",
      locale: "en-US",
      timezoneId: "UTC",
    },
    reporter: [
      ["json", { outputFile: path.join(output, "playwright.json") }],
      [
        path.join(directory, "packages/playwright/dist/reporter.js"),
        {
          outputFile: path.join(output, "manifest.json"),
          run: {
            repository: "ariakit/ariakit",
            repositoryId: "123",
            workflowRunId: "456",
            workflowAttempt: 1,
            testedSha: "d".repeat(40),
            planDigest: "e".repeat(64),
          },
          shard: { key: `${browser}-1`, jobId: "789", sourceAttempt: 1 },
        },
      ],
    ],
  };
  const configFile = path.join(output, "playwright.config.mjs");
  await writeFile(configFile, `export default ${JSON.stringify(config)};\n`);
  const started = performance.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "test", "--config", configFile], {
      cwd: directory,
      env: {
        ...process.env,
        CI: "true",
        VISUAL_TEST: "true",
        E01_BROWSER: browser,
        E01_SCENARIO: scenario,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, output }));
  });
  await writeFile(path.join(output, "process.log"), result.output);
  let manifest;
  try {
    manifest = parseManifest(
      JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8")),
    );
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  const record = {
    scenario,
    repetition,
    exitCode: result.code,
    elapsedMs: performance.now() - started,
    manifestEmitted: !!manifest,
    manifestSha256: manifest ? hash(await readFile(path.join(output, "manifest.json"))) : null,
    captures: [],
  };
  assert.equal(
    result.code,
    ["clean", "recovered"].includes(scenario) ? 0 : 1,
    `${name}: ${result.output}`,
  );
  if (!manifest) {
    assert.ok(!["clean", "recovered"].includes(scenario), name);
    const report = JSON.parse(await readFile(path.join(output, "playwright.json"), "utf8"));
    record.stats = report.stats;
    return record;
  }
  assert.ok(
    ["clean", "recovered"].includes(scenario),
    `${name} unexpectedly emitted a success manifest`,
  );
  assert.equal(manifest.captures.length, scenario === "clean" ? 11 : 5);
  for (const capture of manifest.captures) {
    const bytes = Uint8Array.from(await readFile(path.join(output, capture.image.path)));
    assert.equal(hash(bytes), capture.image.digest);
    const image = await decodeImage(await validateImage(bytes), codecs);
    if (scenario === "recovered") {
      assert.equal(capture.testRetry, 1);
      assert.deepEqual(Array.from(image.data.subarray(0, 4)), [0, 255, 0, 255]);
    }
    record.captures.push({
      item: capture.itemKey,
      retry: capture.testRetry,
      width: image.width,
      height: image.height,
      originalSha256: hash(bytes),
      decodedSha256: hash(image.data),
      imagePath: path.relative(directory, path.join(output, capture.image.path)),
    });
  }
  return record;
}

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  const entry = {
    name,
    version: browser.version(),
    cases: [],
    cleanComparisons: 0,
    cleanChanges: 0,
    deterministicComparisons: 0,
  };
  await browser.close();
  for (let repeat = 0; repeat < 3; repeat += 1) {
    entry.cases.push(await runFixture(name, "clean", repeat));
    process.stdout.write(`${name} clean ${repeat} passed\n`);
  }
  for (const scenario of ["recovered", "exhausted", "preparation", "unstable"]) {
    entry.cases.push(await runFixture(name, scenario));
    process.stdout.write(`${name} ${scenario} passed\n`);
  }
  const cleanCaptures = entry.cases
    .filter((item) => item.scenario === "clean")
    .flatMap((item) => item.captures)
    .filter((item) => item.item.startsWith("clean/"));
  const reference = await decodeImage(
    await validateImage(
      Uint8Array.from(await readFile(path.join(directory, cleanCaptures[0].imagePath))),
    ),
    codecs,
  );
  for (const capture of cleanCaptures.slice(1)) {
    const image = await decodeImage(
      await validateImage(Uint8Array.from(await readFile(path.join(directory, capture.imagePath)))),
      codecs,
    );
    const compared = compareImages(reference, image, strict);
    entry.cleanComparisons += 1;
    entry.cleanChanges += Number(compared.outcome === "changed");
    assert.deepEqual(compareImages(reference, image, strict), compared);
    entry.deterministicComparisons += 1;
    assert.equal(compared.outcome, "unchanged");
  }
  results.browsers.push(entry);
  await writeFile(
    path.join(directory, "results/summary.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
}
process.stdout.write("All browser evidence checks passed.\n");
