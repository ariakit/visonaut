import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureRowView } from "@visonaut/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInternalCli as runCli } from "../src/engine.js";
import { fixture, imageBytes } from "./fixture.js";
import { json, pageService } from "./page-service.js";
import type { Prepared } from "./page-service.js";
import { imagePutNumbers, stagedCounts, submitShard } from "./trusted.js";

const prepared = vi.hoisted((): Prepared => ({
  server: "https://review.example.test",
  bundles: [],
  directory: "",
  directories: [],
}));
// Workflow tests cover artifact and job provenance. These cases start at the verified bundles.
vi.mock("../src/workflow.js", async () =>
  (await import("./page-service.js")).workflowMock(prepared),
);

const environment = {
  VISONAUT_SERVER: "https://review.example.test",
  GITHUB_RUN_ID: "456",
  GITHUB_RUN_ATTEMPT: "1",
  ACTIONS_ID_TOKEN_REQUEST_URL:
    "https://run.actions.githubusercontent.com/id-token?api-version=2.0",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-secret",
};
const directories: string[] = prepared.directories;

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

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
  return submitShard(prepared, [local], { ...environment, ...overrides });
}

/** The requests of one staged run: reserve, one page, one PUT, the index, and submit. */
function stagedPaths(local: Local) {
  return [
    "/id-token",
    "/v1/runs",
    "/v1/runs/run-123/pages",
    `/v1/uploads/ticket-${local.capture.image.digest}.`,
    "/v1/runs/run-123/index",
    "/id-token",
    "/v1/runs/456/submit",
  ];
}

// A service with no reference: the capture is new, so Submit stages its original.
const mockService = pageService;

