import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { digestJson } from "@visonaut/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";
import { fixture, imageBytes } from "./fixture.js";

const environment = {
  VISONAUT_SERVER: "https://review.example.test",
  ACTIONS_ID_TOKEN_REQUEST_URL:
    "https://run.actions.githubusercontent.com/id-token?api-version=2.0",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-secret",
};
const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function execute(argv: string[], overrides: NodeJS.ProcessEnv = {}) {
  let stdout = "";
  let stderr = "";
  const code = await runCli({
    argv,
    environment: { ...environment, ...overrides },
    stdout: (value) => {
      stdout += value;
    },
    stderr: (value) => {
      stderr += value;
    },
  });
  return { code, stdout, stderr };
}

async function localFixture() {
  const local = await fixture();
  directories.push(local.directory);
  return local;
}

interface MockServiceOptions {
  local: Awaited<ReturnType<typeof fixture>>;
  change?: (url: URL, response: unknown) => unknown;
  finalState?: string;
  requestToken?: string;
  oidcToken?: string;
}

async function mockService({
  local,
  change,
  finalState = "comparing",
  requestToken = "github-request-secret",
  oidcToken = "oidc-secret",
}: MockServiceOptions) {
  const manifestDigest = await digestJson(local.manifest);
  const requests: { url: URL; options: RequestInit | undefined }[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    requests.push({ url, options });
    let response: unknown;
    if (url.hostname.endsWith(".actions.githubusercontent.com")) {
      expect(url.searchParams.get("audience")).toBe(environment.VISONAUT_SERVER);
      expect(new Headers(options?.headers).get("Authorization")).toBe(`Bearer ${requestToken}`);
      response = { value: oidcToken };
    } else if (url.pathname === "/v1/runs") {
      expect(new Headers(options?.headers).get("Authorization")).toBe(`Bearer ${oidcToken}`);
      response = {
        schemaVersion: "1.0",
        runId: "run-123",
        capability: "capability-secret",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    } else if (url.pathname.endsWith("/shards/chrome-1")) {
      expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer capability-secret");
      response = {
        schemaVersion: "1.0",
        manifestDigest,
        uploads: [
          {
            imageDigest: local.capture.image.digest,
            ticket: "ticket-1",
            maxBytes: imageBytes.length,
          },
        ],
      };
    } else if (url.pathname === "/v1/uploads/ticket-1") {
      expect(options?.body).toEqual(imageBytes);
      expect(options?.method).toBe("PUT");
      expect(new Headers(options?.headers).get("Content-Type")).toBe("image/png");
      return new Response(null, { status: 204 });
    } else if (url.pathname.endsWith("/finalize")) {
      expect(options?.method).toBe("POST");
      expect(JSON.parse(String(options?.body))).toEqual({
        schemaVersion: "1.0",
        shardKey: "chrome-1",
        manifestDigest,
      });
      response = {
        schemaVersion: "1.0",
        runId: "run-123",
        state: finalState,
        reviewUrl: "/runs/run-123",
        completedShards: 1,
        expectedShards: 2,
        errors: [],
      };
    } else {
      throw new Error("Unexpected request");
    }
    return json(change ? await change(url, response) : response);
  });
  vi.stubGlobal("fetch", fetch);
  return { requests, fetch };
}

