import { rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { digestJson } from "@visonaut/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";
import { fixture, imageBytes } from "./fixture.js";

const directories: string[] = [];
const environment = {
  VISONAUT_SERVER: "https://review.example.test",
  VISONAUT_TOKEN: "session-secret",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/id-token",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
};

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function busy(code = "service_unavailable", retryAfter: string | null = "0", status = 503) {
  return Response.json(
    { schemaVersion: "1.0", error: { code, message: "private-response-secret" } },
    { status, headers: retryAfter === null ? {} : { "Retry-After": retryAfter } },
  );
}

function passed() {
  return Response.json({
    schemaVersion: "1.0",
    runId: "run-123",
    state: "passed",
    reviewUrl: "/runs/run-123",
    completedShards: 1,
    expectedShards: 1,
    errors: [],
  });
}

async function execute(argv = ["status", "--run", "run-123", "--json"], origin?: string) {
  let stdout = "";
  let stderr = "";
  const code = await runCli({
    argv,
    environment: { ...environment, ...(origin ? { VISONAUT_SERVER: origin } : {}) },
    stdout: (value) => {
      stdout += value;
    },
    stderr: (value) => {
      stderr += value;
    },
  });
  return { code, stdout, stderr };
}

describe("public commands under temporary service backpressure", () => {
  it("retries a busy status response and returns the final status", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(passed());
    vi.stubGlobal("fetch", fetch);
    const result = await execute();
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "passed" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.stderr).toBe("");
  });

  it("stops after five attempts without exposing the error body", async () => {
    const fetch = vi.fn(async () => busy());
    vi.stubGlobal("fetch", fetch);
    const result = await execute();
    expect(result.code).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(result.stderr).toContain("HTTP 503");
    expect(result.stderr).not.toContain("secret");
  });

  it.each([400, 401, 403, 409, 422, 429, 500])("does not retry HTTP %i", async (status) => {
    const fetch = vi.fn(async () => busy("service_unavailable", "0", status));
    vi.stubGlobal("fetch", fetch);
    const result = await execute();
    expect(result.code).toBe(status === 401 || status === 403 ? 4 : 1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([null, "", "-1", "not-a-date", "1.5", "120"])(
    "refuses an invalid or over-budget Retry-After value %s",
    async (retryAfter) => {
      const fetch = vi.fn(async () => busy("service_unavailable", retryAfter));
      vi.stubGlobal("fetch", fetch);
      expect((await execute()).code).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("does not retry a semantic failure disguised as a 503", async () => {
    const fetch = vi.fn(async () => busy("plan_too_large"));
    vi.stubGlobal("fetch", fetch);
    expect((await execute()).code).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry network failures", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("request-secret");
    });
    vi.stubGlobal("fetch", fetch);
    const result = await execute();
    expect(result.code).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.stderr).not.toContain("request-secret");
  });

  it.each(["not-json", "too-large"])("does not retry a %s busy response", async (kind) => {
    const fetch = vi.fn(
      async () =>
        new Response(kind === "not-json" ? "invalid" : " ".repeat(2 * 1024 * 1024 + 1), {
          status: 503,
          headers: { "Content-Type": "application/json", "Retry-After": "0" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    expect((await execute()).code).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("honors a Retry-After date before making the next request", async () => {
    const retryAt = Math.ceil(Date.now() / 1000) * 1000 + 1000;
    let secondRequest = 0;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(busy("service_unavailable", new Date(retryAt).toUTCString()))
      .mockImplementationOnce(async () => {
        secondRequest = Date.now();
        return passed();
      });
    vi.stubGlobal("fetch", fetch);
    expect((await execute()).code).toBe(0);
    expect(secondRequest).toBeGreaterThanOrEqual(retryAt);
  });

  it("shares one deadline across retry attempts", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const fetch = vi.fn(async () => {
      now += 29_950;
      return busy();
    });
    vi.stubGlobal("fetch", fetch);
    expect((await execute()).code).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["oidc", "reserve", "declare", "finalize"])(
    "does not retry the %s operation",
    async (operation) => {
      const local = await fixture();
      directories.push(local.directory);
      const manifestDigest = await digestJson(local.manifest);
      const paths: string[] = [];
      const fetch = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input);
        paths.push(url.pathname);
        if (url.hostname.endsWith(".actions.githubusercontent.com")) {
          return operation === "oidc" ? busy() : Response.json({ value: "oidc-secret" });
        }
        if (url.pathname === "/v1/runs") {
          return operation === "reserve"
            ? busy()
            : Response.json({
                schemaVersion: "1.0",
                runId: "run-123",
                capability: "capability-secret",
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
              });
        }
        if (operation === "finalize" && url.pathname.includes("/shards/")) {
          return Response.json({ schemaVersion: "1.0", manifestDigest, uploads: [] });
        }
        return busy();
      });
      vi.stubGlobal("fetch", fetch);
      expect((await execute(["upload", "--dir", local.directory])).code).toBe(1);
      expect(new Set(paths).size).toBe(paths.length);
    },
  );

  it("replays exact image bytes through HTTP even if the local file changes", async () => {
    const local = await fixture();
    directories.push(local.directory);
    const manifestDigest = await digestJson(local.manifest);
    const received: Buffer[] = [];
    const realFetch = globalThis.fetch;
    await using server = createServer(async (incoming, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) {
        chunks.push(Buffer.from(chunk));
      }
      if (incoming.url === "/v1/runs") {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            schemaVersion: "1.0",
            runId: "run-123",
            capability: "capability-secret",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
        );
      } else if (incoming.url?.includes("/shards/")) {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            schemaVersion: "1.0",
            manifestDigest,
            uploads: [
              {
                imageDigest: local.capture.image.digest,
                ticket: "ticket-1",
                maxBytes: imageBytes.length,
              },
            ],
          }),
        );
      } else if (incoming.url?.endsWith("/finalize")) {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            schemaVersion: "1.0",
            runId: "run-123",
            shardKey: local.manifest.shard.key,
            manifestDigest,
            state: "staged",
          }),
        );
      } else {
        received.push(Buffer.concat(chunks));
        if (received.length === 1) {
          await writeFile(join(local.directory, "capture.png"), Buffer.alloc(imageBytes.length));
          response.writeHead(503, { "Content-Type": "application/json", "Retry-After": "0" });
          response.end(JSON.stringify({ error: { code: "validation_busy" } }));
        } else {
          response.writeHead(204);
          response.end();
        }
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No server port");
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.hostname.endsWith(".actions.githubusercontent.com")) {
        return Response.json({ value: "oidc-secret" });
      }
      return realFetch(input, init);
    });
    const result = await execute(
      ["upload", "--dir", local.directory, "--json"],
      `http://127.0.0.1:${address.port}`,
    );
    expect(result.code).toBe(0);
    expect(received).toEqual([imageBytes, imageBytes]);
    expect(JSON.parse(result.stdout)).toMatchObject({ shardStaged: true, visualApproval: false });
  });
});
