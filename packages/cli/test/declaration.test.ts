import { createHash, createHmac } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { digestJson } from "@visonaut/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { issueReuseChallenge, issueUploadTicket } from "../../security/src/capabilities.js";
import { fixture } from "./fixture.js";
import {
  emptyReferencePage,
  imagePutNumbers,
  reserveAnswer,
  stagedCounts,
  submitShard,
} from "./trusted.js";

const prepared = vi.hoisted(() => ({ directory: "", server: "https://visonaut.example" }));
// Workflow tests cover artifact and job provenance. These cases start at the verified manifest.
vi.mock("../src/workflow.js", () => ({ runWorkflowCommand: async () => prepared }));

const directories: string[] = [];
const environment = {
  VISONAUT_SERVER: "https://visonaut.example",
  GITHUB_RUN_ID: "456",
  GITHUB_RUN_ATTEMPT: "1",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/id-token",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
};
// Submit adds its comparison result to the manifest, so the digest of the declaration is the one of
// the posted manifest. A test writes this placeholder, and the stub of the service replaces it.
const DIGEST_PLACEHOLDER = "0".repeat(64);
const configuration = {
  secret: "test-only-signing-key-".repeat(2),
  issuer: environment.VISONAUT_SERVER,
  environment: "production" as const,
};
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

async function imagesFixture(count: number) {
  const local = await fixture();
  directories.push(local.directory);
  local.manifest.captures = [];
  for (let index = 0; index < count; index++) {
    const bytes = image(index);
    const capture = {
      ...local.capture,
      itemKey: `item-${index}`,
      ordinal: index,
      image: {
        ...local.capture.image,
        path: `image-${index}.png`,
        digest: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      },
    };
    local.manifest.captures.push(capture);
    await writeFile(join(local.directory, capture.image.path), bytes);
  }
  await writeFile(local.manifestPath, JSON.stringify(local.manifest));
  return local;
}

async function declaration(local: Awaited<ReturnType<typeof fixture>>, withReuse = false) {
  const uploads = [];
  for (const capture of local.manifest.captures) {
    const imageDigest = capture.image.digest;
    uploads.push({
      imageDigest,
      maxBytes: capture.image.bytes,
      ticket: await issueUploadTicket(configuration, {
        runId,
        shardKey: local.manifest.shard.key,
        objectKey: `quarantine/${runId}/${crypto.randomUUID()}`,
        imageDigest,
        mediaType: capture.image.mediaType,
        maximumBytes: capture.image.bytes,
      }),
    });
  }
  // No stub checks the digest of the challenge, so it keeps the digest of the capture manifest.
  const manifestDigest = await digestJson(local.manifest);
  return {
    schemaVersion: "1.0",
    manifestDigest: DIGEST_PLACEHOLDER,
    uploads,
    ...(withReuse
      ? {
          reuse: await issueReuseChallenge(configuration, {
            runId,
            jobId: local.manifest.shard.jobId,
            shardKey: local.manifest.shard.key,
            manifestDigest,
          }),
        }
      : {}),
  };
}

function execute(local: Awaited<ReturnType<typeof fixture>>) {
  return submitShard(prepared, local.directory, environment);
}

interface ReserveAnswer {
  schemaVersion: string;
  runId: string;
  capability: string;
  expiresAt: string;
}

interface MockServiceParams {
  local: Awaited<ReturnType<typeof fixture>>;
  response: () => Response;
  upload?: (ticket: string, options?: RequestInit) => Response | Promise<Response>;
  reserve?: () => ReserveAnswer;
  reuse?: (options?: RequestInit) => Response | Promise<Response>;
}

/**
 * The requests of Submit besides the shard images: OIDC, reserve, reference, declaration,
 * finalize, OIDC, and submit.
 */
const FIXED_REQUESTS = 7;

