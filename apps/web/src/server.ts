import { operationsMessage } from "@visonaut/service";
import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import {
  createAuth,
  createGitHubClient,
  requireMaintainer,
  requireSessionCredential,
  securePrivateResponse,
  SecurityError,
} from "@visonaut/security";
import { logOperationFailure } from "./operations/failure.ts";
import { previewFixtureResponse } from "./review/preview-fixtures.ts";
import { handleApi } from "./api/index.ts";
import { type DocumentContext, runListResult } from "./dashboard/run-list.ts";
import {
  apiBindings,
  authConfiguration,
  githubConfiguration,
  type OperationsMessage,
  reportSchedulerFailure,
  requireBackendBindings,
  runScheduledOperations,
} from "./runtime.ts";

// The type of the context that each document request gives to the router.
interface DocumentRegister {
  server: { requestContext: DocumentContext };
}

const render = createStartHandler<DocumentRegister>(async (context) => {
  const result = await defaultStreamHandler(context);
  const nonce = context.router.options.ssr?.nonce;
  if (result instanceof Response) return securePrivateResponse(result, nonce);
  return { ...result, response: securePrivateResponse(result.response, nonce) };
});

// Sign-in uses these four routes of Better Auth: the start, the GitHub
// callback, the sign-out, and the error page, to which a failed callback
// redirects. The match is exact. Each other path below /api/auth/ answers 404.
const servedAuthRoutes: ReadonlySet<string> = new Set([
  "POST /api/auth/sign-in/social",
  "GET /api/auth/callback/github",
  "POST /api/auth/sign-out",
  "GET /api/auth/error",
]);

/**
 * The context of one document request: the read of the run list that the
 * loader of the Queue and History starts. The answer comes from the handler
 * of `/api/runs` in the same process, so one endpoint and one access check
 * serve the document and the browser. The read does not throw.
 */
function documentContext(
  request: Request,
  respond: (request: Request) => Promise<Response | null> | Response | null,
): DocumentContext {
  return {
    readRunList: async () => {
      try {
        // The same headers as the document request: the cookie of the session.
        const response = await respond(
          new Request(new URL("/api/runs", request.url), { headers: request.headers }),
        );
        if (!response) throw new Error("The run list has no answer.");
        return await runListResult(response);
      } catch {
        return { status: "error", message: "The run list is temporarily unavailable." };
      }
    },
  };
}

const loopbackHostnames = new Set(["127.0.0.1", "localhost", "[::1]"]);

// `pnpm dev` runs the preview configuration on a loopback origin, which differs
// from the deployed `VISONAUT_ORIGIN`. A deployed Worker never receives it.
function isLoopbackOrigin(url: URL) {
  return url.protocol === "http:" && loopbackHostnames.has(url.hostname);
}

function launchEnabled(value: string) {
  return value === "true";
}

function privateFailure(error: unknown, correlationId: string) {
  return securePrivateResponse(
    Response.json(
      {
        error: {
          code: error instanceof SecurityError ? error.code : "service_unavailable",
          message:
            error instanceof SecurityError
              ? error.message
              : "The service is temporarily unavailable.",
          ...(error instanceof SecurityError ? {} : { reference: correlationId }),
        },
      },
      {
        status: error instanceof SecurityError ? error.status : 503,
        headers: { "Retry-After": "1" },
      },
    ),
  );
}

