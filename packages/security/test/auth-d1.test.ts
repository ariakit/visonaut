import { measureD1 } from "../../../apps/web/src/api/test-d1-costs.js";
import { applyTestMigrations } from "../../../tooling/test-migrations.js";
import { createHmac } from "node:crypto";
import { betterAuth } from "better-auth";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/auth.js";
import { requireMaintainer } from "../src/authorization.js";
import type { GitHubClient } from "../src/github.js";
import { persistWebhook, revokeGitHubAuthorization } from "../src/webhooks.js";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-09-22",
    d1Databases: ["DB", "PREVIEW_DB", "CHANGED_DB"],
  }),
);
const database = await runtime.getD1Database("DB");
const previewDatabase = await runtime.getD1Database("PREVIEW_DB");
const changedDatabase = await runtime.getD1Database("CHANGED_DB");
const configuration = {
  database,
  origin: "https://auth.example",
  environment: "production",
  secret: "production-random-test-secret-with-at-least-32-characters",
  githubClientId: "test-client",
  githubClientSecret: "test-secret",
} as const;

beforeAll(async () => {
  await applyTestMigrations(database);
  await applyTestMigrations(previewDatabase);
});
afterAll(async () => runtime.dispose());

async function createSession() {
  const auth = createAuth(configuration);
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser(
    { name: "Maintainer", email: `${crypto.randomUUID()}@example.com`, emailVerified: true },
    { method: "oauth", oauth: { providerId: "github" } },
  );
  await context.internalAdapter.createAccount({
    providerId: "github",
    accountId: "42",
    userId: user.id,
  });
  const session = await context.internalAdapter.createSession(user.id);
  return { auth, context, user, session };
}

/** The bearer value of a session: its token with the signature of its cookie. */
function bearer(token: string, secret: string = configuration.secret) {
  return `Bearer ${token}.${createHmac("sha256", secret).update(token).digest("base64")}`;
}

/** Makes the session old enough that the next read renews it. */
async function ageSession(sessionId: string) {
  await database
    .prepare('UPDATE session SET "updatedAt" = ?, "expiresAt" = ? WHERE id = ?')
    .bind(
      new Date(Date.now() - 2 * 86_400_000).toISOString(),
      new Date(Date.now() + 5 * 86_400_000).toISOString(),
      sessionId,
    )
    .run();
}

/** A GitHub App client with a permission that a test can change. */
function createGitHub(appId: string) {
  let permission = "write";
  const request = vi.fn(async (path: string) =>
    path.includes("/permission")
      ? { user: { id: 42 }, permission, role_name: permission }
      : { id: 42, login: "maintainer" },
  );
  const client: GitHubClient = {
    appId,
    repositoryId: "100",
    repository: "ariakit/ariakit",
    request,
  };
  return {
    client,
    setPermission(value: string) {
      permission = value;
    },
    /** The number of permission requests that went to GitHub. */
    liveChecks() {
      return request.mock.calls.filter(([path]) => path.includes("/permission")).length;
    },
  };
}