function mockService({ local, response, upload, reserve, reuse }: MockServiceParams) {
  const paths: string[] = [];
  let reservation: ReserveAnswer = {
    schemaVersion: "1.0",
    runId,
    capability: "capability-secret",
    expiresAt: "",
  };
  vi.stubGlobal("fetch", async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    paths.push(url.pathname);
    if (url.hostname.endsWith(".actions.githubusercontent.com")) {
      return Response.json({ value: "oidc-secret" });
    }
    if (url.pathname === "/v1/runs") {
      const answer = reserve?.() ?? {
        schemaVersion: "1.0",
        runId,
        capability: "capability-secret",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      };
      reservation = answer;
      return Response.json(reserveAnswer(answer));
    }
    if (url.pathname.endsWith("/reference")) {
      return Response.json(await emptyReferencePage(options, reservation));
    }
    if (url.pathname.endsWith("/reuse")) {
      if (!reuse) throw new Error("Unexpected reuse request");
      return reuse(options);
    }
    if (url.pathname.includes("/shards/")) {
      const posted = JSON.parse(String(options?.body));
      // Submit adds only its comparison result to the manifest of the capture.
      expect.soft(posted).toEqual({ ...local.manifest, localComparison: expect.any(Object) });
      const answer = response();
      const text = (await answer.text()).replaceAll(DIGEST_PLACEHOLDER, await digestJson(posted));
      return new Response(text, { status: answer.status, headers: answer.headers });
    }
    if (url.pathname.endsWith("/finalize")) {
      return Response.json({
        schemaVersion: "1.0",
        runId: reservation.runId,
        shardKey: local.manifest.shard.key,
        manifestDigest: JSON.parse(String(options?.body)).manifestDigest,
        state: "staged",
      });
    }
    if (url.pathname.startsWith("/v1/uploads/")) {
      return (
        upload?.(decodeURIComponent(url.pathname.slice("/v1/uploads/".length)), options) ??
        new Response(null, { status: 204 })
      );
    }
    if (url.pathname === "/v1/runs/456/submit") {
      return Response.json({
        schemaVersion: "1.0",
        runId: reservation.runId,
        state: "submitted",
        submittedAt: 1,
      });
    }
    throw new Error("Unexpected request");
  });
  return paths;
}

it("reuses proved originals in four bounded pages at once and uploads only misses", async () => {
  const local = await imagesFixture(129);
  const declared = await declaration(local, true);
  const challenge = declared.reuse!;
  const accepted = new Set(
    local.manifest.captures.slice(0, 128).map((capture) => capture.image.digest),
  );
  let proofPages = 0;
  let activePages = 0;
  let maximumActivePages = 0;
  let releaseFirstBatch = () => {};
  const firstBatch = new Promise<void>((resolve) => {
    releaseFirstBatch = resolve;
  });
  let uploads = 0;
  const paths = mockService({
    local,
    response: () => Response.json(declared),
    reuse: async (options) => {
      const pageNumber = ++proofPages;
      activePages++;
      maximumActivePages = Math.max(maximumActivePages, activePages);
      try {
        // Keep the first batch open to prove that a fifth request does not start.
        if (pageNumber <= 4) {
          await firstBatch;
        }
        const body = JSON.parse(String(options?.body)) as {
          challenge: string;
          proofs: { imageDigest: string; proof: string }[];
        };
        expect(body.challenge).toBe(challenge.token);
        expect(body.proofs.length).toBeLessThanOrEqual(32);
        for (const offered of body.proofs) {
          const capture = local.manifest.captures.find(
            (entry) => entry.image.digest === offered.imageDigest,
          );
          if (!capture) throw new Error("Unknown offered image");
          const bytes = await readFile(join(local.directory, capture.image.path));
          expect(offered.proof).toBe(
            createHmac("sha256", Buffer.from(challenge.nonce, "hex")).update(bytes).digest("hex"),
          );
        }
        return Response.json({
          schemaVersion: "1.0",
          reused: body.proofs
            .map(({ imageDigest }) => imageDigest)
            .filter((digest) => accepted.has(digest)),
        });
      } finally {
        activePages--;
      }
    },
    upload: (_ticket, options) => {
      uploads++;
      expect(
        createHash("sha256")
          .update(options?.body as Uint8Array)
          .digest("hex"),
      ).toBe(local.manifest.captures[128]?.image.digest);
      return new Response(null, { status: 204 });
    },
  });
  const operation = execute(local);
  try {
    await vi.waitFor(() => expect(proofPages).toBe(4), { timeout: 5000 });
    expect(activePages).toBe(4);
  } finally {
    releaseFirstBatch();
  }
  const result = await operation;
  expect(result.code).toBe(0);
  expect(result.stderr).toBe("");
  expect(stagedCounts(result.stdout)).toEqual({ originals: 129, reused: 128, uploaded: 1 });
  expect(proofPages).toBe(5);
  expect(maximumActivePages).toBe(4);
  expect(uploads).toBe(1);
  expect(paths.filter((path) => path.startsWith("/v1/uploads/"))).toHaveLength(1);
  // Besides the fixed requests: 5 proof pages and 1 PUT.
  expect(paths).toHaveLength(FIXED_REQUESTS + 5 + 1);

  const baseline = await imagesFixture(129);
  const baselineDeclaration = await declaration(baseline);
  const baselinePaths = mockService({
    local: baseline,
    response: () => Response.json(baselineDeclaration),
  });
  expect((await execute(baseline)).code).toBe(0);
  expect(baselinePaths).toHaveLength(FIXED_REQUESTS + 129);
}, 20_000);

