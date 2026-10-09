import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CAPTURE_PAGE_ROWS,
  capturePagesDigest,
  captureRowView,
  compareCaptureIdentity,
  digestJson,
} from "@visonaut/protocol";
import type { Capture, CapturePage, CaptureProfile } from "@visonaut/protocol";
import { PNG } from "pngjs";
import { afterEach, expect, it, vi } from "vitest";
import { fixture, imageBytes } from "./fixture.js";
import { pageService, sha256Hex } from "./page-service.js";
import type { Prepared } from "./page-service.js";
import { submitShard } from "./trusted.js";

const prepared = vi.hoisted((): Prepared => ({
  server: "https://visonaut.example",
  bundles: [],
  directory: "",
  directories: [],
}));
// Workflow tests cover the artifacts and the job provenance. These cases start at verified
// capture bundles.
vi.mock("../src/workflow.js", async () =>
  (await import("./page-service.js")).workflowMock(prepared),
);

const environment = {
  VISONAUT_SERVER: prepared.server,
  GITHUB_RUN_ID: "456",
  GITHUB_RUN_ATTEMPT: "1",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/id-token",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-secret",
};
const directories: string[] = prepared.directories;
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function png(rgba: number[]) {
  const image = new PNG({ width: 1, height: 1 });
  image.data.set(rgba);
  return PNG.sync.write(image);
}

interface BundleCapture {
  itemKey: string;
  bytes?: Buffer;
}

/** One capture job with one test and the given captures, in the given order. */
async function bundle(shard: string, captures: BundleCapture[]) {
  const local = await fixture();
  directories.push(local.directory);
  local.manifest.shard.key = shard;
  const [record] = local.manifest.profiles;
  if (!record) throw new Error("The fixture has no profile.");
  // The item key is also the display name here.
  const { name: _name, ...capture } = local.capture;
  const profiles = new Map<string, CaptureProfile>();
  const entries: Capture[] = [];
  for (const [ordinal, { itemKey, bytes = imageBytes }] of captures.entries()) {
    // Each capture has its own clip rectangle, as each capture of a real run has.
    const profile: CaptureProfile = {
      ...record.profile,
      captureOptions: {
        ...record.profile.captureOptions,
        clip: { x: ordinal, y: 0, width: 1, height: 1 },
      },
    };
    const profileDigest = await digestJson(profile);
    profiles.set(profileDigest, profile);
    const path = `${sha256Hex(bytes)}.png`;
    await writeFile(join(local.directory, path), bytes);
    entries.push({
      ...capture,
      itemKey,
      ordinal,
      profileDigest,
      image: { ...local.capture.image, digest: sha256Hex(bytes), bytes: bytes.length, path },
    });
  }
  local.manifest.profiles = [...profiles].map(([digest, profile]) => ({ digest, profile }));
  local.manifest.captures = entries;
  await writeFile(local.manifestPath, JSON.stringify(local.manifest));
  return local;
}

const key = (position: number) => `item-${String(position).padStart(5, "0")}`;

it("sends 4,100 captures of 3 capture jobs as 3 pages and one index", async () => {
  // The capture jobs hold the captures in another order than the order of the format.
  const positions = Array.from({ length: 4100 }, (_, position) => position);
  const jobs = [
    positions.filter((position) => position % 3 === 0).reverse(),
    positions.filter((position) => position % 3 === 1),
    positions.filter((position) => position % 3 === 2).reverse(),
  ];
  const bundles = await Promise.all(
    jobs.map((job, index) =>
      bundle(
        `job-${index}`,
        job.map((position) => ({ itemKey: key(position) })),
      ),
    ),
  );
  const service = pageService();
  const result = await submitShard(prepared, bundles, environment);
  const { directory } = prepared;
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);

  const pages = service.pages();
  expect(pages.map((page) => page.rows.length)).toEqual([
    CAPTURE_PAGE_ROWS,
    CAPTURE_PAGE_ROWS,
    100,
  ]);
  const views = [];
  for (const page of pages) {
    for (const row of page.rows) {
      views.push(await captureRowView(page, row));
    }
  }
  expect(views.map((view) => view.itemKey)).toEqual(positions.map(key));
  // No reference exists, so each capture is new.
  expect(new Set(views.map((view) => view.result))).toEqual(new Set([1]));
  // 4,100 clip rectangles are in the rows, and each page has one profile.
  expect(pages.map((page) => page.profiles.length)).toEqual([1, 1, 1]);
  // The item 4099 is capture 1366 of the second capture job.
  expect(views[4099]?.profile.captureOptions.clip).toEqual({ x: 1366, y: 0, width: 1, height: 1 });
  expect(views[4099]?.test.id).toBe("job-1/test-1");

  const index = service.index();
  if (!index) throw new Error("The CLI sent no index.");
  expect(index.pages.map((entry) => entry.last)).toEqual([
    [key(1999), "react-light"],
    [key(3999), "react-light"],
    [key(4099), "react-light"],
  ]);
  expect(await Promise.all(pages.map((page) => digestJson(page)))).toEqual(
    index.pages.map((entry) => entry.digest),
  );
  expect(index.sources.map((source) => source.shardKey)).toEqual(["job-0", "job-1", "job-2"]);
  expect(index.job).toEqual({ id: "789", attempt: 1 });
  expect(index.reference).toEqual({ snapshotId: null, baselineRevision: 0, digest: null });
  expect(Object.keys(index)).not.toContain("captures");

  // 9 requests: 2 tokens, reserve, 3 pages, 1 image (4,100 captures share its bytes), the
  // index, and submit.
  expect(service.paths()).toEqual([
    "/id-token",
    "/v1/runs",
    "/v1/runs/run-123/pages",
    `/v1/uploads/ticket-${sha256Hex(imageBytes)}.`,
    "/v1/runs/run-123/pages",
    "/v1/runs/run-123/pages",
    "/v1/runs/run-123/index",
    "/id-token",
    "/v1/runs/456/submit",
  ]);
  const manifestDigest = await capturePagesDigest(index);
  const receipt = JSON.parse(await readFile(join(directory, "receipt.json"), "utf8"));
  expect(receipt).toEqual({
    schemaVersion: "1.0",
    artifactName: `visonaut-discovery-1-789-combined-${manifestDigest}`,
    manifestDigest,
    workflowRunId: "456",
    workflowAttempt: 1,
    testedSha: "d".repeat(40),
    jobId: "789",
    shardKey: "combined",
  });
  expect(await readFile(join(bundles[0]?.directory ?? "", "output.txt"), "utf8")).toBe(
    `name=${receipt.artifactName}\npath=${join(directory, "receipt.json")}\n`,
  );
}, 60_000);

