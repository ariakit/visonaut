import type { D1Database } from "@cloudflare/workers-types";
import type { VisonautAuth } from "./auth.js";
import { numericId, SecurityError } from "./errors.js";
import { type GitHubClient, type MaintainerIdentity, requireRepositoryWrite } from "./github.js";

export interface RequireMaintainerParams {
  request: Request;
  auth: VisonautAuth;
  database: D1Database;
  github: GitHubClient;
  access?: "read" | "review" | "write";
  /**
   * True when the answer cannot set a cookie, because its headers are already
   * sent: the run list of a streamed document. The session is then read and
   * not renewed, so no new cookie is lost. The checks are the same.
   */
  disableRefresh?: boolean;
}

interface PrivatePermission {
  identity: MaintainerIdentity;
  checkedAt: number;
}

// The positive results of live GitHub permission checks, in the memory of the
// isolate. A result serves later reads and decisions for a limited time.
const privatePermissions = new WeakMap<D1Database, Map<string, PrivatePermission>>();
const maximumPrivatePermissions = 128;
const privateReadLifetime = 60_000;
// Decision submissions may reuse permission briefly during continuous review.
const reviewPermissionLifetime = 10_000;

/** Keep only the cookies of a session answer. A renewed session sets them. */
function sessionCookies(headers: Headers) {
  const cookies = new Headers();
  for (const cookie of headers.getSetCookie()) {
    cookies.append("Set-Cookie", cookie);
  }
  return cookies;
}

export async function requireMaintainer({
  request,
  auth,
  database,
  github,
  access = "write",
  disableRefresh = false,
}: RequireMaintainerParams) {
  const { response: session, headers } = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true, disableRefresh },
    returnHeaders: true,
  });
  if (!session) {
    throw new SecurityError("sign_in_required", 401, "Sign in with GitHub.");
  }
  const sessionHeaders = sessionCookies(headers);
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
  let permissions = privatePermissions.get(database);
  if (!permissions) {
    permissions = new Map();
    privatePermissions.set(database, permissions);
  }
  const cached = permissions.get(key);
  const lifetime = access === "read" ? privateReadLifetime : reviewPermissionLifetime;
  // A cache hit never skips the live session and linked account checks above.
  // A write never reads the stored result: it always makes the live check below.
  if (access !== "write" && cached && cached.checkedAt + lifetime > Date.now()) {
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
  // Each live check stores its positive result, also the check of a write.
  if (permissions.size >= maximumPrivatePermissions) {
    const oldest = permissions.keys().next().value;
    if (oldest !== undefined) {
      permissions.delete(oldest);
    }
  }
  permissions.set(key, { identity, checkedAt });
  return { ...identity, userId: session.user.id, sessionId: session.session.id, sessionHeaders };
}
