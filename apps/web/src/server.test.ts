import { applyTestMigrations } from "../../../tooling/test-migrations.ts";
import { fileURLToPath } from "node:url";
import { ProtocolError } from "@visonaut/protocol";
import * as security from "@visonaut/security";
import { SecurityError } from "@visonaut/security";
import { ConflictError, IncompleteError } from "@visonaut/service";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { unstable_readConfig } from "wrangler";
import * as preRun from "./api/pre-run.ts";
import * as webhooks from "./api/webhooks.ts";
import server from "./server.ts";
import type { BackendEnv } from "./runtime.ts";

// These tests exercise real request handlers without the application renderer.
vi.mock("@tanstack/react-start/server", () => ({
  createStartHandler: () => vi.fn(),
  defaultStreamHandler: vi.fn(),
}));

let runtime: Miniflare;
let env: BackendEnv;
const correlationId = "af4a9c01-3e33-4faa-903c-31c1b20d2bac";
const startedAt = 1_000;
const createAuth = security.createAuth;
const authContexts: Promise<unknown>[] = [];

beforeAll(async () => {
  const configuration = unstable_readConfig({
    config: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)),
    env: "production",
  });
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('request failure tests'); } };",
      compatibilityDate: "2026-09-22",
      bindings: {
        ...configuration.vars,
        BETTER_AUTH_SECRET: "request-test-secret-with-at-least-32-characters",
        CAPABILITY_SECRET: "request-test-secret-with-at-least-32-characters",
        GITHUB_CLIENT_SECRET: "request-test-secret",
        GITHUB_APP_PRIVATE_KEY: "request-test-secret",
        GITHUB_WEBHOOK_SECRET: "request-test-secret",
      },
      d1Databases: ["DB"],
      r2Buckets: ["IMAGES", "QUARANTINE"],
      queueProducers: ["OPERATIONS"],
      serviceBindings: { COMPARATOR: async () => new Response() },
    }),
  );
  env = await runtime.getBindings<BackendEnv>();
  await applyTestMigrations(env.DB);
  await env.DB.prepare(
    "INSERT INTO visonaut_projects(id, repository_id, policy_digest) VALUES (?,?,?)",
  )
    .bind(env.VISONAUT_PROJECT_ID, env.GITHUB_REPOSITORY_ID, "c".repeat(64))
    .run();
});

afterAll(async () => runtime?.dispose());
beforeEach(() => {
  vi.spyOn(security, "createAuth").mockImplementation((configuration) => {
    const auth = createAuth(configuration);
    authContexts.push(auth.$context);
    return auth;
  });
});
afterEach(async () => {
  // Await auth initialization before disposing its native database or mocks.
  await Promise.all(authContexts.splice(0));
  vi.restoreAllMocks();
});

function request() {
  return new Request(`${env.VISONAUT_ORIGIN}/v1/plan?label=private-label-sentinel`, {
    method: "POST",
    headers: { authorization: "Bearer private-token-sentinel" },
    body: JSON.stringify({ private: "private-body-sentinel" }),
  });
}

function privateHeaders(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("no-store, private");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
}

it.each([
  { error: new ConflictError("A newer verdict exists."), code: "conflict", status: 409 },
  { error: new IncompleteError("The capture is incomplete."), code: "incomplete", status: 409 },
  {
    error: new ProtocolError("INVALID_MANIFEST", "The manifest is invalid."),
    code: "invalid_manifest",
    status: 400,
  },
  {
    error: new SecurityError("sign_in_required", 401, "Sign in to continue."),
    code: "sign_in_required",
    status: 401,
  },
  {
    error: new SecurityError("github_unavailable", 503, "Repository access is unavailable."),
    code: "github_unavailable",
    status: 503,
  },
])(
  "keeps known $code request failures without a support reference",
  async ({ error, code, status }) => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const rejected = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(preRun, "reportVisualPlan").mockRejectedValueOnce(error);
    const response = await server.fetch(request(), env, { waitUntil() {} });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      schemaVersion: "1.0",
      error: { code, message: error.message },
    });
    privateHeaders(response);
    expect(response.headers.get("Retry-After")).toBe(status === 503 ? "1" : null);
    expect(output).not.toHaveBeenCalled();
    if (error instanceof SecurityError) {
      expect(rejected).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({ event: "api_rejected", code, status }),
      );
    } else {
      expect(rejected).not.toHaveBeenCalled();
    }
  },
);