it("renews after concurrent proof pages when the upload capability expires", async () => {
  const local = await imagesFixture(129);
  const first = await declaration(local, true);
  const renewed = await declaration(local, true);
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  if (!first.reuse || !renewed.reuse) throw new Error("Missing reuse challenges");
  first.reuse.expiresAt = new Date(now + 60_000).toISOString();
  renewed.reuse.expiresAt = new Date(now + 600_000).toISOString();
  const lastCapture = local.manifest.captures[128];
  if (!lastCapture) throw new Error("Missing final capture");
  const lastDigest = lastCapture.image.digest;
  let reservations = 0;
  let releaseFirstBatch = () => {};
  const firstBatchPending = new Promise<void>((resolve) => {
    releaseFirstBatch = resolve;
  });
  const offered: string[][] = [];
  mockService({
    local,
    reserve: () => ({
      schemaVersion: "1.0",
      runId,
      capability: "capability-secret",
      expiresAt: new Date(now + (reservations++ ? 600_000 : 60_000)).toISOString(),
    }),
    response: () => {
      if (reservations === 1) {
        return Response.json(first);
      }
      return Response.json({
        ...renewed,
        uploads: renewed.uploads.filter((upload) => upload.imageDigest === lastDigest),
      });
    },
    reuse: async (options) => {
      const body = JSON.parse(String(options?.body)) as {
        proofs: { imageDigest: string }[];
      };
      offered.push(body.proofs.map((proof) => proof.imageDigest));
      if (reservations === 1) {
        await firstBatchPending;
        return Response.json({
          schemaVersion: "1.0",
          reused: body.proofs.map((proof) => proof.imageDigest),
        });
      }
      return Response.json({ schemaVersion: "1.0", reused: [lastDigest] });
    },
  });
  const operation = execute(local);
  try {
    await vi.waitFor(() => expect(offered).toHaveLength(4));
    expect(reservations).toBe(1);
    now += 20_000;
  } finally {
    releaseFirstBatch();
  }
  const result = await operation;
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(stagedCounts(result.stdout)).toEqual({ originals: 129, reused: 129, uploaded: 0 });
  expect(imagePutNumbers(result.stdout)).toEqual({ elapsedMs: 0, bytes: 0, retryWaitMs: 0 });
  expect(reservations).toBe(2);
  expect(offered).toHaveLength(5);
  for (const page of offered.slice(0, 4)) {
    expect(page).toHaveLength(32);
  }
  expect(offered[4]).toEqual([lastDigest]);
});

it("falls back to uploads when a reuse challenge expires without progress", async () => {
  const local = await imagesFixture(129);
  const declared = await declaration(local, true);
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  if (!declared.reuse) throw new Error("Missing reuse challenge");
  declared.reuse.expiresAt = new Date(now + 60_000).toISOString();
  let pages = 0;
  let uploads = 0;
  const paths = mockService({
    local,
    response: () => Response.json(declared),
    reuse: (options) => {
      pages++;
      if (pages === 4) now += 20_000;
      const body = JSON.parse(String(options?.body)) as { proofs: { imageDigest: string }[] };
      expect(body.proofs.length).toBeLessThanOrEqual(32);
      return Response.json({ schemaVersion: "1.0", reused: [] });
    },
    upload: () => {
      uploads++;
      return new Response(null, { status: 204 });
    },
  });
  const result = await execute(local);
  expect(result.code).toBe(0);
  expect(stagedCounts(result.stdout)).toEqual({ originals: 129, reused: 0, uploaded: 129 });
  expect(pages).toBe(4);
  expect(uploads).toBe(129);
  expect(paths.filter((path) => path.includes("/shards/"))).toHaveLength(1);
});

