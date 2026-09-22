import type { D1Database } from "@cloudflare/workers-types";
import type { ArivisoAuth } from "./auth.js";
import { numericId, SecurityError } from "./errors.js";
import { type GitHubClient, requireRepositoryWrite } from "./github.js";

export interface RequireMaintainerParams {
  request: Request;
  auth: ArivisoAuth;
  database: D1Database;
  github: GitHubClient;
}

export async function requireMaintainer({
  request,
  auth,
  database,
  github,
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
  const identity = await requireRepositoryWrite(github, numericId(account.accountId));
  return { ...identity, userId: session.user.id, sessionId: session.session.id, sessionHeaders };
}