describe("Better Auth 1.7.5 with native D1", () => {
  it("stores sessions, accepts bearer reads, and revokes logout", async () => {
    const { auth, session, user } = await createSession();
    const headers = new Headers({ authorization: bearer(session.token) });
    expect(await auth.api.getSession({ headers })).toMatchObject({ user: { id: user.id } });
    const audit = await database
      .prepare("SELECT action FROM auth_audit WHERE user_id = ?")
      .bind(user.id)
      .all();
    expect(audit.results).toEqual([{ action: "sign_in" }]);
    await auth.api.signOut({ headers });
    expect(await auth.api.getSession({ headers })).toBeNull();
  });
  it("accepts a bearer token only with its signature", async () => {
    const { auth, session, user } = await createSession();
    const signed = new Headers({ authorization: bearer(session.token) });
    expect(await auth.api.getSession({ headers: signed })).toMatchObject({ user: { id: user.id } });
    const unsigned = new Headers({ authorization: `Bearer ${session.token}` });
    expect(await auth.api.getSession({ headers: unsigned })).toBeNull();
    const otherSecret = "another-random-test-secret-with-at-least-32-characters";
    const wrong = new Headers({ authorization: bearer(session.token, otherSecret) });
    expect(await auth.api.getSession({ headers: wrong })).toBeNull();
    // An instance accepts only a signature that its own secret made.
    const other = createAuth({ ...configuration, secret: otherSecret });
    expect(await other.api.getSession({ headers: signed })).toBeNull();
    expect(await other.api.getSession({ headers: unsigned })).toBeNull();
    expect(await other.api.getSession({ headers: wrong })).toMatchObject({ user: { id: user.id } });
  });
  it("expires persisted sessions and does not use cached cookies", async () => {
    const { auth, session } = await createSession();
    await database
      .prepare('UPDATE session SET "expiresAt" = ? WHERE id = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), session.id)
      .run();
    expect(
      await auth.api.getSession({
        headers: new Headers({ authorization: bearer(session.token) }),
      }),
    ).toBeNull();
    expect(auth.options.session?.cookieCache?.enabled).toBe(false);
    expect(auth.options.account?.encryptOAuthTokens).toBe(true);
  });
  it("renews an old session on D1 without interactive transactions", async () => {
    const { auth, session } = await createSession();
    await ageSession(session.id);
    const response = await auth.api.getSession({
      headers: new Headers({ authorization: bearer(session.token) }),
      asResponse: true,
    });
    expect(response.ok).toBe(true);
    const stored = await database
      .prepare('SELECT "updatedAt" FROM session WHERE id = ?')
      .bind(session.id)
      .first<{ updatedAt: string }>();
    expect(Date.parse(stored?.updatedAt ?? "")).toBeGreaterThan(Date.now() - 60_000);
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });
  it("keeps production sessions out of isolated preview storage", async () => {
    const { session } = await createSession();
    const secret = "preview-only-random-secret-with-at-least-32-characters";
    const preview = createAuth({
      ...configuration,
      database: previewDatabase,
      origin: "https://preview.example",
      environment: "preview",
      secret,
    });
    // The signature is valid for preview, so the answer comes from its storage.
    expect(
      await preview.api.getSession({
        headers: new Headers({ authorization: bearer(session.token, secret) }),
      }),
    ).toBeNull();
    expect(preview.options.advanced?.cookiePrefix).toBe("visonaut-preview");
  });
  it("handles concurrent independent request factories", async () => {
    const { session } = await createSession();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        createAuth(configuration).api.getSession({
          headers: new Headers({ authorization: bearer(session.token) }),
        }),
      ),
    );
    expect(results.every(Boolean)).toBe(true);
  });
  it("persists pending webhook payloads and rejects conflicting replay", async () => {
    const webhook = {
      deliveryId: crypto.randomUUID(),
      event: "push",
      payloadDigest: "a".repeat(64),
      payload: { repository: { id: 10 } },
      receivedAt: Date.now(),
    };
    expect(await persistWebhook(database, webhook)).toEqual({ processed: false });
    expect(
      await database
        .prepare(
          "SELECT payload_json, processed_at FROM github_webhook_delivery WHERE delivery_id = ?",
        )
        .bind(webhook.deliveryId)
        .first(),
    ).toEqual({ payload_json: JSON.stringify(webhook.payload), processed_at: null });
    expect(await persistWebhook(database, webhook)).toEqual({ processed: false });
    await expect(
      persistWebhook(database, { ...webhook, payloadDigest: "b".repeat(64) }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("revokes local sessions when GitHub authorization is revoked", async () => {
    const { auth, session } = await createSession();
    const webhook = {
      deliveryId: crypto.randomUUID(),
      event: "github_app_authorization",
      payloadDigest: "c".repeat(64),
      payload: { action: "revoked", sender: { id: 42 } },
      receivedAt: Date.now(),
    };
    await persistWebhook(database, webhook);
    await revokeGitHubAuthorization(database, webhook);
    expect(
      await auth.api.getSession({
        headers: new Headers({ authorization: bearer(session.token) }),
      }),
    ).toBeNull();
    expect(
      await database
        .prepare(
          "SELECT event, payload_digest, payload_json, processed_at FROM github_webhook_delivery WHERE delivery_id = ?",
        )
        .bind(webhook.deliveryId)
        .first(),
    ).toMatchObject({
      event: webhook.event,
      payload_digest: webhook.payloadDigest,
      payload_json: "{}",
      processed_at: expect.any(Number),
    });
    expect(await persistWebhook(database, webhook)).toEqual({ processed: true });
    await expect(
      persistWebhook(database, { ...webhook, payloadDigest: "e".repeat(64) }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("preserves a new login when a delayed processor repeats a settled revocation", async () => {
    const { auth, context, user, session } = await createSession();
    const webhook = {
      deliveryId: crypto.randomUUID(),
      event: "github_app_authorization",
      payloadDigest: "d".repeat(64),
      payload: { action: "revoked", sender: { id: 42 } },
      receivedAt: Date.now(),
    };
    await persistWebhook(database, webhook);
    await revokeGitHubAuthorization(database, webhook);
    expect(
      await auth.api.getSession({
        headers: new Headers({ authorization: bearer(session.token) }),
      }),
    ).toBeNull();

    const fresh = await context.internalAdapter.createSession(user.id);
    await database
      .prepare("UPDATE account SET accessToken=?,refreshToken=?,idToken=? WHERE userId=?")
      .bind("new-access", "new-refresh", "new-id", user.id)
      .run();
    // Both processors can read a pending receipt before either transaction commits.
    await revokeGitHubAuthorization(database, webhook);
    expect(
      await auth.api.getSession({
        headers: new Headers({ authorization: bearer(fresh.token) }),
      }),
    ).toMatchObject({ user: { id: user.id } });
    expect(
      await database
        .prepare("SELECT accessToken,refreshToken,idToken FROM account WHERE userId=?")
        .bind(user.id)
        .first(),
    ).toEqual({ accessToken: "new-access", refreshToken: "new-refresh", idToken: "new-id" });
    expect(
      await database
        .prepare("SELECT count(*) AS count FROM auth_audit WHERE id=?")
        .bind(`webhook:${webhook.deliveryId}`)
        .first(),
    ).toEqual({ count: 1 });
  });
});

describe("GitHub user token of a sign-in", () => {
  it("stores no token when the sign-in library creates or updates an account row", async () => {
    const noToken = {
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    };
    const tokens = (name: string) => ({
      accessToken: `${name}-access`,
      refreshToken: `${name}-refresh`,
      idToken: `${name}-id`,
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000),
    });
    const measured = measureD1(database);
    const auth = createAuth({ ...configuration, database: measured.database });
    const { internalAdapter } = await auth.$context;
    const user = await internalAdapter.createUser(
      { name: "Maintainer", email: `${crypto.randomUUID()}@example.com`, emailVerified: true },
      { method: "oauth", oauth: { providerId: "github" } },
    );
    const storedTokens = (accountId: string) =>
      database
        .prepare(
          "SELECT accessToken, refreshToken, idToken, accessTokenExpiresAt, refreshTokenExpiresAt FROM account WHERE id=?",
        )
        .bind(accountId)
        .first();

    // A first sign-in creates the row with the values that GitHub sent.
    measured.reset();
    const account = await internalAdapter.createAccount({
      providerId: "github",
      accountId: "4247",
      userId: user.id,
      ...tokens("first"),
    });
    // The hook changes the values of the one statement that writes the row.
    expect(measured.roundTrips()).toBe(1);
    expect(measured.costs[0]?.sql).toMatch(/^insert into "account"/);
    expect(account).toMatchObject({ accountId: "4247", userId: user.id });
    expect(await storedTokens(account.id)).toEqual(noToken);

    // A row from before this rule holds the values of its last sign-in.
    const expiry = new Date(Date.now() + 86_400_000).toISOString();
    await database
      .prepare(
        "UPDATE account SET accessToken=?, refreshToken=?, idToken=?, accessTokenExpiresAt=?, refreshTokenExpiresAt=? WHERE id=?",
      )
      .bind("old-access", "old-refresh", "old-id", expiry, expiry, account.id)
      .run();
    expect(await storedTokens(account.id)).toMatchObject({ accessToken: "old-access" });

    // A later sign-in updates the row with the new values of GitHub.
    measured.reset();
    const updated = await internalAdapter.updateAccount(account.id, {
      providerId: "github",
      ...tokens("later"),
    });
    expect(measured.roundTrips()).toBe(1);
    expect(measured.costs[0]?.sql).toMatch(/^update "account"/);
    expect(updated).toMatchObject({ id: account.id, accountId: "4247", userId: user.id });
    expect(await storedTokens(account.id)).toEqual(noToken);
  });
});

describe("session headers of a private request", () => {
  const github: GitHubClient = {
    appId: "session-headers",
    repositoryId: "100",
    repository: "ariakit/ariakit",
    request: async (path) =>
      path.includes("/permission")
        ? { user: { id: 42 }, permission: "write", role_name: "write" }
        : { id: 42, login: "maintainer" },
  };

  it("holds only the cookies of a renewed session", async () => {
    const { auth, session } = await createSession();
    await ageSession(session.id);
    const request = new Request(configuration.origin, {
      headers: { authorization: bearer(session.token) },
    });
    const identity = await requireMaintainer({ request, auth, database, github, access: "read" });
    expect(new Set(identity.sessionHeaders.keys())).toEqual(new Set(["set-cookie"]));
    const cookies = identity.sessionHeaders.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^__Secure-visonaut-production\.session_token=[^;]+; /);
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("Secure");
  });

  it("is empty when the session needs no renewal", async () => {
    const { auth, session } = await createSession();
    const request = new Request(configuration.origin, {
      headers: { authorization: bearer(session.token) },
    });
    const identity = await requireMaintainer({ request, auth, database, github, access: "read" });
    expect([...identity.sessionHeaders]).toEqual([]);
  });
});

describe("bounded private-read permission", () => {
  it("validates sessions on every read, expires at 60 seconds, and keeps writes live", async () => {
    const { auth, session } = await createSession();
    let permission = "write";
    const requestGithub = vi.fn(async (path: string) =>
      path.includes("/permission")
        ? { user: { id: 42 }, permission, role_name: permission }
        : { id: 42, login: "maintainer" },
    );
    const github: GitHubClient = {
      appId: "read-cache",
      repositoryId: "100",
      repository: "ariakit/ariakit",
      request: requestGithub,
    };
    const request = new Request(configuration.origin, {
      headers: { authorization: bearer(session.token) },
    });
    const parameters = { request, auth, database, github, access: "read" as const };
    const checkedAt = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(checkedAt);
    try {
      await requireMaintainer(parameters);
      permission = "read";
      clock.mockReturnValue(checkedAt + 59_999);
      await requireMaintainer(parameters);
      expect(
        requestGithub.mock.calls.filter(([path]) => path.includes("/permission")),
      ).toHaveLength(1);
      await expect(requireMaintainer({ ...parameters, access: "write" })).rejects.toMatchObject({
        code: "not_maintainer",
      });
      await expect(requireMaintainer(parameters)).rejects.toMatchObject({ code: "not_maintainer" });
      permission = "write";
      await requireMaintainer(parameters);
      clock.mockReturnValue(checkedAt + 119_999);
      permission = "read";
      await expect(requireMaintainer(parameters)).rejects.toMatchObject({ code: "not_maintainer" });
      permission = "write";
      await requireMaintainer(parameters);
      await auth.api.signOut({ headers: request.headers });
      const calls = requestGithub.mock.calls.length;
      await expect(requireMaintainer(parameters)).rejects.toMatchObject({
        code: "sign_in_required",
      });
      expect(requestGithub).toHaveBeenCalledTimes(calls);
    } finally {
      clock.mockRestore();
    }
  });

  it("isolates sessions and repositories and never caches a denial", async () => {
    const first = await createSession();
    const second = await createSession();
    let permission = "read";
    const transport = vi.fn(async (path: string) =>
      path.includes("/permission")
        ? { user: { id: 42 }, permission, role_name: permission }
        : { id: 42, login: "maintainer" },
    );
    const github: GitHubClient = {
      appId: "isolated-cache",
      repositoryId: "100",
      repository: "ariakit/ariakit",
      request: transport,
    };
    const parameters = {
      request: new Request(configuration.origin, {
        headers: { authorization: bearer(first.session.token) },
      }),
      auth: first.auth,
      database,
      github,
      access: "read" as const,
    };
    await expect(requireMaintainer(parameters)).rejects.toMatchObject({ code: "not_maintainer" });
    permission = "write";
    await requireMaintainer(parameters);
    permission = "read";
    await requireMaintainer(parameters);
    await expect(
      requireMaintainer({
        ...parameters,
        request: new Request(configuration.origin, {
          headers: { authorization: bearer(second.session.token) },
        }),
      }),
    ).rejects.toMatchObject({ code: "not_maintainer" });
    await expect(
      requireMaintainer({ ...parameters, github: { ...github, repositoryId: "101" } }),
    ).rejects.toMatchObject({ code: "not_maintainer" });
    const calls = transport.mock.calls.length;
    await expect(
      requireMaintainer({ ...parameters, request: new Request(configuration.origin) }),
    ).rejects.toMatchObject({ code: "sign_in_required" });
    expect(transport).toHaveBeenCalledTimes(calls);
  });
});

describe("bounded review permission", () => {
  it("reuses a read grant for decisions without extending its 10-second lifetime", async () => {
    const { auth, session } = await createSession();
    let permission = "write";
    const transport = vi.fn(async (path: string) =>
      path.includes("/permission")
        ? { user: { id: 42 }, permission, role_name: permission }
        : { id: 42, login: "maintainer" },
    );
    const parameters = {
      request: new Request(configuration.origin, {
        headers: { authorization: bearer(session.token) },
      }),
      auth,
      database,
      github: {
        appId: "review-cache",
        repositoryId: "100",
        repository: "ariakit/ariakit",
        request: transport,
      },
      access: "review" as const,
    };
    const checkedAt = Date.now();
    using clock = vi.spyOn(Date, "now").mockReturnValue(checkedAt);
    await requireMaintainer({ ...parameters, access: "read" });
    const calls = transport.mock.calls.length;
    permission = "read";
    for (const elapsed of [1_000, 5_000, 9_999]) {
      clock.mockReturnValue(checkedAt + elapsed);
      await requireMaintainer(parameters);
    }
    expect(transport).toHaveBeenCalledTimes(calls);
    clock.mockReturnValue(checkedAt + 10_000);
    await expect(requireMaintainer(parameters)).rejects.toMatchObject({ code: "not_maintainer" });
    await expect(requireMaintainer({ ...parameters, access: "read" })).rejects.toMatchObject({
      code: "not_maintainer",
    });
    permission = "write";
    await requireMaintainer(parameters);
    permission = "read";
    await expect(requireMaintainer({ ...parameters, access: "write" })).rejects.toMatchObject({
      code: "not_maintainer",
    });
    await expect(requireMaintainer(parameters)).rejects.toMatchObject({ code: "not_maintainer" });
    permission = "write";
    await requireMaintainer(parameters);
    clock.mockReturnValue(checkedAt + 20_000);
    transport.mockRejectedValue(new Error("GitHub unavailable"));
    await expect(requireMaintainer(parameters)).rejects.toThrow("GitHub unavailable");
  });

  it("counts slow GitHub verification time toward the review grant lifetime", async () => {
    const { auth, session } = await createSession();
    const checkedAt = Date.now();
    using clock = vi.spyOn(Date, "now").mockReturnValue(checkedAt);
    let permission = "write";
    const github: GitHubClient = {
      appId: "slow-review-cache",
      repositoryId: "100",
      repository: "ariakit/ariakit",
      async request(path) {
        if (!path.includes("/permission")) return { id: 42, login: "maintainer" };
        clock.mockReturnValue(checkedAt + 10_000);
        return { user: { id: 42 }, permission, role_name: permission };
      },
    };
    const parameters = {
      request: new Request(configuration.origin, {
        headers: { authorization: bearer(session.token) },
      }),
      auth,
      database,
      github,
      access: "review" as const,
    };
    await requireMaintainer(parameters);
    permission = "read";
    await expect(requireMaintainer(parameters)).rejects.toMatchObject({ code: "not_maintainer" });
  });

  it("checks live sessions and linked accounts and isolates App configurations", async () => {
    const { auth, session, user } = await createSession();
    const second = await createSession();
    let permission = "write";
    const transport = vi.fn(async (path: string) => {
      if (!path.includes("/permission")) return { id: 42, login: "maintainer" };
      return { user: { id: 42 }, permission, role_name: permission };
    });
    const parameters = {
      request: new Request(configuration.origin, {
        headers: { authorization: bearer(session.token) },
      }),
      auth,
      database,
      github: {
        appId: "isolated-review-cache",
        repositoryId: "100",
        repository: "ariakit/ariakit",
        authorizationKey: "original-app-configuration",
        request: transport,
      },
      access: "review" as const,
    };
    await requireMaintainer(parameters);
    permission = "read";
    await requireMaintainer(parameters);
    await expect(
      requireMaintainer({
        ...parameters,
        github: { ...parameters.github, authorizationKey: "rotated-app-configuration" },
      }),
    ).rejects.toMatchObject({ code: "not_maintainer" });
    await expect(
      requireMaintainer({
        ...parameters,
        request: new Request(configuration.origin, {
          headers: { authorization: bearer(second.session.token) },
        }),
      }),
    ).rejects.toMatchObject({ code: "not_maintainer" });
    await database.prepare("UPDATE account SET accountId='99' WHERE userId=?").bind(user.id).run();
    await expect(requireMaintainer(parameters)).rejects.toMatchObject({
      code: "github_unavailable",
    });
    await database.prepare("DELETE FROM account WHERE userId=?").bind(user.id).run();
    const calls = transport.mock.calls.length;
    await expect(requireMaintainer(parameters)).rejects.toMatchObject({ code: "invalid_identity" });
    expect(transport).toHaveBeenCalledTimes(calls);
    await auth.api.signOut({ headers: parameters.request.headers });
    await expect(requireMaintainer(parameters)).rejects.toMatchObject({ code: "sign_in_required" });
    expect(transport).toHaveBeenCalledTimes(calls);
  });
});

describe("schema check of Better Auth", () => {
  /** The options of the service, with the schema check of the library on. */
  function checkedAuth(checkedDatabase: typeof database) {
    const { options } = createAuth({ ...configuration, database: checkedDatabase });
    return betterAuth({
      ...options,
      advanced: {
        ...options.advanced,
        database: { ...options.advanced?.database, validateSchema: true },
      },
    });
  }

  it("does not run for a request", async () => {
    const auth = createAuth(configuration);
    expect(auth.options.advanced?.database?.validateSchema).toBe(false);
    expect((await auth.$context).checkSchema).toBeUndefined();
  });

  it("passes on the numbered migrations when a test turns it on", async () => {
    const { checkSchema } = await checkedAuth(database).$context;
    expect(checkSchema).toBeTypeOf("function");
    await expect(Promise.resolve(checkSchema?.())).resolves.toBeUndefined();
  });

  it("fails on a database that differs from the numbered migrations", async () => {
    using errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await applyTestMigrations(changedDatabase);
    await changedDatabase.prepare('ALTER TABLE "session" DROP COLUMN "userAgent"').run();
    const { checkSchema } = await checkedAuth(changedDatabase).$context;
    await expect(Promise.resolve(checkSchema?.())).rejects.toThrow(/userAgent/);
    expect(errors).toHaveBeenCalled();
  });
});

describe("D1 cost of the access check", () => {
  it("counts the D1 round trips of a private request with a session", async () => {
    const { session, user } = await createSession();
    const measured = measureD1(database);
    const github = createGitHub("access-cost");
    const request = new Request(configuration.origin, {
      headers: { authorization: bearer(session.token) },
    });
    // The second read and the decision use the stored result of the first read.
    for (const access of ["read", "read", "review", "write"] as const) {
      // The service creates the auth instance in each request.
      const auth = createAuth({ ...configuration, database: measured.database });
      measured.reset();
      const identity = await requireMaintainer({
        request,
        auth,
        database: measured.database,
        github: github.client,
        access,
      });
      expect(identity).toMatchObject({ userId: user.id, sessionId: session.id });
      expect(measured.roundTrips()).toBe(2);
      expect(measured.costs).toHaveLength(2);
      expect(measured.costs[0]?.sql).toMatch(/from "session".* join "user"/s);
      expect(measured.costs[1]?.sql).toMatch(/FROM account/);
      expect(measured.totals().rows_written).toBe(0);
    }
    expect(github.liveChecks()).toBe(2);
  });

  it("reads a session and its user in one statement with the values of each row", async () => {
    const { session, user } = await createSession();
    const measured = measureD1(database);
    const auth = createAuth({ ...configuration, database: measured.database });
    await auth.$context;
    measured.reset();
    const result = await auth.api.getSession({
      headers: new Headers({ authorization: bearer(session.token) }),
    });
    expect(measured.roundTrips()).toBe(1);
    // Both tables have the columns id, createdAt, and updatedAt.
    expect(result?.session).toMatchObject({
      id: session.id,
      token: session.token,
      userId: user.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
    });
    expect(result?.user).toMatchObject({
      id: user.id,
      name: "Maintainer",
      email: user.email,
      emailVerified: true,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
    expect(session.id).not.toBe(user.id);
  });

  it("finds the user of a GitHub account in one statement at sign-in", async () => {
    const auth = createAuth(configuration);
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser(
      { name: "Maintainer", email: `${crypto.randomUUID()}@example.com`, emailVerified: true },
      { method: "oauth", oauth: { providerId: "github" } },
    );
    const accountId = "4243";
    const account = await context.internalAdapter.createAccount({
      providerId: "github",
      accountId,
      userId: user.id,
    });
    const measured = measureD1(database);
    const measuredAuth = createAuth({ ...configuration, database: measured.database });
    const { internalAdapter } = await measuredAuth.$context;
    measured.reset();
    const owner = await internalAdapter.findAccountOwnerByKey({ providerId: "github", accountId });
    expect(measured.roundTrips()).toBe(1);
    expect(owner).toMatchObject({
      kind: "owned",
      user: { id: user.id, email: user.email },
      account: { id: account.id, accountId, userId: user.id },
    });
    expect(account.id).not.toBe(user.id);
    expect(
      await internalAdapter.findAccountOwnerByKey({ providerId: "github", accountId: "4244" }),
    ).toBeNull();
  });

  it("finds a user by email with each account in one statement at sign-in", async () => {
    const auth = createAuth(configuration);
    const context = await auth.$context;
    const email = `${crypto.randomUUID()}@example.com`;
    const user = await context.internalAdapter.createUser(
      { name: "Maintainer", email, emailVerified: true },
      { method: "oauth", oauth: { providerId: "github" } },
    );
    const measured = measureD1(database);
    const measuredAuth = createAuth({ ...configuration, database: measured.database });
    const { internalAdapter } = await measuredAuth.$context;
    measured.reset();
    // A user with no account row gives one joined row with empty account columns.
    expect(await internalAdapter.findUserByEmail(email, { includeAccounts: true })).toMatchObject({
      user: { id: user.id, email },
      accounts: [],
    });
    expect(measured.roundTrips()).toBe(1);
    const accounts = [];
    for (const accountId of ["4245", "4246"]) {
      accounts.push(
        await context.internalAdapter.createAccount({
          providerId: "github",
          accountId,
          userId: user.id,
        }),
      );
    }
    measured.reset();
    const found = await internalAdapter.findUserByEmail(email, { includeAccounts: true });
    expect(measured.roundTrips()).toBe(1);
    expect(found?.user).toMatchObject({
      id: user.id,
      email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
    expect(found?.accounts).toHaveLength(2);
    expect(found?.accounts).toEqual(
      expect.arrayContaining(
        accounts.map((account) =>
          expect.objectContaining({
            id: account.id,
            accountId: account.accountId,
            userId: user.id,
            createdAt: account.createdAt,
          }),
        ),
      ),
    );
    expect(
      await internalAdapter.findUserByEmail("nobody@example.com", { includeAccounts: true }),
    ).toBeNull();
  });
});

describe("stored result of a live permission check", () => {
  async function fixture(appId: string) {
    const { auth, session } = await createSession();
    const github = createGitHub(appId);
    const request = new Request(configuration.origin, {
      headers: { authorization: bearer(session.token) },
    });
    return { github, parameters: { request, auth, database, github: github.client } };
  }

  it("serves a read for less than 60 seconds after a live write check", async () => {
    const { github, parameters } = await fixture("write-serves-read");
    const checkedAt = Date.now();
    using clock = vi.spyOn(Date, "now").mockReturnValue(checkedAt);
    await requireMaintainer({ ...parameters, access: "write" });
    expect(github.liveChecks()).toBe(1);
    github.setPermission("read");
    clock.mockReturnValue(checkedAt + 59_999);
    await requireMaintainer({ ...parameters, access: "read" });
    expect(github.liveChecks()).toBe(1);
    // The next live check sees the removed permission.
    clock.mockReturnValue(checkedAt + 60_000);
    await expect(requireMaintainer({ ...parameters, access: "read" })).rejects.toMatchObject({
      code: "not_maintainer",
    });
    expect(github.liveChecks()).toBe(2);
  });

  it("serves a decision for less than 10 seconds after a live write check", async () => {
    const { github, parameters } = await fixture("write-serves-decision");
    const checkedAt = Date.now();
    using clock = vi.spyOn(Date, "now").mockReturnValue(checkedAt);
    await requireMaintainer({ ...parameters, access: "write" });
    github.setPermission("read");
    clock.mockReturnValue(checkedAt + 9_999);
    await requireMaintainer({ ...parameters, access: "review" });
    expect(github.liveChecks()).toBe(1);
    clock.mockReturnValue(checkedAt + 10_000);
    await expect(requireMaintainer({ ...parameters, access: "review" })).rejects.toMatchObject({
      code: "not_maintainer",
    });
    expect(github.liveChecks()).toBe(2);
  });

  it.each(["read", "review", "write"] as const)(
    "makes a live check for a write directly after a stored %s check",
    async (access) => {
      const { github, parameters } = await fixture(`write-after-${access}`);
      using clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
      await requireMaintainer({ ...parameters, access });
      expect(github.liveChecks()).toBe(1);
      // The stored result is in use: a read makes no request to GitHub.
      await requireMaintainer({ ...parameters, access: "read" });
      expect(github.liveChecks()).toBe(1);
      await requireMaintainer({ ...parameters, access: "write" });
      await requireMaintainer({ ...parameters });
      expect(github.liveChecks()).toBe(3);
      github.setPermission("read");
      await expect(requireMaintainer({ ...parameters, access: "write" })).rejects.toMatchObject({
        code: "not_maintainer",
      });
      expect(github.liveChecks()).toBe(4);
      // The failed live check removed the stored result.
      await expect(requireMaintainer({ ...parameters, access: "read" })).rejects.toMatchObject({
        code: "not_maintainer",
      });
      expect(github.liveChecks()).toBe(5);
      expect(clock).toHaveBeenCalled();
    },
  );
});
