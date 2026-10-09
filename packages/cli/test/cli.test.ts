import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { digestJson } from "@visonaut/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInternalCli as runCli } from "../src/engine.js";
import { fixture, imageBytes } from "./fixture.js";
import {
  emptyReferencePage,
  expectLocalReserve,
  imagePutNumbers,
  reserveAnswer,
  stagedCounts,
  submitShard,
} from "./trusted.js";

const prepared = vi.hoisted(() => ({ directory: "", server: "https://review.example.test" }));
// Workflow tests cover artifact and job provenance. These cases start at the verified manifest.
vi.mock("../src/workflow.js", () => ({ runWorkflowCommand: async () => prepared }));

const environment = {
  VISONAUT_SERVER: "https://review.example.test",
  GITHUB_RUN_ID: "456",
  GITHUB_RUN_ATTEMPT: "1",
  ACTIONS_ID_TOKEN_REQUEST_URL:
    "https://run.actions.githubusercontent.com/id-token?api-version=2.0",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-secret",
};
const directories: string[] = [];

/** The requests of one staged shard: reserve, reference, declaration, PUT, finalize, and submit. */
const stagedPaths = [
  "/id-token",
  "/v1/runs",
  "/v1/runs/run-123/reference",
  "/v1/runs/run-123/shards/chrome-1",
  "/v1/uploads/ticket-1",
  "/v1/runs/run-123/finalize",
  "/id-token",
  "/v1/runs/456/submit",
];

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

type Local = Awaited<ReturnType<typeof localFixture>>;

/** Run `submit --shard` on the capture of `local`. */
function submit(local: Local, overrides: NodeJS.ProcessEnv = {}) {
  return submitShard(prepared, local.directory, { ...environment, ...overrides });
}

interface MockServiceOptions {
  local: Local;
  change?: (url: URL, response: Record<string, unknown>) => unknown;
  requestToken?: string;
  oidcToken?: string;
  /** The workflow attempt that the submit request must carry. */
  attempt?: number;
}

async function mockService({
  local,
  change,
  requestToken = "github-request-secret",
  oidcToken = "oidc-secret",
  attempt = 1,
}: MockServiceOptions) {
  const requests: { url: URL; options: RequestInit | undefined }[] = [];
  // Submit adds the result of the local comparison to the manifest. The declaration digest is
  // the digest of the posted manifest.
  let declared: Record<string, unknown> | undefined;
  let manifestDigest = "";
  let reservation = { capability: "capability-secret", expiresAt: "" };
  const fetch = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    requests.push({ url, options });
    let response: Record<string, unknown>;
    if (url.hostname.endsWith(".actions.githubusercontent.com")) {
      expect([environment.VISONAUT_SERVER, `${environment.VISONAUT_SERVER}/submit`]).toContain(
        url.searchParams.get("audience"),
      );
      expect(new Headers(options?.headers).get("Authorization")).toBe(`Bearer ${requestToken}`);
      response = { value: oidcToken };
    } else if (url.pathname === "/v1/runs") {
      expect(new Headers(options?.headers).get("Authorization")).toBe(`Bearer ${oidcToken}`);
      expectLocalReserve(options);
      reservation = {
        capability: "capability-secret",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
      response = reserveAnswer({ schemaVersion: "1.0", runId: "run-123", ...reservation });
    } else if (url.pathname === "/v1/runs/run-123/reference") {
      expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer capability-secret");
      response = await emptyReferencePage(options, reservation);
    } else if (url.pathname.endsWith("/shards/chrome-1")) {
      expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer capability-secret");
      declared = JSON.parse(String(options?.body));
      manifestDigest = await digestJson(declared);
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
        shardKey: "chrome-1",
        manifestDigest,
        state: "staged",
      };
    } else if (url.pathname === "/v1/runs/456/submit") {
      expect(options?.method).toBe("POST");
      expect(new Headers(options?.headers).get("Authorization")).toBe(`Bearer ${oidcToken}`);
      expect(JSON.parse(String(options?.body))).toEqual({
        schemaVersion: "1.0",
        workflowAttempt: attempt,
      });
      response = {
        schemaVersion: "1.0",
        runId: "run-123",
        state: "submitted",
        submittedAt: 1790200000000,
      };
    } else {
      throw new Error("Unexpected request");
    }
    return json(change ? await change(url, response) : response);
  });
  vi.stubGlobal("fetch", fetch);
  return { requests, fetch, declared: () => declared };
}

