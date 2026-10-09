import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { fixture } from "./fixture.js";
import { json, pageService } from "./page-service.js";
import type { PageServiceOptions, Prepared } from "./page-service.js";
import { imagePutNumbers, stagedCounts, submitShard } from "./trusted.js";

const prepared = vi.hoisted((): Prepared => ({
  server: "https://visonaut.example",
  bundles: [],
  directory: "",
  directories: [],
}));
// Workflow tests cover artifact and job provenance. These cases start at the verified bundle.
vi.mock("../src/workflow.js", async () =>
  (await import("./page-service.js")).workflowMock(prepared),
);

const directories: string[] = prepared.directories;
const environment = {
  VISONAUT_SERVER: "https://visonaut.example",
  GITHUB_RUN_ID: "456",
  GITHUB_RUN_ATTEMPT: "1",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/id-token",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-secret",
};
// The CLI retries a reuse request only for a run ID with this form.
const runId = "3f13c649-4649-43fd-b846-b1de3e30ec14";

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function chunk(type: string, data: Buffer): Buffer {
  const content = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, content, checksum]);
}

function image(index: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, index >>> 16, (index >>> 8) & 255, index & 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** One capture job with `count` new captures, each with its own image. */
async function imagesFixture(count: number) {
  const local = await fixture();
  directories.push(local.directory);
  local.manifest.captures = [];
  const images = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index++) {
    const bytes = image(index);
    const digest = createHash("sha256").update(bytes).digest("hex");
    images.set(digest, bytes);
    const capture = {
      ...local.capture,
      // The order of the item keys is the order of the numbers.
      itemKey: `item-${String(index).padStart(5, "0")}`,
      ordinal: index,
      image: { ...local.capture.image, path: `image-${index}.png`, digest, bytes: bytes.length },
    };
    local.manifest.captures.push(capture);
    await writeFile(join(local.directory, capture.image.path), bytes);
  }
  await writeFile(local.manifestPath, JSON.stringify(local.manifest));
  return { ...local, images, digests: [...images.keys()] };
}

function execute(local: Awaited<ReturnType<typeof fixture>>) {
  return submitShard(prepared, [local], environment);
}

function mockService(options: PageServiceOptions = {}) {
  const service = pageService({ runId, ...options });
  const count = (suffix: string) =>
    service.paths().filter((path) => path.endsWith(suffix) || path.includes(suffix)).length;
  return {
    ...service,
    reserves: () => service.reserveBodies.length,
    pagePosts: () => count(`/v1/runs/${runId}/pages`),
    reuseRequests: () => count("/reuse"),
    puts: () => count("/v1/uploads/"),
    indexPosts: () => count("/index"),
  };
}

/** The requests of Submit besides the images: OIDC, reserve, one page, the index, OIDC, submit. */
const FIXED_REQUESTS = 6;

function proofs(options: RequestInit | undefined): string[] {
  const body: { proofs: { imageDigest: string }[] } = JSON.parse(String(options?.body));
  return body.proofs.map((proof) => proof.imageDigest);
}

/** Make `Date.now` a clock that the test moves. */
function clock() {
  const state = { now: Date.now() };
  vi.spyOn(Date, "now").mockImplementation(() => state.now);
  return state;
}

it("reuses proved originals in four bounded requests at once and uploads only misses", async () => {
  const local = await imagesFixture(129);
  const stored = new Map([...local.images].slice(0, 128));
  let proofRequests = 0;
  let active = 0;
  let maximumActive = 0;
  let releaseFirstGroup = () => {};
  const firstGroup = new Promise<void>((resolve) => {
    releaseFirstGroup = resolve;
  });
  const service = mockService({
    stored,
    reuse: true,
    respond: async (url, options) => {
      if (!url.pathname.endsWith("/reuse")) return;
      const number = ++proofRequests;
      active++;
      maximumActive = Math.max(maximumActive, active);
      expect(proofs(options).length).toBeLessThanOrEqual(32);
      // Keep the first group open to prove that a fifth request does not start.
      if (number <= 4) {
        await firstGroup;
      }
      active--;
      return undefined;
    },
  });
  const operation = execute(local);
  try {
    await vi.waitFor(() => expect(proofRequests).toBe(4), { timeout: 5000 });
    expect(active).toBe(4);
  } finally {
    releaseFirstGroup();
  }
  const result = await operation;
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(stagedCounts(result.stdout)).toEqual({ originals: 129, reused: 128, uploaded: 1 });
  expect(proofRequests).toBe(5);
  expect(maximumActive).toBe(4);
  // The stub checks each proof with the bytes that it holds, so only the 129th image has a PUT.
  expect(service.puts()).toBe(1);
  expect(service.paths()).toHaveLength(FIXED_REQUESTS + 5 + 1);

  const baseline = await imagesFixture(129);
  const baselineService = mockService();
  expect((await execute(baseline)).code).toBe(0);
  expect(baselineService.paths()).toHaveLength(FIXED_REQUESTS + 129);
}, 20_000);