describe("public upload and finalize commands", () => {
  it("uploads with GitHub runner and OIDC credentials larger than ordinary text fields", async () => {
    const local = await localFixture();
    const requestToken = "request-" + "a".repeat(8192);
    const oidcToken = "oidc-" + "b".repeat(12288);
    const { requests } = await mockService({ local, requestToken, oidcToken });
    const result = await execute(["upload", "--manifest", local.manifestPath, "--json"], {
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: requestToken,
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ dataAccepted: true, visualApproval: false });
    expect(requests.map(({ url }) => url.pathname)).toEqual([
      "/id-token",
      "/v1/runs",
      "/v1/runs/run-123/shards/chrome-1",
      "/v1/uploads/ticket-1",
    ]);
    expect(result.stdout + result.stderr).not.toContain(requestToken);
    expect(result.stdout + result.stderr).not.toContain(oidcToken);
  });

  it.each(["a".repeat(65537), "a".repeat(8192) + "\n", "has space"])(
    "rejects oversized or malformed GitHub credentials before sending a request",
    async (requestToken) => {
      const local = await localFixture();
      const { fetch } = await mockService({ local });
      const result = await execute(["upload", "--manifest", local.manifestPath], {
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: requestToken,
      });
      expect(result.code).toBe(4);
      expect(fetch).not.toHaveBeenCalled();
      expect(result.stdout + result.stderr).not.toContain(requestToken);
    },
  );

  it("rejects an oversized OIDC response before using it with the service", async () => {
    const local = await localFixture();
    const oidcToken = "b".repeat(65537);
    const { fetch } = await mockService({ local, oidcToken });
    const result = await execute(["upload", "--manifest", local.manifestPath]);
    expect(result.code).toBe(4);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.stdout + result.stderr).not.toContain(oidcToken);
  });

  it("uploads exact bytes, uses distinct OIDC/capability scopes, and does not wait for review", async () => {
    const local = await localFixture();
    const { requests } = await mockService({ local });
    const result = await execute(["upload", "--manifest", local.manifestPath, "--json"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: "1.0",
      operation: "upload",
      runId: "run-123",
      shardKey: "chrome-1",
      manifestDigest: await digestJson(local.manifest),
      uploadedImages: 1,
      dataAccepted: true,
      visualApproval: false,
    });
    expect(requests.map((item) => item.url.pathname)).toEqual([
      "/id-token",
      "/v1/runs",
      "/v1/runs/run-123/shards/chrome-1",
      "/v1/uploads/ticket-1",
    ]);
    expect(requests.every((item) => item.options?.redirect === "error")).toBe(true);
    expect(result.stdout).not.toContain("secret");
  });

  it("keeps compatible optional manifest fields in the declared digest", async () => {
    const local = await localFixture();
    Object.assign(local.manifest, { schemaVersion: "1.4", futureMetadata: { text: "compatible" } });
    await writeFile(local.manifestPath, JSON.stringify(local.manifest));
    const { requests } = await mockService({ local });
    expect((await execute(["upload", "--manifest", local.manifestPath])).code).toBe(0);
    expect(JSON.parse(String(requests[2]?.options?.body))).toEqual(local.manifest);
  });

  it.each(["comparing", "needs-review", "rejected", "incomplete", "passed"])(
    "finalize returns after shard acceptance with state %s",
    async (finalState) => {
      const local = await localFixture();
      await rm(join(local.directory, "capture.png"));
      const { requests } = await mockService({ local, finalState });
      const result = await execute(["finalize", "--manifest", local.manifestPath, "--json"]);
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        operation: "finalize",
        state: finalState,
        visualApproval: false,
      });
      expect(requests).toHaveLength(3);
    },
  );

  it.each(["failed", "superseded"])("finalize fails for %s", async (finalState) => {
    const local = await localFixture();
    await mockService({ local, finalState });
    expect((await execute(["finalize", "--manifest", local.manifestPath])).code).toBe(1);
  });

  it("refuses a mismatched declaration digest", async () => {
    const local = await localFixture();
    const { requests } = await mockService({
      local,
      change: (url, response) =>
        url.pathname.includes("/shards/")
          ? { schemaVersion: "1.0", manifestDigest: "unused", uploads: [] }
          : response,
    });
    const result = await execute(["upload", "--manifest", local.manifestPath]);
    expect(result.code).toBe(1);
    expect(requests).toHaveLength(3);
  });

  it("replays an accepted shard without uploading its images again", async () => {
    const local = await localFixture();
    const manifestDigest = await digestJson(local.manifest);
    const { requests } = await mockService({
      local,
      change: (url, response) =>
        url.pathname.includes("/shards/")
          ? { schemaVersion: "1.0", manifestDigest, uploads: [] }
          : response,
    });
    const result = await execute(["upload", "--manifest", local.manifestPath, "--json"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ uploadedImages: 0, visualApproval: false });
    expect(requests).toHaveLength(3);
  });

  it("checks the image again if it changes after preflight", async () => {
    const local = await localFixture();
    const { requests } = await mockService({
      local,
      change: async (url, response) => {
        if (url.pathname.includes("/shards/")) {
          await writeFile(join(local.directory, "capture.png"), Buffer.alloc(imageBytes.length));
        }
        return response;
      },
    });
    expect((await execute(["upload", "--manifest", local.manifestPath])).code).toBe(1);
    expect(requests).toHaveLength(3);
  });

  it("does not use an expired capability", async () => {
    const local = await localFixture();
    const { requests } = await mockService({
      local,
      change: (url, response) =>
        url.pathname === "/v1/runs"
          ? {
              schemaVersion: "1.0",
              runId: "run-123",
              capability: "expired-secret",
              expiresAt: "2000-01-01T00:00:00Z",
            }
          : response,
    });
    expect((await execute(["upload", "--manifest", local.manifestPath])).code).toBe(4);
    expect(requests).toHaveLength(2);
  });

  it("refuses an upload ticket for a different image", async () => {
    const local = await localFixture();
    const manifestDigest = await digestJson(local.manifest);
    const { requests } = await mockService({
      local,
      change: (url, response) =>
        url.pathname.includes("/shards/")
          ? {
              schemaVersion: "1.0",
              manifestDigest,
              uploads: [
                { imageDigest: "a".repeat(64), ticket: "other", maxBytes: imageBytes.length },
              ],
            }
          : response,
    });
    expect((await execute(["upload", "--manifest", local.manifestPath])).code).toBe(1);
    expect(requests).toHaveLength(3);
  });

  it("fails upload errors without printing a credential echoed by the service", async () => {
    const local = await localFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN }, 500)),
    );
    const result = await execute(["upload", "--manifest", local.manifestPath, "--json"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("HTTP 500");
    expect(result.stderr).not.toContain("secret");
  });
});