describe("submit --shard transport", () => {
  it("stages with GitHub runner and OIDC credentials larger than ordinary text fields", async () => {
    const local = await localFixture();
    const requestToken = "request-" + "a".repeat(8192);
    const oidcToken = "oidc-" + "b".repeat(12288);
    const { requests } = await mockService({ local, requestToken, oidcToken });
    const result = await submit(local, { ACTIONS_ID_TOKEN_REQUEST_TOKEN: requestToken });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Shard chrome-1 staged and run run-123 submitted.");
    expect(requests.map(({ url }) => url.pathname)).toEqual(stagedPaths);
    expect(result.stdout + result.stderr).not.toContain(requestToken);
    expect(result.stdout + result.stderr).not.toContain(oidcToken);
  });

  it.each(["a".repeat(65537), "a".repeat(8192) + "\n", "has space"])(
    "rejects oversized or malformed GitHub credentials before sending a request",
    async (requestToken) => {
      const local = await localFixture();
      const { fetch } = await mockService({ local });
      const result = await submit(local, { ACTIONS_ID_TOKEN_REQUEST_TOKEN: requestToken });
      expect(result.code).toBe(4);
      expect(fetch).not.toHaveBeenCalled();
      expect(result.stdout + result.stderr).not.toContain(requestToken);
    },
  );

  it("rejects an oversized OIDC response before using it with the service", async () => {
    const local = await localFixture();
    const oidcToken = "b".repeat(65537);
    const { fetch } = await mockService({ local, oidcToken });
    const result = await submit(local);
    expect(result.code).toBe(4);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.stdout + result.stderr).not.toContain(oidcToken);
  });

  it("stages exact bytes with a stable run identity and does not wait for review", async () => {
    const local = await localFixture();
    const { requests } = await mockService({ local });
    const result = await submit(local);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      "Shard chrome-1 staged and run run-123 submitted. Visonaut will verify the complete workflow.\nSubmission does not grant visual approval.\n",
    );
    expect(stagedCounts(result.stdout)).toEqual({ originals: 1, reused: 0, uploaded: 1 });
    expect(imagePutNumbers(result.stdout)).toMatchObject({
      bytes: imageBytes.length,
      retryWaitMs: 0,
    });
    expect(requests.map((item) => item.url.pathname)).toEqual(stagedPaths);
    expect(requests.every((item) => item.options?.redirect === "error")).toBe(true);
    expect(result.stdout).not.toContain("secret");
  });

  it("accepts the workflow-owned staged receipt without inventing expected shards", async () => {
    const local = await localFixture();
    await mockService({
      local,
      change: (url, response) =>
        url.pathname.endsWith("/finalize")
          ? {
              schemaVersion: "1.0",
              runId: "run-123",
              shardKey: "chrome-1",
              manifestDigest: response.manifestDigest,
              state: "staged",
            }
          : response,
    });
    const result = await submit(local);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Shard chrome-1 staged and run run-123 submitted.");
  });

  it("rejects a staged receipt for a different manifest", async () => {
    const local = await localFixture();
    await mockService({
      local,
      change: (url, response) =>
        url.pathname.endsWith("/finalize")
          ? { ...response, manifestDigest: "f".repeat(64) }
          : response,
    });
    expect((await submit(local)).code).toBe(1);
  });

  it("keeps compatible optional manifest fields in the declared digest", async () => {
    const local = await localFixture();
    Object.assign(local.manifest, { schemaVersion: "1.4", futureMetadata: { text: "compatible" } });
    await writeFile(local.manifestPath, JSON.stringify(local.manifest));
    const service = await mockService({ local });
    expect((await submit(local)).code).toBe(0);
    // Submit adds only the result of the local comparison to the manifest.
    expect(service.declared()).toEqual({ ...local.manifest, localComparison: expect.any(Object) });
  });

  it("rejects a legacy run-status response instead of treating it as a staged shard", async () => {
    const local = await localFixture();
    await mockService({
      local,
      change: (url, response) =>
        url.pathname.endsWith("/finalize")
          ? {
              schemaVersion: "1.0",
              runId: "run-123",
              state: "passed",
              reviewUrl: "/runs/run-123",
              completedShards: 1,
              expectedShards: 2,
              errors: [],
            }
          : response,
    });
    expect((await submit(local)).code).toBe(1);
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
    const result = await submit(local);
    expect(result.code).toBe(1);
    expect(requests.map(({ url }) => url.pathname)).toEqual(stagedPaths.slice(0, 4));
  });

  it("replays an accepted shard without uploading its images again", async () => {
    const local = await localFixture();
    const { requests } = await mockService({
      local,
      change: (url, response) =>
        url.pathname.includes("/shards/") ? { ...response, uploads: [] } : response,
    });
    const result = await submit(local);
    expect(result.code).toBe(0);
    expect(stagedCounts(result.stdout)).toMatchObject({ uploaded: 0 });
    expect(requests.map(({ url }) => url.pathname)).toEqual(
      stagedPaths.filter((path) => !path.startsWith("/v1/uploads/")),
    );
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
    expect((await submit(local)).code).toBe(1);
    expect(requests.map(({ url }) => url.pathname)).toEqual(stagedPaths.slice(0, 4));
  });

  it("does not use an expired capability", async () => {
    const local = await localFixture();
    const { requests } = await mockService({
      local,
      change: (url, response) =>
        url.pathname === "/v1/runs" ? { ...response, expiresAt: "2000-01-01T00:00:00Z" } : response,
    });
    expect((await submit(local)).code).toBe(4);
    expect(requests).toHaveLength(2);
  });

  it("refuses an upload ticket for a different image", async () => {
    const local = await localFixture();
    const { requests } = await mockService({
      local,
      change: (url, response) =>
        url.pathname.includes("/shards/")
          ? {
              ...response,
              uploads: [
                { imageDigest: "a".repeat(64), ticket: "other", maxBytes: imageBytes.length },
              ],
            }
          : response,
    });
    expect((await submit(local)).code).toBe(1);
    expect(requests.map(({ url }) => url.pathname)).toEqual(stagedPaths.slice(0, 4));
  });

  it("fails refusals without printing a credential echoed by the service", async () => {
    const local = await localFixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN }, 500)),
    );
    const result = await submit(local);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("HTTP 500");
    expect(result.stderr).not.toContain("secret");
  });
});

