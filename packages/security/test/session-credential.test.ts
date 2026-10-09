import { createHmac } from "node:crypto";
import { applyTestMigrations } from "../../../tooling/test-migrations.js";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth, type AuthConfiguration } from "../src/auth.js";
import { requireSessionCredential } from "../src/session-credential.js";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB"],
  }),
);
const database = await runtime.getD1Database("DB");

beforeAll(async () => {
  await applyTestMigrations(database);
});
afterAll(async () => runtime.dispose());

function configuration(environment: AuthConfiguration["environment"]): AuthConfiguration {
  return {
    database,
    origin: environment === "local" ? "http://localhost" : `https://${environment}.example`,
    environment,
    secret: `${environment}-random-test-secret-with-at-least-32-characters`,
    githubClientId: "test-client",
    githubClientSecret: "test-secret",
  };
}

/** Return the session cookie that the sign-in library itself sets on a renewal. */
async function renewedSessionCookie(environment: AuthConfiguration["environment"]) {
  const { secret } = configuration(environment);
  const auth = createAuth(configuration(environment));
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser(
    { name: "Maintainer", email: `${crypto.randomUUID()}@example.com`, emailVerified: true },
    { method: "oauth", oauth: { providerId: "github" } },
  );
  const session = await context.internalAdapter.createSession(user.id);
  // A session older than one day gets a new cookie on its next read.
  await database
    .prepare('UPDATE session SET "updatedAt" = ?, "expiresAt" = ? WHERE id = ?')
    .bind(
      new Date(Date.now() - 2 * 86_400_000).toISOString(),
      new Date(Date.now() + 5 * 86_400_000).toISOString(),
      session.id,
    )
    .run();
  // A bearer token is the session token with the signature of its cookie.
  const signature = createHmac("sha256", secret).update(session.token).digest("base64");
  const response = await auth.api.getSession({
    headers: new Headers({ authorization: `Bearer ${session.token}.${signature}` }),
    asResponse: true,
  });
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .find((pair) => pair?.includes("session_token="));
  if (!cookie) {
    throw new Error("Expected a session cookie on the renewal.");
  }
  const name = cookie.slice(0, cookie.indexOf("="));
  return { auth, cookie, name, userId: user.id };
}

function request(headers: Record<string, string>) {
  return new Request("https://production.example/api/runs", { headers });
}

describe("early refusal of a request with no session credential", () => {
  it.each(["production", "preview", "local"] as const)(
    "passes each cookie header that the sign-in library accepts as a session in %s",
    async (environment) => {
      const { auth, cookie, name, userId } = await renewedSessionCookie(environment);
      const headers = [
        cookie,
        `theme=dark; ${cookie}`,
        // The library reads the first cookie of a name.
        `${cookie}; ${name}=`,
      ];
      for (const header of headers) {
        expect(() => requireSessionCredential(request({ cookie: header }))).not.toThrow();
        const session = await auth.api.getSession({ headers: new Headers({ cookie: header }) });
        expect(session?.user.id).toBe(userId);
      }
    },
  );

  it("leaves a session cookie with a wrong value to the sign-in library", async () => {
    const { auth, name } = await renewedSessionCookie("production");
    for (const header of [`${name}=`, `${name}=value.signature`]) {
      expect(() => requireSessionCredential(request({ cookie: header }))).not.toThrow();
      expect(await auth.api.getSession({ headers: new Headers({ cookie: header }) })).toBeNull();
    }
  });

  it.each(["Bearer token", "bearer token", "BEARER  token"])(
    "passes the bearer header %j to the sign-in library",
    (authorization) => {
      expect(() => requireSessionCredential(request({ authorization }))).not.toThrow();
    },
  );

  it.each([
    ["no header", {}],
    ["a bearer header with no token", { authorization: "Bearer " }],
    ["another authorization scheme", { authorization: "Basic dXNlcjpwYXNz" }],
    ["an unrelated cookie", { cookie: "theme=dark; session=value" }],
  ] as const)("refuses a request with %s", (_name, headers) => {
    expect(() => requireSessionCredential(request(headers))).toThrow(
      expect.objectContaining({ code: "sign_in_required", status: 401 }),
    );
  });
});