it("stops renewal when the upload capability expires without staged images", async () => {
  const local = await imagesFixture(129);
  const declared = await declaration(local, true);
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  let reservations = 0;
  let pages = 0;
  const paths = mockService({
    local,
    reserve: () => {
      reservations++;
      return {
        schemaVersion: "1.0",
        runId,
        capability: "capability-secret",
        expiresAt: new Date(now + 60_000).toISOString(),
      };
    },
    response: () => Response.json(declared),
    reuse: () => {
      pages++;
      if (pages === 4) now += 20_000;
      return Response.json({ schemaVersion: "1.0", reused: [] });
    },
  });
  const result = await execute(local);
  expect(result.code).toBe(4);
  expect(result.stderr).toContain("expired before any image could be staged");
  expect(reservations).toBe(1);
  expect(pages).toBe(4);
  // OIDC, reserve, reference, declaration, and 4 proof pages.
  expect(paths).toHaveLength(8);
});

it("drains reuse pages before rejecting a receipt from another page", async () => {
  const local = await imagesFixture(128);
  const declared = await declaration(local, true);
  const firstCapture = local.manifest.captures[0];
  const otherPageCapture = local.manifest.captures[80];
  if (!firstCapture || !otherPageCapture) throw new Error("Missing capture pages");
  const firstDigest = firstCapture.image.digest;
  const otherPageDigest = otherPageCapture.image.digest;
  let otherPagesSettled = 0;
  const paths = mockService({
    local,
    response: () => Response.json(declared),
    reuse: async (options) => {
      const body = JSON.parse(String(options?.body)) as {
        proofs: { imageDigest: string }[];
      };
      if (body.proofs.some((proof) => proof.imageDigest === firstDigest)) {
        return Response.json({ schemaVersion: "1.0", reused: [otherPageDigest] });
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      otherPagesSettled++;
      return Response.json({
        schemaVersion: "1.0",
        reused: body.proofs.map((proof) => proof.imageDigest),
      });
    },
  });
  const result = await execute(local);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("not offered by this job");
  expect(otherPagesSettled).toBe(3);
  expect(paths.filter((path) => path.endsWith("/reuse"))).toHaveLength(4);
  expect(paths.filter((path) => path.startsWith("/v1/uploads/"))).toHaveLength(0);
  expect(paths.filter((path) => path.endsWith("/finalize"))).toHaveLength(0);
});

it.each([3000, 12300])(
  "uploads %i distinct images from a real signed-ticket declaration",
  async (count) => {
    const local = await imagesFixture(count);
    const declared = await declaration(local);
    const payload = JSON.stringify(declared);
    expect(Buffer.byteLength(payload)).toBeGreaterThan(2 * 1024 * 1024);
    expect(Buffer.byteLength(JSON.stringify(local.manifest))).toBeLessThan(8 * 1024 * 1024);
    const pending = new Map(declared.uploads.map((upload) => [upload.ticket, upload.imageDigest]));
    const paths = mockService({
      local,
      response: () => new Response(payload, { headers: { "Content-Type": "application/json" } }),
      upload: (ticket, options) => {
        const digest = pending.get(ticket);
        expect(digest).toBeDefined();
        expect(
          createHash("sha256")
            .update(options?.body as Uint8Array)
            .digest("hex"),
        ).toBe(digest);
        pending.delete(ticket);
        return new Response(null, { status: 204 });
      },
    });
    const result = await execute(local);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(stagedCounts(result.stdout)).toEqual({
      originals: count,
      reused: 0,
      uploaded: count,
    });
    expect(pending.size).toBe(0);
    expect(paths).toHaveLength(count + FIXED_REQUESTS);
  },
  120_000,
);

it("keeps image PUTs concurrent and bounded", async () => {
  const local = await imagesFixture(11);
  const declared = await declaration(local);
  let active = 0;
  let maximumActive = 0;
  let started = 0;
  let releaseFirstBatch = () => {};
  const firstBatch = new Promise<void>((resolve) => {
    releaseFirstBatch = resolve;
  });
  const paths = mockService({
    local,
    response: () => Response.json(declared),
    upload: async () => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      if (++started === 5) releaseFirstBatch();
      await firstBatch;
      active--;
      return new Response(null, { status: 204 });
    },
  });
  const result = await execute(local);
  expect(result.code).toBe(0);
  expect(stagedCounts(result.stdout)).toMatchObject({ uploaded: 11 });
  expect(maximumActive).toBe(5);
  expect(active).toBe(0);
  expect(paths.filter((path) => path.startsWith("/v1/uploads/"))).toHaveLength(11);
});

