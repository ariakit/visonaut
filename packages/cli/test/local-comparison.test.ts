import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { capturePagesDigest, captureRowView } from "@visonaut/protocol";
import type { Capture, CapturePage, CaptureRowView } from "@visonaut/protocol";
import { PNG } from "pngjs";
import { afterEach, expect, it, vi } from "vitest";
import { comparePixels, decodePng } from "../src/png-comparison.js";
import { fixture } from "./fixture.js";
import { json, pageService, referencePage } from "./page-service.js";
import type { PageServiceOptions, Prepared, ReferenceEntry } from "./page-service.js";
import { submitShard } from "./trusted.js";

const prepared = vi.hoisted((): Prepared => ({
  server: "https://visonaut.example",
  bundles: [],
  directory: "",
  directories: [],
}));
// Workflow tests cover artifact/job provenance; these cases start at the
// verified capture bundle.
vi.mock("../src/workflow.js", async () =>
  (await import("./page-service.js")).workflowMock(prepared),
);

const directories: string[] = prepared.directories;
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function image(width: number, height: number, rgba: number[]) {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data.set(rgba, index);
  }
  return PNG.sync.write(png);
}

function metadata(bytes: Buffer, width = 10, height = 10) {
  return {
    digest: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    width,
    height,
    mediaType: "image/png" as const,
  };
}

const environment = {
  VISONAUT_SERVER: prepared.server,
  GITHUB_RUN_ID: "456",
  GITHUB_RUN_ATTEMPT: "1",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/id-token",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-secret",
};

/**
 * Four captures: `same` has the bytes of its reference, `tolerated` differs inside the
 * allowance, `changed` has one other pixel, and `new` has no reference. The reference also has
 * the capture `removed`.
 */
async function localFixture() {
  const local = await fixture();
  directories.push(local.directory);
  const same = image(10, 10, [100, 100, 100, 255]);
  const tolerated = image(10, 10, [110, 110, 110, 255]);
  const white = image(10, 10, [255, 255, 255, 255]);
  const changed = PNG.sync.read(white);
  changed.data.set([0, 0, 0, 255], (5 * 10 + 5) * 4);
  const black = PNG.sync.write(changed);
  const entries = [
    { key: "same", bytes: same },
    { key: "tolerated", bytes: tolerated },
    { key: "changed", bytes: black },
    { key: "new", bytes: black },
  ];
  local.manifest.captures = await Promise.all(
    entries.map(async ({ key, bytes }, ordinal): Promise<Capture> => {
      const path = `${key}.png`;
      await writeFile(join(local.directory, path), bytes);
      return {
        ...local.capture,
        itemKey: key,
        ordinal,
        comparison: { threshold: 0.2, maxDiffPixels: 0 },
        image: { ...metadata(bytes), path },
      };
    }),
  );
  await writeFile(local.manifestPath, JSON.stringify(local.manifest));
  const profile = local.manifest.profiles[0]?.profile;
  if (!profile) throw new Error("The fixture has no profile.");
  const reference = ["changed", "removed", "same", "tolerated"].map((itemKey): ReferenceEntry => {
    const { mediaType: _mediaType, ...accepted } = metadata(
      itemKey === "changed" || itemKey === "removed" ? white : same,
    );
    return { itemKey, variant: local.capture.variant, profile, image: accepted };
  });
  const referenceImages = new Map<string, Uint8Array>([
    [metadata(white).digest, white],
    [metadata(same).digest, same],
  ]);
  return {
    ...local,
    reference,
    referenceImages,
    digests: {
      white: metadata(white).digest,
      same: metadata(same).digest,
      black: metadata(black).digest,
    },
  };
}

type Local = Awaited<ReturnType<typeof localFixture>>;

async function save(local: Local, captures: Capture[]) {
  local.manifest.captures = captures;
  await writeFile(local.manifestPath, JSON.stringify(local.manifest));
}

function only(local: Local, ...itemKeys: string[]) {
  return save(
    local,
    local.manifest.captures.filter((entry) => itemKeys.includes(entry.itemKey)),
  );
}

interface MockServiceOptions extends Omit<PageServiceOptions, "reference"> {
  reference?: ReferenceEntry[];
  pageSize?: number;
}