describe("submit --shard transport", () => {
  it("stages with GitHub runner and OIDC credentials larger than ordinary text fields", async () => {
    const local = await localFixture();
    const requestToken = "request-" + "a".repeat(8192);
    const oidcToken = "oidc-" + "b".repeat(12288);
    const service = mockService({ requestToken, oidcToken });
    const result = await submit(local, { ACTIONS_ID_TOKEN_REQUEST_TOKEN: requestToken });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("The captures are staged and run run-123 is submitted.");
    expect(service.paths()).toEqual(stagedPaths(local));
    expect(result.stdout + result.stderr).not.toContain(requestToken);
    expect(result.stdout + result.stderr).not.toContain(oidcToken);
  });

  it.each(["a".repeat(65537), "a".repeat(8192) + "\n", "has space"])(
    "rejects oversized or malformed GitHub credentials before sending a request",
    async (requestToken) => {
      const local = await localFixture();
      const { fetch } = mockService();
      const result = await submit(local, { ACTIONS_ID_TOKEN_REQUEST_TOKEN: requestToken });
      expect(result.code).toBe(4);
      expect(fetch).not.toHaveBeenCalled();
      expect(result.stdout + result.stderr).not.toContain(requestToken);
    },
  );

  it("rejects an oversized OIDC response before using it with the service", async () => {
    const local = await localFixture();
    const oidcToken = "b".repeat(65537);
    const { fetch } = mockService({ oidcToken });
    const result = await submit(local);
    expect(result.code).toBe(4);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.stdout + result.stderr).not.toContain(oidcToken);
  });

  it("stages exact bytes with a stable run identity and does not wait for review", async () => {
    const local = await localFixture();
    const service = mockService();
    const result = await submit(local);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      "The captures are staged and run run-123 is submitted. Visonaut will verify the complete workflow.\nSubmission does not grant visual approval.\n",
    );
    expect(stagedCounts(result.stdout)).toEqual({ originals: 1, reused: 0, uploaded: 1 });
    expect(imagePutNumbers(result.stdout)).toMatchObject({
      bytes: imageBytes.length,
      retryWaitMs: 0,
    });
    expect(service.paths()).toEqual(stagedPaths(local));
    expect(service.uploads.get(local.capture.image.digest)).toEqual(Uint8Array.from(imageBytes));
    expect(service.requests.every((item) => item.options?.redirect === "error")).toBe(true);
    expect(result.stdout).not.toContain("secret");
  });

  it("sends the capture as one row with its name, its test, and its profile", async () => {
    const local = await localFixture();
    const service = mockService();
    expect((await submit(local)).code).toBe(0);
    const [page] = service.pages();
    const [row] = page?.rows ?? [];
    if (!page || !row) throw new Error("The CLI sent no row.");
    expect(await captureRowView(page, row)).toEqual({
      itemKey: "dialog/open",
      variantKey: "react-light",
      name: "Open dialog",
      variant: local.capture.variant,
      test: {
        id: "chrome-1/test-1",
        file: "dialog.test.ts",
        titlePath: ["dialog", "open"],
        retry: 1,
      },
      profile: local.manifest.profiles[0]?.profile,
      profileDigest: local.capture.profileDigest,
      comparison: { threshold: 0.2 },
      image: {
        digest: local.capture.image.digest,
        bytes: imageBytes.length,
        width: 1,
        height: 1,
      },
      result: 1,
    });
  });

  it("rejects a staged receipt for a different manifest digest", async () => {
    const local = await localFixture();
    mockService({
      change: (url, response) =>
        url.pathname.endsWith("/index")
          ? { ...response, manifestDigest: "f".repeat(64) }
          : response,
    });
    expect((await submit(local)).code).toBe(1);
  });

  it("rejects a run-status response instead of treating it as a staged run", async () => {
    const local = await localFixture();
    mockService({
      change: (url, response) =>
        url.pathname.endsWith("/index")
          ? {
              schemaVersion: "1.0",
              runId: "run-123",
              manifestDigest: response.manifestDigest,
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

  it("refuses a mismatched page digest", async () => {
    const local = await localFixture();
    const service = mockService({
      change: (url, response) =>
        url.pathname.endsWith("/pages")
          ? { schemaVersion: "1.0", pageDigest: "unused", uploads: [] }
          : response,
    });
    const result = await submit(local);
    expect(result.code).toBe(1);
    expect(service.paths()).toEqual(stagedPaths(local).slice(0, 3));
  });

  it("sends an accepted page again without uploading its images again", async () => {
    const local = await localFixture();
    const service = mockService({
      change: (url, response) =>
        url.pathname.endsWith("/pages") ? { ...response, uploads: [] } : response,
    });
    const result = await submit(local);
    expect(result.code).toBe(0);
    expect(stagedCounts(result.stdout)).toMatchObject({ uploaded: 0 });
    expect(service.paths()).toEqual(
      stagedPaths(local).filter((path) => !path.startsWith("/v1/uploads/")),
    );
  });

  it("checks the image again if it changes after preflight", async () => {
    const local = await localFixture();
    const service = mockService({
      change: async (url, response) => {
        if (url.pathname.endsWith("/pages")) {
          const stored = join(prepared.directory, "images", `${local.capture.image.digest}.png`);
          await writeFile(stored, Buffer.alloc(imageBytes.length));
        }
        return response;
      },
    });
    const result = await submit(local);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("dialog/open (react-light): An image does not match");
    expect(service.paths()).toEqual(stagedPaths(local).slice(0, 3));
  });

  it("does not use an expired capability", async () => {
    const local = await localFixture();
    const service = mockService({
      change: (url, response) =>
        url.pathname === "/v1/runs" ? { ...response, expiresAt: "2000-01-01T00:00:00Z" } : response,
    });
    expect((await submit(local)).code).toBe(4);
    expect(service.requests).toHaveLength(2);
  });

  it("refuses an upload ticket for a different image", async () => {
    const local = await localFixture();
    const service = mockService({
      change: (url, response) =>
        url.pathname.endsWith("/pages")
          ? {
              ...response,
              uploads: [
                { imageDigest: "a".repeat(64), ticket: "other", maxBytes: imageBytes.length },
              ],
            }
          : response,
    });
    expect((await submit(local)).code).toBe(1);
    expect(service.paths()).toEqual(stagedPaths(local).slice(0, 3));
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

  it("stops at the reserve call of a service that has no capture pages", async () => {
    const local = await localFixture();
    // The service of today refuses the comparison mode before it reserves a run.
    const service = mockService({
      respond: (url) =>
        url.pathname === "/v1/runs"
          ? json(
              { schemaVersion: "1.0", error: { code: "comparison_mode", message: "private" } },
              400,
            )
          : undefined,
    });
    const result = await submit(local);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "visonaut: The service refused the request (HTTP 400, comparison_mode). No visual approval was granted.\n",
    );
    expect(service.paths()).toEqual(["/id-token", "/v1/runs"]);
  });

  it("refuses a reserve answer with the comparison mode of the manifest requests", async () => {
    const local = await localFixture();
    const service = mockService({
      change: (url, response) =>
        url.pathname === "/v1/runs" ? { ...response, comparisonMode: "local-v1" } : response,
    });
    const result = await submit(local);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("The service does not support capture pages.");
    expect(service.paths()).toEqual(["/id-token", "/v1/runs"]);
  });
});

describe("submit step", () => {
  it("sends the signed workflow attempt with a token for the submit audience", async () => {
    const local = await localFixture();
    const service = mockService();
    const result = await submit(local);
    expect(result.code).toBe(0);
    // The reserve call and the submit call each use their own token.
    const audiences = service.requests
      .filter(({ url }) => url.pathname === "/id-token")
      .map(({ url }) => url.searchParams.get("audience"));
    expect(audiences).toEqual([
      "https://review.example.test/submit",
      "https://review.example.test/submit",
    ]);
    const last = service.requests.at(-1);
    expect(last?.url.pathname).toBe("/v1/runs/456/submit");
    expect(JSON.parse(String(last?.options?.body))).toEqual({
      schemaVersion: "1.0",
      workflowAttempt: 1,
    });
  });

  it("sends the attempt of a rerun in the reserve call, the index, and the submit request", async () => {
    const local = await localFixture();
    // The capture job ran in attempt 1, and the signed Submit job runs in attempt 2.
    prepared.attempt = 2;
    const service = mockService();
    const result = await submit(local, { GITHUB_RUN_ATTEMPT: "2" });
    prepared.attempt = undefined;
    expect(result.code).toBe(0);
    expect(service.reserveBodies[0]).toMatchObject({ workflowRunId: "456", workflowAttempt: 2 });
    expect(service.index()?.job).toEqual({ id: "789", attempt: 2 });
    expect(service.index()?.sources[0]).toMatchObject({ shardKey: "chrome-1", workflowAttempt: 1 });
    expect(JSON.parse(String(service.requests.at(-1)?.options?.body))).toEqual({
      schemaVersion: "1.0",
      workflowAttempt: 2,
    });
  });

  it("prints only aggregate image PUT measurements for a signed submit", async () => {
    const local = await localFixture();
    const service = mockService();
    const result = await submit(local);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      "Visonaut staged 1 originals (0 reused, 1 uploaded) and 1 capture pages",
    );
    expect(result.stdout).toMatch(
      new RegExp(
        `Image PUTs: \\d+ms aggregate request time, ${imageBytes.length} attempted bytes, 0ms retry wait\\.`,
      ),
    );
    expect(result.stdout).not.toContain(local.capture.name);
    expect(result.stdout).not.toContain(local.capture.image.digest);
    expect(result.stdout).not.toContain("secret");
    expect(service.requests).toHaveLength(stagedPaths(local).length);
  });

  it.each([{ GITHUB_RUN_ATTEMPT: "2" }, { GITHUB_RUN_ID: "457" }])(
    "rejects a capture from another run or attempt before staging: %j",
    async (overrides) => {
      const local = await localFixture();
      const { fetch } = mockService();
      const result = await submit(local, overrides);
      expect(result.code).toBe(4);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects a submission receipt for a different internal run", async () => {
    const local = await localFixture();
    const service = mockService({
      change: (url, response) =>
        url.pathname.endsWith("/submit") ? { ...response, runId: "other-run" } : response,
    });
    const result = await submit(local);
    expect(result.code).toBe(1);
    expect(service.requests.at(-1)?.url.pathname).toBe("/v1/runs/456/submit");
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
    const { manifest } = await localFixture();
    expect((await submitShard(prepared, [{ directory, manifest }], environment)).code).toBe(1);
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

  describe("session cookie form of VISONAUT_TOKEN", () => {
    const statusAnswer = {
      schemaVersion: "1.0",
      runId: "run-123",
      state: "passed",
      reviewUrl: "/runs/run-123",
      completedShards: 1,
      expectedShards: 1,
      errors: [],
    };

    it.each([
      { name: "decoded", token: "abc.d+e/f=", sent: "abc.d+e/f=" },
      { name: "percent-encoded", token: "abc.d%2Be%2Ff%3D", sent: "abc.d+e/f=" },
    ])("sends the $name form as the decoded session", async ({ token, sent }) => {
      const fetch = vi.fn(async (_url: unknown, options?: RequestInit) => {
        expect(new Headers(options?.headers).get("Authorization")).toBe(`Bearer ${sent}`);
        return json(statusAnswer);
      });
      vi.stubGlobal("fetch", fetch);
      const result = await execute(["status", "--run", "run-123", "--json"], {
        VISONAUT_TOKEN: token,
      });
      expect(result.code).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("redacts the encoded and the decoded form if a response echoes them", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => json({ ...statusAnswer, errors: ["abc.d+e/f=", "abc.d%2Be%2Ff%3D"] })),
      );
      const result = await execute(["status", "--run", "run-123"], {
        VISONAUT_TOKEN: "abc.d%2Be%2Ff%3D",
      });
      expect(result.stdout).toContain("Error: [REDACTED]\nError: [REDACTED]\n");
    });

    it.each(["abc%", "abc%zz", "abc%E0%A4%A", "abc%25def", "abc%0Adef", "abc%20def"])(
      "refuses %s before any request",
      async (token) => {
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);
        const result = await execute(["status", "--run", "run-123"], { VISONAUT_TOKEN: token });
        expect(result.code).toBe(4);
        expect(fetch).not.toHaveBeenCalled();
      },
    );
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