export default {
  async fetch(request: Request, env: Env, lifetime: Pick<ExecutionContext, "waitUntil">) {
    const startedAt = Date.now();
    const correlationId = crypto.randomUUID();
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return securePrivateResponse(
        Response.json({
          service: "visonaut",
          status: launchEnabled(env.VISONAUT_LAUNCH_ENABLED) ? "ready" : "setup",
          launchEnabled: launchEnabled(env.VISONAUT_LAUNCH_ENABLED),
          environment: env.VISONAUT_ENVIRONMENT,
          fixtureMode: env.VISONAUT_ENVIRONMENT === "preview",
        }),
      );
    }
    try {
      if (env.VISONAUT_ENVIRONMENT === "preview") {
        if (url.origin !== env.VISONAUT_ORIGIN && !isLoopbackOrigin(url)) {
          return securePrivateResponse(new Response(null, { status: 403 }));
        }
        const fixture = previewFixtureResponse(request);
        if (fixture) return securePrivateResponse(fixture);
        return await render(request, { context: documentContext(request, previewFixtureResponse) });
      }
      requireBackendBindings(env);
      if (url.pathname.startsWith("/api/auth/")) {
        // This answer comes before the auth instance, so no database work runs.
        if (!servedAuthRoutes.has(`${request.method} ${url.pathname}`)) {
          return securePrivateResponse(new Response(null, { status: 404 }));
        }
        if (url.origin !== env.VISONAUT_ORIGIN)
          return securePrivateResponse(new Response(null, { status: 403 }));
        const auth = createAuth(authConfiguration(env));
        return securePrivateResponse(await auth.handler(request));
      }
      if (url.pathname === "/api/me") {
        if (request.method !== "GET" || url.origin !== env.VISONAUT_ORIGIN)
          return securePrivateResponse(
            new Response(null, { status: request.method === "GET" ? 403 : 405 }),
          );
        requireSessionCredential(request);
        const auth = createAuth(authConfiguration(env));
        const github = await createGitHubClient(githubConfiguration(env));
        const identity = await requireMaintainer({
          request,
          auth,
          database: env.DB,
          github,
          access: "read",
        });
        return securePrivateResponse(
          Response.json({ userId: identity.userId }, { headers: identity.sessionHeaders }),
        );
      }
      if (
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/v1/") ||
        url.pathname.startsWith("/images/") ||
        url.pathname === "/webhooks/github"
      ) {
        const response = await handleApi(request, apiBindings(env), {
          waitUntil: (promise) => lifetime.waitUntil(promise),
          failure: { correlationId, startedAt },
        });
        if (response) return response;
      }
      return await render(request, {
        context: documentContext(request, (runsRequest) =>
          handleApi(runsRequest, apiBindings(env), {
            waitUntil: (promise) => lifetime.waitUntil(promise),
            // The document sends its headers before this answer is ready, so
            // a renewed session could not set its cookie.
            disableSessionRefresh: true,
          }),
        ),
      });
    } catch (error) {
      logOperationFailure({
        operation: url.pathname.startsWith("/api/auth/") ? "auth" : "http",
        code: error instanceof SecurityError ? error.code : "service_unavailable",
        correlationId,
        startedAt,
      });
      return privateFailure(error, correlationId);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    if (env.VISONAUT_ENVIRONMENT === "preview") return;
    try {
      requireBackendBindings(env);
      // Frequent cron triggers have a 30-second CPU limit; the queue runs the work.
      await env.OPERATIONS.send({ kind: "recovery" } satisfies OperationsMessage);
    } catch {
      await reportSchedulerFailure(env);
      throw new Error("Scheduled operations failed.");
    }
  },
  async queue(batch: MessageBatch<unknown>, env: Env) {
    if (env.VISONAUT_ENVIRONMENT === "preview") {
      for (const message of batch.messages) {
        message.ack();
      }
      return;
    }
    const valid = batch.messages.filter((message) => {
      const body = message.body;
      if (!operationsMessage(body)) {
        console.error(JSON.stringify({ event: "invalid-operations-message" }));
        message.ack();
        return false;
      }
      return true;
    });
    if (!valid.length) return;
    try {
      for (const message of valid) {
        const parsed = operationsMessage(message.body);
        if (!parsed) continue;
        await runScheduledOperations(env, parsed, message);
        message.ack();
      }
    } catch {
      await reportSchedulerFailure(env);
      for (const message of valid) message.retry({ delaySeconds: 60 });
    }
  },
} satisfies ExportedHandler<Env, unknown>;