/** A service with the reference of `local`, in pages of `pageSize` rows. */
function mockService(
  local: Local,
  { reference = local.reference, pageSize = 2000, ...options }: MockServiceOptions = {},
) {
  const pages: CapturePage[] = [];
  for (let offset = 0; offset < reference.length; offset += pageSize) {
    pages.push(referencePage(reference.slice(offset, offset + pageSize)));
  }
  const service = pageService({
    runId: "run-1",
    referenceImages: local.referenceImages,
    ...options,
    reference: pages,
  });
  return {
    ...service,
    /** The digests of the reference images that the CLI read, in order. */
    downloads: () =>
      service
        .paths()
        .filter((path) => path.includes("/reference/images/"))
        .map((path) => path.split("/").at(-1)),
    pageRequests: () => service.paths().filter((path) => path.endsWith("/pages")).length,
    async rows() {
      const views = new Map<string, CaptureRowView>();
      for (const page of service.pages()) {
        for (const row of page.rows) {
          const view = await captureRowView(page, row);
          views.set(view.itemKey, view);
        }
      }
      return views;
    },
  };
}

async function execute(local: Local) {
  const { code, stdout, stderr } = await submitShard(prepared, [local], environment);
  return { code, output: stdout, error: stderr };
}

it("sends one row for each outcome and uploads only the changes and the mask", async () => {
  const local = await localFixture();
  const service = mockService(local);
  const result = await execute(local);
  expect(result.error).toBe("");
  expect(result.code).toBe(0);
  const rows = await service.rows();
  // The rows have the order of the item key, not the order of the capture job.
  expect([...rows.keys()]).toEqual(["changed", "new", "same", "tolerated"]);
  expect(rows.get("same")?.result).toBe(0);
  expect(rows.get("new")?.result).toBe(1);
  expect(rows.get("tolerated")?.result).toEqual({
    reference: local.digests.same,
    outcome: "unchanged",
    changedPixels: 0,
    ratio: 0,
    sizeChanged: false,
  });
  const changed = rows.get("changed")?.result;
  expect(changed).toEqual({
    reference: local.digests.white,
    outcome: "changed",
    changedPixels: 1,
    ratio: 0.01,
    sizeChanged: false,
    mask: {
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      bytes: expect.any(Number),
      width: 10,
      height: 10,
    },
  });
  // The removed capture is in no request: the service finds it in its own reference.
  expect(JSON.stringify([service.pages(), service.index()])).not.toContain("removed");
  expect(service.downloads()).toEqual([local.digests.white, local.digests.same]);
  // `changed` and `new` have the same bytes, so the uploads are that image and the mask.
  const mask = typeof changed === "object" ? changed.mask?.digest : undefined;
  expect([...service.uploads.keys()].sort()).toEqual([local.digests.black, mask].sort());
  const index = service.index();
  if (!index) throw new Error("The CLI sent no index.");
  const receipt = JSON.parse(await readFile(join(prepared.directory, "receipt.json"), "utf8"));
  expect(receipt.manifestDigest).toBe(await capturePagesDigest(index));
  expect(await readFile(join(local.directory, "output.txt"), "utf8")).toContain(
    `name=${receipt.artifactName}`,
  );
  expect(result.output + result.error).not.toContain("secret");
});

it.each([false, true])(
  "reuses identical reference bytes without reviewing a profile change: %s",
  async (profileChanged) => {
    const local = await localFixture();
    await only(local, "same");
    const reference = local.reference
      .filter((entry) => entry.itemKey === "same")
      .map((entry) => ({
        ...entry,
        profile: profileChanged ? { ...entry.profile, locale: "pt-BR" } : entry.profile,
      }));
    const service = mockService(local, { reference });
    const result = await execute(local);
    expect(service.downloads()).toEqual([]);
    expect(result.error).toBe("");
    expect(result.code).toBe(0);
    expect((await service.rows()).get("same")?.result).toBe(0);
    expect(service.uploads.size).toBe(0);
  },
);