it("settles in-flight image PUTs before reporting a failed batch", async () => {
  const local = await imagesFixture(7);
  const declared = await declaration(local);
  let requests = 0;
  let settled = 0;
  const paths = mockService({
    local,
    response: () => Response.json(declared),
    upload: async () => {
      requests++;
      if (requests === 1) return Response.json({ error: "failed" }, { status: 500 });
      await new Promise((resolve) => setTimeout(resolve, 10));
      settled++;
      return new Response(null, { status: 204 });
    },
  });
  const result = await execute(local);
  expect(result.code).toBe(1);
  expect(requests).toBe(5);
  expect(settled).toBe(4);
  expect(paths.filter((path) => path.endsWith("/finalize"))).toHaveLength(0);
});

it("does not retry an image PUT that gets the code validation_busy", async () => {
  // Only the retired server comparison sent this code, so it is a plain refusal.
  const local = await imagesFixture(1);
  const declared = await declaration(local);
  let requests = 0;
  const paths = mockService({
    local,
    response: () => Response.json(declared),
    upload: () => {
      requests++;
      return Response.json(
        { error: { code: "validation_busy" } },
        { status: 503, headers: { "Retry-After": "0" } },
      );
    },
  });
  const result = await execute(local);
  expect(result.code).toBe(1);
  expect(requests).toBe(1);
  expect(result.stderr).toContain("The service refused the request (HTTP 503, validation_busy).");
  expect(paths.filter((path) => path.endsWith("/finalize"))).toHaveLength(0);
});

it.each(["advertised", "streamed"])(
  "bounds %s declaration bytes by unique images",
  async (kind) => {
    const local = await imagesFixture(1);
    const capture = local.manifest.captures[0];
    if (!capture) {
      throw new Error("Missing fixture capture");
    }
    // Reusing an image for more captures must not increase the ticket budget.
    local.manifest.captures.push({ ...capture, itemKey: "reused", ordinal: 1 });
    await writeFile(local.manifestPath, JSON.stringify(local.manifest));
    const declared = await declaration(local);
    const payload = JSON.stringify({
      ...declared,
      uploads: declared.uploads.slice(0, 1),
      padding: " ".repeat(32 * 1024),
    });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (kind === "advertised") {
      headers["Content-Length"] = String(Buffer.byteLength(payload));
    }
    const paths = mockService({ local, response: () => new Response(payload, { headers }) });
    const result = await execute(local);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("response exceeds");
    expect(paths).toHaveLength(4);
  },
);

it.each(["excess-count", "unknown-image", "duplicate-image", "duplicate-ticket", "invalid-ticket"])(
  "refuses a declaration with %s",
  async (kind) => {
    const local = await imagesFixture(2);
    const declared = await declaration(local);
    const first = declared.uploads[0];
    const second = declared.uploads[1];
    if (!first || !second) {
      throw new Error("Missing fixture upload tickets");
    }
    if (kind === "excess-count") {
      declared.uploads.push({ ...first, ticket: "extra-ticket" });
    } else if (kind === "unknown-image") {
      first.imageDigest = "a".repeat(64);
    } else if (kind === "duplicate-image") {
      second.imageDigest = first.imageDigest;
    } else if (kind === "duplicate-ticket") {
      second.ticket = first.ticket;
    } else {
      first.ticket = "not a credential";
    }
    const paths = mockService({ local, response: () => Response.json(declared) });
    const result = await execute(local);
    expect(result.code).toBe(1);
    expect(paths).toHaveLength(4);
  },
);

