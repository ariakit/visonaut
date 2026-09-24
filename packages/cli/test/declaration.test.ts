import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { digestJson } from "@visonaut/protocol";
import { afterEach, expect, it, vi } from "vitest";
import { issueUploadTicket } from "../../security/src/capabilities.js";
import { runCli } from "../src/index.js";
import { fixture } from "./fixture.js";

const directories: string[] = [];
const environment = {
  VISONAUT_SERVER: "https://visonaut.example",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/id-token",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
};
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

async function declaration(local: Awaited<ReturnType<typeof fixture>>) {
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
  return { schemaVersion: "1.0", manifestDigest: await digestJson(local.manifest), uploads };
}

async function execute(local: Awaited<ReturnType<typeof fixture>>) {
  let stdout = "";
  let stderr = "";
  const code = await runCli({
    argv: ["upload", "--dir", local.directory, "--json"],
    environment,
    stdout: (value) => {
      stdout += value;
    },
    stderr: (value) => {
      stderr += value;
    },
  });
  return { code, stdout, stderr };
}

interface MockServiceParams {
  local: Awaited<ReturnType<typeof fixture>>;
  response: () => Response;
  upload?: (ticket: string, options?: RequestInit) => Response;
  reserve?: () => object;
}

function mockService({ local, response, upload, reserve }: MockServiceParams) {
  const paths: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    paths.push(url.pathname);
    if (url.hostname.endsWith(".actions.githubusercontent.com")) {
      return Response.json({ value: "oidc-secret" });
    }
    if (url.pathname === "/v1/runs") {
      return Response.json(
        reserve?.() ?? {
          schemaVersion: "1.0",
          runId,
          capability: "capability-secret",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        },
      );
    }
    if (url.pathname.includes("/shards/")) {
      expect(JSON.parse(String(options?.body))).toEqual(local.manifest);
      return response();
    }
    if (url.pathname.endsWith("/finalize")) {
      return Response.json({
        schemaVersion: "1.0",
        runId,
        shardKey: local.manifest.shard.key,
        manifestDigest: await digestJson(local.manifest),
        state: "staged",
      });
    }
    if (url.pathname.startsWith("/v1/uploads/")) {
      return (
        upload?.(decodeURIComponent(url.pathname.slice("/v1/uploads/".length)), options) ??
        new Response(null, { status: 204 })
      );
    }
    throw new Error("Unexpected request");
  });
  return paths;
}

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
    expect(JSON.parse(result.stdout)).toMatchObject({
      uploadedImages: count,
      shardStaged: true,
      visualApproval: false,
    });
    expect(pending.size).toBe(0);
    expect(paths).toHaveLength(count + 4);
  },
  120_000,
);

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
    expect(paths).toHaveLength(3);
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
    expect(paths).toHaveLength(3);
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
  expect(JSON.parse(result.stdout)).toMatchObject({ uploadedImages: 4 });
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
    expect(paths.length).toBeLessThanOrEqual(7);
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
  expect(paths).toHaveLength(3);
});

it.each(["oidc", "reserve", "finalize"])(
  "keeps the 2 MiB bound for %s responses",
  async (stage) => {
    const local = await imagesFixture(1);
    let requests = 0;
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      requests++;
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.hostname.endsWith(".actions.githubusercontent.com") && stage !== "oidc") {
        return Response.json({ value: "oidc-secret" });
      }
      if (url.pathname === "/v1/runs" && stage !== "reserve") {
        return Response.json({
          schemaVersion: "1.0",
          runId,
          capability: "capability-secret",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        });
      }
      if (url.pathname.includes("/shards/") && stage === "finalize") {
        return Response.json({
          schemaVersion: "1.0",
          manifestDigest: await digestJson(local.manifest),
          uploads: [],
        });
      }
      return new Response(" ".repeat(2 * 1024 * 1024 + 1), {
        headers: { "Content-Type": "application/json" },
      });
    });
    let stderr = "";
    const code = await runCli({
      argv: ["upload", "--dir", local.directory],
      environment,
      stdout: () => {},
      stderr: (value) => {
        stderr += value;
      },
    });
    expect(code).toBe(1);
    expect(stderr).toContain("response exceeds");
    expect(requests).toBe(stage === "oidc" ? 1 : stage === "reserve" ? 2 : 4);
  },
);