it("reviews a profile change of a capture with other bytes and no changed pixel above the allowance", async () => {
  const local = await localFixture();
  await only(local, "tolerated");
  const [capture] = local.manifest.captures;
  if (!capture) throw new Error("No tolerated fixture capture");
  // With an allowance of 100 pixels, only the profile change makes the capture changed.
  await save(local, [{ ...capture, comparison: { threshold: 0, maxDiffPixels: 100 } }]);
  const reference = local.reference
    .filter((entry) => entry.itemKey === "tolerated")
    .map((entry) => ({ ...entry, profile: { ...entry.profile, locale: "pt-BR" } }));
  const service = mockService(local, { reference });
  expect((await execute(local)).code).toBe(0);
  expect((await service.rows()).get("tolerated")?.result).toMatchObject({
    outcome: "changed",
    changedPixels: 100,
  });
});

// Every PNG pass reads through pngjs, so the number of reads is the number of decodes.
// Submit validates each candidate once. A comparison decodes it again only when it needs pixels.
it.each([
  { itemKey: "same", decodes: 1, downloads: 0 },
  { itemKey: "new", decodes: 1, downloads: 0 },
  { itemKey: "tolerated", decodes: 3, downloads: 1 },
  { itemKey: "changed", decodes: 3, downloads: 1 },
])("decodes the $itemKey capture $decodes time(s)", async ({ itemKey, decodes, downloads }) => {
  const local = await localFixture();
  await only(local, itemKey);
  const service = mockService(local, {
    reference: local.reference.filter((entry) => entry.itemKey === itemKey),
  });
  const read = vi.spyOn(PNG.sync, "read");
  const result = await execute(local);
  expect(result.error).toBe("");
  expect(result.code).toBe(0);
  expect(service.downloads()).toHaveLength(downloads);
  expect(read).toHaveBeenCalledTimes(decodes);
});

it("names the screenshot when its file changes before the upload", async () => {
  const local = await localFixture();
  // The refused capture comes first in the page, before one that needs no upload.
  await only(local, "same", "new");
  const service = mockService(local, {
    reference: local.reference.filter((entry) => entry.itemKey === "same"),
    change: async (url, response) => {
      if (url.pathname.endsWith("/pages")) {
        const stored = join(prepared.directory, "images", `${local.digests.black}.png`);
        await writeFile(stored, Buffer.alloc(10, 1));
      }
      return response;
    },
  });
  const result = await execute(local);
  expect(result.code).toBe(1);
  expect(result.error).toBe(
    "visonaut: new (react-light): An image does not match its manifest size or digest. Run capture again.\n",
  );
  expect(service.uploads.size).toBe(0);
});

it("names no screenshot when a comparison mask file changes before the upload", async () => {
  const local = await localFixture();
  await only(local, "changed");
  const service = mockService(local, {
    reference: local.reference.filter((entry) => entry.itemKey === "changed"),
    change: async (url, response, options) => {
      if (url.pathname.endsWith("/pages") && options?.body instanceof Uint8Array) {
        const page: CapturePage = JSON.parse(Buffer.from(options.body).toString("utf8"));
        const result = page.rows[0]?.[11];
        const mask = typeof result === "object" ? result.mask : undefined;
        if (!mask) throw new Error("No comparison mask");
        const stored = join(prepared.directory, "local-masks", `${mask.digest}.png`);
        await writeFile(stored, Buffer.alloc(mask.bytes, 1));
        // The service has the candidate, so only the mask needs bytes.
        return {
          ...response,
          uploads: [
            { imageDigest: mask.digest, ticket: `ticket-${mask.digest}.`, maxBytes: mask.bytes },
          ],
        };
      }
      return response;
    },
  });
  const result = await execute(local);
  expect(result.code).toBe(1);
  // A mask is not a screenshot, and its name would show that the capture changed.
  expect(result.error).toBe(
    "visonaut: An image does not match its manifest size or digest. Run capture again.\n",
  );
  expect(service.pageRequests()).toBe(1);
});

