import { afterEach, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";

const environment = {
  VISONAUT_SERVER: "https://visonaut.example",
  GITHUB_RUN_ID: "456",
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_SHA: "a".repeat(40),
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/id-token",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function execute(argv: string[], selectedEnvironment = environment) {
  let stdout = "";
  let stderr = "";
  const code = await runCli({
    argv,
    environment: selectedEnvironment,
    stdout(value) {
      stdout += value;
    },
    stderr(value) {
      stderr += value;
    },
  });
  return { code, stdout, stderr };
}

it.each([
  ["pack", "--dir", "/tmp/capture"],
  ["upload", "--dir", "/tmp/capture"],
  ["upload", "--bundle", "/tmp/capture.enc"],
  ["submit", "--dir", "/tmp/capture"],
  ["submit", "--run", "456"],
  ["submit", "--bundle", "/tmp/capture.enc"],
  ["begin", "--run", "456", "--dir", "/tmp/capture"],
  ["submit", "--no-visual", "--shard", "linux"],
  ["submit", "--shard", "linux", "--no-visual"],
  ["submit", "--no-visual", "--bundle", "/tmp/capture"],
  ["submit", "--no-visual", "--no-visual"],
  ["submit", "--no-visual", "--server"],
])("rejects retired or unrelated capture arguments before credentials: %j", async (...argv) => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await execute(argv)).code).toBe(2);
  expect(fetch).not.toHaveBeenCalled();
});

it("reports only the native Plan's no-visual result without capture credentials", async () => {
  const requests: { url: URL; options?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (input: URL | string, options?: RequestInit) => {
    const url = new URL(input);
    requests.push({ url, options });
    if (url.hostname.endsWith(".actions.githubusercontent.com")) {
      expect(url.searchParams.get("audience")).toBe("https://selected.example/plan-report");
      return Response.json({ value: "oidc-secret" });
    }
    expect(url.href).toBe("https://selected.example/v1/plan");
    expect(options?.method).toBe("POST");
    expect(new Headers(options?.headers).get("authorization")).toBe("Bearer oidc-secret");
    expect(JSON.parse(String(options?.body))).toEqual({
      schemaVersion: 1,
      workflowRunId: "456",
      workflowAttempt: 2,
      testedSha: environment.GITHUB_SHA,
      planResult: "success",
      visualRequired: false,
    });
    return new Response(null, { status: 204 });
  });
  const result = await execute(["submit", "--no-visual", "--server", "https://selected.example"]);
  expect(result.code).toBe(0);
  expect(requests).toHaveLength(2);
  expect(result.stdout).toContain("No visual capture is required");
  expect(result.stdout + result.stderr).not.toContain("secret");
});

it.each([{ GITHUB_RUN_ID: "0" }, { GITHUB_RUN_ATTEMPT: "invalid" }, { GITHUB_SHA: "main" }])(
  "rejects invalid no-visual run identity before OIDC: %j",
  async (invalid) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await execute(["submit", "--no-visual"], { ...environment, ...invalid })).code).toBe(4);
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("does not print signed credentials when the no-visual report is refused", async () => {
  const requests: URL[] = [];
  vi.stubGlobal("fetch", async (input: URL | string) => {
    const url = new URL(input);
    requests.push(url);
    if (url.hostname.endsWith(".actions.githubusercontent.com")) {
      return Response.json({ value: "oidc-secret" });
    }
    return Response.json({ error: { message: "refused oidc-secret" } }, { status: 403 });
  });
  const result = await execute(["submit", "--no-visual"]);
  expect(result.code).toBe(4);
  expect(requests.map((url) => url.pathname)).toEqual(["/id-token", "/v1/plan"]);
  expect(result.stdout + result.stderr).not.toContain("secret");
});

it("binds begin to the current tested commit, attempt, and signed Submit audience", async () => {
  const requests: { url: URL; options?: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (input: URL | string, options?: RequestInit) => {
    const url = new URL(input);
    requests.push({ url, options });
    if (url.hostname.endsWith(".actions.githubusercontent.com")) {
      expect(url.searchParams.get("audience")).toBe("https://visonaut.example/submit");
      return Response.json({ value: "oidc-secret" });
    }
    expect(url.pathname).toBe("/v1/runs/456/begin");
    expect(new Headers(options?.headers).get("authorization")).toBe("Bearer oidc-secret");
    expect(JSON.parse(String(options?.body))).toEqual({
      schemaVersion: "1.0",
      workflowAttempt: 2,
      testedSha: environment.GITHUB_SHA,
    });
    return Response.json({ state: "pending" });
  });
  const result = await execute(["begin", "--run", "456"]);
  expect(result.code).toBe(0);
  expect(requests).toHaveLength(2);
  expect(result.stdout).toContain("does not grant visual approval");
  expect(result.stdout + result.stderr).not.toContain("secret");
});

/** End each backoff wait at once, record its delay, and count it as elapsed time. */
function skipBackoffWaits() {
  const delays: number[] = [];
  const realNow = performance.now.bind(performance);
  vi.spyOn(performance, "now").mockImplementation(
    () => realNow() + delays.reduce((total, delay) => total + delay, 0),
  );
  const realSetTimeout = globalThis.setTimeout;
  vi.stubGlobal("setTimeout", (handler: () => void, delay?: number) => {
    if (delay === undefined || delay < 1000) return realSetTimeout(handler, delay);
    delays.push(delay);
    return realSetTimeout(handler, 0);
  });
  return delays;
}

