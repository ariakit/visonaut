// Makes the card pictures of the gallery and of the directions page.
//
// Usage, while a lab server runs:
//
//   pnpm --filter @visonaut/lab capture
//   pnpm --filter @visonaut/lab capture --origin http://127.0.0.1:4371
//
// The list comes from the catalog: one picture of each variant of each
// surface, in each card theme. So a new card gets its pictures with no second
// list. The script sends GET requests only. It writes the files below
// `public/cards`, and it removes a file of that folder that no card uses.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
// Playwright is a dependency of the repository root. The lab does not declare
// it: the lab is temporary, and only this script uses it.
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { MINUTE, NOW } from "../src/fixtures/now.ts";
import {
  cardPictureFolder,
  cardThemes,
  getCardPicture,
  getCardPreviewSearch,
} from "../src/lab/card-pictures.ts";
import type { CardPicture } from "../src/lab/card-pictures.ts";
import { catalog } from "../src/lab/catalog.ts";
import { defaultKnobs } from "../src/lab/knobs.ts";

// The lab development server of `pnpm --filter @visonaut/lab dev`.
const defaultOrigin = "http://127.0.0.1:4320";

// All pictures together stay below 3 MB, so the gallery loads fast and the
// pictures stay a small part of the repository.
const sizeBudget = 3 * 1024 * 1024;

// A preview changes after its load: a fixture answers after 1.5 s at most,
// and one reference surface counts down to a retry. The script holds the
// clock of the preview and moves it by the settle time, so a picture shows
// the same moment on a fast and on a slow machine. The time is not a whole
// number of seconds: a countdown tick is then not at the end of the time.
const settleTime = 2500;
const settleStep = 100;

// After the settle time, React and the image decoder still work for a moment.
// The picture of a card is the first one that stays equal for the stable
// time. A preview that never rests gives its last picture.
const stableTime = 1000;
const stepTime = 250;
const captureLimit = 30_000;

const publicFolder = path.resolve(import.meta.dirname, "../public");

interface Shot {
  /** The path of the file below `public`, as the card requests it. */
  src: string;
  /** The bare preview that the picture shows. */
  url: string;
  picture: CardPicture;
}

function getShots(origin: string) {
  const shots: Shot[] = [];
  for (const surface of catalog.surfaces) {
    for (const variant of surface.variants) {
      for (const theme of cardThemes) {
        const picture = getCardPicture(surface, variant, theme);
        const { scenario, all, still } = getCardPreviewSearch(surface);
        const segments = [surface.kind, surface.id, variant.id].map(encodeURIComponent);
        const url = new URL(`/preview/${segments.join("/")}`, origin);
        // A picture has the default look in one theme. The URL names each
        // look control, so the preview does not read a saved look.
        const search = {
          scenario,
          ...defaultKnobs,
          theme,
          all: all ? "1" : undefined,
          still: still ? "1" : undefined,
        };
        for (const [name, value] of Object.entries(search)) {
          if (value == null) continue;
          url.searchParams.set(name, value);
        }
        shots.push({ src: picture.src, url: url.href, picture });
      }
    }
  }
  return shots;
}

async function takeStablePicture(page: Page) {
  // Playwright ends each finite animation and stops each endless one, so a
  // spinner and a pulse are the same in each picture.
  const shoot = () => page.screenshot({ animations: "disabled", caret: "hide" });
  const start = Date.now();
  let buffer = await shoot();
  let stableSince = Date.now();
  while (Date.now() - stableSince < stableTime) {
    if (Date.now() - start > captureLimit) break;
    await page.waitForTimeout(stepTime);
    const next = await shoot();
    if (next.equals(buffer)) continue;
    buffer = next;
    stableSince = Date.now();
  }
  return buffer;
}

async function capture(browser: Browser, shot: Shot) {
  const { viewport, scale } = shot.picture;
  await using context = await browser.newContext({ viewport, deviceScaleFactor: scale });
  // The script reads the server. It changes nothing there.
  await context.route("**/*", (route) => {
    if (route.request().method() === "GET") {
      return route.continue();
    }
    return route.abort();
  });
  const page = await context.newPage();
  // The clock stops before the preview loads, so no timer of the preview runs
  // during the load. It starts at the fixed present of the fixtures. The
  // clock runs between the two calls and cannot go back, so it stops one
  // minute later.
  await page.clock.install({ time: NOW });
  await page.clock.pauseAt(NOW + MINUTE);
  const response = await page.goto(shot.url, { waitUntil: "networkidle" });
  if (!response?.ok()) {
    throw new Error(`HTTP ${response?.status() ?? "error"} for ${shot.url}`);
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  for (let elapsed = 0; elapsed < settleTime; elapsed += settleStep) {
    await page.clock.runFor(settleStep);
    // A real pause: React renders between two steps, so a timer that a
    // render starts is on time.
    await page.waitForTimeout(50);
  }
  // The `await` keeps the context open until the picture exists.
  return await takeStablePicture(page);
}

/** The path below `public` of each file of the card folder. */
async function listPictureFiles() {
  const folder = path.join(publicFolder, cardPictureFolder);
  // The folder does not exist before the first picture.
  await mkdir(folder, { recursive: true });
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => `/${path.relative(publicFolder, path.join(entry.parentPath, entry.name))}`);
}

function formatSize(bytes: number) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

const { values } = parseArgs({ options: { origin: { type: "string", default: defaultOrigin } } });
const shots = getShots(values.origin);
let totalSize = 0;
let failures = 0;

{
  await using browser = await chromium.launch({ channel: "chrome" });
  for (const shot of shots) {
    try {
      const buffer = await capture(browser, shot);
      const file = path.join(publicFolder, shot.src);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, buffer);
      totalSize += buffer.length;
      console.log(`${shot.src}  ${formatSize(buffer.length)}`);
    } catch (error) {
      failures += 1;
      console.error(`${shot.src}  not captured: ${String(error)}`);
    }
  }
}

const used = new Set(shots.map((shot) => shot.src));
for (const src of await listPictureFiles()) {
  if (used.has(src)) continue;
  await rm(path.join(publicFolder, src));
  console.log(`${src}  removed: no card uses it`);
}

console.log(`${shots.length - failures} of ${shots.length} pictures, ${formatSize(totalSize)}`);
if (failures > 0) {
  process.exitCode = 1;
}
if (totalSize >= sizeBudget) {
  console.error(`The pictures are above the budget of ${formatSize(sizeBudget)}.`);
  process.exitCode = 1;
}
