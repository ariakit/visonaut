import type { D1Database } from "@cloudflare/workers-types";
import type { VisonautAuth } from "./auth.js";
import { numericId, SecurityError } from "./errors.js";
import { type GitHubClient, type MaintainerIdentity, requireRepositoryWrite } from "./github.js";

export interface RequireMaintainerParams {
  request: Request;
  auth: VisonautAuth;
  database: D1Database;
  github: GitHubClient;
  access?: "read" | "write";
}

interface PrivateReadPermission {
  identity: MaintainerIdentity;
  expiresAt: number;
}

const privateReadPermissions = new WeakMap<D1Database, Map<string, PrivateReadPermission>>();
const maximumPrivateReadPermissions = 128;
const privateReadLifetime = 60_000;

export async function requireMaintainer({
  request,
  auth,
  database,
  github,
  access = "write",
}: RequireMaintainerParams) {
  const { response: session, headers: sessionHeaders } = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
    returnHeaders: true,
  });
  if (!session) {
    throw new SecurityError("sign_in_required", 401, "Sign in with GitHub.");
  }
  const accounts = await database
    .prepare("SELECT accountId FROM account WHERE userId = ? AND providerId = 'github'")
    .bind(session.user.id)
    .all<{ accountId: string }>();
  const account = accounts.results[0];
  if (accounts.results.length !== 1 || !account) {
    throw new SecurityError("invalid_identity", 403, "A GitHub identity is required.");
  }
  const githubUserId = numericId(account.accountId);
  const key = JSON.stringify([
    session.session.id,
    session.user.id,
    githubUserId,
    github.authorizationKey ?? [github.appId, github.repositoryId, github.repository],
  ]);
  let permissions = privateReadPermissions.get(database);
  if (!permissions) {
    permissions = new Map();
    privateReadPermissions.set(database, permissions);
  }
  const cached = permissions.get(key);
  // A cache hit never skips the live session and linked account checks above.
  if (access === "read" && cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.identity,
      userId: session.user.id,
      sessionId: session.session.id,
      sessionHeaders,
    };
  }
  permissions.delete(key);
  const checkedAt = Date.now();
  const identity = await requireRepositoryWrite(github, githubUserId);
  if (access === "read") {
    if (permissions.size >= maximumPrivateReadPermissions) {
      const oldest = permissions.keys().next().value;
      if (oldest !== undefined) {
        permissions.delete(oldest);
      }
    }
    permissions.set(key, { identity, expiresAt: checkedAt + privateReadLifetime });
  }
  return { ...identity, userId: session.user.id, sessionId: session.session.id, sessionHeaders };
}