function pendingCheck() {
  return Response.json(
    { error: { code: "check_pending", message: "Check creation is in progress." } },
    { status: 503, headers: { "Retry-After": "1" } },
  );
}

/** Answer the OIDC token request, and each begin attempt with the next answer. */
function answerBeginAttempts(answers: (() => Response)[]) {
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (input: URL | string) => {
    const url = new URL(input);
    requests.push(url.pathname);
    if (url.hostname.endsWith(".actions.githubusercontent.com")) {
      return Response.json({ value: "oidc-secret" });
    }
    const answer = answers.shift();
    if (!answer) throw new Error("Unexpected begin attempt");
    return answer();
  });
  return requests;
}

it("retries begin after a dropped connection, a time limit, an edge error, and a pending check", async () => {
  const delays = skipBackoffWaits();
  const limits: number[] = [];
  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    limits.push(milliseconds);
    return realTimeout(milliseconds);
  });
  const answers: (() => Response)[] = [
    () => {
      throw new TypeError("fetch failed");
    },
    () => {
      throw new DOMException("The operation timed out", "TimeoutError");
    },
    () => new Response("bad gateway", { status: 502 }),
    pendingCheck,
    () => Response.json({ state: "pending" }),
  ];
  const requests = answerBeginAttempts(answers);
  const result = await execute(["begin", "--run", "456"]);
  expect(result.code).toBe(0);
  expect(requests).toEqual(["/id-token", ...Array<string>(5).fill("/v1/runs/456/begin")]);
  expect(delays).toHaveLength(4);
  // The begin attempts have a longer limit than the 30 s of other requests.
  const beginLimits = limits.slice(-5);
  expect(beginLimits).toHaveLength(5);
  for (const limit of beginLimits) {
    expect(limit).toBeGreaterThan(30_000);
    expect(limit).toBeLessThanOrEqual(120_000);
  }
  expect(result.stdout + result.stderr).not.toContain("secret");
});

it("waits for a check that an earlier begin attempt holds, beyond the attempt limit", async () => {
  const delays = skipBackoffWaits();
  const requests = answerBeginAttempts([
    ...Array<() => Response>(8).fill(pendingCheck),
    () => Response.json({ state: "pending" }),
  ]);
  const result = await execute(["begin", "--run", "456"]);
  expect(result.code).toBe(0);
  expect(requests.filter((path) => path === "/v1/runs/456/begin")).toHaveLength(9);
  // The service asks for 1 s, but the lease of the earlier attempt lasts longer.
  expect(delays).toHaveLength(8);
  for (const delay of delays) {
    expect(delay).toBe(5_000);
  }
});

it("stops waiting for a pending check at the begin deadline", async () => {
  const delays = skipBackoffWaits();
  const requests = answerBeginAttempts(Array<() => Response>(100).fill(pendingCheck));
  const result = await execute(["begin", "--run", "456"]);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("HTTP 503, check_pending");
  // The deadline is 4 minutes from before the OIDC token request.
  const waited = delays.reduce((total, delay) => total + delay, 0);
  expect(waited).toBeLessThan(240_000);
  expect(waited).toBeGreaterThan(230_000);
  expect(requests.filter((path) => path === "/v1/runs/456/begin")).toHaveLength(delays.length + 1);
});

it("does not retry begin after a refusal that a later attempt cannot change", async () => {
  skipBackoffWaits();
  const requests: string[] = [];
  vi.stubGlobal("fetch", async (input: URL | string) => {
    const url = new URL(input);
    requests.push(url.pathname);
    if (url.hostname.endsWith(".actions.githubusercontent.com")) {
      return Response.json({ value: "oidc-secret" });
    }
    return Response.json(
      { error: { code: "workflow_candidate", message: "The signed candidate is unavailable." } },
      { status: 503 },
    );
  });
  const result = await execute(["begin", "--run", "456"]);
  expect(result.code).toBe(1);
  expect(requests).toEqual(["/id-token", "/v1/runs/456/begin"]);
  expect(result.stderr).toContain("HTTP 503, workflow_candidate");
});

it("refuses begin for another run before requesting OIDC", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await execute(["begin", "--run", "999"])).code).toBe(4);
  expect(fetch).not.toHaveBeenCalled();
});

it("stops Submit before artifact access when the signed Plan/check boundary rejects it", async () => {
  const requests: URL[] = [];
  vi.stubGlobal("fetch", async (input: URL | string) => {
    const url = new URL(input);
    requests.push(url);
    if (url.hostname.endsWith(".actions.githubusercontent.com")) {
      return Response.json({ value: "oidc-secret" });
    }
    return Response.json(
      { error: { code: "plan_missing", message: "missing Plan oidc-secret" } },
      { status: 403 },
    );
  });
  const result = await execute(["submit", "--shard", "linux", "--shard", "safari"]);
  expect(result.code).toBe(4);
  expect(requests.map((url) => url.pathname)).toEqual(["/id-token", "/v1/runs/456/begin"]);
  expect(result.stderr).toContain("Authentication or permission failed (HTTP 403, plan_missing)");
  expect(result.stderr).not.toContain("oidc-secret");
});
