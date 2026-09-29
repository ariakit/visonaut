import { afterEach, expect, it, vi } from "vitest";
import { runCli } from "../src/index.js";

const environment = {
  VISONAUT_SERVER: "https://visonaut.example",
  VISONAUT_PACKAGE_SHA256: "b".repeat(64),
  VISONAUT_WORKFLOW_SOURCE_SHA: "c".repeat(40),
  GITHUB_RUN_ID: "456",
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_SHA: "a".repeat(40),
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://run.actions.githubusercontent.com/id-token",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
};

afterEach(() => vi.unstubAllGlobals());

async function execute(argv: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await runCli({
    argv,
    environment,
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
])("rejects retired or unrelated capture arguments before credentials: %j", async (...argv) => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect((await execute(argv)).code).toBe(2);
  expect(fetch).not.toHaveBeenCalled();
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
    return Response.json({ error: { message: "missing Plan oidc-secret" } }, { status: 403 });
  });
  const result = await execute(["submit", "--shard", "linux", "--shard", "safari"]);
  expect(result.code).toBe(4);
  expect(requests.map((url) => url.pathname)).toEqual(["/id-token", "/v1/runs/456/begin"]);
  expect(result.stderr).toContain("could not be started");
  expect(result.stderr).not.toContain("oidc-secret");
});