it("renews after concurrent proof requests when the upload capability expires", async () => {
  const local = await imagesFixture(129);
  const time = clock();
  let releaseFirstGroup = () => {};
  const firstGroup = new Promise<void>((resolve) => {
    releaseFirstGroup = resolve;
  });
  const offered: string[][] = [];
  const service = mockService({
    stored: local.images,
    reuse: true,
    lifetimeMs: (call) => (call === 1 ? 60_000 : 600_000),
    respond: async (url, options) => {
      if (!url.pathname.endsWith("/reuse")) return;
      offered.push(proofs(options));
      if (service.reserves() === 1) {
        await firstGroup;
      }
      return undefined;
    },
  });
  const operation = execute(local);
  try {
    await vi.waitFor(() => expect(offered).toHaveLength(4));
    expect(service.reserves()).toBe(1);
    // The capability has 40 seconds now, inside the headroom, so the fifth request does not start.
    time.now += 20_000;
  } finally {
    releaseFirstGroup();
  }
  const result = await operation;
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(stagedCounts(result.stdout)).toEqual({ originals: 129, reused: 129, uploaded: 0 });
  expect(imagePutNumbers(result.stdout)).toEqual({ elapsedMs: 0, bytes: 0, retryWaitMs: 0 });
  expect(service.reserves()).toBe(2);
  // The second answer of the page names only the image that the service still does not have.
  expect(service.pagePosts()).toBe(2);
  expect(offered).toHaveLength(5);
  for (const group of offered.slice(0, 4)) {
    expect(group).toHaveLength(32);
  }
  expect(offered[4]).toEqual([local.digests[128]]);
});

it("falls back to uploads when a reuse challenge expires without progress", async () => {
  const local = await imagesFixture(129);
  const time = clock();
  let proofRequests = 0;
  // The challenge lives 60 seconds, and the capability 10 minutes.
  const service = mockService({
    reuse: true,
    reuseLifetimeMs: 60_000,
    respond: (url, options) => {
      if (!url.pathname.endsWith("/reuse")) return;
      if (++proofRequests === 4) {
        time.now += 20_000;
      }
      expect(proofs(options).length).toBeLessThanOrEqual(32);
      return undefined;
    },
  });
  const result = await execute(local);
  expect(result.code).toBe(0);
  expect(stagedCounts(result.stdout)).toEqual({ originals: 129, reused: 0, uploaded: 129 });
  expect(proofRequests).toBe(4);
  expect(service.puts()).toBe(129);
  expect(service.pagePosts()).toBe(1);
});

// The capability reaches its last 45 seconds after each fourth proof request of the listed tries.
it.each([
  { name: "sends the page again one time", stalledTries: 1, code: 0, proofRequests: 9 },
  { name: "stops after two tries in sequence", stalledTries: 2, code: 4, proofRequests: 8 },
])(
  "$name when the upload capability expires without staged images",
  async ({ stalledTries, code, proofRequests }) => {
    const local = await imagesFixture(129);
    const time = clock();
    let requests = 0;
    const service = mockService({
      reuse: true,
      lifetimeMs: () => 60_000,
      respond: (url) => {
        if (!url.pathname.endsWith("/reuse")) return;
        requests++;
        if (requests % 4 === 0 && requests <= stalledTries * 4) {
          time.now += 20_000;
        }
        return undefined;
      },
    });
    const result = await execute(local);
    expect(result.code).toBe(code);
    expect(service.reserves()).toBe(2);
    expect(service.pagePosts()).toBe(2);
    expect(requests).toBe(proofRequests);
    if (code === 0) {
      expect(stagedCounts(result.stdout)).toEqual({ originals: 129, reused: 0, uploaded: 129 });
      return;
    }
    expect(result.stderr).toContain("expired before any image could be staged");
    // Two times: OIDC, reserve, the page, and 4 proof requests.
    expect(service.paths()).toHaveLength(14);
    expect(service.puts()).toBe(0);
  },
);

