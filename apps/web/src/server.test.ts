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
import { measureD1 } from "./api/test-d1-costs.ts";
import * as webhooks from "./api/webhooks.ts";
import { object, string } from "./api/input.ts";
import server from "./server.ts";
import { authConfiguration, githubConfiguration, type BackendEnv } from "./runtime.ts";

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
  expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
}

function headerNames(response: Response) {
  return [...new Set(response.headers.keys())].sort();
}

it.each([
  { environment: "production", launch: "true", status: "ready" },
  { environment: "preview", launch: "false", status: "setup" },
] as const)(
  "answers the $environment health request with the private headers",
  async ({ environment, launch, status }) => {
    const response = await server.fetch(
      new Request(`${env.VISONAUT_ORIGIN}/health`),
      { ...env, VISONAUT_ENVIRONMENT: environment, VISONAUT_LAUNCH_ENABLED: launch },
      { waitUntil() {} },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({
      service: "visonaut",
      status,
      launchEnabled: launch === "true",
      environment,
      fixtureMode: environment === "preview",
    });
    privateHeaders(response);
  },
);

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
  const response = await server.fetch(new Request(`${env.VISONAUT_ORIGIN}/api/auth/error`), env, {
    waitUntil() {},
  });
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

interface AppRequestOptions {
  origin?: string;
  cookie?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/** A request as the page sends it, with the Origin header and a JSON body. */
function appRequest(
  method: string,
  path: string,
  { origin = env.VISONAUT_ORIGIN, cookie, body, headers: extraHeaders }: AppRequestOptions = {},
) {
  const headers = new Headers({ ...extraHeaders, origin });
  if (cookie) {
    headers.set("cookie", cookie);
  }
  if (body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return new Request(`${origin}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Each use of the database throws, so a 404 answer proves no database work. */
function withoutDatabase(): BackendEnv {
  return {
    ...env,
    DB: new Proxy(env.DB, {
      get() {
        throw new Error("A closed auth route used the database.");
      },
    }),
  };
}

// The status is the answer of Better Auth to a request with no session.
const servedAuthRoutes = [
  "302 GET /api/auth/callback/github",
  "200 GET /api/auth/error",
  "200 POST /api/auth/sign-in/social",
  "200 POST /api/auth/sign-out",
];

it("serves 4 of the 30 auth routes and answers 404 for the 26 others", async () => {
  // The library gives the route list, so a route that an upgrade adds fails
  // the count.
  const auth = createAuth(authConfiguration(env));
  authContexts.push(auth.$context);
  const closed = withoutDatabase();
  const paths = new Set<string>();
  const answered: string[] = [];
  for (const endpoint of Object.values(auth.api)) {
    // An endpoint with no path is not an HTTP route.
    if (!endpoint.path) continue;
    // A route has one path parameter at most. The provider name fills it.
    const path = `/api/auth${endpoint.path.replace(/:\w+/, "github")}`;
    paths.add(path);
    for (const method of [endpoint.options.method].flat()) {
      const served = servedAuthRoutes.some((route) => route.endsWith(` ${method} ${path}`));
      const body = method === "POST" ? { provider: "github", callbackURL: "/" } : undefined;
      const response = await server.fetch(
        appRequest(method, path, { body }),
        served ? env : closed,
        { waitUntil() {} },
      );
      privateHeaders(response);
      if (response.status !== 404) {
        answered.push(`${response.status} ${method} ${path}`);
      }
    }
  }
  expect(paths.size).toBe(30);
  expect(answered.sort()).toEqual([...servedAuthRoutes].sort());
  const closedPaths = [...paths].filter(
    (path) => !answered.some((route) => route.endsWith(` ${path}`)),
  );
  expect(closedPaths).toHaveLength(26);
  expect(security.createAuth).toHaveBeenCalledTimes(servedAuthRoutes.length);
});

it.each([
  ["GET", "/api/auth/"],
  ["GET", "/api/auth/sign-out"],
  ["HEAD", "/api/auth/error"],
  ["POST", "/api/auth/callback/github"],
  ["GET", "/api/auth/callback/gitlab"],
  ["GET", "/api/auth/error/"],
  ["GET", "/api/auth//error"],
  ["GET", "/api/auth/Error"],
  ["GET", "/api/auth/%65rror"],
  ["GET", "/api/auth/error/more"],
])("answers 404 for %s %s, which is not an exact served auth route", async (method, path) => {
  const response = await server.fetch(appRequest(method, path), withoutDatabase(), {
    waitUntil() {},
  });
  expect(response.status).toBe(404);
  privateHeaders(response);
  expect(security.createAuth).not.toHaveBeenCalled();
});

it.each([
  { path: "/api/auth/error", status: 403 },
  { path: "/api/auth/unlisted", status: 404 },
])("answers $status for $path at another origin", async ({ path, status }) => {
  const response = await server.fetch(
    appRequest("GET", path, { origin: "https://other.example" }),
    withoutDatabase(),
    { waitUntil() {} },
  );
  expect(response.status).toBe(status);
  privateHeaders(response);
  expect(security.createAuth).not.toHaveBeenCalled();
});

it("sends a failed GitHub callback to the served error page", async () => {
  const lifetime = { waitUntil() {} };
  const callback = await server.fetch(
    appRequest("GET", "/api/auth/callback/github?error=access_denied"),
    env,
    lifetime,
  );
  expect(callback.status).toBe(302);
  const location = new URL(callback.headers.get("location") ?? "", env.VISONAUT_ORIGIN);
  expect(location.origin + location.pathname).toBe(`${env.VISONAUT_ORIGIN}/api/auth/error`);
  const page = await server.fetch(
    appRequest("GET", location.pathname + location.search),
    env,
    lifetime,
  );
  expect(page.status).toBe(200);
  expect(page.headers.get("content-type")).toContain("text/html");
  privateHeaders(page);
});

function cookieHeader(jar: Map<string, string>) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** Keeps each cookie of the answer, and drops a cookie that the answer ends. */
function storeCookies(jar: Map<string, string>, response: Response) {
  for (const cookie of response.headers.getSetCookie()) {
    const [pair = "", ...attributes] = cookie.split(";");
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator).trim();
    const expired = attributes.some((attribute) => /^\s*max-age=0$/i.test(attribute));
    if (expired) {
      jar.delete(name);
    } else {
      jar.set(name, pair.slice(separator + 1).trim());
    }
  }
}

interface SignInOptions {
  githubUserId: number;
  email: string;
  /** Headers of the client connection, which each request of the sign-in has. */
  headers?: Record<string, string>;
}

/** Signs in through the two served routes, with a stub for GitHub. */
async function signIn({ githubUserId, email, headers }: SignInOptions) {
  const lifetime = { waitUntil() {} };
  const jar = new Map<string, string>();
  // Better Auth asks GitHub for the token and for the profile of the user.
  const github = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://github.com/login/oauth/access_token") {
      // GitHub sends no ID token. The stub sends one, so that the answer has a
      // value for each token column of the account row.
      return Response.json({
        access_token: "test-access-token",
        expires_in: 28_800,
        refresh_token: "test-refresh-token",
        refresh_token_expires_in: 15_897_600,
        id_token: "test-id-token",
        token_type: "bearer",
      });
    }
    if (url === "https://api.github.com/user") {
      return Response.json({ id: githubUserId, login: "maintainer", name: "Maintainer", email });
    }
    if (url === "https://api.github.com/user/emails") {
      return Response.json([{ email, primary: true, verified: true }]);
    }
    throw new Error(`Unexpected request to ${url}.`);
  });
  // A second sign-in of one test gets the same spy, with the calls of the first.
  github.mockClear();
  // A private route asks the GitHub App for the user and for the permission.
  const { appId, repositoryId, repository } = githubConfiguration(env);
  vi.spyOn(security, "createGitHubClient").mockResolvedValue({
    appId,
    repositoryId,
    repository,
    async request(path) {
      if (!path.endsWith("/permission")) {
        return { id: githubUserId, login: "maintainer" };
      }
      return { user: { id: githubUserId }, permission: "write", role_name: "write" };
    },
  });

  const start = await server.fetch(
    appRequest("POST", "/api/auth/sign-in/social", {
      body: { provider: "github", callbackURL: "/history" },
      headers,
    }),
    env,
    lifetime,
  );
  expect(start.status).toBe(200);
  storeCookies(jar, start);
  const authorization = new URL(string(object(await start.json()).url, 4096));
  expect(authorization.origin + authorization.pathname).toBe(
    "https://github.com/login/oauth/authorize",
  );
  expect(authorization.searchParams.get("redirect_uri")).toBe(
    `${env.VISONAUT_ORIGIN}/api/auth/callback/github`,
  );

  const callbackQuery = new URLSearchParams({
    code: "test-code",
    state: authorization.searchParams.get("state") ?? "",
  });
  const callback = await server.fetch(
    appRequest("GET", `/api/auth/callback/github?${callbackQuery}`, {
      cookie: cookieHeader(jar),
      headers,
    }),
    env,
    lifetime,
  );
  expect(callback.status).toBe(302);
  expect(callback.headers.get("location")).toBe("/history");
  storeCookies(jar, callback);
  expect(github).toHaveBeenCalledTimes(3);
  return jar;
}

it("signs in with GitHub, reads the identity, and signs out through the served routes", async () => {
  const githubUserId = 4_242;
  const lifetime = { waitUntil() {} };
  const jar = await signIn({ githubUserId, email: "maintainer@example.com" });

  const signedIn = cookieHeader(jar);
  const identity = await server.fetch(
    appRequest("GET", "/api/me", { cookie: signedIn }),
    env,
    lifetime,
  );
  expect(identity.status).toBe(200);
  const userId = string(object(await identity.json()).userId);
  expect(
    await env.DB.prepare("SELECT accountId, providerId FROM account WHERE userId=?")
      .bind(userId)
      .all(),
  ).toMatchObject({ results: [{ accountId: String(githubUserId), providerId: "github" }] });

  const signOut = await server.fetch(
    appRequest("POST", "/api/auth/sign-out", { cookie: signedIn, body: {} }),
    env,
    lifetime,
  );
  expect(signOut.status).toBe(200);
  expect(await signOut.json()).toEqual({ success: true });
  storeCookies(jar, signOut);
  expect(cookieHeader(jar)).toBe("");
  // The cookie of the ended session is no longer a credential.
  const signedOut = await server.fetch(
    appRequest("GET", "/api/me", { cookie: signedIn }),
    env,
    lifetime,
  );
  expect(signedOut.status).toBe(401);
  expect(
    await env.DB.prepare("SELECT action FROM auth_audit WHERE user_id=? ORDER BY created_at, rowid")
      .bind(userId)
      .all(),
  ).toMatchObject({ results: [{ action: "sign_in" }, { action: "sign_out" }] });

  // A second sign-in finds the user and the account of the first one. It has
  // its own client address, because the sign-in route permits 3 requests in 10
  // seconds for one address.
  const secondJar = await signIn({
    githubUserId,
    email: "maintainer@example.com",
    headers: { "cf-connecting-ip": "203.0.113.8" },
  });
  const secondIdentity = await server.fetch(
    appRequest("GET", "/api/me", { cookie: cookieHeader(secondJar) }),
    env,
    lifetime,
  );
  expect(secondIdentity.status).toBe(200);
  expect(string(object(await secondIdentity.json()).userId)).toBe(userId);
  expect(
    await env.DB.prepare(
      'SELECT (SELECT count(*) FROM account WHERE accountId=?) AS accounts, (SELECT count(*) FROM "user" WHERE email=?) AS users',
    )
      .bind(String(githubUserId), "maintainer@example.com")
      .first(),
  ).toEqual({ accounts: 1, users: 1 });
});

it("stores no GitHub user token at a first sign-in and at a later sign-in", async () => {
  const githubUserId = 4_245;
  const email = "returning@example.com";
  const lifetime = { waitUntil() {} };
  const noToken = {
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
  };
  const accountRows = async () => {
    const rows = await env.DB.prepare(
      "SELECT accessToken, refreshToken, idToken, accessTokenExpiresAt, refreshTokenExpiresAt FROM account WHERE providerId='github' AND accountId=?",
    )
      .bind(String(githubUserId))
      .all();
    return rows.results;
  };
  const signedInUser = async (jar: Map<string, string>) => {
    const identity = await server.fetch(
      appRequest("GET", "/api/me", { cookie: cookieHeader(jar) }),
      env,
      lifetime,
    );
    expect(identity.status).toBe(200);
    return string(object(await identity.json()).userId);
  };

  // The first sign-in creates the account row.
  const firstJar = await signIn({
    githubUserId,
    email,
    headers: { "cf-connecting-ip": "203.0.113.10" },
  });
  expect(await accountRows()).toEqual([noToken]);
  const userId = await signedInUser(firstJar);

  // A row from before this rule holds the values of its last sign-in.
  const expiry = new Date(Date.now() + 86_400_000).toISOString();
  await env.DB.prepare(
    "UPDATE account SET accessToken=?, refreshToken=?, idToken=?, accessTokenExpiresAt=?, refreshTokenExpiresAt=? WHERE providerId='github' AND accountId=?",
  )
    .bind("old-access", "old-refresh", "old-id", expiry, expiry, String(githubUserId))
    .run();
  expect(await accountRows()).toEqual([
    {
      accessToken: "old-access",
      refreshToken: "old-refresh",
      idToken: "old-id",
      accessTokenExpiresAt: expiry,
      refreshTokenExpiresAt: expiry,
    },
  ]);

  // A later sign-in updates the same account row.
  const laterJar = await signIn({
    githubUserId,
    email,
    headers: { "cf-connecting-ip": "203.0.113.11" },
  });
  expect(await accountRows()).toEqual([noToken]);
  expect(await signedInUser(laterJar)).toBe(userId);
});

it("counts the D1 work of the access check of one private request", async () => {
  const jar = await signIn({
    githubUserId: 4_244,
    email: "reader@example.com",
    headers: { "cf-connecting-ip": "203.0.113.9" },
  });
  const measured = measureD1(await runtime.getD1Database("DB"));
  const response = await server.fetch(
    appRequest("GET", "/api/me", { cookie: cookieHeader(jar) }),
    { ...env, DB: measured.database },
    { waitUntil() {} },
  );
  expect(response.status).toBe(200);
  expect(measured.roundTrips()).toBe(2);
  expect(measured.costs).toHaveLength(2);
  const { rows_read, rows_written } = measured.totals();
  expect(rows_written).toBe(0);
  // The count of the account read is not constant: its index scan can count
  // the next entry of the index.
  expect(rows_read).toBeGreaterThanOrEqual(3);
  expect(rows_read).toBeLessThanOrEqual(4);
});

// A private JSON answer has these headers and no other, except for the cookie
// of a renewed session.
const privateJsonHeaders = [
  "cache-control",
  "content-security-policy",
  "content-type",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
  "referrer-policy",
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
];

it("keeps a session through a renewal, a bearer request, and a sign-out", async () => {
  const githubUserId = 4_243;
  const lifetime = { waitUntil() {} };
  const clientAddress = "203.0.113.7";
  // Cloudflare sets the first header. The sign-in library must read only that one.
  const connection = { "cf-connecting-ip": clientAddress, "x-forwarded-for": "198.51.100.9" };
  const jar = await signIn({ githubUserId, email: "reviewer@example.com", headers: connection });
  const [cookieName = ""] = [...jar.keys()].filter((name) => name.endsWith(".session_token"));
  const session = await env.DB.prepare(
    "SELECT session.id, session.token, session.ipAddress FROM session JOIN account ON account.userId = session.userId WHERE account.accountId = ?",
  )
    .bind(String(githubUserId))
    .first<{ id: string; token: string; ipAddress: string }>();
  if (!session) {
    throw new Error("The sign-in stored no session.");
  }

  // The sign-in library reads the client address from the header of Cloudflare.
  expect(session.ipAddress).toBe(clientAddress);
  const limits = await env.DB.prepare(
    'SELECT "key" FROM rateLimit WHERE "key" LIKE ? OR "key" LIKE ? ORDER BY "key"',
  )
    .bind(`${clientAddress}|%`, `${connection["x-forwarded-for"]}|%`)
    .all<{ key: string }>();
  expect(limits.results.map((limit) => limit.key)).toEqual([
    `${clientAddress}|/callback/github`,
    `${clientAddress}|/sign-in/social`,
  ]);

  // One path is a route of the Worker entry, and one is a route of the API.
  for (const path of ["/api/me", "/api/runs"]) {
    const current = await server.fetch(
      appRequest("GET", path, { cookie: cookieHeader(jar) }),
      env,
      lifetime,
    );
    expect(current.status).toBe(200);
    expect(headerNames(current)).toEqual(privateJsonHeaders);

    // The session is now old enough that the next private request renews it.
    await env.DB.prepare('UPDATE session SET "updatedAt" = ?, "expiresAt" = ? WHERE id = ?')
      .bind(
        new Date(Date.now() - 2 * 86_400_000).toISOString(),
        new Date(Date.now() + 5 * 86_400_000).toISOString(),
        session.id,
      )
      .run();
    const renewed = await server.fetch(
      appRequest("GET", path, { cookie: cookieHeader(jar) }),
      env,
      lifetime,
    );
    expect(renewed.status).toBe(200);
    expect(headerNames(renewed)).toEqual([...privateJsonHeaders, "set-cookie"].sort());
    const cookies = renewed.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain(`${cookieName}=`);
    expect(cookies[0]).toContain("HttpOnly");
    storeCookies(jar, renewed);
    // The browser keeps its session with the cookie of the renewal.
    const next = await server.fetch(
      appRequest("GET", path, { cookie: cookieHeader(jar) }),
      env,
      lifetime,
    );
    expect(next.status).toBe(200);
  }

  const withBearer = (token: string) =>
    server.fetch(
      new Request(`${env.VISONAUT_ORIGIN}/api/me`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      env,
      lifetime,
    );
  // `visonaut status` sends `<session token>.<signature>` as a bearer token.
  // That is the URL-decoded value of the session cookie.
  const signedToken = decodeURIComponent(jar.get(cookieName) ?? "");
  expect(signedToken.startsWith(`${session.token}.`)).toBe(true);
  expect(signedToken).not.toContain("%");
  expect((await withBearer(signedToken)).status).toBe(200);
  // The token of the session is not a bearer token without its signature.
  expect((await withBearer(session.token)).status).toBe(401);

  const signedIn = cookieHeader(jar);
  const signOut = await server.fetch(
    appRequest("POST", "/api/auth/sign-out", { cookie: signedIn, body: {} }),
    env,
    lifetime,
  );
  expect(signOut.status).toBe(200);
  const signedOut = await server.fetch(
    appRequest("GET", "/api/me", { cookie: signedIn }),
    env,
    lifetime,
  );
  expect(signedOut.status).toBe(401);
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

it.each([
  { url: "http://127.0.0.1:5173/api/runs", status: 200 },
  { url: "http://localhost:5173/api/runs", status: 200 },
  { url: "http://[::1]:5173/api/runs", status: 200 },
  { url: "https://preview.visonaut.com/api/runs", status: 200 },
  { url: "https://127.0.0.1/api/runs", status: 403 },
  { url: "http://127.0.0.1.example.com/api/runs", status: 403 },
  { url: "https://other.example.com/api/runs", status: 403 },
  { url: "https://visonaut-preview.example.workers.dev/api/runs", status: 403 },
])("answers $status for the preview request $url", async ({ url, status }) => {
  const preview: Env = {
    ...env,
    VISONAUT_ENVIRONMENT: "preview",
    VISONAUT_ORIGIN: "https://preview.visonaut.com",
  };
  const response = await server.fetch(new Request(url), preview, { waitUntil: vi.fn() });
  expect(response.status).toBe(status);
  privateHeaders(response);
});

it("keeps the production origin check for a loopback host", async () => {
  const response = await server.fetch(new Request("http://127.0.0.1:5173/api/me"), env, {
    waitUntil: vi.fn(),
  });
  expect(response.status).toBe(403);
});
