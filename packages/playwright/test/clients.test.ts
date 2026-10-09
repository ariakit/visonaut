import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { FIXED_DIGEST, digestJson, parseManifest, sha256 } from "@visonaut/protocol";
import { zip } from "../../cli/test/archive-fixture.js";
import { extractCaptureArchive } from "../../cli/src/artifact-archive.js";
import type { ComparisonOptions } from "../src/index.js";

const require = createRequire(import.meta.url);
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const runtime = process.execPath;
const playwrightCli = require.resolve("@playwright/test/cli");
const adapter = "@visonaut/playwright";
const reporter = "@visonaut/playwright/reporter";
const metadata = {
  visonaut: {
    comparisonDefaults: {},
    profile: {
      osImageDigest: "a".repeat(64),
      fontsDigest: "b".repeat(64),
    },
  },
};

interface FixtureOptions {
  retries?: number;
  discovery?: boolean;
  /** The options of an adapter before this release, which a caller might still pass. */
  retiredDigests?: boolean;
  extraArgs?: string[];
  browserName?: "chromium" | "webkit";
  timeout?: number;
  comparisonDefaults?: ComparisonOptions;
  screenshotDefaults?: ComparisonOptions;
}

async function runFixture(source: string, options: FixtureOptions = {}) {
  const {
    retries = 0,
    discovery = false,
    retiredDigests = false,
    extraArgs = [],
    browserName = "chromium",
    timeout = 10000,
  } = options;
  const directory = await mkdtemp(path.join(packageDirectory, ".fixture-"));
  const modules = path.join(directory, "node_modules");
  await mkdir(path.join(modules, "@visonaut"), { recursive: true });
  await mkdir(path.join(modules, "@playwright"), { recursive: true });
  await symlink(packageDirectory, path.join(modules, "@visonaut/playwright"));
  await symlink(
    path.dirname(require.resolve("@playwright/test/package.json")),
    path.join(modules, "@playwright/test"),
  );
  const config = {
    forbidOnly: true,
    testDir: directory,
    testMatch: "capture.spec.ts",
    retries,
    workers: 1,
    timeout,
    metadata: {
      visonaut: {
        ...metadata.visonaut,
        ...(Object.hasOwn(options, "comparisonDefaults")
          ? { comparisonDefaults: options.comparisonDefaults }
          : {}),
      },
    },
    expect: { toHaveScreenshot: options.screenshotDefaults },
    use: {
      browserName,
      viewport: { width: 32, height: 32 },
      reducedMotion: "reduce",
      locale: "en-US",
      timezoneId: "UTC",
    },
    reporter: [
      ["list"],
      [
        reporter,
        {
          outputFile: "evidence/manifest.json",
          run: {
            repository: "ariakit/ariakit",
            repositoryId: "123",
            workflowRunId: "456",
            workflowAttempt: 1,
            testedSha: "d".repeat(40),
            ...(retiredDigests ? { planDigest: "e".repeat(64) } : {}),
          },
          shard: { key: "chromium-1", jobId: "789", sourceAttempt: 1 },
          ...(discovery
            ? {
                discovery: {
                  repositoryRoot: directory,
                  ...(retiredDigests ? { executorDigest: "f".repeat(64) } : {}),
                },
              }
            : {}),
        },
      ],
    ],
  };
  await writeFile(
    path.join(directory, "playwright.config.ts"),
    `export default ${JSON.stringify(config)};`,
  );
  await writeFile(
    path.join(directory, "capture.spec.ts"),
    `import { test, expect } from '@playwright/test';\nimport { visual, visualBatch } from ${JSON.stringify(adapter)};\n${source}`,
  );
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(
      runtime,
      [
        playwrightCli,
        "test",
        "--config",
        path.join(directory, "playwright.config.ts"),
        ...extraArgs,
      ],
      { cwd: directory, env: { ...process.env, CI: "true" }, stdio: ["ignore", "pipe", "pipe"] },
    );
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
  return {
    directory,
    ...result,
    async [Symbol.asyncDispose]() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function manifestAt(directory: string) {
  return parseManifest(
    JSON.parse(await readFile(path.join(directory, "evidence/manifest.json"), "utf8")),
  );
}

describe("public project comparison defaults", () => {
  it.each(["chromium", "webkit"] as const)(
    "records explicit defaults and batch/image overrides from real %s captures",
    async (browserName) => {
      await using fixture = await runFixture(
        `
        test('public defaults', async ({ page }, info) => {
          await page.setContent('<style>body { margin:0; background:white }</style>');
          const variant = { key: 'settings', browser: ${JSON.stringify(browserName)} };
          await visual(page, { item: 'default', variant });
          await visual(page, { item: 'override', variant, threshold: 0, maxDiffPixels: 7 });
          await visual(page, { item: 'ratio', variant, maxDiffPixels: undefined, maxDiffPixelRatio: 0.5 });
          await visual(page, { item: 'clear', variant, threshold: undefined, maxDiffPixels: undefined, maxDiffPixelRatio: undefined });
          const inherited = Object.create({ threshold: 0, maxDiffPixels: 100, maxDiffPixelRatio: 1 });
          inherited.item = 'prototype';
          inherited.variant = variant;
          await visual(page, inherited);
          const own = { item: 'own', variant };
          Object.defineProperty(own, 'maxDiffPixels', { value: 8 });
          await visual(page, own);
          await visualBatch(page, {
            variant, threshold: 0.4, maxDiffPixels: 9,
            items: [
              { item: 'batch-default', clip: { x: 0, y: 0, width: 4, height: 4 } },
              { item: 'batch-override', threshold: 0, maxDiffPixels: 3, clip: { x: 0, y: 0, width: 4, height: 4 } },
              { item: 'batch-clear', threshold: undefined, maxDiffPixels: undefined, maxDiffPixelRatio: undefined, clip: { x: 0, y: 0, width: 4, height: 4 } },
            ],
          });
          await visualBatch(page, {
            variant, threshold: undefined, maxDiffPixels: undefined, maxDiffPixelRatio: undefined,
            items: [{ item: 'batch-cleared', clip: { x: 0, y: 0, width: 4, height: 4 } }],
          });
        });
      `,
        {
          browserName,
          comparisonDefaults: { threshold: 0.35, maxDiffPixels: 11, maxDiffPixelRatio: 0.1 },
          screenshotDefaults: { threshold: 0.15, maxDiffPixels: 5 },
        },
      );
      expect(fixture.code, fixture.output).toBe(0);
      const manifest = await manifestAt(fixture.directory);
      expect(manifest.captures.map((capture) => capture.comparison)).toEqual([
        { threshold: 0.35, maxDiffPixels: 11, maxDiffPixelRatio: 0.1 },
        { threshold: 0, maxDiffPixels: 7, maxDiffPixelRatio: 0.1 },
        { threshold: 0.35, maxDiffPixelRatio: 0.5 },
        { threshold: 0.2, maxDiffPixels: 0 },
        { threshold: 0.35, maxDiffPixels: 11, maxDiffPixelRatio: 0.1 },
        { threshold: 0.35, maxDiffPixels: 8, maxDiffPixelRatio: 0.1 },
        { threshold: 0.4, maxDiffPixels: 9, maxDiffPixelRatio: 0.1 },
        { threshold: 0, maxDiffPixels: 3, maxDiffPixelRatio: 0.1 },
        { threshold: 0.2, maxDiffPixels: 0 },
        { threshold: 0.2, maxDiffPixels: 0 },
      ]);
      for (const captures of [manifest.captures.slice(0, 6), manifest.captures.slice(6)]) {
        expect(new Set(captures.map((capture) => capture.profileDigest)).size).toBe(1);
        expect(new Set(captures.map((capture) => capture.image.digest)).size).toBe(1);
      }
      expect(manifest.profiles.every(({ profile }) => !Object.hasOwn(profile, "comparison"))).toBe(
        true,
      );
    },
  );

  it("uses explicit {} without the private bridge, even with looser screenshot defaults", async () => {
    await using fixture = await runFixture(
      `
      test('empty defaults', async ({ page }, info) => {
        await page.setContent('<style>body { margin:0; background:white }</style>');
        const project = info._projectInternal;
        try {
          delete info._projectInternal;
          await visual(page, { item: 'empty', variant: { key: 'empty', browser: 'chromium' } });
        } finally {
          info._projectInternal = project;
        }
      });
    `,
      { comparisonDefaults: {}, screenshotDefaults: { threshold: 0.5, maxDiffPixels: 100 } },
    );
    expect(fixture.code, fixture.output).toBe(0);
    expect(
      (await manifestAt(fixture.directory)).captures.map((capture) => capture.comparison),
    ).toEqual([{ threshold: 0.2, maxDiffPixels: 0 }]);
  });

  it.each([
    ["missing defaults", "delete settings.comparisonDefaults;"],
    [
      "inherited defaults",
      "delete settings.comparisonDefaults; info.project.metadata.visonaut = Object.assign(Object.create({ comparisonDefaults: {} }), settings);",
    ],
    ["inherited metadata", "info.project.metadata = Object.create({ visonaut: settings });"],
  ])("requires own public configuration with %s", async (_name, setup) => {
    await using fixture = await runFixture(
      `
      test('required defaults', async ({ page }, info) => {
        await page.setContent('<style>body { margin:0; background:white }</style>');
        const variant = { key: 'required', browser: 'chromium' };
        const settings = info.project.metadata.visonaut;
        ${setup}
        await expect(visual(page, { item: 'required', variant })).rejects.toThrow('project.metadata.visonaut.comparisonDefaults is required');
      });
    `,
      { screenshotDefaults: { threshold: 0.15, maxDiffPixels: 5, maxDiffPixelRatio: 0.1 } },
    );
    expect(fixture.code, fixture.output).toBe(1);
    expect(fixture.output).toContain("1 passed");
    expect(fixture.output).toContain("required capture started but did not complete");
    await expect(
      readFile(path.join(fixture.directory, "evidence/manifest.json")),
    ).rejects.toThrow();
  });

  it("uses non-enumerable own defaults and ignores inherited comparison fields", async () => {
    await using fixture = await runFixture(`
      test('own defaults', async ({ page }, info) => {
        await page.setContent('<style>body { margin:0; background:white }</style>');
        const defaults = Object.create({ threshold: 0, maxDiffPixelRatio: 1 });
        Object.defineProperty(defaults, 'maxDiffPixels', { value: 8 });
        Object.defineProperty(info.project.metadata.visonaut, 'comparisonDefaults', { value: defaults });
        await visual(page, { item: 'own-defaults', variant: { key: 'own', browser: 'chromium' } });
      });
    `);
    expect(fixture.code, fixture.output).toBe(0);
    expect(
      (await manifestAt(fixture.directory)).captures.map((capture) => capture.comparison),
    ).toEqual([{ threshold: 0.2, maxDiffPixels: 8 }]);
  });

  it.each([
    ["undefined", "must be an object"],
    ["null", "must be an object"],
    ["[]", "must be an object"],
    ["'invalid'", "must be an object"],
    ["{ threshold: 2 }", "Invalid project.metadata.visonaut.comparisonDefaults"],
    ["{ threshold: NaN }", "Invalid project.metadata.visonaut.comparisonDefaults"],
    ["{ maxDiffPixels: -1 }", "Invalid project.metadata.visonaut.comparisonDefaults"],
    ["{ maxDiffPixels: 0.5 }", "Invalid project.metadata.visonaut.comparisonDefaults"],
    ["{ maxDiffPixelRatio: 2 }", "Invalid project.metadata.visonaut.comparisonDefaults"],
  ])("rejects malformed explicit defaults %s even when overridden", async (defaults, message) => {
    await using fixture = await runFixture(`
      test('invalid defaults', async ({ page }, info) => {
        info.project.metadata.visonaut.comparisonDefaults = ${defaults};
        await expect(visual(page, {
          item: 'invalid', variant: { key: 'invalid', browser: 'chromium' },
          threshold: 0.2, maxDiffPixels: 0, maxDiffPixelRatio: 0,
        })).rejects.toThrow(${JSON.stringify(message)});
      });
    `);
    expect(fixture.code, fixture.output).toBe(1);
    expect(fixture.output).toContain("required capture started but did not complete");
    await expect(
      readFile(path.join(fixture.directory, "evidence/manifest.json")),
    ).rejects.toThrow();
  });
});

describe("published adapter and reporter", () => {
  it.each(["chromium", "webkit"] as const)(
    "captures separate items from one stable %s full-page screenshot pair",
    async (browserName) => {
      await using fixture = await runFixture(
        `
        test('batch', async ({ page }) => {
          await page.setViewportSize({ width: 64, height: 40 });
          await page.setContent('<body style="margin:0;height:80px"><div style="position:absolute;left:8px;top:8px;width:16px;height:16px;background:red"></div><div style="position:absolute;left:24px;top:48px;width:16px;height:16px;background:blue"></div></body>');
          const screenshot = page.screenshot.bind(page);
          let screenshots = 0;
          page.screenshot = async (options) => {
            screenshots++;
            return screenshot(options);
          };
          await visualBatch(page, {
            variant: { key: 'light', browser: ${JSON.stringify(browserName)} },
            items: [
              { item: 'card/red', clip: { x: 8, y: 8, width: 16, height: 16 } },
              { item: 'card/blue', clip: { x: 24, y: 48, width: 16, height: 16 } },
            ],
          });
          expect(screenshots).toBe(2);
        });
      `,
        { browserName, timeout: browserName === "webkit" ? 30000 : 10000 },
      );
      expect(fixture.code, fixture.output).toBe(0);
      const manifest = await manifestAt(fixture.directory);
      expect(manifest.captures.map((capture) => [capture.itemKey, capture.ordinal])).toEqual([
        ["card/red", 0],
        ["card/blue", 1],
      ]);
      for (const [index, capture] of manifest.captures.entries()) {
        const clip = { x: index === 0 ? 8 : 24, y: index === 0 ? 8 : 48, width: 16, height: 16 };
        const profile = manifest.profiles.find((entry) => entry.digest === capture.profileDigest);
        expect(profile?.profile.captureOptions).toMatchObject({
          fullPage: true,
          scale: "css",
          captureMethod: "shared-full-page-crop-v1",
          clip,
        });
        const bytes = await readFile(path.join(fixture.directory, "evidence", capture.image.path));
        expect(await sha256(bytes)).toBe(capture.image.digest);
        const image = PNG.sync.read(bytes);
        expect([image.width, image.height]).toEqual([16, 16]);
        const color = index === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255];
        for (let offset = 0; offset < image.data.length; offset += 4) {
          expect([...image.data.subarray(offset, offset + 4)]).toEqual(color);
        }
      }
    },
    45000,
  );

  it("rejects a caught batch crop failure", async () => {
    await using fixture = await runFixture(`
      test('batch crop outside the screenshot', async ({ page }) => {
        await page.setContent('<p>Capture</p>');
        await visualBatch(page, {
          variant: { key: 'light', browser: 'chromium' },
          items: [
            { item: 'card/valid', clip: { x: 0, y: 0, width: 10, height: 10 } },
            { item: 'card/outside', clip: { x: 999, y: 0, width: 10, height: 10 } },
          ],
        }).catch(() => {});
      });
    `);
    expect(fixture.code).toBe(1);
    expect(fixture.output).toContain("required capture started but did not complete");
    await expect(manifestAt(fixture.directory)).rejects.toThrow("ENOENT");
  }, 20000);

  it("rejects a caught empty batch after a completed capture", async () => {
    await using fixture = await runFixture(`
      test('caught empty batch', async ({ page }) => {
        await page.setContent('<p>Capture</p>');
        const variant = { key: 'light', browser: 'chromium' };
        await visual(page, { item: 'card/valid', variant });
        await visualBatch(page, { variant, items: [] }).catch(() => {});
      });
    `);
    expect(fixture.code).toBe(1);
    expect(fixture.output).toContain("required capture started but did not complete");
    await expect(manifestAt(fixture.directory)).rejects.toThrow("ENOENT");
  }, 20000);

  it("rejects a batch when its second screenshot returns after the deadline", async () => {
    await using fixture = await runFixture(`
      import { performance } from 'node:perf_hooks';
      test('late batch screenshot', async ({ page }) => {
        await page.setContent('<p>Capture</p>');
        const screenshot = page.screenshot.bind(page);
        const now = performance.now.bind(performance);
        const timeout = 120_000;
        let calls = 0;
        page.screenshot = async (options) => {
          const bytes = await screenshot(options);
          if (++calls === 2) {
            // Expire the adapter clock after the second real screenshot returns.
            Object.defineProperty(performance, 'now', {
              configurable: true,
              value: () => now() + timeout,
            });
          }
          return bytes;
        };
        try {
          await expect(visualBatch(page, {
            variant: { key: 'light', browser: 'chromium' },
            timeout,
            items: [{ item: 'card/late', clip: { x: 0, y: 0, width: 32, height: 32 } }],
          })).rejects.toThrow('Visual capture timed out before pixels stabilized');
        } finally {
          Reflect.deleteProperty(performance, 'now');
        }
        expect(calls).toBe(2);
        console.log('late second screenshot reached');
      });
    `);
    expect(fixture.code).toBe(1);
    expect(fixture.output).toContain("late second screenshot reached");
    expect(fixture.output).toContain("required capture started but did not complete");
    await expect(manifestAt(fixture.directory)).rejects.toThrow("ENOENT");
  }, 20000);

  it("gives shared crops a profile distinct from direct screenshots", async () => {
    await using fixture = await runFixture(`
      test('distinct capture methods', async ({ page }) => {
        await page.setContent('<p>Capture</p>');
        const clip = { x: 0, y: 0, width: 32, height: 32 };
        const variant = { key: 'light', browser: 'chromium' };
        await visualBatch(page, {
          variant,
          items: [{ item: 'card/batch', clip }],
        });
        await visual(page, {
          item: 'card/direct',
          variant,
          screenshot: { fullPage: true, clip },
        });
      });
    `);
    expect(fixture.code, fixture.output).toBe(0);
    const manifest = await manifestAt(fixture.directory);
    const batch = manifest.captures.find((capture) => capture.itemKey === "card/batch");
    const direct = manifest.captures.find((capture) => capture.itemKey === "card/direct");
    expect(batch?.profileDigest).toBeDefined();
    expect(direct?.profileDigest).toBeDefined();
    expect(batch?.profileDigest).not.toBe(direct?.profileDigest);
    const batchProfile = manifest.profiles.find((entry) => entry.digest === batch?.profileDigest);
    const directProfile = manifest.profiles.find((entry) => entry.digest === direct?.profileDigest);
    expect(batchProfile?.profile.captureOptions).toMatchObject({
      captureMethod: "shared-full-page-crop-v1",
      clip: { x: 0, y: 0, width: 32, height: 32 },
    });
    expect(directProfile?.profile.captureOptions).not.toHaveProperty("captureMethod");
  }, 20000);

  it("captures when fonts.ready stays pending but all font faces are settled", async () => {
    await using fixture = await runFixture(`
      test('settled font faces', async ({ page }) => {
        await page.setContent('<p>Capture</p>');
        await page.evaluate(() => {
          Object.defineProperty(document.fonts, 'ready', {
            value: new Promise(() => {}),
          });
        });
        await visual(page, {
          item: 'fonts/settled',
          variant: { key: 'chromium', browser: 'chromium' },
          timeout: 3000,
        });
      });
    `);
    expect(fixture.code, fixture.output).toBe(0);
    const manifest = await manifestAt(fixture.directory);
    const packageInfo = JSON.parse(
      await readFile(path.join(packageDirectory, "package.json"), "utf8"),
    );
    expect(manifest.producer.version).toBe(packageInfo.version);
    expect(manifest.captures.map((capture) => capture.itemKey)).toEqual(["fonts/settled"]);
  }, 20000);

  it("captures two prepared variants of one item and preserves caller page state", async () => {
    await using fixture = await runFixture(`
      test('prepared variants', async ({ page }) => {
        await page.setContent('<style>body { margin:0; background:white }</style>');
        await page.emulateMedia({ colorScheme: 'light' });
        await visual(page, { item:'dialog/open', name:'Open dialog', variant:{ key:'react-light', framework:'react', browser:'chromium', colorScheme:'light' } });
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.evaluate(() => document.body.style.background = 'black');
        await visual(page, { item:'dialog/open', name:'Open dialog', variant:{ key:'react-dark', framework:'react', browser:'chromium', colorScheme:'dark' } });
        expect(await page.evaluate(() => document.body.style.background)).toBe('black');
        expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
      });
    `);
    expect(fixture.code, fixture.output).toBe(0);
    const manifest = await manifestAt(fixture.directory);
    expect(
      manifest.captures.map((capture) => [capture.itemKey, capture.variant.key, capture.ordinal]),
    ).toEqual([
      ["dialog/open", "react-light", 0],
      ["dialog/open", "react-dark", 1],
    ]);
    expect(new Set(manifest.captures.map((capture) => capture.profileDigest)).size).toBe(2);
    for (const capture of manifest.captures) {
      const bytes = await readFile(path.join(fixture.directory, "evidence", capture.image.path));
      expect(await sha256(bytes)).toBe(capture.image.digest);
      expect(bytes.byteLength).toBe(capture.image.bytes);
    }
  }, 20000);

  it("selects only the final successful retry after a capture and later failure", async () => {
    await using fixture = await runFixture(
      `
      test('recovers', async ({ page }, info) => {
        await page.setContent('<style>body { margin:0; background:' + (info.retry ? 'lime' : 'blue') + ' }</style>');
        await visual(page, { item:'dialog/open', variant:{ key:'react-light', browser:'chromium' } });
        expect(info.retry).toBe(1);
      });
    `,
      { retries: 1 },
    );
    expect(fixture.code, fixture.output).toBe(0);
    const manifest = await manifestAt(fixture.directory);
    expect(manifest.tests.map((test) => test.retry)).toEqual([1]);
    expect(manifest.captures.map((capture) => capture.testRetry)).toEqual([1]);
    const capture = manifest.captures.at(0);
    if (!capture) {
      throw new Error("Capture missing");
    }
    const image = PNG.sync.read(
      await readFile(path.join(fixture.directory, "evidence", capture.image.path)),
    );
    expect([...image.data.subarray(0, 4)]).toEqual([0, 255, 0, 255]);
  }, 20000);

  it("refuses changing pixels even with permissive explicit comparison defaults", async () => {
    await using fixture = await runFixture(
      `
      test('unstable pixels', async ({ page }) => {
        await page.setContent('<style>body { margin:0; background:blue }</style>');
        const screenshot = page.screenshot.bind(page);
        let alternate = false;
        page.screenshot = async (options) => {
          alternate = !alternate;
          await page.evaluate((alternate) => document.body.style.background = alternate ? 'red' : 'blue', alternate);
          return screenshot(options);
        };
        await visual(page, { item:'dialog/open', variant:{ key:'react-light', browser:'chromium' }, timeout:500 });
      });
    `,
      { comparisonDefaults: { threshold: 1, maxDiffPixelRatio: 1 } },
    );
    expect(fixture.code).toBe(1);
    expect(fixture.output).toContain("Visual capture timed out before pixels stabilized");
    await expect(manifestAt(fixture.directory)).rejects.toThrow("ENOENT");
  }, 20000);

  it.each([
    ["preparation", "throw new Error('Preparation failed')", 0],
    ["missing captures", "await page.setContent('<p>No capture</p>')", 0],
    [
      "exhausted retry",
      "await page.setContent('<p>Capture</p>'); await visual(page,{item:'dialog/open',variant:{key:'one',browser:'chromium'}}); throw new Error('later failure')",
      1,
    ],
    [
      "duplicate capture",
      "await page.setContent('<p>Capture</p>'); await visual(page,{item:'dialog/open',variant:{key:'one',browser:'chromium'}}); await visual(page,{item:'dialog/open',variant:{key:'one',browser:'chromium'}})",
      0,
    ],
  ])(
    "does not emit a successful manifest for %s",
    async (_, source, retries) => {
      await using fixture = await runFixture(
        `test('fails safely', async ({page}) => { ${source} });`,
        { retries },
      );
      expect(fixture.code).toBe(1);
      await expect(manifestAt(fixture.directory)).rejects.toThrow("ENOENT");
    },
    20000,
  );
});

it("discovers candidate identities under the immutable full collection configuration", async () => {
  await using fixture = await runFixture(
    `test('new candidate', async ({ page }) => {
    await page.setContent('<p>Added item</p>');
    await visual(page, { item: 'new/item', variant: { key: 'new-variant', browser: 'chromium' } });
  });`,
    { discovery: true },
  );
  expect(fixture.code, fixture.output).toBe(0);
  const manifest = await manifestAt(fixture.directory);
  expect(manifest.run.planDigest).toBe(FIXED_DIGEST);
  expect(manifest.discovery?.executorDigest).toBe(FIXED_DIGEST);
  expect(manifest.tests.map((test) => test.file)).toEqual(["capture.spec.ts"]);
  expect(manifest.captures.map((capture) => capture.itemKey)).toEqual(["new/item"]);
  const receipt = JSON.parse(
    await readFile(path.join(fixture.directory, "evidence/receipt.json"), "utf8"),
  );
  expect(receipt.manifestDigest).toBe(await digestJson(manifest));
  expect(receipt.artifactName).toBe(
    `visonaut-discovery-1-789-chromium-1-${await digestJson(manifest)}`,
  );
}, 20000);

it("sends the fixed digest in both fields, also when the configuration still sets the old options", async () => {
  await using fixture = await runFixture(
    `test('old options', async ({ page }) => {
    await page.setContent('<p>Added item</p>');
    await visual(page, { item: 'new/item', variant: { key: 'new-variant', browser: 'chromium' } });
  });`,
    { discovery: true, retiredDigests: true },
  );
  expect(fixture.code, fixture.output).toBe(0);
  const manifest = await manifestAt(fixture.directory);
  expect(manifest.run.planDigest).toBe(FIXED_DIGEST);
  expect(manifest.discovery?.executorDigest).toBe(FIXED_DIGEST);
}, 20000);

it("refuses a command-line subset of the trusted collection", async () => {
  await using fixture = await runFixture(
    `test('candidate', async ({ page }) => {
    await page.setContent('<p>Added item</p>');
    await visual(page, { item: 'new/item', variant: { key: 'new-variant', browser: 'chromium' } });
  });`,
    { discovery: true, extraArgs: ["--grep", "candidate"] },
  );
  expect(fixture.code).toBe(1);
  expect(fixture.output).toContain("command-line selection");
  await expect(manifestAt(fixture.directory)).rejects.toThrow("ENOENT");
}, 20000);

it("fails an incomplete capture even when the test catches the capture error", async () => {
  await using fixture = await runFixture(`test('caught failure', async ({ page }) => {
    await page.setContent('<p>Stable</p>');
    await visual(page, { item: 'good/item', variant: { key: 'one', browser: 'chromium' } });
    await visual(page, { item: 'broken/item', variant: { key: 'two', browser: 'firefox' } }).catch(() => {});
  });`);
  expect(fixture.code).toBe(1);
  expect(fixture.output).toContain("required capture started but did not complete");
  await expect(manifestAt(fixture.directory)).rejects.toThrow("ENOENT");
}, 20000);

it("stores capture bytes in private attempt files outside diagnostic results", async () => {
  await using fixture = await runFixture(`
    import { stat } from 'node:fs/promises';
    test('file attachment', async ({ page }, info) => {
      await page.setContent('<div style="width:16px;height:16px;background:red"></div>');
      await visual(page, { item: 'file-backed', variant: { key: 'chromium', browser: 'chromium' } });
      const image = info.attachments.find((entry) => entry.name.startsWith('visonaut-image-'));
      expect(image?.body).toBeUndefined();
      expect(image?.path).toContain('visonaut-attachment-');
      expect(image?.path.startsWith(info.outputDir)).toBe(false);
      expect((await stat(image.path)).mode & 0o777).toBe(0o600);
    });
  `);
  expect(fixture.code, fixture.output).toBe(0);
  expect((await manifestAt(fixture.directory)).captures).toHaveLength(1);
}, 20000);

it("produces a capture bundle that passes bounded ordinary ZIP extraction", async () => {
  await using fixture = await runFixture(
    `test('ordinary bundle', async ({ page }) => {
    await page.setContent('<button>Capture</button>');
    await visual(page, { item: 'ordinary/bundle', variant: { key: 'light', browser: 'chromium' } });
  });`,
    { discovery: true },
  );
  expect(fixture.code, fixture.output).toBe(0);
  const manifest = await manifestAt(fixture.directory);
  const output = path.join(fixture.directory, "evidence");
  await writeFile(path.join(output, "environment.json"), "{}");
  const names = [
    "manifest.json",
    "environment.json",
    "receipt.json",
    ...new Set(manifest.captures.map((capture) => capture.image.path)),
  ];
  const archive = path.join(fixture.directory, "capture.zip");
  await writeFile(
    archive,
    zip(
      await Promise.all(
        names.map(async (name) => ({ name, bytes: await readFile(path.join(output, name)) })),
      ),
    ),
  );
  const extracted = path.join(fixture.directory, "extracted");
  await extractCaptureArchive(archive, extracted);
  expect(JSON.parse(await readFile(path.join(extracted, "manifest.json"), "utf8"))).toEqual(
    manifest,
  );
  expect(JSON.parse(await readFile(path.join(extracted, "receipt.json"), "utf8"))).toMatchObject({
    manifestDigest: await digestJson(manifest),
  });
  for (const capture of manifest.captures)
    expect(await sha256(await readFile(path.join(extracted, capture.image.path)))).toBe(
      capture.image.digest,
    );
});
