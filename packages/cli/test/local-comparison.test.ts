import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { digestJson, captureManifestDigest, uploadImages } from "@visonaut/protocol";
import type { Capture, LocalReferenceCapture, Manifest } from "@visonaut/protocol";
import { PNG } from "pngjs";
import { afterEach, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";
import { comparePixels, decodePng } from "../src/png-comparison.js";
import { fixture } from "./fixture.js";

const prepared = vi.hoisted(() => ({ directory: "", server: "https://visonaut.example" }));
// Workflow tests cover artifact/job provenance; these cases start at the
// verified combined manifest.
vi.mock("../src/workflow.js", () => ({ runWorkflowCommand: async () => prepared }));

const directories: string[] = [];
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

async function localFixture() {
  const local = await fixture();
  directories.push(local.directory);
  prepared.directory = local.directory;
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
  local.manifest.discovery = {
    executorDigest: "e".repeat(64),
    configurationDigest: "f".repeat(64),
    inventoryDigest: "a".repeat(64),
  };
  await writeFile(local.manifestPath, JSON.stringify(local.manifest));
  const reference = ["changed", "removed", "same", "tolerated"].map(
    (itemKey): LocalReferenceCapture => ({
      itemKey,
      variantKey: local.capture.variant.key,
      captureId: `capture-${itemKey}`,
      imageId: `image-${itemKey}`,
      profileDigest: local.capture.profileDigest,
      image: metadata(itemKey === "changed" || itemKey === "removed" ? white : same),
      path: `/v1/runs/run-1/reference/images/image-${itemKey}`,
    }),
  );
  const environment = {
    VISONAUT_SERVER: prepared.server,
    GITHUB_RUN_ID: "456",
    GITHUB_RUN_ATTEMPT: "1",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/id-token",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
    GITHUB_OUTPUT: join(local.directory, "output.txt"),
  };
  return {
    ...local,
    reference,
    referenceBytes: new Map(
      reference.map((entry) => [
        entry.imageId,
        entry.itemKey === "changed" || entry.itemKey === "removed" ? white : same,
      ]),
    ),
    environment,
  };
}

interface MockOptions {
  reference?: LocalReferenceCapture[];
  mode?: boolean;
  corruptReference?: boolean;
  incomplete?: boolean;
  arbitraryPath?: boolean;
  stale?: boolean;
  expireAfterUploads?: boolean;
  expireAfterComparison?: boolean;
  switchReferenceOnRenew?: boolean;
  pageSize?: number;
  repeatCursor?: boolean;
}

async function mockService(
  local: Awaited<ReturnType<typeof localFixture>>,
  options: MockOptions = {},
) {
  const originalDigest = await captureManifestDigest(local.manifest);
  const reference = options.reference ?? local.reference;
  const binding = {
    manifestDigest: originalDigest,
    snapshotId: "accepted",
    baselineRevision: 3,
    inventoryDigest: await digestJson(reference),
    captureCount: reference.length,
  };
  const declarations: Manifest[] = [];
  const downloads: string[] = [];
  const uploads: { digest: string; bytes: number }[] = [];
  let reserves = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.hostname.endsWith(".actions.githubusercontent.com")) {
        return Response.json({ value: "oidc-secret" });
      }
      const expiresAt = new Date(Date.now() + 600_000).toISOString();
      if (url.pathname === "/v1/runs") {
        reserves++;
        return Response.json({
          schemaVersion: "1.0",
          runId: "run-1",
          capability: "unbound-secret",
          expiresAt,
          ...(options.mode === false ? {} : { comparisonMode: "local-v1" }),
        });
      }
      if (url.pathname === "/v1/runs/run-1/reference") {
        const body = JSON.parse(String(init?.body));
        expect(body.manifestDigest).toBe(originalDigest);
        if (options.stale) {
          return Response.json({ error: { code: "stale_reference" } }, { status: 409 });
        }
        const start = Number(body.cursor ?? 0);
        const end = start + (options.pageSize ?? reference.length);
        return Response.json({
          schemaVersion: "1.0",
          comparisonMode: "local-v1",
          reference:
            options.switchReferenceOnRenew && reserves > 1
              ? { ...binding, baselineRevision: 4 }
              : binding,
          captures: options.incomplete
            ? reference.slice(0, -1)
            : options.arbitraryPath
              ? reference.map((entry) => ({ ...entry, path: "https://attacker.example/image" }))
              : reference.slice(start, end),
          nextCursor: end >= reference.length ? null : String(options.repeatCursor ? 0 : end),
          capability: "reference-secret",
          expiresAt,
        });
      }
      if (url.pathname.startsWith("/v1/runs/run-1/reference/images/")) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer reference-secret");
        const imageId = url.pathname.split("/").at(-1);
        if (!imageId) {
          throw new Error("No image ID");
        }
        downloads.push(imageId);
        if (options.expireAfterComparison && imageId === "image-changed") {
          vi.setSystemTime(Date.now() + 650_000);
        }
        const bytes = local.referenceBytes.get(imageId);
        if (!bytes) {
          return new Response(null, { status: 404 });
        }
        return new Response(
          Uint8Array.from(options.corruptReference ? Buffer.from("corrupt") : bytes),
          { headers: { "Content-Type": "image/png" } },
        );
      }
      if (url.pathname.startsWith("/v1/runs/run-1/shards/")) {
        const manifest: Manifest = JSON.parse(String(init?.body));
        declarations.push(manifest);
        const images = uploadImages(manifest);
        return Response.json({
          schemaVersion: "1.0",
          manifestDigest: await digestJson(manifest),
          uploads: [...images.values()]
            .filter((entry) => !uploads.some((upload) => upload.digest === entry.digest))
            .map((entry) => ({
              imageDigest: entry.digest,
              ticket: entry.digest,
              maxBytes: entry.bytes,
            })),
        });
      }
      if (url.pathname.startsWith("/v1/uploads/")) {
        const bytes = Buffer.from(init?.body instanceof Uint8Array ? init.body : []);
        uploads.push({
          digest: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.length,
        });
        if (options.expireAfterUploads && uploads.length === 2) {
          vi.setSystemTime(Date.now() + 650_000);
        }
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/v1/runs/run-1/finalize") {
        return Response.json({
          schemaVersion: "1.0",
          runId: "run-1",
          shardKey: local.manifest.shard.key,
          manifestDigest: JSON.parse(String(init?.body)).manifestDigest,
          state: "staged",
        });
      }
      if (url.pathname === "/v1/runs/456/submit") {
        return Response.json({
          schemaVersion: "1.0",
          runId: "run-1",
          state: "submitted",
          submittedAt: 1,
        });
      }
      throw new Error(`Unexpected request ${url.pathname}`);
    }),
  );
  return { declarations, uploads, downloads, reserves: () => reserves, originalDigest };
}

