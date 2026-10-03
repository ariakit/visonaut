import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { arch, cpus, platform } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { summarize } from "./run.mjs";

const sourceRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const availableProfiles = [
  { name: "local", cpuRate: 1, latencyMs: 0, downloadBytesPerSecond: -1, uploadBytesPerSecond: -1 },
  {
    name: "slow",
    cpuRate: 4,
    latencyMs: 150,
    downloadBytesPerSecond: 200_000,
    uploadBytesPerSecond: 100_000,
  },
];

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function files(directory, pattern = /\.(js|css|wasm|html)$/u) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = resolve(directory, entry.name);
    if (entry.isDirectory()) return files(filename, pattern);
    if (!pattern.test(entry.name)) return [];
    const bytes = readFileSync(filename);
    return [{ file: filename.slice(sourceRoot.length), bytes: bytes.length, sha256: hash(bytes) }];
  });
}

async function imageReady(page) {
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-evidence="ready"] img[alt="New image"]');
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  });
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  const display = await page
    .locator(".review-workspace")
    .evaluate((element) => getComputedStyle(element).display);
  if (display !== "grid")
    throw new Error(`Review Shell display must be grid, received ${display}.`);
}

async function resources(page) {
  return page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => ({
      url: entry.name,
      initiatorType: entry.initiatorType,
      startTime: entry.startTime,
      responseStart: entry.responseStart,
      responseEnd: entry.responseEnd,
      duration: entry.duration,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
    })),
  );
}

export async function committedResult(page, response) {
  if (!response.ok()) {
    throw new Error(`The actual decision API returned ${response.status()}.`);
  }
  const result = await response.json();
  if (!result.queued) {
    return { result, status: response.status() };
  }
  if (response.status() !== 202 || typeof result.commandId !== "string") {
    throw new Error("The actual decision returned an invalid admission receipt.");
  }
  // Use a fixed interval so receipt reads do not run on every animation frame.
  const receipt = await page.waitForFunction(
    async (commandId) => {
      const response = await fetch(`/api/commands/${encodeURIComponent(commandId)}/queued`, {
        cache: "no-store",
      });
      if (response.status === 202) return false;
      if (!response.ok) {
        throw new Error(`The actual decision failed: ${response.status}.`);
      }
      return { result: await response.json(), status: response.status };
    },
    result.commandId,
    { polling: 500 },
  );
  try {
    const completed = await receipt.jsonValue();
    if (completed.result.commandId !== result.commandId || completed.result.queued) {
      throw new Error("The terminal receipt must complete the admitted command.");
    }
    return completed;
  } finally {
    await receipt.dispose();
  }
}