it.each(["digest", "width", "height", "bytes"] as const)(
  "validates downloaded reference bytes when the %s of the reference row differs",
  async (field) => {
    const local = await localFixture();
    // `tolerated` is not the first capture, so its name shows that the label is its own key.
    const reference = local.reference.map((entry) =>
      entry.itemKey === "tolerated" || entry.itemKey === "same"
        ? {
            ...entry,
            image: {
              ...entry.image,
              [field]: field === "digest" ? "f".repeat(64) : entry.image[field] + 1,
            },
          }
        : entry,
    );
    const same = local.referenceImages.get(local.digests.same);
    if (!same) throw new Error("No reference bytes");
    // The service sends the real bytes for the digest that its row names.
    const service = mockService(local, {
      reference,
      referenceImages: new Map([...local.referenceImages, ["f".repeat(64), same]]),
    });
    await only(local, "tolerated");
    const result = await execute(local);
    expect(service.downloads()).toHaveLength(1);
    expect(result.code).toBe(1);
    expect(result.error).toBe(
      "visonaut: reference of tolerated (react-light): An image does not match its declared PNG metadata.\n",
    );
    expect(service.pageRequests()).toBe(0);
    expect(service.uploads.size).toBe(0);
  },
);

it.each(["width", "height", "bytes"] as const)(
  "refuses a reference row with the digest of the capture and another %s",
  async (field) => {
    const local = await localFixture();
    await only(local, "same");
    const reference = local.reference
      .filter((entry) => entry.itemKey === "same")
      .map((entry) => ({ ...entry, image: { ...entry.image, [field]: entry.image[field] + 1 } }));
    const service = mockService(local, { reference });
    const result = await execute(local);
    expect(result.code).toBe(1);
    expect(result.error).toContain("invalid reference image metadata");
    expect(service.downloads()).toEqual([]);
    expect(service.pageRequests()).toBe(0);
  },
);

it.each([1, 2, 3])(
  "reads a reference in pages of %i rows with the same result",
  async (pageSize) => {
    const local = await localFixture();
    const service = mockService(local, { pageSize });
    const result = await execute(local);
    expect(result.error).toBe("");
    expect(result.code).toBe(0);
    const pagePaths = service.paths().filter((path) => path.includes("/pages/"));
    expect(pagePaths.map((path) => Number(path.split("/").at(-1)))).toEqual(
      Array.from({ length: Math.ceil(4 / pageSize) }, (_, index) => index + 1),
    );
    const rows = await service.rows();
    expect(rows.get("same")?.result).toBe(0);
    expect(rows.get("new")?.result).toBe(1);
    expect(rows.get("changed")?.result).toMatchObject({ outcome: "changed" });
    expect(rows.get("tolerated")?.result).toMatchObject({ outcome: "unchanged" });
  },
);

it("reads no reference page after the last capture of the run", async () => {
  const local = await localFixture();
  await only(local, "changed");
  const service = mockService(local, { pageSize: 1 });
  expect((await execute(local)).code).toBe(0);
  // `changed` is the first capture of the reference, so the pages 2 to 4 are not necessary.
  expect(service.paths().filter((path) => path.includes("/pages/"))).toHaveLength(1);
});

it.each(["unordered", "duplicate"] as const)(
  "refuses a reference with %s captures from page to page",
  async (problem) => {
    const local = await localFixture();
    const [changed, removed, same, tolerated] = local.reference;
    if (!changed || !removed || !same || !tolerated) throw new Error("No reference");
    const reference =
      problem === "unordered"
        ? [changed, same, removed, tolerated]
        : [changed, removed, removed, tolerated];
    const service = mockService(local, { reference, pageSize: 2 });
    const result = await execute(local);
    expect(result.code).toBe(1);
    expect(result.error).toContain("duplicate or unordered captures");
    expect(service.pageRequests()).toBe(0);
  },
);

it.each(["key", "row", "schema"] as const)(
  "refuses a reference page with an invalid %s before it sends a page",
  async (problem) => {
    const local = await localFixture();
    const service = mockService(local, {
      change: (url, response) => {
        if (!url.pathname.includes("/pages/")) return response;
        const page = structuredClone(response);
        if (problem === "schema") return { ...page, schemaVersion: "2.0" };
        const rows = page.rows;
        if (!Array.isArray(rows) || !Array.isArray(rows[0])) throw new Error("No reference row");
        if (problem === "key") {
          rows[0][0] = "invalid:key";
        } else {
          rows[0].push(0);
        }
        return page;
      },
    });
    const result = await execute(local);
    expect(result.code).toBe(1);
    expect(service.downloads()).toEqual([]);
    expect(service.pageRequests()).toBe(0);
    expect(service.uploads.size).toBe(0);
    expect(result.error).not.toContain("secret");
  },
);

