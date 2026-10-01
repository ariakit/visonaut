import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { parseManifest } from "@visonaut/protocol";

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
  const config = {
    testDir: directory,
    testMatch: "capture.spec.mjs",
    snapshotPathTemplate: path.join(directory, "{arg}{ext}"),
    workers: 1,
    metadata: {
      visonaut: { profile: { osImageDigest: "a".repeat(64), fontsDigest: "b".repeat(64) } },
    },
    expect: { toHaveScreenshot: { threshold: 0.35, maxDiffPixels: 11, maxDiffPixelRatio: 0.1 } },
    projects: [
      { name: "inherited" },
      { name: "project", expect: { toHaveScreenshot: { threshold: 0.15, maxDiffPixels: 5 } } },
      { name: "empty", expect: {} },
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
            planDigest: "e".repeat(64),
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
  it("serializes resolved project defaults and per-image overrides after Playwright exits", async () => {
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

  it("fails clearly if the pinned resolved configuration bridge is unavailable", async () => {
    await using fixture = await runFixture(`
      test('missing bridge', async ({}, info) => {
        const project = info._projectInternal;
        try {
          delete info._projectInternal;
          await expect(visual(page, { item: 'bridge', variant: { key: info.project.name, browser: 'chromium' }, maxDiffPixels: 5 })).rejects.toThrow('Cannot read resolved screenshot defaults');
        } finally {
          info._projectInternal = project;
        }
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
  });
});
