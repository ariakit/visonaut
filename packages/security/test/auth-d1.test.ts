import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "../src/auth.js";
import { persistWebhook, revokeGitHubAuthorization } from "../src/webhooks.js";

const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-09-21",
    d1Databases: ["DB", "PREVIEW_DB"],
  }),
);
const database = await runtime.getD1Database("DB");
const previewDatabase = await runtime.getD1Database("PREVIEW_DB");
const configuration = {
  database,
  origin: "https://auth.example",
  environment: "production",
  secret: "production-random-test-secret-with-at-least-32-characters",
  githubClientId: "test-client",
  githubClientSecret: "test-secret",
} as const;

beforeAll(async () => {
  const migration = (
    await readFile(new URL("../migrations/0001_auth.sql", import.meta.url), "utf8")
  ).replace(/^--.*$/gm, "");
  await database.exec(migration);
  await previewDatabase.exec(migration);
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

describe("Better Auth 1.7.5 with native D1", () => {
  it("stores sessions, accepts bearer reads, and revokes logout", async () => {
    const { auth, session, user } = await createSession();
    const headers = new Headers({ authorization: `Bearer ${session.token}` });
    expect(await auth.api.getSession({ headers })).toMatchObject({ user: { id: user.id } });
    const audit = await database
      .prepare("SELECT action FROM auth_audit WHERE user_id = ?")
      .bind(user.id)
      .all();
    expect(audit.results).toEqual([{ action: "sign_in" }]);
    await auth.api.signOut({ headers });
    expect(await auth.api.getSession({ headers })).toBeNull();
  });
  it("expires persisted sessions and does not use cached cookies", async () => {
    const { auth, session } = await createSession();
    await database
      .prepare('UPDATE session SET "expiresAt" = ? WHERE id = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), session.id)
      .run();
    expect(
      await auth.api.getSession({
        headers: new Headers({ authorization: `Bearer ${session.token}` }),
      }),
    ).toBeNull();
    expect(auth.options.session?.cookieCache?.enabled).toBe(false);
    expect(auth.options.account?.encryptOAuthTokens).toBe(true);
  });
  it("renews an old session on D1 without interactive transactions", async () => {
    const { auth, session } = await createSession();
    const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await database
      .prepare('UPDATE session SET "updatedAt" = ?, "expiresAt" = ? WHERE id = ?')
      .bind(old, new Date(Date.now() + 5 * 86_400_000).toISOString(), session.id)
      .run();
    const response = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${session.token}` }),
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
    const preview = createAuth({
      ...configuration,
      database: previewDatabase,
      origin: "https://preview.example",
      environment: "preview",
      secret: "preview-only-random-secret-with-at-least-32-characters",
    });
    expect(
      await preview.api.getSession({
        headers: new Headers({ authorization: `Bearer ${session.token}` }),
      }),
    ).toBeNull();
    expect(preview.options.advanced?.cookiePrefix).toBe("visonaut-preview");
  });
  it("handles concurrent independent request factories", async () => {
    const { session } = await createSession();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        createAuth(configuration).api.getSession({
          headers: new Headers({ authorization: `Bearer ${session.token}` }),
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
        headers: new Headers({ authorization: `Bearer ${session.token}` }),
      }),
    ).toBeNull();
    expect(await persistWebhook(database, webhook)).toEqual({ processed: true });
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
        headers: new Headers({ authorization: `Bearer ${session.token}` }),
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
        headers: new Headers({ authorization: `Bearer ${fresh.token}` }),
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