it("fails clearly when the service says that the reference is stale", async () => {
  const local = await localFixture();
  const service = mockService(local, {
    respond: (url) =>
      url.pathname.includes("/pages/")
        ? json(
            { schemaVersion: "1.0", error: { code: "stale_reference", message: "private" } },
            409,
          )
        : undefined,
  });
  const result = await execute(local);
  expect(result.code).toBe(1);
  expect(result.error).toContain("Rerun Submit");
  expect(service.pageRequests()).toBe(0);
});

it.each(["png", "dimensions", "settings", "webp", "result"] as const)(
  "does not request credentials for invalid local %s",
  async (failure) => {
    const local = await localFixture();
    const capture = local.manifest.captures[0];
    if (!capture) {
      throw new Error("No fixture capture");
    }
    if (failure === "png") {
      const bytes = Buffer.from("not a png");
      capture.image = { ...metadata(bytes), path: capture.image.path };
      await writeFile(join(local.directory, capture.image.path), bytes);
    } else if (failure === "dimensions") {
      capture.image.width++;
    } else if (failure === "settings") {
      delete capture.comparison;
    } else if (failure === "webp") {
      capture.image.mediaType = "image/webp";
    } else {
      // A capture job cannot supply the result of the comparison.
      local.manifest.localComparison = {
        mode: "local-v1",
        engineVersion: "playwright-pixelmatch-1.63.0",
        codecVersion: "pngjs-7.0.0",
        reference: {
          manifestDigest: "a".repeat(64),
          snapshotId: null,
          baselineRevision: 0,
          inventoryDigest: "b".repeat(64),
          captureCount: 0,
        },
        captures: local.manifest.captures.map((entry) => ({
          itemKey: entry.itemKey,
          variantKey: entry.variant.key,
          candidateDigest: entry.image.digest,
          referenceDigest: entry.image.digest,
          outcome: "unchanged",
          changedPixels: 0,
          ratio: 0,
          sizeChanged: false,
        })),
        removals: [],
      };
    }
    await writeFile(local.manifestPath, JSON.stringify(local.manifest));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await execute(local)).code).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it.each(["encoded", "pixels", "dimension"] as const)(
  "rejects excessive %s before credentials",
  async (bound) => {
    const local = await localFixture();
    const capture = local.manifest.captures[0];
    if (!capture) {
      throw new Error("No fixture capture");
    }
    const width = bound === "pixels" ? 1500 : bound === "dimension" ? 8193 : 10;
    const height = bound === "pixels" ? 1500 : 1;
    const bytes =
      bound === "encoded"
        ? Buffer.alloc(2 * 1024 * 1024 + 1)
        : image(width, height, [255, 255, 255, 255]);
    capture.image = { ...metadata(bytes, width, height), path: capture.image.path };
    await writeFile(join(local.directory, capture.image.path), bytes);
    await writeFile(local.manifestPath, JSON.stringify(local.manifest));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await execute(local)).code).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  "renews with one reserve call and rejects a hidden baseline switch: %s",
  async (switchReference) => {
    const local = await localFixture();
    // The first capability is inside the headroom of 45 seconds, so the first request renews it.
    const service = mockService(local, {
      lifetimeMs: (call) => (call === 1 ? 40_000 : 600_000),
      referenceDigest: (call) => (switchReference && call === 2 ? "8".repeat(64) : "9".repeat(64)),
    });
    const result = await execute(local);
    expect(service.reserveBodies).toHaveLength(2);
    expect(result.code).toBe(switchReference ? 1 : 0);
    if (switchReference) {
      expect(result.error).toContain("Rerun Submit");
      expect(service.pageRequests()).toBe(0);
      return;
    }
    // A renewal reads no reference page again: each page is read one time.
    expect(service.paths().filter((path) => path.includes("/pages/"))).toHaveLength(1);
  },
);

it.each(["run", "lifetime"] as const)("stops a renewal that changes the %s", async (problem) => {
  const local = await localFixture();
  const service = mockService(local, {
    lifetimeMs: (call) => (call === 1 || problem === "lifetime" ? 40_000 : 600_000),
    change: (url, response) =>
      url.pathname === "/v1/runs" && problem === "run" && service.reserveBodies.length === 2
        ? { ...response, runId: "run-2" }
        : response,
  });
  const result = await execute(local);
  expect(result.code).toBe(problem === "run" ? 1 : 4);
  // No loop: one renewal, then the stop.
  expect(service.reserveBodies).toHaveLength(2);
  expect(service.pageRequests()).toBe(0);
});