describe("local data validation before network access", () => {
  it.each([
    "missing",
    "digest",
    "size",
    "empty",
    "major",
    "profile",
    "retry",
    "traversal",
    "absolute",
  ])("refuses %s evidence", async (problem) => {
    const local = await localFixture();
    if (problem === "missing") {
      await rm(join(local.directory, "capture.png"));
    } else if (problem === "digest") {
      local.capture.image.digest = "a".repeat(64);
    } else if (problem === "size") {
      local.capture.image.bytes += 1;
    } else if (problem === "empty") {
      local.manifest.captures = [];
    } else if (problem === "major") {
      local.manifest.schemaVersion = "2.0";
    } else if (problem === "profile") {
      const profile = local.manifest.profiles[0];
      if (!profile) throw new Error("Missing fixture profile");
      profile.profile.locale = "pt-BR";
    } else if (problem === "retry") {
      local.capture.testRetry = 0;
    } else if (problem === "traversal") {
      local.capture.image.path = "../capture.png";
    } else {
      local.capture.image.path = join(local.directory, "capture.png");
    }
    await writeFile(local.manifestPath, JSON.stringify(local.manifest));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = await execute(["upload", "--manifest", local.manifestPath]);
    expect(result.code).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["file", "directory"])("refuses %s symlinks", async (kind) => {
    const local = await localFixture();
    if (kind === "file") {
      await symlink(join(local.directory, "capture.png"), join(local.directory, "link.png"));
      local.capture.image.path = "link.png";
    } else {
      await mkdir(join(local.directory, "images"));
      await writeFile(join(local.directory, "images", "capture.png"), imageBytes);
      await symlink(join(local.directory, "images"), join(local.directory, "linked"));
      local.capture.image.path = "linked/capture.png";
    }
    await writeFile(local.manifestPath, JSON.stringify(local.manifest));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await execute(["upload", "--manifest", local.manifestPath])).code).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("caps file reads before allocating the advertised image size", async () => {
    const local = await localFixture();
    local.capture.image.bytes = 21 * 1024 * 1024;
    await truncate(join(local.directory, "capture.png"), local.capture.image.bytes);
    await writeFile(local.manifestPath, JSON.stringify(local.manifest));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await execute(["upload", "--manifest", local.manifestPath])).code).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("caps manifest file reads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "visonaut-cli-size-"));
    directories.push(directory);
    const file = join(directory, "manifest.json");
    await writeFile(file, "{}");
    await truncate(file, 8 * 1024 * 1024 + 1);
    expect((await execute(["upload", "--manifest", file])).code).toBe(1);
  });
});

