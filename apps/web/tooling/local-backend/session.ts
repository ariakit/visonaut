import { createHmac } from "node:crypto";
import type { Database } from "@visonaut/service";

export interface Maintainer {
  id: number;
  login: string;
}

const sessionSeconds = 7 * 24 * 60 * 60;

/** The `Set-Cookie` value of a Better Auth session: the token and its HMAC-SHA256 signature. */
export function sessionCookie(token: string, secret: string) {
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  const value = encodeURIComponent(`${token}.${signature}`);
  return `visonaut-local.session_token=${value}; Path=/; Max-Age=${sessionSeconds}; HttpOnly; SameSite=Lax`;
}

/** Store the local maintainer with a GitHub account and one new session. */
export async function createSession(database: Database, maintainer: Maintainer, token: string) {
  const now = new Date();
  const date = now.toISOString();
  const expiry = new Date(now.getTime() + sessionSeconds * 1000).toISOString();
  const userId = "local-maintainer";
  await database.batch([
    database
      .prepare(
        'INSERT OR IGNORE INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
      )
      .bind(userId, maintainer.login, `${maintainer.login}@local.invalid`, date, date),
    database
      .prepare(
        "INSERT OR IGNORE INTO account(id,accountId,providerId,userId,createdAt,updatedAt) VALUES('local-account',?,'github',?,?,?)",
      )
      .bind(String(maintainer.id), userId, date, date),
    // Each start of the local backend has a new signing secret, so an old session cannot work.
    database.prepare("DELETE FROM session WHERE userId=?").bind(userId),
    database
      .prepare(
        "INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,userId) VALUES('local-session',?,?,?,?,?)",
      )
      .bind(expiry, token, date, date, userId),
  ]);
}