it("matches the pinned Playwright oracle for YIQ, both caps, alpha, and dimensions", async () => {
  const require = createRequire(import.meta.url);
  // The private comparator is a test oracle; it is absent from shipped CLI code.
  const playwrightRequire = createRequire(require.resolve("@playwright/test/package.json"));
  const coreRequire = createRequire(playwrightRequire.resolve("playwright/package.json"));
  const { utils } = coreRequire(
    join(dirname(coreRequire.resolve("playwright-core/package.json")), "lib/coreBundle.js"),
  );
  const oracle = utils.getComparator("image/png");
  const white = image(10, 10, [255, 255, 255, 255]);
  const blackPixel = PNG.sync.read(white);
  blackPixel.data.set([0, 0, 0, 255], (5 * 10 + 5) * 4);
  const black = PNG.sync.write(blackPixel);
  const edge = PNG.sync.read(white);
  for (let row = 0; row < 10; row++) {
    for (let column = 0; column <= 4; column++) {
      const value = column === 4 ? 128 : 0;
      edge.data.set([value, value, value, 255], (row * 10 + column) * 4);
    }
  }
  const edgeReference = PNG.sync.write(edge);
  for (let row = 0; row < 10; row++) {
    edge.data.set([64, 64, 64, 255], (row * 10 + 4) * 4);
  }
  const cases = [
    {
      candidate: image(10, 10, [110, 110, 110, 255]),
      reference: image(10, 10, [100, 100, 100, 255]),
      comparison: { threshold: 0.2 },
    },
    {
      candidate: image(10, 10, [110, 110, 110, 255]),
      reference: image(10, 10, [100, 100, 100, 255]),
      comparison: { threshold: 0 },
    },
    { candidate: black, reference: white, comparison: { threshold: 0.2 } },
    { candidate: black, reference: white, comparison: { threshold: 0.2, maxDiffPixels: 1 } },
    {
      candidate: black,
      reference: white,
      comparison: { threshold: 0.2, maxDiffPixelRatio: 0.006 },
    },
    {
      candidate: black,
      reference: white,
      comparison: { threshold: 0.2, maxDiffPixels: 0, maxDiffPixelRatio: 1 },
    },
    {
      candidate: image(11, 10, [255, 255, 255, 255]),
      reference: white,
      comparison: { threshold: 0.2, maxDiffPixels: 1000 },
    },
    {
      candidate: image(10, 10, [255, 0, 0, 0]),
      reference: image(10, 10, [0, 0, 255, 0]),
      comparison: { threshold: 0.2 },
    },
    { candidate: PNG.sync.write(edge), reference: edgeReference, comparison: { threshold: 0 } },
    {
      candidate: PNG.sync.write(PNG.sync.read(white), { deflateLevel: 0 }),
      reference: white,
      comparison: { threshold: 0.2 },
    },
  ];
  for (const entry of cases) {
    const result = comparePixels({
      candidate: PNG.sync.read(entry.candidate),
      reference: PNG.sync.read(entry.reference),
      comparison: entry.comparison,
      profileChanged: false,
    });
    expect(result.outcome === "unchanged").toBe(
      oracle(entry.candidate, entry.reference, entry.comparison) === null,
    );
  }
  expect(
    comparePixels({
      candidate: PNG.sync.read(white),
      reference: PNG.sync.read(white),
      comparison: { threshold: 0.2, maxDiffPixels: 1000 },
      profileChanged: true,
    }),
  ).toMatchObject({ outcome: "unchanged", changedPixels: 0, sizeChanged: false });
  expect(
    comparePixels({
      candidate: PNG.sync.read(black),
      reference: PNG.sync.read(white),
      comparison: { threshold: 0.2, maxDiffPixels: 1000 },
      profileChanged: true,
    }),
  ).toMatchObject({ outcome: "changed", changedPixels: 1, sizeChanged: false });
  await expect(
    decodePng(white, { ...metadata(white), width: 100_000 }, "item (variant)"),
  ).rejects.toThrow("item (variant): ");
});
