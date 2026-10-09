import type { D1Database } from "@cloudflare/workers-types";
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { assertFixedOrigin } from "./http.js";

export interface AuthConfiguration {
  database: D1Database;
  origin: string;
  environment: "production" | "preview" | "local";
  secret: string;
  githubClientId: string;
  githubClientSecret: string;
}

// The 5 columns of an account row that can hold the GitHub user token of a
// sign-in or the time of its expiry. The service reads none of them, so each
// write stores NULL.
const noUserToken = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
};

/** Create inside each request so a D1 binding cannot cross request ownership. */
export function createAuth(configuration: AuthConfiguration) {
  const origin = assertFixedOrigin(configuration.origin, configuration.environment);
  if (configuration.secret.length < 32) {
    throw new Error("The auth secret must contain at least 32 characters.");
  }
  return betterAuth({
    appName: "Visonaut",
    baseURL: origin,
    basePath: "/api/auth",
    secret: configuration.secret,
    database: configuration.database,
    trustedOrigins: [origin],
    emailAndPassword: { enabled: false },
    socialProviders: {
      github: {
        clientId: configuration.githubClientId,
        clientSecret: configuration.githubClientSecret,
        scope: ["read:user", "user:email"],
      },
    },
    account: {
      encryptOAuthTokens: true,
      // The update of a later sign-in is the write that sets the token columns
      // of an older row to NULL. See the account hook below.
      updateAccountOnSignIn: true,
      storeStateStrategy: "database",
      accountLinking: { enabled: false },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      cookiePrefix: `visonaut-${configuration.environment}`,
      useSecureCookies: configuration.environment !== "local",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      // Cloudflare sets this header to the one address of the client connection.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      // The numbered migrations own the schema, so no request checks it: a test
      // compares them with the library. A join reads a row and its user in one
      // statement.
      database: { validateSchema: false, joins: true },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    // A bearer token is the session token with the signature of its cookie.
    plugins: [bearer({ requireSignature: true })],
    databaseHooks: {
      account: {
        // The sign-in library creates the row at a first sign-in and updates it
        // at each later one. The hook replaces the values in that one write.
        create: { before: async () => ({ data: noUserToken }) },
        update: { before: async () => ({ data: noUserToken }) },
      },
      session: {
        create: {
          after: async (session) => {
            await configuration.database
              .prepare(
                "INSERT INTO auth_audit (id, user_id, action, created_at) VALUES (?, ?, 'sign_in', ?)",
              )
              .bind(crypto.randomUUID(), session.userId, Date.now())
              .run();
          },
        },
        delete: {
          after: async (session) => {
            await configuration.database
              .prepare(
                "INSERT INTO auth_audit (id, user_id, action, created_at) VALUES (?, ?, 'sign_out', ?)",
              )
              .bind(crypto.randomUUID(), session.userId, Date.now())
              .run();
          },
        },
      },
    },
    telemetry: { enabled: false },
  });
}

export type VisonautAuth = ReturnType<typeof createAuth>;