describe("status output and authentication", () => {
  it.each([
    "passed",
    "uploading",
    "incomplete",
    "comparing",
    "needs-review",
    "rejected",
    "failed",
    "superseded",
  ])("returns accurate JSON for %s", async (state) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, options?: RequestInit) => {
        expect(new Headers(options?.headers).get("Authorization")).toBe(
          "Bearer maintainer-session-secret",
        );
        return json({
          schemaVersion: "1.0",
          runId: "run-123",
          state,
          reviewUrl: "/runs/run-123",
          completedShards: 1,
          expectedShards: 2,
          errors: [],
        });
      }),
    );
    const result = await execute(["status", "--run", "run-123", "--json"], {
      VISONAUT_TOKEN: "maintainer-session-secret",
    });
    expect(result.code).toBe(state === "passed" ? 0 : 3);
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: "1.0",
      runId: "run-123",
      state,
      reviewUrl: "https://review.example.test/runs/run-123",
      completedShards: 1,
      expectedShards: 2,
      errors: [],
    });
  });

  it("does not use GitHub credentials as a private status credential", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await execute(["status", "--run", "run-123"])).code).toBe(4);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("prints readable text and redacts the session if a response echoes it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          schemaVersion: "1.0",
          runId: "run-123",
          state: "needs-review",
          reviewUrl: "/runs/run-123",
          completedShards: 2,
          expectedShards: 2,
          errors: ["secret-session"],
        }),
      ),
    );
    const result = await execute(["status", "--run", "run-123"], {
      VISONAUT_TOKEN: "secret-session",
    });
    expect(result.stdout).toBe(
      "Run run-123: needs-review\nShards: 2/2\nReview: https://review.example.test/runs/run-123\nError: [REDACTED]\n",
    );
  });

  it.each([401, 403])("reports status permission failure for HTTP %s", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({}, status)),
    );
    expect(
      (await execute(["status", "--run", "run-123"], { VISONAUT_TOKEN: "session" })).code,
    ).toBe(4);
  });

  it.each(["2.0", "1.0"])(
    "refuses bad schema or run identity with version %s",
    async (schemaVersion) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          json({
            schemaVersion,
            runId: "other",
            state: "passed",
            reviewUrl: "/runs/other",
            completedShards: 1,
            expectedShards: 1,
            errors: [],
          }),
        ),
      );
      expect(
        (await execute(["status", "--run", "run-123"], { VISONAUT_TOKEN: "session" })).code,
      ).toBe(1);
    },
  );
});

describe("argument and transport boundaries", () => {
  it.each(
    [
      [],
      ["approve"],
      ["upload"],
      ["status"],
      ["status", "--run", "one", "--run", "two"],
      ["status", "--run", "one", "--token", "secret"],
      ["status", "--run", "one", "--manifest", "manifest.json"],
    ].map((argv) => ({ argv })),
  )("rejects unsupported arguments $argv", async ({ argv }) => {
    expect((await execute(argv)).code).toBe(2);
  });

  it.each([
    "http://example.test",
    "https://user:secret@example.test",
    "https://example.test/api",
    "https://example.test/?token=secret",
    "https://example.test/#secret",
  ])("refuses unsafe service origin %s", async (server) => {
    expect(
      (await execute(["status", "--run", "one", "--server", server], { VISONAUT_TOKEN: "session" }))
        .code,
    ).toBe(2);
  });

  it("refuses a fake GitHub OIDC host before sending the Actions token", async () => {
    const local = await localFixture();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = await execute(["upload", "--manifest", local.manifestPath], {
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://attacker.example.test/id-token",
    });
    expect(result.code).toBe(4);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds streamed responses without trusting Content-Length", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(" ".repeat(2 * 1024 * 1024 + 1), {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    expect((await execute(["status", "--run", "one"], { VISONAUT_TOKEN: "session" })).code).toBe(1);
  });

  it("never follows a redirect with the maintainer credential", async () => {
    let redirected = false;
    await using server = createServer((incoming, response) => {
      if (incoming.url === "/redirected") {
        redirected = true;
      }
      response.writeHead(302, { Location: "/redirected" });
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No server port");
    const result = await execute(
      ["status", "--run", "one", "--server", `http://127.0.0.1:${address.port}`],
      { VISONAUT_TOKEN: "session" },
    );
    expect(result.code).toBe(1);
    expect(redirected).toBe(false);
  });
});