it("renews credentials and pending tickets without repeating successful uploads", async () => {
  const local = await imagesFixture(4);
  const declared = await declaration(local);
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const pending = new Map(declared.uploads.map((upload) => [upload.ticket, upload]));
  let reservations = 0;
  let declarations = 0;
  let expiresAt = 0;
  const paths = mockService({
    local,
    reserve: () => {
      reservations++;
      expiresAt = now + 600_000;
      return {
        schemaVersion: "1.0",
        runId,
        capability: `capability-${reservations}`,
        expiresAt: new Date(now + 600_000).toISOString(),
      };
    },
    response: () => {
      declarations++;
      return Response.json({
        ...declared,
        uploads: [...pending.values()].map((entry) => ({
          ...entry,
          ticket: `${entry.ticket}-generation-${declarations}`,
        })),
      });
    },
    upload: (ticket, options) => {
      if (now >= expiresAt) {
        return Response.json({ error: { code: "invalid_capability" } }, { status: 401 });
      }
      expect(new Headers(options?.headers).get("Authorization")).toBe(
        `Bearer capability-${reservations}`,
      );
      expect(ticket.endsWith(`-generation-${declarations}`)).toBe(true);
      const original = ticket.slice(0, ticket.lastIndexOf("-generation-"));
      expect(pending.delete(original)).toBe(true);
      // Other work or a suspended runner can age credentials between requests.
      now += 300_000;
      return new Response(null, { status: 204 });
    },
  });
  const result = await execute(local);
  expect(result.code).toBe(0);
  expect(stagedCounts(result.stdout)).toMatchObject({ uploaded: 4 });
  expect(pending.size).toBe(0);
  expect(reservations).toBe(3);
  expect(declarations).toBe(2);
  expect(paths.filter((path) => path.startsWith("/v1/uploads/"))).toHaveLength(4);
});

it.each(["different-run", "no-time", "repeated-upload"])(
  "stops unsafe credential renewal: %s",
  async (kind) => {
    const local = await imagesFixture(2);
    const declared = await declaration(local);
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let reservations = 0;
    let uploaded = 0;
    const paths = mockService({
      local,
      reserve: () => {
        reservations++;
        return {
          schemaVersion: "1.0",
          runId: reservations > 1 && kind === "different-run" ? "other-run" : runId,
          capability: `capability-${reservations}`,
          expiresAt: new Date(
            now + (reservations > 1 && kind === "no-time" ? 5000 : 600_000),
          ).toISOString(),
        };
      },
      response: () =>
        Response.json({
          ...declared,
          uploads:
            reservations > 1 && kind !== "repeated-upload"
              ? declared.uploads.slice(1)
              : declared.uploads,
        }),
      upload: () => {
        uploaded++;
        now += 600_000;
        return new Response(null, { status: 204 });
      },
    });
    const result = await execute(local);
    expect(result.code).toBe(kind === "no-time" ? 4 : 1);
    expect(reservations).toBe(2);
    expect(uploaded).toBe(1);
    // Two reservations with a reference page each, one PUT, and one declaration. Only the case
    // "repeated-upload" asks for a second declaration.
    expect(paths).toHaveLength(kind === "repeated-upload" ? 9 : 8);
  },
);

it("does not loop when declaration uses the available credential lifetime", async () => {
  const local = await imagesFixture(1);
  const declared = await declaration(local);
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const paths = mockService({
    local,
    response: () => {
      now += 560_000;
      return Response.json(declared);
    },
  });
  const result = await execute(local);
  expect(result.code).toBe(4);
  expect(paths).toHaveLength(4);
});

it.each(["oidc", "reserve", "finalize"])(
  "keeps the 2 MiB bound for %s responses",
  async (stage) => {
    const local = await imagesFixture(1);
    let requests = 0;
    let reservation = { capability: "capability-secret", expiresAt: "" };
    vi.stubGlobal("fetch", async (input: string | URL | Request, options?: RequestInit) => {
      requests++;
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.hostname.endsWith(".actions.githubusercontent.com") && stage !== "oidc") {
        return Response.json({ value: "oidc-secret" });
      }
      if (url.pathname === "/v1/runs" && stage !== "reserve") {
        reservation = {
          capability: "capability-secret",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        };
        return Response.json(reserveAnswer({ schemaVersion: "1.0", runId, ...reservation }));
      }
      if (url.pathname.endsWith("/reference") && stage === "finalize") {
        return Response.json(await emptyReferencePage(options, reservation));
      }
      if (url.pathname.includes("/shards/") && stage === "finalize") {
        return Response.json({
          schemaVersion: "1.0",
          manifestDigest: await digestJson(JSON.parse(String(options?.body))),
          uploads: [],
        });
      }
      return new Response(" ".repeat(2 * 1024 * 1024 + 1), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const result = await execute(local);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("response exceeds");
    // finalize: OIDC, reserve, reference, declaration, and the finalize call.
    expect(requests).toBe(stage === "oidc" ? 1 : stage === "reserve" ? 2 : 5);
  },
);