it("compares 4,100 captures with a reference of 3 pages, one reference page at a time", async () => {
  const white = png([255, 255, 255, 255]);
  const black = png([0, 0, 0, 255]);
  const reference = await (async () => {
    // The accepted run: the items 0 to 4,199 without each item that divides by 1,000.
    const kept = Array.from({ length: 4200 }, (_, position) => position).filter(
      (position) => position % 1000 !== 0,
    );
    const accepted = await bundle(
      "job-0",
      kept.map((position) => ({ itemKey: key(position), bytes: white })),
    );
    const service = pageService();
    expect((await submitShard(prepared, [accepted], environment)).code).toBe(0);
    return service.pages();
  })();
  expect(reference.map((page) => page.rows.length)).toEqual([2000, 2000, 195]);

  // The new run: the items 0 to 4,099. The items 0, 1000, 2000, 3000, and 4000 are new, the
  // items 4,100 to 4,199 are removed, and the items 1999 and 2001 changed.
  const captures = Array.from({ length: 4100 }, (_, position) => ({
    itemKey: key(position),
    bytes: position === 1999 || position === 2001 ? black : white,
  }));
  const bundles = [
    await bundle(
      "job-0",
      captures.filter((_, position) => position % 2 === 0),
    ),
    await bundle(
      "job-1",
      captures.filter((_, position) => position % 2 === 1),
    ),
  ];
  const service = pageService({
    reference,
    referenceImages: new Map([[sha256Hex(white), white]]),
  });
  const result = await submitShard(prepared, bundles, environment);
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);

  const pages = service.pages();
  expect(pages.map((page) => page.rows.length)).toEqual([2000, 2000, 100]);
  const results = new Map<string, unknown>();
  for (const page of pages) {
    for (const row of page.rows) {
      const view = await captureRowView(page, row);
      if (view.result !== 0) results.set(view.itemKey, view.result);
    }
  }
  const changed = {
    reference: sha256Hex(white),
    outcome: "changed",
    changedPixels: 1,
    ratio: 1,
    sizeChanged: false,
    mask: expect.objectContaining({ width: 1, height: 1 }),
  };
  expect(Object.fromEntries(results)).toEqual({
    [key(0)]: 1,
    [key(1000)]: 1,
    [key(1999)]: changed,
    [key(2000)]: 1,
    [key(2001)]: changed,
    [key(3000)]: 1,
    [key(4000)]: 1,
  });
  // Each reference page is read one time, in order, and the reference image one time for each
  // changed capture. The first reference page ends after the item 2001. The uploads are the
  // image of the new captures, the changed image, and one mask.
  const paths = service.paths();
  const referencePaths = paths.filter((path) => path.includes("/reference/"));
  const pagePath = (number: number) =>
    `/v1/runs/run-123/reference/${"9".repeat(64)}/pages/${number}`;
  const imagePath = `/v1/runs/run-123/reference/images/${sha256Hex(white)}`;
  expect(referencePaths).toEqual([pagePath(1), imagePath, imagePath, pagePath(2), pagePath(3)]);
  expect(paths.filter((path) => path.startsWith("/v1/uploads/"))).toHaveLength(3);
  expect(service.uploads.has(sha256Hex(white))).toBe(true);
  expect(service.uploads.has(sha256Hex(black))).toBe(true);
  expect(service.index()?.reference).toEqual({
    snapshotId: "accepted",
    baselineRevision: 3,
    digest: "9".repeat(64),
  });
  // The rows of the run and of the reference have the order of the format.
  const identities = pages.flatMap((page: CapturePage) =>
    page.rows.map((row): [string, string] => [row[0], page.variants[row[2]]?.key ?? ""]),
  );
  expect(identities.toSorted(compareCaptureIdentity)).toEqual(identities);
}, 120_000);