it("drains reuse requests before rejecting a receipt from another request", async () => {
  const local = await imagesFixture(128);
  let proofRequests = 0;
  let othersSettled = 0;
  const service = mockService({
    reuse: true,
    respond: async (url, options) => {
      if (!url.pathname.endsWith("/reuse")) return;
      const offered = new Set(proofs(options));
      if (++proofRequests === 1) {
        const other = local.digests.find((digest) => !offered.has(digest));
        return json({ schemaVersion: "1.0", reused: [other] });
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      othersSettled++;
      return json({ schemaVersion: "1.0", reused: [...offered] });
    },
  });
  const result = await execute(local);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("not offered by this job");
  expect(othersSettled).toBe(3);
  expect(service.reuseRequests()).toBe(4);
  expect(service.puts()).toBe(0);
  expect(service.indexPosts()).toBe(0);
});

it("uploads 4,100 distinct images of 3 pages with upload tickets of the largest length", async () => {
  const local = await imagesFixture(4100);
  // 2,000 tickets of 4,096 characters are about 8 MB, above the default bound of an answer.
  const service = mockService({ ticketLength: 4096 });
  const result = await execute(local);
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(stagedCounts(result.stdout)).toEqual({ originals: 4100, reused: 0, uploaded: 4100 });
  expect(service.pages().map((page) => page.rows.length)).toEqual([2000, 2000, 100]);
  expect([...service.uploads.keys()].sort()).toEqual([...local.digests].sort());
  // Each image has one PUT, and each page has one request.
  expect(service.paths()).toHaveLength(FIXED_REQUESTS + 2 + 4100);
}, 120_000);

it("keeps image PUTs concurrent and bounded", async () => {
  const local = await imagesFixture(11);
  let active = 0;
  let maximumActive = 0;
  let started = 0;
  let releaseFirstGroup = () => {};
  const firstGroup = new Promise<void>((resolve) => {
    releaseFirstGroup = resolve;
  });
  const service = mockService({
    respond: async (url) => {
      if (!url.pathname.startsWith("/v1/uploads/")) return;
      active++;
      maximumActive = Math.max(maximumActive, active);
      if (++started === 5) {
        releaseFirstGroup();
      }
      await firstGroup;
      active--;
      return undefined;
    },
  });
  const result = await execute(local);
  expect(result.code).toBe(0);
  expect(stagedCounts(result.stdout)).toMatchObject({ uploaded: 11 });
  expect(maximumActive).toBe(5);
  expect(active).toBe(0);
  expect(service.puts()).toBe(11);
});

it("settles in-flight image PUTs before reporting a failed group", async () => {
  const local = await imagesFixture(7);
  let requests = 0;
  let settled = 0;
  const service = mockService({
    respond: async (url) => {
      if (!url.pathname.startsWith("/v1/uploads/")) return;
      if (++requests === 1) return json({ error: "failed" }, 500);
      await new Promise((resolve) => setTimeout(resolve, 10));
      settled++;
      return undefined;
    },
  });
  const result = await execute(local);
  expect(result.code).toBe(1);
  expect(requests).toBe(5);
  expect(settled).toBe(4);
  expect(service.indexPosts()).toBe(0);
});

it("does not retry an image PUT that gets the code validation_busy", async () => {
  // Only the retired server comparison sent this code, so it is a plain refusal.
  const local = await imagesFixture(1);
  const service = mockService({
    respond: (url) =>
      url.pathname.startsWith("/v1/uploads/")
        ? json({ error: { code: "validation_busy" } }, 503, { "Retry-After": "0" })
        : undefined,
  });
  const result = await execute(local);
  expect(result.code).toBe(1);
  expect(service.puts()).toBe(1);
  expect(result.stderr).toContain("The service refused the request (HTTP 503, validation_busy).");
  expect(service.indexPosts()).toBe(0);
});

it.each(["advertised", "streamed"])(
  "bounds %s page answer bytes by unique images",
  async (kind) => {
    const local = await imagesFixture(1);
    const capture = local.manifest.captures[0];
    if (!capture) {
      throw new Error("Missing fixture capture");
    }
    // An image that more captures use must not increase the ticket budget.
    local.manifest.captures.push({ ...capture, itemKey: "reused", ordinal: 1 });
    await writeFile(local.manifestPath, JSON.stringify(local.manifest));
    const service = mockService({
      change: (url, response) => {
        if (!url.pathname.endsWith("/pages")) return response;
        expect(response.uploads).toHaveLength(1);
        return { ...response, padding: " ".repeat(32 * 1024) };
      },
      headers: (url, body): Record<string, string> =>
        url.pathname.endsWith("/pages") && kind === "advertised"
          ? { "Content-Length": String(Buffer.byteLength(body)) }
          : {},
    });
    const result = await execute(local);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("response exceeds");
    expect(service.paths()).toHaveLength(3);
  },
);

it.each(["excess-count", "unknown-image", "duplicate-image", "duplicate-ticket", "invalid-ticket"])(
  "refuses a page answer with %s",
  async (kind) => {
    const local = await imagesFixture(2);
    const service = mockService({
      change: (url, response) => {
        if (!url.pathname.endsWith("/pages")) return response;
        const uploads = structuredClone(response.uploads);
        if (!Array.isArray(uploads)) throw new Error("Missing fixture upload tickets");
        const [first, second] = uploads;
        if (kind === "excess-count") {
          uploads.push({ ...first, ticket: "extra-ticket" });
        } else if (kind === "unknown-image") {
          first.imageDigest = "a".repeat(64);
        } else if (kind === "duplicate-image") {
          second.imageDigest = first.imageDigest;
        } else if (kind === "duplicate-ticket") {
          second.ticket = first.ticket;
        } else {
          first.ticket = "not a credential";
        }
        return { ...response, uploads };
      },
    });
    const result = await execute(local);
    expect(result.code).toBe(1);
    expect(service.paths()).toHaveLength(3);
  },
);

it("renews credentials and pending tickets without repeating successful uploads", async () => {
  const local = await imagesFixture(4);
  const time = clock();
  const puts: string[] = [];
  const service = mockService({
    lifetimeMs: () => 600_000,
    respond: (url) => {
      if (!url.pathname.startsWith("/v1/uploads/")) return;
      puts.push(url.pathname);
      // Other work or a suspended runner can age credentials between requests.
      time.now += 300_000;
      return undefined;
    },
  });
  const result = await execute(local);
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(stagedCounts(result.stdout)).toMatchObject({ uploaded: 4 });
  expect(new Set(puts).size).toBe(4);
  expect(puts).toHaveLength(4);
  // Two PUTs use the first capability. The page is sent again with the second one, and the
  // index needs the third one. The stub refuses a request with an old capability.
  expect(service.reserves()).toBe(3);
  expect(service.pagePosts()).toBe(2);
});

it.each(["different-run", "no-time", "repeated-upload"])(
  "stops unsafe credential renewal: %s",
  async (kind) => {
    const local = await imagesFixture(2);
    const time = clock();
    const service = mockService({
      lifetimeMs: (call) => (call > 1 && kind === "no-time" ? 5000 : 600_000),
      respond: (url) => {
        if (!url.pathname.startsWith("/v1/uploads/")) return;
        time.now += 600_000;
        return undefined;
      },
      change: (url, response) => {
        if (service.reserves() < 2) return response;
        if (url.pathname === "/v1/runs" && kind === "different-run") {
          return { ...response, runId: "other-run" };
        }
        if (url.pathname.endsWith("/pages") && kind === "repeated-upload") {
          const [digest] = service.uploads.keys();
          return {
            ...response,
            uploads: [{ imageDigest: digest, ticket: `ticket-${digest}.`, maxBytes: 1000 }],
          };
        }
        return response;
      },
    });
    const result = await execute(local);
    expect(result.code).toBe(kind === "no-time" ? 4 : 1);
    expect(service.reserves()).toBe(2);
    expect(service.puts()).toBe(1);
    // Only the case "repeated-upload" sends the page a second time.
    expect(service.pagePosts()).toBe(kind === "repeated-upload" ? 2 : 1);
  },
);

// A page request that takes 560 of the 600 seconds leaves the capability in its last 45 seconds.
it.each([
  { name: "sends the page again one time", slowRequests: 1, code: 0 },
  { name: "does not loop: it stops after two tries in sequence", slowRequests: 2, code: 4 },
])(
  "$name when the page request uses the available credential lifetime",
  async ({ slowRequests, code }) => {
    const local = await imagesFixture(1);
    const time = clock();
    let pageRequests = 0;
    const service = mockService({
      change: (url, response) => {
        if (url.pathname.endsWith("/pages") && ++pageRequests <= slowRequests) {
          time.now += 560_000;
        }
        return response;
      },
    });
    const result = await execute(local);
    expect(result.code).toBe(code);
    expect(service.reserves()).toBe(2);
    expect(service.pagePosts()).toBe(2);
    if (code === 0) {
      expect(stagedCounts(result.stdout)).toEqual({ originals: 1, reused: 0, uploaded: 1 });
      return;
    }
    expect(result.stderr).toContain("expired before any image could be uploaded");
    // Two times: OIDC, reserve, and the page.
    expect(service.paths()).toHaveLength(6);
    expect(service.puts()).toBe(0);
  },
);

it.each(["oidc", "reserve", "index"])("keeps the 2 MiB bound for %s responses", async (stage) => {
  const local = await imagesFixture(1);
  const large = () =>
    new Response(" ".repeat(2 * 1024 * 1024 + 1), {
      headers: { "Content-Type": "application/json" },
    });
  const service = mockService({
    respond: (url) => {
      if (stage === "oidc" && url.hostname.endsWith(".actions.githubusercontent.com")) {
        return large();
      }
      if (stage === "reserve" && url.pathname === "/v1/runs") return large();
      if (stage === "index" && url.pathname.endsWith("/index")) return large();
      return undefined;
    },
  });
  const result = await execute(local);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("response exceeds");
  // index: OIDC, reserve, the page, the PUT, and the index.
  expect(service.paths()).toHaveLength(stage === "oidc" ? 1 : stage === "reserve" ? 2 : 5);
});