async function execute(environment: Record<string, string | undefined>) {
  let output = "";
  let error = "";
  const code = await runCli({
    argv: ["submit", "--shard", "chrome-1"],
    environment,
    stdout: (value) => {
      output += value;
    },
    stderr: (value) => {
      error += value;
    },
  });
  return { code, output, error };
}

it("keeps tolerated observed bytes in the full manifest and uploads only unique changes plus the mask", async () => {
  const local = await localFixture();
  const service = await mockService(local);
  const result = await execute(local.environment);
  expect(result.error).toBe("");
  expect(result.code).toBe(0);
  expect(service.uploads).toHaveLength(2);
  const declared = service.declarations[0];
  expect(declared?.captures).toEqual(local.manifest.captures);
  expect(declared?.localComparison?.reference.manifestDigest).toBe(service.originalDigest);
  expect(declared?.localComparison?.captures.map((entry) => entry.outcome)).toEqual([
    "unchanged",
    "unchanged",
    "changed",
    "changed",
  ]);
  expect(declared?.localComparison?.removals).toEqual([
    { itemKey: "removed", variantKey: local.capture.variant.key },
  ]);
  expect(service.downloads).toEqual(["image-tolerated", "image-changed"]);
  expect(
    service.uploads.some((entry) => entry.digest === local.manifest.captures[1]?.image.digest),
  ).toBe(false);
  const saved: Manifest = JSON.parse(await readFile(local.manifestPath, "utf8"));
  const receipt = JSON.parse(await readFile(join(local.directory, "receipt.json"), "utf8"));
  expect(saved).toEqual(declared);
  expect(receipt.manifestDigest).toBe(await digestJson(saved));
  expect(await readFile(local.environment.GITHUB_OUTPUT, "utf8")).toContain(
    `name=${receipt.artifactName}`,
  );
  expect(result.output + result.error).not.toContain("secret");
  const originalImages = new Map(
    local.manifest.captures.map((entry) => [entry.image.digest, entry.image.bytes]),
  );
  const counts = {
    captures: local.manifest.captures.length,
    removals: declared?.localComparison?.removals.length,
    encodedOriginalBytes: [...originalImages.values()].reduce((sum, bytes) => sum + bytes, 0),
    physicalOriginalUploads: service.uploads.filter((upload) => originalImages.has(upload.digest))
      .length,
    physicalMaskUploads: service.uploads.filter((upload) => !originalImages.has(upload.digest))
      .length,
    attemptedUploadBytes: service.uploads.reduce((sum, upload) => sum + upload.bytes, 0),
    referenceDownloads: service.downloads.length,
    omittedToleratedBytes: local.manifest.captures[1]?.image.bytes,
  };
  console.info(`LOCAL_COMPARISON_FIXTURE ${JSON.stringify(counts)}`);
});

