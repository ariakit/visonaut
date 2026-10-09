import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { runCli } from "../src/index.js";
import { fixture } from "./fixture.js";

const prepared = vi.hoisted(() => ({ directory: "", server: "https://visonaut.example" }));
// Workflow tests cover artifact and job provenance. These cases start at the verified manifest.
vi.mock("../src/workflow.js", () => ({ runWorkflowCommand: async () => prepared }));

const environment = {
  VISONAUT_SERVER: prepared.server,
  GITHUB_RUN_ID: "456",
  GITHUB_RUN_ATTEMPT: "1",
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/id-token",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
};

const WAIT_MS = 30_000;
const directories: string[] = [];

let timeouts: MockInstance<typeof setTimeout>;

beforeEach(() => {
  // Only the wait is faked: the request deadline reads performance.now.
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  timeouts = vi.spyOn(globalThis, "setTimeout");
});

afterEach(async () => {
  // Restore the spy before the clock: the spy wraps the fake setTimeout.
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * Serve the reserve call. The service sends `Retry-After: 1` with each 503. A call that `refuse`
 * answers with a code is refused. The first call that it leaves alone is accepted, and the next
 * request (the reference page) ends the run with a service failure.
 */
async function serve(refuse: (call: number) => string | undefined) {
  const local = await fixture();
  directories.push(local.directory);
  prepared.directory = local.directory;
  const [capture] = local.manifest.captures;
  if (!capture) {
    throw new Error("The fixture has no capture.");
  }
  // The first validation pass decodes the image, so it must be a real PNG.
  const png = new PNG({ width: 2, height: 2 });
  png.data.fill(255);
  const bytes = PNG.sync.write(png);
  await writeFile(join(local.directory, capture.image.path), bytes);
  capture.image = {
    ...capture.image,
    digest: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    width: 2,
    height: 2,
  };
  capture.comparison = { threshold: 0.2 };
  await writeFile(local.manifestPath, JSON.stringify(local.manifest));
  const tokenRequests: string[] = [];
  const reserves: string[] = [];
  const paths: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.hostname.endsWith(".actions.githubusercontent.com")) {
        const token = `oidc-token-${tokenRequests.length + 1}`;
        tokenRequests.push(token);
        return Response.json({ value: token });
      }
      paths.push(url.pathname);
      if (url.pathname !== "/v1/runs") {
        return Response.json({ error: { code: "stop_here" } }, { status: 500 });
      }
      reserves.push(new Headers(init?.headers).get("authorization") ?? "");
      const code = refuse(reserves.length);
      if (code) {
        return Response.json(
          { schemaVersion: "1.0", error: { code, message: "server-secret" } },
          { status: 503, headers: { "Retry-After": "1" } },
        );
      }
      return Response.json({
        schemaVersion: "1.0",
        runId: "run-1",
        capability: "run-capability",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        comparisonMode: "local-v1",
      });
    }),
  );
  return { reserves, tokenRequests, paths };
}

function submit() {
  let stdout = "";
  let stderr = "";
  const running = runCli({
    argv: ["submit", "--shard", "chrome-1"],
    environment,
    stdout: (value) => {
      stdout += value;
    },
    stderr: (value) => {
      stderr += value;
    },
  });
  return {
    /** Advance the fake clock until the CLI ends. */
    async finish() {
      let done = false;
      const code = running.finally(() => {
        done = true;
      });
      while (!done) {
        await vi.advanceTimersByTimeAsync(1_000);
      }
      return { code: await code, stdout, stderr };
    },
  };
}

describe("a reserve call that the service refuses at its capacity limit", () => {
  it("waits, asks for a new token for each try, and goes on after 3 refusals", async () => {
    const service = await serve((call) => (call <= 3 ? "capacity_exceeded" : undefined));
    const result = await submit().finish();
    // The run goes on to the reference page, which the stub fails.
    expect(service.paths).toEqual([
      "/v1/runs",
      "/v1/runs",
      "/v1/runs",
      "/v1/runs",
      "/v1/runs/run-1/reference",
    ]);
    // Each reserve call carries the token that was requested just before it.
    expect(service.tokenRequests).toHaveLength(4);
    expect(service.reserves).toEqual(service.tokenRequests.map((token) => `Bearer ${token}`));
    expect(new Set(service.reserves).size).toBe(4);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      [
        "Visonaut is at its capacity limit (try 1 of 20). Waiting 30 seconds before the next try.",
        "Visonaut is at its capacity limit (try 2 of 20). Waiting 30 seconds before the next try.",
        "Visonaut is at its capacity limit (try 3 of 20). Waiting 30 seconds before the next try.",
        "visonaut: The service refused the request (HTTP 500, stop_here). No visual approval was granted.",
        "",
      ].join("\n"),
    );
    expect(result.stdout + result.stderr).not.toContain("oidc-token");
    expect(result.stdout + result.stderr).not.toContain("server-secret");
  });

  it("waits 30 seconds even when the answer asks for 1 second", async () => {
    const service = await serve((call) => (call === 1 ? "capacity_exceeded" : undefined));
    const running = submit();
    // vi.waitFor moves the fake clock by a few milliseconds while it polls.
    await vi.waitFor(() => expect(service.reserves).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(WAIT_MS - 2_000);
    expect(service.reserves).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(service.reserves).toHaveLength(2);
    await running.finish();
  });

  it("stops after 20 tries and says so", async () => {
    const service = await serve(() => "capacity_exceeded");
    const result = await submit().finish();
    expect(service.reserves).toHaveLength(20);
    expect(service.tokenRequests).toHaveLength(20);
    expect(new Set(service.reserves).size).toBe(20);
    expect(result.code).toBe(1);
    // 19 waits of 30 seconds are 9 minutes 30 seconds. The last try waits no more.
    expect(result.stderr.match(/capacity limit \(try/g)).toHaveLength(19);
    expect(timeouts.mock.calls.map(([, delay]) => delay)).toEqual(Array(19).fill(WAIT_MS));
    expect(result.stderr).toContain(
      "visonaut: Visonaut stayed at its capacity limit for 20 tries. Check Service attention. Rerun this job after admission resumes. No visual approval was granted.\n",
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("a reserve call that the service refuses with another code", () => {
  // The first two codes need a person. The third is temporary, but only the code
  // capacity_exceeded makes the first reserve call wait.
  it.each(["database_size_exceeded", "capture_limit_exceeded", "service_unavailable"])(
    "makes no second call after %s",
    async (code) => {
      const service = await serve(() => code);
      const result = await submit().finish();
      expect(service.reserves).toHaveLength(1);
      expect(service.tokenRequests).toHaveLength(1);
      expect(result.code).toBe(1);
      expect(result.stderr).toBe(
        `visonaut: The service refused the request (HTTP 503, ${code}). No visual approval was granted.\n`,
      );
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
