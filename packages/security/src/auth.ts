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
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    plugins: [bearer()],
    databaseHooks: {
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