it.each([false, true])(
  "reuses identical reference bytes and preserves a profile change: %s",
  async (profileChanged) => {
    const local = await localFixture();
    const capture = local.manifest.captures.find((entry) => entry.itemKey === "same");
    if (!capture) {
      throw new Error("No identical fixture capture");
    }
    local.manifest.captures = [capture];
    await writeFile(local.manifestPath, JSON.stringify(local.manifest));
    const reference = local.reference
      .filter((entry) => entry.itemKey === "same")
      .map((entry) => ({
        ...entry,
        profileDigest: profileChanged ? "f".repeat(64) : entry.profileDigest,
      }));
    const service = await mockService(local, { reference });
    const result = await execute(local.environment);
    expect(service.downloads).toEqual([]);
    expect(result.error).toBe("");
    expect(result.code).toBe(0);
    expect(service.declarations[0]?.localComparison?.captures).toEqual([
      {
        itemKey: capture.itemKey,
        variantKey: capture.variant.key,
        candidateDigest: capture.image.digest,
        referenceDigest: capture.image.digest,
        outcome: profileChanged ? "changed" : "unchanged",
        changedPixels: 0,
        ratio: 0,
        sizeChanged: false,
      },
    ]);
    expect(service.uploads).toEqual(
      profileChanged ? [{ digest: capture.image.digest, bytes: capture.image.bytes }] : [],
    );
  },
);

it.each(["digest", "width", "height", "bytes"] as const)(
  "validates downloaded reference bytes when %s metadata differs",
  async (field) => {
    const local = await localFixture();
    const reference = local.reference.map((entry) =>
      entry.itemKey === "same"
        ? {
            ...entry,
            image: {
              ...entry.image,
              [field]: field === "digest" ? "f".repeat(64) : entry.image[field] + 1,
            },
          }
        : entry,
    );
    const service = await mockService(local, { reference });
    const result = await execute(local.environment);
    expect(service.downloads).toEqual(["image-same"]);
    expect(result.code).toBe(1);
    expect(result.error).toContain("An image does not match its declared PNG metadata.");
    expect(service.declarations).toEqual([]);
    expect(service.uploads).toEqual([]);
  },
);

it.each(["current", "inherited", "legacy long"] as const)(
  "submits accepted reference captures with %s service IDs",
  async (source) => {
    const local = await localFixture();
    const runId = "dd4cff79-0dd7-4b09-a882-f0524e648206";
    // These ID forms come from workflow materialization and shard inheritance.
    const reference = await Promise.all(
      local.reference.map(async (entry, ordinal) => {
        const captureId = `${runId}:${await digestJson([entry.itemKey, entry.variantKey])}`;
        return {
          ...entry,
          captureId:
            source === "inherited"
              ? `${runId}:inherited:0:${ordinal}`
              : source === "legacy long"
                ? `${`${runId}:`.repeat(20)}${captureId}`
                : captureId,
        };
      }),
    );
    const service = await mockService(local, { reference, pageSize: 2 });
    const result = await execute(local.environment);
    expect(result.error).toBe("");
    expect(result.code).toBe(0);
    expect(service.declarations[0]?.localComparison?.reference.inventoryDigest).toBe(
      await digestJson(reference),
    );
    expect(service.downloads).toEqual(["image-tolerated", "image-changed"]);
    expect(service.uploads).toHaveLength(2);
  },
);

