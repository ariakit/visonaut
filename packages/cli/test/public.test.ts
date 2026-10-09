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

afterEach(() => vi.unstubAllGlobals());

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
