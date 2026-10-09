import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { imageLimits } from "@visonaut/compare";
import { parseManifest } from "@visonaut/protocol";
import { submitBounds } from "../src/submit-bounds.js";

const require = createRequire(import.meta.url);
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const playwrightCli = require.resolve("@playwright/test/cli");

function image(color: number) {
  const pixels = new PNG({ width: 4, height: 4 });
  pixels.data.fill(color);
  for (let offset = 3; offset < pixels.data.length; offset += 4) {
    pixels.data[offset] = 255;
  }
  return PNG.sync.write(pixels).toString("base64");
}

async function runFixture(source: string) {
  const directory = await mkdtemp(path.join(packageDirectory, ".comparison-fixture-"));
  const profile = { osImageDigest: "a".repeat(64), fontsDigest: "b".repeat(64) };
  const comparisonDefaults = { threshold: 0.35, maxDiffPixels: 11, maxDiffPixelRatio: 0.1 };
  const projectDefaults = { threshold: 0.15, maxDiffPixels: 5 };
  const config = {
    testDir: directory,
    testMatch: "capture.spec.mjs",
    snapshotPathTemplate: path.join(directory, "{arg}{ext}"),
    workers: 1,
    metadata: {
      visonaut: { profile, comparisonDefaults },
    },
    expect: { toHaveScreenshot: comparisonDefaults },
    projects: [
      { name: "inherited" },
      {
        name: "project",
        metadata: { visonaut: { profile, comparisonDefaults: projectDefaults } },
        expect: { toHaveScreenshot: projectDefaults },
      },
      { name: "empty", metadata: { visonaut: { profile, comparisonDefaults: {} } }, expect: {} },
    ],
    reporter: [
      [
        fileURLToPath(new URL("../dist/reporter.js", import.meta.url)),
        {
          outputFile: "evidence/manifest.json",
          run: {
            repository: "ariakit/ariakit",
            repositoryId: "123",
            workflowRunId: "456",
            workflowAttempt: 1,
            testedSha: "d".repeat(40),
          },
          shard: { key: "chromium-1", jobId: "789", sourceAttempt: 1 },
        },
      ],
    ],
  };
  await writeFile(
    path.join(directory, "playwright.config.mjs"),
    `export default ${JSON.stringify(config)};`,
  );
  await writeFile(path.join(directory, "reference.png"), Buffer.from(image(255), "base64"));
  // Probe the real worker configuration and reporter without opening a browser.
  await writeFile(
    path.join(directory, "capture.spec.mjs"),
    `
    import { test, expect } from '@playwright/test';
    import { visual, visualBatch } from '@visonaut/playwright';
    const bytes = Buffer.from(${JSON.stringify(image(255))}, 'base64');
    const page = {
      context: () => ({ browser: () => ({ browserType: () => ({ name: () => 'chromium' }), version: () => '149.0' }) }),
      evaluate: async () => ({ viewport: { width: 4, height: 4 }, deviceScaleFactor: 1, locale: 'en-US', timezone: 'UTC', reducedMotion: true, dark: false, contrast: false, forcedColors: false }),
      waitForLoadState: async () => {},
      waitForFunction: async () => ({ dispose: async () => {} }),
      screenshot: async () => bytes,
    };
    ${source}
  `,
  );
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [playwrightCli, "test", "--config", path.join(directory, "playwright.config.mjs")],
      {
        cwd: directory,
        env: { ...process.env, CI: "true" },
        stdio: ["ignore", "pipe", "pipe"],
      },
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

describe("consumer screenshot settings", () => {
  it("serializes explicit project defaults and per-image overrides after Playwright exits", async () => {
    await using fixture = await runFixture(`
      test('settings', async ({}, info) => {
        const variant = { key: info.project.name, browser: 'chromium' };
        await visual(page, { item: 'default', variant });
        await visual(page, { item: 'override', variant, maxDiffPixels: 7, threshold: 0 });
        await visual(page, { item: 'ratio', variant, maxDiffPixels: undefined, maxDiffPixelRatio: 0.5 });
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
            { item: 'batch-default', clip: { x: 0, y: 0, width: 2, height: 2 } },
            { item: 'batch-override', threshold: 0, maxDiffPixels: 3, clip: { x: 0, y: 0, width: 2, height: 2 } },
            { item: 'batch-ratio', maxDiffPixels: undefined, maxDiffPixelRatio: 0.5, clip: { x: 0, y: 0, width: 2, height: 2 } },
          ],
        });
      });
    `);
    expect(fixture.code, fixture.output).toBe(0);
    const manifest = parseManifest(
      JSON.parse(await readFile(path.join(fixture.directory, "evidence/manifest.json"), "utf8")),
    );
    for (const project of ["inherited", "project", "empty"]) {
      const captures = manifest.captures.filter((capture) => capture.variant.key === project);
      const inheritedRatio = project === "inherited" ? { maxDiffPixelRatio: 0.1 } : {};
      expect(captures.map((capture) => capture.comparison)).toEqual([
        project === "inherited"
          ? { threshold: 0.35, maxDiffPixels: 11, maxDiffPixelRatio: 0.1 }
          : project === "project"
            ? { threshold: 0.15, maxDiffPixels: 5 }
            : { threshold: 0.2, maxDiffPixels: 0 },
        { threshold: 0, maxDiffPixels: 7, ...inheritedRatio },
        {
          threshold: project === "inherited" ? 0.35 : project === "project" ? 0.15 : 0.2,
          maxDiffPixelRatio: 0.5,
        },
        project === "inherited"
          ? { threshold: 0.35, maxDiffPixels: 11, maxDiffPixelRatio: 0.1 }
          : project === "project"
            ? { threshold: 0.15, maxDiffPixels: 5 }
            : { threshold: 0.2, maxDiffPixels: 0 },
        {
          threshold: project === "inherited" ? 0.35 : project === "project" ? 0.15 : 0.2,
          maxDiffPixels: 8,
          ...inheritedRatio,
        },
        { threshold: 0.4, maxDiffPixels: 9, ...inheritedRatio },
        { threshold: 0, maxDiffPixels: 3, ...inheritedRatio },
        { threshold: 0.4, maxDiffPixelRatio: 0.5 },
      ]);
      expect(new Set(captures.slice(0, 5).map((capture) => capture.profileDigest)).size).toBe(1);
      expect(new Set(captures.slice(5).map((capture) => capture.profileDigest)).size).toBe(1);
    }
    expect(manifest.profiles.every(({ profile }) => !Object.hasOwn(profile, "comparison"))).toBe(
      true,
    );
  });

  it("uses Playwright's actual comparator as an oracle for both limits and threshold", async () => {
    await using fixture = await runFixture(`
      test('comparator', async ({}, info) => {
        const variant = { key: info.project.name, browser: 'chromium' };
        await visual(page, { item: 'settings', variant, maxDiffPixels: 16, maxDiffPixelRatio: 0.5, threshold: 0.2 });
        const metadata = info.attachments.find((attachment) => attachment.contentType === 'application/vnd.visonaut.capture+json');
        const comparison = JSON.parse(metadata.body.toString()).capture.comparison;
        const changed = Buffer.from(${JSON.stringify(image(0))}, 'base64');
        const name = 'reference.png';
        expect(changed).toMatchSnapshot(name, { ...comparison, maxDiffPixelRatio: 1 });
        expect(changed).toMatchSnapshot(name, { threshold: 0.2, maxDiffPixelRatio: 1 });
        expect(() => expect(changed).toMatchSnapshot(name, comparison)).toThrow('16 pixels');
        expect(() => expect(changed).toMatchSnapshot(name, { ...comparison, maxDiffPixels: 8, maxDiffPixelRatio: 1 })).toThrow('16 pixels');
        expect(() => expect(changed).toMatchSnapshot(name, { threshold: 0.2 })).toThrow('16 pixels');
        const subtle = Buffer.from(${JSON.stringify(image(240))}, 'base64');
        expect(subtle).toMatchSnapshot(name, { threshold: 0.2 });
        expect(() => expect(subtle).toMatchSnapshot(name, { threshold: 0 })).toThrow('16 pixels');
      });
    `);
    expect(fixture.code, fixture.output).toBe(0);
  });

  it.each(["visual", "visualBatch"])(
    "requires public defaults for %s even when overridden",
    async (capture) => {
      await using fixture = await runFixture(`
      test('missing defaults', async ({}, info) => {
        delete info.project.metadata.visonaut.comparisonDefaults;
        await expect(${capture}(page, {
          item: 'missing', variant: { key: info.project.name, browser: 'chromium' },
          threshold: 0, maxDiffPixels: 5, maxDiffPixelRatio: 1,
          items: [{ item: 'missing', clip: { x: 0, y: 0, width: 2, height: 2 } }],
        })).rejects.toThrow('project.metadata.visonaut.comparisonDefaults is required');
      });
    `);
      // Catching an incomplete capture still causes the reporter to reject the run.
      expect(fixture.code).toBe(1);
      expect(fixture.output).toContain(
        "A required capture started but did not complete successfully",
      );
      await expect(
        readFile(path.join(fixture.directory, "evidence/manifest.json")),
      ).rejects.toThrow();
    },
  );
});

// The adapter checks the Submit bounds when it captures an item. The fake page of the fixture
// returns one screenshot of the size under test. The spec catches the capture error and asserts
// its message. The reporter still refuses the run, because the capture started and did not finish.
describe("Submit bounds at capture", () => {
  const spec = (
    kind: "visual" | "visualBatch",
    { width, height, noise = false, expected }: SpecParams,
  ) => `
    import { PNG } from 'pngjs';
    import { randomBytes } from 'node:crypto';
    const png = (width, height, noise) => {
      const pixels = new PNG({ width, height });
      if (noise) pixels.data.set(randomBytes(pixels.data.length));
      else pixels.data.fill(255);
      return PNG.sync.write(pixels);
    };
    test('bounds', async ({}, info) => {
      const variant = { key: info.project.name, browser: 'chromium' };
      // Random pixels must be the same in each screenshot, or they never stabilize.
      const shot = png(${width}, ${height}, ${noise});
      const big = { ...page, screenshot: async () => shot };
      const capture = ${
        kind === "visual"
          ? "visual(big, { item: 'dialog/open', variant })"
          : `visualBatch(big, { variant, items: [
              { item: 'dialog/closed', clip: { x: 0, y: 0, width: 1, height: 1 } },
              { item: 'dialog/open', clip: { x: 0, y: 0, width: ${width}, height: ${height} } },
            ] })`
      };
      ${expected ? `await expect(capture).rejects.toThrow(${expected});` : "await capture;"}
    });
  `;

  interface SpecParams {
    width: number;
    height: number;
    noise?: boolean;
    /** Source text of the argument of toThrow. No value means that the capture passes. */
    expected?: string;
  }

  const refused = "A required capture started but did not complete successfully";
  const kinds = ["visual", "visualBatch"] as const;

  async function expectRefused(fixture: {
    code: number | null;
    output: string;
    directory: string;
  }) {
    expect(fixture.code).toBe(1);
    expect(fixture.output).toContain(refused);
    await expect(
      readFile(path.join(fixture.directory, "evidence/manifest.json")),
    ).rejects.toThrow();
  }

  it("uses the bounds of the Submit image check", () => {
    expect(submitBounds).toEqual({
      maxEncodedBytes: imageLimits.maxEncodedBytes,
      maxPixels: imageLimits.maxPixels,
      maxDimension: imageLimits.maxDimension,
    });
  });

  it.each(kinds)(
    "names the item of %s when it is above the pixel limit",
    async (kind) => {
      await using fixture = await runFixture(
        spec(kind, {
          width: 1248,
          height: 1700,
          expected:
            "new Error(`dialog/open (${info.project.name}): 1248x1700 is 2,121,600 pixels. The limit is 2,100,000.`)",
        }),
      );
      await expectRefused(fixture);
    },
    30000,
  );

  it.each(kinds)(
    "names the item of %s when one side is above the dimension limit",
    async (kind) => {
      await using fixture = await runFixture(
        spec(kind, {
          width: 8193,
          height: 1,
          expected:
            "new Error(`dialog/open (${info.project.name}): 8193x1 has a side above 8,192 pixels.`)",
        }),
      );
      await expectRefused(fixture);
    },
    30000,
  );

  it.each(kinds)(
    "names the item of %s when it is above the encoded size limit",
    async (kind) => {
      // Random pixels do not compress: 800x800 is inside the pixel limit and above 2 MiB.
      await using fixture = await runFixture(
        spec(kind, {
          width: 800,
          height: 800,
          noise: true,
          expected:
            "new RegExp('^dialog/open \\\\(' + info.project.name + '\\\\): [\\\\d,]+ bytes is above the limit of 2,097,152 bytes\\\\.$')",
        }),
      );
      await expectRefused(fixture);
    },
    30000,
  );

  it.each(kinds.flatMap((kind) => [[kind, 1500, 1400] as const, [kind, 8192, 1] as const]))(
    "captures an item of %s of %dx%d, which is on a bound",
    async (kind, width, height) => {
      await using fixture = await runFixture(spec(kind, { width, height }));
      expect(fixture.code, fixture.output).toBe(0);
      const manifest = parseManifest(
        JSON.parse(await readFile(path.join(fixture.directory, "evidence/manifest.json"), "utf8")),
      );
      const image = manifest.captures.find((entry) => entry.itemKey === "dialog/open")?.image;
      expect(image).toMatchObject({ width, height });
    },
    30000,
  );
});