it("matches an unexpected API failure to exactly one safe request log", async () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue(correlationId);
  const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
  const error = new Error("SELECT private_sql FROM secrets; https://private.example/token");
  error.name = "private-exception-name";
  vi.spyOn(preRun, "reportVisualPlan").mockImplementationOnce(async () => {
    clock.mockReturnValue(startedAt + 25);
    throw error;
  });
  const response = await server.fetch(request(), env, { waitUntil() {} });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    schemaVersion: "1.0",
    error: {
      code: "service_unavailable",
      message: "The service is temporarily unavailable.",
      reference: correlationId,
    },
  });
  privateHeaders(response);
  expect(response.headers.get("Retry-After")).toBe("1");
  expect(uuid).toHaveBeenCalledTimes(1);
  expect(output).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({
      event: "operation-failed",
      operation: "api",
      code: "service_unavailable",
      correlationId,
      elapsedMilliseconds: 25,
    }),
  );
});

it("uses the same reference and safe log for an outer HTTP failure", async () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(crypto, "randomUUID").mockReturnValue(correlationId);
  vi.spyOn(Date, "now").mockReturnValue(startedAt);
  const response = await server.fetch(
    request(),
    {
      ...env,
      get VISONAUT_API_LIMITS(): never {
        throw new Error("private-configuration-sentinel");
      },
    },
    { waitUntil() {} },
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: {
      code: "service_unavailable",
      message: "The service is temporarily unavailable.",
      reference: correlationId,
    },
  });
  privateHeaders(response);
  expect(response.headers.get("Retry-After")).toBe("1");
  expect(output).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({
      event: "operation-failed",
      operation: "http",
      code: "service_unavailable",
      correlationId,
      elapsedMilliseconds: 0,
    }),
  );
});

it("keeps a known outer authentication failure without a support reference", async () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(crypto, "randomUUID").mockReturnValue(correlationId);
  vi.spyOn(Date, "now").mockReturnValue(startedAt);
  const error = new SecurityError("sign_in_required", 401, "Sign in to continue.");
  vi.mocked(security.createAuth).mockImplementationOnce(() => {
    throw error;
  });
  const response = await server.fetch(
    new Request(`${env.VISONAUT_ORIGIN}/api/auth/get-session`),
    env,
    { waitUntil() {} },
  );
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    error: { code: error.code, message: error.message },
  });
  privateHeaders(response);
  expect(response.headers.get("Retry-After")).toBe("1");
  expect(output).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({
      event: "operation-failed",
      operation: "auth",
      code: error.code,
      correlationId,
      elapsedMilliseconds: 0,
    }),
  );
});

it("preserves the request lifetime receiver when passing failure context to the API", async () => {
  const background: Promise<unknown>[] = [];
  const lifetime = {
    background,
    waitUntil(promise: Promise<unknown>) {
      this.background.push(promise);
    },
  };
  vi.spyOn(webhooks, "receiveWebhook").mockImplementationOnce(
    async (_request, _context, context) => {
      context.waitUntil(Promise.resolve());
      return Response.json({ received: true }, { status: 202 });
    },
  );
  const response = await server.fetch(
    new Request(`${env.VISONAUT_ORIGIN}/webhooks/github`, { method: "POST" }),
    env,
    lifetime,
  );
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ received: true });
  privateHeaders(response);
  expect(background).toHaveLength(1);
  await Promise.all(background);
});