it("refuses invalid opaque reference capture IDs before upload", async () => {
  for (const captureId of ["", "invalid\u0000id", "invalid\u0080id", "x".repeat(4097)]) {
    const local = await localFixture();
    const reference = local.reference.map((entry) => ({ ...entry, captureId }));
    const service = await mockService(local, { reference });
    const result = await execute(local.environment);
    expect(result.code).toBe(1);
    expect(service.downloads).toHaveLength(0);
    expect(service.declarations).toHaveLength(0);
    expect(service.uploads).toHaveLength(0);
    expect(result.error).not.toContain("secret");
  }
});

it.each(["itemKey", "variantKey"] as const)(
  "keeps reference %s validation strict",
  async (field) => {
    const local = await localFixture();
    const reference = local.reference.map((entry) => ({ ...entry, [field]: "invalid:key" }));
    const service = await mockService(local, { reference });
    expect((await execute(local.environment)).code).toBe(1);
    expect(service.downloads).toHaveLength(0);
    expect(service.declarations).toHaveLength(0);
    expect(service.uploads).toHaveLength(0);
  },
);

it.each(["mode", "corruptReference", "incomplete", "arbitraryPath", "stale"] as const)(
  "fails clearly before upload for %s",
  async (failure) => {
    const local = await localFixture();
    const service = await mockService(
      local,
      failure === "mode" ? { mode: false } : { [failure]: true },
    );
    const result = await execute(local.environment);
    expect(result.code).toBe(1);
    expect(service.uploads).toHaveLength(0);
    expect(service.declarations).toHaveLength(0);
    expect(result.error).not.toContain("secret");
    if (failure === "stale") {
      expect(result.error).toContain("Rerun Submit");
    }
  },
);

it.each(["png", "dimensions", "settings", "webp"] as const)(
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
    } else {
      capture.image.mediaType = "image/webp";
    }
    await writeFile(local.manifestPath, JSON.stringify(local.manifest));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await execute(local.environment)).code).toBe(1);
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
    expect((await execute(local.environment)).code).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("rejects an accepted WebP reference without downloading or uploading bytes", async () => {
  const local = await localFixture();
  const reference = local.reference.map((entry) =>
    entry.itemKey === "same"
      ? { ...entry, image: { ...entry.image, mediaType: "image/webp" as const } }
      : entry,
  );
  const service = await mockService(local, { reference });
  const result = await execute(local.environment);
  expect(result.code).toBe(1);
  expect(result.error).toContain("accepted reference is WebP");
  expect(service.uploads).toHaveLength(0);
  expect(service.downloads).toHaveLength(0);
});

it.each([false, true])(
  "renews the same reference and rejects a hidden baseline switch: %s",
  async (switchReferenceOnRenew) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const local = await localFixture();
    const service = await mockService(local, { expireAfterUploads: true, switchReferenceOnRenew });
    const result = await execute(local.environment);
    expect(service.reserves()).toBe(2);
    expect(result.code).toBe(switchReferenceOnRenew ? 1 : 0);
    if (switchReferenceOnRenew) {
      expect(result.error).toContain("Rerun Submit");
    }
  },
);

it("verifies all bounded inventory pages before comparing captures", async () => {
  const local = await localFixture();
  const service = await mockService(local, { pageSize: 2 });
  const result = await execute(local.environment);
  expect(result.code).toBe(0);
  expect(service.uploads).toHaveLength(2);
});

it("rejects repeated reference pagination before declaration or uploads", async () => {
  const local = await localFixture();
  const service = await mockService(local, { pageSize: 2, repeatCursor: true });
  const result = await execute(local.environment);
  expect(result.code).toBe(1);
  expect(service.declarations).toHaveLength(0);
  expect(service.uploads).toHaveLength(0);
});

it("renews the pinned reference when comparison consumes its remaining lifetime", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const local = await localFixture();
  local.manifest.captures.pop();
  await writeFile(local.manifestPath, JSON.stringify(local.manifest));
  const service = await mockService(local, { expireAfterComparison: true });
  const result = await execute(local.environment);
  expect(result.error).toBe("");
  expect(result.code).toBe(0);
  expect(service.reserves()).toBe(2);
  expect(service.uploads).toHaveLength(2);
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
  ).toMatchObject({ outcome: "changed", changedPixels: 0, sizeChanged: false });
  await expect(decodePng(white, { ...metadata(white), width: 100_000 })).rejects.toThrow();
});