describe("submit step", () => {
  it("sends the signed workflow attempt with a token for the submit audience", async () => {
    const local = await localFixture();
    const { requests } = await mockService({ local });
    const result = await submit(local);
    expect(result.code).toBe(0);
    // The reserve call and the submit call each use their own token.
    const audiences = requests
      .filter(({ url }) => url.pathname === "/id-token")
      .map(({ url }) => url.searchParams.get("audience"));
    expect(audiences).toEqual([
      "https://review.example.test/submit",
      "https://review.example.test/submit",
    ]);
    const last = requests.at(-1);
    expect(last?.url.pathname).toBe("/v1/runs/456/submit");
    expect(JSON.parse(String(last?.options?.body))).toEqual({
      schemaVersion: "1.0",
      workflowAttempt: 1,
    });
  });

  it("sends the attempt of a rerun in the submit request", async () => {
    const local = await localFixture();
    // A submitted shard belongs to the attempt of its workflow run.
    local.manifest.run.workflowAttempt = 2;
    local.manifest.shard.sourceAttempt = 2;
    await writeFile(local.manifestPath, JSON.stringify(local.manifest));
    const { requests } = await mockService({ local, attempt: 2 });
    const result = await submit(local, { GITHUB_RUN_ATTEMPT: "2" });
    expect(result.code).toBe(0);
    expect(JSON.parse(String(requests.at(-1)?.options?.body))).toEqual({
      schemaVersion: "1.0",
      workflowAttempt: 2,
    });
  });

  it("prints only aggregate image PUT measurements for a signed submit", async () => {
    const local = await localFixture();
    const { requests } = await mockService({ local });
    const result = await submit(local);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Visonaut staged 1 originals (0 reused, 1 uploaded)");
    expect(result.stdout).toMatch(
      new RegExp(
        `Image PUTs: \\d+ms aggregate request time, ${imageBytes.length} attempted bytes, 0ms retry wait\\.`,
      ),
    );
    expect(result.stdout).not.toContain(local.capture.name);
    expect(result.stdout).not.toContain(local.capture.image.path);
    expect(result.stdout).not.toContain("secret");
    expect(requests).toHaveLength(stagedPaths.length);
  });

  it.each([{ GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_RUN_ID: "457" }])(
    "rejects a capture from another run or attempt before staging: %j",
    async (overrides) => {
      const local = await localFixture();
      const { fetch } = await mockService({ local });
      const result = await submit(local, overrides);
      expect(result.code).toBe(4);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects a submission receipt for a different internal run", async () => {
    const local = await localFixture();
    const { requests } = await mockService({
      local,
      change: (url, response) =>
        url.pathname.endsWith("/submit") ? { ...response, runId: "other-run" } : response,
    });
    const result = await submit(local);
    expect(result.code).toBe(1);
    expect(requests.at(-1)?.url.pathname).toBe("/v1/runs/456/submit");
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
    const result = await submit(local);
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
    expect((await submit(local)).code).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("caps file reads before allocating the advertised image size", async () => {
    const local = await localFixture();
    local.capture.image.bytes = 21 * 1024 * 1024;
    await truncate(join(local.directory, "capture.png"), local.capture.image.bytes);
    await writeFile(local.manifestPath, JSON.stringify(local.manifest));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await submit(local)).code).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("caps manifest file reads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "visonaut-cli-size-"));
    directories.push(directory);
    const file = join(directory, "manifest.json");
    await writeFile(file, "{}");
    await truncate(file, 8 * 1024 * 1024 + 1);
    expect((await submitShard(prepared, directory, environment)).code).toBe(1);
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
      ["finalize"],
      ["status"],
      ["status", "--run", "one", "--run", "two"],
      ["status", "--run", "one", "--token", "secret"],
      ["status", "--run", "one", "--manifest", "manifest.json"],
      ["status", "--run", "one", "--dir", "visonaut"],
      // The commands that the service no longer accepts.
      ["upload", "--dir", "visonaut"],
      ["upload", "--run", "one"],
      ["transfer-key"],
      ["submit", "--run", "456"],
      ["submit", "--run", "one", "--dir", "visonaut"],
      ["submit", "--dir", "visonaut", "--json"],
      ["submit", "--manifest", "manifest.json"],
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
    const result = await submit(local, {
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
