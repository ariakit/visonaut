import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { digestJson, parseManifest, sha256 } from "@visonaut/protocol";

const require = createRequire(import.meta.url);
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const runtime = process.execPath;
const playwrightCli = require.resolve("@playwright/test/cli");
const adapter = "@visonaut/playwright";
const reporter = "@visonaut/playwright/reporter";
const metadata = {
  visonaut: {
    profile: {
      osImageDigest: "a".repeat(64),
      fontsDigest: "b".repeat(64),
      comparisonPolicyDigest: "c".repeat(64),
      comparisonEngineVersion: "1",
    },
  },
};

async function runFixture(
  source: string,
  retries = 0,
  discovery = false,
  extraArgs: string[] = [],
) {
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
    timeout: 10000,
    metadata,
    use: {
      browserName: "chromium",
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
            planDigest: "e".repeat(64),
          },
          shard: { key: "chromium-1", jobId: "789", sourceAttempt: 1 },
          ...(discovery
            ? { discovery: { executorDigest: "f".repeat(64), repositoryRoot: directory } }
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
    `import { test, expect } from '@playwright/test';\nimport { visual } from ${JSON.stringify(adapter)};\n${source}`,
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

describe("published adapter and reporter", () => {
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
      1,
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

  it("refuses changing pixels with stable dimensions", async () => {
    await using fixture = await runFixture(`
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
    `);
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
        retries,
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
    0,
    true,
  );
  expect(fixture.code, fixture.output).toBe(0);
  const manifest = await manifestAt(fixture.directory);
  expect(manifest.discovery?.executorDigest).toBe("f".repeat(64));
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

it("refuses a command-line subset of the trusted collection", async () => {
  await using fixture = await runFixture(
    `test('candidate', async ({ page }) => {
    await page.setContent('<p>Added item</p>');
    await visual(page, { item: 'new/item', variant: { key: 'new-variant', browser: 'chromium' } });
  });`,
    0,
    true,
    ["--grep", "candidate"],
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