// Use only a writable, resettable local PR fixture. The service is never mocked.
export async function runRoutes(chromium) {
  const origin = new URL(process.env.REVIEW_ROUTE_ORIGIN || "http://127.0.0.1:3000");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) {
    throw new Error("Route measurements require an isolated localhost app.");
  }
  const runPath = process.env.REVIEW_ROUTE_RUN_PATH || "/runs/00000000-0000-4000-8000-000000000001";
  const route = new URL(runPath, origin);
  if (route.origin !== origin.origin || !route.pathname.startsWith("/runs/")) {
    throw new Error("REVIEW_ROUTE_RUN_PATH must select a local review run.");
  }
  const samples = Number(process.env.SAMPLES || 3);
  if (!Number.isSafeInteger(samples) || samples < 1)
    throw new Error("SAMPLES must be a positive integer.");
  const profileNames = (process.env.REVIEW_ROUTE_PROFILES || "local,slow").split(",");
  const profiles = availableProfiles.filter((profile) => profileNames.includes(profile.name));
  if (
    !profiles.length ||
    profileNames.some((name) => !profiles.some((profile) => profile.name === name))
  ) {
    throw new Error("REVIEW_ROUTE_PROFILES must select local, slow, or local,slow.");
  }
  const output = resolve(
    process.env.REVIEW_ROUTE_OUTPUT || resolve(sourceRoot, "artifacts/review-routes"),
  );
  mkdirSync(output, { recursive: true });
  await using browser = await chromium.launch({ channel: "chrome", headless: true });
  const record = {
    measuredAt: new Date().toISOString(),
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: sourceRoot,
      encoding: "utf8",
    }).trim(),
    workingDiffSha256: hash(
      execFileSync("git", ["diff", "--binary", "HEAD"], {
        cwd: sourceRoot,
        maxBuffer: 16 * 1024 * 1024,
      }),
    ),
    buildFiles: files(resolve(sourceRoot, "apps/web/dist")),
    sourceFiles: files(resolve(sourceRoot, "apps/web/src"), /\.(ts|tsx|css)$/u),
    probeFiles: files(resolve(sourceRoot, "apps/web/tooling/review-scale"), /\.(mjs|jsx)$/u),
    environment: {
      os: platform(),
      architecture: arch(),
      cpu: cpus()[0]?.model,
      node: process.version,
      browser: browser.version(),
      viewport: { width: 1280, height: 900 },
    },
    route: route.href,
    limits:
      "Local built Worker and isolated data; two-frame paint opportunity proxy. No production latency, physical display time, Core Web Vitals, or performance budget is established.",
    profiles,
    samples: [],
    errors: [],
  };
  const write = () =>
    writeFileSync(resolve(output, "measurements.json"), `${JSON.stringify(record, null, 2)}\n`);
  for (const profile of profiles) {
    for (let sample = 0; sample < samples; sample++) {
      await using context = await browser.newContext({
        viewport: record.environment.viewport,
        storageState: process.env.REVIEW_ROUTE_STORAGE_STATE,
      });
      context.setDefaultTimeout(30_000);
      const page = await context.newPage();
      page.on("pageerror", (error) =>
        record.errors.push({ profile: profile.name, sample, message: String(error) }),
      );
      const session = await context.newCDPSession(page);
      await session.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuRate });
      await session.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: profile.latencyMs,
        downloadThroughput: profile.downloadBytesPerSecond,
        uploadThroughput: profile.uploadBytesPerSecond,
      });
      try {
        for (const cache of ["cold", "warm"]) {
          const start = performance.now();
          await page.goto(route.href, { waitUntil: "domcontentloaded" });
          await imageReady(page);
          const openRunToFirstImageMs = performance.now() - start;
          const openResources = await resources(page);
          const previous = await page
            .locator('[aria-label="Variants"] [aria-current="page"]')
            .getAttribute("id");
          const approve = page.getByRole("button", { name: /^Approve(?: |$)/ }).first();
          if (!(await approve.isEnabled())) {
            throw new Error(
              "The local fixture must be a writable pending PR run with at least two variants. Preview fixtures are read-only.",
            );
          }
          await page.evaluate(() => performance.clearResourceTimings());
          const saved = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              /\/api\/comparisons\/[^/]+\/commands$/u.test(new URL(response.url()).pathname),
          );
          const saveStart = performance.now();
          await approve.click();
          const response = await saved;
          const { result, status } = await committedResult(page, response);
          if (result.noop || !result.revisions?.length)
            throw new Error("The actual save must commit a new approval.");
          await page
            .locator(".review-save-state")
            .getByText(/variant(?:s)? approved\. Saved\./u)
            .waitFor();
          const saveToConfirmationMs = performance.now() - saveStart;
          await page.waitForFunction((previous) => {
            const selected = document.querySelector(
              '[aria-label="Variants"] [aria-current="page"]',
            );
            return selected?.id && selected.id !== previous;
          }, previous);
          await imageReady(page);
          const measurement = {
            profile: profile.name,
            sample,
            cache,
            openRunToFirstImageMs,
            saveToNextImageMs: performance.now() - saveStart,
            saveToConfirmationMs,
            admissionStatus: response.status(),
            saveStatus: status,
            commandId: result.commandId,
            savedTargets: result.revisions.length,
            openResources,
            saveResources: await resources(page),
          };
          if (!record.samples.length) {
            await page.screenshot({ path: resolve(output, "saved-confirmation.png") });
          }
          // Undo restores the synthetic PR fixture before the next sample.
          const undone = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              /\/api\/commands\/[^/]+\/undo$/u.test(new URL(response.url()).pathname),
          );
          await page.getByRole("button", { name: /^Undo(?: |$)/ }).click();
          const undoResponse = await undone;
          const restored = await committedResult(page, undoResponse);
          const restoredTargets = restored.result.model?.items
            .flatMap((item) => item.variants)
            .filter((variant) => result.revisions.some((target) => target.id === variant.id));
          if (
            restored.result.noop ||
            restoredTargets?.length !== result.revisions.length ||
            restoredTargets.some(
              (variant) => variant.verdict !== null || variant.source !== null,
            ) ||
            restored.result.selection?.itemKey !== result.selection.itemKey ||
            restored.result.selection?.variantKey !== result.selection.variantKey
          ) {
            throw new Error("Undo must restore every saved target and the original selection.");
          }
          await page
            .locator(".review-save-state")
            .getByText("Undo saved. The original selection and verdicts were restored.", {
              exact: true,
            })
            .waitFor();
          await page.waitForFunction(
            (previous) =>
              document.querySelector('[aria-label="Variants"] [aria-current="page"]')?.id ===
              previous,
            previous,
          );
          await imageReady(page);
          if (!record.samples.length) {
            await page.screenshot({ path: resolve(output, "undo-restored.png") });
          }
          record.samples.push({
            ...measurement,
            undoStatus: restored.status,
            restoredTargets: restoredTargets.length,
          });
          write();
        }
      } catch (error) {
        record.errors.push({
          profile: profile.name,
          sample,
          message: String(error),
          pageTitle: await page.title(),
          visibleText: (await page.locator("body").innerText()).slice(0, 2000),
        });
        write();
        throw error;
      }
    }
  }
  record.summary = Object.fromEntries(
    profiles.map((profile) => [
      profile.name,
      Object.fromEntries(
        ["cold", "warm"].map((cache) => {
          const selected = record.samples.filter(
            (sample) => sample.profile === profile.name && sample.cache === cache,
          );
          return [
            cache,
            {
              openRunToFirstImageMs: summarize(
                selected.map((sample) => sample.openRunToFirstImageMs),
              ),
              saveToNextImageMs: summarize(selected.map((sample) => sample.saveToNextImageMs)),
              saveToConfirmationMs: summarize(
                selected.map((sample) => sample.saveToConfirmationMs),
              ),
            },
          ];
        }),
      ),
    ]),
  );
  write();
  if (record.errors.length) throw new Error("Route measurements contained page errors.");
  console.log(`Saved ${resolve(output, "measurements.json")}`);
  return record;
}
